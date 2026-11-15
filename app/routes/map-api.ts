import type { Route } from "./+types/map-api";
import { getSessionUser } from "../../server/auth";
import { downloadDataset, getArtifact, getRecords, isMapFilter, listArtifacts, searchRegions } from "../../server/mapdata";

// JSON behind edk.earth/map: /map/api/artifacts, /map/api/scenes, /map/api/records and /map/api/regions,
// plus /map/api/download for the dataset files (signed in).

const CACHED = "public, s-maxage=300, stale-while-revalidate=3600";
const FORMATS: Record<string, string> = { csv: "text/csv; charset=utf-8", geojson: "application/geo+json", parquet: "application/vnd.apache.parquet" };

const json = (body: unknown, status = 200, cache = CACHED) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": status === 200 ? cache : "private, no-store" } });

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const p = new URL(request.url).searchParams;
  const page = Math.max(1, Math.min(500, Number(p.get("page")) || 1));
  const slug = (p.get("slug") ?? "").slice(0, 160);
  const region = p.get("region")?.slice(0, 160) || null;
  try {
    switch (params.kind) {
      case "artifacts": {
        const filter = p.get("filter") ?? "all";
        return json(await listArtifacts({ q: p.get("q") ?? "", filter: isMapFilter(filter) ? filter : "all", page }));
      }
      case "scenes": {
        const detail = slug ? await getArtifact(slug, { region, page }) : null;
        return detail ? json({ scenes: detail.scenes, page: detail.page, hasMore: detail.hasMore }) : json({ error: "Not found" }, 404);
      }
      case "records": {
        if (!slug) return json({ error: "slug is required" }, 400);
        return json(await getRecords(slug, { region, page, year: p.get("year"), from: p.get("from"), to: p.get("to") }));
      }
      case "regions":
        return json({ regions: await searchRegions(p.get("q") ?? "") });
      case "download": {
        const format = p.get("format") ?? "";
        if (!slug || !FORMATS[format]) return json({ error: "slug and format (csv, geojson, parquet) are required" }, 400);
        const user = await getSessionUser(context.cloudflare.env.DB, request);
        if (!user) return json({ error: "Sign in to download datasets." }, 401);
        const upstream = await downloadDataset(slug, region, format);
        if (!upstream.ok || !upstream.body) return json({ error: "Download unavailable right now." }, upstream.status === 404 ? 404 : 502);
        const name = `${slug}${region ? `-${region}` : ""}.${format}`.replace(/[^a-z0-9.-]/gi, "-");
        return new Response(upstream.body, { headers: { "content-type": FORMATS[format], "content-disposition": `attachment; filename="${name}"`, "cache-control": "private, no-store" } });
      }
      default:
        return json({ error: "Not found" }, 404);
    }
  } catch {
    return json({ error: "The map catalog is unavailable right now." }, 502);
  }
}
