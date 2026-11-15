// Turns an artifact + region (+ an optional second artifact or reference) into a natural request, the
// way someone would actually ask EDK-1. Seeded, so the same inputs always phrase the same way.

/** Words that read as mass nouns: never pluralized ("graffiti", not "graffitis"). */
const MASS = new Set(["graffiti", "debris", "erosion", "flooding", "scaffolding", "damage", "water", "construction", "lighting", "roofing", "fencing", "signage", "foliage", "ivy", "moss", "rust", "litter", "trash", "snow", "ice", "steam", "smoke", "sand", "gravel", "mud", "grass", "seagrass", "floodwater", "brickwork", "stucco", "asphalt", "concrete", "dumping", "vegetation", "overgrowth", "scrub", "brush", "woodland", "marsh", "paving", "cladding", "shrubbery", "wildlife", "machinery", "equipment", "infrastructure", "traffic", "seating", "parking", "housing"]);
const IRREGULAR = { person: "people", child: "children", man: "men", woman: "women", mouse: "mice", goose: "geese", foot: "feet", tooth: "teeth", deer: "deer", sheep: "sheep", fish: "fish", moose: "moose", bison: "bison", elk: "elk", cattle: "cattle", species: "species", series: "series", aircraft: "aircraft", salmon: "salmon", trout: "trout", leaf: "leaves", wolf: "wolves", calf: "calves", knife: "knives", shelf: "shelves", life: "lives", cactus: "cacti", octopus: "octopuses", bus: "buses", gas: "gases", lens: "lenses", canvas: "canvases", chassis: "chassis", status: "statuses", campus: "campuses", virus: "viruses", walrus: "walruses", hippopotamus: "hippos", rhinoceros: "rhinos", platypus: "platypuses" };

function pluralWord(word) {
  const lower = word.toLowerCase();
  if (MASS.has(lower)) return word;
  if (IRREGULAR[lower]) return matchCase(word, IRREGULAR[lower]);
  // Already plural ("Bluebells", "Fern Forests", "Cattails"): leave it.
  if (/s$/i.test(word) && !/(ss|us|is)$/i.test(word)) return word;
  if (/(s|x|z|ch|sh)$/i.test(word)) return word + "es";
  if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + "ies";
  if (/(potato|tomato|hero|echo|volcano|torpedo|mosquito|buffalo|domino|veto)$/i.test(word)) return word + "es";
  return word + "s";
}
const matchCase = (from, to) => (from[0] === from[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to);

/** "Damaged Roof" → "damaged roof"; keeps proper words ("Anna's", "McKinley", "NYC") as written. */
export function common(name) {
  return name
    .replace(/\s*\((?:[^)]*)\)\s*/g, " ") // drop scientific names in parentheses
    .replace(/\b(Scene|Nature Group|Brand|Sightings?)\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w, i) => (/'s$|’s$/.test(w) || /[A-Z].*[A-Z]/.test(w.slice(1)) || /\d/.test(w) || (i > 0 && /^[A-Z]{2,}$/.test(w)) ? w : w.toLowerCase()))
    .join(" ");
}

/** Plural of a phrase: pluralizes the head noun (the last word), unless it reads as a mass noun. */
export function plural(name) {
  const words = common(name).split(" ");
  // "x of y" pluralizes x: "piles of debris" — rare in this catalog, so only the simple case.
  const ofAt = words.indexOf("of");
  const head = ofAt > 0 ? ofAt - 1 : words.length - 1;
  words[head] = pluralWord(words[head]);
  return words.join(" ");
}

export const isMass = (name) => MASS.has(common(name).split(" ").pop());
const article = (phrase) => (/^[aeiou]/i.test(phrase) && !/^(uni|eu|one|use)/i.test(phrase) ? "an " : "a ") + phrase;
const cap = (s) => s[0].toUpperCase() + s.slice(1);

// Deterministic choice from a seed string.
function hash(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h; }
const pick = (list, seed) => list[hash(seed) % list.length];

const NATURE_METHODS = new Set(["footprints_nature", "category_footprints_nature"]);
const STREET = /(roof|window|door|storefront|facade|wall|sidewalk|curb|crosswalk|pole|power line|hydrant|sign|fence|pothole|pavement|asphalt|road|street|graffiti|bench|bus shelter|streetlight|light pole|manhole|storm drain|scaffold|construction|tarp|debris|dumping|cart|vacant|boarded|abandoned|mural|parking)/i;

/**
 * subjects: [{name, method}] (what the query finds), region: {name, type}, ref?: {name, kind: "near" | "civic"}.
 * Returns the query text.
 */
export function phrase({ subjects, region, ref = null, seed }) {
  const r = region.name;
  const [a, b, c] = subjects;
  const pa = plural(a.name), sa = common(a.name);
  const nature = NATURE_METHODS.has(a.method);
  const street = STREET.test(a.name);
  const isCity = region.type === "city";
  const big = region.type === "state" || region.type === "country";
  const any = isMass(a.name) ? sa : pa;

  if (ref && ref.kind === "near") {
    const pr = plural(ref.name), sr = common(ref.name);
    return pick([
      `${cap(any)} near ${pr} in ${r}`,
      `Find ${any} within a block of ${article(sr)} in ${r}`,
      `Show me ${any} close to ${pr} around ${r}`,
      `${cap(any)} within 300 meters of ${article(sr)} in ${r}`,
      `Map the ${any} closest to ${pr} in ${r}`,
    ], seed);
  }
  if (ref && ref.kind === "civic") {
    const pr = plural(ref.name);
    const fresh = /^new /i.test(pr) ? "" : "new ";
    return pick([
      `${cap(any)} near recent ${pr} in ${r}`,
      `Show me ${any} close to ${fresh}${pr} in ${r}`,
      `Where do ${any} and ${pr} overlap in ${r}?`,
    ], seed);
  }
  if (b) {
    const pb = isMass(b.name) ? common(b.name) : plural(b.name);
    if (c) {
      const pc = isMass(c.name) ? common(c.name) : plural(c.name);
      return pick([
        `Show me ${any}, ${pb} and ${pc} across ${r}`,
        `Map ${any}, ${pb} and ${pc} in ${r}`,
        `Where are the ${any}, ${pb} and ${pc} in ${r}?`,
      ], seed);
    }
    return pick([
      `${cap(any)} and ${pb} in ${r}`,
      `Show me ${any} and ${pb} around ${r}`,
      `Where do ${any} and ${pb} turn up in ${r}?`,
      `Map every ${sa} and ${common(b.name)} in ${r}`,
      `Find ${any} alongside ${pb} in ${r}`,
    ], seed);
  }
  if (nature) {
    return pick(big ? [
      `Where have ${pa} been seen across ${r}?`,
      `Recent sightings of ${pa} in ${r}`,
      `Show me ${pa} spotted in ${r}`,
      `Find ${pa} in the wild across ${r}`,
    ] : [
      `Where have ${pa} been seen around ${r}?`,
      `Recent sightings of ${pa} around ${r}`,
      `Show me ${pa} spotted around ${r}`,
      `${cap(pa)} in and around ${r}`,
    ], seed);
  }
  if (isCity && street) {
    return pick([
      `Show me ${any} in ${r}`,
      `Where are the ${any} in ${r}?`,
      `Map every ${sa} in ${r}`,
      `Which neighborhoods in ${r} have ${any}?`,
      `Find ${any} on the streets of ${r}`,
      `${cap(any)} across ${r}, with photos`,
    ], seed);
  }
  return pick(big ? [
    `Find ${any} across ${r}`,
    `Where in ${r} can you see ${any}?`,
    `Show me ${any} throughout ${r}`,
    `Map the ${any} across ${r}`,
  ] : [
    `Show me ${any} in ${r}`,
    `Where are the ${any} around ${r}?`,
    `Find ${any} in ${r}`,
    `Map the ${any} in ${r}`,
    `Look for ${any} around ${r}`,
  ], seed);
}
