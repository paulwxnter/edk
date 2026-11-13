import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { Mark, Wordmark } from "~/components/brand";
import { DEFAULT_MAP_STYLE, GLYPH_SERVER, MAP_STYLES, MAP_STYLE_ORDER, buildMapStyle, glyphFont, hasSatellite, setMapboxToken, type MapStyleId } from "./mapStyles";

// EDK Atlas (edk.earth/atlas, embed.edk.earth for agents, Console → Atlas), adapted from the atlasx
// map: a Protomaps basemap, numbered pins for locations, hexagons for areas, a results panel, and
// click-to-inspect for the ground under any point.

type Feature = { type: "Feature"; id?: string; geometry: { type: string; coordinates: [number, number] } | null; properties: Record<string, any> };
export type ResultData = { query: string; answer?: string; geojson: { features: Feature[] }; areas?: { index: number; center: [number, number]; cells: string[]; label?: string }[] };
type Reading = { key: string; title: string; value: string; detail: string | null; about?: string | null };
type InspectData = { cell: string; ring: [number, number][]; center: [number, number]; known: boolean; place: { type: string; name: string }[]; highlights: Reading[]; categories: { name: string; items: Reading[] }[] };
type Inspect = { lat: number; lng: number; status: "loading" | "done" | "error"; data?: InspectData; error?: string };

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
  /** Fill the parent instead of the window (console). */
  contained?: boolean;
  /** Sent with each search, e.g. { source: "atlas" }. */
  extraBody?: Record<string, unknown>;
  /** Called after each successful search or inspection (the console refreshes the balance). */
  onResult?: () => void;
  /** Show the EDK brand chip (off in the console). */
  brand?: boolean;
};

const titleOf = (p: Record<string, any>) => p.address || p.name || p.feature_name || "Location";
const subtitleOf = (p: Record<string, any>) => [p.feature_name && p.feature_name !== titleOf(p) ? p.feature_name : null, p.neighborhood || p.district || p.area, p.date ? String(p.date).slice(0, 10) : null].filter(Boolean).join(" · ");
const HIDDEN = new Set(["image_url", "icon_url", "interactive", "kind", "h3", "area_index", "video_url", "video_id", "address", "name", "feature_name", "neighborhood", "district", "area", "date", "description", "region_address", "address_label"]);
const pretty = (k: string) => k.replace(/_/g, " ").replace(/\b(usd|pct|km|m)\b/g, (u) => u.toUpperCase());

const onEmbedHost = () => typeof window !== "undefined" && window.location.hostname.startsWith("embed.");
const defaultSearchUrl = () => (onEmbedHost() ? "/search" : "/atlas/api/search");
const defaultInspectUrl = () => (onEmbedHost() ? "/inspect" : "/atlas/api/inspect");

const EXAMPLES = ["bridges in Pittsburgh", "parks with playgrounds in Austin", "solar farms near Phoenix", "high income areas in Denver"];

export default function EmbedMap({ initialQuery = "", token = null, keyError = null, initialResult = null, mapboxToken = null, searchUrl, inspectUrl, contained = false, extraBody, onResult, brand = !contained }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const overlayRef = useRef<any>({ type: "FeatureCollection", features: [] });
  const inputRef = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(false);
  const [style, setStyle] = useState<MapStyleId>(DEFAULT_MAP_STYLE);
  const [query, setQuery] = useState(initialQuery || initialResult?.data.query || "");
  const [result, setResult] = useState<{ id: string | null; data: ResultData } | null>(initialResult);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<React.ReactNode>(keyError);
  const [selected, setSelected] = useState<number | null>(null);
  const [panelOpen, setPanelOpen] = useState(Boolean(initialResult));
  const [inspect, setInspect] = useState<Inspect | null>(null);
  const [hint, setHint] = useState(true);
  setMapboxToken(mapboxToken);

  const features = useMemo(() => (result?.data.geojson.features ?? []).filter((f) => f.geometry?.type === "Point" && Array.isArray(f.geometry.coordinates)), [result]);
  const counts = useMemo(() => {
    const areas = features.filter((f) => f.properties?.kind === "area").length;
    return { locations: features.length - areas, areas };
  }, [features]);

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
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
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

  // Hexagons: picked areas, area results and the inspected cell.
  const syncOverlay = useCallback(() => {
    const map = mapRef.current as any;
    if (!map) return;
    try {
      const source = map.getSource("edk-overlay");
      if (source) return source.setData(overlayRef.current);
      map.addSource("edk-overlay", { type: "geojson", data: overlayRef.current });
      map.addLayer({ id: "edk-overlay-fill", type: "fill", source: "edk-overlay", paint: { "fill-color": ["match", ["get", "kind"], "inspect", "#f1ebdf", "#e0a458"], "fill-opacity": ["match", ["get", "kind"], "pick", 0.12, "inspect", 0.35, 0.28] } });
      map.addLayer({ id: "edk-overlay-line", type: "line", source: "edk-overlay", paint: { "line-color": ["match", ["get", "kind"], "inspect", "#13110e", "#c4823a"], "line-width": ["match", ["get", "kind"], "pick", 2, "inspect", 2.4, 1.2] } });
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
    let cancelled = false;
    (async () => {
      const { cellToBoundary, cellsToMultiPolygon } = await import("h3-js");
      if (cancelled) return;
      const shapes: any[] = [];
      for (const a of result?.data.areas ?? []) {
        try { shapes.push({ type: "Feature", properties: { kind: "pick" }, geometry: { type: "MultiPolygon", coordinates: cellsToMultiPolygon(a.cells, true) } }); } catch { /* skip */ }
      }
      for (const f of result?.data.geojson.features ?? []) {
        if (f.properties?.kind === "area" && f.properties.h3) {
          try { shapes.push({ type: "Feature", properties: { kind: "result" }, geometry: { type: "Polygon", coordinates: [cellToBoundary(String(f.properties.h3), true)] } }); } catch { /* skip */ }
        }
      }
      if (inspect?.data?.ring?.length) shapes.push({ type: "Feature", properties: { kind: "inspect" }, geometry: { type: "Polygon", coordinates: [[...inspect.data.ring, inspect.data.ring[0]]] } });
      overlayRef.current = { type: "FeatureCollection", features: shapes };
      syncOverlay();
    })();
    return () => {
      cancelled = true;
    };
  }, [result, inspect, ready, syncOverlay]);

  const padding = useCallback(() => {
    const desktop = window.innerWidth > 900;
    return desktop ? { top: 90, bottom: 60, left: 420, right: 60 } : { top: 80, bottom: window.innerHeight * 0.5, left: 40, right: 40 };
  }, []);

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
          setInspect(null);
          setPanelOpen(true);
          setSelected(i);
        });
        return new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat(f.geometry!.coordinates).addTo(map);
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
      setHint(false);
      setSelected(null);
      setPanelOpen(true);
      setInspect({ lat, lng, status: "loading" });
      const map = mapRef.current;
      if (map) map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 12.5), padding: padding(), duration: 1600, essential: true });
      try {
        const res = await fetch(inspectUrl ?? defaultInspectUrl(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lat, lng, token }) });
        const body = (await res.json().catch(() => null)) as any;
        if (!res.ok || !body?.data) throw new Error(body?.error || "This area is unavailable right now.");
        setInspect({ lat, lng, status: "done", data: body.data });
        onResult?.();
      } catch (error) {
        setInspect({ lat, lng, status: "error", error: error instanceof Error ? error.message : "This area is unavailable right now." });
      }
    },
    [inspectUrl, token, onResult, padding],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const onClick = (e: any) => runInspect(e.lngLat.lat, e.lngLat.lng);
    map.on("click", onClick);
    map.getCanvas().style.cursor = "crosshair";
    return () => {
      map.off("click", onClick);
    };
  }, [ready, runInspect]);

  // ---- Search -------------------------------------------------------------
  const run = useCallback(
    async (q: string) => {
      const text = q.trim();
      if (!text || loading) return;
      setLoading(true);
      setToast(null);
      setSelected(null);
      setInspect(null);
      setHint(false);
      try {
        const res = await fetch(searchUrl ?? defaultSearchUrl(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: text, token, limit: 20, ...extraBody }) });
        const body = (await res.json().catch(() => null)) as any;
        if (!res.ok || !body?.data) {
          setToast(res.status === 429 ? <>{body?.error} <a href="https://edk.earth/sign-up" target="_blank" rel="noreferrer">Sign up</a></> : body?.error || "Search is unavailable right now.");
          return;
        }
        setResult({ id: body.id, data: body.data });
        setPanelOpen(true);
        onResult?.();
        window.parent?.postMessage({ type: "edk:result", id: body.id, embed_url: body.embed_url, count: body.data.geojson.features.length }, "*");
      } catch {
        setToast("Search is unavailable right now.");
      } finally {
        setLoading(false);
      }
    },
    [loading, token, searchUrl, extraBody, onResult],
  );

  const ranInitial = useRef(false);
  useEffect(() => {
    if (!ready || ranInitial.current) return;
    ranInitial.current = true;
    if (initialResult) fitAll();
    else if (initialQuery && !keyError) run(initialQuery);
  }, [ready, initialQuery, initialResult, keyError, run, fitAll]);

  // Pages embedding the Atlas can drive it: postMessage({type: "edk:search", query}) or {type: "edk:show", data}.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const m = e.data;
      if (!m || typeof m !== "object") return;
      if (m.type === "edk:search" && typeof m.query === "string") {
        setQuery(m.query);
        run(m.query);
      }
      if (m.type === "edk:show" && m.data?.geojson) {
        setResult({ id: m.id ?? null, data: m.data });
        setPanelOpen(true);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [run]);

  // "/" focuses search; Escape steps back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName ?? "");
      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape") {
        if (inspect) setInspect(null);
        else if (selected !== null) setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inspect, selected]);

  const current = selected !== null ? features[selected] : null;
  const showPanel = panelOpen && (result || inspect);
  const place = inspect?.data?.place ?? [];

  return (
    <div className={`map-app${contained ? " is-contained" : ""}`}>
      <div ref={containerRef} className="map-canvas" />
      <div className="map-top">
        {brand ? (
          <a className="map-brand" href="https://edk.earth" target="_top" title="EDK: Compass for Machines">
            <Mark size={24} /> <Wordmark height={17} /> <span className="map-brand-label">Atlas</span>
          </a>
        ) : null}
        <form className="map-search" onSubmit={(e) => { e.preventDefault(); run(query); }}>
          <svg className="map-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" /></svg>
          <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Discover the world" aria-label="Discover the world" title="Ask about places, features or areas, like “bridges in Pittsburgh”" maxLength={500} list="edk-atlas-examples" />
          <datalist id="edk-atlas-examples">{EXAMPLES.map((ex) => <option key={ex} value={ex} />)}</datalist>
          {query ? null : <kbd className="map-kbd" title="Press / to search">/</kbd>}
          <button className="map-go" type="submit" disabled={loading || !query.trim()} aria-label="Search" title="Search">
            {loading ? <span className="spinner" /> : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>}
          </button>
        </form>
      </div>

      {showPanel ? (
        <aside className="map-panel" aria-label={inspect ? "Area details" : "Results"}>
          <div className="map-panel-head">
            {current || (inspect && result) ? (
              <button type="button" className="map-close" aria-label="Back to results" title="Back to results" onClick={() => { setSelected(null); setInspect(null); }}>←</button>
            ) : null}
            <div style={{ flex: 1, minWidth: 0 }}>
              {inspect ? (
                <>
                  <span className="map-eyebrow">Inspect</span>
                  <h2>{place[0]?.name ?? "This area"}</h2>
                  <small>{place.length > 1 ? place.slice(1).map((p) => p.name).join(" · ") : `${inspect.lat.toFixed(4)}, ${inspect.lng.toFixed(4)}`}</small>
                </>
              ) : current ? (
                <>
                  <span className="map-eyebrow">{current.properties.kind === "area" ? "Area" : "Location"} {selected! + 1}</span>
                  <h2>{titleOf(current.properties)}</h2>
                  <small>{subtitleOf(current.properties)}</small>
                </>
              ) : (
                <>
                  <h2>{result!.data.query}</h2>
                  <small>{[counts.locations ? `${counts.locations} location${counts.locations === 1 ? "" : "s"}` : null, counts.areas ? `${counts.areas} area${counts.areas === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ") || "No matches"}</small>
                </>
              )}
            </div>
            <button type="button" className="map-close" aria-label="Close" title="Close" onClick={() => { setPanelOpen(false); setInspect(null); }}>✕</button>
          </div>
          <div className="map-panel-body">
            {inspect ? (
              inspect.status === "loading" ? (
                <p className="map-muted"><span className="spinner" /> Reading the ground…</p>
              ) : inspect.status === "error" ? (
                <p className="map-muted">{inspect.error}</p>
              ) : !inspect.data?.known ? (
                <p className="map-muted">Nothing is known about this spot yet. Try a populated area.</p>
              ) : (
                <div className="inspect">
                  {inspect.data.highlights.length ? (
                    <div className="inspect-highlights">
                      {inspect.data.highlights.map((h) => (
                        <div key={h.key} className="inspect-highlight" title={h.about ?? undefined}>
                          <small>{h.title}</small>
                          <strong>{h.value}</strong>
                          {h.detail ? <span>{h.detail}</span> : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {inspect.data.categories.map((cat, i) => (
                    <details key={cat.name} className="inspect-cat" open={i < 2}>
                      <summary>{cat.name}<span>{cat.items.length}</span></summary>
                      <dl>
                        {cat.items.map((it) => (
                          <div key={it.key} title={it.about ?? undefined}>
                            <dt>{it.title}</dt>
                            <dd>{it.value}{it.detail ? <small> {it.detail}</small> : null}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  ))}
                </div>
              )
            ) : current ? (
              <div className="map-detail">
                {current.properties.image_url ? <img src={current.properties.image_url} alt={titleOf(current.properties)} loading="lazy" /> : null}
                {current.properties.description ? <p>{String(current.properties.description)}</p> : null}
                <dl>
                  {Object.entries(current.properties)
                    .filter(([k, v]) => !HIDDEN.has(k) && v !== null && v !== "" && typeof v !== "object")
                    .slice(0, 18)
                    .map(([k, v]) => (
                      <div key={k} style={{ display: "contents" }}>
                        <dt>{pretty(k)}</dt>
                        <dd>{typeof v === "number" ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(v)}</dd>
                      </div>
                    ))}
                  <dt>coordinates</dt>
                  <dd>{current.geometry!.coordinates[1].toFixed(5)}, {current.geometry!.coordinates[0].toFixed(5)}</dd>
                </dl>
                <button type="button" className="map-link" onClick={() => runInspect(current.geometry!.coordinates[1], current.geometry!.coordinates[0])}>Inspect this area →</button>
              </div>
            ) : (
              <>
                {result!.data.answer ? <div className="answer">{result!.data.answer}</div> : null}
                {features.map((f, i) => (
                  <button type="button" key={f.id ?? i} className={`result${selected === i ? " is-selected" : ""}`} onClick={() => setSelected(i)} title={titleOf(f.properties)}>
                    <span className={`result-thumb${f.properties.image_url ? "" : f.properties.kind === "area" ? " is-area" : " is-pin"}`} style={f.properties.image_url ? { backgroundImage: `url("${f.properties.image_url}")` } : undefined} />
                    <span style={{ minWidth: 0 }}>
                      <strong>{i + 1}. {titleOf(f.properties)}</strong>
                      <small>{subtitleOf(f.properties) || (f.properties.kind === "area" ? "Area" : f.properties.feature_name || "")}</small>
                    </span>
                  </button>
                ))}
                {!features.length && !result!.data.answer ? <p className="map-muted">Nothing matched. Try a place or a physical feature.</p> : null}
              </>
            )}
          </div>
        </aside>
      ) : result && !panelOpen ? (
        <button type="button" className="map-pill" onClick={() => setPanelOpen(true)}>{features.length} results</button>
      ) : null}

      <div className="map-styles" role="group" aria-label="Map style">
        {MAP_STYLE_ORDER.filter((id) => id !== "satellite" || hasSatellite()).map((id) => (
          <button key={id} type="button" className={style === id ? "active" : ""} onClick={() => setStyle(id)} title={`${MAP_STYLES[id].label} map`}>{MAP_STYLES[id].label}</button>
        ))}
      </div>
      {toast ? (
        <div className="map-toast" role="status">{toast}</div>
      ) : hint && !result ? (
        <div className="map-hint" role="note">
          <span>Search above, or click anywhere to inspect the ground.</span>
          <button type="button" aria-label="Dismiss" title="Dismiss" onClick={() => setHint(false)}>✕</button>
        </div>
      ) : null}
    </div>
  );
}
