export type RegionType = "country" | "state" | "county" | "city";

export type Region = {
  id: string;
  /** URL name, e.g. "san-francisco-ca". */
  slug: string | null;
  name: string;
  type: RegionType;
  /** Short context shown beside the name, e.g. "CA, US". */
  context: string;
  /** Two-letter country code of the country this region is (or sits in), e.g. "US". */
  countryCode?: string | null;
  center: [number, number] | null;
  /** [west, south, east, north] */
  bbox: [number, number, number, number] | null;
};

/** Broadest to narrowest. */
export const REGION_ORDER: RegionType[] = ["country", "state", "county", "city"];

export const REGION_LABEL: Record<RegionType, string> = { country: "Country", state: "State", county: "County", city: "City" };

/** The scenes column that holds each kind of region id. */
export const SCENE_REGION_COLUMN: Record<RegionType, string> = { country: "c_id", state: "s_id", city: "r_id", county: "p_id" };

export const FALLBACK_ZOOM: Record<RegionType, number> = { country: 3.6, state: 5.5, county: 8.5, city: 10.5 };

type Camera = { bounds: [[number, number], [number, number]] } | { center: [number, number]; zoom: number };

/** Where to point the map for a region. Boxes that wrap the globe (the US with Alaska, say) fall back to the center. */
export function regionCamera(region: Region): Camera | null {
  const b = region.bbox;
  if (b && b[2] - b[0] < 120 && b[2] > b[0] && b[3] > b[1]) return { bounds: [[b[0], b[1]], [b[2], b[3]]] };
  if (region.center) return { center: region.center, zoom: FALLBACK_ZOOM[region.type] };
  return null;
}
