// Find attribute catalog: the place attributes stored on every street-level image (embed_sv → Turbopuffer)
// and on OSM / civic / species rows. This file is the ONLY source of attribute names that may reach a
// Turbopuffer filter or a SQL clause. Sources, releases and coverage come from ov-back-2/attributes.md.
//
// Each entry carries the words JEV reads:
//   ask      what the attribute measures (Gate 1 and Gate 2 instructions)
//   triggers phrases that imply a condition on it (helps Gate 1 decide true)
//   not      nearby attributes it must not be confused with (helps Gate 1 decide false)

export type Coverage = "global" | "us" | "conus";
export type AttrKind = "enum" | "tags" | "number" | "bool";
export type EnumValue = { value: string | number; label: string; hint?: string };
export type Band = { value: number; words: string };

export type AttributeDef = {
  key: string;
  label: string;
  group: string;
  kind: AttrKind;
  coverage: Coverage;
  source: string;
  ask: string;
  triggers: string;
  not?: string;
  // number
  unit?: string;
  unitFamily?: UnitFamily;
  range?: [number, number];
  presets?: number[];
  low?: Band;
  high?: Band;
  // enum / tags
  values?: EnumValue[];
  /** Values are exact strings stored in the column; `prefix` values match with a trailing wildcard. */
  match?: "exact" | "prefix";
  /** Allow live value lists from the namespace (merged with `values`). */
  dynamic?: boolean;
  /** Values used when the user asks for the attribute without naming a value ("in flood zones"). */
  whenUnspecified?: (string | number)[];
  // bool
  yes?: string;
  noValue?: string;
};

export type UnitFamily = "length_m" | "length_km" | "percent" | "usd" | "minutes" | "celsius" | "mm" | "speed_ms" | "count" | "plain";

export const GROUPS: Record<string, string> = {
  terrain: "Terrain and elevation",
  flood: "Flood hazard",
  water: "Water and coast",
  climate: "Climate",
  air: "Air quality",
  solar: "Solar resource",
  wind: "Wind resource",
  settlement: "Settlement and built environment",
  landuse: "Land use and land cover",
  agriculture: "Agriculture and cropland",
  soil: "Soil",
  people: "Population and demographics",
  jobs: "Jobs and economy",
  ecology: "Ecology",
  geology: "Geology",
  wildfire: "Wildfire hazard",
  pollution: "Pollution and regulated facilities",
  access: "Access and travel time",
  capture: "Image capture",
};

const num = (
  key: string,
  label: string,
  group: string,
  coverage: Coverage,
  source: string,
  unit: string,
  unitFamily: UnitFamily,
  range: [number, number],
  presets: number[],
  ask: string,
  triggers: string,
  extra: Partial<AttributeDef> = {}
): AttributeDef => ({ key, label, group, kind: "number", coverage, source, unit, unitFamily, range, presets, ask, triggers, ...extra });

const en = (key: string, label: string, group: string, coverage: Coverage, source: string, values: EnumValue[], ask: string, triggers: string, extra: Partial<AttributeDef> = {}): AttributeDef => ({
  key,
  label,
  group,
  kind: "enum",
  coverage,
  source,
  values,
  match: "exact",
  ask,
  triggers,
  ...extra,
});

const v = (value: string | number, label: string, hint?: string): EnumValue => ({ value, label, hint });

const PCT = [1, 5, 10, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 95];
const WIND = [2, 3, 4, 5, 6, 7, 8, 9, 10];

export const ATTRIBUTES: AttributeDef[] = [
  // ── Terrain (Copernicus DEM GLO-30)
  num("elevation_m", "Elevation", "terrain", "global", "Copernicus DEM GLO-30", "m", "length_m", [-450, 8850], [0, 2, 5, 10, 20, 50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000],
    "Height of the surface above sea level in metres (a surface model, so it includes buildings and tree canopy).",
    "altitude, above or below a height, 'high up', 'mountain', 'alpine', 'hilltop', 'low-lying', 'near sea level', 'at sea level', a stated height in m or ft",
    { low: { value: 10, words: "low-lying / near sea level" }, high: { value: 1000, words: "high elevation / mountains" }, not: "Slope or steepness is slope_deg / terrain_class. Building height is ghsl_built_height_avg_m." }),
  num("slope_deg", "Slope", "terrain", "global", "Copernicus DEM GLO-30 (Horn 3×3)", "°", "plain", [0, 90], [1, 2, 5, 10, 15, 20, 25, 30, 40],
    "Steepness of the ground at the image location in degrees.",
    "a stated slope in degrees or %, 'slope of more than', 'gradient'",
    { low: { value: 2, words: "flat / level" }, high: { value: 15, words: "steep" }, not: "Plain words like 'steep', 'hilly', 'flat' with no number are better answered by terrain_class." }),
  en("terrain_class", "Terrain", "terrain", "global", "Copernicus DEM GLO-30", [
    v("flat", "Flat", "slope under 2°, level ground"),
    v("gentle", "Gentle", "slope 2–5°, gently sloping"),
    v("moderate", "Moderate", "slope 5–15°, hilly"),
    v("steep", "Steep", "slope over 15°, steep hillsides"),
  ], "How steep the ground is, as a class: flat, gentle, moderate or steep.", "'flat', 'level', 'hilly', 'sloped', 'on a hill', 'hillside', 'steep', 'steep streets'"),
  en("aspect_dir", "Slope facing", "terrain", "global", "Copernicus DEM GLO-30", [
    v("N", "North-facing"), v("NE", "Northeast-facing"), v("E", "East-facing"), v("SE", "Southeast-facing"),
    v("S", "South-facing"), v("SW", "Southwest-facing"), v("W", "West-facing"), v("NW", "Northwest-facing"),
  ], "Compass direction the slope faces (null on flat ground).", "'south-facing slope', 'north-facing hillside', 'facing west'",
    { not: "A compass word used for location ('north Denver', 'the west side') is NOT slope facing." }),

  // ── Flood (WRI Aqueduct Floods)
  en("flood_zone", "Flood zone", "flood", "global", "WRI Aqueduct Floods V2 (modelled)", [
    v("10yr", "10-year flood zone", "inside a flood zone: floods in a 1-in-10-year event, high and frequent flood risk"),
    v("100yr", "100-year flood zone", "inside a flood zone: floods only in a 1-in-100-year event, lower but real flood risk"),
    v("none", "Outside flood zones", "not in any flood zone; only when the user asks for safe / outside / no flood risk"),
  ], "Modelled river or coastal flood hazard zone (return period), not observed floods.",
    "'flood zone', 'floodplain', 'flood-prone', 'at risk of flooding', 'flood risk', 'outside the flood zone', 'safe from floods'",
    { whenUnspecified: ["10yr", "100yr"], not: "'Flooded streets' describing what is in the image is a feature, not necessarily a flood-zone filter; only answer true when the query asks about flood risk of the place." }),
  en("flood_source", "Flood source", "flood", "global", "WRI Aqueduct Floods V2", [
    v("river", "River flooding"), v("coastal", "Coastal flooding / storm surge"), v("both", "River and coastal"),
  ], "Whether the modelled flood hazard comes from rivers, the coast or both.", "'riverine flooding', 'coastal flooding', 'storm surge', 'river flood risk'"),
  num("flood_river_100yr_m", "River flood depth (100-year)", "flood", "global", "WRI Aqueduct Floods V2", "m", "length_m", [0, 30], [0.1, 0.25, 0.5, 1, 2, 3, 5],
    "Modelled depth of a 1-in-100-year river flood at the location, in metres.", "a stated flood depth ('more than 1 m of flooding', 'deep flooding')", { high: { value: 1, words: "deep river flooding" } }),
  num("flood_coast_100yr_m", "Coastal flood depth (100-year)", "flood", "global", "WRI Aqueduct Floods V2 (no subsidence)", "m", "length_m", [0, 30], [0.1, 0.25, 0.5, 1, 2, 3, 5],
    "Modelled depth of a 1-in-100-year coastal flood / storm surge at the location, in metres.", "a stated surge or coastal flood depth", { high: { value: 1, words: "deep coastal flooding" } }),

  // ── Water (JRC Global Surface Water) and coast
  en("water_proximity", "Water proximity", "water", "global", "JRC Global Surface Water V1.5", [
    v("on_water", "On water", "the point is on a water surface"),
    v("waterfront", "Waterfront", "within 100 m of water: waterfront, lakeside, riverside, beachfront"),
    v("near_water", "Near water", "within 1 km of water"),
    v("no_water", "Away from water", "no surface water within 1 km"),
  ], "How close the location is to surface water (lakes, rivers, reservoirs, sea).",
    "'waterfront', 'lakeside', 'riverside', 'by the river', 'on the water', 'near a lake', 'beachfront', 'away from water', 'inland'",
    { whenUnspecified: ["on_water", "waterfront", "near_water"], not: "The ocean coastline distance in km is coast_distance_km." }),
  num("water_distance_m", "Distance to water", "water", "global", "JRC Global Surface Water V1.5", "m", "length_m", [0, 1000], [0, 25, 50, 100, 200, 250, 500, 750, 1000],
    "Distance to the nearest surface water within 1 km, in metres (null beyond 1 km).", "a stated distance to water ('within 200 m of a lake')"),
  en("water_type", "Water type", "water", "global", "JRC Global Surface Water V1.5", [
    v("permanent", "Permanent water", "water present at least 90% of the time"),
    v("seasonal", "Seasonal water", "water present only part of the year"),
  ], "Whether the nearby surface water is permanent or seasonal.", "'seasonal lake', 'seasonal river', 'permanent water', 'dry riverbed'"),
  en("water_transition", "Water change", "water", "global", "JRC Global Surface Water V1.5 (1984–2021)", [
    v("permanent", "Permanent water"), v("new_permanent", "New permanent water", "became permanent water"), v("lost_permanent", "Lost permanent water", "permanent water that dried up"),
    v("seasonal", "Seasonal water"), v("new_seasonal", "New seasonal water"), v("lost_seasonal", "Lost seasonal water"),
    v("seasonal_to_permanent", "Seasonal became permanent"), v("permanent_to_seasonal", "Permanent became seasonal"),
    v("ephemeral_permanent", "Ephemeral permanent"), v("ephemeral_seasonal", "Ephemeral seasonal"), v("not_water", "Never water"),
  ], "How surface water at the location changed between 1984 and 2021.", "'lost water', 'dried up', 'new reservoir', 'water appeared', 'shrinking lake'"),
  num("coast_distance_km", "Distance to coast", "water", "global", "NASA GSFC distance to coast", "km", "length_km", [0, 2600], [0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000],
    "Distance to the ocean coastline in kilometres.", "'coastal', 'by the sea', 'near the coast', 'oceanfront', 'inland', 'far from the ocean', a stated distance to the coast",
    { low: { value: 5, words: "coastal / near the sea" }, high: { value: 100, words: "far inland" } }),
  { key: "coast_is_offshore", label: "Offshore", group: "water", kind: "bool", coverage: "global", source: "NASA GSFC distance to coast", ask: "Whether the point lies offshore (over the sea).", triggers: "'offshore', 'at sea', 'over the ocean'", yes: "Offshore / over the sea", noValue: "On land" },

  // ── Climate (Köppen-Geiger, CHELSA)
  en("climate_group", "Climate zone", "climate", "global", "Köppen-Geiger V3 (1991–2020)", [
    v("tropical", "Tropical", "hot and wet all year"), v("arid", "Arid", "desert and steppe, dry"), v("temperate", "Temperate", "mild winters"),
    v("cold", "Cold / continental", "cold winters, snow"), v("polar", "Polar", "tundra and ice"),
  ], "Broad Köppen climate zone of the location (1991–2020 normal, not today's weather).",
    "'tropical', 'desert climate', 'dry climate', 'temperate', 'continental', 'cold climate', 'snowy winters', 'polar', 'tundra'",
    { not: "Today's weather or a season is not a climate zone. A precise Köppen code ('Csa', 'Mediterranean climate') is climate_symbol." }),
  en("climate_symbol", "Köppen climate", "climate", "global", "Köppen-Geiger V3 (1991–2020)", [
    v("Af", "Tropical rainforest"), v("Am", "Tropical monsoon"), v("Aw", "Tropical savanna"), v("BWh", "Hot desert"), v("BWk", "Cold desert"),
    v("BSh", "Hot semi-arid steppe"), v("BSk", "Cold semi-arid steppe"), v("Csa", "Hot-summer Mediterranean"), v("Csb", "Warm-summer Mediterranean"),
    v("Cwa", "Monsoon humid subtropical"), v("Cwb", "Subtropical highland"), v("Cfa", "Humid subtropical"), v("Cfb", "Oceanic"), v("Cfc", "Subpolar oceanic"),
    v("Dsa", "Hot-summer continental, dry summer"), v("Dsb", "Warm-summer continental, dry summer"), v("Dwa", "Monsoon hot-summer continental"),
    v("Dwb", "Monsoon warm-summer continental"), v("Dfa", "Hot-summer humid continental"), v("Dfb", "Warm-summer humid continental"),
    v("Dfc", "Subarctic"), v("Dfd", "Extremely cold subarctic"), v("ET", "Tundra"), v("EF", "Ice cap"),
  ], "Exact Köppen-Geiger climate class.", "'Mediterranean climate', 'oceanic climate', 'humid subtropical', 'monsoon climate', 'subarctic', 'savanna climate', a Köppen code like 'Csa' or 'BWh'"),
  num("chelsa_temp_mean_c", "Mean annual temperature", "climate", "global", "CHELSA V2.1 (1981–2010)", "°C", "celsius", [-40, 35], [-10, 0, 5, 10, 15, 20, 22, 25, 28],
    "Average yearly air temperature (1981–2010 normal), °C.", "'warm places', 'hot climate', 'cold places', a stated average temperature",
    { low: { value: 5, words: "cold" }, high: { value: 22, words: "hot / warm" } }),
  num("chelsa_temp_max_warmest_month_c", "Summer high temperature", "climate", "global", "CHELSA V2.1 (1981–2010)", "°C", "celsius", [-20, 50], [20, 25, 28, 30, 32, 35, 38, 40],
    "Average daily maximum in the warmest month, °C.", "'hot summers', 'scorching summers', 'mild summers', a stated summer temperature",
    { low: { value: 22, words: "mild / cool summers" }, high: { value: 32, words: "hot summers" } }),
  num("chelsa_temp_min_coldest_month_c", "Winter low temperature", "climate", "global", "CHELSA V2.1 (1981–2010)", "°C", "celsius", [-60, 30], [-30, -20, -10, -5, 0, 5, 10, 15],
    "Average daily minimum in the coldest month, °C.", "'freezing winters', 'harsh winters', 'mild winters', 'frost-free', a stated winter temperature",
    { low: { value: -10, words: "harsh / freezing winters" }, high: { value: 5, words: "mild / frost-free winters" } }),
  num("chelsa_precip_annual_mm", "Annual rainfall", "climate", "global", "CHELSA V2.1 (1981–2010)", "mm", "mm", [0, 12000], [100, 250, 500, 750, 1000, 1500, 2000, 3000],
    "Average yearly precipitation, mm.", "'rainy', 'wet', 'dry', 'arid', 'low rainfall', a stated rainfall",
    { low: { value: 300, words: "dry / low rainfall" }, high: { value: 1500, words: "wet / rainy" } }),

  // ── Air quality (WashU ACAG)
  num("acag_pm25_latest_ugm3", "PM2.5 air pollution", "air", "global", "WashU ACAG V6 satellite PM2.5 (2023)", "µg/m³", "plain", [0, 200], [5, 10, 15, 25, 35, 50, 75],
    "Annual average fine-particle (PM2.5) air pollution in 2023, µg/m³. WHO guideline is 5.",
    "'polluted air', 'smog', 'bad air quality', 'clean air', 'low pollution', 'air pollution', a stated PM2.5",
    { low: { value: 5, words: "clean air (WHO guideline)" }, high: { value: 15, words: "polluted air" } }),

  // ── Solar (Global Solar Atlas)
  num("gsa_ghi_kwh_m2_day", "Sunshine (solar irradiance)", "solar", "global", "Global Solar Atlas", "kWh/m²/day", "plain", [0, 8], [2, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5],
    "Long-term average daily global horizontal irradiance: how sunny the place is.", "'sunny', 'lots of sun', 'strong sunshine', 'cloudy places', 'good for solar'",
    { low: { value: 3, words: "cloudy / low sun" }, high: { value: 5.5, words: "very sunny" }, not: "Solar panel yield is gsa_pvout_kwh_kwp_day." }),
  num("gsa_pvout_kwh_kwp_day", "Solar panel yield", "solar", "global", "Global Solar Atlas", "kWh/kWp/day", "plain", [0, 7], [2.5, 3, 3.5, 4, 4.5, 5],
    "Average daily electricity a 1 kW solar panel system would produce.", "'solar potential', 'good for solar panels', 'solar farm site', 'PV output'",
    { low: { value: 3, words: "poor solar potential" }, high: { value: 4.5, words: "excellent solar potential" } }),

  // ── Wind (Global Wind Atlas)
  num("gwa_mean_wind_speed_10m_ms", "Wind speed (10 m)", "wind", "global", "Global Wind Atlas 4.0", "m/s", "speed_ms", [0, 25], WIND,
    "Mean wind speed 10 m above ground, m/s: how windy it is at street level.", "'windy', 'gusty', 'sheltered from wind', 'calm', a stated wind speed",
    { low: { value: 3, words: "calm / sheltered" }, high: { value: 6, words: "windy" }, not: "Wind farm or turbine potential refers to hub height: gwa_mean_wind_speed_100m_ms." }),
  num("gwa_mean_wind_speed_100m_ms", "Wind speed (100 m)", "wind", "global", "Global Wind Atlas 4.0", "m/s", "speed_ms", [0, 30], WIND,
    "Mean wind speed at 100 m (turbine hub height), m/s.", "'wind farm potential', 'good for wind turbines', 'wind energy'",
    { low: { value: 5, words: "poor wind resource" }, high: { value: 7.5, words: "strong wind resource" } }),
  num("gwa_mean_power_density_100m_w_m2", "Wind power density (100 m)", "wind", "global", "Global Wind Atlas 4.0", "W/m²", "plain", [0, 3000], [100, 200, 300, 400, 500, 750, 1000],
    "Mean wind power density at 100 m, W/m².", "a stated wind power density", { high: { value: 400, words: "high wind power" } }),

  // ── Settlement and built environment (GHSL)
  en("settlement_code", "Settlement type", "settlement", "global", "GHSL SMOD R2023A (2020, 1 km)", [
    v(30, "Urban centre", "dense city core, downtown"),
    v(23, "Dense urban cluster", "dense town"),
    v(22, "Semi-dense urban cluster", "smaller town"),
    v(21, "Suburban / peri-urban", "suburbs, outskirts"),
    v(13, "Rural cluster", "village"),
    v(12, "Low-density rural", "countryside"),
    v(11, "Very low-density rural", "remote, sparsely populated"),
    v(10, "Water", "on water"),
  ], "How urban or rural the location is (GHSL Degree of Urbanisation).",
    "'urban', 'downtown', 'city centre', 'suburban', 'suburbs', 'rural', 'countryside', 'village', 'remote', 'small town'",
    { not: "Land cover such as forest or farmland is nlcd/cropland, not settlement." }),
  num("ghsl_built_height_avg_m", "Building height", "settlement", "global", "GHSL BUILT-H (2018, 100 m)", "m", "length_m", [0, 200], [3, 5, 8, 10, 15, 20, 30, 50],
    "Average height of buildings in the surrounding 100 m cell, metres.", "'high-rise', 'tall buildings', 'skyscrapers', 'low-rise', 'single-storey'",
    { low: { value: 6, words: "low-rise" }, high: { value: 20, words: "high-rise / tall buildings" } }),
  num("ghsl_built_fraction", "Built-up share", "settlement", "global", "GHSL BUILT-S (2020, 100 m)", "fraction", "plain", [0, 1], [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8],
    "Share of the surrounding 100 m cell covered by buildings (0–1).", "'densely built', 'built-up', 'open land', 'few buildings', 'sparse buildings'",
    { low: { value: 0.05, words: "open / barely built" }, high: { value: 0.4, words: "densely built" } }),
  num("ghsl_pop_1km_2020", "Population density", "settlement", "global", "GHSL POP (2020, 1 km)", "people per km²", "count", [0, 200000], [10, 50, 100, 500, 1000, 2500, 5000, 10000, 20000],
    "Estimated residents in the surrounding 1 km² cell: population density.", "'densely populated', 'crowded', 'sparsely populated', 'empty', a stated people per km²",
    { low: { value: 50, words: "sparsely populated" }, high: { value: 5000, words: "densely populated" } }),

  // ── Land use (Overture) and land cover (NLCD)
  { key: "land_use_categories", label: "Land use", group: "landuse", kind: "tags", coverage: "global", source: "Overture Maps land use 2026-10-21",
    ask: "Mapped land use around the location.",
    triggers: "'in a park', 'near a cemetery', 'on a campus', 'residential area', 'industrial area', 'farmland', 'golf course', 'military land', 'construction site'",
    values: [
      v("park", "Park"), v("residential", "Residential"), v("developed", "Developed / commercial"), v("education", "School or campus"), v("medical", "Hospital or medical"),
      v("cemetery", "Cemetery"), v("construction", "Construction site"), v("agriculture", "Agricultural"), v("recreation", "Recreation"), v("pedestrian", "Pedestrian area"),
      v("protected", "Protected area"), v("managed", "Managed grounds"), v("horticulture", "Gardens / horticulture"), v("golf", "Golf course"), v("religious", "Religious site"),
      v("military", "Military"), v("transportation", "Transportation"), v("landfill", "Landfill"), v("resource_extraction", "Quarry / mining"), v("campground", "Campground"), v("entertainment", "Entertainment"),
    ], match: "exact", dynamic: true,
    not: "A land-use word that is itself the searched feature ('parks in Toronto') is the feature, not a filter. Only true when it qualifies another feature ('benches in parks')." },
  en("nlcd_land_cover_code", "Land cover", "landuse", "conus", "Annual NLCD 2024", [
    v(11, "Open water"), v(12, "Perennial ice / snow"), v(21, "Developed, open space", "parks, lawns, golf courses"), v(22, "Developed, low intensity", "single-family housing"),
    v(23, "Developed, medium intensity"), v(24, "Developed, high intensity", "dense commercial, apartments"), v(31, "Barren land", "rock, sand, clay"),
    v(41, "Deciduous forest"), v(42, "Evergreen forest"), v(43, "Mixed forest"), v(52, "Shrub / scrub"), v(71, "Grassland"), v(81, "Pasture / hay"), v(82, "Cultivated crops"),
    v(90, "Woody wetlands"), v(95, "Emergent herbaceous wetlands"),
  ], "Satellite land cover class at the location (US lower 48).", "'forested', 'in the woods', 'wetland', 'grassland', 'barren', 'shrubland', 'heavily developed', 'cropland'"),
  num("nlcd_tree_canopy_pct", "Tree canopy", "landuse", "conus", "USFS Tree Canopy Cover 2024", "%", "percent", [0, 100], PCT,
    "Percent of the ground covered by tree canopy (US lower 48).", "'leafy', 'tree-lined', 'shaded', 'lots of trees', 'no trees', 'treeless'",
    { low: { value: 5, words: "treeless" }, high: { value: 40, words: "leafy / heavy tree cover" } }),
  num("nlcd_impervious_pct", "Paved surface", "landuse", "conus", "Annual NLCD 2024 fractional impervious", "%", "percent", [0, 100], PCT,
    "Percent of the ground that is paved or roofed (US lower 48).", "'paved', 'concrete jungle', 'asphalt', 'impervious', 'green', 'unpaved'",
    { low: { value: 10, words: "mostly unpaved / green" }, high: { value: 60, words: "heavily paved" } }),

  // ── Agriculture (USDA CDL)
  en("cropland_proximity", "Near farmland", "agriculture", "us", "USDA Cropland Data Layer 2025", [
    v("on_cropland", "On farmland"), v("adjacent_cropland", "Next to farmland", "within 100 m"), v("near_cropland", "Near farmland", "within 1 km"), v("no_cropland", "No farmland nearby"),
  ], "How close the location is to agricultural land (crops, pasture, hay, orchards, fallow).", "'next to farms', 'near fields', 'farm country', 'agricultural area', 'surrounded by crops'", { whenUnspecified: ["on_cropland", "adjacent_cropland", "near_cropland"] }),
  en("cropland_code", "Crop", "agriculture", "us", "USDA Cropland Data Layer 2025", [
    v(1, "Corn"), v(2, "Cotton"), v(3, "Rice"), v(4, "Sorghum"), v(5, "Soybeans"), v(21, "Barley"), v(23, "Spring wheat"), v(24, "Winter wheat"), v(36, "Alfalfa"),
    v(37, "Other hay"), v(61, "Fallow"), v(62, "Pasture / grass"), v(66, "Cherries"), v(68, "Apples"), v(69, "Grapes / vineyards"), v(72, "Citrus"), v(75, "Almonds"),
    v(76, "Walnuts"), v(176, "Grassland / pasture"), v(204, "Pistachios"), v(212, "Oranges"),
    v(111, "Open water"), v(121, "Developed, open space"), v(122, "Developed, low intensity"), v(123, "Developed, medium intensity"), v(124, "Developed, high intensity"),
    v(131, "Barren"), v(141, "Deciduous forest"), v(142, "Evergreen forest"), v(143, "Mixed forest"), v(152, "Shrubland"), v(190, "Woody wetlands"), v(195, "Herbaceous wetlands"),
  ], "The crop or agricultural class growing at the location in 2025.", "a crop name: 'corn fields', 'vineyards', 'orchards', 'wheat', 'almond groves', 'soybeans', 'pasture'",
    { not: "Only when a crop is named; general 'farmland' is cropland_proximity." }),

  // ── Soil (SSURGO, US)
  en("soil_drainage_class", "Soil drainage", "soil", "us", "USDA SSURGO 2026-10", [
    v("Excessively drained", "Excessively drained"), v("Somewhat excessively drained", "Somewhat excessively drained"), v("Well drained", "Well drained"),
    v("Moderately well drained", "Moderately well drained"), v("Somewhat poorly drained", "Somewhat poorly drained"), v("Poorly drained", "Poorly drained"),
    v("Very poorly drained", "Very poorly drained"), v("Subaqueous", "Subaqueous"),
  ], "How quickly water drains from the soil (map-unit aggregate).", "'well-drained soil', 'poorly drained', 'waterlogged', 'soggy ground'"),
  en("soil_hydrologic_group", "Soil runoff group", "soil", "us", "USDA SSURGO 2026-10", [
    v("A", "A — high infiltration (sandy)"), v("B", "B — moderate infiltration"), v("C", "C — slow infiltration"), v("D", "D — very slow, high runoff (clay)"),
    v("A/D", "A/D"), v("B/D", "B/D"), v("C/D", "C/D"),
  ], "Soil hydrologic group: how much rain soaks in versus runs off.", "'high runoff', 'sandy soil', 'clay soil', 'hydrologic group'"),
  en("soil_farmland_class", "Farmland class", "soil", "us", "USDA SSURGO 2026-10", [
    v("All areas are prime farmland", "Prime farmland"), v("Prime farmland if irrigated", "Prime if irrigated"), v("Prime farmland if drained", "Prime if drained"),
    v("Farmland of statewide importance", "Statewide importance"), v("Farmland of local importance", "Local importance"), v("Farmland of unique importance", "Unique farmland"),
    v("Not prime farmland", "Not prime farmland"),
  ], "USDA farmland classification of the soil.", "'prime farmland', 'good agricultural soil', 'farmland of statewide importance'", { dynamic: true }),
  en("soil_flood_frequency", "Soil flooding frequency", "soil", "us", "USDA SSURGO 2026-10", [
    v("None", "Never floods"), v("Very rare", "Very rare"), v("Rare", "Rare"), v("Occasional", "Occasional"), v("Frequent", "Frequent"), v("Very frequent", "Very frequent"),
  ], "How often the soil map unit floods, from soil survey records.", "'frequently flooded soil', 'soil that never floods'", { not: "General flood risk of a place is flood_zone." }),
  num("soil_bedrock_depth_min_cm", "Depth to bedrock", "soil", "us", "USDA SSURGO 2026-10", "cm", "plain", [0, 300], [25, 50, 100, 150, 200],
    "Minimum depth to bedrock, cm.", "'shallow bedrock', 'deep soil', 'rocky ground'", { low: { value: 50, words: "shallow bedrock" }, high: { value: 150, words: "deep soil" } }),
  num("soil_water_table_depth_min_cm", "Water table depth", "soil", "us", "USDA SSURGO 2026-10", "cm", "plain", [0, 300], [0, 25, 50, 100, 150, 200],
    "Minimum annual depth to the water table, cm.", "'high water table', 'shallow groundwater', 'deep water table'", { low: { value: 50, words: "high / shallow water table" } }),

  // ── Population and demographics (ACS 5-year, block group)
  num("acs_median_household_income_usd", "Median household income", "people", "us", "US Census ACS 2020–2024 (block group)", "USD", "usd", [0, 260000], [25000, 40000, 50000, 60000, 75000, 100000, 125000, 150000, 200000],
    "Median household income of the surrounding census block group, US dollars.", "'wealthy', 'affluent', 'rich neighborhoods', 'low-income', 'poor areas', 'working class', a stated income",
    { low: { value: 40000, words: "low-income" }, high: { value: 125000, words: "wealthy / affluent" } }),
  num("acs_median_home_value_usd", "Median home value", "people", "us", "US Census ACS 2020–2024 (block group)", "USD", "usd", [0, 2100000], [100000, 200000, 300000, 500000, 750000, 1000000, 1500000],
    "Median owner-occupied home value in the block group, US dollars.", "'expensive homes', 'million-dollar homes', 'affordable housing', a stated home value",
    { low: { value: 200000, words: "affordable homes" }, high: { value: 1000000, words: "expensive homes" } }),
  num("acs_median_gross_rent_usd", "Median rent", "people", "us", "US Census ACS 2020–2024 (block group)", "USD/month", "usd", [0, 4000], [800, 1000, 1500, 2000, 2500, 3000, 3500],
    "Median monthly gross rent in the block group, US dollars.", "'high rent', 'cheap rent', 'affordable rent', a stated rent",
    { low: { value: 1000, words: "cheap rent" }, high: { value: 2500, words: "high rent" } }),
  num("acs_pct_below_poverty", "Poverty rate", "people", "us", "US Census ACS 2020–2024 (block group)", "%", "percent", [0, 100], [5, 10, 15, 20, 25, 30, 40],
    "Percent of residents below the poverty line in the block group.", "'high poverty', 'poor neighborhoods', 'deprived', a stated poverty rate",
    { low: { value: 5, words: "low poverty" }, high: { value: 25, words: "high poverty" } }),
  num("acs_pct_bachelors_or_higher", "College degree share", "people", "us", "US Census ACS 2020–2024 (block group)", "%", "percent", [0, 100], [10, 20, 30, 40, 50, 60, 70, 80],
    "Percent of adults 25+ with a bachelor's degree or higher.", "'highly educated', 'college-educated', a stated education share",
    { low: { value: 15, words: "few college graduates" }, high: { value: 60, words: "highly educated" } }),
  num("acs_pct_renter_occupied", "Renter share", "people", "us", "US Census ACS 2020–2024 (block group)", "%", "percent", [0, 100], [20, 30, 40, 50, 60, 70, 80],
    "Percent of homes that are renter-occupied.", "'mostly renters', 'renter-heavy', 'mostly homeowners', 'owner-occupied'",
    { low: { value: 25, words: "mostly homeowners" }, high: { value: 60, words: "mostly renters" } }),
  num("acs_median_age", "Median age", "people", "us", "US Census ACS 2020–2024 (block group)", "years", "plain", [0, 100], [25, 30, 35, 40, 45, 50, 55, 60, 65],
    "Median age of residents in the block group.", "'young neighborhoods', 'student areas', 'retirement communities', 'older residents', a stated median age",
    { low: { value: 30, words: "young population" }, high: { value: 55, words: "older population / retirees" } }),
  num("acs_pct_commute_transit", "Transit commuting", "people", "us", "US Census ACS 2020–2024 (block group)", "%", "percent", [0, 100], [5, 10, 20, 30, 40, 50],
    "Percent of workers who commute by public transit.", "'transit-oriented', 'people take the subway', 'transit commuters'", { high: { value: 30, words: "transit-heavy" } }),
  num("acs_pct_commute_walk_bike", "Walk/bike commuting", "people", "us", "US Census ACS 2020–2024 (block group)", "%", "percent", [0, 100], [5, 10, 20, 30, 40, 50],
    "Percent of workers who walk or cycle to work.", "'walkable', 'bike-friendly', 'people walk to work', 'cycling city'", { high: { value: 20, words: "walkable / bike-friendly" } }),
  num("acs_pct_work_from_home", "Work from home", "people", "us", "US Census ACS 2020–2024 (block group)", "%", "percent", [0, 100], [5, 10, 15, 20, 30, 40],
    "Percent of workers who work from home.", "'remote workers', 'work from home'", { high: { value: 20, words: "many remote workers" } }),
  num("acs_total_population", "Block group population", "people", "us", "US Census ACS 2020–2024 (block group)", "people", "count", [0, 50000], [500, 1000, 2000, 3000, 5000],
    "Number of residents in the census block group (not a density).", "a stated number of residents in the neighborhood", { not: "Population density is ghsl_pop_1km_2020." }),

  // ── Jobs (LEHD LODES, block group)
  num("lodes_bg_jobs_per_km2", "Job density", "jobs", "us", "LEHD LODES8 2024 (block group)", "jobs/km²", "count", [0, 500000], [100, 500, 1000, 5000, 10000, 25000, 50000],
    "Jobs located in the block group per km²: how much of an employment centre it is.", "'business district', 'office district', 'employment centre', 'commercial core', 'job hub', 'where people work'",
    { low: { value: 100, words: "few jobs / residential" }, high: { value: 10000, words: "business district / job hub" } }),
  en("lodes_bg_top_sector", "Main employment sector", "jobs", "us", "LEHD LODES8 2024 (block group)", [
    v("CNS01", "Agriculture, forestry, fishing"), v("CNS02", "Mining, oil and gas"), v("CNS03", "Utilities"), v("CNS04", "Construction"), v("CNS05", "Manufacturing"),
    v("CNS06", "Wholesale trade"), v("CNS07", "Retail trade"), v("CNS08", "Transportation and warehousing"), v("CNS09", "Information / media / tech"),
    v("CNS10", "Finance and insurance"), v("CNS11", "Real estate"), v("CNS12", "Professional, scientific, technical services"), v("CNS13", "Management of companies"),
    v("CNS14", "Administrative and waste services"), v("CNS15", "Education"), v("CNS16", "Health care"), v("CNS17", "Arts, entertainment, recreation"),
    v("CNS18", "Hotels and restaurants"), v("CNS19", "Other services"), v("CNS20", "Public administration / government"),
  ], "The industry with the most jobs in the surrounding block group.", "'manufacturing district', 'industrial area', 'financial district', 'hospital district', 'tourist area with hotels', 'government district', 'warehouse district'",
    { match: "prefix" }),

  // ── Ecology and geology
  en("resolve_biome_name", "Biome", "ecology", "global", "RESOLVE Ecoregions 2017", [
    v("Tropical & Subtropical Moist Broadleaf Forests", "Tropical rainforest"), v("Tropical & Subtropical Dry Broadleaf Forests", "Tropical dry forest"),
    v("Tropical & Subtropical Coniferous Forests", "Tropical conifer forest"), v("Temperate Broadleaf & Mixed Forests", "Temperate broadleaf forest"),
    v("Temperate Conifer Forests", "Temperate conifer forest"), v("Boreal Forests/Taiga", "Boreal forest / taiga"),
    v("Tropical & Subtropical Grasslands, Savannas & Shrublands", "Tropical savanna"), v("Temperate Grasslands, Savannas & Shrublands", "Temperate grassland / prairie"),
    v("Flooded Grasslands & Savannas", "Flooded grassland"), v("Montane Grasslands & Shrublands", "Montane grassland"), v("Tundra", "Tundra"),
    v("Mediterranean Forests, Woodlands & Scrub", "Mediterranean woodland"), v("Deserts & Xeric Shrublands", "Desert / xeric shrubland"), v("Mangroves", "Mangroves"),
  ], "The natural biome the location falls in.", "'rainforest', 'savanna', 'prairie', 'taiga', 'boreal', 'desert biome', 'mangrove', 'tundra', 'Mediterranean scrub'",
    { not: "If the user is searching for the vegetation itself as a feature ('mangroves in Florida'), it is the feature, not a filter." }),
  en("resolve_realm", "Biogeographic realm", "ecology", "global", "RESOLVE Ecoregions 2017", [
    v("Nearctic", "Nearctic (North America)"), v("Neotropic", "Neotropic (Latin America)"), v("Palearctic", "Palearctic (Europe, N. Asia, N. Africa)"),
    v("Afrotropic", "Afrotropic (sub-Saharan Africa)"), v("Indomalayan", "Indomalayan (South & SE Asia)"), v("Australasia", "Australasia"), v("Oceania", "Oceania"), v("Antarctica", "Antarctica"),
  ], "Biogeographic realm.", "'Neotropical', 'Palearctic', 'Afrotropical', named realms"),
  en("glim_lithology_name", "Bedrock type", "geology", "global", "GLiM 2012 (0.5°)", [
    v("su", "Unconsolidated sediments"), v("ss", "Siliciclastic sedimentary rock (sandstone, shale)"), v("sm", "Mixed sedimentary rock"), v("sc", "Carbonate rock (limestone)"),
    v("ev", "Evaporites"), v("py", "Pyroclastics"), v("mt", "Metamorphic rock"), v("pa", "Acid plutonic (granite)"), v("pi", "Intermediate plutonic"), v("pb", "Basic plutonic"),
    v("va", "Acid volcanic"), v("vi", "Intermediate volcanic"), v("vb", "Basic volcanic (basalt)"), v("ig", "Ice and glaciers"),
  ], "Dominant surface rock type (coarse 0.5° grid).", "'limestone', 'karst', 'granite', 'volcanic rock', 'basalt', 'sandstone', 'sedimentary'"),

  // ── Wildfire
  num("wildfire_fwi_rp10", "Fire weather (10-year)", "wildfire", "global", "CSIRO / World Bank Fire Weather Index", "FWI", "plain", [0, 150], [10, 20, 30, 40, 50, 60, 80],
    "Maximum Fire Weather Index expected once in 10 years: how dangerous fire weather gets.", "'fire weather', 'fire-prone climate', 'wildfire risk' outside the US",
    { low: { value: 15, words: "low fire danger" }, high: { value: 40, words: "extreme fire weather" }, not: "In the US lower 48 prefer whp_class for 'wildfire risk'." }),
  en("whp_class", "Wildfire hazard", "wildfire", "conus", "USFS Wildfire Hazard Potential 2023", [
    v(1, "Very low"), v(2, "Low"), v(3, "Moderate"), v(4, "High"), v(5, "Very high"), v(6, "Non-burnable"), v(7, "Water"),
  ], "USFS wildfire hazard potential class (US lower 48).", "'wildfire risk', 'fire-prone', 'high fire danger', 'wildland-urban interface', 'low wildfire risk'"),

  // ── Pollution and facilities (EPA)
  num("tri_facilities_within_5km", "Toxic release sites nearby", "pollution", "us", "EPA Toxics Release Inventory 2024", "sites within 5 km", "count", [0, 500], [0, 1, 2, 3, 5, 10, 20, 50],
    "Number of EPA Toxics Release Inventory facilities within 5 km.", "'near polluting factories', 'near chemical plants', 'industrial pollution', 'toxic sites', 'no polluters nearby'",
    { low: { value: 0, words: "no toxic release sites nearby" }, high: { value: 5, words: "many polluting facilities" } }),
  num("tri_releases_within_5km_lbs", "Toxic releases nearby", "pollution", "us", "EPA Toxics Release Inventory 2024", "lbs/year within 5 km", "count", [0, 1e9], [1000, 10000, 100000, 1000000, 10000000],
    "Total reported on-site toxic releases by facilities within 5 km, pounds per year.", "'heavy toxic emissions', 'chemical releases', a stated amount", { high: { value: 100000, words: "heavy toxic releases" } }),
  num("tri_nearest_distance_m", "Distance to nearest toxic release site", "pollution", "us", "EPA Toxics Release Inventory 2024", "m", "length_m", [0, 50000], [250, 500, 1000, 2000, 5000, 10000],
    "Distance to the nearest Toxics Release Inventory facility, metres.", "'within a mile of a chemical plant', 'next to a refinery', 'far from factories'",
    { low: { value: 1000, words: "next to a polluting facility" }, high: { value: 10000, words: "far from polluters" } }),
  num("frs_facilities_within_1km", "Regulated facilities nearby", "pollution", "us", "EPA Facility Registry Service", "facilities within 1 km", "count", [0, 5000], [0, 5, 10, 25, 50, 100, 500],
    "Number of EPA-regulated facilities (any permit) within 1 km.", "'lots of industrial sites', 'regulated facilities nearby'", { high: { value: 50, words: "many regulated facilities" } }),

  // ── Access (Malaria Atlas Project)
  num("travel_min_to_city", "Travel time to a city", "access", "global", "Malaria Atlas Project (2015)", "min", "minutes", [0, 3000], [10, 15, 30, 60, 90, 120, 180, 300, 600],
    "Travel time to the nearest city of 50,000+ people, minutes.", "'remote', 'isolated', 'hours from a city', 'within an hour of a city', 'off the grid', 'close to the city'",
    { low: { value: 30, words: "close to a city" }, high: { value: 180, words: "remote / isolated" } }),
  num("travel_min_to_healthcare_motorized", "Drive time to healthcare", "access", "global", "Malaria Atlas Project (2019)", "min", "minutes", [0, 3000], [5, 10, 15, 30, 60, 120],
    "Driving time to the nearest healthcare facility, minutes.", "'far from hospitals', 'healthcare deserts', 'near a hospital', a stated drive time to care",
    { low: { value: 10, words: "near healthcare" }, high: { value: 60, words: "far from healthcare" } }),
  num("travel_min_to_healthcare_walking", "Walk time to healthcare", "access", "global", "Malaria Atlas Project (2019)", "min", "minutes", [0, 10000], [10, 15, 30, 60, 120, 240],
    "Walking time to the nearest healthcare facility, minutes.", "'walking distance to a clinic', a stated walk time to care", { low: { value: 15, words: "walkable to healthcare" } }),

  // ── Capture
  { key: "is_pano", label: "360° panorama", group: "capture", kind: "bool", coverage: "global", source: "Capture metadata", ask: "Whether the image is a 360° panorama.", triggers: "'360', 'panorama', 'panoramic', 'spherical images'", yes: "Only 360° panoramas", noValue: "Only regular (non-panoramic) photos" },
  { key: "is_video", label: "Video", group: "capture", kind: "bool", coverage: "global", source: "Capture metadata", ask: "Whether the result is a video capture.", triggers: "'video', 'footage', 'clips'", yes: "Only video captures", noValue: "Only still images" },
  en("month", "Capture month", "capture", "global", "Capture metadata", [
    v("1", "January"), v("2", "February"), v("3", "March"), v("4", "April"), v("5", "May"), v("6", "June"),
    v("7", "July"), v("8", "August"), v("9", "September"), v("10", "October"), v("11", "November"), v("12", "December"),
  ], "Month of the year the image was captured.", "a named month ('in July'), a season ('in winter' = Dec, Jan, Feb in the north; 'in summer' = Jun, Jul, Aug)",
    { not: "A year is handled separately and is not a month." }),
];

export const ATTRIBUTE_BY_KEY: Record<string, AttributeDef> = Object.fromEntries(ATTRIBUTES.map((a) => [a.key, a]));
export const MAX_ATTRIBUTE_FILTERS = 10;
export const IDENT = /^[a-z][a-z0-9_]*$/;

export function valueLabel(def: AttributeDef, value: unknown) {
  const hit = def.values?.find((x) => String(x.value) === String(value));
  return hit ? hit.label : String(value);
}

export function formatNumber(def: AttributeDef, value: number) {
  if (def.unitFamily === "usd") return `$${value >= 1000 ? `${Math.round(value / 1000).toLocaleString()}k` : value}`;
  const n = Math.abs(value) >= 1000 ? value.toLocaleString() : String(+value.toFixed(2));
  return def.unit && !["fraction", "FWI"].includes(def.unit) ? `${n} ${def.unit}` : n;
}
