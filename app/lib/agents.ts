// Agent onboarding: one prompt for any coding agent, plus per-agent MCP setup.
import { FREE_CU } from "./pricing";
export const SITE = "https://edk.earth";
export const API = "https://api.edk.earth";
export const EMBED = "https://embed.edk.earth";

export const PACKAGES = {
  sdk: "@edks/sdk",
  mcp: "@edks/mcp",
  cli: "@edks/cli",
};

export const INSTALL = {
  sdk: `npm install ${PACKAGES.sdk}`,
  mcp: `npx -y ${PACKAGES.mcp}`,
  cli: `npm install -g ${PACKAGES.cli}`,
};

const mcpJson = (wrapper: string) =>
  JSON.stringify({ [wrapper]: { edk: { command: "npx", args: ["-y", PACKAGES.mcp], env: { EDK_API_KEY: "edk_sk_..." } } } }, null, 2);

export type AgentSetup = { id: string; name: string; command?: string; file?: string; config?: string; note?: string };

export const agentSetups: AgentSetup[] = [
  { id: "claude", name: "Claude Code", command: `claude mcp add edk --env EDK_API_KEY=edk_sk_... -- npx -y ${PACKAGES.mcp}`, note: "Or add the same server to .mcp.json in your project. Claude Desktop uses the JSON below in claude_desktop_config.json." },
  { id: "codex", name: "Codex", file: "~/.codex/config.toml", config: `[mcp_servers.edk]\ncommand = "npx"\nargs = ["-y", "${PACKAGES.mcp}"]\nenv = { EDK_API_KEY = "edk_sk_..." }` },
  { id: "cursor", name: "Cursor", file: ".cursor/mcp.json", config: mcpJson("mcpServers") },
  { id: "gemini", name: "Gemini CLI", file: "~/.gemini/settings.json", config: mcpJson("mcpServers") },
];

/** Discover, Inspect, Route, Monitor or Detect, for a model deciding which call to make. */
export const whenToUse = `## Discover, Inspect, Route, Monitor or Detect
EDK-1 has five calls. Pick by what you already have and what you need back.

**Discover** when you have a question and need places. It finds things; you get a list back.
- "bridges in Pittsburgh", "solar farms near Phoenix": things you can see on the ground.
- "high income areas in Denver", "low flood risk with tree canopy in Austin": areas that meet conditions.
- Returns locations and areas with coordinates, imagery and an embed_url that opens them on the Atlas.
- Name the city or region in the query. Set limit to what you will actually use (CU scales with results). Add answer: true only when the user wants a written summary.
- reasoning is "fast" (default), "low", "medium" or "max". Higher levels study the results more closely before returning them, and return a box and a boxed_image_url on the ones they studied. Medium and max cost twice the CU and need Tier 1 and Tier 2. Stay on fast unless the user asks for more care.

**Inspect** when you have a point and need to know about it. It describes one spot; you get facts back.
- "what is at 40.4406, -79.9959", "is this address in a flood zone", "who lives around here".
- Returns the place names, highlights (income, people nearby, elevation, flood risk, tree canopy, air quality) and every known fact by category.
- It takes coordinates, not names. If you only have a name or address, Discover it first and Inspect the coordinates that come back.

**Route** when you have a start and an end and need the way between them.
- "drive from Point State Park to Carnegie Mellon avoiding pothole streets", "walking route from A to B".
- from and to take a place name, an address, or coordinates. include is plain words for what to pass on the way ("a coffee shop"); conditions is plain words for what to stay clear of ("pothole streets"). EDK-1 finds those places along the way and routes through or around them.
- Returns distance, duration, the path as GeoJSON, turn-by-turn steps, what it passes and avoided, and the direct route for comparison.
- Conditions steer driving routes only. Read note and remaining in the response and tell the user when something could not be avoided.

**Monitor** when the user wants to know about new events as they happen, not once.
- "tell me when a building permit is filed in Pittsburgh", "watch for new potholes downtown every hour".
- POST /v1/monitors with artifacts (names or ids from GET /v1/artifacts), an area (a place name or "lat, lng"), since (a date), interval ("15m", "1h", "6h", "1d") and a webhook_url. Events also appear in the console.
- Each new event is 0.2 CU. Monitor is available from Tier 4; a 403 means the account is below it, so say so.

**Detect** when you have an image and need to know what is in it.
- "what is in this photo", "where is the pothole in this frame", "which objects does this street view show".
- POST /v1/detect with image_url (https) or image (base64 JPEG or PNG). max_objects (default 12) caps how many come back.
- Returns objects, each with a label, a probability, a box (top, left, bottom, right as fractions of the image) and pixels (x, y, width, height), plus annotated_image: the picture with the boxes drawn on.
- 1 CU for the image plus 0.2 CU for each object returned. It reads one image; it does not say where on Earth the picture was taken.

Together: Discover to find candidates, Inspect the one or two that matter, Route to the one chosen. Don't Inspect every Discover result, and don't use Discover to describe a single known point.
None of the calls returns live traffic or transit timetables. Say so instead of guessing.`;

export const rulesSnippet = `## EDK (EDK-1 spatial model)
- Questions about places and what is on the ground go to EDK-1 (https://api.edk.earth/v1).
- Discover finds places from a question: POST /v1/discover {query, limit}. Use it when you need a list of locations or areas.
- Inspect describes one point: GET /v1/inspect?lat=&lng=. Use it when you already have coordinates.
- Route finds the way: POST /v1/route {from, to, include?, conditions?}. Use it for directions; include is what to pass, conditions what to avoid.
- Name-only question about one spot: Discover it, then Inspect the coordinates returned.
- Use the edk MCP tools when available; otherwise the ${PACKAGES.sdk} SDK or the REST API with EDK_API_KEY.
- Monitor watches an area for new events: POST /v1/monitors {artifacts, area, since, interval, webhook_url}. Tier 4 and above.
- Detect reads an image: POST /v1/detect {image_url} or {image}. Use it when you have a picture and need the objects in it, with boxes.
- Share results on the Atlas with the embed_url each Discover call returns.
- Docs: https://edk.earth/docs`;

/** The platforms the onboarding prompt is written for. Each one gets its own prompt. */
export type AgentTarget = "claude-code" | "codex" | "cursor" | "gemini" | "claude" | "chatgpt";
export const AGENT_TARGETS: { id: AgentTarget; name: string; kind: string }[] = [
  { id: "claude-code", name: "Claude Code", kind: "Terminal agent" },
  { id: "codex", name: "Codex", kind: "Terminal agent" },
  { id: "cursor", name: "Cursor", kind: "Editor agent" },
  { id: "gemini", name: "Gemini CLI", kind: "Terminal agent" },
  { id: "claude", name: "Claude", kind: "Desktop app" },
  { id: "chatgpt", name: "ChatGPT", kind: "Chat, nothing to install" },
];
export const isAgentTarget = (v: unknown): v is AgentTarget => AGENT_TARGETS.some((t) => t.id === v);

const INTRO = `EDK-1 is a spatial model that gives humans and machines a compass for the world: position, condition, motion, navigation, stream and vision.
Five calls: Discover finds places, Inspect describes a point, Route finds the way, Monitor watches for change, Detect reads an image. Docs: ${SITE}/docs · API: ${API}/v1`;

const REFERENCE = `## Reference
- \`POST /v1/discover\` {query, limit?, reasoning? (fast | low | medium | max), answer? (default false), areas?: [[lng,lat]], focus?} → {id, model, embed_url, usage, data: {geojson, region?, conditions?, answer?}}
- \`GET /v1/inspect?lat=&lng=\` → {model, usage, data: {known, place, highlights, categories, outline}}
- \`POST /v1/route\` {from, to, include?, conditions?, profile?} → {model, usage, data: {from, to, route: {distance_m, duration_s, geometry, steps}, direct?, include?, conditions?, included, avoided, remaining?, note?}}
- \`POST /v1/monitors\` {artifacts, area, since?, interval?, webhook_url?, prompt?, name?} → the monitor, with webhook_secret. \`GET /v1/monitors\`, \`GET /v1/monitors/:id/events\`, \`PATCH\` {status: "paused" | "active"}, \`DELETE\`, \`POST /v1/monitors/:id/scan\`. \`GET /v1/artifacts?q=\` lists what can be watched.
- \`POST /v1/detect\` {image_url | image (base64), max_objects?, threshold?, annotate?} → {model, usage, data: {image: {width, height}, objects: [{label, artifact_id, category, probability, confidence, box, pixels, also?}], annotated_image}}
- \`GET /v1/usage\` balance, tier and limits
- Authenticate with \`Authorization: Bearer $EDK_API_KEY\`. MCP tools: \`edk_discover\`, \`edk_inspect\`, \`edk_route\`, \`edk_monitor_create\`, \`edk_monitor_events\`, \`edk_usage\`.
- \`curl -X POST ${API}/v1/discover -H "Authorization: Bearer $EDK_API_KEY" -H "content-type: application/json" -d '{"query":"bridges in Pittsburgh","limit":5}'\`
- A Compute Unit (CU) is the GPU and CPU work EDK-1 needs to process a request.`;

const ATLAS_LINKS = `- For a places question, give me an Atlas link I can open: \`${SITE}/atlas?q=<url-encoded question>\` (the user signs in with a free account). Example: ${SITE}/atlas?q=bridges%20in%20Pittsburgh`;

/** How each coding agent adds the MCP server, and the rules file it reads. */
const CONNECT: Record<Exclude<AgentTarget, "claude" | "chatgpt">, { how: string; rules: string }> = {
  "claude-code": { how: `Run \`claude mcp add edk --env EDK_API_KEY=$EDK_API_KEY -- npx -y ${PACKAGES.mcp}\`.`, rules: "CLAUDE.md" },
  codex: {
    how: `Add this to \`~/.codex/config.toml\`, leaving the key for me to fill in:\n\n\`\`\`toml\n[mcp_servers.edk]\ncommand = "npx"\nargs = ["-y", "${PACKAGES.mcp}"]\nenv = { EDK_API_KEY = "edk_sk_..." }\n\`\`\``,
    rules: "AGENTS.md",
  },
  cursor: { how: `Add this to \`.cursor/mcp.json\` (or \`~/.cursor/mcp.json\` to keep the key out of the repository), leaving the key for me to fill in:\n\n\`\`\`json\n${mcpJson("mcpServers")}\n\`\`\``, rules: ".cursor/rules/edk.mdc" },
  gemini: { how: `Add this to \`~/.gemini/settings.json\`, leaving the key for me to fill in:\n\n\`\`\`json\n${mcpJson("mcpServers")}\n\`\`\``, rules: "GEMINI.md" },
};

function codingPrompt(target: keyof typeof CONNECT) {
  const name = AGENT_TARGETS.find((t) => t.id === target)!.name;
  const { how, rules } = CONNECT[target];
  return `# Connect EDK-1 to ${name}

${INTRO}

You are ${name}. Work through these steps in order. Check each one, and stop and tell me if a step fails.

1. **Account.** If I don't have one, ask me to sign up at ${SITE}/sign-up (${FREE_CU} free CU every month).
2. **Key.** Ask me to create a secret key at ${SITE}/console/keys and set it in my shell as \`EDK_API_KEY\`. Never ask me to paste the key here, and never commit it.
3. **Connect.** ${how}
   Tell me if I need to restart ${name} for the \`edk\` tools to show up. Do not install the CLI or the SDK unless I ask.
4. **Test.** Discover "parks with playgrounds in Austin" (limit 5), then Inspect the first result's coordinates. Show me the results, the CU used and the embed_url.
5. **Remember.** Add this to \`${rules}\`:

\`\`\`
${rulesSnippet}
\`\`\`

${whenToUse}

${REFERENCE}`;
}

function claudeDesktopPrompt() {
  return `# Connect EDK-1 to Claude

${INTRO}

You are Claude in the desktop app. You cannot edit my config or run commands, so walk me through these steps one at a time and wait for me after each. Do not try to install anything yourself.

1. **Account.** Sign up at ${SITE}/sign-up (${FREE_CU} free CU every month).
2. **Key.** Create a secret key at ${SITE}/console/keys. Keep it out of this chat.
3. **Connect.** Open Settings → Developer → Edit Config and add this to \`claude_desktop_config.json\`, with the key in place of \`edk_sk_...\`:

\`\`\`json
${mcpJson("mcpServers")}
\`\`\`

4. **Restart** Claude. The \`edk\` tools appear in the tools menu.
5. **Test.** Once they do, Discover "parks with playgrounds in Austin" (limit 5) and show me the results and the embed_url.

Until the tools are connected:
${ATLAS_LINKS}

${whenToUse}

${REFERENCE}`;
}

function chatPrompt() {
  return `# Use EDK-1 from ChatGPT

${INTRO}

You are a chat assistant with no terminal. You cannot install packages, set environment variables or keep a key, so do not try to install the CLI, the SDK or an MCP server, and do not ask me for an API key.

${ATLAS_LINKS}
- For directions, describe the Route call and give me the Atlas link, where the Route button in the query bar takes a start, an end, what to pass and what to avoid.
- If I am building something, write the code for me to run myself from the Reference below, reading the key from \`EDK_API_KEY\`.
- If I want EDK-1 connected as tools, point me to ${SITE}/agents for Claude Code, Codex, Cursor, Gemini CLI or the Claude desktop app.

${whenToUse}

${REFERENCE}`;
}

/** The onboarding prompt for one platform, or (with none named) one that works out where it is running. */
export function agentPrompt(target?: AgentTarget | null) {
  if (target === "chatgpt") return chatPrompt();
  if (target === "claude") return claudeDesktopPrompt();
  if (target) return codingPrompt(target);
  return genericPrompt();
}

function genericPrompt() {
  return `# Connect EDK-1

${INTRO}

## First, work out where you are running
Setup depends on what you can do. Decide which of these you are, tell me in one line, and follow only that section.
Do not install anything or run commands unless your section says to.

### A. Chat app with no terminal (ChatGPT, Claude or Gemini in the browser or mobile app)
You cannot install packages, set environment variables or keep a key. Do not try to install the CLI, the SDK or an MCP server, and do not ask me for an API key.
- For a places question, give me an Atlas link I can open: \`${SITE}/atlas?q=<url-encoded question>\` (the user signs in with a free account). Example: ${SITE}/atlas?q=bridges%20in%20Pittsburgh
- If I am building something, write the code for me to run myself using the Reference below, reading the key from \`EDK_API_KEY\`.
- If I want you connected properly, tell me to use a coding agent (section B) or Claude Desktop (section C).
Then skip to "Discover, Inspect, Route or Monitor".

### B. Coding agent with a terminal
1. **Account.** If I don't have one, ask me to sign up at ${SITE}/sign-up (${FREE_CU} free CU every month).
2. **Key.** Ask me to create a secret key at ${SITE}/console/keys and set it in my shell as \`EDK_API_KEY\`. Never ask me to paste the key here, and never commit it. Check it is set before going on.
3. **Connect** the MCP server the way your client does it, then tell me if a restart is needed:
   - **Claude Code:** run \`claude mcp add edk --env EDK_API_KEY=$EDK_API_KEY -- npx -y ${PACKAGES.mcp}\`. Rules file: \`CLAUDE.md\`.
   - **Codex:** add to \`~/.codex/config.toml\`:
     \`[mcp_servers.edk]\` · \`command = "npx"\` · \`args = ["-y", "${PACKAGES.mcp}"]\` · \`env = { EDK_API_KEY = "<key>" }\`. Rules file: \`AGENTS.md\`.
   - **Cursor:** add an \`edk\` entry under \`mcpServers\` in \`.cursor/mcp.json\` with command \`npx\`, args \`["-y", "${PACKAGES.mcp}"]\` and env \`EDK_API_KEY\`. Rules: \`.cursor/rules\`.
   - **Gemini CLI:** the same \`mcpServers\` entry in \`~/.gemini/settings.json\`. Rules file: \`GEMINI.md\`.
   - **Another agent, or no MCP support:** use the SDK in code (\`npm install ${PACKAGES.sdk}\`) or call the REST API. Install the CLI (\`npm install -g ${PACKAGES.cli}\`) only if I ask for EDK in my own terminal.
   Config files hold the key in plain text: write them outside the repository or leave the value for me to fill in.
4. **Test.** Discover "parks with playgrounds in Austin" (limit 5), then Inspect the first result's coordinates. Show me the results, the CU used and the embed_url.
5. **Remember.** Add this to the rules file named for your client above:

\`\`\`
${rulesSnippet}
\`\`\`

### C. Claude Desktop (chat app that supports local MCP servers)
You cannot edit my config yourself. Give me these steps: sign up and create a key (steps 1 and 2 above), open Settings → Developer → Edit Config, add an \`edk\` entry under \`mcpServers\` with command \`npx\`, args \`["-y", "${PACKAGES.mcp}"]\` and env \`EDK_API_KEY\`, then restart the app. Until then, behave as in section A.

${whenToUse}

${REFERENCE}`;
}

export function llmsTxt() {
  return `# EDK

> EDK-1 is a spatial model that gives humans and machines a compass for the world: position, condition, motion, navigation, stream and vision. Find places, understand any spot, route between them and watch for change, through one API.

- [Model](${SITE}/model): position, condition, motion, navigation, stream and vision, the six primitives EDK-1 is built on
- [Docs](${SITE}/docs): Discover, Inspect, Route, Monitor, Detect, reasoning, Compute Units, tiers, embeds, SDK, CLI and MCP
- [Agent setup](${SITE}/agents.md): a prompt that connects an agent to EDK-1. Add ?for=claude-code, codex, cursor, gemini, claude or chatgpt for one platform
- [Atlas](${SITE}/atlas): EDK-1 on a map, for signed-in accounts
- [API](${API}/v1): base URL; authenticate with Authorization: Bearer edk_sk_…

${whenToUse}

## If you are a chat assistant without a terminal
Do not install the CLI, SDK or MCP server and do not ask for an API key. Send the user an Atlas link instead: ${SITE}/atlas?q=<url-encoded question>
`;
}
