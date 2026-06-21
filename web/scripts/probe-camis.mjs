// Can Node (your seed script + Vercel server functions) reach the Camis /
// GoingToCamp API past its Azure WAF? Everything works from a browser; this
// tests server-side with full browser-like headers. Run from web/:
//
//   node scripts/probe-camis.mjs
//
// Paste the output. If these come back 200, I'll build the Camis adapter. If
// they're 403 (Azure WAF), Camis needs a different fetch path and we'll discuss.

const HOST = "https://washington.goingtocamp.com";

// As close to a real Chrome request as we can get from Node.
const HEADERS = {
  accept: "application/json, text/plain, */*",
  "accept-language": "en-US,en;q=0.9",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  referer: HOST + "/",
  origin: HOST,
  "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
};

async function probe(label, url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
    const body = await r.text();
    let note = "";
    try {
      const j = JSON.parse(body);
      note = Array.isArray(j) ? `array[${j.length}]` : `keys: ${Object.keys(j).slice(0, 6).join(",")}`;
    } catch {
      note = /Azure WAF/i.test(body) ? "** Azure WAF block **" : body.slice(0, 80);
    }
    console.log(`${label}: HTTP ${r.status}  ${note}`);
  } catch (e) {
    console.log(`${label}: ERROR ${e.message}`);
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  const start = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const end = new Date(Date.now() + 33 * 864e5).toISOString().slice(0, 10);
  // -2147483396 = Alta Lake State Park rootMapId (from browser probe).
  const availUrl =
    `${HOST}/api/availability/map?mapId=-2147483396&bookingCategoryId=0` +
    `&startDate=${start}&endDate=${end}&getDailyAvailability=true&isReserving=true`;

  console.log("Testing Camis (GoingToCamp) reachability from Node…\n");
  await probe("discovery  /api/resourceLocation", HOST + "/api/resourceLocation");
  await probe("metadata   /api/bookingcategories", HOST + "/api/bookingcategories");
  await probe("availability /api/availability/map", availUrl);
  console.log("\n=== DONE — paste this back ===");
}

main();
