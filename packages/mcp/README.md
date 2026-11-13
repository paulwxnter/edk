# @edks/mcp

The EDK MCP server. It gives coding agents tools for questions about the physical world: `edk_search`, `edk_inspect`, `edk_regions`, `edk_geocode`, `edk_catalog`, `edk_trends` and `edk_usage`. Search results include an `embed_url` that shows them on the EDK Atlas.

1. Sign up at https://edk.earth (500 free CU) and create a secret key in Console → API Keys.
2. Add the server to your agent with `EDK_API_KEY` set.

**Claude Code**

```sh
claude mcp add edk --env EDK_API_KEY=edk_sk_... -- npx -y @edks/mcp
```

**Codex** (`~/.codex/config.toml`)

```toml
[mcp_servers.edk]
command = "npx"
args = ["-y", "@edks/mcp"]
env = { EDK_API_KEY = "edk_sk_..." }
```

**Cursor** (`.cursor/mcp.json`) and **Gemini CLI** (`~/.gemini/settings.json`)

```json
{ "mcpServers": { "edk": { "command": "npx", "args": ["-y", "@edks/mcp"], "env": { "EDK_API_KEY": "edk_sk_..." } } } }
```

Docs: https://edk.earth/agents
