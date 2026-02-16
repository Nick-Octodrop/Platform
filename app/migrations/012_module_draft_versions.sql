create table if not exists module_draft_versions (
    id text primary key,
    module_id text not null,
    manifest jsonb not null,
    note text null,
    created_at timestamptz not null default now(),
    created_by text null
);

create index if not exists module_draft_versions_module_created_idx
  on module_draft_versions (module_id, created_at desc);
