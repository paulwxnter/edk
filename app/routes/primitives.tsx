import { Link } from "react-router";
import { SiteLayout } from "~/components/chrome";
import AsciiArt from "~/ascii/AsciiArt";
import { PRIMITIVES } from "~/lib/primitives";

export const meta = () => [
  { title: "Model · EDK" },
  { name: "description", content: "EDK-1, a model of physical computation: Position, Condition, Motion, Navigation, Stream and Vision, and what each lets a machine do on Earth." },
];

export default function Primitives() {
  return (
    <SiteLayout>
      <section className="page-hero primitives-hero">
        <h1>Physical Computation</h1>
        <p>Language models learned to read. EDK-1 learns the ground. Six things a machine must know to act on Earth, each building on those before it.</p>
        <nav className="primitive-index" aria-label="Primitives">
          {PRIMITIVES.map((p, i) => (
            <a key={p.id} href={`#${p.id}`}><span>0{i + 1}</span>{p.name}</a>
          ))}
        </nav>
      </section>

      <div className="primitive-rows">
        {PRIMITIVES.map((p, i) => (
          <section key={p.id} id={p.id} className="primitive-row" aria-labelledby={`${p.id}-title`}>
            <div className="primitive-copy">
              <span className="primitive-num">0{i + 1}</span>
              <h2 id={`${p.id}-title`}>{p.name}</h2>
              <p className="primitive-sub">{p.subtitle}</p>
              <p className="primitive-desc">{p.description}</p>
              <ul className="primitive-asks">
                {p.asks.map((q) => <li key={q}>{q}</li>)}
              </ul>
              <div className="primitive-today">
                <span>In EDK-1 today</span>
                <p>{p.today}</p>
                <code>{p.call}</code>
              </div>
            </div>
            <div className="primitive-art art-host" aria-hidden="true">
              <AsciiArt art={[{ scene: p.scene, x: 0.5, y: p.scene === "cars" ? 0.6 : 0.5, size: 0.42 }]} />
            </div>
          </section>
        ))}
      </div>

      <section className="cta" style={{ marginTop: "clamp(3.5rem, 8vw, 6rem)" }}>
        <h2>Put the primitives to work</h2>
        <p>Five calls reach all six: Discover, Inspect, Route, Monitor and Detect.</p>
        <div className="hero-actions">
          <Link className="btn btn-primary btn-lg" to="/atlas">Open the Atlas</Link>
          <Link className="btn btn-lg" to="/docs">Read the docs</Link>
        </div>
      </section>
    </SiteLayout>
  );
}
