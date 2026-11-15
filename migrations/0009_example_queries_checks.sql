-- The last live run of each example query: did EDK-1 return enough results in the right place.
-- Generated queries start inactive until a check passes, so a strong ledger score alone never ships one.
alter table example_queries add column check_status text;        -- pass | fail
alter table example_queries add column check_reason text;        -- why it failed: empty, few, wrong_region, error
alter table example_queries add column check_results integer;    -- results returned
alter table example_queries add column check_region text;        -- region EDK-1 resolved the query to
alter table example_queries add column check_subjects integer;   -- distinct subject artifacts among the results
alter table example_queries add column check_result_id text;     -- result id; opens at embed.edk.earth/r/<id>
alter table example_queries add column checked_at integer;       -- ms
