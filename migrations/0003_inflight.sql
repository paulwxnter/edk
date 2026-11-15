-- Requests running right now, for per-tier concurrency limits. Rows older than two minutes are stale.
create table if not exists inflight (
  id text primary key,
  user_id text not null,
  started_at integer not null
);
create index if not exists inflight_user_idx on inflight (user_id, started_at);
