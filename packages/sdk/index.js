// @edks/sdk: a small client for EDK-1 (https://api.edk.earth/v1). No dependencies.
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

  /** Discover places: a question in plain words. Returns { id, model, embed_url, usage, data }. */
  discover(query, options = {}) {
    return this.request("POST", "/v1/discover", { body: { query, ...options } });
  }

  /** Inspect a point: what is known about the area there. */
  inspect({ lat, lng }) {
    return this.request("GET", "/v1/inspect", { query: { lat, lng } });
  }

  /**
   * Route from A to B, passing what you include and around what you ask it to avoid.
   * `from` and `to` are [lng, lat], {lat, lng}, "lat, lng", or a place name or address.
   * @param {{ from: any, to: any, include?: string, conditions?: string, profile?: "driving" | "walking" | "cycling" }} options
   */
  route(options) {
    return this.request("POST", "/v1/route", { body: options });
  }

  /** Monitor: watch an area for new events of chosen artifacts (Tier 4 and above). */
  get monitors() {
    const r = (method, path, init) => this.request(method, path, init);
    return {
      /** @param {{ artifacts: string[], area: any, since?: string, interval?: string | number, webhook_url?: string, prompt?: string, name?: string }} options */
      create: (options) => r("POST", "/v1/monitors", { body: options }),
      list: () => r("GET", "/v1/monitors"),
      get: (id) => r("GET", `/v1/monitors/${encodeURIComponent(id)}`),
      update: (id, patch) => r("PATCH", `/v1/monitors/${encodeURIComponent(id)}`, { body: patch }),
      pause: (id) => r("PATCH", `/v1/monitors/${encodeURIComponent(id)}`, { body: { status: "paused" } }),
      resume: (id) => r("PATCH", `/v1/monitors/${encodeURIComponent(id)}`, { body: { status: "active" } }),
      delete: (id) => r("DELETE", `/v1/monitors/${encodeURIComponent(id)}`),
      scan: (id) => r("POST", `/v1/monitors/${encodeURIComponent(id)}/scan`),
      events: (id, { after, limit } = {}) => r("GET", `/v1/monitors/${encodeURIComponent(id)}/events`, { query: { after, limit } }),
    };
  }

  /** Artifacts by name: what Discover finds and what Monitor can watch. */
  artifacts(q = "") {
    return this.request("GET", "/v1/artifacts", { query: { q } });
  }

  /** A stored Discover result you created (free). */
  result(id) {
    return this.request("GET", `/v1/discover/${encodeURIComponent(id)}`);
  }

  /** Balance, tier and limits. */
  usage() {
    return this.request("GET", "/v1/usage");
  }

  /** @deprecated Use discover(). */
  search(query, options = {}) {
    return this.discover(query, options);
  }
}

export default EDK;
