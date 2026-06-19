// Seed the `facilities` table from RIDB (official recreation.gov API).
// Run LOCALLY from the web/ folder (RIDB is blocked in the cloud sandbox):
//
//   cd web
//   node scripts/seed-facilities.mjs
//
// Reads NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RIDB_API_KEY from .env.local.
// Idempotent: upserts on facility_id, so it's safe to re-run (e.g. weekly refresh).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- env ----------------------------------------------------------------
function loadEnv() {
  const txt = readFileSync(join(__dirname, "..", ".env.local"), "utf8");
  const env = {};
  for (const line of txt.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}
const env = loadEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const RIDB_KEY = env.RIDB_API_KEY;
if (!SUPABASE_URL || !SERVICE_KEY || !RIDB_KEY) {
  console.error("Missing env. Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RIDB_API_KEY in .env.local");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- RIDB pagination ----------------------------------------------------
const LIMIT = 50; // RIDB max page size
const DELAY_MS = 1300; // stay under RIDB's ~50 req/min
const RIDB = "https://ridb.recreation.gov/api/v1/facilities";

async function fetchPage(offset, attempt = 0) {
  const url = `${RIDB}?activity=CAMPING&full=true&limit=${LIMIT}&offset=${offset}`;
  try {
    const res = await fetch(url, { headers: { apikey: RIDB_KEY, accept: "application/json" } });
    if (res.status === 429) throw new Error("rate limited (429)");
    if (!res.ok) throw new Error(`RIDB ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return await res.json();
  } catch (e) {
    // Retry on rate limits AND transient network errors ("fetch failed").
    if (attempt < 6) {
      const wait = 2000 * (attempt + 1);
      console.log(`\n  retry offset ${offset} (attempt ${attempt + 1}) in ${wait}ms — ${e.message}`);
      await sleep(wait);
      return fetchPage(offset, attempt + 1);
    }
    throw new Error(`gave up at offset ${offset}: ${e.message}`);
  }
}

// Known bad RIDB coordinates, corrected by facility_id. RIDB occasionally ships a
// wrong lat/lng (e.g. a one-digit latitude typo that drops a pin in the ocean);
// these overrides win over the RIDB value so a re-seed keeps the fix.
// Keep in sync with src/app/api/facilities/route.ts.
const COORD_CORRECTIONS = {
  // Big Reservoir Campground, Foresthill CA — RIDB serves lat 31.14 (Pacific Ocean).
  "10300375": { lat: 39.143696, lng: -120.755314 },
};

// Rough per-state bounding boxes [latMin, latMax, lngMin, lngMax] with built-in
// margin. Drop facilities whose coordinates fall outside their declared state so
// "ocean dot" bad data never reaches the DB. Keep in sync with the API route.
const STATE_BOUNDS = {
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

function toRow(f) {
  let lat = Number(f.FacilityLatitude);
  let lng = Number(f.FacilityLongitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if ((f.FacilityTypeDescription ?? "") !== "Campground") return null; // campgrounds only
  const name = (f.FacilityName ?? "").trim();
  if (!name) return null;
  const addr = Array.isArray(f.FACILITYADDRESS) ? f.FACILITYADDRESS[0] : undefined;
  const state = addr?.AddressStateCode ?? null;
  const fid = String(f.FacilityID);

  // Coordinate hygiene (keep in sync with the API route): apply a known correction
  // if we have one, otherwise rescue sign-flipped longitudes and drop points that
  // fall outside their declared state's bounding box (bad RIDB "ocean dot" data).
  const corr = COORD_CORRECTIONS[fid];
  if (corr) {
    lat = corr.lat;
    lng = corr.lng;
  } else {
    if (lng > 0) lng = -lng;
    const b = state ? STATE_BOUNDS[state] : undefined;
    if (b && (lat < b[0] - MARGIN || lat > b[1] + MARGIN || lng < b[2] - MARGIN || lng > b[3] + MARGIN)) {
      return null;
    }
  }

  return {
    facility_id: fid,
    name,
    lat,
    lng,
    reservable: !!f.Reservable,
    facility_type: f.FacilityTypeDescription ?? null,
    city: addr?.City ?? null,
    state,
    parent_name: null,
    updated_at: new Date().toISOString(),
  };
}

async function upsert(rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await db.from("facilities").upsert(batch, { onConflict: "facility_id" });
    if (error) throw new Error(`Supabase upsert failed: ${error.message}`);
  }
}

// ---- main ---------------------------------------------------------------
async function main() {
  console.log("Fetching campgrounds from RIDB…");
  let offset = 0;
  let total = Infinity;
  let fetched = 0;
  let kept = 0;

  while (offset < total && offset < 12000) {
    const data = await fetchPage(offset);
    const recs = data.RECDATA ?? [];
    total = Number(data.METADATA?.RESULTS?.TOTAL_COUNT ?? recs.length);
    fetched += recs.length;
    const rows = recs.map(toRow).filter(Boolean);
    if (rows.length) {
      await upsert(rows); // write each page immediately — a dropout never loses progress
      kept += rows.length;
    }
    process.stdout.write(`\r  offset ${offset}/${total} · scanned ${fetched} · campgrounds saved ${kept}   `);
    if (recs.length === 0) break;
    offset += LIMIT;
    await sleep(DELAY_MS);
  }
  console.log(`\nDone fetching. Verifying…`);

  const { count } = await db.from("facilities").select("*", { count: "exact", head: true });
  console.log(`Done. facilities table now holds ${count} rows.`);
}

main().catch((e) => {
  console.error("\nSeed failed:", e.message);
  process.exit(1);
});
