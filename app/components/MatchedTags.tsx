type Region = { name: string; type?: string | null; context?: string | null };

/**
 * What a Discover search matched: the region it searched and, when more than one catalog feature
 * matched, those features as tags. Shown above the results on the Atlas and in the Playground.
 */
export default function MatchedTags({ region, tags, className }: { region?: Region | null; tags?: string[] | null; className?: string }) {
  const names = tags && tags.length > 1 ? tags : [];
  if (!region?.name && !names.length) return null;
  const where = region?.name ? [region.name, region.context].filter(Boolean).join(", ") : null;
  return (
    <div className={["matched", className].filter(Boolean).join(" ")} aria-label="Matched">
      {where ? (
        <span className="matched-region" title={`Matched ${region?.type || "region"}: ${where}`}>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
          {where}
        </span>
      ) : null}
      {names.map((name) => <span key={name} className="matched-tag">{name}</span>)}
    </div>
  );
}
