// Billed calls shared by the REST API, the console and embeds: check what the account may spend and run
// at once, run EDK-1, trim results to that, record usage and store the result.
import { countReturned, parseSearchInput, runSearch, SearchError } from "./search";
import { MODEL, shapeDiscover, shapeInspect } from "./shape";
import { inspect } from "./lookups";
import { parseRouteInput, runRoute } from "./route";
import { beginInflight, endInflight, newResultId, recordUsage, saveResult, spendable } from "./store";
import { unitsToCu } from "../app/lib/pricing";
import { reasoningAllowed, reasoningById, tierForReasoning, verifyCountFor } from "../app/lib/tiers";
import { detect, loadImage, parseDetectInput, VisionError } from "lib/locate/vision";
import { newTally, withTokenTally } from "lib/locate/tokens";

export type Caller = { userId: string; keyId: string | null; source: "api" | "playground" | "atlas" | "embed" | "mcp" | "map" };
export { VisionError };

export class BillingError extends Error {
  constructor(message: string, readonly status = 402) {
    super(message);
  }
}

const embedUrl = (id: string) => `${(process.env.EMBED_URL || "https://embed.edk.earth").replace(/\/+$/, "")}/r/${id}`;
const SPATIAL_RESULT_UNITS = 1.5;

async function account(db: D1Database, caller: Caller) {
  const a = await spendable(db, caller.userId);
  if (a.spendable <= 0) throw new BillingError(a.capped ? "Your monthly CU limit is reached. Raise it in Billing & Usage." : "Your CU balance is used up. Add credits in Billing & Usage.");
  return a;
}

/** Runs `fn` inside one of the tier's concurrency slots. */
async function withSlot<T>(db: D1Database, userId: string, limit: number, fn: () => Promise<T>) {
  const slot = await beginInflight(db, userId, limit);
  if (!slot) throw new BillingError(`Your tier runs ${limit} request${limit === 1 ? "" : "s"} at a time. Wait for one to finish, or add credits to move up a tier.`, 429);
  try {
    return await fn();
  } finally {
    await endInflight(db, slot).catch(() => {});
  }
}

/** Discover: a question about the visual world, answered with places and areas. */
export async function billedDiscover(db: D1Database, caller: Caller, body: unknown, extra: { timeZone?: string } = {}) {
  const a = await account(db, caller);
  const maxLimit = Math.min(a.tier.maxResults, a.settings.max_results ?? Infinity);
  const input = parseSearchInput(body, maxLimit);
  const reasoning = reasoningById(input.reasoning)!;
  if (!reasoningAllowed(a.tier, reasoning.id)) {
    throw new BillingError(`${reasoning.name} reasoning starts at ${tierForReasoning(reasoning.id).name}. Add credits in Billing & Usage to move up a tier.`, 403);
  }
  // Tier 2 and up: the leading results are verified to have the feature boxed on their picture.
  input.verify = verifyCountFor(a.tier);
  // Never return more than the account can pay for.
  input.spatialLimit = Math.min(input.limit, Math.floor(a.spendable / (SPATIAL_RESULT_UNITS * reasoning.cost)));
  input.limit = Math.min(input.limit, Math.floor(a.spendable / reasoning.cost));
  return withSlot(db, caller.userId, a.tier.concurrency, async () => {
    const raw = await runSearch(input, { userId: caller.userId, sessionId: caller.keyId ?? caller.userId, timeZone: extra.timeZone }, `edk:${caller.source}`);
    if (raw.spatialApplied && input.spatialLimit === 0) throw new BillingError("This request needs at least 0.3 CU. Add credits in Billing & Usage.");
    if (!raw.spatialApplied && input.limit === 0) throw new BillingError("This request needs at least 0.2 CU. Add credits in Billing & Usage.");
    const data = await shapeDiscover(raw);
    const counts = countReturned(raw.geojson.features);
    const id = newResultId();
    await saveResult(db, id, caller.userId, input.query, data);
    const units = await recordUsage(db, { userId: caller.userId, keyId: caller.keyId, source: caller.source, endpoint: "discover", locations: counts.locations, areas: counts.areas, chargedUnits: counts.units * (raw.spatialApplied ? SPATIAL_RESULT_UNITS : 1) * reasoning.cost, query: input.query, resultId: id });
    return {
      id, model: MODEL, embed_url: embedUrl(id), reasoning: reasoning.id,
      usage: { locations: counts.locations, areas: counts.areas, cu: unitsToCu(units) },
      data,
      ...(input.development && raw.development ? { development: raw.development } : {}),
    };
  });
}

/** Detect: 1 CU for the image, plus 0.2 CU for each object found in it. */
export const DETECT_UNITS = 5;

export async function billedDetect(db: D1Database, caller: Caller, body: any) {
  const a = await account(db, caller);
  if (a.spendable < DETECT_UNITS + 1) throw new BillingError("Detect needs at least 1.2 CU. Add credits in Billing & Usage.");
  const input = parseDetectInput(body);
  input.maxObjects = Math.min(input.maxObjects, Math.floor(a.spendable - DETECT_UNITS));
  const bytes = await loadImage(body ?? {});
  return withSlot(db, caller.userId, a.tier.concurrency, async () => {
    const { development, ...data } = await withTokenTally(newTally(), () => detect(bytes, input));
    const units = await recordUsage(db, { userId: caller.userId, keyId: caller.keyId, source: caller.source, endpoint: "detect", locations: data.objects.length, areas: 0, chargedUnits: DETECT_UNITS + data.objects.length, query: typeof body?.image_url === "string" ? body.image_url : "image" });
    return {
      model: MODEL,
      usage: { images: 1, objects: data.objects.length, cu: unitsToCu(units) },
      data,
      ...(body?.development === true || body?.development === "true" ? { development } : {}),
    };
  });
}

/** Inspect: everything known about the area under a point. One location when something is known. */
export async function billedInspect(db: D1Database, caller: Caller, lat: unknown, lng: unknown) {
  const a = await account(db, caller);
  if (a.spendable < 1) throw new BillingError("Inspect needs 0.2 CU. Add credits in Billing & Usage.");
  return withSlot(db, caller.userId, a.tier.concurrency, async () => {
    const raw = await inspect(lat, lng);
    const known = raw.known ? 1 : 0;
    if (known) await recordUsage(db, { userId: caller.userId, keyId: caller.keyId, source: caller.source, endpoint: "inspect", locations: 1, areas: 0, query: `${lat},${lng}` });
    return { model: MODEL, usage: { locations: known, areas: 0, cu: unitsToCu(known) }, data: shapeInspect(raw) };
  });
}

/** Route: 1 CU for the path, plus 0.2 CU for each place it passes or was steered around. */
export const ROUTE_UNITS = 5;

export async function billedRoute(db: D1Database, caller: Caller, body: unknown, extra: { timeZone?: string } = {}) {
  const a = await account(db, caller);
  if (a.spendable < ROUTE_UNITS) throw new BillingError("A route needs 1 CU. Add credits in Billing & Usage.");
  const input = parseRouteInput(body);
  return withSlot(db, caller.userId, a.tier.concurrency, async () => {
    const data = await runRoute(input, { userId: caller.userId, sessionId: caller.keyId ?? caller.userId, timeZone: extra.timeZone });
    const units = await recordUsage(db, { userId: caller.userId, keyId: caller.keyId, source: caller.source, endpoint: "route", locations: ROUTE_UNITS + data.avoided.length + data.included.length, areas: 0, query: [input.include && `include ${input.include}`, input.conditions].filter(Boolean).join("; ") || "route" });
    return { model: MODEL, usage: { routes: 1, avoided: data.avoided.length, included: data.included.length, cu: unitsToCu(units) }, data };
  });
}

/** Anonymous Route on the public Atlas. */
export async function freeRoute(body: unknown) {
  const data = await runRoute(parseRouteInput(body), { userId: null, sessionId: crypto.randomUUID() });
  return { model: MODEL, usage: { routes: 1, avoided: data.avoided.length, included: data.included.length, cu: 0 }, data };
}

/** Anonymous Discover on the public Atlas: small limit, nothing billed. */
export async function freeDiscover(db: D1Database, body: unknown, limit: number) {
  const input = parseSearchInput(body, limit);
  const raw = await runSearch(input, { userId: null, sessionId: crypto.randomUUID() }, "edk:map");
  const data = await shapeDiscover(raw);
  const id = newResultId();
  await saveResult(db, id, null, input.query, data);
  return {
    id, model: MODEL, embed_url: embedUrl(id),
    usage: { locations: 0, areas: 0, cu: 0 },
    data,
    ...(input.development && raw.development ? { development: raw.development } : {}),
  };
}

/** Anonymous Inspect on the public Atlas. */
export async function freeInspect(lat: unknown, lng: unknown) {
  return { model: MODEL, usage: { locations: 0, areas: 0, cu: 0 }, data: shapeInspect(await inspect(lat, lng)) };
}

export { SearchError };
