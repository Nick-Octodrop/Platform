create index if not exists records_generic_tenant_entity_id_idx
  on records_generic (tenant_id, entity_id, id);

create index if not exists records_generic_tenant_entity_updated_idx
  on records_generic (tenant_id, entity_id, updated_at desc);

create index if not exists records_chatter_org_entity_record_created_idx
  on records_chatter (org_id, entity_id, record_id, created_at desc);

create index if not exists manifest_snapshots_org_module_created_idx
  on manifest_snapshots (org_id, module_id, created_at desc);

create index if not exists manifest_snapshots_org_module_hash_idx
  on manifest_snapshots (org_id, module_id, manifest_hash);

create index if not exists module_drafts_module_updated_idx
  on module_drafts (module_id, updated_at desc);

create index if not exists module_audit_org_module_created_idx
  on module_audit (org_id, module_id, created_at desc);

create index if not exists modules_installed_org_module_idx
  on modules_installed (org_id, module_id);
