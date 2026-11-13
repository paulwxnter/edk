import { sql } from "./e2-db";
type Row=Record<string,any>;
const norm=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const stop=new Set("a an and are at by for from in into near of on or the to with within around across show find map me".split(" "));
const stem=(s:string)=>s.endsWith("ies")?s.slice(0,-3)+"y":s.endsWith("s")&&s.length>2?s.slice(0,-1):s;
const escapeLike=(s:string)=>s.replace(/[\\%_]/g,"\\$&");
// "cities" -> city/cities; "palms" -> palm (also matches "palms").
const patternsFor=(terms:string[])=>Array.from(new Set(terms.flatMap(t=>t.endsWith("ies")?[stem(t),t]:[stem(t)]))).map(t=>`%${escapeLike(t)}%`);
const REGION_COLUMNS="r.id::text as id, r.name, r.region_type, r.country_code, r.state_code, country.name as country_name, state.name as state_name";
const REGION_PARENTS="left join lateral (select name from regions where region_type = 'country' and country_code = r.country_code order by id limit 1) country on true left join lateral (select name from regions where region_type = 'state' and country_code = r.country_code and state_code = r.state_code order by id limit 1) state on true";
// Per-query candidate lookup: each non-stop word is matched through the
// trigram indexes on regions.name and lower(artifacts.name), so only rows
// that share a word with the query reach ranking and Jev.
// Small in-process TTL caches. Regions and verified artifacts change rarely; a
// few minutes of staleness is fine, and a cold instance just falls through to SQL.
const CANDIDATE_TTL_MS=10*60_000, DETAIL_TTL_MS=60*60_000, MAX_ENTRIES=5000;
type Entry<T>={at:number;value:T};
const regionCandidates=new Map<string,Entry<Row[]>>();
const artifactCandidates=new Map<string,Entry<Row[]>>();
const regionDetailCache=new Map<string,Entry<Row|null>>();
const fresh=<T>(cache:Map<string,Entry<T>>,key:string,ttl:number)=>{const e=cache.get(key);return e&&Date.now()-e.at<ttl?e:undefined;};
const remember=<T>(cache:Map<string,Entry<T>>,key:string,value:T)=>{if(cache.size>=MAX_ENTRIES)cache.delete(cache.keys().next().value as string);cache.set(key,{at:Date.now(),value});};
const REGION_CANDIDATES=`select p as pattern, x.* from unnest($1::text[]) p, lateral (select r.id::text as id, r.name from regions r where r.favorite = true and r.name ilike p order by length(r.name), r.rank asc nulls last limit 30) x`;
const ARTIFACT_CANDIDATES=`select p as pattern, x.* from unnest($1::text[]) p, lateral (select a.id::text as id, a.name, a.feature_id::text as feature_id, a.method, a.taxon_id from artifacts a where a.status = 'verified' and lower(a.name) like p order by length(a.name) limit 60) x`;
async function cachedPerPattern(cache:Map<string,Entry<Row[]>>,patterns:string[],query:string):Promise<Row[]>{
  const missing=patterns.filter(p=>!fresh(cache,p,CANDIDATE_TTL_MS));
  if(missing.length){
    const rows=await sql.query(query,[missing]) as Row[];
    const byPattern=new Map<string,Row[]>(missing.map(p=>[p,[]]));
    for(const {pattern,...row} of rows)byPattern.get(pattern)?.push(row);
    byPattern.forEach((list,p)=>remember(cache,p,list));
  }
  const seen=new Set<string>();
  // Same order the old `distinct on (id)` query returned (by id): ranking ties and what Jev sees stay stable.
  return patterns.flatMap(p=>cache.get(p)?.value||[]).filter(r=>{if(seen.has(r.id))return false;seen.add(r.id);return true;}).sort((x,y)=>x.id<y.id?-1:x.id>y.id?1:0);
}
async function regionDetails(ids:string[]):Promise<Row[]>{
  const missing=ids.filter(id=>!fresh(regionDetailCache,id,DETAIL_TTL_MS));
  if(missing.length){
    const rows=await sql.query(`select ${REGION_COLUMNS} from regions r ${REGION_PARENTS} where r.id = any($1::bigint[])`,[missing]) as Row[];
    for(const id of missing)remember(regionDetailCache,id,rows.find(r=>r.id===id)||null);
  }
  return ids.map(id=>regionDetailCache.get(id)?.value).filter(Boolean) as Row[];
}
export const routerCatalog={
  async lookup(query:string):Promise<{regions:Row[];artifacts:Row[]}>{
    const terms=Array.from(new Set(norm(query).split(" ").filter(t=>t.length>1&&!stop.has(t)))).slice(0,10);
    if(!terms.length)return {regions:[],artifacts:[]};
    const patterns=patternsFor(terms);
    // Each query word gets its own candidate budget (shortest names first), so
    // a common substring like "bus" can't crowd out "billboard". Candidates are
    // cached per word, so later queries sharing words ("new", "york") skip the DB.
    const [regionRows,artifactRows]=await Promise.all([
      cachedPerPattern(regionCandidates,patterns,REGION_CANDIDATES),
      cachedPerPattern(artifactCandidates,patterns,ARTIFACT_CANDIDATES),
    ]);
    // Substring patterns are a cheap prefilter ("tree" also hits "Street");
    // keep only rows sharing a whole word with the query.
    // Names fully contained in the query ("California") outrank partial
    // hits on a shared word ("Palm Bay" for "palm trees in California").
    const words=(r:Row)=>norm(r.name).split(" ").filter(Boolean);
    const score=(r:Row)=>words(r).filter(t=>terms.some(q=>stem(q)===stem(t))).length;
    const full=(r:Row)=>score(r)===words(r).length?1:0;
    const rank=(rows:Row[],limit:number)=>rows.filter(r=>score(r)>0).sort((a,b)=>full(b)-full(a)||score(b)-score(a)||a.name.length-b.name.length).slice(0,limit);
    const regionIds=rank(regionRows as Row[],40).map(r=>r.id);
    const regions=await regionDetails(regionIds);
    return {regions:regionIds.map(id=>regions.find((r:Row)=>r.id===id)).filter(Boolean) as Row[],artifacts:rank(artifactRows as Row[],48).map(a=>({...a,taxon_id:a.taxon_id===null||a.taxon_id===undefined?null:Number(a.taxon_id)}))};
  },
  async embeddings(artifactIds:string[]):Promise<Map<string,number[][]>>{
    const map=new Map<string,number[][]>();
    if(!artifactIds.length)return map;
    const rows=await sql.query("select artifact_id::text, embedding::text from artifacts_ebmed where artifact_id = any($1::uuid[]) and dimensions = 1024 order by artifact_id, embedding_kind, term_index",[artifactIds]);
    for(const row of rows as Row[]){const list=map.get(row.artifact_id)||[];list.push(JSON.parse(row.embedding));map.set(row.artifact_id,list);}
    return map;
  },
  async regionById(id:string){return (await sql.query(`select ${REGION_COLUMNS} from regions r ${REGION_PARENTS} where r.id = $1::bigint and r.favorite = true`,[id]))[0] as Row|undefined;},
  /** The region in focus and the regions above it, narrowest first: city (r_id) or county (p_id) → state (s_id) → country (c_id). */
  async regionChain(id:string):Promise<Row[]>{
    if(!/^\d+$/.test(id))return [];
    const focus=await this.regionById(id);
    if(!focus)return [];
    const chain:Row[]=[focus];
    const type=String(focus.region_type);
    if((type==="city"||type==="county")&&focus.state_code){
      const state=(await sql.query(`select ${REGION_COLUMNS} from regions r ${REGION_PARENTS} where r.region_type = 'state' and r.favorite = true and r.country_code = $1 and r.state_code = $2 order by r.id limit 1`,[focus.country_code,focus.state_code]))[0] as Row|undefined;
      if(state)chain.push(state);
    }
    if(type!=="country"&&focus.country_code){
      const country=(await sql.query(`select ${REGION_COLUMNS} from regions r ${REGION_PARENTS} where r.region_type = 'country' and r.favorite = true and r.country_code = $1 order by r.id limit 1`,[focus.country_code]))[0] as Row|undefined;
      if(country)chain.push(country);
    }
    return chain;
  }
};
