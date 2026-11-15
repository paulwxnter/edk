import { useEffect, useRef, useState } from "react";
import { Link, redirect, useNavigate, useRevalidator, useSearchParams } from "react-router";
import type { Route } from "./+types/playground";
import FieldArt, { type Field } from "~/ascii/FieldArt";
import { CodeBlock } from "~/components/copy";
import { API, PACKAGES } from "~/lib/agents";
import { formatCu, unitsToCu } from "~/lib/pricing";
import { DEFAULT_REASONING, REASONING, TIERS, nextTier, reasoningAllowed, tierForReasoning, type ReasoningId } from "~/lib/tiers";
import UpgradeCard from "~/components/UpgradeCard";
import MatchedTags from "~/components/MatchedTags";
import PlaceInput, { type Place } from "~/map/PlaceInput";
import EmbedMap from "~/map/EmbedMap";
import { getSessionUser } from "../../../server/auth";
import { publicStoredDiscover } from "../../../server/shape";
import { getResult, listResults, spendable, usageForResult } from "../../../server/store";

export const meta = ({ data }: Route.MetaArgs) => [{ title: `${data?.result ? `${data.result.query} · ` : ""}Playground · EDK Console` }];

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const mapboxToken = [process.env.MAPBOX_API_KEY, process.env.NEXT_PUBLIC_MAPBOX_TOKEN].find((token) => token?.startsWith("pk.")) ?? null;
  const db = context.cloudflare.env.DB;
  const user = await getSessionUser(db, request);
  if (!user) return { maxResults: TIERS[0].maxResults, tier: TIERS[0].id, mapboxToken, result: null, recent: [] };
  const a = await spendable(db, user.id);
  // /console/discover/:id opens a result this account made before, so a refresh or a saved link comes back to it.
  let result = null;
  if (params.id) {
    const row = await getResult(db, params.id);
    if (!row || row.user_id !== user.id) throw redirect("/console");
    const used = await usageForResult(db, user.id, row.id);
    result = {
      id: row.id, query: row.query, created_at: row.created_at,
      embed_url: `${(process.env.EMBED_URL || "https://embed.edk.earth").replace(/\/+$/, "")}/r/${row.id}`,
      usage: used ? { locations: used.locations, areas: used.areas, units: used.units } : null,
      data: publicStoredDiscover(row.payload),
    };
  }
  return { maxResults: Math.min(a.tier.maxResults, a.settings.max_results ?? Infinity), tier: a.tier.id, mapboxToken, result, recent: await listResults(db, user.id) };
}

const EXAMPLES = ["Bridges in Pittsburgh", "High income areas in Denver", "Solar farms near Phoenix"];
const SPOTS: [string, string, string][] = [["Downtown Pittsburgh", "40.4406", "-79.9959"], ["Austin, TX", "30.2672", "-97.7431"], ["Golden Gate Park", "37.7694", "-122.4862"]];
const ROUTES: [string, string, string, string][] = [["Pittsburgh, around potholes", "Point State Park, Pittsburgh", "Carnegie Mellon University, Pittsburgh", "avoid pothole streets"], ["Austin, direct", "Texas State Capitol, Austin", "Zilker Park, Austin", ""]];

type Tab = "discover" | "inspect" | "route";
const TABS: { id: Tab; label: string; title: string; lead: string; art: Field }[] = [
  { id: "discover", label: "Discover", title: "What are you looking for?", lead: "Places and areas, asked in plain language.", art: "contours" },
  { id: "inspect", label: "Inspect", title: "What is at this spot?", lead: "Everything known about one point.", art: "rings" },
  { id: "route", label: "Route", title: "Where are you headed?", lead: "From A to B, around what you avoid.", art: "paths" },
];

const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const mins = (s: number) => `${Math.max(1, Math.round(s / 60))} min`;
const num = (v: string) => (v.trim() === "" ? null : Number(v));
const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
const dateFormat = new Intl.DateTimeFormat("en-US", { month: "long", day: "2-digit", year: "numeric", timeZone: "UTC" });
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
function dateLabel(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  if (/^\d{4}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? dateFormat.format(date) : value;
}

// The Discover options last used, so they carry from the query box to the result page and on to the next search.
const kept: { limit: number | null; reasoning: ReasoningId; answer: boolean } = { limit: null, reasoning: DEFAULT_REASONING, answer: false };

const nameOf = (p: Record<string, any>) => p.name || p.address || p.feature_name || "Result";
const placeOf = (p: Record<string, any>) => [p.kind === "area" ? "Area" : p.feature_name, p.neighborhood || p.district].filter(Boolean).join(" · ");
const imageOf = (p: Record<string, any>) => p.boxed_image_url || p.image_url || null;
function pointOf(feature: any): { lat: number; lng: number } | null {
  const c = feature?.geometry?.type === "Point" ? feature.geometry.coordinates : null;
  return Array.isArray(c) && c.every(Number.isFinite) ? { lat: c[1], lng: c[0] } : null;
}

function ResultDetails({ properties }: { properties: Record<string, any> }) {
  return (
    <span className="pg-result-text">
      <strong>{nameOf(properties)}</strong>
      {properties.name && properties.address && properties.address !== properties.name ? <small>{properties.address}</small> : null}
      <small>{placeOf(properties)}</small>
      {properties.date ? <small>{dateLabel(properties.date)}</small> : null}
      {properties.facts?.map((fact: any, index: number) => <small key={index}>{fact.title}{fact.detail || fact.value ? ` · ${fact.detail || fact.value}` : ""}</small>)}
      {typeof properties.distance === "number" && !properties.facts?.some((fact: any) => fact.title.startsWith("Distance")) ? <small>{properties.distance.toLocaleString()} m away</small> : null}
      {properties.insight ? <small>{properties.insight}</small> : null}
    </span>
  );
}

/** One result in the mosaic: its picture edge to edge, its name on hover. Every fifth tile runs wide. */
function Tile({ feature, index, wide, onOpen }: { feature: any; index: number; wide: boolean; onOpen: () => void }) {
  const p = feature.properties ?? {};
  const [broken, setBroken] = useState(false);
  const image = broken ? null : imageOf(p);
  return (
    <button type="button" className={`pg-tile${wide ? " is-wide" : ""}${image ? "" : " is-blank"}`} style={{ "--i": Math.min(index, 16) } as React.CSSProperties} onClick={onOpen} aria-label={`Open ${nameOf(p)}`}>
      {image ? <img src={image} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} /> : null}
      <span className="pg-tile-num">{String(index + 1).padStart(2, "0")}</span>
      {p.kind === "area" ? <span className="pg-tile-kind">Area</span> : p.boxed_image_url ? <span className="pg-tile-kind">Boxed</span> : null}
      <span className="pg-tile-cap">
        <strong>{nameOf(p)}</strong>
        <small>{placeOf(p) || (p.address !== nameOf(p) ? p.address : "")}</small>
      </span>
    </button>
  );
}

/** A result opened from the mosaic or the list: the full picture, everything known, and where to go next. */
function ResultDialog({ features, index, onIndex }: { features: any[]; index: number | null; onIndex: (i: number | null) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const feature = index === null ? null : features[index];
  useEffect(() => {
    if (feature && !dialog.current?.open) dialog.current?.showModal();
    if (!feature && dialog.current?.open) dialog.current.close();
  }, [feature]);
  const p = feature?.properties ?? {};
  const point = pointOf(feature);
  const image = imageOf(p);
  const step = (by: number) => index !== null && onIndex((index + by + features.length) % features.length);
  return (
    <dialog ref={dialog} className="pg-image-dialog pg-result-dialog" aria-label={feature ? nameOf(p) : "Result"} onClose={() => onIndex(null)} onClick={(e) => { if (e.target === dialog.current) onIndex(null); }} onKeyDown={(e) => { if (e.key === "ArrowRight") step(1); if (e.key === "ArrowLeft") step(-1); }}>
      {feature ? <>
        <header>
          <h2><span className="mono faint">{String(index! + 1).padStart(2, "0")}</span> {nameOf(p)}</h2>
          <div className="row">
            {features.length > 1 ? <>
              <button className="btn btn-sm" type="button" onClick={() => step(-1)} aria-label="Previous result">←</button>
              <button className="btn btn-sm" type="button" onClick={() => step(1)} aria-label="Next result">→</button>
            </> : null}
            <button className="btn btn-sm" type="button" onClick={() => onIndex(null)}>Close</button>
          </div>
        </header>
        {image ? <img key={image} src={image} alt={nameOf(p)} /> : null}
        <ResultDetails properties={p} />
        {point ? (
          <div className="row pg-dialog-foot">
            <span className="mono faint">{point.lat.toFixed(5)}, {point.lng.toFixed(5)}</span>
            <Link className="btn btn-sm" to={`/console?tab=inspect&lat=${point.lat}&lng=${point.lng}`}>Inspect this spot</Link>
          </div>
        ) : null}
      </> : null}
    </dialog>
  );
}

/** Request samples and the JSON response, one at a time. */
function CodeView({ samples, response }: { samples: [string, string][]; response?: unknown }) {
  const tabs: [string, string][] = response === undefined ? samples : [...samples, ["Response", JSON.stringify(response, null, 2)]];
  const [active, setActive] = useState(0);
  const [label, code] = tabs[Math.min(active, tabs.length - 1)];
  return (
    <div className="pg-code">
      <div className="seg" role="tablist" aria-label="Code sample">
        {tabs.map(([name], i) => <button key={name} type="button" role="tab" aria-selected={name === label} className={name === label ? "is-on" : ""} onClick={() => setActive(i)}>{name}</button>)}
      </div>
      <CodeBlock code={code} label={label} />
    </div>
  );
}

export default function Playground(props: Route.ComponentProps) {
  // A stored result is its own page: the form starts over from that result's query.
  return <PlaygroundView key={props.loaderData.result?.id ?? "new"} loaderData={props.loaderData} />;
}

function PlaygroundView({ loaderData }: Pick<Route.ComponentProps, "loaderData">) {
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const stored = loaderData.result;
  const asked = params.get("tab");
  const tab: Tab = stored ? "discover" : asked === "inspect" || asked === "route" ? asked : "discover";
  const current = TABS.find((t) => t.id === tab)!;
  const tier = TIERS.find((t) => t.id === loaderData.tier) ?? TIERS[0];
  // Discover
  const [query, setQuery] = useState(stored?.query ?? "");
  const [limit, setLimit] = useState(Math.min(kept.limit ?? 10, loaderData.maxResults));
  const [answer, setAnswer] = useState(kept.answer);
  const [reasoning, setReasoning] = useState<ReasoningId>(reasoningAllowed(tier, kept.reasoning) ? kept.reasoning : DEFAULT_REASONING);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const [near, setNear] = useState("");
  const [focus, setFocus] = useState("");
  const [view, setView] = useState<"grid" | "list" | "code">("grid");
  const [opened, setOpened] = useState<number | null>(null);
  // Inspect
  const [lat, setLat] = useState(params.get("lat") ?? SPOTS[0][1]);
  const [lng, setLng] = useState(params.get("lng") ?? SPOTS[0][2]);
  // Route
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [fromPlace, setFromPlace] = useState<Place | null>(null);
  const [toPlace, setToPlace] = useState<Place | null>(null);
  const [conditions, setConditions] = useState("");
  const [include, setInclude] = useState("");
  const [profile, setProfile] = useState("driving");
  const [showStops, setShowStops] = useState(false);
  const [showAvoid, setShowAvoid] = useState(false);
  const routeReady = Boolean(from.trim() && to.trim());
  // Output
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<{ tab: Tab; body: any; ms: number } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menu]);

  const clampLimit = (n: number) => Math.max(1, Math.min(loaderData.maxResults, Math.round(n) || 1));
  const level = REASONING.find((r) => r.id === reasoning)!;

  /** Optional "areas" points: one "lat, lng" per line, up to four (sent as [lng, lat]). */
  const areas = near
    .split(/\n|;/)
    .map((line) => line.split(",").map((s) => Number(s.trim())))
    .filter((p) => p.length === 2 && p.every(Number.isFinite))
    .slice(0, 4)
    .map(([la, ln]) => [ln, la] as [number, number]);

  const discoverBody = (q: string) => ({ query: q.trim(), limit, ...(reasoning !== DEFAULT_REASONING ? { reasoning } : {}), ...(answer ? { answer: true } : {}), ...(areas.length ? { areas } : {}), ...(focus.trim() ? { focus: focus.trim() } : {}) });
  const routeBody = {
    from: fromPlace ?? from.trim(),
    to: toPlace ?? to.trim(),
    ...(include.trim() ? { include: include.trim() } : {}),
    ...(profile === "driving" && conditions.trim() ? { conditions: conditions.trim() } : {}),
    ...(profile !== "driving" ? { profile } : {}),
  };
  const ready = tab === "discover" ? Boolean(query.trim()) : tab === "route" ? routeReady : num(lat) !== null && num(lng) !== null;

  async function run(e?: React.FormEvent, text = query) {
    e?.preventDefault();
    if (busy || (tab === "discover" ? !text.trim() : !ready)) return;
    setBusy(true);
    setError(null);
    const started = performance.now();
    const post = (path: string, body: unknown) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    try {
      const r =
        tab === "discover"
          ? await post("/console/api/discover", { ...discoverBody(text), source: "playground" })
          : tab === "route"
            ? await post("/console/api/route", { ...routeBody, source: "playground" })
            : await post("/console/api/inspect", { lat: num(lat), lng: num(lng), source: "playground" });
      const body = (await r.json()) as any;
      if (!r.ok) throw new Error(body?.error || `Request failed (${r.status})`);
      if (tab === "discover" && body?.id) {
        // The result is stored: its own URL shows it from here on.
        Object.assign(kept, { limit, reasoning, answer });
        navigate(`/console/discover/${body.id}`);
        return;
      }
      setRes({ tab, body, ms: Math.round(performance.now() - started) });
      setBusy(false);
      revalidator.revalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
      setBusy(false);
    }
  }

  const auth = `-H "Authorization: Bearer $EDK_API_KEY"`;
  const sdk = `import { EDK } from "${PACKAGES.sdk}";\n\nconst edk = new EDK(); // reads EDK_API_KEY\n`;
  const body = discoverBody(query || EXAMPLES[0]);
  const { query: bodyQuery, ...discoverOptions } = body;
  const samples: [string, string][] =
    tab === "discover"
      ? [
          ["curl", `curl -X POST ${API}/v1/discover \\\n  ${auth} \\\n  -H "content-type: application/json" \\\n  -d '${JSON.stringify(body)}'`],
          ["TypeScript", `${sdk}const { data, embed_url } = await edk.discover(${JSON.stringify(bodyQuery)}, ${JSON.stringify(discoverOptions).replace(/"(\w+)":/g, " $1: ").replace(/}$/, " }")});`],
          ["CLI", `edk discover ${JSON.stringify(bodyQuery)} --limit ${limit}`],
          ...(stored ? [["Stored result", `curl ${API}/v1/discover/${stored.id} \\\n  ${auth}`] as [string, string]] : []),
        ]
      : tab === "route"
        ? [
            ["curl", `curl -X POST ${API}/v1/route \\\n  ${auth} \\\n  -H "content-type: application/json" \\\n  -d '${JSON.stringify(routeBody)}'`],
            ["TypeScript", `${sdk}const { data } = await edk.route(${JSON.stringify(routeBody, null, 2)});`],
          ]
        : [
            ["curl", `curl "${API}/v1/inspect?lat=${lat}&lng=${lng}" \\\n  ${auth}`],
            ["TypeScript", `${sdk}const { data } = await edk.inspect({ lat: ${num(lat) ?? 0}, lng: ${num(lng) ?? 0} });`],
            ["CLI", `edk inspect ${lat},${lng}`],
          ];

  const features: any[] = stored?.data.geojson.features ?? [];
  // The Atlas map pins only the point results, so its pin numbers map back through this.
  const pinned = features.flatMap((f, i) => (pointOf(f) ? [i] : []));
  const storedBody = stored ? { id: stored.id, model: "edk-1", embed_url: stored.embed_url, ...(stored.usage ? { usage: { locations: stored.usage.locations, areas: stored.usage.areas, cu: unitsToCu(stored.usage.units) } } : {}), data: stored.data } : null;
  const live = res?.tab === tab ? res : null;
  const inspected = live?.tab === "inspect" ? live.body?.data : null;
  const routed = live?.tab === "route" ? live.body?.data : null;
  const compact = Boolean(stored || live || busy);

  return (
    <div className="console-page pg-page">
      <section className={`pg-hero art-host${compact ? " is-compact" : ""}`}>
        {compact ? null : <div className="pg-art" aria-hidden="true"><FieldArt field={current.art} /></div>}
        <div className="pg-hero-inner">
          <nav className="tabs" aria-label="Playground calls">
            {TABS.map((t) => <Link key={t.id} to={t.id === "discover" ? "/console" : `/console?tab=${t.id}`} className={tab === t.id ? "active" : ""} aria-current={tab === t.id ? "page" : undefined}>{t.label}</Link>)}
          </nav>
          <h1>{current.title}</h1>
          {compact ? null : <p className="pg-lead">{current.lead}</p>}

          {tab === "discover" ? (
            <div className="prompt-wrap pg-prompt">
              <form className="prompt" onSubmit={run}>
                <textarea
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) run(e); }}
                  placeholder="Ask EDK-1 about any place…"
                  aria-label="Query"
                  rows={2}
                  maxLength={500}
                  autoFocus={!stored}
                />
                <div className="prompt-bar">
                  <span className="prompt-model"><svg className="prompt-infinity" width="18" height="10" viewBox="0 0 36 20" fill="none" aria-hidden="true"><path pathLength="100" d="M18 10c-3.5-4.5-6-7-9.5-7a7 7 0 0 0 0 14c3.5 0 6-2.5 9.5-7s6-7 9.5-7a7 7 0 0 1 0 14c-3.5 0-6-2.5-9.5-7Z" /></svg>EDK-1</span>
                  <div className="pg-limit" title={`Most results, 1 to ${loaderData.maxResults} on your tier`}>
                    <label htmlFor="pg-limit">Limit</label>
                    <button type="button" onClick={() => setLimit(clampLimit(limit - 1))} disabled={limit <= 1} aria-label="Fewer results">−</button>
                    <input id="pg-limit" type="number" min={1} max={loaderData.maxResults} value={limit} onChange={(e) => setLimit(clampLimit(Number(e.target.value)))} />
                    <button type="button" onClick={() => setLimit(clampLimit(limit + 1))} disabled={limit >= loaderData.maxResults} aria-label="More results">+</button>
                  </div>
                  <button type="button" className={`prompt-reasoning-btn pg-toggle${answer ? " is-on" : ""}`} aria-pressed={answer} onClick={() => setAnswer(!answer)} title="Add a written answer to the results">Answer</button>
                  <div className="prompt-reasoning" ref={menuRef}>
                    <button type="button" className="prompt-reasoning-btn" aria-haspopup="listbox" aria-expanded={menu} aria-label={`Reasoning: ${level.name}`} onClick={() => setMenu((v) => !v)}>
                      {level.name}
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                    </button>
                    {menu ? (
                      <ul className="prompt-reasoning-menu" role="listbox" aria-label="Reasoning">
                        {REASONING.map((r) => {
                          const allowed = reasoningAllowed(tier, r.id);
                          return (
                            <li key={r.id} role="option" aria-selected={r.id === reasoning} aria-disabled={!allowed}>
                              <button type="button" disabled={!allowed} onClick={() => { setReasoning(r.id); setMenu(false); }}>
                                <strong>{r.name}</strong>
                                <small>{allowed ? r.does : `Starts at ${tierForReasoning(r.id).name}.`}</small>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </div>
                  <button className="prompt-send" type="submit" disabled={busy || !query.trim()} aria-label="Discover">
                    {busy ? <span className="spinner" /> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" /></svg>}
                    <span className="pg-send-label">Discover</span>
                  </button>
                </div>
              </form>
              {more ? (
                <div className="options pg-more">
                  <label className="field">
                    <span>areas</span>
                    <textarea className="textarea" rows={2} value={near} onChange={(e) => setNear(e.target.value)} placeholder={"40.4406, -79.9959\n40.4520, -80.0100"} />
                    <small>Up to four points to search around, one "lat, lng" per line.</small>
                  </label>
                  <label className="field">
                    <span>focus</span>
                    <input className="input" value={focus} onChange={(e) => setFocus(e.target.value.replace(/[^\d]/g, ""))} placeholder="Region id" />
                    <small>A region to search in when the query names no place.</small>
                  </label>
                </div>
              ) : null}
              <div className="prompt-examples pg-examples">
                {compact ? null : EXAMPLES.map((ex) => <button key={ex} type="button" className="chip" disabled={busy} onClick={() => { setQuery(ex); run(undefined, ex); }}>{ex}</button>)}
                <button type="button" className={`chip${more ? " is-on" : ""}`} aria-expanded={more} onClick={() => setMore(!more)}>{more ? "−" : "+"} areas, focus</button>
              </div>
            </div>
          ) : tab === "route" ? (
            <div className="pg-route pg-card">
              <form className="panel pg-form" onSubmit={run}>
                <div className="pg-route-stops">
                  <div className="pg-route-stop"><span className="pg-route-marker" aria-hidden="true" /><span>From</span><PlaceInput value={from} onText={(value) => { setFrom(value); setFromPlace(null); }} onPick={(place) => { setFrom(place.label); setFromPlace(place); }} token={loaderData.mapboxToken} placeholder="Starting point" ariaLabel="From" sessionSearch /></div>
                  <div className="pg-route-stop"><span className="pg-route-marker" aria-hidden="true" /><span>To</span><PlaceInput value={to} onText={(value) => { setTo(value); setToPlace(null); }} onPick={(place) => { setTo(place.label); setToPlace(place); }} token={loaderData.mapboxToken} near={() => fromPlace ? [fromPlace.lng, fromPlace.lat] : null} placeholder="Destination" ariaLabel="To" sessionSearch /></div>
                </div>
                <div className="row pg-route-examples">
                  {ROUTES.map(([name, a, b, c]) => <button key={name} type="button" className="chip" onClick={() => { setFrom(a); setTo(b); setFromPlace(null); setToPlace(null); setProfile("driving"); setInclude(""); setConditions(c); setShowStops(false); setShowAvoid(Boolean(c)); }}>{name}</button>)}
                </div>
                {routeReady ? <>
                  <fieldset className="route-profile">
                    <legend>Travel profile</legend>
                    <div className="route-modes">
                      {[["driving", "Drive"], ["walking", "Walk"], ["cycling", "Cycle"]].map(([value, label]) => (
                        <label key={value}><input type="radio" name="route-profile" value={value} checked={profile === value} onChange={() => setProfile(value)} /><span>{label}</span></label>
                      ))}
                    </div>
                  </fieldset>
                  <div className="pg-route-choices">
                    <section>
                      <button type="button" className="route-options-toggle" aria-expanded={showStops} onClick={() => setShowStops(!showStops)}><strong>Stops</strong><span aria-hidden="true">{showStops ? "−" : "+"}</span></button>
                      {showStops ? <label className="field"><span>Pass along the way</span><input className="input" value={include} onChange={(e) => setInclude(e.target.value)} placeholder="Coffee shops or scenic overlooks" maxLength={300} /></label> : null}
                    </section>
                    {profile === "driving" ? <section>
                      <button type="button" className="route-options-toggle" aria-expanded={showAvoid} onClick={() => setShowAvoid(!showAvoid)}><strong>Avoid</strong><span aria-hidden="true">{showAvoid ? "−" : "+"}</span></button>
                      {showAvoid ? <label className="field"><span>Steer clear of</span><input className="input" value={conditions} onChange={(e) => setConditions(e.target.value)} placeholder="Streets with potholes" maxLength={300} /></label> : null}
                    </section> : null}
                  </div>
                </> : null}
                <div className="pg-bar">
                  <button className="btn btn-primary btn-lg" type="submit" disabled={busy || !ready} style={{ marginLeft: "auto" }}>{busy ? <><span className="spinner" /> Running</> : "Find route"}</button>
                </div>
              </form>
            </div>
          ) : (
            <div className="pg-card">
              <form className="panel pg-form" onSubmit={run}>
                <div className="grid-2">
                  <label className="field"><span>lat</span><input className="input" value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" /></label>
                  <label className="field"><span>lng</span><input className="input" value={lng} onChange={(e) => setLng(e.target.value)} inputMode="decimal" /></label>
                </div>
                <div className="pg-bar">
                  <div className="row">
                    {SPOTS.map(([name, la, ln]) => <button key={name} type="button" className="chip" onClick={() => { setLat(la); setLng(ln); }}>{name}</button>)}
                  </div>
                  <button className="btn btn-primary btn-lg" type="submit" disabled={busy || !ready} style={{ marginLeft: "auto" }}>{busy ? <><span className="spinner" /> Running</> : "Inspect"}</button>
                </div>
              </form>
            </div>
          )}
          {error ? <div className="notice is-error pg-error" role="alert">{error}</div> : null}
        </div>
      </section>

      {tab === "discover" && busy ? (
        <section className="pg-results" aria-busy="true" aria-label="Searching">
          <div className="pg-grid is-loading">{Array.from({ length: Math.min(Math.max(limit, 4), 9) }, (_, i) => <span key={i} className={`pg-tile${i % 5 === 0 ? " is-wide" : ""}`} />)}</div>
        </section>
      ) : stored && storedBody ? (
        <section className="pg-results" aria-labelledby="pg-results-title">
          <header className="pg-results-head">
            <div>
              <h2 id="pg-results-title">{stored.query}</h2>
              <p className="pg-meta">
                <span>{plural(features.length, "result")}</span>
                {stored.usage ? <span>{formatCu(stored.usage.units)} CU</span> : null}
                {stored.data.duration_ms ? <span>{(stored.data.duration_ms / 1000).toFixed(1)} s</span> : null}
                <span>{dateFormat.format(stored.created_at)}</span>
              </p>
              <MatchedTags region={stored.data.region} tags={stored.data.tags} />
            </div>
            <div className="pg-results-actions">
              <div className="seg" role="tablist" aria-label="View">
                {(["grid", "list", "code"] as const).map((v) => <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? "is-on" : ""} onClick={() => setView(v)}>{v === "grid" ? "Grid" : v === "list" ? "List" : "Code"}</button>)}
              </div>
              <a className="btn btn-sm" href={`/atlas/${stored.id}`}>Open on the Atlas ↗</a>
            </div>
          </header>
          {stored.data.answer && view !== "code" ? <div className="answer">{stored.data.answer}</div> : null}
          {view === "code" ? <CodeView samples={samples} response={storedBody} /> : !features.length ? (
            <p className="pg-empty">No results. Try a place or a physical feature.</p>
          ) : view === "grid" ? (
            <div className="pg-grid">
              {pinned.length && stored ? <div className="pg-tile pg-map-tile"><EmbedMap key={stored.id} contained readOnly preview brand={false} mapboxToken={loaderData.mapboxToken} initialResult={{ id: stored.id, data: stored.data as never }} onPick={(i) => setOpened(pinned[i] ?? null)} /></div> : null}
              {features.map((f, i) => <Tile key={i} feature={f} index={i} wide={pinned.length ? i % 5 === 3 : i % 5 === 0} onOpen={() => setOpened(i)} />)}
            </div>
          ) : (
            <div className="results pg-list">
              {features.map((f, i) => {
                const image = imageOf(f.properties);
                return (
                  <button key={i} type="button" className="result" onClick={() => setOpened(i)}>
                    <span className={`result-thumb${image ? "" : f.properties.kind === "area" ? " is-area" : " is-pin"}`} style={image ? { backgroundImage: `url("${image}")` } : undefined} />
                    <ResultDetails properties={f.properties} />
                  </button>
                );
              })}
            </div>
          )}
          {features.length && view !== "code" && nextTier(tier) ? <UpgradeCard href="/console/billing" /> : null}
          <ResultDialog features={features} index={opened} onIndex={setOpened} />
        </section>
      ) : live ? (
        <section className="pg-results pg-narrow">
          <header className="pg-results-head">
            <p className="pg-meta">
              <span className="tag is-moss">200</span>
              <span>{live.ms} ms</span>
              {live.body?.usage ? <span>{live.tab === "route" ? `${live.body.usage.avoided} avoided · ` : ""}{live.body.usage.cu} CU</span> : null}
            </p>
            <div className="seg" role="tablist" aria-label="View">
              {(["grid", "code"] as const).map((v) => <button key={v} type="button" role="tab" aria-selected={(view === "code") === (v === "code")} className={(view === "code") === (v === "code") ? "is-on" : ""} onClick={() => setView(v)}>{v === "grid" ? "Result" : "Code"}</button>)}
            </div>
          </header>
          {view === "code" ? <CodeView samples={samples} response={live.body} /> : routed ? (
            <div className="panel pg-route-result">
              <strong>{routed.from.label || `${routed.from.lat}, ${routed.from.lng}`} → {routed.to.label || `${routed.to.lat}, ${routed.to.lng}`}</strong>
              <div className="inspect-grid pg-route-metrics">
                <div className="stat pg-stat"><span className="label">Distance</span><strong>{km(routed.route.distance_m)}</strong>{routed.direct ? <small>direct {km(routed.direct.distance_m)}</small> : null}</div>
                <div className="stat pg-stat"><span className="label">Time</span><strong>{mins(routed.route.duration_s)}</strong>{routed.direct ? <small>direct {mins(routed.direct.duration_s)}</small> : null}</div>
                <div className="stat pg-stat"><span className="label">Avoided</span><strong>{routed.avoided.length}</strong>{routed.conditions ? <small>of {routed.conditions.matches} known</small> : null}</div>
              </div>
              {routed.note ? <p className="muted pg-note">{routed.note}</p> : null}
              <ol className="muted pg-steps">
                {routed.route.steps.filter((s: any) => s.instruction).slice(0, 12).map((s: any, i: number) => <li key={i}>{s.instruction}</li>)}
              </ol>
            </div>
          ) : inspected ? (
            <div className="panel">
              <strong>{inspected.place?.map((p: any) => p.name).join(", ") || "This spot"}</strong>
              {!inspected.known ? <p className="muted">Nothing is known about this spot yet.</p> : null}
              <div className="inspect-grid">
                {(inspected.highlights ?? []).map((h: any, index: number) => (
                  <div key={index} className="stat pg-stat"><span className="label">{h.title}</span><strong>{h.detail || h.value}</strong></div>
                ))}
              </div>
              {(inspected.categories ?? []).slice(0, 4).map((c: any) => (
                <p key={c.name} className="muted pg-note"><strong>{c.name}:</strong> {c.items.slice(0, 4).map((x: any) => [x.title, x.detail || x.value].filter(Boolean).join(" ")).join(" · ")}</p>
              ))}
            </div>
          ) : null}
        </section>
      ) : (
        <section className="pg-narrow pg-idle">
          {tab === "discover" && loaderData.recent.length ? (
            <div className="pg-recent">
              <h2>Recent</h2>
              {loaderData.recent.map((r) => <Link key={r.id} to={`/console/discover/${r.id}`}><span>{r.query}</span><small>{shortDate.format(r.created_at)}</small></Link>)}
            </div>
          ) : null}
          <details className="pg-route-details"><summary>View in code</summary><CodeView samples={samples} /></details>
        </section>
      )}
    </div>
  );
}
