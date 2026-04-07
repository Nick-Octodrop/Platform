# Runtime Role Audit

Date: 2026-04-07

## Risk Statement

Postgres RLS does not protect queries executed by superusers or roles with `BYPASSRLS`. Tenant isolation is only meaningful if the API and worker runtime database connections use a low-privilege role.

## Automated Audit

Run:

```bash
SUPABASE_DB_URL="<db-url>" python3 scripts/runtime_security_verify.py --json
```

The verifier fails on:

- `RUNTIME_ROLE_SUPERUSER`
- `RUNTIME_ROLE_BYPASSRLS`
- missing RLS helper functions
- missing table RLS
- missing expected policies
- public `attachments` bucket
- missing storage policies

## Manual SQL Checks

Run in the SQL editor using the same role/connection class used by the API where possible:

```sql
select current_user;

select rolname, rolsuper, rolbypassrls
from pg_roles
where rolname = current_user;
```

Expected:

- `rolsuper = false`
- `rolbypassrls = false`
- role is not `postgres`

## Safety Assumptions For Internal Bypasses

Every `db_internal_service()` use is high risk and must remain narrow.

Reviewed bypasses:

- API credential hash lookup before workspace is known.
- API credential last-used metadata update.
- Inbound webhook lookup before workspace is known.
- Marketplace app catalog operations requiring global published-app visibility and superadmin mutations.
- Platform role writes.
- System integration provider bootstrap writes.

Required controls:

- Keep bypass scopes around the smallest DB operation only.
- Do not pass user-controlled SQL into a bypass path.
- Keep route-level authorization before any bypass mutation.
- Log and review new bypass paths during PR review.
- Prefer narrow `SECURITY DEFINER` RPCs if bypass usage grows.

## Deployment Gate

Production is not approved if the runtime verifier reports `RUNTIME_ROLE_SUPERUSER` or `RUNTIME_ROLE_BYPASSRLS`.

