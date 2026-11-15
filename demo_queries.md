# Demo queries

Example queries for EDK-1 that have been run live against `api.edk.earth/v1/discover` (limit 10) and checked by hand. Each one pairs a strong base subject from `query_suggestions` (Neon) with an attribute filter from `engine/lib/locate/attributes/catalog.ts`.

**What "checked" means**
- 10 results came back, in the place the query names.
- Every result carries a `facts` value that meets the filter (for example "Homes that are rented: 80.1%").
- For visual queries, the first photo shows the subject with a sensible box.

Tested 14 November 2026. Results are cached, so a link opens the same answer we checked.

## In the MCP README

| Query | Type | Filter | Evidence | Result |
|---|---|---|---|---|
| Streetlight issues in New Orleans where median household income is under $40k | civic | `acs_median_household_income_usd` | Records from Hollygrove and Broadmoor, 30 Oct – 1 Nov 2026 | [res_96914267](https://embed.edk.earth/r/res_96914267ccd44f26b074117c) |
| Vandalism in Chicago on blocks where most homes are rented | civic | `acs_pct_renter_occupied` | All 10 between 62.9% and 96.5% rented | [res_7d58e65b](https://embed.edk.earth/r/res_7d58e65b35394cbb93a6237c) |
| Cyclist accidents in Chicago where over 10% of people walk or bike to work | civic | `acs_pct_commute_walk_bike` | 17.2%–27.7% walk or bike; The Loop, River North | [res_73823c35](https://embed.edk.earth/r/res_73823c351d4f4b839229b24b) |
| Cracked asphalt in Sacramento inside flood zones | visual | `flood_zone` | First 3 photos: clearly cracked roads, boxed | [res_1e149513](https://embed.edk.earth/r/res_1e149513e9b04aad81640506) |
| Desert wildflower blooms in California where annual rainfall is under 200 mm | visual | `chelsa_precip_annual_mm` | 92–198 mm a year; Anza-Borrego; first photo is a full bloom | [res_4c8e2387](https://embed.edk.earth/r/res_4c8e238749724c478ae2e3e5) |
| Fern-filled forests in New Zealand where annual rainfall is over 2,000 mm | visual | `chelsa_precip_annual_mm` | 4,562–5,336 mm a year; West Coast, Milford Sound; first photo excellent | [res_edfaa185](https://embed.edk.earth/r/res_edfaa185fee64e8996b99075) |
| Bison herds in South Dakota more than an hour from a city | animal | `travel_min_to_city` | About 5 hours from a city; first 3 photos are excellent | [res_36dc31d2](https://embed.edk.earth/r/res_36dc31d205774099bfb8252f) |
| Accessory dwelling unit permits in Los Angeles where median home value is over $1M | permit | `acs_median_home_value_usd` | All on blocks worth $1.03M–$1.55M, filed 23–24 Oct 2026 | [res_c39043c3](https://embed.edk.earth/r/res_c39043c326114bfcb2485aaf) |
| New building permits in New York City inside flood zones | permit | `flood_zone` | All marked high or some flood risk, filed 29–30 Oct 2026 | [res_5e33b312](https://embed.edk.earth/r/res_5e33b3120784449b9dad9553) |

## Civic records

| Query | Filter | Evidence | Result |
|---|---|---|---|
| Flooding issues in New Orleans where soil drains poorly | `soil_drainage_class` | Soil "usually wet", soaks in slowly; Gentilly and Lake Oaks | [res_8620a83c](https://embed.edk.earth/r/res_8620a83c09af412f97acc1b1) |
| Rodent issues in Chicago where median rent is under $1,200 | `acs_median_gross_rent_usd` | Rents $965–$1,052 a month; Austin, New City, North Kenwood | [res_d8b89f4e](https://embed.edk.earth/r/res_d8b89f4e6a7b428db9c94dd1) |
| Tree planting requests in Pittsburgh where tree canopy is under 20% | `nlcd_tree_canopy_pct` | Tree cover 0% on the first results; Bloomfield, Friendship | [res_dabd21c7](https://embed.edk.earth/r/res_dabd21c7c1724e6bb4493004) |
| Mold complaints in New York City inside flood zones | `flood_zone` | High or some flood risk; Harlem, Gowanus, Sheepshead Bay | [res_6600809d](https://embed.edk.earth/r/res_6600809d751b4d55a609d600) |
| Sewer backups in Kansas City inside flood zones | `flood_zone` | Some flood risk; Quality Hill, Columbus Park | [res_adb972d9](https://embed.edk.earth/r/res_adb972d9645a42e3a1e87e2a) |
| Drainage issues in Charlotte inside flood zones | `flood_zone` | High or some flood risk; Coulwood, Shuffletown | [res_c47a4caf](https://embed.edk.earth/r/res_c47a4caf29164d15acd8d3b7) |
| Sidewalk repairs in Boston where median home value is over $800k | `acs_median_home_value_usd` | Home values $988k–$1.05M; Charlestown, South Boston | [res_534f985f](https://embed.edk.earth/r/res_534f985ffe6b4a368111bfde) |

## Permits

| Query | Filter | Evidence | Result |
|---|---|---|---|
| Generator permits in Los Angeles in high wildfire hazard areas | `whp_class` | All high wildfire hazard; Sunland, Studio City | [res_ccf23164](https://embed.edk.earth/r/res_ccf23164c1634461851df618) |
| Construction permits in Austin where median home value is over $600k | `acs_median_home_value_usd` | Home values $686k–$1.03M; Bryker Woods | [res_1f990042](https://embed.edk.earth/r/res_1f99004272e546838dfedb53) |
| Patio permits in Los Angeles where summer highs are over 32°C | `chelsa_temp_max_warmest_month_c` | Summer highs 32.4–32.5°C; Virgil Village, Los Feliz, Sun Valley | [res_d6840572](https://embed.edk.earth/r/res_d6840572b7bd43d2a15fee3c) |

## Visual

| Query | Filter | Evidence | Result |
|---|---|---|---|
| Graffiti in Cincinnati on blocks where most homes are rented | `acs_pct_renter_occupied` | 80.1%–85.8% rented; first photo: tagged wall beside a bike lane, boxed | [res_2ef63f49](https://embed.edk.earth/r/res_2ef63f49136c4e9dacd7bf4d) |
| Road surface deterioration in Vermont where winter lows drop below -15°C | `chelsa_temp_min_coldest_month_c` | Winter lows -15.2 to -15.3°C on US Route 5; first photo: road scan full of cracks and patches | [res_c8f73cbf](https://embed.edk.earth/r/res_c8f73cbf17674703bbb7aa29) |
| Joshua tree groves in California above 1,000 m | `elevation_m` | 1,164–1,319 m in Joshua Tree National Park; first photo excellent | [res_2986eaf9](https://embed.edk.earth/r/res_2986eaf92bc44616a319066d) |
| Saguaro groves in Tucson on south-facing slopes | `aspect_dir` | All south-facing; first photo: saguaros, boxed | [res_e665f4e1](https://embed.edk.earth/r/res_e665f4e19cac45d19f47bbd2) |
| Muddy trails in England where annual rainfall is over 1,000 mm | `chelsa_precip_annual_mm` | 1,129–1,666 mm a year; Lake District; first photo excellent | [res_7f084210](https://embed.edk.earth/r/res_7f08421078094a82b4458bb7) |
| Canal cycleways in Belgium inside flood zones | `flood_zone` | Some flood risk; around Ath; first photo: towpath along a canal | [res_57d94b82](https://embed.edk.earth/r/res_57d94b820cd1403289e7cb9d) |
| Graffiti in San Francisco on blocks where most homes are rented | `acs_pct_renter_occupied` | 76%–100% rented; first photo: long tagged wall | [res_1bba6589](https://embed.edk.earth/r/res_1bba65895d094110be3e557a) |
| Road surface deterioration in Montréal where winter lows drop below -10°C | `chelsa_temp_min_coldest_month_c` | -13.8 to -14.6°C; first photo: cracked, patched lane | [res_ae5a75ac](https://embed.edk.earth/r/res_ae5a75ac46854c51b5efd6a4) |
| Bike crossings in Mexico City above 2,000 m | `elevation_m` | 2,229–2,234 m; first photo: green bike crossing | [res_076e76e1](https://embed.edk.earth/r/res_076e76e1b019449f9fe01cd7) |
| Saguaro groves in Arizona where summer highs are over 38°C | `chelsa_temp_max_warmest_month_c` | 38.3–41.5°C; Marana, Buckeye | [res_f80f4387](https://embed.edk.earth/r/res_f80f43871e2d476a9efe229d) |
| Joshua tree groves in Nevada above 1,000 m | `elevation_m` | 1,176–1,269 m; Red Rock Canyon; first photo excellent | [res_388d9ded](https://embed.edk.earth/r/res_388d9dedaa7d4fa79079756f) |
| Muddy trails in Belgium inside flood zones | `flood_zone` | Some flood risk; Flemish Brabant; first photo excellent | [res_1873c0e4](https://embed.edk.earth/r/res_1873c0e4d08841aeaf3464bb) |
| Fern forests in Melbourne where annual rainfall is over 1,000 mm | `chelsa_precip_annual_mm` | 1,018–1,306 mm; Sherbrooke, Warburton; first photo excellent | [res_39de0043](https://embed.edk.earth/r/res_39de0043acb34da1892a3f75) |
| Autumn color drives in New Hampshire above 500 m | `elevation_m` | 508–568 m; first photo: full autumn colour | [res_fb1241d5](https://embed.edk.earth/r/res_fb1241d5c8eb4a18899a82b9) |
| Aspen groves in Colorado above 2,500 m | `elevation_m` | 2,901–2,965 m; Mountain Village | [res_07e2f3c4](https://embed.edk.earth/r/res_07e2f3c4bc524aba944ae6c2) |
| Aspen groves in Utah above 2,500 m | `elevation_m` | 2,503–2,855 m; Snowbird, La Sal Mountains | [res_4ee2e788](https://embed.edk.earth/r/res_4ee2e788fc87451fa571c7b1) |
| Snow-covered forests in British Columbia above 1,000 m | `elevation_m` | 1,025–1,063 m; Gold Bridge | [res_24fc9e80](https://embed.edk.earth/r/res_24fc9e80151a462ca52808b9) |
| Overgrown trails in Melbourne where annual rainfall is over 800 mm | `chelsa_precip_annual_mm` | 979–1,040 mm; Dandenong Ranges | [res_d57b23b6](https://embed.edk.earth/r/res_d57b23b6385f421da0a94612) |
| Bison herds in Wyoming above 2,000 m | `elevation_m` | 2,216–2,552 m; Yellowstone | [res_10b82936](https://embed.edk.earth/r/res_10b829362cf04ded89890b23) |
| Nuthatches in Massachusetts where tree canopy is over 60% | `nlcd_tree_canopy_pct` | 85%–92% canopy; Woburn | [res_da45a42a](https://embed.edk.earth/r/res_da45a42a1a934847a7d12324) |
| Manatees in Florida inside flood zones | `flood_zone` | All high flood risk; Marion County; first photo: manatee eating grass | [res_fd45e90e](https://embed.edk.earth/r/res_fd45e90efbb440159ef54522) |

## More civic records

| Query | Filter | Evidence | Result |
|---|---|---|---|
| Graffiti in Chicago on blocks where most homes are rented | `acs_pct_renter_occupied` | 62.4% rented; West Garfield Park, North Lawndale | [res_902ccc81](https://embed.edk.earth/r/res_902ccc81a1734e44a0dff197) |
| Rodent issues in New York City where median rent is under $1,500 | `acs_median_gross_rent_usd` | Rents $1,207–$1,247; Bed-Stuy, the Bronx | [res_c35ce3dd](https://embed.edk.earth/r/res_c35ce3ddc7c94006b5bab1af) |
| Heat complaints in New York City on blocks where most homes are rented | `acs_pct_renter_occupied` | 70%–83.8% rented; Flatbush, Ridgewood | [res_10b16ad0](https://embed.edk.earth/r/res_10b16ad0c9ed40fabcba50a8) |
| Plumbing complaints in Cincinnati where median home value is under $150k | `acs_median_home_value_usd` | Homes worth $65k–$125k; South Fairmount | [res_7c6011c9](https://embed.edk.earth/r/res_7c6011c9dd044caa94f08595) |
| Flooding issues in Austin inside flood zones | `flood_zone` | All high flood risk; Cat Mountain | [res_3401ba24](https://embed.edk.earth/r/res_3401ba24d0464017b39f74cf) |
| Sewer issues in Buffalo inside flood zones | `flood_zone` | High or some flood risk; South Buffalo | [res_297f3887](https://embed.edk.earth/r/res_297f388798d94bd99e55682a) |
| Tree planting requests in Chicago where tree canopy is under 10% | `nlcd_tree_canopy_pct` | 0% tree cover; Colonial Gardens | [res_164934c1](https://embed.edk.earth/r/res_164934c10a0f4e1b8f0e3d6b) |
| Illegal parking in San Francisco on blocks where most homes are rented | `acs_pct_renter_occupied` | 64%–81% rented; Western Addition, SoMa | [res_a592e4ae](https://embed.edk.earth/r/res_a592e4aea9be4a86b75474a8) |
| Noise complaints in New York City on blocks where most homes are rented | `acs_pct_renter_occupied` | 94%–100% rented; East Village, Tremont | [res_7bd93bc6](https://embed.edk.earth/r/res_7bd93bc648b84797bdd684e4) |
| Overgrown vegetation in Seattle where annual rainfall is over 900 mm | `chelsa_precip_annual_mm` | 1,038–1,100 mm; Leschi, South Park | [res_eeba8cce](https://embed.edk.earth/r/res_eeba8cce37894159906bc195) |
| Mold complaints in San Francisco on blocks where most homes are rented | `acs_pct_renter_occupied` | 74%–100% rented; Tenderloin, Mission | [res_5772ffbd](https://embed.edk.earth/r/res_5772ffbd7aa44eb7804821e5) |
| Thefts in Seattle where median home value is over $900k | `acs_median_home_value_usd` | Homes worth $941k–$1.4M; Roosevelt, Wallingford | [res_ea0d0e23](https://embed.edk.earth/r/res_ea0d0e2315934dfe99d68e83) |
| Burglaries in New York City where median home value is over $1M | `acs_median_home_value_usd` | Homes worth $1.24M–$1.93M; Manhattan, Brooklyn | [res_05235535](https://embed.edk.earth/r/res_0523553506c549f8a8110584) |
| Shoplifting in Chicago where median household income is over $100k | `acs_median_household_income_usd` | Incomes $109k–$134k; River North | [res_50af5455](https://embed.edk.earth/r/res_50af5455f6924c63a967c6c6) |
| Sewer backups in New York City inside flood zones | `flood_zone` | All high flood risk; Canarsie, Howard Beach | [res_af06eba3](https://embed.edk.earth/r/res_af06eba3c9e24dcc88c53c7e) |

## More permits

| Query | Filter | Evidence | Result |
|---|---|---|---|
| Accessory dwelling unit permits in Los Angeles in high wildfire hazard areas | `whp_class` | All high hazard; Beachwood Canyon, Beverly Glen | [res_3f2aaba8](https://embed.edk.earth/r/res_3f2aaba80b364d2185ff3f1b) |
| Fire suppression permits in Los Angeles in high wildfire hazard areas | `whp_class` | All high hazard; Bel Air | [res_9b727e1f](https://embed.edk.earth/r/res_9b727e1fb968450ea210f044) |
| Retaining wall permits in Los Angeles in high wildfire hazard areas | `whp_class` | All high hazard; Riviera, Bel Air | [res_55ffab04](https://embed.edk.earth/r/res_55ffab0400f848ba98fb44ad) |
| Scaffold permits in New York City on blocks where most homes are rented | `acs_pct_renter_occupied` | 70%–100% rented; Gowanus, Yorkville | [res_a8cc9c06](https://embed.edk.earth/r/res_a8cc9c0633724394b22bf5b6) |
| Electric vehicle charger permits in Austin where median home value is over $600k | `acs_median_home_value_usd` | Homes worth $614k–$1.1M; Allandale | [res_b63e3746](https://embed.edk.earth/r/res_b63e3746c8fe4f1b99c48a1b) |
| Construction permits in Philadelphia on blocks where most homes are rented | `acs_pct_renter_occupied` | 71%–100% rented; Rittenhouse, Kensington | [res_3b740e24](https://embed.edk.earth/r/res_3b740e24f45440beb5d55f65) |
| Tenant improvement permits in New York City inside flood zones | `flood_zone` | High or some flood risk; Mill Basin, Gowanus | [res_cf3551b9](https://embed.edk.earth/r/res_cf3551b9347346ff94203ba0) |
| Patio permits in Austin where summer highs are over 35°C | `chelsa_temp_max_warmest_month_c` | 35–35.1°C; East Cesar Chavez | [res_ea066461](https://embed.edk.earth/r/res_ea06646173914e898412e4cd) |
| Gas permits in Philadelphia where median home value is under $200k | `acs_median_home_value_usd` | Homes worth $112k–$158k; North Philadelphia | [res_b69fae58](https://embed.edk.earth/r/res_b69fae58fec7448b9d2d42d9) |
| New building permits in Vancouver inside flood zones | `flood_zone` | All high flood risk; Marpole, Dunbar | [res_c4f59ac8](https://embed.edk.earth/r/res_c4f59ac8ec12436eb647623a) |

## Near: OSM places

Each result carries a `distance` (metres) to the nearest OSM reference; the ranges below cover all 10 results. Two use OSM land use instead (park, education).

**OSM, visual and attribute**

| Query | Near | Filter | Evidence | Result |
|---|---|---|---|---|
| Vacant buildings near schools in Detroit where median home value is under $100k | 29–187 m | `acs_median_home_value_usd` | Homes worth $76k–$92k; first photo: sealed building | [res_a24fa6ca](https://embed.edk.earth/r/res_a24fa6ca061747beae50bda7) |
| Bike crossings near train stations in Mexico City above 2,000 m | 82–251 m | `elevation_m` | 2,230–2,233 m; first photo: bike crossing | [res_60676b80](https://embed.edk.earth/r/res_60676b8002b8487e9aa8b4ec) |
| Mallards near parks in London inside flood zones | park land use | `flood_zone` | High or some flood risk; first photo excellent | [res_c6903b96](https://embed.edk.earth/r/res_c6903b969e0d4de8a6d6d16b) |
| Fallen trees near parks in Indianapolis where tree canopy is over 40% | park land use | `nlcd_tree_canopy_pct` | 79%–86% canopy; first photo: fallen log by a trail | [res_ceac0d11](https://embed.edk.earth/r/res_ceac0d11461e48fab8dddc63) |
| Graffiti near train stations in Chicago on blocks where most homes are rented | 94–736 m | `acs_pct_renter_occupied` | 62%–91.5% rented; first photo: tagged walls | [res_6070b02e](https://embed.edk.earth/r/res_6070b02e9bab42be9a0652b1) |
| Flooding issues near schools in New Orleans inside flood zones | 22–52 m | `flood_zone` | High or some flood risk; civic records | [res_f1d05849](https://embed.edk.earth/r/res_f1d058492a38403fb193d0b2) |

**OSM and visual**

| Query | Near | Evidence | Result |
|---|---|---|---|
| Cracked asphalt near schools in Sacramento | 38–132 m | First photo: cracked road, boxed | [res_0c998577](https://embed.edk.earth/r/res_0c998577f118438e84f2d826) |
| Boarded-up buildings near schools in Baltimore | 58–409 m | First photo excellent: boarded rowhouse | [res_2e7c24c0](https://embed.edk.earth/r/res_2e7c24c09c174e29bdaf0958) |
| Sandpipers near beaches in San Diego | by the water, 1–2 km from the sea | Ocean Beach, Mission Beach; first photo excellent | [res_d80867eb](https://embed.edk.earth/r/res_d80867eb426a489cb3de75ff) |

**OSM and civic records**

| Query | Near | Result |
|---|---|---|
| Cyclist accidents within 200 m of train stations in Chicago | 9–15 m | [res_f87248cc](https://embed.edk.earth/r/res_f87248cceb124610a85a6ec9) |
| Shoplifting near supermarkets in Chicago | 14–26 m | [res_87ab6de4](https://embed.edk.earth/r/res_87ab6de4a887448cba14a3d9) |
| Robberies near train stations in Chicago | 4–17 m | [res_775ea6c9](https://embed.edk.earth/r/res_775ea6c9d36b46bca91beed8) |
| Snow removal issues near hospitals in Buffalo | 134–200 m | [res_bda428e5](https://embed.edk.earth/r/res_bda428e5c0234e85b6d5e401) |
| Rear-end accidents near schools in Austin | 64–165 m | [res_a518b019](https://embed.edk.earth/r/res_a518b019e3e349c484f1ca4a) |
| Noise complaints near universities in New York City | on campus land (land use: education) | [res_99a01766](https://embed.edk.earth/r/res_99a01766600e4709bfa72d44) |

**OSM and permits**

| Query | Near | Result |
|---|---|---|
| Patio permits near restaurants in Philadelphia | 4–62 m | [res_c59f02a6](https://embed.edk.earth/r/res_c59f02a674044130b0b3d6c7) |
| Demolition permits near schools in Chicago | 2–77 m | [res_21cda09c](https://embed.edk.earth/r/res_21cda09ca4f243118124afea) |
| Scaffold permits near schools in New York City | 28–73 m | [res_22a3acd6](https://embed.edk.earth/r/res_22a3acd67f2e4257b5d5c49f) |
| Electric vehicle charger permits near supermarkets in Austin | 5–128 m | [res_e92dcce2](https://embed.edk.earth/r/res_e92dcce252be4f9cbab38445) |
| Generator permits near hospitals in Los Angeles | 24–356 m | [res_bfb0aad3](https://embed.edk.earth/r/res_bfb0aad3fc6f4986b3680011) |
| New building permits near train stations in Los Angeles | 122–274 m | [res_9dac1efa](https://embed.edk.earth/r/res_9dac1efa44b0400597b943fe) |
