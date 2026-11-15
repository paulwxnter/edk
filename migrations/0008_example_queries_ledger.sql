-- Example queries generated from the scene ledger: each row names the region and artifacts it was built
-- from and keeps their scene match scores, so a demo can pick strong queries and explain why they work.
-- Scores are ledger distances: eq_top is the mean of the 15 closest photo matches for an artifact in a
-- region (lower is better; <= 0.42 excellent, <= 0.46 good).
alter table example_queries add column region_id text;
alter table example_queries add column region_type text;      -- city | state | county | country
alter table example_queries add column region_name text;
alter table example_queries add column country_code text;
alter table example_queries add column state_code text;
alter table example_queries add column artifact_ids text;     -- JSON array of artifact ids (uuid)
alter table example_queries add column feature_ids text;      -- JSON array of ledger feature ids
alter table example_queries add column artifact_names text;   -- JSON array, same order as artifact_ids
-- JSON array, one entry per artifact: {"artifact","feature_id","eq_top","eq_median","eq_p90","photos","role"}
-- role is "subject" for what the query finds, "reference" for what it is measured against.
alter table example_queries add column scores text;
alter table example_queries add column eq_top real;           -- combined: the weakest (highest) subject eq_top
alter table example_queries add column eq_top_mean real;      -- mean eq_top across subjects
alter table example_queries add column quality_tier text;     -- excellent | good
alter table example_queries add column template text;         -- single | multi | near | civic | curated
alter table example_queries add column source text not null default 'curated'; -- curated | ledger

create index if not exists example_queries_region on example_queries (region_type, region_id);
create index if not exists example_queries_quality on example_queries (active, eq_top);
