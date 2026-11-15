#!/usr/bin/env node
// @edks/mcp: the EDK-1 MCP server (stdio). Gives agents a compass: Discover places and Inspect any spot.
// Needs EDK_API_KEY (create one at https://edk.earth/console/keys). No dependencies.
import { createInterface } from "node:readline";

const VERSION = "0.6.1";
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

/** A compact view of a Discover result for the model. */
function summarizeDiscover(r) {
  const features = r.data?.geojson?.features ?? [];
  return {
    id: r.id,
    model: r.model,
    embed_url: r.embed_url,
    usage: r.usage,
    ...(r.reasoning ? { reasoning: r.reasoning } : {}),
    ...(r.data?.answer ? { answer: r.data.answer } : {}),
    ...(r.data?.region ? { region: r.data.region.name } : {}),
    results: features.map((f, i) => {
      const p = f.properties ?? {};
      const out = { n: i + 1, kind: p.kind, title: p.name || p.address || p.feature_name || "Result", lat: f.geometry?.coordinates?.[1] ?? null, lng: f.geometry?.coordinates?.[0] ?? null };
      for (const k of ["feature_name", "neighborhood", "district", "date", "description", "image_url", "boxed_image_url", "facts"]) if (p[k]) out[k] = p[k];
      if (typeof p.distance === "number") out.distance = p.distance;
      if (p.insight) out.insight = p.insight;
      return out;
    }),
  };
}

const TOOLS = [
  {
    name: "edk_discover",
    description: "Find anything visible on Earth with EDK-1, a foundation model of the physical world trained on 30 billion images. Ask in plain words for objects (graffiti, solar panels, bridges), conditions (damaged roofs, boarded windows, potholes), events (crashes, new construction) or nature (wildlife, plants, sightings), or for areas by measured conditions (flood risk, income, tree canopy). Returns each result with coordinates and its photo (studied results add boxed_image_url; raise reasoning to study more), CU used, and an embed_url that opens them on the EDK Atlas.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The question, e.g. 'bridges in Pittsburgh'." },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "Most results (default 10; capped by the account's tier)." },
        answer: { type: "boolean", description: "Add a short written answer (default false)." },
        reasoning: { type: "string", enum: ["fast", "low", "medium", "max"], description: "How closely to study the results before returning them (default fast). Higher levels return boxed_image_url on studied results; medium and max cost twice the CU and need Tier 1 and Tier 2. Stay on fast unless the user asks for more care." },
        areas: { type: "array", items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 }, description: "Up to 4 [lng, lat] points to search around." },
      },
      required: ["query"],
    },
    run: async (a) => summarizeDiscover(await api("POST", "/v1/discover", { body: { query: a.query, limit: a.limit ?? 10, answer: a.answer, areas: a.areas, ...(a.reasoning ? { reasoning: a.reasoning } : {}) } })),
  },
  {
    name: "edk_inspect",
    description: "Read what's true at any coordinate with EDK-1: terrain, hazards, climate and who lives there, plus every known fact by category.",
    inputSchema: { type: "object", properties: { lat: { type: "number" }, lng: { type: "number" } }, required: ["lat", "lng"] },
    run: (a) => api("GET", "/v1/inspect", { query: { lat: a.lat, lng: a.lng } }),
  },
  {
    name: "edk_route",
    description: "Get from A to B with EDK-1 around what you name, like potholed streets, construction or crash-prone intersections, and past what you want to see. from and to take a place name, an address, or \"lat, lng\". Returns distance, duration, the path as GeoJSON, turn-by-turn steps, what was avoided, and the direct route for comparison.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start: a place name, an address, or \"lat, lng\"." },
        to: { type: "string", description: "End: a place name, an address, or \"lat, lng\"." },
        include: { type: "string", description: "What to pass on the way, in plain words, like \"a coffee shop\" or \"scenic overlooks\". Optional." },
        conditions: { type: "string", description: "What to stay clear of, in plain words. Optional." },
        profile: { type: "string", enum: ["driving", "walking", "cycling"], description: "Default driving. Conditions steer driving routes only." },
      },
      required: ["from", "to"],
    },
    run: (a) => api("POST", "/v1/route", { body: { from: a.from, to: a.to, include: a.include, conditions: a.conditions, profile: a.profile } }),
  },
  {
    name: "edk_monitor_create",
    description: "Watch a place with EDK-1 and get each new sighting or event by webhook and in the EDK console the moment it appears. Use when the user wants to be told about change, not answered once. Tier 4 and above; each event is 0.2 CU.",
    inputSchema: {
      type: "object",
      properties: {
        artifacts: { type: "array", items: { type: "string" }, description: "Up to five artifact names or ids, like [\"Building Permit\"]." },
        area: { type: "string", description: "A place name like \"Pittsburgh\", or \"lat, lng\"." },
        since: { type: "string", description: "Report events after this date, YYYY-MM-DD. Default: a week ago." },
        interval: { type: "string", enum: ["15m", "1h", "6h", "1d"], description: "How often to scan. Default 1h." },
        webhook_url: { type: "string", description: "A public https URL to receive events. Optional." },
        prompt: { type: "string", description: "What matters about these events. Saved; not used to filter yet." },
      },
      required: ["artifacts", "area"],
    },
    run: (a) => api("POST", "/v1/monitors", { body: a }),
  },
  {
    name: "edk_monitor_events",
    description: "List the user's monitors, or the new events one monitor found (pass monitor_id).",
    inputSchema: { type: "object", properties: { monitor_id: { type: "string" }, limit: { type: "number" } } },
    run: (a) => (a.monitor_id ? api("GET", `/v1/monitors/${encodeURIComponent(a.monitor_id)}/events`, { query: { limit: a.limit } }) : api("GET", "/v1/monitors")),
  },
  {
    name: "edk_usage",
    description: "The account's CU balance, tier and limits.",
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
      serverInfo: { name: "edk", title: "EDK-1: Compass for Machines", version: VERSION },
      instructions: "EDK-1 is a foundation model of the physical world. Trained on 30 billion images, it sees the planet street by street, so you can find anything visible on Earth, read what's true there, route around it, and get alerted the moment it changes. Use EDK when a task depends on what the real world looks like. edk_discover: objects, conditions, events or nature, or areas by measured conditions like flood risk, income or tree canopy, each with its photo. edk_inspect: what's true at any coordinate, from terrain and hazards to who lives there. edk_route: A to B around what you name. edk_monitor_create: watch a place and get each new sighting by webhook. Share the embed_url so the user can see results on the EDK Atlas.",
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
