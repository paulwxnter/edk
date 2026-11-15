# How the example queries were built

This document covers how the 800 rows in `example_queries` (source `ledger`) were produced, how each was checked, and why 594 are active.

```
ledger (≈493M rows, 528 GB)
  │  1. extract     artifact × region pairs with strong photo matches   → 168,718 pairs
  │  2. classify    keep concrete, visual artifacts; drop brands/abstract → 105,269 pairs
  │  3. references  which regions have schools, parks, permits, 311…   → presence map
  │  4. generate    pick, combine, phrase, score                        → 800 queries (inactive)
  │  5. validate    run each one live against api.edk.earth             → 594 pass, 206 fail
  ▼  6. load        D1 example_queries, local and production
```

## 1. Extract strong pairs from the ledger

**Source:** `public.ledger` in Postgres. Each row describes one artifact (`feature_id`) in one region (`region_id`, `region_type`), and the scene job adds photo-match statistics. The column definitions come from `ov-back-2/docs/scene-ledger-measurements.md`.

| Column | Meaning |
| --- | --- |
| `eq_top` | Mean of the **15 lowest** `scenes.distance` values for the artifact in the region. Lower means closer matches. **100 is a placeholder** for fewer than 15 photos, not a real score. |
| `eq_all` | Mean of all finite distances. |
| `eq_median` | 50th percentile distance, the typical match. |
| `eq_p90` | 90th percentile distance, the weaker end. |
| `eq_valid_count` | How many photos had a distance. |

**Threshold:** `eq_top ≤ 0.46` and `eq_valid_count ≥ 15`. The bands come from `ov-back-2/migrations/316_query_suggestions.sql`, which counts **excellent as ≤ 0.42** and **good as ≤ 0.46**.

**Why it goes artifact by artifact:** the ledger has no index on the `eq_*` columns, so filtering on `eq_top` directly scans the whole table. That ran over ten minutes before I cancelled it. Instead, `extract-ledger.mjs` takes the 3,687 artifacts the scene job finished (`artifact_scene_ledger_work`, run `53b4df0b…`, status `complete`) and reads their rows through `ledger_feature_region_idx`, 40 artifacts per batch, 6 batches at a time.

**Join notes:** `artifacts.feature_id` is text and `ledger.feature_id` is bigint, so the join casts. The `regions` table supplies the name, state code, country code and coordinates.

**Result:** 168,718 pairs across 1,952 artifacts and 8,886 regions.

| Region type | Pairs | Excellent (≤ 0.42) |
| --- | ---: | ---: |
| city | 51,918 | 8,586 |
| state / province | 34,137 | 7,939 |
| county | 65,584 | 11,092 |
| country | 17,079 | 4,764 |

## 2. Classify artifacts by theme

`artifacts` has no usable type or taxon field for these rows: `artifact_type` and `taxon_id` are empty. So `generate.mjs` assigns themes from the artifact's name, and **only themed artifacts are used**. That one rule removes most store brands (Circle K, Days Inn, CVS) and abstract scene terms ("Neighborhood Character", "Waterfront Chill", "Smart City Systems").

| Theme | Matched on (examples) |
| --- | --- |
| animals | a word list of animal names (junco, egret, coyote, manatee, bear…) plus herd, colony, flock |
| damage | damaged, cracked, leaning, downed, fallen, pothole, erosion, sinkhole, debris, tarp, flood, boarded, vacant, graffiti, overgrown… |
| construction | construction, crane, scaffold, demolition, installation in progress… |
| infrastructure | bridge, power line, utility, transformer, hydrant, storm drain, crosswalk, bike lane, solar, wind turbine… |
| buildings | roof, storefront, facade, porch, pool, fence, window… |
| plants | flower, tree, grove, blossom, fern, moss, cactus, wildflower… |
| landscape | trail, beach, cliff, canyon, desert, waterfall, coast, forest, boardwalk… |

**Excluded as activities or abstractions:** names ending in biking, skiing, camping, crossing (except school crossing), perch and failure, plus generic single nouns like Road, Car, Sky and Tree.

**Result:** 105,269 themed pairs.

## 3. Resolve references

The "near" and civic queries mention a second feature, so it has to exist in the region. `resolve-references.mjs` sums `ledger.total_count` for each reference feature in each region, using the same index.

| Reference | feature_id | Regions with records |
| --- | --- | ---: |
| School | 113 | 6,077 |
| Playground | 183 | 5,658 |
| Library | 18716 | 5,439 |
| Park | 251 | 3,878 |
| Train Station | 227454 | 2,180 |
| Hospital | 107 | 1,751 |
| Marina | 333 | 1,532 |
| Beach | 236932 | 871 |
| Street Repair (311) | 8559 | 71 |
| Demolition Permit | 8546 | 66 |
| Roofing Permit | 8548 | 64 |
| Vandalism (crime) | 8522 | 60 |
| Solar Permit | 8549 | 49 |
| New Building Permit | 225688 | 48 |
| Code Violation (311) | 8570 | 32 |

Each reference also has a **meaning rule**, so it only pairs with subjects that make sense next to it:

- **Demolition permits:** boarded, vacant, abandoned, collapsed or fire-damaged buildings
- **Street repairs:** potholes and cracked asphalt
- **Schools:** damaged crosswalks and broken traffic signals

An earlier version paired references by theme alone and produced queries like "speed hump signs near solar permits", which is why the meaning rules exist.

## 4. Generate queries

### Selection

1. **Ordering:** regions are sorted **city → state/province → country**. Within each type, regions with more strong artifacts come first, which stands in for how much imagery covers the place.
2. **Quotas per type:** city 520, state 230, country 50. Counties got 0; see "What was left out".
3. **Templates per city, in order:** single, multi, near, civic, single, multi. A city gets at most 5 queries, a state 4, a country 3.
4. **Variety limits:**
   - An artifact can be the subject of at most 5 queries.
   - Themes take turns, weighted toward damage, infrastructure, construction and animals, so the list isn't mostly trails and forests. Those score well but show less.
5. **Multi-artifact queries** combine 2 or 3 artifacts that share a theme in the same region. Near-duplicates like "Fern Forests" and "Fern-Filled Forest" are skipped.

### Phrasing (`phrase.mjs`)

Seeded templates, so the same inputs always produce the same text:

| Template | Examples |
| --- | --- |
| single, street-level | "Map every damaged storm drain in Houston, TX" · "Which neighborhoods in Sacramento, CA have road cracks?" |
| single, wildlife | "Where have nuthatches been seen across California?" · "Recent sightings of cockatoos around Sydney" |
| multi | "Where do construction sites and new building permits overlap in Los Angeles, CA?" · "Manatees and ospreys in Florida" |
| near | "Map the vacant buildings closest to schools in Detroit, MI" · "Fallen trees near parks in Madison, WI" |
| civic | "Vacant buildings near recent demolition permits in Chicago, IL" · "Cracked asphalt near recent street repairs in New Orleans, LA" |

Text rules:

- **Plurals:** "damaged roofs" and "juncos". Names already plural stay as they are ("bluebells"). Mass nouns never get an "s": graffiti, debris, erosion, scrub.
- **Cleanup:** scientific names in parentheses are removed, along with "Scene", "Sighting" and "Brand" suffixes.
- **Regions:** US cities are always "City, ST". Canadian cities get the province code only when the name is shared. Other cities get the country name only when the name is shared. Countries get "the" where needed ("the United States").

### Scores saved on each row

| Column | Value |
| --- | --- |
| `scores` | JSON array with one entry per artifact: `eq_top`, `eq_median`, `eq_p90` and photo count, with role `subject`. References get role `reference` and a record count. |
| `eq_top` | The **weakest** subject's `eq_top`, so a multi query is only as strong as its worst artifact. |
| `eq_top_mean` | The mean `eq_top` across subjects. |
| `quality_tier` | `excellent` (≤ 0.42) or `good` (≤ 0.46), based on `eq_top`. |
| `region_*`, `artifact_ids`, `feature_ids`, `artifact_names` | What the query was built from. |
| `template`, `category`, `highlight` | The kind of query, its theme, and a one-line reason it should work. |

Every generated row is inserted with `active = 0`.

## 5. Validate live

A strong ledger score does not guarantee that the search engine returns the result. An early spot check showed the problem:

- **Empty:** "Map every damaged storm drain in Houston" came back with nothing, although Houston has 15+ strong matches in the ledger.
- **Wrong place:** "Fallen trees near parks in Madison" landed in Texas and Australia.

So `validate.mjs` runs every query against `https://api.edk.earth/v1/discover` (limit 10, 20 at a time) and records the outcome.

A query **passes** when all of these hold:

1. It returns HTTP 200 with **3 or more results**.
2. It's in the **right place**: the region the engine resolved matches the region in the query, or at least 2 of the top 5 results have that place in their address or district.
3. The answer doesn't say the results are somewhere else ("not seeing", "can't place", "elsewhere") unless 3+ results are local.
4. For **multi** queries, at least **two** of the named artifacts appear among the results.

Passing rows are set to `active = 1`. Every row stores `check_status`, `check_reason`, `check_results`, `check_region`, `check_subjects`, `check_result_id` (opens at `embed.edk.earth/r/<id>`) and `checked_at`.

### Results

**594 pass, 206 fail.**

| Kind | Checked | Pass |
| --- | ---: | ---: |
| city · single | 211 | 175 |
| city · multi | 197 | 106 |
| city · near | 99 | 71 |
| city · civic | 13 | 12 |
| state · single | 153 | 140 |
| state · multi | 77 | 47 |
| country · single | 33 | 32 |
| country · multi | 17 | 11 |

| Failure reason | Count | Example |
| --- | ---: | --- |
| one_subject | 87 | "Road cracks and cracked sidewalks in Woodstock, VT": only one of the two artifacts came back |
| wrong_region | 52 | "Flooding damage near hospitals in Moscow, Russia": resolved to all of Russia |
| empty | 50 | "Flooded roads within 300 meters of a hospital in Columbus, OH" |
| error | 12 | timeouts |
| few | 5 | "Where have maple trees been seen around Akron, OH?": 1 result |

By theme: construction passed 28 of 30, buildings 62/66, damage 108/131, plants 126/172, animals 109/159, infrastructure 87/123, landscape 74/119.

### Photo spot check

The validator can't see the images. I opened the first photos of six passing queries:

| Query | Photo |
| --- | --- |
| Map the vacant buildings closest to schools in Detroit, MI | ✅ Sealed building with blocked windows and barriers |
| Vacant buildings near recent demolition permits in Chicago, IL | ✅ Empty brick building with a "For Rent" sign |
| Road cracks near schools in Sacramento, CA | ✅ Long crack across the lane, boxed |
| Map the fallen trees closest to parks in Indianapolis, IN | ✅ Downed trunk across the brush |
| Damaged fences near recent code violations in Dallas, TX | ✅ Missing fence section with trash behind it |
| Map the flooding damage in Houston, TX | ⚠️ Dry road, no box, displayed upside down |

**Takeaway:** passing the check means the right kind of results came back in the right place. It doesn't prove every photo shows the thing named. Demo queries should still be looked at by eye.

## 6. Load

1. **Migrations:** `0007` created `example_queries`, `0008` added the region, artifact and score columns, and `0009` added the check columns.
2. **Data:** `generate.mjs` writes `example-queries.sql`. It deletes earlier `source = 'ledger'` rows and inserts all rows inactive. `validate.mjs` writes `example-queries-checks.sql`, which flips the passing rows on and stores every outcome.
3. **Applied:** to local and production D1. Production now holds 20 curated rows, 594 active ledger rows and 206 inactive ledger rows.

## What was left out, and known issues

- **Counties:** "Harris County, TX" doesn't resolve to a region, so results came from anywhere. County queries return when the engine supports county scoping.
- **Condition words aren't enforced.** "Leaning utility pole" photos showed upright poles, yet the reasoning check still drew boxes. The check seems to confirm "a pole is here", not "it's leaning". The same may apply to damaged, boarded and similar words.
- **Some unboxed photos display upside down.** The camera's rotation flag appears to be ignored when no box is drawn (seen on the Houston flooding photo).
- **Cached empties:** EDK caches results, including empty ones from overloaded runs. To re-test a failed query, change its wording slightly.
- **The 20 curated rows weren't regenerated.** Several of them failed earlier tests (Chicago water main breaks, Starbucks vs. Dunkin', humpbacks in Monterey Bay).

## Cost

Validation ran each query once at limit 10. With the earlier exploratory tests, this used about 800 CU of the account that ran it.

## Re-running

See `README.md` in this folder for the commands. A full run takes about 10 minutes for the extract, under a minute for references and generation, and about 10 minutes to validate 800 queries at a concurrency of 20.
