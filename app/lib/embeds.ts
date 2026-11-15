// Embeds (client-safe): what a map load costs, the default limits, and the site presets offered in the console.
import { UNITS_PER_CU } from "./pricing";

/** Each map load is 0.2 CU (one unit), billed to the key or result owner. */
export const LOAD_UNITS = 1;
export const LOAD_CU = LOAD_UNITS / UNITS_PER_CU;
/** Loads a day, per embed key, unless the owner sets another limit. */
export const DEFAULT_EMBED_DAILY = 1000;
export const MAX_EMBED_DAILY = 100_000;
/** Loads a day, across all shared result links of one account, unless the owner sets another limit. */
export const DEFAULT_RESULT_DAILY = 2000;
/** Loads a day from one visitor: per embed key, and per result link. Stops one browser from looping. */
export const EMBED_PER_VISITOR = 100;
export const RESULT_PER_VISITOR = 30;

/** Where agents show maps: ChatGPT and Claude render pages from these origins. */
export const SITE_PRESETS: { id: string; label: string; origins: string[]; note: string }[] = [
  { id: "chatgpt", label: "ChatGPT", origins: ["https://chatgpt.com", "https://*.oaiusercontent.com"], note: "Canvas and apps in ChatGPT" },
  { id: "claude", label: "Claude", origins: ["https://claude.ai", "https://*.claudeusercontent.com"], note: "Artifacts in Claude" },
  { id: "local", label: "This computer", origins: ["http://localhost", "http://127.0.0.1"], note: "Any port, for development" },
];

/** "example.com" → "https://example.com"; returns null when it is not a site. */
export function normalizeOrigin(input: string): string | null {
  let v = input.trim().replace(/\/+$/, "");
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = `${/^(localhost|127\.0\.0\.1|\d+\.\d+\.\d+\.\d+)(:\d+)?$/i.test(v) ? "http" : "https"}://${v}`;
  const m = v.match(/^(https?):\/\/(\*\.)?([a-z0-9.-]+)(:\d{1,5})?$/i);
  if (!m) return null;
  if (m[2] && !m[3].includes(".")) return null;
  return `${m[1].toLowerCase()}://${m[2] ?? ""}${m[3].toLowerCase()}${m[4] ?? ""}`;
}
