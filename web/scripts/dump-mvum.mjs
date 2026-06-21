// Dump the national USFS MVUM "Roads open to all Vehicles" (Forest Service) to one
// GeoJSON file, for tiling with tippecanoe. Run LOCALLY (USFS is blocked in the
// cloud sandbox):
//
//   cd web
//   node scripts/dump-mvum.mjs                 # -> mvum-national.geojson
//   node scripts/dump-mvum.mjs out.geojson     # custom path
//
// This is a long run (hundreds of thousands of segments). It writes incrementally,
// so a crash mid-run just means re-running. No API key needed. The output file is
// large — don't commit it (add to .gitignore).

import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const OUT = process.argv[2] || "mvum-national.geojson";
const LAYER = "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_01/MapServer/1";
// Forest Service roads open to all vehicles = the dispersed-camping-friendly set.
const WHERE = "jurisdiction LIKE 'FS%' AND mvum_symbol_name LIKE 'Roads open to all Vehicles%'";
const OUT_FIELDS = "objectid,id,name,forestname,seasonal";
const PAGE = 1000;
const DELAY_MS = 300;
const TIMEOUT_MS = 90000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, attempt = 0) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { accept: "application/json" }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    if (d.error) throw new Error(d.error.message || "query error");
    return d;
  } catch (e) {
    if (attempt < 6) {
      const wait = 2000 * (attempt + 1);
      console.log(`\n  retry (attempt ${attempt + 1}) in ${wait}ms — ${e.message}`);
      await sleep(wait);
      return getJson(url, attempt + 1);
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

function toFeature(f) {
  const a = f.attributes || {};
  const paths = f.geometry?.paths;
  if (!Array.isArray(paths) || paths.length === 0) return null;
  const geometry =
    paths.length === 1
      ? { type: "LineString", coordinates: paths[0] }
      : { type: "MultiLineString", coordinates: paths };
  const name = (a.name && String(a.name).trim()) || (a.id && String(a.id).trim()) || String(a.objectid);
  return {
    type: "Feature",
    geometry,
    properties: {
      id: String(a.id ?? a.objectid),
      name,
      forest: a.forestname ?? null,
      season: a.seasonal ?? null,
    },
  };
}

async function main() {
  mkdirSync(dirname(OUT), { recursive: true });
  const out = createWriteStream(OUT, { encoding: "utf8" });
  out.write('{"type":"FeatureCollection","features":[');
  let first = true;
  let lastOid = 0;
  let kept = 0;

  for (;;) {
    const where = encodeURIComponent(`(${WHERE}) AND objectid > ${lastOid}`);
    const url =
      `${LAYER}/query?where=${where}&outFields=${OUT_FIELDS}&orderByFields=objectid` +
      `&resultRecordCount=${PAGE}&returnGeometry=true&outSR=4326&maxAllowableOffset=0.0001` +
      `&geometryPrecision=5&f=json`;
    const data = await getJson(url);
    const feats = data.features || [];
    if (feats.length === 0) break;
    lastOid = Math.max(...feats.map((f) => f.attributes.objectid));
    for (const f of feats) {
      const ft = toFeature(f);
      if (!ft) continue;
      out.write((first ? "" : ",") + "\n" + JSON.stringify(ft));
      first = false;
      kept++;
    }
    process.stdout.write(`\r  dumped ${kept} road segments (through oid ${lastOid})   `);
    if (feats.length < PAGE) break;
    await sleep(DELAY_MS);
  }

  out.write("\n]}\n");
  await new Promise((r) => out.end(r));
  console.log(`\nDone. Wrote ${kept} features to ${OUT}.`);
}

main().catch((e) => {
  console.error("\nDump failed:", e.message);
  process.exit(1);
});
