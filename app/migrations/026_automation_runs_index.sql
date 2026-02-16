-- Add index to speed automation runs list by org and automation.
create index if not exists automation_runs_org_automation_created_idx
  on automation_runs (org_id, automation_id, created_at desc);
