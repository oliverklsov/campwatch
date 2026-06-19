import { NextResponse } from "next/server";
import type { FacilityHit } from "@/lib/types";

// Proxies RIDB facility search so the API key stays server-side.
// RIDB is the OFFICIAL recreation.gov API: https://ridb.recreation.gov/docs
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim();
  if (!q || q.length < 2) return NextResponse.json([]);

  const url =
    `https://ridb.recreation.gov/api/v1/facilities?query=${encodeURIComponent(q)}` +
    `&limit=10&full=false&activity=CAMPING`;
  const res = await fetch(url, {
    headers: { apikey: process.env.RIDB_API_KEY! },
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    return NextResponse.json({ error: `RIDB ${res.status}` }, { status: 502 });
  }
  const data = await res.json();
  const hits: FacilityHit[] = (data.RECDATA ?? [])
    .filter((f: any) => f.Reservable)
    .map((f: any) => ({
      facilityId: String(f.FacilityID),
      name: f.FacilityName ?? "",
      city: f.FACILITYADDRESS?.[0]?.City ?? "",
      state: f.FACILITYADDRESS?.[0]?.AddressStateCode ?? "",
    }));
  return NextResponse.json(hits);
}
