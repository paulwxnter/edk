// Client-safe formatting of a result's place attributes: the values that matched the query's filters,
// plus a short set of context attributes shown around each result.
import { ATTRIBUTE_BY_KEY, valueLabel, type AttributeDef } from "./catalog";

export type AttributeFact = { key: string; label: string; value: string; matched: boolean };

/** Place facts worth showing on any result when the image carries them, in display order. */
export const CONTEXT_KEYS = [
  "elevation_m",
  "terrain_class",
  "settlement_code",
  "climate_symbol",
  "flood_zone",
  "water_proximity",
  "nlcd_tree_canopy_pct",
  "acag_pm25_latest_ugm3",
  "acs_median_household_income_usd",
  "whp_class",
];

const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

function round(def: AttributeDef, n: number) {
  if (def.unitFamily === "usd") return n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 10000 ? `$${Math.round(n / 1000).toLocaleString()}k` : `$${Math.round(n).toLocaleString()}`;
  const a = Math.abs(n);
  const s = a >= 100 ? Math.round(n).toLocaleString() : a >= 10 ? n.toFixed(1).replace(/\.0$/, "") : n.toFixed(2).replace(/\.?0+$/, "");
  if (!def.unit || def.unit === "fraction" || def.unit === "FWI") return s;
  return def.unit === "%" || def.unit === "°" || def.unit === "°C" ? `${s}${def.unit}` : `${s} ${def.unit}`;
}

/** One attribute value as display text, or null when the result has no value for it. */
export function formatAttribute(key: string, raw: unknown): string | null {
  const def = ATTRIBUTE_BY_KEY[key];
  if (!def || raw === null || raw === undefined || raw === "") return null;
  if (def.kind === "bool") return cap(raw === true || raw === "true" ? def.yes?.replace(/^Only /, "") ?? "Yes" : def.noValue?.replace(/^Only /, "") ?? "No");
  if (def.kind === "tags") {
    const list = (Array.isArray(raw) ? raw : [raw]).map((x) => valueLabel(def, x)).filter(Boolean);
    return list.length ? list.join(", ") : null;
  }
  if (def.kind === "enum") {
    if (def.match === "prefix") {
      const hit = def.values?.find((x) => String(raw).startsWith(String(x.value)));
      return hit ? hit.label : String(raw);
    }
    return valueLabel(def, raw);
  }
  const n = Number(raw);
  return Number.isFinite(n) ? round(def, n) : null;
}

/** Every catalog attribute the result carries, grouped by catalog group (for the ⓘ panel). */
export function allAttributeFacts(properties: Record<string, unknown> | undefined, matchedKeys: string[]) {
  if (!properties) return [] as { group: string; facts: AttributeFact[] }[];
  const groups = new Map<string, AttributeFact[]>();
  for (const def of Object.values(ATTRIBUTE_BY_KEY)) {
    const value = formatAttribute(def.key, properties[def.key]);
    if (!value) continue;
    const list = groups.get(def.group) ?? [];
    list.push({ key: def.key, label: def.label, value, matched: matchedKeys.includes(def.key) });
    groups.set(def.group, list);
  }
  return Array.from(groups, ([group, facts]) => ({ group, facts }));
}

/**
 * Facts for one result: the matched filter attributes first (marked `matched`), then context attributes
 * the result also carries. `limit` caps the context part only.
 */
export function attributeFacts(properties: Record<string, unknown> | undefined, matchedKeys: string[], limit = 6): AttributeFact[] {
  if (!properties) return [];
  const facts: AttributeFact[] = [];
  for (const key of matchedKeys) {
    const value = formatAttribute(key, properties[key]);
    if (value) facts.push({ key, label: ATTRIBUTE_BY_KEY[key].label, value, matched: true });
  }
  let added = 0;
  for (const key of CONTEXT_KEYS) {
    if (added >= limit) break;
    if (matchedKeys.includes(key)) continue;
    const value = formatAttribute(key, properties[key]);
    if (!value) continue;
    facts.push({ key, label: ATTRIBUTE_BY_KEY[key].label, value, matched: false });
    added++;
  }
  return facts;
}
