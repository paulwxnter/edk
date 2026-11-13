// api.edk.earth: the EDK REST API. Every /v1 call takes an API key (Authorization: Bearer edk_sk_…).
import { Hono } from "hono";
import { cors } from "hono/cors";
import { billedSearch, BillingError, chargeSimple, assertCanSpend, SearchError, type Caller } from "./billed";
import { LookupError, catalog, geocode, inspect, regions, sources, trendsRegions, trendsSearch, trendsSeries } from "./lookups";
import { findApiKey, getResult, originAllowed, spendable, dailyUsage, type ApiKeyRow } from "./store";
import { settleCheckout, verifyWebhook } from "./stripe";
import { formatCu, unitsToCu, UNITS_PER_CU } from "../app/lib/pricing";

type Vars = { caller: Caller; key: ApiKeyRow };
type AppEnv = { Bindings: Env; Variables: Vars };

export const api = new Hono<AppEnv>();

api.use("/v1/*", cors({ origin: "*", allowHeaders: ["authorization", "content-type", "x-api-key"], allowMethods: ["GET", "POST", "OPTIONS"], maxAge: 86400 }));

const docs = () => `${process.env.SITE_URL || "https://edk.earth"}/docs`;

api.get("/", (c) =>
  c.json({
    name: "EDK API",
    tagline: "Compass for Machines",
    docs: docs(),
    endpoints: ["POST /v1/search", "GET /v1/search/:id", "GET /v1/inspect", "GET /v1/regions", "GET /v1/geocode", "GET /v1/catalog", "GET /v1/sources", "GET /v1/trends/search", "GET /v1/trends/regions", "GET /v1/trends/series", "GET /v1/usage"],
  }),
);
api.get("/health", (c) => c.json({ ok: true }));

// Stripe webhook (no API key; verified by signature).
api.post("/v1/billing/webhook", async (c) => {
  const payload = await c.req.text();
  const event = await verifyWebhook(payload, c.req.header("stripe-signature") ?? null, process.env.STRIPE_WEBHOOK_SECRET || "");
  if (!event) return c.json({ error: "Invalid signature." }, 400);
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    await settleCheckout(c.env.DB, String(event.data?.object?.id || ""));
  }
  return c.json({ received: true });
});

// API key auth for everything else under /v1.
api.use("/v1/*", async (c, next) => {
  if (c.req.method === "OPTIONS") return next();
  const header = c.req.header("authorization") || "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : c.req.header("x-api-key") || "";
  if (!token) return c.json({ error: "Missing API key. Send Authorization: Bearer edk_sk_…  Create one at https://edk.earth/console/keys" }, 401);
  const key = await findApiKey(c.env.DB, token);
  if (!key) return c.json({ error: "Invalid or revoked API key." }, 401);
  if (key.kind === "publishable" && !originAllowed(key, c.req.header("origin") ?? null)) return c.json({ error: "This publishable key is not allowed from this origin." }, 403);
  const source = c.req.header("x-edk-client") === "mcp" ? "mcp" : "api";
  c.set("key", key);
  c.set("caller", { userId: key.user_id, keyId: key.id, source });
  await next();
});

function fail(c: any, error: unknown) {
  if (error instanceof BillingError || error instanceof SearchError || error instanceof LookupError) return c.json({ error: error.message }, error.status);
  console.error("[api] failed", error instanceof Error ? error.message : error);
  return c.json({ error: "Something went wrong. Please try again." }, 502);
}

api.post("/v1/search", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "Send a JSON body like {\"query\": \"bridges in Pittsburgh\"}." }, 400);
  try {
    return c.json(await billedSearch(c.env.DB, c.get("caller"), body, { timeZone: (c.req.raw as any).cf?.timezone }));
  } catch (error) {
    return fail(c, error);
  }
});

api.get("/v1/search", async (c) => {
  const q = c.req.query("q") || c.req.query("query");
  if (!q) return c.json({ error: "Give a query in q." }, 400);
  try {
    return c.json(await billedSearch(c.env.DB, c.get("caller"), { query: q, limit: c.req.query("limit"), focus: c.req.query("focus"), answer: c.req.query("answer") !== "false" }, { timeZone: (c.req.raw as any).cf?.timezone }));
  } catch (error) {
    return fail(c, error);
  }
});

api.get("/v1/search/:id", async (c) => {
  const row = await getResult(c.env.DB, c.req.param("id"));
  if (!row || row.user_id !== c.get("caller").userId) return c.json({ error: "Unknown result." }, 404);
  const base = (process.env.EMBED_URL || "https://embed.edk.earth").replace(/\/+$/, "");
  return c.json({ id: row.id, embed_url: `${base}/r/${row.id}`, created_at: new Date(row.created_at).toISOString(), data: row.payload });
});

api.get("/v1/inspect", async (c) => {
  try {
    const caller = c.get("caller");
    await assertCanSpend(c.env.DB, caller);
    const data = await inspect(c.req.query("lat"), c.req.query("lng"));
    const usage = await chargeSimple(c.env.DB, caller, "inspect", data.known ? 1 : 0, `${c.req.query("lat")},${c.req.query("lng")}`);
    return c.json({ usage, data });
  } catch (error) {
    return fail(c, error);
  }
});

api.get("/v1/geocode", async (c) => {
  try {
    const caller = c.get("caller");
    await assertCanSpend(c.env.DB, caller);
    const data = await geocode(c.req.query("q"));
    const usage = await chargeSimple(c.env.DB, caller, "geocode", data.places.length ? 1 : 0, c.req.query("q"));
    return c.json({ usage, data });
  } catch (error) {
    return fail(c, error);
  }
});

api.get("/v1/trends/series", async (c) => {
  try {
    const caller = c.get("caller");
    await assertCanSpend(c.env.DB, caller);
    const data = await trendsSeries(new URL(c.req.url).searchParams);
    const usage = await chargeSimple(c.env.DB, caller, "trends", data.series.length, c.req.query("feature"));
    return c.json({ usage, data });
  } catch (error) {
    return fail(c, error);
  }
});

// Free lookups (no CU): regions, catalog, sources, trends discovery.
const free = (fn: (params: URLSearchParams) => Promise<unknown>) => async (c: any) => {
  try {
    return c.json({ usage: { locations: 0, areas: 0, cu: 0 }, data: await fn(new URL(c.req.url).searchParams) });
  } catch (error) {
    return fail(c, error);
  }
};
api.get("/v1/regions", free(regions));
api.get("/v1/catalog", free(catalog));
api.get("/v1/sources", free(sources));
api.get("/v1/trends/search", free((p) => trendsSearch(p.get("q"))));
api.get("/v1/trends/regions", free(trendsRegions));

api.get("/v1/usage", async (c) => {
  const { userId } = c.get("caller");
  const [account, days] = await Promise.all([spendable(c.env.DB, userId), dailyUsage(c.env.DB, userId, 30)]);
  return c.json({
    balance_cu: unitsToCu(account.balance),
    month_cu: unitsToCu(account.used),
    monthly_cu_cap: account.settings.monthly_cu_cap,
    max_results: account.settings.max_results,
    units_per_cu: UNITS_PER_CU,
    daily: days.map((d) => ({ day: d.day, cu: unitsToCu(d.units), locations: d.results, areas: d.images, calls: d.calls })),
    summary: `${formatCu(account.balance)} CU left`,
  });
});

api.notFound((c) => c.json({ error: "Not found. See " + docs() }, 404));
