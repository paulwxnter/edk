// Monitor (the Stream primitive): watch one area for new events of the artifacts a caller picks, from a
// date they choose, on an interval. Each run scans the artifacts' source (their own civic table in
// Postgres, or Turbopuffer for imagery) for rows newer than the monitor's cursor, keeps them as events,
// shows them in the console and posts them to the caller's webhook, signed. Tier 4 and above.
import { createHmac } from "node:crypto";
import { sql } from "lib/locate/e2-db";
import { getArtifact, getRegionById, listArtifacts, REGION_COLS, toRegion } from "lib/lens-server";
import { CIVIC_LATEST_WHERE, CIVIC_SELECT, civicFields, httpsOnly, safeTable } from "lib/live/civic-row";
import { tableColumns } from "lib/locate/civic-tables";
import { geocodeAddress } from "lib/locate/address-gate";
import { SCENE_REGION_COLUMN, type Region } from "lib/regions";
import { CIVIC_METHODS } from "lib/lens";
import { TIERS } from "../app/lib/tiers";
import { recordUsage, spendable } from "./store";
import { unitsToCu } from "../app/lib/pricing";

export class MonitorError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** Monitors open at Tier 4. */
export const MONITOR_TIER = "tier4";
export const MONITOR_INTERVALS = [15, 60, 360, 1440] as const;
const MAX_ARTIFACTS = 5;
const MAX_MONITORS = 25;
/** Most new events one artifact yields per run; the rest wait for the next run. */
const MAX_EVENTS = 100;
const MAX_ATTEMPTS = 5;
const TPUF_URL = (process.env.TURBOPUFFER_BASE_URL || "https://api.turbopuffer.com").replace(/\/+$/, "");
const TPUF_MAX_DISTANCE = 0.59;

type Engine = "sql" | "turbopuffer";
type WatchedArtifact = { id: string; name: string; kind: string; engine: Engine; source_table: string | null };
type Cursor = Record<string, { at: string; key: string }>;
export type MonitorRow = {
  id: string; user_id: string; key_id: string | null; name: string; prompt: string | null; artifacts: string;
  region_id: string; region_type: string; region_name: string; center_lng: number | null; center_lat: number | null;
  interval_minutes: number; since: number; cursor: string | null; webhook_url: string | null; webhook_secret: string;
  status: string; status_reason: string | null; last_run_at: number | null; next_run_at: number; events_count: number;
  created_at: number; updated_at: number;
};
type EventRow = {
  id: string; monitor_id: string; user_id: string; artifact_id: string; artifact_name: string | null; source_key: string;
  occurred_at: string | null; lat: number | null; lng: number | null; title: string | null; address: string | null;
  image_url: string | null; payload: string | null; created_at: number; delivered_at: number | null; delivery_status: string | null; attempts: number;
};
type NewEvent = Omit<EventRow, "id" | "monitor_id" | "user_id" | "created_at" | "delivered_at" | "delivery_status" | "attempts">;

const now = () => Date.now();
const randomId = (prefix: string) => prefix + crypto.randomUUID().replace(/-/g, "").slice(0, 20);

// ---- Access ------------------------------------------------------------------

const tierIndex = (id: string) => TIERS.findIndex((t) => t.id === id);
export const monitorAllowed = (tierId: string) => tierIndex(tierId) >= tierIndex(MONITOR_TIER);

async function requireTier(db: D1Database, userId: string) {
  const a = await spendable(db, userId);
  if (!monitorAllowed(a.tier.id)) {
    const need = TIERS.find((t) => t.id === MONITOR_TIER)!;
    throw new MonitorError(`Monitor is available from ${need.name} ($${need.unlockDollars?.toLocaleString("en-US")} in credits added). This account is on ${a.tier.name}.`, 403);
  }
  return a;
}

// ---- Input -------------------------------------------------------------------

/** "15m", "1h", "6h", "1d", "daily", or minutes. Snaps to the nearest interval offered. */
export function parseInterval(v: unknown): number {
  let minutes = Number.NaN;
  if (typeof v === "number") minutes = v;
  else if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    const m = t.match(/^(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)?$/);
    if (m) minutes = Number(m[1]) * (m[2]?.startsWith("h") ? 60 : m[2]?.startsWith("d") ? 1440 : 1);
    else if (t === "hourly") minutes = 60;
    else if (t === "daily") minutes = 1440;
  }
  if (!Number.isFinite(minutes) || minutes <= 0) return 60;
  return MONITOR_INTERVALS.reduce((best, x) => (Math.abs(x - minutes) < Math.abs(best - minutes) ? x : best), 60);
}

function parseSince(v: unknown): number {
  if (v == null || v === "") return now() - 7 * 86_400_000;
  const t = typeof v === "number" ? v : Date.parse(String(v));
  if (!Number.isFinite(t)) throw new MonitorError('Give "since" as a date, like "2026-11-01".');
  if (t > now() + 60_000) throw new MonitorError('"since" is in the future.');
  if (t < now() - 365 * 86_400_000) throw new MonitorError('"since" can be at most a year ago.');
  return t;
}

/** Only public https endpoints receive webhooks. */
function parseWebhook(v: unknown): string | null {
  if (v == null || v === "") return null;
  let url: URL;
  try {
    url = new URL(String(v).trim());
  } catch {
    throw new MonitorError("The webhook must be a full https:// URL.");
  }
  const host = url.hostname.toLowerCase();
  const privateHost = host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === "[::1]";
  if (url.protocol !== "https:" || privateHost) throw new MonitorError("The webhook must be a public https:// URL.");
  return url.toString().slice(0, 500);
}

/** Artifacts by id, slug or name. Only artifacts with dated events can be watched. */
async function resolveArtifacts(input: unknown): Promise<WatchedArtifact[]> {
  const list = (Array.isArray(input) ? input : typeof input === "string" ? input.split(",") : []).map((x) => String(typeof x === "object" && x ? (x as any).id ?? (x as any).name ?? "" : x).trim()).filter(Boolean);
  if (!list.length) throw new MonitorError('Pick at least one artifact to watch, like "artifacts": ["Building Permit"].');
  if (list.length > MAX_ARTIFACTS) throw new MonitorError(`Watch at most ${MAX_ARTIFACTS} artifacts in one monitor.`);
  const out: WatchedArtifact[] = [];
  for (const ref of list) {
    let row = await getArtifact(ref).catch(() => null);
    if (!row) {
      const hit = (await listArtifacts({ q: ref }).catch(() => []))[0];
      row = hit ? await getArtifact(hit.id).catch(() => null) : null;
    }
    if (!row) throw new MonitorError(`No artifact matches "${ref}". Search them with GET /v1/artifacts?q=.`);
    const civic = (CIVIC_METHODS as readonly string[]).includes(row.method ?? "") && Boolean(safeTable(row.source_table));
    if (row.kind === "imagery") out.push({ id: row.id, name: row.name, kind: row.kind, engine: "turbopuffer", source_table: null });
    else if (civic) out.push({ id: row.id, name: row.name, kind: row.kind, engine: "sql", source_table: row.source_table });
    else throw new MonitorError(`"${row.name}" has no dated events to watch. Pick imagery or a record stream such as permits, 311 requests or inspections.`);
  }
  return Array.from(new Map(out.map((a) => [a.id, a])).values());
}

/** The smallest region (city, then county, then state) that contains a point. */
async function regionAt(lng: number, lat: number): Promise<Region | null> {
  const rows = (await sql.withTimeout(10000, (tx) =>
    tx.query(
      `select ${REGION_COLS} from regions r
        where r.region_type in ('city', 'county', 'state') and r.geometry is not null
          and ST_Contains(r.geometry, ST_SetSRID(ST_MakePoint($1, $2), 4326))
        order by case r.region_type when 'city' then 0 when 'county' then 1 else 2 end, r.favorite desc nulls last, r.population desc nulls last
        limit 1`,
      [lng, lat],
    ),
  ).catch(() => [])) as any[];
  return rows[0] ? toRegion(rows[0]) : null;
}

/** An area as a region: {region_id}, {lat, lng}, "lat, lng", or a place name. */
async function resolveArea(input: unknown): Promise<Region> {
  const v: any = input;
  if (v && typeof v === "object" && (v.region_id || v.id)) {
    const r = await getRegionById(String(v.region_id ?? v.id));
    if (r) return r;
    throw new MonitorError("No region has that id.");
  }
  let point: [number, number] | null = null;
  if (v && typeof v === "object" && Number.isFinite(Number(v.lat)) && Number.isFinite(Number(v.lng))) point = [Number(v.lng), Number(v.lat)];
  if (typeof v === "string") {
    const m = v.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (m) point = [Number(m[2]), Number(m[1])];
    else if (v.trim().length >= 2) {
      const hit = await geocodeAddress(v.trim().slice(0, 200)).catch(() => null);
      if (hit) point = [hit.lng, hit.lat];
    }
  }
  if (!point) throw new MonitorError('Give an area: a place name like "Pittsburgh", "lat, lng", or {"region_id": "…"}.');
  const region = await regionAt(point[0], point[1]);
  if (!region) throw new MonitorError("That area is outside the regions EDK-1 covers.");
  return region;
}

// ---- Shape -------------------------------------------------------------------

export function publicMonitor(m: MonitorRow, withSecret = false) {
  const artifacts = JSON.parse(m.artifacts) as WatchedArtifact[];
  return {
    id: m.id,
    name: m.name,
    prompt: m.prompt,
    artifacts: artifacts.map((a) => ({ id: a.id, name: a.name, source: a.engine === "turbopuffer" ? "imagery" : "records" })),
    area: { region_id: m.region_id, name: m.region_name, type: m.region_type, center: m.center_lng != null && m.center_lat != null ? [m.center_lng, m.center_lat] : null },
    interval_minutes: m.interval_minutes,
    since: new Date(m.since).toISOString(),
    webhook_url: m.webhook_url,
    ...(withSecret ? { webhook_secret: m.webhook_secret } : {}),
    status: m.status,
    ...(m.status_reason ? { status_reason: m.status_reason } : {}),
    events: m.events_count,
    last_run_at: m.last_run_at ? new Date(m.last_run_at).toISOString() : null,
    next_run_at: m.status === "active" ? new Date(m.next_run_at).toISOString() : null,
    created_at: new Date(m.created_at).toISOString(),
  };
}

export function publicEvent(e: EventRow) {
  return {
    id: e.id,
    monitor_id: e.monitor_id,
    artifact: { id: e.artifact_id, name: e.artifact_name },
    occurred_at: e.occurred_at,
    detected_at: new Date(e.created_at).toISOString(),
    location: e.lat != null && e.lng != null ? { lat: e.lat, lng: e.lng } : null,
    title: e.title,
    address: e.address,
    image_url: e.image_url,
    details: e.payload ? JSON.parse(e.payload) : null,
    delivery: e.delivered_at ? { status: e.delivery_status, at: new Date(e.delivered_at).toISOString() } : e.delivery_status ? { status: e.delivery_status, at: null } : null,
  };
}

// ---- Create / read / change ----------------------------------------------------

export async function createMonitor(db: D1Database, userId: string, keyId: string | null, body: any) {
  await requireTier(db, userId);
  const count = await db.prepare("select count(*) as n from monitors where user_id = ? and status != 'deleted'").bind(userId).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_MONITORS) throw new MonitorError(`An account can run ${MAX_MONITORS} monitors. Delete one to add another.`);
  const artifacts = await resolveArtifacts(body?.artifacts ?? body?.artifact);
  const region = await resolveArea(body?.area ?? body?.region ?? body?.where);
  const since = parseSince(body?.since);
  const interval = parseInterval(body?.interval ?? body?.every ?? body?.interval_minutes);
  const webhook = parseWebhook(body?.webhook_url ?? body?.webhook);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim().slice(0, 1000) || null : null;
  const name = (typeof body?.name === "string" && body.name.trim() ? body.name.trim() : `${artifacts.map((a) => a.name).join(", ")} in ${region.name}`).slice(0, 120);
  const id = randomId("mon_");
  const secret = `whsec_${crypto.randomUUID().replace(/-/g, "")}`;
  const t = now();
  await db
    .prepare(
      `insert into monitors (id, user_id, key_id, name, prompt, artifacts, region_id, region_type, region_name, center_lng, center_lat, interval_minutes, since, cursor, webhook_url, webhook_secret, status, next_run_at, events_count, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, ?, ?, 'active', ?, 0, ?, ?)`,
    )
    .bind(id, userId, keyId, name, prompt, JSON.stringify(artifacts), region.id, region.type, [region.name, region.context].filter(Boolean).join(", "), region.center?.[0] ?? null, region.center?.[1] ?? null, interval, since, webhook, secret, t, t, t)
    .run();
  return (await getMonitor(db, userId, id))!;
}

export async function getMonitor(db: D1Database, userId: string, id: string) {
  return db.prepare("select * from monitors where id = ? and user_id = ? and status != 'deleted'").bind(id, userId).first<MonitorRow>();
}

export async function listMonitors(db: D1Database, userId: string) {
  const { results } = await db.prepare("select * from monitors where user_id = ? and status != 'deleted' order by created_at desc").bind(userId).all<MonitorRow>();
  return results;
}

export async function updateMonitor(db: D1Database, userId: string, id: string, body: any) {
  const m = await getMonitor(db, userId, id);
  if (!m) throw new MonitorError("Unknown monitor.", 404);
  const patch: Record<string, unknown> = {};
  if (body?.status === "paused" || body?.status === "active") {
    if (body.status === "active") await requireTier(db, userId);
    patch.status = body.status;
    patch.status_reason = null;
    if (body.status === "active") patch.next_run_at = now();
  }
  if (body?.name !== undefined) patch.name = String(body.name).trim().slice(0, 120) || m.name;
  if (body?.prompt !== undefined) patch.prompt = String(body.prompt ?? "").trim().slice(0, 1000) || null;
  if (body?.interval !== undefined || body?.interval_minutes !== undefined) patch.interval_minutes = parseInterval(body.interval ?? body.interval_minutes);
  if (body?.webhook_url !== undefined) patch.webhook_url = parseWebhook(body.webhook_url);
  const keys = Object.keys(patch);
  if (keys.length) {
    await db.prepare(`update monitors set ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? where id = ? and user_id = ?`).bind(...keys.map((k) => patch[k]), now(), id, userId).run();
  }
  return (await getMonitor(db, userId, id))!;
}

export async function deleteMonitor(db: D1Database, userId: string, id: string) {
  const r = await db.prepare("update monitors set status = 'deleted', updated_at = ? where id = ? and user_id = ? and status != 'deleted'").bind(now(), id, userId).run();
  if (!r.meta.changes) throw new MonitorError("Unknown monitor.", 404);
}

export async function listEvents(db: D1Database, userId: string, opts: { monitorId?: string | null; after?: string | null; limit?: number } = {}) {
  const limit = Math.max(1, Math.min(200, Math.floor(Number(opts.limit) || 50)));
  const where = ["e.user_id = ?"];
  const params: unknown[] = [userId];
  if (opts.monitorId) {
    where.push("e.monitor_id = ?");
    params.push(opts.monitorId);
  }
  const after = opts.after ? Date.parse(opts.after) : Number.NaN;
  if (Number.isFinite(after)) {
    where.push("e.created_at > ?");
    params.push(after);
  }
  const { results } = await db
    .prepare(`select e.*, m.name as monitor_name from monitor_events e join monitors m on m.id = e.monitor_id where ${where.join(" and ")} order by e.created_at desc, e.occurred_at desc, e.id desc limit ?`)
    .bind(...params, limit)
    .all<EventRow & { monitor_name: string }>();
  return results;
}

// ---- Scanning ------------------------------------------------------------------

const isoOf = (v: unknown) => {
  if (v instanceof Date) return v.toISOString();
  const t = Date.parse(String(v ?? ""));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/** New rows of a civic record stream in the region, oldest first, after the cursor. */
async function scanRecords(a: WatchedArtifact, region: { id: string; type: string; bbox: Region["bbox"] }, cursor: { at: string; key: string }): Promise<NewEvent[]> {
  const table = safeTable(a.source_table);
  if (!table) return [];
  const columns = await tableColumns(a.source_table!);
  if (!columns.has("date")) return [];
  const column = SCENE_REGION_COLUMN[region.type as keyof typeof SCENE_REGION_COLUMN];
  const where = [CIVIC_LATEST_WHERE, "(latitude is not null or geometry is not null)", "(date > $1::timestamptz or (date = $1::timestamptz and id::text > $2))"];
  const params: unknown[] = [cursor.at, cursor.key];
  if (column && columns.has(column)) {
    params.push(region.id);
    where.push(`${column} = $${params.length}::bigint`);
  } else if (region.bbox && columns.has("geometry")) {
    params.push(...region.bbox);
    where.push(`geometry && ST_MakeEnvelope($${params.length - 3}, $${params.length - 2}, $${params.length - 1}, $${params.length}, 4326)`);
  } else return [];
  params.push(MAX_EVENTS);
  const rows = (await sql.withTimeout(20000, (tx) =>
    tx.query(`select ${CIVIC_SELECT} from ${table} where ${where.join(" and ")} order by date asc, id::text asc limit $${params.length}`, params),
  )) as any[];
  return rows.map((r) => {
    const f = civicFields(r);
    const lat = Number(r.lat), lng = Number(r.lng);
    return {
      artifact_id: a.id,
      artifact_name: a.name,
      source_key: `${a.source_table}:${r.id}`,
      occurred_at: isoOf(r.date),
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      title: f.name || f.category || a.name,
      address: f.address,
      image_url: f.image_url,
      payload: JSON.stringify({ category: f.category, description: f.description, status: f.status, neighborhood: f.neighborhood, location: f.location }),
    };
  });
}

async function tpufQuery(namespace: string, body: Record<string, unknown>) {
  const key = process.env.TURBOPUFFER_KEY || process.env.TURBOPUFFER_API_KEY;
  if (!key) throw new Error("No Turbopuffer key configured.");
  const res = await fetch(`${TPUF_URL}/v2/namespaces/${encodeURIComponent(namespace)}/query`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  if (res.status === 404) return null;
  if (!res.ok) throw Object.assign(new Error(`Turbopuffer query failed (${res.status}).`), { status: res.status });
  const value = (await res.json()) as any;
  return (value.rows || value.results || []) as any[];
}

/** New imagery of an artifact in the region: its stored vectors against the region's namespace, dated after the cursor. */
async function scanImagery(a: WatchedArtifact, region: { id: string; bbox: Region["bbox"] }, cursor: { at: string; key: string }): Promise<NewEvent[]> {
  const embeds = (await sql.query("select embedding::text as e from artifacts_ebmed where artifact_id = $1::uuid and dimensions = 1024 order by embedding_kind, term_index limit 2", [a.id]).catch(() => [])) as any[];
  if (!embeds.length) return [];
  const day = cursor.at.slice(0, 10);
  const inBox = (lng: number, lat: number) => !region.bbox || (lng >= region.bbox[0] && lat >= region.bbox[1] && lng <= region.bbox[2] && lat <= region.bbox[3]);
  const rows: any[] = [];
  for (const { e } of embeds) {
    const vector = JSON.parse(e);
    const run = async (namespace: string, dateField: string | null) =>
      tpufQuery(namespace, { rank_by: ["vector", "ANN", vector], limit: 400, exclude_attributes: ["vector", "embed", "description"], ...(dateField ? { filters: [dateField, "Gte", day] } : {}) });
    let found: any[] | null = null;
    // The region's own namespace first, then the global one; the date attribute is "date" or "captured_at".
    for (const ns of [region.id, "global"]) {
      for (const field of ["date", "captured_at", null]) {
        try {
          found = await run(ns, field);
          break;
        } catch (err: any) {
          if (err?.status !== 400) throw err;
        }
      }
      if (found) break;
    }
    rows.push(...(found ?? []));
  }
  const seen = new Set<string>();
  const out: NewEvent[] = [];
  for (const row of rows) {
    const attr = row.attributes || row;
    const lat = Number(attr.lat ?? attr.latitude), lng = Number(attr.lng ?? attr.lon ?? attr.longitude);
    const dist = Number(row.$dist ?? row.dist ?? row.distance);
    const when = isoOf(attr.date ?? attr.captured_at);
    const key = `tpuf:${row.id ?? attr.id ?? attr.v_id}`;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inBox(lng, lat) || (Number.isFinite(dist) && dist > TPUF_MAX_DISTANCE)) continue;
    if (!when || when < cursor.at || (when === cursor.at && key <= cursor.key) || seen.has(key)) continue;
    seen.add(key);
    out.push({
      artifact_id: a.id,
      artifact_name: a.name,
      source_key: key,
      occurred_at: when,
      lat,
      lng,
      title: a.name,
      address: typeof attr.address === "string" ? attr.address : null,
      image_url: httpsOnly(attr.image_url ?? attr.visual_url),
      payload: JSON.stringify({ match: Number.isFinite(dist) ? +(1 - dist).toFixed(3) : null }),
    });
  }
  return out.sort((x, y) => (x.occurred_at! < y.occurred_at! ? -1 : x.occurred_at! > y.occurred_at! ? 1 : x.source_key < y.source_key ? -1 : 1)).slice(0, MAX_EVENTS);
}

const sign = (secret: string, body: string, t: number) => createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");

/** Posts undelivered events to the webhook, signed: `x-edk-signature: t=<ms>,v1=<hmac-sha256 of "<t>.<body>">`. */
async function deliver(db: D1Database, m: MonitorRow) {
  if (!m.webhook_url) return { sent: 0, status: null as string | null };
  const { results } = await db
    .prepare("select * from monitor_events where monitor_id = ? and delivered_at is null and attempts < ? order by created_at asc limit 100")
    .bind(m.id, MAX_ATTEMPTS)
    .all<EventRow>();
  if (!results.length) return { sent: 0, status: null };
  const t = now();
  const body = JSON.stringify({ type: "monitor.events", monitor: { id: m.id, name: m.name }, events: results.map(publicEvent), sent_at: new Date(t).toISOString() });
  let status: string;
  try {
    const res = await fetch(m.webhook_url, { method: "POST", headers: { "content-type": "application/json", "user-agent": "EDK-Monitor/1", "x-edk-event": "monitor.events", "x-edk-signature": `t=${t},v1=${sign(m.webhook_secret, body, t)}` }, body, signal: AbortSignal.timeout(10000) });
    status = String(res.status);
  } catch (err) {
    status = err instanceof Error && err.name === "TimeoutError" ? "timeout" : "unreachable";
  }
  const ok = /^2\d\d$/.test(status);
  const ids = results.map((e) => e.id);
  await db.batch(ids.map((id) => db.prepare(`update monitor_events set attempts = attempts + 1, delivery_status = ?${ok ? ", delivered_at = ?" : ""} where id = ?`).bind(...(ok ? [status, t, id] : [status, id]))));
  return { sent: ok ? ids.length : 0, status };
}

/** One run of a monitor: scan each artifact after its cursor, keep and bill new events, then deliver. */
export async function runMonitor(db: D1Database, m: MonitorRow) {
  const t = now();
  await db.prepare("update monitors set last_run_at = ?, next_run_at = ? where id = ?").bind(t, t + m.interval_minutes * 60_000, m.id).run();
  const account = await spendable(db, m.user_id);
  if (!monitorAllowed(account.tier.id)) {
    await db.prepare("update monitors set status = 'paused', status_reason = ? where id = ?").bind("This account is below Tier 4.", m.id).run();
    return { found: 0, kept: 0, delivered: 0, error: "This account is below Tier 4." };
  }
  const region = await getRegionById(m.region_id);
  if (!region) return { found: 0, kept: 0, delivered: 0, error: "The monitor's region is no longer available." };
  const artifacts = JSON.parse(m.artifacts) as WatchedArtifact[];
  const cursor: Cursor = m.cursor ? JSON.parse(m.cursor) : {};
  const start = new Date(m.since).toISOString();
  let found = 0;
  let kept = 0;
  const errors: string[] = [];
  let budget = Math.floor(account.spendable);
  for (const a of artifacts) {
    const c = cursor[a.id] ?? { at: start, key: "" };
    let events: NewEvent[] = [];
    try {
      events = a.engine === "sql" ? await scanRecords(a, { id: region.id, type: region.type, bbox: region.bbox }, c) : await scanImagery(a, { id: region.id, bbox: region.bbox }, c);
    } catch (err) {
      console.error(JSON.stringify({ event: "monitor_scan_error", monitor: m.id, artifact: a.id, error: String((err as Error)?.message ?? err).slice(0, 200) }));
      errors.push(`${a.name}: the source did not answer.`);
      continue;
    }
    found += events.length;
    // Each new event is 0.2 CU; keep only what the balance covers, and move the cursor only that far.
    const affordable = events.slice(0, Math.max(0, budget));
    budget -= affordable.length;
    if (affordable.length) {
      const res = await db.batch(
        affordable.map((e) =>
          db
            .prepare(
              `insert or ignore into monitor_events (id, monitor_id, user_id, artifact_id, artifact_name, source_key, occurred_at, lat, lng, title, address, image_url, payload, created_at, attempts)
               values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
            )
            .bind(randomId("evt_"), m.id, m.user_id, e.artifact_id, e.artifact_name, e.source_key, e.occurred_at, e.lat, e.lng, e.title, e.address, e.image_url, e.payload, t),
        ),
      );
      const inserted = res.reduce((n, r) => n + (r.meta.changes || 0), 0);
      kept += inserted;
      const last = affordable[affordable.length - 1];
      const key = last.source_key.slice(last.source_key.indexOf(":") + 1);
      cursor[a.id] = { at: last.occurred_at ?? c.at, key: a.engine === "sql" ? key : last.source_key };
    }
    if (affordable.length < events.length) break;
  }
  if (kept) await recordUsage(db, { userId: m.user_id, keyId: m.key_id, source: "monitor", endpoint: "monitor", locations: kept, areas: 0, query: m.name, resultId: m.id });
  const outOfCu = found > kept && budget <= 0;
  await db
    .prepare(`update monitors set cursor = ?, events_count = events_count + ?${outOfCu ? ", status = 'paused', status_reason = 'Your CU balance is used up. Add credits, then resume.'" : ""}, updated_at = ? where id = ?`)
    .bind(JSON.stringify(cursor), kept, now(), m.id)
    .run();
  const delivery = await deliver(db, (await db.prepare("select * from monitors where id = ?").bind(m.id).first<MonitorRow>())!);
  return { found, kept, cu: unitsToCu(kept), delivered: delivery.sent, webhook_status: delivery.status, ...(errors.length ? { errors } : {}) };
}

/** Run now, from the API or the console. */
export async function scanNow(db: D1Database, userId: string, id: string) {
  const m = await getMonitor(db, userId, id);
  if (!m) throw new MonitorError("Unknown monitor.", 404);
  if (m.status !== "active") throw new MonitorError("Resume the monitor to scan it.", 409);
  return runMonitor(db, m);
}

/** The cron: every monitor that is due, a few at a time. */
export async function runDueMonitors(db: D1Database, limit = 10) {
  const { results } = await db.prepare("select * from monitors where status = 'active' and next_run_at <= ? order by next_run_at asc limit ?").bind(now(), limit).all<MonitorRow>();
  for (const m of results) {
    try {
      const r = await runMonitor(db, m);
      console.log(JSON.stringify({ event: "monitor_run", monitor: m.id, ...r }));
    } catch (err) {
      console.error(JSON.stringify({ event: "monitor_run_error", monitor: m.id, error: String((err as Error)?.message ?? err).slice(0, 200) }));
    }
  }
  return results.length;
}
