# Example queries from the scene ledger

Builds `example_queries` rows (D1) from artifact × region pairs whose photo matches are strong, then keeps only the ones that work live.

Scores come from `ledger.eq_top`: the mean of the 15 closest photo matches (`scenes.distance`) for an artifact in a region. Lower is better: ≤ 0.42 excellent, ≤ 0.46 good, 100 means fewer than 15 photos.

```sh
mkdir -p .example-queries
node scripts/example-queries/extract-ledger.mjs .example-queries                       # ledger → pairs.json (≈ 10 min)
node scripts/example-queries/resolve-references.mjs .example-queries/pairs.json .example-queries   # which regions have schools, permits, 311…
node scripts/example-queries/generate.mjs .example-queries/pairs.json .example-queries  # → example-queries.sql / .json (all inactive)
EDK_KEY=edk_sk_... node scripts/example-queries/validate.mjs .example-queries 20       # live check → example-queries-checks.sql
npx wrangler d1 execute edk-db --remote --file .example-queries/example-queries.sql
npx wrangler d1 execute edk-db --remote --file .example-queries/example-queries-checks.sql
```

- `generate.mjs` mixes single, multi-artifact, near (an OSM reference such as schools or parks) and civic (permits, 311, crime) queries; cities first, then states and provinces, then countries. Counties are skipped until EDK-1 resolves them as regions.
- `phrase.mjs` turns artifact + region into a natural request.
- `validate.mjs` runs every query (≈ 1 CU each) and activates only those with 3+ results in the named region; for multi-artifact queries, at least two of the artifacts must appear. It cannot see the photos, so spot-check a few.
