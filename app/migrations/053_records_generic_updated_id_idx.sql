create index if not exists records_generic_tenant_entity_updated_id_idx
  on records_generic (tenant_id, entity_id, updated_at desc, id desc);
