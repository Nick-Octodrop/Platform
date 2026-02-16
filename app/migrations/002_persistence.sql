-- Persistence v0 schema for product layer

create table if not exists modules_installed (
  org_id text not null,
  module_id text not null,
  enabled boolean not null default true,
  current_hash text not null,
  name text,
  installed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tags jsonb,
  primary key (org_id, module_id)
);

create table if not exists manifest_snapshots (
  org_id text not null,
  module_id text not null,
  manifest_hash text not null,
  manifest jsonb not null,
  created_at timestamptz not null default now(),
  actor jsonb,
  reason text,
  unique (org_id, module_id, manifest_hash)
);

create table if not exists module_audit (
  org_id text not null,
  module_id text not null,
  audit_id text not null,
  audit jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists module_audit_idx on module_audit (org_id, module_id, created_at desc);

create table if not exists jobs (
  org_id text not null,
  job_id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, job_id)
);

create index if not exists jobs_updated_idx on jobs (org_id, updated_at desc);

create table if not exists workflow_instances (
  org_id text not null,
  instance_id text not null,
  module_id text not null,
  workflow_id text not null,
  subject_ref jsonb,
  state text not null,
  history jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (org_id, instance_id)
);
