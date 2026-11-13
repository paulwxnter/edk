// The attribute gate: JEV decides, in two passes, whether a Find query filters on place attributes
// and with what values. JEV answers typed questions: `noul` (probability 0–1) and `choice` (one of
// the given criteria). Every question below carries its own instructions so JEV can answer it alone.
import { ATTRIBUTES, ATTRIBUTE_BY_KEY, GROUPS, MAX_ATTRIBUTE_FILTERS, formatNumber, type AttributeDef, type EnumValue } from "./catalog";
import { normalizeFilters, type AttributeFilter } from "./compile";
import { liveValues } from "./values";
import { decide, type DecisionAttempt } from "../jev";

type JevAnswer = { choice?: string; noul?: number };
export type GateAttempt = { gate: "intent" | "values" | "timeframe"; provider: "jev" | "gateway_jev" | "openai_decision"; status: "ok" | "error"; duration_ms: number; questions: number; error?: string };

const INTENT_THRESHOLD = 0.6;
const ANY_THRESHOLD = 0.5;

const RULES = [
  "You are the attribute gate of EDK Find, a search engine over street-level images of the physical world.",
  "Every image carries place attributes (terrain, flood hazard, water, climate, air quality, sun, wind, settlement, land cover, soil, demographics, jobs, ecology, geology, wildfire hazard, pollution, travel time, capture type).",
  "A query has three separate parts: the FEATURE being searched for (potholes, benches, houses), the PLACE (a city, state or country) and optional ATTRIBUTE conditions on the place (steep, waterfront, wealthy, polluted).",
  "Only attribute conditions count here. Never treat the searched feature, a place name, a year or a compass word used as part of a place name ('north Denver', 'West Texas') as an attribute condition.",
  "Adjectives describing the place around the feature are attribute conditions: 'houses on steep hills' → terrain; 'benches in wealthy neighborhoods' → income; 'flood-prone streets' → flood zone; 'low-lying' → elevation.",
  "Be precise: answer true for the most specific attribute that captures the condition, and false for attributes that are only loosely related.",
].join(" ");

async function ask(questions: Record<string, unknown>, state: Record<string, unknown>, timeoutMs: number, gate: GateAttempt["gate"], attempts: GateAttempt[]): Promise<Record<string, JevAnswer> | null> {
  // JEV, then the gateway, then the OpenAI decision model (lib/locate/jev.ts).
  const tried: DecisionAttempt[] = [];
  const result = await decide(questions, state, timeoutMs, tried);
  for (const t of tried) attempts.push({ gate, provider: t.provider, status: t.status, duration_ms: t.duration_ms, questions: Object.keys(questions).length, ...(t.error ? { error: t.error } : {}) });
  return result?.answers ?? null;
}

// ---------------------------------------------------------------- Gate 1: intent

function intentQuestion(def: AttributeDef) {
  return {
    type: "noul",
    instructions: [
      `Attribute: "${def.label}" (${GROUPS[def.group]}). Measures: ${def.ask}`,
      `It is requested when the query puts a condition on it, for example ${def.triggers}.`,
      def.not ? `Do not confuse: ${def.not}` : "",
      `Answer true only if the user wants results restricted or ranked by ${def.label.toLowerCase()}. A mere mention of a related word inside the feature name or place name is false.`,
    ].filter(Boolean).join(" "),
    criteria: {
      true: `The query restricts or ranks results by ${def.label.toLowerCase()}.`,
      false: `The query puts no condition on ${def.label.toLowerCase()}.`,
    },
  };
}

export type IntentResult = { any: number; picks: { key: string; score: number }[] };

/** Gate 1: which attributes (if any) does the query filter on? Runs in parallel with region/feature routing. */
export async function gateIntent(query: string, exclude: Set<string>, attempts: GateAttempt[]): Promise<IntentResult> {
  const defs = ATTRIBUTES.filter((d) => !exclude.has(d.key));
  const questions: Record<string, unknown> = {
    attr_any: {
      type: "noul",
      instructions:
        "Does the query restrict or rank results by any property of the place itself (terrain, elevation, flood risk, water, climate, air quality, sunshine, wind, how urban it is, land cover, soil, income or other demographics, jobs, biome, rock type, wildfire hazard, pollution, remoteness, or 360°/video capture)? The searched feature, place names and years do not count.",
      criteria: { true: "At least one place-attribute condition is present.", false: "Only a feature and/or a place and/or a year; no attribute condition." },
    },
    ...Object.fromEntries(defs.map((d) => [`attr:${d.key}`, intentQuestion(d)])),
  };
  const answers = await ask(questions, { task: RULES, query }, 6000, "intent", attempts);
  if (!answers) return { any: 0, picks: [] };
  const any = Number(answers.attr_any?.noul ?? 0);
  if (any < ANY_THRESHOLD) return { any, picks: [] };
  const picks = defs
    .map((d) => ({ key: d.key, score: Number(answers[`attr:${d.key}`]?.noul ?? 0) }))
    .filter((p) => p.score >= INTENT_THRESHOLD)
    .sort((a, b) => b.score - a.score);
  return { any, picks: preferSpecific(picks).slice(0, MAX_ATTRIBUTE_FILTERS) };
}

/** When a class and its raw measure both fire with no number in play, keep the stronger one. */
function preferSpecific(picks: { key: string; score: number }[]) {
  const pairs: [string, string][] = [["terrain_class", "slope_deg"], ["flood_zone", "flood_river_100yr_m"], ["flood_zone", "flood_coast_100yr_m"], ["climate_group", "climate_symbol"], ["water_proximity", "water_distance_m"]];
  const drop = new Set<string>();
  for (const [a, b] of pairs) {
    const pa = picks.find((p) => p.key === a), pb = picks.find((p) => p.key === b);
    if (pa && pb) drop.add(pa.score >= pb.score ? b : a);
  }
  return picks.filter((p) => !drop.has(p.key));
}

// ---------------------------------------------------------------- numbers stated in the query

const NUM = String.raw`(-?\d+(?:[.,]\d+)*)\s*`;
type Stated = { value: number; text: string };

function toNumber(s: string) {
  return Number(s.replace(/,(?=\d{3}\b)/g, "").replace(",", "."));
}

/** Numbers in the query converted to the attribute's unit, e.g. "500 ft" → 152 m, "$100k" → 100000. */
export function statedNumbers(query: string, def: AttributeDef): Stated[] {
  const q = query.toLowerCase();
  const out: Stated[] = [];
  const push = (value: number, text: string) => Number.isFinite(value) && out.push({ value: +value.toFixed(3), text: text.trim() });
  const each = (re: RegExp, fn: (n: number, m: RegExpMatchArray) => number | null) => {
    for (const m of Array.from(q.matchAll(re))) {
      const n = fn(toNumber(m[1]), m);
      if (n != null) push(n, m[0]);
    }
  };
  switch (def.unitFamily) {
    case "length_m":
      each(new RegExp(NUM + String.raw`(km|kilomet(?:er|re)s?)\b`, "g"), (n) => n * 1000);
      each(new RegExp(NUM + String.raw`(mi|miles?)\b`, "g"), (n) => n * 1609.34);
      each(new RegExp(NUM + String.raw`(ft|feet|foot)\b`, "g"), (n) => n * 0.3048);
      each(new RegExp(NUM + String.raw`(m|met(?:er|re)s?)\b`, "g"), (n) => n);
      break;
    case "length_km":
      each(new RegExp(NUM + String.raw`(km|kilomet(?:er|re)s?)\b`, "g"), (n) => n);
      each(new RegExp(NUM + String.raw`(mi|miles?)\b`, "g"), (n) => n * 1.60934);
      each(new RegExp(NUM + String.raw`(m|met(?:er|re)s?)\b`, "g"), (n) => n / 1000);
      break;
    case "percent":
      each(new RegExp(NUM + String.raw`(%|percent|per cent)`, "g"), (n) => n);
      break;
    case "usd":
      each(/\$\s*(\d+(?:[.,]\d+)*)\s*(k|thousand|m|million)?\b/g, (n, m) => (m[2] === "k" || m[2] === "thousand" ? n * 1e3 : m[2] === "m" || m[2] === "million" ? n * 1e6 : n));
      each(new RegExp(NUM + String.raw`(k|thousand)\b`, "g"), (n) => n * 1e3);
      each(new RegExp(NUM + String.raw`(million)\b`, "g"), (n) => n * 1e6);
      break;
    case "minutes":
      each(new RegExp(NUM + String.raw`(min|mins|minutes?)\b`, "g"), (n) => n);
      each(new RegExp(NUM + String.raw`(h|hrs?|hours?)\b`, "g"), (n) => n * 60);
      break;
    case "celsius":
      each(new RegExp(NUM + String.raw`(°\s*f|degrees? f(?:ahrenheit)?|f\b)`, "g"), (n) => ((n - 32) * 5) / 9);
      each(new RegExp(NUM + String.raw`(°\s*c?|degrees?(?: c(?:elsius)?)?|c\b)`, "g"), (n) => n);
      break;
    case "mm":
      each(new RegExp(NUM + String.raw`(mm|millimet(?:er|re)s?)\b`, "g"), (n) => n);
      each(new RegExp(NUM + String.raw`(cm)\b`, "g"), (n) => n * 10);
      each(new RegExp(NUM + String.raw`(in|inch(?:es)?)\b`, "g"), (n) => n * 25.4);
      break;
    case "speed_ms":
      each(new RegExp(NUM + String.raw`(m/s|meters? per second)`, "g"), (n) => n);
      each(new RegExp(NUM + String.raw`(km/h|kph)`, "g"), (n) => n / 3.6);
      each(new RegExp(NUM + String.raw`(mph)\b`, "g"), (n) => n * 0.44704);
      break;
  }
  // Bare numbers ("above 500"), but never something that reads as a year.
  if (!out.length) {
    for (const m of Array.from(q.matchAll(/(?:above|over|below|under|more than|less than|at least|at most|greater than|higher than|lower than|between|from|to|than)\s+(-?\d+(?:[.,]\d+)*)/g))) {
      const n = toNumber(m[1]);
      if (n >= 1900 && n <= 2100 && Number.isInteger(n)) continue;
      push(n, `${m[1]} ${def.unit ?? ""}`);
    }
  }
  const [lo, hi] = def.range ?? [-Infinity, Infinity];
  return out.filter((s) => s.value >= lo && s.value <= hi).filter((s, i, all) => all.findIndex((x) => x.value === s.value) === i).slice(0, 4);
}

function thresholdOptions(query: string, def: AttributeDef) {
  const stated = statedNumbers(query, def);
  const opts: { id: string; value: number; label: string }[] = [];
  const add = (value: number, label: string) => {
    if (opts.some((o) => Math.abs(o.value - value) < 1e-9)) return;
    opts.push({ id: `t${opts.length}`, value, label });
  };
  stated.forEach((s) => add(s.value, `${formatNumber(def, s.value)} — the number stated in the query ("${s.text}")`));
  if (def.low) add(def.low.value, `${formatNumber(def, def.low.value)} — the usual threshold for "${def.low.words}"`);
  if (def.high) add(def.high.value, `${formatNumber(def, def.high.value)} — the usual threshold for "${def.high.words}"`);
  (def.presets ?? []).forEach((p) => add(p, formatNumber(def, p)));
  return { stated, opts: opts.slice(0, 20) };
}

// ---------------------------------------------------------------- Gate 2: values

const RANGE_WORDS = /\bbetween\b|\bfrom\s+-?\d.*\bto\s+-?\d|\d\s*(?:-|–|to)\s*\d/;

/** Gate 2: values, directions and thresholds for each attribute Gate 1 picked. One JEV call. */
export async function gateValues(query: string, keys: string[], namespace: string, attempts: GateAttempt[]): Promise<AttributeFilter[]> {
  if (!keys.length) return [];
  const defs = keys.map((k) => ATTRIBUTE_BY_KEY[k]).filter(Boolean);
  const questions: Record<string, unknown> = {};
  const enumValues = new Map<string, EnumValue[]>();
  const thresholds = new Map<string, ReturnType<typeof thresholdOptions>>();

  await Promise.all(
    defs.map(async (def) => {
      if (def.kind !== "enum" && def.kind !== "tags") return;
      const live = def.dynamic ? await liveValues(namespace, def.key) : [];
      const known = def.values ?? [];
      const merged = [...known, ...live.filter((x) => !known.some((k) => String(k.value) === x)).map((x) => ({ value: x, label: x.replace(/_/g, " ") }))];
      enumValues.set(def.key, merged.slice(0, 30));
    })
  );

  for (const def of defs) {
    const head = `The user filters by "${def.label}" (${def.ask}).`;
    if (def.kind === "enum" || def.kind === "tags") {
      const vals = enumValues.get(def.key) ?? [];
      vals.forEach((val, i) => {
        questions[`val:${def.key}:${i}`] = {
          type: "choice",
          instructions: `${head} Is "${val.label}"${val.hint ? ` (${val.hint})` : ""} one of the values the user wants? Several values can be requested together ("flat or gentle", "suburban and rural"). Choose requested only if the query asks for it or clearly implies it; a value the user wants to exclude is not_requested.`,
          criteria: { requested: `The user wants ${def.label.toLowerCase()} = ${val.label}.`, not_requested: `The user does not ask for ${val.label}.` },
        };
      });
    } else if (def.kind === "bool") {
      questions[`bool:${def.key}`] = {
        type: "choice",
        instructions: `${head} Which does the user want?`,
        criteria: { yes: def.yes ?? `Only where ${def.label.toLowerCase()} is true.`, no: def.noValue ?? `Only where ${def.label.toLowerCase()} is false.`, any: "No preference either way." },
      };
    } else {
      const t = thresholdOptions(query, def);
      thresholds.set(def.key, t);
      const lowWords = def.low?.words ?? `low ${def.label.toLowerCase()}`;
      const highWords = def.high?.words ?? `high ${def.label.toLowerCase()}`;
      questions[`dir:${def.key}`] = {
        type: "choice",
        instructions: `${head} Unit: ${def.unit}. In which direction does the user constrain it? "above" covers more than / over / at least / at or above and words like "${highWords}"; "below" covers less than / under / at most and words like "${lowWords}"; "between" needs two bounds; "highest" and "lowest" are superlatives that rank results (the highest, the most, the top; the lowest, the least).`,
        criteria: {
          above: `Values above a threshold (e.g. "${highWords}", "over ${t.opts[0] ? formatNumber(def, t.opts[0].value) : "a value"}").`,
          below: `Values below a threshold (e.g. "${lowWords}", "under ${t.opts[0] ? formatNumber(def, t.opts[0].value) : "a value"}").`,
          between: "Values inside a range with a lower and an upper bound.",
          highest: `Rank by the highest ${def.label.toLowerCase()} (superlative, no threshold).`,
          lowest: `Rank by the lowest ${def.label.toLowerCase()} (superlative, no threshold).`,
        },
      };
      if (t.opts.length) {
        const criteria = Object.fromEntries(t.opts.map((o) => [o.id, o.label]));
        questions[`thr:${def.key}`] = {
          type: "choice",
          instructions: `${head} Unit: ${def.unit}. Which threshold best matches the user's wording? If the query states a number, choose the option marked as stated in the query (already converted to ${def.unit}). Otherwise choose the option that matches the user's descriptive words (for example "${lowWords}" or "${highWords}").`,
          criteria,
        };
        if (RANGE_WORDS.test(query)) {
          questions[`lo:${def.key}`] = { type: "choice", instructions: `${head} The user gives a range. Which option is its LOWER bound?`, criteria };
          questions[`hi:${def.key}`] = { type: "choice", instructions: `${head} The user gives a range. Which option is its UPPER bound?`, criteria };
        }
      }
    }
  }

  const answers = await ask(questions, { task: RULES, query, attributes: defs.map((d) => d.label) }, 6000, "values", attempts);
  if (!answers) return [];

  const filters: AttributeFilter[] = [];
  for (const def of defs) {
    if (def.kind === "enum" || def.kind === "tags") {
      const vals = (enumValues.get(def.key) ?? []).filter((_, i) => answers[`val:${def.key}:${i}`]?.choice === "requested").map((x) => x.value);
      // Gate 1 said the user filters on this attribute; if no specific value was picked, use its default set.
      const chosen = vals.length ? vals : def.whenUnspecified ?? [];
      if (chosen.length) filters.push({ key: def.key, op: "in", values: chosen, source: "jev" });
    } else if (def.kind === "bool") {
      const c = answers[`bool:${def.key}`]?.choice;
      if (c === "yes" || c === "no") filters.push({ key: def.key, op: "eq", value: c === "yes", source: "jev" });
    } else {
      const t = thresholds.get(def.key)!;
      const pick = (id?: string) => t.opts.find((o) => o.id === id)?.value;
      const dir = answers[`dir:${def.key}`]?.choice;
      const thr = pick(answers[`thr:${def.key}`]?.choice);
      if (dir === "above" && thr != null) filters.push({ key: def.key, op: "gte", value: thr, source: "jev" });
      else if (dir === "below" && thr != null) filters.push({ key: def.key, op: "lte", value: thr, source: "jev" });
      else if (dir === "between") {
        const lo = pick(answers[`lo:${def.key}`]?.choice) ?? t.stated[0]?.value;
        const hi = pick(answers[`hi:${def.key}`]?.choice) ?? t.stated[1]?.value;
        if (lo != null && hi != null) filters.push({ key: def.key, op: "between", value: lo, value2: hi, source: "jev" });
      } else if (dir === "highest") filters.push({ key: def.key, op: "gte", value: def.high?.value, sort: "desc", source: "jev" });
      else if (dir === "lowest") filters.push({ key: def.key, op: "lte", value: def.low?.value, sort: "asc", source: "jev" });
    }
  }
  return normalizeFilters(filters);
}

// ---------------------------------------------------------------- Timeframe gate (answer layer)

export type Timeframe = "weekly" | "monthly" | "annual";

const TIMEFRAME_RULES = [
  "You are the timeframe gate of EDK Find's answer layer. A user searched civic records (permits, complaints, service requests, crimes, accidents, inspections) in a place.",
  "The answer can include counts over time from the record ledger: week by week, month by month or year by year.",
  "Decide which of these the answer needs to respond well. More than one can be true. Prefer the granularity that matches the time words in the query.",
].join(" ");

const TIMEFRAME_QUESTIONS: Record<Timeframe, { instructions: string; true: string; false: string }> = {
  weekly: {
    instructions: "Does a good answer need week-by-week counts? True for very recent windows: 'this week', 'last week', 'past few weeks', 'lately', 'right now', 'recently', 'spike', 'surge'.",
    true: "The query is about the last days or weeks, or a short-term spike.",
    false: "The query is not about the last few weeks.",
  },
  monthly: {
    instructions: "Does a good answer need month-by-month counts? True for 'this month', 'last month', 'this year', 'past year', 'past few months', 'seasonal', 'summer', 'winter', 'trend' over months.",
    true: "The query is about months, the current or past year, seasonality, or a recent trend.",
    false: "The query does not concern months or the past year.",
  },
  annual: {
    instructions: "Does a good answer need year-by-year counts? True for 'over the years', 'since 2020', 'long-term', 'historically', 'compared to last year', 'growing', 'declining', or a named year.",
    true: "The query compares years or asks about long-term change or a specific year.",
    false: "The query does not concern multiple years.",
  },
};

/** Which ledger series the answer should carry for civic features. Annual when JEV is unsure or unavailable. */
export async function gateTimeframe(query: string, attempts: GateAttempt[] = []): Promise<Timeframe[]> {
  const questions = Object.fromEntries(Object.entries(TIMEFRAME_QUESTIONS).map(([key, q]) => [`tf:${key}`, { type: "noul", instructions: q.instructions, criteria: { true: q.true, false: q.false } }]));
  const answers = await ask(questions, { rules: TIMEFRAME_RULES, query }, 2500, "timeframe", attempts).catch(() => null);
  const picked = (Object.keys(TIMEFRAME_QUESTIONS) as Timeframe[]).filter((key) => (answers?.[`tf:${key}`]?.noul ?? 0) >= 0.5);
  return picked.length ? picked : ["annual"];
}
