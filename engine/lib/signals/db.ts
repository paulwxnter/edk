// Signals data layer (server-only): artifacts are the catalog, ledger holds the numbers.
// Every lookup goes through ledger by numeric feature_id (indexed), never through a text join.
import { unstable_cache } from "lib/cache";
import { sql } from "lib/locate/e2-db";
import { isIndicatorType, sourceLabel, type Bench, type Model, type PeerRow, type Point, type Region, type RegionValue, type SearchHit, type Timeframe } from "./types";

const HOUR = 3600;
const cached = <A extends unknown[], R>(fn: (...args: A) => Promise<R>, key: string, revalidate = HOUR) =>
  unstable_cache(fn, ["insight", key], { revalidate, tags: ["insight", key] });

async function query<T = Record<string, any>>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await sql.query(text, params)) as unknown as T[];
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

const MODEL_COLS = "feature_id, slug, name, description, method, indicator_type, interests";
const REGION_COLS = "id, slug, name, region_type, state_code, country_code, population, area_sq_km";

function toModel(r: Record<string, any>): Model {
  return {
    featureId: Number(r.feature_id),
    slug: String(r.slug),
    name: String(r.name).replace(/ Web Usage$/i, ""),
    description: r.description ? String(r.description) : null,
    method: r.method ?? null,
    indicatorType: isIndicatorType(r.indicator_type) ? r.indicator_type : null,
    interests: Array.isArray(r.interests) ? r.interests : [],
  };
}

function toRegion(r: Record<string, any>): Region {
  return {
    id: Number(r.id),
    slug: String(r.slug ?? r.id),
    name: String(r.name),
    type: String(r.region_type),
    stateCode: r.state_code ?? null,
    countryCode: r.country_code ?? null,
    population: num(r.population),
    areaKm2: num(r.area_sq_km),
  };
}

/** Search ranks live civic streams first, then mapped and detected objects, then species (there are 200k+ of them). */
const METHOD_TIER = `case
  when method in ('permits','crimes','accidents','service_requests','inspections') then 0
  when method in ('osm','name','terms','data_centre_infrastructure','political_dataset_suite') or method like 'research%' then 1
  when method like '%web_tech%' then 2
  else 3 end`;

// ---------------------------------------------------------------- catalog

export const getModel = cached(async (slug: string): Promise<Model | null> => {
  const rows = await query(`select ${MODEL_COLS} from artifacts where slug = $1 and feature_id ~ '^[0-9]+$' limit 1`, [slug]);
  return rows[0] ? toModel(rows[0]) : null;
}, "model");

export const getRegion = cached(async (slug: string): Promise<Region | null> => {
  const rows = await query(`select ${REGION_COLS} from regions where slug = $1 order by array_position(array['city','county','state','country'], region_type) limit 1`, [slug]);
  return rows[0] ? toRegion(rows[0]) : null;
}, "region");

/** Feature + place search for the header. */
export const search = cached(async (q: string): Promise<SearchHit[]> => {
  const term = q.trim().toLowerCase();
  if (term.length < 2) return [];
  const [features, regions] = await Promise.all([
    query(
      `select slug, name, method, indicator_type from artifacts
       where lower(name) like '%' || $1 || '%' and feature_id ~ '^[0-9]+$' and slug is not null
       order by ${METHOD_TIER}, (lower(name) = $1) desc, (lower(name) like $1 || '%') desc, (lower(name) ~ ('\\m' || $2)) desc, length(name), name
       limit 8`,
      [term, term.replace(/[^a-z0-9 ]/g, "")]
    ),
    query(
      `select ${REGION_COLS} from regions where name ilike $1 || '%' and slug is not null
       order by (lower(name) = $1) desc, array_position(array['city','county','state','country'], region_type), population desc nulls last
       limit 4`,
      [term]
    ),
  ]);
  return [
    ...features.map((f): SearchHit => ({ kind: "feature", slug: f.slug, name: String(f.name).replace(/ Web Usage$/i, ""), type: isIndicatorType(f.indicator_type) ? f.indicator_type : null, source: sourceLabel(f.method) })),
    ...regions.map((r): SearchHit => {
      const region = toRegion(r);
      return { kind: "region", slug: region.slug, name: region.name, label: [region.type, region.stateCode ?? region.countryCode].filter(Boolean).join(" · ") };
    }),
  ];
}, "search");

// ---------------------------------------------------------------- one feature in one region

export type Availability = { timeframes: Exclude<Timeframe, "all">[]; total: number | null; bench: Bench | null };

/** What the ledger holds for a feature in a region: which series exist, the all-time total and the peer benchmark. */
export const getAvailability = cached(async (featureId: number, regionId: number): Promise<Availability> => {
  const rows = await query(
    `select timeframe, count(*)::int n,
            max(total_count) filter (where timeframe = 'all') total,
            max(quantity_rank) filter (where timeframe = 'all') quantity_rank,
            max(peer_count) filter (where timeframe = 'all') peer_count,
            max(quantity_percentile) filter (where timeframe = 'all') quantity_percentile,
            max(quantity_share) filter (where timeframe = 'all') quantity_share,
            max(quantity_country_rank) filter (where timeframe = 'all') quantity_country_rank
     from ledger where feature_id = $1 and region_id = $2 and measurement = 'count' group by timeframe`,
    [featureId, regionId]
  );
  const all = rows.find((r) => r.timeframe === "all");
  // A series needs at least two periods to be worth plotting.
  const timeframes = (["year", "monthly", "weekly"] as const).filter((t) => (rows.find((r) => r.timeframe === t)?.n ?? 0) >= 2);
  const bench: Bench | null =
    all && (all.quantity_rank != null || all.quantity_percentile != null)
      ? { rank: num(all.quantity_rank), peers: num(all.peer_count), percentile: num(all.quantity_percentile), share: num(all.quantity_share), countryRank: num(all.quantity_country_rank) }
      : null;
  return { timeframes: [...timeframes], total: all ? Number(all.total) || 0 : null, bench };
}, "availability");

const SERIES_SPAN: Record<Exclude<Timeframe, "all">, { periods: number; step: string }> = {
  year: { periods: 15, step: "1 year" },
  monthly: { periods: 48, step: "1 month" },
  weekly: { periods: 78, step: "1 week" },
};

export const getSeries = cached(async (featureId: number, regionId: number, tf: Exclude<Timeframe, "all">): Promise<Point[]> => {
  const { periods, step } = SERIES_SPAN[tf];
  const rows = await query(
    `with latest as (select max(date_from) d from ledger where region_id = $1 and feature_id = $2 and timeframe = $3 and measurement = 'count')
     select to_char(date_from, 'YYYY-MM-DD') d, total_count v
     from ledger, latest
     where region_id = $1 and feature_id = $2 and timeframe = $3 and measurement = 'count'
       and date_from > latest.d - ($4::int * $5::interval)
     order by date_from`,
    [regionId, featureId, tf, periods, step]
  );
  return rows.map((r) => ({ date: r.d, value: Number(r.v) || 0 }));
}, "series");

/** Top regions of one type for a feature (all-time counts). */
export const getTopRegions = cached(async (featureId: number, regionType: string, limit = 15): Promise<RegionValue[]> => {
  const rows = await query(
    `select r.id, r.slug, r.name, r.region_type, r.state_code, r.country_code, r.population, r.area_sq_km, l.total_count v
     from ledger l join regions r on r.id = l.region_id
     where l.feature_id = $1 and l.timeframe = 'all' and l.region_type = $2 and l.measurement = 'count' and l.total_count > 0 and r.slug is not null
     order by l.total_count desc limit $3`,
    [featureId, regionType, limit]
  );
  return rows.map((r) => ({ region: toRegion(r), value: Number(r.v) || 0 }));
}, "top-regions");

/** Region types a feature has data at, so the comparison only offers tabs that will fill. */
export const getRegionTypes = cached(async (featureId: number): Promise<string[]> => {
  const rows = await query(
    `select t from unnest(array['city','county','state','country']) t
     where exists (select 1 from ledger where feature_id = $1 and region_type = t and timeframe = 'all' and measurement = 'count' and total_count > 0)`,
    [featureId]
  );
  return rows.map((r) => r.t as string);
}, "region-types");

/** Regions with data for this feature whose name matches (used to add regions to a comparison). */
export const searchRegionsForFeature = cached(async (featureId: number, q: string): Promise<RegionValue[]> => {
  const term = q.trim();
  if (!term) return [];
  const rows = await query(
    `select r.id, r.slug, r.name, r.region_type, r.state_code, r.country_code, r.population, r.area_sq_km, l.total_count v
     from regions r join ledger l on l.region_id = r.id and l.feature_id = $1 and l.timeframe = 'all' and l.measurement = 'count' and l.total_count > 0
     where r.name ilike $2 || '%' and r.slug is not null
     order by (lower(r.name) = lower($2)) desc, l.total_count desc
     limit 8`,
    [featureId, term]
  );
  return rows.map((r) => ({ region: toRegion(r), value: Number(r.v) || 0 }));
}, "regions-for-feature");

/** The other indicators of the same type in this region, largest first. */
export const getPeers = cached(async (regionId: number, type: string): Promise<PeerRow[]> => {
  const rows = await query(
    `select a.slug, a.name, l.total_count v from (
       select feature_id, total_count from ledger
       where region_id = $1 and timeframe = 'all' and year = 0 and measurement = 'count' and total_count > 0
       order by total_count desc limit 4000
     ) l join artifacts a on a.feature_id = l.feature_id::text
     where a.indicator_type = $2 and a.slug is not null
     order by l.total_count desc limit 40`,
    [regionId, type]
  );
  const seen = new Set<string>();
  return rows.filter((r) => !seen.has(r.slug) && !!seen.add(r.slug)).map((r) => ({ slug: r.slug, name: String(r.name).replace(/ Web Usage$/i, ""), value: Number(r.v) || 0 }));
}, "peers", 6 * HOUR);

/** Best region to land on when a feature has nothing in the requested one. */
export async function getFallbackRegion(featureId: number): Promise<Region | null> {
  for (const t of ["city", "county", "state", "country"]) {
    const top = await getTopRegions(featureId, t, 1);
    if (top[0]) return top[0].region;
  }
  return null;
}
