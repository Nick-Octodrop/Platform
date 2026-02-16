alter table module_drafts
  add column if not exists base_snapshot_id text null;

create index if not exists module_drafts_base_snapshot_idx on module_drafts(base_snapshot_id);
