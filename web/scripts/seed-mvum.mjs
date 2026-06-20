// Seed mvum_roads from the USFS Motor Vehicle Use Map: Roads layer (Arizona pilot).
// Run LOCALLY from web/ (USFS GIS is blocked in the cloud sandbox):
//
//   cd web
//   node scripts/seed-mvum.mjs
//
// Imports Forest Service roads open to all vehicles within Arizona, simplifies the
// geometry, computes a bounding box per segment (for viewport queries), and loads
// them into public.mvum_roads. Re-runnable: it clears AZ rows first, then inserts.
//
// Data note: the national MVUM service has no "dispersed camping" attribute, so we
// import FS roads open to all vehicles — the backcountry routes along which dispersed
// camping is generally allowed (verify locally). Reads SUPABASE creds from .env.local.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- MVUM source --------------------------------------------------------
const LAYER = "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_01/MapServer/1";
const STATE = "AZ";
const AZ_ENV = { xmin: -114.82, ymin: 31.33, xmax: -109.04, ymax: 37.0, spatialReference: { wkid: 4326 } };
// FS roads open to all vehicles = the dispersed-camping-friendly backcountry roads.
const WHERE = "jurisdiction LIKE 'FS%' AND mvum_symbol_name LIKE 'Roads open to all Vehicles%'";
const PAGE = 1000;
const OUT_FIELDS = "objectid,rte_cn,id,name,forestname,seasonal,mvum_symbol_name";
const TIMEOUT_MS = 60000;

async function getJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { accept: "application/json" }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// objectid-keyed pagination (works on MapServer even without resultOffset support).
async function fetchPage(lastOid, attempt = 0) {
  const where = encodeURIComponent(`(${WHERE}) AND objectid > ${lastOid}`);
  const geom = encodeURIComponent(JSON.stringify(AZ_ENV));
  const url =
    `${LAYER}/query?where=${where}&geometry=${geom}&geometryType=esriGeometryEnvelope&inSR=4326` +
    `&spatialRel=esriSpatialRelIntersects&outFields=${OUT_FIELDS}&orderByFields=objectid` +
    `&resultRecordCount=${PAGE}&returnGeometry=true&outSR=4326&maxAllowableOffset=0.0001` +
    `&geometryPrecision=5&f=json`;
  try {
    const data = await getJson(url);
    if (data.error) throw new Error(data.error.message || "query error");
    return data.features || [];
  } catch (e) {
    if (attempt < 5) {
      const wait = 2000 * (attempt + 1);
      console.log(`\n  retry after oid ${lastOid} (attempt ${attempt + 1}) in ${wait}ms — ${e.message}`);
      await sleep(wait);
      return fetchPage(lastOid, attempt + 1);
    }
    throw new Error(`gave up after oid ${lastOid}: ${e.message}`);
  }
}

function toRow(f) {
  const a = f.attributes || {};
  const paths = f.geometry?.paths;
  if (!Array.isArray(paths) || paths.length === 0) return null;
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  for (const path of paths) {
    for (const [lng, lat] of path) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  if (!Number.isFinite(minLat) || minLng > maxLng) return null;
  const geom =
    paths.length === 1
      ? { type: "LineString", coordinates: paths[0] }
      : { type: "MultiLineString", coordinates: paths };
  const name = (a.name && String(a.name).trim()) || (a.id && String(a.id).trim()) || String(a.rte_cn ?? a.objectid);
  return {
    id: String(a.objectid),
    name,
    forest: a.forestname ?? null,
    state: STATE,
    corridor_ft: null, // not published in this dataset
    season: a.seasonal ?? null,
    geom,
    min_lat: minLat,
    max_lat: maxLat,
    min_lng: minLng,
    max_lng: maxLng,
    updated_at: new Date().toISOString(),
  };
}

async function insertBatch(rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await db.from("mvum_roads").insert(batch);
    if (error) throw new Error(`Supabase insert failed: ${error.message}`);
  }
}

async function main() {
  console.log(`Clearing existing ${STATE} rows…`);
  const { error: delErr } = await db.from("mvum_roads").delete().eq("state", STATE);
  if (delErr) throw new Error(`delete failed: ${delErr.message}`);

  console.log("Fetching MVUM roads from USFS…");
  let lastOid = 0;
  let kept = 0;
  for (;;) {
    const feats = await fetchPage(lastOid);
    if (feats.length === 0) break;
    lastOid = Math.max(...feats.map((f) => f.attributes.objectid));
    const rows = feats.map(toRow).filter(Boolean);
    if (rows.length) {
      await insertBatch(rows);
      kept += rows.length;
    }
    process.stdout.write(`\r  imported ${kept} road segments (through oid ${lastOid})   `);
    if (feats.length < PAGE) break;
    await sleep(400);
  }

  const { count } = await db.from("mvum_roads").select("*", { count: "exact", head: true });
  console.log(`\nDone. mvum_roads now holds ${count} segments.`);
}

main().catch((e) => {
  console.error("\nSeed failed:", e.message);
  process.exit(1);
});
