import { useState } from "react";
import { useRevalidator } from "react-router";
import type { Route } from "./+types/playground";
import { CodeBlock } from "~/components/copy";
import { API } from "~/lib/agents";
import { getSettings } from "../../../server/store";
import { getSessionUser } from "../../../server/auth";

export const meta = () => [{ title: "Playground · EDK Console" }];

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = await getSessionUser(context.cloudflare.env.DB, request);
  const settings = user ? await getSettings(context.cloudflare.env.DB, user.id) : null;
  return { maxResults: settings?.max_results ?? null };
}

const EXAMPLES = ["bridges in Pittsburgh", "parks with playgrounds in Austin", "high income areas in Denver", "solar farms near Phoenix", "is 1600 Pennsylvania Ave flood prone?"];

type Response = { id: string; embed_url: string; usage: { locations: number; areas: number; cu: number }; data: any };

export default function Playground({ loaderData }: Route.ComponentProps) {
  const revalidator = useRevalidator();
  const [query, setQuery] = useState(EXAMPLES[0]);
  const [limit, setLimit] = useState(10);
  const [answer, setAnswer] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<Response | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const max = loaderData.maxResults ?? 60;

  async function run(e?: React.FormEvent) {
    e?.preventDefault();
    if (!query.trim() || busy) return;
    setBusy(true);
    setError(null);
    const started = performance.now();
    try {
      const r = await fetch("/console/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, limit, answer }) });
      const body = (await r.json()) as any;
      if (!r.ok) throw new Error(body?.error || `Request failed (${r.status})`);
      setRes(body);
      setElapsed(Math.round(performance.now() - started));
      revalidator.revalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  const curl = `curl -X POST ${API}/v1/search \\\n  -H "Authorization: Bearer $EDK_API_KEY" \\\n  -H "content-type: application/json" \\\n  -d '${JSON.stringify({ query, limit, ...(answer ? {} : { answer: false }) })}'`;
  const features: any[] = res?.data?.geojson?.features ?? [];

  return (
    <div className="console-page">
      <div className="console-head">
        <div>
          <h1>Playground</h1>
          <p>Run a search against the live API. Each CU covers five locations or areas, like any API call.</p>
        </div>
      </div>
      <div className="playground">
        <form className="panel pg-form" onSubmit={run}>
          <label className="field">
            <span>Query</span>
            <textarea className="textarea" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={500} rows={2} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run(); }} />
          </label>
          <div className="row">
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" className="btn btn-sm" onClick={() => setQuery(ex)}>{ex}</button>
            ))}
          </div>
          <div className="pg-bar">
            <label className="field" style={{ width: 120 }}>
              <span>Limit</span>
              <input className="input" type="number" min={1} max={max} value={limit} onChange={(e) => setLimit(Math.max(1, Math.min(max, Number(e.target.value) || 1)))} />
            </label>
            <label className="row" style={{ height: 40, color: "var(--fg-muted)", fontSize: ".88rem" }}>
              <input type="checkbox" checked={answer} onChange={(e) => setAnswer(e.target.checked)} /> Written answer
            </label>
            <span className="faint" style={{ fontSize: ".82rem", height: 40, display: "flex", alignItems: "center" }}>Up to {Math.ceil(limit / 5)} CU</span>
            <button className="btn btn-primary btn-lg" type="submit" disabled={busy || !query.trim()} style={{ marginLeft: "auto" }}>{busy ? <><span className="spinner" /> Searching…</> : "Run search"}</button>
          </div>
          {error ? <div className="notice is-error">{error}</div> : null}
        </form>

        {res ? (
          <>
            <div className="panel">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div className="row">
                  <span className="tag is-moss">200</span>
                  <span className="mono faint" style={{ fontSize: ".78rem" }}>{elapsed} ms · {res.usage.locations} locations · {res.usage.areas} areas · {res.usage.cu} CU</span>
                </div>
                <div className="row">
                  <a className="btn btn-sm" href={res.embed_url} target="_blank" rel="noreferrer">Open on the map ↗</a>
                </div>
              </div>
              {res.data.answer ? <div className="answer" style={{ marginTop: "1rem" }}>{res.data.answer}</div> : null}
            </div>
            <div className="pg-out">
              <div className="results">
                {features.map((f, i) => (
                  <div className="result" key={i}>
                    <span className="result-thumb" style={f.properties.image_url ? { backgroundImage: `url("${f.properties.image_url}")` } : undefined} />
                    <span style={{ minWidth: 0 }}>
                      <strong>{i + 1}. {f.properties.address || f.properties.name || f.properties.feature_name || "Result"}</strong>
                      <small>{[f.properties.feature_name, f.properties.neighborhood || f.properties.district, f.properties.date ? String(f.properties.date).slice(0, 10) : null].filter(Boolean).join(" · ")}</small>
                      <small className="mono">{f.geometry?.coordinates?.[1]?.toFixed(4)}, {f.geometry?.coordinates?.[0]?.toFixed(4)}</small>
                    </span>
                  </div>
                ))}
                {!features.length ? <p className="muted">No results. Try a place or a physical feature.</p> : null}
              </div>
              <div className="pg-json"><pre>{JSON.stringify(res, null, 2)}</pre></div>
            </div>
          </>
        ) : null}

        <div className="panel">
          <h2>Same call from your code</h2>
          <p>Create a key under API Keys, set it as EDK_API_KEY, and run:</p>
          <CodeBlock code={curl} label="curl" />
        </div>
      </div>
    </div>
  );
}
