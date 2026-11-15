import { useEffect, useId, useRef, useState } from "react";
import { formatSourceCell, type SourcePage } from "lib/signals/types";

const PAGE_SIZE = 25;
const EXPORT_MAX = 5000;

type Range = { from: string; to: string };
const NO_RANGE: Range = { from: "", to: "" };

/** Data Viewer: the rows behind a signal in a place, filterable by date and exportable. */
export default function SignalSource({ feature, region, place }: { feature: string; region: string; place: string }) {
  const [page, setPage] = useState(1);
  const [range, setRange] = useState<Range>(NO_RANGE);
  const [draft, setDraft] = useState<Range>(NO_RANGE);
  const [data, setData] = useState<SourcePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const exportDialog = useRef<HTMLDialogElement>(null);

  const params = (extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({ feature, region, ...extra });
    if (range.from) p.set("from", range.from);
    if (range.to) p.set("to", range.to);
    return p;
  };
  const url = `/signals/api/source?${params({ page: String(page) })}`;

  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    setLoading(true);
    fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Could not load records.");
        return response.json() as Promise<SourcePage>;
      })
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [url, retry]);

  const applyRange = (next: Range) => {
    setRange(next);
    setDraft(next);
    setPage(1);
  };
  const filtered = Boolean(range.from || range.to);
  const invalidRange = Boolean(draft.from && draft.to && draft.from > draft.to);
  const first = (page - 1) * PAGE_SIZE + 1;

  if (failed && !data) {
    return (
      <div className="sd-state" role="status">
        <p>Could not load the records for this signal.</p>
        <button type="button" className="btn btn-sm" onClick={() => setRetry(retry + 1)}>Try again</button>
      </div>
    );
  }
  if (!data) return <div className="sd-state" role="status"><span className="spinner faint" /> Loading records…</div>;
  if (!data.columns.length) return <div className="sd-state"><p>No records are published for this signal in {place} yet.</p></div>;

  return (
    <div className="sd-viewer">
      <div className="sd-toolbar">
        <div className="sd-toolbar-title">
          <h3>{data.title ?? "Records"}</h3>
          <p className="mono">
            {data.rows.length ? `Rows ${first.toLocaleString()}–${(first + data.rows.length - 1).toLocaleString()}` : "No rows"}
            {filtered ? ` · ${range.from || "start"} → ${range.to || "latest"}` : " · newest first"}
          </p>
        </div>
        <div className="sd-toolbar-actions">
          {data.dated && (
            <form className="sd-range" onSubmit={(e) => { e.preventDefault(); if (!invalidRange) applyRange(draft); }}>
              <label>
                <span>From</span>
                <input className="input" type="date" value={draft.from} max={draft.to || undefined} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
              </label>
              <label>
                <span>To</span>
                <input className="input" type="date" value={draft.to} min={draft.from || undefined} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
              </label>
              <button type="submit" className="btn btn-sm" disabled={invalidRange || (draft.from === range.from && draft.to === range.to)}>Apply</button>
              {filtered && <button type="button" className="btn btn-sm btn-ghost" onClick={() => applyRange(NO_RANGE)}>Clear</button>}
            </form>
          )}
          <button type="button" className="btn btn-primary sd-export-btn" onClick={() => exportDialog.current?.showModal()} disabled={!data.rows.length}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" /></svg>
            Export
          </button>
        </div>
      </div>

      {data.rows.length ? (
        <div className={`sd-table-wrap${loading ? " is-loading" : ""}`} tabIndex={0} role="region" aria-label="Records table">
          <table className="sd-table">
            <thead>
              <tr>
                <th scope="col" className="sd-num-col">#</th>
                {data.columns.map((column) => <th key={column.key} scope="col" className={isNumeric(column.kind) ? "is-num" : undefined}>{column.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, index) => (
                <tr key={index}>
                  <td className="sd-num-col mono">{first + index}</td>
                  {row.map((value, cell) => {
                    const column = data.columns[cell];
                    const kind = column.kind;
                    return (
                      <td key={column.key} className={isNumeric(kind) ? "is-num mono" : kind === "date" || kind === "month" ? "is-date mono" : undefined}>
                        {kind === "date" || kind === "month" || isNumeric(kind) ? formatSourceCell(value, kind) : <span className="sd-text" title={value ?? undefined}>{formatSourceCell(value, kind)}</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="sd-state"><p>{filtered ? "No records in this date range." : "No records on this page."}</p>{filtered && <button type="button" className="btn btn-sm" onClick={() => applyRange(NO_RANGE)}>Clear dates</button>}</div>
      )}

      <nav className="sd-pager" aria-label="Record pages">
        <button className="btn btn-sm" type="button" disabled={page === 1 || loading} onClick={() => setPage(page - 1)}>← Previous</button>
        <span className="mono">Page {page}{loading ? " · loading" : ""}</span>
        <button className="btn btn-sm" type="button" disabled={!data.hasMore || loading} onClick={() => setPage(page + 1)}>Next →</button>
      </nav>

      <ExportDialog dialog={exportDialog} feature={feature} region={region} place={place} page={page} range={range} dated={Boolean(data.dated)} />
    </div>
  );
}

const isNumeric = (kind: string | undefined) => kind === "number" || kind === "percent" || kind === "score" || kind === "bytes";

function ExportDialog({ dialog, feature, region, place, page, range, dated }: { dialog: React.RefObject<HTMLDialogElement | null>; feature: string; region: string; place: string; page: number; range: Range; dated: boolean }) {
  const titleId = useId();
  const [format, setFormat] = useState<"csv" | "json">("csv");
  const [scope, setScope] = useState<"page" | "all">("all");
  const [dates, setDates] = useState<Range>(range);
  // Open with the dates the viewer is filtered to.
  useEffect(() => setDates(range), [range]);
  const invalid = Boolean(dates.from && dates.to && dates.from > dates.to);

  const href = (() => {
    const p = new URLSearchParams({ feature, region, format, scope, page: String(scope === "page" ? page : 1) });
    if (dated && dates.from) p.set("from", dates.from);
    if (dated && dates.to) p.set("to", dates.to);
    return `/signals/api/source?${p}`;
  })();

  return (
    <dialog ref={dialog} className="sd-export" aria-labelledby={titleId}>
      <header>
        <h2 id={titleId}>Export data</h2>
        <p>{place}</p>
      </header>
      <fieldset>
        <legend>Rows</legend>
        <div className="sd-choice">
          <label className={scope === "all" ? "is-on" : undefined}>
            <input type="radio" name="sd-scope" checked={scope === "all"} onChange={() => setScope("all")} />
            <strong>All matching rows</strong>
            <small>Up to {EXPORT_MAX.toLocaleString()} rows, newest first</small>
          </label>
          <label className={scope === "page" ? "is-on" : undefined}>
            <input type="radio" name="sd-scope" checked={scope === "page"} onChange={() => setScope("page")} />
            <strong>Current page</strong>
            <small>Page {page}, {PAGE_SIZE} rows</small>
          </label>
        </div>
      </fieldset>
      {dated && (
        <fieldset>
          <legend>Date range <span className="faint">(optional)</span></legend>
          <div className="sd-export-dates">
            <label><span>From</span><input className="input" type="date" value={dates.from} max={dates.to || undefined} onChange={(e) => setDates({ ...dates, from: e.target.value })} /></label>
            <label><span>To</span><input className="input" type="date" value={dates.to} min={dates.from || undefined} onChange={(e) => setDates({ ...dates, to: e.target.value })} /></label>
            {(dates.from || dates.to) && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDates(NO_RANGE)}>Any date</button>}
          </div>
          {invalid && <p className="sd-error">The start date is after the end date.</p>}
        </fieldset>
      )}
      <fieldset>
        <legend>Format</legend>
        <div className="seg trend-seg" role="group" aria-label="Format">
          <button type="button" className={format === "csv" ? "is-on" : undefined} aria-pressed={format === "csv"} onClick={() => setFormat("csv")}>CSV</button>
          <button type="button" className={format === "json" ? "is-on" : undefined} aria-pressed={format === "json"} onClick={() => setFormat("json")}>JSON</button>
        </div>
      </fieldset>
      <footer>
        <form method="dialog"><button className="btn" type="submit">Cancel</button></form>
        {invalid ? (
          <button className="btn btn-primary" type="button" disabled>Download</button>
        ) : (
          <a className="btn btn-primary" href={href} download onClick={() => dialog.current?.close()}>Download {format.toUpperCase()}</a>
        )}
      </footer>
    </dialog>
  );
}
