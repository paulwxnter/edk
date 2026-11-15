import { createRequestHandler } from "react-router";
import { withDb } from "lib/locate/e2-db";
import { api } from "../server/api";
import { handleCdn } from "../server/cdn";
import { getAuth, getSessionUser } from "../server/auth";
import { billedDetect, billedDiscover, billedInspect, billedRoute, BillingError, SearchError, VisionError, type Caller } from "../server/billed";
import { LookupError } from "../server/lookups";
import { verifyEmbedToken } from "../server/embed";
import { listArtifacts } from "lib/lens-server";
import { runDueMonitors } from "../server/monitor";
import { blockedCountry, limitAuth, limitSignups, verifyTurnstile } from "../server/guard";

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

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

function errorResponse(error: unknown) {
	if (error instanceof BillingError || error instanceof SearchError || error instanceof LookupError || error instanceof VisionError) return json({ error: error.message }, error.status);
	console.error("[edk] failed", error instanceof Error ? error.message : error);
	return json({ error: "EDK is temporarily unavailable. Please try again." }, 502);
}

/** Which surface a request is for. */
function surface(url: URL): "api" | "cdn" | "embed" | "www" | "site" {
	const host = url.hostname;
	if (host.startsWith("api.")) return "api";
	if (host.startsWith("cdn.")) return "cdn";
	if (host.startsWith("embed.")) return "embed";
	if (host.startsWith("www.")) return "www";
	return "site";
}

/** Who pays for an Atlas call: the signed-in user (console), the key owner (embed token), or nobody (public). */
async function atlasCaller(request: Request, env: Env, body: any, consoleUser: boolean): Promise<Caller | null | "unauthorized" | "revoked"> {
	if (consoleUser) {
		const user = await getSessionUser(env.DB, request);
		if (!user) return "unauthorized";
		return { userId: user.id, keyId: null, source: body?.source === "playground" ? "playground" : "atlas" };
	}
	const embed = verifyEmbedToken(body?.token);
	if (!embed) return null;
	const key = await env.DB.prepare("select revoked_at from api_keys where id = ?").bind(embed.keyId).first<{ revoked_at: number | null }>();
	if (!key || key.revoked_at) return "revoked";
	return { userId: embed.userId, keyId: embed.keyId, source: "embed" };
}

async function atlasCall(request: Request, env: Env, kind: "discover" | "inspect" | "route" | "detect", consoleUser: boolean) {
	const body = (await request.json().catch(() => null)) as any;
	if (!body) return json({ error: "Send a JSON body." }, 400);
	try {
		const caller = await atlasCaller(request, env, body, consoleUser);
		if (caller === "unauthorized") return json({ error: "Sign in to use EDK." }, 401);
		if (caller === "revoked") return json({ error: "This embed key was revoked." }, 401);
		if (caller) {
			const timeZone = (request as any).cf?.timezone;
			if (kind === "route") return json(await billedRoute(env.DB, caller, body, { timeZone }));
			if (kind === "detect") return json(await billedDetect(env.DB, caller, body));
			return json(kind === "discover" ? await billedDiscover(env.DB, caller, body, { timeZone }) : await billedInspect(env.DB, caller, body.lat, body.lng));
		}
		// Maps on other sites need an embed key; there are no anonymous calls.
		return json({ error: "This map needs an embed key. Create one in Console → Embeds." }, 401);
	} catch (error) {
		return errorResponse(error);
	}
}

/** The Lens list: things EDK-1 can find, by name. Public and cached. */
async function lenses(url: URL) {
	try {
		const list = await listArtifacts({ q: (url.searchParams.get("q") || "").slice(0, 80) });
		return new Response(JSON.stringify({ lenses: list.slice(0, 80).map((a) => ({ id: a.id, name: a.name, description: a.description, kind: a.kind })) }), {
			headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=600" },
		});
	} catch (error) {
		return errorResponse(error);
	}
}

/** Better Auth, behind the auth rate limit; sign-up also needs Turnstile and is capped per IP per hour. */
async function authCall(request: Request, env: Env, url: URL) {
	const limited = await limitAuth(env, request);
	if (limited) return limited;
	if (request.method === "POST" && url.pathname === "/api/auth/sign-up/email") {
		const blocked = (await verifyTurnstile(request)) ?? (await limitSignups(env.DB, request));
		if (blocked) return blocked;
	}
	return getAuth(env.DB).handler(request);
}

/** Product analytics through edk.earth/_t/…: events go on to PostHog (US), its script from its asset host (cached). */
async function posthogRelay(request: Request, url: URL, ctx: ExecutionContext) {
	const path = url.pathname.slice(3);
	const isAsset = path.startsWith("/static/") || path.startsWith("/array/");
	const target = new URL(path + url.search, isAsset ? "https://us-assets.i.posthog.com" : "https://us.i.posthog.com");
	if (isAsset) {
		const cache = (caches as unknown as { default: Cache }).default;
		const hit = await cache.match(request);
		if (hit) return hit;
		const res = await fetch(target, { headers: { accept: request.headers.get("accept") ?? "*/*" } });
		if (res.ok) ctx.waitUntil(cache.put(request, res.clone()));
		return res;
	}
	const headers = new Headers(request.headers);
	headers.delete("cookie");
	headers.delete("host");
	const ip = request.headers.get("cf-connecting-ip");
	if (ip) headers.set("x-forwarded-for", ip);
	return fetch(target, { method: request.method, headers, body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body });
}

async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const url = new URL(request.url);
	const where = surface(url);
	const post = request.method === "POST";
	if (blockedCountry(request)) return json({ error: "EDK is not available in your region." }, 451);
	if (where === "www") return Response.redirect(`https://edk.earth${url.pathname}${url.search}`, 301);
	if (where === "api") return api.fetch(request, env, ctx);
	if (where === "cdn") return handleCdn(request, ctx);
	if (where === "embed") {
		if (post && (url.pathname === "/discover" || url.pathname === "/search")) return atlasCall(request, env, "discover", false);
		if (post && url.pathname === "/inspect") return atlasCall(request, env, "inspect", false);
		if (post && url.pathname === "/route") return atlasCall(request, env, "route", false);
		if (url.pathname === "/lenses") return lenses(url);
		// The embed host serves only the Atlas ("/") and stored results ("/r/:id") plus assets.
		const allowed = url.pathname === "/" || url.pathname.startsWith("/r/") || url.pathname.startsWith("/assets/") || url.pathname.startsWith("/__manifest") || url.pathname.endsWith(".data") || /\.(svg|png|ico|txt)$/.test(url.pathname);
		if (!allowed) return Response.redirect(`https://edk.earth${url.pathname}${url.search}`, 302);
	}
	if (where === "site") {
		if (url.pathname.startsWith("/api/auth/")) return authCall(request, env, url);
		if (url.pathname.startsWith("/_t/")) return posthogRelay(request, url, ctx);
		// Console (billed to the signed-in user) and the public Atlas.
		if (post && (url.pathname === "/console/api/discover" || url.pathname === "/console/api/search")) return atlasCall(request, env, "discover", true);
		if (post && url.pathname === "/console/api/inspect") return atlasCall(request, env, "inspect", true);
		if (post && url.pathname === "/console/api/route") return atlasCall(request, env, "route", true);
		if (post && url.pathname === "/console/api/detect") return atlasCall(request, env, "detect", true);
		if (post && url.pathname === "/atlas/api/route") return atlasCall(request, env, "route", true);
		if (url.pathname === "/atlas/api/lenses") return lenses(url);
		// The Atlas on edk.earth needs an account, and is billed to it like the console.
		if (post && (url.pathname === "/atlas/api/discover" || url.pathname === "/atlas/api/search")) return atlasCall(request, env, "discover", true);
		if (post && url.pathname === "/atlas/api/inspect") return atlasCall(request, env, "inspect", true);
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
	// Every five minutes: run the monitors that are due.
	scheduled(_controller, env, ctx) {
		ctx.waitUntil(withDb(() => runDueMonitors(env.DB), (p) => ctx.waitUntil(p)));
	},
} satisfies ExportedHandler<Env>;
