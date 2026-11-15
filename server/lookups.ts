// Inspect (ported from atlasx): what is known about the small area under a point, titled and explained
// by the attribute legend and grouped by category. Ids, codes and data years are left out.
import { sql } from "lib/locate/e2-db";
import { cellAt, cellRing } from "lib/locate/areas";
import { isInternal, legend, readAttribute, type Reading } from "lib/locate/legend";

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

/** Everything known about the small area under a point. The cell and ring stay internal (see shape.ts). */
export async function inspect(lat: unknown, lng: unknown) {
  const p = point(lat, lng);
  if (!p) throw new LookupError("Give a point as lat and lng.");
  const cell = cellAt(p.lng, p.lat);
  const [guide, rows] = await Promise.all([legend(), sql.query("select * from h3_hexagons where id = $1::h3index limit 1", [cell]) as Promise<any[]>]);
  const row = rows[0] ?? null;
  const base = { cell, ring: cellRing(cell), center: row && Number.isFinite(Number(row.lng)) ? [Number(row.lng), Number(row.lat)] : [p.lng, p.lat] };
  if (!row) return { ...base, known: false, place: [], highlights: [], categories: [] };
  const ids = [row.r_id, row.p_id, row.s_id, row.c_id].filter((v) => v != null).map(String);
  const regions = ids.length ? ((await sql.query("select id::text as id, name, region_type, coalesce(country_code, iso2) as country_code from regions where id = any($1::bigint[])", [ids]).catch(() => [])) as any[]) : [];
  const place = ["city", "county", "state", "country"].flatMap((type) => {
    const r = regions.find((x) => x.region_type === type);
    return r ? [{ type, name: String(r.name) }] : [];
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
  const strip = ({ category, note, ...item }: Reading) => ({ ...item, ...(note ? { note } : {}) });
  const categories = Array.from(groups, ([name, items]) => ({ name, items: items.map(strip) })).sort((a, b) => rank(a.name) - rank(b.name));
  const highlights = HIGHLIGHTS.flatMap(([key, title]) => {
    const reading = readAttribute(guide, key, row[key]);
    return reading ? [{ ...strip(reading), title }] : [];
  }).slice(0, 4);
  return { ...base, known: true, place, highlights, categories };
}
