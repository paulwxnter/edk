import { ATTRIBUTES, ATTRIBUTE_BY_KEY } from "./attributes/catalog";
import type { DecisionAnswer, DecisionQuestion } from "./jev";

export type SpatialPlan =
  | { operation: "nearest" | "within"; target: string; reference: string; radius?: number }
  | { operation: "density"; target: string }
  | { operation: "compare"; subjects: string[]; metric: string; reference?: string; order: "asc" | "desc" | "input" };

export type SpatialInput = { areaCount: number; addressCount: number; focus: boolean };
export const spatialFilterQuestions = (keys: string[]) => Object.fromEntries(keys.map((key) => [`scope:${key}`, {
  type: "choice",
  instructions: "For the spatial relationship in the query, decide whether this condition describes the requested result, the artifact used as its reference, or both. If unrelated or uncertain select neither.",
  criteria: { target: "Requested result only", reference: "Reference artifact only", both: "Both artifacts", neither: "Neither artifact" },
}]));
type Candidate = { id: string; name: string };

export function spatialQuestions(query: string, artifacts: Candidate[], regions: Candidate[], input: SpatialInput) {
  const artifactChoices = Object.fromEntries(artifacts.map(({ id, name }) => [`artifact:${id}`, name]));
  const pointChoices = Object.fromEntries([
    ...Array.from({ length: input.areaCount }, (_, i) => [`area:${i + 1}`, `Supplied area ${i + 1}`]),
    ...Array.from({ length: input.addressCount }, (_, i) => [`address:${i + 1}`, `Geocoded address ${i + 1} in query order`]),
  ]);
  const distances: Record<string, number> = {};
  for (const match of query.matchAll(/(?<![\d.-])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(kilometers?|kilometres?|km|meters?|metres?|miles?|mi|feet|foot|ft|m)\b/gi)) {
    const unit = match[2].toLowerCase();
    const multiplier = unit.startsWith("k") ? 1000 : unit.startsWith("mi") ? 1609.344 : /^(f)/.test(unit) ? 0.3048 : 1;
    const meters = Number(match[1].replaceAll(",", "")) * multiplier;
    if (meters > 0 && meters <= 10_000) distances[match[0]] = meters;
  }
  const choice = (instructions: string, criteria: Record<string, string>): DecisionQuestion =>
    ({ type: "choice", instructions, criteria: { none: "Not requested or ambiguous.", ...criteria } });
  const questions: Record<string, DecisionQuestion> = {
    spatial_operation: choice("Classify the relationship implied by the query. For 'benches near libraries in Boston' choose nearest even without the word closest. For 'near me' with supplied areas choose nearest. Use within only for an explicit numeric radius. A city name alone scopes a search. For 'benches in Boston' or 'benches and libraries' without a proximity relationship choose none, except a location-free lookup with supplied coordinate areas implies a local search.", {
      nearest: "Find A near B without a numeric radius, including near the caller's supplied coordinates.",
      within: "Find locations within an explicitly requested numeric distance of a reference.",
      density: "Find areas where one requested kind of mapped record is concentrated.",
      compare: "Compare two or more artifacts, supplied areas, or addresses on a shared measurement.",
    }),
    spatial_target: choice("For a proximity or concentration request, which catalog artifact is being returned? Use meaning and grammatical roles regardless of word order.", artifactChoices),
    spatial_reference: choice("Choose what serves as the geographic origin for distance. In 'benches near libraries in Boston', the reference is libraries, never benches or Boston. In 'near me', choose areas if supplied. A named city only bounds the search unless its center was explicitly requested. For a comparison by distance select the shared reference artifact.", {
      ...artifactChoices, ...pointChoices,
      ...(input.areaCount ? { areas: "The caller's location (near me) or all supplied coordinate areas as implicit origins" } : {}),
      ...Object.fromEntries(regions.map(({ id, name }) => [`center:${id}`, `Explicit center of ${name}`])),
      ...(input.focus ? { "center:focus": "Explicit center of the focused region" } : {}),
    }),
    spatial_radius: choice("Which exact distance phrase specifies the radius of the requested search?", Object.fromEntries(Object.keys(distances).map((phrase) => [phrase, phrase]))),
    spatial_metric: choice("Which single shared measurement is requested for comparison? Use mapped count by default for comparisons of two artifact inventories. Use straight-line distance for comparisons of proximity to an artifact.", {
      count: "Number of mapped records", density: "Mapped records per square kilometer", distance: "Distance to the closest mapped reference",
      ...Object.fromEntries(ATTRIBUTES.filter((def) => def.kind === "number").map((def) => [def.key, def.label])),
    }),
    spatial_order: choice("What ordering does the user explicitly request for the measured values? For which is closer, prefer smallest distance first.", { asc: "Smallest first", desc: "Largest first" }),
    ...Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`spatial_subject_${i + 1}`, choice(
      `Which is comparison subject number ${i + 1}, in user order? Choose none when fewer subjects were requested. Preserve supplied area order for references to these areas.`,
      { ...artifactChoices, ...pointChoices },
    )])),
  };
  return { questions, distances };
}

export function parseSpatialPlan(answers: Record<string, DecisionAnswer> | undefined, spec: ReturnType<typeof spatialQuestions>): SpatialPlan | null {
  const selected = (key: string) => {
    const value = answers?.[key]?.choice;
    return typeof value === "string" && value !== "none" && Object.hasOwn(spec.questions[key].criteria, value) ? value : null;
  };
  const operation = selected("spatial_operation");
  const target = selected("spatial_target");
  const reference = selected("spatial_reference");
  if (operation === "density") return target ? { operation, target } : null;
  if (operation === "nearest" || operation === "within") {
    const radius = spec.distances[selected("spatial_radius") ?? ""];
    return target && reference && target !== reference && (operation === "nearest" || radius) ? { operation, target, reference, radius } : null;
  }
  if (operation !== "compare") return null;
  const subjects = [...new Set([1, 2, 3, 4].map((i) => selected(`spatial_subject_${i}`)).filter((s): s is string => Boolean(s)))];
  const metric = selected("spatial_metric");
  const order = selected("spatial_order");
  if (!metric || subjects.length < 2) return null;
  const artifacts = subjects.every((s) => s.startsWith("artifact:"));
  const points = subjects.every((s) => !s.startsWith("artifact:")) && new Set(subjects.map((s) => s.split(":")[0])).size === 1;
  if (!(artifacts && (metric === "count" || metric === "density") || points && (Boolean(ATTRIBUTE_BY_KEY[metric]) || metric === "distance" && reference?.startsWith("artifact:")))) return null;
  if (points) subjects.sort((a, b) => a.localeCompare(b));
  return { operation, subjects, metric, ...(reference ? { reference } : {}), order: order === "asc" || order === "desc" ? order : "input" };
}
