import { NextResponse } from "next/server";
import { getAvailability } from "@/lib/sources";

// On-demand availability for one facility, used by the Explore bottom sheet.
// We only store snapshots for *watched* facilities, so for everything else on
// the map we fetch live when the user taps a pin. The source (recreation.gov,
// US eDirect state parks, …) is resolved from the facility id by getAvailability.
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

  const result = await getAvailability(id, start, end);
  return NextResponse.json(result);
}
