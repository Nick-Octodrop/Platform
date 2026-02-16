-- Phase 1: unified jobs queue (v1)

alter table if exists jobs rename to jobs_legacy;

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  type text not null,
  status text not null default 'queued',
  priority int not null default 0,
  run_at timestamptz not null default now(),
  attempt int not null default 0,
  max_attempts int not null default 10,
  locked_at timestamptz null,
  locked_by text null,
  last_error text null,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jobs_status_run_priority_idx
  on jobs (status, run_at, priority desc);

create index if not exists jobs_org_created_idx
  on jobs (org_id, created_at desc);

create unique index if not exists jobs_idempotency_idx
  on jobs (org_id, type, idempotency_key)
  where idempotency_key is not null;

create table if not exists job_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  org_id text not null,
  ts timestamptz not null default now(),
  level text not null,
  message text not null,
  data jsonb
);

create index if not exists job_events_job_ts_idx
  on job_events (job_id, ts desc);

create index if not exists job_events_org_ts_idx
  on job_events (org_id, ts desc);
