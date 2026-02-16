create table if not exists workspaces (
  id text primary key default (gen_random_uuid()::text),
  name text not null,
  owner_user_id text not null,
  created_at timestamptz not null default now()
);

create table if not exists workspace_members (
  workspace_id text not null references workspaces(id) on delete cascade,
  user_id text not null,
  role text not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists workspace_members_user_idx on workspace_members (user_id);
