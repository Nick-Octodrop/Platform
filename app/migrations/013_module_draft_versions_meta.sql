alter table if exists module_draft_versions
  add column if not exists parent_version_id text null,
  add column if not exists ops_applied jsonb null,
  add column if not exists validation_errors jsonb null;

create index if not exists module_draft_versions_parent_idx
  on module_draft_versions (parent_version_id);
