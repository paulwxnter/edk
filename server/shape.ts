// Public response shapes for EDK-1. The engine works with H3 cells and every attribute of an area;
// callers get only what answers their question: core fields per result, area facts only for the
// conditions the query used, and outlines as GeoJSON polygons (never cell ids).
import { cellToBoundary, cellsToMultiPolygon } from "h3-js";
import { legend, readAttribute } from "lib/locate/legend";

export const MODEL = "edk-1";

const CORE = ["name", "address", "feature_name", "description", "date", "neighborhood", "district", "image_url"] as const;

type Fact = { key: string; title: string; value: string; detail?: string };
const publicFact = (fact: { title: string; value?: string | null; detail?: string | null }) => ({
  title: fact.title, detail: fact.detail || fact.value || null,
});

const present = (v: unknown) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && !v.length);

function polygonOfCell(cell: unknown) {
  try {
    return typeof cell === "string" && cell ? { type: "Polygon" as const, coordinates: [cellToBoundary(cell, true)] } : null;
  } catch {
    return null;
  }
}

async function factReader() {
  const guide = await legend().catch(() => null);
  return (key: string, raw: unknown): Fact | null => {
    if (!present(raw)) return null;
    const reading = guide ? readAttribute(guide, key, raw) : null;
    if (reading) return { key, title: reading.title, value: reading.value, ...(reading.detail ? { detail: reading.detail } : {}) };
    return { key, title: key.replace(/_/g, " "), value: String(raw) };
  };
}

/** The Discover payload: answer, lean results, the region searched and the conditions applied. */
export async function shapeDiscover(raw: any) {
  const applied: any[] = raw?.filters?.applied ?? [];
  const filterKeys: string[] = applied.map((a) => String(a.key));
  const fact = filterKeys.length ? await factReader() : () => null;
  const rawFeatures: any[] = raw?.geojson?.features ?? [];
  const features = rawFeatures.map((f, i) => {
    const p = f?.properties ?? {};
    const isArea = p.kind === "area";
    // Area ids are built from their cell ("h3:…"); give them a plain one instead.
    const rawId = f?.id === undefined ? undefined : String(f.id);
    const id = isArea || (rawId && /h3|^8[0-9a-f]{14}$/i.test(rawId)) ? `area-${i + 1}` : rawId;
    const props: Record<string, unknown> = { kind: isArea ? "area" : "location" };
    for (const key of CORE) if (present(p[key])) props[key] = p[key];
    if (typeof props.date === "string" && /^\d{4}-\d{2}-\d{2}/.test(props.date)) props.date = props.date.slice(0, 10);
    if (isArea) {
      const outline = Array.isArray(p.spatialCells) && p.spatialCells.length > 1
        ? { type: "MultiPolygon" as const, coordinates: cellsToMultiPolygon(p.spatialCells, true) }
        : polygonOfCell(p.h3);
      if (outline) props.outline = outline;
    }
    if (p.box && typeof p.box === "object") {
      props.box = p.box;
      if (typeof p.boxed_image_url === "string") props.boxed_image_url = p.boxed_image_url;
    }
    if (typeof p.spatialDistance === "number" && Number.isFinite(p.spatialDistance)) props.distance = p.spatialDistance;
    if (typeof p.spatialInsight === "string") props.insight = p.spatialInsight;
    const facts = [...(Array.isArray(p.spatialFacts) ? p.spatialFacts as Fact[] : []), ...filterKeys.map((k) => fact(k, p[k])).filter(Boolean)];
    if (facts.length) props.facts = facts.filter((entry): entry is Fact => entry !== null).map(publicFact);
    return { type: "Feature" as const, ...(id !== undefined ? { id } : {}), geometry: f.geometry, properties: props };
  });
  const region = raw?.region ? { id: String(raw.region.id), name: raw.region.name, type: raw.region.type ?? raw.region.region_type ?? null, context: raw.region.context ?? null } : null;
  const areas = (raw?.areas ?? []).map((a: any) => {
    let outline: unknown = null;
    try {
      outline = { type: "MultiPolygon", coordinates: cellsToMultiPolygon(a.cells ?? [], true) };
    } catch {
      /* no outline */
    }
    return { index: a.index, center: a.center, ...(a.label ? { label: a.label } : {}), ...(outline ? { outline } : {}) };
  });
  return {
    query: raw?.query,
    ...(raw?.answer ? { answer: raw.answer } : {}),
    geojson: { type: "FeatureCollection" as const, features },
    ...(region ? { region } : {}),
    ...(Array.isArray(raw?.tags) && raw.tags.length ? { tags: raw.tags.map(String) as string[] } : {}),
    ...(areas.length ? { areas } : {}),
    ...(raw?.geocoded?.length ? { places: raw.geocoded.map((g: any) => ({ label: g.label, lat: g.lat, lng: g.lng })) } : {}),
    duration_ms: raw?.duration_ms,
  };
}

/** The Inspect payload: where the point is, highlights and every known fact, plus the area's outline. */
export function shapeInspect(raw: any) {
  const ring: [number, number][] = raw?.ring ?? [];
  return {
    known: Boolean(raw?.known),
    center: raw?.center,
    ...(ring.length ? { outline: { type: "Polygon" as const, coordinates: [[...ring, ring[0]]] } } : {}),
    place: raw?.place ?? [],
    highlights: (raw?.highlights ?? []).map(publicFact),
    categories: (raw?.categories ?? []).map((category: { name: string; items: Parameters<typeof publicFact>[0][] }) => ({
      name: category.name, items: category.items.map(publicFact),
    })),
  };
}

export type DiscoverData = Awaited<ReturnType<typeof shapeDiscover>>;

/** Bring previously stored results up to the current public response shape. */
export function publicStoredDiscover(data: DiscoverData & { conditions?: unknown }): DiscoverData {
  const { conditions: _conditions, ...rest } = data;
  return {
    ...rest,
    geojson: {
      ...data.geojson,
      features: data.geojson.features.map((feature) => {
        const { video_url: _video, ...properties } = feature.properties;
        if (Array.isArray(properties.facts)) properties.facts = properties.facts.map(publicFact);
        return { ...feature, properties };
      }),
    },
  };
}
