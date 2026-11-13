// Find attribute pipeline: explicit `where` + JEV gates → validated, coverage-checked, probed filters.
import { ATTRIBUTE_BY_KEY } from "./catalog";
import { coverageGuard, describe, normalizeFilters, parseWhere, relaxOnce, toTurbopuffer, toWhere, type AppliedFilter, type AttributeFilter, type SkippedFilter } from "./compile";
import { gateIntent, gateValues, type GateAttempt, type IntentResult } from "./gate";
import { countMatches } from "./values";

export type { AttributeFilter } from "./compile";
export { appendSqlFilters, sortByAttribute, toTurbopuffer } from "./compile";

export type FindAttributeOptions = {
  /** Explicit filters, e.g. { elevation_m: { gt: 1600 }, terrain_class: ["steep"] }. Never changed by the gates. */
  where?: unknown;
  /** false = do not run the JEV gates (explicit `where` only). */
  gate?: boolean;
};

export type FiltersReport = {
  applied: AppliedFilter[];
  skipped: SkippedFilter[];
  relaxed: { label: string; text: string }[];
  /** The applied filters as a `where` object: send it back with gate:false to re-run exactly. */
  where: Record<string, unknown>;
  coverage: string | null;
  gate: { ran: boolean; intent: number | null; picked: string[]; attempts: GateAttempt[] };
};

/** The part of the report that is safe to return to clients (no provider timings or errors). */
export function publicFilters(report?: FiltersReport | null) {
  if (!report) return null;
  return {
    applied: report.applied.map(({ key, label, text, op, values, value, value2, sort, unit, source }) => ({ key, label, text, op, values, value, value2, sort, unit, source })),
    skipped: report.skipped,
    relaxed: report.relaxed,
    where: report.where,
    coverage: report.coverage,
    gate: report.gate.ran ? { picked: report.gate.picked } : null,
  };
}

/** Reads `where` / `gate` from a request body. */
export function attributeOptionsFrom(body: any): FindAttributeOptions {
  return { where: body?.where && typeof body.where === "object" ? body.where : undefined, gate: body?.gate === false ? false : undefined };
}

export function gateEnabled(options?: FindAttributeOptions) {
  return options?.gate !== false && process.env.FIND_ATTRIBUTE_GATE !== "0" && Boolean(process.env.JEV_API_KEY || process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_AI_GATEWAY);
}

/** Starts Gate 1. Call right after the query arrives so it runs alongside region / feature routing. */
export function startAttributeIntent(query: string, options: FindAttributeOptions | undefined, attempts: GateAttempt[]) {
  const explicit = parseWhere(options?.where);
  const pending: Promise<IntentResult> | null = gateEnabled(options) ? gateIntent(query, new Set(explicit.map((f) => f.key)), attempts).catch(() => ({ any: 0, picks: [] })) : null;
  // Gate 2 only needs the namespace for dynamic attributes (live value lists). For every other pick it
  // starts as soon as Gate 1 answers, so it runs alongside catalog lookup and routing instead of after.
  const early: Promise<AttributeFilter[] | null> | null = pending
    ? pending.then((intent) => {
        const picked = intent.picks.map((p) => p.key);
        if (!picked.length) return [];
        if (picked.some((key) => ATTRIBUTE_BY_KEY[key]?.dynamic)) return null;
        return gateValues(query, picked, "global", attempts).catch(() => [] as AttributeFilter[]);
      }).catch(() => null)
    : null;
  return { explicit, pending, early };
}

/**
 * Finishes the pipeline once the region is known: Gate 2 for the picked attributes, merge with explicit
 * filters, drop attributes the region can't have, then relax JEV filters (never explicit ones) while a
 * Count probe on the search namespace says they would match nothing.
 */
export async function resolveAttributeFilters(args: {
  query: string;
  explicit: AttributeFilter[];
  pending: Promise<IntentResult> | null;
  /** Gate 2 started early by startAttributeIntent; null result = picks need the namespace, run it here. */
  early?: Promise<AttributeFilter[] | null> | null;
  region: any;
  namespace: string;
  baseFilters: unknown[];
  attempts: GateAttempt[];
}): Promise<{ filters: AttributeFilter[]; report: FiltersReport }> {
  const intent = args.pending ? await args.pending : null;
  const picked = intent?.picks.map((p) => p.key) ?? [];
  const earlyValues = picked.length && args.early ? await args.early : null;
  const fromJev = !picked.length ? [] : earlyValues ?? await gateValues(args.query, picked, args.namespace, args.attempts).catch(() => []);
  const merged = normalizeFilters([...args.explicit, ...fromJev.filter((f) => !args.explicit.some((e) => e.key === f.key))]);
  const { kept, skipped } = coverageGuard(merged, args.region);

  let filters = kept;
  const relaxed: { label: string; text: string }[] = [];
  for (let step = 0; step < 3 && filters.some((f) => f.source === "jev"); step++) {
    const n = await countMatches(args.namespace, [...args.baseFilters, ...toTurbopuffer(filters)]);
    if (n == null || n > 0) break;
    const next = relaxOnce(filters);
    if (!next) break;
    relaxed.push({ label: ATTRIBUTE_BY_KEY[next.dropped.key].label, text: describe(next.dropped).text });
    filters = next.filters;
  }

  const anyLimited = filters.some((f) => ATTRIBUTE_BY_KEY[f.key].coverage !== "global");
  return {
    filters,
    report: {
      applied: filters.map(describe),
      skipped,
      relaxed,
      where: toWhere(filters),
      coverage: filters.length ? `Filters match images that have these attributes${anyLimited ? "; some are US-only" : ""}.` : null,
      gate: { ran: Boolean(args.pending), intent: intent ? +intent.any.toFixed(2) : null, picked, attempts: args.attempts },
    },
  };
}
