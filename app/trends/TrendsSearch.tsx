import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { DEFAULT_FEATURE_SLUG, DEFAULT_REGION_SLUG, TYPE_LABEL, type SearchHit } from "lib/signals/types";
import { PinIcon, SearchIcon } from "./icons";

/**
 * Trends search. Searches every indexed signal (permits, 311, mapped places, detected objects,
 * species…) plus places. Picking a signal keeps the current place; picking a place keeps the
 * current signal.
 */
export default function TrendsSearch() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [, , feature = DEFAULT_FEATURE_SLUG, region = DEFAULT_REGION_SLUG] = pathname.split("/");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(() => {
      fetch(`/signals/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal })
        .then((r) => r.json() as Promise<{ hits?: SearchHit[] }>)
        .then((d) => {
          setHits(d.hits ?? []);
          setActive(0);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 160);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const go = (hit: SearchHit) => {
    setOpen(false);
    setQuery("");
    navigate(hit.kind === "feature" ? `/signals/${hit.slug}/${region}` : `/signals/${feature}/${hit.slug}`);
  };

  const features = hits.filter((h) => h.kind === "feature");
  const places = hits.filter((h) => h.kind === "region");
  const ordered = [...features, ...places];

  return (
    <div ref={ref} className={`trends-search${open && ordered.length ? " is-open" : ""}`}>
      <label className="trends-search-field">
        <SearchIcon />
        <input
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(ordered.length - 1, a + 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            }
            if (e.key === "Enter" && ordered[active]) go(ordered[active]);
          }}
          placeholder="Search a signal or a place"
          aria-label="Search signals and places"
          role="combobox"
          aria-expanded={open && ordered.length > 0}
          aria-controls="trends-search-list"
        />
        {loading && <span className="spinner" aria-label="Searching" />}
      </label>
      {open && ordered.length > 0 && (
        <div id="trends-search-list" className="trends-search-list" role="listbox">
          {features.length > 0 && <p className="label">SIGNALS</p>}
          {features.map((h) => {
            const i = ordered.indexOf(h);
            return (
              <button key={`f-${h.slug}`} type="button" role="option" aria-selected={i === active} className={i === active ? "is-active" : undefined} onMouseEnter={() => setActive(i)} onClick={() => go(h)}>
                <span className="trends-search-glyph mono">~</span>
                <span className="trends-search-name">{h.name}</span>
                <small className="mono">
                  {h.kind === "feature" && h.type && TYPE_LABEL[h.type].singular}
                </small>
              </button>
            );
          })}
          {places.length > 0 && <p className="label">PLACES</p>}
          {places.map((h) => {
            const i = ordered.indexOf(h);
            return (
              <button key={`r-${h.slug}`} type="button" role="option" aria-selected={i === active} className={i === active ? "is-active" : undefined} onMouseEnter={() => setActive(i)} onClick={() => go(h)}>
                <span className="trends-search-glyph"><PinIcon /></span>
                <span className="trends-search-name">{h.name}</span>
                <small className="mono">{h.kind === "region" && h.label}</small>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
