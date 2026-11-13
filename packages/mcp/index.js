#!/usr/bin/env node
// @edks/mcp: the EDK MCP server (stdio). Gives agents tools for questions about the physical world.
// Needs EDK_API_KEY (create one at https://edk.earth/console/keys). No dependencies.
import { createInterface } from "node:readline";

const VERSION = "0.1.0";
const BASE = (process.env.EDK_BASE_URL || "https://api.edk.earth").replace(/\/+$/, "");
const KEY = process.env.EDK_API_KEY || "";

async function api(method, path, { query, body } = {}) {
  if (!KEY) throw new Error("EDK_API_KEY is not set. Create a key at https://edk.earth/console/keys and add it to this MCP server's env.");
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${KEY}`, "x-edk-client": "mcp", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `EDK request failed (${res.status})`);
  return data;
}

/** A compact view of a search for the model: the answer, usage, the map link, and slim results. */
function summarizeSearch(r) {
  const features = r.data?.geojson?.features ?? [];
  return {
    id: r.id,
    embed_url: r.embed_url,
    usage: r.usage,
    answer: r.data?.answer ?? null,
    region: r.data?.region?.name ?? r.data?.regions?.[0]?.name ?? null,
    results: features.map((f, i) => {
      const p = f.properties ?? {};
      const out = { n: i + 1, title: p.address || p.name || p.feature_name || "Result", kind: p.kind === "area" ? "area" : p.feature_name || null, lat: f.geometry?.coordinates?.[1] ?? null, lng: f.geometry?.coordinates?.[0] ?? null };
      for (const k of ["neighborhood", "district", "date", "description", "image_url", "h3"]) if (p[k]) out[k] = p[k];
      return out;
    }),
    ...(r.data?.trends ? { trends: r.data.trends } : {}),
  };
}

const TOOLS = [
  {
    name: "edk_search",
    description: "Ask EDK a question about the physical world in plain words: located things (bridges, potholes, solar farms, parks), areas that meet conditions (income, flood zone, elevation, tree canopy), or amounts over time. Returns a short answer, results with coordinates and CDN image URLs, CU used, and an embed_url that shows the results on the EDK Atlas map. Each CU covers five locations or areas returned.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The question, e.g. 'bridges in Pittsburgh' or 'is 1595 Kelvinway Lane in a flood zone?'" },
        limit: { type: "integer", minimum: 1, maximum: 60, description: "Most results to return (default 10)." },
        areas: { type: "array", items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 }, description: "Up to 4 [lng, lat] points to search around." },
        answer: { type: "boolean", description: "Include a written answer (default true)." },
      },
      required: ["query"],
    },
    run: async (a) => summarizeSearch(await api("POST", "/v1/search", { body: { query: a.query, limit: a.limit ?? 10, areas: a.areas, answer: a.answer } })),
  },
  {
    name: "edk_inspect",
    description: "Everything known about the small area at a coordinate: city, county, state, highlights (income, population, elevation, flood risk, tree canopy, air quality) and all available facts by category. Counts as one location (0.2 CU).",
    inputSchema: { type: "object", properties: { lat: { type: "number" }, lng: { type: "number" } }, required: ["lat", "lng"] },
    run: (a) => api("GET", "/v1/inspect", { query: { lat: a.lat, lng: a.lng } }),
  },
  {
    name: "edk_regions",
    description: "Find regions (countries, states, counties, cities) by name, or the regions containing a point. Free.",
    inputSchema: { type: "object", properties: { q: { type: "string" }, type: { type: "string", enum: ["country", "state", "county", "city"] }, lat: { type: "number" }, lng: { type: "number" } } },
    run: (a) => api("GET", "/v1/regions", { query: a }),
  },
  {
    name: "edk_geocode",
    description: "Addresses and places for text, with coordinates.",
    inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
    run: (a) => api("GET", "/v1/geocode", { query: { q: a.q } }),
  },
  {
    name: "edk_catalog",
    description: "The kinds of located things EDK can find, with descriptions. Free.",
    inputSchema: { type: "object", properties: { q: { type: "string" }, type: { type: "string", enum: ["object", "event", "condition", "material", "organism"] } } },
    run: (a) => api("GET", "/v1/catalog", { query: a }),
  },
  {
    name: "edk_trends",
    description: "Counts over time for a feature. Give q to find features, feature + type for where it is most common, or feature + regions (slugs, comma separated) + tf (year, monthly, weekly) for a series.",
    inputSchema: { type: "object", properties: { q: { type: "string" }, feature: { type: "string" }, type: { type: "string" }, regions: { type: "string" }, tf: { type: "string", enum: ["year", "monthly", "weekly"] } } },
    run: (a) => (a.regions ? api("GET", "/v1/trends/series", { query: { feature: a.feature, regions: a.regions, tf: a.tf ?? "monthly" } }) : a.feature ? api("GET", "/v1/trends/regions", { query: { feature: a.feature, type: a.type } }) : api("GET", "/v1/trends/search", { query: { q: a.q } })),
  },
  {
    name: "edk_usage",
    description: "The account's CU balance, this month's usage and limits.",
    inputSchema: { type: "object", properties: {} },
    run: () => api("GET", "/v1/usage"),
  },
];

const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    return reply(id, {
      protocolVersion: params?.protocolVersion || "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "edk", title: "EDK: Compass for Machines", version: VERSION },
      instructions: "EDK answers questions about the physical world. Use edk_search for most questions; share its embed_url so the user can see results on the EDK Atlas. Each CU covers five locations or areas returned.",
    });
  }
  if (method === "ping") return reply(id, {});
  if (method === "tools/list") return reply(id, { tools: TOOLS.map(({ run, ...t }) => t) });
  if (method === "tools/call") {
    const tool = TOOLS.find((t) => t.name === params?.name);
    if (!tool) return fail(id, -32602, `Unknown tool: ${params?.name}`);
    try {
      const result = await tool.run(params?.arguments ?? {});
      return reply(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result });
    } catch (error) {
      return reply(id, { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true });
    }
  }
  if (id !== undefined && id !== null) return fail(id, -32601, `Method not found: ${method}`);
  // Notifications (initialized, cancelled…) need no reply.
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return fail(null, -32700, "Parse error");
  }
  for (const m of Array.isArray(msg) ? msg : [msg]) handle(m).catch((e) => fail(m?.id ?? null, -32603, String(e?.message || e)));
});
