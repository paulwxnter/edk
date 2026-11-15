// Route: a path from A to B through Mapbox Directions, passing what the caller wants to see ("include a
// coffee shop") and steered around what they want to avoid ("avoid pothole streets"). The conditions go through the same engine as Discover: the
// source gate picks what to look for, the route's cities are reverse geocoded so the search knows where
// to look, and the matches that sit on the route are handed to Mapbox as points to exclude.
import { geocodeAddress } from "lib/locate/address-gate";
import { runSearch, SearchError, type Asker } from "./search";

const DIRECTIONS = "https://api.mapbox.com/directions/v5/mapbox";
const REVERSE = "https://api.mapbox.com/search/geocode/v6/reverse";
/** Mapbox accepts at most 50 excluded points, on the driving profile only. */
const MAX_EXCLUDE = 50;
/** How close to the path a match must be to count as "on the route". */
const ON_ROUTE_M = 40;
const ON_ROUTE_AREA_M = 450;
/** A match this close to either end cannot be avoided: it is where the trip starts or ends. */
const ENDPOINT_M = 80;
const MATCHES_PER_SEARCH = 200;
const SEARCHBOX = "https://api.mapbox.com/search/searchbox/v1/forward";
const MAX_ROUNDS = 3;
/** Places to pass are picked from those this close to the direct path, and at most this many. */
const DETOUR_M: Record<string, number> = { driving: 1500, cycling: 800, walking: 400 };
const MAX_VIA = 3;

export const ROUTE_PROFILES = ["driving", "walking", "cycling"] as const;
export type RouteProfile = (typeof ROUTE_PROFILES)[number];
type LngLat = [number, number];
type Stop = { lat: number; lng: number; label?: string };
type Hazard = { lat: number; lng: number; name: string; kind: "location" | "area" };
/** A match and the spot on the road to close: the point of the path nearest to it. */
type Block = { hazard: Hazard; at: LngLat };
type Leg = { distance_m: number; duration_s: number; geometry: { type: "LineString"; coordinates: LngLat[] }; steps: { instruction: string; name: string; distance_m: number; duration_s: number }[] };

export type RouteInput = { from: unknown; to: unknown; conditions: string; include: string; profile: RouteProfile };

const token = () => process.env.MAPBOX_API_KEY || process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
const validPoint = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

export function parseRouteInput(body: any): RouteInput {
  const from = body?.from ?? body?.origin ?? body?.a;
  const to = body?.to ?? body?.destination ?? body?.b;
  if (from == null || from === "" || to == null || to === "") throw new SearchError('Give a start and an end: {"from": "Point State Park, Pittsburgh", "to": [-79.9436, 40.4433]}.', 400);
  const conditions = typeof body?.conditions === "string" ? body.conditions.trim().slice(0, 300) : typeof body?.avoid === "string" ? body.avoid.trim().slice(0, 300) : "";
  const include = typeof body?.include === "string" ? body.include.trim().slice(0, 300) : typeof body?.via === "string" ? body.via.trim().slice(0, 300) : "";
  const profile = ROUTE_PROFILES.includes(body?.profile) ? (body.profile as RouteProfile) : "driving";
  return { from, to, conditions, include, profile };
}

/** A named place or address to coordinates. Landmarks and businesses first, then plain addresses. */
async function placeNamed(text: string, near?: LngLat | null): Promise<Stop | null> {
  const url = new URL(SEARCHBOX);
  url.searchParams.set("q", text);
  url.searchParams.set("limit", "1");
  if (near) url.searchParams.set("proximity", `${near[0]},${near[1]}`);
  url.searchParams.set("access_token", token());
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) }).catch(() => null);
  const f = res?.ok ? ((await res.json().catch(() => null)) as any)?.features?.[0] : null;
  const [lng, lat] = f?.geometry?.coordinates ?? [];
  if (validPoint(lat, lng)) {
    const p = f.properties ?? {};
    return { lat, lng, label: [p.name, p.place_formatted].filter(Boolean).join(", ") || p.full_address || text };
  }
  const hit = await geocodeAddress(text, near).catch(() => null);
  return hit ? { lat: hit.lat, lng: hit.lng, label: hit.address || hit.label } : null;
}

/** A stop given as [lng, lat], {lat, lng}, "lat, lng", or a place name or address. */
async function resolveStop(value: unknown, which: string, near?: LngLat | null): Promise<Stop> {
  if (Array.isArray(value) && value.length >= 2) {
    const [lng, lat] = [Number(value[0]), Number(value[1])];
    if (validPoint(lat, lng)) return { lat, lng };
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const v = value as any;
    const [lat, lng] = [Number(v.lat ?? v.latitude), Number(v.lng ?? v.lon ?? v.longitude)];
    if (validPoint(lat, lng)) return { lat, lng, ...(typeof v.label === "string" ? { label: v.label.slice(0, 120) } : {}) };
  }
  if (typeof value === "string") {
    const text = value.trim().slice(0, 200);
    const m = text.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (m && validPoint(Number(m[1]), Number(m[2]))) return { lat: Number(m[1]), lng: Number(m[2]) };
    if (text.length >= 3) {
      const hit = await placeNamed(text, near);
      if (hit) return hit;
    }
  }
  throw new SearchError(`Could not place the ${which} of the route. Give coordinates as [lng, lat], or a clearer name or address.`, 400);
}

async function directions(profile: RouteProfile, a: Stop, b: Stop, exclude: LngLat[], via: { lat: number; lng: number }[] = []): Promise<Leg | null> {
  const points = [a, ...via, b].map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
  const url = new URL(`${DIRECTIONS}/${profile}/${points}`);
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("overview", "full");
  url.searchParams.set("steps", "true");
  if (exclude.length) url.searchParams.set("exclude", exclude.map(([lng, lat]) => `point(${lng.toFixed(6)} ${lat.toFixed(6)})`).join(","));
  url.searchParams.set("access_token", token());
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  const body = (await res.json().catch(() => null)) as any;
  const route = body?.routes?.[0];
  if (!res.ok || !route?.geometry?.coordinates?.length) {
    if (res.status === 401 || res.status === 403) throw new SearchError("Routing is not configured.", 502);
    return null;
  }
  const steps = (route.legs ?? []).flatMap((leg: any) => leg.steps ?? []).map((s: any) => ({ instruction: String(s.maneuver?.instruction || ""), name: String(s.name || ""), distance_m: Math.round(s.distance || 0), duration_s: Math.round(s.duration || 0) }));
  return { distance_m: Math.round(route.distance), duration_s: Math.round(route.duration), geometry: { type: "LineString", coordinates: route.geometry.coordinates }, steps };
}

/** The city (or nearest named place) at a point, as "Pittsburgh, Pennsylvania". */
async function cityAt(lng: number, lat: number): Promise<string | null> {
  const url = new URL(REVERSE);
  url.searchParams.set("longitude", String(lng));
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("types", "place,locality");
  url.searchParams.set("limit", "1");
  url.searchParams.set("access_token", token());
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) }).catch(() => null);
  if (!res?.ok) return null;
  const p = ((await res.json().catch(() => null)) as any)?.features?.[0]?.properties;
  const name = p?.context?.place?.name || p?.name;
  if (!name) return null;
  const region = p?.context?.region?.name;
  return region && region !== name ? `${name}, ${region}` : String(name);
}

/** The point of a path nearest to a place, and how far away it is, on a flat projection good enough at city scale. */
function nearestOnPath(lng: number, lat: number, path: LngLat[]): { metres: number; at: LngLat; index: number } {
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110_540;
  let best = Infinity;
  let at: LngLat = path[0];
  let index = 0;
  for (let i = 1; i < path.length; i++) {
    const ax = (path[i - 1][0] - lng) * kx, ay = (path[i - 1][1] - lat) * ky;
    const bx = (path[i][0] - lng) * kx, by = (path[i][1] - lat) * ky;
    const dx = bx - ax, dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best) {
      best = d;
      at = [path[i - 1][0] + t * (path[i][0] - path[i - 1][0]), path[i - 1][1] + t * (path[i][1] - path[i - 1][1])];
      index = i - 1 + t;
    }
  }
  return { metres: best, at, index };
}
const metresToPath = (lng: number, lat: number, path: LngLat[]) => nearestOnPath(lng, lat, path).metres;
const metresBetween = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => Math.hypot((a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 110_540);

/** "avoid pothole streets" → "pothole streets": the thing to find, without the instruction around it. */
const subjectOf = (conditions: string) =>
  conditions
    .replace(/^\s*(please\s+)?(try to\s+)?(avoid(ing)?|without|no|skip(ping)?|stay(ing)? away from|steer(ing)? clear of|route around|go(ing)? around|keep(ing)? (away from|off))\s+/i, "")
    .replace(/\s+(please|if possible)\s*$/i, "")
    .trim() || conditions;

/** "include a coffee shop" → "a coffee shop": the thing to pass, without the instruction around it. */
const placeOf = (include: string) =>
  include
    .replace(/^\s*(please\s+)?(include|including|pass(ing)?( by)?|go(ing)? (past|by|through)|stop(ping)? (at|by)|via|see(ing)?|visit(ing)?|with)\s+/i, "")
    .replace(/\s+(on the way|along the way|please|if possible)\s*$/i, "")
    .trim() || include;

/** How many stops "include" asks for: "a coffee shop" is one, "two parks" two, "scenic overlooks" a few. */
function stopsWanted(subject: string) {
  const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, some: MAX_VIA, few: MAX_VIA };
  const first = subject.toLowerCase().match(/^(\d+|[a-z]+)\b/)?.[1] ?? "";
  if (/^\d+$/.test(first)) return Math.max(1, Math.min(MAX_VIA, Number(first)));
  if (first in words) return words[first];
  return /s$/i.test(subject.trim().split(/\s+/).pop() ?? "") ? MAX_VIA : 1;
}

/** Everything along the route and in its cities that meets the conditions, as points. */
async function findHazards(subject: string, path: LngLat[], asker: Asker): Promise<{ hazards: Hazard[]; cities: string[]; labels: string[] }> {
  const probes = [path[0], path[Math.floor(path.length / 2)], path[path.length - 1]];
  const cities = Array.from(new Set((await Promise.all(probes.map(([lng, lat]) => cityAt(lng, lat)))).filter((c): c is string => Boolean(c))));
  // Two looks: each city along the way by name, and the ground right under the path (four spots along it).
  const along = [0.15, 0.4, 0.6, 0.85].map((t) => path[Math.min(path.length - 1, Math.floor(path.length * t))]);
  const runs = await Promise.all([
    ...cities.map((city) => runSearch({ query: `${subject} in ${city}`, limit: MATCHES_PER_SEARCH, answer: false }, asker, "edk:route").catch(() => null)),
    runSearch({ query: subject, areas: along, limit: MATCHES_PER_SEARCH, answer: false }, asker, "edk:route").catch(() => null),
  ]);
  const seen = new Set<string>();
  const hazards: Hazard[] = [];
  const labels = new Set<string>();
  for (const run of runs) {
    for (const a of (run as any)?.filters?.applied ?? []) if (a?.label) labels.add(String(a.label));
    for (const f of run?.geojson.features ?? []) {
      const [lng, lat] = f?.geometry?.coordinates ?? [];
      if (!validPoint(lat, lng)) continue;
      const key = `${lng.toFixed(5)},${lat.toFixed(5)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const p = f.properties ?? {};
      if (p.feature_name) labels.add(String(p.feature_name));
      hazards.push({ lat, lng, name: String(p.feature_name || p.name || p.address || "Match"), kind: p.kind === "area" ? "area" : "location" });
    }
  }
  return { hazards, cities, labels: Array.from(labels).slice(0, 6) };
}

const onRoute = (h: Hazard, path: LngLat[]) => metresToPath(h.lng, h.lat, path) <= (h.kind === "area" ? ON_ROUTE_AREA_M : ON_ROUTE_M);

const stripLeg = (leg: Leg) => ({ distance_m: leg.distance_m, duration_s: leg.duration_s, geometry: leg.geometry, steps: leg.steps });

export async function runRoute(input: RouteInput, asker: Asker) {
  if (!token()) throw new SearchError("Routing is not configured.", 502);
  const from = await resolveStop(input.from, "start");
  const to = await resolveStop(input.to, "end", [from.lng, from.lat]);
  if (metresBetween(from, to) < 5) throw new SearchError("The start and end are the same place.", 400);
  const direct = await directions(input.profile, from, to, []);
  if (!direct) throw new SearchError("No route was found between those two places.", 404);
  const base = { from, to, profile: input.profile };
  if (!input.conditions && !input.include) return { ...base, route: direct, avoided: [] as Hazard[], included: [] as Hazard[] };

  const path0 = direct.geometry.coordinates;
  const avoidSubject = input.conditions ? subjectOf(input.conditions) : "";
  const passSubject = input.include ? placeOf(input.include) : "";
  // Both searches look along the direct path, at the same time.
  const [found, wanted] = await Promise.all([
    avoidSubject ? findHazards(avoidSubject, path0, asker) : null,
    passSubject ? findHazards(passSubject, path0, asker) : null,
  ]);
  const notes: string[] = [];

  // Include: the best few matches near the direct path, visited in the order the path reaches them.
  let via: Hazard[] = [];
  if (wanted) {
    const reach = DETOUR_M[input.profile] ?? 1500;
    const near = wanted.hazards
      .filter((h) => metresBetween(h, from) > ENDPOINT_M && metresBetween(h, to) > ENDPOINT_M)
      .map((h) => ({ h, ...nearestOnPath(h.lng, h.lat, path0) }))
      .filter((x) => x.metres <= reach)
      .sort((x, y) => x.metres - y.metres);
    // Spread the picks out: skip a match too close to one already picked.
    const picked: typeof near = [];
    const want = stopsWanted(passSubject);
    for (const x of near) {
      if (picked.length >= want) break;
      if (picked.some((p) => metresBetween(p.h, x.h) < 300)) continue;
      picked.push(x);
    }
    via = picked.sort((x, y) => x.index - y.index).map((x) => x.h);
    if (!wanted.hazards.length) notes.push(`Nothing matching "${passSubject}" is known along the way.`);
    else if (!via.length) notes.push(`Nothing matching "${passSubject}" is close enough to the route to pass.`);
  }

  let route = direct;
  if (via.length) {
    const passing = await directions(input.profile, from, to, [], via);
    if (passing) route = passing;
    else {
      notes.push(`The route could not be made to pass ${passSubject}.`);
      via = [];
    }
  }

  // Avoid: close the road where each match sits on the path, re-route, and repeat while the new path runs into more.
  let blocks: Block[] = [];
  const steerable = input.profile === "driving";
  if (found) {
    const avoidable = found.hazards.filter((h) => metresBetween(h, from) > ENDPOINT_M && metresBetween(h, to) > ENDPOINT_M && !via.some((v) => metresBetween(v, h) < ENDPOINT_M));
    if (!found.hazards.length) notes.push(found.cities.length ? `Nothing matching "${avoidSubject}" is known in ${found.cities.join(" or ")}.` : "The route's cities could not be named, so nothing was avoided.");
    else if (!steerable) notes.push(`Avoiding steers driving routes only. This ${input.profile} route does not avoid ${avoidSubject}.`);
    else {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const path = route.geometry.coordinates;
        const hits = avoidable.filter((h) => onRoute(h, path)).map((hazard) => ({ hazard, at: nearestOnPath(hazard.lng, hazard.lat, path).at }));
        // A closure next to either end would cut the trip off before it starts.
        const fresh = hits.filter((b) => metresBetween({ lng: b.at[0], lat: b.at[1] }, from) > ENDPOINT_M && metresBetween({ lng: b.at[0], lat: b.at[1] }, to) > ENDPOINT_M);
        if (!fresh.length) break;
        const next = [...blocks, ...fresh].slice(0, MAX_EXCLUDE);
        const attempt = await directions(input.profile, from, to, next.map((b) => b.at), via);
        if (!attempt) {
          notes.push(blocks.length ? "Some matches could not be avoided without cutting the trip off." : `There is no way around ${avoidSubject} on this route.`);
          break;
        }
        route = attempt;
        blocks = next;
        if (next.length >= MAX_EXCLUDE) break;
      }
    }
  }
  const excluded = Array.from(new Set(blocks.map((b) => b.hazard)));
  // What the final path really misses, and what it still passes.
  const avoided = excluded.filter((h) => !onRoute(h, route.geometry.coordinates));
  const remaining = found ? found.hazards.filter((h) => onRoute(h, route.geometry.coordinates)).length : 0;
  if (found?.hazards.length && steerable && !excluded.length && !remaining) notes.push(`Nothing matching "${avoidSubject}" is on the direct route.`);
  else if (remaining) notes.push(`${remaining} match${remaining === 1 ? "" : "es"} could not be avoided on this route.`);

  return {
    ...base,
    ...(found ? { conditions: { text: input.conditions, looked_for: found.labels.length ? found.labels : [avoidSubject], cities: found.cities, matches: found.hazards.length } } : {}),
    ...(wanted ? { include: { text: input.include, looked_for: wanted.labels.length ? wanted.labels : [passSubject], cities: wanted.cities, matches: wanted.hazards.length } } : {}),
    route,
    // The plain route, whenever what was asked for changed the path, so the two can be compared.
    ...(route !== direct ? { direct: stripLeg(direct) } : {}),
    avoided,
    included: via,
    ...(found ? { remaining } : {}),
    ...(notes.length ? { note: notes.join(" ") } : {}),
  };
}

export type RouteData = Awaited<ReturnType<typeof runRoute>>;
