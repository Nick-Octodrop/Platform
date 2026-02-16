create index if not exists records_generic_entity_created_idx
  on records_generic (tenant_id, entity_id, created_at desc);
