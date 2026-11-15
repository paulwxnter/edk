// Abuse protection: the country block, rate limits (API by account tier, auth by IP), the sign-up
// limit per hour and Turnstile on sign-up.
import { tierFor, type Tier, type TierId } from "../app/lib/tiers";
import { dollarsAdded } from "./store";

/** Countries EDK does not serve (ISO 3166-1 alpha-2, as in request.cf.country). */
const BLOCKED_COUNTRIES = new Set(["CN"]);

export function blockedCountry(request: Request) {
  const country = (request as any).cf?.country as string | undefined;
  return !!country && BLOCKED_COUNTRIES.has(country);
}

export const clientIp = (request: Request) => request.headers.get("cf-connecting-ip") || "unknown";

const tooMany = (message: string, retryAfter: number) =>
  new Response(JSON.stringify({ error: message, message }), { status: 429, headers: { "content-type": "application/json; charset=utf-8", "retry-after": String(retryAfter) } });

// ---- API: requests per minute by tier --------------------------------------------

/** Each tier's binding in wrangler.json; its limit matches the tier's requestsPerMinute. */
const API_LIMITERS: Record<TierId, keyof Env> = {
  community: "RL_API_COMMUNITY",
  tier1: "RL_API_TIER1",
  tier2: "RL_API_TIER2",
  tier3: "RL_API_TIER3",
  tier4: "RL_API_TIER4",
  tier5: "RL_API_TIER5",
};

// Tier lookups cost a D1 query, so each isolate keeps them for a minute.
const tierCache = new Map<string, { tier: Tier; until: number }>();

async function cachedTier(db: D1Database, userId: string) {
  const hit = tierCache.get(userId);
  if (hit && hit.until > Date.now()) return hit.tier;
  const tier = tierFor(await dollarsAdded(db, userId));
  if (tierCache.size > 5000) tierCache.clear();
  tierCache.set(userId, { tier, until: Date.now() + 60_000 });
  return tier;
}

/** A 429 when the account is over its tier's requests per minute, else null. Counted per account, across keys. */
export async function limitApi(env: Env, userId: string): Promise<Response | null> {
  const tier = await cachedTier(env.DB, userId);
  const limiter = env[API_LIMITERS[tier.id]] as unknown as RateLimit | undefined;
  if (!limiter) return null; // No binding (e.g. a test environment): don't block.
  const { success } = await limiter.limit({ key: userId });
  return success ? null : tooMany(`Rate limit: ${tier.name} allows ${tier.requestsPerMinute} requests per minute. Higher tiers allow more: ${process.env.SITE_URL || "https://edk.earth"}/docs#tiers`, 60);
}

// ---- Auth ----------------------------------------------------------------------

/** Auth calls that change something: sign-up, sign-in, password reset, verification emails. */
export async function limitAuth(env: Env, request: Request): Promise<Response | null> {
  if (request.method !== "POST" || !env.RL_AUTH) return null;
  const { success } = await env.RL_AUTH.limit({ key: clientIp(request) });
  return success ? null : tooMany("Too many attempts. Wait a minute and try again.", 60);
}

const SIGNUPS_PER_HOUR = 5;
const HOUR = 3_600_000;

/** Counts a sign-up attempt for this IP; a 429 past SIGNUPS_PER_HOUR in the last hour. */
export async function limitSignups(db: D1Database, request: Request): Promise<Response | null> {
  const ip = clientIp(request);
  const now = Date.now();
  const row = await db.prepare("select count(*) as n from signup_attempts where ip = ? and created_at > ?").bind(ip, now - HOUR).first<{ n: number }>();
  if ((row?.n ?? 0) >= SIGNUPS_PER_HOUR) return tooMany("Too many sign-ups from this network. Try again in an hour.", 3600);
  await db.batch([
    db.prepare("insert into signup_attempts (ip, created_at) values (?, ?)").bind(ip, now),
    db.prepare("delete from signup_attempts where created_at < ?").bind(now - 24 * HOUR),
  ]);
  return null;
}

// ---- Turnstile ------------------------------------------------------------------

const CAPTCHA_FAILED = "Could not verify you're human. Reload the page and try again.";

// Cloudflare's always-pass test keys, used in local development when none are set.
const TEST_SITE_KEY = "1x00000000000000000000AA";
const TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";

export const turnstileSiteKey = () => process.env.TURNSTILE_SITE_KEY || (import.meta.env.DEV ? TEST_SITE_KEY : "");
const turnstileSecret = () => process.env.TURNSTILE_SECRET_KEY || (import.meta.env.DEV ? TEST_SECRET_KEY : "");

/** Checks the Turnstile token sent with sign-up (header x-turnstile-token); a 403 when it fails. */
export async function verifyTurnstile(request: Request): Promise<Response | null> {
  const secret = turnstileSecret();
  if (!secret) {
    console.error("[turnstile] TURNSTILE_SECRET_KEY is not set; sign-up is unprotected");
    return null;
  }
  const token = request.headers.get("x-turnstile-token") || "";
  const fail = () => new Response(JSON.stringify({ error: CAPTCHA_FAILED, message: CAPTCHA_FAILED, code: "CAPTCHA_FAILED" }), { status: 403, headers: { "content-type": "application/json; charset=utf-8" } });
  if (!token) return fail();
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  form.append("remoteip", clientIp(request));
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form }).catch(() => null);
  const outcome = res?.ok ? ((await res.json().catch(() => null)) as { success?: boolean } | null) : null;
  return outcome?.success ? null : fail();
}
