-- Hand-checked demo prompts for EDK-1 (Neon). Every row was run live against /v1/discover and reviewed:
-- 10 results in the named place, the filter visible in each result's facts, and (for visual rows) a good first photo.
-- Loaded from demo_queries.md by scripts/example-queries/load-demo-prompts.mjs.
create table if not exists public.demo_prompts (
  id             bigserial primary key,
  prompt         text not null unique,
  category       text not null check (category in ('civic', 'permit', 'visual', 'animal')),
  sources        text[] not null,              -- what it combines: civic, permit, visual, osm, attribute
  operation      text not null check (operation in ('in_region', 'near', 'within')),
  osm_reference  text,                         -- the OSM place for near/within prompts (schools, train stations…)
  attributes     text[] not null default '{}', -- keys from engine/lib/locate/attributes/catalog.ts
  region_type    text,                         -- city | county | state | country, as EDK-1 resolved it
  region_name    text,
  c_id           bigint,                       -- country region id
  s_id           bigint,                       -- state region id
  p_id           bigint,                       -- county region id (a city's dominant county)
  r_id           bigint,                       -- city region id
  evidence       text,                         -- what came back when it was checked
  distance_min_m double precision,             -- near/within: closest result to the reference
  distance_max_m double precision,             -- near/within: farthest result
  result_id      text,                         -- stored result (GET /v1/discover/:id)
  embed_url      text,
  in_readme      boolean not null default false, -- shown in the MCP README
  active         boolean not null default true,
  tested_at      date not null,
  created_at     timestamptz not null default now()
);
create index if not exists demo_prompts_category_idx on public.demo_prompts (category) where active;
create index if not exists demo_prompts_region_idx on public.demo_prompts (c_id, s_id, r_id) where active;
