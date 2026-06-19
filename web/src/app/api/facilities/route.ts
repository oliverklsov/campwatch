import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

// Returns the whole campground catalog as GeoJSON for the Explore map.
// Public data; cached at the edge so the 4k-point payload is fetched rarely.
export const dynamic = "force-dynamic";

type Row = {
  facility_id: string;
  name: string;
  lat: number;
  lng: number;
  reservable: boolean;
  city: string | null;
  state: string | null;
};

export async function GET() {
  const db = createServiceClient();
  const { data, error } = await db
    .from("facilities")
    .select("facility_id,name,lat,lng,reservable,city,state")
    .returns<Row[]>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const features = (data ?? [])
    .map((f) => {
      // Rescue sign-flipped longitudes (a CA campground stored as +120 lands in
      // the Pacific) — no US recreation.gov facility sits at a positive longitude.
      const lng = f.lng > 0 ? -f.lng : f.lng;
      return { ...f, lng };
    })
    // Drop anything still outside a generous US bounding box (bad/garbage coords).
    .filter((f) => f.lat >= 17 && f.lat <= 72 && f.lng >= -179 && f.lng <= -64)
    .map((f) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [f.lng, f.lat] },
      properties: {
        id: f.facility_id,
        name: f.name,
        reservable: f.reservable,
        city: f.city ?? "",
        state: f.state ?? "",
      },
    }));

  return NextResponse.json(
    { type: "FeatureCollection", features },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } }
  );
}
