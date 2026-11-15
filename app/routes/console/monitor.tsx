import { useEffect, useMemo, useState } from "react";
import { Form, Link, redirect, useActionData, useFetcher, useNavigation, useRevalidator } from "react-router";
import type { Route } from "./+types/monitor";
import { CodeBlock } from "~/components/copy";
import { Autocomplete, Modal, Segmented, type Option } from "~/components/ui";
import PlaceInput, { type Place } from "~/map/PlaceInput";
import { API } from "~/lib/agents";
import { TIERS } from "~/lib/tiers";
import { getSessionUser } from "../../../server/auth";
import { spendable } from "../../../server/store";
import { createMonitor, deleteMonitor, listEvents, listMonitors, monitorAllowed, MonitorError, MONITOR_TIER, publicEvent, publicMonitor, scanNow, updateMonitor } from "../../../server/monitor";

export const meta = () => [{ title: "Monitor · EDK Console" }];

export async function loader({ request, context }: Route.LoaderArgs) {
  const db = context.cloudflare.env.DB;
  const user = await getSessionUser(db, request);
  if (!user) throw redirect("/login?next=/console/monitor");
  const a = await spendable(db, user.id);
  const allowed = monitorAllowed(a.tier.id);
  const [monitors, events] = allowed ? await Promise.all([listMonitors(db, user.id), listEvents(db, user.id, { limit: 60 })]) : [[], []];
  const need = TIERS.find((t) => t.id === MONITOR_TIER)!;
  return {
    allowed,
    tier: a.tier.name,
    need: { name: need.name, dollars: need.unlockDollars ?? 0 },
    mapboxToken: process.env.MAPBOX_API_KEY?.startsWith("pk.") ? process.env.MAPBOX_API_KEY : null,
    monitors: monitors.map((m) => publicMonitor(m, true)),
    events: events.map((e) => ({ ...publicEvent(e), monitor_name: e.monitor_name })),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const db = context.cloudflare.env.DB;
  const user = await getSessionUser(db, request);
  if (!user) throw redirect("/login?next=/console/monitor");
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const id = String(form.get("id") || "");
  try {
    if (intent === "create") {
      let artifacts: unknown = [];
      try {
        artifacts = JSON.parse(String(form.get("artifacts") || "[]"));
      } catch {
        /* handled by createMonitor */
      }
      const m = await createMonitor(db, user.id, null, {
        name: form.get("name") || undefined,
        artifacts,
        area: String(form.get("area") || ""),
        since: String(form.get("since") || ""),
        interval: Number(form.get("interval") || 60),
        prompt: String(form.get("prompt") || ""),
        webhook_url: String(form.get("webhook_url") || ""),
      });
      return { ok: `Watching ${m.region_name}. The first scan runs within five minutes.`, created: m.id };
    }
    if (intent === "scan") {
      const r = await scanNow(db, user.id, id);
      if ("error" in r && r.error) return { error: r.error };
      if (!("cu" in r)) return { error: "The scan did not run." };
      return { ok: `Scanned: ${r.kept} new event${r.kept === 1 ? "" : "s"}${r.kept ? ` (${r.cu} CU)` : ""}${r.webhook_status ? `, webhook answered ${r.webhook_status}` : ""}.${"errors" in r && r.errors ? ` ${r.errors.join(" ")}` : ""}` };
    }
    if (intent === "pause" || intent === "resume") {
      await updateMonitor(db, user.id, id, { status: intent === "pause" ? "paused" : "active" });
      return { ok: intent === "pause" ? "Paused." : "Resumed." };
    }
    if (intent === "webhook") {
      await updateMonitor(db, user.id, id, { webhook_url: String(form.get("webhook_url") || "") });
      return { ok: "Webhook saved." };
    }
    if (intent === "delete") {
      await deleteMonitor(db, user.id, id);
      return { ok: "Deleted." };
    }
    return { error: "Unknown action." };
  } catch (error) {
    return { error: error instanceof MonitorError ? error.message : "Something went wrong. Please try again." };
  }
}

const INTERVALS: [number, string][] = [[15, "15 min"], [60, "Hourly"], [360, "6 hours"], [1440, "Daily"]];
const intervalText = (m: number) => ({ 15: "Every 15 minutes", 60: "Hourly", 360: "Every 6 hours", 1440: "Daily" } as Record<number, string>)[m] ?? `Every ${m} minutes`;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
type Since = "now" | "day" | "week" | "month" | "date";
const SINCE: [Since, string][] = [["now", "From now"], ["day", "Last day"], ["week", "Last week"], ["month", "Last month"], ["date", "A date"]];

async function searchArtifacts(q: string, signal: AbortSignal): Promise<Option[]> {
  const res = await fetch(`/atlas/api/lenses?q=${encodeURIComponent(q)}`, { signal });
  const body = (await res.json()) as any;
  // OpenStreetMap places have no dates, so they cannot be watched.
  return (Array.isArray(body?.lenses) ? body.lenses : []).filter((l: any) => l.kind !== "places").map((l: any) => ({ id: l.id, label: l.name, detail: l.description }));
}

/** New monitor: four short steps, each asking one thing, with the defaults already chosen. */
function NewMonitor({ open, onClose, mapboxToken }: { open: boolean; onClose: () => void; mapboxToken: string | null }) {
  const fetcher = useFetcher<typeof action>();
  const [step, setStep] = useState(0);
  const [artifacts, setArtifacts] = useState<Option[]>([]);
  const [areaText, setAreaText] = useState("");
  const [place, setPlace] = useState<Place | null>(null);
  const [since, setSince] = useState<Since>("week");
  const [date, setDate] = useState(daysAgo(14));
  const [interval, setInterval] = useState(60);
  const [deliver, setDeliver] = useState<"console" | "webhook">("console");
  const [webhook, setWebhook] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [name, setName] = useState("");

  useEffect(() => {
    if (!open) return;
    setStep(0);
  }, [open]);
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && "created" in fetcher.data && fetcher.data.created) {
      setArtifacts([]);
      setAreaText("");
      setPlace(null);
      setWebhook("");
      setPrompt("");
      setName("");
      onClose();
    }
  }, [fetcher.state, fetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const sinceDate = since === "now" ? new Date().toISOString() : since === "day" ? daysAgo(1) : since === "week" ? daysAgo(7) : since === "month" ? daysAgo(30) : date;
  const area = place ? `${place.lat}, ${place.lng}` : areaText.trim();
  const areaLabel = place?.label ?? areaText.trim();
  const steps = ["What to watch", "Where", "When", "Where events go"];
  const ready = [artifacts.length > 0, area.length >= 2, since !== "date" || Boolean(date), deliver === "console" || /^https:\/\/.+\..+/.test(webhook.trim())];
  const last = step === steps.length - 1;
  const busy = fetcher.state !== "idle";
  const error = fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;

  const submit = () =>
    fetcher.submit(
      { intent: "create", artifacts: JSON.stringify(artifacts.map((a) => a.id)), area, since: sinceDate, interval: String(interval), webhook_url: deliver === "webhook" ? webhook.trim() : "", prompt, name },
      { method: "post" },
    );

  return (
    <Modal open={open} onClose={onClose} title="New monitor">
      <ol className="steps-bar" aria-label="Steps">
        {steps.map((s, i) => (
          <li key={s} className={i === step ? "is-on" : i < step ? "is-done" : ""}>
            <button type="button" disabled={i > step && !ready.slice(0, i).every(Boolean)} onClick={() => setStep(i)}><span>{i + 1}</span>{s}</button>
          </li>
        ))}
      </ol>

      <div className="modal-body">
        {step === 0 ? (
          <div className="wizard">
            <h3>What should EDK-1 watch for?</h3>
            <p>Pick up to five things that appear on the ground or in public records.</p>
            <Autocomplete value={artifacts} onChange={setArtifacts} search={searchArtifacts} placeholder="Building permit, pothole, construction…" autoFocus />
          </div>
        ) : step === 1 ? (
          <div className="wizard">
            <h3>Where?</h3>
            <p>A city, neighborhood or address. EDK-1 watches the city, county or state around it.</p>
            <div className="step-place">
              <PlaceInput value={areaText} onText={(t) => { setAreaText(t); setPlace(null); }} onPick={(p) => { setPlace(p); setAreaText(p.label); }} token={mapboxToken} placeholder="Pittsburgh" ariaLabel="Area" autoFocus types="place,city,locality,neighborhood,district,region,address" />
            </div>
          </div>
        ) : step === 2 ? (
          <div className="wizard">
            <h3>From when, and how often?</h3>
            <p>Events after this point are reported. Each new event is 0.2 CU.</p>
            <span className="step-label">Report events from</span>
            <Segmented label="Report events from" value={since} onChange={setSince} options={SINCE} />
            {since === "date" ? <input className="input" type="date" value={date} min={daysAgo(365)} max={daysAgo(0)} onChange={(e) => setDate(e.target.value)} style={{ marginTop: ".6rem", maxWidth: 200 }} /> : null}
            <span className="step-label">Scan</span>
            <Segmented label="Scan" value={interval} onChange={setInterval} options={INTERVALS} />
          </div>
        ) : (
          <div className="wizard">
            <h3>Where should new events go?</h3>
            <div className="choice-cards">
              <button type="button" className={deliver === "console" ? "is-on" : ""} onClick={() => setDeliver("console")}>
                <strong>This console</strong>
                <small>Events list under Monitor.</small>
              </button>
              <button type="button" className={deliver === "webhook" ? "is-on" : ""} onClick={() => setDeliver("webhook")}>
                <strong>Console and a webhook</strong>
                <small>Each batch is posted to your URL, signed.</small>
              </button>
            </div>
            {deliver === "webhook" ? <input className="input" type="url" value={webhook} onChange={(e) => setWebhook(e.target.value)} placeholder="https://example.com/edk-events" autoFocus style={{ marginTop: ".8rem" }} /> : null}
            {showMore ? (
              <div className="step-more">
                <label className="field"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={artifacts.length && areaLabel ? `${artifacts.map((a) => a.label).join(", ")} in ${areaLabel}` : "Optional"} /></label>
                <label className="field">
                  <span>Prompt</span>
                  <textarea className="textarea" rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={1000} placeholder="What matters to you about these events" />
                  <small>Saved with the monitor. It does not filter events yet.</small>
                </label>
              </div>
            ) : (
              <button type="button" className="link-btn" onClick={() => setShowMore(true)}>+ Name it, or add a prompt</button>
            )}
            <dl className="step-summary">
              <div><dt>Watching</dt><dd>{artifacts.map((a) => a.label).join(", ")}</dd></div>
              <div><dt>Where</dt><dd>{areaLabel}</dd></div>
              <div><dt>From</dt><dd>{since === "now" ? "Now on" : day(sinceDate)}, {intervalText(interval).toLowerCase()}</dd></div>
            </dl>
          </div>
        )}
        {error ? <div className="notice is-error" style={{ marginTop: "1rem" }}>{error}</div> : null}
      </div>

      <div className="modal-foot">
        {step > 0 ? <button type="button" className="btn btn-ghost" onClick={() => setStep(step - 1)}>Back</button> : <span />}
        {last ? (
          <button type="button" className="btn btn-primary" disabled={busy || !ready.every(Boolean)} onClick={submit}>{busy ? <><span className="spinner" /> Starting</> : "Start monitoring"}</button>
        ) : (
          <button type="button" className="btn btn-primary" disabled={!ready[step]} onClick={() => setStep(step + 1)}>Continue</button>
        )}
      </div>
    </Modal>
  );
}

export default function Monitor({ loaderData }: Route.ComponentProps) {
  const { allowed, tier, need, monitors, events, mapboxToken } = loaderData;
  const result = useActionData<typeof action>();
  const nav = useNavigation();
  const revalidator = useRevalidator();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const busy = nav.state !== "idle";

  // New events arrive while the page is open.
  useEffect(() => {
    if (!allowed) return;
    const t = window.setInterval(() => document.visibilityState === "visible" && revalidator.revalidate(), 30_000);
    return () => window.clearInterval(t);
  }, [allowed]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => (filter === "all" ? events : events.filter((e) => e.monitor_id === filter)), [events, filter]);

  if (!allowed) {
    return (
      <div className="console-page">
        <div className="console-head"><div><h1>Monitor</h1><p>Watch an area for new events and receive them as they appear.</p></div></div>
        <div className="panel mon-locked">
          <h2>Monitor opens at {need.name}</h2>
          <p>Pick what to watch, where and since when. EDK-1 scans on your interval and sends every new event here and to your webhook. It is available once ${need.dollars.toLocaleString("en-US")} in credits has been added. This account is on {tier}.</p>
          <Link className="btn btn-primary" to="/console/billing">Add credits</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="console-page">
      <div className="console-head">
        <div>
          <h1>Monitor</h1>
          <p>Watch an area for new events. Each new event is 0.2 CU.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>New monitor</button>
      </div>

      {result && "error" in result && result.error ? <div className="notice is-error" style={{ marginBottom: "1rem" }}>{result.error}</div> : null}
      {result && "ok" in result && result.ok ? <div className="notice is-ok" style={{ marginBottom: "1rem" }}>{result.ok}</div> : null}

      <NewMonitor open={creating} onClose={() => setCreating(false)} mapboxToken={mapboxToken} />

      {monitors.length ? (
        <div className="mon-rows">
          {monitors.map((m) => {
            const expanded = openId === m.id;
            return (
              <section key={m.id} className={`mon-row${expanded ? " is-open" : ""}`}>
                <button type="button" className="mon-row-main" aria-expanded={expanded} onClick={() => setOpenId(expanded ? null : m.id)}>
                  <i className={`mon-dot${m.status === "active" ? " is-live" : ""}`} aria-hidden="true" />
                  <span className="mon-row-name">
                    <strong>{m.name}</strong>
                    <small>{m.area.name} · {intervalText(m.interval_minutes)}</small>
                  </span>
                  <span className="mon-row-stat"><strong>{m.events}</strong><small>events</small></span>
                  <span className="mon-row-stat"><strong>{when(m.last_run_at)}</strong><small>last scan</small></span>
                  <svg className="mon-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                </button>
                {expanded ? (
                  <div className="mon-row-body">
                    <div className="row">{m.artifacts.map((a) => <span key={a.id} className="chip">{a.name}</span>)}</div>
                    {m.status_reason ? <p className="notice">{m.status_reason}</p> : null}
                    {m.prompt ? <p className="mon-prompt">{m.prompt}</p> : null}
                    <dl className="mon-facts">
                      <div><dt>Since</dt><dd>{day(m.since)}</dd></div>
                      <div><dt>Next scan</dt><dd>{m.status === "active" ? when(m.next_run_at) : "Paused"}</dd></div>
                      <div><dt>Webhook</dt><dd>{m.webhook_url ? new URL(m.webhook_url).host : "Console only"}</dd></div>
                    </dl>
                    <Form method="post" className="mon-webhook-form">
                      <input type="hidden" name="intent" value="webhook" />
                      <input type="hidden" name="id" value={m.id} />
                      <input className="input" name="webhook_url" type="url" defaultValue={m.webhook_url ?? ""} placeholder="https://example.com/edk-events" />
                      <button className="btn btn-sm" type="submit" disabled={busy}>Save webhook</button>
                    </Form>
                    {m.webhook_url ? (
                      <details className="mon-secret-box">
                        <summary>Signing secret</summary>
                        <p className="muted">Each request carries <code>x-edk-signature: t=…,v1=…</code>, the HMAC-SHA256 of <code>{"<t>.<body>"}</code> with this secret.</p>
                        <code className="mon-secret">{m.webhook_secret}</code>
                      </details>
                    ) : null}
                    <div className="row">
                      <Form method="post"><input type="hidden" name="id" value={m.id} /><button className="btn btn-sm" name="intent" value="scan" disabled={busy || m.status !== "active"}>Scan now</button></Form>
                      <Form method="post"><input type="hidden" name="id" value={m.id} /><button className="btn btn-sm" name="intent" value={m.status === "active" ? "pause" : "resume"} disabled={busy}>{m.status === "active" ? "Pause" : "Resume"}</button></Form>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setFilter(m.id)}>Show its events</button>
                      <Form method="post" style={{ marginLeft: "auto" }} onSubmit={(e) => { if (!confirm(`Delete "${m.name}"? Its events stay in your history.`)) e.preventDefault(); }}><input type="hidden" name="id" value={m.id} /><button className="btn btn-sm btn-ghost btn-danger" name="intent" value="delete" disabled={busy}>Delete</button></Form>
                    </div>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="panel mon-empty">
          <h2>Nothing watched yet</h2>
          <p>Pick something to watch, like new building permits or potholes, an area, and a start date. New events show up here and at your webhook.</p>
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>New monitor</button>
        </div>
      )}

      {monitors.length ? (
        <section className="panel" style={{ marginTop: "1.5rem" }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>Events</h2>
            <select className="select" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: "auto" }}>
              <option value="all">All monitors</option>
              {monitors.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          {shown.length ? (
            <ul className="event-list">
              {shown.map((e) => (
                <li key={e.id}>
                  {e.image_url ? <span className="event-thumb" style={{ backgroundImage: `url("${e.image_url}")` }} /> : <span className="event-thumb is-empty" />}
                  <span className="event-main">
                    <strong>{e.title || e.artifact.name}</strong>
                    <small>{[e.address || (e.location ? `${e.location.lat.toFixed(4)}, ${e.location.lng.toFixed(4)}` : null), e.monitor_name].filter(Boolean).join(" · ")}</small>
                  </span>
                  <span className="event-when"><strong>{day(e.occurred_at)}</strong><small>found {when(e.detected_at)}</small></span>
                  <span className={`event-delivery${e.delivery?.at ? " is-ok" : e.delivery ? " is-bad" : ""}`} title={e.delivery ? `Webhook ${e.delivery.status}` : "Console only"}>{e.delivery ? (e.delivery.at ? "Sent" : "Failed") : ""}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted" style={{ marginTop: "1rem" }}>New events appear here as monitors find them. This page refreshes every 30 seconds.</p>
          )}
        </section>
      ) : null}

      <details className="panel dev-box" style={{ marginTop: "1.5rem" }}>
        <summary>Developers</summary>
        <CodeBlock label="curl" code={`curl -X POST ${API}/v1/monitors \\\n  -H "Authorization: Bearer $EDK_API_KEY" \\\n  -H "content-type: application/json" \\\n  -d '{ "artifacts": ["Building Permit"], "area": "Pittsburgh", "since": "${daysAgo(7)}", "interval": "1h", "webhook_url": "https://example.com/edk-events" }'`} />
      </details>
    </div>
  );
}
