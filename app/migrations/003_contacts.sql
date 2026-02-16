create table if not exists contacts (
  org_id text not null,
  contact_id text not null,
  full_name text not null,
  email text null,
  phone text null,
  company text null,
  notes text null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (org_id, contact_id)
);

create index if not exists contacts_updated_idx on contacts (org_id, updated_at desc);
