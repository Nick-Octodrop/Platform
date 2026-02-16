create table if not exists templates (
  org_id text not null,
  template_id uuid not null default gen_random_uuid(),
  name text not null,
  category text,
  format text,
  content text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, template_id)
);

create index if not exists templates_updated_idx on templates (org_id, updated_at desc);
