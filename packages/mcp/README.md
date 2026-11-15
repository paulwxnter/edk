<!-- mcp-name: earth.edk/mcp -->
# EDK-1 MCP server

[![npm](https://img.shields.io/npm/v/@edks/mcp?color=e0a458&label=npm)](https://www.npmjs.com/package/@edks/mcp)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-earth.edk%2Fmcp-9cb46a)](https://registry.modelcontextprotocol.io/v0/servers?search=earth.edk)
[![License: MIT](https://img.shields.io/badge/license-MIT-8fb3c0)](LICENSE)

EDK-1 is a foundation model of the physical world. Trained on 30 billion images, it sees the planet street by street, so your agent can find anything visible on Earth, read what's true there, route around it, and get alerted the moment it changes.

Use EDK when a task depends on what the real world looks like.

```
"Streetlight issues in New Orleans where median household income is under $40k"
"Vandalism in Chicago on blocks where most homes are rented"
"Cyclist accidents in Chicago where over 10% of people walk or bike to work"
"Cracked asphalt in Sacramento inside flood zones"
"Desert wildflower blooms in California where annual rainfall is under 200 mm"
"Fern-filled forests in New Zealand where annual rainfall is over 2,000 mm"
"Bison herds in South Dakota more than an hour from a city"
"Accessory dwelling unit permits in Los Angeles where median home value is over $1M"
"New building permits in New York City inside flood zones"
```

Every result comes back with its location, its photo and an `embed_url` that opens it on the [EDK Atlas](https://edk.earth/atlas).

## Tools

| Tool | What it does |
| --- | --- |
| `edk_discover` | Ask for objects (graffiti, solar panels, bridges), conditions (storm-damaged roofs, boarded-up windows, potholes), events (crashes, new construction) or nature (humpback whales, alligators, wildflowers), and get each one back with its photo. Or find areas by what's measured there, like flood risk, income or tree canopy. Set `reasoning` from `fast` to `max` to have results studied more closely. |
| `edk_inspect` | Read what's true at any coordinate, from terrain and hazards to who lives there. |
| `edk_route` | Get from A to B around what you name, like potholed streets, construction or crash-prone intersections. |
| `edk_monitor_create` | Watch a place and get each new sighting by webhook. |
| `edk_monitor_events` | List monitors and the events they found. |
| `edk_usage` | Compute Unit balance, tier and limits. |

## Setup

1. Sign up at [edk.earth](https://edk.earth). Every account gets 500 free Compute Units a month.
2. Create a secret key in **Console → API Keys**.
3. Add the server to your client with `EDK_API_KEY` set.

**Claude Code**

```sh
claude mcp add edk --env EDK_API_KEY=edk_sk_... -- npx -y @edks/mcp
```

**Claude Desktop** (`claude_desktop_config.json`), **Cursor** (`.cursor/mcp.json`), **Windsurf** and **Gemini CLI** (`~/.gemini/settings.json`)

```json
{
  "mcpServers": {
    "edk": {
      "command": "npx",
      "args": ["-y", "@edks/mcp"],
      "env": { "EDK_API_KEY": "edk_sk_..." }
    }
  }
}
```

**VS Code** (`.vscode/mcp.json`)

```json
{
  "inputs": [{ "type": "promptString", "id": "edk-key", "description": "EDK API key", "password": true }],
  "servers": {
    "edk": {
      "command": "npx",
      "args": ["-y", "@edks/mcp"],
      "env": { "EDK_API_KEY": "${input:edk-key}" }
    }
  }
}
```

**Codex** (`~/.codex/config.toml`)

```toml
[mcp_servers.edk]
command = "npx"
args = ["-y", "@edks/mcp"]
env = { EDK_API_KEY = "edk_sk_..." }
```

**Docker**

```sh
docker build -t edk-mcp . && docker run -i --rm -e EDK_API_KEY=edk_sk_... edk-mcp
```

## Pricing

Usage is metered in Compute Units (CU), the GPU and CPU work a request needs. Discover costs 0.2 CU per result, Monitor events 0.2 CU each. Higher reasoning levels use twice the compute. See [edk.earth/pricing](https://edk.earth/pricing).

## Links

- Docs: [edk.earth/docs](https://edk.earth/docs)
- Agents guide: [edk.earth/agents](https://edk.earth/agents)
- The data behind it: [edk.earth/elements](https://edk.earth/elements)

The server has no dependencies and needs Node 18 or later. `EDK_BASE_URL` points it at another API host.

MIT licensed.
