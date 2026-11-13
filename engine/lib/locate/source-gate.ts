// The source gate: JEV decides which stores a query needs before anything is shown.
//   features  things, records and places (Turbopuffer imagery, civic tables, OSM, footprints_nature)
//   areas     the places themselves, picked by their attributes (h3_hexagons, resolution 8)
//   trends    counts over time around a feature (the ledger)
// A query can need one, two or all three.

import { decide } from "./jev";

export type SourceGate = { features: number; areas: number; trends: number };

const RULES = [
  "You route queries for Outerview, a geographic search engine. Three stores can answer a query, alone or together.",
  "FEATURES: located things, records and places such as benches, potholes, restaurants, permits, crimes, collisions, trees or animals.",
  "AREAS: the land itself, divided into small hexagonal cells that carry place attributes (income, poverty, rent, home value, population, jobs, elevation, slope, flood zones, tree canopy, air quality, wildfire hazard, land cover, climate, travel time).",
  "TRENDS: a ledger of counts over time (by week, month and year) for a feature in a region.",
].join(" ");

const QUESTIONS = {
  features: {
    type: "noul",
    instructions:
      "Does the user want specific things, records or places located on the map? True for 'potholes in Austin', 'bakeries in wealthy areas of Chicago' (bakeries are the feature) and 'crimes near downtown'. False when the query names no thing at all and only describes what kind of area it wants, such as 'high income areas in New York City' or 'flood prone neighborhoods in Miami'.",
    criteria: { true: "The query names a thing, record or place to find.", false: "The query names no thing to find, only a kind of area or a trend." },
  },
  areas: {
    type: "noul",
    instructions:
      "Does the user want AREAS themselves returned: neighborhoods, zones, parts of a city or land chosen by an attribute of the place? True for 'high income areas in New York City', 'steep neighborhoods in Seattle', 'where is the tree canopy highest in Atlanta', 'low poverty areas with permits' (areas and a feature). False when a place attribute only narrows a named feature ('bakeries in wealthy areas': the user wants bakeries, not areas) and false when no attribute of the place is mentioned.",
    criteria: { true: "The user wants areas, neighborhoods or zones picked by a place attribute.", false: "The user wants things or trends, not areas." },
  },
  trends: {
    type: "noul",
    instructions:
      "Does the user ask how an amount changes over time, or for counts by period: trends, growth, decline, rising, falling, 'over time', 'per month', 'by year', 'this year versus last', 'how many permits were issued each month'? False for a plain lookup of where things are.",
    criteria: { true: "The user asks about change over time or counts by period.", false: "The user asks where things are, not how amounts change." },
  },
};

/** Asks JEV, then the OpenAI decision model. Null when neither answers: callers fall back to their own rules. */
export async function gateSources(query: string, timeoutMs = 3500): Promise<SourceGate | null> {
  const result = await decide(QUESTIONS, { rules: RULES, query }, timeoutMs).catch(() => null);
  const n = (key: string) => (typeof result?.answers[key]?.noul === "number" ? (result.answers[key].noul as number) : null);
  const [features, areas, trends] = [n("features"), n("areas"), n("trends")];
  if (features === null || areas === null || trends === null) return null;
  console.log(JSON.stringify({ event: "source_gate", provider: result?.provider, features: +features.toFixed(2), areas: +areas.toFixed(2), trends: +trends.toFixed(2) }));
  return { features, areas, trends };
}
