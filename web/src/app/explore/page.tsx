"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, {
  type StyleSpecification,
  type GeoJSONSource,
  type Map as MlMap,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import TabBar from "@/components/TabBar";
import BottomSheet from "@/components/BottomSheet";
import { hipcampSearchUrl, koaUrl } from "@/lib/affiliates";
import { createClient } from "@/lib/supabase/client";
import { Protocol as PMTilesProtocol } from "pmtiles";

const GREEN = "#2d6a4f";
const TAN = "#b08968";
const PURPLE = "#6d597a";
const MAGENTA = "#e0218a"; // dispersed roads + bubbles
const BLUE = "#2563eb"; // permit lotteries
const MVUM_TILES_URL =
  "pmtiles://https://pfwuvjyaxrefxgcxdsoa.supabase.co/storage/v1/object/public/tiles/mvum.pmtiles";
let pmtilesRegistered = false;
const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;
const ROAD_MIN_ZOOM = 9; // dispersed roads only load when zoomed in this far
const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

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
type Spot = { id: string; name: string; notes: string | null; user_id: string; lat: number; lng: number };
type Road = { id: string; name: string; forest: string | null; season: string | null; lat: number; lng: number };
type Lottery = {
  id: string;
  name: string;
  area: string | null;
  state: string | null;
  apply_open: string | null;
  apply_close: string | null;
  results_date: string | null;
  cadence: string | null;
  url: string | null;
  lat: number;
  lng: number;
};
type Rating = {
  user_id: string;
  stars: number | null;
  road_condition: string | null;
  cell_signal: string | null;
  crowding: string | null;
  comment: string | null;
};
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
  bookableSites?: number;
  openSites?: number;
  siteNightDates?: { date: string; count: number; status?: string }[];
  siteAvailability?: { site: string; dates: { date: string; status?: string }[] }[];
  bookingUrl?: string;
  bookingLabel?: string;
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
  const supabase = useMemo(() => createClient(), []);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [selectedSpot, setSelectedSpot] = useState<Spot | null>(null);
  const [selectedRoad, setSelectedRoad] = useState<Road | null>(null);
  const [selectedLottery, setSelectedLottery] = useState<Lottery | null>(null);
  const [draft, setDraft] = useState<{ lat: number; lng: number } | null>(null);
  const [show, setShow] = useState({ reservable: true, fcfs: true });
  const [showDispersed, setShowDispersed] = useState(false);
  const [showLotteries, setShowLotteries] = useState(false);
  const [addMode, setAddMode] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [range, setRange] = useState({ start: isoToday(), end: isoPlus(30) });
  const [stateFilter, setStateFilter] = useState("all");
  const [states, setStates] = useState<string[]>([]);
  const [satellite, setSatellite] = useState(true);
  const [zoom, setZoom] = useState(3.4);
  const [mounted, setMounted] = useState(false);

  // Refs so map event handlers (registered once) always read current values.
  const showDispersedRef = useRef(showDispersed);
  showDispersedRef.current = showDispersed;
  const addModeRef = useRef(addMode);
  addModeRef.current = addMode;

  // Render only on the client — the map and date defaults depend on the browser,
  // so SSR'd HTML would never match (hydration error). Placeholder matches on both.
  useEffect(() => setMounted(true), []);

  // ---- dispersed-layer data loaders (stable: only depend on the supabase client) ----
  const loadSpots = useMemo(
    () => async (map: MlMap) => {
      const src = map.getSource("spots") as GeoJSONSource | undefined;
      if (!src) return;
      const { data } = await supabase
        .from("dispersed_spots")
        .select("id,name,lat,lng,notes,user_id")
        .limit(1000);
      const features = (data ?? []).map((s: Spot) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [s.lng, s.lat] },
        properties: { id: s.id, name: s.name, notes: s.notes, user_id: s.user_id },
      }));
      src.setData({ type: "FeatureCollection", features });
    },
    [supabase]
  );

  const loadLotteries = useMemo(
    () => async (map: MlMap) => {
      const src = map.getSource("lotteries") as GeoJSONSource | undefined;
      if (!src) return;
      const { data } = await supabase
        .from("lotteries")
        .select("id,name,area,state,apply_open,apply_close,results_date,cadence,url,lat,lng")
        .not("lat", "is", null);
      const features = (data ?? []).map((l: Lottery) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [l.lng, l.lat] },
        properties: l,
      }));
      src.setData({ type: "FeatureCollection", features });
    },
    [supabase]
  );

  // ---- init map once (after client mount, when the container exists) ----
  useEffect(() => {
    if (!mounted || mapRef.current || !containerRef.current) return;
    if (!pmtilesRegistered) {
      maplibregl.addProtocol("pmtiles", new PMTilesProtocol().tile);
      pmtilesRegistered = true;
    }
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

    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));

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

      // Dispersed-camping MVUM roads — nationwide vector tiles (PMTiles on Supabase
      // Storage). White halo = selected-road highlight; magenta = all roads. Source
      // layer name "mvum" matches the tippecanoe -l flag.
      map.addSource("mvum", { type: "vector", url: MVUM_TILES_URL });
      map.addLayer({
        id: "mvum-hl",
        type: "line",
        source: "mvum",
        "source-layer": "mvum",
        filter: ["==", ["get", "id"], "__none__"],
        layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
        paint: {
          "line-color": "#ffffff",
          "line-opacity": 0.95,
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 6, 15, 12],
        },
      });
      map.addLayer({
        id: "mvum",
        type: "line",
        source: "mvum",
        "source-layer": "mvum",
        layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
        paint: {
          "line-color": MAGENTA,
          "line-opacity": 0.9,
          "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.6, 9, 1.6, 12, 3, 15, 5],
        },
      });

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
        loadPinImage(map, "pin-purple", PURPLE),
        loadPinImage(map, "pin-blue", BLUE),
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

      // User-submitted dispersed spots (purple pins), on top.
      map.addSource("spots", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "spot-pts",
        type: "symbol",
        source: "spots",
        layout: {
          "icon-image": "pin-purple",
          "icon-size": 0.9,
          "icon-anchor": "bottom",
          "icon-allow-overlap": true,
          visibility: "none",
        },
      });

      // Permit/lottery locations (blue pins), toggled on.
      map.addSource("lotteries", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "lottery-pts",
        type: "symbol",
        source: "lotteries",
        layout: {
          "icon-image": "pin-blue",
          "icon-size": 0.95,
          "icon-anchor": "bottom",
          "icon-allow-overlap": true,
          visibility: "none",
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
      // (dispersed roads come from vector tiles now — no clusters to expand)
      map.on("click", "pts", (e) => {
        if (addModeRef.current) return;
        const f = e.features?.[0];
        const p = f?.properties ?? {};
        const coords = (f?.geometry as GeoJSON.Point | undefined)?.coordinates ?? [0, 0];
        setSelectedSpot(null);
        setSelectedRoad(null);
        setSelectedLottery(null);
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
      map.on("click", "spot-pts", (e) => {
        if (addModeRef.current) return;
        const f = e.features?.[0];
        const p = f?.properties ?? {};
        const c = (f?.geometry as GeoJSON.Point | undefined)?.coordinates ?? [0, 0];
        setSelected(null);
        setSelectedRoad(null);
        setSelectedLottery(null);
        setSelectedSpot({
          id: String(p.id),
          name: String(p.name ?? "Dispersed spot"),
          notes: p.notes ? String(p.notes) : null,
          user_id: String(p.user_id ?? ""),
          lng: Number(c[0]),
          lat: Number(c[1]),
        });
      });
      map.on("click", "mvum", (e) => {
        if (addModeRef.current) return;
        const f = e.features?.[0];
        const p = f?.properties ?? {};
        setSelected(null);
        setSelectedSpot(null);
        setSelectedLottery(null);
        setSelectedRoad({
          id: String(p.id),
          name: p.name ? String(p.name) : "",
          forest: p.forest ? String(p.forest) : null,
          season: p.season ? String(p.season) : null,
          lng: e.lngLat.lng,
          lat: e.lngLat.lat,
        });
      });
      map.on("click", "lottery-pts", (e) => {
        if (addModeRef.current) return;
        const f = e.features?.[0];
        const p = f?.properties ?? {};
        const c = (f?.geometry as GeoJSON.Point | undefined)?.coordinates ?? [0, 0];
        setSelected(null);
        setSelectedSpot(null);
        setSelectedRoad(null);
        setSelectedLottery({
          id: String(p.id),
          name: p.name ? String(p.name) : "",
          area: p.area ? String(p.area) : null,
          state: p.state ? String(p.state) : null,
          apply_open: p.apply_open ? String(p.apply_open) : null,
          apply_close: p.apply_close ? String(p.apply_close) : null,
          results_date: p.results_date ? String(p.results_date) : null,
          cadence: p.cadence ? String(p.cadence) : null,
          url: p.url ? String(p.url) : null,
          lng: Number(c[0]),
          lat: Number(c[1]),
        });
      });
      for (const layer of ["pts", "clusters", "spot-pts", "mvum", "lottery-pts"]) {
        map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = addModeRef.current ? "crosshair" : ""));
      }
      // Tap empty map: drop a spot in add-mode, otherwise dismiss any open sheet.
      map.on("click", (e) => {
        if (addModeRef.current) {
          setDraft({ lat: e.lngLat.lat, lng: e.lngLat.lng });
          setAddMode(false);
          return;
        }
        const hits = map.queryRenderedFeatures(e.point, {
          layers: ["pts", "clusters", "spot-pts", "mvum", "lottery-pts"],
        });
        if (hits.length === 0) {
          setSelected(null);
          setSelectedSpot(null);
          setSelectedRoad(null);
          setSelectedLottery(null);
        }
      });
      // Reload viewport roads + track zoom as the user pans.
      map.on("moveend", () => {
        setZoom(map.getZoom());
      });
      setReady(true);
    });

    return () => {
      map.remove();
      mapRef.current = undefined;
    };
  }, [mounted, supabase]);

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

  // Toggle the dispersed-camping layers; load their data when turned on.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const vis = showDispersed ? "visible" : "none";
    for (const id of ["mvum", "mvum-hl", "spot-pts"])
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis);
    if (showDispersed) {
      loadSpots(map);
    } else {
      setAddMode(false);
      setSelectedRoad(null);
    }
  }, [showDispersed, ready, loadSpots]);

  // Toggle the lotteries layer; load pins when turned on.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (map.getLayer("lottery-pts"))
      map.setLayoutProperty("lottery-pts", "visibility", showLotteries ? "visible" : "none");
    if (showLotteries) loadLotteries(map);
    else setSelectedLottery(null);
  }, [showLotteries, ready, loadLotteries]);

  // Highlight the selected dispersed road (white halo filtered to its id).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("mvum-hl")) return;
    map.setFilter("mvum-hl", ["==", ["get", "id"], selectedRoad ? selectedRoad.id : "__none__"]);
  }, [selectedRoad, ready]);

  // Reflect add-mode in the cursor.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = addMode ? "crosshair" : "";
  }, [addMode]);

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

  async function saveSpot(name: string, notes: string) {
    const map = mapRef.current;
    if (!userId) {
      window.location.href = "/login";
      return;
    }
    if (!draft || !map) return;
    const { data, error } = await supabase
      .from("dispersed_spots")
      .insert({ user_id: userId, name, lat: draft.lat, lng: draft.lng, notes: notes || null })
      .select("id,name,lat,lng,notes,user_id")
      .single();
    setDraft(null);
    if (!error && data) {
      await loadSpots(map);
      setSelectedSpot(data as Spot);
    }
  }

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
        style={{ position: "fixed", top: 64, bottom: 64, left: 0, right: 0 }}
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
        <Chip on={show.reservable} onClick={() => setShow((s) => ({ ...s, reservable: !s.reservable }))} color={GREEN}>
          ⛺ Reservable
        </Chip>
        <Chip on={show.fcfs} onClick={() => setShow((s) => ({ ...s, fcfs: !s.fcfs }))} color={TAN}>
          🏕️ First-come-first-served
        </Chip>
        <Chip on={showDispersed} onClick={() => setShowDispersed((v) => !v)} color={MAGENTA}>
          🚐 Dispersed
        </Chip>
        {showDispersed && (
          <Chip on={addMode} onClick={() => setAddMode((v) => !v)} color={PURPLE}>
            ➕ Add spot
          </Chip>
        )}
        <Chip on={showLotteries} onClick={() => setShowLotteries((v) => !v)} color={BLUE}>
          🎟️ Lotteries
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

      {/* add-mode banner */}
      {addMode && (
        <div className="fixed left-1/2 top-[112px] z-30 -translate-x-1/2 rounded-full bg-[#6d597a] px-4 py-2 text-xs font-medium text-white shadow-lg">
          Tap the map to drop your dispersed spot ·{" "}
          <button onClick={() => setAddMode(false)} className="underline">
            Cancel
          </button>
        </div>
      )}

      {/* dispersed zoom hint */}
      {showDispersed && !addMode && zoom < ROAD_MIN_ZOOM && (
        <div className="fixed left-1/2 top-[112px] z-20 -translate-x-1/2 rounded-full bg-white/95 px-3 py-1.5 text-xs text-stone-600 shadow">
          Zoom in to see individual roads
        </div>
      )}

      {/* legend */}
      <div className="fixed bottom-[76px] left-3 z-20 max-w-[220px] rounded-xl bg-white/95 px-3 py-2 text-[11px] leading-relaxed shadow-sm">
        <LegendRow color={GREEN}>Reservable</LegendRow>
        <LegendRow color={TAN}>First-come-first-served</LegendRow>
        <LegendRow color={MAGENTA}>Dispersed roads (MVUM)</LegendRow>
        <LegendRow color={PURPLE} pin>
          Saved dispersed spots
        </LegendRow>
        <LegendRow color={BLUE} pin>
          Permit lotteries
        </LegendRow>
        {showDispersed && (
          <p className="mt-1 border-t border-stone-200 pt-1 text-[10px] text-stone-400">
            Camping usually allowed within ~300 ft of these forest roads unless posted — verify on the
            forest&apos;s MVUM.
          </p>
        )}
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

      {selected && (
        <Sheet
          key={selected.id}
          sel={selected}
          range={range}
          supabase={supabase}
          userId={userId}
          onClose={() => setSelected(null)}
        />
      )}
      {selectedSpot && (
        <SpotSheet
          key={selectedSpot.id}
          spot={selectedSpot}
          userId={userId}
          supabase={supabase}
          onClose={() => setSelectedSpot(null)}
          onDeleted={async () => {
            setSelectedSpot(null);
            if (mapRef.current) await loadSpots(mapRef.current);
          }}
        />
      )}
      {selectedRoad && <RoadSheet key={selectedRoad.id} road={selectedRoad} onClose={() => setSelectedRoad(null)} />}
      {selectedLottery && (
        <LotterySheet key={selectedLottery.id} lottery={selectedLottery} onClose={() => setSelectedLottery(null)} />
      )}
      {draft && <AddSpotForm userId={userId} onCancel={() => setDraft(null)} onSave={saveSpot} />}

      <TabBar />
    </>
  );
}

function LegendRow({
  color,
  pin,
  children,
}: {
  color: string;
  pin?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-stone-700">
      <span
        className={`inline-block ${pin ? "h-3 w-2 rounded-sm" : "h-2.5 w-2.5 rounded-full"}`}
        style={{ backgroundColor: color }}
      />
      {children}
    </div>
  );
}

function Chip({
  on,
  onClick,
  color,
  children,
}: {
  on: boolean;
  onClick: () => void;
  color?: string;
  children: React.ReactNode;
}) {
  const onStyle = color ? { backgroundColor: color, borderColor: color, color: "#fff" } : undefined;
  return (
    <button
      onClick={onClick}
      style={on ? onStyle : undefined}
      className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm ${
        on
          ? color
            ? ""
            : "border-green-700 bg-green-700 text-white"
          : "border-stone-300 bg-white text-stone-700"
      }`}
    >
      {children}
    </button>
  );
}

function RoadSheet({ road, onClose }: { road: Road; onClose: () => void }) {
  const label = road.name ? (/^[0-9]/.test(road.name) ? `Forest Road ${road.name}` : road.name) : "Forest road";
  return (
    <BottomSheet onClose={onClose}>
      <h3 className="text-lg font-bold">{label}</h3>
      <p className="text-sm" style={{ color: MAGENTA }}>
        Dispersed-camping forest road
      </p>
      <div className="mt-2 space-y-0.5 text-sm text-stone-600">
        {road.forest && <p>{road.forest}</p>}
        {road.season && <p>Open: {road.season}</p>}
      </div>
      <p className="mt-3 rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-500">
        Dispersed camping is generally allowed within ~300 ft of this road unless posted otherwise. Confirm on
        the forest&apos;s MVUM, don&apos;t block the road, and pack out everything.
      </p>
      <a
        href={`https://www.google.com/maps/dir/?api=1&destination=${road.lat},${road.lng}`}
        target="_blank"
        rel="noreferrer"
        className="mt-3 block w-full rounded-xl border border-stone-300 py-2.5 text-center text-sm font-medium text-stone-700 hover:bg-stone-50"
      >
        Directions to this road ↗
      </a>
    </BottomSheet>
  );
}

function AddSpotForm({
  userId,
  onCancel,
  onSave,
}: {
  userId: string | null;
  onCancel: () => void;
  onSave: (name: string, notes: string) => void;
}) {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 px-4" onClick={onCancel}>
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold">Add a dispersed spot</h3>
        {!userId ? (
          <p className="mt-2 text-sm text-stone-600">
            <a href="/login" className="font-medium text-green-700 underline">
              Sign in
            </a>{" "}
            to save a spot for the community.
          </p>
        ) : (
          <>
            <label className="mt-3 block text-xs font-medium text-stone-500">Name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Pine flat off FR 300"
              className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            />
            <label className="mt-3 block text-xs font-medium text-stone-500">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Access, shade, what to expect…"
              className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            />
          </>
        )}
        <div className="mt-4 flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 rounded-xl border border-stone-300 py-2.5 text-sm font-medium text-stone-700"
          >
            Cancel
          </button>
          {userId && (
            <button
              onClick={() => name.trim() && onSave(name.trim(), notes.trim())}
              disabled={!name.trim()}
              className="flex-1 rounded-xl bg-[#6d597a] py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              Save spot
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const ROAD_OPTS = ["paved", "gravel", "rough", "4x4-only"];
const CELL_OPTS = ["none", "weak", "good"];
const CROWD_OPTS = ["empty", "some", "crowded"];

function mode(values: (string | null)[]) {
  const counts: Record<string, number> = {};
  for (const v of values) if (v) counts[v] = (counts[v] ?? 0) + 1;
  let best: string | null = null;
  let n = 0;
  for (const [k, c] of Object.entries(counts)) if (c > n) ((best = k), (n = c));
  return best;
}

function SpotSheet({
  spot,
  userId,
  supabase,
  onClose,
  onDeleted,
}: {
  spot: Spot;
  userId: string | null;
  supabase: ReturnType<typeof createClient>;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [fav, setFav] = useState(false);
  const [loading, setLoading] = useState(true);
  const [photos, setPhotos] = useState<{ id: string; url: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState<{ stars: number; road: string; cell: string; crowd: string; comment: string }>(
    { stars: 0, road: "", cell: "", crowd: "", comment: "" }
  );

  useEffect(() => {
    let live = true;
    setLoading(true);
    (async () => {
      const { data: rs } = await supabase
        .from("spot_ratings")
        .select("user_id,stars,road_condition,cell_signal,crowding,comment")
        .eq("spot_id", spot.id);
      if (!live) return;
      const list = (rs ?? []) as Rating[];
      setRatings(list);
      const mine = userId ? list.find((r) => r.user_id === userId) : undefined;
      if (mine)
        setForm({
          stars: mine.stars ?? 0,
          road: mine.road_condition ?? "",
          cell: mine.cell_signal ?? "",
          crowd: mine.crowding ?? "",
          comment: mine.comment ?? "",
        });
      if (userId) {
        const { data: f } = await supabase
          .from("spot_favorites")
          .select("spot_id")
          .eq("spot_id", spot.id)
          .eq("user_id", userId);
        if (live) setFav((f ?? []).length > 0);
      }
      const { data: ph } = await supabase
        .from("spot_photos")
        .select("id,url")
        .eq("spot_id", spot.id)
        .order("created_at", { ascending: false });
      if (live) setPhotos((ph ?? []) as { id: string; url: string }[]);
      setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, [spot.id, userId, supabase]);

  const count = ratings.length;
  const starVals = ratings.map((r) => r.stars).filter((s): s is number => typeof s === "number");
  const avg = starVals.length ? starVals.reduce((a, b) => a + b, 0) / starVals.length : null;

  async function submitRating() {
    if (!userId) {
      window.location.href = "/login";
      return;
    }
    const row = {
      spot_id: spot.id,
      user_id: userId,
      stars: form.stars || null,
      road_condition: form.road || null,
      cell_signal: form.cell || null,
      crowding: form.crowd || null,
      comment: form.comment.trim() || null,
    };
    await supabase.from("spot_ratings").upsert(row, { onConflict: "spot_id,user_id" });
    const { data: rs } = await supabase
      .from("spot_ratings")
      .select("user_id,stars,road_condition,cell_signal,crowding,comment")
      .eq("spot_id", spot.id);
    setRatings((rs ?? []) as Rating[]);
  }

  async function addPhoto(file: File) {
    if (!userId) {
      window.location.href = "/login";
      return;
    }
    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${spot.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("spot-photos").upload(path, file);
      if (upErr) return;
      const { data: pub } = supabase.storage.from("spot-photos").getPublicUrl(path);
      await supabase.from("spot_photos").insert({ spot_id: spot.id, user_id: userId, path, url: pub.publicUrl });
      const { data: ph } = await supabase
        .from("spot_photos")
        .select("id,url")
        .eq("spot_id", spot.id)
        .order("created_at", { ascending: false });
      setPhotos((ph ?? []) as { id: string; url: string }[]);
    } finally {
      setUploading(false);
    }
  }

  async function toggleFav() {
    if (!userId) {
      window.location.href = "/login";
      return;
    }
    if (fav) {
      setFav(false);
      await supabase.from("spot_favorites").delete().eq("spot_id", spot.id).eq("user_id", userId);
    } else {
      setFav(true);
      await supabase.from("spot_favorites").insert({ spot_id: spot.id, user_id: userId });
    }
  }

  async function deleteSpot() {
    if (!userId || spot.user_id !== userId) return;
    if (!window.confirm("Delete this spot?")) return;
    await supabase.from("dispersed_spots").delete().eq("id", spot.id).eq("user_id", userId);
    onDeleted();
  }

  return (
    <BottomSheet onClose={onClose}>

      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-bold">{spot.name}</h3>
          <p className="text-sm" style={{ color: PURPLE }}>
            Dispersed camping spot
          </p>
        </div>
        <button
          onClick={toggleFav}
          className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium ${
            fav ? "bg-[#6d597a] text-white" : "border border-stone-300 text-stone-700"
          }`}
        >
          {fav ? "★ Saved" : "☆ Save"}
        </button>
      </div>

      {spot.notes && <p className="mt-2 text-sm text-stone-600">{spot.notes}</p>}

      <div className="mt-3">
        {photos.length > 0 && (
          <div className="-mx-1 mb-2 flex gap-2 overflow-x-auto px-1">
            {photos.map((p) => (
              // eslint-disable-next-line @next/next/no-img-element
              <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="shrink-0">
                <img src={p.url} alt={spot.name} loading="lazy" className="h-24 w-32 rounded-lg object-cover" />
              </a>
            ))}
          </div>
        )}
        {userId ? (
          <label className="inline-block cursor-pointer text-xs font-medium text-green-700 hover:underline">
            {uploading ? "Uploading…" : "+ Add photo"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) addPhoto(f);
                e.target.value = "";
              }}
            />
          </label>
        ) : (
          <a href="/login" className="text-xs font-medium text-green-700 hover:underline">
            Sign in to add a photo
          </a>
        )}
      </div>

      <div className="mt-3 rounded-lg bg-stone-50 px-3 py-2 text-sm">
        {loading ? (
          <p className="text-stone-500">Loading reviews…</p>
        ) : count === 0 ? (
          <p className="text-stone-500">No reviews yet — be the first.</p>
        ) : (
          <div className="space-y-0.5">
            <p className="font-medium">
              {avg != null ? `★ ${avg.toFixed(1)}` : "Unrated"}{" "}
              <span className="font-normal text-stone-500">
                · {count} review{count !== 1 ? "s" : ""}
              </span>
            </p>
            <p className="text-xs text-stone-600">
              Road: {mode(ratings.map((r) => r.road_condition)) ?? "—"} · Cell:{" "}
              {mode(ratings.map((r) => r.cell_signal)) ?? "—"} · Crowding:{" "}
              {mode(ratings.map((r) => r.crowding)) ?? "—"}
            </p>
          </div>
        )}
      </div>

      {/* recent comments */}
      {ratings.filter((r) => r.comment).length > 0 && (
        <div className="mt-2 space-y-1.5">
          {ratings
            .filter((r) => r.comment)
            .slice(0, 5)
            .map((r, i) => (
              <p key={i} className="rounded-lg bg-stone-50 px-3 py-1.5 text-xs text-stone-700">
                {r.stars ? `★${r.stars} ` : ""}
                {r.comment}
              </p>
            ))}
        </div>
      )}

      {/* your review */}
      <div className="mt-4">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-stone-400">Your review</p>
        {!userId ? (
          <p className="text-sm text-stone-600">
            <a href="/login" className="font-medium text-green-700 underline">
              Sign in
            </a>{" "}
            to rate and save this spot.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setForm((f) => ({ ...f, stars: n }))}
                  className={`text-2xl leading-none ${n <= form.stars ? "text-amber-500" : "text-stone-300"}`}
                  aria-label={`${n} stars`}
                >
                  ★
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Select label="Road" value={form.road} opts={ROAD_OPTS} onChange={(v) => setForm((f) => ({ ...f, road: v }))} />
              <Select label="Cell" value={form.cell} opts={CELL_OPTS} onChange={(v) => setForm((f) => ({ ...f, cell: v }))} />
              <Select label="Crowding" value={form.crowd} opts={CROWD_OPTS} onChange={(v) => setForm((f) => ({ ...f, crowd: v }))} />
            </div>
            <textarea
              value={form.comment}
              onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))}
              rows={2}
              placeholder="Anything worth knowing?"
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            />
            <button
              onClick={submitRating}
              className="w-full rounded-xl bg-[#6d597a] py-2.5 text-sm font-bold text-white"
            >
              Save review
            </button>
          </div>
        )}
      </div>

      <a
        href={`https://www.google.com/maps/dir/?api=1&destination=${spot.lat},${spot.lng}`}
        target="_blank"
        rel="noreferrer"
        className="mt-3 block w-full rounded-xl border border-stone-300 py-2.5 text-center text-sm font-medium text-stone-700 hover:bg-stone-50"
      >
        Directions ↗
      </a>
      {userId && spot.user_id === userId && (
        <button onClick={deleteSpot} className="mt-2 w-full py-2 text-center text-xs text-red-500">
          Delete this spot
        </button>
      )}
      <p className="mt-3 text-[11px] text-stone-400">
        Dispersed sites are user-submitted. Confirm legality (within ~300 ft of an open forest road, no
        closures) on the forest&apos;s MVUM and pack out everything.
      </p>
    </BottomSheet>
  );
}

function Select({
  label,
  value,
  opts,
  onChange,
}: {
  label: string;
  value: string;
  opts: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-1 text-xs text-stone-600">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-stone-300 px-1.5 py-1 text-xs"
      >
        <option value="">—</option>
        {opts.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function Sheet({
  sel,
  range,
  supabase,
  userId,
  onClose,
}: {
  sel: Selected;
  range: { start: string; end: string };
  supabase: ReturnType<typeof createClient>;
  userId: string | null;
  onClose: () => void;
}) {
  const [av, setAv] = useState<Avail>({ loading: true });
  const [images, setImages] = useState<{ url: string; title: string }[]>([]);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [showSites, setShowSites] = useState(false);

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
  const bookableSites = av.bookableSites ?? 0;
  const openSites = av.openSites ?? 0;
  const span = `${mmdd(range.start)}–${mmdd(range.end)}`;
  const watchHref =
    `/dashboard/new?facility=${encodeURIComponent(sel.id)}&name=${encodeURIComponent(sel.name)}` +
    `&start=${range.start}&end=${range.end}`;

  return (
    <>
      <BottomSheet onClose={onClose}>

        {images.length > 0 && (
          <div className="mb-3 -mx-1 flex gap-2 overflow-x-auto px-1">
            {images.slice(0, 8).map((im, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={im.url}
                alt={im.title || sel.name}
                loading="lazy"
                onClick={() => setLightbox(im.url)}
                className="h-28 w-44 flex-shrink-0 cursor-pointer rounded-lg object-cover"
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
                Reservable on {av.bookingLabel ?? "recreation.gov"}
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

        {/* Distinct sites bookable/first-come in the window. When nothing's open we
            lean on RIDB's authoritative type to say definitively whether it's FCFS
            or simply fully booked, instead of guessing. */}
        <div className="my-3 min-h-[44px] text-sm">
          {av.loading ? (
            <p className="text-stone-500">Checking live availability…</p>
          ) : av.error ? (
            <p className="text-stone-500">Couldn&apos;t load live availability — set a watch and we&apos;ll keep checking.</p>
          ) : total > 0 ? (
            <>
              <p className="font-medium">
                {bookableSites > 0 && (
                  <span className="text-green-800">
                    🟢 {bookableSites} site{bookableSites !== 1 ? "s" : ""} bookable online
                  </span>
                )}
                {bookableSites > 0 && openSites > 0 && <span className="text-stone-400"> · </span>}
                {openSites > 0 && (
                  <span className="text-orange-800">
                    🏕️ {openSites} first-come site{openSites !== 1 ? "s" : ""}
                  </span>
                )}
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
          ) : av.resType === "fcfs" ? (
            <p className="text-stone-700">
              🏕️ <span className="font-medium">First-come-first-served.</span> This campground isn&apos;t
              bookable online — sites are claimed in person, so arrive early.
            </p>
          ) : av.resType === "reservable" ? (
            <p className="text-stone-700">
              <span className="font-medium">Reservable — fully booked for {span}.</span> No sites are open
              right now. Set a watch and we&apos;ll email you the moment one frees up.
            </p>
          ) : av.resType === "mixed" ? (
            <p className="text-stone-700">
              Has both reservable and first-come sites; nothing is bookable online for {span}. Set a watch for
              cancellations, or arrive early for a first-come site.
            </p>
          ) : (
            <p className="text-stone-500">
              No sites bookable online for {span}. Set a watch and we&apos;ll email you if booking opens.
            </p>
          )}
          {av.resType === "unknown" && (
            <p className="mt-2 text-[11px] text-stone-400">
              Reservation type can vary by season — confirm this campground&apos;s rules on recreation.gov.
            </p>
          )}
        </div>

        {!av.loading && av.siteAvailability && av.siteAvailability.length > 0 && (
          <div className="mb-3">
            <button
              onClick={() => setShowSites((v) => !v)}
              className="text-sm font-medium text-green-700 hover:underline"
              aria-expanded={showSites}
            >
              {showSites ? "▾ Hide" : "▸ Show"} {av.siteAvailability.length} available site
              {av.siteAvailability.length !== 1 ? "s" : ""} by night
            </button>
            {showSites && (
              <ul className="mt-2 max-h-64 space-y-1.5 overflow-y-auto pr-1">
                {av.siteAvailability.map((s) => (
                  <li
                    key={s.site}
                    className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-stone-100 pb-1.5"
                  >
                    <span className="text-sm font-medium text-stone-800">{s.site}</span>
                    <span className="flex flex-wrap gap-1">
                      {s.dates.map((d) => (
                        <span
                          key={d.date}
                          className={`rounded px-1.5 py-0.5 text-xs ${
                            d.status === "Open" ? "bg-orange-50 text-orange-800" : "bg-green-50 text-green-800"
                          }`}
                        >
                          {d.date.slice(5)}
                        </span>
                      ))}
                    </span>
                    <a
                      href={`${watchHref}&sites=${encodeURIComponent(s.site)}`}
                      className="ml-auto whitespace-nowrap text-xs font-medium text-green-700 hover:underline"
                      title={`Watch site ${s.site}`}
                    >
                      🔔 watch
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

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

        <CampgroundReviews facilityId={sel.id} facilityName={sel.name} userId={userId} supabase={supabase} />

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
          Open on {av.bookingLabel ?? "recreation.gov"} ↗
        </a>
        <a
          href={`/campground/${encodeURIComponent(sel.id)}`}
          className="mt-2 block w-full py-2 text-center text-sm font-medium text-stone-500 hover:text-stone-700 hover:underline"
        >
          Campground page &amp; reviews →
        </a>
        <p className="mt-2 text-center text-xs text-stone-400">
          Nearby private camping:{" "}
          <a
            href={hipcampSearchUrl({ city: sel.city, state: sel.state, name: sel.name })}
            target="_blank"
            rel="sponsored noopener noreferrer"
            className="font-medium text-green-700 hover:underline"
          >
            Hipcamp
          </a>{" "}
          ·{" "}
          <a
            href={koaUrl()}
            target="_blank"
            rel="sponsored noopener noreferrer"
            className="font-medium text-green-700 hover:underline"
          >
            KOA
          </a>
        </p>
      </BottomSheet>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt={sel.name} className="max-h-[90vh] max-w-full rounded-lg object-contain" />
        </div>
      )}
    </>
  );
}

function CampgroundReviews({
  facilityId,
  facilityName,
  userId,
  supabase,
}: {
  facilityId: string;
  facilityName: string;
  userId: string | null;
  supabase: ReturnType<typeof createClient>;
}) {
  const [reviews, setReviews] = useState<{ user_id: string; stars: number | null; comment: string | null }[]>([]);
  const [form, setForm] = useState<{ stars: number; comment: string }>({ stars: 0, comment: "" });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from("campground_reviews")
        .select("user_id,stars,comment")
        .eq("facility_id", facilityId);
      if (!live) return;
      const list = (data ?? []) as { user_id: string; stars: number | null; comment: string | null }[];
      setReviews(list);
      const mine = userId ? list.find((r) => r.user_id === userId) : undefined;
      if (mine) setForm({ stars: mine.stars ?? 0, comment: mine.comment ?? "" });
      setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, [facilityId, userId, supabase]);

  const count = reviews.length;
  const starVals = reviews.map((r) => r.stars).filter((s): s is number => typeof s === "number");
  const avg = starVals.length ? starVals.reduce((a, b) => a + b, 0) / starVals.length : null;

  async function submit() {
    if (!userId) {
      window.location.href = "/login";
      return;
    }
    await supabase.from("campground_reviews").upsert(
      {
        facility_id: facilityId,
        facility_name: facilityName,
        user_id: userId,
        stars: form.stars || null,
        comment: form.comment.trim() || null,
      },
      { onConflict: "facility_id,user_id" }
    );
    const { data } = await supabase
      .from("campground_reviews")
      .select("user_id,stars,comment")
      .eq("facility_id", facilityId);
    setReviews((data ?? []) as { user_id: string; stars: number | null; comment: string | null }[]);
  }

  return (
    <div className="my-3 border-t border-stone-100 pt-3">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-stone-400">Camper reviews</p>
      {loading ? (
        <p className="text-sm text-stone-500">Loading reviews…</p>
      ) : count === 0 ? (
        <p className="text-sm text-stone-500">No reviews yet — be the first.</p>
      ) : (
        <>
          <p className="text-sm font-medium">
            {avg != null ? `★ ${avg.toFixed(1)}` : "Unrated"}{" "}
            <span className="font-normal text-stone-500">
              · {count} review{count !== 1 ? "s" : ""}
            </span>
          </p>
          <div className="mt-1 space-y-1.5">
            {reviews
              .filter((r) => r.comment)
              .slice(0, 5)
              .map((r, i) => (
                <p key={i} className="rounded-lg bg-stone-50 px-3 py-1.5 text-xs text-stone-700">
                  {r.stars ? `★${r.stars} ` : ""}
                  {r.comment}
                </p>
              ))}
          </div>
        </>
      )}
      {!userId ? (
        <p className="mt-2 text-sm text-stone-600">
          <a href="/login" className="font-medium text-green-700 underline">
            Sign in
          </a>{" "}
          to leave a review.
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setForm((f) => ({ ...f, stars: n }))}
                className={`text-2xl leading-none ${n <= form.stars ? "text-amber-500" : "text-stone-300"}`}
                aria-label={`${n} stars`}
              >
                ★
              </button>
            ))}
          </div>
          <textarea
            value={form.comment}
            onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))}
            rows={2}
            placeholder="How was it?"
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
          />
          <button
            onClick={submit}
            className="w-full rounded-xl bg-green-700 py-2.5 text-sm font-bold text-white hover:bg-green-800"
          >
            Save review
          </button>
        </div>
      )}
    </div>
  );
}

function LotterySheet({ lottery, onClose }: { lottery: Lottery; onClose: () => void }) {
  const fmt = (d: string) =>
    new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const place = [lottery.area, lottery.state].filter(Boolean).join(", ");
  return (
    <BottomSheet onClose={onClose}>
      <h3 className="text-lg font-bold">{lottery.name}</h3>
      <p className="text-sm" style={{ color: BLUE }}>
        🎟️ Permit lottery{place ? ` · ${place}` : ""}
      </p>
      <div className="mt-2 space-y-1 text-sm text-stone-700">
        {lottery.apply_open ? (
          <p>
            <span className="font-medium">Apply</span> {fmt(lottery.apply_open)}
            {lottery.apply_close ? ` – ${fmt(lottery.apply_close)}` : ""}
            {lottery.results_date ? ` · Results ${fmt(lottery.results_date)}` : ""}
          </p>
        ) : lottery.cadence ? (
          <p className="text-stone-600">{lottery.cadence}</p>
        ) : null}
        {lottery.apply_open && lottery.cadence && <p className="text-xs text-stone-500">{lottery.cadence}</p>}
      </div>
      {lottery.url && (
        <a
          href={lottery.url}
          target="_blank"
          rel="noreferrer"
          className="mt-3 block w-full rounded-xl border border-stone-300 py-2.5 text-center text-sm font-medium text-stone-700 hover:bg-stone-50"
        >
          Details &amp; apply ↗
        </a>
      )}
      <a
        href="/lotteries"
        className="mt-2 block w-full rounded-xl bg-green-700 py-2.5 text-center text-sm font-bold text-white hover:bg-green-800"
      >
        Follow for reminders
      </a>
    </BottomSheet>
  );
}
