create table if not exists user_platform_roles (
  user_id text primary key,
  platform_role text not null default 'standard',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_platform_roles_role_chk check (platform_role in ('standard', 'superadmin'))
);

create index if not exists user_platform_roles_role_idx on user_platform_roles (platform_role);

-- Backfill legacy workspace role naming.
update workspace_members
set role = 'admin'
where role = 'owner';

-- Normalize role domain for workspace members.
alter table workspace_members
  drop constraint if exists workspace_members_role_chk;

alter table workspace_members
  add constraint workspace_members_role_chk
  check (role in ('admin', 'member', 'readonly', 'portal'));
