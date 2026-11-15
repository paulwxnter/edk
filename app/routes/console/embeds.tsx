import { useEffect, useState } from "react";
import { Form, redirect, useActionData, useFetcher, useNavigation } from "react-router";
import type { Route } from "./+types/embeds";
import { CodeBlock, useCopy } from "~/components/copy";
import { Modal } from "~/components/ui";
import { EMBED } from "~/lib/agents";
import { DEFAULT_EMBED_DAILY, DEFAULT_RESULT_DAILY, LOAD_CU, MAX_EMBED_DAILY, normalizeOrigin, SITE_PRESETS } from "~/lib/embeds";
import { getSessionUser } from "../../../server/auth";
import { createApiKey, listApiKeys, revokeApiKey, updateEmbedKey } from "../../../server/store";
import { embedScope, getShareSettings, loadsToday, resultScope, saveShareSettings } from "../../../server/embed";

export const meta = () => [{ title: "Embeds · EDK Console" }];

export async function loader({ request, context }: Route.LoaderArgs) {
  const db = context.cloudflare.env.DB;
  const user = await getSessionUser(db, request);
  if (!user) throw redirect("/login?next=/console/embeds");
  const keys = (await listApiKeys(db, user.id)).filter((k) => k.kind === "publishable");
  const [loads, share, resultLoads] = await Promise.all([Promise.all(keys.map((k) => loadsToday(db, embedScope(k.id)))), getShareSettings(db, user.id), loadsToday(db, resultScope(user.id))]);
  return {
    embeds: keys.map((k, i) => ({ id: k.id, name: k.name, prefix: k.prefix, origins: k.allowed_origins ? k.allowed_origins.split(",") : [], cap: k.daily_load_cap ?? DEFAULT_EMBED_DAILY, loads: loads[i], created_at: k.created_at })),
    share: { ...share, cap: share.result_link_daily_cap ?? DEFAULT_RESULT_DAILY, loads: resultLoads },
  };
}

const parseCap = (v: FormDataEntryValue | null, fallback: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_EMBED_DAILY) : fallback;
};
const parseOrigins = (v: FormDataEntryValue | null) => {
  const list = String(v || "").split(/[\s,]+/).filter(Boolean);
  const out: string[] = [];
  for (const raw of list) {
    const o = normalizeOrigin(raw);
    if (!o) return { error: `"${raw}" is not a site like https://example.com` };
    out.push(o);
  }
  return { origins: Array.from(new Set(out)).slice(0, 30) };
};

export async function action({ request, context }: Route.ActionArgs) {
  const db = context.cloudflare.env.DB;
  const user = await getSessionUser(db, request);
  if (!user) throw redirect("/login?next=/console/embeds");
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const id = String(form.get("id") || "");
  if (intent === "create") {
    const parsed = parseOrigins(form.get("origins"));
    if ("error" in parsed) return { error: parsed.error };
    if (!parsed.origins.length) return { error: "Add at least one site that may show this map." };
    const existing = await listApiKeys(db, user.id);
    if (existing.length >= 25) return { error: "You can have up to 25 keys. Remove one first." };
    const created = await createApiKey(db, user.id, String(form.get("name") || "").trim() || "Embed", "publishable", parsed.origins);
    await updateEmbedKey(db, user.id, created.id, { daily_load_cap: parseCap(form.get("cap"), DEFAULT_EMBED_DAILY) });
    return { created: { id: created.id, key: created.key } };
  }
  if (intent === "save") {
    const parsed = parseOrigins(form.get("origins"));
    if ("error" in parsed) return { error: parsed.error };
    if (!parsed.origins.length) return { error: "Keep at least one site, or remove the embed." };
    await updateEmbedKey(db, user.id, id, { origins: parsed.origins, daily_load_cap: parseCap(form.get("cap"), DEFAULT_EMBED_DAILY), name: String(form.get("name") || "").trim() });
    return { ok: "Saved." };
  }
  if (intent === "remove") {
    await revokeApiKey(db, user.id, id);
    return { ok: "Removed. Pages using it stop loading." };
  }
  if (intent === "share") {
    await saveShareSettings(db, user.id, { result_links: form.get("result_links") === "on", result_link_daily_cap: parseCap(form.get("cap"), DEFAULT_RESULT_DAILY) });
    return { ok: "Saved." };
  }
  return { error: "Unknown action." };
}

/** Allowed sites: presets for ChatGPT, Claude and this computer, plus any site typed in. */
function SitesField({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = (raw: string) => {
    const parts = raw.split(/[\s,]+/).filter(Boolean);
    const next = [...value];
    for (const p of parts) {
      const o = normalizeOrigin(p);
      if (!o) return setError(`"${p}" is not a site like https://example.com`);
      if (!next.includes(o)) next.push(o);
    }
    setError(null);
    setText("");
    onChange(next);
  };
  return (
    <div className="sites">
      <div className="sites-presets">
        {SITE_PRESETS.map((p) => {
          const on = p.origins.every((o) => value.includes(o));
          return (
            <button key={p.id} type="button" className={`site-preset${on ? " is-on" : ""}`} aria-pressed={on} onClick={() => onChange(on ? value.filter((o) => !p.origins.includes(o)) : Array.from(new Set([...value, ...p.origins])))}>
              <strong>{on ? "✓ " : "+ "}{p.label}</strong>
              <small>{p.note}</small>
            </button>
          );
        })}
      </div>
      <div className="sites-add">
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (text.trim()) add(text); } }} placeholder="https://example.com or https://*.example.com" aria-label="Add a site" />
        <button type="button" className="btn" disabled={!text.trim()} onClick={() => add(text)}>Add</button>
      </div>
      {error ? <small className="sites-error">{error}</small> : null}
      {value.length ? (
        <ul className="sites-list">
          {value.map((o) => (
            <li key={o}><code>{o}</code><button type="button" aria-label={`Remove ${o}`} onClick={() => onChange(value.filter((x) => x !== o))}>×</button></li>
          ))}
        </ul>
      ) : <small className="muted">No sites yet. The map loads nowhere until you add one.</small>}
    </div>
  );
}

const snippet = (key: string) => `<iframe src="${EMBED}/?key=${key}&q=parks+in+Austin" width="100%" height="480" style="border:0" loading="lazy"></iframe>`;

function NewEmbed({ open, onClose }: { open: boolean; onClose: () => void }) {
  const fetcher = useFetcher<typeof action>();
  const [name, setName] = useState("");
  const [sites, setSites] = useState<string[]>([]);
  const [cap, setCap] = useState(DEFAULT_EMBED_DAILY);
  const { copied, copy } = useCopy();
  const created = fetcher.data && "created" in fetcher.data ? fetcher.data.created : null;
  const error = fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;
  const close = () => {
    setName("");
    setSites([]);
    setCap(DEFAULT_EMBED_DAILY);
    onClose();
  };
  return (
    <Modal open={open} onClose={close} title={created ? "Your embed is ready" : "New embed"}>
      <div className="modal-body">
        {created ? (
          <div className="wizard">
            <p>Copy the key now; it is shown once. Paste this where the map should appear:</p>
            <div className="key-reveal"><code>{created.key}</code><button type="button" className="btn btn-sm" onClick={() => copy(created.key)}>{copied ? "Copied" : "Copy"}</button></div>
            <CodeBlock label="HTML" code={snippet(created.key)} />
          </div>
        ) : (
          <div className="wizard">
            <label className="field"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Docs site" maxLength={60} autoFocus /></label>
            <div className="field">
              <span>Where it may appear</span>
              <SitesField value={sites} onChange={setSites} />
            </div>
            <label className="field">
              <span>Loads a day</span>
              <input className="input" type="number" min={1} max={MAX_EMBED_DAILY} value={cap} onChange={(e) => setCap(Math.max(1, Math.min(MAX_EMBED_DAILY, Number(e.target.value) || 1)))} style={{ maxWidth: 160 }} />
              <small>Each load is {LOAD_CU} CU, up to {(cap * LOAD_CU).toLocaleString("en-US")} CU a day. Searches inside the map are billed like the API.</small>
            </label>
            {error ? <div className="notice is-error">{error}</div> : null}
          </div>
        )}
      </div>
      <div className="modal-foot">
        <span />
        {created ? (
          <button type="button" className="btn btn-primary" onClick={close}>Done</button>
        ) : (
          <button type="button" className="btn btn-primary" disabled={fetcher.state !== "idle" || !sites.length} onClick={() => fetcher.submit({ intent: "create", name, origins: sites.join(","), cap: String(cap) }, { method: "post" })}>
            {fetcher.state !== "idle" ? <><span className="spinner" /> Creating</> : "Create embed"}
          </button>
        )}
      </div>
    </Modal>
  );
}

function EmbedRow({ e }: { e: Route.ComponentProps["loaderData"]["embeds"][number] }) {
  const [open, setOpen] = useState(false);
  const [sites, setSites] = useState(e.origins);
  const nav = useNavigation();
  useEffect(() => setSites(e.origins), [e.origins.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const pct = Math.min(100, Math.round((e.loads / e.cap) * 100));
  return (
    <section className={`mon-row${open ? " is-open" : ""}`}>
      <button type="button" className="mon-row-main" aria-expanded={open} onClick={() => setOpen(!open)}>
        <i className={`mon-dot${e.origins.length ? " is-live" : ""}`} aria-hidden="true" />
        <span className="mon-row-name">
          <strong>{e.name}</strong>
          <small>{e.origins.length ? `${e.origins.length} site${e.origins.length === 1 ? "" : "s"} · ${e.prefix}` : "No sites: loads nowhere"}</small>
        </span>
        <span className="mon-row-stat embed-meter"><strong>{e.loads.toLocaleString("en-US")} / {e.cap.toLocaleString("en-US")}</strong><small>loads today</small><i style={{ width: `${pct}%` }} /></span>
        <svg className="mon-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open ? (
        <Form method="post" className="mon-row-body">
          <input type="hidden" name="intent" value="save" />
          <input type="hidden" name="id" value={e.id} />
          <input type="hidden" name="origins" value={sites.join(",")} />
          <label className="field"><span>Name</span><input className="input" name="name" defaultValue={e.name} maxLength={60} /></label>
          <div className="field"><span>Where it may appear</span><SitesField value={sites} onChange={setSites} /></div>
          <label className="field">
            <span>Loads a day</span>
            <input className="input" name="cap" type="number" min={1} max={MAX_EMBED_DAILY} defaultValue={e.cap} style={{ maxWidth: 160 }} />
            <small>{LOAD_CU} CU a load. Past the limit the map shows a notice until tomorrow.</small>
          </label>
          <CodeBlock label="HTML" code={snippet(`${e.prefix.split("…")[0]}…`)} />
          <div className="row">
            <button className="btn btn-primary btn-sm" type="submit" disabled={nav.state !== "idle"}>Save</button>
            <button className="btn btn-sm btn-ghost btn-danger" type="submit" name="intent" value="remove" style={{ marginLeft: "auto" }} onClick={(ev) => { if (!confirm(`Remove "${e.name}"? Pages using it stop loading.`)) ev.preventDefault(); }}>Remove</button>
          </div>
        </Form>
      ) : null}
    </section>
  );
}

export default function Embeds({ loaderData }: Route.ComponentProps) {
  const { embeds, share } = loaderData;
  const result = useActionData<typeof action>();
  const nav = useNavigation();
  const [creating, setCreating] = useState(false);
  return (
    <div className="console-page">
      <div className="console-head">
        <div>
          <h1>Embeds</h1>
          <p>Put the Atlas in your site, or let ChatGPT and Claude show it. Each load is {LOAD_CU} CU, under a daily limit you set.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>New embed</button>
      </div>

      {result && "error" in result && result.error ? <div className="notice is-error" style={{ marginBottom: "1rem" }}>{result.error}</div> : null}
      {result && "ok" in result && result.ok ? <div className="notice is-ok" style={{ marginBottom: "1rem" }}>{result.ok}</div> : null}

      <NewEmbed open={creating} onClose={() => setCreating(false)} />

      {embeds.length ? (
        <div className="mon-rows">{embeds.map((e) => <EmbedRow key={e.id} e={e} />)}</div>
      ) : (
        <div className="panel mon-empty">
          <h2>No embeds yet</h2>
          <p>An embed is a live map for one or more sites you choose: your own pages, this computer while you build, or ChatGPT and Claude. Nothing else can load it.</p>
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>New embed</button>
        </div>
      )}

      <Form method="post" className="panel share-panel" style={{ marginTop: "1.5rem" }}>
        <input type="hidden" name="intent" value="share" />
        <div className="share-head">
          <div>
            <h2>Shared result links</h2>
            <p className="muted">Every Discover call returns an <code>embed_url</code> that opens its results on a read-only map. Agents share these in chat. Each load is {LOAD_CU} CU.</p>
          </div>
          <label className="switch"><input type="checkbox" name="result_links" defaultChecked={share.result_links} /><span aria-hidden="true" /><b>On</b></label>
        </div>
        <div className="share-foot">
          <label className="field">
            <span>Loads a day, across all links</span>
            <input className="input" name="cap" type="number" min={1} max={MAX_EMBED_DAILY} defaultValue={share.cap} style={{ maxWidth: 160 }} />
          </label>
          <span className="mon-row-stat embed-meter"><strong>{share.loads.toLocaleString("en-US")} / {share.cap.toLocaleString("en-US")}</strong><small>loads today</small><i style={{ width: `${Math.min(100, Math.round((share.loads / share.cap) * 100))}%` }} /></span>
          <button className="btn btn-sm" type="submit" disabled={nav.state !== "idle"}>Save</button>
        </div>
      </Form>
    </div>
  );
}
