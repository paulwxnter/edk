// Areas: the resolution-8 H3 cells of h3_hexagons, which carry every place attribute.
// Used three ways: areas picked on the map (query context), area search ("high income areas in
// New York City") and the Inspect tool (everything known about one cell).
import { cellToBoundary, gridDisk, latLngToCell } from "h3-js";
import { sql } from "./e2-db";
import { appendSqlFilters, type AttributeFilter } from "./attributes";
import { CONTEXT_KEYS } from "./attributes/display";

export const AREA_RESOLUTION = 8;
const REGION_COLUMN: Record<string, string> = { city: "r_id", state: "s_id", county: "p_id", country: "c_id" };

let columnsPending: Promise<Set<string>> | null = null;
/** Column names of h3_hexagons (read once per server instance). */
export function hexColumns() {
  if (!columnsPending) {
    columnsPending = sql
      .query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'h3_hexagons'")
      .then((rows: any[]) => new Set(rows.map((r) => String(r.column_name))))
      .catch(() => {
        columnsPending = null;
        return new Set<string>();
      });
  }
  return columnsPending;
}

export const cellAt = (lng: number, lat: number) => latLngToCell(lat, lng, AREA_RESOLUTION);

/** A cell's outline as a closed [lng, lat] ring. */
export function cellRing(cell: string): [number, number][] {
  const ring = cellToBoundary(cell, true) as [number, number][];
  return ring;
}

export type PickedArea = { index: number; lng: number; lat: number; cell: string; cells: string[]; stateId: string | null; /** An asset's name, when the area is one of the user's assets. */ label?: string };

/** A user's assets as search areas: each asset's own cell plus its six neighbours. */
export function assetAreas(assets: { name: string; latitude: number; longitude: number; s_id: string | null; h3_r8: string | null }[]): PickedArea[] {
  return assets.map((a, i) => {
    const cell = a.h3_r8 || cellAt(Number(a.longitude), Number(a.latitude));
    return { index: i + 1, lng: Number(a.longitude), lat: Number(a.latitude), cell, cells: gridDisk(cell, 1), stateId: a.s_id, label: a.name };
  });
}

/** Turns points picked on the map into search areas: the cell under each point plus its six neighbours, and the state it sits in. */
export async function resolvePickedAreas(points: [number, number][]): Promise<PickedArea[]> {
  const areas = points.map(([lng, lat], i) => {
    const cell = cellAt(lng, lat);
    return { index: i + 1, lng, lat, cell, cells: gridDisk(cell, 1), stateId: null as string | null };
  });
  const rows = (await sql
    .query("select id::text as id, s_id::text as s_id from h3_hexagons where id = any($1::text[]::h3index[])", [areas.map((a) => a.cell)])
    .catch(() => [])) as any[];
  const byCell = new Map(rows.map((r) => [String(r.id), r.s_id ? String(r.s_id) : null]));
  await Promise.all(
    areas.map(async (a) => {
      a.stateId = byCell.get(a.cell) ?? null;
      if (a.stateId) return;
      // Cell not in the table yet (or not matched to a state): find the state that contains the point.
      const found = (await sql
        .query(
          "select id::text as id from regions where region_type = 'state' and favorite = true and geometry is not null and ST_Contains(geometry, ST_SetSRID(ST_MakePoint($1, $2), 4326)) limit 1",
          [a.lng, a.lat],
        )
        .catch(() => [])) as any[];
      a.stateId = found[0]?.id ?? null;
    }),
  );
  return areas;
}

/**
 * Area search: cells of one region that satisfy the query's attribute filters, as point features
 * (the cell centre) carrying the matched values. Strongest match first inside a city or county.
 */
export async function searchAreas(region: { id: string | number; region_type?: string; layer?: string } | null, filters: AttributeFilter[], limit = 60, cells?: string[]) {
  const column = region ? REGION_COLUMN[String(region.region_type ?? region.layer)] : null;
  // Inside picked areas (or around geocoded addresses) the cells themselves bound the search; otherwise the region does.
  const inCells = Boolean(cells?.length);
  if ((!inCells && (!column || !region?.id)) || !filters.length) return [];
  const columns = await hexColumns();
  const where = inCells ? [`t.id = any($1::text[]::h3index[])`, `t.resolution = ${AREA_RESOLUTION}`] : [`t.${column} = $1::bigint`, `t.resolution = ${AREA_RESOLUTION}`];
  const values: unknown[] = [inCells ? cells : String(region!.id)];
  const applied = appendSqlFilters(filters, columns, where, values);
  if (!applied.length) return [];
  const extra = CONTEXT_KEYS.filter((key) => columns.has(key) && !applied.includes(key));
  // The country, state, county and city of each cell, so it can be named by them rather than its coordinates.
  const regionCols = REGION_ID_COLUMNS.filter((c) => columns.has(c));
  // Rank by the first numeric condition ("high income" → richest first). Whole states and countries
  // skip the sort so the scan can stop as soon as it has enough cells.
  const ranked = filters.find((f) => applied.includes(f.key) && ["gt", "gte", "lt", "lte", "between"].includes(f.op));
  const small = inCells || column === "r_id" || column === "p_id";
  const order = ranked && small ? `order by t.${ranked.key} ${ranked.op === "lt" || ranked.op === "lte" ? "asc" : "desc"} nulls last` : "";
  values.push(limit);
  const rows = (await sql
    .withTimeout(15000, (tx) =>
      tx.query(
        `select t.id::text as id, t.lat, t.lng${regionCols.map((c) => `, t.${c}::text as ${c}`).join("")}${[...applied, ...extra].map((key) => `, t.${key}`).join("")}
         from h3_hexagons t where ${where.join(" and ")} ${order} limit $${values.length}`,
        values,
      ),
    )
    .catch((error: unknown) => {
      console.error(JSON.stringify({ event: "area_search_error", error: String((error as Error)?.message ?? error).slice(0, 200) }));
      return [];
    })) as any[];
  const names = await regionNames(rows.flatMap((row) => regionCols.map((c) => row[c]).filter(Boolean)));
  return rows.flatMap((row) => {
    const lng = Number(row.lng);
    const lat = Number(row.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return [];
    const ids = Object.fromEntries(REGION_ID_COLUMNS.map((c) => [c, row[c] ? String(row[c]) : null])) as Record<(typeof REGION_ID_COLUMNS)[number], string | null>;
    return [
      {
        type: "Feature",
        id: `h3:${row.id}`,
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: {
          kind: "area",
          h3: String(row.id),
          feature_name: "Areas",
          ...ids,
          region_address: regionAddress(ids, names),
          ...Object.fromEntries([...applied, ...extra].map((key) => [key, row[key] ?? null])),
        },
      },
    ];
  });
}

/** The region id columns h3_hexagons carries: country, state, county, city. */
export const REGION_ID_COLUMNS = ["c_id", "s_id", "p_id", "r_id"] as const;

/** Region names by id, in one query. */
async function regionNames(ids: string[]) {
  const unique = Array.from(new Set(ids.map(String).filter((id) => /^\d+$/.test(id))));
  if (!unique.length) return new Map<string, string>();
  const rows = (await sql.query("select id::text as id, name from regions where id = any($1::bigint[])", [unique]).catch(() => [])) as any[];
  return new Map(rows.map((r) => [String(r.id), String(r.name)]));
}

/** "Austin, Texas, United States": the city (else the county), then the state, then the country. */
export function regionAddress(ids: Partial<Record<(typeof REGION_ID_COLUMNS)[number], string | null>>, names: Map<string, string>) {
  const name = (id?: string | null) => (id ? names.get(String(id)) ?? null : null);
  const parts = [name(ids.r_id) ?? name(ids.p_id), name(ids.s_id), name(ids.c_id)].filter((v): v is string => Boolean(v));
  return parts.filter((v, i) => parts.indexOf(v) === i).join(", ") || null;
}

/**
 * The cells at given points (geocoded addresses), as area features carrying every context attribute,
 * the attributes the query asks about, their region ids and a built address. `matches` says whether the
 * cell satisfies the query's attribute filters ("is 12 Main St elevated?"), null when none apply.
 */
export async function areasAtPoints(areas: { index: number; lng: number; lat: number; cell: string; label?: string }[], filters: AttributeFilter[]) {
  if (!areas.length) return [];
  const columns = await hexColumns();
  const regionCols = REGION_ID_COLUMNS.filter((c) => columns.has(c));
  const values: unknown[] = [areas.map((a) => a.cell)];
  const conditions: string[] = [];
  const applied = appendSqlFilters(filters, columns, conditions, values);
  const keys = Array.from(new Set([...applied, ...CONTEXT_KEYS.filter((key) => columns.has(key))]));
  const rows = (await sql
    .query(
      `select t.id::text as id${regionCols.map((c) => `, t.${c}::text as ${c}`).join("")}${keys.map((k) => `, t.${k}`).join("")}
         ${conditions.length ? `, (${conditions.join(" and ")}) as matches` : ""}
       from h3_hexagons t where t.id = any($1::text[]::h3index[])`,
      values,
    )
    .catch((error: unknown) => {
      console.error(JSON.stringify({ event: "address_area_error", error: String((error as Error)?.message ?? error).slice(0, 200) }));
      return [];
    })) as any[];
  const byCell = new Map(rows.map((r) => [String(r.id), r]));
  const names = await regionNames(rows.flatMap((row) => regionCols.map((c) => row[c]).filter(Boolean)));
  return areas.map((a) => {
    const row = byCell.get(a.cell) ?? {};
    const ids = Object.fromEntries(REGION_ID_COLUMNS.map((c) => [c, row[c] ? String(row[c]) : null])) as Record<(typeof REGION_ID_COLUMNS)[number], string | null>;
    return {
      type: "Feature",
      id: `addr:${a.index}:${a.cell}`,
      geometry: { type: "Point", coordinates: [a.lng, a.lat] },
      properties: {
        kind: "area",
        h3: a.cell,
        feature_name: "Address",
        area_index: a.index,
        address_label: a.label ?? null,
        known: byCell.has(a.cell),
        matches: conditions.length && byCell.has(a.cell) ? Boolean(row.matches) : null,
        ...ids,
        region_address: regionAddress(ids, names),
        ...Object.fromEntries(keys.map((k) => [k, row[k] ?? null])),
      },
    };
  });
}
