// D1 data access: API keys, balances, usage, settings, stored results and credit purchases.
import { FREE_UNITS, UNITS_PER_CU } from "../app/lib/pricing";
import { tierFor } from "../app/lib/tiers";

const now = () => Date.now();
const randomId = (prefix = "") => prefix + crypto.randomUUID().replace(/-/g, "");

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
function randomToken(length: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- API keys ---------------------------------------------------------------

export type KeyKind = "secret" | "publishable";
export type ApiKeyRow = { id: string; user_id: string; name: string; kind: KeyKind; prefix: string; allowed_origins: string | null; daily_load_cap: number | null; created_at: number; last_used_at: number | null; revoked_at: number | null };

export async function createApiKey(db: D1Database, userId: string, name: string, kind: KeyKind, allowedOrigins: string[] = []) {
  const key = `${kind === "secret" ? "edk_sk_" : "edk_pk_"}${randomToken(32)}`;
  const id = randomId("key_");
  const origins = allowedOrigins.map((o) => o.trim().replace(/\/+$/, "")).filter(Boolean).join(",");
  await db
    .prepare("insert into api_keys (id, user_id, name, kind, prefix, hash, allowed_origins, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, userId, name.slice(0, 60) || "Untitled key", kind, `${key.slice(0, 11)}…${key.slice(-4)}`, await sha256Hex(key), origins || null, now())
    .run();
  return { id, key };
}

export async function listApiKeys(db: D1Database, userId: string) {
  const { results } = await db.prepare("select id, user_id, name, kind, prefix, allowed_origins, daily_load_cap, created_at, last_used_at, revoked_at from api_keys where user_id = ? and revoked_at is null order by created_at desc").bind(userId).all<ApiKeyRow>();
  return results;
}

export async function revokeApiKey(db: D1Database, userId: string, id: string) {
  await db.prepare("update api_keys set revoked_at = ? where id = ? and user_id = ?").bind(now(), id, userId).run();
}

export async function findApiKey(db: D1Database, key: string) {
  if (!/^edk_(sk|pk)_[A-Za-z0-9]{20,64}$/.test(key)) return null;
  const row = await db.prepare("select id, user_id, name, kind, prefix, allowed_origins, daily_load_cap, created_at, last_used_at, revoked_at from api_keys where hash = ?").bind(await sha256Hex(key)).first<ApiKeyRow>();
  if (!row || row.revoked_at) return null;
  // Touch at most once a minute.
  if (!row.last_used_at || now() - row.last_used_at > 60_000) await db.prepare("update api_keys set last_used_at = ? where id = ?").bind(now(), row.id).run();
  return row;
}

export function originAllowed(row: Pick<ApiKeyRow, "allowed_origins">, origin: string | null) {
  // A key with no allowed sites embeds nowhere.
  if (!row.allowed_origins || !origin) return false;
  let page: URL;
  try {
    page = new URL(origin);
  } catch {
    return false;
  }
  return row.allowed_origins.split(",").some((allowed) => {
    if (allowed === page.origin) return true;
    // "https://*.example.com" allows any subdomain.
    const wild = allowed.match(/^(https?):\/\/\*\.(.+)$/);
    if (wild) return page.protocol === `${wild[1]}:` && page.hostname.endsWith(`.${wild[2]}`);
    // "http://localhost" with no port allows any port on this computer.
    const local = allowed.match(/^(https?):\/\/(localhost|127\.0\.0\.1)$/);
    return local ? page.protocol === `${local[1]}:` && page.hostname === local[2] : false;
  });
}

/** An embed key's allowed sites, daily load limit or name. */
export async function updateEmbedKey(db: D1Database, userId: string, id: string, patch: { origins?: string[]; daily_load_cap?: number | null; name?: string }) {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.origins) {
    sets.push("allowed_origins = ?");
    params.push(Array.from(new Set(patch.origins)).join(",") || null);
  }
  if (patch.daily_load_cap !== undefined) {
    sets.push("daily_load_cap = ?");
    params.push(patch.daily_load_cap);
  }
  if (patch.name !== undefined) {
    sets.push("name = ?");
    params.push(patch.name.slice(0, 60) || "Embed");
  }
  if (!sets.length) return;
  await db.prepare(`update api_keys set ${sets.join(", ")} where id = ? and user_id = ? and kind = 'publishable' and revoked_at is null`).bind(...params, id, userId).run();
}

// ---- Balance ----------------------------------------------------------------

/**
 * Every account gets FREE_UNITS each calendar month (UTC). What is left of them does not carry over;
 * credits that were bought never expire. Free units are spent first.
 */
export async function getBalanceParts(db: D1Database, userId: string) {
  const month = monthStart();
  const row = await db.prepare("select units, free_units, free_month from balances where user_id = ?").bind(userId).first<{ units: number; free_units: number; free_month: number }>();
  if (!row) {
    await db.prepare("insert or ignore into balances (user_id, units, free_units, free_month, updated_at) values (?, 0, ?, ?, ?)").bind(userId, FREE_UNITS, month, now()).run();
    return { paid: 0, free: FREE_UNITS };
  }
  if (row.free_month !== month) {
    await db.prepare("update balances set free_units = ?, free_month = ?, updated_at = ? where user_id = ? and free_month != ?").bind(FREE_UNITS, month, now(), userId, month).run();
    return { paid: row.units, free: FREE_UNITS };
  }
  // The monthly allowance shrank: trim what is left this month so nobody keeps more than today's grant.
  if (row.free_units > FREE_UNITS) {
    await db.prepare("update balances set free_units = min(free_units, ?), updated_at = ? where user_id = ?").bind(FREE_UNITS, now(), userId).run();
    return { paid: row.units, free: FREE_UNITS };
  }
  return { paid: row.units, free: row.free_units };
}

/** The user's balance in units: this month's free units plus credits. */
export async function getBalance(db: D1Database, userId: string) {
  const b = await getBalanceParts(db, userId);
  return b.paid + b.free;
}

export async function addUnits(db: D1Database, userId: string, units: number) {
  await getBalance(db, userId);
  await db.prepare("update balances set units = units + ?, updated_at = ? where user_id = ?").bind(units, now(), userId).run();
}

// ---- Settings ---------------------------------------------------------------

export type Settings = { max_results: number | null; monthly_cu_cap: number | null; stripe_customer_id: string | null };

export async function getSettings(db: D1Database, userId: string): Promise<Settings> {
  const row = await db.prepare("select max_results, monthly_cu_cap, stripe_customer_id from user_settings where user_id = ?").bind(userId).first<Settings>();
  return row ?? { max_results: null, monthly_cu_cap: null, stripe_customer_id: null };
}

export async function saveSettings(db: D1Database, userId: string, patch: Partial<Settings>) {
  const current = await getSettings(db, userId);
  const next = { ...current, ...patch };
  await db
    .prepare(
      "insert into user_settings (user_id, max_results, monthly_cu_cap, stripe_customer_id, updated_at) values (?, ?, ?, ?, ?) on conflict(user_id) do update set max_results = excluded.max_results, monthly_cu_cap = excluded.monthly_cu_cap, stripe_customer_id = excluded.stripe_customer_id, updated_at = excluded.updated_at",
    )
    .bind(userId, next.max_results, next.monthly_cu_cap, next.stripe_customer_id, now())
    .run();
  return next;
}

// ---- Usage ------------------------------------------------------------------

export const monthStart = (d = new Date()) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);

export async function unitsThisMonth(db: D1Database, userId: string) {
  const row = await db.prepare("select coalesce(sum(units), 0) as units from usage_events where user_id = ? and created_at >= ?").bind(userId, monthStart()).first<{ units: number }>();
  return row?.units ?? 0;
}

/**
 * How many units the user may spend on the next call: the lower of their balance and what is left
 * under their monthly cap. 0 means the call must be refused.
 */
export async function spendable(db: D1Database, userId: string) {
  const [parts, settings, used, added] = await Promise.all([getBalanceParts(db, userId), getSettings(db, userId), unitsThisMonth(db, userId), dollarsAdded(db, userId)]);
  const balance = parts.paid + parts.free;
  const capLeft = settings.monthly_cu_cap != null ? settings.monthly_cu_cap * UNITS_PER_CU - used : Infinity;
  const tier = tierFor(added);
  return { balance, free: parts.free, settings, used, added, tier, spendable: Math.max(0, Math.min(balance, capLeft)), capped: capLeft <= 0 };
}

/** Lifetime credits added, in dollars (paid Checkout Sessions). */
export async function dollarsAdded(db: D1Database, userId: string) {
  const row = await db.prepare("select coalesce(sum(amount_cents), 0) as cents from credit_purchases where user_id = ? and credited_at is not null").bind(userId).first<{ cents: number }>();
  return (row?.cents ?? 0) / 100;
}

// ---- Concurrency ----------------------------------------------------------------

const STALE_MS = 120_000;

/** Claims a slot for a running request, or returns null when the tier's limit is reached. */
export async function beginInflight(db: D1Database, userId: string, limit: number) {
  const since = Date.now() - STALE_MS;
  const row = await db.prepare("select count(*) as n from inflight where user_id = ? and started_at > ?").bind(userId, since).first<{ n: number }>();
  if ((row?.n ?? 0) >= limit) return null;
  const id = randomId("run_");
  await db.batch([
    db.prepare("delete from inflight where user_id = ? and started_at <= ?").bind(userId, since),
    db.prepare("insert into inflight (id, user_id, started_at) values (?, ?, ?)").bind(id, userId, Date.now()),
  ]);
  return id;
}

export async function endInflight(db: D1Database, id: string) {
  await db.prepare("delete from inflight where id = ?").bind(id).run();
}

export async function recordUsage(
  db: D1Database,
  e: { userId: string; keyId: string | null; source: string; endpoint: string; locations: number; areas: number; chargedUnits?: number; query?: string | null; resultId?: string | null },
) {
  // Columns: results = locations returned, images = areas returned (5 of either = 1 CU).
  const units = e.chargedUnits ?? e.locations + e.areas;
  await db.batch([
    db
      .prepare("insert into usage_events (id, user_id, key_id, source, endpoint, results, images, units, query, result_id, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(randomId("use_"), e.userId, e.keyId, e.source, e.endpoint, e.locations, e.areas, units, e.query?.slice(0, 500) ?? null, e.resultId ?? null, now()),
    // Free units first, then credits. (Both expressions read the row as it was before the update.)
    db.prepare("update balances set free_units = max(free_units - ?, 0), units = units - max(? - free_units, 0), updated_at = ? where user_id = ?").bind(units, units, now(), e.userId),
  ]);
  return units;
}

/** Units per UTC day for the last `days` days, oldest first. */
export async function dailyUsage(db: D1Database, userId: string, days = 30) {
  const since = Date.now() - days * 86_400_000;
  const { results } = await db
    .prepare("select strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') as day, sum(units) as units, sum(results) as results, sum(images) as images, count(*) as calls from usage_events where user_id = ? and created_at >= ? group by day order by day")
    .bind(userId, since)
    .all<{ day: string; units: number; results: number; images: number; calls: number }>();
  const byDay = new Map(results.map((r) => [r.day, r]));
  const out: { day: string; units: number; results: number; images: number; calls: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    out.push(byDay.get(day) ?? { day, units: 0, results: 0, images: 0, calls: 0 });
  }
  return out;
}

export async function recentUsage(db: D1Database, userId: string, limit = 25) {
  const { results } = await db
    .prepare("select id, source, endpoint, results, images, units, query, result_id, created_at from usage_events where user_id = ? order by created_at desc limit ?")
    .bind(userId, limit)
    .all<{ id: string; source: string; endpoint: string; results: number; images: number; units: number; query: string | null; result_id: string | null; created_at: number }>();
  return results;
}

// ---- Stored results -----------------------------------------------------------

export async function saveResult(db: D1Database, id: string, userId: string | null, query: string, payload: unknown) {
  await db.prepare("insert into results (id, user_id, query, payload, created_at) values (?, ?, ?, ?, ?)").bind(id, userId, query.slice(0, 500), JSON.stringify(payload), now()).run();
}

export async function getResult(db: D1Database, id: string) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) return null;
  const row = await db.prepare("select id, user_id, query, payload, created_at from results where id = ?").bind(id).first<{ id: string; user_id: string | null; query: string; payload: string; created_at: number }>();
  return row ? { ...row, payload: JSON.parse(row.payload) } : null;
}

/** The account's latest Discover results, newest first, for the Playground's recent list. */
export async function listResults(db: D1Database, userId: string, limit = 6) {
  const { results } = await db.prepare("select id, query, created_at from results where user_id = ? order by created_at desc limit ?").bind(userId, limit).all<{ id: string; query: string; created_at: number }>();
  return results;
}

/** What a stored result cost when it was made. */
export async function usageForResult(db: D1Database, userId: string, resultId: string) {
  return db.prepare("select results as locations, images as areas, units from usage_events where user_id = ? and result_id = ? limit 1").bind(userId, resultId).first<{ locations: number; areas: number; units: number }>();
}

export const newResultId =() => randomId("res_").slice(0, 28);

// ---- Anonymous map searches ---------------------------------------------------

export async function takeAnonSearch(db: D1Database, ip: string, perDay: number) {
  const day = new Date().toISOString().slice(0, 10);
  const ipHash = (await sha256Hex(`edk-anon:${ip}`)).slice(0, 32);
  const row = await db
    .prepare("insert into anon_usage (ip_hash, day, searches) values (?, ?, 1) on conflict(ip_hash, day) do update set searches = searches + 1 returning searches")
    .bind(ipHash, day)
    .first<{ searches: number }>();
  return (row?.searches ?? 1) <= perDay;
}

// ---- Credit purchases ---------------------------------------------------------

export async function recordPurchase(db: D1Database, id: string, userId: string, amountCents: number, units: number) {
  await db.prepare("insert or ignore into credit_purchases (id, user_id, amount_cents, units, status, created_at) values (?, ?, ?, ?, 'pending', ?)").bind(id, userId, amountCents, units, now()).run();
}

/** Credits a paid Checkout Session exactly once. Returns true when this call credited it. */
export async function creditPurchase(db: D1Database, id: string, userId: string, amountCents: number, units: number) {
  await recordPurchase(db, id, userId, amountCents, units);
  const claimed = await db.prepare("update credit_purchases set status = 'paid', credited_at = ? where id = ? and credited_at is null").bind(now(), id).run();
  if (!claimed.meta.changes) return false;
  await addUnits(db, userId, units);
  return true;
}

export async function listPurchases(db: D1Database, userId: string) {
  const { results } = await db.prepare("select id, amount_cents, units, status, created_at, credited_at from credit_purchases where user_id = ? and status = 'paid' order by created_at desc limit 20").bind(userId).all<{ id: string; amount_cents: number; units: number; status: string; created_at: number; credited_at: number | null }>();
  return results;
}
