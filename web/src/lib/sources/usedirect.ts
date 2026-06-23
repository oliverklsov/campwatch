// US eDirect / "Recreation Dynamics" adapter (Tyler Technologies family).
//
// One JSON API shape powers many state-park systems; only the host differs.
// Confirmed live shapes (ReserveCalifornia, June 2026):
//   GET  {apiBase}fd/places            -> [{ PlaceId, Name, City, State, Zip, Latitude, Longitude, ... }]
//   POST {apiBase}search/place {PlaceId,StartDate,Nights} -> { SelectedPlace:{ Facilities:{ <id>:{ FacilityId, Name, Category, Latitude, Longitude, FacilityAllowWebBooking } } } }
//   POST {apiBase}search/grid  {FacilityId,StartDate,Nights} -> { Facility:{ Units:{ <id>:{ UnitId, Name, ShortName, Slices:{ "YYYY-MM-DDT00:00:00":{ Date, IsFree, IsBlocked } } } } } }
// `IsFree === true` means the site is bookable that night.
//
// Facility ids are namespaced in our DB as `ued-<state>-<FacilityId>` (e.g. ued-ca-708).

import type { Opening } from "@/lib/types";

export type UsedirectState = {
  apiBase: string; // ends with "/rdr/"
  bookingBase: string; // public reservation site root (used for "Book now" links)
  name: string;
};

// Hosts captured from each system's live `window.apiurl`. Bases end in "/rdr/".
export const USEDIRECT_STATES: Record<string, UsedirectState> = {
  ca: {
    apiBase: "https://california-rdr.prod.cali.rd12.recreation-management.tylerapp.com/rdr/",
    bookingBase: "https://www.reservecalifornia.com/",
    name: "California State Parks",
  },
  fl: {
    apiBase: "https://floridardr.usedirect.com/Floridardr/rdr/",
    bookingBase: "https://reserve.floridastateparks.org/",
    name: "Florida State Parks",
  },
  mn: {
    apiBase: "https://mnrdr.usedirect.com/minnesotardr/rdr/",
    bookingBase: "https://reservemn.usedirect.com/",
    name: "Minnesota State Parks",
  },
  va: {
    apiBase: "https://prod-va-rdr.recreation-management.tylerapp.com/virginiardr/rdr/",
    bookingBase: "https://reservevaparks.com/",
    name: "Virginia State Parks",
  },
  oh: {
    apiBase: "https://ohiordr.usedirect.com/Ohiordr/rdr/",
    bookingBase: "https://reserveohio.com/",
    name: "Ohio State Parks",
  },
  nv: {
    apiBase: "https://nevadardr.usedirect.com/NevadaRDR/rdr/",
    bookingBase: "https://reservenevada.com/",
    name: "Nevada State Parks",
  },
  mo: {
    apiBase: "https://msprdr.usedirect.com/MSPRDR/rdr/",
    bookingBase: "https://icampmo1.usedirect.com/",
    name: "Missouri State Parks",
  },
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export function isUsedirectId(id: string): boolean {
  return id.startsWith("ued-");
}

export function parseUsedirectId(id: string): { state: string; facilityId: string } | null {
  // ued-<state>-<facilityId>; state is 2 letters, facilityId is the rest.
  const m = /^ued-([a-z]{2})-(.+)$/.exec(id);
  if (!m) return null;
  return { state: m[1], facilityId: m[2] };
}

export function makeUsedirectId(state: string, facilityId: string | number): string {
  return `ued-${state.toLowerCase()}-${facilityId}`;
}

export function usedirectBookingUrl(id: string): string {
  const p = parseUsedirectId(id);
  const cfg = p && USEDIRECT_STATES[p.state];
  return cfg ? cfg.bookingBase : "https://www.recreation.gov/";
}

type Slice = { Date?: string; IsFree?: boolean; IsBlocked?: boolean; IsWalkin?: boolean };
type Unit = { UnitId?: number; Name?: string; ShortName?: string; Slices?: Record<string, Slice> };
type GridResponse = { Facility?: { Units?: Record<string, Unit>; UnitCount?: number } };

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(d: string, n: number): string {
  return new Date(Date.parse(d + "T00:00:00Z") + n * 86400_000).toISOString().slice(0, 10);
}
function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400_000);
}

async function gridChunk(
  cfg: UsedirectState,
  facilityId: string,
  startDate: string,
  nights: number
): Promise<GridResponse> {
  const res = await fetch(cfg.apiBase + "search/grid", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/plain, */*",
      "User-Agent": UA,
      Referer: cfg.bookingBase,
      Origin: cfg.bookingBase.replace(/\/$/, ""),
    },
    cache: "no-store",
    body: JSON.stringify({
      FacilityId: facilityId,
      StartDate: startDate,
      Nights: nights,
      InSeasonOnly: true,
      WebOnly: true,
      IsADA: false,
      SleepingUnitId: 0,
      MinVehicleLength: 0,
      UnitCategoryId: 0,
      UnitTypesGroupIds: [],
    }),
  });
  if (!res.ok) throw new Error(`usedirect grid ${res.status} for ${facilityId}`);
  return (await res.json()) as GridResponse;
}

/**
 * Fetch the availability grid for [start, end], chunking the window so we cover
 * it regardless of the server's default grid length. Returns the bookable
 * openings plus the total number of campsites (units) seen.
 */
export async function usedirectSiteSummary(
  id: string,
  start: string,
  end: string
): Promise<{ openings: Opening[]; siteTotal: number }> {
  const p = parseUsedirectId(id);
  if (!p) throw new Error(`bad usedirect id: ${id}`);
  const cfg = USEDIRECT_STATES[p.state];
  if (!cfg) throw new Error(`unknown usedirect state: ${p.state}`);

  const CHUNK = 13; // request ~2-week grids
  // Build the chunk windows, then fetch them all in parallel.
  const chunkStarts: string[] = [];
  for (let cursor = start, guard = 0; cursor <= end && guard < 40; cursor = addDays(cursor, CHUNK), guard++) {
    chunkStarts.push(cursor);
  }
  const grids = await Promise.all(
    chunkStarts.map((s) =>
      gridChunk(cfg, p.facilityId, s, Math.min(CHUNK, Math.max(1, dayDiff(s, end) + 1))).catch(() => null)
    )
  );

  const seen = new Set<string>();
  const openings: Opening[] = [];
  const units = new Set<string>();
  for (const grid of grids) {
    if (!grid) continue;
    const unitMap = grid.Facility?.Units ?? {};
    for (const [uid, unit] of Object.entries(unitMap)) {
      const site = (unit.Name || unit.ShortName || uid).toString().trim();
      units.add(site);
      for (const [sliceKey, slice] of Object.entries(unit.Slices ?? {})) {
        const date = (slice.Date || sliceKey).slice(0, 10);
        if (date < start || date > end) continue;
        if (slice.IsFree === true && slice.IsBlocked !== true) {
          const key = `${site}|${date}`;
          if (!seen.has(key)) {
            seen.add(key);
            openings.push({ site, date, status: "Available" });
          }
        }
      }
    }
  }

  return { openings, siteTotal: units.size };
}

/** Poller entry point: just the bookable openings for [start, end]. */
export async function usedirectOpenings(id: string, start: string, end: string): Promise<Opening[]> {
  return (await usedirectSiteSummary(id, start, end)).openings;
}

export { ymd };
