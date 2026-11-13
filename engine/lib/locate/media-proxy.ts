import { createHmac } from "node:crypto";

// Media in results is served from cdn.edk.earth: /i/<sig>/<base64url(source)>. The signature (an HMAC
// of the source URL) keeps the CDN from being used as an open proxy.
const cdnBase = () => (process.env.CDN_URL || "https://cdn.edk.earth").replace(/\/+$/, "");
const secret = () => process.env.CDN_SIGNING_KEY || process.env.BETTER_AUTH_SECRET || "edk-dev";

export function signMedia(source: string) {
  return createHmac("sha256", secret()).update(source).digest("base64url").slice(0, 22);
}

export function mediaProxyUrl(value: unknown, _kind: "image" | "video") {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const source = url.toString();
    if (source.startsWith(cdnBase() + "/")) return source;
    return `${cdnBase()}/i/${signMedia(source)}/${Buffer.from(source).toString("base64url")}`;
  } catch {
    return null;
  }
}

/** The source URL behind a CDN path, or null when the signature does not match. */
export function verifyMediaPath(sig: string, encoded: string) {
  try {
    const source = Buffer.from(encoded, "base64url").toString("utf8");
    if (!source.startsWith("https://")) return null;
    return signMedia(source) === sig ? source : null;
  } catch {
    return null;
  }
}
