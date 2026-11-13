export interface EDKOptions {
  /** Defaults to process.env.EDK_API_KEY. */
  apiKey?: string;
  /** Defaults to https://api.edk.earth. */
  baseUrl?: string;
  fetch?: typeof fetch;
  client?: string;
}

export interface Usage {
  /** Locations returned. */
  locations: number;
  /** Areas returned. */
  areas: number;
  /** Compute Units used: one CU covers five locations or areas. */
  cu: number;
}

export interface Feature {
  type: "Feature";
  id?: string;
  geometry: { type: "Point"; coordinates: [number, number] } | null;
  properties: { name?: string; address?: string; feature_name?: string; image_url?: string; date?: string; kind?: string; h3?: string; [key: string]: unknown };
}

export interface SearchOptions {
  /** 1–60, default 20. */
  limit?: number;
  /** Up to 4 points to search around, [lng, lat]. */
  areas?: [number, number][];
  /** A region id to search in when the query names no place. */
  focus?: string;
  /** Include a written answer (default true). */
  answer?: boolean;
}

export interface SearchResult {
  id: string;
  embed_url: string;
  usage: Usage;
  data: {
    query: string;
    answer?: string;
    duration_ms: number;
    geojson: { type: "FeatureCollection"; features: Feature[] };
    regions: { id: string; name: string; [key: string]: unknown }[];
    filters: unknown[];
    trends?: unknown;
    areas?: { index: number; center: [number, number]; cells: string[]; label?: string }[];
    [key: string]: unknown;
  };
}

export interface Envelope<T> {
  usage: Usage;
  data: T;
}

export declare class EDKError extends Error {
  status: number;
  body: unknown;
}

export declare class EDK {
  constructor(options?: EDKOptions);
  request(method: string, path: string, init?: { query?: Record<string, unknown>; body?: unknown }): Promise<any>;
  get(path: string, query?: Record<string, unknown>): Promise<any>;
  search(query: string, options?: SearchOptions): Promise<SearchResult>;
  result(id: string): Promise<{ id: string; embed_url: string; created_at: string; data: SearchResult["data"] }>;
  inspect(point: { lat: number; lng: number }): Promise<Envelope<any>>;
  regions(params: { q?: string; type?: "country" | "state" | "county" | "city"; slug?: string; id?: string; lat?: number; lng?: number }): Promise<Envelope<any>>;
  geocode(q: string): Promise<Envelope<{ places: { name: string; address: string | null; lat: number; lng: number; exact: boolean }[] }>>;
  catalog(params?: { q?: string; type?: string; slug?: string }): Promise<Envelope<any>>;
  sources(params: { keys?: string; artifacts?: string }): Promise<Envelope<any>>;
  usage(): Promise<{ balance_cu: number; month_cu: number; monthly_cu_cap: number | null; max_results: number | null; daily: { day: string; cu: number; locations: number; areas: number; calls: number }[] }>;
  trends: {
    search(q: string): Promise<Envelope<any>>;
    regions(params: { feature: string; type?: string; q?: string }): Promise<Envelope<any>>;
    series(params: { feature: string; regions: string[] | string; tf?: "year" | "monthly" | "weekly" }): Promise<Envelope<any>>;
  };
}

export default EDK;
