// One civic record (permits, crimes, collisions, 311, inspections), read the same way everywhere:
// the lens points (lib/lens-server.ts) and the live activity feed (lib/live/feed.ts).

/** Columns every per-artifact civic table carries, plus a point for the map. */
export const CIVIC_SELECT = `id::text as id, date, description, metadescription, category, subtype, address, block, location_description, neighborhood, visual_url, status,
  coalesce(longitude, ST_X(ST_Centroid(geometry))) as lng, coalesce(latitude, ST_Y(ST_Centroid(geometry))) as lat`;

/** The newest-first predicate: matches the tables' partial "<region>_date_latest" indexes exactly. */
export const CIVIC_LATEST_WHERE = `date is not null and lower(coalesce(migration_status, 'complete')) = 'complete'`;

export const titleCase = (v: string) => v.toLowerCase().replace(/(^|[\s\-/(])([a-z])/g, (_, lead, ch) => lead + ch.toUpperCase());
export const httpsOnly = (u: unknown) => (typeof u === "string" && u.startsWith("https://") ? u : null);
export const safeTable = (t: string | null) => (t && /^[a-z0-9_]{1,63}$/.test(t) ? `"${t}"` : null);

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
/** "1 EAST    2 STREET" → "1 East 2 Street": collapse runs of spaces, and soften all-caps. */
const tidy = (v: string) => {
  const t = v.replace(/\s+/g, " ").trim();
  return t === t.toUpperCase() && /[A-Z]/.test(t) ? titleCase(t) : t;
};

/** The readable fields of one civic row. */
export function civicFields(r: Record<string, any>) {
  const description = text(r.description);
  const category = [text(r.category), text(r.subtype)].filter(Boolean).join(" · ") || null;
  return {
    // Many records carry only a block ("085XX S CHAPPEL AVE"), not a full address.
    address: text(r.address) ? tidy(r.address) : text(r.block) ? tidy(String(r.block)) : null,
    name: description ? titleCase(description).slice(0, 120) : null,
    neighborhood: text(r.neighborhood),
    location: text(r.location_description) ? titleCase(String(r.location_description)) : null,
    category,
    description: text(r.metadescription) || description || category,
    status: text(r.status),
    image_url: httpsOnly(r.visual_url),
  };
}

/** A database date (Date, or text) as an ISO string. */
export function isoDate(v: unknown): string | null {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.toISOString() : null;
  if (typeof v !== "string" || !v) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2} /.test(v) ? v.replace(" ", "T") : v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
