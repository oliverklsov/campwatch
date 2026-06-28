// Provider dispatch. Routes and the poller call these instead of the
// recreation.gov helpers directly, so each facility id is sent to the right
// backend based on its source prefix:
//   bare numeric  -> recreation.gov
//   ued-*         -> US eDirect state parks
//   camis-*       -> Camis / GoingToCamp   (added later)

import type { Opening } from "@/lib/types";
import { fetchOpenings as recOpenings, fetchAvailabilityDetail, bookingUrl as recBookingUrl } from "@/lib/recgov";
import { fetchReservationType } from "@/lib/ridb";
import {
  isUsedirectId,
  usedirectOpenings,
  usedirectSiteSummary,
  usedirectBookingUrl,
  USEDIRECT_STATES,
  parseUsedirectId,
} from "./usedirect";
import {
  isCamisId,
  camisOpenings,
  camisSiteSummary,
  camisBookingUrl,
  CAMIS_TENANTS,
  parseCamisId,
} from "./camis";

export type Source = "recreation.gov" | "usedirect" | "camis";

export function sourceOf(id: string): Source {
  if (isUsedirectId(id)) return "usedirect";
  if (isCamisId(id)) return "camis";
  return "recreation.gov";
}

export function bookingUrlForFacility(id: string): string {
  switch (sourceOf(id)) {
    case "usedirect":
      return usedirectBookingUrl(id);
    case "camis":
      return camisBookingUrl(id);
    default:
      return recBookingUrl(id);
  }
}

/** Human label for where this facility is booked, e.g. for "Reservable on …". */
export function bookingLabelForFacility(id: string): string {
  if (sourceOf(id) === "usedirect") {
    const p = parseUsedirectId(id);
    return (p && USEDIRECT_STATES[p.state]?.name) || "the state park system";
  }
  if (sourceOf(id) === "camis") {
    const p = parseCamisId(id);
    return (p && CAMIS_TENANTS[p.tenant]?.name) || "the state park system";
  }
  return "recreation.gov";
}

/** Poller hook: bookable/FCFS openings for [start, end]. */
export async function fetchOpeningsForFacility(
  id: string,
  start: string,
  end: string
): Promise<Opening[]> {
  switch (sourceOf(id)) {
    case "usedirect":
      return usedirectOpenings(id, start, end);
    case "camis":
      return camisOpenings(id, start, end);
    default:
      return recOpenings(id, start, end);
  }
}

export type AvailabilityResult = {
  facilityId: string;
  window: { start: string; end: string };
  resType: "reservable" | "fcfs" | "mixed" | "unknown";
  reservableSites: number;
  fcfsSites: number;
  siteTotal: number;
  totalOpenings: number;
  bookable: number;
  fcfs: number;
  bookableSites: number;
  openSites: number;
  siteNightDates: { date: string; count: number; status: "Available" | "Open" }[];
  // Per actual campsite: which nights in the window it's open. Real site names
  // for recreation.gov + US eDirect; resource ids for Camis.
  siteAvailability: { site: string; dates: { date: string; status: "Available" | "Open" }[] }[];
  bookingUrl: string;
  bookingLabel: string;
  error?: string;
};

// Short-TTL memo so repeated taps on a state-park pin are instant and we don't
// re-walk the upstream tree each time. Per serverless instance; ample for the
// bottom-sheet use case (availability doesn't change second-to-second).
type StateParkAvailCacheEntry = { at: number; val: AvailabilityResult };
const stateParkAvailCache = new Map<string, StateParkAvailCacheEntry>();
const AVAIL_TTL_MS = 60_000;

export function aggregate(
  id: string,
  start: string,
  end: string,
  openings: Opening[]
): Pick<
  AvailabilityResult,
  "totalOpenings" | "bookable" | "fcfs" | "bookableSites" | "openSites" | "siteNightDates" | "siteAvailability"
> {
  const byDate: Record<string, { count: number; available: number; open: number }> = {};
  for (const o of openings) {
    const e = (byDate[o.date] ??= { count: 0, available: 0, open: 0 });
    e.count++;
    if (o.status === "Available") e.available++;
    else e.open++;
  }
  const siteNightDates = Object.entries(byDate)
    .map(([date, v]) => ({ date, count: v.count, status: (v.available > 0 ? "Available" : "Open") as "Available" | "Open" }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Per-site breakdown: each site open on >=1 night in the window, with the
  // specific nights it's available (capped to keep the payload bounded).
  const bySite = new Map<string, { date: string; status: "Available" | "Open" }[]>();
  for (const o of openings) {
    const arr = bySite.get(o.site) ?? [];
    arr.push({ date: o.date, status: o.status });
    bySite.set(o.site, arr);
  }
  const siteAvailability = [...bySite.entries()]
    .map(([site, dates]) => ({ site, dates: dates.sort((a, b) => a.date.localeCompare(b.date)) }))
    .sort((a, b) => a.site.localeCompare(b.site, undefined, { numeric: true }))
    .slice(0, 100);

  return {
    totalOpenings: openings.length,
    bookable: openings.filter((o) => o.status === "Available").length,
    fcfs: openings.filter((o) => o.status === "Open").length,
    bookableSites: new Set(openings.filter((o) => o.status === "Available").map((o) => o.site)).size,
    openSites: new Set(openings.filter((o) => o.status === "Open").map((o) => o.site)).size,
    siteNightDates,
    siteAvailability,
  };
}

/** On-demand availability for the Explore bottom sheet, normalized per source. */
export async function getAvailability(id: string, start: string, end: string): Promise<AvailabilityResult> {
  const window = { start, end };
  const bookingUrl = bookingUrlForFacility(id);
  const bookingLabel = bookingLabelForFacility(id);

  const src = sourceOf(id);
  if (src === "usedirect" || src === "camis") {
    const cacheKey = `${id}|${start}|${end}`;
    const hit = stateParkAvailCache.get(cacheKey);
    if (hit && Date.now() - hit.at < AVAIL_TTL_MS) return hit.val;
    let result: AvailabilityResult;
    try {
      const { openings, siteTotal } =
        src === "usedirect"
          ? await usedirectSiteSummary(id, start, end)
          : await camisSiteSummary(id, start, end);
      // State-park systems are fully reservable (no FCFS concept exposed).
      result = {
        facilityId: id,
        window,
        resType: "reservable",
        reservableSites: siteTotal,
        fcfsSites: 0,
        siteTotal,
        ...aggregate(id, start, end, openings),
        bookingUrl,
        bookingLabel,
      };
    } catch (e) {
      result = {
        facilityId: id,
        window,
        resType: "reservable",
        reservableSites: 0,
        fcfsSites: 0,
        siteTotal: 0,
        totalOpenings: 0,
        bookable: 0,
        fcfs: 0,
        bookableSites: 0,
        openSites: 0,
        siteNightDates: [],
        siteAvailability: [],
        bookingUrl,
        bookingLabel,
        error: e instanceof Error ? e.message : "availability fetch failed",
      };
    }
    if (!result.error) stateParkAvailCache.set(cacheKey, { at: Date.now(), val: result });
    return result;
  }

  // recreation.gov: authoritative reservation type from RIDB + live availability.
  const resvPromise = fetchReservationType(id);
  try {
    const { openings } = await fetchAvailabilityDetail(id, start, end, { jitter: { min: 0, max: 150 } });
    const resv = await resvPromise;
    return {
      facilityId: id,
      window,
      resType: resv.resType,
      reservableSites: resv.reservableSites,
      fcfsSites: resv.fcfsSites,
      siteTotal: resv.siteTotal,
      ...aggregate(id, start, end, openings),
      bookingUrl,
      bookingLabel,
    };
  } catch (e) {
    const resv = await resvPromise;
    return {
      facilityId: id,
      window,
      resType: resv.resType,
      reservableSites: resv.reservableSites,
      fcfsSites: resv.fcfsSites,
      siteTotal: resv.siteTotal,
      totalOpenings: 0,
      bookable: 0,
      fcfs: 0,
      bookableSites: 0,
      openSites: 0,
      siteNightDates: [],
      siteAvailability: [],
      bookingUrl,
      bookingLabel,
      error: e instanceof Error ? e.message : "availability fetch failed",
    };
  }
}
