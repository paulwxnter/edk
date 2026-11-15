-- Embeds need a key and a list of allowed sites; each map load is billed and capped per day.
alter table api_keys add column daily_load_cap integer;

-- Shared result links (embed.edk.earth/r/:id): whether they open, and how many loads a day they may use.
create table if not exists share_settings (
  user_id text primary key,
  result_links integer not null default 1,
  result_link_daily_cap integer,
  updated_at integer not null
);
