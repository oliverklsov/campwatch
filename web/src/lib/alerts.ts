// Pure, unit-testable core of the availability poller: the date window math,
// the snapshot diff, and the per-watch match filter. Kept free of Supabase/fetch
// so it can be tested in isolation (see alerts.test.ts).

import type { Opening, Watch } from "@/lib/types";

export function addDays(d: string, n: number): string {
  return new Date(new Date(d + "T00:00:00Z").getTime() + n * 86400_000).toISOString().slice(0, 10);
}

export function isWeekendNight(d: string): boolean {
  const day = new Date(d + "T00:00:00Z").getUTCDay(); // Fri=5, Sat=6
  return day === 5 || day === 6;
}

/** Widest [start, end] across a facility's watches, expanded by each watch's flex_days. */
export function widestWindow(watches: Watch[]): { start: string; end: string } {
  const start = watches
    .map((w) => addDays(w.start_date, -(w.flex_days || 0)))
    .reduce((a, b) => (b < a ? b : a));
  const end = watches
    .map((w) => addDays(w.end_date, w.flex_days || 0))
    .reduce((a, b) => (b > a ? b : a));
  return { start, end };
}

export type SnapshotTuple = [string, string, string]; // [site, date, status]

/** Openings present now that weren't in the previous snapshot — the alert-worthy set. */
export function freshOpenings(prev: SnapshotTuple[], current: Opening[]): Opening[] {
  const seen = new Set(prev.map(([s, d, st]) => `${s}|${d}|${st}`));
  return current.filter((o) => !seen.has(`${o.site}|${o.date}|${o.status}`));
}

/** Of the fresh openings, those satisfying a watch's window / site / fcfs / weekend filters. */
export function matchWatch(w: Watch, fresh: Opening[]): Opening[] {
  const winStart = addDays(w.start_date, -(w.flex_days || 0));
  const winEnd = addDays(w.end_date, w.flex_days || 0);
  return fresh.filter(
    (o) =>
      o.date >= winStart &&
      o.date <= winEnd &&
      (w.sites.length === 0 || w.sites.includes(o.site)) &&
      (o.status === "Available" || w.include_fcfs) &&
      (!w.weekend_only || isWeekendNight(o.date))
  );
}
