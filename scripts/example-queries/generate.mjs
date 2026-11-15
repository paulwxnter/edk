// Generates example queries from the scene ledger: artifact × region pairs whose 15 closest photo matches
// are strong (ledger.eq_top, lower is better), combined into single, multi-artifact, "near" (an OSM
// reference) and civic (permits, 311, crime records) queries, phrased naturally, with their scores.
//
//   node scripts/example-queries/generate.mjs <pairs.json> <out-dir>
//
// pairs.json comes from the ledger extract (one row per artifact × region with eq_top <= 0.46, 15+ photos).
// Writes <out-dir>/example-queries.sql (inserts into D1 example_queries) and <out-dir>/example-queries.json.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { phrase } from "./phrase.mjs";

const [, , PAIRS, OUT_DIR = "."] = process.argv;
const pairs = JSON.parse(fs.readFileSync(PAIRS, "utf8"));
const EXCELLENT = 0.42;
const GOOD = 0.46;

// ---------------------------------------------------------------- what an artifact is about

const ANIMALS = "junco nuthatch sandpiper cicada waxwing muskrat oriole woodpecker koala merganser chickadee manatee vireo mantis squirrel egret cormorant mallard warbler ibex chipmunk jackdaw oystercatcher wren jay seagull gull lynx mussel sapsucker moth osprey anole urchin elk swan sparrow catbird crow avocet tapir jacana stonechat plover wigeon hummingbird nightjar ladybug goldfinch turnstone coot aphid godwit deer hoverfly hoverflies buzzard ibis alligator macaque bison moorhen marmot raccoon guanaco coati wasp gadwall slug pintail trogon bumblebee bee bees tortoise turtle otter seal moose shorebird raptor heron crane pelican eagle hawk falcon owl vulture kingfisher flamingo penguin puffin loon grebe duck goose geese finch thrush robin bluebird cardinal tanager grosbeak bunting blackbird grackle starling magpie raven dove pigeon parrot parakeet cockatoo kookaburra lorikeet emu kangaroo wallaby wombat possum opossum skunk fox coyote wolf bear beaver porcupine hedgehog badger mole vole rabbit hare frog toad newt salamander lizard gecko iguana snake rattlesnake python crocodile butterfly dragonfly damselfly beetle grasshopper cricket spider scorpion crab lobster shrimp octopus jellyfish starfish dolphin whale orca sea lion walrus shark ray stingray salmon trout bass monkey lemur gorilla chimpanzee baboon capybara llama alpaca camel zebra giraffe elephant rhino hippo lion tiger leopard cheetah jaguar puma cougar bobcat ocelot sloth armadillo anteater pangolin meerkat mongoose hyena dingo aardwolf chamois guineafowl peacock pheasant quail grouse turkey roadrunner herd colony flock basking".split(" ");
const PLANTS = "flower flowers tree trees grove groves blossom blossoms lily lilies fern ferns moss lichen cactus cacti saguaro bush bushes wildflower wildflowers bloom aspen aspens birch spruce pine redwood redwoods bamboo ivy honeysuckle wisteria sunflower poppy lupine tulip daisy rose orchid thistle thistles cattail cattails bluebell bluebells anemone anemones impatiens zinnia delphinium hyacinth freesia crocus cosmos verbena salvia mint susan susans dogwood magnolia maple oak palm palms willow cypress juniper sagebrush heather lavender clover dandelion goldenrod milkweed iris peony marigold petunia begonia geranium hibiscus jasmine azalea rhododendron camellia gardenia lilac morning glory".split(" ");

const THEMES = [
  ["damage", /(damage|damaged|crack|cracked|broken|collapsed|leaning|downed|sagging|fallen|pothole|erosion|sinkhole|debris|dumping|leak|leaking|stain|rust|failure|burn scar|fire-damaged|tarp|flood|flooding|floodwater|high-water|boarded|abandoned|vacant|graffiti|vandal|overgrown|blocked|exposed|missing|peeling|storm|wreck|ruin|roofless|icy|snow covered|snow-covered|standing water|washout|landslide|rockfall|closure)/i],
  ["construction", /(construction|crane|scaffold|demolition|excavat|roof replacement|installation in progress|work zone|detour|barricade|hoarding|new foundation|framing)/i],
  ["infrastructure", /(bridge|power line|utility|pole|transformer|substation|cell tower|tower|pipe|pipeline|dam|levee|guardrail|hydrant|manhole|storm drain|streetlight|traffic signal|crosswalk|bus lane|bus stop|bus shelter|rail|tunnel|underpass|overpass|cycleway|bike lane|bike crossing|bike route|charging|charger|solar|wind turbine|irrigation|water tower|water tank|seawall|breakwater|floodgate|school crossing|parking garage|speed hump|bollard|roundabout)/i],
  ["buildings", /(roof|home|house|facade|porch|pool|garage|fence|bungalow|brownstone|apartment|storefront|window|door|chimney|rooftop|mural|loggia|balcony|courtyard|greenhouse|barn|silo|lighthouse|church|chapel|mosque|temple|castle|mansion|cottage|cabin|tiny house|townhouse|adobe|stucco)/i],
  ["landscape", /(trail|path|drive|beach|cliff|canyon|desert|mountain|lake|river|waterfall|coast|coastal|dune|dunes|marsh|wetland|meadow|forest|woodland|glacier|volcano|geyser|hot spring|cave|reef|lagoon|bay|island|prairie|savanna|tundra|oasis|gorge|mesa|butte|valley|summit|ridge|boardwalk|campsite|ski|snowshoe|singletrack|via ferrata)/i],
];
const ABSTRACT = /(biking|basking|skiing|cycling|camping|hiking|kayaking|surfing|swimming$|running$|meetup|ride$|failure|perch$|crossing$(?<!school crossing$)|character|chill|systems|issues|risks|meetup|vibes|lifestyle|culture|experience|activity|mood|commute|weekend|smart city|safety|watch$|day$|night$|picnic|scenery|view$|^sunset$|^sunrise$|^moon$|^dew$|^foam$|^metal$|^fog$|^rain$|^sky$|^cloud|^road$|^roads$|^sidewalk$|^street$|^car$|^cars$|^building$|^house$|^tree$|^grass$|^water$|^person|^people|interior|exterior$|selfie|portrait|hobby|sport$|game$|^park view$|home$|drive home|neighborhood)/i;

const words = (name) => name.toLowerCase().replace(/[^a-z\s-]/g, " ").split(/[\s-]+/).filter(Boolean);
function themeOf(name) {
  if (ABSTRACT.test(name)) return null;
  const w = words(name);
  if (w.some((x) => ANIMALS.includes(x) || ANIMALS.includes(x.replace(/e?s$/, "")))) return "animals";
  for (const [theme, re] of THEMES) if (re.test(name)) return theme;
  if (w.some((x) => PLANTS.includes(x))) return "plants";
  return null;
}

// ---------------------------------------------------------------- regions

const COUNTRY = { US: "United States", CA: "Canada", AU: "Australia", GB: "United Kingdom", NZ: "New Zealand", IE: "Ireland", DE: "Germany", FR: "France", ES: "Spain", IT: "Italy", NL: "Netherlands", MX: "Mexico", BR: "Brazil", JP: "Japan", RU: "Russia", ZA: "South Africa", IN: "India", SE: "Sweden", NO: "Norway", CH: "Switzerland", AT: "Austria", PT: "Portugal", AR: "Argentina", CL: "Chile" };
const TYPE_RANK = { city: 0, state: 1, county: 2, country: 3 };
// Counties are left out: EDK-1 does not resolve "Harris County, TX" to a region yet, so those queries
// return results from anywhere. Their share goes to cities and states.
const QUOTA = { city: 520, state: 230, county: 0, country: 50 };        // queries per region type (validated later)
const PER_REGION = { city: 5, state: 4, county: 0, country: 3 };        // queries per region
const ARTIFACT_CAP = 5;                                                  // uses per artifact as a subject

const themed = pairs.filter((p) => p.region && TYPE_RANK[p.region_type] !== undefined && (p.theme = themeOf(p.artifact)));
// Prominence: how many strong artifacts a region has stands in for how much imagery covers it.
const prominence = themed.reduce((m, p) => m.set(p.region_id, (m.get(p.region_id) || 0) + 1), new Map());
const nameCount = themed.filter((p) => p.region_type === "city").reduce((m, p) => {
  const k = p.region.toLowerCase();
  if (!m.has(k)) m.set(k, new Set());
  m.get(k).add(p.region_id);
  return m;
}, new Map());

function regionLabel(p) {
  const country = p.region_country || p.country;
  if (p.region_type === "city") {
    // US cities always carry the state code: "Madison, WI" resolves to the city, "Madison" alone does not.
    if (country === "US" && p.region_state) return `${p.region}, ${p.region_state}`;
    const shared = (nameCount.get(p.region.toLowerCase())?.size || 0) > 1;
    if (!shared) return p.region;
    return country === "CA" ? `${p.region}, ${p.region_state}` : `${p.region}, ${COUNTRY[country] || country}`;
  }
  if (p.region_type === "county") return country === "US" && p.region_state ? `${p.region}, ${p.region_state}` : p.region;
  if (p.region_type === "country" && /^(United|Netherlands|Philippines|Czech|Dominican|Bahamas|Gambia|Maldives)/.test(p.region)) return `the ${p.region}`;
  return p.region;
}

// ---------------------------------------------------------------- references (resolved against the ledger)

// Each reference only pairs with subjects it makes sense next to (matched on the subject's name).
const REFERENCES = {
  near: [
    { name: "School", feature_id: "113", match: /(crosswalk|school crossing|pothole|cracked (sidewalk|asphalt|pavement)|road crack|graffiti|damaged (curb|sign|fence|light|playground|bench|crosswalk)|speed hump|bike lane|bike crossing|traffic signal|leaning|downed|sagging|vacant|boarded|abandoned|dumping)/i },
    { name: "Park", feature_id: "251", match: /(graffiti|fallen tree|downed|dumping|overgrown|damaged (bench|playground|picnic|fence)|squirrel|raccoon|coyote|deer|heron|egret|duck|mallard|goose|swan|owl|hawk|woodpecker|chipmunk|turtle|bluebell|wildflower|blossom|cherry)/i },
    { name: "Train Station", feature_id: "227454", match: /(graffiti|vacant|boarded|abandoned|bike (lane|crossing|route|parking)|cycleway|underpass|bridge|scaffold|construction|crane|cracked|damaged)/i },
    { name: "Hospital", feature_id: "107", match: /(downed power|sagging power|leaning utility|flood|standing water|storm debris|road crack|pothole|construction crane)/i },
    { name: "Beach", feature_id: "236932", match: /(coastal|erosion|dune|seawall|breakwater|tide pool|sandpiper|plover|seal|sea lion|pelican|gull|oystercatcher|turnstone|shorebird|crab|marine debris|lifeguard)/i },
    { name: "Marina", feature_id: "333", match: /(seal|sea lion|pelican|cormorant|otter|manatee|heron|egret|gull|swan|seawall|breakwater|marine debris|storm surge)/i },
    { name: "Playground", feature_id: "183", match: /(damaged playground|graffiti|dumping|fallen tree|standing water|squirrel)/i },
    { name: "Library", feature_id: "18716", match: /(graffiti|boarded|vacant|cracked building|damaged facade|scaffold)/i },
  ],
  civic: [
    { name: "Demolition Permit", feature_id: "8546", match: /(boarded|abandoned|vacant|collapsed|fire-damaged|fire damage|demolition|roofless|condemned|ruin)/i },
    { name: "New Building Permit", feature_id: "225688", match: /(construction (site|crane|fence|fencing|hoarding)|crane|scaffold|new foundation|framing|excavat)/i },
    { name: "Roofing Permit", feature_id: "8548", match: /(roof damage|damaged roof|storm-damaged roof|tarp|leaking roof|collapsed roof|roof replacement)/i },
    { name: "Solar Permit", feature_id: "8549", match: /(solar)/i },
    { name: "Code Violation", feature_id: "8570", match: /(overgrown (lot|vacant lot|yard|sidewalk)|dumping|boarded|abandoned|vacant|graffiti|damaged fence|broken window|peeling)/i },
    { name: "Street Repair", feature_id: "8559", match: /(pothole|cracked asphalt|road crack|cracked pavement|damaged curb|damaged road|sinkhole|water main|uneven)/i },
    { name: "Vandalism", feature_id: "8522", match: /(graffiti|broken window|damaged (bench|sign|bus shelter|light pole))/i },
  ],
};
// presence: Map "<feature_id>:<region_id>" -> record count, filled by resolve-references.mjs.
const presencePath = path.join(OUT_DIR, "reference-presence.json");
const presence = fs.existsSync(presencePath) ? new Map(Object.entries(JSON.parse(fs.readFileSync(presencePath, "utf8")))) : null;
const refCount = (ref, regionId) => Number(presence?.get(`${ref.feature_id}:${regionId}`) || 0);

// ---------------------------------------------------------------- selection

const byRegion = new Map();
for (const p of themed) {
  if (!byRegion.has(p.region_id)) byRegion.set(p.region_id, []);
  byRegion.get(p.region_id).push(p);
}
for (const list of byRegion.values()) list.sort((a, b) => a.eq_top - b.eq_top);

const regions = [...byRegion.entries()]
  .map(([id, list]) => ({ id, list, type: list[0].region_type, prominence: prominence.get(id) || 0 }))
  .sort((a, b) => TYPE_RANK[a.type] - TYPE_RANK[b.type] || b.prominence - a.prominence);

const used = new Map(); // artifact -> subject uses
const seenText = new Set();
const out = [];
const counts = { city: 0, state: 0, county: 0, country: 0 };
const canUse = (p) => (used.get(p.artifact) || 0) < ARTIFACT_CAP;
const take = (p) => used.set(p.artifact, (used.get(p.artifact) || 0) + 1);
const tier = (eq) => (eq <= EXCELLENT ? "excellent" : "good");
const scoreOf = (p, role = "subject") => ({ artifact: p.artifact, feature_id: p.feature_id, eq_top: round(p.eq_top), eq_median: round(p.eq_median), eq_p90: round(p.eq_p90), photos: p.n, role });
const round = (n) => (n == null || Number.isNaN(n) ? null : Math.round(n * 10000) / 10000);

function add(template, subjects, region, ref = null) {
  const label = regionLabel(subjects[0]);
  const seed = `${template}|${subjects.map((s) => s.artifact).join("+")}|${region.id}|${ref?.name || ""}`;
  const text = phrase({ subjects: subjects.map((s) => ({ name: s.artifact, method: s.theme === "animals" || s.theme === "plants" ? "footprints_nature" : s.method })), region: { name: label, type: region.type }, ref: ref && { name: ref.name, kind: template === "civic" ? "civic" : "near" }, seed });
  const key = text.toLowerCase();
  if (seenText.has(key)) return false;
  seenText.add(key);
  const subjectScores = subjects.map((s) => s.eq_top);
  const worst = Math.max(...subjectScores);
  const scores = subjects.map((s) => scoreOf(s));
  if (ref) scores.push({ artifact: ref.name, feature_id: ref.feature_id, eq_top: null, eq_median: null, eq_p90: null, photos: null, records: refCount(ref, region.id), role: "reference" });
  const first = subjects[0];
  out.push({
    id: "lq-" + crypto.createHash("sha1").update(key).digest("hex").slice(0, 12),
    operation: "discover",
    query: text,
    input: { query: text, limit: 10, answer: true },
    category: subjects[0].theme,
    reasoning: "fast",
    highlight: subjects.length > 1
      ? `Every artifact matches strongly here: ${subjects.map((s) => `${s.artifact} ${round(s.eq_top)}`).join(", ")} (best 15 photos, lower is closer).`
      : `${first.artifact}: its 15 closest photos in ${label} average ${round(first.eq_top)} (${tier(first.eq_top)}), from ${first.n.toLocaleString("en-US")} photos.`,
    region_id: region.id,
    region_type: region.type,
    region_name: label,
    country_code: first.region_country || first.country || null,
    state_code: first.region_state || first.state || null,
    artifact_ids: subjects.flatMap((s) => s.artifact_ids.slice(0, 1)).concat(ref ? [] : []),
    feature_ids: subjects.map((s) => s.feature_id).concat(ref ? [ref.feature_id] : []),
    artifact_names: subjects.map((s) => s.artifact).concat(ref ? [ref.name] : []),
    scores,
    eq_top: round(worst),
    eq_top_mean: round(subjectScores.reduce((a, b) => a + b, 0) / subjectScores.length),
    quality_tier: tier(worst),
    template,
  });
  subjects.forEach(take);
  subjects.forEach((s) => themeUse.set(s.theme, (themeUse.get(s.theme) || 0) + 1));
  counts[region.type]++;
  return true;
}

// Themes take turns, so the list isn't all trails and forests (they score well but show less).
const themeUse = new Map();
const THEME_WEIGHT = { damage: 0, infrastructure: 0.3, construction: 0.3, animals: 0.3, buildings: 0.6, plants: 0.8, landscape: 1.2 };
const themeCost = (t) => (themeUse.get(t) || 0) + (THEME_WEIGHT[t] ?? 1) * 4;
function pickSingle(region, avoid) {
  const options = region.list.filter((p) => canUse(p) && !avoid.has(p.artifact)).slice(0, 12);
  if (!options.length) return null;
  return options.sort((a, b) => themeCost(a.theme) - themeCost(b.theme) || a.eq_top - b.eq_top)[0];
}
function pickMulti(region, avoid, size) {
  for (const a of region.list) {
    if (!canUse(a) || avoid.has(a.artifact)) continue;
    const mates = region.list.filter((b) => b !== a && b.theme === a.theme && canUse(b) && !avoid.has(b.artifact) && !shareHead(a.artifact, b.artifact));
    if (mates.length >= size - 1) return [a, ...mates.slice(0, size - 1)];
  }
  return null;
}
const head = (name) => words(name).pop();
const stem = (w) => w.replace(/(ies)$/, "y").replace(/(es|s)$/, "");
const shareHead = (a, b) => {
  const wa = words(a).map(stem), wb = words(b).map(stem);
  return wa.at(-1) === wb.at(-1) || wa.some((w) => w.length >= 4 && wb.includes(w));
};

function pickWithRef(region, avoid, kind) {
  if (!presence) return null;
  for (const p of region.list) {
    if (!canUse(p) || avoid.has(p.artifact)) continue;
    const ref = REFERENCES[kind].find((r) => r.match.test(p.artifact) && refCount(r, region.id) > 0 && r.name !== p.artifact);
    if (ref) return [p, ref];
  }
  return null;
}

for (const region of regions) {
  if (counts[region.type] >= QUOTA[region.type]) continue;
  const avoid = new Set();
  // Each region gets a spread of templates, best first, up to its cap.
  const plan = region.type === "city"
    ? ["single", "multi", "near", "civic", "single", "multi"]
    : region.type === "county" ? ["single", "civic", "multi"]
    : ["single", "multi", "single"];
  let made = 0;
  for (const template of plan) {
    if (made >= PER_REGION[region.type] || counts[region.type] >= QUOTA[region.type]) break;
    let ok = false;
    if (template === "single") {
      const p = pickSingle(region, avoid);
      if (p) ok = add("single", [p], region);
      if (p) avoid.add(p.artifact);
    } else if (template === "multi") {
      const group = pickMulti(region, avoid, made % 3 === 2 ? 3 : 2);
      if (group) { ok = add("multi", group, region); group.forEach((g) => avoid.add(g.artifact)); }
    } else {
      const hit = pickWithRef(region, avoid, template);
      if (hit) { ok = add(template, [hit[0]], region, hit[1]); avoid.add(hit[0].artifact); }
    }
    if (ok) made++;
  }
}

// Order: cities, states, counties, countries; within each, the visual themes (damage, infrastructure,
// construction, animals) lead, then by score. Trails and forests score well but show less.
const ORDER_THEME = { damage: 0, construction: 0, infrastructure: 1, animals: 1, buildings: 2, plants: 3, landscape: 3 };
const ORDER_TEMPLATE = { civic: 0, near: 0, multi: 1, single: 1 };
out.sort((a, b) => TYPE_RANK[a.region_type] - TYPE_RANK[b.region_type]
  || (ORDER_THEME[a.category] ?? 4) - (ORDER_THEME[b.category] ?? 4)
  || ORDER_TEMPLATE[a.template] - ORDER_TEMPLATE[b.template]
  || a.eq_top - b.eq_top);
out.forEach((q, i) => (q.sort_order = 1000 + i));

// ---------------------------------------------------------------- write

const esc = (v) => (v === null || v === undefined ? "null" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const json = (v) => esc(JSON.stringify(v));
const lines = [
  "-- Generated by scripts/example-queries/generate.mjs from the scene ledger. Replaces earlier ledger rows.",
  "delete from example_queries where source = 'ledger';",
];
for (const q of out) {
  lines.push(`insert into example_queries (id, operation, query, input, category, reasoning, highlight, sort_order, active, region_id, region_type, region_name, country_code, state_code, artifact_ids, feature_ids, artifact_names, scores, eq_top, eq_top_mean, quality_tier, template, source) values (${[
    // Inactive until validate.mjs sees it work live.
    esc(q.id), esc(q.operation), esc(q.query), json(q.input), esc(q.category), esc(q.reasoning), esc(q.highlight), q.sort_order, 0,
    esc(q.region_id), esc(q.region_type), esc(q.region_name), esc(q.country_code), esc(q.state_code),
    json(q.artifact_ids), json(q.feature_ids), json(q.artifact_names), json(q.scores), q.eq_top, q.eq_top_mean, esc(q.quality_tier), esc(q.template), "'ledger'",
  ].join(", ")});`);
}
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "example-queries.sql"), lines.join("\n") + "\n");
fs.writeFileSync(path.join(OUT_DIR, "example-queries.json"), JSON.stringify(out, null, 2));
const byTemplate = out.reduce((m, q) => ((m[q.template] = (m[q.template] || 0) + 1), m), {});
console.log(`${out.length} queries`, JSON.stringify(counts), JSON.stringify(byTemplate), `themed pairs ${themed.length}/${pairs.length}`, presence ? "" : "(no reference presence yet: near/civic skipped)");
