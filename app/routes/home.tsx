import { Link } from "react-router";
import type { Route } from "./+types/home";
import { SiteLayout, useUser } from "~/components/chrome";
import { Contours } from "~/components/brand";
import { AgentChip, InstallSwitcher } from "~/components/copy";
import AsciiArt from "~/ascii/AsciiArt";
import EmbedMap from "~/map/EmbedMap";
import { API, EMBED, PACKAGES } from "~/lib/agents";
import { CU_PRICE_USD, FREE_CU, MIN_TOPUP_USD, cuForDollars } from "~/lib/pricing";
import { openEmbed } from "../../server/embed";

export function meta({ data }: Route.MetaArgs) {
  if (data?.mode === "embed") return [{ title: "EDK Atlas" }, { name: "description", content: "Search the physical world on the EDK Atlas." }];
  return [
    { title: "EDK: Compass for Machines" },
    { name: "description", content: "One API for questions about the physical world: imagery, places, civic records, area attributes and trends. Built for agents and apps, with the free EDK Atlas." },
    { property: "og:title", content: "EDK: Compass for Machines" },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const embedHost = url.hostname.startsWith("embed.");
  // Local development: ?embed=1 shows the map.
  const isEmbed = embedHost || (import.meta.env.DEV && url.searchParams.has("embed"));
  if (!isEmbed) return { mode: "site" as const };
  const key = url.searchParams.get("key");
  const mapboxToken = process.env.MAPBOX_API_KEY?.startsWith("pk.") ? process.env.MAPBOX_API_KEY : null;
  const query = (url.searchParams.get("q") || "").slice(0, 500);
  if (!key) return { mode: "embed" as const, query, token: null, error: null, mapboxToken };
  const opened = await openEmbed(context.cloudflare.env.DB, key, request.headers.get("referer"));
  if ("error" in opened) return { mode: "embed" as const, query, token: null, error: opened.error as string, mapboxToken };
  return { mode: "embed" as const, query, token: opened.token, error: null, mapboxToken };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  if (loaderData.mode === "embed") return <EmbedMap initialQuery={loaderData.query} token={loaderData.token} keyError={loaderData.error} mapboxToken={loaderData.mapboxToken} />;
  return <Landing />;
}

const capabilities = [
  { title: "Located things", body: "Bridges, potholes, solar farms, trailheads, gas stations. Ask in plain words and get points with names, dates and imagery.", code: "\"bridges in Pittsburgh\"", icon: "pin" },
  { title: "Areas by attribute", body: "Find the places that meet conditions: income, flood zone, tree canopy, elevation, air quality and more than a hundred others.", code: "\"high income areas in Austin\"", icon: "hex" },
  { title: "Trends over time", body: "Counts and series for a feature across cities, counties and states, monthly or yearly.", code: "GET /v1/trends/series", icon: "trend" },
  { title: "Inspect any spot", body: "Everything known about the small area under a coordinate, grouped and explained.", code: "GET /v1/inspect?lat=&lng=", icon: "scope" },
  { title: "Imagery on a CDN", body: "Every image in a result is served from cdn.edk.earth, cached at the edge and ready to show.", code: "https://cdn.edk.earth/i/…", icon: "image" },
  { title: "The Atlas, embedded", body: "Each search returns an embed_url. Drop it in an iframe and the results appear on the live Atlas.", code: "embed.edk.earth/r/<id>", icon: "map" },
];

function Icon({ name }: { name: string }) {
  const p = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, "aria-hidden": true } as const;
  if (name === "pin") return <svg {...p}><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" /></svg>;
  if (name === "hex") return <svg {...p}><path d="m12 2.5 8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5Z" /><path d="m12 7.5 4 2.3v4.4l-4 2.3-4-2.3V9.8Z" /></svg>;
  if (name === "trend") return <svg {...p}><path d="M3 17l5.5-5.5 4 4L21 7" /><path d="M15 7h6v6" /></svg>;
  if (name === "scope") return <svg {...p}><circle cx="12" cy="12" r="7.5" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></svg>;
  if (name === "image") return <svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m3 16 5-5 4 4 3-3 6 6" /><circle cx="16" cy="9" r="1.5" /></svg>;
  return <svg {...p}><path d="M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5Z" /><path d="M9 4v13.5M15 6.5V20" /></svg>;
}

const requestSample = `curl -X POST ${API}/v1/search \\
  -H "Authorization: Bearer $EDK_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{
    "query": "bridges in Pittsburgh",
    "limit": 10
  }'`;

function Landing() {
  const user = useUser();
  return (
    <SiteLayout>
      <main>
        <section className="hero hero-split">
          <div className="hero-bg" aria-hidden="true"><Contours /></div>
          <div className="hero-copy">
            <Link className="eyebrow" to="/atlas"><b>Free</b> Explore the Atlas →</Link>
            <h1>Compass for Machines</h1>
            <p className="lead">One API for questions about the physical world. Your agents and apps ask in plain words and get back places, imagery, area attributes and trends, ready for a map.</p>
            <div className="hero-actions">
              <Link className="btn btn-primary btn-lg" to={user ? "/console" : "/sign-up"}>{user ? "Open the console" : `Start with ${FREE_CU} free CU`}</Link>
              <Link className="btn btn-lg" to="/docs">Read the docs</Link>
            </div>
            <AgentChip />
            <InstallSwitcher />
          </div>
          <div className="hero-earth art-host" title="Drag to turn the Earth">
            <AsciiArt art={[{ scene: "earth", x: 0.5, y: 0.48, size: 0.38 }]} />
            <span className="hero-earth-hint">drag to turn</span>
          </div>
        </section>

        <div className="demo" role="figure" aria-label="An EDK search request and its response">
          <div className="demo-pane">
            <div className="demo-bar"><i /><i /><i /><span>request</span></div>
            <pre>{requestSample}</pre>
          </div>
          <div className="demo-pane">
            <div className="demo-bar"><i /><i /><i /><span>200 OK</span></div>
            <pre>
              {"{\n"}
              {"  "}<span className="t-key">"id"</span>: <span className="t-str">"res_9f2c41…"</span>,{"\n"}
              {"  "}<span className="t-key">"embed_url"</span>: <span className="t-str">"https://embed.edk.earth/r/res_9f2c41…"</span>,{"\n"}
              {"  "}<span className="t-key">"usage"</span>: {"{ "}<span className="t-key">"locations"</span>: <span className="t-num">10</span>, <span className="t-key">"areas"</span>: <span className="t-num">0</span>, <span className="t-key">"cu"</span>: <span className="t-num">2</span>{" },\n"}
              {"  "}<span className="t-key">"data"</span>: {"{\n"}
              {"    "}<span className="t-key">"answer"</span>: <span className="t-str">"Ten bridges across the Allegheny…"</span>,{"\n"}
              {"    "}<span className="t-key">"geojson"</span>: {"{ "}<span className="t-key">"type"</span>: <span className="t-str">"FeatureCollection"</span>, <span className="t-key">"features"</span>: [{"\n"}
              {"      { "}<span className="t-key">"geometry"</span>: {"{ "}<span className="t-key">"coordinates"</span>: [<span className="t-num">-80.0063</span>, <span className="t-num">40.4446</span>] {"},\n"}
              {"        "}<span className="t-key">"properties"</span>: {"{ "}<span className="t-key">"name"</span>: <span className="t-str">"Roberto Clemente Bridge"</span>,{"\n"}
              {"          "}<span className="t-key">"image_url"</span>: <span className="t-str">"https://cdn.edk.earth/i/…"</span>{" } },\n"}
              {"      "}<span className="t-dim">…</span>{"\n"}
              {"    ] }\n  }\n}"}
            </pre>
          </div>
        </div>

        <section className="section" aria-labelledby="ask-title">
          <div className="section-head">
            <div>
              <span className="section-kicker">What machines can ask</span>
              <h2 id="ask-title">The ground truth, one call away</h2>
              <p>Imagery, civic records, open map data and area statistics, behind a single query engine that decides what each question needs.</p>
            </div>
            <div className="head-art art-host"><AsciiArt art={[{ scene: "birds", x: 0.5, y: 0.5, size: 0.42 }]} /></div>
          </div>
          <div className="cards">
            {capabilities.map((c) => (
              <article className="card" key={c.title}>
                <span className="card-icon"><Icon name={c.icon} /></span>
                <h3>{c.title}</h3>
                <p>{c.body}</p>
                <code>{c.code}</code>
              </article>
            ))}
          </div>
        </section>

        <section className="section" aria-labelledby="how-title">
          <div className="section-head">
            <div>
              <span className="section-kicker">How it works</span>
              <h2 id="how-title">From a question to the Atlas</h2>
              <p>No GIS stack, tile server or data pipeline to run.</p>
            </div>
            <div className="head-art art-host"><AsciiArt art={[{ scene: "houses", x: 0.5, y: 0.55, size: 0.55 }]} /></div>
          </div>
          <div className="steps">
            <article className="step"><span className="step-num">1</span><h3>Ask</h3><p>Send a question in plain words, optionally with points or a region to search around.</p></article>
            <article className="step"><span className="step-num">2</span><h3>EDK routes it</h3><p>The engine picks the sources, regions and conditions the question needs, and writes a short answer.</p></article>
            <article className="step"><span className="step-num">3</span><h3>Use the result</h3><p>GeoJSON with names, dates and CDN images, an answer, and an embed_url that shows it all on the Atlas.</p></article>
          </div>
        </section>

        <section className="section" aria-labelledby="map-title">
          <div className="map-band">
            <div>
              <span className="section-kicker">EDK Atlas</span>
              <h2 id="map-title">See it on the Atlas</h2>
              <p>The Atlas is EDK on a map, free to use. Search the world, open any result, and embed it in your own pages with your agent's results already loaded.</p>
              <div className="row">
                <Link className="btn btn-primary" to="/atlas">Open the Atlas</Link>
                <Link className="btn" to="/docs#embeds">Embed it</Link>
              </div>
            </div>
            <Link className="map-frame art-host" to="/atlas" aria-label="Open the EDK Atlas">
              <div className="art-layer"><AsciiArt art={[{ scene: "houses", x: 0.3, y: 0.52, size: 0.34 }, { scene: "trees", x: 0.7, y: 0.5, size: 0.32 }, { scene: "cars", x: 0.52, y: 0.86, size: 0.2 }]} interactive={false} /></div>
            </Link>
          </div>
        </section>

        <section className="section" aria-labelledby="ship-title">
          <div className="section-head">
            <div>
              <span className="section-kicker">Build from anywhere</span>
              <h2 id="ship-title">REST, SDK, CLI and MCP</h2>
              <p>Call it from code, the terminal or your coding agent. <Link to="/agents">Connect Claude, Codex, Cursor or Gemini</Link> in a minute.</p>
            </div>
          </div>
          <div className="distribution">
            <Link className="dist-card" to="/docs#search"><span className="tag is-ochre">API</span><strong>REST API</strong><code>{API}/v1</code></Link>
            <Link className="dist-card" to="/docs#sdk"><span className="tag">SDK</span><strong>{PACKAGES.sdk}</strong><code>npm install {PACKAGES.sdk}</code></Link>
            <Link className="dist-card" to="/docs#cli"><span className="tag">CLI</span><strong>{PACKAGES.cli}</strong><code>npm install -g {PACKAGES.cli}</code></Link>
            <Link className="dist-card" to="/docs#mcp"><span className="tag is-moss">MCP</span><strong>{PACKAGES.mcp}</strong><code>npx -y {PACKAGES.mcp}</code></Link>
          </div>
        </section>

        <section className="section" id="pricing" aria-labelledby="pricing-title">
          <div className="section-head">
            <div>
              <span className="section-kicker">Pricing</span>
              <h2 id="pricing-title">Pay for what comes back</h2>
              <p>A Compute Unit (CU) covers five locations or areas in your results. Looking up regions and the catalog is free, and a search never returns more than your balance covers.</p>
            </div>
            <div className="head-art art-host"><AsciiArt art={[{ scene: "butterflies", x: 0.5, y: 0.5, size: 0.42 }]} /></div>
          </div>
          <div className="pricing">
            <article className="price-card">
              <span className="tag is-moss">Start</span>
              <div className="price">{FREE_CU} CU <small>free</small></div>
              <ul><li>Every new account</li><li>Full API, SDK, CLI and MCP</li><li>No card needed</li></ul>
            </article>
            <article className="price-card is-featured">
              <span className="tag is-ochre">Credits</span>
              <div className="price">${(CU_PRICE_USD * 1000).toFixed(0)} <small>per 1,000 CU</small></div>
              <ul><li>Add from ${MIN_TOPUP_USD} ({cuForDollars(MIN_TOPUP_USD).toLocaleString("en-US")} CU)</li><li>Credits never expire</li><li>Set a monthly CU limit</li></ul>
            </article>
            <article className="price-card">
              <span className="tag">Atlas</span>
              <div className="price">Free</div>
              <ul><li>Search the public Atlas</li><li>Embed stored results anywhere</li><li>Live embeds bill your CU</li></ul>
            </article>
          </div>
        </section>

        <section className="cta art-host">
          <div className="art-layer"><AsciiArt art={[{ scene: "branch-tree", x: 0.11, y: 0.97, size: 0.5 }, { scene: "aurora", x: 0.87, y: 0.42, size: 0.4 }]} /></div>
          <h2>Point your machines at the world</h2>
          <p>Create an account, make a key, and run your first search in under a minute.</p>
          <div className="hero-actions">
            <Link className="btn btn-primary btn-lg" to={user ? "/console" : "/sign-up"}>{user ? "Open the console" : "Get started free"}</Link>
            <Link className="btn btn-lg" to="/agents">Onboard your agent</Link>
          </div>
        </section>
      </main>
    </SiteLayout>
  );
}
