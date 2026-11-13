// What a per-artifact table has: its columns and its newest-first indexes. Cached per process.
import { sql } from "./e2-db";

// Column lists per table, so queries only touch columns a table actually has.
const tableColumnCache = new Map<string, Promise<Set<string>>>();
export function tableColumns(table: string): Promise<Set<string>> {
  if (!/^[a-z][a-z0-9_]*$/i.test(table)) return Promise.resolve(new Set());
  if (!tableColumnCache.has(table)) {
    const pending = sql.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = $1", [table])
      .then((rows: any[]) => new Set(rows.map((row) => String(row.column_name))))
      .catch(() => { tableColumnCache.delete(table); return new Set<string>(); });
    tableColumnCache.set(table, pending);
  }
  return tableColumnCache.get(table)!;
}

// Per-artifact civic tables (artifacts.source_table, e.g. construction_permit_permits) carry the place
// attributes and partial "<region>_date_latest" indexes: (r_id|s_id|c_id, date desc, id desc)
// where date is not null and migration_status is complete.
export type CivicIndexes = { latest: Set<string>; dateIdx: boolean };
const civicIndexCache = new Map<string, Promise<CivicIndexes>>();
/** Which ordered indexes a per-artifact table has: per-region "date_latest" ones, and the plain `<table>_date_idx` (date desc, source_row_id). */
export function civicIndexes(table: string): Promise<CivicIndexes> {
  if (!civicIndexCache.has(table)) {
    // Detected by definition, not name: long table names get truncated index names (63-char limit).
    const pending = sql.query("select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = $1 and indexdef ilike '%date%'", [table])
      .then((rows: any[]) => {
        const defs = rows.map((row) => String(row.indexdef).toLowerCase().replace(/\s+/g, " "));
        const latest = (col: string) => defs.some((def) => def.includes(`(${col}, date desc, id desc)`) && def.includes("migration_status") && def.includes("date is not null"));
        return {
          latest: new Set(["c_id", "s_id", "r_id", "p_id"].filter(latest)),
          dateIdx: rows.some((row) => String(row.indexname) === `${table}_date_idx`),
        };
      })
      .catch(() => { civicIndexCache.delete(table); return { latest: new Set<string>(), dateIdx: false }; });
    civicIndexCache.set(table, pending);
  }
  return civicIndexCache.get(table)!;
}
