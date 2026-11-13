// Embed sessions: embed.edk.earth/?q=…&key=edk_pk_… is checked once, server side, against the key's
// allowed origins (from the embedding page's Referer). The page then gets a short-lived signed token
// for its searches, so the publishable key itself is never sent again from the browser.
import { createHmac } from "node:crypto";
import { findApiKey, originAllowed, type ApiKeyRow } from "./store";

const secret = () => process.env.CDN_SIGNING_KEY || process.env.BETTER_AUTH_SECRET || "edk-dev";
const TTL_MS = 30 * 60_000;

const sign = (payload: string) => createHmac("sha256", `${secret()}:embed`).update(payload).digest("base64url").slice(0, 32);

export async function openEmbed(db: D1Database, key: string, referer: string | null) {
  const row = await findApiKey(db, key);
  if (!row) return { error: "This embed key is not valid." as const };
  if (row.kind !== "publishable") return { error: "Use a publishable key (edk_pk_…) in embeds, never a secret key." as const };
  const origin = referer ? safeOrigin(referer) : null;
  if (!originAllowed(row, origin)) return { error: "This site is not allowed to use this embed key." as const };
  const exp = Date.now() + TTL_MS;
  const payload = `${row.id}.${row.user_id}.${exp}`;
  return { token: `${payload}.${sign(payload)}`, key: row };
}

export function verifyEmbedToken(token: unknown): { keyId: string; userId: string } | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [keyId, userId, exp, sig] = parts;
  if (Number(exp) < Date.now()) return null;
  if (sign(`${keyId}.${userId}.${exp}`) !== sig) return null;
  return { keyId, userId };
}

function safeOrigin(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export type { ApiKeyRow };
