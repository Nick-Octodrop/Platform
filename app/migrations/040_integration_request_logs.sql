create table if not exists integration_request_logs (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  connection_id uuid null references connections(id) on delete set null,
  source text not null default 'manual',
  direction text not null default 'outbound',
  method text,
  url text,
  request_headers_json jsonb not null default '{}'::jsonb,
  request_query_json jsonb not null default '{}'::jsonb,
  request_body_json jsonb null,
  request_body_text text null,
  response_status integer,
  response_headers_json jsonb not null default '{}'::jsonb,
  response_body_json jsonb null,
  response_body_text text null,
  ok boolean,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists integration_request_logs_org_connection_created_idx
  on integration_request_logs (org_id, connection_id, created_at desc);

create index if not exists integration_request_logs_org_source_created_idx
  on integration_request_logs (org_id, source, created_at desc);
