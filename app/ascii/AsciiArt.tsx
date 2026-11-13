import { useEffect, useRef } from "react";
import type { ArtworkPlacement } from "./compositions";
import type { MotionSceneId } from "./scenes";

// ASCII scenes (ported from eearth): physical-world subjects drawn as geometry, then etched into a
// grid of page-aligned glyphs. Each instance fills its positioned parent and only animates while
// on screen. Pointer drags turn the Earth; clicks send a pulse.

export type Art = { scene: MotionSceneId; x: number; y: number; size: number };

const STEP = 1 / 60;

export default function AsciiArt({ art, className = "", interactive = true }: { art: Art[]; className?: string; interactive?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = JSON.stringify(art);

  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    let disposed = false;
    let cleanup = () => {};

    (async () => {
      const [{ KoiRenderer }, { SceneLife }] = await Promise.all([import("./koi/renderer"), import("./SceneLife")]);
      if (disposed) return;
      const renderer = new KoiRenderer(canvas);
      const light = window.matchMedia("(prefers-color-scheme: light)");
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
      const placements: ArtworkPlacement[] = art.map((a) => ({ scene: a.scene, anchor: "at", scale: 1, at: { x: a.x, y: a.y, size: a.size } }));
      const layers = placements.map((p, i) => new SceneLife(p.scene, 1, i, p));
      const surface = document.createElement("canvas");
      const source = surface.getContext("2d", { willReadFrequently: true })!;
      let raf = 0, last = 0, acc = 0, lastRender = 0, visible = false, width = 0, height = 0;
      let dragging = false, dragX = 0, moved = 0;

      const draw = () => {
        source.setTransform(1, 0, 0, 1, 0, 0);
        source.clearRect(0, 0, surface.width, surface.height);
        const { cw, ch } = renderer.grid;
        source.setTransform(2 / cw, 0, 0, 2 / ch, 0, 0);
        for (const layer of layers) layer.draw(source);
        renderer.renderGeometry(source, layers[0]?.time || 0);
      };
      const resize = () => {
        const box = host.getBoundingClientRect();
        if (Math.round(box.width) === width && Math.round(box.height) === height) return;
        width = Math.max(1, Math.round(box.width));
        height = Math.max(1, Math.round(box.height));
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        renderer.setTheme(light.matches && !document.documentElement.dataset.theme?.includes("dark"));
        renderer.resize(width, height, Math.min(window.devicePixelRatio || 1, 1.5));
        const { cols, rows } = renderer.grid;
        surface.width = cols * 2;
        surface.height = rows * 2;
        renderer.setDimBoxes([]);
        for (const layer of layers) {
          layer.resize(width, height, []);
          layer.setReduced(reduced.matches);
          // Settle rooted scenes before the first frame.
          for (let i = 0; i < 90; i++) layer.step(STEP);
        }
        draw();
      };
      const frame = (now: number) => {
        raf = 0;
        if (!visible || document.hidden || reduced.matches) return;
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        acc += dt;
        let steps = 0;
        while (acc >= STEP && steps < 4) {
          for (const layer of layers) layer.step(STEP);
          acc -= STEP;
          steps++;
        }
        if (steps === 4) acc = 0;
        if (now - lastRender >= 1000 / 30) {
          draw();
          lastRender = now;
        }
        raf = requestAnimationFrame(frame);
      };
      const start = () => {
        cancelAnimationFrame(raf);
        last = performance.now();
        acc = 0;
        if (visible && !document.hidden && !reduced.matches) raf = requestAnimationFrame(frame);
        else draw();
      };
      const local = (e: PointerEvent | MouseEvent) => {
        const b = host.getBoundingClientRect();
        return { x: e.clientX - b.left, y: e.clientY - b.top };
      };
      const onMove = (e: PointerEvent) => {
        const p = local(e);
        for (const layer of layers) layer.move({ ...p, active: e.pointerType !== "touch", speed: 0 });
        if (dragging) {
          const dx = e.clientX - dragX;
          moved += Math.abs(dx);
          for (const layer of layers) layer.drag(dx);
          dragX = e.clientX;
        }
      };
      const isControl = (e: Event) => e.composedPath().some((n) => n instanceof Element && n.matches("a,button,input,textarea,select,label"));
      const onDown = (e: PointerEvent) => {
        if (isControl(e)) return;
        dragging = true;
        dragX = e.clientX;
        moved = 0;
      };
      const onUp = () => {
        dragging = false;
        for (const layer of layers) layer.release();
      };
      const onClick = (e: MouseEvent) => {
        if (moved > 6 || isControl(e)) return;
        const p = local(e);
        for (const layer of layers) layer.click(p.x, p.y);
      };
      const io = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        start();
      });
      const ro = new ResizeObserver(() => resize());
      resize();
      io.observe(host);
      ro.observe(host);
      document.addEventListener("visibilitychange", start);
      light.addEventListener("change", () => { width = 0; resize(); });
      if (interactive) {
        host.addEventListener("pointermove", onMove, { passive: true });
        host.addEventListener("pointerdown", onDown);
        window.addEventListener("pointerup", onUp);
        host.addEventListener("click", onClick);
      }
      cleanup = () => {
        cancelAnimationFrame(raf);
        io.disconnect();
        ro.disconnect();
        document.removeEventListener("visibilitychange", start);
        host.removeEventListener("pointermove", onMove);
        host.removeEventListener("pointerdown", onDown);
        window.removeEventListener("pointerup", onUp);
        host.removeEventListener("click", onClick);
      };
    })();

    return () => {
      disposed = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, interactive]);

  return <canvas ref={ref} className={`ascii-art ${className}`} aria-hidden="true" />;
}
