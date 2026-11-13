import { Link } from "react-router";
import { SiteLayout } from "~/components/chrome";
import { CodeBlock } from "~/components/copy";
import AsciiArt from "~/ascii/AsciiArt";
import { API, EMBED, PACKAGES } from "~/lib/agents";
import { CU_PRICE_USD, FREE_CU, MIN_TOPUP_USD } from "~/lib/pricing";

export const meta = () => [
  { title: "Docs · EDK" },
  { name: "description", content: "EDK API reference: search, inspect, regions, geocoding, trends, embeds, Compute Units, and the SDK, CLI and MCP server." },
];

const toc: [string, [string, string][]][] = [
  ["Start", [["quickstart", "Quickstart"], ["auth", "Authentication"], ["billing", "Compute Units"]]],
  ["API", [["search", "Search"], ["results", "Results"], ["images", "Images & CDN"], ["inspect", "Inspect"], ["regions", "Regions & geocoding"], ["catalog", "Catalog & sources"], ["trends", "Trends"], ["usage", "Usage"], ["errors", "Errors"]]],
  ["Atlas", [["atlas", "The Atlas"], ["embeds", "Embeds"]]],
  ["Tools", [["sdk", "SDK"], ["cli", "CLI"], ["mcp", "MCP"], ["agents", "Agents"]]],
];

function Endpoint({ method, path }: { method: "GET" | "POST"; path: string }) {
  return <p className="endpoint"><span className={`method${method === "GET" ? " get" : ""}`}>{method}</span>{path}</p>;
}

export default function Docs() {
  return (
    <SiteLayout>
      <section className="page-hero art-host" style={{ position: "relative" }}>
        <div className="art-layer" style={{ left: "55%" }}><AsciiArt art={[{ scene: "river", x: 0.55, y: 0.5, size: 0.5 }]} /></div>
        <span className="section-kicker">Documentation</span>
        <h1>Build with EDK</h1>
        <p>Ask questions about the physical world over HTTPS and get GeoJSON, imagery, area facts and a short answer back. Base URL <code>{API}/v1</code>.</p>
      </section>
      <div className="docs">
        <nav className="docs-toc" aria-label="On this page">
          {toc.map(([group, items]) => (
            <div key={group} style={{ display: "contents" }}>
              <span className="label">{group}</span>
              {items.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
            </div>
          ))}
        </nav>
        <article className="prose">
          <h2 id="quickstart">Quickstart</h2>
          <ol>
            <li><Link to="/sign-up">Create an account</Link>. It starts with {FREE_CU} free CU.</li>
            <li>Create a secret key in <Link to="/console/keys">Console → API Keys</Link> and set it as <code>EDK_API_KEY</code>.</li>
            <li>Run a search:</li>
          </ol>
          <CodeBlock label="curl" code={`curl -X POST ${API}/v1/search \\\n  -H "Authorization: Bearer $EDK_API_KEY" \\\n  -H "content-type: application/json" \\\n  -d '{"query": "bridges in Pittsburgh", "limit": 10}'`} />
          <p>Or with the SDK:</p>
          <CodeBlock label="TypeScript" code={`import { EDK } from "${PACKAGES.sdk}";\n\nconst edk = new EDK(); // reads EDK_API_KEY\nconst { data, embed_url, usage } = await edk.search("bridges in Pittsburgh", { limit: 10 });\n\nconsole.log(data.answer);\nconsole.log(data.geojson.features.length, "results,", usage.cu, "CU");\nconsole.log("See them on the Atlas:", embed_url);`} />

          <h2 id="auth">Authentication</h2>
          <p>Send your key on every call as <code>Authorization: Bearer edk_sk_…</code> (or <code>x-api-key</code>). Keys are shown once when created and stored only as a hash. Revoke a key at any time in the console.</p>
          <table>
            <thead><tr><th>Key</th><th>Use</th></tr></thead>
            <tbody>
              <tr><td><code>edk_sk_…</code> secret</td><td>Servers, scripts, the CLI, the SDK and MCP. Never put it in a browser or a URL.</td></tr>
              <tr><td><code>edk_pk_…</code> publishable</td><td>Live searches in <a href="#embeds">embedded maps</a>, limited to the sites you allow.</td></tr>
            </tbody>
          </table>

          <h2 id="billing">Compute Units</h2>
          <p><strong>A Compute Unit (CU) covers five locations or areas.</strong> A search that comes back with 8 locations and 2 areas uses 2 CU. You pay only for what comes back, and every location keeps its imagery at no extra cost.</p>
          <ul>
            <li>New accounts get {FREE_CU} CU. Add credits from ${MIN_TOPUP_USD} in <Link to="/console/billing">Billing &amp; Usage</Link>, at ${(CU_PRICE_USD * 1000).toFixed(0)} per 1,000 CU.</li>
            <li>A search never returns more results than your balance covers. With an empty balance, calls return <code>402</code>.</li>
            <li>Set a <strong>max results per search</strong> and a <strong>monthly CU limit</strong> in the console. The <code>limit</code> you send is capped by both.</li>
            <li>Regions, the catalog, sources and trend discovery are free. Inspect and geocode count as one location when they find something; a trends series counts one location per region.</li>
          </ul>

          <h2 id="search">Search</h2>
          <Endpoint method="POST" path="/v1/search" />
          <p>One question in plain words. EDK decides what it needs (located things, areas that meet conditions, counts over time) and where to look.</p>
          <table>
            <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
            <tbody>
              <tr><td><code>query</code></td><td>string</td><td>Required. Up to 500 characters, e.g. "solar farms near Phoenix" or "is 1595 Kelvinway Lane in a flood zone?"</td></tr>
              <tr><td><code>limit</code></td><td>number</td><td>Most results to return, 1–60. Default 20.</td></tr>
              <tr><td><code>areas</code></td><td>[lng, lat][]</td><td>Up to 4 points to search around instead of a named place.</td></tr>
              <tr><td><code>focus</code></td><td>string</td><td>A region id (from <a href="#regions">regions</a>) to search in when the query names no place.</td></tr>
              <tr><td><code>answer</code></td><td>boolean</td><td>Include a short written answer. Default true.</td></tr>
            </tbody>
          </table>
          <p><code>GET /v1/search?q=…&amp;limit=…</code> works too, for quick tests.</p>

          <h2 id="results">Results</h2>
          <CodeBlock label="200 OK" copy={false} code={`{
  "id": "res_…",
  "embed_url": "${EMBED}/r/res_…",
  "usage": { "locations": 8, "areas": 2, "cu": 2 },
  "data": {
    "query": "bridges in Pittsburgh",
    "answer": "…",
    "geojson": {
      "type": "FeatureCollection",
      "features": [{
        "type": "Feature",
        "geometry": { "type": "Point", "coordinates": [-80.0063, 40.4446] },
        "properties": { "name": "…", "feature_name": "Bridge", "neighborhood": "…", "date": "…", "image_url": "https://cdn.edk.earth/i/…" }
      }]
    },
    "regions": [{ "id": "…", "name": "Pittsburgh", "region_type": "city" }],
    "filters": [],
    "trends": { … },            // when the question asks about amounts over time
    "areas": [{ "index": 1, "center": [lng, lat], "cells": ["…"] }]  // when you sent areas or named an address
  }
}`} />
          <ul>
            <li>Results whose <code>properties.kind</code> is <code>"area"</code> are small hexagonal areas (H3 cells, in <code>properties.h3</code>) that meet the query's conditions, with their facts as properties.</li>
            <li><code>GET /v1/search/:id</code> returns a stored result you created, at no cost.</li>
          </ul>

          <h2 id="images">Images &amp; CDN</h2>
          <p>Every image or video URL in a result points at <code>https://cdn.edk.earth</code>. Media is fetched once, cached at the edge, and served with long cache headers and open CORS, so you can put it straight into an <code>&lt;img&gt;</code> tag. CDN URLs are signed; they don't expire, but they can't be edited to fetch anything else.</p>

          <h2 id="inspect">Inspect</h2>
          <Endpoint method="GET" path="/v1/inspect?lat=40.4406&lng=-79.9959" />
          <p>Everything known about the small area under a point: where it is (city, county, state, country), a few highlights (income, population nearby, elevation, flood risk, tree canopy, air quality) and every available fact, grouped by category.</p>

          <h2 id="regions">Regions &amp; geocoding</h2>
          <Endpoint method="GET" path="/v1/regions?q=austin&type=city" />
          <p>Find regions by name (<code>q</code>, optional <code>type</code>: country, state, county, city), by <code>slug</code> or <code>id</code>, or the regions containing a point (<code>lat</code>, <code>lng</code>). Free.</p>
          <Endpoint method="GET" path="/v1/geocode?q=1600 Pennsylvania Ave" />
          <p>Addresses and places for text, with coordinates. A <code>"lat, lng"</code> string comes back as is.</p>

          <h2 id="catalog">Catalog &amp; sources</h2>
          <Endpoint method="GET" path="/v1/catalog?q=bridge" />
          <p>The kinds of located things EDK can find, with descriptions. Filter by <code>q</code> or <code>type</code> (object, event, condition, material, organism). Free.</p>
          <Endpoint method="GET" path="/v1/sources?keys=elevation_m,flood_zone" />
          <p>The published datasets behind area facts, with publisher, release, license and citation. Free.</p>

          <h2 id="trends">Trends</h2>
          <Endpoint method="GET" path="/v1/trends/search?q=gas" />
          <Endpoint method="GET" path="/v1/trends/regions?feature=gas-stations&type=city" />
          <Endpoint method="GET" path="/v1/trends/series?feature=gas-stations&regions=austin-tx,denver-co&tf=monthly" />
          <p>Find a feature, see where it is most common, then get its series for up to five regions (<code>tf</code>: year, monthly or weekly). Searches that ask about amounts include trends automatically.</p>

          <h2 id="usage">Usage</h2>
          <Endpoint method="GET" path="/v1/usage" />
          <p>Your CU balance, this month's usage, your limits, and CU per day for the last 30 days.</p>

          <h2 id="errors">Errors</h2>
          <p>Errors return JSON like <code>{`{"error": "…"}`}</code> with a plain-language message.</p>
          <table>
            <thead><tr><th>Status</th><th>Meaning</th></tr></thead>
            <tbody>
              <tr><td><code>400</code></td><td>The request is missing something or out of range.</td></tr>
              <tr><td><code>401</code></td><td>No key, or the key is invalid or revoked.</td></tr>
              <tr><td><code>402</code></td><td>The balance is used up, or the monthly CU limit is reached.</td></tr>
              <tr><td><code>403</code></td><td>A publishable key used from a site it doesn't allow, or a query that can't be answered.</td></tr>
              <tr><td><code>404</code></td><td>Unknown result, region or catalog entry.</td></tr>
              <tr><td><code>502</code></td><td>Temporarily unavailable. Retry after a moment.</td></tr>
            </tbody>
          </table>

          <h2 id="atlas">The Atlas</h2>
          <p><Link to="/atlas">edk.earth/atlas</Link> is EDK on a map, free to use without an account: search the world, open results, switch between outdoor, light, dark and satellite. Signed in, the same Atlas is in Console → Atlas, searching with your account. Click anywhere to inspect the ground: who lives there, the terrain, hazards, climate and more. Anonymous searches are limited per day. Agents and other sites embed the same Atlas from <code>embed.edk.earth</code>.</p>

          <h2 id="embeds">Embeds</h2>
          <h3>Show a result</h3>
          <p>Every search returns an <code>embed_url</code>. It shows that result on the Atlas, needs no key, and costs nothing to view.</p>
          <CodeBlock label="HTML" code={`<iframe src="${EMBED}/r/res_…" width="100%" height="480" style="border:0" loading="lazy"></iframe>`} />
          <h3>Live searches</h3>
          <p>Create a publishable key (<code>edk_pk_…</code>) with the sites allowed to use it, then pass it with an optional starting query. Searches made in the embed use your CU.</p>
          <CodeBlock label="HTML" code={`<iframe src="${EMBED}/?key=edk_pk_…&q=parks+with+playgrounds+in+Austin" width="100%" height="480" style="border:0"></iframe>`} />
          <h3>Drive it from your page</h3>
          <CodeBlock label="JavaScript" code={`const map = document.querySelector("iframe").contentWindow;\nmap.postMessage({ type: "edk:search", query: "bridges in Pittsburgh" }, "${EMBED}");\n// Or show results you already have (the data object from /v1/search):\nmap.postMessage({ type: "edk:show", data }, "${EMBED}");\n\n// The map tells you when results arrive:\nwindow.addEventListener("message", (e) => {\n  if (e.data?.type === "edk:result") console.log(e.data.count, e.data.embed_url);\n});`} />

          <h2 id="sdk">SDK</h2>
          <CodeBlock label="shell" code={`npm install ${PACKAGES.sdk}`} />
          <CodeBlock label="TypeScript" code={`import { EDK } from "${PACKAGES.sdk}";\n\nconst edk = new EDK({ apiKey: process.env.EDK_API_KEY });\n\nawait edk.search("high income areas in Denver", { limit: 20 });\nawait edk.inspect({ lat: 40.4406, lng: -79.9959 });\nawait edk.regions({ q: "austin", type: "city" });\nawait edk.geocode("1600 Pennsylvania Ave");\nawait edk.catalog({ q: "bridge" });\nawait edk.trends.series({ feature: "gas-stations", regions: ["austin-tx"], tf: "monthly" });\nawait edk.usage();`} />
          <p>Works in Node 18+, Bun, Deno, Workers and the browser (with a publishable key). Errors throw <code>EDKError</code> with <code>status</code> and <code>message</code>.</p>

          <h2 id="cli">CLI</h2>
          <CodeBlock label="shell" code={`npm install -g ${PACKAGES.cli}\n\nedk login                         # paste a secret key; it is stored in ~/.edk\nedk search "bridges in Pittsburgh" --limit 10\nedk search "solar farms near Phoenix" --json > farms.json\nedk inspect 40.4406,-79.9959\nedk regions austin\nedk usage`} />
          <p><code>EDK_API_KEY</code> in the environment takes precedence over the stored key.</p>

          <h2 id="mcp">MCP</h2>
          <p>The MCP server gives agents these tools: <code>edk_search</code>, <code>edk_inspect</code>, <code>edk_regions</code>, <code>edk_geocode</code>, <code>edk_catalog</code>, <code>edk_trends</code> and <code>edk_usage</code>. Search results include the <code>embed_url</code> so the agent can show them on the Atlas.</p>
          <CodeBlock label="any MCP client" code={`{\n  "mcpServers": {\n    "edk": {\n      "command": "npx",\n      "args": ["-y", "${PACKAGES.mcp}"],\n      "env": { "EDK_API_KEY": "edk_sk_..." }\n    }\n  }\n}`} />

          <h2 id="agents">Agents</h2>
          <p>Connect Claude Code, Codex, Cursor or Gemini CLI in a minute. <Link to="/agents">The agents page</Link> has one prompt for any agent and the config for each one. Agents can also read <a href="/agents.md">/agents.md</a> and <a href="/llms.txt">/llms.txt</a>.</p>
        </article>
      </div>
    </SiteLayout>
  );
}
