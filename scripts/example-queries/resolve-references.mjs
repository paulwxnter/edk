// For each reference feature (schools, parks, permits, 311…) and each region in pairs.json, looks up how
// many records the ledger holds there, so "near" and civic queries only name references a region has.
//
//   node scripts/example-queries/resolve-references.mjs <pairs.json> <out-dir>
// Writes <out-dir>/reference-presence.json: {"<feature_id>:<region_id>": count}. Needs NEON_DB_URL in .env.
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const [, , PAIRS, OUT_DIR = "."] = process.argv;
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")]; }));
const sql = postgres(env.NEON_DB_URL, { ssl: "require", max: 4, onnotice: () => {} });

const REFERENCE_IDS = ["113", "251", "107", "227454", "18716", "236932", "333", "183", "8546", "225688", "8548", "8549", "8570", "8559", "8522"];
const pairs = JSON.parse(fs.readFileSync(PAIRS, "utf8"));
const regionIds = [...new Set(pairs.filter((p) => p.region_type !== "country").map((p) => Number(p.region_id)))];

const presence = {};
await Promise.all(REFERENCE_IDS.map(async (fid) => {
  for (let i = 0; i < regionIds.length; i += 3000) {
    const rows = await sql`select region_id::text region_id, sum(total_count)::bigint n from ledger
      where feature_id = ${Number(fid)} and region_id = any(${regionIds.slice(i, i + 3000)}) and total_count > 0 group by region_id`;
    for (const r of rows) presence[`${fid}:${r.region_id}`] = Number(r.n);
  }
  console.log(fid, Object.keys(presence).filter((k) => k.startsWith(fid + ":")).length, "regions");
}));
fs.writeFileSync(path.join(OUT_DIR, "reference-presence.json"), JSON.stringify(presence));
await sql.end();
