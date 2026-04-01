create table if not exists api_request_logs (
  id text primary key,
  org_id text not null,
  api_credential_id text null,
  method text not null,
  path text not null,
  status_code integer not null,
  duration_ms integer null,
  ip_address text null,
  user_agent text null,
  created_at timestamptz not null default now()
);

create index if not exists api_request_logs_org_created_idx
  on api_request_logs (org_id, created_at desc);

create index if not exists api_request_logs_credential_created_idx
  on api_request_logs (api_credential_id, created_at desc);
