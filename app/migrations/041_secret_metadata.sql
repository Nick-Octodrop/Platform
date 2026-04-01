alter table if exists secrets
  add column if not exists provider_key text null,
  add column if not exists secret_key text null,
  add column if not exists status text not null default 'active',
  add column if not exists version integer not null default 1,
  add column if not exists last_rotated_at timestamptz null;

create index if not exists secrets_org_provider_key_idx
  on secrets (org_id, provider_key);

create index if not exists secrets_org_secret_key_idx
  on secrets (org_id, secret_key);
