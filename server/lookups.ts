// Lookups beside search (ported from atlasx routes): inspect an area, regions, geocoding, sources,
// the searchable catalog, and trends series. Each returns plain JSON or throws LookupError.
import { sql } from "lib/locate/e2-db";
import { cellAt, cellRing } from "lib/locate/areas";
import { isInternal, legend, readAttribute, type Reading } from "lib/locate/legend";
import { datasetsFor } from "lib/locate/datasets";
import { REGION_ORDER } from "lib/regions";
import { REGION_COLS as COLUMNS, getArtifact, getRegionById, getRegionBySlug, listArtifacts, toRegion } from "lib/lens-server";
import { isIndicatorTypeId } from "lib/lens";
import { getModel, getRegion, getSeries, getTopRegions, search as searchSignals, searchRegionsForFeature } from "lib/signals/db";
import { isSeriesTimeframe } from "lib/signals/types";

export class LookupError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const CATEGORY_ORDER = [
  "Demographics", "Population", "Employment", "Settlement", "Built environment", "Land use", "Land cover", "Accessibility",
  "Terrain", "Flood hazard", "Wildfire hazard", "Air quality", "Industrial facilities", "Surface water", "Coast",
  "Climate", "Climate normals", "Ecology", "Geology", "Soil", "Agriculture", "Solar energy", "Wind energy",
];
const HIGHLIGHTS: [string, string][] = [
  ["acs_median_household_income_usd", "Household income"],
  ["ghsl_pop_1km_2020", "People nearby"],
  ["elevation_m", "Elevation"],
  ["flood_zone", "Flood risk"],
  ["nlcd_tree_canopy_pct", "Tree canopy"],
  ["acag_pm25_latest_ugm3", "Air quality"],
  ["settlement_type", "Setting"],
  ["climate_description", "Climate"],
];

function point(lat: unknown, lng: unknown) {
  const la = parseFloat(String(lat ?? ""));
  const ln = parseFloat(String(lng ?? ""));
  if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
  return { lat: la, lng: ln };
}

/** Everything known about the small area (H3 cell) under a point. */
export async function inspect(lat: unknown, lng: unknown) {
  const p = point(lat, lng);
  if (!p) throw new LookupError("Give a place as lat and lng.");
  const cell = cellAt(p.lng, p.lat);
  const [guide, rows] = await Promise.all([legend(), sql.query("select * from h3_hexagons where id = $1::h3index limit 1", [cell]) as Promise<any[]>]);
  const row = rows[0] ?? null;
  const base = { cell, ring: cellRing(cell), center: row && Number.isFinite(Number(row.lng)) ? [Number(row.lng), Number(row.lat)] : [p.lng, p.lat] };
  if (!row) return { ...base, known: false, place: [], highlights: [], categories: [] };
  const ids = [row.r_id, row.p_id, row.s_id, row.c_id].filter((v) => v != null).map(String);
  const regions = ids.length ? ((await sql.query("select id::text as id, name, region_type, coalesce(country_code, iso2) as country_code from regions where id = any($1::bigint[])", [ids]).catch(() => [])) as any[]) : [];
  const place = ["city", "county", "state", "country"].flatMap((type) => {
    const r = regions.find((x) => x.region_type === type);
    return r ? [{ type, name: String(r.name), countryCode: r.country_code || null }] : [];
  });
  const groups = new Map<string, Reading[]>();
  for (const field of guide.fields) {
    if (!field.inHexagons || isInternal(field)) continue;
    const reading = readAttribute(guide, field.column, row[field.column]);
    if (!reading) continue;
    const list = groups.get(field.category) ?? [];
    if (list.some((r) => r.value === reading.value && !reading.detail)) continue;
    list.push(reading);
    groups.set(field.category, list);
  }
  const rank = (name: string) => CATEGORY_ORDER.indexOf(name) + 1 || CATEGORY_ORDER.length + 1;
  const strip = ({ category, ...item }: Reading) => item;
  const categories = Array.from(groups, ([name, items]) => ({ name, items: items.map(strip) })).sort((a, b) => rank(a.name) - rank(b.name));
  const highlights = HIGHLIGHTS.flatMap(([key, title]) => {
    const reading = readAttribute(guide, key, row[key]);
    return reading ? [{ ...strip(reading), title }] : [];
  }).slice(0, 4);
  return { ...base, known: true, place, highlights, categories };
}

/** Regions by slug, id, name (q, optional type) or containing a point (lat, lng). */
export async function regions(params: URLSearchParams) {
  const slug = (params.get("slug") || "").trim();
  if (slug) {
    const region = /^[a-z0-9-]{1,120}$/.test(slug) ? await getRegionBySlug(slug) : null;
    if (!region) throw new LookupError("Unknown region.", 404);
    return { region };
  }
  const id = (params.get("id") || "").trim();
  if (id) {
    const region = /^\d+$/.test(id) ? await getRegionById(id) : null;
    if (!region) throw new LookupError("Unknown region.", 404);
    return { region };
  }
  const q = (params.get("q") || "").trim();
  if (q) {
    if (q.length < 2 || q.length > 80) return { regions: [] };
    const type = REGION_ORDER.find((t) => t === params.get("type"));
    const like = `%${q.replace(/[%_]/g, "\\$&")}%`;
    const rows = await sql.query(
      `select ${COLUMNS} from regions r
       where r.favorite = true and r.name ilike $1 ${type ? "and r.region_type = $3" : ""}
       order by (lower(r.name) = lower($2)) desc, (r.region_type = 'country') desc, (r.region_type = 'state') desc,
                r.population desc nulls last, length(r.name)
       limit 12`,
      type ? [like, q, type] : [like, q],
    );
    return { regions: (rows as any[]).map(toRegion) };
  }
  const p = point(params.get("lat"), params.get("lng"));
  if (!p) throw new LookupError("Give a place (lat, lng), a name (q), an id or a slug.");
  const rows = (await sql.query(
    `select ${COLUMNS} from regions r
     where r.favorite = true and r.status = 'verified' and r.geometry is not null
       and ST_Contains(r.geometry, ST_SetSRID(ST_MakePoint($1, $2), 4326))`,
    [p.lng, p.lat],
  )) as any[];
  return { levels: REGION_ORDER.map((type) => rows.find((r) => r.region_type === type)).filter(Boolean).map(toRegion) };
}

/** Addresses and places for a text query, from Mapbox. A "lat, lng" pair is returned as is. */
export async function geocode(qRaw: unknown) {
  const q = String(qRaw ?? "").trim().slice(0, 200);
  if (q.length < 3) return { places: [] };
  const pair = q.match(/^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (pair && Math.abs(Number(pair[1])) <= 90 && Math.abs(Number(pair[2])) <= 180) {
    const [lat, lng] = [Number(pair[1]), Number(pair[2])];
    return { places: [{ id: null, name: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, context: "Exact coordinates", address: null, lng, lat, exact: true }] };
  }
  const token = process.env.MAPBOX_API_KEY;
  if (!token) throw new LookupError("Geocoding is not configured.", 503);
  const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
  url.searchParams.set("q", q);
  url.searchParams.set("autocomplete", "true");
  url.searchParams.set("limit", "6");
  url.searchParams.set("types", "address,street,postcode,place,locality,neighborhood");
  url.searchParams.set("access_token", token);
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new LookupError("Geocoding is unavailable right now.", 502);
  const data = (await res.json()) as any;
  const places = (data.features ?? []).flatMap((f: any) => {
    const p = f.properties ?? {};
    const [lng, lat] = f.geometry?.coordinates ?? [];
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return [];
    return [{ id: p.mapbox_id ?? f.id ?? null, name: p.name_preferred || p.name || p.full_address || q, context: p.place_formatted || "", address: p.full_address || [p.name, p.place_formatted].filter(Boolean).join(", "), lng, lat, exact: p.feature_type === "address" }];
  });
  return { places };
}

/** The published sources behind attribute keys, and the datasets behind result artifacts. */
export async function sources(params: URLSearchParams) {
  const artifactIds = (params.get("artifacts") || "").split(",").map((k) => k.trim()).filter(Boolean).slice(0, 20);
  const keys = (params.get("keys") || "").split(",").map((k) => k.trim()).filter((k) => /^[a-z0-9_]{1,80}$/.test(k)).slice(0, 30);
  const [guide, datasets] = await Promise.all([keys.length ? legend() : null, datasetsFor(artifactIds)]);
  const out = new Map<string, any>();
  for (const key of keys) {
    const field = guide?.byColumn.get(key);
    if (!field) continue;
    const name = field.source.title || field.source.publisher || field.category;
    const entry = out.get(name) ?? { name, category: field.category, publisher: field.source.publisher, release: field.source.release, description: field.source.description, url: field.source.url, license: field.source.license, citation: field.source.citation, attributes: [] as any[] };
    entry.attributes.push({ key, title: field.title, about: field.about });
    out.set(name, entry);
  }
  return { sources: Array.from(out.values()), datasets };
}

/** What can be searched for: the catalog of located things (lenses). */
export async function catalog(params: URLSearchParams) {
  const slug = (params.get("slug") || "").trim();
  if (slug) {
    const found = /^[a-z0-9-]{1,200}$/i.test(slug) ? await getArtifact(slug) : null;
    if (!found) throw new LookupError("Unknown catalog entry.", 404);
    const { source_table, ...artifact } = found as any;
    return { artifact };
  }
  const type = params.get("type");
  return { artifacts: await listArtifacts({ q: (params.get("q") || "").slice(0, 80), type: isIndicatorTypeId(type) ? type : null }) };
}

export async function trendsSearch(q: unknown) {
  return { hits: await searchSignals(String(q ?? "").slice(0, 80)) };
}

export async function trendsRegions(params: URLSearchParams) {
  const model = await getModel(params.get("feature") ?? "");
  if (!model) throw new LookupError("Unknown feature.", 404);
  const q = params.get("q");
  if (q != null) return { regions: await searchRegionsForFeature(model.featureId, q.slice(0, 60)) };
  const type = ["city", "county", "state", "country"].includes(params.get("type") ?? "") ? params.get("type")! : "city";
  return { regions: await getTopRegions(model.featureId, type, 15) };
}

export async function trendsSeries(params: URLSearchParams) {
  const tf = params.get("tf") ?? "monthly";
  if (!isSeriesTimeframe(tf)) throw new LookupError("tf must be year, monthly or weekly.");
  const model = await getModel(params.get("feature") ?? "");
  if (!model) throw new LookupError("Unknown feature.", 404);
  const slugs = (params.get("regions") ?? "").split(",").filter(Boolean).slice(0, 5);
  if (!slugs.length) throw new LookupError("Give one to five region slugs in regions.");
  const series = await Promise.all(
    slugs.map(async (slug) => {
      const region = await getRegion(slug);
      return region ? { region, points: await getSeries(model.featureId, region.id, tf) } : null;
    }),
  );
  return { feature: { slug: model.slug, name: model.name }, timeframe: tf, series: series.filter(Boolean) };
}
