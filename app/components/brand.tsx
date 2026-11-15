import { Link } from "react-router";

/** The EDK mark: a heavy Earth ring crossed by a compass needle whose ochre north point breaks out of it. */
export function Mark({ size = 26, mono = false }: { size?: number; mono?: boolean }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="22.5" fill="none" stroke="currentColor" strokeWidth="7" />
      <path d="M32 1.5 41.5 32H22.5Z" fill={mono ? "currentColor" : "var(--ochre, #e0a458)"} />
      <path d="M32 62.5 22.5 32H41.5Z" fill="currentColor" />
      <path d="M11 32 32 27.2V36.8Z M53 32 32 36.8V27.2Z" fill="currentColor" />
      <circle cx="32" cy="32" r="3.6" fill="var(--bg, #13110e)" stroke="currentColor" strokeWidth="2.4" />
    </svg>
  );
}

/** The custom "edk" wordmark (drawn, not typeset). */
export function Wordmark({ height = 20 }: { height?: number }) {
  return (
    <svg className="brand-word" height={height} width={(height * 136) / 64} viewBox="0 0 136 64" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="9">
        <path d="M8.5 40H40.5A16 16 0 1 0 36.8 50.3" />
        <circle cx="71.5" cy="40" r="16" />
        <path d="M87.5 2V60.5M105.5 2V60.5M106 47 128.5 21.5M113.5 38.5 131 60.5" />
      </g>
    </svg>
  );
}

/** The EDK logo is the wordmark alone. `size` is its height in pixels. */
export function Logo({ to = "/", size = 22 }: { to?: string | null; size?: number }) {
  const inner = (
    <>
      <Wordmark height={size} />
      <span className="sr-only">EDK</span>
    </>
  );
  if (to === null) return <span className="brand">{inner}</span>;
  return to.startsWith("http") ? (
    <a className="brand" href={to} aria-label="EDK home">{inner}</a>
  ) : (
    <Link className="brand" to={to} aria-label="EDK home">{inner}</Link>
  );
}

/** Topographic contour lines: nested, gently irregular rings around a few summits. */
export function Contours({ seed = 7 }: { seed?: number }) {
  const summits: [number, number, number][] = [
    [520, 330, 15],
    [1080, 260, 12],
    [820, 640, 10],
  ];
  let s = seed;
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const paths: { d: string; strong: boolean }[] = [];
  for (const [cx, cy, rings] of summits) {
    const wobble = Array.from({ length: 7 }, () => rand() * Math.PI * 2);
    for (let r = 1; r <= rings; r++) {
      const radius = r * 34;
      const pts: string[] = [];
      for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        const k = 1 + 0.12 * Math.sin(3 * a + wobble[0]) + 0.07 * Math.sin(5 * a + wobble[1] + r * 0.3) + 0.04 * Math.sin(9 * a + wobble[2]);
        pts.push(`${(cx + Math.cos(a) * radius * k * 1.35).toFixed(1)},${(cy + Math.sin(a) * radius * k).toFixed(1)}`);
      }
      paths.push({ d: `M${pts.join("L")}Z`, strong: r % 5 === 0 });
    }
  }
  return (
    <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {paths.map((p, i) => (
        <path key={i} d={p.d} className={p.strong ? "contour contour-strong" : "contour"} />
      ))}
    </svg>
  );
}
