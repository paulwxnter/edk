import { SiteLayout } from "~/components/chrome";
import { Logo, Mark, Wordmark } from "~/components/brand";

export const meta = () => [
  { title: "Brand · EDK" },
  { name: "description", content: "The EDK logo, colors and type, with downloadable assets." },
];

const colors: [string, string, string][] = [
  ["Soil", "#13110E", "Dark canvas, ink on light"],
  ["Paper", "#F1EBDF", "Light canvas, mark on dark"],
  ["Ochre", "#E0A458", "The north needle, primary actions"],
  ["Moss", "#9CB46A", "Live, verified, free"],
  ["Clay", "#C8643F", "Warnings and highlights, sparingly"],
  ["Sky", "#8FB3C0", "Water, numbers in code"],
];

const assets: [string, string, string[]][] = [
  ["Mark", "edk-mark", ["svg", "512.png"]],
  ["Mark on dark", "edk-mark-on-dark", ["svg", "512.png"]],
  ["Mark, one color", "edk-mark-mono", ["svg"]],
  ["Wordmark", "edk-wordmark", ["svg"]],
  ["Wordmark on dark", "edk-wordmark-on-dark", ["svg"]],
  ["Lockup", "edk-lockup", ["svg", "1200.png"]],
  ["Lockup on dark", "edk-lockup-on-dark", ["svg", "1200.png"]],
  ["App icon", "edk-app-icon", ["svg", "512.png", "192.png"]],
  ["Social card", "edk-social-card", ["svg", "png"]],
];

const file = (base: string, ext: string) => `/brand/${base}${ext.includes(".") ? `-${ext}` : `.${ext}`}`;

export default function Brand() {
  return (
    <SiteLayout>
      <section className="page-hero">
        <span className="section-kicker">Brand</span>
        <h1>The compass</h1>
        <p>A heavy Earth ring crossed by a compass needle. The ochre north point breaks out of the ring: machines finding their way across the world.</p>
      </section>

      <section className="section" style={{ paddingTop: "2rem" }}>
        <div className="brand-hero">
          <div className="brand-tile is-dark"><Logo to={null} size={64} /></div>
          <div className="brand-tile is-light"><Logo to={null} size={64} /></div>
          <div className="brand-tile is-ochre"><Mark size={96} mono /></div>
        </div>
      </section>

      <div className="docs" style={{ marginTop: "3rem" }}>
        <nav className="docs-toc" aria-label="On this page">
          <span className="label">Brand</span>
          <a href="#logo">Logo</a>
          <a href="#color">Color</a>
          <a href="#type">Type</a>
          <a href="#assets">Assets</a>
        </nav>
        <article className="prose">
          <h2 id="logo">Logo</h2>
          <p>The mark is drawn on a 64-unit grid: a ring 7 units thick, a north–south needle that runs past the ring at both ends, and a short east–west bar. The wordmark is custom drawn with 9-unit strokes; use the artwork, never type "edk" in a font.</p>
          <ul>
            <li>The north point is always <strong>Ochre</strong>. Everything else takes one ink: Soil on light, Paper on dark.</li>
            <li>Keep clear space of at least a quarter of the mark's width on every side.</li>
            <li>Smallest sizes: 16px for the mark, 96px wide for the lockup.</li>
            <li>Don't rotate the needle, recolor the north point, outline the mark or add effects.</li>
            <li>On Ochre, use the one-color mark in Soil.</li>
          </ul>
          <div className="brand-specimen">
            <span><Mark size={16} /></span><span><Mark size={24} /></span><span><Mark size={40} /></span><span><Wordmark height={28} /></span>
          </div>

          <h2 id="color">Color</h2>
          <p>Earth tones on a soil-dark canvas. Ochre stays under a few percent of any screen.</p>
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
          <p><strong>Fraunces</strong> for display headings, <strong>Geist</strong> for interface and body text, <strong>Geist Mono</strong> for code, labels and numbers. ASCII scenes (an Earth, trees, birds, waves) are etched in a page-aligned glyph grid and appear around content, never behind text.</p>

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
          <p>The full guide is in the repository as <code>brand.md</code>.</p>
        </article>
      </div>
    </SiteLayout>
  );
}
