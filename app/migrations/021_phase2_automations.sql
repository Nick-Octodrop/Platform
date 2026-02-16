create table if not exists automations (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  name text not null,
  description text null,
  status text not null default 'draft',
  trigger jsonb not null,
  steps jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz null,
  published_by text null
);

create index if not exists automations_org_status_idx
  on automations (org_id, status);

create index if not exists automations_org_updated_idx
  on automations (org_id, updated_at desc);

create table if not exists automation_runs (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  automation_id uuid not null,
  status text not null default 'queued',
  trigger_event_id uuid null,
  trigger_type text not null,
  trigger_payload jsonb not null,
  current_step_index int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz null,
  ended_at timestamptz null,
  last_error text null
);

create index if not exists automation_runs_org_created_idx
  on automation_runs (org_id, created_at desc);

create index if not exists automation_runs_automation_created_idx
  on automation_runs (automation_id, created_at desc);

create index if not exists automation_runs_status_created_idx
  on automation_runs (status, created_at desc);

create table if not exists automation_step_runs (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  run_id uuid not null,
  step_index int not null,
  step_id text not null,
  status text not null default 'queued',
  attempt int not null default 0,
  started_at timestamptz null,
  ended_at timestamptz null,
  input jsonb null,
  output jsonb null,
  last_error text null,
  idempotency_key text not null
);

create unique index if not exists automation_step_runs_unique_idx
  on automation_step_runs (org_id, run_id, step_id, attempt);

create index if not exists automation_step_runs_run_idx
  on automation_step_runs (run_id, step_index);
