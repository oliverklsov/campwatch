// Reachability + shape probe for the US eDirect state-park API family, run from
// Node (the same environment as the seed script and the Vercel server routes).
// This confirms whether the live hosts answer server-side requests and that the
// /fd/places -> /search/place -> /search/grid flow works. Run from web/:
//
//   node scripts/probe-state-sources.mjs
//
// Paste the output back. No deps, no env (public endpoints).

const HOSTS = {
  CA: "https://california-rdr.prod.cali.rd12.recreation-management.tylerapp.com/rdr/",
  FL: "https://floridardr.usedirect.com/Floridardr/rdr/",
  MN: "https://mnrdr.usedirect.com/minnesotardr/rdr/",
  VA: "https://prod-va-rdr.recreation-management.tylerapp.com/virginiardr/rdr/",
  OH: "https://ohiordr.usedirect.com/Ohiordr/rdr/",
  NV: "https://nevadardr.usedirect.com/NevadaRDR/rdr/",
  MO: "https://msprdr.usedirect.com/MSPRDR/rdr/",
};

// Browser-ish headers so we pass any WAF that checks for a real UA.
const HEADERS = {
  accept: "application/json, text/plain, */*",
  "accept-language": "en-US,en;q=0.9",
  "content-type": "application/json",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
};

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

async function getJSON(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
    const txt = await r.text();
    let j = null;
    try {
      j = JSON.parse(txt);
    } catch {}
    return { status: r.status, json: j, text: txt.slice(0, 120) };
  } catch (e) {
    return { error: e.message };
  } finally {
    clearTimeout(t);
  }
}

async function postJSON(url, body, referer) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { ...HEADERS, ...(referer ? { referer, origin: new URL(referer).origin } : {}) },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const txt = await r.text();
    let j = null;
    try {
      j = JSON.parse(txt);
    } catch {}
    return { status: r.status, json: j, text: txt.slice(0, 120) };
  } catch (e) {
    return { error: e.message };
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  console.log("=== 1) Node REACHABILITY: GET {base}fd/places for every state ===\n");
  for (const [st, base] of Object.entries(HOSTS)) {
    const r = await getJSON(base + "fd/places");
    const places = Array.isArray(r.json) ? r.json.length : "n/a";
    console.log(
      `${st}: ${r.error ? "ERROR " + r.error : "HTTP " + r.status + "  places=" + places}`
    );
  }

  console.log("\n=== 2) FULL FLOW on Florida (usedirect.com host) ===\n");
  const base = HOSTS.FL;
  const ref = "https://reserve.floridastateparks.org";
  const places = await getJSON(base + "fd/places");
  if (!Array.isArray(places.json)) {
    console.log("Could not load FL places, stopping flow test:", places.error || places.status, places.text);
  } else {
    // Find a place that looks like it has camping (has a PlaceId), pick the first few.
    const p = places.json.find((x) => x.PlaceId) || places.json[0];
    console.log(`Sample place: PlaceId=${p.PlaceId} Name=${JSON.stringify(p.Name)} lat=${p.Latitude} lng=${p.Longitude} city=${JSON.stringify(p.City)}`);
    const start = ymd(new Date(Date.now() + 21 * 864e5));
    const sp = await postJSON(
      base + "search/place",
      { PlaceId: p.PlaceId, StartDate: start, Nights: 1, IsADA: false, UnitCategoryId: 0, SleepingUnitId: 0, MinVehicleLength: 0, UnitTypesGroupIds: [], CountNearby: false, RefreshFavourites: true, Latitude: 0, Longitude: 0 },
      ref
    );
    console.log(`search/place: ${sp.error ? "ERROR " + sp.error : "HTTP " + sp.status}`);
    const facs = sp.json && sp.json.SelectedPlace && sp.json.SelectedPlace.Facilities;
    const facList = facs ? Object.values(facs) : [];
    console.log(`facilities returned: ${facList.length}`);
    if (facList[0]) {
      const f = facList[0];
      console.log(`Sample facility: FacilityId=${f.FacilityId} Name=${JSON.stringify(f.Name)} Category=${JSON.stringify(f.Category)} lat=${f.Latitude} lng=${f.Longitude} webBooking=${f.FacilityAllowWebBooking}`);
      const grid = await postJSON(
        base + "search/grid",
        { FacilityId: f.FacilityId, StartDate: start, Nights: 7, InSeasonOnly: true, WebOnly: true, IsADA: false, SleepingUnitId: 0, MinVehicleLength: 0, UnitCategoryId: 0, UnitTypesGroupIds: [] },
        ref
      );
      console.log(`search/grid: ${grid.error ? "ERROR " + grid.error : "HTTP " + grid.status}`);
      const units = grid.json && grid.json.Facility && grid.json.Facility.Units;
      const uk = units ? Object.keys(units) : [];
      console.log(`units (campsites) returned: ${uk.length}`);
      if (uk.length) {
        const u = units[uk[0]];
        const sk = u.Slices ? Object.keys(u.Slices) : [];
        const free = sk.filter((d) => u.Slices[d].IsFree).length;
        console.log(`first unit "${u.Name}": ${sk.length} day-slices, ${free} free (IsFree=true)`);
        console.log(`sample slice: ${JSON.stringify(u.Slices[sk[0]])}`);
      }
    }
  }
  console.log("\n=== DONE — paste everything above back ===");
}

main().catch((e) => console.error("fatal:", e));
