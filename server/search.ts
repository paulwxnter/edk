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
import { sql } from "lib/locate/e2-db";
import { getRegionById } from "lib/lens-server";
import { relevantContext } from "lib/locate/context";
import { newTally, withTokenTally } from "lib/locate/tokens";
import { gateAddresses } from "lib/locate/address-gate";
import { boxedImageUrl, sight } from "lib/locate/vision";
import { DEFAULT_REASONING, reasoningById, type ReasoningId } from "../app/lib/tiers";

/** The engine handles up to 200 results; tiers decide how many an account may ask for. */
export const MAX_LIMIT = 200;
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
  /** Most results to return (1–200, capped by tier). */
  limit: number;
  spatialLimit?: number;
  /** Include a written answer (off unless asked for). */
  answer?: boolean;
  /** Include sanitized stage timing diagnostics in the Discover response. */
  development?: boolean;
  /** How closely results are studied before they are returned. */
  reasoning?: ReasoningId;
  /**
   * Strict verification (Tier 2 and up): the first `verify` pictured results must have the feature boxed
   * on their picture. A result whose picture shows no box is dropped and the next one is checked instead.
   * Set by the billing layer from the account's tier, never from the request body.
   */
  verify?: number;
};

export type DevelopmentTiming = {
  total_ms: number;
  stages: Array<{ name: string; ms: number }>;
};

/** Keep development diagnostics useful without exposing internal routing choices or artifact labels. */
function developmentTimings(stages: Array<{ stage: string; ms: number }>): DevelopmentTiming["stages"] {
  return stages.map(({ stage, ms }) => ({
    name:
      stage === "address_gate" ? "address_resolution" :
      stage === "source_gate" ? "source_selection" :
      stage.startsWith("attribute_gate") ? "constraint_parsing" :
      stage === "catalog_regions" || stage === "catalog_artifacts" || stage === "catalog_embeddings" ? "catalog_search" :
      stage === "routing_llm" ? "query_interpretation" :
      stage === "context_gate" ? "context_lookup" :
      stage === "spatial_execution" ? "cross_reference" :
      stage === "spatial_filter_assignment" ? "filter_assignment" :
      stage === "spatial_reference_retrieval" ? "reference_retrieval" :
      stage === "spatial_target_retrieval" ? "target_retrieval" :
      stage === "spatial_scope_preparation" ? "scope_preparation" :
      stage === "spatial_ranking" ? "result_ranking" :
      stage === "spatial_aggregation" ? "data_aggregation" :
      stage.startsWith("retrieval:") ? "data_retrieval" :
      stage === "neighborhoods" ? "result_enrichment" :
      stage === "areas_resolve" ? "area_resolution" :
      stage === "areas_search" ? "area_search" :
      stage === "address_areas" ? "address_area_lookup" :
      stage === "reasoning" ? "reasoning" :
      stage === "answer" ? "answer_generation" : "other",
    ms,
  }));
}

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
  const reasoning = body?.reasoning === undefined || body?.reasoning === null || body?.reasoning === "" ? DEFAULT_REASONING : reasoningById(String(body.reasoning).toLowerCase())?.id;
  if (!reasoning) throw new SearchError("reasoning is one of fast, low, medium or max.", 400);
  return {
    query, areas, focus, where: body?.where, limit, reasoning,
    answer: body?.answer === true || body?.answer === "true",
    development: body?.development === true || body?.development === "true",
  };
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

const SIGHT_THRESHOLD = 0.5;
const SIGHT_PARALLEL = 16;
const SIGHT_ROUNDS = 3;

/**
 * Reasoning: looks at the picture behind each leading result and keeps only the ones that show what was
 * asked for, marking where it is. A result that fails is dropped and the next one is studied in its
 * place, so the first `depth` pictured results all hold. Results without a picture pass through.
 *
 * With `verify` (Tier 2 and up) the check is stricter for the first `verify` results that hold: each must
 * come back with a bounding box, so a picture where the feature cannot be placed is dropped too.
 */
async function study(features: any[], depth: number, verify = 0) {
  const pictured = features.filter((f) => f?.properties?.kind !== "area" && typeof f?.properties?.image_url === "string" && f.properties.feature_name);
  const rejected = new Set<any>();
  let next = 0;
  let need = Math.min(Math.max(depth, verify), pictured.length);
  // How many results have passed with a box, and how many strict checks could not read their picture.
  let boxed = 0;
  let strictChecks = 0;
  let unreadable = 0;
  let inFlight = 0;
  const rounds = verify > 0 ? SIGHT_ROUNDS + 2 : SIGHT_ROUNDS;
  for (let round = 0; need > 0 && next < pictured.length && round < rounds; round++) {
    const batch = pictured.slice(next, next + need);
    next += batch.length;
    need = 0;
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(SIGHT_PARALLEL, batch.length) }, async () => {
      while (cursor < batch.length) {
        const feature = batch[cursor++];
        const p = feature.properties;
        // Strict only while fewer than `verify` results have passed or are being checked strictly right now.
        const strict = boxed + inFlight < verify;
        if (strict) {
          strictChecks += 1;
          inFlight += 1;
        }
        const seen = await sight(p.image_url, String(p.feature_name));
        if (strict) inFlight -= 1;
        if (!seen) {
          // Outside strict verification an image that cannot be read stays as it was.
          if (strict) {
            unreadable += 1;
            rejected.add(feature);
            need += 1;
          }
          continue;
        }
        if (seen.probability < SIGHT_THRESHOLD || (strict && !seen.box)) {
          rejected.add(feature);
          need += 1;
        } else if (seen.box) {
          boxed += 1;
          p.box = seen.box;
          const boxedUrl = boxedImageUrl(p.image_url, seen.box, String(p.feature_name));
          if (boxedUrl) p.boxed_image_url = boxedUrl;
        }
      }
    }));
  }
  // Vision unavailable: every strict check came back unreadable. Return the results rather than none.
  if (verify > 0 && strictChecks > 0 && unreadable === strictChecks) return features;
  return rejected.size ? features.filter((f) => !rejected.has(f)) : features;
}

export async function runSearch(input: SearchInput, asker: Asker, source = "edk") {
  const tally = newTally();
  return withTokenTally(tally, () => search(input, asker, source, tally));
}

async function search(input: SearchInput, asker: Asker, source: string, tally: ReturnType<typeof newTally>) {
  const { query } = input;
  // Reasoning may drop results, so the engine is asked for spares to take their place.
  const depth = source === "edk:route" ? 0 : reasoningById(input.reasoning ?? DEFAULT_REASONING)!.depth;
  const verify = source === "edk:route" ? 0 : Math.max(0, Math.floor(input.verify ?? 0));
  const studied = Math.max(depth, verify);
  const spare = studied > 0 ? Math.min(30, Math.max(8, studied * 2)) : 0;
  const limit = input.limit + spare;
  const points = input.areas ?? [];
  const focusId = input.focus ?? null;
  const timer = new QueryTimer();
  const log = new SearchLog(query, source, timer, asker);
  timer.updateRoutingDiagnostics({ request: {
    limit: input.limit,
    spatial_limit: input.spatialLimit ?? input.limit,
    reasoning: input.reasoning ?? DEFAULT_REASONING,
    answer_requested: input.answer === true,
    development_requested: input.development === true,
    focus_id: focusId,
    area_count: points.length,
    explicit_where: input.where ?? null,
  } });
  const contextPending = asker.userId
    ? timer.stage("context_gate", () => relevantContext(query, asker, log.id, asker.timeZone || "UTC")).catch(() => ({ picked: [] as any[], reviewed: 0 }))
    : Promise.resolve({ picked: [] as any[], reviewed: 0 });
  const timeframes = gateTimeframe(query).catch(() => ["annual" as const]);
  const gatePending = timer.stage("source_gate", () => gateSources(query)).catch(() => null);
  const options = attributeOptionsFrom({ where: input.where });
  try {
    const spatialEnabled = process.env.DISCOVER_SPATIAL === "1" && source !== "edk:route";
    const geocoded = !points.length || spatialEnabled
      ? await timer
          .stage("address_gate", async () => {
            const near = focusId ? (await getRegionById(focusId).catch(() => null))?.center ?? null : null;
            return gateAddresses(query, near, spatialEnabled);
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
    const spatialContext = spatialEnabled ? { areas: points.length ? picked : [], addresses: addressAreas, limit: (input.spatialLimit ?? input.limit) + spare } : undefined;
    const runGrouped = () => Promise.all(Array.from(groups.values()).slice(0, MAX_AREA_GROUPS).map((g) => runGeoSearch(query, limit, g.stateId, null, timer, "name", undefined, undefined, options, Array.from(new Set(g.cells)))));
    const initial = spatialEnabled || !picked.length
      ? await runGeoSearch(query, limit, null, null, timer, "name", undefined, undefined, options, undefined, focusId, spatialContext)
      : null;
    const spatialApplied = Boolean(initial && "spatialApplied" in initial && initial.spatialApplied);
    const runs = initial && (spatialApplied || initial.safety || !picked.length) ? [initial] : await runGrouped();
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
    const areaFeatures = !spatialApplied && wantsAreas ? await timer.stage("areas_search", () => searchAreas(result.region, attributeFilters, limit, pickedCells.length ? pickedCells : undefined)) : [];
    const fromAddresses = addressAreas.length > 0 && picked === addressAreas;
    const addressFeatures = !spatialApplied && fromAddresses ? await timer.stage("address_areas", () => areasAtPoints(addressAreas, attributeFilters)) : [];
    const withFeatures = fromAddresses ? (gate ? gate.features >= 0.5 : result.artifacts.length > 0) && result.artifacts.length > 0 : featuresWanted && result.artifacts.length > 0;
    const addressCells = new Set(addressFeatures.map((f: any) => String(f.properties.h3)));
    const areaResults = [...addressFeatures, ...areaFeatures.filter((f: any) => !addressCells.has(String(f.properties.h3)))];
    if (areaResults.length) features = withFeatures ? interleave([areaResults, features], limit) : areaResults.slice(0, limit);

    if (studied > 0 && features.length) features = await timer.stage("reasoning", () => study(features, depth, verify)).catch(() => features);
    features = features.slice(0, spatialApplied ? input.spatialLimit ?? input.limit : input.limit);

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
                measuredFacts: spatialApplied ? features.flatMap((feature) => {
                  const p = feature.properties;
                  const facts = Array.isArray(p.spatialFacts) ? p.spatialFacts.map((fact: { title: string; value: string }) => `${fact.title}: ${fact.value}`) : [];
                  if (typeof p.spatialDistance === "number") facts.push(`Distance: ${p.spatialDistance} m`);
                  return facts.length ? [`${p.name ?? p.address ?? p.feature_name}: ${facts.join(", ")}`] : [];
                }) : undefined,
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
      spatialApplied,
      query,
      duration_ms: timer.totalMs(),
      ...(input.development ? { development: { total_ms: timer.totalMs(), stages: developmentTimings(timer.all()) } } : {}),
      geojson: { type: "FeatureCollection" as const, features },
      regions,
      // The catalog features the query matched, by name.
      tags: Array.from(new Set<string>(result.artifacts.map((a: any) => String(a.name)))),
      year: result.searchPlan.year,
      ...(answer ? { answer } : {}),
      filters,
      ...(focus ? { region: focus } : {}),
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
