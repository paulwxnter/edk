import { sql } from "lib/locate/e2-db";
import { CIVIC_METHODS, INDICATOR_TYPES, PLACE_METHODS, kindOf, type Artifact, type IndicatorTypeId } from "lib/lens";
import { SCENE_REGION_COLUMN, type Region, type RegionType } from "lib/regions";
import { CIVIC_LATEST_WHERE, CIVIC_SELECT, civicFields, httpsOnly, safeTable, titleCase } from "lib/live/civic-row";

const ARTIFACT_COLS = `id::text as id, slug, name, description, method, indicator_type, icon_emoji, icon_url, source_table,
  coalesce(total_scenes, 0)::float8 as total_scenes`;

type Row = Artifact & { source_table: string | null };

const toArtifact = (r: any): Row => ({
  id: r.id,
  slug: r.slug || null,
  name: r.name,
  description: r.description || null,
  method: r.method || null,
  indicator_type: r.indicator_type || null,
  icon_emoji: r.icon_emoji || null,
  icon_url: typeof r.icon_url === "string" && r.icon_url.startsWith("https://") ? r.icon_url : null,
  total_scenes: Number(r.total_scenes) || 0,
  source_table: r.source_table || null,
  kind: kindOf(r.method, Number(r.total_scenes) || 0),
});

const civicList = CIVIC_METHODS.map((m) => `'${m}'`).join(",");
const placeList = PLACE_METHODS.map((m) => `'${m}'`).join(",");


const ANY_KIND = `(total_scenes > 0 or (method in (${civicList},${placeList}) and source_table is not null))`;
const ORDER = `order by total_scenes desc nulls last, (description is null), name`;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

/**
 * The Lens list. With a kind: that kind only. With a search term: matching names across every kind.
 * With neither: the leading artifacts of each kind, so every source shows up in "All".
 */
export async function listArtifacts({ q, type }: { q?: string; type?: IndicatorTypeId | null }): Promise<Artifact[]> {
  const term = (q || "").trim().slice(0, 80);
  const strip = (rows: Row[]) => rows.map(({ source_table, ...a }) => a as Artifact);
  if (type || term) {
    const params: unknown[] = [];
    let where = `status = 'verified' and ${ANY_KIND}`;
    if (term) {
      params.push(`%${escapeLike(term)}%`, term);
      where += ` and name ilike $1`;
    }
    if (type) {
      params.push(type);
      where += ` and indicator_type = $${params.length}`;
    }
    const rows = await sql.query(
      `select ${ARTIFACT_COLS} from artifacts where ${where}
       order by ${term ? "(lower(name) = lower($2)) desc, (name ilike $2 || '%') desc," : ""} total_scenes desc nulls last, (description is null), name
       limit 150`,
      params,
    );
    return strip((rows as any[]).map(toArtifact));
  }
  const per = await Promise.all(
    INDICATOR_TYPES.map((t) => sql.query(`select ${ARTIFACT_COLS} from artifacts where status = 'verified' and ${ANY_KIND} and indicator_type = $1 ${ORDER} limit 14`, [t.id])),
  );
  return strip(per.flat().map(toArtifact));
}

/** One artifact by id or slug, with its source table (server-only). */
export async function getArtifact(idOrSlug: string): Promise<Row | null> {
  const byId = /^[0-9a-f-]{36}$/i.test(idOrSlug);
  const rows = (await sql.query(
    `select ${ARTIFACT_COLS} from artifacts where status = 'verified' and ${byId ? "id = $1::uuid" : "slug = $1"} order by total_scenes desc nulls last limit 1`,
    [idOrSlug],
  )) as any[];
  return rows[0] ? toArtifact(rows[0]) : null;
}

const MAX_POINTS = 20;
const TIMEOUT_MS = 20000;

/** Up to 20 points of one artifact, optionally inside one region, as GeoJSON features. */
export async function loadArtifactFeatures(artifact: Row, region: { id: string; type: RegionType } | null) {
  const column = region ? SCENE_REGION_COLUMN[region.type] : null;
  const filter = (alias = "") => (column ? `and ${alias}${column} = $1::bigint` : "");
  const params = column ? [region!.id] : [];

  // Street-level imagery: the shared scenes table.
  if (artifact.kind === "imagery") {
    const rows = (await sql.withTimeout(TIMEOUT_MS, (tx) =>
      tx.query(
        // The picture comes from embed_sv (the migrated image), not the scene's own visual_url.
        `select s.id, s.artifact_name, coalesce(e.address, s.address) as address, s.captured_at, s.year, s.lng, s.lat,
                coalesce(nullif(btrim(e.image_url), ''), nullif(btrim(e.visual_url), ''), s.visual_url) as image
         from (select embedsv_id, embedsv_id::text as id, artifact_name, address, visual_url, captured_at, year,
                      ST_X(ST_Centroid(geometry)) as lng, ST_Y(ST_Centroid(geometry)) as lat
               from scenes where artifact_id = $${params.length + 1}::uuid and geometry is not null ${filter()}
               limit ${MAX_POINTS}) s
         left join embed_sv e on e.id = s.embedsv_id`,
        [...params, artifact.id],
      ),
    )) as any[];
    return rows.map((r) => feature(r.id, r.lng, r.lat, {
      address: r.address,
      feature_name: r.artifact_name || artifact.name,
      image_url: httpsOnly(r.image),
      icon_url: artifact.icon_url,
      date: r.captured_at ?? (r.year ? `${r.year}-01-01` : null),
    }));
  }

  const table = safeTable(artifact.source_table);
  if (!table) return [];

  // OpenStreetMap layers: name, address, brand and opening hours.
  if (artifact.kind === "places") {
    const rows = (await sql.withTimeout(TIMEOUT_MS, (tx) =>
      tx.query(
        `select id::text as id, name, address, brand, website, opening_hours, visual_url, properties,
                coalesce(lng, ST_X(ST_PointOnSurface(geometry))) as lng, coalesce(lat, ST_Y(ST_PointOnSurface(geometry))) as lat
         from ${table} where (lat is not null or geometry is not null) ${filter()}
         limit ${MAX_POINTS}`,
        params,
      ),
    )) as any[];
    return rows.map((r) => feature(`${artifact.source_table}:${r.id}`, r.lng, r.lat, {
      // A place reads best by its name, with the street address underneath.
      address: r.name || r.address || null,
      location: r.name && r.address ? r.address : null,
      feature_name: artifact.name,
      brand: r.brand || null,
      website: httpsOnly(r.website),
      opening_hours: r.opening_hours || null,
      image_url: httpsOnly(r.visual_url),
      icon_url: artifact.icon_url,
      osm: osmDetails(r.properties),
    }));
  }

  // Civic record streams (permits, crimes, collisions, 311, inspections): newest first. The predicate
  // mirrors the tables' partial "<region>_date_latest" indexes, so this is an index walk, not a sort.
  const rows = (await sql.withTimeout(TIMEOUT_MS, (tx) =>
    tx.query(
      `select ${CIVIC_SELECT}
       from ${table}
       where ${CIVIC_LATEST_WHERE} ${filter()}
         ${column ? `and ${column} is not null` : ""} and (latitude is not null or geometry is not null)
       order by date desc, id desc
       limit ${MAX_POINTS}`,
      params,
    ),
  )) as any[];
  return rows.map((r) => {
    const f = civicFields(r);
    return feature(`${artifact.source_table}:${r.id}`, r.lng, r.lat, {
      address: f.address,
      name: f.name,
      neighborhood: f.neighborhood,
      location: f.location,
      feature_name: artifact.name,
      description: f.description,
      status: f.status,
      image_url: f.image_url,
      icon_url: artifact.icon_url,
      date: r.date ?? null,
    });
  });
}

/** The OpenStreetMap tags people actually look for, pulled out of the raw tag bag. */
function osmDetails(raw: unknown) {
  const t = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!t) return null;
  const s = (...keys: string[]) => {
    for (const k of keys) {
      const v = t[k];
      if ((typeof v === "string" || typeof v === "number") && String(v).trim()) return String(v).trim().slice(0, 300);
    }
    return null;
  };
  const site = s("website", "contact:website", "url");
  const street = [s("addr:housenumber"), s("addr:street")].filter(Boolean).join(" ");
  const out: Record<string, string | null> = {
    category: s("label_name", "amenity", "shop", "tourism", "leisure", "office", "craft", "healthcare"),
    phone: s("phone", "contact:phone", "contact:mobile"),
    email: s("email", "contact:email"),
    website: site ? (/^https?:\/\//i.test(site) ? site.replace(/^http:/i, "https:") : `https://${site}`) : null,
    address: [street, s("addr:city"), s("addr:postcode")].filter(Boolean).join(", ") || null,
    cuisine: s("cuisine"),
    operator: s("operator"),
    brand: s("brand"),
    description: s("description", "note"),
    wheelchair: s("wheelchair"),
    internet: s("internet_access"),
    outdoor_seating: s("outdoor_seating"),
    takeaway: s("takeaway"),
    delivery: s("delivery"),
    diet_vegetarian: s("diet:vegetarian"),
    diet_vegan: s("diet:vegan"),
    smoking: s("smoking"),
    fee: s("fee"),
    access: s("access"),
    capacity: s("capacity"),
    level: s("level"),
    stars: s("stars"),
    denomination: s("denomination", "religion"),
    sport: s("sport"),
    surface: s("surface"),
    height: s("height"),
    start_date: s("start_date"),
    wikipedia: s("wikipedia"),
    facebook: s("contact:facebook", "facebook"),
    instagram: s("contact:instagram", "instagram"),
    checked: s("check_date", "survey:date"),
  };
  const kept = Object.fromEntries(Object.entries(out).filter(([, v]) => v));
  return Object.keys(kept).length ? kept : null;
}

function feature(id: string, lng: unknown, lat: unknown, properties: Record<string, unknown>) {
  const x = Number(lng);
  const y = Number(lat);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { type: "Feature" as const, id, geometry: { type: "Point", coordinates: [x, y] }, properties };
}

// ---------------------------------------------------------------- regions by slug / id

const REGION_COLS = `r.id::text as id, r.slug, r.name, r.region_type, coalesce(r.country_code, r.iso2) as country_code, r.state_code,
  r.longitude::float8 as lng, r.latitude::float8 as lat,
  ST_XMin(coalesce(r.bbox, r.geometry)) as w, ST_YMin(coalesce(r.bbox, r.geometry)) as s,
  ST_XMax(coalesce(r.bbox, r.geometry)) as e, ST_YMax(coalesce(r.bbox, r.geometry)) as n`;

export function toRegion(row: any): Region {
  const box = [row.w, row.s, row.e, row.n].map(Number);
  const context =
    row.region_type === "country" ? "" : [row.region_type !== "state" ? row.state_code : null, row.country_code].filter(Boolean).join(", ");
  return {
    id: row.id,
    slug: row.slug || null,
    name: row.name,
    type: row.region_type,
    context,
    countryCode: typeof row.country_code === "string" && /^[a-z]{2}$/i.test(row.country_code) ? row.country_code.toUpperCase() : null,
    center: Number.isFinite(row.lng) && Number.isFinite(row.lat) ? [row.lng, row.lat] : null,
    bbox: box.every(Number.isFinite) ? (box as Region["bbox"]) : null,
  };
}

export { REGION_COLS };

export async function getRegionBySlug(slug: string): Promise<Region | null> {
  const rows = (await sql.query(
    `select ${REGION_COLS} from regions r where r.slug = $1
     order by r.favorite desc nulls last, r.population desc nulls last limit 1`,
    [slug],
  )) as any[];
  return rows[0] ? toRegion(rows[0]) : null;
}

export async function getRegionById(id: string): Promise<Region | null> {
  if (!/^\d+$/.test(id)) return null;
  const rows = (await sql.query(`select ${REGION_COLS} from regions r where r.id = $1::bigint limit 1`, [id])) as any[];
  return rows[0] ? toRegion(rows[0]) : null;
}
