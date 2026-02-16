create unique index if not exists jobs_org_type_idempotency_idx
  on jobs (org_id, type, idempotency_key)
  where idempotency_key is not null;
