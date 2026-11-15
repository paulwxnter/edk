import { useEffect, useId, useRef, useState } from "react";

// A text field that suggests places as you type, from Mapbox Search Box (landmarks, businesses and
// addresses). Picking one hands back its coordinates; typing on clears them.

export type Place = { lat: number; lng: number; label: string };
type Suggestion = { name: string; detail: string; label: string } & ({ place: Place } | { mapboxId: string; session: string });

const SEARCHBOX = "https://api.mapbox.com/search/searchbox/v1";
const COORDS = /^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/;

type Props = {
  value: string;
  onText: (text: string) => void;
  onPick: (place: Place) => void;
  /** A public Mapbox token; without one the field is a plain input. */
  token: string | null;
  /** Where to bias suggestions, [lng, lat]. */
  near?: () => [number, number] | null;
  placeholder: string;
  ariaLabel: string;
  /** Open the list above the field (the query bar sits at the bottom of the map). */
  dropUp?: boolean;
  onFocus?: () => void;
  autoFocus?: boolean;
  /** Search Box feature types, e.g. "place,neighborhood,address" for areas. Default: anything. */
  types?: string;
  sessionSearch?: boolean;
};

export default function PlaceInput({ value, onText, onPick, token, near, placeholder, ariaLabel, dropUp = false, onFocus, autoFocus, types, sessionSearch = false }: Props) {
  const [list, setList] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const picked = useRef<string | null>(null);
  const session = useRef<{ id: string; started: number; requests: number } | null>(null);
  const retrieving = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(false);
  const [pickError, setPickError] = useState(false);
  const listId = useId();

  useEffect(() => () => retrieving.current?.abort(), []);

  useEffect(() => {
    const text = value.trim();
    if (!token || !open || text.length < 3 || COORDS.test(text) || text === picked.current) {
      setList([]);
      return;
    }
    const ctrl = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const url = new URL(`${SEARCHBOX}/${sessionSearch ? "suggest" : "forward"}`);
        url.searchParams.set("q", text);
        url.searchParams.set("limit", "5");
        if (sessionSearch) {
          const now = Date.now();
          if (!session.current || now - session.current.started >= 180_000 || session.current.requests >= 49) {
            session.current = { id: crypto.randomUUID(), started: now, requests: 0 };
          }
          session.current.requests++;
          url.searchParams.set("session_token", session.current.id);
        }
        if (types) url.searchParams.set("types", types);
        const at = near?.();
        if (at) url.searchParams.set("proximity", `${at[0].toFixed(4)},${at[1].toFixed(4)}`);
        url.searchParams.set("access_token", token);
        const res = await fetch(url, { signal: ctrl.signal });
        const body = (await res.json().catch(() => null)) as any;
        if (ctrl.signal.aborted) return;
        const next: Suggestion[] = (sessionSearch ? body?.suggestions ?? [] : body?.features ?? []).flatMap((f: any): Suggestion[] => {
          const p = sessionSearch ? f : f.properties ?? {};
          const name = String(p.name || p.full_address || text);
          const detail = String(p.place_formatted || p.full_address || "");
          const label = [name, detail].filter(Boolean).join(", ");
          if (sessionSearch) return typeof p.mapbox_id === "string" ? [{ mapboxId: p.mapbox_id, session: url.searchParams.get("session_token")!, name, detail, label }] : [];
          const [lng, lat] = f?.geometry?.coordinates ?? [];
          return Number.isFinite(lat) && Number.isFinite(lng) ? [{ place: { lat, lng, label }, name, detail, label }] : [];
        });
        setList(next);
        setActive(-1);
      } catch {
        /* aborted, or no suggestions this time */
      }
    }, 200);
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [value, open, token, sessionSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async (s: Suggestion) => {
    setList([]);
    setOpen(false);
    if ("place" in s) {
      picked.current = s.label;
      onPick(s.place);
      return;
    }
    if (!token) return;
    const ctrl = new AbortController();
    retrieving.current?.abort();
    retrieving.current = ctrl;
    session.current = null;
    setLoading(true);
    setPickError(false);
    try {
      const url = new URL(`${SEARCHBOX}/retrieve/${encodeURIComponent(s.mapboxId)}`);
      url.search = new URLSearchParams({ access_token: token, session_token: s.session }).toString();
      const res = await fetch(url, { signal: ctrl.signal });
      const body = await res.json<{ features?: { geometry?: { coordinates?: number[] } }[] }>();
      const [lng, lat] = body?.features?.[0]?.geometry?.coordinates ?? [];
      if (!res.ok || !Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("Place unavailable");
      if (ctrl.signal.aborted) return;
      picked.current = s.label;
      onPick({ lat, lng, label: s.label });
    } catch {
      if (!ctrl.signal.aborted) setPickError(true);
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  };

  return (
    <span className={`place-input${dropUp ? " is-up" : ""}`}>
      <input
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => {
          retrieving.current?.abort();
          setLoading(false);
          setPickError(false);
          setList([]);
          setActive(-1);
          picked.current = null;
          onText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          onFocus?.();
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (loading && e.key === "Enter") e.preventDefault();
          if (!open || !list.length) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const step = (e.key === "ArrowDown") !== dropUp ? 1 : -1;
            setActive((i) => i < 0 ? (step > 0 ? 0 : list.length - 1) : (i + step + list.length) % list.length);
          } else if (e.key === "Enter" && active >= 0) {
            e.preventDefault();
            pick(list[active]);
          } else if (e.key === "Escape") {
            e.stopPropagation();
            setList([]);
          }
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        role="combobox"
        aria-controls={open && list.length ? listId : undefined}
        aria-activedescendant={open && list[active] ? `${listId}-${active}` : undefined}
        aria-autocomplete="list"
        aria-expanded={open && list.length > 0}
        maxLength={200}
        autoComplete="off"
      />
      {open && list.length ? (
        <ul className="place-list" id={listId} role="listbox" aria-label={`${ariaLabel} suggestions`}>
          {(dropUp ? [...list].reverse() : list).map((s) => {
            const i = list.indexOf(s);
            return (
              <li key={`${s.label}-${i}`} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                <button type="button" tabIndex={-1} className={i === active ? "is-active" : ""} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
                  <span><strong>{s.name}</strong>{s.detail ? <small>{s.detail}</small> : null}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {loading || pickError ? <span className="route-place-status" role="status">{loading ? "Locating…" : "Try another suggestion or enter an address."}</span> : null}
    </span>
  );
}
