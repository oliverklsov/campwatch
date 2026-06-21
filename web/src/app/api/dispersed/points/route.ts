import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

// All dispersed-road points (one per segment, using the bbox center) as GeoJSON.
// Lightweight (no geometry) so the whole state can be loaded once and clustered
// client-side — that's what lets dots show when the map is zoomed out. The heavy
// road *lines* are still fetched per-viewport by /api/facilities-style bbox query.
export const dynamic = "force-dynamic";

type Row = {
  id: string;
  name: string | null;
  forest: string | null;
  season: string | null;
  min_lat: number;
  max_lat: number;
  min_lng: number;
  max_lng: number;
};

export async function GET() {
  const db = createServiceClient();
  const PAGE = 1000;
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("mvum_roads")
      .select("id,name,forest,season,min_lat,max_lat,min_lng,max_lng")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1)
      .returns<Row[]>();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }

  const features = rows.map((r) => ({
    type: "Feature" as const,
    geometry: {
      type: "Point" as const,
      coordinates: [(r.min_lng + r.max_lng) / 2, (r.min_lat + r.max_lat) / 2],
    },
    properties: { id: r.id, name: r.name, forest: r.forest, season: r.season },
  }));

  return NextResponse.json(
    { type: "FeatureCollection", features },
    { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } }
  );
}
