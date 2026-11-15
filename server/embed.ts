// Embeds. A live map (embed.edk.earth/?key=edk_pk_…) needs a publishable key and opens only inside the sites
// the key allows, checked server side against the embedding page's Referer. A shared result link
// (embed.edk.earth/r/:id) opens read-only. Every load is 0.2 CU to the owner, under a daily limit per key
// (or per account for result links) and per visitor, so a page cannot be loaded a million times on anyone's bill.
// After a key checks out, the page gets a short-lived signed token for its calls, so the key is not sent again.
import { createHmac } from "node:crypto";
import { DEFAULT_EMBED_DAILY, DEFAULT_RESULT_DAILY, EMBED_PER_VISITOR, LOAD_UNITS, RESULT_PER_VISITOR } from "../app/lib/embeds";
import { findApiKey, originAllowed, recordUsage, sha256Hex, spendable, type ApiKeyRow } from "./store";

const secret = () => process.env.CDN_SIGNING_KEY || process.env.BETTER_AUTH_SECRET || "edk-dev";
const TTL_MS = 30 * 60_000;

const sign = (payload: string) => createHmac("sha256", `${secret()}:embed`).update(payload).digest("base64url").slice(0, 32);
const today = () => new Date().toISOString().slice(0, 10);

/** Counts one more load for a scope today; false once the scope is over its limit. */
async function takeDaily(db: D1Database, scope: string, perDay: number) {
  const hash = (await sha256Hex(`edk-scope:${scope}`)).slice(0, 32);
  const row = await db
    .prepare("insert into anon_usage (ip_hash, day, searches) values (?, ?, 1) on conflict(ip_hash, day) do update set searches = searches + 1 returning searches")
    .bind(hash, today())
    .first<{ searches: number }>();
  return (row?.searches ?? 1) <= perDay;
}

/** Loads counted today for a scope. */
export async function loadsToday(db: D1Database, scope: string) {
  const hash = (await sha256Hex(`edk-scope:${scope}`)).slice(0, 32);
  const row = await db.prepare("select searches from anon_usage where ip_hash = ? and day = ?").bind(hash, today()).first<{ searches: number }>();
  return row?.searches ?? 0;
}
export const embedScope = (keyId: string) => `embed:${keyId}`;
export const resultScope = (userId: string) => `results:${userId}`;

/** Bills one load to the owner, or says why it cannot be paid. */
async function chargeLoad(db: D1Database, userId: string, keyId: string | null, endpoint: string, query: string) {
  const a = await spendable(db, userId);
  if (a.spendable < LOAD_UNITS) return false;
  await recordUsage(db, { userId, keyId, source: "embed", endpoint, locations: LOAD_UNITS, areas: 0, query });
  return true;
}

const safeOrigin = (url: string | null) => {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

export async function openEmbed(db: D1Database, key: string, referer: string | null, ip: string) {
  const row = await findApiKey(db, key);
  if (!row) return { error: "This embed key is not valid." as const };
  if (row.kind !== "publishable") return { error: "Use an embed key (edk_pk_…) in embeds, never a secret key." as const };
  if (!row.allowed_origins) return { error: "This embed key has no allowed sites yet. Add them in Console → Embeds." as const };
  const origin = safeOrigin(referer);
  if (!origin) return { error: "This map opens only inside a site its owner allows." as const };
  if (!originAllowed(row, origin)) return { error: "This site is not allowed to use this embed key." as const };
  if (!(await takeDaily(db, `${embedScope(row.id)}:${ip}`, EMBED_PER_VISITOR))) return { error: "This map has been opened too often from here today." as const };
  if (!(await takeDaily(db, embedScope(row.id), row.daily_load_cap ?? DEFAULT_EMBED_DAILY))) return { error: "This map has reached its daily limit. It opens again tomorrow." as const };
  if (!(await chargeLoad(db, row.user_id, row.id, "embed_load", origin))) return { error: "This map is unavailable right now." as const };
  const exp = Date.now() + TTL_MS;
  const payload = `${row.id}.${row.user_id}.${exp}`;
  return { token: `${payload}.${sign(payload)}`, key: row };
}

export type ShareSettings = { result_links: boolean; result_link_daily_cap: number | null };

export async function getShareSettings(db: D1Database, userId: string): Promise<ShareSettings> {
  const row = await db.prepare("select result_links, result_link_daily_cap from share_settings where user_id = ?").bind(userId).first<{ result_links: number; result_link_daily_cap: number | null }>();
  return { result_links: row ? Boolean(row.result_links) : true, result_link_daily_cap: row?.result_link_daily_cap ?? null };
}

export async function saveShareSettings(db: D1Database, userId: string, s: ShareSettings) {
  await db
    .prepare("insert into share_settings (user_id, result_links, result_link_daily_cap, updated_at) values (?, ?, ?, ?) on conflict(user_id) do update set result_links = excluded.result_links, result_link_daily_cap = excluded.result_link_daily_cap, updated_at = excluded.updated_at")
    .bind(userId, s.result_links ? 1 : 0, s.result_link_daily_cap, Date.now())
    .run();
}

/** A shared result link: read-only, billed to the account that made the result, capped per day. */
export async function openResult(db: D1Database, result: { id: string; user_id: string | null }, ip: string) {
  if (!(await takeDaily(db, `result:${result.id}:${ip}`, RESULT_PER_VISITOR))) return { error: "This map has been opened too often from here today." };
  if (!result.user_id) return { ok: true as const };
  const settings = await getShareSettings(db, result.user_id);
  if (!settings.result_links) return { error: "The owner of this result has turned off shared links." };
  if (!(await takeDaily(db, resultScope(result.user_id), settings.result_link_daily_cap ?? DEFAULT_RESULT_DAILY))) return { error: "This map has reached its daily limit. It opens again tomorrow." };
  if (!(await chargeLoad(db, result.user_id, null, "result_load", result.id))) return { error: "This map is unavailable right now." };
  return { ok: true as const };
}

export function verifyEmbedToken(token: unknown): { keyId: string; userId: string } | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [keyId, userId, exp, sig] = parts;
  if (Number(exp) < Date.now()) return null;
  if (sign(`${keyId}.${userId}.${exp}`) !== sig) return null;
  return { keyId, userId };
}

export type { ApiKeyRow };
