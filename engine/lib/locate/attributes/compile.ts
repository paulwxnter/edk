// Attribute filters: validation against the catalog, coverage guard, and compilation to
// Turbopuffer filters (image search) and SQL clauses (OSM / civic / species tables).
import { ATTRIBUTE_BY_KEY, IDENT, MAX_ATTRIBUTE_FILTERS, formatNumber, valueLabel, type AttributeDef } from "./catalog";

export type FilterOp = "in" | "eq" | "gt" | "gte" | "lt" | "lte" | "between";
export type AttributeFilter = {
  key: string;
  op: FilterOp;
  /** enum / tags values */
  values?: (string | number)[];
  /** number threshold or bool value */
  value?: number | boolean;
  /** upper bound for `between` */
  value2?: number;
  /** highest / lowest: results are re-sorted by this attribute */
  sort?: "asc" | "desc";
  source: "jev" | "where";
};
export type SkippedFilter = { key: string; label: string; reason: string };
export type AppliedFilter = AttributeFilter & { label: string; text: string; unit?: string };

type Region = { region_type?: string; country_code?: string | null; state_code?: string | null } | null | undefined;

const NON_CONUS = new Set(["AK", "HI", "PR", "GU", "VI", "AS", "MP", "UM"]);

function clamp(def: AttributeDef, n: number) {
  const [lo, hi] = def.range ?? [-Infinity, Infinity];
  return Math.min(hi, Math.max(lo, n));
}

/** Keep only well-formed filters on catalog attributes, at most MAX_ATTRIBUTE_FILTERS, one per key. */
export function normalizeFilters(input: AttributeFilter[]): AttributeFilter[] {
  const out: AttributeFilter[] = [];
  const seen = new Set<string>();
  for (const f of input) {
    const def = ATTRIBUTE_BY_KEY[f?.key];
    if (!def || !IDENT.test(def.key) || seen.has(def.key)) continue;
    if (def.kind === "enum" || def.kind === "tags") {
      const allowed = def.values ? new Set(def.values.map((x) => String(x.value))) : null;
      const vals = (f.values ?? []).map((x) => (typeof x === "number" ? x : String(x).slice(0, 120))).filter((x) => !allowed || allowed.has(String(x)) || def.dynamic);
      if (!vals.length) continue;
      out.push({ key: def.key, op: "in", values: vals.slice(0, 30), source: f.source });
    } else if (def.kind === "bool") {
      if (typeof f.value !== "boolean") continue;
      out.push({ key: def.key, op: "eq", value: f.value, source: f.source });
    } else {
      const sort = f.sort === "asc" || f.sort === "desc" ? f.sort : undefined;
      const n = typeof f.value === "number" && Number.isFinite(f.value) ? clamp(def, f.value) : null;
      if (f.op === "between") {
        const n2 = typeof f.value2 === "number" && Number.isFinite(f.value2) ? clamp(def, f.value2) : null;
        if (n == null || n2 == null) continue;
        out.push({ key: def.key, op: "between", value: Math.min(n, n2), value2: Math.max(n, n2), sort, source: f.source });
      } else if (["gt", "gte", "lt", "lte"].includes(f.op) && n != null) {
        out.push({ key: def.key, op: f.op, value: n, sort, source: f.source });
      } else if (sort) {
        // Highest / lowest with no usable band: rank only.
        out.push({ key: def.key, op: "gte", value: def.range?.[0] ?? -1e12, sort, source: f.source });
      } else continue;
    }
    seen.add(def.key);
    if (out.length >= MAX_ATTRIBUTE_FILTERS) break;
  }
  return out;
}

/** Drop attributes the region cannot have (US-only outside the US, lower-48-only outside CONUS). */
export function coverageGuard(filters: AttributeFilter[], region: Region) {
  const kept: AttributeFilter[] = [];
  const skipped: SkippedFilter[] = [];
  const country = region?.country_code ? String(region.country_code).toUpperCase() : null;
  const state = region?.state_code ? String(region.state_code).toUpperCase() : null;
  for (const f of filters) {
    const def = ATTRIBUTE_BY_KEY[f.key];
    if (def.coverage !== "global" && country && country !== "US") {
      skipped.push({ key: f.key, label: def.label, reason: "only available in the United States" });
      continue;
    }
    if (def.coverage === "conus" && country === "US" && state && NON_CONUS.has(state)) {
      skipped.push({ key: f.key, label: def.label, reason: "only available in the contiguous United States" });
      continue;
    }
    kept.push(f);
  }
  return { kept, skipped };
}

// ---------------------------------------------------------------- Turbopuffer

function tpufOne(f: AttributeFilter): unknown[] | null {
  const def = ATTRIBUTE_BY_KEY[f.key];
  if (!def) return null;
  if (f.op === "in") {
    const vals = f.values ?? [];
    if (def.kind === "tags") return [def.key, "ContainsAny", vals.map(String)];
    if (def.match === "prefix") return vals.length === 1 ? [def.key, "Glob", `${vals[0]}*`] : ["Or", vals.map((x) => [def.key, "Glob", `${x}*`])];
    return [def.key, "In", vals];
  }
  if (f.op === "eq") return [def.key, "Eq", f.value];
  if (f.op === "between") return ["And", [[def.key, "Gte", f.value], [def.key, "Lte", f.value2]]];
  const op = { gt: "Gt", gte: "Gte", lt: "Lt", lte: "Lte" }[f.op];
  return op ? [def.key, op, f.value] : null;
}

export function toTurbopuffer(filters: AttributeFilter[]): unknown[] {
  return filters.map(tpufOne).filter((x): x is unknown[] => Boolean(x));
}

// ---------------------------------------------------------------- SQL (OSM / civic / species)

/**
 * Appends one clause per filter whose column exists on the table. Values go into `values` as
 * parameters; column names come only from the catalog. Returns the keys that were applied.
 */
export function appendSqlFilters(filters: AttributeFilter[], columns: Set<string>, clauses: string[], values: unknown[], alias = "t") {
  const applied: string[] = [];
  const p = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  for (const f of filters) {
    const def = ATTRIBUTE_BY_KEY[f.key];
    if (!def || !IDENT.test(def.key) || !columns.has(def.key)) continue;
    const col = `${alias}.${def.key}`;
    if (f.op === "in") {
      const vals = f.values ?? [];
      if (def.kind === "tags") clauses.push(`${col} && ${p(vals.map(String))}::text[]`);
      else if (def.match === "prefix") clauses.push(`${col}::text like any(${p(vals.map((x) => `${x}%`))}::text[])`);
      else if (vals.every((x) => typeof x === "number")) clauses.push(`${col} = any(${p(vals)}::float8[])`);
      else clauses.push(`${col}::text = any(${p(vals.map(String))}::text[])`);
    } else if (f.op === "eq") clauses.push(`${col} = ${p(Boolean(f.value))}::boolean`);
    else if (f.op === "between") clauses.push(`${col} between ${p(f.value)}::float8 and ${p(f.value2)}::float8`);
    else {
      const op = { gt: ">", gte: ">=", lt: "<", lte: "<=" }[f.op];
      if (!op) continue;
      clauses.push(`${col} ${op} ${p(f.value)}::float8`);
    }
    applied.push(def.key);
  }
  return applied;
}

// ---------------------------------------------------------------- explicit `where`

/**
 * Parses an explicit filter object, e.g.
 *   { elevation_m: { gt: 1600 }, terrain_class: ["steep"], is_pano: true, acs_median_age: { between: [30, 40] } }
 */
export function parseWhere(where: unknown): AttributeFilter[] {
  if (!where || typeof where !== "object" || Array.isArray(where)) return [];
  const out: AttributeFilter[] = [];
  for (const [key, raw] of Object.entries(where as Record<string, unknown>).slice(0, 40)) {
    const def = ATTRIBUTE_BY_KEY[key];
    if (!def) continue;
    if (def.kind === "bool") {
      if (typeof raw === "boolean") out.push({ key, op: "eq", value: raw, source: "where" });
    } else if (def.kind === "enum" || def.kind === "tags") {
      const vals = Array.isArray(raw) ? raw : [raw];
      out.push({ key, op: "in", values: vals.filter((x) => typeof x === "string" || typeof x === "number") as (string | number)[], source: "where" });
    } else if (raw && typeof raw === "object") {
      const o = raw as Record<string, unknown>;
      const sort = o.sort === "asc" || o.sort === "desc" ? (o.sort as "asc" | "desc") : undefined;
      if (Array.isArray(o.between)) out.push({ key, op: "between", value: Number(o.between[0]), value2: Number(o.between[1]), sort, source: "where" });
      else {
        const op = (["gt", "gte", "lt", "lte"] as const).find((k) => typeof o[k] === "number");
        if (op) out.push({ key, op, value: Number(o[op]), sort, source: "where" });
        else if (sort) out.push({ key, op: "gte", sort, source: "where" });
      }
    } else if (typeof raw === "number") out.push({ key, op: "gte", value: raw, source: "where" });
  }
  return normalizeFilters(out);
}

/** The same filters as an explicit `where` object (so the UI can re-run with a chip removed). */
export function toWhere(filters: AttributeFilter[]) {
  return Object.fromEntries(
    filters.map((f) => {
      if (f.op === "in") return [f.key, f.values];
      if (f.op === "eq") return [f.key, f.value];
      if (f.op === "between") return [f.key, { between: [f.value, f.value2], ...(f.sort ? { sort: f.sort } : {}) }];
      return [f.key, { [f.op]: f.value, ...(f.sort ? { sort: f.sort } : {}) }];
    })
  );
}

// ---------------------------------------------------------------- relax and describe

/** One step looser: drop the last numeric filter (thresholds are the most fragile), else the last filter. */
export function relaxOnce(filters: AttributeFilter[]): { filters: AttributeFilter[]; dropped: AttributeFilter } | null {
  if (!filters.length) return null;
  let idx = -1;
  for (let i = filters.length - 1; i >= 0; i--) if (["gt", "gte", "lt", "lte", "between"].includes(filters[i].op) && filters[i].source === "jev") { idx = i; break; }
  if (idx < 0) for (let i = filters.length - 1; i >= 0; i--) if (filters[i].source === "jev") { idx = i; break; }
  if (idx < 0) return null; // never relax what the user set explicitly
  const f = filters[idx];
  const def = ATTRIBUTE_BY_KEY[f.key];
  // A "highest / lowest" whose band matched nothing keeps its ranking, just without the band.
  if (f.sort && def?.range && f.value !== def.range[0]) {
    return { filters: filters.map((x, i) => (i === idx ? { ...x, op: "gte" as const, value: def.range![0], value2: undefined } : x)), dropped: f };
  }
  return { filters: filters.filter((_, i) => i !== idx), dropped: f };
}

export function describe(f: AttributeFilter): AppliedFilter {
  const def = ATTRIBUTE_BY_KEY[f.key];
  let text = def.label;
  if (f.op === "in") text = `${def.label}: ${(f.values ?? []).map((x) => valueLabel(def, x)).join(", ")}`;
  else if (f.op === "eq") text = `${def.label}: ${f.value ? def.yes ?? "yes" : def.noValue ?? "no"}`;
  else if (f.op === "between") text = `${def.label} ${formatNumber(def, Number(f.value))}–${formatNumber(def, Number(f.value2))}`;
  else if (f.sort && (f.value == null || f.value === def.range?.[0])) text = `${f.sort === "desc" ? "Highest" : "Lowest"} ${def.label.toLowerCase()}`;
  else text = `${def.label} ${{ gt: ">", gte: "≥", lt: "<", lte: "≤" }[f.op as "gt"]} ${formatNumber(def, Number(f.value))}`;
  if (f.sort && !text.startsWith("Highest") && !text.startsWith("Lowest")) text += f.sort === "desc" ? ", highest first" : ", lowest first";
  return { ...f, label: def.label, text, unit: def.unit };
}

/** Re-rank results by the first filter that asks for highest / lowest. */
export function sortByAttribute<T extends { properties?: Record<string, unknown> }>(features: T[], filters: AttributeFilter[]): T[] {
  const s = filters.find((f) => f.sort);
  if (!s) return features;
  const val = (x: T) => {
    const n = Number(x.properties?.[s.key]);
    return Number.isFinite(n) ? n : null;
  };
  return [...features].sort((a, b) => {
    const va = val(a), vb = val(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return s.sort === "desc" ? vb - va : va - vb;
  });
}
