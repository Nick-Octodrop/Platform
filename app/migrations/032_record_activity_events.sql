-- Generic activity timeline events for all entity records

create table if not exists record_activity_events (
  id uuid primary key,
  org_id text not null,
  entity_id text not null,
  record_id text not null,
  event_type text not null,
  author_user_id text null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists record_activity_events_org_entity_record_created_idx
  on record_activity_events (org_id, entity_id, record_id, created_at desc);

