// Seed state-park campgrounds from the Camis / GoingToCamp API into the shared
// `facilities` table, tagged source='camis' with namespaced ids
// (camis-<tenant>-<rootMapId>). Run LOCALLY from web/ (uses the service-role key):
//
//   node scripts/seed-camis.mjs            # all configured tenants (WA, WI, MI)
//   node scripts/seed-camis.mjs wa         # just Washington
//
// Idempotent. Apply migration 0009 first. Sends full browser headers to pass the
// Azure WAF (confirmed reachable from Node).
//
// Coordinates: Washington fills decimal `gpsCoordinates`; Wisconsin/Michigan
// mostly don't, so we fall back to geocoding the street address via the free US
// Census geocoder (no API key, US addresses only — which is all of these).

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

// Keep in sync with web/src/lib/sources/camis.ts (CAMIS_TENANTS).
const TENANTS = {
  wa: { host: "https://washington.goingtocamp.com", abbr: "WA" },
  wi: { host: "https://wisconsin.goingtocamp.com", abbr: "WI" },
  mi: { host: "https://midnrreservations.com", abbr: "MI" },
  // No MD: Maryland State Parks is on ReserveAmerica/Aspira (.do servlets), not
  // GoingToCamp — would need a separate ReserveAmerica adapter.
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function headers(host) {
  return {
    accept: "application/json, text/plain, */*",
    "accept-language": "en-US,en;q=0.9",
    "user-agent": UA,
    referer: host + "/",
    origin: host,
    "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
  };
}

const validCoord = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && lat > 17 && lat < 72 && lng < -60 && lng > -180;

// Only accept the clean decimal "lat, lng" form; DMS / blank fall through to geocoding.
function parseGps(s) {
  if (!s || typeof s !== "string") return null;
  const parts = s.split(",").map((x) => parseFloat(x.trim()));
  if (parts.length !== 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return null;
  if (!validCoord(parts[0], parts[1])) return null;
  return { lat: parts[0], lng: parts[1] };
}

async function req(url, host, attempt = 0) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45000);
  try {
    const r = await fetch(url, { headers: headers(host), signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    if (attempt < 4) {
      await sleep(1500 * (attempt + 1));
      return req(url, host, attempt + 1);
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

// --- US Census geocoder (free, no key) -------------------------------------
const geoCache = new Map();
async function censusGeocode(oneline) {
  if (geoCache.has(oneline)) return geoCache.get(oneline);
  const url =
    `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(oneline)}` +
    `&benchmark=Public_AR_Current&format=json`;
  try {
    const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const m = j?.result?.addressMatches?.[0]?.coordinates;
    const out = m && validCoord(m.y, m.x) ? { lat: m.y, lng: m.x } : null;
    geoCache.set(oneline, out);
    return out;
  } catch {
    geoCache.set(oneline, null);
    return null;
  }
}

async function geocodePark(lv, abbr) {
  const street = (lv.streetAddress || "").trim();
  const city = (lv.city || "").trim();
  const zip = (lv.zip || "").trim();
  // Try full street address first, then a coarser city/zip fallback.
  for (const addr of [
    street && city ? `${street}, ${city}, ${abbr} ${zip}` : null,
    city ? `${city}, ${abbr} ${zip}` : null,
    zip ? `${zip}` : null,
  ]) {
    if (!addr) continue;
    const c = await censusGeocode(addr);
    await sleep(120);
    if (c) return c;
  }
  return null;
}

async function upsert(rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("facilities").upsert(rows.slice(i, i + 500), { onConflict: "facility_id" });
    if (error) throw new Error(error.message);
  }
}

async function seedTenant(code) {
  const cfg = TENANTS[code];
  if (!cfg) { console.error(`unknown tenant ${code}`); return 0; }
  console.log(`\n=== ${cfg.abbr} (${code}) — ${cfg.host} ===`);
  const locations = await req(cfg.host + "/api/resourceLocation", cfg.host);
  const list = Array.isArray(locations) ? locations : [];
  console.log(`  ${list.length} resource locations`);

  const byId = new Map();
  let fromGps = 0, fromGeocode = 0, skipped = 0, i = 0;
  for (const loc of list) {
    i++;
    const rootMapId = loc.rootMapId;
    const lv0 = (loc.localizedValues && loc.localizedValues[0]) || {};
    const name = (lv0.fullName || lv0.shortName || "").trim();
    if (rootMapId == null || !name) { skipped++; continue; }

    let coord = parseGps(loc.gpsCoordinates);
    if (coord) fromGps++;
    else {
      coord = await geocodePark({ streetAddress: lv0.streetAddress, city: lv0.city, zip: loc.regionCode }, cfg.abbr);
      if (coord) fromGeocode++;
    }
    if (!coord) { skipped++; continue; }

    const fid = `camis-${code}-${rootMapId}`;
    byId.set(fid, {
      facility_id: fid,
      name: name.slice(0, 200),
      lat: coord.lat,
      lng: coord.lng,
      reservable: true,
      facility_type: "Campground",
      city: lv0.city || null,
      state: cfg.abbr,
      parent_name: null,
      source: "camis",
      updated_at: new Date().toISOString(),
    });
    if (i % 25 === 0) process.stdout.write(`\r  processed ${i}/${list.length} (gps ${fromGps}, geocoded ${fromGeocode})   `);
  }
  const rows = [...byId.values()];
  console.log(`\n  ${rows.length} parks (gps ${fromGps}, geocoded ${fromGeocode}, skipped ${skipped}). Upserting…`);
  await upsert(rows);
  console.log(`  done: ${rows.length} rows for ${cfg.abbr}.`);
  return rows.length;
}

async function main() {
  const want = process.argv.slice(2).map((s) => s.toLowerCase());
  const codes = want.length ? want : Object.keys(TENANTS);
  let total = 0;
  for (const code of codes) {
    try { total += await seedTenant(code); }
    catch (e) { console.error(`\n${code} failed:`, e.message); }
  }
  console.log(`\nAll done. ${total} Camis state-park campgrounds upserted.`);
}

main().catch((e) => { console.error("fatal:", e); process.exit(1); });
