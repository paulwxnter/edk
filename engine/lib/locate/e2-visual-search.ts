type TurboRow = { id?: string | number; $dist?: number; dist?: number; distance?: number; attributes?: Record<string, unknown>; [key: string]: unknown };
const BASE_URL = (process.env.TURBOPUFFER_BASE_URL || "https://api.turbopuffer.com").replace(/\/+$/, "");

// Query vectors come only from an artifact's stored embeddings (artifacts_ebmed). There is no
// on-the-fly text embedding: a feature without stored vectors has no image results.
async function queryNamespace(namespace: string, vector: number[], limit: number, year?: number | null, h3R5?: string[], extraFilters: unknown[] = [], h3R8?: string[]) {
  const key = process.env.TURBOPUFFER_KEY || process.env.TURBOPUFFER_API_KEY; if (!key) throw new Error("No Turbopuffer API key configured.");
  const body: Record<string, unknown> = { rank_by: ["vector", "ANN", vector], limit, exclude_attributes: ["vector", "embed", "description"] };
  const filters: unknown[] = [];
  if (year) filters.push(["year", "Eq", String(year)]);
  if (h3R5?.length) filters.push(["h3_r5", "In", h3R5]);
  // Areas picked on the map: only images inside those resolution-8 cells.
  if (h3R8?.length) filters.push(["h3_r8", "In", h3R8]);
  // Place-attribute filters from the Find attribute gate (validated against the catalog).
  filters.push(...extraFilters);
  if (filters.length === 1) body.filters = filters[0];
  if (filters.length > 1) body.filters = ["And", filters];
  const response = await fetch(`${BASE_URL}/v2/namespaces/${encodeURIComponent(namespace)}/query`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  if (response.status === 404) { const error = new Error("Turbopuffer namespace not found."); error.name = "NamespaceNotFound"; throw error; }
  if (!response.ok) throw new Error(`Turbopuffer query failed (${response.status}).`);
  const value = (await response.json() as any); return (value.rows || value.results || []) as TurboRow[];
}
function number(value: unknown) { const result = Number(value); return Number.isFinite(result) ? result : null; }
function geojson(rows: TurboRow[], maxDistance = 0.59) {
  const seenCaptures = new Set<string>();
  return {
    type: "FeatureCollection",
    features: rows.flatMap((row) => {
      const attr = (row.attributes || row) as Record<string, unknown>;
      const latitude = number(attr.lat ?? attr.latitude);
      const longitude = number(attr.lng ?? attr.lon ?? attr.longitude);
      const distance = number(row.$dist ?? row.dist ?? row.distance);
      const visualUrl = String(attr.visual_url ?? "");
      const date = attr.date ?? attr.captured_at ?? null;
      if (latitude === null || longitude === null || (distance !== null && distance > maxDistance) || /wasabi/i.test(visualUrl)) return [];
      // Turbopuffer preserves rank order. Retain the first candidate for an exact
      // location-and-capture duplicate, which is the best semantic match.
      if (date !== null && date !== "") {
        const captureKey = `${latitude}|${longitude}|${String(date)}`;
        if (seenCaptures.has(captureKey)) return [];
        seenCaptures.add(captureKey);
      }
      return [{ type: "Feature", id: String(row.id ?? attr.id ?? attr.v_id ?? ""), geometry: { type: "Point", coordinates: [longitude, latitude] }, properties: { ...attr, distance, source_id: String(row.id ?? attr.id ?? attr.v_id ?? ""), engine: "turbopuffer" } }];
    }),
  };
}
export async function searchVisualGeojson({ query, regionId, year, limit, vector: suppliedVector, h3R5, h3R8, candidates, maxDistance, attributeFilters }: { query: string; h3R8?: string[]; regionId?: string | null; year?: string | number | null; limit: number; vector?: number[]; h3R5?: string[]; candidates?: number; maxDistance?: number; attributeFilters?: unknown[] }) {
  const parsedYear = year === null || year === undefined || year === "" || year === "all" ? null : Number(year);
  const filterYear = parsedYear !== null && Number.isInteger(parsedYear) && parsedYear > 1900 && parsedYear < 2200 ? parsedYear : null;
  if (!suppliedVector?.length) return { type: "FeatureCollection", features: [] as ReturnType<typeof geojson>["features"] };
  const vector = suppliedVector; let rows: TurboRow[];
  const fetchRows = (namespace: string, activeYear: number | null) => queryNamespace(namespace, vector, Math.min(1200, Math.max(limit + 50, candidates ?? 250)), activeYear, h3R5, attributeFilters, h3R8);
  // Position searches run on the global namespace and narrow by h3_r5 cell,
  // so a point outside the routed region still finds what is there.
  try { rows = await fetchRows(h3R5?.length ? "global" : regionId || "global", filterYear); }
  catch (error) {
    if ((error as Error).name !== "NamespaceNotFound" || !regionId) throw error;
    rows = await fetchRows("global", filterYear);
  }
  const collection = geojson(rows, maxDistance); return { ...collection, features: collection.features.slice(0, limit) };
}
