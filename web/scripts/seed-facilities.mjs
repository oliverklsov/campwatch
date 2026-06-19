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

function toRow(f) {
  const lat = Number(f.FacilityLatitude);
  const lng = Number(f.FacilityLongitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if ((f.FacilityTypeDescription ?? "") !== "Campground") return null; // campgrounds only
  const name = (f.FacilityName ?? "").trim();
  if (!name) return null;
  const addr = Array.isArray(f.FACILITYADDRESS) ? f.FACILITYADDRESS[0] : undefined;
  return {
    facility_id: String(f.FacilityID),
    name,
    lat,
    lng,
    reservable: !!f.Reservable,
    facility_type: f.FacilityTypeDescription ?? null,
    city: addr?.City ?? null,
    state: addr?.AddressStateCode ?? null,
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
