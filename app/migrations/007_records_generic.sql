create table if not exists records_generic (
  tenant_id text not null default 'default',
  entity_id text not null,
  id uuid not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, entity_id, id)
);

create index if not exists records_generic_entity_idx
  on records_generic (tenant_id, entity_id);

create index if not exists records_generic_entity_updated_idx
  on records_generic (tenant_id, entity_id, updated_at desc);
