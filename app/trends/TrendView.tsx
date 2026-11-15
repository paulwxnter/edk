import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import SignalCitations from "./SignalCitations";
import SignalSource from "./SignalSource";
import TimeSeriesChart, { type TSMode } from "./TimeSeriesChart";
import { PlusIcon, XIcon } from "./icons";
import {
  TIMEFRAMES,
  compactNumber,
  formatChange,
  granularityFor,
  peerScope,
  per100k,
  perKm2,
  periodLabel,
  regionLabel,
  type Bench,
  type Model,
  type Point,
  type Region,
  type RegionValue,
  type Timeframe,
} from "lib/signals/types";

type SeriesTf = Exclude<Timeframe, "all">;
type Line = { region: Region; points: Point[] };

/** EDK palette: ochre for the place you are looking at, then moss, sky, clay and a quiet neutral. */
export const TREND_COLORS = ["var(--ochre)", "var(--moss)", "var(--sky)", "var(--clay)", "var(--fg-muted)"];

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
const TYPE_TABS: Record<string, string> = { city: "Cities", county: "Counties", state: "States", country: "Countries" };

/** One signal in one place: the time series (when there is one), its headline numbers, and where else it is. */
export default function TrendView({
  paid,
  signedIn,
  model,
  region,
  timeframes,
  initialTf,
  initialLines,
  total,
  bench,
  regionTypes,
  initialType,
  initialTop,
}: {
  paid: boolean;
  signedIn: boolean;
  model: Model;
  region: Region;
  /** Timeframes with a series here; empty means an all-time snapshot (e.g. mapped places). */
  timeframes: SeriesTf[];
  initialTf: SeriesTf | null;
  /** Primary region first, then any compared regions. */
  initialLines: Line[];
  total: number | null;
  bench: Bench | null;
  regionTypes: string[];
  initialType: string;
  initialTop: RegionValue[];
}) {
  const tracked = initialTf !== null;
  const navigate = useNavigate();
  const location = useLocation();
  const upgrade = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<"viewer" | "source" | null>(null);
  const requireUpgrade = () => {
    if (!signedIn) navigate(`/sign-up?next=${encodeURIComponent(location.pathname + location.search)}`);
    else upgrade.current?.showModal();
  };
  const gated = <T,>(change: (value: T) => void) => paid ? change : requireUpgrade;
  const [tf, setTf] = useState<SeriesTf | null>(initialTf);
  const [mode, setMode] = useState<TSMode>("bar");
  const [basis, setBasis] = useState<"volume" | "rate">("volume");
  const [lines, setLines] = useState<Line[]>(initialLines);
  const [compare, setCompare] = useState<Region[]>(initialLines.slice(1).map((l) => l.region));
  const [loading, setLoading] = useState(false);
  // What the lines on screen were loaded for. The server already sent the first set, so nothing is fetched on mount.
  const loadedFor = useRef(`${initialTf}|${initialLines.map((l) => l.region.slug).join(",")}`);

  // Refetch when the timeframe or the compared regions change. The current chart stays visible meanwhile.
  useEffect(() => {
    if (!tf) return;
    const slugs = [region.slug, ...compare.map((r) => r.slug)];
    const key = `${tf}|${slugs.join(",")}`;
    if (key === loadedFor.current) return;
    loadedFor.current = key;
    const ctrl = new AbortController();
    setLoading(true);
    fetch(`/signals/api/series?feature=${encodeURIComponent(model.slug)}&tf=${tf}&regions=${slugs.map(encodeURIComponent).join(",")}`, { signal: ctrl.signal })
      .then((r) => r.json() as Promise<{ series?: Line[] }>)
      .then((d) => d.series && setLines(d.series))
      .catch(() => {})
      .finally(() => setLoading(false));
    const p = new URLSearchParams(window.location.search);
    p.set("tf", tf);
    if (compare.length) p.set("vs", compare.map((r) => r.slug).join(","));
    else p.delete("vs");
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${p}`);
    return () => ctrl.abort();
  }, [tf, compare, model.slug, region.slug]);

  const comparing = lines.length > 1;
  const chartSeries = useMemo(
    () =>
      lines.map((l, i) => ({
        key: l.region.slug,
        name: regionLabel(l.region),
        color: TREND_COLORS[i % TREND_COLORS.length],
        points: basis === "rate" ? l.points.map((p) => ({ date: p.date, value: +(per100k(p.value, l.region.population) ?? 0).toFixed(2) })) : l.points,
      })),
    [lines, basis]
  );

  const addRegion = (r: Region) => {
    if (r.slug === region.slug || compare.some((c) => c.slug === r.slug) || compare.length >= 4) return;
    setCompare([...compare, r]);
    if (mode !== "line") setMode("line");
  };
  const removeRegion = (slug: string) => setCompare(compare.filter((c) => c.slug !== slug));

  const primary = lines[0]?.points ?? [];
  const stats = useMemo(() => seriesStats(primary), [primary]);

  return (
    <div className="trend-view">
      <dialog className="signals-upgrade" ref={upgrade} aria-labelledby="signals-upgrade-title">
        <h2 id="signals-upgrade-title">Upgrade to EDK Signals</h2>
        <p>View monthly and weekly data, compare regions, browse source records, and export CSV.</p>
        <div className="row">
          <form method="dialog"><button className="btn" type="submit">Close</button></form>
          <Link className="btn btn-primary" to="/pricing?plan=signals" onClick={() => upgrade.current?.close()}>View plan</Link>
        </div>
      </dialog>
      {tracked || (!paid && timeframes.length > 0) ? (
        <section>
          <div className="trend-toolbar">
            <div className="trend-toolbar-group">
              <Segmented value={tf} onChange={(value) => {
                if (value === "year" && !paid) return;
                gated(setTf)(value);
              }} options={TIMEFRAMES.map((period) => ({ ...period, disabled: paid && !timeframes.includes(period.id) }))} label="Period" />
              <Segmented
                value={mode}
                onChange={gated(setMode)}
                label="Chart type"
                options={[
                  { id: "area", label: "Area" },
                  { id: "line", label: "Line" },
                  { id: "bar", label: "Bars" },
                ]}
              />
              {(comparing || !paid) && (
                <Segmented
                  value={basis}
                  onChange={gated(setBasis)}
                  label="Basis"
                  options={[
                    { id: "volume", label: "Volume" },
                    { id: "rate", label: "Per 100k" },
                  ]}
                />
              )}
              {loading && <span className="spinner faint" aria-label="Loading" />}
            </div>
            {paid ? <CompareBox feature={model.slug} exclude={[region.slug, ...compare.map((c) => c.slug)]} onPick={addRegion} disabled={compare.length >= 4} /> : <button type="button" className="trend-compare-field" onClick={requireUpgrade}><PlusIcon /> Compare a region</button>}
          </div>

          {comparing && (
            <div className="trend-chips">
              {lines.map((l, i) => (
                <span key={l.region.slug} className="trend-chip">
                  <span className="ts-dot" style={{ background: TREND_COLORS[i % TREND_COLORS.length] }} />
                  {regionLabel(l.region)}
                  {i > 0 && (
                    <button type="button" onClick={() => removeRegion(l.region.slug)} aria-label={`Remove ${l.region.name}`}>
                      <XIcon />
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}

          <div className={cx("trend-chart", loading && "is-loading")}>
            {primary.length ? (
              <TimeSeriesChart series={chartSeries} mode={comparing ? (mode === "bar" ? "bar" : "line") : mode} granularity={granularityFor(tf!)} formatY={compactNumber} />
            ) : (
              <div className="ts-empty">{tf ? "No periods to plot" : "No annual data for this signal and place"}</div>
            )}
          </div>

          {tf && <Kpis
            items={[
              { label: `Latest ${tf === "year" ? "year" : tf === "monthly" ? "month" : "week"}`, value: stats.latest ? compactNumber(stats.latest.value) : "—", sub: stats.latest ? periodLabel(stats.latest.date, tf!) : "" },
              { label: "Change", value: formatChange(stats.change), sub: "vs previous period", tone: stats.change == null ? undefined : stats.change >= 0 ? "up" : "down" },
              { label: "Peak", value: stats.peak ? compactNumber(stats.peak.value) : "—", sub: stats.peak ? periodLabel(stats.peak.date, tf!) : "" },
              model.countryLevel
                ? { label: "Latest snapshot", value: total != null ? compactNumber(total) : "—", sub: `${model.unit ?? "count"} on mobile` }
                : { label: "All time", value: total != null ? compactNumber(total) : "—", sub: perLine(total, region) },
            ]}
          />}
        </section>
      ) : (
        // Counted signals: the regional comparison is the chart, the footprint numbers follow it.
        <>
          <WhereItIs lead onUpgrade={paid ? undefined : requireUpgrade} model={model} region={region} regionTypes={regionTypes} initialType={initialType} initialTop={initialTop} compared={[]} />
          <SnapshotPanel region={region} total={total} bench={bench} top={initialTop} topType={initialType} />
        </>
      )}

      <section className={cx("sd-panel", tab && "is-open")} aria-label="Signal data">
        <div className="sd-entry" role="tablist" aria-label="Signal data view">
          <button
            type="button"
            role="tab"
            className={cx("sd-entry-btn is-primary", tab === "viewer" && "is-on")}
            aria-selected={tab === "viewer"}
            onClick={paid ? () => setTab(tab === "viewer" ? null : "viewer") : requireUpgrade}
          >
            <span className="sd-entry-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h16v14H4zM4 10h16M4 15h16M10 5v14" /></svg>
            </span>
            <span className="sd-entry-text">
              <strong>Data Viewer {!paid && <span className="tag is-ochre">Signals</span>}</strong>
              <small>Browse the {model.countryLevel ? "monthly figures" : "records"} behind this chart, filter by date and export CSV or JSON.</small>
            </span>
            <span className="sd-entry-chev" aria-hidden="true">{tab === "viewer" ? "−" : "+"}</span>
          </button>
          <button
            type="button"
            role="tab"
            className={cx("sd-entry-btn", tab === "source" && "is-on")}
            aria-selected={tab === "source"}
            onClick={() => setTab(tab === "source" ? null : "source")}
          >
            <span className="sd-entry-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2V5Zm0 16a2 2 0 0 1 2-2h12v2" /></svg>
            </span>
            <span className="sd-entry-text">
              <strong>Data Source</strong>
              <small>Where this signal comes from: publisher, coverage and licence.</small>
            </span>
            <span className="sd-entry-chev" aria-hidden="true">{tab === "source" ? "−" : "+"}</span>
          </button>
        </div>
        {tab && (
          <div className="sd-body" role="tabpanel">
            {paid && tab === "viewer" && <SignalSource feature={model.slug} region={region.slug} place={regionLabel(region)} />}
            {tab === "source" && <SignalCitations feature={model.slug} region={region.slug} />}
          </div>
        )}
      </section>
      {(tracked || (!paid && timeframes.length > 0)) && <WhereItIs onUpgrade={paid ? undefined : requireUpgrade} model={model} region={region} regionTypes={regionTypes} initialType={initialType} initialTop={initialTop} onCompare={gated(addRegion)} compared={compare.map((c) => c.slug)} />}
    </div>
  );
}

// ---------------------------------------------------------------- snapshot (no time series)

function SnapshotPanel({ region, total, bench, top, topType }: { region: Region; total: number | null; bench: Bench | null; top: RegionValue[]; topType: string }) {
  const pct = bench?.percentile ?? null;
  // Without a ledger benchmark, rank against the leading regions we already have.
  const idx = top.findIndex((r) => r.region.slug === region.slug);
  const topSum = top.reduce((a, r) => a + r.value, 0);
  const plural = (TYPE_TABS[topType] ?? "places").toLowerCase();
  const rank =
    bench?.rank != null
      ? { value: `#${bench.rank.toLocaleString()}`, sub: bench.peers ? `of ${bench.peers.toLocaleString()} ${peerScope(region)}` : peerScope(region) }
      : idx >= 0
        ? { value: `#${idx + 1}`, sub: `among ${plural} worldwide` }
        : { value: "—", sub: `outside the top ${top.length} ${plural}` };
  const share =
    bench?.share != null
      ? { value: `${bench.share.toFixed(bench.share >= 10 ? 0 : 1)}%`, sub: "of the peer group's total" }
      : idx >= 0 && topSum
        ? { value: `${((top[idx].value / topSum) * 100).toFixed(1)}%`, sub: `of the top ${top.length} ${plural}` }
        : { value: "—", sub: "no peer total yet" };
  return (
    <section className="trend-snapshot">
      {pct != null && (
        <div className="trend-rail">
          <div className="trend-rail-labels mono">
            <span>fewest</span>
            <span className="trend-rail-here">
              {regionLabel(region)} · {Math.round(pct)}th percentile
            </span>
            <span>most</span>
          </div>
          <div className="trend-rail-track mono" aria-hidden>
            <AsciiRail percentile={pct} />
          </div>
        </div>
      )}
      <Kpis
        items={[
          { label: "Counted", value: total != null ? compactNumber(total) : "—", sub: `all time in ${region.name}` },
          { label: "Rank", ...rank },
          { label: "Share", ...share },
          { label: "Density", value: densityValue(total, region), sub: region.population ? "per 100k residents" : region.areaKm2 ? "per km²" : "" },
        ]}
      />
    </section>
  );
}

function AsciiRail({ percentile }: { percentile: number }) {
  const width = 72;
  const at = Math.min(width - 1, Math.max(0, Math.round((percentile / 100) * (width - 1))));
  return (
    <>
      <span className="trend-rail-done">{"=".repeat(at)}</span>
      <span className="trend-rail-mark">◆</span>
      <span>{"-".repeat(width - at - 1)}</span>
    </>
  );
}

// ---------------------------------------------------------------- where it is (regional comparison)

function WhereItIs({
  lead,
  onUpgrade,
  model,
  region,
  regionTypes,
  initialType,
  initialTop,
  onCompare,
  compared,
}: {
  lead?: boolean;
  onUpgrade?: () => void;
  model: Model;
  region: Region;
  regionTypes: string[];
  initialType: string;
  initialTop: RegionValue[];
  onCompare?: (r: Region) => void;
  compared: string[];
}) {
  const [type, setType] = useState(initialType);
  const [rows, setRows] = useState(initialTop);
  const [basis, setBasis] = useState<"volume" | "rate">("volume");
  const [loading, setLoading] = useState(false);
  const cache = useRef(new Map<string, RegionValue[]>([[initialType, initialTop]]));

  const pick = (t: string) => {
    setType(t);
    const hit = cache.current.get(t);
    if (hit) return setRows(hit);
    setLoading(true);
    fetch(`/signals/api/regions?feature=${encodeURIComponent(model.slug)}&type=${t}`)
      .then((r) => r.json() as Promise<{ regions?: RegionValue[] }>)
      .then((d) => {
        cache.current.set(t, d.regions ?? []);
        setRows(d.regions ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const shown = rows
    .map((r) => ({ ...r, rate: per100k(r.value, r.region.population) }))
    .filter((r) => basis === "volume" || r.rate != null)
    .sort((a, b) => (basis === "volume" ? b.value - a.value : (b.rate ?? 0) - (a.rate ?? 0)));
  const max = Math.max(1, ...shown.map((r) => (basis === "volume" ? r.value : r.rate ?? 0)));

  return (
    <section className="trend-where">
      <div className="trend-section-head">
        <div>
          <h2>{lead ? "Where it is" : "Where else it is"}</h2>
          <p>
            {model.countryLevel ? `Latest ${model.unit ?? "count"} (mobile) by ${type}` : `All-time count by ${type}`}
            {basis === "rate" ? ", per 100,000 residents" : ""}.
          </p>
        </div>
        <div className="trend-toolbar-group">
          {loading && <span className="spinner faint" aria-label="Loading" />}
          <Segmented value={type} onChange={onUpgrade ?? pick} label="Region type" options={(onUpgrade && !model.countryLevel ? Object.keys(TYPE_TABS) : regionTypes).map((t) => ({ id: t, label: TYPE_TABS[t] ?? t }))} />
          <Segmented
            value={basis}
            onChange={onUpgrade ?? setBasis}
            label="Basis"
            options={[
              { id: "volume", label: "Volume" },
              { id: "rate", label: "Per 100k" },
            ]}
          />
        </div>
      </div>
      {shown.length ? (
        <ol className={cx("trend-ranks", loading && "is-loading")}>
          {shown.map((r, i) => {
            const v = basis === "volume" ? r.value : r.rate ?? 0;
            const here = r.region.slug === region.slug;
            const inChart = compared.includes(r.region.slug);
            return (
              <li key={r.region.slug} className={here ? "is-here" : undefined}>
                <span className="trend-rank-num mono">{String(i + 1).padStart(2, "0")}</span>
                <Link to={`/signals/${model.slug}/${r.region.slug}`} className="trend-rank-name">
                  {regionLabel(r.region)}
                </Link>
                <span className="trend-bar">
                  <span style={{ width: `${Math.max(1.5, (v / max) * 100)}%` }} />
                </span>
                <span className="trend-rank-value mono tabular">{basis === "volume" ? compactNumber(v) : v.toFixed(v >= 100 ? 0 : 1)}</span>
                {onCompare && !here ? (
                  <button type="button" className="trend-rank-add" onClick={() => onCompare(r.region)} disabled={inChart} title={inChart ? "In the chart" : "Add to chart"} aria-label={inChart ? `${r.region.name} is in the chart` : `Add ${r.region.name} to the chart`}>
                    <PlusIcon />
                  </button>
                ) : (
                  <span />
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="trend-empty mono">no {type}-level data for this signal</p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- pieces

function CompareBox({ feature, exclude, onPick, disabled }: { feature: string; exclude: string[]; onPick: (r: Region) => void; disabled: boolean }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<RegionValue[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) return setRows([]);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/signals/api/regions?feature=${encodeURIComponent(feature)}&q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal })
        .then((r) => r.json() as Promise<{ regions?: RegionValue[] }>)
        .then((d) => setRows(d.regions ?? []))
        .catch(() => {});
    }, 160);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, feature]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  const list = rows.filter((r) => !exclude.includes(r.region.slug));
  return (
    <div ref={ref} className="trend-compare">
      <label className="trend-compare-field">
        <PlusIcon />
        <input
          value={q}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          placeholder={disabled ? "Up to 5 regions" : "Compare a region"}
          aria-label="Compare a region"
        />
      </label>
      {open && list.length > 0 && (
        <div className="trend-compare-list">
          {list.map((r) => (
            <button
              key={r.region.slug}
              type="button"
              onClick={() => {
                onPick(r.region);
                setQ("");
                setOpen(false);
              }}
            >
              <span>{regionLabel(r.region)}</span>
              <small className="mono">{compactNumber(r.value)}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Segmented<T extends string>({ value, onChange, options, label }: { value: T | null; onChange: (v: T) => void; options: { id: T; label: string; disabled?: boolean }[]; label: string }) {
  if (options.length < 2) return null;
  return (
    <div className="seg trend-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" disabled={o.disabled} aria-pressed={value === o.id} onClick={() => onChange(o.id)} className={value === o.id ? "is-on" : undefined}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Kpis({ items }: { items: { label: string; value: string; sub: string; tone?: "up" | "down" }[] }) {
  return (
    <dl className="trend-kpis">
      {items.map((k) => (
        <div key={k.label}>
          <dt className="label">{k.label.toUpperCase()}</dt>
          <dd className={cx("trend-kpi-value tabular", k.tone === "up" && "is-up", k.tone === "down" && "is-down")}>{k.value}</dd>
          <dd className="trend-kpi-sub">{k.sub}</dd>
        </div>
      ))}
    </dl>
  );
}

function seriesStats(points: Point[]) {
  if (!points.length) return { latest: null, change: null, peak: null };
  const latest = points[points.length - 1];
  const prev = points.length > 1 ? points[points.length - 2] : null;
  const peak = points.reduce((a, b) => (b.value > a.value ? b : a), points[0]);
  const change = prev && prev.value ? ((latest.value - prev.value) / prev.value) * 100 : null;
  return { latest, change, peak };
}

function perLine(total: number | null, region: Region) {
  const r = total != null ? per100k(total, region.population) : null;
  return r != null ? `${r.toFixed(r >= 100 ? 0 : 1)} per 100k residents` : `in ${region.name}`;
}

function densityValue(total: number | null, region: Region) {
  if (total == null) return "—";
  const r = per100k(total, region.population) ?? perKm2(total, region.areaKm2);
  return r == null ? "—" : r.toFixed(r >= 100 ? 0 : r >= 10 ? 1 : 2);
}
