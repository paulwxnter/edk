// The EDK query engine (ported from atlasx): one natural-language query becomes located results
// (imagery, civic records, places), areas picked by their attributes, trends over time and a short
// answer. Callers handle auth and billing; this module only searches.
import { runGeoSearch } from "lib/locate/e2-geo-search";
import { QueryTimer, SearchLog } from "lib/locate/e2-logs";
import { publicGeoJson } from "lib/locate/public-results";
import { attributeOptionsFrom, publicFilters } from "lib/locate/attributes";
import { generateAnswer } from "lib/locate/answer";
import { gateTimeframe } from "lib/locate/attributes/gate";
import { nearestNeighborhoods } from "lib/locate/neighborhoods";
import { gateSources } from "lib/locate/source-gate";
import { areasAtPoints, cellAt, resolvePickedAreas, searchAreas, type PickedArea } from "lib/locate/areas";
import { loadTrends } from "lib/locate/trends";
import { asksAboutAmount } from "lib/locate/intent";
import { sql } from "lib/locate/e2-db";
import { getRegionById } from "lib/lens-server";
import { relevantContext } from "lib/locate/context";
import { newTally, withTokenTally } from "lib/locate/tokens";
import { gateAddresses } from "lib/locate/address-gate";

export const MAX_LIMIT = 60;
export const DEFAULT_LIMIT = 20;
const MAX_AREAS = 4;
const MAX_AREA_GROUPS = 4;

export type SearchInput = {
  query: string;
  /** Points to search around, [[lng, lat], …] (up to 4). */
  areas?: [number, number][];
  /** A region id to focus on when the query names no place. */
  focus?: string | null;
  /** Explicit attribute conditions, as accepted by the engine. */
  where?: unknown;
  /** Most results to return (1–60). */
  limit: number;
  /** Include a written answer (default true). */
  answer?: boolean;
};

export type Asker = { userId: string | null; sessionId: string; timeZone?: string };

export class SearchError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Validates a request body into SearchInput, or throws SearchError(400). */
export function parseSearchInput(body: any, maxLimit = MAX_LIMIT): SearchInput {
  const query = typeof body?.query === "string" ? body.query.trim() : typeof body?.q === "string" ? body.q.trim() : "";
  if (!query || query.length > 500) throw new SearchError("Give a query between 1 and 500 characters.", 400);
  const areas = Array.isArray(body?.areas)
    ? body.areas
        .filter((p: unknown): p is [number, number] => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90)
        .slice(0, MAX_AREAS)
        .map((p: [number, number]) => [Number(p[0]), Number(p[1])] as [number, number])
    : [];
  const focus = typeof body?.focus === "string" && /^\d+$/.test(body.focus) ? body.focus : typeof body?.focus === "number" ? String(body.focus) : null;
  const requested = Number(body?.limit);
  const limit = Math.max(1, Math.min(maxLimit, MAX_LIMIT, Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : DEFAULT_LIMIT));
  return { query, areas, focus, where: body?.where, limit, answer: body?.answer !== false };
}

/** Takes one row from each list in turn, so no area or source hides the others. */
function interleave<T>(lists: T[][], limit: number) {
  const out: T[] = [];
  for (let i = 0; out.length < limit; i++) {
    let added = false;
    for (const list of lists) {
      if (list[i] === undefined) continue;
      out.push(list[i]);
      added = true;
      if (out.length >= limit) break;
    }
    if (!added) break;
  }
  return out;
}

async function artifactDetails(ids: string[]) {
  if (!ids.length) return new Map<string, { slug: string | null; icon_url: string | null }>();
  const rows = (await sql.query("select id::text as id, slug, icon_url from artifacts where id = any($1::uuid[])", [ids]).catch(() => [])) as any[];
  return new Map(rows.map((r) => [String(r.id), { slug: r.slug || null, icon_url: typeof r.icon_url === "string" && r.icon_url.startsWith("https://") ? r.icon_url : null }]));
}

export async function runSearch(input: SearchInput, asker: Asker, source = "edk") {
  const tally = newTally();
  return withTokenTally(tally, () => search(input, asker, source, tally));
}

async function search(input: SearchInput, asker: Asker, source: string, tally: ReturnType<typeof newTally>) {
  const { query, limit } = input;
  const points = input.areas ?? [];
  const focusId = input.focus ?? null;
  const timer = new QueryTimer();
  const log = new SearchLog(query, source, timer, asker);
  const contextPending = asker.userId
    ? timer.stage("context_gate", () => relevantContext(query, asker, log.id, asker.timeZone || "UTC")).catch(() => ({ picked: [] as any[], reviewed: 0 }))
    : Promise.resolve({ picked: [] as any[], reviewed: 0 });
  const timeframes = gateTimeframe(query).catch(() => ["annual" as const]);
  const gatePending = timer.stage("source_gate", () => gateSources(query)).catch(() => null);
  const options = attributeOptionsFrom({ where: input.where });
  try {
    const geocoded = !points.length
      ? await timer
          .stage("address_gate", async () => {
            const near = focusId ? (await getRegionById(focusId).catch(() => null))?.center ?? null : null;
            return gateAddresses(query, near);
          })
          .catch(() => ({ asked: false, probability: null, addresses: [] as any[] }))
      : null;
    const addressAreas: PickedArea[] = geocoded?.addresses.length
      ? (await timer.stage("areas_resolve", () => resolvePickedAreas(geocoded.addresses.map((a: any) => [a.lng, a.lat] as [number, number])))).map((area, i) => ({ ...area, label: geocoded.addresses[i].label }))
      : [];
    const picked: PickedArea[] = points.length ? await timer.stage("areas_resolve", () => resolvePickedAreas(points)) : addressAreas;
    const groups = new Map<string, { stateId: string | null; cells: string[] }>();
    for (const area of picked) {
      const key = area.stateId ?? "global";
      const group = groups.get(key) ?? { stateId: area.stateId, cells: [] };
      group.cells.push(...area.cells);
      groups.set(key, group);
    }
    const runs = picked.length
      ? await Promise.all(Array.from(groups.values()).slice(0, MAX_AREA_GROUPS).map((g) => runGeoSearch(query, limit, g.stateId, null, timer, "name", undefined, undefined, options, Array.from(new Set(g.cells)))))
      : [await runGeoSearch(query, limit, null, null, timer, "name", undefined, undefined, options, undefined, focusId)];
    const result = runs[0];
    if (runs.some((r) => r.safety)) {
      await log.finish({ status: "blocked", routingTrace: result.searchPlan.routing, tokens: tally });
      throw new SearchError("This search cannot be answered. Try a place or physical feature.", 403);
    }
    const gate = await gatePending;
    const filters = publicFilters(result.filters);
    const attributeFilters = ("attributeFilters" in result ? result.attributeFilters : []) ?? [];

    const areaOfCell = new Map<string, PickedArea>();
    for (const area of picked) for (const cell of area.cells) if (!areaOfCell.has(cell)) areaOfCell.set(cell, area);
    const perRun = runs.map((r) => {
      const list = publicGeoJson(r.geojson).features;
      if (picked.length) {
        for (const f of list) {
          const [lng, lat] = f.geometry?.coordinates ?? [];
          const area = Number.isFinite(lng) && Number.isFinite(lat) ? areaOfCell.get(cellAt(lng, lat)) : undefined;
          if (area) f.properties.area_index = area.index;
        }
      }
      return list;
    });
    let features: any[] = interleave(perRun, limit);

    const pickedCells = Array.from(new Set(picked.flatMap((a) => a.cells)));
    const featuresWanted = result.artifacts.length > 0 || !gate || gate.features >= 0.5;
    const wantsAreas = attributeFilters.length > 0 && (pickedCells.length > 0 || Boolean(result.region)) && (gate ? gate.areas >= 0.5 || !featuresWanted : result.artifacts.length === 0);
    const areaFeatures = wantsAreas ? await timer.stage("areas_search", () => searchAreas(result.region, attributeFilters, limit, pickedCells.length ? pickedCells : undefined)) : [];
    const fromAddresses = addressAreas.length > 0 && picked === addressAreas;
    const addressFeatures = fromAddresses ? await timer.stage("address_areas", () => areasAtPoints(addressAreas, attributeFilters)) : [];
    const withFeatures = fromAddresses ? (gate ? gate.features >= 0.5 : result.artifacts.length > 0) && result.artifacts.length > 0 : featuresWanted && result.artifacts.length > 0;
    const addressCells = new Set(addressFeatures.map((f: any) => String(f.properties.h3)));
    const areaResults = [...addressFeatures, ...areaFeatures.filter((f: any) => !addressCells.has(String(f.properties.h3)))];
    if (areaResults.length) features = withFeatures ? interleave([areaResults, features], limit) : areaResults.slice(0, limit);

    const labels = await timer.stage("neighborhoods", () => nearestNeighborhoods(features));
    labels.forEach((label: any, i: number) => {
      const p = features[i].properties;
      if (p.kind === "area") {
        const near = (typeof p.address_label === "string" && p.address_label) || label.neighborhood || label.district || label.area || null;
        const place = typeof p.region_address === "string" && p.region_address ? p.region_address : null;
        p.address = near || place || `${features[i].geometry.coordinates[1].toFixed(4)}, ${features[i].geometry.coordinates[0].toFixed(4)}`;
        if (place && place !== p.address) p.district = near && label.district && label.district !== near ? `${label.district} · ${place}` : place;
        else if (label.district && label.district !== p.address) p.district = label.district;
        return;
      }
      for (const key of ["neighborhood", "district", "area"] as const) if (label[key]) p[key] = label[key];
    });

    const details = await artifactDetails(result.artifacts.map((a: any) => a.id));
    const iconByName = new Map<string, string | null>(result.artifacts.map((a: any) => [String(a.name).toLowerCase(), details.get(a.id)?.icon_url ?? null] as [string, string | null]));
    const onlyIcon = result.artifacts.length === 1 ? details.get(result.artifacts[0].id)?.icon_url ?? null : null;
    for (const f of features) {
      const icon = iconByName.get(String(f.properties.feature_name || "").toLowerCase()) ?? (f.properties.kind === "area" ? null : onlyIcon);
      if (icon) f.properties.icon_url = icon;
    }
    const focus = !picked.length && result.region?.id ? await getRegionById(String(result.region.id)).catch(() => null) : null;

    const wantsTrends = !picked.length && (gate ? gate.trends >= 0.5 : asksAboutAmount(query)) && result.artifacts.length > 0 && Boolean(focus);
    const trends = wantsTrends
      ? await timer
          .stage("trends", () =>
            loadTrends(
              result.artifacts.map((a: any) => ({ name: a.name, feature_id: a.feature_id, slug: details.get(a.id)?.slug ?? null, icon_url: details.get(a.id)?.icon_url ?? null })),
              focus && { id: focus.id, name: focus.name, slug: focus.slug },
            ),
          )
          .catch(() => null)
      : null;

    const regions = Array.from(new Map<string, any>(runs.flatMap((r) => r.regions).map((r: any) => [String(r.id), r] as [string, any])).values());
    const context = await contextPending;
    const answer =
      input.answer === false
        ? null
        : await timer
            .stage("answer", async () =>
              generateAnswer({
                query,
                features,
                regions,
                year: result.searchPlan.year,
                filters,
                artifacts: result.artifacts,
                timeframes: await timeframes,
                history: context.picked.map((c: any) => ({ when: c.when, query: c.query, place: c.place, answer: c.answer })),
              }),
            )
            .catch(() => null);

    await log.finish({
      status: "ok",
      resultCount: features.length,
      regionId: result.region?.id ? String(result.region.id) : null,
      regionName: result.region?.name ? String(result.region.name) : null,
      featureNames: result.searchPlan.features.map((f: any) => f.feature_name),
      routingTrace: result.searchPlan.routing,
      tokens: tally,
      answer,
    });

    return {
      query,
      duration_ms: timer.totalMs(),
      geojson: { type: "FeatureCollection" as const, features },
      regions,
      year: result.searchPlan.year,
      ...(answer ? { answer } : {}),
      filters,
      sources: { features: features.some((f) => f.properties.kind !== "area"), areas: areaResults.length > 0, trends: Boolean(trends) },
      ...(trends && (gate ? gate.features < 0.5 : asksAboutAmount(query)) ? { lead: "trends" } : {}),
      ...(focus ? { region: focus } : {}),
      ...("regionFallback" in result && (result as any).regionFallback?.used === "global" ? { region_global: true } : {}),
      ...(trends ? { trends } : {}),
      ...(picked.length ? { areas: picked.map((a) => ({ index: a.index, center: [a.lng, a.lat], cells: a.cells, ...(a.label ? { label: a.label } : {}) })) } : {}),
      ...(geocoded?.addresses.length ? { geocoded: geocoded.addresses } : {}),
    };
  } catch (error) {
    if (error instanceof SearchError) throw error;
    console.error("[search] failed", error instanceof Error ? error.message : "Unknown error");
    await log.finish({ status: "error", error: error instanceof Error ? error.message : "Unknown error", tokens: tally });
    throw new SearchError("Search is temporarily unavailable. Please try again.", 502);
  }
}

export type SearchPayload = Awaited<ReturnType<typeof runSearch>>;

/** Billing counts: every returned place is a location, or an area (an H3 cell that meets the conditions). */
export function countReturned(features: any[]) {
  const areas = features.filter((f) => f?.properties?.kind === "area").length;
  return { locations: features.length - areas, areas, units: features.length };
}
