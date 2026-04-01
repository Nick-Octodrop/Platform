create table if not exists api_credentials (
  id text primary key,
  org_id text not null,
  name text not null,
  key_prefix text not null,
  key_hash text not null,
  scopes_json jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  created_by text null,
  last_used_at timestamptz null,
  revoked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists api_credentials_key_hash_idx
  on api_credentials (key_hash);

create unique index if not exists api_credentials_org_key_prefix_idx
  on api_credentials (org_id, key_prefix);

create index if not exists api_credentials_org_status_idx
  on api_credentials (org_id, status, created_at desc);
