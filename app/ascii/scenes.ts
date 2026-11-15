export const SCENES = [
  { id: "branch-tree", name: "branches in the breeze", subject: "branching tree", group: "land", hint: "a rooted tree, a passing breeze." },
  { id: "trees", name: "a little woodland", subject: "trees", group: "land", hint: "move through the canopy. click to stir the leaves." },
  { id: "houses", name: "places to call home", subject: "houses", group: "built", hint: "little roofs, lit windows, and chimney smoke." },
  { id: "terrain", name: "what holds here", subject: "mountain weather", group: "land", hint: "sun on one slope, rain on the other." },
  { id: "cars", name: "on the move", subject: "cars", group: "built", hint: "click to set a destination. they find a way around." },
  { id: "koi", name: "a quiet pond", subject: "koi", group: "water", hint: "click to feed. move slowly to draw them near." },
  { id: "shoal", name: "silver, together", subject: "silver shoal", group: "water", hint: "click to gather the school. a quick sweep scatters it." },
  { id: "rays", name: "ocean gliders", subject: "manta flight", group: "water", hint: "click to draw a slow turn through the current." },
  { id: "jellyfish", name: "a softer current", subject: "jellyfish bloom", group: "water", hint: "click to send a pressure wave through the bells." },
  { id: "octopus", name: "eight little currents", subject: "octopus drift", group: "water", hint: "an arm follows your curiosity. move gently." },
  { id: "birds", name: "following the wind", subject: "swallow murmuration", group: "air", hint: "the flock parts around your pointer, then finds its way." },
  { id: "butterflies", name: "a passing flutter", subject: "monarch meadow", group: "air", hint: "click to invite a moment of stillness." },
  { id: "dragonflies", name: "above the reeds", subject: "dragonfly patrol", group: "air", hint: "move slowly. they hover, then disappear into a dart." },
  { id: "hummingbirds", name: "small wings, still air", subject: "hummingbird pause", group: "air", hint: "click to leave a little nectar in the air." },
  { id: "kelp", name: "under the tide", subject: "kelp current", group: "land", hint: "click to send a current through the rooted fronds." },
  { id: "grass", name: "a little wind", subject: "wind through grass", group: "land", hint: "brush past the blades. click for a wider gust." },
  { id: "willow", name: "the canopy breathes", subject: "willow canopy", group: "land", hint: "click to stir the hanging branches." },
  { id: "waves", name: "nothing in a hurry", subject: "ocean swell", group: "sky", hint: "click to make a ripple. watch the waves meet." },
  { id: "river", name: "water finds a way", subject: "river braids", group: "sky", hint: "click to release a pulse into the current." },
  { id: "aurora", name: "light, unfolding", subject: "aurora curtains", group: "sky", hint: "move through the curtain. click to send a light wave." },
  { id: "earth", name: "our pale blue home", subject: "living Earth", group: "sky", hint: "drag to turn the planet. click for a surface pulse." },
] as const;
export type SceneId = typeof SCENES[number]["id"];
export type SceneMode = "single" | "mixed" | "sequence";
export type MotionSceneId = Exclude<SceneId, "koi">;
export const DEFAULT_SCENES: SceneId[] = ["houses", "trees", "cars", "kelp", "willow", "waves", "river", "aurora", "earth", "grass", "koi", "butterflies"];
export const COMPANIONS: Partial<Record<SceneId, MotionSceneId>> = {
  houses: "trees", trees: "houses", cars: "houses",
  shoal: "kelp", kelp: "shoal", rays: "jellyfish", jellyfish: "rays", butterflies: "grass", grass: "butterflies",
};
