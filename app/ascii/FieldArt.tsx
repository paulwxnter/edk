import { useEffect, useRef } from "react";

// A quiet field of ASCII drawn behind the Playground's query box: map contours for Discover, survey
// rings for Inspect, travelled paths for Route. It fills its positioned parent, clears a space around
// the middle where the form sits, and fades out toward the bottom edge.

export type Field = "contours" | "rings" | "paths";

const CW = 9;
const CH = 17;
type Cell = { ch: string; a: number; accent?: boolean } | null;

const smooth = (lo: number, hi: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};
const hash = (x: number, y: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
/** The glyph for a line running along (tx, ty), in screen space. */
function stroke(tx: number, ty: number) {
  const a = ((Math.atan2(ty, tx) % Math.PI) + Math.PI) % Math.PI;
  if (a < Math.PI / 8 || a > (7 * Math.PI) / 8) return "-";
  if (a < (3 * Math.PI) / 8) return "\\";
  if (a < (5 * Math.PI) / 8) return "|";
  return "/";
}

const height = (x: number, y: number, t: number) => {
  const u = x / 210, v = y / 190;
  return Math.sin(u * 1.3 + t * 0.05) * Math.cos(v * 1.7 - t * 0.04) + 0.5 * Math.sin((u + v) * 2.1 + t * 0.03) + 0.25 * Math.sin(u * 4.3 - v * 3.1);
};

/** Contour lines of a slowly shifting terrain, with a few found places marked on it. */
function contours(x: number, y: number, t: number, col: number, row: number): Cell {
  const pin = hash(col, row);
  if (pin < 0.004) return { ch: "+", a: 0.55 + 0.45 * Math.sin(t * 1.4 + pin * 4000), accent: true };
  const f = height(x, y, t) * 3.4;
  const level = Math.round(f);
  const gx = height(x + 2, y, t) - height(x - 2, y, t);
  const gy = height(x, y + 2, t) - height(x, y - 2, t);
  // How far this cell is from the contour, in pixels: a line stays one glyph thick on any slope.
  const slope = (Math.hypot(gx, gy) / 4) * 3.4;
  if (Math.abs(f - level) > slope * 5) return null;
  return { ch: stroke(-gy, gx), a: level % 3 === 0 ? 0.9 : 0.42 };
}

/** Rings spreading from the spot being inspected, over a faint crosshair. */
function rings(x: number, y: number, t: number, col: number, row: number, w: number, h: number): Cell {
  const cx = w / 2, cy = h * 0.5;
  const dx = x - cx, dy = y - cy;
  const d = Math.hypot(dx, dy);
  const far = 1 - smooth(0, Math.max(w, h) * 0.62, d);
  const f = d / 58 - t * 0.2;
  const ring = Math.round(f);
  if (Math.abs(f - ring) < 0.09) return { ch: stroke(-dy, dx), a: (0.35 + 0.65 * far), accent: ((ring % 4) + 4) % 4 === 0 };
  const onRow = row === Math.floor(cy / CH), onCol = col === Math.floor(cx / CW);
  if (onRow && col % 2 === 0) return { ch: col % 10 === 0 ? "+" : "-", a: 0.3 * far };
  if (onCol) return { ch: row % 4 === 0 ? "+" : "|", a: 0.3 * far };
  return null;
}

const LANES = [
  { base: 0.2, amp: 0.07, wave: 170, phase: 0.4, speed: 5 },
  { base: 0.36, amp: 0.05, wave: 120, phase: 2.1, speed: -3 },
  { base: 0.8, amp: 0.08, wave: 210, phase: 4.2, speed: 7 },
];

/** Routes crossing the field as marching dashes over a dotted ground. The last one is the route taken. */
function paths(x: number, y: number, t: number, col: number, row: number, w: number, h: number): Cell {
  for (let i = LANES.length - 1; i >= 0; i--) {
    const lane = LANES[i];
    const at = (px: number) => h * (lane.base + lane.amp * Math.sin(px / lane.wave + lane.phase + t * 0.08));
    if (Math.floor(at(x) / CH) !== row) continue;
    const taken = i === LANES.length - 1;
    const march = (((col - t * lane.speed) % 9) + 9) % 9;
    if (taken && march < 1) return { ch: ">", a: 1, accent: true };
    if (march > 5.5) return null;
    return { ch: stroke(CW, at(x + CW / 2) - at(x - CW / 2)), a: taken ? 0.9 : 0.5, accent: taken };
  }
  return col % 6 === 0 && row % 3 === 0 ? { ch: ".", a: 0.28 } : null;
}

const FIELDS = { contours, rings, paths };

export default function FieldArt({ field }: { field: Field }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !host || !ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const scheme = window.matchMedia("(prefers-color-scheme: light)");
    const cell = FIELDS[field];
    let raf = 0, visible = true, last = 0, w = 0, h = 0, ink = "#888", accent = "#e0a458";

    const draw = (now: number) => {
      const t = reduced.matches ? 12 : now / 1000;
      ctx.clearRect(0, 0, w, h);
      // The form's clearing: an ellipse around the middle, never narrower than the query box.
      const rx = Math.min(w * 0.5, 370), ry = h * 0.42;
      for (let row = 0; row * CH < h; row++) {
        const y = row * CH + CH / 2;
        const edge = smooth(0, 0.2, 1 - y / h) * smooth(0, 0.06, y / h);
        for (let col = 0; col * CW < w; col++) {
          const x = col * CW + CW / 2;
          const clear = smooth(0.95, 1.75, Math.hypot((x - w / 2) / rx, (y - h / 2) / ry));
          if (clear * edge < 0.04) continue;
          const c = cell(x, y, t, col, row, w, h);
          if (!c || c.a <= 0) continue;
          ctx.globalAlpha = Math.min(1, c.a * clear * edge * (c.accent ? 0.85 : 0.6));
          ctx.fillStyle = c.accent ? accent : ink;
          ctx.fillText(c.ch, x, y);
        }
      }
    };
    const frame = (now: number) => {
      raf = 0;
      if (!visible || document.hidden || reduced.matches) return;
      if (now - last >= 1000 / 15) {
        draw(now);
        last = now;
      }
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      draw(performance.now());
      if (visible && !document.hidden && !reduced.matches) raf = requestAnimationFrame(frame);
    };
    const resize = () => {
      const box = host.getBoundingClientRect();
      w = Math.max(1, Math.round(box.width));
      h = Math.max(1, Math.round(box.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const css = getComputedStyle(host);
      ink = css.getPropertyValue("--fg-muted").trim() || ink;
      accent = css.getPropertyValue("--ochre-text").trim() || accent;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `12px ${css.getPropertyValue("--font-mono").trim() || "monospace"}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      start();
    };
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      start();
    });
    const ro = new ResizeObserver(resize);
    resize();
    io.observe(host);
    ro.observe(host);
    document.addEventListener("visibilitychange", start);
    scheme.addEventListener("change", resize);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", start);
      scheme.removeEventListener("change", resize);
    };
  }, [field]);

  return <canvas ref={ref} className="field-art" aria-hidden="true" />;
}
