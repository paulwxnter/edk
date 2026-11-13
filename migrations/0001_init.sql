-- Better Auth core tables (column names follow Better Auth's defaults).
create table if not exists "user" (
  "id" text primary key,
  "name" text not null,
  "email" text not null unique,
  "emailVerified" integer not null default 0,
  "image" text,
  "createdAt" date not null,
  "updatedAt" date not null
);

create table if not exists "session" (
  "id" text primary key,
  "expiresAt" date not null,
  "token" text not null unique,
  "createdAt" date not null,
  "updatedAt" date not null,
  "ipAddress" text,
  "userAgent" text,
  "userId" text not null references "user" ("id") on delete cascade
);
create index if not exists session_user_idx on "session" ("userId");

create table if not exists "account" (
  "id" text primary key,
  "accountId" text not null,
  "providerId" text not null,
  "userId" text not null references "user" ("id") on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" date,
  "refreshTokenExpiresAt" date,
  "scope" text,
  "password" text,
  "createdAt" date not null,
  "updatedAt" date not null
);
create index if not exists account_user_idx on "account" ("userId");

create table if not exists "verification" (
  "id" text primary key,
  "identifier" text not null,
  "value" text not null,
  "expiresAt" date not null,
  "createdAt" date not null,
  "updatedAt" date not null
);
create index if not exists verification_identifier_idx on "verification" ("identifier");

-- API keys. Only a SHA-256 hash of each key is stored; `prefix` is shown in the console.
-- kind: 'secret' (server use) or 'publishable' (embeds; limited to allowed_origins).
create table if not exists api_keys (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  name text not null,
  kind text not null default 'secret',
  prefix text not null,
  hash text not null unique,
  allowed_origins text,
  created_at integer not null,
  last_used_at integer,
  revoked_at integer
);
create index if not exists api_keys_user_idx on api_keys (user_id);

-- Balance in units: 1 unit = one result or one image returned; 5 units = 1 CU.
create table if not exists balances (
  user_id text primary key references "user" ("id") on delete cascade,
  units integer not null default 0,
  updated_at integer not null
);

create table if not exists usage_events (
  id text primary key,
  user_id text not null,
  key_id text,
  source text not null,
  endpoint text not null,
  results integer not null default 0,
  images integer not null default 0,
  units integer not null default 0,
  query text,
  result_id text,
  created_at integer not null
);
create index if not exists usage_user_time_idx on usage_events (user_id, created_at);

-- Credit purchases through Stripe Checkout; id is the Checkout Session id, so a payment is credited once.
create table if not exists credit_purchases (
  id text primary key,
  user_id text not null,
  amount_cents integer not null,
  units integer not null,
  status text not null,
  created_at integer not null,
  credited_at integer
);
create index if not exists purchases_user_idx on credit_purchases (user_id, created_at);

create table if not exists user_settings (
  user_id text primary key references "user" ("id") on delete cascade,
  max_results integer,
  monthly_cu_cap integer,
  stripe_customer_id text,
  updated_at integer not null
);

-- Stored search results, for GET /v1/search/:id and embed.edk.earth/r/:id.
create table if not exists results (
  id text primary key,
  user_id text,
  query text not null,
  payload text not null,
  created_at integer not null
);
create index if not exists results_user_idx on results (user_id, created_at);
