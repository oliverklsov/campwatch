import { NextResponse } from "next/server";
import { fetchReleaseWindow } from "@/lib/recgov";

// When does this campground release reservations? Detected from rec.gov's
// not-yet-released boundary. Cached hard — a campground's window rarely changes.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const { horizon, windowDays } = await fetchReleaseWindow(params.id, { jitter: { min: 0, max: 120 } });
    return NextResponse.json(
      { horizon, windowDays, windowMonths: windowDays ? Math.round(windowDays / 30) : null },
      { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } }
    );
  } catch (e) {
    return NextResponse.json({ horizon: null, windowDays: null, windowMonths: null });
  }
}
