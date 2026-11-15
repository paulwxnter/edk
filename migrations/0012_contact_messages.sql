-- Messages sent from edk.earth/contact by signed-in people, read and answered from Oracle.
create table if not exists contact_messages (
  id text primary key,
  user_id text not null references "user"(id) on delete cascade,
  topic text not null,
  subject text not null,
  body text not null,
  page text,
  status text not null default 'new',
  created_at integer not null,
  updated_at integer not null
);

create index if not exists contact_messages_created on contact_messages (created_at desc);
create index if not exists contact_messages_user on contact_messages (user_id, created_at desc);
