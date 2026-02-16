create table if not exists saved_filters (
  id uuid primary key default gen_random_uuid(),
  org_id text not null default 'default',
  user_id text not null,
  entity_id text not null,
  name text not null,
  domain jsonb not null,
  state jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists saved_filters_org_user_entity_idx
  on saved_filters (org_id, user_id, entity_id);

create table if not exists user_entity_prefs (
  id uuid primary key default gen_random_uuid(),
  org_id text not null default 'default',
  user_id text not null,
  entity_id text not null,
  default_mode text,
  default_filter_id uuid,
  default_filter_key text,
  default_group_by text,
  updated_at timestamptz not null default now(),
  unique (org_id, user_id, entity_id)
);

create index if not exists user_entity_prefs_org_user_entity_idx
  on user_entity_prefs (org_id, user_id, entity_id);
