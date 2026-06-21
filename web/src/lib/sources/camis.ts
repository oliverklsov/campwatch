// Camis / GoingToCamp adapter (WA, WI, MI, MD).
//
// Confirmed live shapes (Washington, June 2026):
//   GET /api/resourceLocation        -> [{ resourceLocationId, rootMapId, gpsCoordinates:"lat, lng",
//                                          localizedValues:[{ fullName, shortName, city }] }]
//   GET /api/bookingcategories       -> [{ bookingCategoryId, localizedValues:[{name}] }]  ("Campsite" is the camping one)
//   GET /api/availability/map?mapId=<id>&bookingCategoryId=<c>&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
//       &getDailyAvailability=true&isReserving=true
//     -> { resourceAvailabilities:{ <resourceId>:[{availability,remainingQuota}, …per night] },
//          mapLinkAvailabilities:{ <childMapId>:[…] } }   // tree: drill children until resources appear
//   availability === 0  => bookable that night.
//
// The API sits behind an Azure WAF that rejects bare requests, so every call
// sends full browser-like headers (confirmed to pass from Node).
//
// Facility ids: `camis-<tenant>-<rootMapId>` (rootMapId is what availability needs,
// and ids can be negative, e.g. camis-wa--2147483396).

import type { Opening } from "@/lib/types";

export type CamisTenant = {
  host: string; // e.g. https://washington.goingtocamp.com
  name: string;
  abbr: string; // state code for the `state` column
};

// WA confirmed live; the others are the documented GoingToCamp tenants (same API).
export const CAMIS_TENANTS: Record<string, CamisTenant> = {
  wa: { host: "https://washington.goingtocamp.com", name: "Washington State Parks", abbr: "WA" },
  wi: { host: "https://wisconsin.goingtocamp.com", name: "Wisconsin State Parks", abbr: "WI" },
  mi: { host: "https://midnrreservations.com", name: "Michigan State Parks", abbr: "MI" },
  md: { host: "https://parkreservations.maryland.gov", name: "Maryland State Parks", abbr: "MD" },
};

function camisHeaders(host: string): Record<string, string> {
  return {
    accept: "application/json, text/plain, */*",
    "accept-language": "en-US,en;q=0.9",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    referer: host + "/",
    origin: host,
    "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
  };
}

export function isCamisId(id: string): boolean {
  return id.startsWith("camis-");
}
export function parseCamisId(id: string): { tenant: string; mapId: number } | null {
  const m = /^camis-([a-z]{2})-(-?\d+)$/.exec(id);
  if (!m) return null;
  return { tenant: m[1], mapId: Number(m[2]) };
}
export function makeCamisId(tenant: string, rootMapId: number | string): string {
  return `camis-${tenant.toLowerCase()}-${rootMapId}`;
}
export function camisBookingUrl(id: string): string {
  const p = parseCamisId(id);
  const t = p && CAMIS_TENANTS[p.tenant];
  return t ? t.host + "/" : "https://www.recreation.gov/";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function addDays(d: string, n: number): string {
  return new Date(Date.parse(d + "T00:00:00Z") + n * 86400_000).toISOString().slice(0, 10);
}

// "Campsite" bookingCategoryId, memoized per tenant host.
const catCache = new Map<string, number>();
export async function camisCampsiteCategory(host: string): Promise<number> {
  if (catCache.has(host)) return catCache.get(host)!;
  const res = await fetch(host + "/api/bookingcategories", { headers: camisHeaders(host), cache: "no-store" });
  if (!res.ok) throw new Error(`camis bookingcategories ${res.status}`);
  const cats = (await res.json()) as Array<{ bookingCategoryId?: number; id?: number; localizedValues?: { name?: string }[]; name?: string }>;
  const match =
    cats.find((c) => /^campsite$/i.test(c.localizedValues?.[0]?.name || c.name || "")) ||
    cats.find((c) => /campsite|campground/i.test(c.localizedValues?.[0]?.name || c.name || ""));
  const cid = match ? (match.bookingCategoryId ?? match.id ?? 0) : 0;
  catCache.set(host, cid);
  return cid;
}

type Slot = { availability: number; remainingQuota: number | null };
type AvailResp = {
  resourceAvailabilities?: Record<string, Slot[]>;
  mapLinkAvailabilities?: Record<string, number[]>;
};

async function getMapAvailability(
  host: string,
  mapId: number,
  catId: number,
  start: string,
  end: string
): Promise<AvailResp> {
  const u =
    `${host}/api/availability/map?mapId=${mapId}&bookingCategoryId=${catId}` +
    `&startDate=${start}&endDate=${end}&getDailyAvailability=true&isReserving=true`;
  const res = await fetch(u, { headers: camisHeaders(host), cache: "no-store" });
  if (!res.ok) throw new Error(`camis availability ${res.status} for map ${mapId}`);
  return (await res.json()) as AvailResp;
}

/**
 * Walk the park's map tree from rootMapId, collecting every resource (campsite)
 * that is bookable (availability === 0) on each night in [start, end]. Bounded
 * by a visited set + a hard map cap so a deep park can't run away.
 */
async function collectOpenings(id: string, start: string, end: string): Promise<{ openings: Opening[]; siteTotal: number }> {
  const p = parseCamisId(id);
  if (!p) throw new Error(`bad camis id: ${id}`);
  const t = CAMIS_TENANTS[p.tenant];
  if (!t) throw new Error(`unknown camis tenant: ${p.tenant}`);
  const catId = await camisCampsiteCategory(t.host);

  const openings: Opening[] = [];
  const sites = new Set<string>();
  const visited = new Set<number>();
  const queue: number[] = [p.mapId];
  let calls = 0;

  while (queue.length && calls < 40) {
    const mapId = queue.shift()!;
    if (visited.has(mapId)) continue;
    visited.add(mapId);
    calls++;
    let data: AvailResp;
    try {
      data = await getMapAvailability(t.host, mapId, catId, start, end);
    } catch {
      continue; // skip a flaky node rather than abort the park
    }
    for (const [resourceId, slots] of Object.entries(data.resourceAvailabilities ?? {})) {
      const site = `R${resourceId}`;
      sites.add(site);
      slots.forEach((slot, i) => {
        if (slot.availability === 0) {
          const date = addDays(start, i);
          if (date <= end) openings.push({ site, date, status: "Available" });
        }
      });
    }
    for (const childId of Object.keys(data.mapLinkAvailabilities ?? {})) {
      const cid = Number(childId);
      if (!visited.has(cid)) queue.push(cid);
    }
    await sleep(80);
  }

  return { openings, siteTotal: sites.size };
}

/** Poller entry point. */
export async function camisOpenings(id: string, start: string, end: string): Promise<Opening[]> {
  return (await collectOpenings(id, start, end)).openings;
}

/** Availability-sheet entry point: openings + total campsite count. */
export async function camisSiteSummary(id: string, start: string, end: string): Promise<{ openings: Opening[]; siteTotal: number }> {
  return collectOpenings(id, start, end);
}
