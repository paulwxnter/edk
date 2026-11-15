import { useEffect, useId, useMemo, useRef, useState } from "react";

// Multi-series time chart for Trends (ported from atlasx / ov-insight).
// Line, stacked area or stacked bars; absolute / indexed (=100 at first value) / share scales.
// Legend toggles series; hovering shows every value at that period. Colours are CSS colour strings,
// so series can use theme tokens (var(--ochre)) and follow Soil / Paper.

export type TSPoint = { date: string; value: number };
export type TSSeries = { key: string; name: string; color: string; points: TSPoint[] };
export type TSMode = "line" | "area" | "bar";
export type TSScale = "absolute" | "indexed" | "share";
export type TSGranularity = "year" | "month" | "week";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function useMeasure<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ width: Math.round(e.contentRect.width), height: Math.round(e.contentRect.height) }));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, size.width, size.height] as const;
}

function niceTicks(min: number, max: number, count = 5) {
  const span = max - min || 1;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) ticks.push(+v.toFixed(10));
  return ticks;
}

/** Nice y ticks whose last tick always covers `max`. */
function coverTicks(max: number, count = 5) {
  const ticks = niceTicks(0, max, count);
  const step = ticks.length > 1 ? ticks[1] - ticks[0] : max || 1;
  while (ticks[ticks.length - 1] < max) ticks.push(+(ticks[ticks.length - 1] + step).toFixed(10));
  return ticks;
}

/** Monotone cubic (Fritsch–Carlson): smooth, never overshoots the data. */
function smoothPath(pts: [number, number][]) {
  const n = pts.length;
  if (n < 3) return pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join("");
  const dx = pts.slice(1).map((p, i) => p[0] - pts[i][0]);
  const slope = pts.slice(1).map((p, i) => (dx[i] ? (p[1] - pts[i][1]) / dx[i] : 0));
  const m = pts.map((_, i) => {
    if (i === 0) return slope[0];
    if (i === n - 1) return slope[n - 2];
    const a = slope[i - 1], b = slope[i];
    return a * b <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / a + (dx[i] + 2 * dx[i - 1]) / b);
  });
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${pts[i][0] + h},${pts[i][1] + m[i] * h} ${pts[i + 1][0] - h},${pts[i + 1][1] - m[i + 1] * h} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  return d;
}

export function tickLabel(d: string, granularity: TSGranularity) {
  const [y, m, day] = d.split("-").map(Number);
  if (granularity === "year") return String(y);
  if (granularity === "month") return `${MONTHS[(m || 1) - 1]} ${String(y).slice(2)}`;
  return `${day} ${MONTHS[(m || 1) - 1]}`;
}

export const compact = (v: number) =>
  Math.abs(v) >= 1e9 ? `${+(v / 1e9).toFixed(1)}B` : Math.abs(v) >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${+(v / 1e3).toFixed(1)}K` : String(Math.round(v));

export default function TimeSeriesChart({
  series,
  mode = "area",
  scale = "absolute",
  smooth = true,
  height,
  granularity = "year",
  formatY = compact,
  showLegend = false,
}: {
  series: TSSeries[];
  mode?: TSMode;
  scale?: TSScale;
  smooth?: boolean;
  /** Fixed height in px. Omit to fill the parent (which must have a height), so the x-axis never falls off screen. */
  height?: number;
  granularity?: TSGranularity;
  formatY?: (v: number) => string;
  showLegend?: boolean;
}) {
  const [ref, width, boxHeight] = useMeasure<HTMLDivElement>();
  const fill = height === undefined;
  const chartHeight = height ?? Math.max(180, boxHeight);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  const stacked = mode !== "line";
  const m = { top: 16, right: 16, bottom: 30, left: 52 };
  const w = Math.max(0, width - m.left - m.right);
  const h = chartHeight - m.top - m.bottom;

  const { dates, matrix } = useMemo(() => {
    const dates = Array.from(new Set(series.flatMap((s) => s.points.map((p) => p.date)))).sort();
    const raw = series.map((s) => {
      const map = new Map(s.points.map((p) => [p.date, p.value]));
      return dates.map((d) => map.get(d) ?? null);
    });
    let matrix = raw;
    if (scale === "indexed") {
      matrix = raw.map((row) => {
        const base = row.find((v) => v != null && v !== 0);
        return row.map((v) => (v == null || !base ? null : +((v / base) * 100).toFixed(2)));
      });
    } else if (scale === "share") {
      matrix = raw.map((row, si) =>
        row.map((v, di) => {
          const tot = raw.reduce((a, r, ri) => a + (hidden.has(series[ri].key) ? 0 : r[di] ?? 0), 0);
          return v == null || !tot || hidden.has(series[si].key) ? null : +((v / tot) * 100).toFixed(2);
        })
      );
    }
    return { dates, matrix };
  }, [series, scale, hidden]);

  const visIdx = series.map((s, i) => (hidden.has(s.key) ? -1 : i)).filter((i) => i >= 0);
  const stackTop = dates.map((_, di) => visIdx.reduce((a, si) => a + (matrix[si][di] ?? 0), 0));
  const maxV = stacked ? Math.max(1, ...stackTop) : Math.max(1, ...visIdx.flatMap((si) => matrix[si].map((v) => v ?? 0)));
  const yTicks = scale === "share" && stacked ? [0, 20, 40, 60, 80, 100] : coverTicks(maxV, 5);
  const yTop = yTicks[yTicks.length - 1] || 1;
  const n = dates.length;
  const band = n ? w / n : 0;
  const x = (i: number) => (mode === "bar" ? i * band + band / 2 : n > 1 ? (i / (n - 1)) * w : w / 2);
  const y = (v: number) => h - (Math.min(v, yTop) / yTop) * h;
  const fmt = scale === "absolute" ? formatY : scale === "share" ? (v: number) => `${Math.round(v)}%` : (v: number) => String(Math.round(v));
  const clipId = `ts-clip-${useId().replace(/:/g, "")}`;
  const tickEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(w / 72))));

  const base = dates.map(() => 0);
  const layers = visIdx.map((si) => {
    const lower = [...base];
    const upper = dates.map((_, di) => (base[di] += matrix[si][di] ?? 0));
    return { si, lower, upper };
  });

  const rows =
    hover != null
      ? visIdx.map((si) => ({ s: series[si], v: matrix[si][hover] })).filter((r) => r.v != null).sort((a, b) => (b.v ?? 0) - (a.v ?? 0))
      : [];
  const line = (pts: [number, number][]) => (smooth ? smoothPath(pts) : pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(""));

  return (
    <div className={`ts${fill ? " ts-fill" : ""}`}>
      {showLegend && series.length > 1 && (
        <ul className="ts-legend">
          {series.map((s) => (
            <li key={s.key}>
              <button
                type="button"
                aria-pressed={!hidden.has(s.key)}
                onClick={() =>
                  setHidden((prev) => {
                    const next = new Set(prev);
                    if (next.has(s.key)) next.delete(s.key);
                    else next.add(s.key);
                    return next;
                  })
                }
                className={hidden.has(s.key) ? "is-off" : undefined}
              >
                <span className="ts-dot" style={{ background: s.color }} />
                {s.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div ref={ref} className="ts-box">
        {width > 0 && n > 0 && (
          <svg
            width={width}
            height={chartHeight}
            className="ts-svg"
            onMouseMove={(e) => {
              const px = e.clientX - e.currentTarget.getBoundingClientRect().left - m.left;
              const i = mode === "bar" ? Math.floor(px / (band || 1)) : Math.round((px / (w || 1)) * (n - 1));
              setHover(i >= 0 && i < n ? i : null);
            }}
            onMouseLeave={() => setHover(null)}
          >
            <defs>
              <clipPath id={clipId}>
                <rect x={-6} y={-6} width={w + 12} height={h + 6} />
              </clipPath>
            </defs>
            <g transform={`translate(${m.left},${m.top})`}>
              {yTicks.map((t) => (
                <g key={t}>
                  <line x1={0} x2={w} y1={y(t)} y2={y(t)} className="ts-grid" strokeDasharray={t === 0 ? undefined : "2 4"} />
                  <text x={-10} y={y(t)} dy="0.32em" textAnchor="end" className="ts-axis">
                    {fmt(t)}
                  </text>
                </g>
              ))}
              {dates.map((d, i) =>
                i % tickEvery === 0 ? (
                  <text key={d} x={x(i)} y={h + 19} textAnchor="middle" className="ts-axis">
                    {tickLabel(d, granularity)}
                  </text>
                ) : null
              )}

              <g clipPath={`url(#${clipId})`}>
                {mode === "bar" &&
                  layers.map(({ si, lower, upper }) => (
                    <g key={series[si].key}>
                      {dates.map((d, di) =>
                        upper[di] > lower[di] ? (
                          <rect
                            key={d}
                            x={x(di) - Math.max(1, band * 0.32)}
                            width={Math.max(2, band * 0.64)}
                            y={y(upper[di])}
                            height={Math.max(0, y(lower[di]) - y(upper[di]))}
                            style={{ fill: series[si].color }}
                            opacity={hover == null || hover === di ? 0.95 : 0.4}
                          />
                        ) : null
                      )}
                    </g>
                  ))}

                {mode === "area" &&
                  layers.map(({ si, lower, upper }) => {
                    const top = upper.map((v, i) => [x(i), y(v)] as [number, number]);
                    const bottom = lower.map((v, i) => [x(i), y(v)] as [number, number]).reverse();
                    const topPath = line(top);
                    const bottomPath = line(bottom).replace(/^M/, "L");
                    return (
                      <g key={series[si].key}>
                        <path d={`${topPath}${bottomPath}Z`} style={{ fill: series[si].color }} fillOpacity={visIdx.length > 1 ? 0.3 : 0.14} />
                        <path d={topPath} fill="none" style={{ stroke: series[si].color }} strokeWidth={2} strokeLinejoin="round" />
                      </g>
                    );
                  })}

                {mode === "line" &&
                  visIdx.map((si) => {
                    const pts = matrix[si].map((v, i) => (v == null ? null : ([x(i), y(v)] as [number, number]))).filter(Boolean) as [number, number][];
                    if (!pts.length) return null;
                    return <path key={series[si].key} d={line(pts)} fill="none" style={{ stroke: series[si].color }} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />;
                  })}

                {hover != null &&
                  mode !== "bar" &&
                  visIdx.map((si) => {
                    const v = stacked ? layers.find((l) => l.si === si)?.upper[hover] : matrix[si][hover];
                    return v == null ? null : <circle key={series[si].key} cx={x(hover)} cy={y(v)} r={4} style={{ fill: series[si].color }} className="ts-point" strokeWidth={2} />;
                  })}
              </g>
              {hover != null && mode !== "bar" && <line x1={x(hover)} x2={x(hover)} y1={0} y2={h} className="ts-cursor" />}
            </g>
          </svg>
        )}
        {n === 0 && <div className="ts-empty">No time series for this selection</div>}
        {hover != null && rows.length > 0 && (
          <div className="ts-tip" style={{ left: x(hover) + m.left > width - 220 ? x(hover) + m.left - 200 : x(hover) + m.left + 14 }}>
            <div className="ts-tip-date">{tickLabel(dates[hover], granularity)}</div>
            {rows.slice(0, 10).map((r) => (
              <div key={r.s.key} className="ts-tip-row">
                <span className="ts-tip-name">
                  <span className="ts-dot" style={{ background: r.s.color }} />
                  <span>{r.s.name}</span>
                </span>
                <span className="ts-tip-value">{scale === "absolute" ? Number(r.v).toLocaleString() : fmt(r.v!)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
