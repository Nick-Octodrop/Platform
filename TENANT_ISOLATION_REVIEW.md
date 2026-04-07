# Tenant Isolation Review

## Current Model

The application resolves an actor workspace in `app/main.py` using `X-Workspace-Id`, memberships, and platform roles. Generic records are stored with tenant/workspace scope in `app/stores_db.py` and app-layer queries generally include `tenant_id` or `org_id`.

Memory store tests confirm tenant buckets are separate. DB store inspection shows core generic record methods filter by tenant id.

## Material Gaps

- No RLS enablement or policies were found in `app/migrations/*.sql`.
- Service-role paths exist for storage and some backend operations.
- Workers and integrations need separate tenant-boundary tests because they may execute outside request middleware.
- Studio/module draft history previously needed migration hardening; `app/migrations/035_tenant_scoped_module_drafts.sql` indicates this was a known cross-workspace risk.

## Required Controls

- Every tenant table must have RLS enabled.
- Every policy must include workspace membership or service-only safe predicates.
- Every worker job payload must carry and validate `org_id`.
- Every route that takes object ids must validate object tenant and record visibility/write policy.
- Cache keys must include workspace and access-policy-relevant identity whenever responses are field masked.

## Tests Required

- User A in workspace A cannot read/write/list workspace B records by id.
- Multi-workspace user cannot access workspace B objects while active workspace is A unless explicitly switched.
- Attachments cannot be downloaded, linked, listed, or deleted without record-level access.
- Workers cannot process a job whose payload org id does not match job org id.
- Studio drafts, previews, and generated modules are workspace-scoped.

