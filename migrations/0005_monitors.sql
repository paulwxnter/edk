-- Monitor (the Stream primitive): an area watched for new events of chosen artifacts, on an interval.
create table if not exists monitors (
  id text primary key,
  user_id text not null,
  key_id text,
  name text not null,
  -- Kept for later: not used to filter events yet.
  prompt text,
  -- JSON: [{id, name, kind, engine: "sql" | "turbopuffer", source_table}]
  artifacts text not null,
  region_id text not null,
  region_type text not null,
  region_name text not null,
  center_lng real,
  center_lat real,
  interval_minutes integer not null,
  -- Events after this time (ms) are reported.
  since integer not null,
  -- JSON: {artifact_id: {at: iso, key}}, the newest event seen per artifact.
  cursor text,
  webhook_url text,
  webhook_secret text not null,
  -- active | paused | deleted
  status text not null default 'active',
  status_reason text,
  last_run_at integer,
  next_run_at integer not null,
  events_count integer not null default 0,
  created_at integer not null,
  updated_at integer not null
);
create index if not exists monitors_user_idx on monitors (user_id, created_at);
create index if not exists monitors_due_idx on monitors (status, next_run_at);

create table if not exists monitor_events (
  id text primary key,
  monitor_id text not null,
  user_id text not null,
  artifact_id text not null,
  artifact_name text,
  -- Where the event came from (table:id, or tpuf:id): one event per source row per monitor.
  source_key text not null,
  occurred_at text,
  lat real,
  lng real,
  title text,
  address text,
  image_url text,
  payload text,
  created_at integer not null,
  delivered_at integer,
  delivery_status text,
  attempts integer not null default 0
);
create unique index if not exists monitor_events_key on monitor_events (monitor_id, source_key);
create index if not exists monitor_events_monitor_idx on monitor_events (monitor_id, created_at);
create index if not exists monitor_events_user_idx on monitor_events (user_id, created_at);
