create table if not exists module_icons (
  module_id text primary key,
  icon_key text not null,
  updated_at timestamptz not null default now()
);
