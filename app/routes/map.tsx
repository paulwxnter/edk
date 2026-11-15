import { useEffect, useMemo, useRef, useState } from "react";
import { Form, Link, NavLink, redirect, useNavigate } from "react-router";
import type { Route } from "./+types/map";
import FieldArt from "~/ascii/FieldArt";
import { SiteLayout } from "~/components/chrome";
import EmbedMap from "~/map/EmbedMap";
import { getSessionUser } from "../../server/auth";
import { CIVIC_METHODS, MAP_FILTERS, isMapFilter } from "~/lib/mapkinds";
import { getArtifact, getRecords, listArtifacts, type MapArtifact, type MapDetail, type MapRecord, type MapRegion, type MapScene } from "../../server/mapdata";

// edk.earth/map: everything EDK has detected, browsable. /map lists it (and /map/permits, /map/crime…
// narrow it); /map/:feature shows one thing everywhere it was found, /map/:feature/:region one place.

const SIGNED_OUT_SCENES = 12;
const SIGNED_OUT_RECORDS = 25;

type Category = { label: string; href: string; blurb: (name: string, where: string) => string };
const CATEGORIES: Record<string, Category> = {
  permits: { label: "Permits", href: "/map/permits", blurb: (name, where) => `See where building, development and licensing activity is happening in ${where}. Every ${name.toLowerCase()} record comes from an official filing, with its applicant, dates, project type and status, so you can follow construction, measure growth and spot new work before it breaks ground.` },
  accidents: { label: "Traffic accidents", href: "/map/traffic-accidents", blurb: (name, where) => `Where and when collisions happen on the roads of ${where}. Mapping each ${name.toLowerCase()} record reveals risky intersections, dangerous corridors and patterns by hour and season, from public agency reporting you can cite.` },
  service_requests: { label: "Community issues", href: "/map/community-issues", blurb: (name, where) => `Concerns residents of ${where} have reported to their local agencies. On the map, ${name.toLowerCase()} records show which neighbourhoods report the most, how issues cluster and how quickly they recur.` },
  crimes: { label: "Crime", href: "/map/crime", blurb: (name, where) => `Reported ${name.toLowerCase()} incidents across ${where}, placed where they happened. Reporting practices vary by jurisdiction, so read the numbers with the context behind them.` },
};
const VISUAL: Category = { label: "Visual", href: "/map/visual", blurb: (name, where) => `${name} as it actually looks, photographed at real locations across ${where}. Each scene pairs a picture with its place, so you can see conditions on the ground, notice what changes and know a site before you go.` };
const categoryOf = (method: string | null) => (method && CATEGORIES[method]) || VISUAL;
const methodLabel = (method: string | null) => (method && CATEGORIES[method]?.label) || (method === "name" || method === "terms" ? "Visual" : method ? method.replace(/_/g, " ") : "Visual");

const parseDate = (value: string | null) => {
  if (!value) return null;
  const d = new Date(value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  return Number.isNaN(d.getTime()) ? null : d;
};
const DAY = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });
const formatDate = (value: string | null) => {
  const d = parseDate(value);
  return d ? DAY.format(d) : null;
};

export function meta({ data }: Route.MetaArgs) {
  if (!data) return [{ title: "Map · EDK" }];
  if (data.mode === "browse") {
    const filter = MAP_FILTERS.find((f) => f.key === data.filter);
    return [
      { title: data.filter === "all" ? "Map · EDK" : `${filter?.label} · Map · EDK` },
      { name: "description", content: "The EDK Map: millions of things detected around the world, from bridges and solar farms to permits, collisions and community issues. Browse them, map them, download them." },
    ];
  }
  const { artifact, region } = data.detail;
  const where = region ? region.name : "the world";
  return [
    { title: `${artifact.name}${region ? ` in ${region.name}` : ""} · Map · EDK` },
    { name: "description", content: artifact.description ?? `${artifact.name} across ${where}, mapped by EDK.` },
  ];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const user = await getSessionUser(context.cloudflare.env.DB, request);
  const signedIn = Boolean(user);
  const feature = params.feature;
  if (feature === "all" && !params.region) throw redirect(`/map${url.search}`);
  if (!feature || (isMapFilter(feature) && !params.region)) {
    const filter = feature && isMapFilter(feature) ? feature : "all";
    const q = (url.searchParams.get("q") ?? "").slice(0, 120);
    const list = await listArtifacts({ q, filter }).catch(() => null);
    return { mode: "browse" as const, filter, q, list, signedIn, mapboxToken: null };
  }
  const detail = await getArtifact(feature, { region: params.region ?? null }).catch(() => undefined);
  if (detail === undefined) throw new Response("The map is unavailable right now.", { status: 502 });
  if (detail === null || (params.region && !detail.region)) throw new Response("Not found", { status: 404 });
  const civic = CIVIC_METHODS.has(detail.artifact.method ?? "");
  const records = civic ? await getRecords(feature, { region: params.region ?? null }).catch(() => null) : null;
  const mapboxToken = [process.env.MAPBOX_API_KEY, process.env.NEXT_PUBLIC_MAPBOX_TOKEN].find((token) => token?.startsWith("pk.")) ?? null;
  return { mode: "detail" as const, detail, civic, records, signedIn, mapboxToken };
}

export const headers = () => ({ "Cache-Control": "private, no-store" });

export default function MapRoute({ loaderData }: Route.ComponentProps) {
  return (
    <SiteLayout>
      {loaderData.mode === "browse"
        ? <MapBrowse key={`${loaderData.filter}:${loaderData.q}`} filter={loaderData.filter} q={loaderData.q} list={loaderData.list} />
        : <MapDetailView key={`${loaderData.detail.artifact.slug}:${loaderData.detail.region?.slug ?? ""}`} detail={loaderData.detail} civic={loaderData.civic} records={loaderData.records} signedIn={loaderData.signedIn} mapboxToken={loaderData.mapboxToken} />}
    </SiteLayout>
  );
}

// ---------------------------------------------------------------- browse

function MapBrowse({ filter, q, list }: { filter: string; q: string; list: { artifacts: MapArtifact[]; page: number; hasMore: boolean } | null }) {
  const [items, setItems] = useState(list?.artifacts ?? []);
  const [page, setPage] = useState(list?.page ?? 1);
  const [hasMore, setHasMore] = useState(Boolean(list?.hasMore));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(list ? null : "The map is unavailable right now. Try again in a moment.");
  const here = filter === "all" ? "/map" : `/map/${filter}`;

  const more = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/map/api/artifacts?${new URLSearchParams({ q, filter, page: String(page + 1) })}`);
      if (!res.ok) throw new Error();
      const body = (await res.json()) as { artifacts: MapArtifact[]; page: number; hasMore: boolean };
      setItems((current) => [...current, ...body.artifacts]);
      setPage(body.page);
      setHasMore(body.hasMore);
    } catch {
      setError("Could not load more. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="geo-page">
      <section className="geo-hero">
        <div className="pg-art" aria-hidden="true"><FieldArt field="contours" /></div>
        <div className="geo-hero-inner">
          <span className="label">Map</span>
          <h1>Detect change</h1>
          <p className="geo-lead">A global sensor network that keeps finding what changes across places, infrastructure, businesses, nature and the built environment.</p>
          <Form method="get" action={here} className="geo-search" role="search">
            <label className="sr-only" htmlFor="geo-q">Search the map</label>
            <input id="geo-q" name="q" defaultValue={q} placeholder="Explore the world." autoComplete="off" enterKeyHint="search" />
            <button type="submit" className="geo-search-go" aria-label="Search">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
            </button>
          </Form>
          <p className="geo-note mono">5M+ things found around the world</p>
        </div>
      </section>

      <section className="geo-browse" aria-labelledby="geo-browse-title">
        <div className="geo-browse-head">
          <h2 id="geo-browse-title">{q ? <>Results for <em>{q}</em></> : "Explore"}</h2>
          <nav className="seg geo-filters" aria-label="Kinds">
            {MAP_FILTERS.map((f) => (
              <NavLink key={f.key} end to={`${f.key === "all" ? "/map" : `/map/${f.key}`}${q ? `?q=${encodeURIComponent(q)}` : ""}`} className={() => (f.key === filter ? "is-on" : "")}>{f.label}</NavLink>
            ))}
          </nav>
        </div>
        {error && !items.length ? <p className="geo-empty">{error}</p> : !items.length ? (
          <p className="geo-empty">Nothing found{q ? ` for “${q}”` : ""}. Try a broader word, like <Link to="/map?q=bridge">bridge</Link> or <Link to="/map?q=solar">solar</Link>.</p>
        ) : (
          <>
            <div className="geo-cards">
              {items.map((a, i) => (
                <Link key={a.id} to={`/map/${a.slug}`} className="geo-card" style={{ "--i": Math.min(i % 24, 16) } as React.CSSProperties}>
                  <span className="geo-card-kind mono">{methodLabel(a.method)}</span>
                  <h3>{a.name}</h3>
                  <p>{a.description ?? "Scenes and records for this, wherever it was found."}</p>
                  <span className="geo-card-go mono">Explore →</span>
                </Link>
              ))}
            </div>
            {error ? <p className="geo-empty">{error}</p> : null}
            {hasMore ? <div className="geo-more"><button type="button" className="btn" disabled={busy} onClick={more}>{busy ? "Loading…" : "Load more"}</button></div> : null}
          </>
        )}
      </section>
    </main>
  );
}

// ---------------------------------------------------------------- detail

type Records = { records: MapRecord[]; page: number; hasMore: boolean } | null;

function MapDetailView({ detail, civic, records: initialRecords, signedIn, mapboxToken }: { detail: MapDetail; civic: boolean; records: Records; signedIn: boolean; mapboxToken: string | null }) {
  const { artifact, region } = detail;
  const category = categoryOf(artifact.method);
  const where = region ? region.name : "the world";
  const regionQuery = region ? `&region=${encodeURIComponent(region.slug)}` : "";

  const [scenes, setScenes] = useState(detail.scenes);
  const [scenePage, setScenePage] = useState(detail.page);
  const [scenesMore, setScenesMore] = useState(detail.hasMore);
  const [records, setRecords] = useState(initialRecords?.records ?? []);
  const [recordPage, setRecordPage] = useState(initialRecords?.page ?? 1);
  const [recordsMore, setRecordsMore] = useState(Boolean(initialRecords?.hasMore));
  const [filters, setFilters] = useState({ year: "", from: "", to: "" });
  const [applied, setApplied] = useState(filters);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(civic && !initialRecords ? "Records are unavailable right now." : null);
  const [opened, setOpened] = useState<number | null>(null);

  const visibleScenes = signedIn ? scenes : scenes.slice(0, SIGNED_OUT_SCENES);
  const visibleRecords = signedIn ? records : records.slice(0, SIGNED_OUT_RECORDS);
  const items: (MapScene | MapRecord)[] = civic ? visibleRecords : visibleScenes;
  // The same map as the Atlas, read-only: one pin per scene or record that has a place.
  const pinned = useMemo(() => items.flatMap((item, index) => (item.lng != null && item.lat != null ? [index] : [])), [items]);
  const mapResult = useMemo(() => ({
    id: null,
    data: {
      query: region ? `${artifact.name} in ${region.name}` : artifact.name,
      geojson: {
        features: pinned.map((index) => {
          const item = items[index];
          return { type: "Feature" as const, id: String(item.id), geometry: { type: "Point", coordinates: [item.lng!, item.lat!] as [number, number] }, properties: { name: item.address ?? artifact.name, address: item.address, date: item.date, image_url: "image" in item ? item.image : null } };
        }),
      },
    },
  }), [pinned, items, artifact.name, region]);
  const capped = civic ? records.length > visibleRecords.length || recordsMore : scenes.length > visibleScenes.length || scenesMore;
  const hasMore = civic ? recordsMore : scenesMore;

  const loadRecords = async (page: number, f = applied) => {
    const params = new URLSearchParams({ slug: artifact.slug, page: String(page) });
    if (region) params.set("region", region.slug);
    if (f.year) params.set("year", f.year);
    if (f.from) params.set("from", f.from);
    if (f.to) params.set("to", f.to);
    const res = await fetch(`/map/api/records?${params}`);
    if (!res.ok) throw new Error();
    return (await res.json()) as { records: MapRecord[]; page: number; hasMore: boolean };
  };

  const more = async () => {
    setBusy(true);
    setError(null);
    try {
      if (civic) {
        const next = await loadRecords(recordPage + 1);
        setRecords((current) => [...current, ...next.records]);
        setRecordPage(next.page);
        setRecordsMore(next.hasMore);
      } else {
        const res = await fetch(`/map/api/scenes?slug=${encodeURIComponent(artifact.slug)}&page=${scenePage + 1}${regionQuery}`);
        if (!res.ok) throw new Error();
        const next = (await res.json()) as { scenes: MapScene[]; page: number; hasMore: boolean };
        setScenes((current) => [...current, ...next.scenes]);
        setScenePage(next.page);
        setScenesMore(next.hasMore);
      }
    } catch {
      setError("Could not load more. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const applyFilters = async (next: typeof filters) => {
    setApplied(next);
    setBusy(true);
    setError(null);
    try {
      const body = await loadRecords(1, next);
      setRecords(body.records);
      setRecordPage(body.page);
      setRecordsMore(body.hasMore);
    } catch {
      setError("Records are unavailable right now.");
    } finally {
      setBusy(false);
    }
  };

  const total = artifact.totalScenes ?? 0;
  const scanned = formatDate(artifact.lastIndexed ?? artifact.lastScan);
  const download = (format: string) => `/map/api/download?slug=${encodeURIComponent(artifact.slug)}&format=${format}${regionQuery}`;
  const filtered = Boolean(applied.year || applied.from || applied.to);

  return (
    <main className="geo-page geo-detail">
      <p className="trends-crumbs mono">
        <Link to="/map">Map</Link> <span>/</span> <Link to={category.href}>{category.label}</Link>
        {region ? <> <span>/</span> <Link to={`/map/${artifact.slug}`}>{artifact.name}</Link></> : null}
      </p>
      <div className="geo-detail-grid">
        <header className="geo-detail-intro">
          <h1>{artifact.name}{region ? <span className="geo-detail-where"> in {region.name}</span> : null}</h1>
          {artifact.description ? <p className="geo-detail-desc">{artifact.description}</p> : null}
          <p>
            {total > 0
              ? <>EDK has mapped <strong>{total.toLocaleString("en-US")}</strong> {artifact.name.toLowerCase()} {region ? `across ${region.name} ` : ""}from street-level imagery, video and field observations{scanned ? `, last indexed ${scanned}` : ""}. Explore every location on the map or download the data.</>
              : <>EDK tracks {artifact.name.toLowerCase()} records {region ? `across ${region.name} ` : ""}from public agency data{scanned ? `, last indexed ${scanned}` : ""}. Explore every record on the map or download the data.</>}
          </p>
          <p>{category.blurb(artifact.name, where)}</p>
          {(
            <div className="geo-tags">
              <Link to={category.href} className="geo-tag is-accent">{category.label}</Link>
              {artifact.interests.map((tag) => <Link key={tag} to={`/map?q=${encodeURIComponent(tag)}`} className="geo-tag">{tag}</Link>)}
            </div>
          )}
        </header>

        <section className="geo-discovery" aria-labelledby="geo-discovery-title">
          <div className="geo-discovery-head">
            <h2 id="geo-discovery-title">Discovery</h2>
            <RegionPicker slug={artifact.slug} region={region} />
          </div>
          <div className="geo-overview">
            {pinned.length ? <EmbedMap key={pinned.length + JSON.stringify(applied)} contained readOnly preview brand={false} mapboxToken={mapboxToken} initialResult={mapResult as never} onPick={(i) => setOpened(pinned[i] ?? null)} /> : <span className="geo-overview-empty mono">Nothing placed on the map yet</span>}
          </div>

          {civic && signedIn ? (
            <form className="geo-record-filters" onSubmit={(e) => { e.preventDefault(); applyFilters({ year: /^\d{4}$/.test(filters.year) ? filters.year : "", from: filters.from, to: filters.to }); }}>
              <label><span className="label">Year</span><input className="input" inputMode="numeric" placeholder="2026" value={filters.year} onChange={(e) => setFilters({ ...filters, year: e.target.value.replace(/\D/g, "").slice(0, 4) })} /></label>
              <label><span className="label">From</span><input className="input" type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></label>
              <label><span className="label">To</span><input className="input" type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></label>
              <button className="btn btn-sm" type="submit" disabled={busy}>Apply</button>
              {filtered ? <button className="btn btn-sm btn-ghost" type="button" onClick={() => { const empty = { year: "", from: "", to: "" }; setFilters(empty); applyFilters(empty); }}>Clear</button> : null}
            </form>
          ) : null}

          {civic ? (
            !visibleRecords.length ? <p className="geo-empty">{error ?? (filtered ? "No records match these dates." : `No records have been indexed${region ? ` in ${region.name}` : ""} yet.`)}</p> : (
              <ol className="geo-records">
                {visibleRecords.map((r, i) => (
                  <li key={`${r.id}-${i}`}>
                    <button type="button" onClick={() => setOpened(i)}>
                      <span className="geo-record-num mono">{String(i + 1).padStart(2, "0")}</span>
                      <span className="geo-record-main">
                        <strong>{r.address ?? r.name ?? "Address unavailable"}</strong>
                        <small>{r.description ?? "No description."}</small>
                      </span>
                      <span className="geo-record-date mono">{formatDate(r.date) ?? ""}</span>
                    </button>
                  </li>
                ))}
              </ol>
            )
          ) : !visibleScenes.length ? <p className="geo-empty">No scenes have been indexed{region ? ` in ${region.name}` : ""} yet.</p> : (
            <div className="geo-scenes">
              {visibleScenes.map((s, i) => <SceneTile key={`${s.id}-${i}`} scene={s} index={i} name={artifact.name} onOpen={() => setOpened(i)} />)}
            </div>
          )}

          {error && items.length ? <p className="geo-empty">{error}</p> : null}
          <div className="geo-more">
            {!signedIn && capped ? <Link className="btn btn-primary" to={`/sign-up?next=${encodeURIComponent(`/map/${artifact.slug}${region ? `/${region.slug}` : ""}`)}`}>Sign up to see everything</Link>
              : hasMore ? <button type="button" className="btn" disabled={busy} onClick={more}>{busy ? "Loading…" : "Load more"}</button> : null}
          </div>
        </section>

        <aside className="geo-detail-meta">
          <dl className="geo-stats">
            <div><dt className="label">Mapped</dt><dd>{total > 0 ? total.toLocaleString("en-US") : civic ? "Records" : "—"}</dd></div>
            <div><dt className="label">Last scan</dt><dd>{formatDate(artifact.lastScan) ?? "—"}</dd></div>
            <div><dt className="label">Last indexed</dt><dd>{formatDate(artifact.lastIndexed) ?? "—"}</dd></div>
          </dl>
          <div className="geo-side-block">
            <h2 className="label">Download</h2>
            <p>{artifact.name} dataset{region ? ` in ${region.name}` : ""}</p>
            <div className="geo-links">
              {(["csv", "geojson", "parquet"] as const).map((format) => signedIn
                ? <a key={format} href={download(format)} download><span>{format === "geojson" ? "GeoJSON" : format.toUpperCase()}</span><span aria-hidden="true">↓</span></a>
                : <Link key={format} to={`/sign-up?next=${encodeURIComponent(`/map/${artifact.slug}${region ? `/${region.slug}` : ""}`)}`}><span>{format === "geojson" ? "GeoJSON" : format.toUpperCase()}</span><span className="mono faint">Sign up</span></Link>)}
            </div>
          </div>
          {detail.related.length ? (
            <div className="geo-side-block">
              <h2 className="label">{civic ? `More ${category.label.toLowerCase()}` : "Related"}</h2>
              <div className="geo-links">
                {detail.related.slice(0, 12).map((item) => <Link key={item.slug} to={`/map/${item.slug}${region ? `/${region.slug}` : ""}`}><span>{item.name}</span><span aria-hidden="true">→</span></Link>)}
              </div>
              <Link className="geo-see-all mono" to={category.href}>See all {category.label.toLowerCase()} →</Link>
            </div>
          ) : null}
        </aside>
      </div>

      {civic
        ? <RecordDialog records={visibleRecords} index={opened} onIndex={setOpened} />
        : <SceneDialog scenes={visibleScenes} name={artifact.name} index={opened} onIndex={setOpened} />}
    </main>
  );
}

const captionFor = (name: string, scene: MapScene) => [scene.address ?? name, formatDate(scene.date)].filter(Boolean).join(" · ");

function SceneTile({ scene, index, name, onOpen }: { scene: MapScene; index: number; name: string; onOpen: () => void }) {
  const [broken, setBroken] = useState(false);
  const image = broken ? null : scene.image;
  return (
    <button type="button" className={`pg-tile${image ? "" : " is-blank"}`} style={{ "--i": Math.min(index, 16) } as React.CSSProperties} onClick={onOpen} aria-label={`Open ${captionFor(name, scene)}`}>
      {image ? <img src={image} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} /> : null}
      <span className="pg-tile-num">{String(index + 1).padStart(2, "0")}</span>
      <span className="pg-tile-cap">
        <strong>{scene.address ?? name}</strong>
        {formatDate(scene.date) ? <small>{formatDate(scene.date)}</small> : null}
      </span>
    </button>
  );
}

function useDialog(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    if (!open && ref.current?.open) ref.current.close();
  }, [open]);
  return ref;
}

function SceneDialog({ scenes, name, index, onIndex }: { scenes: MapScene[]; name: string; index: number | null; onIndex: (i: number | null) => void }) {
  const scene = index === null ? null : scenes[index] ?? null;
  const ref = useDialog(Boolean(scene));
  const step = (by: number) => index !== null && onIndex((index + by + scenes.length) % scenes.length);
  return (
    <dialog ref={ref} className="pg-image-dialog pg-result-dialog" aria-label={scene ? captionFor(name, scene) : name} onClose={() => onIndex(null)} onClick={(e) => { if (e.target === ref.current) onIndex(null); }} onKeyDown={(e) => { if (e.key === "ArrowRight") step(1); if (e.key === "ArrowLeft") step(-1); }}>
      {scene ? <>
        <header>
          <h2><span className="mono faint">{String(index! + 1).padStart(2, "0")}</span> {scene.address ?? name}</h2>
          <div className="row">
            {scenes.length > 1 ? <>
              <button className="btn btn-sm" type="button" onClick={() => step(-1)} aria-label="Previous scene">←</button>
              <button className="btn btn-sm" type="button" onClick={() => step(1)} aria-label="Next scene">→</button>
            </> : null}
            <button className="btn btn-sm" type="button" onClick={() => onIndex(null)}>Close</button>
          </div>
        </header>
        {scene.image ? <img key={scene.image} src={scene.image} alt={captionFor(name, scene)} /> : null}
        <div className="row pg-dialog-foot">
          <span className="mono faint">{formatDate(scene.date) ?? ""}{scene.lat != null && scene.lng != null ? `  ·  ${scene.lat.toFixed(5)}, ${scene.lng.toFixed(5)}` : ""}</span>
          {scene.lat != null && scene.lng != null ? <Link className="btn btn-sm" to={`/console?tab=inspect&lat=${scene.lat}&lng=${scene.lng}`}>Inspect this spot</Link> : null}
        </div>
      </> : null}
    </dialog>
  );
}

function RecordDialog({ records, index, onIndex }: { records: MapRecord[]; index: number | null; onIndex: (i: number | null) => void }) {
  const record = index === null ? null : records[index] ?? null;
  const ref = useDialog(Boolean(record));
  const step = (by: number) => index !== null && onIndex((index + by + records.length) % records.length);
  return (
    <dialog ref={ref} className="pg-image-dialog pg-result-dialog geo-record-dialog" aria-label="Record details" onClose={() => onIndex(null)} onClick={(e) => { if (e.target === ref.current) onIndex(null); }} onKeyDown={(e) => { if (e.key === "ArrowRight") step(1); if (e.key === "ArrowLeft") step(-1); }}>
      {record ? <>
        <header>
          <h2><span className="mono faint">{String(index! + 1).padStart(2, "0")}</span> {record.address ?? record.name ?? "Record"}</h2>
          <div className="row">
            {records.length > 1 ? <>
              <button className="btn btn-sm" type="button" onClick={() => step(-1)} aria-label="Previous record">←</button>
              <button className="btn btn-sm" type="button" onClick={() => step(1)} aria-label="Next record">→</button>
            </> : null}
            <button className="btn btn-sm" type="button" onClick={() => onIndex(null)}>Close</button>
          </div>
        </header>
        <dl className="geo-record-fields">
          {record.name ? <div><dt className="label">Name</dt><dd>{record.name}</dd></div> : null}
          {record.date ? <div><dt className="label">Date</dt><dd>{formatDate(record.date)}</dd></div> : null}
          {record.description ? <div className="is-wide"><dt className="label">Description</dt><dd>{record.description}</dd></div> : null}
          {record.meta.map(([key, value]) => <div key={key}><dt className="label">{key}</dt><dd>{value}</dd></div>)}
        </dl>
        {record.lat != null && record.lng != null ? (
          <div className="row pg-dialog-foot">
            <span className="mono faint">{record.lat.toFixed(5)}, {record.lng.toFixed(5)}</span>
            <Link className="btn btn-sm" to={`/console?tab=inspect&lat=${record.lat}&lng=${record.lng}`}>Inspect this spot</Link>
          </div>
        ) : null}
      </> : null}
    </dialog>
  );
}

function RegionPicker({ slug, region }: { slug: string; region: MapRegion | null }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [list, setList] = useState<MapRegion[]>([]);
  const [loading, setLoading] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const timer = window.setTimeout(() => {
      fetch(`/map/api/regions?q=${encodeURIComponent(q)}`)
        .then((res) => (res.ok ? (res.json() as Promise<{ regions?: MapRegion[] }>) : { regions: [] }))
        .then((body: { regions?: MapRegion[] }) => setList(body.regions ?? []))
        .catch(() => setList([]))
        .finally(() => setLoading(false));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [q, open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const go = (target: MapRegion | null) => {
    setOpen(false);
    navigate(target ? `/map/${slug}/${target.slug}` : `/map/${slug}`);
  };

  return (
    <div className="geo-region" ref={box}>
      <button type="button" className="btn btn-sm" aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen(!open)}>
        {region ? region.name : "Everywhere"} <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div className="geo-region-menu">
          <input className="input" autoFocus placeholder="Search cities, states, countries" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search places" />
          <div className="geo-region-list" role="listbox" aria-label="Places">
            <button type="button" role="option" aria-selected={!region} onClick={() => go(null)}>Everywhere</button>
            {list.map((r) => (
              <button key={`${r.layer}-${r.id}`} type="button" role="option" aria-selected={region?.slug === r.slug} onClick={() => go(r)}>
                <span>{r.name}</span>
                <small>{[r.state, r.country].filter(Boolean).join(", ") || r.layer}</small>
              </button>
            ))}
            {loading && !list.length ? <p className="faint">Searching…</p> : !loading && !list.length ? <p className="faint">No places match.</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
