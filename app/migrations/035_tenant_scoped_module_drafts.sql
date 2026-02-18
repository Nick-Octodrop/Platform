-- Scope studio drafts to a workspace/org.
-- Previously `module_drafts` and `module_draft_versions` were global and leaked drafts across workspaces.

alter table if exists module_drafts
  add column if not exists org_id text not null default 'default';

alter table if exists module_drafts
  drop constraint if exists module_drafts_pkey;

alter table if exists module_drafts
  add constraint module_drafts_pkey primary key (org_id, module_id);

drop index if exists module_drafts_updated_idx;
create index if not exists module_drafts_org_updated_idx on module_drafts (org_id, updated_at desc);

alter table if exists module_draft_versions
  add column if not exists org_id text not null default 'default';

create index if not exists module_draft_versions_org_module_created_idx
  on module_draft_versions (org_id, module_id, created_at desc);

