create table if not exists secrets (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  name text,
  secret_enc text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists secrets_org_created_idx
  on secrets (org_id, created_at desc);

create table if not exists connections (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  type text not null,
  name text not null,
  config jsonb not null default '{}'::jsonb,
  secret_ref uuid null references secrets(id) on delete set null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists connections_org_type_idx
  on connections (org_id, type);

create index if not exists connections_org_status_idx
  on connections (org_id, status);
