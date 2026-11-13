// Agent onboarding: one prompt for any coding agent, plus per-agent MCP setup.
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

export const rulesSnippet = `## EDK (physical-world data)
- Questions about places, imagery, areas, hazards, demographics or trends go to EDK (https://api.edk.earth/v1).
- Use the edk MCP tools when available; otherwise the ${PACKAGES.sdk} SDK or the REST API with EDK_API_KEY.
- Show results on the EDK Atlas with the embed_url each search returns (https://embed.edk.earth/r/<id>).
- Docs: https://edk.earth/docs`;

export function agentPrompt() {
  return `# Connect EDK: Compass for Machines

EDK answers questions about the physical world (located things, imagery, area attributes, trends) through one API.
Docs: ${SITE}/docs · API: ${API}/v1 · Atlas: ${EMBED}

Work through these steps in order. Check each one before moving on, and stop and tell me if a step fails.

1. **Account.** If I don't have one yet, ask me to sign up at ${SITE}/sign-up (new accounts get 500 free CU).
2. **API key.** Ask me to create a secret key at ${SITE}/console/keys and set it as the environment variable \`EDK_API_KEY\`.
   Never ask me to paste the key into this chat, and never write it into a file that is committed.
3. **Connect.** Add the EDK MCP server to this agent:
   - Command: \`npx -y ${PACKAGES.mcp}\` with env \`EDK_API_KEY\`.
   - Claude Code: \`claude mcp add edk --env EDK_API_KEY=$EDK_API_KEY -- npx -y ${PACKAGES.mcp}\`
   - Codex, Cursor and Gemini CLI: add an \`edk\` server with that command to their MCP config (${SITE}/agents shows each file).
   If MCP is not available, use the SDK (\`npm install ${PACKAGES.sdk}\`) or call the REST API directly:
   \`curl -X POST ${API}/v1/search -H "Authorization: Bearer $EDK_API_KEY" -H "content-type: application/json" -d '{"query":"bridges in Pittsburgh","limit":5}'\`
4. **Test.** Run one search (for example "parks with playgrounds in Austin", limit 5) and show me the answer, the number of results, the CU used and the embed_url.
5. **Remember.** Add this to CLAUDE.md, AGENTS.md or this project's rules file:

\`\`\`
${rulesSnippet}
\`\`\`

## Reference
- \`POST /v1/search\` {query, limit (1–60, default 20), areas?: [[lng,lat]], focus?: region id, answer?: boolean} → {id, embed_url, usage, data: {answer, geojson, regions, filters, trends?}}
- \`GET /v1/inspect?lat=&lng=\` everything known about the area at a point
- \`GET /v1/regions?q=\` · \`GET /v1/geocode?q=\` · \`GET /v1/catalog?q=\` · \`GET /v1/trends/series?feature=&regions=&tf=\` · \`GET /v1/usage\`
- Images in results are served from https://cdn.edk.earth.
- Billing: one CU covers five locations or areas returned. A search never returns more than the balance covers.
`;
}

export function llmsTxt() {
  return `# EDK

> Compass for Machines: one API for questions about the physical world (imagery, places, civic records, area attributes and trends), with the embeddable EDK Atlas.

- [Docs](${SITE}/docs): the REST API, SDK, CLI, MCP, embeds and billing
- [Agent setup](${SITE}/agents.md): a prompt that connects any coding agent to EDK
- [Atlas](${EMBED}): EDK on a map, free to use
- [API](${API}/v1): base URL; authenticate with Authorization: Bearer edk_sk_…
`;
}
