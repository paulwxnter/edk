// Line icons for the Atlas: tools, panel controls, and one per Inspect category.

export function Icon({ d, size = 16 }: { d: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}

export const ICONS = {
  close: "M6 6l12 12M18 6 6 18",
  back: "M15 6l-6 6 6 6",
  chevron: "m6 9 6 6 6-6",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  info: "M12 11v6M12 7.5h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  search: "M21 21l-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  send: "M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z",
  compass: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM15.5 8.5l-2 5-5 2 2-5 5-2Z",
  layers: "m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5",
  lens: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM14.3 8l5.7 9.9M9.7 8h11.4M7.4 12l5.7-9.9M9.7 16 4 6.1M14.3 16H2.9M16.6 12l-5.7 9.9",
  hand: "M9 11V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5a1.5 1.5 0 0 1 3 0V11m0-.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-4.6-2.1L4 15.8a1.5 1.5 0 0 1 2.3-2L9 16",
  inspect: "M10 10h4M6.5 7 8 4h2v13a3.5 3.5 0 1 1-7 0c0-3 2-6.5 3.5-10ZM17.5 7 16 4h-2v13a3.5 3.5 0 1 0 7 0c0-3-2-6.5-3.5-10Z",
  route: "M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM8 17h6.5a3.5 3.5 0 0 0 0-7h-5a3.5 3.5 0 0 1 0-7H16",
  bookmark: "M6 4h12v17l-6-4-6 4V4Z",
  hexagon: "M12 2.5 20.2 7v10L12 21.5 3.8 17V7L12 2.5Z",
  shield: "M12 3 4.5 6v5.5c0 4.5 3 8 7.5 9.5 4.5-1.5 7.5-5 7.5-9.5V6L12 3ZM9 12l2 2 4-4",
  include: "M12 8v8M8 12h8M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  avoid: "M5.6 5.6l12.8 12.8M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  target: "M12 2v4M12 18v4M2 12h4M18 12h4M12 12h.01M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z",
} as const;

type Tone = "ochre" | "moss" | "sky" | "clay" | "paper";

/** Each category's icon and the color family it belongs to: people, built, land, water, air and energy. */
const CATEGORIES: Record<string, [Tone, string]> = {
  Demographics: ["ochre", "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"],
  Population: ["ochre", "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"],
  Employment: ["ochre", "M4 7h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1ZM9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18"],
  Settlement: ["paper", "M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6"],
  "Built environment": ["paper", "M5 21V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v17M15 9h3a1 1 0 0 1 1 1v11M3 21h18M9 7h2M9 11h2M9 15h2"],
  "Land use": ["paper", "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2ZM9 4v14M15 6v14"],
  Accessibility: ["paper", "M5 17h14M6 17l1.5-6h9L18 17M7 17v2M17 17v2M8.5 11 10 7h4l1.5 4"],
  "Industrial facilities": ["clay", "M3 21V10l6 4v-4l6 4V5h4v16H3Z"],
  "Land cover": ["moss", "M12 22v-6M12 16c-3.5 0-6-2.5-6-6a6 6 0 0 1 12 0c0 3.5-2.5 6-6 6Z"],
  Terrain: ["moss", "m3 20 6-12 4 7 2-3 6 8H3Z"],
  Ecology: ["moss", "M5 19c0-9 5-14 15-14 0 10-5 15-14 15M5 19c3-5 6-8 10-10"],
  Geology: ["moss", "M6 4h12l4 6-10 11L2 10l4-6ZM2 10h20"],
  Soil: ["moss", "M3 8h18M3 13h18M3 18h18M7 8v5M14 13v5M17 3v5"],
  Agriculture: ["moss", "M12 21V10M12 10c0-3 2-5 5-5 0 3-2 5-5 5ZM12 14c0-3-2-5-5-5 0 3 2 5 5 5Z"],
  "Flood hazard": ["sky", "M2 8c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 14c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 20c2-2 4-2 6 0s4 2 6 0 4-2 6 0"],
  "Surface water": ["sky", "M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.500 6-11 6-11Z"],
  Coast: ["sky", "M12 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM12 8v13M5 13a7 7 0 0 0 14 0M8 12h8"],
  "Air quality": ["sky", "M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h8a2.5 2.5 0 1 1-2.5 2.5"],
  "Wildfire hazard": ["clay", "M12 22c4 0 7-3 7-7 0-3-2-5-3-7-1 2-2 3-3 3 0-3-1-6-4-9 0 4-4 6-4 12 0 5 3 8 7 8Z"],
  Climate: ["clay", "M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0Z"],
  "Climate normals": ["clay", "M12 3v2M5.600 5.600 7 7M3 12h2M17 7l1.4-1.4M16 12a4 4 0 0 0-7.500-2M8 20h9a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.600 1.500A3 3 0 0 0 8 20Z"],
  "Solar energy": ["ochre", "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 2v2M12 20v2M4.900 4.900l1.400 1.400M17.700 17.700l1.400 1.400M2 12h2M20 12h2M4.900 19.100l1.400-1.400M17.700 6.300l1.400-1.400"],
  "Wind energy": ["sky", "M12 12v10M12 12 9 3M12 12l8 4M12 12l-8 4M10 22h4"],
};
const FALLBACK: [Tone, string] = ["paper", "M3 12V4h8l10 10-8 8L3 12ZM7.500 8h.01"];

export const categoryTone = (name: string): Tone => (CATEGORIES[name] ?? FALLBACK)[0];
export function CategoryIcon({ name }: { name: string }) {
  return <Icon d={(CATEGORIES[name] ?? FALLBACK)[1]} size={17} />;
}
