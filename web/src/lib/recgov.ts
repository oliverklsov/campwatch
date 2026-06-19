// TypeScript port of the Python poller's RecGovClient.
// All assumptions about the UNDOCUMENTED availability endpoint live in this file.

import type { Opening } from "./types";

const BASE = "https://www.recreation.gov/api/camps/availability/campground";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

type RawMonth = {
  campsites?: Record<
    string,
    { site?: string; loop?: string; availabilities?: Record<string, string> }
  >;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function* monthsCovering(start: string, end: string): Generator<string> {
  let [y, m] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    yield `${y}-${String(m).padStart(2, "0")}-01`;
    m === 12 ? ((m = 1), y++) : m++;
  }
}

type Jitter = { min: number; max: number };
const POLLER_JITTER: Jitter = { min: 200, max: 1700 }; // polite for bulk polling

async function fetchMonth(
  facilityId: string,
  monthStart: string,
  jitter: Jitter = POLLER_JITTER
): Promise<RawMonth> {
  await sleep(jitter.min + Math.random() * (jitter.max - jitter.min)); // politeness jitter
  const url = `${BASE}/${facilityId}/month?start_date=${encodeURIComponent(`${monthStart}T00:00:00.000Z`)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    cache: "no-store",
  });
  if (res.status === 404) return { campsites: {} };
  if (!res.ok) throw new Error(`rec.gov ${res.status} for facility ${facilityId} (${monthStart})`);
  return (await res.json()) as RawMonth;
}

/**
 * Fetch every (site, date, status) opening for a facility across the months
 * covering [start, end]. Statuses: "Available" (bookable) and "Open" (FCFS).
 */
export async function fetchOpenings(
  facilityId: string,
  start: string,
  end: string,
  opts?: { jitter?: Jitter }
): Promise<Opening[]> {
  const openings: Opening[] = [];
  for (const m of monthsCovering(start, end)) {
    const raw = await fetchMonth(facilityId, m, opts?.jitter);
    for (const c of Object.values(raw.campsites ?? {})) {
      const site = c.site ?? "?";
      for (const [day, status] of Object.entries(c.availabilities ?? {})) {
        const date = day.slice(0, 10);
        if (date >= start && date <= end && (status === "Available" || status === "Open")) {
          openings.push({ site, date, status });
        }
      }
    }
  }
  return openings;
}

/**
 * Like fetchOpenings, but also returns the full status tally and site count for
 * the window — so callers can tell a *full reservable* campground (statuses like
 * Reserved/NYR) apart from one that's *first-come-first-served / not bookable
 * online right now* (sites exist but none are in the reservation system).
 */
export async function fetchAvailabilityDetail(
  facilityId: string,
  start: string,
  end: string,
  opts?: { jitter?: Jitter }
): Promise<{ openings: Opening[]; statusCounts: Record<string, number>; siteCount: number }> {
  const openings: Opening[] = [];
  const statusCounts: Record<string, number> = {};
  const sites = new Set<string>();
  for (const m of monthsCovering(start, end)) {
    const raw = await fetchMonth(facilityId, m, opts?.jitter);
    for (const c of Object.values(raw.campsites ?? {})) {
      const site = c.site ?? "?";
      let inWindow = false;
      for (const [day, status] of Object.entries(c.availabilities ?? {})) {
        const date = day.slice(0, 10);
        if (date < start || date > end) continue;
        inWindow = true;
        statusCounts[status] = (statusCounts[status] ?? 0) + 1;
        if (status === "Available" || status === "Open") openings.push({ site, date, status });
      }
      if (inWindow) sites.add(site);
    }
  }
  return { openings, statusCounts, siteCount: sites.size };
}

/**
 * Detect a campground's rolling booking window by scanning forward for the
 * boundary where dates flip to "NYR" (Not Yet Released). The latest released
 * date is the current horizon; horizon - today ≈ the window length.
 */
export async function fetchReleaseWindow(
  facilityId: string,
  opts?: { jitter?: Jitter }
): Promise<{ horizon: string | null; windowDays: number | null }> {
  const today = new Date();
  let y = today.getUTCFullYear();
  let m = today.getUTCMonth() + 1;
  let horizon: string | null = null;
  let sawReleased = false;

  for (let i = 0; i < 10; i++) {
    const monthStart = `${y}-${String(m).padStart(2, "0")}-01`;
    const raw = await fetchMonth(facilityId, monthStart, opts?.jitter);
    let monthReleased = false;
    for (const c of Object.values(raw.campsites ?? {})) {
      for (const [day, status] of Object.entries(c.availabilities ?? {})) {
        if (/nyr|not yet released/i.test(status)) continue; // not released yet
        monthReleased = true;
        const date = day.slice(0, 10);
        if (!horizon || date > horizon) horizon = date;
      }
    }
    if (monthReleased) sawReleased = true;
    else if (sawReleased) break; // released months followed by a fully-NYR month = boundary
    m === 12 ? ((m = 1), y++) : m++;
  }

  const todayStr = today.toISOString().slice(0, 10);
  const windowDays = horizon
    ? Math.round((Date.parse(horizon + "T00:00:00Z") - Date.parse(todayStr + "T00:00:00Z")) / 86400_000)
    : null;
  return { horizon, windowDays };
}

export const bookingUrl = (facilityId: string) =>
  `https://www.recreation.gov/camping/campgrounds/${facilityId}`;
