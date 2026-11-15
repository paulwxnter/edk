export interface EDKOptions {
  /** Defaults to process.env.EDK_API_KEY. */
  apiKey?: string;
  /** Defaults to https://api.edk.earth. */
  baseUrl?: string;
  fetch?: typeof fetch;
  client?: string;
}

export interface Usage {
  locations: number;
  areas: number;
  /** Compute Units: the GPU and CPU work EDK-1 needed for the request. */
  cu: number;
}

export interface Fact {
  title: string;
  detail: string | null;
}

export interface Feature {
  type: "Feature";
  id?: string;
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    kind: "location" | "area";
    name?: string;
    address?: string;
    feature_name?: string;
    description?: string;
    date?: string;
    neighborhood?: string;
    district?: string;
    image_url?: string;
    /** Where the feature sits in image_url, as fractions of its size. Set on results studied by reasoning. */
    box?: { top: number; left: number; bottom: number; right: number };
    /** image_url with the feature outlined and named. */
    boxed_image_url?: string;
    /** Areas: the zone's outline. */
    outline?: { type: "Polygon"; coordinates: [number, number][][] } | { type: "MultiPolygon"; coordinates: [number, number][][][] };
    facts?: Fact[];
    /** Straight-line distance in meters, when measured for this result. */
    distance?: number;
    /** How a displayed measurement was calculated. */
    insight?: string;
  };
}

export type Reasoning = "fast" | "low" | "medium" | "max";

export interface DiscoverOptions {
  /** Default 20, up to your tier's maximum. */
  limit?: number;
  /** How closely EDK-1 studies its results before returning them. Default "fast". Medium and max cost twice the CU and need Tier 1 and Tier 2. */
  reasoning?: Reasoning;
  /** Add a short written answer. Default false. */
  answer?: boolean;
  /** Include engine duration and sanitized stage timings in the response. */
  development?: boolean;
  /** Up to 4 points to search around, [lng, lat]. */
  areas?: [number, number][];
  /** A region id to search in when the query names no place. */
  focus?: string;
}

export interface DiscoverResult {
  id: string;
  model: "edk-1";
  embed_url: string;
  /** The reasoning level used. */
  reasoning: Reasoning;
  usage: Usage;
  /** Present only when DiscoverOptions.development is true. */
  development?: {
    total_ms: number;
    stages: { name: string; ms: number }[];
  };
  data: {
    query: string;
    answer?: string;
    geojson: { type: "FeatureCollection"; features: Feature[] };
    region?: { id: string; name: string; type: string | null; context: string | null };
    /** The catalog features the query matched, by name. */
    tags?: string[];
    areas?: { index: number; center: [number, number]; label?: string; outline?: unknown }[];
    duration_ms: number;
  };
}

export interface InspectResult {
  model: "edk-1";
  usage: Usage;
  data: {
    known: boolean;
    center: [number, number];
    outline?: { type: "Polygon"; coordinates: [number, number][][] };
    place: { type: string; name: string }[];
    highlights: Fact[];
    categories: { name: string; items: Fact[] }[];
  };
}

export type RoutePlace = [number, number] | { lat: number; lng: number } | string;

export interface RouteOptions {
  /** [lng, lat], {lat, lng}, "lat, lng", or a place name or address. */
  from: RoutePlace;
  to: RoutePlace;
  /** What to pass on the way, in plain words: "a coffee shop", "scenic overlooks". */
  include?: string;
  /** What the route should stay clear of, in plain words: "avoid pothole streets". Steers driving routes. */
  conditions?: string;
  profile?: "driving" | "walking" | "cycling";
}

export interface RouteLine { type: "LineString"; coordinates: [number, number][] }

export interface RouteResult {
  model: "edk-1";
  usage: { routes: number; avoided: number; included: number; cu: number };
  data: {
    from: { lat: number; lng: number; label?: string };
    to: { lat: number; lng: number; label?: string };
    profile: "driving" | "walking" | "cycling";
    route: { distance_m: number; duration_s: number; geometry: RouteLine; steps: { instruction: string; name: string; distance_m: number; duration_s: number }[] };
    /** The plain route, when include or conditions changed the path, so the two can be compared. */
    direct?: { distance_m: number; duration_s: number; geometry: RouteLine; steps: RouteResult["data"]["route"]["steps"] };
    include?: { text: string; looked_for: string[]; cities: string[]; matches: number };
    /** The places the route passes, in order. */
    included: { lat: number; lng: number; name: string; kind: "location" | "area" }[];
    conditions?: { text: string; looked_for: string[]; cities: string[]; matches: number };
    /** The places the route was steered around. */
    avoided: { lat: number; lng: number; name: string; kind: "location" | "area" }[];
    /** Matches the final route still passes. */
    remaining?: number;
    note?: string;
  };
}

export interface MonitorOptions {
  /** Up to five artifact names or ids (see artifacts()). */
  artifacts: string[];
  /** A place name, "lat, lng", {lat, lng} or {region_id}. */
  area: string | { lat: number; lng: number } | { region_id: string };
  /** Events after this date. Default: a week ago. */
  since?: string;
  /** "15m", "1h", "6h" or "1d". */
  interval?: string | number;
  webhook_url?: string;
  /** Saved with the monitor; not used to filter events yet. */
  prompt?: string;
  name?: string;
}

export interface Monitor {
  id: string;
  name: string;
  prompt: string | null;
  artifacts: { id: string; name: string; source: "imagery" | "records" }[];
  area: { region_id: string; name: string; type: string; center: [number, number] | null };
  interval_minutes: number;
  since: string;
  webhook_url: string | null;
  webhook_secret?: string;
  status: "active" | "paused";
  status_reason?: string;
  events: number;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
}

export interface MonitorEvent {
  id: string;
  monitor_id: string;
  artifact: { id: string; name: string | null };
  occurred_at: string | null;
  detected_at: string;
  location: { lat: number; lng: number } | null;
  title: string | null;
  address: string | null;
  image_url: string | null;
  details: Record<string, unknown> | null;
  delivery: { status: string | null; at: string | null } | null;
}

export declare class EDKError extends Error {
  status: number;
  body: unknown;
}

export declare class EDK {
  constructor(options?: EDKOptions);
  request(method: string, path: string, init?: { query?: Record<string, unknown>; body?: unknown }): Promise<any>;
  discover(query: string, options?: DiscoverOptions): Promise<DiscoverResult>;
  inspect(point: { lat: number; lng: number }): Promise<InspectResult>;
  route(options: RouteOptions): Promise<RouteResult>;
  readonly monitors: {
    create(options: MonitorOptions): Promise<Monitor>;
    list(): Promise<{ data: Monitor[] }>;
    get(id: string): Promise<Monitor>;
    update(id: string, patch: Partial<Pick<MonitorOptions, "interval" | "webhook_url" | "prompt" | "name">> & { status?: "active" | "paused" }): Promise<Monitor>;
    pause(id: string): Promise<Monitor>;
    resume(id: string): Promise<Monitor>;
    delete(id: string): Promise<{ deleted: true }>;
    scan(id: string): Promise<{ found: number; kept: number; cu: number; delivered: number; webhook_status: string | null; errors?: string[] }>;
    events(id: string, options?: { after?: string; limit?: number }): Promise<{ data: MonitorEvent[] }>;
  };
  artifacts(q?: string): Promise<{ data: { id: string; name: string; description: string | null; kind: string; watchable: boolean }[] }>;
  result(id: string): Promise<{ id: string; model: "edk-1"; embed_url: string; created_at: string; data: DiscoverResult["data"] }>;
  usage(): Promise<{ balance_cu: number; month_cu: number; tier: { name: string; max_results: number; concurrency: number }; monthly_cu_cap: number | null; max_results: number; daily: { day: string; cu: number; calls: number }[] }>;
  /** @deprecated Use discover(). */
  search(query: string, options?: DiscoverOptions): Promise<DiscoverResult>;
}

export default EDK;
