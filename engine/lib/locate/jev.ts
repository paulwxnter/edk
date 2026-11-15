// One client for every decision the engine asks: JEV first (direct, then through the AI gateway),
// and an OpenAI decision model as the fallback when JEV cannot answer. Questions are typed:
//   noul    a probability from 0 to 1
//   choice  one of the given criteria keys
// Every call adds its input tokens to the request's tally (lib/locate/tokens.ts).
import { addDecisionTokens, estimateTokens } from "./tokens";

export type DecisionAnswer = { choice?: string; noul?: number };
export type DecisionProvider = "jev" | "gateway_jev" | "openai_decision";
export type DecisionQuestion = { type: "noul" | "choice"; instructions: string; criteria: Record<string, string> };
export type DecisionResult = { answers: Record<string, DecisionAnswer>; provider: DecisionProvider; model: string; httpStatus: number; inputTokens: number };
export type DecisionAttempt = { provider: DecisionProvider; model: string; status: "ok" | "error"; duration_ms: number; http_status?: number | null; error?: string };

const openAiKey = () => process.env.OPENAI_API_KEY || process.env.OPEN_AI_KEY;
export const DECISION_MODEL = () => process.env.DECISION_MODEL || "gpt-6-luna";

class HttpError extends Error {
  constructor(message: string, readonly httpStatus: number) {
    super(message);
  }
}

/** One JEV call. Throws on a non-200 or an unreadable body. */
export async function jevRequest(target: { url: string; key: string; model: string }, state: unknown, questions: Record<string, unknown>, timeoutMs: number) {
  const body = JSON.stringify({ model: target.model, state: typeof state === "string" ? state : JSON.stringify(state), questions });
  const response = await fetch(target.url, { method: "POST", headers: { authorization: `Bearer ${target.key}`, "content-type": "application/json" }, signal: AbortSignal.timeout(timeoutMs), body });
  const text = await response.text();
  let value: any = null;
  try {
    value = JSON.parse(text);
  } catch {
    /* handled below as an empty provider response */
  }
  if (!response.ok) throw new HttpError(`Jev failed (${response.status}).`, response.status);
  const inputTokens = Number(value?.usage?.input_tokens) || estimateTokens(body);
  addDecisionTokens(inputTokens);
  return { answers: (value?.answers ?? {}) as Record<string, DecisionAnswer>, value, httpStatus: response.status, inputTokens };
}

const FALLBACK_SYSTEM = [
  "You are a decision model. You receive a STATE (facts about a request) and a set of QUESTIONS about it.",
  "Answer every question on its own, using only the state and that question's instructions and criteria.",
  'A question of type "noul" asks how likely its "true" criterion holds: answer with a number from 0 to 1 (0 = certainly false, 1 = certainly true, 0.5 = cannot tell).',
  'A question of type "choice" asks you to pick exactly one of its criteria: answer with that criterion\'s key, copied exactly.',
  'Return JSON only, in this shape: {"answers": {"<question key>": {"noul": <number>} | {"choice": "<criteria key>"}}}. Include every question key, and nothing else.',
].join(" ");

/** The same questions answered by an OpenAI model, in JEV's answer shape. Throws when it cannot answer. */
export async function openAiDecision(state: unknown, questions: Record<string, unknown>, timeoutMs: number) {
  const key = openAiKey();
  if (!key) throw new Error("No OpenAI key for the decision fallback.");
  const model = DECISION_MODEL();
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      reasoning_effort: "none",
      messages: [
        { role: "system", content: FALLBACK_SYSTEM },
        { role: "user", content: JSON.stringify({ state: typeof state === "string" ? safeParse(state) : state, questions }) },
      ],
    }),
  });
  if (!response.ok) throw new HttpError(`Decision fallback failed (${response.status}).`, response.status);
  const value = (await response.json() as any);
  const parsed = safeParse(String(value?.choices?.[0]?.message?.content || "{}")) as any;
  const raw = parsed?.answers && typeof parsed.answers === "object" ? parsed.answers : {};
  // Keep only well-formed answers to questions that were asked.
  const answers: Record<string, DecisionAnswer> = {};
  for (const [name, question] of Object.entries(questions) as [string, any][]) {
    const a = raw[name];
    if (!a || typeof a !== "object") continue;
    if (question?.type === "choice") {
      if (typeof a.choice === "string" && question.criteria && a.choice in question.criteria) answers[name] = { choice: a.choice };
    } else if (typeof a.noul === "number" && Number.isFinite(a.noul)) answers[name] = { noul: Math.max(0, Math.min(1, a.noul)) };
  }
  const inputTokens = Number(value?.usage?.prompt_tokens) || estimateTokens(JSON.stringify(questions));
  addDecisionTokens(inputTokens, true);
  return { answers, value: { answers }, httpStatus: response.status, inputTokens, model };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Asks the questions of JEV, then the gateway, then the OpenAI decision model. Returns the first
 * answer, or null when none of them answers. `attempts` receives one entry per provider tried.
 */
export async function decide(questions: Record<string, unknown>, state: unknown, timeoutMs: number, attempts?: DecisionAttempt[], allowOpenAi = true): Promise<DecisionResult | null> {
  const jevTargets: { provider: DecisionProvider; url: string; key?: string; model: string }[] = [
    { provider: "jev", url: "https://api.typesafe.ai/v1/systemone", key: process.env.JEV_API_KEY, model: process.env.JEV_MODEL || "jev-latest" },
    { provider: "gateway_jev", url: "https://ai-gateway.vercel.sh/v1/evaluate", key: process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_AI_GATEWAY, model: "typesafe-ai/jev" },
  ];
  const note = (a: DecisionAttempt) => attempts?.push(a);
  const reason = (error: unknown) => String((error as Error)?.message ?? error).slice(0, 200);
  for (const t of jevTargets) {
    if (!t.key) continue;
    const started = Date.now();
    try {
      const out = await jevRequest({ url: t.url, key: t.key, model: t.model }, state, questions, timeoutMs);
      note({ provider: t.provider, model: t.model, status: "ok", duration_ms: Date.now() - started, http_status: out.httpStatus });
      return { answers: out.answers, provider: t.provider, model: t.model, httpStatus: out.httpStatus, inputTokens: out.inputTokens };
    } catch (error) {
      note({ provider: t.provider, model: t.model, status: "error", duration_ms: Date.now() - started, http_status: error instanceof HttpError ? error.httpStatus : null, error: reason(error) });
    }
  }
  if (allowOpenAi && openAiKey()) {
    const started = Date.now();
    try {
      // The fallback gets a little longer: it is only reached after JEV has already used its budget.
      const out = await openAiDecision(state, questions, Math.max(timeoutMs, 6000));
      note({ provider: "openai_decision", model: out.model, status: "ok", duration_ms: Date.now() - started, http_status: out.httpStatus });
      return { answers: out.answers, provider: "openai_decision", model: out.model, httpStatus: out.httpStatus, inputTokens: out.inputTokens };
    } catch (error) {
      note({ provider: "openai_decision", model: DECISION_MODEL(), status: "error", duration_ms: Date.now() - started, http_status: error instanceof HttpError ? error.httpStatus : null, error: reason(error) });
    }
  }
  return null;
}
