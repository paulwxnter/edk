// Pulls every artifact × region pair with a supported scene match score from ledger (eq_top <= 0.46, 15+ photos),
// artifact by artifact through ledger_feature_region_idx instead of scanning the ~500M-row table.
//
//   node scripts/example-queries/extract-ledger.mjs <out-dir>     (needs NEON_DB_URL in .env)
// Writes <out-dir>/pairs.json, the input to generate.mjs and resolve-references.mjs.
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")]; }));
const sql = postgres(env.NEON_DB_URL, { ssl: "require", max: 6, onnotice: () => {} });
const OUT_DIR = process.argv[2] || ".";
const OUT = path.join(OUT_DIR, "pairs.json");
const MAX_EQ = 0.46; // "good" or better, per query_suggestions (excellent <= 0.42)

const RUN = "53b4df0b-48ac-4ce5-baa0-6f4c253b90f3";
const work = await sql`select distinct w.feature_id from artifact_scene_ledger_work w where w.run_id = ${RUN} and w.status = 'complete'`;
const featureIds = work.map((r) => String(r.feature_id));
const artifacts = await sql`select feature_id, array_agg(id::text order by length(name)) ids, min(name) filter (where true) as name, min(method) method
  from artifacts where status = 'verified' and feature_id = any(${featureIds}) group by feature_id`;
const byFeature = new Map(artifacts.map((a) => [String(a.feature_id), a]));
console.log("features", featureIds.length, "with verified artifacts", byFeature.size);

const pairs = [];
const batches = [];
for (let i = 0; i < featureIds.length; i += 40) batches.push(featureIds.slice(i, i + 40));
let done = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (batches.length) {
    const batch = batches.shift();
    const rows = await sql`select l.feature_id::text feature_id, l.region_id::text region_id, l.region_type, l.country_code, l.state_code,
        l.eq_top, l.eq_median, l.eq_p90, l.eq_valid_count, l.total_count
      from ledger l where l.feature_id = any(${batch.map(Number)}) and l.eq_top <= ${MAX_EQ} and l.eq_valid_count >= 15`;
    for (const r of rows) {
      const a = byFeature.get(r.feature_id);
      if (!a) continue;
      pairs.push({ feature_id: r.feature_id, artifact_ids: a.ids, artifact: a.name, method: a.method, region_id: r.region_id, region_type: r.region_type, country: r.country_code, state: r.state_code, eq_top: Number(r.eq_top), eq_median: Number(r.eq_median), eq_p90: Number(r.eq_p90), n: Number(r.eq_valid_count), total: Number(r.total_count) });
    }
    done += batch.length;
    process.stdout.write(`\r${done}/${featureIds.length} artifacts, ${pairs.length} pairs`);
  }
}));
console.log();
fs.writeFileSync(path.join(OUT_DIR, "pairs-raw.json"), JSON.stringify(pairs));

// Region names.
const regionIds = [...new Set(pairs.map((p) => p.region_id))];
const names = new Map();
for (let i = 0; i < regionIds.length; i += 2000) {
  const rows = await sql`select id::text id, name, state_code, country_code, latitude, longitude, favorite, total_footprints from regions where id = any(${regionIds.slice(i, i + 2000).map(Number)})`;
  for (const r of rows) names.set(r.id, r);
}
for (const p of pairs) { const r = names.get(p.region_id); p.region = r?.name ?? null; p.region_state = r?.state_code ?? null; p.region_country = r?.country_code ?? null; p.lat = r?.latitude ?? null; p.lng = r?.longitude ?? null; p.favorite = r?.favorite ?? null; p.footprints = r?.total_footprints ?? null; }
fs.writeFileSync(OUT, JSON.stringify(pairs));
const types = pairs.reduce((m, p) => ((m[p.region_type] = (m[p.region_type] || 0) + 1), m), {});
console.log("pairs", pairs.length, "regions", regionIds.length, JSON.stringify(types));
await sql.end();
