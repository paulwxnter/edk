// The address gate: before a search runs, JEV decides whether the query contains street addresses
// that must be turned into coordinates. When it does, Luna separates out each address, Mapbox
// geocodes them, and the search runs around those points (like areas picked on the map).
import { decide } from "./jev";

export type GeocodedAddress = { address: string; label: string; lng: number; lat: number; exact: boolean };

const MAX_ADDRESSES = 4;

// Cheap pre-check so most queries ("potholes in Austin") never pay for the gate: a house number,
// a street word, a postcode or the word "address".
const MAYBE_ADDRESS = /\b\d{1,6}\s+[a-z0-9]|\b(street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|drive|dr\.?|lane|ln\.?|way|court|ct\.?|place|pl\.?|parkway|pkwy|highway|hwy|terrace|square|plaza)\b|\b\d{5}(-\d{4})?\b|\baddress(es)?\b/i;

const QUESTIONS = {
  addresses: {
    type: "noul",
    instructions:
      "Does the query contain one or more specific street addresses (a house or building number with a street, optionally a city or postcode) that must be geocoded into coordinates before searching? True for 'permits near 1600 Pennsylvania Ave NW, Washington DC', 'crimes around 350 5th Ave and 1 World Trade Center', 'what is near 221B Baker Street'. False for a plain city, state, neighborhood or country ('potholes in Austin'), a street with no number ('restaurants on Main Street'), and for numbers that are counts, years or amounts ('top 10 parks', 'permits in 2023', 'income over $150k').",
    criteria: { true: "The query names at least one specific street address to geocode.", false: "The query names no specific street address." },
  },
};

const LUNA_SYSTEM = [
  "You are Luna, the address extractor of a geographic search engine.",
  'Return JSON only, in this shape: {"addresses": string[]}.',
  `List every specific street address in the user's query, at most ${MAX_ADDRESSES}, in the order they appear.`,
  "Copy each address as written, completed with the city, state or postcode the query gives for it (an address followed by 'in Austin' gets ', Austin').",
  "Leave out everything that is not an address: the things being searched for, plain place names without a street number, years and counts.",
  'If there is no address, return {"addresses": []}.',
].join(" ");

/** Asks JEV whether the query needs geocoding. Null when no decision model answers. */
async function needsGeocoding(query: string) {
  const result = await decide(QUESTIONS, { rules: "Decide whether this geographic search query contains street addresses that need geocoding.", query }, 3000).catch(() => null);
  const p = result?.answers.addresses?.noul;
  return typeof p === "number" ? p : null;
}

/** Luna separates the addresses out of the query. */
async function extractAddresses(query: string): Promise<string[]> {
  const key = process.env.OPENAI_API_KEY || process.env.OPEN_AI_KEY;
  if (!key) return [];
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({
      model: process.env.LUNA_MODEL || "gpt-5.6-luna",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: LUNA_SYSTEM },
        { role: "user", content: query },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Address extraction failed (${response.status}).`);
  const value = (await response.json() as any);
  let parsed: any = {};
  try {
    parsed = JSON.parse(String(value?.choices?.[0]?.message?.content || "{}"));
  } catch {
    return [];
  }
  const list = Array.isArray(parsed?.addresses) ? parsed.addresses : [];
  return Array.from(new Set(list.filter((a: unknown): a is string => typeof a === "string").map((a: string) => a.trim().slice(0, 200)).filter((a: string) => a.length >= 4))).slice(0, MAX_ADDRESSES) as string[];
}

/** One address to coordinates through Mapbox. `near` biases the match toward the region in focus. */
export async function geocodeAddress(address: string, near?: [number, number] | null): Promise<GeocodedAddress | null> {
  const token = process.env.MAPBOX_API_KEY || process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return null;
  const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
  url.searchParams.set("q", address);
  url.searchParams.set("limit", "1");
  url.searchParams.set("types", "address,street,postcode,place,locality,neighborhood");
  if (near && near.every(Number.isFinite)) url.searchParams.set("proximity", `${near[0]},${near[1]}`);
  url.searchParams.set("access_token", token);
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`Geocoding failed (${res.status}).`);
  const f = ((await res.json() as any))?.features?.[0];
  const [lng, lat] = f?.geometry?.coordinates ?? [];
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const p = f.properties ?? {};
  return { address: p.full_address || address, label: p.name_preferred || p.name || address, lng, lat, exact: p.feature_type === "address" };
}

/**
 * The whole gate: JEV → Luna → Mapbox. Returns the geocoded addresses (empty when the query has
 * none, or when any step cannot answer: the search then runs as it would have).
 */
export async function gateAddresses(query: string, near?: [number, number] | null): Promise<{ asked: boolean; probability: number | null; addresses: GeocodedAddress[] }> {
  if (!MAYBE_ADDRESS.test(query)) return { asked: false, probability: null, addresses: [] };
  const probability = await needsGeocoding(query);
  if (probability === null || probability < 0.5) return { asked: true, probability, addresses: [] };
  const found = await extractAddresses(query).catch((e) => {
    console.error("[address-gate] extract failed", e instanceof Error ? e.message : e);
    return [] as string[];
  });
  const geocoded = await Promise.all(found.map((a) => geocodeAddress(a, near).catch(() => null)));
  const addresses = geocoded.filter((g): g is GeocodedAddress => Boolean(g));
  console.log(JSON.stringify({ event: "address_gate", probability: +probability.toFixed(2), extracted: found.length, geocoded: addresses.length }));
  return { asked: true, probability, addresses };
}
