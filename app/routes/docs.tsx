import { Link } from "react-router";
import { SiteLayout } from "~/components/chrome";
import { CodeBlock } from "~/components/copy";
import AsciiArt from "~/ascii/AsciiArt";
import { API, EMBED, PACKAGES } from "~/lib/agents";
import { CU_DEFINITION, CU_PRICE_USD, FREE_CU, MIN_TOPUP_USD } from "~/lib/pricing";
import { REASONING, TIERS, tierForReasoning } from "~/lib/tiers";

export const meta = () => [
  { title: "Docs · EDK" },
  { name: "description", content: "EDK-1 API: Discover, Inspect, Route, Monitor and Detect, reasoning, Compute Units, tiers, the Atlas and embeds, and the SDK, CLI and MCP server." },
];

const toc: [string, [string, string][]][] = [
  ["Start", [["quickstart", "Quickstart"], ["auth", "Authentication"], ["compute", "Compute Units"], ["tiers", "Tiers"]]],
  ["API", [["discover", "Discover"], ["reasoning", "Reasoning"], ["inspect", "Inspect"], ["route", "Route"], ["monitor", "Monitor"], ["detect", "Detect"], ["usage", "Usage"], ["errors", "Errors"]]],
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
        <h1>EDK-1</h1>
        <p>A spatial model that gives humans and machines a compass for the visual world. Five calls: <strong>Discover</strong> places, <strong>Inspect</strong> any spot, <strong>Route</strong> between them, <strong>Monitor</strong> for change and <strong>Detect</strong> what an image shows. Base URL <code>{API}/v1</code>.</p>
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
            <li><Link to="/sign-up">Create an account</Link> ({FREE_CU} free CU every month).</li>
            <li>Create a secret key in <Link to="/console/keys">API Keys</Link> and set it as <code>EDK_API_KEY</code>.</li>
            <li>Discover:</li>
          </ol>
          <CodeBlock label="curl" code={`curl -X POST ${API}/v1/discover \\\n  -H "Authorization: Bearer $EDK_API_KEY" \\\n  -H "content-type: application/json" \\\n  -d '{"query": "bridges in Pittsburgh", "limit": 10}'`} />
          <CodeBlock label="TypeScript" code={`import { EDK } from "${PACKAGES.sdk}";\n\nconst edk = new EDK(); // reads EDK_API_KEY\nconst { data, embed_url } = await edk.discover("bridges in Pittsburgh", { limit: 10 });\nconst spot = await edk.inspect({ lat: 40.4406, lng: -79.9959 });`} />

          <h2 id="auth">Authentication</h2>
          <p>Send <code>Authorization: Bearer edk_sk_…</code> on every call. Keys are shown once and stored as a hash.</p>
          <table>
            <thead><tr><th>Key</th><th>Use</th></tr></thead>
            <tbody>
              <tr><td><code>edk_sk_…</code></td><td>Servers, the CLI, the SDK and MCP. Never in a browser or URL.</td></tr>
              <tr><td><code>edk_pk_…</code></td><td>Live <a href="#embeds">embeds</a>, created in Console → Embeds and limited to the sites you allow.</td></tr>
            </tbody>
          </table>

          <h2 id="compute">Compute Units</h2>
          <p>{CU_DEFINITION}</p>
          <ul>
            <li><strong>Discover</strong> uses 0.2 CU per result for standard searches and 0.3 CU per result for searches that calculate spatial measurements. Medium and max <a href="#reasoning">reasoning</a> use twice that.</li>
            <li><strong>Inspect</strong> uses 0.2 CU when the spot is known, nothing when it isn't.</li>
            <li><strong>Route</strong> uses 1 CU, plus 0.2 CU for each place it passes or steers around.</li>
            <li><strong>Monitor</strong> uses 0.2 CU for each new event it finds. Scans with nothing new are free.</li>
            <li><strong>Detect</strong> uses 1 CU per image, plus 0.2 CU for each object it returns.</li>
            <li><strong>Embeds</strong> use 0.2 CU each time a map loads, under the daily limits you set.</li>
            <li>Every account gets {FREE_CU} free CU each month; what is left does not carry over. Credits are ${(CU_PRICE_USD * 1000).toFixed(0)} per 1,000 CU, from ${MIN_TOPUP_USD}, and never expire.</li>
            <li>A request never returns more than your balance covers. With no balance, calls return <code>402</code>. You can also set a monthly CU limit.</li>
          </ul>

          <h2 id="tiers">Tiers</h2>
          <p>Credits you add over time unlock higher tiers: more results per request, more requests at once, a higher rate limit and higher reasoning. Rate limits count every key on an account together; past the limit, calls return <code>429</code> with a <code>Retry-After</code> header.</p>
          <table>
            <thead><tr><th>Tier</th><th>Unlock</th><th>Results per request</th><th>Requests at once</th><th>Requests per minute</th><th>Reasoning up to</th></tr></thead>
            <tbody>
              {TIERS.map((t) => (
                <tr key={t.id}><td>{t.name}</td><td>{t.unlockDollars === null ? "Contact us" : t.unlockDollars === 0 ? "Free" : `$${t.unlockDollars.toLocaleString("en-US")} added`}</td><td>{t.maxResults}</td><td>{t.concurrency}</td><td>{t.requestsPerMinute.toLocaleString("en-US")}</td><td>{REASONING.find((r) => r.id === t.reasoning)?.name}</td></tr>
              ))}
            </tbody>
          </table>

          <h2 id="discover">Discover</h2>
          <Endpoint method="POST" path="/v1/discover" />
          <p>Find places from a question in plain words: things you can see (bridges, parks, solar farms) or areas that meet conditions (income, flood risk, tree canopy).</p>
          <table>
            <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
            <tbody>
              <tr><td><code>query</code></td><td>string</td><td>Required, up to 500 characters.</td></tr>
              <tr><td><code>limit</code></td><td>number</td><td>Most results. Default 20, up to your tier's maximum ({TIERS[0].maxResults} on {TIERS[0].name}).</td></tr>
              <tr><td><code>reasoning</code></td><td>string</td><td><code>fast</code> (default), <code>low</code>, <code>medium</code> or <code>max</code>. See <a href="#reasoning">Reasoning</a>.</td></tr>
              <tr><td><code>answer</code></td><td>boolean</td><td>Add a short written answer. Default <code>false</code>.</td></tr>
              <tr><td><code>development</code></td><td>boolean</td><td>When <code>true</code>, include engine duration and sanitized stage timings in a top-level <code>development</code> object.</td></tr>
              <tr><td><code>areas</code></td><td>[lng, lat][]</td><td>Search around up to four points.</td></tr>
              <tr><td><code>focus</code></td><td>string</td><td>A region id to search in when the query names no place.</td></tr>
            </tbody>
          </table>
          <CodeBlock label="200 OK" copy={false} code={`{
  "id": "res_…",
  "model": "edk-1",
  "embed_url": "${EMBED}/r/res_…",
  "reasoning": "fast",
  "usage": { "locations": 8, "areas": 2, "cu": 2 },
  "development": { "total_ms": 842, "stages": [{ "name": "data_retrieval", "ms": 411 }] },
  "data": {
    "query": "bridges in Pittsburgh",
    "geojson": {
      "type": "FeatureCollection",
      "features": [{
        "type": "Feature",
        "geometry": { "type": "Point", "coordinates": [-80.0063, 40.4446] },
        "properties": {
          "kind": "location",
          "feature_name": "Bridge",
          "address": "Pittsburgh, Pennsylvania, United States",
          "neighborhood": "North Shore",
          "date": "2021-07-24",
          "image_url": "https://cdn.edk.earth/i/…",
          "box": { "top": 0.31, "left": 0.12, "bottom": 0.74, "right": 0.88 },
          "boxed_image_url": "https://cdn.edk.earth/b/…"
        }
      }]
    },
    "region": { "id": "…", "name": "Pittsburgh", "type": "city" }
  }
}`} />
          <ul>
            <li>Results are <code>"location"</code> (a point, often with imagery) or <code>"area"</code> (a small zone that meets the query's conditions, with an <code>outline</code> polygon).</li>
            <li>Results can include <code>facts</code> with a title and detail, plus distance in meters or an explanation of the measurement when applicable.</li>
            <li><code>GET /v1/discover/:id</code> returns a stored result at no cost.</li>
          </ul>

          <h2 id="reasoning">Reasoning</h2>
          <p>Reasoning sets how closely EDK-1 studies its results before it returns them. Higher levels take a little longer and give you results you can lean on harder. Set it per request with <code>reasoning</code>; the default is <code>fast</code>.</p>
          <table>
            <thead><tr><th>Level</th><th>What you get</th><th>Results studied</th><th>CU</th><th>Available from</th></tr></thead>
            <tbody>
              {REASONING.map((r) => (
                <tr key={r.id}><td><code>{r.id}</code></td><td>{r.does}</td><td>{Number.isFinite(r.depth) ? `First ${r.depth}` : "All"}</td><td>{r.cost === 1 ? "Standard" : `${r.cost}× standard`}</td><td>{tierForReasoning(r.id).name}</td></tr>
              ))}
            </tbody>
          </table>
          <CodeBlock label="curl" code={`curl -X POST ${API}/v1/discover \\
  -H "Authorization: Bearer $EDK_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"query": "potholes in Pittsburgh", "limit": 10, "reasoning": "medium"}'`} />
          <ul>
            <li>A result that was studied carries a <code>box</code>, the part of its image that answers the query (<code>top</code>, <code>left</code>, <code>bottom</code>, <code>right</code> as fractions of the image), and a <code>boxed_image_url</code>: the same image with the box drawn on.</li>
            <li>The response names the level used in <code>reasoning</code>. A level above your tier returns <code>403</code>.</li>
            <li>On the home page and in the Atlas, pick the level from the Reasoning menu in the prompt.</li>
          </ul>

          <h2 id="inspect">Inspect</h2>
          <Endpoint method="GET" path="/v1/inspect?lat=40.4406&lng=-79.9959" />
          <p>What is known about the small area under a point: where it is, a few highlights, and every fact by category, with the area's outline.</p>
          <CodeBlock label="200 OK" copy={false} code={`{
  "model": "edk-1",
  "usage": { "locations": 1, "areas": 0, "cu": 0.2 },
  "data": {
    "known": true,
    "center": [-79.9959, 40.4406],
    "outline": { "type": "Polygon", "coordinates": [[…]] },
    "place": [{ "type": "city", "name": "Pittsburgh" }, …],
    "highlights": [{ "key": "elevation_m", "title": "Elevation", "value": "Low hills", "detail": "256 m" }, …],
    "categories": [{ "name": "Demographics", "items": [ … ] }, …]
  }
}`} />

          <h2 id="route">Route</h2>
          <Endpoint method="POST" path="/v1/route" />
          <p>The way from A to B, passing what you want to see and steered around what you ask it to avoid. Give the conditions in plain words: EDK-1 works out what to look for, finds it in the cities along the way, and routes around the matches that sit on the path.</p>
          <table>
            <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
            <tbody>
              <tr><td><code>from</code>, <code>to</code></td><td>string or [lng, lat]</td><td>Required. A place name, an address, <code>"lat, lng"</code>, <code>[lng, lat]</code> or <code>{"{lat, lng}"}</code>.</td></tr>
              <tr><td><code>include</code></td><td>string</td><td>What to pass on the way, like <code>"a coffee shop"</code> or <code>"scenic overlooks"</code>. "a" or "one" passes one; a plural passes up to three.</td></tr>
              <tr><td><code>conditions</code></td><td>string</td><td>What to stay clear of, like <code>"avoid pothole streets"</code>. Up to 300 characters.</td></tr>
              <tr><td><code>profile</code></td><td>string</td><td><code>driving</code> (default), <code>walking</code> or <code>cycling</code>. Conditions steer driving routes only.</td></tr>
            </tbody>
          </table>
          <CodeBlock label="curl" code={`curl -X POST ${API}/v1/route \\
  -H "Authorization: Bearer $EDK_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{ "from": "Point State Park, Pittsburgh", "to": "Carnegie Mellon University, Pittsburgh", "conditions": "avoid pothole streets" }'`} />
          <CodeBlock label="200 OK" copy={false} code={`{
  "model": "edk-1",
  "usage": { "routes": 1, "avoided": 3, "cu": 1.6 },
  "data": {
    "from": { "lat": 40.4416, "lng": -80.0078, "label": "Point State Park, Pittsburgh, …" },
    "to": { "lat": 40.4431, "lng": -79.9429, "label": "Carnegie Mellon University, …" },
    "profile": "driving",
    "conditions": { "text": "avoid pothole streets", "looked_for": ["Pothole"], "cities": ["Pittsburgh, Pennsylvania"], "matches": 237 },
    "route": { "distance_m": 6635, "duration_s": 1117, "geometry": { "type": "LineString", "coordinates": [[…]] }, "steps": [ … ] },
    "direct": { "distance_m": 6348, "duration_s": 1013, "geometry": { … } },
    "avoided": [{ "lat": 40.441, "lng": -79.9575, "name": "Pothole", "kind": "location" }, …],
    "remaining": 0
  }
}`} />
          <ul>
            <li><code>route</code> is the path to take. <code>direct</code> is the plain path, with its own steps, present whenever <code>include</code> or <code>conditions</code> changed it, so the two can be compared.</li>
            <li><code>included</code> lists the places the route passes, in order.</li>
            <li><code>avoided</code> lists what the route was steered around; <code>remaining</code> counts matches it still passes, and <code>note</code> says why when there is something to say.</li>
            <li>Up to 50 places are avoided per route. A match at the start or the end cannot be avoided.</li>
          </ul>

          <h2 id="monitor">Monitor</h2>
          <Endpoint method="POST" path="/v1/monitors" />
          <p>Watch an area for new events of the artifacts you pick, from a date you choose. On every interval EDK-1 scans their sources for anything newer, keeps each event, shows it in Console → Monitor and posts it to your webhook. Available from Tier 4.</p>
          <table>
            <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
            <tbody>
              <tr><td><code>artifacts</code></td><td>string[]</td><td>Required. Up to five names or ids from <code>GET /v1/artifacts?q=</code>: imagery, or record streams such as permits, 311 requests and inspections.</td></tr>
              <tr><td><code>area</code></td><td>string or object</td><td>Required. A place name, <code>"lat, lng"</code>, <code>{"{lat, lng}"}</code> or <code>{"{region_id}"}</code>. EDK-1 watches the city, county or state around it.</td></tr>
              <tr><td><code>since</code></td><td>date</td><td>Report events after this date, up to a year back. Default: a week ago.</td></tr>
              <tr><td><code>interval</code></td><td>string</td><td><code>15m</code>, <code>1h</code> (default), <code>6h</code> or <code>1d</code>.</td></tr>
              <tr><td><code>webhook_url</code></td><td>string</td><td>A public https URL that receives each batch of new events.</td></tr>
              <tr><td><code>prompt</code></td><td>string</td><td>What matters to you about these events. Saved with the monitor; it does not filter events yet.</td></tr>
              <tr><td><code>name</code></td><td>string</td><td>Optional label.</td></tr>
            </tbody>
          </table>
          <CodeBlock label="curl" code={`curl -X POST ${API}/v1/monitors \\
  -H "Authorization: Bearer $EDK_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{ "artifacts": ["Building Permit"], "area": "Pittsburgh", "since": "2026-11-01", "interval": "1h", "webhook_url": "https://example.com/edk-events" }'`} />
          <p>The response is the monitor, with its <code>webhook_secret</code>. Each webhook request is a POST of <code>{"{ type: \"monitor.events\", monitor, events, sent_at }"}</code> with <code>x-edk-signature: t=&lt;ms&gt;,v1=&lt;hex&gt;</code>, the HMAC-SHA256 of <code>&lt;t&gt;.&lt;body&gt;</code> with the secret. Failed deliveries are retried on the next scans, up to five times.</p>
          <table>
            <thead><tr><th>Call</th><th>What it does</th></tr></thead>
            <tbody>
              <tr><td><code>GET /v1/monitors</code></td><td>Your monitors.</td></tr>
              <tr><td><code>GET /v1/monitors/:id/events?after=</code></td><td>Events a monitor found, newest first.</td></tr>
              <tr><td><code>GET /v1/events?after=</code></td><td>Events across all your monitors.</td></tr>
              <tr><td><code>PATCH /v1/monitors/:id</code></td><td><code>{"{status: \"paused\" | \"active\"}"}</code>, or a new <code>interval</code>, <code>webhook_url</code>, <code>prompt</code> or <code>name</code>.</td></tr>
              <tr><td><code>POST /v1/monitors/:id/scan</code></td><td>Scan now instead of waiting for the interval.</td></tr>
              <tr><td><code>DELETE /v1/monitors/:id</code></td><td>Stop and remove a monitor.</td></tr>
              <tr><td><code>GET /v1/artifacts?q=</code></td><td>Artifacts by name, and whether each can be watched.</td></tr>
            </tbody>
          </table>
          <ul>
            <li>Each new event is 0.2 CU. When the balance runs out the monitor pauses; add credits and resume it.</li>
            <li>Below Tier 4 the calls return <code>403</code>.</li>
          </ul>

          <h2 id="detect">Detect</h2>
          <Endpoint method="POST" path="/v1/detect" />
          <p>Send an image and get back the objects in it: every artifact EDK-1 knows that it can see, each with a label, a box and its coordinates in the frame, plus the image with the boxes drawn on.</p>
          <table>
            <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
            <tbody>
              <tr><td><code>image_url</code></td><td>string</td><td>An https link to a JPEG or PNG, up to 16 MB. Send this or <code>image</code>.</td></tr>
              <tr><td><code>image</code></td><td>string</td><td>The image as base64, with or without a <code>data:</code> prefix.</td></tr>
              <tr><td><code>max_objects</code></td><td>number</td><td>Most objects to return, 1 to 40. Default 12.</td></tr>
              <tr><td><code>threshold</code></td><td>number</td><td>How sure EDK-1 must be that an object is present, between 0 and 1. Default 0.6.</td></tr>
              <tr><td><code>annotate</code></td><td>boolean</td><td>Return the image with boxes drawn on. Default <code>true</code>.</td></tr>
            </tbody>
          </table>
          <CodeBlock label="curl" code={`curl -X POST ${API}/v1/detect \\
  -H "Authorization: Bearer $EDK_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"image_url": "https://example.com/street.jpg", "max_objects": 8}'`} />
          <CodeBlock label="200 OK" copy={false} code={`{
  "model": "edk-1",
  "usage": { "images": 1, "objects": 3, "cu": 1.6 },
  "data": {
    "image": { "width": 1024, "height": 576 },
    "objects": [{
      "label": "Road Marking",
      "artifact_id": "…",
      "category": "transportation",
      "probability": 0.95,
      "confidence": 0.84,
      "box": { "top": 0.56, "left": 0.01, "bottom": 1, "right": 0.3 },
      "pixels": { "x": 10, "y": 323, "width": 297, "height": 253 },
      "also": ["Lane Marking", "Center Line"]
    }, …],
    "annotated_image": "data:image/jpeg;base64,…",
    "duration_ms": 1890
  }
}`} />
          <ul>
            <li><code>box</code> edges are fractions of the image from its top-left corner; <code>pixels</code> is the same box in the image's own pixels.</li>
            <li><code>probability</code> is how sure EDK-1 is that the object is in the image; <code>confidence</code> is how sure it is of the box.</li>
            <li><code>also</code> lists other artifacts found in the same place, so one object is returned once.</li>
            <li>Photos are turned upright before they are read, so boxes match the image as you see it. Images larger than 1,024 pixels a side are scaled down for reading; coordinates always refer to the image you sent.</li>
          </ul>

          <h2 id="usage">Usage</h2>
          <Endpoint method="GET" path="/v1/usage" />
          <p>Balance, this month's CU, your tier and limits, and CU per day for 30 days.</p>

          <h2 id="errors">Errors</h2>
          <table>
            <thead><tr><th>Status</th><th>Meaning</th></tr></thead>
            <tbody>
              <tr><td><code>400</code></td><td>Missing or out-of-range input.</td></tr>
              <tr><td><code>401</code></td><td>No key, or an invalid or revoked key.</td></tr>
              <tr><td><code>402</code></td><td>Balance used up, or monthly CU limit reached.</td></tr>
              <tr><td><code>403</code></td><td>Publishable key used from a site it doesn't allow, or a reasoning level or call above your tier.</td></tr>
              <tr><td><code>429</code></td><td>More requests at once than your tier allows.</td></tr>
              <tr><td><code>502</code></td><td>Temporarily unavailable. Retry shortly.</td></tr>
            </tbody>
          </table>

          <h2 id="atlas">The Atlas</h2>
          <p><Link to="/atlas">edk.earth/atlas</Link> is EDK-1 on a map for signed-in accounts, billed in CU like the API: find places, understand any spot and route between them. Signed in, Console → Atlas uses your account. Agents embed it from <code>embed.edk.earth</code>.</p>

          <h2 id="embeds">Embeds</h2>
          <p>Every Discover result has an <code>embed_url</code> that opens it on a read-only Atlas. Agents share these links in chat. Each load is 0.2 CU to the account that made the result, under a daily limit set in Console → Embeds, where the links can also be turned off.</p>
          <CodeBlock label="HTML" code={`<iframe src="${EMBED}/r/res_…" width="100%" height="480" style="border:0" loading="lazy"></iframe>`} />
          <p>For a live map in your page, create an embed in Console → Embeds. An embed has its own key and opens only inside the sites you list: your domains (<code>https://*.example.com</code> for subdomains), <code>http://localhost</code> for any port on your computer, and presets for ChatGPT and Claude. Each load is 0.2 CU under a daily limit you set, and one visitor can load it at most 100 times a day. Searches inside the map are billed like the API.</p>
          <CodeBlock label="HTML" code={`<iframe src="${EMBED}/?key=edk_pk_…&q=parks+in+Austin" width="100%" height="480" style="border:0"></iframe>`} />
          <CodeBlock label="JavaScript" code={`const atlas = document.querySelector("iframe").contentWindow;\natlas.postMessage({ type: "edk:search", query: "bridges in Pittsburgh" }, "${EMBED}");\natlas.postMessage({ type: "edk:show", data }, "${EMBED}"); // data from /v1/discover`} />

          <h2 id="sdk">SDK</h2>
          <CodeBlock label="TypeScript" code={`npm install ${PACKAGES.sdk}\n\nimport { EDK } from "${PACKAGES.sdk}";\nconst edk = new EDK({ apiKey: process.env.EDK_API_KEY });\n\nawait edk.discover("high income areas in Denver", { limit: 20 });\nawait edk.inspect({ lat: 40.4406, lng: -79.9959 });\nawait edk.usage();`} />

          <h2 id="cli">CLI</h2>
          <CodeBlock label="shell" code={`npm install -g ${PACKAGES.cli}\n\nedk login\nedk discover "bridges in Pittsburgh" --limit 10\nedk inspect 40.4406,-79.9959\nedk usage`} />

          <h2 id="mcp">MCP</h2>
          <p>Tools: <code>edk_discover</code>, <code>edk_inspect</code>, <code>edk_usage</code>.</p>
          <CodeBlock label="any MCP client" code={`{\n  "mcpServers": {\n    "edk": {\n      "command": "npx",\n      "args": ["-y", "${PACKAGES.mcp}"],\n      "env": { "EDK_API_KEY": "edk_sk_..." }\n    }\n  }\n}`} />

          <h2 id="agents">Agents</h2>
          <p><Link to="/agents">Connect Claude, Codex, Cursor or Gemini</Link>, or point any agent at <a href="/agents.md">/agents.md</a>.</p>
        </article>
      </div>
    </SiteLayout>
  );
}
