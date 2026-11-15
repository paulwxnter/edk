import { cellArea, cellToLatLng, getResolution, gridDisk, greatCircleDistance, isValidCell, polygonToCellsExperimental, POLYGON_TO_CELLS_FLAGS } from "h3-js";
import { areasAtPoints, cellAt, hexColumns, type PickedArea } from "./areas";
import { ATTRIBUTE_BY_KEY } from "./attributes/catalog";
import { formatAttribute } from "./attributes/display";
import { appendSqlFilters, type AttributeFilter } from "./attributes";
import { sql } from "./e2-db";
import { tableColumns } from "./civic-tables";
import type { SpatialPlan } from "./spatial-plan";

type Point = [number, number];
type Feature = { type: string; id?: string; geometry: { type: string; coordinates: any }; properties: Record<string, any> };
type Region = { id: string; name: string; region_type: string };
export type SpatialSource = { id: string; name: string; feature_id: string | null; method: string; source_table: string | null; terms: string[] };
const REGION_COLUMNS: Record<string, string> = { city: "r_id", state: "s_id", county: "p_id", country: "c_id" };
const MAX_CELLS = 2000;
const MAX_TARGETS = 1200;
const MAX_REFERENCES = 100;

type Scope = { region: Region | null; cells?: string[]; year: string | number | null; filters: AttributeFilter[] };

/** A single scoped query path for mapped record retrieval and aggregation. */
export async function mappedRecords(artifact: SpatialSource, scope: Scope, mode: "rows" | "counts", limit = 100): Promise<any[] | null> {
  const table = artifact.source_table;
  if (!table || !/^[a-z][a-z0-9_]*$/.test(table)) return null;
  const columns = await tableColumns(table);
  const regionColumn = scope.region && REGION_COLUMNS[scope.region.region_type];
  if (!columns.has("geometry") || !columns.has("id") ||
      (scope.region && (!regionColumn || !columns.has(regionColumn))) ||
      ((scope.cells?.length || mode === "counts") && !columns.has("h3_r8"))) return null;
  // Empty geometries are dropped after the page is read (they have no point): testing each row here reads
  // every stored geometry in the region before the limit applies.
  const where = ["t.geometry is not null"];
  const values: unknown[] = [];
  const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
  if (scope.region) where.push(`t.${regionColumn} = ${bind(scope.region.id)}::bigint`);
  if (scope.cells?.length) where.push(`t.h3_r8 = any(${bind(scope.cells)}::text[]::h3index[])`);
  if (artifact.feature_id && /^\d+$/.test(artifact.feature_id) && columns.has("feature_id")) {
    where.push(`t.feature_id = ${bind(artifact.feature_id)}::bigint`);
  } else if (artifact.method === "osm") {
    if (artifact.terms.length && !columns.has("search_vector")) return null;
    if (artifact.terms.length) where.push(`exists (select 1 from unnest(${bind(artifact.terms.slice(0, 8))}::text[]) as term where t.search_vector @@ plainto_tsquery('english', term))`);
  }
  if (scope.year != null && scope.year !== "all") {
    if (columns.has("year")) where.push(`t.year = ${bind(Number(scope.year))}::int`);
    else if (columns.has("date")) where.push(`substring(t.date::text, 1, 4) = ${bind(String(scope.year))}::text`);
    else return null;
  }
  if (appendSqlFilters(scope.filters, columns, where, values).length < new Set(scope.filters.map((filter) => filter.key)).size) return null;
  if (mode === "counts") {
    where.push("t.h3_r8 is not null");
    return sql.withTimeout(8000, (tx) => tx.query(
      `select t.h3_r8::text as cell, count(distinct t.id)::int as count from public.${table} t where ${where.join(" and ")} group by t.h3_r8`, values,
    ));
  }
  const storedCell = columns.has("h3_r8") ? "t.h3_r8::text" : "null::text";
  const selected = [...new Set(scope.filters.map((f) => f.key))].map((key) => `, t.${key}`).join("");
  // Named columns only: to_jsonb(t) would carry every column of every row in the region through the sort.
  const optional = ["address", "date", "description"].map((key) => columns.has(key) ? `t.${key}::text as ${key}` : `null::text as ${key}`).join(", ");
  const rowLimit = bind(limit);
  const dateOrder = columns.has("date") ? "t.date desc nulls last, " : "";
  const rows = await sql.withTimeout(8000, (tx) => tx.query(
    `select t.id::text as id, ${storedCell} as cell, st_asgeojson(t.geometry)::json as geometry,
       st_asgeojson(st_pointonsurface(t.geometry))::json as point,
       ${optional}${selected}
     from public.${table} t where ${where.join(" and ")} order by ${dateOrder}t.id limit ${rowLimit}`, values,
  ));
  return rows.map(({ id, geometry, point, cell, ...properties }) => ({
    type: "Feature", id, geometry, properties: { ...properties, feature_name: artifact.name, artifact_id: artifact.id, spatialPoint: point?.coordinates, h3_r8: cell },
  }));
}

function pointOf(feature: Feature): Point | null {
  const point = feature.properties.spatialPoint ?? (feature.geometry?.type === "Point" ? feature.geometry.coordinates : null);
  return Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90 ? [point[0], point[1]] : null;
}

export function distance(a: Point, b: Point) {
  return greatCircleDistance([a[1], a[0]], [b[1], b[0]], "m");
}

export function cellsAround(point: Point, radius?: number, stored?: string): string[] {
  const cell = stored && isValidCell(stored) && getResolution(stored) === 8 ? stored : cellAt(...point);
  if (!radius) return gridDisk(cell, 1);
  // A circumscribed geodesic polygon includes the full disk. The distance check removes the excess.
  const radians = Math.PI / 180;
  const angle = (radius / Math.cos(Math.PI / 64) + 1) / 6371007.18;
  const lat = point[1] * radians;
  const lng = point[0] * radians;
  const ring = Array.from({ length: 64 }, (_, index) => {
    const bearing = index * 2 * Math.PI / 64;
    const y = Math.asin(Math.sin(lat) * Math.cos(angle) + Math.cos(lat) * Math.sin(angle) * Math.cos(bearing));
    const x = lng + Math.atan2(Math.sin(bearing) * Math.sin(angle) * Math.cos(lat), Math.cos(angle) - Math.sin(lat) * Math.sin(y));
    return [((x / radians + 540) % 360) - 180, y / radians];
  });
  return polygonToCellsExperimental(ring, 8, POLYGON_TO_CELLS_FLAGS.containmentOverlapping, true);
}

export function rankProximity(rows: Feature[], references: Point[], radius = Infinity) {
  const unique = new Map<string, { feature: Feature; meters: number; key: string }>();
  for (const feature of rows) {
    const point = pointOf(feature);
    if (!point) continue;
    const meters = Math.min(...references.map((reference) => distance(reference, point)));
    const key = String(feature.id || feature.properties.source_id || point.join(","));
    if (meters <= radius && (!unique.has(key) || meters < unique.get(key)!.meters)) unique.set(key, { feature, meters, key });
  }
  return [...unique.values()].sort((a, b) => a.meters - b.meters || a.key.localeCompare(b.key));
}

type SpatialContext = {
  limit: number;
  region: Region | null;
  year: Scope["year"];
  areas: PickedArea[];
  addresses: PickedArea[];
  targetFilters: AttributeFilter[];
  referenceFilters: AttributeFilter[];
  retrieve: (id: string, scope: Scope, limit: number) => Promise<Feature[] | null>;
  aggregate: (id: string, scope: Scope) => Promise<{ cell: string; count: number }[] | null>;
  artifactName: (id: string) => string;
  regionCenter: (id: string) => Promise<Point | null>;
  recordTiming?: (stage: string, ms: number) => void;
};

const idOf = (choice: string) => choice.slice(choice.indexOf(":") + 1);
const cellPoint = (cell: string): Point => { const [lat, lng] = cellToLatLng(cell); return [lng, lat]; };
const squareKm = (cell: string) => cellArea(cell, "km2");
const fact = (key: string, title: string, value: string, detail?: string) => ({ key, title, value, ...(detail ? { detail } : {}) });
const number = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });
const coverage = (known: number, total: number) => fact("coverage", "Coverage", `${known} of ${total} cells`);
const areaFeature = (id: string, name: string, point: Point, facts: ReturnType<typeof fact>[], h3?: string, insight?: string): Feature => ({
  type: "Feature", id, geometry: { type: "Point", coordinates: point },
  properties: { kind: "area", name, feature_name: name, h3, spatialFacts: facts, spatialInsight: insight },
});

export async function executeSpatial(plan: SpatialPlan, ctx: SpatialContext): Promise<Feature[] | null> {
  const timed = async <T>(stage: string, work: () => Promise<T>): Promise<T> => {
    const started = performance.now();
    try {
      return await work();
    } finally {
      ctx.recordTiming?.(stage, Math.round(performance.now() - started));
    }
  };
  const localCells = [...new Set(ctx.areas.flatMap((area) => area.cells))];
  const scoped = Boolean(ctx.region || localCells.length);
  const scope: Scope = { region: ctx.region, cells: localCells.length ? localCells : undefined, year: ctx.year, filters: ctx.targetFilters };
  const pick = (choice: string) => (choice.startsWith("address:") ? ctx.addresses : ctx.areas)[Number(idOf(choice)) - 1];
  const candidates = async (artifact: string, cells: string[]) => {
    const sorted = [...new Set(cells)].sort();
    if (!sorted.length) return [];
    if (sorted.length > MAX_CELLS) return null;
    // One request for every cell: parallel pages of the same search compete with each other and take longer together.
    return timed("spatial_target_retrieval", () => ctx.retrieve(artifact, { ...scope, cells: sorted }, MAX_TARGETS));
  };

  if (plan.operation === "nearest" || plan.operation === "within") {
    let refs: { point: Point; cell?: string }[] = [];
    if (plan.reference.startsWith("artifact:")) {
      if (!scoped) return null;
      const rows = await timed("spatial_reference_retrieval", () => ctx.retrieve(idOf(plan.reference), { ...scope, filters: ctx.referenceFilters }, MAX_REFERENCES));
      if (rows === null) return null;
      refs = rows.flatMap((feature) => { const point = pointOf(feature); return point ? [{ point, cell: feature.properties.h3_r8 }] : []; });
    } else if (plan.reference.startsWith("center:")) {
      const point = await ctx.regionCenter(idOf(plan.reference));
      if (!point) return null;
      refs = [{ point }];
    } else {
      const picked = plan.reference === "areas" ? ctx.areas : [pick(plan.reference)].filter(Boolean);
      if (!picked.length) return null;
      refs = picked.map(({ lng, lat, cell }) => ({ point: [lng, lat], cell }));
    }
    const cells = new Set<string>();
    await timed("spatial_scope_preparation", async () => {
      for (const ref of refs) {
        for (const cell of cellsAround(ref.point, plan.operation === "within" ? plan.radius : undefined, ref.cell)) cells.add(cell);
        if (cells.size > MAX_CELLS) break;
      }
    });
    if (cells.size > MAX_CELLS) return null;
    const rows = await candidates(idOf(plan.target), [...cells]);
    if (rows === null) return null;
    const ranked = await timed("spatial_ranking", async () => rankProximity(rows, refs.map(({ point }) => point), plan.operation === "within" ? plan.radius : undefined));
    return ranked
      .slice(0, ctx.limit).map(({ feature, meters }) => ({ ...feature, properties: {
        ...feature.properties, spatialDistance: Math.round(meters * 100) / 100,
        ...(plan.operation === "within" ? { spatialInsight: `Measured ${number(meters)} m against the requested ${number(plan.radius!)} m radius.` } : {}),
      } }));
  }
  if (plan.operation === "density") {
    if (!scoped) return null;
    const artifact = idOf(plan.target);
    const rows = await timed("spatial_aggregation", () => ctx.aggregate(artifact, scope));
    if (rows === null) return null;
    return rows.filter(({ cell }) => isValidCell(cell) && getResolution(cell) === 8)
      .map(({ cell, count }) => ({ cell, count, density: count / squareKm(cell) }))
      .sort((a, b) => b.density - a.density || a.cell.localeCompare(b.cell)).slice(0, ctx.limit)
      .map(({ cell, count, density }) => areaFeature(cell, ctx.artifactName(artifact), cellPoint(cell), [
        fact("mapped_records", "Mapped records", number(count)), fact("records_per_km2", "Mapped records per km²", number(density)),
      ], cell, `${number(count)} mapped records ÷ ${squareKm(cell).toFixed(4)} km² = ${number(density)} records per km².`));
  }
  if (plan.operation !== "compare") return null;
  const artifactSubjects = plan.subjects[0].startsWith("artifact:");
  if (artifactSubjects && !scoped) return null;
  if (!artifactSubjects && plan.metric === "distance" && ctx.targetFilters.length) return null;
  const center = ctx.region ? await ctx.regionCenter(ctx.region.id) : null;
  const comparisonArea = artifactSubjects && plan.metric === "density"
    ? localCells.length
      ? localCells.reduce((sum, cell) => sum + squareKm(cell), 0)
      : Number((await sql.withTimeout(6000, (tx) => tx.query(
        "select st_area(geometry::geography) / 1000000 as km2 from regions where id = $1::bigint", [ctx.region!.id],
      )))[0]?.km2)
    : 0;
  const comparePoints = artifactSubjects ? [] : plan.subjects.map(pick);
  if (comparePoints.some((area) => !area)) return null;
  const addresses = plan.subjects[0].startsWith("address:");
  const comparisonCells = (area: PickedArea) => addresses ? [area.cell] : area.cells;
  const attribute = Object.hasOwn(ATTRIBUTE_BY_KEY, plan.metric) ? ATTRIBUTE_BY_KEY[plan.metric] : undefined;
  const cellReadings = new Map<string, number>();
  if (attribute) {
    const columns = await hexColumns();
    if (columns.has(attribute.key)) {
      const cells = [...new Set(comparePoints.flatMap(comparisonCells))];
      const values: unknown[] = [cells];
      const where = ["t.id = any($1::text[]::h3index[])"];
      if (appendSqlFilters(ctx.targetFilters, columns, where, values).length < new Set(ctx.targetFilters.map((filter) => filter.key)).size) return null;
      const rows = await sql.withTimeout(6000, (tx) => tx.query(
        `select t.id::text as id, t.${attribute.key} as value from h3_hexagons t where ${where.join(" and ")}`, values,
      ));
      for (const row of rows) if (row.value != null && Number.isFinite(Number(row.value))) cellReadings.set(String(row.id), Number(row.value));
    }
  }
  const pointFeatures = comparePoints.length ? await areasAtPoints(comparePoints, []) : [];
  const compared = await Promise.all(plan.subjects.map(async (subject, i) => {
    let measurement: number | null = null;
    let detail: ReturnType<typeof fact> | undefined;
    let feature: Feature;
    let featureInsight: string | undefined;
    let label: string;
    let formatted: string | null = null;
    if (artifactSubjects) {
      const id = idOf(subject);
      const rows = await timed("spatial_aggregation", () => ctx.aggregate(id, scope));
      if (rows) {
        const records = rows.reduce((sum, row) => sum + row.count, 0);
        measurement = plan.metric === "count" ? records : comparisonArea > 0 ? records / comparisonArea : null;
        if (plan.metric === "density" && measurement !== null) {
          featureInsight = `${number(records)} mapped records ÷ ${comparisonArea.toFixed(4)} km² = ${number(measurement)} records per km².`;
        }
      }
      label = plan.metric === "count" ? "Mapped records" : "Mapped records per km²";
      const point = center ?? (ctx.areas[0] ? [ctx.areas[0].lng, ctx.areas[0].lat] as Point : null);
      if (!point) return null;
      feature = areaFeature(subject, ctx.artifactName(id), point, [], undefined, featureInsight);
    } else {
      const area = comparePoints[i];
      const point: Point = [area.lng, area.lat];
      feature = pointFeatures[i];
      feature.properties.name = area.label || `Area ${area.index}`;
      feature.properties.feature_name = addresses ? "Address" : "Area";
      feature.properties.spatialCells = comparisonCells(area);
      if (plan.metric === "distance" && plan.reference) {
        const id = idOf(plan.reference);
        const rows = await timed("spatial_reference_retrieval", () => ctx.retrieve(id, { ...scope, cells: gridDisk(area.cell, 1), filters: ctx.referenceFilters }, MAX_REFERENCES));
        measurement = rows ? rankProximity(rows, [point])[0]?.meters ?? null : null;
        label = `Distance to ${ctx.artifactName(id)}`;
        if (measurement !== null) {
          formatted = `${number(measurement)} m`;
          feature.properties.spatialDistance = Math.round(measurement * 100) / 100;
        }
      } else if (attribute) {
        const cells = comparisonCells(area);
        const readings = cells.flatMap((cell) => cellReadings.has(cell) ? [cellReadings.get(cell)!] : []);
        measurement = readings.length ? readings.reduce((sum, value) => sum + value, 0) / readings.length : null;
        label = attribute.label;
        detail = coverage(readings.length, cells.length);
        formatted = formatAttribute(attribute.key, measurement);
        if (readings.length > 1 && formatted) feature.properties.spatialInsight = `Mean of ${readings.length} available cell readings: ${formatted}.`;
      } else return null;
    }
    feature.properties.spatialFacts = [fact(plan.metric, label, formatted ?? (measurement === null ? "Unavailable" : number(measurement))), ...(detail ? [detail] : [])];
    return { feature, measurement, i };
  }));
  if (compared.some((item) => item === null)) return null;
  const results = compared.filter((item) => item !== null);
  if (artifactSubjects && results.every((item) => item.measurement === null)) return null;
  if (plan.order !== "input") results.sort((a, b) => {
    if (a.measurement === null) return b.measurement === null ? a.i - b.i : 1;
    if (b.measurement === null) return -1;
    return (plan.order === "asc" ? a.measurement - b.measurement : b.measurement - a.measurement) || a.i - b.i;
  });
  return results.slice(0, ctx.limit).map(({ feature }) => feature);
}
