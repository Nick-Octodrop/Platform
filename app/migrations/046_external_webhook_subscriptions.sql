create table if not exists external_webhook_subscriptions (
  id text primary key,
  org_id text not null,
  name text not null,
  target_url text not null,
  event_pattern text not null,
  signing_secret_id text null,
  status text not null default 'active',
  headers_json jsonb not null default '{}'::jsonb,
  last_delivered_at timestamptz null,
  last_status_code integer null,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists external_webhook_subscriptions_org_status_idx
  on external_webhook_subscriptions (org_id, status, created_at desc);

create index if not exists external_webhook_subscriptions_org_event_idx
  on external_webhook_subscriptions (org_id, event_pattern);
