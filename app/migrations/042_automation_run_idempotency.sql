alter table if exists automation_runs
  add column if not exists idempotency_key text null;

create unique index if not exists automation_runs_org_automation_idempotency_idx
  on automation_runs (org_id, automation_id, idempotency_key)
  where idempotency_key is not null;
