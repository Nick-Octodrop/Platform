create table if not exists marketplace_apps (
  id text primary key default (gen_random_uuid()::text),
  slug text not null,
  title text not null,
  description text,
  category text,
  icon_url text,
  status text not null default 'published',
  source_org_id text not null,
  source_module_id text not null,
  source_manifest_hash text not null,
  source_manifest jsonb not null,
  published_by_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists marketplace_apps_source_unique
  on marketplace_apps (source_org_id, source_module_id, source_manifest_hash);

create index if not exists marketplace_apps_status_created_idx
  on marketplace_apps (status, created_at desc);

create unique index if not exists marketplace_apps_slug_unique
  on marketplace_apps (slug);

alter table marketplace_apps
  drop constraint if exists marketplace_apps_status_chk;

alter table marketplace_apps
  add constraint marketplace_apps_status_chk
  check (status in ('draft', 'published', 'archived'));
