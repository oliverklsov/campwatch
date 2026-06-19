import { NextResponse } from "next/server";
import { fetchAvailabilityDetail, bookingUrl } from "@/lib/recgov";
import { fetchReservationType } from "@/lib/ridb";

// On-demand availability for one facility, used by the Explore bottom sheet.
// We only store snapshots for *watched* facilities, so for everything else on
// the map we fetch live from rec.gov when the user taps a pin.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const id = params.id;
  const url = new URL(request.url);
  const today = new Date();
  const start = url.searchParams.get("start") ?? isoDate(today);
  const end =
    url.searchParams.get("end") ?? isoDate(new Date(today.getTime() + 30 * 86400_000));

  // Authoritative reservation type from RIDB, fetched in parallel (never rejects).
  const resvPromise = fetchReservationType(id);

  try {
    // Interactive single-facility lookup — minimal jitter so the sheet is snappy.
    const { openings } = await fetchAvailabilityDetail(id, start, end, { jitter: { min: 0, max: 150 } });
    const resv = await resvPromise;

    // Aggregate site-nights per date, marking each as bookable ("Available") or FCFS ("Open").
    const byDate: Record<string, { count: number; available: number; open: number }> = {};
    for (const o of openings) {
      const e = (byDate[o.date] ??= { count: 0, available: 0, open: 0 });
      e.count++;
      if (o.status === "Available") e.available++;
      else e.open++;
    }
    const dates = Object.entries(byDate)
      .map(([date, v]) => ({ date, count: v.count, status: v.available > 0 ? "Available" : "Open" }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({
      facilityId: id,
      window: { start, end },
      // Authoritative reservation type (from RIDB per-site data).
      resType: resv.resType,
      reservableSites: resv.reservableSites,
      fcfsSites: resv.fcfsSites,
      siteTotal: resv.siteTotal,
      // Live availability facts for the chosen dates.
      totalOpenings: openings.length,
      bookable: openings.filter((o) => o.status === "Available").length,
      fcfs: openings.filter((o) => o.status === "Open").length,
      siteNightDates: dates,
      bookingUrl: bookingUrl(id),
    });
  } catch (e) {
    // Availability failed, but reservation type may still be known.
    const resv = await resvPromise;
    return NextResponse.json({
      error: e instanceof Error ? e.message : "availability fetch failed",
      resType: resv.resType,
      reservableSites: resv.reservableSites,
      fcfsSites: resv.fcfsSites,
      siteTotal: resv.siteTotal,
      bookingUrl: bookingUrl(id),
    });
  }
}
