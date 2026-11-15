// Sight: what EDK-1 sees in an image. Jev answers typed questions about a picture, and one request can
// carry hundreds of them at once, so an image is read in three passes:
//   1. scenes     one question per broad category (nature, infrastructure, transportation…)
//   2. artifacts  one question per catalog artifact in the categories that are present, 500 a request,
//                 every request in parallel
//   3. boxes      one box per artifact that is present
// Jev's Box always returns a box, so presence is decided in pass 2 and pass 3 only places it.
import { sql } from "./e2-db";
import { verifyMediaPath, signMedia } from "./media-proxy";
import { addDecisionTokens } from "./tokens";

export class VisionError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export type Box = { top: number; left: number; bottom: number; right: number };
type JevQuestion = { type: "noul" | "box"; instructions: string; criteria?: Record<string, string> };
type JevAnswer = { noul?: number; box?: Box; confidence?: number };

const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
// Jev accepts 280 to 1568 px a side and never resizes. 1024 on the long side keeps small objects legible
// while a request of 500 questions still answers in about half a second.
const MIN_SIDE = 280;
const MAX_SIDE = 1568;
const SEND_SIDE = 1024;
const MAX_PASSTHROUGH_BYTES = 900 * 1024;
// Jev answers at a steady rate of tokens, however they are split across requests, so the catalog pass
// asks the shortest question that works (measured: 2,700 artifacts in 0.8 s, against 2.1 s with each
// artifact's description attached) and sends up to 900 of them a request.
const LABELS_PER_REQUEST = 900;
const MAX_LABELS = 5400;
const MAX_PARALLEL = 6;
const SCENE_THRESHOLD = 0.4;
/** A box over nearly the whole frame describes the scene, not an object in it. */
const WHOLE_FRAME = 0.9;

// ---------------------------------------------------------------- image input

// The workerd build imports its WebAssembly as a module, the only way a Worker may load it.
// It may be set up only once per isolate, so the import is kept on the global (a dev reload of this file
// would otherwise run it again).
type Photon = typeof import("@cf-wasm/photon/workerd");
const photonLib = (): Promise<Photon> => ((globalThis as { __edkPhoton?: Promise<Photon> }).__edkPhoton ??= import("@cf-wasm/photon/workerd"));

function base64Of(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** The image a caller sent: base64 (with or without a data: prefix) or an https URL. */
export async function loadImage(body: { image?: unknown; image_url?: unknown }): Promise<Uint8Array> {
  if (typeof body?.image === "string" && body.image.trim()) {
    const data = body.image.trim().replace(/^data:image\/[a-z+.-]+;base64,/i, "").replace(/\s+/g, "");
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(data.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    } catch {
      throw new VisionError("image must be base64-encoded JPEG or PNG data.");
    }
    if (!bytes.length) throw new VisionError("image must be base64-encoded JPEG or PNG data.");
    if (bytes.length > MAX_IMAGE_BYTES) throw new VisionError("image must be 16 MB or smaller.", 413);
    return bytes;
  }
  if (typeof body?.image_url === "string" && body.image_url.trim()) return fetchImage(body.image_url.trim());
  throw new VisionError('Send image (base64 JPEG or PNG) or image_url (https), like {"image_url": "https://…/street.jpg"}.');
}

export async function fetchImage(source: string): Promise<Uint8Array> {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new VisionError("image_url must be a valid https URL.");
  }
  if (url.protocol !== "https:") throw new VisionError("image_url must use https.");
  const response = await fetch(url, { headers: { accept: "image/jpeg,image/png,image/*;q=0.8", "user-agent": "EDK-Sight/1" }, signal: AbortSignal.timeout(10_000), redirect: "follow" }).catch(() => null);
  if (!response?.ok) throw new VisionError(`Could not download image_url${response ? ` (${response.status})` : ""}.`);
  if (Number(response.headers.get("content-length") || 0) > MAX_IMAGE_BYTES) throw new VisionError("image_url must point to an image of 16 MB or less.", 413);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) throw new VisionError("image_url must point to an image of 16 MB or less.", 413);
  return bytes;
}

/** Format, size and EXIF orientation read from the file header, without decoding the picture. */
export function imageHeader(bytes: Uint8Array): { format: "jpg" | "png"; width: number; height: number; orientation: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length > 24 && view.getUint32(0) === 0x89504e47) return { format: "png", width: view.getUint32(16), height: view.getUint32(20), orientation: 1 };
  if (bytes.length < 4 || view.getUint16(0) !== 0xffd8) return null;
  let offset = 2;
  let orientation = 1;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    const length = view.getUint16(offset + 2);
    if (marker === 0xe1 && length > 16 && view.getUint32(offset + 4) === 0x45786966) orientation = exifOrientation(view, offset + 10, offset + 2 + length) ?? orientation;
    // Start-of-frame markers carry the size (all but DHT, JPG and DAC, which share the range).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { format: "jpg", height: view.getUint16(offset + 5), width: view.getUint16(offset + 7), orientation };
    }
    offset += 2 + length;
  }
  return null;
}

function exifOrientation(view: DataView, start: number, end: number) {
  try {
    const little = view.getUint16(start) === 0x4949;
    const directory = start + view.getUint32(start + 4, little);
    const entries = view.getUint16(directory, little);
    for (let i = 0; i < entries; i++) {
      const entry = directory + 2 + i * 12;
      if (entry + 12 > end) break;
      if (view.getUint16(entry, little) === 0x0112) return view.getUint16(entry + 8, little);
    }
  } catch {
    /* no readable EXIF */
  }
  return null;
}

/** Turns RGBA pixels the way their EXIF orientation says they should be shown. */
function orient(pixels: Uint8Array, width: number, height: number, orientation: number) {
  if (orientation < 2 || orientation > 8) return { pixels, width, height };
  const swap = orientation >= 5;
  const outWidth = swap ? height : width;
  const outHeight = swap ? width : height;
  const out = new Uint8Array(pixels.length);
  const source = new Uint32Array(pixels.buffer, pixels.byteOffset, width * height);
  const target = new Uint32Array(out.buffer);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let tx = x;
      let ty = y;
      if (orientation === 2) tx = width - 1 - x;
      else if (orientation === 3) { tx = width - 1 - x; ty = height - 1 - y; }
      else if (orientation === 4) ty = height - 1 - y;
      else if (orientation === 5) { tx = y; ty = x; }
      else if (orientation === 6) { tx = height - 1 - y; ty = x; }
      else if (orientation === 7) { tx = height - 1 - y; ty = width - 1 - x; }
      else if (orientation === 8) { tx = y; ty = width - 1 - x; }
      target[ty * outWidth + tx] = source[y * width + x];
    }
  }
  return { pixels: out, width: outWidth, height: outHeight };
}

export type PreparedImage = {
  /** What Jev receives. */
  base64: string;
  format: "jpg" | "png";
  /** The picture as the caller sees it (after EXIF rotation). */
  width: number;
  height: number;
  /** Upright RGBA pixels at the size sent, when the image had to be decoded. */
  decoded?: { pixels: Uint8Array; width: number; height: number };
  bytes: Uint8Array;
};

/** Fits an image into what Jev accepts. A picture already in range is sent untouched, with no decode. */
export async function prepareImage(bytes: Uint8Array): Promise<PreparedImage> {
  const header = imageHeader(bytes);
  if (header && header.orientation === 1 && bytes.length <= MAX_PASSTHROUGH_BYTES &&
      Math.max(header.width, header.height) <= MAX_SIDE && Math.min(header.width, header.height) >= MIN_SIDE) {
    return { base64: base64Of(bytes), format: header.format, width: header.width, height: header.height, bytes };
  }
  const photon = await photonLib();
  let image: InstanceType<typeof photon.PhotonImage>;
  try {
    image = photon.PhotonImage.new_from_byteslice(bytes);
  } catch {
    throw new VisionError("The image could not be read. Send a JPEG or PNG.");
  }
  try {
    const upright = orient(image.get_raw_pixels(), image.get_width(), image.get_height(), header?.orientation ?? 1);
    let scale = Math.min(1, SEND_SIDE / Math.max(upright.width, upright.height));
    if (Math.min(upright.width, upright.height) * scale < MIN_SIDE) scale = MIN_SIDE / Math.min(upright.width, upright.height);
    const width = Math.round(upright.width * scale);
    const height = Math.round(upright.height * scale);
    if (Math.max(width, height) > MAX_SIDE) throw new VisionError("The image is too narrow. Crop it closer to 5:1 or squarer.");
    const full = new photon.PhotonImage(upright.pixels, upright.width, upright.height);
    const sized = scale === 1 ? full : photon.resize(full, width, height, photon.SamplingFilter.Triangle);
    try {
      const jpeg = sized.get_bytes_jpeg(82);
      return { base64: base64Of(jpeg), format: "jpg", width: upright.width, height: upright.height, bytes: jpeg, decoded: { pixels: sized.get_raw_pixels(), width, height } };
    } finally {
      if (sized !== full) sized.free();
      full.free();
    }
  } finally {
    image.free();
  }
}

// ---------------------------------------------------------------- Jev

async function ask(image: PreparedImage, questions: Record<string, JevQuestion>, timeoutMs: number): Promise<Record<string, JevAnswer>> {
  const key = process.env.JEV_API_KEY;
  if (!key) throw new VisionError("Sight is not configured.", 503);
  if (!Object.keys(questions).length) return {};
  // A new reference for each image in each request, as Jev's image guide asks.
  const ref = `photo-${crypto.randomUUID()}`;
  const send = () => fetch(JEV_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "TypeSafe-Danger-Zone-Images": "true" },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model: process.env.JEV_VISION_MODEL || process.env.JEV_MODEL || "jev-latest",
      state: { photo: ref },
      assets: { [ref]: { type: "image", format: image.format, data_base64: image.base64 } },
      questions,
    }),
  });
  let response = await send().catch(() => null);
  if (!response || response.status === 429 || response.status >= 500) response = await send().catch(() => null);
  if (!response) throw new VisionError("Sight is temporarily unavailable. Please try again.", 502);
  if (!response.ok) {
    console.error("[vision] jev failed", response.status, (await response.text().catch(() => "")).slice(0, 200));
    throw new VisionError(response.status === 400 || response.status === 413 ? "The image could not be read. Send a JPEG or PNG between 280 and 1568 pixels a side." : "Sight is temporarily unavailable. Please try again.", response.status === 400 || response.status === 413 ? 400 : 502);
  }
  const value = (await response.json().catch(() => null)) as { answers?: Record<string, JevAnswer>; usage?: { input_tokens?: number } } | null;
  addDecisionTokens(value?.usage?.input_tokens);
  return value?.answers ?? {};
}

/** Runs tasks a few at a time, in order. */
async function pooled<T, R>(items: T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await run(items[index]);
    }
  }));
  return out;
}

// ---------------------------------------------------------------- catalog

export const SCENES: { id: string; name: string; shows: string }[] = [
  { id: "nature", name: "Nature", shows: "plants, trees, animals, water, terrain or other natural features" },
  { id: "infrastructure", name: "Infrastructure", shows: "roads, bridges, utilities, signs, lighting, drainage or other public works" },
  { id: "transportation", name: "Transportation", shows: "vehicles, transit, parking, traffic, cycling or anything about getting around" },
  { id: "business", name: "Business", shows: "shops, restaurants, offices, signage, storefronts or commercial activity" },
  { id: "outdoors", name: "Outdoors", shows: "parks, trails, playgrounds, campsites or outdoor recreation" },
  { id: "real_estate", name: "Real estate", shows: "houses, apartments, buildings, yards, construction or property features" },
  { id: "environment", name: "Environment", shows: "weather, pollution, flooding, erosion, litter or environmental conditions" },
  { id: "sports", name: "Sports", shows: "courts, fields, stadiums, equipment or people playing sport" },
  { id: "travel", name: "Travel", shows: "landmarks, scenic views, lodging, attractions or places people visit" },
  { id: "culture", name: "Culture", shows: "art, murals, monuments, historic or religious buildings, or cultural life" },
  { id: "community", name: "Community", shows: "schools, civic buildings, gathering places or neighborhood life" },
  { id: "events", name: "Events", shows: "crowds, festivals, markets, incidents or something happening" },
];
const SCENE_IDS = new Set(SCENES.map((scene) => scene.id));
const GENERAL = "general";

// Map-tag names that describe a record, not something a picture shows (opening hours, yes/no tags, floor counts).
const NOT_VISIBLE = /opening hours$|(yes|no|alt)$|^d+ floor building$|^(landuse|man made|surface) |( landuse| material)$/i;

type Label = { id: string; name: string; description: string | null; scenes: string[] };
let catalog: { at: number; pending: Promise<Label[]> } | null = null;

/** Every artifact that can be seen in a picture, most common first. Cached for ten minutes. */
export function visibleArtifacts(): Promise<Label[]> {
  if (catalog && Date.now() - catalog.at < 600_000) return catalog.pending;
  const pending = sql.query(
    `select id::text as id, name, left(description, 140) as description, interests
       from artifacts
      where status = 'verified' and method in ('name', 'terms', 'osm', 'osm_alt')
        and (total_scenes > 0 or source_table is not null)
      order by total_scenes desc nulls last, name
      limit ${MAX_LABELS * 2}`,
  ).then((rows: any[]) => {
    const seen = new Set<string>();
    const out: Label[] = [];
    for (const row of rows) {
      const name = String(row.name || "").trim();
      const key = name.toLowerCase();
      if (!name || name.length > 80 || seen.has(key) || NOT_VISIBLE.test(name)) continue;
      seen.add(key);
      const scenes = (Array.isArray(row.interests) ? row.interests : []).filter((scene: unknown): scene is string => typeof scene === "string" && SCENE_IDS.has(scene));
      out.push({ id: String(row.id), name, description: row.description ? String(row.description).trim() : null, scenes: scenes.length ? scenes : [GENERAL] });
      if (out.length >= MAX_LABELS) break;
    }
    return out;
  });
  catalog = { at: Date.now(), pending };
  pending.catch(() => { catalog = null; });
  return pending;
}

const presence = (label: Pick<Label, "name" | "description">): JevQuestion => ({
  type: "noul",
  instructions: `Is ${label.name} clearly visible in \`photo\`?${label.description ? ` ${label.name}: ${label.description}` : ""}`,
  criteria: { true: `Yes. ${label.name} can be seen in the image.`, false: `No. ${label.name} cannot be seen in the image.` },
});
/** The catalog pass: the same question, as short as it can be. */
const glance = (name: string): JevQuestion => ({ type: "noul", instructions: `Is ${name} visible in \`photo\`?`, criteria: { true: "Yes", false: "No" } });
const placement = (name: string): JevQuestion => ({ type: "box", instructions: `the ${name} in \`photo\`` });

const round = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (n: unknown) => Math.max(0, Math.min(1, Number(n) || 0));
function cleanBox(box: Box | undefined): Box | null {
  if (!box) return null;
  const out = { top: round(clamp(box.top)), left: round(clamp(box.left)), bottom: round(clamp(box.bottom)), right: round(clamp(box.right)) };
  return out.bottom > out.top && out.right > out.left ? out : null;
}
function overlap(a: Box, b: Box) {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (width <= 0 || height <= 0) return 0;
  const shared = width * height;
  return shared / ((a.right - a.left) * (a.bottom - a.top) + (b.right - b.left) * (b.bottom - b.top) - shared);
}

// ---------------------------------------------------------------- detect

export type DetectedObject = {
  label: string;
  artifact_id: string;
  category: string | null;
  probability: number;
  confidence: number | null;
  box: Box;
  pixels: { x: number; y: number; width: number; height: number };
  /** Other artifacts found in the same place. */
  also?: string[];
};

export type DetectInput = { maxObjects: number; threshold: number; annotate: boolean };

export function parseDetectInput(body: any): DetectInput {
  const max = Number(body?.max_objects);
  const threshold = Number(body?.threshold);
  return {
    maxObjects: Math.max(1, Math.min(40, Number.isFinite(max) && max > 0 ? Math.floor(max) : 12)),
    threshold: Number.isFinite(threshold) && threshold > 0 && threshold < 1 ? threshold : 0.6,
    annotate: body?.annotate !== false && body?.annotate !== "false",
  };
}

export async function detect(bytes: Uint8Array, input: DetectInput) {
  const started = Date.now();
  const stages: { name: string; ms: number }[] = [];
  const timed = async <T>(name: string, work: () => Promise<T>) => {
    const from = Date.now();
    try {
      return await work();
    } finally {
      stages.push({ name, ms: Date.now() - from });
    }
  };
  const labelsPending = visibleArtifacts();
  const image = await timed("image", () => prepareImage(bytes));

  let requests = 1;
  let failed = 0;
  /** Asks about a set of artifacts in as few parallel requests as the connection limit allows. */
  const look = async (labels: Label[], parallel = MAX_PARALLEL) => {
    if (!labels.length) return [];
    const count = Math.min(parallel, Math.ceil(labels.length / LABELS_PER_REQUEST));
    const size = Math.ceil(labels.length / count);
    const pages = Array.from({ length: Math.ceil(labels.length / size) }, (_, i) => labels.slice(i * size, (i + 1) * size));
    requests += pages.length;
    return (await pooled(pages, MAX_PARALLEL, async (page) => {
      const answers = await ask(image, Object.fromEntries(page.map((label, i) => [`a${i}`, glance(label.name)])), 12_000).catch(() => { failed += 1; return null; });
      return answers ? page.flatMap((label, i) => {
        const probability = answers[`a${i}`]?.noul;
        return typeof probability === "number" && probability >= input.threshold ? [{ label, probability }] : [];
      }) : [];
    })).flat();
  };

  // Pass 1: which broad kinds of thing are in the picture. Artifacts that belong to no category are
  // asked about at the same time, since they are needed whatever the answer.
  const all = await labelsPending;
  const uncategorizedLabels = all.filter((label) => label.scenes[0] === GENERAL);
  const [scenes, uncategorized] = await timed("scenes", () => Promise.all([
    ask(image, Object.fromEntries(SCENES.map((scene) => [scene.id, {
      type: "noul" as const,
      instructions: `Does \`photo\` show ${scene.shows}?`,
      criteria: { true: `Yes. The image shows something in ${scene.name.toLowerCase()}.`, false: "No. Nothing like this is in the image." },
    }])), 8000).catch(() => ({} as Record<string, JevAnswer>)),
    look(uncategorizedLabels, MAX_PARALLEL - 1),
  ]));
  const present = new Set(SCENES.filter((scene) => (scenes[scene.id]?.noul ?? 1) >= SCENE_THRESHOLD).map((scene) => scene.id));

  // Pass 2: every artifact in the categories that are present.
  const inScene = all.filter((label) => label.scenes[0] !== GENERAL && label.scenes.some((scene) => present.has(scene)));
  const seen = [...uncategorized, ...(await timed("artifacts", () => look(inScene)))].sort((x, y) => y.probability - x.probability);
  if (failed && failed >= requests - 1) throw new VisionError("Sight is temporarily unavailable. Please try again.", 502);
  const considered = inScene.length + uncategorizedLabels.length;

  // Pass 3: place the most likely ones. More than asked for, since several names can share one box.
  const candidates = seen.slice(0, Math.min(80, input.maxObjects * 3));
  const placed = await timed("boxes", () => ask(image, Object.fromEntries(candidates.map(({ label }, i) => [`b${i}`, placement(label.name)])), 12_000));
  const objects: DetectedObject[] = [];
  candidates.forEach(({ label, probability }, i) => {
    const box = cleanBox(placed[`b${i}`]?.box);
    if (!box || (box.right - box.left) * (box.bottom - box.top) > WHOLE_FRAME) return;
    const same = objects.find((object) => overlap(object.box, box) >= 0.85);
    if (same) {
      (same.also ??= []).push(label.name);
      return;
    }
    const confidence = placed[`b${i}`]?.confidence;
    objects.push({
      label: label.name,
      artifact_id: label.id,
      category: label.scenes.find((scene) => scene !== GENERAL) ?? null,
      probability: round(probability),
      confidence: typeof confidence === "number" ? round(confidence) : null,
      box,
      pixels: { x: Math.round(box.left * image.width), y: Math.round(box.top * image.height), width: Math.round((box.right - box.left) * image.width), height: Math.round((box.bottom - box.top) * image.height) },
    });
  });
  const kept = objects.slice(0, input.maxObjects);
  const annotated = input.annotate && kept.length ? await timed("annotate", () => drawBoxes(image, kept.map((object) => ({ box: object.box, label: object.label }))).catch((error) => { console.error("[vision] annotate failed", error); return null; })) : null;
  return {
    image: { width: image.width, height: image.height },
    objects: kept,
    ...(annotated ? { annotated_image: `data:image/jpeg;base64,${base64Of(annotated)}` } : {}),
    duration_ms: Date.now() - started,
    development: { total_ms: Date.now() - started, labels: considered, requests: requests + 1, stages },
  };
}

// ---------------------------------------------------------------- verify one artifact in one image

export type Sighting = { probability: number; box: Box | null; confidence: number | null };

/** Whether one artifact is in one image, and where. Null when the image or the model cannot be read. */
export async function sight(imageUrl: string, name: string, description?: string | null): Promise<Sighting | null> {
  try {
    const image = await prepareImage(await fetchImage(sourceOf(imageUrl) ?? imageUrl));
    const answers = await ask(image, { present: presence({ name, description: description ?? null }), box: placement(name) }, 6000);
    const probability = answers.present?.noul;
    if (typeof probability !== "number") return null;
    const confidence = answers.box?.confidence;
    return { probability: round(probability), box: cleanBox(answers.box?.box), confidence: typeof confidence === "number" ? round(confidence) : null };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- drawing

const cdnBase = () => (process.env.CDN_URL || "https://cdn.edk.earth").replace(/\/+$/, "");
const PALETTE: [number, number, number][] = [[255, 196, 0], [0, 200, 255], [255, 87, 87], [120, 230, 120], [200, 130, 255], [255, 140, 40], [80, 160, 255], [255, 105, 180]];

/** The source behind one of our CDN image URLs. */
export function sourceOf(imageUrl: string) {
  const match = imageUrl.startsWith(cdnBase() + "/") ? imageUrl.slice(cdnBase().length).match(/^\/i\/([A-Za-z0-9_-]{22})\/([A-Za-z0-9_-]+)$/) : null;
  return match ? verifyMediaPath(match[1], match[2]) : null;
}

const boxPath = (box: Box) => [box.top, box.left, box.bottom, box.right].map((n) => Math.round(clamp(n) * 1000)).join("-");

/** A CDN URL that serves an image with one box drawn on it: /b/<sig>/<source>/<box>/<label>. */
export function boxedImageUrl(imageUrl: string, box: Box, label: string) {
  const source = sourceOf(imageUrl);
  if (!source) return null;
  const path = boxPath(box);
  const name = Buffer.from(label.slice(0, 60)).toString("base64url");
  return `${cdnBase()}/b/${signMedia(`${source}#${path}#${name}`)}/${Buffer.from(source).toString("base64url")}/${path}/${name}`;
}

/** Reads a /b/ path back, or null when it was not signed by us. */
export function verifyBoxedPath(sig: string, encoded: string, path: string, name: string): { source: string; box: Box; label: string } | null {
  try {
    const source = Buffer.from(encoded, "base64url").toString("utf8");
    if (!source.startsWith("https://") || signMedia(`${source}#${path}#${name}`) !== sig) return null;
    const [top, left, bottom, right] = path.split("-").map((n) => Number(n) / 1000);
    return { source, box: { top, left, bottom, right }, label: Buffer.from(name, "base64url").toString("utf8") };
  } catch {
    return null;
  }
}

/** A JPEG of the image with each box outlined and named. */
export async function drawBoxes(image: PreparedImage, boxes: { box: Box; label?: string }[]): Promise<Uint8Array> {
  const photon = await photonLib();
  let pixels: Uint8Array;
  let width: number;
  let height: number;
  if (image.decoded) ({ pixels, width, height } = image.decoded);
  else {
    const source = photon.PhotonImage.new_from_byteslice(image.bytes);
    pixels = source.get_raw_pixels();
    width = source.get_width();
    height = source.get_height();
    source.free();
  }
  const stroke = Math.max(2, Math.round(Math.max(width, height) / 320));
  const paint = (x0: number, y0: number, x1: number, y1: number, [r, g, b]: [number, number, number]) => {
    for (let y = Math.max(0, y0); y < Math.min(height, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(width, x1); x++) {
        const i = (y * width + x) * 4;
        pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = 255;
      }
    }
  };
  const fontSize = Math.max(14, Math.round(Math.max(width, height) / 52));
  const tags: { text: string; x: number; y: number }[] = [];
  const taken: { x0: number; x1: number; y0: number; y1: number }[] = [];
  boxes.forEach(({ box, label }, index) => {
    const color = PALETTE[index % PALETTE.length];
    const x0 = Math.round(box.left * width), x1 = Math.round(box.right * width);
    const y0 = Math.round(box.top * height), y1 = Math.round(box.bottom * height);
    paint(x0, y0, x1, y0 + stroke, color);
    paint(x0, y1 - stroke, x1, y1, color);
    paint(x0, y0, x0 + stroke, y1, color);
    paint(x1 - stroke, y0, x1, y1, color);
    if (label) {
      const text = label.slice(0, 40);
      const tagWidth = Math.min(width - x0, Math.round(text.length * fontSize * 0.56) + 10);
      const tagHeight = fontSize + 6;
      let tagTop = y0 - tagHeight >= 0 ? y0 - tagHeight : y0;
      // Step a name down until it sits clear of the ones already placed.
      for (let tries = 0; tries < 8 && taken.some((t) => x0 < t.x1 && x0 + tagWidth > t.x0 && tagTop < t.y1 && tagTop + tagHeight > t.y0); tries++) tagTop = Math.min(height - tagHeight, tagTop + tagHeight);
      taken.push({ x0, x1: x0 + tagWidth, y0: tagTop, y1: tagTop + tagHeight });
      paint(x0, tagTop, x0 + tagWidth, tagTop + tagHeight, color);
      tags.push({ text, x: x0 + 5, y: tagTop + 2 });
    }
  });
  const out = new photon.PhotonImage(pixels, width, height);
  try {
    // The color is handed over to the call, so each label gets its own.
    for (const tag of tags) photon.draw_text_with_color(out, tag.text, tag.x, tag.y, fontSize, new photon.Rgba(20, 20, 20, 255));
    return out.get_bytes_jpeg(86);
  } finally {
    out.free();
  }
}

/** The boxed picture behind a /b/ CDN path. */
export async function renderBoxed(source: string, box: Box, label: string) {
  const image = await prepareImage(await fetchImage(source));
  return drawBoxes(image, [{ box, label }]);
}
