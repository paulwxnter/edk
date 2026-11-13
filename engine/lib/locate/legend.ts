// attribute_legend, read once per server instance: the public title, meaning, category, value names,
// value bands and published source of every place attribute.
import { sql } from "./e2-db";

export type LegendField = {
  column: string;
  title: string;
  about: string | null;
  category: string;
  unit: string | null;
  kind: string;
  inHexagons: boolean;
  source: { title: string | null; publisher: string | null; release: string | null; url: string | null; license: string | null; citation: string | null; description: string | null };
};
export type Legend = {
  fields: LegendField[];
  byColumn: Map<string, LegendField>;
  values: Map<string, { title: string; about: string | null }>;
  ranges: Map<string, { min: number | null; max: number | null; title: string; about: string | null }[]>;
};

let pending: Promise<Legend> | null = null;

export function legend(): Promise<Legend> {
  if (!pending) {
    pending = sql
      .query(
        `select row_type, column_name, field_title, value, range_min, range_max, title, short_description, category, unit, value_kind, in_h3_hexagons,
                source_title, source_description, source_publisher, source_release, source_url, license, citation
         from attribute_legend order by sort_order`,
      )
      .then((rows: any[]) => {
        const out: Legend = { fields: [], byColumn: new Map(), values: new Map(), ranges: new Map() };
        for (const r of rows) {
          if (r.row_type === "field") {
            const field: LegendField = {
              column: r.column_name,
              title: r.field_title || r.title || r.column_name,
              about: r.short_description || null,
              category: r.category || "Other",
              unit: r.unit || null,
              kind: r.value_kind || "text",
              inHexagons: r.in_h3_hexagons === true,
              source: {
                title: r.source_title || null,
                publisher: r.source_publisher || null,
                release: r.source_release || null,
                url: typeof r.source_url === "string" && /^https?:\/\//.test(r.source_url) ? r.source_url : null,
                license: r.license || null,
                citation: r.citation || null,
                description: r.source_description || null,
              },
            };
            out.fields.push(field);
            out.byColumn.set(field.column, field);
          } else if (r.row_type === "value" && r.value != null) {
            out.values.set(`${r.column_name}=${String(r.value).toLowerCase()}`, { title: r.title || String(r.value), about: r.short_description || null });
          } else if (r.row_type === "range") {
            const list = out.ranges.get(r.column_name) ?? [];
            list.push({ min: r.range_min == null ? null : Number(r.range_min), max: r.range_max == null ? null : Number(r.range_max), title: r.title || "", about: r.short_description || null });
            out.ranges.set(r.column_name, list);
          }
        }
        return out;
      })
      .catch((error) => {
        pending = null;
        throw error;
      });
  }
  return pending;
}

function number(n: number) {
  const a = Math.abs(n);
  if (a >= 1000) return Math.round(n).toLocaleString("en-US");
  if (a >= 100) return n.toFixed(0);
  if (a >= 10) return n.toFixed(1).replace(/\.0$/, "");
  return n.toFixed(2).replace(/\.?0+$/, "") || "0";
}

/** A stored value as a measured figure with its unit ("$133,824", "50 m", "12.5%"). Null when empty. */
function figure(raw: unknown, field: LegendField): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (Array.isArray(raw)) {
    const list = raw.map(String).filter(Boolean);
    return list.length ? list.slice(0, 8).join(", ") : null;
  }
  if (typeof raw === "boolean") return raw ? "Yes" : "No";
  const n = typeof raw === "number" ? raw : Number(raw);
  if (field.kind === "numeric" && Number.isFinite(n)) {
    const u = field.unit || "";
    if (/^USD/.test(u)) return `$${Math.round(n).toLocaleString("en-US")}${/per month/.test(u) ? " a month" : ""}`;
    if (u.startsWith("%")) return `${number(n)}%`;
    if (u.startsWith("°")) return `${number(n)}${u}`;
    if (/^fraction/.test(u)) return `${number(n * 100)}%`;
    if (!u || u.length > 14) return number(n);
    return `${number(n)} ${u}`;
  }
  return String(raw);
}

export type Reading = { key: string; title: string; about: string | null; value: string; detail: string | null; note: string | null; category: string };

/**
 * One attribute as a person should read it: a named value ("100-year flood zone") or the band a
 * number falls in ("Upper-middle"), with the measured figure as the detail. Null when there is no value.
 */
export function readAttribute(guide: Legend, column: string, raw: unknown): Reading | null {
  const field = guide.byColumn.get(column);
  if (!field) return null;
  const shown = figure(raw, field);
  if (!shown) return null;
  const named = Array.isArray(raw) ? null : guide.values.get(`${column}=${String(raw).toLowerCase()}`);
  const n = Number(raw);
  const band = field.kind === "numeric" && Number.isFinite(n) ? guide.ranges.get(column)?.find((b) => (b.min == null || n >= b.min) && (b.max == null || n < b.max)) : null;
  // "Upper-middle ($100-150k)" → "Upper-middle": the figure itself is shown beside it.
  const bandTitle = band?.title ? band.title.replace(/\s*\([^)]*\)\s*$/, "").trim() : "";
  const label = named?.title ?? (bandTitle || null);
  const about = (text: string | null | undefined) => (text ? text.replace(/\s*(Stored as|Applies when)[^.]*\.\s*$/i, "").trim() : null);
  return {
    key: column,
    title: field.title,
    about: field.about,
    value: label ?? shown,
    detail: label && label.toLowerCase() !== shown.toLowerCase() && field.kind === "numeric" ? shown : null,
    note: about(named?.about ?? band?.about),
    category: field.category,
  };
}

/** Columns a visitor never needs: record ids, raw codes and the year a dataset was published. */
export const isInternal = (field: LegendField) => field.kind === "identifier" || field.kind === "year" || /(_code|_id|_ids|_geoid|_mukey|_symbol)$/.test(field.column);
