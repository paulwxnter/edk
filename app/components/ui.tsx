import { useEffect, useId, useRef, useState } from "react";

/** A dialog over the page. Escape and the backdrop close it. */
export function Modal({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? " is-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export type Option = { id: string; label: string; detail?: string | null };

/**
 * Type to search, pick from the list under the field. Picked options show as chips.
 * `search` is called as the text changes (debounced) and returns the options to show.
 */
export function Autocomplete({ value, onChange, search, placeholder, max = 5, autoFocus = false }: { value: Option[]; onChange: (v: Option[]) => void; search: (q: string, signal: AbortSignal) => Promise<Option[]>; placeholder: string; max?: number; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState<Option[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const picked = new Set(value.map((v) => v.id));
  const shown = list.filter((o) => !picked.has(o.id));

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    setBusy(true);
    const t = window.setTimeout(async () => {
      try {
        setList(await search(q.trim(), ctrl.signal));
        setActive(0);
      } catch {
        /* aborted */
      } finally {
        if (!ctrl.signal.aborted) setBusy(false);
      }
    }, 180);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
    };
  }, [q, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (o: Option) => {
    onChange([...value, o]);
    setQ("");
    setActive(0);
    inputRef.current?.focus();
  };
  const full = value.length >= max;

  return (
    <div className={`ac${open && !full ? " is-open" : ""}`}>
      <div className="ac-field" onClick={() => inputRef.current?.focus()}>
        {value.map((v) => (
          <span key={v.id} className="ac-chip">
            {v.label}
            <button type="button" aria-label={`Remove ${v.label}`} onClick={(e) => { e.stopPropagation(); onChange(value.filter((x) => x.id !== v.id)); }}>×</button>
          </span>
        ))}
        {full ? null : (
          <input
            ref={inputRef}
            value={q}
            autoFocus={autoFocus}
            onChange={(e) => { setQ(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 120)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, shown.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
              else if (e.key === "Enter") { if (shown[active]) { e.preventDefault(); pick(shown[active]); } }
              else if (e.key === "Backspace" && !q && value.length) onChange(value.slice(0, -1));
              else if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
            }}
            placeholder={value.length ? "Add another" : placeholder}
            role="combobox"
            aria-expanded={open && shown.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
          />
        )}
      </div>
      {open && !full ? (
        <ul className="ac-list" id={listId} role="listbox">
          {shown.slice(0, 8).map((o, i) => (
            <li key={o.id} role="option" aria-selected={i === active}>
              <button type="button" className={i === active ? "is-active" : ""} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => pick(o)}>
                <strong>{o.label}</strong>
                {o.detail ? <small>{o.detail}</small> : null}
              </button>
            </li>
          ))}
          {!shown.length ? <li className="ac-empty">{busy ? "Searching…" : q ? `Nothing matches "${q}"` : "Start typing to search"}</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

/** A row of mutually exclusive choices. */
export function Segmented<T extends string | number>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, string][]; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={value === v} className={value === v ? "is-on" : ""} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}
