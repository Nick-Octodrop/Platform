alter table if exists modules_installed
  add column if not exists status text not null default 'installed';

alter table if exists modules_installed
  add column if not exists active_version text null;

alter table if exists modules_installed
  add column if not exists last_error text null;

alter table if exists modules_installed
  add column if not exists archived boolean not null default false;

create table if not exists module_versions (
  org_id text not null,
  module_id text not null,
  version_id text not null,
  version_num integer not null,
  manifest_hash text not null,
  manifest jsonb not null,
  created_at timestamptz not null default now(),
  created_by jsonb,
  notes text,
  primary key (org_id, module_id, version_id)
);

create unique index if not exists module_versions_module_version_idx
  on module_versions (org_id, module_id, version_num);
