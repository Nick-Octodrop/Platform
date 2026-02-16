create table if not exists module_drafts (
    module_id text primary key,
    manifest jsonb not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    updated_by text null
);

create index if not exists module_drafts_updated_idx on module_drafts(updated_at desc);
