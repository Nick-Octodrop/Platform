create table if not exists workspace_ui_prefs (
  org_id text primary key,
  theme text null,
  colors jsonb null,
  updated_at timestamptz not null default now()
);

create table if not exists user_ui_prefs (
  org_id text not null,
  user_id text not null,
  theme text null,
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
