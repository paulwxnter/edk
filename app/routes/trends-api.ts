import type { Route } from "./+types/trends-api";
import { getSessionUser } from "../../server/auth";
import { hasSignalsAccess } from "../../server/signals-access";
import { getModel, getRegion, getSeries, getTopRegions, search, searchRegionsForFeature } from "lib/signals/db";
import { SOURCE_EXPORT_MAX, getCitations, getSourcePage } from "lib/signals/source";
import { isSeriesTimeframe } from "lib/signals/types";

// Read-only JSON for the Trends page: /signals/api/series, /signals/api/regions and /signals/api/search.

const CACHED = "public, s-maxage=600, stale-while-revalidate=3600";
const TYPES = ["city", "county", "state", "country"];

const json = (body: unknown, status = 200, cache?: string) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache && status === 200 ? cache : "private, no-store" } });

/** Series for one feature across up to five regions: ?feature=slug&regions=a,b&tf=monthly */
async function series(p: URLSearchParams) {
  const tf = p.get("tf");
  if (!isSeriesTimeframe(tf)) return json({ error: "tf must be year, monthly or weekly" }, 400);
  const model = await getModel(p.get("feature") ?? "");
  if (!model) return json({ error: "Unknown feature" }, 404);
  const slugs = (p.get("regions") ?? "").split(",").filter(Boolean).slice(0, 5);
  const rows = await Promise.all(
    slugs.map(async (slug) => {
      const region = await getRegion(slug);
      return region ? { region, points: await getSeries(model.featureId, region.id, tf, model.measurement) } : null;
    })
  );
  return json({ series: rows.filter(Boolean) }, 200);
}

/** Regions for one feature: ?feature=slug&type=city (top by volume) or ?feature=slug&q=chi (name search, regions with data only). */
async function regions(p: URLSearchParams) {
  const model = await getModel(p.get("feature") ?? "");
  if (!model) return json({ error: "Unknown feature" }, 404);
  const q = p.get("q");
  if (q != null) return json({ regions: await searchRegionsForFeature(model.featureId, q.slice(0, 60), model.measurement) });
  // Web technologies are only reported per country.
  const type = model.countryLevel ? "country" : TYPES.includes(p.get("type") ?? "") ? p.get("type")! : "city";
  return json({ regions: await getTopRegions(model.featureId, type, 15, model.measurement) }, 200);
}

/** Signal + place search: ?q=permit */
async function find(p: URLSearchParams) {
  return json({ hits: await search((p.get("q") ?? "").slice(0, 80)) }, 200, CACHED);
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Data Viewer rows: ?feature&region&page[&from=YYYY-MM-DD][&to=YYYY-MM-DD]
 * Export: add format=csv|json and scope=page|all (all = every matching row, up to SOURCE_EXPORT_MAX).
 */
async function source(p: URLSearchParams, citations = false) {
  const page = Number(p.get("page") ?? 1);
  if (!Number.isInteger(page) || page < 1 || page > 400) return json({ error: "Invalid page." }, 400);
  const from = p.get("from") || null;
  const to = p.get("to") || null;
  if ((from && !ISO_DAY.test(from)) || (to && !ISO_DAY.test(to))) return json({ error: "Dates are YYYY-MM-DD." }, 400);
  const [model, region] = await Promise.all([getModel(p.get("feature") ?? ""), getRegion(p.get("region") ?? "")]);
  if (!model || !region) return json({ error: "Signal or place not found." }, 404);
  if (citations) return json({ citations: await getCitations(model, region) });

  const format = p.get("format");
  const all = (format === "csv" || format === "json") && p.get("scope") === "all";
  const result = await getSourcePage(model, region, all ? { page: 1, pageSize: SOURCE_EXPORT_MAX, from, to } : { page, from, to });
  if (format !== "csv" && format !== "json") return json({ ...result, hasMore: result.hasMore && page < 400 });

  const range = [from, to].filter(Boolean).join("_to_");
  const name = `${model.slug}-${region.slug}${range ? `-${range}` : ""}${all ? "" : `-page-${page}`}`;
  if (format === "json") {
    const rows = result.rows.map((row) => Object.fromEntries(result.columns.map((column, i) => [column.key, row[i]])));
    return new Response(JSON.stringify({ signal: model.name, place: region.name, from, to, columns: result.columns, rows, truncated: all && result.hasMore }, null, 2), { headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${name}.json"`,
      "cache-control": "private, no-store",
    } });
  }
  const cell = (value: string | null) => {
    const text = value ?? "";
    const safe = /^[\s\u0000-\u001f]*[=+\-@＝＋－＠]|^[\t\r\n]/u.test(text) ? "'" + text : text;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  const csv = [result.columns.map((column) => column.label), ...result.rows]
    .map((row) => row.map(cell).join(",")).join("\r\n");
  return new Response(csv, { headers: {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="${name}.csv"`,
    "cache-control": "private, no-store",
  } });
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const p = new URL(request.url).searchParams;
  try {
    if (params.kind === "series" || params.kind === "regions" || params.kind === "source") {
      const db = context.cloudflare.env.DB;
      const user = await getSessionUser(db, request);
      if (!user || !await hasSignalsAccess(db, user.id)) return json({ error: "A Signals subscription is required." }, 403);
    }
    if (params.kind === "series") return await series(p);
    if (params.kind === "regions") return await regions(p);
    if (params.kind === "source") return await source(p);
    if (params.kind === "citations") return await source(p, true);
    if (params.kind === "search") return await find(p);
    return json({ error: "Not found" }, 404);
  } catch (error) {
    console.error("[edk] trends api failed", error instanceof Error ? error.message : error);
    return json({ error: "Signals are temporarily unavailable." }, 502);
  }
}
