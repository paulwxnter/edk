// Client-safe types, constants and formatting for Signals. lib/signals/db.ts (server-only) builds on these.

export const DEFAULT_FEATURE_SLUG = "construction-permit";
export const DEFAULT_REGION_SLUG = "new-york-city-ny";

export type Timeframe = "all" | "year" | "monthly" | "weekly";
export const TIMEFRAMES: { id: Exclude<Timeframe, "all">; label: string }[] = [
  { id: "year", label: "Yearly" },
  { id: "monthly", label: "Monthly" },
  { id: "weekly", label: "Weekly" },
];
export const isSeriesTimeframe = (v: unknown): v is Exclude<Timeframe, "all"> => v === "year" || v === "monthly" || v === "weekly";

export type IndicatorType = "condition" | "object" | "material" | "organism" | "event";
export const TYPE_LABEL: Record<IndicatorType, { singular: string; plural: string; blurb: string }> = {
  event: { singular: "Event", plural: "Events", blurb: "Things that happen: permits, collisions, crimes, inspections" },
  condition: { singular: "Condition", plural: "Conditions", blurb: "The state of a place: complaints, wear, noise and upkeep" },
  object: { singular: "Object", plural: "Objects", blurb: "Things that physically exist: street furniture, signs, buildings" },
  material: { singular: "Material", plural: "Materials", blurb: "What surfaces are made of: concrete, asphalt, brick" },
  organism: { singular: "Organism", plural: "Organisms", blurb: "Living things: trees, plants, animals and species sightings" },
};
export const isIndicatorType = (v: unknown): v is IndicatorType => typeof v === "string" && v in TYPE_LABEL;

export type Model = {
  featureId: number;
  slug: string;
  name: string;
  description: string | null;
  method: string | null;
  indicatorType: IndicatorType | null;
  interests: string[];
  /** Ledger measurement this signal is read in ("count" for most; web technologies have their own). */
  measurement: string;
  /** What one unit of the measurement is, for labels ("websites", "installations"). Null for plain counts. */
  unit: string | null;
  /** Only reported per country (web technologies): any city, county or state resolves to its country. */
  countryLevel: boolean;
};

/** Web technology signals, from HTTP Archive: one per technology, plus one per technology category. */
export const isWebTechMethod = (method: string | null | undefined) => method === "web_technologies" || isWebTechCategoryMethod(method);
// The source data spells the category method "techologies"; accept both spellings.
export const isWebTechCategoryMethod = (method: string | null | undefined) => method === "category_web_techologies" || method === "category_web_technologies";

/** Ledger measurement, unit and reporting level for an artifact method (mirrors ov-insight's method table). */
export function measurementFor(method: string | null | undefined): Pick<Model, "measurement" | "unit" | "countryLevel"> {
  if (method === "web_technologies") return { measurement: "wt_origins_mobile", unit: "websites", countryLevel: true };
  if (isWebTechCategoryMethod(method)) return { measurement: "wt_technology_installations_mobile", unit: "installations", countryLevel: true };
  return { measurement: "count", unit: null, countryLevel: false };
}

/** Region types a signal can be read at. */
export const regionTypesFor = (model: Pick<Model, "countryLevel">) => (model.countryLevel ? ["country"] : ["city", "county", "state", "country"]);

export type Region = {
  id: number;
  slug: string;
  name: string;
  type: string;
  stateCode: string | null;
  countryCode: string | null;
  population: number | null;
  areaKm2: number | null;
};

export type Bench = { rank: number | null; peers: number | null; percentile: number | null; share: number | null; countryRank: number | null };

export type Point = { date: string; value: number };

export type RegionValue = { region: Region; value: number };

export type PeerRow = { slug: string; name: string; value: number };

export type SearchHit =
  | { kind: "feature"; slug: string; name: string; type: IndicatorType | null }
  | { kind: "region"; slug: string; name: string; label: string };

export function regionLabel(r: Pick<Region, "name" | "type" | "stateCode" | "countryCode">) {
  if (r.type === "country") return r.name;
  return [r.name, r.stateCode ?? r.countryCode].filter(Boolean).join(", ");
}

export function peerScope(r: Pick<Region, "type" | "stateCode" | "countryCode">) {
  const plural = r.type === "city" ? "cities" : r.type === "county" ? "counties" : r.type === "state" ? "states" : "countries";
  if (r.type === "country") return plural;
  if (r.type === "state") return `${plural} in ${r.countryCode ?? "the country"}`;
  return `${plural} in ${r.stateCode ?? r.countryCode ?? "the area"}`;
}

export function compactNumber(n: number) {
  const a = Math.abs(n);
  if (a >= 1e9) return `${+(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${+(n / 1e3).toFixed(0)}K`;
  if (a >= 1e3) return `${+(n / 1e3).toFixed(1)}K`;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function formatChange(p: number | null) {
  if (p == null || !Number.isFinite(p)) return "—";
  return `${p > 0 ? "+" : ""}${p.toFixed(Math.abs(p) >= 10 ? 0 : 1)}%`;
}

export const per100k = (value: number, population: number | null) => (population ? (value / population) * 1e5 : null);
export const perKm2 = (value: number, area: number | null) => (area ? value / area : null);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function periodLabel(date: string, tf: Timeframe) {
  const [y, m, d] = date.split("-").map(Number);
  if (tf === "year" || tf === "all") return String(y);
  if (tf === "monthly") return `${MONTHS[m - 1]} ${y}`;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export const granularityFor = (tf: Timeframe) => (tf === "monthly" ? "month" : tf === "weekly" ? "week" : "year") as "year" | "month" | "week";

/** Monochrome-first series palette: white for the primary region, then quiet greys and one green accent. */
export const SERIES_COLORS = ["#f5f5f5", "#4ade80", "#94a3b8", "#64748b", "#cbd5e1"];

export type SourceColumnKind = "date" | "month" | "number" | "percent" | "score" | "bytes" | "text";

export type SourcePage = {
  columns: { key: string; label: string; kind?: SourceColumnKind }[];
  rows: (string | null)[][];
  hasMore: boolean;
  page: number;
  /** Whether rows can be narrowed by date (the table has a date column). */
  dated?: boolean;
  /** What the rows are, e.g. "Source records" or "Monthly ledger". */
  title?: string;
};

/** Formats one Data Viewer cell for display (exports keep the raw value). */
export function formatSourceCell(value: string | null, kind: SourceColumnKind | undefined) {
  if (value == null || value === "") return "—";
  const n = Number(value);
  switch (kind) {
    case "month": {
      const [y, m] = value.split("-").map(Number);
      return y && m ? `${MONTHS[m - 1]} ${y}` : value;
    }
    case "number":
      return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : value;
    case "percent":
      return Number.isFinite(n) ? `${n.toFixed(n >= 10 ? 1 : 2)}%` : value;
    case "score":
      return Number.isFinite(n) ? String(Math.round(n <= 1 ? n * 100 : n)) : value;
    case "bytes":
      if (!Number.isFinite(n)) return value;
      return n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`;
    default:
      return value;
  }
}
