// Token accounting for one search request. Every decision call (JEV, or its OpenAI fallback) and the
// answer call add to a per-request tally, which SearchLog writes to stream_logs when the search ends.
// AsyncLocalStorage carries the tally through the request, so call sites need no extra parameters.
import { AsyncLocalStorage } from "node:async_hooks";

export type TokenTally = {
  /** Input tokens of every decision call (routing, attribute gates, source gate, context gate…). */
  decisionInput: number;
  decisionCalls: number;
  /** How many of those calls fell back to the OpenAI decision model. */
  decisionFallbacks: number;
  answerInput: number;
  answerOutput: number;
};

const store = new AsyncLocalStorage<TokenTally>();

export const newTally = (): TokenTally => ({ decisionInput: 0, decisionCalls: 0, decisionFallbacks: 0, answerInput: 0, answerOutput: 0 });

/** Runs a request with its own tally. */
export function withTokenTally<T>(tally: TokenTally, fn: () => Promise<T>): Promise<T> {
  return store.run(tally, fn);
}

const count = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);
/** About four characters per token, for providers that report no usage. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export function addDecisionTokens(input: unknown, fallback = false) {
  const tally = store.getStore();
  if (!tally) return;
  tally.decisionInput += count(input);
  tally.decisionCalls += 1;
  if (fallback) tally.decisionFallbacks += 1;
}

export function addAnswerTokens(input: unknown, output: unknown) {
  const tally = store.getStore();
  if (!tally) return;
  tally.answerInput += count(input);
  tally.answerOutput += count(output);
}
