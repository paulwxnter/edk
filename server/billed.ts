// Billed calls shared by the REST API, the console playground and embeds: check what the account may
// spend, run the call, trim results to that, record usage and store the result.
import { countReturned, parseSearchInput, runSearch, SearchError, type SearchPayload } from "./search";
import { newResultId, recordUsage, saveResult, spendable } from "./store";
import { unitsToCu } from "../app/lib/pricing";

export type Caller = { userId: string; keyId: string | null; source: "api" | "playground" | "atlas" | "embed" | "mcp" | "map" };

export class BillingError extends Error {
  constructor(message: string, readonly status = 402) {
    super(message);
  }
}

const embedUrl = (id: string) => `${(process.env.EMBED_URL || "https://embed.edk.earth").replace(/\/+$/, "")}/r/${id}`;

export async function billedSearch(db: D1Database, caller: Caller, body: unknown, extra: { timeZone?: string } = {}) {
  const account = await spendable(db, caller.userId);
  if (account.spendable <= 0) {
    throw new BillingError(account.capped ? "Your monthly CU limit is reached. Raise it in the console under Billing & Usage." : "Your CU balance is used up. Add credits in the console under Billing & Usage.");
  }
  const maxLimit = account.settings.max_results ?? undefined;
  const input = parseSearchInput(body, maxLimit);
  // Never return more than the account can pay for.
  input.limit = Math.max(1, Math.min(input.limit, account.spendable));
  const data = await runSearch(input, { userId: caller.userId, sessionId: caller.keyId ?? caller.userId, timeZone: extra.timeZone }, `edk:${caller.source}`);
  return finish(db, caller, data, "search", input.query);
}

/** Anonymous searches on the free map: no account, small limit, nothing billed. */
export async function freeSearch(db: D1Database, body: unknown, limit: number) {
  const input = parseSearchInput(body, limit);
  const data = await runSearch(input, { userId: null, sessionId: crypto.randomUUID() }, "edk:map");
  const id = newResultId();
  await saveResult(db, id, null, input.query, data);
  return { id, embed_url: embedUrl(id), usage: { locations: 0, areas: 0, cu: 0 }, data };
}

async function finish(db: D1Database, caller: Caller, data: SearchPayload, endpoint: string, query: string) {
  const counts = countReturned(data.geojson.features);
  const id = newResultId();
  await saveResult(db, id, caller.userId, query, data);
  await recordUsage(db, { userId: caller.userId, keyId: caller.keyId, source: caller.source, endpoint, locations: counts.locations, areas: counts.areas, query, resultId: id });
  return { id, embed_url: embedUrl(id), usage: { locations: counts.locations, areas: counts.areas, cu: unitsToCu(counts.units) }, data };
}

/** Charges a simple call that returns `locations` places (inspect, geocode, series). */
export async function chargeSimple(db: D1Database, caller: Caller, endpoint: string, locations: number, query?: string) {
  if (locations <= 0) return { locations: 0, areas: 0, cu: 0 };
  await recordUsage(db, { userId: caller.userId, keyId: caller.keyId, source: caller.source, endpoint, locations, areas: 0, query });
  return { locations, areas: 0, cu: unitsToCu(locations) };
}

export async function assertCanSpend(db: D1Database, caller: Caller) {
  const account = await spendable(db, caller.userId);
  if (account.spendable <= 0) throw new BillingError(account.capped ? "Your monthly CU limit is reached." : "Your CU balance is used up. Add credits in the console.");
  return account;
}

export { SearchError };
