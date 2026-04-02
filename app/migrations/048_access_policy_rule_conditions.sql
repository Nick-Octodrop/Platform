alter table if exists workspace_access_policy_rules
  add column if not exists condition_json jsonb null;

create index if not exists workspace_access_policy_rules_org_type_condition_idx
  on workspace_access_policy_rules (org_id, resource_type, profile_id, priority)
  where condition_json is not null;
