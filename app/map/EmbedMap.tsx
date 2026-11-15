import UpgradeCard from "~/components/UpgradeCard";
import MatchedTags from "~/components/MatchedTags";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { Wordmark } from "~/components/brand";
import { DEFAULT_MAP_STYLE, GLYPH_SERVER, MAP_STYLES, MAP_STYLE_ORDER, buildMapStyle, glyphFont, hasSatellite, setMapboxToken, type MapStyleId } from "./mapStyles";
import { CategoryIcon, Icon, ICONS, categoryTone } from "./icons";
import PlaceInput, { type Place } from "./PlaceInput";
import { formatCu } from "~/lib/pricing";

// EDK Atlas (edk.earth/atlas, embed.edk.earth for agents, Console → Atlas), adapted from the atlasx
// map: a Protomaps basemap, one dock top-left that the results hang from, a centred tool rail on the
// right (lens, map style, select areas, inspect, route, archive), and the query bar at the bottom.

type Feature = { type: "Feature"; id?: string; geometry: { type: string; coordinates: [number, number] } | null; properties: Record<string, any> };
export type ResultData = { query: string; answer?: string; geojson: { features: Feature[] }; region?: { name: string; type?: string | null; context?: string | null }; tags?: string[]; areas?: { index: number; center: [number, number]; label?: string; outline?: any }[] };
type Reading = { title: string; detail: string | null; value?: string; about?: string | null; note?: string | null };
type InspectData = { center: [number, number]; outline?: any; known: boolean; place: { type: string; name: string }[]; highlights: Reading[]; categories: { name: string; items: Reading[] }[] };
type Inspect = { lat: number; lng: number; status: "loading" | "done" | "error"; data?: InspectData; error?: string };
type Line = { type: "LineString"; coordinates: [number, number][] };
type Stop = { lat: number; lng: number; label?: string };
type RouteData = {
  from: Stop; to: Stop; profile: string;
  route: { distance_m: number; duration_s: number; geometry: Line; steps: { instruction: string; name: string; distance_m: number; duration_s: number }[] };
  direct?: { distance_m: number; duration_s: number; geometry: Line; steps?: RouteData["route"]["steps"] };
  include?: { text: string; looked_for: string[]; cities: string[]; matches: number };
  included?: { lat: number; lng: number; name: string }[];
  conditions?: { text: string; looked_for: string[]; cities: string[]; matches: number };
  avoided: { lat: number; lng: number; name: string }[];
  remaining?: number;
  note?: string;
};
type Lens = { id: string; name: string; description: string | null };
type Archived = { id: string | null; query: string; count: number; at: number; data: ResultData };
type Tool = "areas" | "inspect" | "route" | null;
type Popover = "lens" | "style" | "archive" | null;
type Pick = { lng: number; lat: number; cell: string; outline: any };

type Props = {
  initialQuery?: string;
  token?: string | null;
  keyError?: string | null;
  initialResult?: { id: string; data: ResultData } | null;
  mapboxToken?: string | null;
  /** Where searches go (the console passes its own, billed endpoint). */
  searchUrl?: string;
  /** Where inspections go. */
  inspectUrl?: string;
  /** Where routes go. */
  routeUrl?: string;
  /** Fill the parent instead of the window (console). */
  contained?: boolean;
  /** Sent with each call, e.g. { source: "atlas" }. */
  extraBody?: Record<string, unknown>;
  /** Called after each successful call (the console refreshes the balance). */
  onResult?: () => void;
  /** Show the EDK wordmark in the dock (off in the console). */
  brand?: boolean;
  /** A shared result or a keyless embed: no searching, inspecting or routing. */
  readOnly?: boolean;
  /** Just the map and its pins (a result's first tile, the /map pages): no dock; a pin calls onPick. */
  preview?: boolean;
  onPick?: (index: number) => void;
  /** Give each result its own URL under this path ("/atlas" → "/atlas/res_…"), so a refresh brings it back. */
  resultPath?: string;
  /** The account balance in units, shown as CU (the signed-in Atlas). */
  balanceUnits?: number | null;
  /** When set, results end with an Upgrade card linking here (accounts below the top self-serve tier). */
  upgradeUrl?: string | null;
};

const titleOf = (p: Record<string, any>) => p.name || p.address || p.feature_name || "Location";
const subtitleOf = (p: Record<string, any>) => [p.feature_name && p.feature_name !== titleOf(p) ? p.feature_name : null, p.neighborhood || p.district || p.area].filter(Boolean).join(" · ");
const resultDate = (value: unknown) => {
  if (typeof value !== "string" || !value) return null;
  if (/^\d{4}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date) : value;
};

const onEmbedHost = () => typeof window !== "undefined" && window.location.hostname.startsWith("embed.");
const endpoint = (name: "discover" | "inspect" | "route" | "lenses") => (onEmbedHost() ? `/${name}` : `/atlas/api/${name}`);

const MAX_PICKS = 4;
const ARCHIVE_KEY = "edk-atlas-archive";
const PROFILES: [string, string][] = [["driving", "Drive"], ["walking", "Walk"], ["cycling", "Cycle"]];

const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)} km` : `${Math.round(m)} m`);
const mins = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.max(1, Math.round(s / 60))} min`);
const coordText = (lat: number, lng: number) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

function readArchive(): Archived[] {
  try {
    const list = JSON.parse(window.localStorage.getItem(ARCHIVE_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
function writeArchive(list: Archived[]) {
  try {
    window.localStorage.setItem(ARCHIVE_KEY, JSON.stringify(list));
  } catch {
    /* storage full or blocked: the archive is a convenience */
  }
}

/** A tiny drawn map in each style's own colors: land, a bay, a park and two roads. */
function Swatch({ id }: { id: MapStyleId }) {
  const c = MAP_STYLES[id].swatch;
  return (
    <svg viewBox="0 0 76 60" aria-hidden="true">
      <rect width="76" height="60" fill={c.land} />
      <path d="M0 0h30c4 8 1 15-6 20S8 32 0 34Z" fill={c.water} />
      <path d="M44 34c8-4 18-3 24 3s5 15-2 19-18 3-23-3-6-15 1-19Z" fill={c.green} />
      <path d="M-4 48 34 30 80 14" stroke={c.road} strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M36 -4 34 30 46 64" stroke={c.road} strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** One reading in an Inspect category; the "i" opens what it means. */
function ReadingRow({ item }: { item: Reading }) {
  const [open, setOpen] = useState(false);
  const explain = [item.about, item.note].filter(Boolean) as string[];
  return (
    <li>
      <div className="reading">
        <span className="reading-title">{item.title}</span>
        <span className="reading-value">{item.detail || item.value}</span>
        {explain.length ? (
          <button type="button" className={`reading-info${open ? " is-open" : ""}`} aria-expanded={open} aria-label={`What ${item.title} means`} onClick={() => setOpen((v) => !v)}><Icon d={ICONS.info} size={12} /></button>
        ) : <i aria-hidden="true" />}
      </div>
      {open ? <div className="reading-about">{explain.map((t, i) => <p key={i}>{t}</p>)}</div> : null}
    </li>
  );
}

function InspectGroup({ name, items, index, startOpen }: { name: string; items: Reading[]; index: number; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <section className={`inspect-cat tone-${categoryTone(name)}${open ? " is-open" : ""}`} style={{ animationDelay: `${120 + Math.min(index, 12) * 35}ms` }}>
      <button type="button" className="inspect-cat-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="inspect-cat-icon"><CategoryIcon name={name} /></span>
        <span className="inspect-cat-name">{name}</span>
        <span className="inspect-cat-count">{items.length}</span>
        <Icon d={ICONS.chevron} size={15} />
      </button>
      {open ? <ul>{items.map((it, i) => <ReadingRow key={i} item={it} />)}</ul> : null}
    </section>
  );
}

export default function EmbedMap({ initialQuery = "", token = null, keyError = null, initialResult = null, mapboxToken = null, searchUrl, inspectUrl, routeUrl, contained = false, extraBody, onResult, brand = !contained, balanceUnits = null, readOnly = false, preview = false, onPick, resultPath, upgradeUrl = null }: Props) {
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const containerRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const stopMarkersRef = useRef<Marker[]>([]);
  const overlayRef = useRef<any>({ type: "FeatureCollection", features: [] });
  const atlas = resultPath === "/atlas";
  const dockRef = useRef<HTMLDivElement>(null);
  const sheetDrag = useRef<{ y: number; height: number } | null>(null);
  const sheetMoved = useRef(false);
  const [sheetHeight, setSheetHeight] = useState<number>();
  const [draggingSheet, setDraggingSheet] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(false);
  const [style, setStyle] = useState<MapStyleId>(DEFAULT_MAP_STYLE);
  const [query, setQuery] = useState(initialQuery || initialResult?.data.query || "");
  const [result, setResult] = useState<{ id: string | null; data: ResultData } | null>(initialResult);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<React.ReactNode>(keyError);
  const [selected, setSelected] = useState<number | null>(null);
  const [panelOpen, setPanelOpen] = useState(Boolean(initialResult) && !preview);
  const [inspect, setInspect] = useState<Inspect | null>(null);
  // Tools are things you turn on: with none in hand, clicking the map only moves it.
  const [tool, setTool] = useState<Tool>(null);
  const [popover, setPopover] = useState<Popover>(null);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [lenses, setLenses] = useState<Lens[] | null>(null);
  const [lensQuery, setLensQuery] = useState("");
  const [archive, setArchive] = useState<Archived[]>([]);
  // Route
  const [routeOpen, setRouteOpen] = useState(false);
  const [stops, setStops] = useState<{ from: string; to: string }>({ from: "", to: "" });
  // Coordinates for a stop picked from the suggestions or the map; typing clears them.
  const [points, setPoints] = useState<{ from: Stop | null; to: Stop | null }>({ from: null, to: null });
  const [include, setInclude] = useState("");
  // Which of the two routes is in front: the one EDK-1 shaped, or the plain direct one.
  const [routeView, setRouteView] = useState<"edk" | "direct">("edk");
  const [activeStop, setActiveStop] = useState<"from" | "to">("from");
  const [conditions, setConditions] = useState("");
  const [profile, setProfile] = useState("driving");
  const [routeBusy, setRouteBusy] = useState(false);
  const [routeData, setRouteData] = useState<RouteData | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  setMapboxToken(mapboxToken);

  const features = useMemo(() => (result?.data.geojson.features ?? []).filter((f) => f.geometry?.type === "Point" && Array.isArray(f.geometry.coordinates)), [result]);
  const counts = useMemo(() => {
    const areas = features.filter((f) => f.properties?.kind === "area").length;
    return { locations: features.length - areas, areas };
  }, [features]);

  const view: "route" | "inspect" | "detail" | "results" | null = routeOpen ? "route" : inspect ? "inspect" : result && panelOpen ? (selected !== null && features[selected] ? "detail" : "results") : null;
  const dockOpen = view !== null;

  useEffect(() => setArchive(readArchive()), []);

  useEffect(() => {
    setSheetHeight(undefined);
  }, [view, result, selected]);

  const sheetStops = () => {
    const height = containerRef.current?.clientHeight ?? window.innerHeight;
    const full = Math.max(120, height - 92);
    return [120, Math.max(120, Math.min(full, Math.round(height * 0.48))), full];
  };
  const sheetStart = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    sheetMoved.current = false;
    sheetDrag.current = { y: event.clientY, height: dockRef.current?.offsetHeight ?? sheetStops()[1] };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingSheet(true);
  };
  const sheetMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = sheetDrag.current;
    if (!drag || (!sheetMoved.current && Math.abs(drag.y - event.clientY) < 5)) return;
    sheetMoved.current = true;
    const [peek, , full] = sheetStops();
    setSheetHeight(Math.min(full, Math.max(peek, drag.height + drag.y - event.clientY)));
  };
  const sheetEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = sheetDrag.current;
    sheetDrag.current = null;
    setDraggingSheet(false);
    if (!drag || !sheetMoved.current) return;
    const height = drag.height + drag.y - event.clientY;
    setSheetHeight(sheetStops().reduce((nearest, stop) => Math.abs(stop - height) < Math.abs(nearest - height) ? stop : nearest));
  };

  // ---- Map ---------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;
    (async () => {
      const [{ default: maplibregl }, { Protocol }] = await Promise.all([import("maplibre-gl"), import("pmtiles")]);
      await import("maplibre-gl/dist/maplibre-gl.css");
      if (cancelled || !containerRef.current) return;
      try { maplibregl.removeProtocol("pmtiles"); } catch { /* not registered */ }
      maplibregl.addProtocol("pmtiles", new Protocol().tile);
      try { maplibregl.removeProtocol("ovglyph"); } catch { /* not registered */ }
      maplibregl.addProtocol("ovglyph", async (params, abort) => {
        const m = params.url.match(/^ovglyph:\/\/(.+)\/(\d+)-(\d+)$/);
        if (!m) throw new Error("Bad glyph request");
        const stack = decodeURIComponent(m[1]).split(",")[0];
        const res = await fetch(`${GLYPH_SERVER}/${encodeURIComponent(glyphFont(stack, Number(m[2])))}/${m[2]}-${m[3]}.pbf`, { signal: abort.signal });
        if (!res.ok) throw new Error(`Glyphs unavailable (${res.status})`);
        return { data: await res.arrayBuffer() };
      });
      map = new maplibregl.Map({ container: containerRef.current, style: buildMapStyle(DEFAULT_MAP_STYLE), center: [-40, 30], zoom: 1.6, attributionControl: false });
      map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
      mapRef.current = map;
      map.on("load", () => setReady(true));
    })();
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (ready) mapRef.current?.setStyle(buildMapStyle(style));
  }, [style, ready]);

  // Keep the map sized to its box (the console sidebar opens and closes around it).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !ready) return;
    const ro = new ResizeObserver(() => mapRef.current?.resize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);

  // One overlay source: hexagons (picked areas, area results, the inspected cell), the route and what it avoids.
  const syncOverlay = useCallback(() => {
    const map = mapRef.current as any;
    if (!map) return;
    try {
      const source = map.getSource("edk-overlay");
      if (source) return source.setData(overlayRef.current);
      const shape = ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]];
      const kind = (k: string) => ["==", ["get", "kind"], k];
      map.addSource("edk-overlay", { type: "geojson", data: overlayRef.current });
      map.addLayer({ id: "edk-overlay-fill", type: "fill", source: "edk-overlay", filter: shape, paint: { "fill-color": ["match", ["get", "kind"], "inspect", "#f1ebdf", "#e0a458"], "fill-opacity": ["match", ["get", "kind"], "pick", 0.16, "inspect", 0.35, 0.28] } });
      map.addLayer({ id: "edk-overlay-line", type: "line", source: "edk-overlay", filter: shape, paint: { "line-color": ["match", ["get", "kind"], "inspect", "#13110e", "#c4823a"], "line-width": ["match", ["get", "kind"], "pick", 2, "inspect", 2.4, 1.2] } });
      map.addLayer({ id: "edk-direct-casing", type: "line", source: "edk-overlay", filter: kind("direct"), layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#f1ebdf", "line-opacity": 0.7, "line-width": 7 } });
      map.addLayer({ id: "edk-direct", type: "line", source: "edk-overlay", filter: kind("direct"), layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#5d6b73", "line-width": 3.5, "line-dasharray": [1.2, 1.6] } });
      map.addLayer({ id: "edk-route-casing", type: "line", source: "edk-overlay", filter: kind("route"), layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#13110e", "line-width": 8 } });
      map.addLayer({ id: "edk-route", type: "line", source: "edk-overlay", filter: kind("route"), layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#e0a458", "line-width": 4.5 } });
      map.addLayer({ id: "edk-avoided", type: "circle", source: "edk-overlay", filter: kind("avoided"), paint: { "circle-radius": 5, "circle-color": "#c8643f", "circle-stroke-color": "#13110e", "circle-stroke-width": 1.5 } });
      map.addLayer({ id: "edk-included", type: "circle", source: "edk-overlay", filter: kind("included"), paint: { "circle-radius": 7, "circle-color": "#9cb46a", "circle-stroke-color": "#13110e", "circle-stroke-width": 2 } });
    } catch {
      /* style still loading; styledata will retry */
    }
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.on("styledata", syncOverlay);
    return () => {
      map.off("styledata", syncOverlay);
    };
  }, [ready, syncOverlay]);

  useEffect(() => {
    if (!ready) return;
    const shapes: any[] = [];
    // Live picks, or the areas a finished search ran in.
    if (picks.length) for (const p of picks) shapes.push({ type: "Feature", properties: { kind: "pick" }, geometry: p.outline });
    else for (const a of result?.data.areas ?? []) if (a.outline) shapes.push({ type: "Feature", properties: { kind: "pick" }, geometry: a.outline });
    for (const f of result?.data.geojson.features ?? []) if (f.properties?.kind === "area" && f.properties.outline) shapes.push({ type: "Feature", properties: { kind: "result" }, geometry: f.properties.outline });
    if (inspect?.data?.outline) shapes.push({ type: "Feature", properties: { kind: "inspect" }, geometry: inspect.data.outline });
    if (routeData) {
      const front = routeView === "direct" && routeData.direct ? routeData.direct.geometry : routeData.route.geometry;
      const back = routeData.direct ? (routeView === "direct" ? routeData.route.geometry : routeData.direct.geometry) : null;
      if (back) shapes.push({ type: "Feature", properties: { kind: "direct" }, geometry: back });
      shapes.push({ type: "Feature", properties: { kind: "route" }, geometry: front });
      for (const h of routeData.avoided) shapes.push({ type: "Feature", properties: { kind: "avoided", name: h.name }, geometry: { type: "Point", coordinates: [h.lng, h.lat] } });
      for (const h of routeData.included ?? []) shapes.push({ type: "Feature", properties: { kind: "included", name: h.name }, geometry: { type: "Point", coordinates: [h.lng, h.lat] } });
    }
    overlayRef.current = { type: "FeatureCollection", features: shapes };
    syncOverlay();
  }, [result, inspect, picks, routeData, routeView, ready, syncOverlay]);

  const padding = useCallback(() => {
    const desktop = (containerRef.current?.clientWidth ?? window.innerWidth) > 900;
    const height = containerRef.current?.clientHeight ?? window.innerHeight;
    const sheet = dockRef.current?.classList.contains("is-open") ? dockRef.current.offsetHeight : height * 0.48;
    return desktop ? { top: 70, bottom: 110, left: 450, right: 90 } : { top: 92, bottom: atlas ? Math.min(sheet + 12, height * 0.6) : height * 0.5, left: 36, right: 62 };
  }, [atlas]);

  const fitAll = useCallback(() => {
    const map = mapRef.current;
    if (!map || !features.length) return;
    const xs = features.map((f) => f.geometry!.coordinates[0]);
    const ys = features.map((f) => f.geometry!.coordinates[1]);
    if (features.length === 1) map.flyTo({ center: features[0].geometry!.coordinates, zoom: 15, padding: padding(), duration: 1800 });
    else map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: padding(), maxZoom: 15, duration: 1800 });
  }, [features, padding]);

  // Pins.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let cancelled = false;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    if (!features.length) return;
    (async () => {
      const maplibregl = (await import("maplibre-gl")).default;
      if (cancelled) return;
      markersRef.current = features.map((f, i) => {
        const el = document.createElement("button");
        el.type = "button";
        el.className = `edk-pin${f.properties?.kind === "area" ? " is-area" : ""}`;
        el.title = titleOf(f.properties);
        el.setAttribute("aria-label", `Result ${i + 1}: ${titleOf(f.properties)}`);
        const dot = document.createElement("span");
        dot.style.animationDelay = `${Math.min(i, 40) * 25}ms`;
        const num = document.createElement("b");
        num.textContent = String(i + 1);
        dot.appendChild(num);
        el.appendChild(dot);
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (preview) {
            setSelected(i);
            pickRef.current?.(i);
            return;
          }
          setInspect(null);
          setRouteOpen(false);
          setPanelOpen(true);
          setSelected(i);
        });
        return new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(f.geometry!.coordinates).addTo(map);
      });
      fitAll();
    })();
    return () => {
      cancelled = true;
    };
  }, [features, ready, fitAll]);

  useEffect(() => {
    markersRef.current.forEach((m, i) => {
      m.getElement().classList.toggle("is-selected", i === selected);
      m.getElement().classList.toggle("is-dimmed", selected !== null && i !== selected);
    });
    const map = mapRef.current;
    if (map && selected !== null && features[selected]) map.flyTo({ center: features[selected].geometry!.coordinates, zoom: Math.max(map.getZoom(), 15.5), padding: padding(), duration: 1400 });
  }, [selected, features, padding]);

  // ---- Inspect --------------------------------------------------------------
  const runInspect = useCallback(
    async (lat: number, lng: number) => {
      setSelected(null);
      setRouteOpen(false);
      setPanelOpen(true);
      setInspect({ lat, lng, status: "loading" });
      const map = mapRef.current;
      if (map) map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 12.5), padding: padding(), duration: 1600, essential: true });
      try {
        const res = await fetch(inspectUrl ?? endpoint("inspect"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lat, lng, token, ...extraBody }) });
        const body = (await res.json().catch(() => null)) as any;
        if (!res.ok || !body?.data) throw new Error(body?.error || "This area is unavailable right now.");
        setInspect({ lat, lng, status: "done", data: body.data });
        onResult?.();
      } catch (error) {
        setInspect({ lat, lng, status: "error", error: error instanceof Error ? error.message : "This area is unavailable right now." });
      }
    },
    [inspectUrl, token, onResult, padding, extraBody],
  );

  // ---- Select areas -----------------------------------------------------------
  // The same shape the engine searches: the cell under the point and its six neighbours.
  const togglePick = useCallback(async (lng: number, lat: number) => {
    const h3 = await import("h3-js");
    const cell = h3.latLngToCell(lat, lng, 8);
    const disk = h3.gridDisk(cell, 1);
    setPicks((list) => {
      const hit = list.findIndex((p) => disk.includes(p.cell) || h3.gridDisk(p.cell, 1).includes(cell));
      if (hit >= 0) return list.filter((_, i) => i !== hit);
      if (list.length >= MAX_PICKS) return list;
      return [...list, { lng, lat, cell, outline: { type: "MultiPolygon", coordinates: h3.cellsToMultiPolygon(disk, true) } }];
    });
  }, []);

  // ---- Route ------------------------------------------------------------------
  const openRoute = useCallback(() => {
    setInspect(null);
    setSelected(null);
    setRouteOpen(true);
    setTool("route");
  }, []);

  const runRoute = useCallback(async (requested?: { from: string; to: string; include?: string; conditions?: string; profile?: string }) => {
    const from = requested?.from ?? points.from ?? stops.from.trim();
    const to = requested?.to ?? points.to ?? stops.to.trim();
    if (readOnly || routeBusy || !from || !to) return;
    const travelProfile = requested?.profile ?? profile;
    setRouteView("edk");
    setRouteBusy(true);
    setRouteError(null);
    try {
      const res = await fetch(routeUrl ?? endpoint("route"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        from, to, include: requested ? requested.include ?? "" : include.trim(),
        conditions: travelProfile === "driving" ? requested ? requested.conditions ?? "" : conditions.trim() : "",
        profile: travelProfile, token, ...extraBody,
      }) });
      const body = (await res.json().catch(() => null)) as any;
      if (!res.ok || !body?.data) throw new Error(body?.error || "Routing is unavailable right now.");
      setRouteData(body.data);
      setTool(null);
      onResult?.();
      window.parent?.postMessage({ type: "edk:route", distance_m: body.data.route.distance_m, duration_s: body.data.route.duration_s, avoided: body.data.avoided.length }, "*");
    } catch (error) {
      setRouteError(error instanceof Error ? error.message : "Routing is unavailable right now.");
    } finally {
      setRouteBusy(false);
    }
  }, [routeBusy, readOnly, stops, points, include, conditions, profile, token, extraBody, routeUrl, onResult]);

  // A and B on the map, and the camera on the whole route.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let cancelled = false;
    stopMarkersRef.current.forEach((m) => m.remove());
    stopMarkersRef.current = [];
    if (!routeData) return;
    (async () => {
      const maplibregl = (await import("maplibre-gl")).default;
      if (cancelled) return;
      stopMarkersRef.current = ([["A", routeData.from], ["B", routeData.to]] as [string, Stop][]).map(([letter, s]) => {
        const el = document.createElement("div");
        el.className = "edk-stop";
        el.textContent = letter;
        el.title = s.label || coordText(s.lat, s.lng);
        return new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([s.lng, s.lat]).addTo(map);
      });
      const line = [...routeData.route.geometry.coordinates, ...(routeData.direct?.geometry.coordinates ?? [])];
      const xs = line.map((c) => c[0]);
      const ys = line.map((c) => c[1]);
      map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: padding(), maxZoom: 16, duration: 1600 });
    })();
    return () => {
      cancelled = true;
    };
  }, [routeData, ready, padding]);

  const closeRoute = useCallback(() => {
    setRouteOpen(false);
    setRouteData(null);
    setRouteError(null);
    setTool((t) => (t === "route" ? null : t));
  }, []);

  // ---- The tool in hand ------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !tool) return;
    const onClick = (e: any) => {
      const { lat, lng } = e.lngLat;
      if (tool === "inspect") runInspect(lat, lng);
      else if (tool === "areas") togglePick(lng, lat);
      else {
        // Route: the click fills the stop being set, then moves on to the other one.
        setStops((s) => ({ ...s, [activeStop]: coordText(lat, lng) }));
        setPoints((p) => ({ ...p, [activeStop]: { lat, lng } }));
        setActiveStop((a) => (a === "from" ? "to" : "from"));
      }
    };
    map.on("click", onClick);
    map.getCanvas().style.cursor = "crosshair";
    return () => {
      map.off("click", onClick);
      map.getCanvas().style.cursor = "";
    };
  }, [ready, tool, runInspect, togglePick, activeStop]);

  const pickTool = (next: Exclude<Tool, null>) => {
    setPopover(null);
    const on = tool === next ? null : next;
    setTool(on);
  };

  // ---- Search -------------------------------------------------------------
  const run = useCallback(
    async (q: string, around?: [number, number][]) => {
      const text = q.trim();
      if (!text || loading) return;
      setLoading(true);
      setToast(null);
      setSelected(null);
      setInspect(null);
      setRouteOpen(false);
      const areas = around ?? picks.map((p) => [p.lng, p.lat] as [number, number]);
      try {
        const res = await fetch(searchUrl ?? endpoint("discover"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: text, token, limit: 10, answer: true, ...(areas.length ? { areas } : {}), ...extraBody }) });
        const body = (await res.json().catch(() => null)) as any;
        if (!res.ok || !body?.data) {
          setToast(res.status === 429 ? <>{body?.error} <a href="https://edk.earth/sign-up" target="_blank" rel="noreferrer">Sign up</a></> : body?.error || "Search is unavailable right now.");
          return;
        }
        setResult({ id: body.id, data: body.data });
        setPanelOpen(true);
        if (resultPath && body.id) window.history.pushState(null, "", `${resultPath}/${body.id}`);
        setPicks([]);
        setTool((t) => (t === "areas" ? null : t));
        const count = body.data.geojson.features.length;
        setArchive((list) => {
          const next = [{ id: body.id ?? null, query: text, count, at: Date.now(), data: body.data }, ...list.filter((a) => a.query.toLowerCase() !== text.toLowerCase())].slice(0, 12);
          writeArchive(next);
          return next;
        });
        onResult?.();
        window.parent?.postMessage({ type: "edk:result", id: body.id, embed_url: body.embed_url, count }, "*");
      } catch {
        setToast("Search is unavailable right now.");
      } finally {
        setLoading(false);
      }
    },
    [loading, token, searchUrl, extraBody, onResult, picks, resultPath],
  );

  /** Close the results for good (minimize only tucks them away). */
  const dismiss = useCallback(() => {
    setResult(null);
    setSelected(null);
    setPanelOpen(false);
    setQuery("");
    if (resultPath && window.location.pathname !== resultPath) window.history.pushState(null, "", resultPath);
  }, [resultPath]);

  // Back and forward move between results that were opened here.
  useEffect(() => {
    if (!resultPath) return;
    const onPop = () => {
      const id = window.location.pathname.startsWith(`${resultPath}/`) ? window.location.pathname.slice(resultPath.length + 1) : null;
      if (!id) {
        setResult(null);
        setSelected(null);
        setPanelOpen(false);
        return;
      }
      const kept = readArchive().find((a) => a.id === id);
      if (!kept) return window.location.reload();
      setQuery(kept.query);
      setSelected(null);
      setResult({ id: kept.id, data: kept.data });
      setPanelOpen(true);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [resultPath]);

  const ranInitial = useRef(false);
  useEffect(() => {
    if (!ready || ranInitial.current) return;
    ranInitial.current = true;
    if (initialResult) fitAll();
    else if (initialQuery && !keyError) run(initialQuery);
  }, [ready, initialQuery, initialResult, keyError, run, fitAll]);

  // Pages embedding the Atlas can drive it: postMessage({type: "edk:search", query}), {type: "edk:show", data}
  // or {type: "edk:route", from, to, include, conditions, profile}.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const m = e.data;
      if (!m || typeof m !== "object") return;
      if (m.type === "edk:search" && typeof m.query === "string" && !readOnly) {
        setQuery(m.query);
        run(m.query);
      }
      if (m.type === "edk:show" && m.data?.geojson) {
        setResult({ id: m.id ?? null, data: m.data });
        setPanelOpen(true);
      }
      if (m.type === "edk:route" && m.data?.route?.geometry) {
        setRouteData(m.data);
        setRouteOpen(true);
      } else if (m.type === "edk:route" && !readOnly && e.source === window.parent &&
        typeof m.from === "string" && typeof m.to === "string" && m.from.trim() && m.to.trim()) {
        const from = m.from.trim().slice(0, 200);
        const to = m.to.trim().slice(0, 200);
        const include = typeof m.include === "string" ? m.include.trim().slice(0, 300) : "";
        const conditions = typeof m.conditions === "string" ? m.conditions.trim().slice(0, 300) : "";
        const profile = m.profile === "walking" || m.profile === "cycling" ? m.profile : "driving";
        setStops({ from, to });
        setPoints({ from: null, to: null });
        setInclude(include);
        setConditions(conditions);
        setProfile(profile);
        openRoute();
        void runRoute({ from, to, include, conditions, profile });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [run, runRoute, openRoute, readOnly]);

  // Lens: a catalogue of things EDK-1 can find. Loaded when the list first opens, then as you type.
  useEffect(() => {
    if (popover !== "lens") return;
    const ctrl = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`${endpoint("lenses")}?q=${encodeURIComponent(lensQuery.trim())}`, { signal: ctrl.signal });
        const body = (await res.json().catch(() => null)) as any;
        if (Array.isArray(body?.lenses)) setLenses(body.lenses);
      } catch {
        /* aborted, or the list stays as it was */
      }
    }, lenses ? 220 : 0);
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [popover, lensQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickLens = (lens: Lens) => {
    setPopover(null);
    setQuery(lens.name);
    const map = mapRef.current;
    // Zoomed in on somewhere: look there. Otherwise let the engine place the query.
    const here = !picks.length && map && map.getZoom() >= 8 ? [[map.getCenter().lng, map.getCenter().lat] as [number, number]] : undefined;
    run(lens.name, here);
  };

  // Clicking outside the rail folds its popover away.
  useEffect(() => {
    if (!popover) return;
    const onDown = (e: MouseEvent) => railRef.current && !railRef.current.contains(e.target as Node) && setPopover(null);
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [popover]);

  // "/" focuses search; Escape steps back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName ?? "");
      if (e.key === "/" && !typing && !preview) {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape") {
        if (popover) setPopover(null);
        else if (tool) setTool(null);
        else if (inspect) setInspect(null);
        else if (selected !== null) setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inspect, selected, tool, popover, preview]);

  const setStopText = (k: "from" | "to", text: string) => {
    setStops((s) => ({ ...s, [k]: text }));
    setPoints((p) => ({ ...p, [k]: null }));
  };
  const pickStop = (k: "from" | "to", place: Place) => {
    setStops((s) => ({ ...s, [k]: place.label }));
    setPoints((p) => ({ ...p, [k]: place }));
    setActiveStop(k === "from" ? "to" : "from");
  };
  // Suggestions lean toward the start once it is set, otherwise toward where the map is looking.
  const mapCentre = () => {
    if (points.from) return [points.from.lng, points.from.lat] as [number, number];
    const c = mapRef.current?.getCenter();
    return c ? ([c.lng, c.lat] as [number, number]) : null;
  };
  const routeReady = Boolean(stops.from.trim() && stops.to.trim());
  const shownSteps = routeData ? (routeView === "direct" && routeData.direct?.steps ? routeData.direct.steps : routeData.route.steps) : [];

  const current = view === "detail" ? features[selected!] : null;
  const place = inspect?.data?.place ?? [];
  const toolNote = tool === "inspect" ? "Click anywhere on the map to inspect that spot" : tool === "areas" ? (picks.length >= MAX_PICKS ? "Four areas picked. Click one to remove it" : "Click the map to add an area to your question") : tool === "route" ? `Click the map to set ${activeStop === "from" ? "the start (A)" : "the end (B)"}` : null;
  const closeBtn = (onClick: () => void, label = "Close") => <button type="button" className="map-close" aria-label={label} data-tip={label} data-tip-side="bottom" onClick={onClick}><Icon d={ICONS.close} /></button>;
  const minimizeBtn = <button type="button" className="map-close map-minimize" aria-label="Minimize results" data-tip="Minimize" data-tip-side="bottom" onClick={() => setPanelOpen(false)}><Icon d={ICONS.minus} /></button>;
  const railBtn = (id: string, label: string, icon: string, on: boolean, onClick: () => void, badge?: number) => (
    <button type="button" aria-label={label} aria-pressed={on} data-tip={label} className={on ? "active" : ""} onClick={onClick}>
      <Icon d={icon} size={18} />
      {badge ? <b>{badge}</b> : null}
    </button>
  );

  return (
    <div data-map-style={style} className={`map-app${atlas ? " is-atlas" : ""}${result ? " has-results" : ""}${contained ? " is-contained" : ""}${dockOpen ? " has-panel" : ""}${brand ? "" : " no-brand"}${preview ? " is-preview" : ""}`}>
      <div ref={containerRef} className="map-canvas" />

      {/* One piece, docked top-left: the wordmark on its own, and whatever is showing hangs from it. */}
      <div ref={dockRef} className={`map-dock${dockOpen ? " is-open" : ""}${draggingSheet ? " is-dragging" : ""}`} style={atlas && sheetHeight !== undefined ? { "--atlas-sheet-height": `${sheetHeight}px` } as React.CSSProperties : undefined}>
        {atlas && dockOpen && <button
          className="atlas-sheet-handle"
          type="button"
          aria-label="Resize results panel"
          onPointerDown={sheetStart}
          onPointerMove={sheetMove}
          onPointerUp={sheetEnd}
          onPointerCancel={() => { sheetDrag.current = null; setDraggingSheet(false); }}
          onClick={(event) => {
            if (event.detail !== 0 && sheetMoved.current) return;
            const [, half, full] = sheetStops();
            setSheetHeight((dockRef.current?.offsetHeight ?? half) >= full - 4 ? half : full);
          }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            event.preventDefault();
            const currentHeight = dockRef.current?.offsetHeight ?? sheetStops()[1];
            const stops = sheetStops();
            const next = event.key === "ArrowUp" ? stops.find((stop) => stop > currentHeight + 4) : stops.reverse().find((stop) => stop < currentHeight - 4);
            if (next !== undefined) setSheetHeight(next);
          }}
        ><span /></button>}
        {brand ? (
          <div className="map-dock-bar">
            <a className="map-brand" href="https://edk.earth" target="_top" aria-label="EDK home"><Wordmark height={18} /></a>
            {dockOpen ? <span className="map-dock-view">{view === "route" ? "Route" : view === "inspect" ? "Inspect" : "Discover"}</span> : null}
          </div>
        ) : null}
        <div className="map-dock-body" aria-hidden={!dockOpen}>
          {view === "route" ? (
            <section className="map-panel" aria-label="Route">
              <div className="map-panel-head">
                <span className="panel-icon tone-ochre"><Icon d={ICONS.route} size={20} /></span>
                <div className="panel-title">
                  <h2>Route</h2>
                  <small>{routeData ? `${km(routeData.route.distance_m)} · ${mins(routeData.route.duration_s)}` : "From A to B: what to pass, and what to avoid"}</small>
                </div>
                {closeBtn(closeRoute)}
              </div>
              <div className="map-panel-body">
                <form className="route-form" onSubmit={(e) => { e.preventDefault(); runRoute(); }}>
                  {(["from", "to"] as const).map((k) => (
                    <label key={k} className={`route-stop${tool === "route" && activeStop === k ? " is-active" : ""}`}>
                      <b>{k === "from" ? "A" : "B"}</b>
                      <PlaceInput value={stops[k]} onText={(t) => setStopText(k, t)} onPick={(p) => pickStop(k, p)} token={mapboxToken} near={mapCentre} onFocus={() => setActiveStop(k)} placeholder={k === "from" ? "Start: a place, an address, or click the map" : "End: a place, an address, or click the map"} ariaLabel={k === "from" ? "Start" : "End"} sessionSearch />
                    </label>
                  ))}
                  <label className="route-stop is-include">
                    <Icon d={ICONS.include} size={15} />
                    <input value={include} onChange={(e) => setInclude(e.target.value)} placeholder="Include, like “a coffee shop” or “scenic overlooks”" aria-label="Include on the way" maxLength={300} />
                  </label>
                  {profile === "driving" ? <label className="route-stop is-avoid">
                    <Icon d={ICONS.avoid} size={15} />
                    <input value={conditions} onChange={(e) => setConditions(e.target.value)} placeholder="Avoid, like “pothole streets”" aria-label="Avoid" maxLength={300} />
                  </label> : null}
                  <div className="route-bar">
                    <div className="route-profiles" role="group" aria-label="Travel by">
                      {PROFILES.map(([id, label]) => <button key={id} type="button" aria-pressed={profile === id} onClick={() => setProfile(id)}>{label}</button>)}
                    </div>
                    <button type="button" className={`route-pick${tool === "route" ? " is-on" : ""}`} onClick={() => setTool(tool === "route" ? null : "route")} data-tip={tool === "route" ? "Stop picking on the map" : "Pick A and B on the map"} data-tip-side="bottom" aria-pressed={tool === "route"} aria-label="Pick on the map"><Icon d={ICONS.target} size={15} /></button>
                    <button type="submit" className="route-go" disabled={routeBusy || !routeReady}>{routeBusy ? <span className="spinner" /> : "Route"}</button>
                  </div>
                </form>
                {routeError ? <p className="map-muted">{routeError}</p> : null}
                {routeData ? (
                  <div className="route-result">
                    {routeData.direct ? (
                      <div className="route-compare" role="radiogroup" aria-label="Compare routes">
                        {([
                          ["edk", "EDK-1 route", routeData.route, [routeData.included?.length ? `passes ${routeData.included.length}` : null, routeData.avoided.length ? `avoids ${routeData.avoided.length}` : null].filter(Boolean).join(" · ") || "as asked"],
                          ["direct", "Direct", routeData.direct, "nothing applied"],
                        ] as const).map(([id, label, r, sub]) => (
                          <button key={id} type="button" role="radio" aria-checked={routeView === id} className={`route-option is-${id}${routeView === id ? " is-on" : ""}`} onClick={() => setRouteView(id)}>
                            <span className="route-option-head"><i aria-hidden="true" />{label}</span>
                            <strong>{mins(r.duration_s)}</strong>
                            <small>{km(r.distance_m)} · {sub}</small>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="route-stats">
                        <div><small>Distance</small><strong>{km(routeData.route.distance_m)}</strong></div>
                        <div><small>Time</small><strong>{mins(routeData.route.duration_s)}</strong></div>
                        <div className={routeData.avoided.length ? "tone-clay" : ""}><small>Avoided</small><strong>{routeData.avoided.length}</strong></div>
                      </div>
                    )}
                    {routeData.direct ? <p className="route-note">The EDK-1 route takes {routeData.route.duration_s >= routeData.direct.duration_s ? `${mins(routeData.route.duration_s - routeData.direct.duration_s)} longer` : `${mins(routeData.direct.duration_s - routeData.route.duration_s)} less`} than the direct one. Tap either to see it on the map.</p> : null}
                    {routeData.included?.length ? (
                      <ul className="route-via">
                        {routeData.included.map((h, i) => <li key={i}><i aria-hidden="true" />{h.name}<small>{coordText(h.lat, h.lng)}</small></li>)}
                      </ul>
                    ) : null}
                    {routeData.include ? <p className="route-note">Looked for {routeData.include.looked_for.join(", ").toLowerCase()} along the way: {routeData.include.matches} known.</p> : null}
                    {routeData.note ? <p className="route-note">{routeData.note}</p> : null}
                    <ol className="route-steps">
                      {shownSteps.filter((st) => st.instruction).map((st, i) => (
                        <li key={i}><span>{st.instruction}</span><small>{st.distance_m ? km(st.distance_m) : ""}</small></li>
                      ))}
                    </ol>
                  </div>
                ) : null}
              </div>
            </section>
          ) : view === "inspect" && inspect ? (
            <section className="map-panel" aria-label="Area details" key={`${inspect.lat},${inspect.lng}`}>
              <div className="map-panel-head">
                {result ? <button type="button" className="map-close" aria-label="Back to results" data-tip="Back to results" data-tip-side="bottom" onClick={() => setInspect(null)}><Icon d={ICONS.back} /></button> : null}
                <span className={`panel-icon tone-ochre${inspect.status === "loading" ? " is-busy" : ""}`}><Icon d={ICONS.inspect} size={20} /></span>
                <div className="panel-title">
                  <h2>{place[0]?.name ?? (inspect.status === "loading" ? "Looking closer" : "This area")}</h2>
                  <small>{place.length > 1 ? place.slice(1).map((p) => p.name).join(", ") : coordText(inspect.lat, inspect.lng)}</small>
                </div>
                {closeBtn(() => setInspect(null))}
              </div>
              <div className="map-panel-body">
                {inspect.status === "loading" ? (
                  <div className="inspect-loading" role="status" aria-label="Reading the ground">
                    <div>{Array.from({ length: 4 }, (_, i) => <i key={i} />)}</div>
                    {Array.from({ length: 5 }, (_, i) => <i key={i} style={{ opacity: 1 - i * 0.16 }} />)}
                  </div>
                ) : inspect.status === "error" ? (
                  <p className="map-muted">{inspect.error}</p>
                ) : !inspect.data?.known ? (
                  <p className="map-muted">Nothing is recorded here yet. Try a spot on land, or a little closer to a town.</p>
                ) : (
                  <div className="inspect">
                    {inspect.data.highlights.length ? (
                      <dl className="inspect-highlights">
                        {inspect.data.highlights.map((h, i) => (
                          <div key={i} className={`inspect-highlight tone-${["ochre", "moss", "sky", "clay"][i % 4]}`} title={h.about ?? undefined} style={{ animationDelay: `${40 + i * 50}ms` }}>
                            <dt>{h.title}</dt>
                            <dd>{h.detail ?? h.value}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                    {inspect.data.categories.map((cat, i) => <InspectGroup key={cat.name} name={cat.name} items={cat.items} index={i} startOpen={i === 0} />)}
                    <p className="inspect-foot">Figures describe the area around this point, roughly a few city blocks across.</p>
                  </div>
                )}
              </div>
            </section>
          ) : view === "detail" && current ? (
            <section className="map-panel" aria-label="Result">
              <div className="map-panel-head">
                <button type="button" className="map-close" aria-label="Back to results" data-tip="Back to results" data-tip-side="bottom" onClick={() => setSelected(null)}><Icon d={ICONS.back} /></button>
                <div className="panel-title">
                  <span className="map-eyebrow">{current.properties.kind === "area" ? "Area" : "Location"} {selected! + 1}</span>
                  <h2>{titleOf(current.properties)}</h2>
                  <small>{subtitleOf(current.properties)}</small>
                </div>
                {minimizeBtn}
                {closeBtn(dismiss, "Close results")}
              </div>
              <div className="map-panel-body">
                <div className="map-detail">
                  {current.properties.image_url ? <img src={current.properties.boxed_image_url || current.properties.image_url} alt={titleOf(current.properties)} loading="lazy" /> : null}
                  {current.properties.description ? <p>{String(current.properties.description)}</p> : null}
                  <dl>
                    {current.properties.feature_name ? <><dt>Type</dt><dd>{current.properties.kind === "area" ? "Area" : current.properties.feature_name}</dd></> : null}
                    {current.properties.neighborhood || current.properties.district ? <><dt>Where</dt><dd>{current.properties.neighborhood || current.properties.district}</dd></> : null}
                    {current.properties.date ? <><dt>Seen</dt><dd>{resultDate(current.properties.date)}</dd></> : null}
                    {typeof current.properties.distance === "number" && !(current.properties.facts ?? []).some((fact: any) => fact.title.startsWith("Distance")) ? <><dt>Distance</dt><dd>{current.properties.distance.toLocaleString()} m</dd></> : null}
                    {(current.properties.facts ?? []).map((x: any, i: number) => (
                      <div key={i} style={{ display: "contents" }}>
                        <dt>{x.title}</dt>
                        <dd>{x.detail || x.value}</dd>
                      </div>
                    ))}
                    <dt>Coordinates</dt>
                    <dd>{coordText(current.geometry!.coordinates[1], current.geometry!.coordinates[0])}</dd>
                  </dl>
                  {current.properties.insight ? <p>{String(current.properties.insight)}</p> : null}
                  <div className="map-actions" hidden={readOnly}>
                    <button type="button" className="map-link" onClick={() => runInspect(current.geometry!.coordinates[1], current.geometry!.coordinates[0])}><Icon d={ICONS.inspect} size={14} /> Inspect this area</button>
                    <button type="button" className="map-link" onClick={() => { const [lng, lat] = current.geometry!.coordinates; setStops((s) => ({ ...s, to: titleOf(current.properties) })); setPoints((p) => ({ ...p, to: { lat, lng, label: titleOf(current.properties) } })); setActiveStop("from"); openRoute(); }}><Icon d={ICONS.route} size={14} /> Route here</button>
                  </div>
                </div>
              </div>
            </section>
          ) : view === "results" && result ? (
            <section className="map-panel" aria-label="Results">
              <div className="map-panel-head">
                <div className="panel-title">
                  <h2>{result.data.query}</h2>
                  <small>{[counts.locations ? `${counts.locations} location${counts.locations === 1 ? "" : "s"}` : null, counts.areas ? `${counts.areas} area${counts.areas === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ") || "No matches"}</small>
                </div>
                {minimizeBtn}
                {closeBtn(dismiss, "Close results")}
              </div>
              <div className="map-panel-body">
                <MatchedTags region={result.data.region} tags={result.data.tags} className="is-map" />
                {result.data.answer ? <div className="answer">{result.data.answer}</div> : null}
                {features.map((f, i) => (
                  <button type="button" key={f.id ?? i} className="result" style={{ animationDelay: `${Math.min(i, 14) * 30}ms` }} onClick={() => setSelected(i)} title={titleOf(f.properties)}>
                    <span className={`result-thumb${f.properties.image_url ? "" : f.properties.kind === "area" ? " is-area" : " is-pin"}`} style={f.properties.image_url ? { backgroundImage: `url("${f.properties.image_url}")` } : undefined} />
                    <b className="result-num">{i + 1}</b>
                    <span style={{ minWidth: 0 }}>
                      <strong>{titleOf(f.properties)}</strong>
                      {f.properties.address && f.properties.address !== titleOf(f.properties) ? <small className="result-address">{f.properties.address}</small> : null}
                      <small>{subtitleOf(f.properties) || (f.properties.kind === "area" ? "Area" : f.properties.feature_name || "")}</small>
                      {f.properties.date ? <small>{resultDate(f.properties.date)}</small> : null}
                      {typeof f.properties.distance === "number" ? <small>Distance · {f.properties.distance.toLocaleString()} m</small> : null}
                    </span>
                  </button>
                ))}
                {!features.length && !result.data.answer ? <p className="map-muted">Nothing matched. Try a place or a physical feature.</p> : null}
                {upgradeUrl && features.length && !readOnly ? <UpgradeCard href={upgradeUrl} className="is-map" /> : null}
              </div>
            </section>
          ) : null}
        </div>
      </div>

      {/* Minimized results: a compass that brings them back. */}
      {result && !dockOpen ? (
        <button type="button" className="map-restore" aria-label="Show discover results" data-tip={`${features.length} results`} data-tip-side="right" onClick={() => setPanelOpen(true)}><Icon d={ICONS.compass} size={18} /></button>
      ) : null}

      {readOnly ? null : (
      <form className={`map-search${routeOpen ? " is-route" : ""}`} onSubmit={(e) => { e.preventDefault(); routeOpen ? runRoute() : run(query); }}>
        {atlas && brand && <a className="atlas-query-brand" href="/" aria-label="EDK home"><Wordmark height={15} /></a>}
        {routeOpen ? (
          <>
            <span className="map-chip is-route">
              <Icon d={ICONS.route} size={13} /> Route
              <button type="button" aria-label="Leave route" onClick={closeRoute}><Icon d={ICONS.close} size={11} /></button>
            </span>
            <PlaceInput value={stops.to} onText={(t) => setStopText("to", t)} onPick={(p) => pickStop("to", p)} token={mapboxToken} near={mapCentre} onFocus={() => setActiveStop("to")} placeholder={stops.from.trim() ? "Where to?" : "Where to? Set the start on the left"} ariaLabel="Destination" dropUp />
          </>
        ) : (
          <>
            <Icon d={ICONS.search} />
            {picks.length ? (
              <span className="map-chip">
                <Icon d={ICONS.hexagon} size={13} /> {picks.length} {picks.length === 1 ? "area" : "areas"}
                <button type="button" aria-label="Clear areas" onClick={() => setPicks([])}><Icon d={ICONS.close} size={11} /></button>
              </span>
            ) : null}
            <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={picks.length ? "Ask about these areas" : "Discover the world"} aria-label="Discover the world" maxLength={500} />
            {query ? null : <kbd className="map-kbd">/</kbd>}
          </>
        )}
        <button type="button" className={`map-route-btn${routeOpen ? " is-on" : ""}`} aria-label="Route" aria-pressed={routeOpen} data-tip={routeOpen ? "Back to Discover" : "Route from A to B"} data-tip-side="top" onClick={() => (routeOpen ? closeRoute() : (setPopover(null), openRoute()))}>
          <Icon d={ICONS.route} size={17} />
        </button>
        <button className="map-go" type="submit" disabled={routeOpen ? routeBusy || !routeReady : loading || !query.trim()} aria-label={routeOpen ? "Route" : "Discover"}>
          {(routeOpen ? routeBusy : loading) ? <span className="spinner" /> : <Icon d={ICONS.send} size={17} />}
        </button>
      </form>
      )}

      {atlas && view === "results" && features.length > 0 && !toolNote && !toast ? (
        <p className="atlas-result-tip map-tool-note" role="status">Tap a map pin to view details</p>
      ) : null}
      {toolNote ? <p className="map-tool-note" role="status">{toolNote}<span>Esc</span></p> : null}

      {balanceUnits !== null ? (
        <a className="map-balance" href="/console/billing" target="_top" aria-label="Compute balance and billing">
          <svg className="prompt-infinity" width="18" height="10" viewBox="0 0 36 20" fill="none" aria-hidden="true"><path pathLength="100" d="M18 10c-3.5-4.5-6-7-9.5-7a7 7 0 0 0 0 14c3.5 0 6-2.5 9.5-7s6-7 9.5-7a7 7 0 0 1 0 14c-3.5 0-6-2.5-9.5-7Z" /></svg>{formatCu(balanceUnits)} CU
        </a>
      ) : null}

      <div className="map-rail" ref={railRef}>
        {popover === "style" ? (
          <div className="map-pop map-styles" role="group" aria-label="Map style">
            {MAP_STYLE_ORDER.filter((id) => id !== "satellite" || hasSatellite()).map((id) => (
              <button key={id} type="button" aria-pressed={style === id} onClick={() => { setStyle(id); setPopover(null); }}>
                <Swatch id={id} />
                <span>{MAP_STYLES[id].label}</span>
              </button>
            ))}
          </div>
        ) : popover === "lens" ? (
          <div className="map-pop map-list" role="dialog" aria-label="Lens">
            <p>Lens <span>Things EDK-1 can find</span></p>
            <input autoFocus value={lensQuery} onChange={(e) => setLensQuery(e.target.value)} placeholder="Search lenses" aria-label="Search lenses" />
            <ul>
              {(lenses ?? []).map((l) => (
                <li key={l.id}><button type="button" onClick={() => pickLens(l)}><strong>{l.name}</strong>{l.description ? <small>{l.description}</small> : null}</button></li>
              ))}
              {lenses && !lenses.length ? <li className="is-empty">No lens by that name.</li> : null}
              {!lenses ? <li className="is-empty"><span className="spinner" /></li> : null}
            </ul>
          </div>
        ) : popover === "archive" ? (
          <div className="map-pop map-list" role="dialog" aria-label="Archive">
            <p>Archive <span>Kept in this browser</span></p>
            <ul>
              {archive.map((a) => (
                <li key={a.at}>
                  <button type="button" onClick={() => { setPopover(null); setQuery(a.query); setInspect(null); setRouteOpen(false); setSelected(null); setResult({ id: a.id, data: a.data }); setPanelOpen(true); if (resultPath && a.id) window.history.pushState(null, "", `${resultPath}/${a.id}`); }}>
                    <strong>{a.query}</strong>
                    <small>{a.count} result{a.count === 1 ? "" : "s"} · {new Date(a.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</small>
                  </button>
                </li>
              ))}
              {!archive.length ? <li className="is-empty">Your discoveries will be kept here.</li> : null}
            </ul>
            {archive.length ? <button type="button" className="map-list-clear" onClick={() => { writeArchive([]); setArchive([]); }}>Clear archive</button> : null}
          </div>
        ) : null}
        <nav className="map-tools" aria-label="Map tools">
          {readOnly ? null : railBtn("lens", "Lens", ICONS.lens, popover === "lens", () => setPopover(popover === "lens" ? null : "lens"))}
          {railBtn("style", "Map style", ICONS.layers, popover === "style", () => setPopover(popover === "style" ? null : "style"))}
          {readOnly ? null : railBtn("areas", tool === "areas" ? "Click the map to add an area" : "Select areas", ICONS.hand, tool === "areas", () => pickTool("areas"), picks.length)}
          {readOnly ? null : railBtn("inspect", tool === "inspect" ? "Click the map to inspect" : "Inspect", ICONS.inspect, tool === "inspect", () => pickTool("inspect"))}
          <i aria-hidden="true" />
          {readOnly ? null : railBtn("archive", "Archive", ICONS.bookmark, popover === "archive", () => setPopover(popover === "archive" ? null : "archive"), archive.length ? undefined : undefined)}
          <i aria-hidden="true" />
          {railBtn("in", "Zoom in", ICONS.plus, false, () => mapRef.current?.zoomIn())}
          {railBtn("out", "Zoom out", ICONS.minus, false, () => mapRef.current?.zoomOut())}
        </nav>
      </div>

      {toast ? <div className="map-toast" role="status">{toast}</div> : null}
    </div>
  );
}
