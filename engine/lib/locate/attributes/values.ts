// Live Turbopuffer helpers for attribute filters: per-namespace value lists (group_by) and the
// filtered Count probe used to relax filters that would return nothing.
import { unstable_cache } from "lib/cache";
import { ATTRIBUTE_BY_KEY } from "./catalog";

const BASE_URL = (process.env.TURBOPUFFER_BASE_URL || "https://api.turbopuffer.com").replace(/\/+$/, "");
const apiKey = () => process.env.TURBOPUFFER_KEY || process.env.TURBOPUFFER_API_KEY || "";

async function tpufQuery(namespace: string, body: Record<string, unknown>, timeoutMs: number) {
  const response = await fetch(`${BASE_URL}/v2/namespaces/${encodeURIComponent(namespace)}/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey()}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Turbopuffer ${response.status}`);
  return (await response.json()) as any;
}

/**
 * Values that actually occur for an attribute in a namespace, most common first. Aggregation is
 * fast on city namespaces (~0.7 s) but slow on large ones, so it is time-capped and cached; on a
 * timeout the catalog's own value list is used instead.
 */
const cachedValues = unstable_cache(
  async (namespace: string, key: string): Promise<string[]> => {
    const value = await tpufQuery(namespace, { aggregate_by: { n: ["Count"] }, group_by: [key], top_k: 40 }, 1800);
    const groups = (value.aggregation_groups ?? []) as Record<string, unknown>[];
    return groups
      .filter((g) => g[key] != null && !(Array.isArray(g[key]) && !(g[key] as unknown[]).length))
      .sort((a, b) => Number(b.n) - Number(a.n))
      .flatMap((g) => (Array.isArray(g[key]) ? (g[key] as unknown[]).map(String) : [String(g[key])]))
      .filter((x, i, all) => all.indexOf(x) === i)
      .slice(0, 40);
  },
  ["find-attr-values"],
  { revalidate: 24 * 3600 }
);

export async function liveValues(namespace: string, key: string): Promise<string[]> {
  const def = ATTRIBUTE_BY_KEY[key];
  if (!def?.dynamic || namespace === "global") return [];
  return cachedValues(namespace, key).catch(() => []);
}

/** Rows matching the filters in a namespace, or null when the probe could not answer in time. */
export async function countMatches(namespace: string, filters: unknown[]): Promise<number | null> {
  if (!filters.length) return null;
  try {
    const value = await tpufQuery(namespace, { aggregate_by: { n: ["Count"] }, filters: filters.length === 1 ? filters[0] : ["And", filters] }, 2500);
    const n = Number(value?.aggregations?.n);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}
