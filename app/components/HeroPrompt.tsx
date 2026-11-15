import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { DEFAULT_REASONING, REASONING, type ReasoningId } from "~/lib/tiers";

const EXAMPLES = ["Bridges in Pittsburgh", "Solar farms near Phoenix", "High income areas in Denver"];

/** The landing page's query box: a question goes straight to the Atlas, at the reasoning level picked. */
export default function HeroPrompt() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [reasoning, setReasoning] = useState<ReasoningId>(DEFAULT_REASONING);
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const level = REASONING.find((r) => r.id === reasoning)!;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !menu.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const go = (q: string) => {
    const text = q.trim();
    if (text) navigate(`/atlas?q=${encodeURIComponent(text)}${reasoning === DEFAULT_REASONING ? "" : `&reasoning=${reasoning}`}`);
  };
  return (
    <div className="prompt-wrap">
      <form className="prompt" onSubmit={(e) => { e.preventDefault(); go(query); }}>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(query); } }}
          placeholder="Ask EDK-1 about any place…"
          aria-label="Ask EDK-1 about any place"
          rows={2}
          maxLength={500}
        />
        <div className="prompt-bar">
          <span className="prompt-model"><svg className="prompt-infinity" width="18" height="10" viewBox="0 0 36 20" fill="none" aria-hidden="true"><path pathLength="100" d="M18 10c-3.5-4.5-6-7-9.5-7a7 7 0 0 0 0 14c3.5 0 6-2.5 9.5-7s6-7 9.5-7a7 7 0 0 1 0 14c-3.5 0-6-2.5-9.5-7Z" /></svg>EDK-1</span>
          <div className="prompt-reasoning" ref={menu}>
            <button type="button" className="prompt-reasoning-btn" aria-haspopup="listbox" aria-expanded={open} aria-label={`Mode: ${level.name}`} onClick={() => setOpen((v) => !v)}>
              {level.name}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </button>
            {open ? (
              <ul className="prompt-reasoning-menu" role="listbox" aria-label="Mode">
                {REASONING.map((r) => (
                  <li key={r.id} role="option" aria-selected={r.id === reasoning}>
                    <button type="button" onClick={() => { setReasoning(r.id); setOpen(false); }}>
                      <strong>{r.name}</strong>
                      <small>{r.does}</small>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <button className="prompt-send" type="submit" disabled={!query.trim()} aria-label="Discover">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" /></svg>
          </button>
        </div>
      </form>
      <div className="prompt-examples">
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" className="chip" onClick={() => go(ex)}>{ex}</button>
        ))}
      </div>
    </div>
  );
}
