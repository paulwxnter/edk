// Neighborhood labels for search results. `neighborhoods` holds OSM points (neighbourhood / quarter /
// suburb) with H3 cells, not boundaries, so labels are matched by distance inside the result's county:
// - area: the county polygon containing the result (regions, gist), with NYC counties shown as boroughs;
// - neighborhood: a neighbourhood/quarter point in the result's H3 r9 cell, else the nearest one within
//   NEAR_M in the same county (stops labels crossing a river into another borough), skipping
//   housing-complex names ("… Homes", "… Historic District");
// - district: the nearest suburb point within DISTRICT_M in the same county (Chicago community areas,
//   Toronto districts), skipped when it is just the borough/county name.
import { latLngToCell } from "h3-js";
import { sql } from "./e2-db";

export type NeighborhoodLabel = { neighborhood: string | null; district: string | null; area: string | null };

const NEAR_M = 1200;
const DISTRICT_M = 2500;
const MAX_POINTS = 60;
const MINOR_NAMES = "(homes|courts?|apartments|cottages|historic district|manor|towers|estates|houses|garden homes)$";

// Official county names that people know by another name.
const AREA_NAMES: Record<string, string> = {
  "New York County": "Manhattan",
  "Kings County": "Brooklyn",
  "Queens County": "Queens",
  "Richmond County": "Staten Island",
  "Bronx County": "The Bronx",
  Bronx: "The Bronx",
};

/** A representative [lng, lat] for a GeoJSON geometry (first vertex for lines and polygons). */
function pointOf(geometry: any): [number, number] | null {
  let c = geometry?.coordinates;
  while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
  return Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]) ? [Number(c[0]), Number(c[1])] : null;
}

/** One label per feature (same order); empty labels when the lookup fails. */
export async function nearestNeighborhoods(features: Array<{ geometry?: any }>): Promise<NeighborhoodLabel[]> {
  const empty: NeighborhoodLabel[] = features.map(() => ({ neighborhood: null, district: null, area: null }));
  const points = features.slice(0, MAX_POINTS).map((f) => pointOf(f.geometry));
  const index = points.flatMap((p, i) => (p ? [i] : []));
  if (!index.length) return empty;
  const lng = index.map((i) => points[i]![0]);
  const lat = index.map((i) => points[i]![1]);
  const r9 = index.map((i) => { try { return latLngToCell(points[i]![1], points[i]![0], 9); } catch { return null; } });
  try {
    const rows = await sql.withTimeout(2500, (tx) => tx.query(
      `select u.i::int as i, coalesce(exact.name, near.name) as neighborhood, district.name as district, county.name as area
         from unnest($1::float8[], $2::float8[], $3::text[]) with ordinality u(x, y, cell, i)
         cross join lateral (select st_setsrid(st_makepoint(u.x, u.y), 4326) as g) p
         left join lateral (select r.name, r.geometry from regions r
                             where r.favorite = true and r.status = 'verified' and r.geometry is not null and r.region_type = 'county'
                               and st_intersects(r.geometry, p.g) limit 1) county on true
         left join lateral (select n.name from neighborhoods n
                             where n.h3_r9 = u.cell and n.place in ('neighbourhood', 'quarter') and n.name !~* $4
                               and n.geometry && st_expand(p.g, 0.01) limit 1) exact on true
         left join lateral (select c.name from (select n.name, n.geometry from neighborhoods n
                               where n.place in ('neighbourhood', 'quarter') and n.name !~* $4
                               order by n.geometry <-> p.g limit 6) c
                             where st_dwithin(c.geometry::geography, p.g::geography, ${NEAR_M})
                               and (county.geometry is null or st_intersects(county.geometry, c.geometry))
                             order by c.geometry <-> p.g limit 1) near on true
         left join lateral (select c.name from (select n.name, n.geometry from neighborhoods n
                               where n.place = 'suburb' order by n.geometry <-> p.g limit 3) c
                             where st_dwithin(c.geometry::geography, p.g::geography, ${DISTRICT_M})
                               and (county.geometry is null or st_intersects(county.geometry, c.geometry))
                             order by c.geometry <-> p.g limit 1) district on true`,
      [lng, lat, r9, MINOR_NAMES],
    ));
    const labels = [...empty];
    for (const row of rows as any[]) {
      const at = index[Number(row.i) - 1];
      if (at === undefined) continue;
      const area = row.area ? AREA_NAMES[row.area] || row.area : null;
      const district = row.district && row.district !== row.neighborhood && row.district !== area && !Object.values(AREA_NAMES).includes(row.district) ? row.district : null;
      labels[at] = { neighborhood: row.neighborhood || null, district, area };
    }
    return labels;
  } catch (error) {
    console.error("[neighborhoods] lookup failed:", error instanceof Error ? error.message : error);
    return empty;
  }
}
