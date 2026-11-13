// cdn.edk.earth: serves result media from signed paths (/i/<sig>/<base64url source>), cached at the edge.
import { verifyMediaPath } from "lib/locate/media-proxy";

const MEDIA = /^(image|video)\//;
const YEAR = 31_536_000;

export async function handleCdn(request: Request, ctx: ExecutionContext) {
  const url = new URL(request.url);
  if (url.pathname === "/tiles/planet.pmtiles") return handleTiles(request, url, ctx);
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  if (url.pathname === "/" || url.pathname === "") return new Response("EDK CDN", { headers: { "content-type": "text/plain" } });
  const m = url.pathname.match(/^\/i\/([A-Za-z0-9_-]{22})\/([A-Za-z0-9_-]+)$/);
  const source = m ? verifyMediaPath(m[1], m[2]) : null;
  if (!source) return new Response("Not found", { status: 404 });

  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(`${url.origin}${url.pathname}`, { method: "GET" });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const upstream = await fetch(source, { headers: { accept: "image/*,video/*;q=0.9" }, cf: { cacheTtl: 86_400, cacheEverything: true } } as RequestInit).catch(() => null);
  if (!upstream || !upstream.ok) return new Response("Media unavailable", { status: upstream?.status === 404 ? 404 : 502, headers: { "cache-control": "public, max-age=60" } });
  const type = upstream.headers.get("content-type") || "";
  if (!MEDIA.test(type)) return new Response("Not media", { status: 415 });

  const response = new Response(upstream.body, {
    headers: {
      "content-type": type,
      "cache-control": `public, max-age=${YEAR}, immutable`,
      "access-control-allow-origin": "*",
      "x-content-type-options": "nosniff",
      ...(upstream.headers.get("content-length") ? { "content-length": upstream.headers.get("content-length")! } : {}),
    },
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

// The Atlas basemap: one planet-wide PMTiles archive, read with HTTP range requests. Each byte range is
// cached at the edge on its own (tile offsets are fixed, so ranges repeat across visitors).
const BASEMAP = "https://s3.us-east-005.backblazeb2.com/outerview/basemaps/planet.pmtiles";
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "range, if-match", "access-control-expose-headers": "content-range, content-length, etag, accept-ranges", "access-control-allow-methods": "GET, HEAD, OPTIONS" };

async function handleTiles(request: Request, url: URL, ctx: ExecutionContext) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const range = request.headers.get("range");
  const m = range?.match(/^bytes=(\d+)-(\d+)$/);
  if (!m || Number(m[2]) - Number(m[1]) > 32 * 1024 * 1024) {
    // Only bounded ranges are served (PMTiles never asks for the whole archive).
    const head = await fetch(BASEMAP, { method: "HEAD" });
    return new Response(null, { status: m ? 416 : 200, headers: { ...CORS, "accept-ranges": "bytes", "content-length": head.headers.get("content-length") ?? "0", etag: head.headers.get("etag") ?? "" } });
  }
  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(`${url.origin}/tiles/planet.pmtiles?r=${m[1]}-${m[2]}`);
  const hit = await cache.match(key);
  if (hit) {
    return new Response(hit.body, { status: 206, headers: { ...CORS, "content-type": "application/octet-stream", "content-range": hit.headers.get("x-content-range") ?? "", "cache-control": "public, max-age=86400", etag: hit.headers.get("etag") ?? "" } });
  }
  const upstream = await fetch(BASEMAP, { headers: { range: `bytes=${m[1]}-${m[2]}` } });
  if (upstream.status !== 206 && upstream.status !== 200) return new Response("Tiles unavailable", { status: 502, headers: CORS });
  const bytes = await upstream.arrayBuffer();
  const contentRange = upstream.headers.get("content-range") ?? `bytes ${m[1]}-${Number(m[1]) + bytes.byteLength - 1}/*`;
  const etag = upstream.headers.get("etag") ?? "";
  ctx.waitUntil(cache.put(key, new Response(bytes, { headers: { "content-type": "application/octet-stream", "cache-control": "public, max-age=604800", "x-content-range": contentRange, etag } })));
  return new Response(bytes, { status: 206, headers: { ...CORS, "content-type": "application/octet-stream", "content-range": contentRange, "content-length": String(bytes.byteLength), "cache-control": "public, max-age=86400", etag } });
}
