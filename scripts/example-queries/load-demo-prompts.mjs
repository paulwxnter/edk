// Loads every prompt in demo_queries.md into public.demo_prompts (Neon), upserting on the prompt text.
//
//   node scripts/example-queries/load-demo-prompts.mjs [demo_queries.md]     (needs NEON_DB_URL and EDK_KEY in .env)
//
// Category comes from the stored result itself: permit records → permit, rows with photos → visual (animal when the
// subject is wildlife), everything else → civic. Region ids (c_id, s_id, p_id, r_id) come from the region EDK-1
// resolved for the result; a city's county is the county most of its hexagons sit in.
import fs from "node:fs";
import postgres from "postgres";

const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")]; }));
const sql = postgres(env.NEON_DB_URL, { ssl: "require", max: 4, onnotice: () => {} });
const MD = process.argv[2] || "demo_queries.md";
const TESTED = "2026-11-14";
const ANIMALS = /\b(bison|elk|mallards?|sandpipers?|manatees?|nuthatch(es)?|egrets?|otters?|swans?)\b/i;
const OSM = /\b(?:near|closest to|within [\d,]+ ?m of) (schools|train stations|railway stations|parks|hospitals|supermarkets|restaurants|universities|beaches|playgrounds|marinas|malls|golf courses|hotels)\b/i;

// 1. Parse the markdown tables.
const rows = [];
let section = "";
for (const line of fs.readFileSync(MD, "utf8").split(/\r?\n/)) {
  if (line.startsWith("## ")) { section = line.slice(3).trim(); continue; }
  const id = line.match(/embed\.edk\.earth\/r\/(res_[0-9a-f]+)/)?.[1];
  if (!line.startsWith("|") || !id) continue;
  const cells = line.split("|").slice(1, -1).map((c) => c.trim());
  const prompt = cells[0];
  const attributes = [...line.matchAll(/`([a-z0-9_]+)`/g)].map((m) => m[1]);
  const range = line.match(/\|\s*([\d,]+)–([\d,]+) m\s*\|/);
  const evidence = cells.slice(1, -1).filter((c) => !/^`[a-z0-9_]+`$/.test(c) && !/^(civic|visual|animal|permit)$/.test(c)).join("; ");
  rows.push({
    prompt, result_id: id, attributes, evidence,
    in_readme: section === "In the MCP README",
    operation: /\bwithin [\d,]+ ?m of\b/i.test(prompt) ? "within" : /\b(near|closest to)\b/i.test(prompt) ? "near" : "in_region",
    osm_reference: prompt.match(OSM)?.[1]?.toLowerCase() ?? null,
    distance_min_m: range ? Number(range[1].replace(/,/g, "")) : null,
    distance_max_m: range ? Number(range[2].replace(/,/g, "")) : null,
  });
}
console.log("parsed", rows.length, "prompts");

// 2. Read each stored result for category and region.
const countryBySource = new Map(), stateBySource = new Map();
for (const row of rows) {
  const res = await fetch(`https://api.edk.earth/v1/discover/${row.result_id}`, { headers: { authorization: `Bearer ${env.EDK_KEY}` } });
  const body = await res.json();
  const features = body?.data?.geojson?.features ?? [];
  const region = body?.data?.region ?? null;
  const permit = features.some((f) => /permit/i.test(f.properties?.feature_name ?? ""));
  const photos = features.some((f) => f.properties?.image_url);
  row.category = permit ? "permit" : photos ? (ANIMALS.test(row.prompt) ? "animal" : "visual") : "civic";
  row.embed_url = body?.embed_url ?? `https://embed.edk.earth/r/${row.result_id}`;
  row.region_type = region?.type ?? null;
  row.region_name = region?.name ?? null;
  row.region_id = region?.id ?? null;
  const base = row.category === "animal" ? "visual" : row.category;
  row.sources = [base, ...(row.osm_reference ? ["osm"] : []), ...(row.attributes.length ? ["attribute"] : [])];
}

// 3. Region ids.
for (const row of rows) {
  row.c_id = row.s_id = row.p_id = row.r_id = null;
  if (!row.region_id) continue;
  const [r] = await sql`select id::text id, region_type, country_id, state_id from regions where id = ${row.region_id}::bigint`;
  if (!r) continue;
  const country = async () => {
    if (r.country_id == null) return null;
    if (!countryBySource.has(r.country_id)) countryBySource.set(r.country_id, (await sql`select id::text id from regions where region_type = 'country' and source_id = ${r.country_id} limit 1`)[0]?.id ?? null);
    return countryBySource.get(r.country_id);
  };
  const state = async () => {
    if (r.state_id == null) return null;
    if (!stateBySource.has(r.state_id)) stateBySource.set(r.state_id, (await sql`select id::text id from regions where region_type = 'state' and source_id = ${r.state_id} limit 1`)[0]?.id ?? null);
    return stateBySource.get(r.state_id);
  };
  if (r.region_type === "country") row.c_id = r.id;
  else if (r.region_type === "state") { row.s_id = r.id; row.c_id = await country(); }
  else if (r.region_type === "county") { row.p_id = r.id; row.s_id = await state(); row.c_id = await country(); }
  else if (r.region_type === "city") {
    row.r_id = r.id; row.s_id = await state(); row.c_id = await country();
    row.p_id = (await sql`select p_id::text p_id from h3_hexagons where r_id = ${r.id}::bigint and p_id is not null group by p_id order by count(*) desc limit 1`)[0]?.p_id ?? null;
  }
}

// 4. Create and upsert.
await sql.unsafe(fs.readFileSync("scripts/example-queries/demo_prompts.sql", "utf8"));
for (const r of rows) {
  await sql`insert into demo_prompts (prompt, category, sources, operation, osm_reference, attributes, region_type, region_name, c_id, s_id, p_id, r_id,
      evidence, distance_min_m, distance_max_m, result_id, embed_url, in_readme, tested_at)
    values (${r.prompt}, ${r.category}, ${r.sources}, ${r.operation}, ${r.osm_reference}, ${r.attributes}, ${r.region_type}, ${r.region_name},
      ${r.c_id}, ${r.s_id}, ${r.p_id}, ${r.r_id}, ${r.evidence}, ${r.distance_min_m}, ${r.distance_max_m}, ${r.result_id}, ${r.embed_url}, ${r.in_readme}, ${TESTED})
    on conflict (prompt) do update set category = excluded.category, sources = excluded.sources, operation = excluded.operation,
      osm_reference = excluded.osm_reference, attributes = excluded.attributes, region_type = excluded.region_type, region_name = excluded.region_name,
      c_id = excluded.c_id, s_id = excluded.s_id, p_id = excluded.p_id, r_id = excluded.r_id, evidence = excluded.evidence,
      distance_min_m = excluded.distance_min_m, distance_max_m = excluded.distance_max_m, result_id = excluded.result_id,
      embed_url = excluded.embed_url, in_readme = excluded.in_readme, tested_at = excluded.tested_at`;
}
const summary = await sql`select category, operation, count(*)::int n from demo_prompts where active group by 1, 2 order by 1, 2`;
console.table(summary);
await sql.end();
