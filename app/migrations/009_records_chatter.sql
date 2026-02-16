create table if not exists records_chatter (
  org_id text not null,
  entity_id text not null,
  record_id text not null,
  id text primary key,
  type text not null,
  body text not null,
  actor jsonb,
  created_at timestamptz not null
);

create index if not exists records_chatter_entity_idx
  on records_chatter (org_id, entity_id, record_id, created_at desc);
