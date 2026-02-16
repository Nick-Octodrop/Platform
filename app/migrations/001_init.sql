-- Minimal schema for MVP (Supabase/Postgres)

create table if not exists orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists org_members (
  user_id uuid not null,
  org_id uuid not null references orgs(id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, org_id)
);

create table if not exists modules_installed (
  org_id uuid not null references orgs(id) on delete cascade,
  module_id text not null,
  enabled boolean not null default true,
  current_hash text not null,
  installed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, module_id)
);

create table if not exists manifest_snapshots (
  org_id uuid not null references orgs(id) on delete cascade,
  module_id text not null,
  hash text not null,
  manifest_json jsonb not null,
  created_at timestamptz not null default now(),
  actor_json jsonb,
  reason text,
  primary key (org_id, module_id, hash)
);

create table if not exists manifest_audit (
  org_id uuid not null references orgs(id) on delete cascade,
  module_id text not null,
  audit_json jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists workflow_instances (
  org_id uuid not null references orgs(id) on delete cascade,
  instance_id uuid not null,
  instance_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, instance_id)
);
