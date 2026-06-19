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

// Known bad RIDB coordinates, corrected by facility_id. RIDB occasionally ships a
// wrong lat/lng (e.g. a one-digit latitude typo that drops a pin in the ocean);
// these overrides win over whatever is stored. Keep in sync with seed-facilities.mjs.
const COORD_CORRECTIONS: Record<string, { lat: number; lng: number }> = {
  // Big Reservoir Campground, Foresthill CA — RIDB serves lat 31.14 (Pacific Ocean).
  "10300375": { lat: 39.143696, lng: -120.755314 },
};

// Rough per-state bounding boxes [latMin, latMax, lngMin, lngMax] with built-in
// margin. Used to drop facilities whose coordinates fall outside their declared
// state — catches "ocean dot" bad data the generous US bbox lets through. Keep in
// sync with seed-facilities.mjs.
const STATE_BOUNDS: Record<string, [number, number, number, number]> = {
  AL: [30.1, 35.1, -88.6, -84.8], AK: [51.0, 71.6, -179.6, -129.5], AZ: [31.2, 37.1, -115.0, -108.9],
  AR: [32.9, 36.6, -94.7, -89.6], CA: [32.4, 42.1, -124.6, -114.0], CO: [36.9, 41.1, -109.2, -101.9],
  CT: [40.9, 42.1, -73.8, -71.7], DE: [38.4, 39.9, -75.9, -74.9], DC: [38.7, 39.0, -77.2, -76.9],
  FL: [24.3, 31.1, -87.7, -79.9], GA: [30.3, 35.1, -85.7, -80.7], HI: [18.8, 22.3, -160.4, -154.7],
  ID: [41.9, 49.1, -117.3, -110.9], IL: [36.9, 42.6, -91.6, -87.4], IN: [37.7, 41.8, -88.2, -84.7],
  IA: [40.3, 43.6, -96.7, -90.1], KS: [36.9, 40.1, -102.2, -94.5], KY: [36.4, 39.2, -89.6, -81.9],
  LA: [28.9, 33.1, -94.1, -88.8], ME: [42.9, 47.6, -71.2, -66.9], MD: [37.8, 39.8, -79.5, -74.9],
  MA: [41.2, 42.9, -73.6, -69.9], MI: [41.6, 48.3, -90.5, -82.3], MN: [43.4, 49.5, -97.3, -89.4],
  MS: [30.1, 35.1, -91.7, -88.0], MO: [35.9, 40.7, -95.9, -89.0], MT: [44.3, 49.1, -116.1, -103.9],
  NE: [39.9, 43.1, -104.1, -95.2], NV: [34.9, 42.1, -120.1, -114.0], NH: [42.6, 45.4, -72.6, -70.5],
  NJ: [38.8, 41.4, -75.6, -73.8], NM: [31.2, 37.1, -109.1, -102.9], NY: [40.4, 45.1, -79.9, -71.8],
  NC: [33.7, 36.7, -84.4, -75.4], ND: [45.8, 49.1, -104.1, -96.5], OH: [38.3, 42.4, -84.9, -80.4],
  OK: [33.6, 37.1, -103.1, -94.4], OR: [41.9, 46.4, -124.7, -116.4], PA: [39.6, 42.4, -80.6, -74.6],
  RI: [41.1, 42.1, -71.9, -71.1], SC: [31.9, 35.3, -83.4, -78.4], SD: [42.4, 46.0, -104.1, -96.4],
  TN: [34.9, 36.8, -90.4, -81.6], TX: [25.7, 36.6, -106.7, -93.4], UT: [36.9, 42.1, -114.1, -108.9],
  VT: [42.6, 45.1, -73.5, -71.4], VA: [36.5, 39.5, -83.7, -75.1], WA: [45.5, 49.1, -124.9, -116.9],
  WV: [37.1, 40.7, -82.7, -77.6], WI: [42.4, 47.4, -92.9, -86.7], WY: [40.9, 45.1, -111.1, -103.9],
  PR: [17.8, 18.6, -67.3, -65.2], VI: [17.6, 18.5, -65.2, -64.5],
};
const MARGIN = 0.3;

// Returns corrected [lng, lat] for the map, or null if the point is bad/garbage.
function fixCoords(r: Row): [number, number] | null {
  const corr = COORD_CORRECTIONS[r.facility_id];
  if (corr) return [corr.lng, corr.lat];
  // Rescue sign-flipped longitudes (a CA campground stored as +120 lands in the
  // Pacific) — no US recreation.gov facility sits at a positive longitude.
  const lng = r.lng > 0 ? -r.lng : r.lng;
  const lat = r.lat;
  const b = r.state ? STATE_BOUNDS[r.state] : undefined;
  if (b) {
    if (lat < b[0] - MARGIN || lat > b[1] + MARGIN || lng < b[2] - MARGIN || lng > b[3] + MARGIN) {
      return null; // coordinates fall outside the declared state — drop bad data
    }
    return [lng, lat];
  }
  // Unknown/foreign state: fall back to a generous US bounding box.
  if (lat >= 17 && lat <= 72 && lng >= -179 && lng <= -64) return [lng, lat];
  return null;
}

export async function GET() {
  const db = createServiceClient();

  // Supabase caps a select at 1000 rows by default; page through so the whole
  // ~4,370-campground catalog reaches the map.
  const PAGE = 1000;
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("facilities")
      .select("facility_id,name,lat,lng,reservable,city,state")
      .order("facility_id", { ascending: true })
      .range(from, from + PAGE - 1)
      .returns<Row[]>();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }

  const features = rows
    .map((f) => ({ row: f, coords: fixCoords(f) }))
    .filter((x): x is { row: Row; coords: [number, number] } => x.coords !== null)
    .map(({ row, coords }) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: coords },
      properties: {
        id: row.facility_id,
        name: row.name,
        reservable: row.reservable,
        city: row.city ?? "",
        state: row.state ?? "",
      },
    }));

  return NextResponse.json(
    { type: "FeatureCollection", features },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } }
  );
}
