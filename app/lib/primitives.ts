// The six primitives EDK-1 is built on. The brand, the home page, /model and the docs all describe
// the model in these terms, in this order: each one builds on those before it.
import type { MotionSceneId } from "~/ascii/scenes";

export type Primitive = {
  id: string;
  name: string;
  /** What the primitive is, as a capability. */
  subtitle: string;
  /** One short line, for tables and cards. */
  does: string;
  description: string;
  /** Questions it answers. */
  asks: string[];
  /** How EDK-1 exposes it today. */
  today: string;
  call: string;
  scene: MotionSceneId;
};

export const PRIMITIVES: Primitive[] = [
  {
    id: "position",
    name: "Position",
    subtitle: "Grounding anything on Earth",
    does: "Knows where things are",
    description: "A name, a sentence, a photograph or a coordinate resolves to one exact place, with everything known about it attached. Position is how a model stops guessing where and starts knowing.",
    asks: ["Where is this?", "What is at this point?", "Which places match this description?"],
    today: "Discover resolves a question to places. Inspect resolves a point.",
    call: "POST /v1/discover",
    scene: "houses",
  },
  {
    id: "condition",
    name: "Condition",
    subtitle: "Reading the state of a place",
    does: "Judges what holds there",
    description: "Terrain, risk, access and activity, fused into a single picture of what holds at a place. Condition turns ground truth into something a machine can decide from.",
    asks: ["Is it safe, reachable, buildable?", "Who lives around here?", "Where does this hold true?"],
    today: "Inspect reads every known condition at a point. Discover finds the areas that meet them.",
    call: "GET /v1/inspect",
    scene: "terrain",
  },
  {
    id: "motion",
    name: "Motion",
    subtitle: "Understanding how the world moves",
    does: "Tracks how the world changes",
    description: "Flows, rhythms and change over time: what a place is doing now, and where it is heading. Motion gives a model a sense of before and after.",
    asks: ["What changed here, and when?", "Where is activity building?", "What does this place do at night?"],
    today: "Discover results carry when each thing was seen, so change can be read across them.",
    call: "POST /v1/discover",
    scene: "birds",
  },
  {
    id: "navigation",
    name: "Navigation",
    subtitle: "Directing movement through the physical world",
    does: "Finds the way through",
    description: "Paths for people and machines, shaped by position, condition and motion together. Navigation is where understanding becomes action: the right way through, not only the shortest.",
    asks: ["How do I get from A to B?", "Which way avoids the hazard?", "What should this vehicle steer around?"],
    today: "Route finds the way from A to B, around whatever you ask it to avoid.",
    call: "POST /v1/route",
    scene: "cars",
  },
  {
    id: "stream",
    name: "Stream",
    subtitle: "Watching for change, everywhere",
    does: "Notices what is new",
    description: "A standing watch over a place: the moment something new appears, it is noticed, described and sent on. Stream turns a model that answers into one that keeps an eye out.",
    asks: ["What changed here since Monday?", "Tell me when a permit is filed on this street.", "Which new hazards appeared overnight?"],
    today: "Monitor scans an area for new events of the artifacts you choose and sends each one to your webhook. Tier 4 and above.",
    call: "POST /v1/monitors",
    scene: "river",
  },
  {
    id: "vision",
    name: "Vision",
    subtitle: "Seeing what is in front of you",
    does: "Recognizes what it sees",
    description: "A single image, read the way the model reads the world: every object it knows is found, named and outlined. Vision lets a machine look at the ground in front of it and know what is there.",
    asks: ["What is in this picture?", "Where exactly is the pothole in this frame?", "Which of these photos show storm damage?"],
    today: "Detect takes an image and returns the artifacts in it, each with a label, a box and its coordinates in the frame.",
    call: "POST /v1/detect",
    scene: "aurora",
  },
];

/** One sentence on what EDK-1 is, for descriptions, footers and agents. */
export const ONE_LINER = "EDK-1 is a spatial model that gives humans and machines a compass for the world: position, condition, motion, navigation, stream and vision.";

/** The landing page's lead, under "Compass for Machines". */
export const HERO_LEAD = "A foundation model for the physical world. EDK-1 gives every agent, vehicle and person the same sense of Earth: where things are, what holds there, how it moves, the way through, what just changed, and what is in view.";
