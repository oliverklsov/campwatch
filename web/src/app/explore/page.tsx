"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, {
  type StyleSpecification,
  type GeoJSONSource,
  type Map as MlMap,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import TabBar from "@/components/TabBar";

const GREEN = "#2d6a4f";
const TAN = "#b08968";
const PURPLE = "#6d597a";
const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;

const isoToday = () => new Date().toISOString().slice(0, 10);
const isoPlus = (days: number) => new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
const mmdd = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const subDays = (d: string, n: number) =>
  new Date(Date.parse(d + "T00:00:00Z") - n * 86400_000).toISOString().slice(0, 10);

// Teardrop map pin with a white tent inside, in the given color.
function pinSvg(color: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="52" viewBox="0 0 40 52">
    <path d="M20 1.5C10.6 1.5 3 9.1 3 18.5c0 11 17 32 17 32s17-21 17-32C37 9.1 29.4 1.5 20 1.5z" fill="${color}" stroke="#fff" stroke-width="2.5"/>
    <path d="M20 9.5 L30 25 L10 25 Z" fill="#fff"/>
    <path d="M20 15 L25 25 L15 25 Z" fill="${color}"/>
  </svg>`;
}

// Rasterize an SVG pin and register it with the map under `id`.
function loadPinImage(map: MlMap, id: string, color: string) {
  return new Promise<void>((resolve) => {
    const img = new Image(40, 52);
    img.onload = () => {
      if (!map.hasImage(id)) map.addImage(id, img, { pixelRatio: 2 });
      resolve();
    };
    img.onerror = () => resolve();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(pinSvg(color));
  });
}

// Free raster basemap (OpenStreetMap). Fine for launch volumes; can swap to a
// vector provider (Protomaps/MapTiler) later without touching the rest.
const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: [
        "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

type Selected = { id: string; name: string; reservable: boolean; city: string; state: string; lat: number; lng: number };
type Avail = {
  loading: boolean;
  error?: boolean;
  resType?: "reservable" | "fcfs" | "mixed" | "unknown";
  reservableSites?: number;
  fcfsSites?: number;
  siteTotal?: number;
  totalOpenings?: number;
  bookable?: number;
  fcfs?: number;
  siteNightDates?: { date: string; count: number; status?: string }[];
  bookingUrl?: string;
};
type WxDay = {
  date: string;
  name: string;
  high: number | null;
  low: number | null;
  unit: string;
  short: string;
  icon: string;
};

export default function ExplorePage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap>();
  const fcRef = useRef<GeoJSON.FeatureCollection | null>(null);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [show, setShow] = useState({ reservable: true, fcfs: true });
  const [range, setRange] = useState({ start: isoToday(), end: isoPlus(30) });
  const [stateFilter, setStateFilter] = useState("all");
  const [states, setStates] = useState<string[]>([]);
  const [satellite, setSatellite] = useState(true);
  const [mounted, setMounted] = useState(false);

  // Render only on the client — the map and date defaults depend on the browser,
  // so SSR'd HTML would never match (hydration error). Placeholder matches on both.
  useEffect(() => setMounted(true), []);

  // ---- init map once (after client mount, when the container exists) ----
  useEffect(() => {
    if (!mounted || mapRef.current || !containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_STYLE,
      center: [-98.5, 39.5],
      zoom: 3.4,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    // Safety net: ensure the canvas matches the container once layout settles.
    setTimeout(() => map.resize(), 0);

    map.on("load", async () => {
      map.resize();
      const fc: GeoJSON.FeatureCollection = await fetch("/api/facilities").then((r) => r.json());
      fcRef.current = fc;
      setStates(
        [...new Set(fc.features.map((f) => String(f.properties?.state ?? "")).filter(Boolean))].sort()
      );
      // Satellite imagery (toggled), above OSM and below pins. Uses MapTiler's
      // commercial-licensed hybrid (satellite + baked-in labels, deep zoom) when a
      // key is configured; otherwise falls back to USGS public-domain imagery.
      // Both are fine for commercial use, unlike Esri's free basemap terms.
      const satTiles = MAPTILER_KEY
        ? [`https://api.maptiler.com/maps/hybrid/256/{z}/{x}/{y}.jpg?key=${MAPTILER_KEY}`]
        : ["https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}"];
      map.addSource("sat", {
        type: "raster",
        tiles: satTiles,
        tileSize: 256,
        maxzoom: MAPTILER_KEY ? 20 : 16,
        attribution: MAPTILER_KEY
          ? "© MapTiler © OpenStreetMap contributors"
          : "Imagery: USGS The National Map",
      });
      map.addLayer({ id: "sat", type: "raster", source: "sat", layout: { visibility: "visible" } });

      map.addSource("facilities", {
        type: "geojson",
        data: fc,
        cluster: true,
        clusterRadius: 46,
        clusterMaxZoom: 11,
      });

      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "facilities",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": GREEN,
          "circle-opacity": 0.85,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff",
          "circle-radius": ["step", ["get", "point_count"], 15, 25, 20, 100, 26, 750, 34],
        },
      });
      await Promise.all([
        loadPinImage(map, "pin-green", GREEN),
        loadPinImage(map, "pin-tan", TAN),
      ]);
      map.addLayer({
        id: "pts",
        type: "symbol",
        source: "facilities",
        filter: ["!", ["has", "point_count"]],
        layout: {
          "icon-image": ["case", ["==", ["get", "reservable"], true], "pin-green", "pin-tan"],
          "icon-size": 1,
          "icon-anchor": "bottom",
          "icon-allow-overlap": true,
        },
      });

      map.on("click", "clusters", (e) => {
        const f = map.queryRenderedFeatures(e.point, { layers: ["clusters"] })[0];
        const clusterId = f.properties?.cluster_id;
        (map.getSource("facilities") as GeoJSONSource)
          .getClusterExpansionZoom(clusterId)
          .then((zoom) => {
            map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom });
          });
      });
      map.on("click", "pts", (e) => {
        const f = e.features?.[0];
        const p = f?.properties ?? {};
        const coords = (f?.geometry as GeoJSON.Point | undefined)?.coordinates ?? [0, 0];
        setSelected({
          id: String(p.id),
          name: String(p.name ?? "Campground"),
          reservable: p.reservable === true || p.reservable === "true",
          city: String(p.city ?? ""),
          state: String(p.state ?? ""),
          lng: Number(coords[0]),
          lat: Number(coords[1]),
        });
      });
      for (const layer of ["pts", "clusters"]) {
        map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
      }
      // Tap empty map (not a pin/cluster) to dismiss the open sheet.
      map.on("click", (e) => {
        const hits = map.queryRenderedFeatures(e.point, { layers: ["pts", "clusters"] });
        if (hits.length === 0) setSelected(null);
      });
      setReady(true);
    });

    return () => {
      map.remove();
      mapRef.current = undefined;
    };
  }, [mounted]);

  // ---- apply chip filter (re-cluster on filtered data) ----
  useEffect(() => {
    const map = mapRef.current;
    const fc = fcRef.current;
    if (!map || !fc || !map.getSource("facilities")) return;
    const features = fc.features.filter((f) => {
      const okType = f.properties?.reservable ? show.reservable : show.fcfs;
      const okState = stateFilter === "all" || f.properties?.state === stateFilter;
      return okType && okState;
    });
    (map.getSource("facilities") as GeoJSONSource).setData({ type: "FeatureCollection", features });
  }, [show, stateFilter, ready]);

  // Toggle the satellite layer on/off.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("sat")) return;
    map.setLayoutProperty("sat", "visibility", satellite ? "visible" : "none");
  }, [satellite, ready]);

  // Fly the map to the selected state's campgrounds (reset to US on "all").
  useEffect(() => {
    const map = mapRef.current;
    const fc = fcRef.current;
    if (!map || !fc || !ready) return;
    if (stateFilter === "all") {
      map.easeTo({ center: [-98.5, 39.5], zoom: 3.4, duration: 700 });
      return;
    }
    const feats = fc.features.filter((f) => f.properties?.state === stateFilter);
    if (!feats.length) return;
    const b = new maplibregl.LngLatBounds();
    for (const f of feats) b.extend((f.geometry as GeoJSON.Point).coordinates as [number, number]);
    map.fitBounds(b, { padding: 50, maxZoom: 9, duration: 700 });
  }, [stateFilter, ready]);

  if (!mounted) {
    return (
      <div className="fixed inset-0 flex items-center justify-center text-sm text-stone-500">
        Loading map…
      </div>
    );
  }

  return (
    <>
      {/* full-bleed map between header and tab bar (inline geometry so it never
          collapses to zero height regardless of CSS build) */}
      <div
        ref={containerRef}
        className="bg-stone-100"
        style={{ position: "fixed", top: 56, bottom: 64, left: 0, right: 0 }}
      />

      {/* filter chips */}
      <div className="fixed inset-x-3 top-[69px] z-30 flex gap-2 overflow-x-auto">
        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          className="shrink-0 rounded-full border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 shadow-sm"
        >
          <option value="all">All states</option>
          {states.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <Chip on={show.reservable} onClick={() => setShow((s) => ({ ...s, reservable: !s.reservable }))}>
          ⛺ Reservable
        </Chip>
        <Chip on={show.fcfs} onClick={() => setShow((s) => ({ ...s, fcfs: !s.fcfs }))}>
          🏕️ First-come-first-served
        </Chip>
      </div>

      {/* date-range control — drives the availability shown in each pin's sheet */}
      <div className="fixed left-3 top-[108px] z-30 flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs shadow-sm">
        <span className="font-medium text-stone-600">Dates</span>
        <input
          type="date"
          value={range.start}
          max={range.end}
          onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))}
          className="rounded border border-stone-300 px-1.5 py-1"
        />
        <span className="text-stone-400">→</span>
        <input
          type="date"
          value={range.end}
          min={range.start}
          onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))}
          className="rounded border border-stone-300 px-1.5 py-1"
        />
      </div>

      {/* legend */}
      <div className="fixed bottom-[76px] left-3 z-20 rounded-xl bg-white/95 px-3 py-2 text-[11px] leading-relaxed shadow-sm">
        <LegendRow color={GREEN}>Reservable</LegendRow>
        <LegendRow color={TAN}>First-come-first-served</LegendRow>
        <LegendRow color={PURPLE} muted>
          Dispersed (free) — coming soon
        </LegendRow>
      </div>

      {/* basemap toggle */}
      <button
        onClick={() => setSatellite((s) => !s)}
        className="fixed bottom-[76px] right-3 z-20 rounded-xl bg-white/95 px-3 py-2 text-xs font-medium text-stone-700 shadow-sm"
      >
        {satellite ? "🗺️ Map" : "🛰️ Satellite"}
      </button>

      {!ready && (
        <div className="fixed left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white/90 px-4 py-2 text-sm text-stone-600 shadow">
          Loading campgrounds…
        </div>
      )}

      {selected && <Sheet key={selected.id} sel={selected} range={range} onClose={() => setSelected(null)} />}

      <TabBar />
    </>
  );
}

function LegendRow({ color, muted, children }: { color: string; muted?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex items-center gap-2 ${muted ? "text-stone-400" : "text-stone-700"}`}>
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      {children}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm ${
        on ? "border-green-700 bg-green-700 text-white" : "border-stone-300 bg-white text-stone-700"
      }`}
    >
      {children}
    </button>
  );
}

function Sheet({
  sel,
  range,
  onClose,
}: {
  sel: Selected;
  range: { start: string; end: string };
  onClose: () => void;
}) {
  const [av, setAv] = useState<Avail>({ loading: true });
  const [images, setImages] = useState<{ url: string; title: string }[]>([]);

  // Availability re-fetches whenever the pin or the chosen date range changes.
  useEffect(() => {
    let live = true;
    setAv({ loading: true });
    fetch(`/api/facility/${sel.id}/availability?start=${range.start}&end=${range.end}`)
      .then((r) => r.json())
      .then((d) => live && setAv({ loading: false, error: !!d.error, ...d }))
      .catch(() => live && setAv({ loading: false, error: true }));
    return () => {
      live = false;
    };
  }, [sel.id, range.start, range.end]);

  // Photos only depend on the facility, so fetch them separately.
  useEffect(() => {
    let live = true;
    setImages([]);
    fetch(`/api/facility/${sel.id}/media`)
      .then((r) => r.json())
      .then((d) => live && setImages(Array.isArray(d.images) ? d.images : []))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [sel.id]);

  // Weather depends on location only.
  const [days, setDays] = useState<WxDay[]>([]);
  useEffect(() => {
    let live = true;
    setDays([]);
    if (!sel.lat && !sel.lng) return;
    fetch(`/api/weather?lat=${sel.lat}&lng=${sel.lng}`)
      .then((r) => r.json())
      .then((d) => live && setDays(Array.isArray(d.days) ? d.days : []))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [sel.id, sel.lat, sel.lng]);

  // Reservation release window (depends on facility only).
  const [release, setRelease] = useState<{ horizon: string | null; windowDays: number | null; windowMonths: number | null } | null>(null);
  useEffect(() => {
    let live = true;
    setRelease(null);
    fetch(`/api/facility/${sel.id}/release`)
      .then((r) => r.json())
      .then((d) => live && setRelease(d))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [sel.id]);

  const place = [sel.city, sel.state].filter(Boolean).join(", ");
  const total = av.totalOpenings ?? 0;
  const span = `${mmdd(range.start)}–${mmdd(range.end)}`;
  const watchHref =
    `/dashboard/new?facility=${encodeURIComponent(sel.id)}&name=${encodeURIComponent(sel.name)}` +
    `&start=${range.start}&end=${range.end}`;

  return (
    <div className="fixed inset-x-0 bottom-16 z-30 max-h-[72vh] overflow-y-auto rounded-t-2xl bg-white px-5 pb-5 pt-3 shadow-[0_-8px_30px_rgba(0,0,0,0.18)]">
      <div className="sticky top-0 z-10 -mx-5 -mt-3 flex items-center justify-between bg-white/95 px-5 pb-2 pt-3 backdrop-blur">
        <div className="mx-auto h-1 w-10 rounded-full bg-stone-200" />
        <button
          onClick={onClose}
          className="absolute right-4 top-2 rounded-full bg-stone-100 px-2 py-0.5 text-stone-500 hover:bg-stone-200"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {images.length > 0 && (
        <div className="mb-3 -mx-1 flex gap-2 overflow-x-auto px-1">
          {images.slice(0, 8).map((im, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={im.url}
              alt={im.title || sel.name}
              loading="lazy"
              className="h-28 w-44 flex-shrink-0 rounded-lg object-cover"
            />
          ))}
        </div>
      )}

      <h3 className="text-lg font-bold">{sel.name}</h3>
      {place && <p className="text-sm text-stone-500">{place}</p>}

      {/* Authoritative reservation type from RIDB per-site data. */}
      {!av.loading && av.resType && av.resType !== "unknown" && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {av.resType === "reservable" && (
            <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-800">
              Reservable on recreation.gov
            </span>
          )}
          {av.resType === "fcfs" && (
            <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-semibold text-orange-800">
              First-come-first-served · no reservations
            </span>
          )}
          {av.resType === "mixed" && (
            <>
              <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-800">
                Part reservable
              </span>
              <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-semibold text-orange-800">
                Part first-come
              </span>
            </>
          )}
          {(av.siteTotal ?? 0) > 0 && (
            <span className="text-xs text-stone-500">
              {av.reservableSites} reservable / {av.fcfsSites} first-come · {av.siteTotal} sites
            </span>
          )}
        </div>
      )}

      {/* Only assert what the live feed can prove for the chosen dates: how many
          site-nights are bookable online ("Available") vs first-come ("Open").
          Reservation policy varies by season, so we defer the authoritative answer
          to recreation.gov rather than guessing a campground-level label. */}
      <div className="my-3 min-h-[44px] text-sm">
        {av.loading ? (
          <p className="text-stone-500">Checking live availability…</p>
        ) : av.error ? (
          <p className="text-stone-500">Couldn&apos;t load live availability — set a watch and we&apos;ll keep checking.</p>
        ) : total > 0 ? (
          <>
            <p className="font-medium">
              {(av.bookable ?? 0) > 0 && <span className="text-green-800">🟢 {av.bookable} bookable online</span>}
              {(av.bookable ?? 0) > 0 && (av.fcfs ?? 0) > 0 && <span className="text-stone-400"> · </span>}
              {(av.fcfs ?? 0) > 0 && <span className="text-orange-800">🏕️ {av.fcfs} first-come</span>}
              <span className="text-stone-600"> · {span}</span>
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {av.siteNightDates!.slice(0, 8).map((d) => {
                const fc = d.status === "Open";
                return (
                  <span
                    key={d.date}
                    className={`rounded-md px-2 py-1 text-xs ${
                      fc ? "bg-orange-50 text-orange-900" : "bg-green-50 text-green-900"
                    }`}
                  >
                    {d.date.slice(5)} · {d.count}
                    {fc ? " FCFS" : ""}
                  </span>
                );
              })}
            </div>
          </>
        ) : (
          <p className="text-stone-500">
            No sites bookable online for {span}. This campground may be first-come-first-served or fully
            booked — set a watch and we&apos;ll email you if booking opens.
          </p>
        )}
        <p className="mt-2 text-[11px] text-stone-400">
          Reservation type can vary by season — confirm this campground&apos;s rules on recreation.gov.
        </p>
      </div>

      {release && release.windowMonths != null && av.resType === "reservable" && (
        <div className="mb-3 rounded-lg bg-stone-50 px-3 py-2 text-sm">
          <p className="font-medium text-stone-700">
            📅 Reservations open ~{release.windowMonths} month{release.windowMonths !== 1 ? "s" : ""} ahead
          </p>
          {release.horizon && (
            <p className="text-xs text-stone-500">Currently bookable through {mmdd(release.horizon)}.</p>
          )}
          {release.windowDays != null && release.horizon && range.start > release.horizon && (
            <p className="mt-0.5 text-xs text-green-800">
              Your {mmdd(range.start)} dates should open for booking around{" "}
              {mmdd(subDays(range.start, release.windowDays))}.
            </p>
          )}
        </div>
      )}

      {days.length > 0 && (
        <div className="mb-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-stone-400">Forecast</p>
          <div className="flex gap-2 overflow-x-auto">
            {days.map((d) => (
              <div
                key={d.date}
                title={d.short}
                className="flex w-16 flex-shrink-0 flex-col items-center rounded-lg bg-stone-50 px-1 py-2 text-center"
              >
                <span className="text-[11px] font-medium text-stone-600">
                  {new Date(d.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" })}
                </span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={d.icon} alt={d.short} className="my-1 h-8 w-8 rounded" />
                <span className="text-xs font-bold text-stone-800">
                  {d.high != null ? `${d.high}°` : "—"}
                </span>
                <span className="text-[11px] text-stone-500">{d.low != null ? `${d.low}°` : "—"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <a
        href={watchHref}
        className="block w-full rounded-xl bg-green-700 py-3.5 text-center font-bold text-white hover:bg-green-800"
      >
        🔔 Watch availability
      </a>
      <a
        href={av.bookingUrl ?? `https://www.recreation.gov/camping/campgrounds/${sel.id}`}
        target="_blank"
        rel="noreferrer"
        className="mt-2 block w-full rounded-xl border border-green-700 py-2.5 text-center text-sm font-medium text-green-700 hover:bg-green-50"
      >
        Open on recreation.gov ↗
      </a>
    </div>
  );
}
