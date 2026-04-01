alter table connections
  add column if not exists health_status text,
  add column if not exists last_tested_at timestamptz,
  add column if not exists last_success_at timestamptz,
  add column if not exists last_error text;

create index if not exists connections_org_health_idx
  on connections (org_id, health_status);
