create table if not exists workspace_invites (
  id text primary key default (gen_random_uuid()::text),
  workspace_id text not null references workspaces(id) on delete cascade,
  email text not null,
  role text not null,
  invited_by_user_id text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create index if not exists workspace_invites_workspace_idx on workspace_invites (workspace_id, status);
create index if not exists workspace_invites_email_idx on workspace_invites (lower(email), status);

alter table workspace_invites
  drop constraint if exists workspace_invites_role_chk;

alter table workspace_invites
  add constraint workspace_invites_role_chk
  check (role in ('admin', 'member', 'readonly', 'portal'));

alter table workspace_invites
  drop constraint if exists workspace_invites_status_chk;

alter table workspace_invites
  add constraint workspace_invites_status_chk
  check (status in ('pending', 'accepted', 'cancelled'));
