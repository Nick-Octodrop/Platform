alter table if exists api_credentials
  add column if not exists expires_at timestamptz null,
  add column if not exists last_rotated_at timestamptz null;

create index if not exists api_credentials_org_expires_idx
  on api_credentials (org_id, expires_at);
