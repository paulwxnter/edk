import { SiteLayout } from "~/components/chrome";
import { Wordmark } from "~/components/brand";
import { ONE_LINER, PRIMITIVES } from "~/lib/primitives";

export const meta = () => [
  { title: "Brand · EDK" },
  { name: "description", content: "The four primitives of EDK-1, and the EDK wordmark, colors and type, with downloadable assets." },
];

const colors: [string, string, string][] = [
  ["Soil", "#13110E", "Canvas, ink on light"],
  ["Paper", "#F1EBDF", "Light canvas, ink on dark"],
  ["Ochre", "#E0A458", "Primary actions, one accent per screen"],
  ["Moss", "#9CB46A", "Live, verified, free"],
  ["Clay", "#C8643F", "Warnings, sparingly"],
  ["Sky", "#8FB3C0", "Water, numbers in code"],
];

const assets: [string, string, string[]][] = [
  ["Wordmark", "edk-wordmark", ["svg", "1200.png"]],
  ["Wordmark on dark", "edk-wordmark-on-dark", ["svg", "1200.png"]],
  ["Wordmark in ochre", "edk-wordmark-ochre", ["svg"]],
  ["App icon", "edk-app-icon", ["svg", "512.png", "192.png"]],
  ["Social card", "edk-social-card", ["svg", "png"]],
];

const file = (base: string, ext: string) => `/brand/${base}${ext.includes(".") ? `-${ext}` : `.${ext}`}`;

export default function Brand() {
  return (
    <SiteLayout>
      <section className="page-hero">
        <h1>edk</h1>
        <p>{ONE_LINER}</p>
      </section>

      <section className="section" style={{ paddingTop: "2rem" }}>
        <div className="brand-hero">
          <div className="brand-tile is-dark"><Wordmark height={72} /></div>
          <div className="brand-tile is-light"><Wordmark height={72} /></div>
          <div className="brand-tile is-ochre"><Wordmark height={56} /></div>
        </div>
      </section>

      <div className="docs" style={{ marginTop: "3rem" }}>
        <nav className="docs-toc" aria-label="On this page">
          <span className="label">Brand</span>
          <a href="#primitives">Primitives</a>
          <a href="#wordmark">Wordmark</a>
          <a href="#color">Color</a>
          <a href="#type">Type</a>
          <a href="#assets">Assets</a>
        </nav>
        <article className="prose">
          <h2 id="primitives">Primitives</h2>
          <p>Everything EDK-1 does is one of six primitives. Describe the model in these terms, in this order; each builds on the ones before it.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Primitive</th><th>What it is</th><th>Line</th></tr></thead>
              <tbody>
                {PRIMITIVES.map((p) => (
                  <tr key={p.name}><td><strong>{p.name}</strong></td><td>{p.subtitle}</td><td>{p.description}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul>
            <li>Tagline: <strong>Compass for Machines</strong>. The four primitives are what the compass reads.</li>
            <li>Capitalize a primitive when naming it, lowercase in running text.</li>
            <li>Discover, Inspect, Route and Monitor are the API calls; the primitives are what the model does.</li>
          </ul>

          <h2 id="wordmark">Wordmark</h2>
          <p>The wordmark is the logo. Drawn, not typeset: round letters on 9-unit strokes.</p>
          <ul>
            <li>Always lowercase <strong>edk</strong>, from the artwork. Never set it in a font.</li>
            <li>One ink: Soil on light, Paper on dark, Soil on Ochre.</li>
            <li>Clear space: the height of the "e" on every side. Smallest size: 14px tall.</li>
            <li>Don't stretch, outline, rotate or add effects.</li>
          </ul>
          <div className="brand-specimen"><Wordmark height={14} /><Wordmark height={22} /><Wordmark height={36} /></div>

          <h2 id="color">Color</h2>
          <div className="swatches">
            {colors.map(([name, hex, role]) => (
              <div className="swatch" key={name}>
                <span style={{ background: hex }} />
                <strong>{name}</strong>
                <code>{hex}</code>
                <small>{role}</small>
              </div>
            ))}
          </div>

          <h2 id="type">Type</h2>
          <p><strong>Geist</strong> for headings and text (600 for headings, tight tracking), <strong>Geist Mono</strong> for code, labels and numbers. ASCII scenes appear around content, never behind text.</p>

          <h2 id="assets">Assets</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Asset</th><th>Files</th></tr></thead>
              <tbody>
                {assets.map(([name, base, exts]) => (
                  <tr key={base}>
                    <td>{name}</td>
                    <td>{exts.map((ext) => <a key={ext} className="btn btn-sm" style={{ marginRight: ".4rem" }} href={file(base, ext)} download>{ext.toUpperCase().replace(".PNG", " PNG")}</a>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </div>
    </SiteLayout>
  );
}
