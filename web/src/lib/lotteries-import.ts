import type { createServiceClient } from "@/lib/supabase/server";

// Pulls the live recreation.gov lottery list and refreshes our catalog.
// The endpoint returns many per-day runs; we dedupe by permit and keep each
// lottery's NEXT upcoming run for its dates. Upsert-only so user follows survive.

const CURATED_SLUGS = [
  "half-dome", "mount-whitney", "enchantments", "coyote-buttes-north", "coyote-buttes-south",
  "angels-landing", "grand-canyon-river", "four-rivers", "rogue-river", "dinosaur-green-yampa",
  "san-juan-river", "mount-st-helens",
];

const isoDate = (ts: string) => new Date(ts).toISOString().slice(0, 10);

function categorize(name: string): string {
  const n = name.toLowerCase();
  if (/(river|salmon|snake|rogue|chama|yampa|\bgreen\b|san juan|desolation|hells canyon|salt river|4 rivers)/.test(n))
    return "river";
  if (/(hunt|duck|turkey|waterfowl|deer|blind)/.test(n)) return "hunting";
  if (/(firefly|firework|easter|christmas|viewing|celebration|tree lighting)/.test(n)) return "event";
  if (/(campground|cabin|boat storage|parking)/.test(n)) return "campground";
  return "hiking";
}

function inferState(name: string): string {
  const n = name.toLowerCase();
  const map: [RegExp, string][] = [
    [/coyote buttes|the wave|grand canyon|salt river/, "AZ"],
    [/zion|angels landing|subway|mystery canyon|left fork|san juan|desolation|green river|yampa|dinosaur/, "UT"],
    [/yosemite|half dome|whitney/, "CA"],
    [/enchantment|st\.? helens|alpine lakes/, "WA"],
    [/rogue/, "OR"],
    [/ruedi|congaree firefly|colorado/, "CO"],
    [/salmon|selway|four rivers|4 rivers|hells canyon|snake river/, "ID"],
    [/rio chama/, "NM"],
    [/yellowstone/, "WY"],
    [/smoky mountains/, "TN"],
    [/congaree|carolina sandhills/, "SC"],
    [/mount rushmore/, "SD"],
    [/cape lookout/, "NC"],
    [/blackwater/, "MD"],
    [/belton lake|georgetown|somerville/, "TX"],
    [/white house|christmas tree/, "DC"],
  ];
  for (const [re, st] of map) if (re.test(n)) return st;
  return "";
}

function cadence(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("daily")) return "Daily lottery — apply 1–2 days ahead";
  if (n.includes("advanced")) return "Advanced lottery — apply months ahead";
  if (n.includes("seasonal")) return "Seasonal lottery";
  return "";
}

type Run = { open_at?: string; close_at?: string; announced_at?: string; deadline_at?: string };

export async function importLotteries(db: ReturnType<typeof createServiceClient>) {
  const res = await fetch("https://www.recreation.gov/api/lottery/available", {
    headers: { "User-Agent": "CampWatch/1.0 (https://campwatch-tau.vercel.app)", accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`lottery list ${res.status}`);
  const lots: any[] = (await res.json())?.lotteries ?? [];

  // Group runs by permit/facility id.
  const byId = new Map<string, { name: string; url: string | null; runs: Run[] }>();
  for (const l of lots) {
    const info = l.inventory_info ?? {};
    const id = String(info.facility_id ?? l.inventory_id ?? "").trim();
    const name = String(info.facility_name ?? l.name ?? "").trim();
    if (!id || !name || /fake/i.test(name)) continue;
    const e = byId.get(id) ?? { name, url: info.facility_url ? `https://www.recreation.gov${info.facility_url}` : null, runs: [] };
    e.runs.push({ open_at: l.open_at, close_at: l.close_at, announced_at: l.announced_at, deadline_at: l.deadline_at });
    byId.set(id, e);
  }

  const now = Date.now();
  const rows = [...byId.entries()].map(([id, e]) => {
    const upcoming = e.runs
      .filter((r) => r.open_at && Date.parse(r.open_at) >= now)
      .sort((a, b) => Date.parse(a.open_at!) - Date.parse(b.open_at!));
    const next = upcoming[0];
    return {
      id,
      name: e.name,
      area: "",
      state: inferState(e.name),
      category: categorize(e.name),
      apply_open: next?.open_at ? isoDate(next.open_at) : null,
      apply_close: next?.close_at ? isoDate(next.close_at) : null,
      results_date: next?.announced_at ? isoDate(next.announced_at) : null,
      cadence: cadence(e.name),
      estimated: false,
      url: e.url,
      notes: null as string | null,
    };
  });

  // Remove the old hand-curated rows (now superseded by live data), then upsert.
  await db.from("lotteries").delete().in("id", CURATED_SLUGS);
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from("lotteries").upsert(rows.slice(i, i + 200), { onConflict: "id" });
    if (error) throw new Error(`lottery upsert: ${error.message}`);
  }
  return { distinct: rows.length, runs: lots.length };
}
