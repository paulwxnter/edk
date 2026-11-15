// api.edk.earth: the EDK-1 API. Two core calls, Discover and Inspect, plus Usage. Every /v1 call takes an
// API key (Authorization: Bearer edk_sk_…).
import { Hono } from "hono";
import { cors } from "hono/cors";
import { billedDetect, billedDiscover, billedInspect, billedRoute, BillingError, SearchError, VisionError, type Caller } from "./billed";
import { LookupError } from "./lookups";
import { createMonitor, deleteMonitor, getMonitor, listEvents, listMonitors, MonitorError, publicEvent, publicMonitor, scanNow, updateMonitor } from "./monitor";
import { listArtifacts } from "lib/lens-server";
import { MODEL, publicStoredDiscover } from "./shape";
import { findApiKey, getResult, originAllowed, spendable, dailyUsage, type ApiKeyRow } from "./store";
import { settleCheckout, verifyWebhook } from "./stripe";
import { unitsToCu } from "../app/lib/pricing";
import { limitApi } from "./guard";

type Vars = { caller: Caller; key: ApiKeyRow };
type AppEnv = { Bindings: Env; Variables: Vars };

export const api = new Hono<AppEnv>();

api.use("/v1/*", cors({ origin: "*", allowHeaders: ["authorization", "content-type", "x-api-key", "x-edk-client"], allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"], maxAge: 86400 }));

const docs = () => `${process.env.SITE_URL || "https://edk.earth"}/docs`;

api.get("/", (c) => c.json({ name: "EDK", model: MODEL, docs: docs(), endpoints: ["POST /v1/discover", "GET /v1/discover/:id", "GET /v1/inspect", "POST /v1/route", "POST /v1/detect", "POST /v1/monitors", "GET /v1/monitors", "GET /v1/monitors/:id/events", "GET /v1/artifacts", "GET /v1/usage"] }));
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
  c.set("key", key);
  c.set("caller", { userId: key.user_id, keyId: key.id, source: c.req.header("x-edk-client") === "mcp" ? "mcp" : "api" });
  const limited = await limitApi(c.env, key.user_id);
  if (limited) return limited;
  await next();
});

function fail(c: any, error: unknown) {
  if (error instanceof BillingError || error instanceof SearchError || error instanceof LookupError || error instanceof MonitorError || error instanceof VisionError) return c.json({ error: error.message }, error.status);
  console.error("[api] failed", error instanceof Error ? error.message : error);
  return c.json({ error: "Something went wrong. Please try again." }, 502);
}

const timeZone = (c: any) => (c.req.raw as any).cf?.timezone as string | undefined;

async function discoverPost(c: any) {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: 'Send a JSON body like {"query": "bridges in Pittsburgh"}.' }, 400);
  try {
    return c.json(await billedDiscover(c.env.DB, c.get("caller"), body, { timeZone: timeZone(c) }));
  } catch (error) {
    return fail(c, error);
  }
}

async function discoverGet(c: any) {
  const q = c.req.query("q") || c.req.query("query");
  if (!q) return c.json({ error: "Give a query in q." }, 400);
  try {
    return c.json(await billedDiscover(c.env.DB, c.get("caller"), { query: q, limit: c.req.query("limit"), focus: c.req.query("focus"), reasoning: c.req.query("reasoning"), answer: c.req.query("answer") === "true", development: c.req.query("development") === "true" }, { timeZone: timeZone(c) }));
  } catch (error) {
    return fail(c, error);
  }
}

async function storedResult(c: any) {
  const row = await getResult(c.env.DB, c.req.param("id"));
  if (!row || row.user_id !== c.get("caller").userId) return c.json({ error: "Unknown result." }, 404);
  const base = (process.env.EMBED_URL || "https://embed.edk.earth").replace(/\/+$/, "");
  return c.json({ id: row.id, model: MODEL, embed_url: `${base}/r/${row.id}`, created_at: new Date(row.created_at).toISOString(), data: publicStoredDiscover(row.payload) });
}

async function inspectHandler(c: any) {
  const body = c.req.method === "POST" ? await c.req.json().catch(() => ({})) : {};
  try {
    return c.json(await billedInspect(c.env.DB, c.get("caller"), body.lat ?? c.req.query("lat"), body.lng ?? c.req.query("lng")));
  } catch (error) {
    return fail(c, error);
  }
}

/** Route: POST {from, to, conditions?, profile?}, or GET ?from=lat,lng&to=lat,lng&conditions=… */
async function routeHandler(c: any) {
  const body = c.req.method === "POST" ? await c.req.json().catch(() => null) : { from: c.req.query("from"), to: c.req.query("to"), conditions: c.req.query("conditions") ?? c.req.query("avoid"), include: c.req.query("include"), profile: c.req.query("profile") };
  if (!body) return c.json({ error: 'Send a JSON body like {"from": "Point State Park, Pittsburgh", "to": "Carnegie Mellon University", "conditions": "avoid pothole streets"}.' }, 400);
  try {
    return c.json(await billedRoute(c.env.DB, c.get("caller"), body, { timeZone: timeZone(c) }));
  } catch (error) {
    return fail(c, error);
  }
}

api.post("/v1/discover", discoverPost);
api.get("/v1/discover", discoverGet);
api.get("/v1/discover/:id", storedResult);
api.get("/v1/inspect", inspectHandler);
api.post("/v1/inspect", inspectHandler);
api.post("/v1/route", routeHandler);

/** Detect: POST {image | image_url, max_objects?, threshold?, annotate?}. The objects in a picture, each with its box. */
api.post("/v1/detect", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: 'Send a JSON body like {"image_url": "https://example.com/street.jpg"}, or {"image": "<base64 JPEG or PNG>"}.' }, 400);
  try {
    return c.json(await billedDetect(c.env.DB, c.get("caller"), body));
  } catch (error) {
    return fail(c, error);
  }
});
api.get("/v1/route", routeHandler);

// Earlier name for Discover, kept for clients built against it.
api.post("/v1/search", discoverPost);
api.get("/v1/search", discoverGet);
api.get("/v1/search/:id", storedResult);

// Monitor (Stream): watch an area for new events of chosen artifacts, delivered to a webhook. Tier 4 and above.
const guard = (fn: (c: any) => Promise<Response>) => async (c: any) => {
  try {
    return await fn(c);
  } catch (error) {
    return fail(c, error);
  }
};
api.post("/v1/monitors", guard(async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: 'Send a JSON body like {"artifacts": ["Building Permit"], "area": "Pittsburgh", "since": "2026-11-01", "interval": "1h", "webhook_url": "https://…"}.' }, 400);
  const { userId, keyId } = c.get("caller");
  return c.json(publicMonitor(await createMonitor(c.env.DB, userId, keyId, body), true), 201);
}));
api.get("/v1/monitors", guard(async (c) => c.json({ data: (await listMonitors(c.env.DB, c.get("caller").userId)).map((m) => publicMonitor(m)) })));
api.get("/v1/monitors/:id", guard(async (c) => {
  const m = await getMonitor(c.env.DB, c.get("caller").userId, c.req.param("id"));
  return m ? c.json(publicMonitor(m, true)) : c.json({ error: "Unknown monitor." }, 404);
}));
api.patch("/v1/monitors/:id", guard(async (c) => c.json(publicMonitor(await updateMonitor(c.env.DB, c.get("caller").userId, c.req.param("id"), await c.req.json().catch(() => ({})))))));
api.delete("/v1/monitors/:id", guard(async (c) => {
  await deleteMonitor(c.env.DB, c.get("caller").userId, c.req.param("id"));
  return c.json({ deleted: true });
}));
api.get("/v1/monitors/:id/events", guard(async (c) => {
  const { userId } = c.get("caller");
  const id = c.req.param("id");
  if (!(await getMonitor(c.env.DB, userId, id))) return c.json({ error: "Unknown monitor." }, 404);
  return c.json({ data: (await listEvents(c.env.DB, userId, { monitorId: id, after: c.req.query("after"), limit: Number(c.req.query("limit")) })).map(publicEvent) });
}));
api.post("/v1/monitors/:id/scan", guard(async (c) => c.json(await scanNow(c.env.DB, c.get("caller").userId, c.req.param("id")))));
api.get("/v1/events", guard(async (c) => c.json({ data: (await listEvents(c.env.DB, c.get("caller").userId, { after: c.req.query("after"), limit: Number(c.req.query("limit")) })).map(publicEvent) })));

// The artifacts EDK-1 knows: what Discover finds and what Monitor can watch.
api.get("/v1/artifacts", guard(async (c) => {
  const list = await listArtifacts({ q: (c.req.query("q") || "").slice(0, 80) });
  return c.json({ data: list.slice(0, 100).map((a) => ({ id: a.id, name: a.name, description: a.description, kind: a.kind, watchable: a.kind !== "places" })) });
}));

api.get("/v1/usage", async (c) => {
  const { userId } = c.get("caller");
  const [account, days] = await Promise.all([spendable(c.env.DB, userId), dailyUsage(c.env.DB, userId, 30)]);
  return c.json({
    balance_cu: unitsToCu(account.balance),
    free_cu: unitsToCu(account.free),
    month_cu: unitsToCu(account.used),
    tier: { name: account.tier.name, max_results: account.tier.maxResults, concurrency: account.tier.concurrency, reasoning: account.tier.reasoning },
    monthly_cu_cap: account.settings.monthly_cu_cap,
    max_results: Math.min(account.tier.maxResults, account.settings.max_results ?? Infinity),
    daily: days.map((d) => ({ day: d.day, cu: unitsToCu(d.units), calls: d.calls })),
  });
});

api.notFound((c) => c.json({ error: "Not found. See " + docs() }, 404));
