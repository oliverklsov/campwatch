// Seed state-park campgrounds from the US eDirect API family into the same
// `facilities` table recreation.gov uses, tagged source='usedirect' with
// namespaced ids (ued-<state>-<FacilityId>). Run LOCALLY from web/ (uses the
// service-role key in .env.local):
//
//   node scripts/seed-usedirect.mjs            # all configured states
//   node scripts/seed-usedirect.mjs ca fl      # just these states
//
// Idempotent (upsert on facility_id) — safe to re-run. Apply migration
// 0009_facility_source.sql first so the `source` column exists.

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

// Keep in sync with web/src/lib/sources/usedirect.ts (USEDIRECT_STATES).
const STATES = {
  ca: { apiBase: "https://california-rdr.prod.cali.rd12.recreation-management.tylerapp.com/rdr/", booking: "https://www.reservecalifornia.com/", abbr: "CA" },
  fl: { apiBase: "https://floridardr.usedirect.com/Floridardr/rdr/", booking: "https://reserve.floridastateparks.org/", abbr: "FL" },
  mn: { apiBase: "https://mnrdr.usedirect.com/minnesotardr/rdr/", booking: "https://reservemn.usedirect.com/", abbr: "MN" },
  va: { apiBase: "https://prod-va-rdr.recreation-management.tylerapp.com/virginiardr/rdr/", booking: "https://reservevaparks.com/", abbr: "VA" },
  oh: { apiBase: "https://ohiordr.usedirect.com/Ohiordr/rdr/", booking: "https://reserveohio.com/", abbr: "OH" },
  nv: { apiBase: "https://nevadardr.usedirect.com/NevadaRDR/rdr/", booking: "https://reservenevada.com/", abbr: "NV" },
  mo: { apiBase: "https://msprdr.usedirect.com/MSPRDR/rdr/", booking: "https://icampmo1.usedirect.com/", abbr: "MO" },
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ymd = (d) => d.toISOString().slice(0, 10);

async function req(url, opts = {}, attempt = 0) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45000);
  try {
    const r = await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: {
        "User-Agent": UA,
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        ...(opts.headers || {}),
      },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    if (attempt < 4) {
      await sleep(1500 * (attempt + 1));
      return req(url, opts, attempt + 1);
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

const validCoord = (lat, lng) =>
  typeof lat === "number" && typeof lng === "number" && lat > 17 && lat < 72 && lng < -60 && lng > -180;

function campRows(code, cfg, place, facilities) {
  const rows = [];
  for (const f of facilities) {
    if (!/camp/i.test(String(f.Category || ""))) continue; // skip tours/lodging/day-use
    let lat = f.Latitude, lng = f.Longitude;
    if (!validCoord(lat, lng)) { lat = place.Latitude; lng = place.Longitude; }
    if (!validCoord(lat, lng)) continue;
    const parkName = (place.Name || "").trim();
    const facName = (f.Name || "").trim();
    const name = facName && facName !== parkName ? `${parkName} — ${facName}` : parkName || facName;
    rows.push({
      facility_id: `ued-${code}-${f.FacilityId}`,
      name: name.slice(0, 200),
      lat,
      lng,
      reservable: true,
      facility_type: "Campground",
      city: place.City || null,
      state: cfg.abbr,
      parent_name: parkName || null,
      source: "usedirect",
      updated_at: new Date().toISOString(),
    });
  }
  return rows;
}

async function upsert(rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await db.from("facilities").upsert(chunk, { onConflict: "facility_id" });
    if (error) throw new Error(error.message);
  }
}

async function seedState(code) {
  const cfg = STATES[code];
  if (!cfg) { console.error(`unknown state ${code}`); return; }
  console.log(`\n=== ${cfg.abbr} (${code}) ===`);
  const places = await req(cfg.apiBase + "fd/places");
  const parks = Array.isArray(places) ? places : [];
  console.log(`  ${parks.length} places; scanning for campgrounds…`);
  const startDate = ymd(new Date(Date.now() + 14 * 864e5));

  const all = [];
  let scanned = 0, withCamp = 0;
  for (const place of parks) {
    if (place.IsWebViewable === false) continue;
    scanned++;
    try {
      const sp = await req(cfg.apiBase + "search/place", {
        method: "POST",
        headers: { Referer: cfg.booking, Origin: cfg.booking.replace(/\/$/, "") },
        body: JSON.stringify({
          PlaceId: place.PlaceId, StartDate: startDate, Nights: 1, IsADA: false,
          UnitCategoryId: 0, SleepingUnitId: 0, MinVehicleLength: 0, UnitTypesGroupIds: [],
          CountNearby: false, RefreshFavourites: true, Latitude: 0, Longitude: 0,
        }),
      });
      const facObj = sp?.SelectedPlace?.Facilities;
      const facs = facObj ? Object.values(facObj) : [];
      const rows = campRows(code, cfg, place, facs);
      if (rows.length) withCamp++;
      all.push(...rows);
    } catch (e) {
      // Skip a flaky park rather than abort the whole state.
      process.stdout.write(`\r  (skip ${place.PlaceId}: ${e.message})        `);
    }
    if (scanned % 25 === 0) process.stdout.write(`\r  scanned ${scanned}/${parks.length}, ${all.length} campgrounds found   `);
    await sleep(150);
  }

  // De-dupe by facility_id (a facility can appear under nearby places).
  const byId = new Map(all.map((r) => [r.facility_id, r]));
  const rows = [...byId.values()];
  console.log(`\n  ${withCamp} parks with camping → ${rows.length} campground facilities. Upserting…`);
  await upsert(rows);
  console.log(`  done: ${rows.length} rows for ${cfg.abbr}.`);
  return rows.length;
}

async function main() {
  const want = process.argv.slice(2).map((s) => s.toLowerCase());
  const codes = want.length ? want : Object.keys(STATES);
  let total = 0;
  for (const code of codes) {
    try { total += (await seedState(code)) || 0; }
    catch (e) { console.error(`\n${code} failed:`, e.message); }
  }
  console.log(`\nAll done. ${total} state-park campgrounds upserted.`);
}

main().catch((e) => { console.error("fatal:", e); process.exit(1); });
