create table if not exists workspace_access_profiles (
  id text primary key,
  org_id text not null,
  profile_key text null,
  name text not null,
  description text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists workspace_access_profiles_org_key_idx
  on workspace_access_profiles (org_id, profile_key)
  where profile_key is not null;

create index if not exists workspace_access_profiles_org_name_idx
  on workspace_access_profiles (org_id, lower(name));

create table if not exists workspace_access_profile_assignments (
  org_id text not null,
  profile_id text not null references workspace_access_profiles (id) on delete cascade,
  user_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, profile_id, user_id)
);

create index if not exists workspace_access_profile_assignments_org_user_idx
  on workspace_access_profile_assignments (org_id, user_id);

create table if not exists workspace_access_policy_rules (
  id text primary key,
  org_id text not null,
  profile_id text not null references workspace_access_profiles (id) on delete cascade,
  resource_type text not null,
  resource_id text not null,
  access_level text not null,
  priority integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_access_policy_rules_resource_type_chk
    check (resource_type in ('module', 'entity', 'field', 'action'))
);

create index if not exists workspace_access_policy_rules_org_profile_idx
  on workspace_access_policy_rules (org_id, profile_id, resource_type, priority, created_at);

create index if not exists workspace_access_policy_rules_org_resource_idx
  on workspace_access_policy_rules (org_id, resource_type, resource_id);
