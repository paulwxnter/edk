import { CIVIC_METHODS } from "lib/locate/civic";
import { tableColumns } from "lib/locate/civic-tables";
import { datasetsForSource, type Dataset } from "lib/locate/datasets";
import { sql } from "lib/locate/e2-db";
import { isWebTechCategoryMethod, regionLabel, type Model, type Region, type SourcePage } from "./types";

const REGION_COLUMNS = new Map([["city", "r_id"], ["county", "p_id"], ["state", "s_id"], ["country", "c_id"]]);
const DATES = ["date", "event_date", "incident_date", "observed_at", "acq_date", "captured_at"];
const DISPLAY = [["name", "Name"], ["address", "Address"], ["description", "Description"], ["metadescription", "Details"], ["year", "Year"]] as const;
export const SOURCE_PAGE_SIZE = 25;
/** Most rows one export may hold. */
export const SOURCE_EXPORT_MAX = 5000;

export type SourceQuery = {
  page: number;
  /** Rows per page (25 on screen; up to SOURCE_EXPORT_MAX for an export). */
  pageSize?: number;
  /** Inclusive date range, YYYY-MM-DD. Ignored when the rows have no date. */
  from?: string | null;
  to?: string | null;
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: string | null | undefined) => (v && ISO_DAY.test(v) ? v : null);
const empty = (page: number): SourcePage => ({ columns: [], rows: [], hasMore: false, page });

/** The verified artifact behind a signal: where its records live and how they were produced. */
async function artifactFor(model: Model) {
  const [artifact] = await sql.query(
    `select a.id::text as id, a.source_table, a.method,
       exists (select 1 from artifacts b where b.source_table = a.source_table and b.feature_id is distinct from a.feature_id) as shared
     from artifacts a where a.slug = $1 and a.feature_id = $2 and a.status = 'verified' limit 1`,
    [model.slug, String(model.featureId)],
  );
  return artifact as unknown as { id: string; source_table: unknown; method: string | null; shared: boolean } | undefined;
}

/** Rows behind a signal in a place, newest first, optionally narrowed to a date range. */
export async function getSourcePage(model: Model, region: Region, q: SourceQuery): Promise<SourcePage> {
  const page = q.page;
  const size = Math.max(1, Math.min(SOURCE_EXPORT_MAX, q.pageSize ?? SOURCE_PAGE_SIZE));
  const from = day(q.from);
  const to = day(q.to);
  if (model.countryLevel) return webTechPage(model, region, page, size, from, to);

  const regionColumn = REGION_COLUMNS.get(region.type);
  if (!regionColumn) return empty(page);
  const artifact = await artifactFor(model);
  const table = artifact?.source_table;
  if (!artifact || typeof table !== "string" || !/^[a-z][a-z0-9_]*$/.test(table)) return empty(page);
  const available = await tableColumns(table);
  if (!available.has(regionColumn) || !available.has("id") || (artifact.shared && !available.has("feature_id"))) return empty(page);

  const date = DATES.find((column) => available.has(column));
  const columns: SourcePage["columns"] = [
    ...(date ? [{ key: date, label: "Date", kind: "date" as const }] : []),
    ...DISPLAY.filter(([key]) => available.has(key) && !(date && key === "year")).map(([key, label]) => ({ key, label })),
  ];
  if (!columns.length) return empty(page);

  const values: (number | string)[] = [region.id];
  const where = [`${regionColumn} = $1`];
  if (available.has("feature_id")) {
    values.push(model.featureId);
    where.push(`feature_id = $${values.length}`);
  }
  const civic = CIVIC_METHODS.has(artifact.method ?? "") && date === "date" && available.has("migration_status");
  if (civic) where.push("date is not null", "lower(coalesce(migration_status, 'complete')) = 'complete'");
  if (date && from) {
    values.push(from);
    where.push(`${date} >= $${values.length}::date`);
  }
  if (date && to) {
    values.push(to);
    where.push(`${date} < ($${values.length}::date + 1)`);
  }
  const select = columns.map(({ key }) => key === date
    ? `left(${key}::text, 10) as "${key}"`
    : `left(${key}::text, 1000) as "${key}"`).join(", ");
  values.push(size + 1, (page - 1) * size);
  const rows = await sql.withTimeout(size > SOURCE_PAGE_SIZE ? 20000 : 8000, (tx) => tx.query(
    `select ${select} from public."${table}" where ${where.join(" and ")}
     order by ${date ? `"${table}".${date} desc${civic ? "" : " nulls last"}, ` : ""}id desc
     limit $${values.length - 1} offset $${values.length}`,
    values,
  ));
  return {
    columns,
    rows: rows.slice(0, size).map((row: Record<string, unknown>) => columns.map(({ key }) => row[key] == null ? null : String(row[key]))),
    hasMore: rows.length > size,
    page,
    dated: Boolean(date),
    title: "Source records",
  };
}

// ---------------------------------------------------------------- web technologies (HTTP Archive, per country)

const WEB_TECH_COLUMNS: SourcePage["columns"] = [
  { key: "date", label: "Month", kind: "month" },
  { key: "origins_mobile", label: "Websites (mobile)", kind: "number" },
  { key: "origins_desktop", label: "Websites (desktop)", kind: "number" },
  { key: "share_mobile", label: "Share (mobile)", kind: "percent" },
  { key: "cwv_pass_rate_mobile", label: "Core Web Vitals pass", kind: "percent" },
  { key: "lh_performance_mobile", label: "Lighthouse perf.", kind: "score" },
  { key: "bytes_total_mobile", label: "Page weight", kind: "bytes" },
];

const CATEGORY_MEASUREMENTS = [
  { key: "wt_technology_installations_mobile", label: "Installations (mobile)" },
  { key: "wt_technology_installations_desktop", label: "Installations (desktop)" },
];

/**
 * Web technologies are reported per country and month. A technology reads its own monthly rows from
 * web_technologies; a category reads its monthly ledger, the sum of its member technologies.
 */
async function webTechPage(model: Model, region: Region, page: number, size: number, from: string | null, to: string | null): Promise<SourcePage> {
  if (region.type !== "country") return empty(page);
  const offset = (page - 1) * size;

  if (isWebTechCategoryMethod(model.method)) {
    const rows = await sql.query(
      `select to_char(date_from, 'YYYY-MM-DD') d, measurement, total_count::text v from ledger
       where feature_id = $1 and region_id = $2 and timeframe = 'monthly' and measurement = any($3::text[])
         and ($4::date is null or date_from >= $4::date) and ($5::date is null or date_from <= $5::date)
       order by date_from desc`,
      [model.featureId, region.id, CATEGORY_MEASUREMENTS.map((m) => m.key), from, to],
    ) as Record<string, string>[];
    const byMonth = new Map<string, Record<string, string>>();
    for (const row of rows) byMonth.set(row.d, { ...byMonth.get(row.d), date: row.d, [row.measurement]: row.v });
    const all = [...byMonth.values()];
    const columns: SourcePage["columns"] = [{ key: "date", label: "Month", kind: "month" }, ...CATEGORY_MEASUREMENTS.map((m) => ({ ...m, kind: "number" as const }))];
    return {
      columns,
      rows: all.slice(offset, offset + size).map((row) => columns.map(({ key }) => row[key] ?? null)),
      hasMore: all.length > offset + size,
      page,
      dated: true,
      title: `Monthly ledger · ${regionLabel(region)}`,
    };
  }

  const artifact = await artifactFor(model);
  if (!artifact) return empty(page);
  const rows = await sql.withTimeout(size > SOURCE_PAGE_SIZE ? 20000 : 8000, (tx) => tx.query(
    `select ${WEB_TECH_COLUMNS.map(({ key }) => key === "date" ? `to_char(date, 'YYYY-MM-DD') as date` : `${key}::text as ${key}`).join(", ")}
     from web_technologies
     where artifact_id = $1::uuid and region_id = $2 and rank = 'ALL'
       and ($3::date is null or date >= $3::date) and ($4::date is null or date <= $4::date)
     order by date desc limit $5 offset $6`,
    [artifact.id, region.id, from, to, size + 1, offset],
  )) as Record<string, string | null>[];
  return {
    columns: WEB_TECH_COLUMNS,
    rows: rows.slice(0, size).map((row) => WEB_TECH_COLUMNS.map(({ key }) => row[key] ?? null)),
    hasMore: rows.length > size,
    page,
    dated: true,
    title: `HTTP Archive · ${regionLabel(region)}`,
  };
}

// ---------------------------------------------------------------- citations

/** The datasets behind a signal in a place. */
export async function getCitations(model: Model, region: Region): Promise<Dataset[]> {
  if (model.countryLevel) return ledgerCitations(model, region);
  const regionColumn = REGION_COLUMNS.get(region.type);
  if (!regionColumn) return [];
  const artifact = await artifactFor(model);
  const table = artifact?.source_table;
  if (!artifact || typeof table !== "string" || !/^[a-z][a-z0-9_]*$/.test(table)) return [];
  const available = await tableColumns(table);
  if (!available.has(regionColumn) || (artifact.shared && !available.has("feature_id"))) return [];
  if (!available.has("dataset_id")) return datasetsForSource(table, [], region.name);
  const values: (number | string)[] = [region.id];
  const where = [`${regionColumn} = $1`];
  if (available.has("feature_id")) {
    values.push(model.featureId);
    where.push(`feature_id = $${values.length}`);
  }
  // Read the newest rows the same way the Data Viewer does (index order), never a scan of the whole table.
  const date = DATES.find((column) => available.has(column));
  const civic = CIVIC_METHODS.has(artifact.method ?? "") && date === "date" && available.has("migration_status");
  if (civic) where.push("date is not null", "lower(coalesce(migration_status, 'complete')) = 'complete'");
  const rows = await sql.withTimeout(8000, (tx) => tx.query(
    `select dataset_id::text as dataset_id from public."${table}" where ${where.join(" and ")}
     order by ${date ? `"${table}".${date} desc${civic ? "" : " nulls last"}, ` : ""}id desc limit ${SOURCE_PAGE_SIZE + 1}`,
    values,
  ));
  return datasetsForSource(table, rows.flatMap((row: Record<string, unknown>) => row.dataset_id ? [String(row.dataset_id)] : []), region.name);
}

/** Citations from the ledger's own source notes (web technologies cite HTTP Archive per snapshot month). */
async function ledgerCitations(model: Model, region: Region): Promise<Dataset[]> {
  const [row] = await sql.query(
    `select source from ledger where feature_id = $1 and region_id = $2 and measurement = $3 and timeframe = 'all' and source is not null limit 1`,
    [model.featureId, region.id, model.measurement],
  ) as unknown as { source: unknown }[];
  const sources = Array.isArray(row?.source) ? row.source as Record<string, unknown>[] : [];
  const seen = new Set<string>();
  return sources.flatMap((s, i) => {
    const name = typeof s.source_name === "string" ? s.source_name : null;
    if (!name) return [];
    const url = typeof s.source_url === "string" && s.source_url.startsWith("https://") ? s.source_url : null;
    const key = `${name}|${url}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const month = typeof s.snapshot_month === "string" ? s.snapshot_month : null;
    return [{
      id: `ledger-${i}`,
      name: name === "HTTP Archive" ? "HTTP Archive Technology Report" : name,
      publisher: name,
      description: month ? `Latest snapshot ${month}` : null,
      url,
      license: null,
      place: regionLabel(region),
      category: "Web technologies",
      artifacts: [],
    }];
  });
}
