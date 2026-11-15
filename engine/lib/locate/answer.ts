// Find answer layer: turns a finished console search into one short, natural answer.
// The server builds a structured plain-text context first (place, filters, ledger totals and the series
// the query needs, where results cluster by neighborhood, the first 10 results), so Luna writes from
// clean facts instead of raw rows. OpenAI first, Cerebras as fallback; it ships inside the search response.
import { sql } from "./e2-db";
import { CIVIC_METHODS } from "./civic";
import { ATTRIBUTE_BY_KEY } from "./attributes/catalog";
import { CONTEXT_KEYS, formatAttribute } from "./attributes/display";
import type { Timeframe } from "./attributes/gate";
import { asksAboutAmount, asksAboutTime } from "./intent";
import { legend, readAttribute } from "./legend";
import { addAnswerTokens, estimateTokens } from "./tokens";

export type AnswerInput = {
  measuredFacts?: string[];
  query: string;
  features: Array<{ properties?: Record<string, any> }>;
  regions?: Array<{ id: string; name: string; layer?: string; state_name?: string; country_name?: string }>;
  year?: string | number | null;
  filters?: { applied?: Array<{ key: string; text: string }>; skipped?: Array<{ label: string; reason: string }>; relaxed?: Array<{ text: string }> } | null;
  artifacts?: Array<{ name: string; feature_id?: string | null; method?: string | null }>;
  /** Ledger series for civic features, from the JEV timeframe gate. Defaults to annual. */
  timeframes?: Timeframe[];
  /** Earlier messages from the same person that this question leans on (from the context engine), oldest first. */
  history?: Array<{ when: string; query: string; place: string | null; answer: string | null }>;
};

/** Examples sent to the model. It may name one; a short list keeps it from reciting many. */
export const TOP_RESULTS = 6;
const RESULT_CAP_NOTE = "The examples are a recent sample, not a full count. Only TOTAL gives a total.";

const countBy = <T>(items: T[], key: (item: T) => string | null | undefined) => {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    if (k) counts.set(k, (counts.get(k) || 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
};
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const dateText = (d: string | Date) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const monthText = (d: string | Date) => new Date(d).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const titleCase = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s);

const COUNTRIES = new Set(["united states", "united states of america", "usa", "us", "canada", "ca", "united kingdom", "uk"]);
/** "50 HAVEN AVE, New York, NY, 10032, United States" -> "50 Haven Ave". Keeps the first meaningful part. */
function cleanAddress(address: unknown, place?: { name?: string; state_name?: string } | null) {
  const parts = String(address || "").split(",").map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  const drop = new Set([place?.name, place?.state_name].filter(Boolean).map((x) => String(x).toLowerCase()));
  const kept = parts.filter((p) => {
    const l = p.toLowerCase();
    return !COUNTRIES.has(l) && !drop.has(l) && !/^\d{5}(-\d{4})?$/.test(p) && !/^[A-Z]{2}( \d{5})?$/.test(p) && !/^[A-Z]\d[A-Z] ?\d[A-Z]\d$/i.test(p);
  });
  return kept.length ? titleCase(kept.slice(0, 2).join(", ")) : null;
}

const STREET_SUFFIX: Record<string, string> = { st: "Street", ave: "Avenue", av: "Avenue", dr: "Drive", blvd: "Boulevard", rd: "Road", pl: "Place", ln: "Lane", pkwy: "Parkway", ct: "Court", ter: "Terrace", hwy: "Highway", sq: "Square", cir: "Circle", expy: "Expressway" };
/** "99 MARGARET CORBIN DR, New York, NY" -> "Margaret Corbin Drive": the street, the way a person says it. */
function streetName(address: unknown, place?: { name?: string; state_name?: string } | null) {
  const first = cleanAddress(address, place)?.split(",")[0]?.trim().split(/\s+/).map(titleCase).join(" ");
  if (!first) return null;
  const street = first.replace(/^\d+[a-z]?(?:-\d+)?\s+/i, "").replace(/\b([A-Za-z]+)\.?$/, (word, w: string) => STREET_SUFFIX[w.toLowerCase()] ?? word);
  return /[a-z]/i.test(street) ? street : null;
}

function describeAttribute(props: Record<string, any>[], key: string): string | null {
  const def = ATTRIBUTE_BY_KEY[key];
  const values = props.map((p) => p[key]).filter((v) => v !== null && v !== undefined && v !== "");
  if (!def || !values.length) return null;
  const label = def.label.toLowerCase();
  if (def.kind === "number") {
    const nums = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    return nums.length ? `${label} typically ~${formatAttribute(key, nums[Math.floor(nums.length / 2)])}` : null;
  }
  const top = countBy(values.flatMap((v) => (def.kind === "tags" && Array.isArray(v) ? v : [v])), (v) => formatAttribute(key, def.kind === "tags" ? [v] : v));
  if (!top.length) return null;
  if (top[0][1] >= values.length * 0.6 || top.length === 1) return `${label}: mostly ${top[0][0]}`;
  return `${label}: mix of ${top[0][0]} and ${top[1][0]}`;
}

/** The value that best stands for a set of results: the middle number, or the most common label. */
function representative(values: unknown[], numeric: boolean): unknown {
  if (numeric) {
    const nums = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    return nums.length ? nums[Math.floor(nums.length / 2)] : null;
  }
  const flat = values.flatMap((v) => (Array.isArray(v) ? v : [v])).map(String);
  return countBy(flat, (v) => v)[0]?.[0] ?? null;
}

/**
 * ATTRIBUTE GUIDE lines from attribute_legend: what each condition (and each attribute most results
 * share) measures, and what the typical value around these results means in plain words.
 */
async function attributeGuide(props: Record<string, any>[], keys: string[], matchedKeys: string[]): Promise<string[]> {
  if (!keys.length) return [];
  const guide = await legend().catch(() => null);
  if (!guide) return [];
  const lines: string[] = [];
  for (const key of keys) {
    const field = guide.byColumn.get(key);
    if (!field) continue;
    const values = props.map((p) => p[key]).filter((v) => v !== null && v !== undefined && v !== "");
    const reading = values.length ? readAttribute(guide, key, representative(values, field.kind === "numeric")) : null;
    const typical = reading ? `Typical around these results: ${reading.value}${reading.detail ? ` (${reading.detail})` : ""}${reading.note ? `. That means: ${reading.note}` : ""}` : "";
    const bands = (guide.ranges.get(key) ?? []).map((b) => b.title).filter(Boolean).slice(0, 6).join(" < ");
    lines.push(
      `- ${field.title} [${field.category}${matchedKeys.includes(key) ? ", a condition the user asked for" : ""}]: ${field.about ?? ""}${field.unit ? ` Measured in ${field.unit}.` : ""}${bands ? ` Scale: ${bands}.` : ""} ${typical}`.replace(/\s+/g, " ").trim(),
    );
  }
  return lines.length ? ["ATTRIBUTE GUIDE (what each attribute measures and what the typical value here means; speak the meaning, never the field name, code or scale):", ...lines] : [];
}

type LedgerRow = { feature_id: string; timeframe: string; year: number | null; date_from: string | null; date_to: string | null; total: string; quantity_rank: number | null; peer_count: number | null };

async function ledgerRows(featureIds: string[], regionId: string): Promise<LedgerRow[]> {
  return await sql.query(
    `select feature_id::text, timeframe, year, date_from, date_to, total_count::bigint::text as total, quantity_rank, peer_count
       from ledger
      where feature_id = any($1::bigint[]) and region_id = $2::bigint and measurement = 'count'
        and (timeframe = 'all'
          or (timeframe = 'year' and year >= extract(year from now())::int - 5)
          or (timeframe = 'monthly' and date_from >= date_trunc('month', now()) - interval '12 months')
          or (timeframe = 'weekly' and date_from >= now() - interval '9 weeks'))
      order by feature_id, timeframe, date_from`,
    [featureIds, regionId],
  ).catch(() => [] as any[]) as LedgerRow[];
}

/** One series line plus a short computed note ("highest in the window", "partial"). */
function seriesLine(label: string, rows: LedgerRow[], name: string, pointLabel: (r: LedgerRow) => string, take: number) {
  const points = rows.slice(-take);
  if (points.length < 2) return null;
  const now = Date.now();
  const partial = (r: LedgerRow) => r.date_to && new Date(r.date_to).getTime() > now;
  // Ledger gaps show up as points far below the window's typical value (e.g. 841 between months of ~6,000).
  // Flag them and keep them out of the comparisons, so a gap is not read as a real drop and rebound.
  const sorted = points.map((r) => Number(r.total)).sort((a, b) => a - b);
  const typical = sorted[Math.floor(sorted.length / 2)];
  const gap = (r: LedgerRow) => points.length >= 4 && Number(r.total) < typical * 0.3;
  const text = points.map((r) => `${pointLabel(r)} ${fmt(Number(r.total))}${partial(r) ? " (so far)" : gap(r) ? " (likely incomplete data)" : ""}`).join(" · ");
  const complete = points.filter((r) => !partial(r) && !gap(r));
  const notes: string[] = [];
  if (complete.length >= 2) {
    const last = complete[complete.length - 1], prev = complete[complete.length - 2];
    const change = (Number(last.total) - Number(prev.total)) / Math.max(1, Number(prev.total));
    notes.push(`${pointLabel(last)} was ${Math.abs(change) < 0.05 ? "about level with" : change > 0 ? "up from" : "down from"} ${pointLabel(prev)}`);
    const peak = complete.reduce((a, b) => (Number(b.total) > Number(a.total) ? b : a));
    notes.push(`highest in this window (not all time): ${pointLabel(peak)}`);
  }
  return `TREND (${label}, ${name}): ${text}${notes.length ? ` — ${notes.join("; ")}` : ""}`;
}

/**
 * TOTAL and TREND lines, only when the question is about an amount or how it changes ("how many",
 * "growing", "by month"). Otherwise the answer carries no totals at all. Image features: overall total
 * only. Civic: overall plus the requested series; a series is limited to the year asked when there is one.
 */
async function ledgerSection(input: AnswerInput) {
  const region = input.regions?.[0];
  const features = (input.artifacts || []).filter((a) => a.feature_id && /^\d+$/.test(String(a.feature_id)));
  if (!asksAboutAmount(input.query) || !region?.id || !/^\d+$/.test(String(region.id)) || !features.length) return [];
  const askedYear = input.year && /^\d{4}$/.test(String(input.year)) ? Number(input.year) : null;
  const rows = (await ledgerRows(features.map((f) => String(f.feature_id)), String(region.id)))
    .filter((r) => !askedYear || r.timeframe === "all" || r.timeframe === "year" || Number(r.year) === askedYear);
  const timeframes = input.timeframes?.length ? input.timeframes : ["annual"];
  const totals: string[] = [];
  const trends: string[] = [];
  for (const f of features) {
    const mine = rows.filter((r) => r.feature_id === String(f.feature_id));
    const all = mine.find((r) => r.timeframe === "all");
    // A total below what the search just returned is stale (e.g. 49 on record, 50 shown): leave it out.
    const shown = input.features.filter((x) => x.properties?.feature_name === f.name).length;
    if (all && Number(all.total) >= shown) {
      // A rank only means something against a real peer group ("1 of 2" does not).
      const rank = all.quantity_rank && all.peer_count && all.peer_count >= 10 ? ` (rank ${all.quantity_rank} of ${all.peer_count} comparable places)` : "";
      const civic = CIVIC_METHODS.has(String(f.method || ""));
      totals.push(`${f.name} ${fmt(Number(all.total))} ${civic ? "filed" : "across the city"}${rank}`);
    }
    if (!CIVIC_METHODS.has(String(f.method || ""))) continue;
    if (timeframes.includes("weekly")) trends.push(seriesLine("weekly, last 8 weeks", mine.filter((r) => r.timeframe === "weekly"), f.name, (r) => `wk of ${dateText(r.date_from!).replace(/, \d{4}$/, "")}`, 8) || "");
    if (timeframes.includes("monthly")) trends.push(seriesLine("monthly, last 12 months", mine.filter((r) => r.timeframe === "monthly"), f.name, (r) => monthText(r.date_from!), 12) || "");
    if (timeframes.includes("annual")) trends.push(seriesLine("yearly", mine.filter((r) => r.timeframe === "year"), f.name, (r) => String(r.year), 6) || "");
  }
  return [
    ...(totals.length ? [`TOTAL IN ${region.name.toUpperCase()} (all time): ${totals.join(" · ")}`] : []),
    ...trends.filter(Boolean),
  ];
}

/** The structured context Luna answers from. Plain labelled lines read better for the model than JSON. */
export async function buildContext(input: AnswerInput): Promise<string> {
  if (input.measuredFacts?.length) return ["MEASUREMENTS FROM MAPPED DATA", ...input.measuredFacts.slice(0, 20)].join("\n");
  const props = input.features.map((f) => f.properties || {});
  const region = input.regions?.[0];
  const matchedKeys = (input.filters?.applied || []).map((f) => f.key);
  const lines: string[] = [];
  const timely = asksAboutTime(input.query);
  lines.push(`TODAY: ${dateText(new Date())}`);
  lines.push(`QUESTION: ${input.query}`);
  if (input.history?.length) {
    lines.push("EARLIER IN THIS CONVERSATION (oldest first; the same person asked these before, and this question leans on them):");
    input.history.forEach((h, i) => {
      lines.push(`  ${i + 1}. ${h.when} — they asked: "${h.query.slice(0, 220)}"${h.place ? ` (about ${h.place})` : ""}${h.answer ? ` — you said: "${h.answer.replace(/\s+/g, " ").slice(0, 420)}"` : ""}`);
    });
  }
  if (region) lines.push(`PLACE: ${[region.name, region.state_name, region.country_name].filter((x, i, a) => x && a.indexOf(x) === i).join(", ")}${region.layer ? ` (${region.layer})` : ""}`);
  const features = countBy(props, (p) => p.feature_name);
  lines.push(`LOOKING FOR: ${features.map(([n]) => n).join(", ") || "(unknown)"}`);
  // Civic records are filed reports with filing dates; everything else is seen in street-level photos.
  const kinds = new Set((input.artifacts || []).filter((a) => features.some(([n]) => n === a.name)).map((a) => (CIVIC_METHODS.has(String(a.method || "")) ? "civic" : "imagery")));
  if (!kinds.size) kinds.add("imagery");
  const areaResults = props.filter((p) => p.kind === "area").length;
  if (areaResults) lines.push(`AREAS: ${areaResults === props.length ? "every example is" : `${areaResults} of the examples are`} a part of the place itself (a few blocks across), picked because the land or the neighbourhood there fits the conditions. Describe which parts of the place fit and what they are like.`);
  lines.push(`KIND: ${[...kinds].map((k) => k === "civic" ? "things filed with the city (permits, complaints, incidents); a date is when it was filed" : "things physically out on the street; a date is when it was last seen there").join(" + ")}`);
  if (input.year) lines.push(`YEAR ASKED: ${input.year}`);
  lines.push(`FILTERS USED: ${(input.filters?.applied || []).map((f) => f.text).join("; ") || "(none)"}`);
  const skipped = [...(input.filters?.skipped || []).map((s) => `${s.label} (${s.reason})`), ...(input.filters?.relaxed || []).map((r) => `${r.text} (relaxed: nothing matched)`)];
  if (skipped.length) lines.push(`NOT APPLIED: ${skipped.join("; ")}`);
  lines.push(...await ledgerSection(input));

  const hoods = countBy(props, (p) => p.neighborhood);
  const districts = countBy(props, (p) => p.district);
  const areas = countBy(props, (p) => p.area);
  const multiArea = areas.length > 1;
  const counted = (list: [string, number][], n: number) => list.slice(0, n).map(([name, c]) => `${name} ${c}`).join(" · ");
  if (hoods.length || districts.length) {
    lines.push("WHERE THEY ARE (how many of the examples are in each; for choosing places, not for quoting):");
    if (hoods.length) lines.push(`  neighborhoods: ${counted(hoods, 6)}`);
    if (districts.length) lines.push(`  districts: ${counted(districts, 5)}`);
    if (multiArea) lines.push(`  boroughs / counties: ${counted(areas, 4)}`);
  }

  const contextKeys = CONTEXT_KEYS.filter((k) => !matchedKeys.includes(k) && props.filter((p) => p[k] !== null && p[k] !== undefined && p[k] !== "").length >= props.length * 0.5).slice(0, 2);
  const placeLike = [...matchedKeys, ...contextKeys].map((k) => describeAttribute(props, k)).filter(Boolean);
  if (placeLike.length) lines.push(`WHAT THE PLACES ARE LIKE: ${placeLike.join("; ")}`);
  lines.push(...await attributeGuide(props, [...matchedKeys, ...contextKeys], matchedKeys));

  // Dates only when the question is about time; otherwise they pull the answer toward a log entry.
  const dates = props.map((p) => String(p.date || "").slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (timely && dates.length) lines.push(`WHEN: newest ${monthText(dates[dates.length - 1])}${dates[0] !== dates[dates.length - 1] ? `, going back to ${monthText(dates[0])}` : ""}`);

  // Examples carry the street (never a house number) and the neighborhood, so the answer can place one
  // naturally ("up on Margaret Corbin Drive") instead of citing an address.
  lines.push(`EXAMPLES (name one at most):`);
  props.slice(0, TOP_RESULTS).forEach((p) => {
    // "near Fifth City in Humboldt Park", "near Williamsburg, Brooklyn" (borough only when results span several).
    const local = [p.neighborhood ? `near ${p.neighborhood}` : null, p.district && p.district !== p.neighborhood ? `in ${p.district}` : null].filter(Boolean).join(" ");
    const where = [local || null, multiArea && p.area ? p.area : null].filter(Boolean).join(", ");
    const facts = matchedKeys.map((k) => { const v = formatAttribute(k, p[k]); return v ? `${ATTRIBUTE_BY_KEY[k]?.label.toLowerCase()} ${v}` : null; }).filter(Boolean);
    const parts = [
      p.feature_name,
      p.description ? titleCase(String(p.description).trim()).slice(0, 90) : null,
      streetName(p.address ?? p.location_address, region),
      where || null,
      timely && p.date ? monthText(String(p.date).slice(0, 10)) : null,
      ...facts,
    ].filter(Boolean);
    lines.push(`- ${parts.join(" · ")}`);
  });
  lines.push(`NOTE: ${RESULT_CAP_NOTE}`);
  return lines.join("\n");
}

const ANSWER_SYSTEM_PROMPT = `You are Luna, E2's local guide. You've walked these streets and know them well. Someone just asked you about the place, and you answer the way a friend who lives there would: relaxed, specific, a few sentences.

How to sound
- Speak from your own knowledge of the place, as someone who has been there: "you'll find them all over…", "they bunch up around…", "there's a good stretch of them along…". You are not looking at photos, a map, a database or search results. You just know the place.
- Answer what they asked first. Then give it a little life: where it is and what those streets are like (use WHAT THE PLACES ARE LIKE and FILTERS USED for that).
- Name two or three neighborhoods at most, the ones people would recognise. Mention one street at most, the way a person says it ("up on Margaret Corbin Drive", "along Laight Street"). Never a house number, never more than one example, never a list.
- Only bring up timing when WHEN is in the context, and say it loosely ("lately", "back in 2019", "over the summer"). Never give a full date.
- Numbers only come from TOTAL and TREND, and those only appear when the question is about an amount or a change. Use one or two, rounded the way people talk ("about 6,000 a month", "well over 400,000 over the years"). With no TOTAL or TREND line, give no counts or totals at all.
- For a growth or trend question, say plainly whether it's rising, falling or holding steady, then back it with the TREND line: where it started, where it is now, the busiest stretch. Skip any month marked "likely incomplete data" and never read it as a drop. A month marked "so far" is not finished.
- Fold filters in as a description of the place ("in the city's wealthier pockets", "on the flood-prone blocks"). If something under NOT APPLIED matters, say so in a few words. With FILTERS USED (none), say nothing about filters.
- KIND tells you what these things are. Things filed with the city are "filed", "pulled" or "reported". Things out on the street are simply there; you know where they are.
- ATTRIBUTE GUIDE explains what each condition measures and what the typical value around these places means. Use that meaning to say what the place is actually like for someone living or working there ("comfortably well-off blocks", "low ground that takes on water in a big storm", "a short drive from the nearest hospital"). When the user asked for a condition, say whether these places really fit it and how strongly. Never say the attribute's name, a code, a scale step or a raw measurement; one plain, rounded figure is fine when it makes the point ("households here bring in around $150,000").
- When AREAS is in the context, the answer is about parts of the place, not things in it: say which neighborhoods fit, what they have in common, and how they differ from each other if they do.
- EARLIER IN THIS CONVERSATION is what this same person asked you before, with when. Treat the new question as the next turn of that conversation: resolve "those", "there" or a missing subject from it, and where it helps, connect the two in a few words ("compared with the Brooklyn ones you asked about earlier, these sit further inland"). Never repeat an earlier answer, never mention dates or times of earlier questions, and ignore the earlier messages entirely when they add nothing.
- Lead with the most useful thing a person could do with the answer: where to go, what to expect there, what stands out. Prefer one concrete, specific observation over two general ones.
- 2 to 4 sentences, about 40 to 90 words. Plain text, no lists, headings, markdown or emoji.

Never
- Open by repeating the question, or with "Sure", "Here's", "Great question".
- Say "photographed", "spotted in images", "captured", "imagery", "mapped", "records", "results", "matches", "data", "dataset", "the search", "according to", or use percentages, medians or ranges.
- Say anything that is not in the context: no invented places, landmarks, causes or numbers.

Voice examples only (never reuse their places or numbers):
"You'll find them all over the quieter, well-off corners of Denver, especially around Washington Park and up into Cherry Creek. There's a nice run of them along Downing Street, on those leafy blocks by the park."
"It's been climbing. Denver went from about 700 permits a month last winter to around 1,000 by early summer, and June was the busiest month so far."
Not like this: "Street signs are spotted around Washington Park. Several were photographed at 99 Downing St on Dec 12, 2019. E2 has mapped 49,819 street signs across Denver overall."`;

const openAi = () => {
  const key = process.env.OPENAI_API_KEY || process.env.OPEN_AI_KEY;
  // Own env var: LUNA_MODEL also drives the router fallback, which stays on its own model.
  return key ? { key, model: process.env.ANSWER_MODEL || "gpt-6-luna" } : null;
};
const cerebras = () => {
  const key = process.env.CEREBRAS_API_KEY || process.env.CEREBRAS_KEY;
  return key ? { key, model: process.env.CEREBRAS_MODEL || "gpt-oss-120b" } : null;
};

async function complete(url: string, key: string, body: Record<string, unknown>, timeoutMs: number) {
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`answer failed (${response.status})`);
  const value = (await response.json() as any);
  const text = value?.choices?.[0]?.message?.content;
  // Tokens the answer used, for stream_logs (estimated when the provider reports none).
  addAnswerTokens(value?.usage?.prompt_tokens ?? estimateTokens(JSON.stringify(body.messages ?? "")), value?.usage?.completion_tokens ?? estimateTokens(typeof text === "string" ? text : ""));
  if (typeof text !== "string" || !text.trim()) throw new Error("empty answer");
  return text.trim();
}

// "low" measured the same speed as "none" (~1.4–1.6 s) with slightly tighter answers.
export const ANSWER_REASONING_EFFORT = process.env.ANSWER_REASONING_EFFORT || "low";

/**
 * The answer for a finished search, or null when no provider answers in time. Called inside the search
 * request so the answer ships with the results.
 */
export async function generateAnswer(input: AnswerInput, timeoutMs = 8000): Promise<string | null> {
  if (!input.features.length) return null;
  const messages = [
    { role: "system", content: input.measuredFacts?.length
      ? "Answer the geographic question in plain language using only the provided measurements. Use their units and identify the subjects. Keep the method, routing, and internal identifiers private. Preserve missing values and describe counts as mapped records."
      : ANSWER_SYSTEM_PROMPT },
    { role: "user", content: await buildContext(input) },
  ];
  const primary = openAi();
  if (primary) {
    try {
      return await complete("https://api.openai.com/v1/chat/completions", primary.key, { model: primary.model, messages, reasoning_effort: ANSWER_REASONING_EFFORT, max_completion_tokens: 260 }, timeoutMs);
    } catch (error) {
      console.error("[answer] OpenAI failed:", error instanceof Error ? error.message : error);
    }
  }
  const fallback = cerebras();
  if (fallback) {
    try {
      return await complete("https://api.cerebras.ai/v1/chat/completions", fallback.key, { model: fallback.model, messages, temperature: 0.4, max_tokens: 600 }, timeoutMs);
    } catch (error) {
      console.error("[answer] Cerebras failed:", error instanceof Error ? error.message : error);
    }
  }
  return null;
}
