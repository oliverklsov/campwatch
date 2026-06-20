// Discovery probe for the USFS MVUM service (Arizona). Run LOCALLY:
//
//   cd web
//   node scripts/mvum-probe.mjs
//   node scripts/mvum-probe.mjs "https://host/.../MapServer"   # force a service root
//
// The Roads layer has no dispersed-camping attribute, so this lists every layer in
// the MVUM service and inspects any "dispersed camping" layer (fields + AZ samples).
// It also dumps the distinct road symbol names in case camping is encoded there.

const AZ = { xmin: -114.82, ymin: 31.33, xmax: -109.04, ymax: 37.0 };
const TIMEOUT_MS = 30000;

// Service roots to try (the layer-1 = Roads endpoint confirmed working last run).
const ROOTS = [
  "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_01/MapServer",
  "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_03/MapServer",
];

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

async function listService(root) {
  process.stdout.write(`\n=== service ${root}\n`);
  let svc;
  try {
    svc = await getJson(`${root}?f=json`);
  } catch (e) {
    console.log(`  ✗ ${e.message}`);
    return null;
  }
  if (svc.error) {
    console.log(`  ✗ ${svc.error.message}`);
    return null;
  }
  const layers = [...(svc.layers || []), ...(svc.tables || [])];
  console.log(`  layers/tables (${layers.length}):`);
  for (const l of layers) console.log(`    [${l.id}] ${l.name}  (${l.geometryType || "table"})`);
  return layers;
}

async function probeLayer(root, layer) {
  const url = `${root}/${layer.id}`;
  console.log(`\n--- layer [${layer.id}] "${layer.name}" @ ${url}`);
  let meta;
  try {
    meta = await getJson(`${url}?f=json`);
  } catch (e) {
    console.log(`  ✗ ${e.message}`);
    return;
  }
  const fields = meta.fields || [];
  console.log(`  geometryType: ${meta.geometryType}  fields (${fields.length}):`);
  for (const f of fields) console.log(`    - ${f.name}  [${(f.type || "").replace("esriFieldType", "")}]  "${f.alias ?? ""}"`);

  const env = encodeURIComponent(JSON.stringify(AZ));
  const q =
    `${url}/query?where=1%3D1&geometry=${env}&geometryType=esriGeometryEnvelope&inSR=4326` +
    `&spatialRel=esriSpatialRelIntersects&outFields=*&resultRecordCount=3&returnGeometry=false&f=json`;
  try {
    const data = await getJson(q);
    const feats = data.features || [];
    console.log(`  AZ samples: ${feats.length}`);
    feats.forEach((ft, i) => {
      console.log(`   --- sample ${i + 1} ---`);
      for (const [k, v] of Object.entries(ft.attributes || {})) {
        if (v !== null && v !== "" && String(v) !== "0") console.log(`     ${k}: ${v}`);
      }
    });
  } catch (e) {
    console.log(`  (sample query failed: ${e.message})`);
  }
}

// Distinct MVUM road symbol names in AZ — in case dispersed camping is a symbol value.
async function distinctRoadSymbols(root, roadsId) {
  const env = encodeURIComponent(JSON.stringify(AZ));
  const url =
    `${root}/${roadsId}/query?where=1%3D1&geometry=${env}&geometryType=esriGeometryEnvelope&inSR=4326` +
    `&spatialRel=esriSpatialRelIntersects&outFields=mvum_symbol_name&returnDistinctValues=true` +
    `&returnGeometry=false&resultRecordCount=200&f=json`;
  try {
    const data = await getJson(url);
    const vals = [...new Set((data.features || []).map((f) => f.attributes?.mvum_symbol_name).filter(Boolean))];
    console.log(`\n  distinct AZ road symbol names (${vals.length}):`);
    vals.forEach((v) => console.log(`    • ${v}`));
  } catch (e) {
    console.log(`  (distinct symbols query failed: ${e.message})`);
  }
}

async function main() {
  const arg = process.argv[2];
  const roots = arg ? [arg.replace(/\/\d+\/?$/, "")] : ROOTS;
  for (const root of roots) {
    const layers = await listService(root);
    if (!layers) continue;

    const campLayers = layers.filter((l) => /disp|camp|retriev/i.test(l.name));
    if (campLayers.length) {
      console.log(`\n>>> found ${campLayers.length} dispersed/camping layer(s)`);
      for (const l of campLayers) await probeLayer(root, l);
    } else {
      console.log(`\n>>> no layer named like "dispersed/camping" — camping may be a road symbol or a separate service`);
    }

    const roads = layers.find((l) => /road/i.test(l.name) && l.geometryType);
    if (roads) await distinctRoadSymbols(root, roads.id);

    console.log("\nDone. Paste this output back.");
    return;
  }
  console.log("\nNo service responded. Paste the failure and we'll find the right URL.");
  process.exit(1);
}

main().catch((e) => {
  console.error("Probe failed:", e.message);
  process.exit(1);
});
