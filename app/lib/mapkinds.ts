// The kinds of thing on edk.earth/map, shared by the page and the server that reads the catalog.

/** The browse filters: each is a page (/map/permits) and a set of collection methods upstream. */
export const MAP_FILTERS = [
  { key: "all", label: "All", type: null },
  { key: "visual", label: "Visual", type: "name,terms" },
  { key: "permits", label: "Permits", type: "permits" },
  { key: "traffic-accidents", label: "Traffic accidents", type: "accidents" },
  { key: "community-issues", label: "Community issues", type: "service_requests" },
  { key: "crime", label: "Crime", type: "crimes" },
] as const;
export type MapFilter = (typeof MAP_FILTERS)[number]["key"];
export const isMapFilter = (value: string | undefined): value is MapFilter => MAP_FILTERS.some((f) => f.key === value);

/** Civic streams come as records (address, description, date) rather than pictures. */
export const CIVIC_METHODS = new Set(["permits", "accidents", "crimes", "service_requests", "inspections"]);
