import { useEffect, useState } from "react";
import { Form, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/keys";
import { useCopy } from "~/components/copy";
import { EMBED } from "~/lib/agents";
import { getSessionUser } from "../../../server/auth";
import { createApiKey, listApiKeys, revokeApiKey } from "../../../server/store";

export const meta = () => [{ title: "API Keys · EDK Console" }];

async function requireUser(request: Request, db: D1Database) {
  const user = await getSessionUser(db, request);
  if (!user) throw new Response("Unauthorized", { status: 401 });
  return user;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = await requireUser(request, context.cloudflare.env.DB);
  return { keys: await listApiKeys(context.cloudflare.env.DB, user.id) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const db = context.cloudflare.env.DB;
  const user = await requireUser(request, db);
  const form = await request.formData();
  if (form.get("intent") === "revoke") {
    await revokeApiKey(db, user.id, String(form.get("id")));
    return { revoked: true as const };
  }
  const kind = form.get("kind") === "publishable" ? "publishable" : "secret";
  const origins = String(form.get("origins") || "").split(/[\s,]+/).filter(Boolean);
  for (const o of origins) {
    if (!/^https?:\/\/(\*\.)?[a-z0-9.-]+(:\d+)?$/i.test(o.replace(/\/+$/, ""))) return { error: `"${o}" is not an origin like https://example.com` };
  }
  const existing = await listApiKeys(db, user.id);
  if (existing.length >= 25) return { error: "You can have up to 25 keys. Revoke one first." };
  const created = await createApiKey(db, user.id, String(form.get("name") || "").trim() || (kind === "secret" ? "Secret key" : "Embed key"), kind, origins);
  return { created: { key: created.key, kind } };
}

const fmt = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Never");

export default function Keys({ loaderData }: Route.ComponentProps) {
  const data = useActionData<typeof action>();
  const nav = useNavigation();
  const [kind, setKind] = useState<"secret" | "publishable">("secret");
  const { copied, copy } = useCopy();
  const [shown, setShown] = useState<{ key: string; kind: string } | null>(null);
  useEffect(() => {
    if (data && "created" in data && data.created) setShown(data.created);
  }, [data]);

  return (
    <div className="console-page">
      <div className="console-head">
        <div>
          <h1>API Keys</h1>
          <p>Secret keys call the API from servers, the CLI, the SDK and MCP. Publishable keys run live searches in embedded maps.</p>
        </div>
      </div>

      <section className="panel">
        <h2>Create a key</h2>
        <p>The full key is shown once. Store it in your environment as EDK_API_KEY.</p>
        <Form method="post" className="pg-form">
          <div className="grid-2">
            <label className="field"><span>Name</span><input className="input" name="name" placeholder={kind === "secret" ? "Production server" : "Docs site embed"} maxLength={60} /></label>
            <label className="field">
              <span>Type</span>
              <select className="select" name="kind" value={kind} onChange={(e) => setKind(e.target.value as any)}>
                <option value="secret">Secret (edk_sk_…)</option>
                <option value="publishable">Publishable for embeds (edk_pk_…)</option>
              </select>
            </label>
          </div>
          {kind === "publishable" ? (
            <label className="field">
              <span>Allowed sites</span>
              <input className="input" name="origins" placeholder="https://example.com, https://*.example.com" />
              <small>Pages allowed to embed live searches with this key. Leave empty to allow any site.</small>
            </label>
          ) : null}
          <div className="row">
            <button className="btn btn-primary" type="submit" disabled={nav.state !== "idle"}>Create key</button>
          </div>
          {data && "error" in data && data.error ? <div className="notice is-error">{data.error}</div> : null}
        </Form>
        {shown ? (
          <>
            <div className="key-reveal">
              <code>{shown.key}</code>
              <button type="button" className="btn btn-sm" onClick={() => copy(shown.key)}>{copied ? "Copied" : "Copy"}</button>
            </div>
            <p className="faint" style={{ fontSize: ".82rem", margin: ".6rem 0 0" }}>
              {shown.kind === "secret" ? "Copy it now. You won't see it again." : <>Embed with <code>{`${EMBED}/?key=${shown.key.slice(0, 12)}…&q=your+query`}</code></>}
            </p>
          </>
        ) : null}
      </section>

      <section className="panel">
        <h2>Your keys</h2>
        {loaderData.keys.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Key</th><th>Type</th><th>Created</th><th>Last used</th><th /></tr></thead>
              <tbody>
                {loaderData.keys.map((k) => (
                  <tr key={k.id}>
                    <td>{k.name}{k.allowed_origins ? <div className="faint" style={{ fontSize: ".76rem" }}>{k.allowed_origins.split(",").join(", ")}</div> : null}</td>
                    <td className="mono" style={{ fontSize: ".8rem" }}>{k.prefix}</td>
                    <td><span className={`tag${k.kind === "publishable" ? " is-moss" : ""}`}>{k.kind === "publishable" ? "embed" : "secret"}</span></td>
                    <td className="faint">{fmt(k.created_at)}</td>
                    <td className="faint">{fmt(k.last_used_at)}</td>
                    <td style={{ textAlign: "right" }}>
                      <Form method="post" onSubmit={(e) => { if (!confirm(`Revoke "${k.name}"? Apps using it stop working.`)) e.preventDefault(); }}>
                        <input type="hidden" name="intent" value="revoke" />
                        <input type="hidden" name="id" value={k.id} />
                        <button className="btn btn-sm btn-ghost btn-danger" type="submit">Revoke</button>
                      </Form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted" style={{ margin: 0 }}>No keys yet. Create one above.</p>
        )}
      </section>
    </div>
  );
}
