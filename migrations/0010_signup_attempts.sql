-- Sign-up attempts by IP, for the per-hour sign-up limit. Rows older than a day are pruned on insert.
create table if not exists signup_attempts (
  ip text not null,
  created_at integer not null -- ms
);
create index if not exists signup_attempts_ip_time on signup_attempts (ip, created_at);
