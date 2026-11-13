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

/** Where an indicator's numbers come from, in plain words. Raw method names are never shown. */
export function sourceLabel(method: string | null) {
  switch (method) {
    case "permits":
      return "Building permits stream";
    case "crimes":
      return "Crime reports stream";
    case "accidents":
      return "Traffic collisions stream";
    case "service_requests":
      return "311 service requests stream";
    case "inspections":
      return "Inspections stream";
    case "osm":
    case "osm_alt":
      return "Mapped places";
    case "name":
    case "terms":
      return "Street-level imagery";
    case "footprints_nature":
    case "category_footprints_nature":
      return "Species observations";
    case "web_technologies":
    case "category_web_techologies":
      return "Web technology census";
    default:
      return method?.startsWith("research") ? "Research dataset" : "EDK index";
  }
}

export type Model = {
  featureId: number;
  slug: string;
  name: string;
  description: string | null;
  method: string | null;
  indicatorType: IndicatorType | null;
  interests: string[];
};

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
  | { kind: "feature"; slug: string; name: string; type: IndicatorType | null; source: string }
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
