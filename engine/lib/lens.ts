// Lens catalog: every artifact the map can show, grouped by where its points come from.
// Client-safe (no database access); the server side lives in lib/lens-server.ts.

export type LensKind = "imagery" | "places" | "permits" | "crimes" | "accidents" | "service_requests" | "inspections";

export type Artifact = {
  id: string;
  slug: string | null;
  name: string;
  description: string | null;
  method: string | null;
  indicator_type: string | null;
  icon_emoji: string | null;
  icon_url: string | null;
  total_scenes: number;
  kind: LensKind;
};

/** The Lens filters: artifacts.indicator_type values. */
export const INDICATOR_TYPES = [
  { id: "object", label: "Objects" },
  { id: "event", label: "Events" },
  { id: "condition", label: "Conditions" },
  { id: "material", label: "Materials" },
  { id: "organism", label: "Organisms" },
] as const;
export type IndicatorTypeId = (typeof INDICATOR_TYPES)[number]["id"];
export const isIndicatorTypeId = (v: unknown): v is IndicatorTypeId => INDICATOR_TYPES.some((t) => t.id === v);

export const LENS_KINDS: { id: LensKind; label: string; singular: string }[] = [
  { id: "imagery", label: "Imagery", singular: "Street-level imagery" },
  { id: "places", label: "Places", singular: "Mapped place" },
  { id: "permits", label: "Permits", singular: "Building permits" },
  { id: "crimes", label: "Crimes", singular: "Crime reports" },
  { id: "accidents", label: "Accidents", singular: "Traffic collisions" },
  { id: "service_requests", label: "311", singular: "311 service requests" },
  { id: "inspections", label: "Inspections", singular: "Inspections" },
];

export const KIND_LABEL = Object.fromEntries(LENS_KINDS.map((k) => [k.id, k])) as Record<LensKind, (typeof LENS_KINDS)[number]>;

export const isLensKind = (v: unknown): v is LensKind => typeof v === "string" && v in KIND_LABEL;

/** Civic record streams: one table per artifact, same columns (date, latitude, longitude, description…). */
export const CIVIC_METHODS = ["permits", "crimes", "accidents", "service_requests", "inspections"] as const;
/** OpenStreetMap layers: one table per artifact (name, lat, lng, address, brand…). */
export const PLACE_METHODS = ["osm", "osm_alt"] as const;

export function kindOf(method: string | null, totalScenes: number): LensKind {
  if (method && (CIVIC_METHODS as readonly string[]).includes(method)) return method as LensKind;
  if (method && (PLACE_METHODS as readonly string[]).includes(method)) return "places";
  return totalScenes > 0 ? "imagery" : "places";
}

/** "object" → "Object". Pending / missing types fall back to where the data comes from. */
export function indicatorLabel(a: Pick<Artifact, "indicator_type" | "kind">) {
  const t = (a.indicator_type || "").trim();
  if (!t || t === "pending") return KIND_LABEL[a.kind].singular;
  return t.charAt(0).toUpperCase() + t.slice(1).replace(/_/g, " ");
}
