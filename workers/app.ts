import { createRequestHandler } from "react-router";
import { withDb } from "lib/locate/e2-db";
import { api } from "../server/api";
import { handleCdn } from "../server/cdn";
import { getAuth, getSessionUser } from "../server/auth";
import { assertCanSpend, billedSearch, BillingError, chargeSimple, freeSearch, SearchError, type Caller } from "../server/billed";
import { inspect, LookupError } from "../server/lookups";
import { verifyEmbedToken } from "../server/embed";
import { takeAnonSearch } from "../server/store";

declare module "react-router" {
	export interface AppLoadContext {
		cloudflare: {
			env: Env;
			ctx: ExecutionContext;
		};
	}
}

const requestHandler = createRequestHandler(
	() => import("virtual:react-router/server-build"),
	import.meta.env.MODE,
);

/** Free map: searches per IP per day, and results per search, without an account. */
const FREE_MAP_SEARCHES = 20;
const FREE_MAP_LIMIT = 15;
/** Free Atlas: area inspections per IP per day. */
const FREE_INSPECTS = 300;

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

function errorResponse(error: unknown) {
	if (error instanceof BillingError || error instanceof SearchError || error instanceof LookupError) return json({ error: error.message }, error.status);
	console.error("[search] failed", error instanceof Error ? error.message : error);
	return json({ error: "Search is temporarily unavailable. Please try again." }, 502);
}

/** Which surface a request is for. Local development uses ?host= or a path prefix. */
function surface(url: URL): "api" | "cdn" | "embed" | "www" | "site" {
	const host = url.hostname;
	if (host.startsWith("api.")) return "api";
	if (host.startsWith("cdn.")) return "cdn";
	if (host.startsWith("embed.")) return "embed";
	if (host.startsWith("www.")) return "www";
	return "site";
}

/** POST /search on embed.edk.earth: embed-token searches (billed to the key's owner) or free map searches. */
async function embedSearch(request: Request, env: Env) {
	const body = (await request.json().catch(() => null)) as any;
	if (!body) return json({ error: "Send a JSON body." }, 400);
	try {
		const embed = verifyEmbedToken(body.token);
		if (embed) {
			const key = await env.DB.prepare("select revoked_at from api_keys where id = ?").bind(embed.keyId).first<{ revoked_at: number | null }>();
			if (!key || key.revoked_at) return json({ error: "This embed key was revoked." }, 401);
			return json(await billedSearch(env.DB, { userId: embed.userId, keyId: embed.keyId, source: "embed" }, body));
		}
		const ip = request.headers.get("cf-connecting-ip") || "local";
		if (!(await takeAnonSearch(env.DB, ip, FREE_MAP_SEARCHES))) {
			return json({ error: `The free Atlas allows ${FREE_MAP_SEARCHES} searches a day. Sign up at edk.earth for 500 free CU and the API.` }, 429);
		}
		return json(await freeSearch(env.DB, body, FREE_MAP_LIMIT));
	} catch (error) {
		return errorResponse(error);
	}
}

/**
 * Atlas inspect (click on the map): what is known about the area under a point. Billed in the console
 * and in keyed embeds (one location when something is known); free and rate-limited on the public Atlas.
 */
async function atlasInspect(request: Request, env: Env, consoleUser: boolean) {
	const body = (await request.json().catch(() => null)) as any;
	if (!body) return json({ error: "Send a JSON body." }, 400);
	try {
		let caller: Caller | null = null;
		if (consoleUser) {
			const user = await getSessionUser(env.DB, request);
			if (!user) return json({ error: "Sign in to use the Atlas." }, 401);
			caller = { userId: user.id, keyId: null, source: "atlas" };
		} else {
			const embed = verifyEmbedToken(body.token);
			if (embed) caller = { userId: embed.userId, keyId: embed.keyId, source: "embed" };
		}
		if (caller) {
			await assertCanSpend(env.DB, caller);
			const data = await inspect(body.lat, body.lng);
			const usage = await chargeSimple(env.DB, caller, "inspect", data.known ? 1 : 0, `${body.lat},${body.lng}`);
			return json({ usage, data });
		}
		const ip = request.headers.get("cf-connecting-ip") || "local";
		if (!(await takeAnonSearch(env.DB, `inspect:${ip}`, FREE_INSPECTS))) return json({ error: "That is a lot of exploring for one day. Sign up at edk.earth to keep going." }, 429);
		return json({ usage: { locations: 0, areas: 0, cu: 0 }, data: await inspect(body.lat, body.lng) });
	} catch (error) {
		return errorResponse(error);
	}
}

/** POST /console/api/search: the console playground, billed to the signed-in user. */
async function playgroundSearch(request: Request, env: Env) {
	const user = await getSessionUser(env.DB, request);
	if (!user) return json({ error: "Sign in to use the playground." }, 401);
	const body = await request.json().catch(() => null);
	if (!body) return json({ error: "Send a JSON body." }, 400);
	try {
		return json(await billedSearch(env.DB, { userId: user.id, keyId: null, source: (body as any).source === "atlas" ? "atlas" : "playground" }, body, { timeZone: (request as any).cf?.timezone }));
	} catch (error) {
		return errorResponse(error);
	}
}

async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const url = new URL(request.url);
	const where = surface(url);
	if (where === "www") return Response.redirect(`https://edk.earth${url.pathname}${url.search}`, 301);
	if (where === "api") return api.fetch(request, env, ctx);
	if (where === "cdn") return handleCdn(request, ctx);
	if (where === "embed") {
		if (request.method === "POST" && url.pathname === "/search") return embedSearch(request, env);
		if (request.method === "POST" && url.pathname === "/inspect") return atlasInspect(request, env, false);
		// The embed host serves only the map ("/") and stored results ("/r/:id") plus assets.
		const allowed = url.pathname === "/" || url.pathname.startsWith("/r/") || url.pathname.startsWith("/assets/") || url.pathname.startsWith("/__manifest") || url.pathname.endsWith(".data") || /\.(svg|png|ico|txt)$/.test(url.pathname);
		if (!allowed) return Response.redirect(`https://edk.earth${url.pathname}${url.search}`, 302);
	}
	if (where === "site") {
		if (url.pathname.startsWith("/api/auth/")) return getAuth(env.DB).handler(request);
		if (request.method === "POST" && url.pathname === "/console/api/search") return playgroundSearch(request, env);
		if (request.method === "POST" && url.pathname === "/console/api/inspect") return atlasInspect(request, env, true);
		// The public Atlas on edk.earth/atlas.
		if (request.method === "POST" && (url.pathname === "/atlas/api/search" || url.pathname === "/_embed/search")) return embedSearch(request, env);
		if (request.method === "POST" && url.pathname === "/atlas/api/inspect") return atlasInspect(request, env, false);
		// Local development: /_api/… and /_cdn/… reach the API and CDN on one origin.
		if (url.pathname.startsWith("/_api/")) return api.fetch(new Request(new URL(url.pathname.slice(5) + url.search, url.origin), request), env, ctx);
		if (url.pathname.startsWith("/_cdn/")) return handleCdn(new Request(new URL(url.pathname.slice(5) + url.search, url.origin), request), ctx);
	}
	return requestHandler(request, { cloudflare: { env, ctx } });
}

export default {
	fetch(request, env, ctx) {
		return withDb(() => handle(request, env, ctx), (p) => ctx.waitUntil(p));
	},
} satisfies ExportedHandler<Env>;
