// @edks/sdk: a small client for the EDK API (https://api.edk.earth/v1). No dependencies.
const DEFAULT_BASE = "https://api.edk.earth";

export class EDKError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "EDKError";
    this.status = status;
    this.body = body;
  }
}

const env = (name) => (typeof process !== "undefined" && process.env ? process.env[name] : undefined);

export class EDK {
  /** @param {{ apiKey?: string, baseUrl?: string, fetch?: typeof fetch, client?: string }} [options] */
  constructor(options = {}) {
    this.apiKey = options.apiKey ?? env("EDK_API_KEY");
    this.baseUrl = (options.baseUrl ?? env("EDK_BASE_URL") ?? DEFAULT_BASE).replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.client = options.client ?? "sdk";
    if (!this.apiKey) throw new EDKError("Missing API key. Pass { apiKey } or set EDK_API_KEY. Create one at https://edk.earth/console/keys", 401);
    this.trends = {
      search: (q) => this.get("/v1/trends/search", { q }),
      regions: (params) => this.get("/v1/trends/regions", params),
      series: ({ feature, regions, tf = "monthly" }) => this.get("/v1/trends/series", { feature, regions: Array.isArray(regions) ? regions.join(",") : regions, tf }),
    };
  }

  /** Low-level request. */
  async request(method, path, { query, body } = {}) {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    const res = await this.fetchImpl(url, {
      method,
      headers: { authorization: `Bearer ${this.apiKey}`, "x-edk-client": this.client, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: text };
    }
    if (!res.ok) throw new EDKError(data?.error || `EDK request failed (${res.status})`, res.status, data);
    return data;
  }

  get(path, query) {
    return this.request("GET", path, { query });
  }

  /** Ask a question in plain words. Returns { id, embed_url, usage, data }. */
  search(query, options = {}) {
    return this.request("POST", "/v1/search", { body: { query, ...options } });
  }

  /** A stored search result you created (free). */
  result(id) {
    return this.get(`/v1/search/${encodeURIComponent(id)}`);
  }

  /** Everything known about the small area at a point. */
  inspect({ lat, lng }) {
    return this.get("/v1/inspect", { lat, lng });
  }

  /** Regions by name ({ q, type }), slug, id, or containing a point ({ lat, lng }). */
  regions(params) {
    return this.get("/v1/regions", params);
  }

  /** Addresses and places for text. */
  geocode(q) {
    return this.get("/v1/geocode", { q });
  }

  /** What EDK can find ({ q, type, slug }). */
  catalog(params = {}) {
    return this.get("/v1/catalog", params);
  }

  /** Sources behind area facts ({ keys: "elevation_m,flood_zone" }). */
  sources(params) {
    return this.get("/v1/sources", params);
  }

  /** Balance, this month's usage and limits. */
  usage() {
    return this.get("/v1/usage");
  }
}

export default EDK;
