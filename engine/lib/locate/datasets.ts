// The published datasets behind a set of results, from the legends table.
// For each artifact: sample one row of its source table, read the row's dataset_id, and look that up in
// legends (public_legends as a fallback). Tables without dataset_id fall back to a legends entry that
// names the table (legends.source_table or target_table). Artifacts with neither get no card: nothing
// is guessed or made up.
import { sql } from "./e2-db";
import { tableColumns } from "./civic-tables";
import { safeTable } from "lib/live/civic-row";

export type Dataset = {
  id: string;
  name: string;
  publisher: string | null;
  description: string | null;
  url: string | null;
  license: string | null;
  place: string | null;
  category: string | null;
  /** The artifacts in these results that come from this dataset. */
  artifacts: string[];
};

const SAMPLE_TIMEOUT_MS = 3000;
const LEGEND_COLS = `dataset_id::text as id, name, source as publisher, description, source_url as url, license, city as place, category`;

async function sampleDatasetId(table: string, featureId: string | null): Promise<string | null> {
  const quoted = safeTable(table);
  if (!quoted) return null;
  const columns = await tableColumns(table);
  if (!columns.has("dataset_id")) return null;
  const byFeature = featureId && /^\d+$/.test(featureId) && columns.has("feature_id");
  const rows = (await sql
    .withTimeout(SAMPLE_TIMEOUT_MS, (tx) =>
      tx.query(
        `select dataset_id::text as id from ${quoted} where dataset_id is not null ${byFeature ? "and feature_id = $1::bigint" : ""} limit 1`,
        byFeature ? [featureId] : [],
      ),
    )
    .catch(() => [])) as any[];
  return rows[0]?.id ?? null;
}

async function legendById(id: string) {
  const rows = (await sql.query(
    `select ${LEGEND_COLS} from legends where dataset_id = $1::uuid
     union all select ${LEGEND_COLS} from public_legends where dataset_id = $1::uuid
     limit 1`,
    [id],
  )) as any[];
  return rows[0] ?? null;
}

async function legendByTable(table: string) {
  const rows = (await sql.query(
    `select ${LEGEND_COLS} from legends where source_table = $1 or target_table = $1
     order by (source_table = $1) desc, (status = 'active') desc, updated_at desc nulls last limit 1`,
    [table],
  )) as any[];
  return rows[0] ?? null;
}

export async function datasetsFor(artifactIds: string[]): Promise<Dataset[]> {
  const ids = artifactIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 12);
  if (!ids.length) return [];
  const artifacts = (await sql.query(
    `select id::text as id, name, source_table, feature_id::text as feature_id from artifacts where id = any($1::uuid[])`,
    [ids],
  )) as any[];

  const found = await Promise.all(
    artifacts.map(async (a) => {
      if (!a.source_table) return null;
      const datasetId = await sampleDatasetId(a.source_table, a.feature_id).catch(() => null);
      const legend = (datasetId && (await legendById(datasetId))) || (await legendByTable(a.source_table));
      return legend ? { legend, artifact: String(a.name) } : null;
    }),
  );

  const byId = new Map<string, Dataset>();
  for (const hit of found) {
    if (!hit) continue;
    const l = hit.legend;
    const entry = byId.get(l.id) ?? {
      id: String(l.id),
      name: String(l.name || "Dataset"),
      publisher: l.publisher || null,
      description: l.description ? String(l.description).split(/\n\s*\n/)[0].trim() : null,
      url: l.url && /^https?:\/\//.test(l.url) ? l.url : null,
      license: l.license || null,
      place: l.place || null,
      category: l.category || null,
      artifacts: [] as string[],
    };
    if (!entry.artifacts.includes(hit.artifact)) entry.artifacts.push(hit.artifact);
    byId.set(l.id, entry);
  }
  return Array.from(byId.values());
}
