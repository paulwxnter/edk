create table if not exists signals_access_grants (
  user_id text primary key references "user"(id) on delete cascade,
  granted_at integer not null
);
