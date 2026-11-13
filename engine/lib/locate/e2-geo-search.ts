import { searchVisualGeojson } from "./e2-visual-search";
import { sql } from "./e2-db";
import { mediaProxyUrl } from "./media-proxy";
import { QueryTimer, type RoutingAttempt, type RoutingProvider, type RoutingTrace, type StageTiming } from "./e2-logs";
import { routerCatalog } from "./router-catalog";
import { getSearchYearOptions } from "./year-options";
import { CIVIC_METHODS } from "./civic";
import { appendSqlFilters, resolveAttributeFilters, sortByAttribute, startAttributeIntent, toTurbopuffer, type AttributeFilter, type FindAttributeOptions, type FiltersReport } from "./attributes";
import type { GateAttempt } from "./attributes/gate";
import { asksAboutAmount } from "./intent";
import { DECISION_MODEL, jevRequest, openAiDecision } from "./jev";
import { civicIndexes, tableColumns } from "./civic-tables";

export type GeoSearchPlan = { feature_id: string | null; feature_name: string; artifact_id?: string | null; artifact_name?: string | null; region_id: string | null; region_name: string | null; region_ids?: string[]; region_names?: string[]; year?: string | null; engine: "turbopuffer"; search_terms: string[] };
type DirectArtifact = { id: string; name: string; feature_id: string | null; method: string; source_table: string | null; terms: string[] };
const DIRECT_METHODS = new Set(["permits", "accidents", "crimes", "service_requests", "inspections", "osm"]);
const LOOKUP_STOP_WORDS = new Set(["a", "an", "and", "are", "at", "by", "for", "from", "in", "into", "near", "of", "on", "or", "the", "to", "with", "within", "around", "across", "show", "find", "map", "me"]);

const normalizedText = (value: unknown) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const termsFor = (query: string) => Array.from(new Set(query.toLowerCase().match(/[a-z0-9]+/g)?.filter(part => part.length > 1 && !LOOKUP_STOP_WORDS.has(part)) || [])).slice(0, 10);
const yearInQuery = (query: string) => getSearchYearOptions().find((candidate) => new RegExp(`\\b${candidate}\\b`).test(query)) || null;

function toDirectArtifact(row: any): DirectArtifact {
  return { id: String(row.id), name: String(row.name || ""), feature_id: row.feature_id ? String(row.feature_id) : null, method: String(row.method || ""), source_table: row.source_table ? String(row.source_table) : null, terms: Array.isArray(row.terms) ? row.terms.map(String).filter(Boolean) : [] };
}

async function directArtifactById(id: string | null | undefined): Promise<DirectArtifact | null> {
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await sql.query(
    "select id::text as id, name, feature_id::text as feature_id, method, source_table, terms from artifacts where id = $1::uuid and status = 'verified' and method = any($2::text[]) limit 1",
    [id, Array.from(DIRECT_METHODS)],
  ).catch(() => [] as any[]);
  return rows[0] ? toDirectArtifact(rows[0]) : null;
}

// Per-artifact civic tables carry the place attributes and "<region>_date_latest" indexes (lib/locate/civic-tables.ts).

/**
 * Civic search on the artifact's own table: newest records of this feature in the region, with
 * place-attribute filters. When the region has a date-latest index, the predicates match it exactly and
 * the planner is told to walk it newest-first (instead of collecting every row in the region and
 * sorting), so a LIMIT stops after enough matches. Returns null when the table can't be used.
 */
/** Amount / trend questions are answered from the ledger; records are only a sample to show, so they get a
 * small page, a short budget, and no slow fallback to the year tables. */
type CivicMode = { sample?: boolean; cells?: string[] };
/** Keeps only rows inside the picked resolution-8 cells. False when the table has no h3_r8 column. */
function appendCells(cells: string[] | undefined, columns: Set<string> | null, where: string[], values: unknown[]) {
  if (!cells?.length) return true;
  if (!columns?.has("h3_r8")) return false;
  values.push(cells);
  where.push(`t.h3_r8 = any($${values.length}::text[]::h3index[])`);
  return true;
}
const SAMPLE_LIMIT = 20;
const SAMPLE_TIMEOUT_MS = 6000;

async function perArtifactCivicSearch(artifact: DirectArtifact, region: any, year: string | number | null, limit: number, attributeFilters: AttributeFilter[], mode: CivicMode = {}) {
  const table = artifact.source_table;
  if (!table || !/^[a-z][a-z0-9_]*$/.test(table) || !CIVIC_METHODS.has(artifact.method)) return null;
  const columns = await tableColumns(table);
  if (!columns.has("geometry")) return null;
  const regionColumn: Record<string, string> = { city: "r_id", state: "s_id", county: "p_id", country: "c_id" };
  const filterColumn = region ? regionColumn[String(region.region_type)] : null;
  const where: string[] = ["t.geometry is not null"];
  const values: unknown[] = [];
  if (filterColumn && region?.id && columns.has(filterColumn)) {
    values.push(String(region.id));
    where.push(`t.${filterColumn} = $${values.length}::bigint`);
  }
  if (artifact.feature_id && /^\d+$/.test(artifact.feature_id) && columns.has("feature_id")) {
    values.push(artifact.feature_id);
    where.push(`t.feature_id = $${values.length}::bigint`);
  }
  const numericYear = Number(year);
  if (year !== null && year !== undefined && year !== "" && Number.isInteger(numericYear) && columns.has("year")) {
    values.push(numericYear);
    where.push(`t.year = $${values.length}::int`);
  }
  if (!appendCells(mode.cells, columns, where, values)) return null;
  const hasDate = columns.has("date");
  const idx = hasDate ? await civicIndexes(table) : { latest: new Set<string>(), dateIdx: false };
  // Strategy 1: (region, date desc, id desc) partial index — exact region, newest first.
  const indexed = Boolean(filterColumn && columns.has("migration_status") && idx.latest.has(filterColumn));
  // Strategy 2: (date desc, source_row_id) index — walk newest first, keep rows in the region.
  const dateWalk = !indexed && idx.dateIdx && columns.has("source_row_id");
  if (indexed) where.push("t.date is not null", "lower(coalesce(t.migration_status, 'complete')) = 'complete'");
  else if (dateWalk) where.push("t.date is not null");
  const orderBy = indexed ? "t.date desc, t.id desc" : dateWalk ? "t.date desc, t.source_row_id" : hasDate ? "t.date desc nulls last, t.id desc" : "t.id desc";
  const appliedAttributes = appendSqlFilters(attributeFilters, columns, where, values);
  const unappliedAttributes = attributeFilters.map((f) => f.key).filter((key) => !appliedAttributes.includes(key));
  values.push(Math.min(limit, 100));
  const attributeSelect = appliedAttributes.map((key) => `, t.${key}`).join("");
  // A date walk over a small region can scan far, so it gets a shorter budget.
  const rows = await sql.withTimeout(mode.sample ? SAMPLE_TIMEOUT_MS : dateWalk ? 10000 : 20000, async (tx) => {
    // Newest-first index walk; a bitmap scan + sort would read every row in the region.
    // ORDER BY matches the index exactly (nulls are excluded), so the LIMIT stops the walk early.
    if (indexed || dateWalk) await tx.query("set local enable_bitmapscan = off");
    if (indexed || dateWalk) await tx.query("set local enable_sort = off");
    return tx.query(
      `select t.id::text as source_id,
              coalesce(to_jsonb(t)->>'date', to_jsonb(t)->>'issued_at', to_jsonb(t)->>'created_at') as date,
              coalesce(to_jsonb(t)->>'description', to_jsonb(t)->>'project_name', to_jsonb(t)->>'permit_type') as description,
              coalesce(to_jsonb(t)->>'address', to_jsonb(t)->>'location_address') as address,
              st_asgeojson(t.geometry)::json as geometry${attributeSelect}
         from public.${table} t
        where ${where.join(" and ")}
        order by ${orderBy}
        limit $${values.length}`,
      values,
    );
  }).catch((error: unknown) => {
    console.error(JSON.stringify({ event: "civic_search_error", table, error: String((error as Error)?.message ?? error).slice(0, 200) }));
    return null;
  });
  if (!rows) return null;
  return {
    year: Number.isInteger(numericYear) && year !== null && year !== "" ? numericYear : null,
    unappliedAttributes,
    features: (rows as any[]).flatMap((row: any) => row.geometry ? [{ type: "Feature", id: row.source_id, geometry: row.geometry, properties: { date: row.date || null, description: row.description || null, address: row.address || null, feature_name: artifact.name, artifact_id: artifact.id, ...Object.fromEntries(appliedAttributes.map((key) => [key, row[key] ?? null])) } }] : []),
  };
}

async function directArtifactSearch(artifact: DirectArtifact, region: any, year: string | number | null, limit: number, attributeFilters: AttributeFilter[] = [], mode: CivicMode = {}) {
  const sample = mode.sample && CIVIC_METHODS.has(artifact.method);
  if (sample) limit = Math.min(limit, SAMPLE_LIMIT);
  // Civic artifacts: their own table first (it has the place attributes); the year tables are a fallback.
  const perArtifact = await perArtifactCivicSearch(artifact, region, year, limit, attributeFilters, { sample, cells: mode.cells });
  if (perArtifact && (perArtifact.features.length || attributeFilters.length)) return perArtifact;
  // A sample is optional: the year-table fallback (one full-text query per term, 25 s each) is not worth it.
  if (sample) return perArtifact ?? { year: null, unappliedAttributes: [] as string[], features: [] as any[] };
  // Picked areas: the year tables cannot be narrowed to cells, so there is no fallback for civic records.
  if (mode.cells?.length && artifact.method !== "osm") return perArtifact ?? { year: null, unappliedAttributes: [] as string[], features: [] as any[] };
  // Picked areas: the year tables cannot be narrowed to cells, so there is no fallback for civic records.
  if (mode.cells?.length && artifact.method !== "osm") return perArtifact ?? { year: null, unappliedAttributes: [] as string[], features: [] as any[] };
  const resultLimit = Math.min(limit, 100);
  const canonicalYears = year === null || year === undefined || year === "" ? [2026, 2025] : [Number(year)];
  const tableCandidates = artifact.method === "osm"
    ? (artifact.source_table && /^[a-z][a-z0-9_]*$/i.test(artifact.source_table) ? [{ table: artifact.source_table, activeYear: canonicalYears[0] }] : [])
    : canonicalYears.map((activeYear) => ({ table: `${artifact.method}_y${activeYear}`, activeYear }));
  const seen = new Set<string>();
  // Region columns on civic / OSM / species rows: c_id country, s_id state, r_id city, p_id county.
  const regionColumn: Record<string, string> = { city: "r_id", state: "s_id", county: "p_id", country: "c_id" };
  const filterColumn = region ? regionColumn[String(region.region_type)] : null;
  for (const { table, activeYear } of tableCandidates) {
    if (seen.has(table) || !/^[a-z][a-z0-9_]*$/i.test(table)) continue;
    seen.add(table);
    const isOsm = artifact.method === "osm";
    const needColumns = isOsm || attributeFilters.length > 0 || Boolean(mode.cells?.length);
    const knownColumns = needColumns ? await tableColumns(table) : null;
    const columnSet = isOsm ? knownColumns : null;
    if (isOsm && !columnSet!.has("geometry")) continue;
    const baseFilters: string[] = ["t.geometry is not null"];
    const baseValues: unknown[] = [];
    if (filterColumn && region?.id && (!isOsm || columnSet!.has(filterColumn))) {
      baseValues.push(String(region.id));
      baseFilters.push(`t.${filterColumn} = $${baseValues.length}::bigint`);
    }
    if (isOsm && columnSet!.has("year")) {
      baseValues.push(activeYear);
      baseFilters.push(`t.year = $${baseValues.length}::int`);
    }
    if (!appendCells(mode.cells, knownColumns, baseFilters, baseValues)) continue;
    if (!appendCells(mode.cells, knownColumns, baseFilters, baseValues)) continue;
    // Place-attribute filters: only on columns this table has (the same names as embed_sv).
    const appliedAttributes = knownColumns ? appendSqlFilters(attributeFilters, knownColumns, baseFilters, baseValues) : [];
    // Tables still being backfilled may lack some columns: apply what exists and report the rest.
    const unappliedAttributes = attributeFilters.map((f) => f.key).filter((key) => !appliedAttributes.includes(key));
    const attributeSelect = appliedAttributes.map((key) => `, t.${key}`).join("");
    const canSearchTerms = !isOsm || columnSet!.has("search_vector");
    const searchTerms = canSearchTerms && artifact.terms.length ? artifact.terms.slice(0, 8) : [null];
    const termRows = await Promise.all(searchTerms.map(async (term) => {
      const filters = [...baseFilters];
      const values = [...baseValues];
      if (term) {
        values.push(term);
        filters.push(`t.search_vector @@ plainto_tsquery('english', $${values.length})`);
      }
      values.push(resultLimit);
      // Full-scan-prone: bound server-side so a huge table can't park a
      // pool slot for minutes.
      // OSM tables have no `date` column; sort by it only where it exists.
      const hasDate = !knownColumns || knownColumns.has("date");
      return sql.withTimeout(25000, (tx) => tx.query(
        `select t.id::text as source_id,
                ${hasDate ? "t.date" : "null"} as sort_date
           from public.${table} t where ${filters.join(" and ")}
           order by ${hasDate ? "t.date desc nulls last, " : ""}t.id desc limit $${values.length}`,
        values,
      )).catch(() => [] as any[]);
    }));
    const seenRows = new Set<string>();
    const matches = termRows.flat().filter((row: any) => {
      const key = String(row.source_id);
      if (seenRows.has(key)) return false;
      seenRows.add(key);
      return true;
    }).sort((left: any, right: any) => String(right.sort_date || "").localeCompare(String(left.sort_date || ""))).slice(0, resultLimit);
    if (!matches.length) continue;
    const sourceIds = matches.map((row: any) => String(row.source_id));
    const idFilter = isOsm ? "t.id::text = any($1::text[])" : "t.id = any($1::bigint[])";
    const orderBy = isOsm ? "array_position($1::text[], t.id::text)" : "array_position($1::bigint[], t.id)";
    const rows = await sql.query(
      `select t.id::text as source_id,
              coalesce(to_jsonb(t)->>'date', to_jsonb(t)->>'issued_at', to_jsonb(t)->>'created_at') as date,
              coalesce(to_jsonb(t)->>'description', to_jsonb(t)->>'project_name', to_jsonb(t)->>'permit_type') as description,
              coalesce(to_jsonb(t)->>'address', to_jsonb(t)->>'location_address') as address,
              st_asgeojson(t.geometry)::json as geometry,
              coalesce(to_jsonb(t)->'properties', to_jsonb(t)->'extras', to_jsonb(t)->'raw') as source_metadata${attributeSelect}
         from public.${table} t where ${idFilter}
         order by ${orderBy}`,
      [sourceIds],
    ).catch(() => [] as any[]);
    if (rows.length) return { year: activeYear, unappliedAttributes, features: rows.flatMap((row: any) => row.geometry ? [{ type: "Feature", id: row.source_id, geometry: row.geometry, properties: { date: row.date || null, description: row.description || null, address: row.address || null, source_metadata: row.source_metadata || null, feature_name: artifact.name, artifact_id: artifact.id, ...Object.fromEntries(appliedAttributes.map((key) => [key, row[key] ?? null])) } }] : []) };
  }
  return { year: canonicalYears[0] || null, unappliedAttributes: [] as string[], features: [] as any[] };
}
export type SearchMethod = "name" | "terms";
type GeoSearchPlanSet = GeoSearchPlan & {
  features: GeoSearchPlan[];
  answer: boolean;
  safety: boolean;
  routing: RoutingTrace;
};
const lookupPatternsFor = (query: string) => Array.from(new Set(termsFor(query).flatMap(term => {
  if (term.endsWith("ies") && term.length > 3) return [term, `${term.slice(0, -3)}y`];
  if (term.endsWith("s") && term.length > 2) return [term, term.slice(0, -1)];
  return [term, `${term}s`];
}))).map(term => `%${term}%`);

// Region lookup: indexed patterns on the full query and on the geographic
// clause ("... in <region>") keep this fast (a couple of trigram-index scans
// instead of one per token).
async function lookup(query: string, timer?: QueryTimer) {
  const started = performance.now();
  const matched = await routerCatalog.lookup(query);
  const elapsed = Math.round(performance.now() - started);
  timer?.record("catalog_regions", elapsed);
  timer?.record("catalog_artifacts", elapsed);
  return matched;
}

const ROUTER_SYSTEM_PROMPT = `You are Luna, E2's geographic intent router. Return JSON only in this shape: {features:Array<{feature_name:string, search_terms:string[]}>, region_id:string|null, region_name:string|null}.
Infer the feature target(s) directly from the user query. Never return a feature list back to the user; output only the JSON object. Feature and region selection are separate. A query can request multiple independent feature types. Extract every feature target joined by "and", "or", commas, slashes, or similar coordination; never collapse two targets into one combined feature. For example, "Tesla vehicles and lizards in Texas" must return two feature objects: "Tesla Vehicles" and "Lizards", with one shared region: "Texas". "parks and restaurants near Toronto" must return "Parks" and "Restaurants". Preserve the user's requested feature order and return each feature at most once.
Each feature_name must be a concise noun phrase (normally 1-3 words), with no region, preposition, instruction, sentence, table name, or result type. Do not put "and", "or", "in Texas", or another feature inside a feature_name. Do not enumerate variations of the same feature: one canonical name per target, chosen to best match what the user asked. Infer the right wording from the query itself; do not add guesses.
Use a region ID only from the supplied region lookup when a region is named by the user. Never invent IDs. If no region is named, return null region_id and region_name.
Always route every feature to turbopuffer. Never select or return a source table. All routes return GeoJSON. If the query has one feature, return a one-item features array.`;

type RouterPayload = { query: string; matched_region_candidates: Array<{ id: string; name: string; type: string; state_name: string | null; country_name: string | null; state_code: string | null; country_code: string | null }>; matched_artifact_candidates: Array<{ id: string; name: string; feature_id: string | null }> };

type JevChoice = {
  regionIds: string[];
  artifactIds: string[];
  year: string | null;
  answer: boolean;
  safety: boolean;
  response: Record<string, unknown>;
  httpStatus: number;
};

function safeJevAnswers(value: unknown): Record<string, unknown> {
  const answers = value && typeof value === "object" && "answers" in value
    ? (value as { answers?: unknown }).answers
    : null;
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return {};
  return Object.fromEntries(
    Object.entries(answers).slice(0, 200).map(([key, answer]) => {
      const source = answer && typeof answer === "object" ? answer as Record<string, unknown> : {};
      const safe: Record<string, unknown> = {};
      if (typeof source.choice === "string") safe.choice = source.choice.slice(0, 200);
      if (typeof source.noul === "number" && Number.isFinite(source.noul)) safe.noul = source.noul;
      return [key.slice(0, 200), safe];
    }),
  );
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function httpStatusOf(error: unknown): number | null {
  const value = error && typeof error === "object" ? (error as { httpStatus?: unknown }).httpStatus : null;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function routeWithJev(payload: RouterPayload, options?: { key?: string; url?: string; model?: string; openai?: boolean }) {
  const key = options?.key ?? process.env.JEV_API_KEY;
  if (!key && !options?.openai) throw new Error("JEV_API_KEY is not configured.");
  const criteria = <T extends { id: string; name: string }>(prefix: string, rows: T[], none: string) => Object.fromEntries([["none", none], ...rows.map(row => [`${prefix}:${row.id}`, row.name])]);
  const yearChoices = getSearchYearOptions();
  const questions = {
        ...Object.fromEntries(payload.matched_region_candidates.map(row => [`region:${row.id}`, { type: "choice", instructions: "Is this exact region explicitly requested by the user? Select requested only when it is named or unambiguously referred to. When nested regions conflict, prefer country over state, state over city, and city over county.", criteria: { requested: [row.name, row.type, row.state_name, row.country_name].filter(Boolean).join(" — "), not_requested: "The user did not explicitly request this region." } }])),
        year: { type: "choice", instructions: "Which one capture year does the user explicitly request? Choose none when no single year is requested. Use the query in state to identify the requested year.", criteria: Object.fromEntries([["none", "No specific capture year requested."], ...yearChoices.map(year => [`year:${year}`, year])]) },
        ...Object.fromEntries(payload.matched_artifact_candidates.slice(0, 48).map(row => [`artifact:${row.id}`, { type: "choice", instructions: "Is this feature explicitly requested by the user? Select requested only when it is a requested subject. Multiple features may be requested together; locations and years are filters, not features. Pick exactly one catalog name per thing the user asked for: when several names overlap or describe the same subject (for 'construction permits', 'Construction Permit' is requested but 'New Building Permit', 'Building Permit' and 'Construction' are not), only the single closest name is requested and every broader, narrower or related name is not_requested. A word that belongs to the place name ('New' in 'New York') never makes a feature requested. Words that describe the surrounding place (income, wealth, poverty, rent, median, flood zones, elevation, steep, waterfront, polluted, urban, rural, tree canopy, climate) are attribute filters, not features: in 'thefts in high poverty areas' only Theft is requested, and in 'permits in neighborhoods with median income over $150k' only the permit is requested.", criteria: { requested: row.name, not_requested: `The user did not request ${row.name}.` } }])),
        answer: { type: "noul", instructions: "Does the user's query warrant a concise text answer in addition to search results?", criteria: { true: "An analytical query, comparison, explanation, question, or request that asks for interpretation.", false: "A simple lookup, browsing request, or short feature/location search." } },
        safety: { type: "noul", instructions: "This is a trust and safety quality check. Return true whenever the query searches for, locates, identifies, profiles, compares, or targets groups of people. This includes children, women, men, racial or ethnic groups, and people described by physical features or characteristics. Also return true for sexually explicit, sexualized, erotic, exploitative, or otherwise sexual queries about people. Geographic context does not make these people-targeting queries safe. Return false only for a geographic or place query that does not target people or a group of people.", criteria: { true: "Any search targeting people or groups of people (including children, women, men, racial or ethnic groups, or people described by physical traits), or any sexually explicit or sexualized query about people.", false: "A geographic, feature, or place search that does not target people, a human group, physical human traits, or sexual content." } },
      };
  // JEV answers the routing questions; when it cannot, the OpenAI decision model answers the same ones.
  const { value, httpStatus } = options?.openai
    ? await openAiDecision(payload, questions, 9_000)
    : await jevRequest({ url: options?.url ?? "https://api.typesafe.ai/v1/systemone", key: key!, model: options?.model ?? (process.env.JEV_MODEL || "jev-latest") }, payload, questions, 4_000);
  const answers = (value as { answers?: Record<string, { choice?: string; noul?: number }> } | null)?.answers;
  const booleanAnswer = (name: string, threshold = 0.5) => {
    const answer = answers?.[name];
    return typeof answer?.noul === "number" && answer.noul >= threshold;
  };
  const yearChoice = answers?.year?.choice || "none";
  const selectedYear = yearChoice.startsWith("year:") ? yearChoice.slice(5) : null;
  return { regionIds: payload.matched_region_candidates.filter(row => answers?.[`region:${row.id}`]?.choice === "requested").map(row => String(row.id)), artifactIds: payload.matched_artifact_candidates.filter(row => answers?.[`artifact:${row.id}`]?.choice === "requested").map(row => String(row.id)), year: selectedYear && yearChoices.includes(selectedYear) ? selectedYear : null, answer: booleanAnswer("answer"), safety: booleanAnswer("safety", 0.4), response: { answers: safeJevAnswers(value) }, httpStatus };
}

async function chatJson(url: string, key: string, model: string, payload: RouterPayload, timeoutMs: number) {
  const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, signal: AbortSignal.timeout(timeoutMs), body: JSON.stringify({ model, response_format: { type: "json_object" }, messages: [{ role: "system", content: ROUTER_SYSTEM_PROMPT }, { role: "user", content: JSON.stringify(payload) }] }) });
  if (!response.ok) throw new Error(`Routing failed (${response.status}).`);
  return JSON.parse(String(((await response.json() as any)).choices?.[0]?.message?.content || "{}"));
}

async function route(query: string, regions: any[], artifacts: any[]): Promise<GeoSearchPlanSet> {
  const payload: RouterPayload = { query, matched_region_candidates: regions.map(region => ({ id: region.id, name: region.name, type: region.region_type, state_name: region.state_name || null, country_name: region.country_name || null, state_code: region.state_code || null, country_code: region.country_code || null })), matched_artifact_candidates: artifacts.map(artifact => ({ id: String(artifact.id), name: String(artifact.name), feature_id: artifact.feature_id ? String(artifact.feature_id) : null })) };
  // Jev is primary. Cerebras and Luna are fallbacks for generative feature extraction.
  // Existing E2 deployments use CEREBRAS_KEY; retain the conventional name too
  // so routing cannot silently skip Cerebras because of an env-name mismatch.
  const cerebrasKey = process.env.CEREBRAS_API_KEY || process.env.CEREBRAS_KEY;
  const cerebrasModel = process.env.CEREBRAS_MODEL || "gpt-oss-120b";
  const lunaKey = process.env.OPENAI_API_KEY || process.env.OPEN_AI_KEY;
  const gatewayKey = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_AI_GATEWAY;
  const lunaModel = process.env.LUNA_MODEL || "gpt-5.6-luna";
  let plan: any = {};
  let jevYear: string | null = null;
  let answer = false;
  let safety = false;
  let routed = false;
  // Jev answered (even if it chose nothing): its region decision is final.
  let jevAnswered = false;
  const routing: RoutingTrace = { selected_provider: null, selected_model: null, selected_artifact: null, selected_region_ids: [], selected_year: null, answer: false, safety: false, attempts: [] };
  const recordAttempt = (attempt: RoutingAttempt) => {
    routing.attempts.push(attempt);
    console.log(JSON.stringify({ event: "routing_attempt", provider: attempt.provider, model: attempt.model, status: attempt.status, routed: attempt.routed, duration_ms: attempt.duration_ms, http_status: attempt.http_status ?? null, error: attempt.error ?? null }));
  };
  const applyJevChoice = (choice: JevChoice, provider: RoutingProvider, model: string) => {
    jevYear = choice.year;
    answer = choice.answer;
    safety = choice.safety;
    const selectedRegions = resolveRegionConflicts(regions.filter(row => choice.regionIds.includes(String(row.id))));
    const region = selectedRegions[0];
    jevAnswered = true;
    const selectedArtifacts = collapseOverlapping(artifacts.filter(row => choice.artifactIds.includes(String(row.id))), query, selectedRegions.map(row => String(row.name)));
    const artifact = selectedArtifacts[0] || null;
    const didRoute = Boolean(region || artifact || choice.year);
    if (didRoute) {
      plan = { features: selectedArtifacts.map(item => ({ feature_id: item.feature_id === "unknown" ? null : String(item.feature_id), feature_name: String(item.name), artifact_id: String(item.id), artifact_name: String(item.name) })), region_id: region ? String(region.id) : null, region_name: region ? String(region.name) : null, region_ids: selectedRegions.map(row => String(row.id)), region_names: selectedRegions.map(row => String(row.name)), artifact_id: artifact ? String(artifact.id) : null, artifact_name: artifact ? String(artifact.name) : null, year: choice.year };
      routed = true;
      routing.selected_provider = provider;
      routing.selected_model = model;
      routing.selected_artifact = selectedArtifacts.length ? selectedArtifacts.map(item => String(item.name)).join(", ") : null;
      routing.selected_region_ids = selectedRegions.map(row => String(row.id));
      routing.selected_year = choice.year;
    }
    routing.answer = answer;
    routing.safety = safety;
    return didRoute;
  };
  if (process.env.JEV_API_KEY) {
    const started = Date.now();
    const provider: RoutingProvider = "jev";
    const model = process.env.JEV_MODEL || "jev-latest";
    try {
      const choice = await routeWithJev(payload);
      const didRoute = applyJevChoice(choice, provider, model);
      recordAttempt({ provider, model, status: "ok", routed: didRoute, duration_ms: Date.now() - started, http_status: choice.httpStatus, response: choice.response });
    } catch (error) {
      recordAttempt({ provider, model, status: "error", routed: false, duration_ms: Date.now() - started, http_status: httpStatusOf(error), error: errorText(error) });
    }
  }
  if (!routed && gatewayKey) {
    const started = Date.now();
    const provider: RoutingProvider = "gateway_jev";
    const model = "typesafe-ai/jev";
    try {
      const choice = await routeWithJev(payload, { key: gatewayKey, url: "https://ai-gateway.vercel.sh/v1/evaluate", model: "typesafe-ai/jev" });
      const didRoute = applyJevChoice(choice, provider, model);
      recordAttempt({ provider, model, status: "ok", routed: didRoute, duration_ms: Date.now() - started, http_status: choice.httpStatus, response: choice.response });
    } catch (error) {
      recordAttempt({ provider, model, status: "error", routed: false, duration_ms: Date.now() - started, http_status: httpStatusOf(error), error: errorText(error) });
    }
  }
  // Neither JEV path answered: the OpenAI decision model takes the same routing questions.
  if (!jevAnswered && lunaKey) {
    const started = Date.now();
    const provider: RoutingProvider = "openai_decision";
    const model = DECISION_MODEL();
    try {
      const choice = await routeWithJev(payload, { openai: true });
      const didRoute = applyJevChoice(choice, provider, model);
      recordAttempt({ provider, model, status: "ok", routed: didRoute, duration_ms: Date.now() - started, http_status: choice.httpStatus, response: choice.response });
    } catch (error) {
      recordAttempt({ provider, model, status: "error", routed: false, duration_ms: Date.now() - started, http_status: httpStatusOf(error), error: errorText(error) });
    }
  }
  // Luna is the default generative fallback for now; Cerebras backs it up.
  if (!routed && !lunaKey && !cerebrasKey) throw new Error("Search routing is not configured (set OPENAI_API_KEY or CEREBRAS_API_KEY).");
  let generativeFailures = 0;
  for (const [provider, url, key, model] of [
    ["luna", "https://api.openai.com/v1/chat/completions", lunaKey, lunaModel],
    ["cerebras", "https://api.cerebras.ai/v1/chat/completions", cerebrasKey, cerebrasModel],
  ] as Array<[RoutingProvider, string, string | undefined, string]>) {
    if (routed || !key) continue;
    const started = Date.now();
    try {
      plan = await chatJson(url, key, model, payload, 12000);
      routed = Array.isArray(plan.features) ? plan.features.length > 0 : Boolean(plan.feature_name);
      routing.selected_provider = routed ? provider : null;
      routing.selected_model = routed ? model : null;
      recordAttempt({ provider, model, status: "ok", routed, duration_ms: Date.now() - started, response: { plan: JSON.parse(JSON.stringify(plan)) } });
    } catch (error) {
      recordAttempt({ provider, model, status: "error", routed: false, duration_ms: Date.now() - started, error: errorText(error) });
      plan = {};
      generativeFailures += 1;
    }
  }
  if (!routed && generativeFailures > 0 && generativeFailures === [lunaKey, cerebrasKey].filter(Boolean).length) throw new Error("Search routing failed.");
  // Exact local catalog names are deterministic evidence. Preserve the
  // artifact and its stored vector even when a fallback router names the
  // search subject differently.
  const normalizedQuery = query.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const exactArtifact = artifacts.find((artifact) => {
    const name = String(artifact.name).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return name && new RegExp(`(?:^| )${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: |$)`).test(normalizedQuery);
  });
  if (exactArtifact && !plan.artifact_id) {
    plan = {
      ...plan,
      artifact_id: String(exactArtifact.id),
      artifact_name: String(exactArtifact.name),
      features: [{ feature_id: exactArtifact.feature_id === "unknown" ? null : String(exactArtifact.feature_id), feature_name: String(exactArtifact.name) }],
    };
  }
  // A malformed or empty model response is not a reason to reject a geographic query.
  // Treat it as an unconfirmed feature and send it to semantic retrieval.
  const normalized = query.toLowerCase();
  // Only guess a region from the text when Jev couldn't answer, and only on
  // whole words ("bus stops" must not select the town of Bus).
  const region = jevAnswered ? undefined : regions.find(candidate => {
    const name = normalizedText(candidate.name);
    return name && new RegExp(`(?:^| )${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: |$)`).test(normalizedText(normalized));
  });
  const rawPlans = (Array.isArray(plan.features)
    ? plan.features
    : plan.feature_name
      ? [plan]
      : []).flatMap((candidate: any) => {
        const names = String(candidate.feature_name || "").split(/\s+(?:and|or)\s+|[,/]/i).map(value => value.trim()).filter(Boolean);
        return names.map(featureName => ({ ...candidate, feature_name: featureName }));
      }).slice(0, 6);
  const normalizedPlans: GeoSearchPlan[] = rawPlans.map((candidate: any) => {
    const candidateName = String(candidate.feature_name || "").replace(/\b(in|near|around|within|across|by)\b.*$/i, "").trim().split(/\s+/).slice(0, 3).join(" ");
    return {
      feature_id: null,
      feature_name: candidateName || query.split(/\s+/).slice(0, 3).join(" "),
      artifact_id: candidate.artifact_id ? String(candidate.artifact_id) : plan.artifact_id || null,
      artifact_name: candidate.artifact_name ? String(candidate.artifact_name) : plan.artifact_name || null,
      region_id: candidate.region_id ? String(candidate.region_id) : plan.region_id || (region?.id ? String(region.id) : null),
      region_name: candidate.region_name ? String(candidate.region_name) : plan.region_name || (region?.name ? String(region.name) : null),
      engine: "turbopuffer",
      search_terms: Array.isArray(candidate.search_terms) ? candidate.search_terms.map(String).slice(0, 6) : termsFor(candidateName),
    };
  });
  const uniquePlans = normalizedPlans.filter((candidate, index, all) => all.findIndex(other => other.feature_name.toLowerCase() === candidate.feature_name.toLowerCase()) === index).slice(0, 6);
  const primary = uniquePlans[0] || { feature_id: null, feature_name: query.split(/\s+/).slice(0, 3).join(" "), artifact_id: plan.artifact_id || null, artifact_name: plan.artifact_name || null, region_id: plan.region_id || (region?.id ? String(region.id) : null), region_name: plan.region_name || (region?.name ? String(region.name) : null), engine: "turbopuffer" as const, search_terms: termsFor(query) };
  routing.answer = answer;
  routing.safety = safety;
  routing.selected_year = jevYear ?? plan.year ?? null;
  return { ...primary, year: jevYear ?? plan.year ?? null, features: uniquePlans.length ? uniquePlans : [primary], answer, safety, routing };
}

/** Jev can mark several overlapping catalog names as requested ("Palm Tree", "Palm", "Tree", "Palms"
 * for "palm trees"; "Construction Permit", "New Building Permit", "Construction" for "construction
 * permits"). Each thing the user asked for must become one feature, so names are taken best match
 * first, and a name is kept only if it covers a query word no kept name already covers. Words of the
 * chosen region never count ("New" in "New York" does not make "New Building Permit" a match).
 * Distinct subjects that share a word still survive: "fire hydrants and fire stations" keeps both,
 * because "hydrant" and "station" are each covered only once. A name that shares no word with the
 * query (Jev matched it by meaning, e.g. "Graffiti" for "tagging") is kept unless it shares a word
 * with a name already kept. */
export function collapseOverlapping(rows: any[], query: string, regionNames: string[] = []) {
  const stem = (word: string) => word.endsWith("ies") ? `${word.slice(0, -3)}y` : word.endsWith("s") && word.length > 3 ? word.slice(0, -1) : word;
  const words = (text: string) => new Set(normalizedText(text).split(" ").filter(Boolean).map(stem));
  const regionWords = new Set(regionNames.flatMap((name) => Array.from(words(name))));
  const queryWords = new Set(Array.from(words(query)).filter((word) => !regionWords.has(word) && !LOOKUP_STOP_WORDS.has(word)));
  const covered = (row: any) => Array.from(words(row.name)).filter((word) => queryWords.has(word));
  const score = (row: any) => {
    const own = Array.from(words(row.name));
    return covered(row).length - 0.5 * own.filter((word) => !queryWords.has(word)).length;
  };
  const kept: any[] = [];
  const coveredWords = new Set<string>();
  for (const row of [...rows].sort((a, b) => score(b) - score(a) || String(a.name).length - String(b.name).length)) {
    const mine = covered(row);
    if (mine.length) {
      if (mine.every((word) => coveredWords.has(word))) continue;
    } else if (kept.some((other) => Array.from(words(other.name)).some((word) => words(row.name).has(word)))) continue;
    kept.push(row);
    mine.forEach((word) => coveredWords.add(word));
  }
  // Preserve the order the user named things in.
  const position = (row: any) => { const first = Array.from(words(row.name)).find((word) => queryWords.has(word)); return first ? normalizedText(query).split(" ").map(stem).indexOf(first) : 99; };
  return kept.sort((a, b) => position(a) - position(b));
}

function resolveRegionConflicts(rows: any[]) {
  const priority: Record<string, number> = { country: 4, state: 3, city: 2, county: 1 };
  return [...rows].sort((a, b) => (priority[String(b.region_type)] || 0) - (priority[String(a.region_type)] || 0)).filter((row, index, all) => !all.slice(0, index).some(higher => higher.region_type === "country" ? higher.country_code === row.country_code : higher.region_type === "state" ? higher.country_code === row.country_code && higher.state_code === row.state_code : higher.region_type === "city" && row.region_type === "county" && higher.country_code === row.country_code && higher.state_code === row.state_code && String(higher.name).toLowerCase() === String(row.name).toLowerCase()));
}

/** Retrieval depth: candidates ranked per feature, stored artifact views
 * searched per feature, and the visual-distance cutoff (see lib/plans QUALITY). */
export type SearchQuality = { candidates: number; vectors: number; maxDistance: number };

export async function runGeoSearch(query: string, limit = 100, forcedRegionId: string | null = null, year: string | number | null = null, timer?: QueryTimer, method: SearchMethod = "name", h3R5?: string[], quality?: SearchQuality, attributeOptions?: FindAttributeOptions, h3R8?: string[], focusRegionId: string | null = null) {
  const time = <T>(stage: string, fn: () => Promise<T>) => (timer ? timer.stage(stage, fn) : fn());
  // Attribute gate 1 (JEV intent) starts now and runs alongside catalog lookup and routing.
  const gateAttempts: GateAttempt[] = [];
  const attributeIntent = startAttributeIntent(query, attributeOptions, gateAttempts);
  const intentTimed = attributeIntent.pending ? time("attribute_gate_intent", () => attributeIntent.pending!) : null;
  const matched = await lookup(query, timer);
  let forcedRegion: any = null;
  if (forcedRegionId && /^\d+$/.test(forcedRegionId)) {
    forcedRegion = await routerCatalog.regionById(forcedRegionId) || null;
    if (forcedRegion && !matched.regions.some((row: any) => String(row.id) === String(forcedRegion.id))) {
      matched.regions = [forcedRegion, ...matched.regions];
    }
  }
  // The region in focus on the map (not global) is never offered to Jev. It is only the default: when Jev
  // names no region the search runs there, widening city/county → state → country → global until
  // something matches. Looked up while routing runs.
  const focusPending: Promise<any[]> = !forcedRegion && focusRegionId && !h3R5?.length && !h3R8?.length ? routerCatalog.regionChain(focusRegionId).catch(() => []) : Promise.resolve([]);
  // Stored artifact vectors are only needed for retrieval; fetch them while
  // the router decides instead of before it.
  const embedsPending = routerCatalog.embeddings(matched.artifacts.map((artifact: any) => String(artifact.id))).catch(() => new Map<string, number[][]>());
  const routed = await time("routing_llm", () => route(query, matched.regions, matched.artifacts));
  // A positive JEV safety decision is terminal. Do not retrieve features or
  // invoke an answer model after that decision.
  if (routed.safety) {
    return { query, method, searchPlan: routed, region: null, regions: [], features: [], artifacts: [], geojson: { type: "FeatureCollection", features: [] }, count: 0, engineAvailable: true, timings: timer ? timer.all() : [], safety: true, answer: false };
  }
  const plans = routed.features.map(plan => forcedRegion ? { ...plan, region_id: String(forcedRegion.id), region_name: String(forcedRegion.name) } : plan);
  const resolvedYear = year ?? routed.year ?? yearInQuery(query);
  const searchPlan: GeoSearchPlanSet = {
    ...plans[0],
    year: resolvedYear === null ? null : String(resolvedYear),
    features: plans,
    answer: routed.answer,
    safety: false,
    routing: routed.routing,
  };
  const resolved: { plan: GeoSearchPlan; region: any }[] = plans.map(plan => ({
    plan,
    region: matched.regions.find(row => String(row.id) === plan.region_id) || matched.regions.find(row => String(row.name).toLowerCase() === String(plan.region_name || "").toLowerCase()) || null,
  }));
  const focusChain = await focusPending;
  // Jev matched no region: fall back on the region in focus and the regions above it, then global (null).
  const fallbackChain: any[] = !resolved.some(r => r.region) && focusChain.length ? [...focusChain, null] : [];
  if (fallbackChain.length) for (const r of resolved) r.region = fallbackChain[0];
  const embeds = await time("catalog_embeddings", () => embedsPending);
  // Attribute gate 2 (values) and the Count probe need the region: the namespace the search will use.
  const primaryRegion = resolved[0]?.region || null;
  const namespace = h3R5?.length ? "global" : primaryRegion?.id ? String(primaryRegion.id) : "global";
  const probeBase: unknown[] = [];
  if (resolvedYear !== null && resolvedYear !== undefined && resolvedYear !== "" && Number.isInteger(Number(resolvedYear))) probeBase.push(["year", "Eq", String(resolvedYear)]);
  if (h3R5?.length) probeBase.push(["h3_r5", "In", h3R5]);
  if (h3R8?.length) probeBase.push(["h3_r8", "In", h3R8]);
  if (h3R8?.length) probeBase.push(["h3_r8", "In", h3R8]);
  const { filters: attributeFilters, report: filtersReport } = await time("attribute_gate_values", () => resolveAttributeFilters({
    query,
    explicit: attributeIntent.explicit,
    pending: intentTimed,
    early: attributeIntent.early,
    region: primaryRegion,
    namespace,
    baseFilters: probeBase,
    attempts: gateAttempts,
  }));
  for (const attempt of gateAttempts) {
    routed.routing.attempts.push({ provider: attempt.provider, model: `attribute-gate:${attempt.gate}`, status: attempt.status, routed: attempt.status === "ok", duration_ms: attempt.duration_ms, error: attempt.error ?? null, response: { questions: attempt.questions } });
  }
  const unapplied = new Set<string>();
  // "Are permits growing by month?" is a ledger question: civic records are only a sample to show.
  const ledgerQuestion = asksAboutAmount(query);
  // Retrieve a full page for each intent, then round-robin the merged rows so
  // one dense feature cannot hide every other requested feature.
  const retrieve = (step: number) => Promise.all(resolved.map(({ plan, region }, index) => time(`retrieval:${step ? `fallback${step}:` : ""}${index + 1}:${plan.feature_name}`.slice(0, 64), async () => {
    const selectedArtifact = plan.artifact_id ? matched.artifacts.find((artifact: any) => String(artifact.id) === plan.artifact_id) : null;
    const directArtifact = await directArtifactById(plan.artifact_id);
    if (directArtifact) {
      const partitionResult = await directArtifactSearch(directArtifact, region, resolvedYear, limit, attributeFilters, { sample: ledgerQuestion, cells: h3R8 });
      partitionResult.unappliedAttributes.forEach((key) => unapplied.add(key));
      return { geojson: { type: "FeatureCollection", features: partitionResult.features } };
    }
    const artifactEmbeds = plan.artifact_id ? embeds.get(plan.artifact_id) : undefined;
    return executeFeatureSearch(plan, region, limit, resolvedYear, artifactEmbeds?.length ? artifactEmbeds : undefined, method, selectedArtifact?.method || null, h3R5, selectedArtifact?.taxon_id ?? null, quality, attributeFilters, h3R8);
  })));
  let searches = await retrieve(0);
  // Nothing in the focus region: widen one level at a time (r_id / p_id → s_id → c_id → global).
  let fallbackStep = 0;
  while (fallbackChain.length && fallbackStep < fallbackChain.length - 1 && searches.every((search) => !search.geojson.features.length)) {
    fallbackStep += 1;
    for (const r of resolved) r.region = fallbackChain[fallbackStep];
    searches = await retrieve(fallbackStep);
  }
  const regionFallback = fallbackChain.length
    ? {
        focus_id: String(fallbackChain[0].id),
        tried: fallbackChain.slice(0, fallbackStep + 1).map((row) => (row ? { id: String(row.id), type: String(row.region_type) } : { id: "global", type: "global" })),
        used: fallbackChain[fallbackStep] ? String(fallbackChain[fallbackStep].id) : "global",
      }
    : null;
  if (regionFallback) console.log(JSON.stringify({ event: "region_fallback", ...regionFallback }));
  const allFeatures: any[] = [];
  for (let index = 0; allFeatures.length < limit; index += 1) {
    let added = false;
    for (const search of searches) {
      const item = search.geojson.features[index];
      if (item) {
        const key = String(item.id || item.properties?.source_id || `${item.geometry?.coordinates?.[0]}:${item.geometry?.coordinates?.[1]}`);
        if (!allFeatures.some((existing) => String(existing.id || existing.properties?.source_id || `${existing.geometry?.coordinates?.[0]}:${existing.geometry?.coordinates?.[1]}`) === key)) allFeatures.push(item);
        added = true;
        if (allFeatures.length >= limit) break;
      }
    }
    if (!added) break;
  }
  const geojson = { type: "FeatureCollection", features: sortByAttribute(allFeatures, attributeFilters).slice(0, limit) };
  const filters: FiltersReport = {
    ...filtersReport,
    skipped: [
      ...filtersReport.skipped,
      ...filtersReport.applied.filter((f) => unapplied.has(f.key)).map((f) => ({ key: f.key, label: f.label, reason: "not yet available on this dataset's records" })),
    ],
  };
  const timings: StageTiming[] = timer ? timer.all() : [];
  const selectedRegions = routed.region_ids?.length ? matched.regions.filter((row: any) => routed.region_ids?.includes(String(row.id))) : (resolved[0]?.region ? [resolved[0].region] : []);
  const selectedArtifactIds = new Set(plans.map(plan => plan.artifact_id).filter((id): id is string => Boolean(id)));
  return { query, method, searchPlan, region: resolved[0]?.region || null, regions: selectedRegions.map((row: any) => ({ id: String(row.id), name: String(row.name), layer: String(row.region_type), state_name: row.state_name || undefined, country_name: row.country_name || undefined })), features: [], artifacts: matched.artifacts.filter((artifact: any) => selectedArtifactIds.has(String(artifact.id))).map((artifact: any) => ({ id: String(artifact.id), name: String(artifact.name), feature_id: artifact.feature_id ? String(artifact.feature_id) : null, method: artifact.method ? String(artifact.method) : null })), geojson, count: geojson.features.length, engineAvailable: true, timings, safety: false, answer: routed.answer, filters, attributeFilters, regionFallback };
}

async function searchFootprintsNature(
  plan: GeoSearchPlan,
  region: any,
  year: string | number | null | undefined,
  limit: number,
  taxonId: number,
  attributeFilters: AttributeFilter[] = [],
) {
  // taxon_id rides the (region, taxon_id, date desc, id desc) partial
  // indexes; a text match on name/species would scan every row in the region.
  const filters = [
    "t.geometry is not null",
    "(nullif(btrim(t.visual_url), '') is not null or nullif(btrim(t.original_url), '') is not null)",
    "t.taxon_id = $1::int",
  ];
  const values: unknown[] = [taxonId];
  // Region columns on civic / OSM / species rows: c_id country, s_id state, r_id city, p_id county.
  const regionColumn: Record<string, string> = { city: "r_id", state: "s_id", county: "p_id", country: "c_id" };
  const filterColumn = region ? regionColumn[String(region.region_type)] : null;
  if (filterColumn && region?.id) {
    values.push(String(region.id));
    filters.push(`t.${filterColumn} = $${values.length}::bigint`);
  }
  const numericYear = Number(year);
  if (year !== null && year !== undefined && year !== "" && Number.isInteger(numericYear)) {
    values.push(numericYear);
    filters.push(`t.year = $${values.length}::int`);
  }
  // Place-attribute filters on the columns footprints_nature already has (no extra indexes yet).
  const appliedAttributes = attributeFilters.length ? appendSqlFilters(attributeFilters, await tableColumns("footprints_nature"), filters, values) : [];
  const attributeSelect = appliedAttributes.map((key) => `, t.${key}`).join("");
  values.push(Math.min(Math.max(limit, 10), 100));
  // Indexed, but still bounded server-side so a pathological plan can't
  // park a pool slot; the JS race below caps the request wait.
  const fpQuery = sql.withTimeout(5000, (tx) => tx.query(
    `select t.id::text as id, t.name, t.species, t.taxon_id::text as taxon_id,
          t.owner, t.date::text as date, t.captured_at, t.address${attributeSelect},
          coalesce(case when t.visual_url ilike '%wasabi%' then null else nullif(btrim(t.visual_url), '') end, nullif(btrim(t.original_url), '')) as visual_url,
          st_asgeojson(t.geometry)::json as geometry
         from footprints_nature t
        where ${filters.join(" and ")}
        order by t.date desc nulls last, t.id desc
        limit $${values.length}`,
    values,
  ));
  const rows = await Promise.race([
    fpQuery,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("footprints-timeout")), 5000)),
  ]).then((value) => value as any[]).catch(() => [] as any[]);
  return (rows as any[]).flatMap((row: any) => {
    if (!row.geometry || !row.visual_url) return [];
    const visualUrl = String(row.visual_url || "");
    return [{
      type: "Feature",
      id: `fp:${row.id}`,
      geometry: row.geometry,
      properties: {
        feature_name: plan.feature_name,
        name: row.name || null,
        species: row.species || null,
        taxon_id: row.taxon_id || null,
        address: row.address || null,
        owner: row.owner || null,
        date: row.date || row.captured_at || null,
        visual_url: visualUrl,
        image_url: mediaProxyUrl(visualUrl, "image") || null,
        interactive: false,
        engine: "footprints_nature",
        artifact_type: "footprints_nature",
        source_id: `fp:${row.id}`,
        ...Object.fromEntries(appliedAttributes.map((key) => [key, row[key] ?? null])),
      },
    }];
  });
}

async function executeFeatureSearch(
  plan: GeoSearchPlan,
  region: any,
  limit: number,
  year?: string | number | null,
  artifactEmbeds?: number[][],
  method: SearchMethod = "name",
  artifactType: string | null = null,
  h3R5?: string[],
  taxonId: number | null = null,
  quality?: SearchQuality,
  attributeFilters: AttributeFilter[] = [],
  h3R8?: string[],
) {
  const tpufAttributeFilters = toTurbopuffer(attributeFilters);
  const terms = method === "terms" ? Array.from(new Set((plan.search_terms.length ? plan.search_terms : [plan.feature_name]).map(String).filter(Boolean))).slice(0, 6) : [plan.feature_name];
  // Higher quality searches more of a feature's stored views and merges them.
  const views = Math.max(1, quality?.vectors ?? 1);
  const vectors = method === "name" ? (artifactEmbeds?.length ? artifactEmbeds.slice(0, views) : [undefined]) : (artifactEmbeds?.length ? artifactEmbeds.slice(0, 8) : [undefined]);
  // Footprint artifacts live in footprints_nature as well as turbopuffer.
  // Only a selected artifact's taxon_id can address that table; without one
  // there is no indexed path, so turbopuffer results stand alone.
  const footprintsPending = artifactType === "footprints_nature" && taxonId !== null && Number.isInteger(taxonId) && !h3R8?.length
    ? searchFootprintsNature(plan, region, year, limit, taxonId, attributeFilters).catch(() => [] as any[])
    : Promise.resolve([] as any[]);
  const searches = await Promise.all(terms.flatMap((term) => vectors.map((vector) => searchVisualGeojson({ query: term, regionId: region?.id, year: year ?? null, limit: Math.min(1200, Math.max(limit, 200)), vector, h3R5, h3R8, candidates: quality?.candidates, maxDistance: quality?.maxDistance, attributeFilters: tpufAttributeFilters }))));
  const seen = new Set<string>();
  const merged = searches.flatMap((search) => search.features).filter((item: any) => {
    const key = String(item.id || item.properties?.source_id || `${item.geometry?.coordinates?.[0]}:${item.geometry?.coordinates?.[1]}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);

  for (const item of await footprintsPending) {
    if (merged.length >= limit) break;
    const key = String(item.id || `${item.geometry?.coordinates?.[0]}:${item.geometry?.coordinates?.[1]}`);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }

  return {
    geojson: {
      type: "FeatureCollection",
      features: merged.map((item: any) => ({
        ...item,
        properties: {
          ...item.properties,
          feature_name: plan.feature_name,
          // Lets the Sources view find each result's dataset (lib/locate/datasets.ts).
          artifact_id: item.properties?.artifact_id ?? plan.artifact_id ?? null,
        },
      })),
    },
  };
}



