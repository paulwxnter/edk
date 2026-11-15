import { Link } from "react-router";
import type { Route } from "./+types/home";
import { SiteLayout, useUser } from "~/components/chrome";
import { AgentChip, InstallSwitcher } from "~/components/copy";
import HeroPrompt from "~/components/HeroPrompt";
import AsciiArt from "~/ascii/AsciiArt";
import EmbedMap from "~/map/EmbedMap";
import { API, PACKAGES } from "~/lib/agents";
import { FREE_CU } from "~/lib/pricing";
import { HERO_LEAD, ONE_LINER, PRIMITIVES } from "~/lib/primitives";
import { openEmbed } from "../../server/embed";

export function meta({ data }: Route.MetaArgs) {
  if (data?.mode === "embed") return [{ title: "EDK Atlas" }, { name: "description", content: "Discover and inspect the world with EDK-1." }];
  return [
    { title: "EDK: Compass for Machines" },
    { name: "description", content: `${ONE_LINER} Find places, understand any spot, route between them and watch for change, through one API.` },
    { property: "og:title", content: "EDK: Compass for Machines" },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const embedHost = url.hostname.startsWith("embed.");
  // Local development: ?embed=1 shows the Atlas.
  const isEmbed = embedHost || (import.meta.env.DEV && url.searchParams.has("embed"));
  if (!isEmbed) return { mode: "site" as const };
  const key = url.searchParams.get("key");
  const mapboxToken = process.env.MAPBOX_API_KEY?.startsWith("pk.") ? process.env.MAPBOX_API_KEY : null;
  const query = (url.searchParams.get("q") || "").slice(0, 500);
  if (!key) return { mode: "embed" as const, query, token: null, error: "This map needs an embed key. Create one in Console → Embeds on edk.earth.", mapboxToken };
  const opened = await openEmbed(context.cloudflare.env.DB, key, request.headers.get("referer"), request.headers.get("cf-connecting-ip") || "local");
  if ("error" in opened) return { mode: "embed" as const, query, token: null, error: opened.error as string, mapboxToken };
  return { mode: "embed" as const, query, token: opened.token, error: null, mapboxToken };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  if (loaderData.mode === "embed") return <EmbedMap initialQuery={loaderData.query} token={loaderData.token} keyError={loaderData.error} mapboxToken={loaderData.mapboxToken} readOnly={!loaderData.token} />;
  return <Landing />;
}

const requestSample = `curl -X POST ${API}/v1/discover \\
  -H "Authorization: Bearer $EDK_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{ "query": "bridges in Pittsburgh", "limit": 10 }'`;

function Landing() {
  const user = useUser();
  return (
    <SiteLayout>
      <main>
        <section className="hero hero-split">
          <div className="hero-bg" aria-hidden="true" />
          <div className="hero-copy">
            <h1>Compass for Machines</h1>
            <p className="lead">{HERO_LEAD}</p>
            <HeroPrompt />
            <div className="hero-links">
              <Link className="btn btn-primary" to={user ? "/console" : "/sign-up"}>{user ? "Playground" : "Get started"}</Link>
              <Link className="btn" to="/signals">Insights</Link>
              <Link className="btn" to="/docs">Docs</Link>
              <AgentChip />
            </div>
          </div>
          <div className="hero-earth art-host" title="Drag to turn">
            <AsciiArt art={[{ scene: "earth", x: 0.5, y: 0.48, size: 0.38 }]} />
          </div>
        </section>

        <div className="demo" role="figure" aria-label="A Discover request and its response">
          <div className="demo-pane">
            <div className="demo-bar"><i /><i /><i /><span>discover</span></div>
            <pre>{requestSample}</pre>
            <div style={{ padding: "0 1.2rem 1.2rem" }}><InstallSwitcher /></div>
          </div>
          <div className="demo-pane">
            <div className="demo-bar"><i /><i /><i /><span>200 OK</span></div>
            <pre>
              {"{\n"}
              {"  "}<span className="t-key">"model"</span>: <span className="t-str">"edk-1"</span>,{"\n"}
              {"  "}<span className="t-key">"usage"</span>: {"{ "}<span className="t-key">"locations"</span>: <span className="t-num">10</span>, <span className="t-key">"cu"</span>: <span className="t-num">2</span>{" },\n"}
              {"  "}<span className="t-key">"embed_url"</span>: <span className="t-str">"https://embed.edk.earth/r/res_9f2c…"</span>,{"\n"}
              {"  "}<span className="t-key">"data"</span>: {"{ "}<span className="t-key">"geojson"</span>: {"{ "}<span className="t-key">"features"</span>: [{"\n"}
              {"    { "}<span className="t-key">"geometry"</span>: {"{ "}<span className="t-key">"coordinates"</span>: [<span className="t-num">-80.0063</span>, <span className="t-num">40.4446</span>] {"},\n"}
              {"      "}<span className="t-key">"properties"</span>: {"{\n"}
              {"        "}<span className="t-key">"kind"</span>: <span className="t-str">"location"</span>,{"\n"}
              {"        "}<span className="t-key">"feature_name"</span>: <span className="t-str">"Bridge"</span>,{"\n"}
              {"        "}<span className="t-key">"neighborhood"</span>: <span className="t-str">"North Shore"</span>,{"\n"}
              {"        "}<span className="t-key">"image_url"</span>: <span className="t-str">"https://cdn.edk.earth/i/…"</span>{" } },\n"}
              {"    "}<span className="t-dim">…</span>{"\n"}
              {"  ] } }\n}"}
            </pre>
          </div>
        </div>

        <section className="section" aria-labelledby="core-title">
          <div className="section-head">
            <div>
              <h2 id="core-title">Physical Intelligence</h2>
              <p>Six things a machine must know to act on Earth, each building on those before it.</p>
            </div>
            <Link className="btn" to="/model">The model</Link>
          </div>
          <div className="primitive-grid">
            {PRIMITIVES.map((p, i) => (
              <Link className="primitive-card" key={p.id} to={`/model#${p.id}`}>
                <div className="primitive-card-art art-host" aria-hidden="true">
                  <AsciiArt art={[{ scene: p.scene, x: 0.5, y: p.scene === "cars" ? 0.62 : 0.55, size: 0.32 }]} interactive={false} />
                </div>
                <span className="primitive-num">0{i + 1}</span>
                <h3>{p.name}</h3>
                <p className="primitive-sub">{p.subtitle}</p>
                <p>{p.description}</p>
              </Link>
            ))}
          </div>
        </section>

        <section className="section" aria-labelledby="calls-title">
          <div className="section-head">
            <div>
              <h2 id="calls-title">Intelligence on Demand</h2>
              <p>Five calls, from one question to a standing watch.</p>
            </div>
          </div>
          <div className="cards cards-5">
            <article className="card">
              <span className="tag is-ochre">Discover</span>
              <h3>Find</h3>
              <p>Bridges, parks, solar farms, or areas that meet conditions like income, flood risk or tree canopy. Get locations and areas back, with imagery.</p>
              <code>POST /v1/discover</code>
            </article>
            <article className="card">
              <span className="tag is-moss">Inspect</span>
              <h3>Understand</h3>
              <p>Point anywhere and get what is known about it: who lives there, terrain, hazards, climate and more.</p>
              <code>GET /v1/inspect?lat=&amp;lng=</code>
            </article>
            <article className="card">
              <span className="tag">Route</span>
              <h3>Navigate</h3>
              <p>From A to B, steered around what you ask it to avoid: pothole streets, flood-prone blocks, construction.</p>
              <code>POST /v1/route</code>
            </article>
            <article className="card">
              <span className="tag">Monitor</span>
              <h3>Watch</h3>
              <p>Pick what to watch, where, and since when. Every new event is sent to your webhook as it appears. Tier 4 and above.</p>
              <code>POST /v1/monitors</code>
            </article>
            <article className="card">
              <span className="tag">Detect</span>
              <h3>See</h3>
              <p>Send an image and get back every object EDK-1 knows in it, each with a label, a box and its coordinates.</p>
              <code>POST /v1/detect</code>
            </article>
          </div>
        </section>

        <section className="section" aria-labelledby="map-title">
          <div className="map-band">
            <div>
              <h2 id="map-title">See it on the Atlas</h2>
              <p>Find, understand and route on a live map with your account. Every API result comes with a link that opens it on the Atlas.</p>
              <div className="row">
                <Link className="btn btn-primary" to="/atlas">Open the Atlas</Link>
                <Link className="btn" to="/docs#embeds">Embed</Link>
              </div>
            </div>
            <Link className="map-frame art-host" to="/atlas" aria-label="Open the EDK Atlas">
              <div className="art-layer"><AsciiArt art={[{ scene: "houses", x: 0.3, y: 0.52, size: 0.34 }, { scene: "trees", x: 0.7, y: 0.5, size: 0.32 }, { scene: "cars", x: 0.52, y: 0.86, size: 0.2 }]} interactive={false} /></div>
            </Link>
          </div>
        </section>

        <section className="section" aria-labelledby="signals-title">
          <div className="section-head">
            <div>
              <h2 id="signals-title">Signals</h2>
              <p>Explore how places change over time, from construction activity to traffic collisions.</p>
            </div>
            <Link className="btn" to="/signals">Explore Signals</Link>
          </div>
        </section>

        <section className="section" aria-labelledby="ship-title">
          <div className="section-head">
            <div>
              <h2 id="ship-title">REST, SDK, CLI and MCP</h2>
              <p>From code, the terminal or your agent. <Link to="/agents">Connect Claude, Codex, Cursor or Gemini</Link>.</p>
            </div>
          </div>
          <div className="distribution">
            <Link className="dist-card" to="/docs#discover"><span className="tag is-ochre">API</span><strong>REST API</strong><code>{API}/v1</code></Link>
            <Link className="dist-card" to="/docs#sdk"><span className="tag">SDK</span><strong>{PACKAGES.sdk}</strong><code>npm install {PACKAGES.sdk}</code></Link>
            <Link className="dist-card" to="/docs#cli"><span className="tag">CLI</span><strong>{PACKAGES.cli}</strong><code>npm install -g {PACKAGES.cli}</code></Link>
            <Link className="dist-card" to="/docs#mcp"><span className="tag is-moss">MCP</span><strong>{PACKAGES.mcp}</strong><code>npx -y {PACKAGES.mcp}</code></Link>
          </div>
        </section>

        <section className="cta art-host">
          <div className="art-layer"><AsciiArt art={[{ scene: "branch-tree", x: 0.11, y: 0.97, size: 0.5 }, { scene: "aurora", x: 0.87, y: 0.42, size: 0.4 }]} /></div>
          <h2>Give your machines a compass</h2>
          <p>{FREE_CU} CU /month. No credit card required.</p>
          <div className="hero-actions">
            <Link className="btn btn-primary btn-lg" to={user ? "/console" : "/sign-up"}>{user ? "Playground" : "Get started"}</Link>
            <Link className="btn btn-lg" to="/agents">Agents</Link>
          </div>
        </section>
      </main>
    </SiteLayout>
  );
}
