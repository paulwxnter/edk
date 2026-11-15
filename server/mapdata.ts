// Data for edk.earth/map: the catalog of detected things (artifacts), the scenes and civic records behind
// each one, and the places they can be narrowed to. Read from the public catalog API on the server, cached
// at the edge, with every picture re-served from cdn.edk.earth.
import { mediaProxyUrl } from "lib/locate/media-proxy";
import { MAP_FILTERS, type MapFilter } from "../app/lib/mapkinds";
export { CIVIC_METHODS, MAP_FILTERS, isMapFilter, type MapFilter } from "../app/lib/mapkinds";

const BASE = "https://api.outerview.ai";

export type MapArtifact = { id: string; slug: string; name: string; description: string | null; method: string | null };
export type MapRegion = { id: string; slug: string; name: string; layer: string; state: string | null; country: string | null };
export type MapScene = { id: string; image: string | null; address: string | null; date: string | null; lng: number | null; lat: number | null };
export type MapRecord = { id: string; address: string | null; description: string | null; date: string | null; name: string | null; lng: number | null; lat: number | null; meta: [string, string][] };
export type MapDetail = {
  artifact: { slug: string; name: string; description: string | null; method: string | null; interests: string[]; totalScenes: number | null; lastScan: string | null; lastIndexed: string | null };
  region: MapRegion | null;
  related: { slug: string; name: string }[];
  scenes: MapScene[];
  page: number;
  hasMore: boolean;
};

class Upstream extends Error {
  constructor(public status: number) {
    super(`Catalog unavailable (${status})`);
  }
}

async function get<T>(path: string, params: Record<string, string | number | null | undefined> = {}, timeout = 25_000): Promise<T | null> {
  const url = new URL(path, BASE);
  for (const [key, value] of Object.entries(params)) if (value !== null && value !== undefined && value !== "") url.searchParams.set(key, String(value));
  const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeout), cf: { cacheTtl: 300, cacheEverything: true } } as RequestInit);
  if (res.status === 404) return null;
  if (!res.ok) throw new Upstream(res.status);
  return (await res.json()) as T;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const point = (geometry: any): [number | null, number | null] => {
  const c = geometry?.type === "Point" ? geometry.coordinates : null;
  return Array.isArray(c) && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1])) ? [Number(c[0]), Number(c[1])] : [null, null];
};

function toRegion(r: any): MapRegion | null {
  if (!r?.slug) return null;
  return { id: String(r.id), slug: String(r.slug), name: String(r.name), layer: String(r.layer ?? ""), state: str(r.state_name ?? r.stateName), country: str(r.country_name ?? r.countryName) };
}

export async function listArtifacts({ q, filter = "all", page = 1 }: { q?: string; filter?: MapFilter; page?: number }) {
  const type = MAP_FILTERS.find((f) => f.key === filter)?.type ?? null;
  const body = await get<{ data: any[]; page: number; hasMore: boolean }>("/v1/beacon", { q: q?.trim().slice(0, 120), type, page });
  return {
    artifacts: (body?.data ?? []).map((a): MapArtifact => ({ id: String(a.id), slug: String(a.slug), name: String(a.name), description: str(a.description), method: str(a.method) })),
    page: body?.page ?? page,
    hasMore: Boolean(body?.hasMore),
  };
}

export async function getArtifact(slug: string, { region, page = 1 }: { region?: string | null; page?: number } = {}): Promise<MapDetail | null> {
  const body = await get<any>(`/v1/beacon/${encodeURIComponent(slug)}`, { page, region_slug: region });
  if (!body?.artifact) return null;
  const a = body.artifact;
  return {
    artifact: {
      slug,
      name: String(a.name),
      description: str(a.description),
      method: str(a.method),
      interests: Array.isArray(a.interests) ? a.interests.filter((i: unknown) => typeof i === "string") : [],
      totalScenes: a.totalScenes == null ? null : Number(a.totalScenes),
      lastScan: str(a.lastScan),
      lastIndexed: str(a.lastIndexed),
    },
    region: toRegion(body.region),
    related: Array.isArray(body.related) ? body.related.map((r: any) => ({ slug: String(r.slug), name: String(r.name) })) : [],
    scenes: (Array.isArray(body.scenes) ? body.scenes : []).map((s: any): MapScene => {
      const [lng, lat] = point(s.geometry);
      return { id: String(s.id), image: mediaProxyUrl(s.visualUrl, "image"), address: str(s.address), date: str(s.date), lng, lat };
    }),
    page: Number(body.page ?? page),
    hasMore: Boolean(body.hasMore),
  };
}

export const RECORDS_PAGE = 50;

export async function getRecords(slug: string, { region, page = 1, year, from, to }: { region?: string | null; page?: number; year?: string | null; from?: string | null; to?: string | null }) {
  const body = await get<any>("/v1/data", {
    artifact: slug,
    region,
    page,
    limit: RECORDS_PAGE,
    year: year && /^\d{4}$/.test(year) ? year : null,
    date_from: from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : null,
    date_to: to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : null,
  }, 45_000);
  const features: any[] = body?.data?.geojson?.features ?? [];
  return {
    records: features.map((f, i): MapRecord => {
      const p = f.properties ?? {};
      const [lng, lat] = point(f.geometry);
      const meta = p.source_metadata && typeof p.source_metadata === "object" && !Array.isArray(p.source_metadata)
        ? Object.entries(p.source_metadata as Record<string, unknown>)
            .filter(([, v]) => v !== null && v !== "" && typeof v !== "object")
            .map(([k, v]): [string, string] => [k.replace(/_/g, " "), String(v)])
        : [];
      return { id: String(f.id ?? `${page}-${i}`), address: str(p.address), description: str(p.description), date: str(p.date), name: str(p.name), lng, lat, meta };
    }),
    page: Number(body?.data?.page ?? page),
    hasMore: Boolean(body?.data?.hasMore),
  };
}

export async function searchRegions(q: string) {
  const body = await get<{ data: any[] }>("/v1/regions", { q: q.trim().slice(0, 60), page: 1, pageSize: 40 }, 10_000);
  return (body?.data ?? []).map(toRegion).filter((r): r is MapRegion => r !== null);
}

/** The dataset file for one artifact (and region) as CSV, GeoJSON or Parquet. */
export async function downloadDataset(slug: string, region: string | null, format: string) {
  const url = new URL(`/api/v1/beacon/${encodeURIComponent(slug)}/download`, BASE);
  if (region) url.searchParams.set("region_slug", region);
  url.searchParams.set("format", format);
  return fetch(url, { signal: AbortSignal.timeout(120_000) });
}
