-- Free map searches without an account, counted per hashed IP per day.
create table if not exists anon_usage (
  ip_hash text not null,
  day text not null,
  searches integer not null default 0,
  primary key (ip_hash, day)
);
