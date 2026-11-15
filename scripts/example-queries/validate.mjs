// Runs every generated example query against the live API and keeps only the ones that work: enough
// results, scoped to the region the query names. Writes the outcome next to each query and an SQL file
// that records it in example_queries (failures stay, inactive, with the reason).
//
//   EDK_KEY=edk_sk_... node scripts/example-queries/validate.mjs <dir> [concurrency]
// Reads <dir>/example-queries.json, writes <dir>/validation.json and <dir>/example-queries-checks.sql.
import fs from "node:fs";
import path from "node:path";

const [, , DIR = ".", PAR = "20"] = process.argv;
const KEY = process.env.EDK_KEY;
const BASE = (process.env.EDK_BASE_URL || "https://api.edk.earth").replace(/\/+$/, "");
if (!KEY) throw new Error("Set EDK_KEY to a secret key.");
const MIN_RESULTS = 3;

const queries = JSON.parse(fs.readFileSync(path.join(DIR, "example-queries.json"), "utf8"));
const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/^the /, "").trim();
const base = (label) => fold(label.split(",")[0]);
const MISPLACED = /(not seeing|can.t place|couldn.t find .* in|elsewhere|other states|isn.t in|aren.t in|none in)/i;

async function check(q) {
  const started = Date.now();
  try {
    const res = await fetch(`${BASE}/v1/discover`, {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ query: q.query, limit: 10, answer: true }),
      signal: AbortSignal.timeout(120_000),
    });
    const body = await res.json().catch(() => ({}));
    const features = body?.data?.geojson?.features ?? [];
    const resolved = body?.data?.region?.name ?? null;
    const want = base(q.region_name);
    const regionOk = resolved && fold(resolved) === want;
    // Where the results actually are: the region named in their address or district.
    const local = features.slice(0, 5).filter((f) => {
      const p = f.properties ?? {};
      const where = fold(`${p.address ?? ""} ${p.district ?? ""}`);
      return where.includes(want) || (q.region_type === "city" && q.state_code && new RegExp(`\\b${fold(q.state_code)}\\b`).test(where) && where.includes(want.split(" ")[0]));
    }).length;
    const subjects = new Set(features.map((f) => fold(f.properties?.feature_name)));
    const subjectHits = q.artifact_names.slice(0, q.template === "multi" ? 3 : 1).filter((n) => subjects.has(fold(n))).length;
    let reason = null;
    if (!res.ok) reason = "error";
    else if (!features.length) reason = "empty";
    else if (features.length < MIN_RESULTS) reason = "few";
    else if (!regionOk && local < 2) reason = "wrong_region";
    else if (MISPLACED.test(body?.data?.answer ?? "") && local < 3) reason = "wrong_region";
    else if (q.template === "multi" && subjectHits < 2) reason = "one_subject";
    return { id: q.id, query: q.query, status: reason ? "fail" : "pass", reason, results: features.length, region: resolved, subjects: subjectHits, local, result_id: body?.id ?? null, ms: Date.now() - started };
  } catch (error) {
    return { id: q.id, query: q.query, status: "fail", reason: "error", results: 0, region: null, subjects: 0, local: 0, result_id: null, ms: Date.now() - started, error: String(error) };
  }
}

const out = [];
const queue = [...queries];
let done = 0;
await Promise.all(Array.from({ length: Number(PAR) }, async () => {
  while (queue.length) {
    const r = await check(queue.shift());
    out.push(r);
    done++;
    if (done % 25 === 0 || done === queries.length) {
      const pass = out.filter((x) => x.status === "pass").length;
      console.log(`${done}/${queries.length} checked, ${pass} pass`);
      fs.writeFileSync(path.join(DIR, "validation.json"), JSON.stringify(out, null, 2));
    }
  }
}));
fs.writeFileSync(path.join(DIR, "validation.json"), JSON.stringify(out, null, 2));

const esc = (v) => (v === null || v === undefined ? "null" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const now = Date.now();
const sql = out.map((r) => `update example_queries set active = ${r.status === "pass" ? 1 : 0}, check_status = ${esc(r.status)}, check_reason = ${esc(r.reason)}, check_results = ${r.results}, check_region = ${esc(r.region)}, check_subjects = ${r.subjects}, check_result_id = ${esc(r.result_id)}, checked_at = ${now} where id = ${esc(r.id)};`);
fs.writeFileSync(path.join(DIR, "example-queries-checks.sql"), sql.join("\n") + "\n");
const reasons = out.reduce((m, r) => ((m[r.reason ?? "pass"] = (m[r.reason ?? "pass"] || 0) + 1), m), {});
console.log("done", JSON.stringify(reasons));
