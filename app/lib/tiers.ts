// Tiers (client-safe). Credits added to an account over its lifetime unlock a tier; tiers raise how many
// results one request may return, how many requests may run at once and how much reasoning Discover may
// use. Usage is always paid in CU.

export type TierId = "community" | "tier1" | "tier2" | "tier3" | "tier4" | "tier5";

export type Tier = {
  id: TierId;
  name: string;
  /** Lifetime credits added to unlock, in dollars. null = by agreement. */
  unlockDollars: number | null;
  /** Most results one Discover request may return. */
  maxResults: number;
  /** Requests that may run at once. */
  concurrency: number;
  /** API requests per minute, across all of an account's keys. Each value needs a matching rate limit binding in wrangler.json. */
  requestsPerMinute: number;
  /** The highest Discover reasoning level. */
  reasoning: ReasoningId;
};

export type ReasoningId = "fast" | "low" | "medium" | "max";

export type Reasoning = {
  id: ReasoningId;
  name: string;
  /** One line for pickers and docs. */
  does: string;
  /** How many leading results are studied before they are returned. */
  depth: number;
  /** What a result costs, as a multiple of the standard price. */
  cost: number;
};

/** Discover reasoning: how closely EDK-1 studies its results before returning them. Lowest first. */
export const REASONING: Reasoning[] = [
  { id: "fast", name: "Fast", does: "Answers in an instant.", depth: 3, cost: 1 },
  { id: "low", name: "Low", does: "A steadier, surer read.", depth: 3, cost: 1 },
  { id: "medium", name: "Medium", does: "More robust and more precise, with more compute behind it.", depth: 20, cost: 2 },
  { id: "max", name: "Max", does: "The most powerful and accurate, with the most compute.", depth: Infinity, cost: 2 },
];
export const DEFAULT_REASONING: ReasoningId = "fast";

export const reasoningById = (id: unknown) => REASONING.find((level) => level.id === id) ?? null;
/** Whether a tier may use a reasoning level. */
export const reasoningAllowed = (tier: Tier, id: ReasoningId) => REASONING.findIndex((level) => level.id === id) <= REASONING.findIndex((level) => level.id === tier.reasoning);
/** The first tier that offers a reasoning level. */
export const tierForReasoning = (id: ReasoningId) => TIERS.find((tier) => reasoningAllowed(tier, id)) ?? TIERS[TIERS.length - 1];

export const TIERS: Tier[] = [
  { id: "community", name: "Community", unlockDollars: 0, maxResults: 3, concurrency: 1, requestsPerMinute: 60, reasoning: "low" },
  { id: "tier1", name: "Tier 1", unlockDollars: 20, maxResults: 50, concurrency: 3, requestsPerMinute: 120, reasoning: "medium" },
  { id: "tier2", name: "Tier 2", unlockDollars: 100, maxResults: 100, concurrency: 10, requestsPerMinute: 300, reasoning: "max" },
  { id: "tier3", name: "Tier 3", unlockDollars: 500, maxResults: 200, concurrency: 25, requestsPerMinute: 600, reasoning: "max" },
  { id: "tier4", name: "Tier 4", unlockDollars: 1000, maxResults: 200, concurrency: 50, requestsPerMinute: 1200, reasoning: "max" },
  { id: "tier5", name: "Tier 5", unlockDollars: null, maxResults: 200, concurrency: 100, requestsPerMinute: 3000, reasoning: "max" },
];

/** The tier unlocked by a lifetime total of credits added, in dollars. Tier 5 is by agreement. */
export function tierFor(dollars: number): Tier {
  return [...TIERS].reverse().find((t) => t.unlockDollars !== null && dollars >= t.unlockDollars) ?? TIERS[0];
}

export function nextTier(tier: Tier): Tier | null {
  const next = TIERS[TIERS.findIndex((t) => t.id === tier.id) + 1];
  return next && next.unlockDollars !== null ? next : null;
}

/** Results verified with a bounding box per Discover request, from Tier 2 up. */
export const VERIFIED_RESULTS = 10;
const VERIFY_FROM: TierId = "tier2";

/** How many leading Discover results a tier verifies (a box must be found on the picture, or the result is dropped). */
export function verifyCountFor(tier: Tier) {
  return TIERS.findIndex((t) => t.id === tier.id) >= TIERS.findIndex((t) => t.id === VERIFY_FROM) ? VERIFIED_RESULTS : 0;
}
