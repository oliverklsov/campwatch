import { NextResponse } from "next/server";

// Free National Weather Service forecast (no API key). US-only, which is fine —
// every facility is on US federal land. Two hops: points -> forecast URL.
// NWS asks for a descriptive User-Agent.
export const dynamic = "force-dynamic";
const UA = "CampWatch/1.0 (https://campwatch-tau.vercel.app)";

const empty = () => NextResponse.json({ days: [] });

export async function GET(request: Request) {
  const u = new URL(request.url);
  const lat = Number(u.searchParams.get("lat"));
  const lng = Number(u.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return empty();

  const headers = { "User-Agent": UA, Accept: "application/geo+json" };
  try {
    // NWS requires <= 4 decimal places on the points endpoint.
    const pt = await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lng.toFixed(4)}`, {
      headers,
      next: { revalidate: 3600 },
    });
    if (!pt.ok) return empty();
    const forecastUrl = (await pt.json())?.properties?.forecast;
    if (!forecastUrl) return empty();

    const fc = await fetch(forecastUrl, { headers, next: { revalidate: 3600 } });
    if (!fc.ok) return empty();
    const periods = (await fc.json())?.properties?.periods ?? [];

    // NWS alternates daytime (high) and night (low) periods that share a calendar
    // date. Pair them into one entry per day carrying both high and low.
    type Day = {
      date: string;
      name: string;
      high: number | null;
      low: number | null;
      unit: string;
      short: string;
      icon: string;
    };
    const byDate = new Map<string, Day>();
    for (const p of periods) {
      const date = String(p.startTime).slice(0, 10);
      const d =
        byDate.get(date) ??
        ({ date, name: "", high: null, low: null, unit: p.temperatureUnit, short: "", icon: "" } as Day);
      if (p.isDaytime) {
        d.high = p.temperature;
        d.name = p.name;
        d.short = p.shortForecast;
        d.icon = p.icon;
      } else {
        d.low = p.temperature;
        if (!d.icon) d.icon = p.icon; // a leading night period with no preceding day
        if (!d.short) d.short = p.shortForecast;
        if (!d.name) d.name = p.name;
      }
      byDate.set(date, d);
    }
    const days = [...byDate.values()].slice(0, 6);

    return NextResponse.json(
      { days },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } }
    );
  } catch {
    return empty();
  }
}
