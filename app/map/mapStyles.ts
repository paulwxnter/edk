import { layersWithPartialCustomTheme, type Theme } from "protomaps-themes-base";
import type { StyleSpecification } from "maplibre-gl";

export type MapStyleId = "outdoor" | "light" | "dark" | "satellite";

/** Our own Protomaps basemap: one planet-wide PMTiles archive read with HTTP range requests. */
/** Served through cdn.edk.earth (range requests, edge cached); locally through /_cdn on the dev server. */
export const basemapUrl = () =>
  typeof window !== "undefined" && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)
    ? `${window.location.origin}/_cdn/tiles/planet.pmtiles`
    : "https://cdn.edk.earth/tiles/planet.pmtiles";

const ASSETS = "https://protomaps.github.io/basemaps-assets";

/** Satellite imagery (and the featured photo in the menu) come from Mapbox. */
let MAPBOX_TOKEN = "";
/** The public Mapbox token (pk.) for satellite imagery, provided by the page. */
export const setMapboxToken = (token: string | null | undefined) => {
  MAPBOX_TOKEN = token || "";
};
export const hasSatellite = () => Boolean(MAPBOX_TOKEN);

// ---------------------------------------------------------------- typography
// Outerview's map type is Metropolis (geometric, wide, quiet). Glyphs are served through the
// "ovglyph" protocol registered in MapView, which falls back to Noto Sans for non-Latin scripts.
export const GLYPH_SERVER = "https://fonts.openmaptiles.org";
const FONT = { regular: "Metropolis Regular", medium: "Metropolis Medium", bold: "Metropolis Semi Bold", italic: "Metropolis Medium Italic", lightItalic: "Metropolis Light Italic" };

/** Which real font file serves a glyph range of one of our fonts. */
export function glyphFont(stack: string, rangeStart: number) {
  const latin = rangeStart < 768 || (rangeStart >= 7680 && rangeStart < 8448);
  if (latin) return stack;
  return /Italic/.test(stack) ? "Klokantech Noto Sans Italic" : /Bold/.test(stack) ? "Klokantech Noto Sans Bold" : "Klokantech Noto Sans Regular";
}

// ---------------------------------------------------------------- palettes

type Palette = Partial<Theme>;

/** Roads share one family of colors: bridges and tunnels follow the surface roads. */
function roads(p: { minor: string; minorCasing: string; major: string; majorCasing: string; highway: string; highwayCasing: string; other: string; tunnel: string; tunnelCasing: string }): Palette {
  return {
    other: p.other,
    minor_service: p.minor,
    minor_a: p.minor,
    minor_b: p.minor,
    link: p.major,
    major: p.major,
    highway: p.highway,
    minor_service_casing: p.minorCasing,
    minor_casing: p.minorCasing,
    link_casing: p.majorCasing,
    major_casing_early: p.majorCasing,
    major_casing_late: p.majorCasing,
    highway_casing_early: p.highwayCasing,
    highway_casing_late: p.highwayCasing,
    bridges_other: p.other,
    bridges_minor: p.minor,
    bridges_link: p.major,
    bridges_major: p.major,
    bridges_highway: p.highway,
    bridges_other_casing: p.minorCasing,
    bridges_minor_casing: p.minorCasing,
    bridges_link_casing: p.majorCasing,
    bridges_major_casing: p.majorCasing,
    bridges_highway_casing: p.highwayCasing,
    tunnel_other: p.tunnel,
    tunnel_minor: p.tunnel,
    tunnel_link: p.tunnel,
    tunnel_major: p.tunnel,
    tunnel_highway: p.tunnel,
    tunnel_other_casing: p.tunnelCasing,
    tunnel_minor_casing: p.tunnelCasing,
    tunnel_link_casing: p.tunnelCasing,
    tunnel_major_casing: p.tunnelCasing,
    tunnel_highway_casing: p.tunnelCasing,
  };
}

function labels(p: { ink: string; soft: string; faint: string; halo: string; water: string }): Palette {
  return {
    city_label: p.ink,
    city_label_halo: p.halo,
    subplace_label: p.soft,
    subplace_label_halo: p.halo,
    state_label: p.faint,
    state_label_halo: p.halo,
    country_label: p.soft,
    roads_label_major: p.soft,
    roads_label_major_halo: p.halo,
    roads_label_minor: p.faint,
    roads_label_minor_halo: p.halo,
    address_label: p.faint,
    address_label_halo: p.halo,
    peak_label: p.soft,
    ocean_label: p.water,
    waterway_label: p.water,
  };
}

// Outdoor — an old survey sheet: warm parchment land, sage woods, dusty teal water, ochre highways, sepia ink.
const OUTDOOR: Palette = {
  background: "#a8c3bd",
  water: "#a8c3bd",
  earth: "#eadfc6",
  park_a: "#cfd4a5",
  park_b: "#c2ca97",
  wood_a: "#c4cc9b",
  wood_b: "#b5bf8a",
  scrub_a: "#dad7ae",
  scrub_b: "#d0cfa2",
  glacier: "#f5f0e3",
  sand: "#e9d8ae",
  beach: "#eedcb1",
  zoo: "#ccd3a4",
  hospital: "#ecd3c0",
  school: "#e8dbb3",
  industrial: "#ddd0b3",
  military: "#d9cfb6",
  aerodrome: "#dfd4ba",
  runway: "#cbbf9e",
  pier: "#dccdaa",
  buildings: "#d9c9a4",
  pedestrian: "#e5d8b9",
  railway: "#9b8964",
  boundaries: "#8c6f48",
  ...roads({ minor: "#f8f0dd", minorCasing: "#cdb98f", major: "#f4e0ad", majorCasing: "#bfa368", highway: "#e3aa5b", highwayCasing: "#9c6b2c", other: "#d9c9a6", tunnel: "#e6dabd", tunnelCasing: "#cdbd98" }),
  ...labels({ ink: "#3f2d18", soft: "#6a5131", faint: "#8f7650", halo: "#f3e9d2", water: "#527d77" }),
  landcover: { barren: "#e3d4b1", farmland: "#e3dcb3", forest: "#bbc593", glacier: "#f5f0e3", grassland: "#d4d5a6", scrub: "#cfd0a0", urban_area: "#e3d6b8" },
};

// Light — porcelain: near-white land, pale slate water, hairline roads, black ink.
const LIGHT: Palette = {
  background: "#ccd9e1",
  water: "#ccd9e1",
  earth: "#f5f4f0",
  park_a: "#e2eadb",
  park_b: "#dae4d1",
  wood_a: "#dfe8d7",
  wood_b: "#d5e0cb",
  scrub_a: "#e8ecde",
  scrub_b: "#e3e8d8",
  glacier: "#fbfcfc",
  sand: "#efeadc",
  beach: "#f1ecdd",
  zoo: "#dfe8d7",
  hospital: "#f3e9e6",
  school: "#f0eee4",
  industrial: "#ebeae6",
  military: "#eae8e3",
  aerodrome: "#eceae6",
  runway: "#dddbd5",
  pier: "#e6e4de",
  buildings: "#e7e5df",
  pedestrian: "#eeece7",
  railway: "#b9b6ad",
  boundaries: "#8f8d86",
  ...roads({ minor: "#ffffff", minorCasing: "#dcdad3", major: "#ffffff", majorCasing: "#cbc8bf", highway: "#fdf6e3", highwayCasing: "#c9b98c", other: "#e9e7e1", tunnel: "#efede8", tunnelCasing: "#dedcd6" }),
  ...labels({ ink: "#161616", soft: "#4b4a46", faint: "#8a8882", halo: "#f8f7f3", water: "#7d95a4" }),
  landcover: { barren: "#efede5", farmland: "#eef0e4", forest: "#dce6d2", glacier: "#fbfcfc", grassland: "#e6ecdd", scrub: "#e4e9da", urban_area: "#eeede8" },
};

// Dark — obsidian: neutral black land, deeper water, graphite roads with bronze highways, soft white ink.
const DARK: Palette = {
  background: "#090a0b",
  water: "#090a0b",
  earth: "#19191b",
  park_a: "#162019",
  park_b: "#17231b",
  wood_a: "#151f18",
  wood_b: "#16221a",
  scrub_a: "#191d18",
  scrub_b: "#1a1e19",
  glacier: "#202224",
  sand: "#1e1d19",
  beach: "#201e1a",
  zoo: "#17221a",
  hospital: "#211b1b",
  school: "#1f1e1a",
  industrial: "#1c1c1d",
  military: "#1c1b1b",
  aerodrome: "#1d1d1f",
  runway: "#2a2a2c",
  pier: "#1f1f21",
  buildings: "#212123",
  pedestrian: "#1c1c1e",
  railway: "#34332f",
  boundaries: "#6b665c",
  ...roads({ minor: "#2a2a2d", minorCasing: "#121213", major: "#36363a", majorCasing: "#121213", highway: "#5a4b34", highwayCasing: "#141210", other: "#232325", tunnel: "#222224", tunnelCasing: "#151516" }),
  ...labels({ ink: "#eeeeee", soft: "#a8a8ac", faint: "#77777c", halo: "#0b0b0c", water: "#566462" }),
  landcover: { barren: "#1b1a18", farmland: "#191c18", forest: "#152018", glacier: "#202224", grassland: "#181d18", scrub: "#191d18", urban_area: "#1b1b1d" },
};

// Satellite — Mapbox imagery under our own labels and borders.
const OVERLAY: Palette = {
  ...DARK,
  boundaries: "#ffffff",
  ...labels({ ink: "#ffffff", soft: "#f0f0f0", faint: "#dcdcdc", halo: "rgba(0,0,0,0.75)", water: "#d5e6ee" }),
};

type Def = {
  label: string;
  base: "light" | "dark";
  theme: Palette;
  swatch: { land: string; water: string; green: string; road: string };
  /** Mapbox imagery under the labels. */
  imagery?: boolean;
};

const DEFS: Record<MapStyleId, Def> = {
  outdoor: { label: "Outdoor", base: "light", theme: OUTDOOR, swatch: { land: "#eadfc6", water: "#a8c3bd", green: "#b5bf8a", road: "#e3aa5b" } },
  light: { label: "Light", base: "light", theme: LIGHT, swatch: { land: "#f5f4f0", water: "#ccd9e1", green: "#d5e0cb", road: "#ffffff" } },
  dark: { label: "Dark", base: "dark", theme: DARK, swatch: { land: "#19191b", water: "#090a0b", green: "#17231b", road: "#5a4b34" } },
  satellite: { label: "Satellite", base: "dark", theme: OVERLAY, imagery: true, swatch: { land: "#4a5237", water: "#17313c", green: "#2f4a2a", road: "#e8e8e8" } },
};

export const MAP_STYLE_ORDER: MapStyleId[] = ["outdoor", "light", "dark", "satellite"];
export const DEFAULT_MAP_STYLE: MapStyleId = "outdoor";
export const MAP_STYLES = DEFS;

// ---------------------------------------------------------------- layers

type Layer = Record<string, any>;

/** Swaps the stock Noto Sans for our type, wherever a font is named (plain lists and expressions). */
function retype(value: unknown): unknown {
  if (typeof value === "string") {
    if (value === "Noto Sans Regular") return FONT.medium;
    if (value === "Noto Sans Medium") return FONT.bold;
    if (value === "Noto Sans Italic") return FONT.italic;
    return value;
  }
  return Array.isArray(value) ? value.map(retype) : value;
}

/** Our own cartographic voice on top of the Protomaps layer set. */
function brand(layers: Layer[], id: MapStyleId): Layer[] {
  const def = DEFS[id];
  return layers.map((layer) => {
    const l: Layer = { ...layer, layout: { ...(layer.layout || {}) }, paint: { ...(layer.paint || {}) } };
    if (l.type === "symbol") {
      if (l.layout["text-font"]) l.layout["text-font"] = retype(l.layout["text-font"]);
      l.paint["text-halo-width"] = def.imagery ? 1.6 : 1.3;
      l.paint["text-halo-blur"] = def.imagery ? 0.8 : 0.4;
    }
    switch (l.id) {
      case "places_country":
        l.layout["text-font"] = [FONT.bold];
        l.layout["text-transform"] = "uppercase";
        l.layout["text-letter-spacing"] = 0.22;
        l.layout["text-size"] = ["interpolate", ["linear"], ["zoom"], 2, 10, 5, 13, 8, 17];
        break;
      case "places_region":
        l.layout["text-font"] = [FONT.medium];
        l.layout["text-transform"] = "uppercase";
        l.layout["text-letter-spacing"] = 0.16;
        l.layout["text-size"] = ["interpolate", ["linear"], ["zoom"], 3, 8.5, 7, 11.5];
        break;
      case "places_locality":
        l.layout["text-letter-spacing"] = 0.01;
        break;
      case "places_subplace":
        l.layout["text-font"] = [FONT.medium];
        l.layout["text-transform"] = "uppercase";
        l.layout["text-letter-spacing"] = 0.12;
        l.layout["text-size"] = ["interpolate", ["linear"], ["zoom"], 11, 9, 16, 11.5];
        break;
      case "water_label_ocean":
      case "water_label_lakes":
      case "water_waterway_label":
        l.layout["text-font"] = [FONT.lightItalic];
        l.layout["text-letter-spacing"] = l.id === "water_label_ocean" ? 0.3 : 0.12;
        if (l.id === "water_label_ocean") l.layout["text-transform"] = "uppercase";
        break;
      case "roads_labels_minor":
      case "roads_labels_major":
        l.layout["text-font"] = [FONT.regular];
        l.layout["text-letter-spacing"] = 0.04;
        break;
      case "boundaries_country":
        l.paint["line-width"] = ["interpolate", ["linear"], ["zoom"], 2, 0.7, 6, 1.3, 10, 2];
        l.paint["line-dasharray"] = [1, 0];
        l.paint["line-opacity"] = def.imagery ? 0.75 : 0.85;
        break;
      case "boundaries":
        l.paint["line-width"] = ["interpolate", ["linear"], ["zoom"], 3, 0.4, 8, 0.9];
        l.paint["line-dasharray"] = [4, 2.5];
        l.paint["line-opacity"] = def.imagery ? 0.5 : 0.6;
        break;
      case "buildings":
        // Buildings read as a soft block pattern, with a hairline edge in the land's own family.
        l.paint["fill-opacity"] = id === "outdoor" ? 0.75 : 0.9;
        break;
      case "water_river":
      case "water_stream":
        l.paint["line-opacity"] = 0.9;
        break;
    }
    return l;
  });
}

/** Satellite keeps only what belongs on top of imagery: labels, borders and a ghost of the main roads. */
function overlayOnly(layers: Layer[]): Layer[] {
  const keepLines = new Set(["boundaries_country", "boundaries", "roads_major", "roads_highway", "roads_bridges_major", "roads_bridges_highway"]);
  return layers
    .filter((l) => l.type === "symbol" || keepLines.has(l.id))
    .map((l) => {
      if (!l.id.startsWith("roads_") || l.type !== "line") return l;
      return { ...l, paint: { ...l.paint, "line-color": "#ffffff", "line-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0, 11, 0.22, 16, 0.3] } };
    });
}

export function buildMapStyle(id: MapStyleId): StyleSpecification {
  const def = DEFS[id];
  const base = brand(layersWithPartialCustomTheme("protomaps", def.base, def.theme, "en") as Layer[], id);
  const protomaps = {
    type: "vector" as const,
    url: `pmtiles://${basemapUrl()}`,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Protomaps',
  };
  if (def.imagery) {
    return {
      version: 8,
      glyphs: "ovglyph://{fontstack}/{range}",
      sprite: `${ASSETS}/sprites/v4/dark`,
      sources: {
        protomaps,
        imagery: {
          type: "raster",
          tiles: [`https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=${MAPBOX_TOKEN}`],
          tileSize: 512,
          maxzoom: 21,
          attribution: '© <a href="https://www.mapbox.com/about/maps/">Mapbox</a> © Maxar',
        },
      },
      layers: [
        { id: "background", type: "background", paint: { "background-color": "#0b1418" } },
        { id: "imagery", type: "raster", source: "imagery", paint: { "raster-fade-duration": 250, "raster-saturation": -0.08, "raster-contrast": 0.06 } },
        ...overlayOnly(base),
      ] as StyleSpecification["layers"],
    };
  }
  return {
    version: 8,
    glyphs: "ovglyph://{fontstack}/{range}",
    sprite: `${ASSETS}/sprites/v4/${def.base}`,
    sources: { protomaps },
    layers: base as StyleSpecification["layers"],
  };
}
