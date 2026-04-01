create table if not exists integration_providers (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text,
  auth_type text not null default 'none',
  manifest_json jsonb not null default '{}'::jsonb,
  is_system boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists integration_providers_system_idx
  on integration_providers (is_system, key);

create table if not exists integration_connection_secrets (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  connection_id uuid not null references connections(id) on delete cascade,
  secret_id uuid not null references secrets(id) on delete cascade,
  secret_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, secret_key)
);

create index if not exists integration_connection_secrets_org_connection_idx
  on integration_connection_secrets (org_id, connection_id);

create index if not exists integration_connection_secrets_org_secret_idx
  on integration_connection_secrets (org_id, secret_id);

create table if not exists integration_mappings (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  connection_id uuid null references connections(id) on delete cascade,
  name text not null,
  source_entity text not null,
  target_entity text not null,
  mapping_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists integration_mappings_org_connection_idx
  on integration_mappings (org_id, connection_id, created_at desc);

create table if not exists integration_webhooks (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  connection_id uuid not null references connections(id) on delete cascade,
  direction text not null,
  event_key text not null,
  endpoint_path text,
  signing_secret_id uuid null references secrets(id) on delete set null,
  status text not null default 'active',
  config_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists integration_webhooks_org_connection_idx
  on integration_webhooks (org_id, connection_id, created_at desc);

create table if not exists webhook_events (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  connection_id uuid null references connections(id) on delete set null,
  provider_event_id text,
  event_key text,
  headers_json jsonb not null default '{}'::jsonb,
  payload_json jsonb not null default '{}'::jsonb,
  signature_valid boolean,
  status text not null default 'received',
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error_message text
);

create index if not exists webhook_events_org_received_idx
  on webhook_events (org_id, received_at desc);

create unique index if not exists webhook_events_org_connection_provider_event_uidx
  on webhook_events (org_id, connection_id, provider_event_id)
  where provider_event_id is not null;

create table if not exists sync_checkpoints (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  connection_id uuid not null references connections(id) on delete cascade,
  scope_key text not null,
  cursor_value text,
  cursor_json jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  status text not null default 'idle',
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, connection_id, scope_key)
);

create index if not exists sync_checkpoints_org_connection_idx
  on sync_checkpoints (org_id, connection_id, updated_at desc);
