# RLS Implementation Plan

Date: 2026-04-07

## Goal

Move Octodrop tenant isolation from app-code-only filtering to database/storage-enforced isolation. App filters still stay, but every tenant-owned table must also deny cross-tenant reads/writes at Postgres RLS and Supabase Storage policy layers.

## Implemented In This Pass

- Added transaction-local DB context in `app/db.py`:
  - `app.org_id`
  - `app.user_id`
  - `app.internal_service`
- Wired the existing workspace context in `app/stores_db.py` so `set_org_id()` also updates DB RLS context.
- Wired authenticated user id into DB context in `app/auth.py` and `_resolve_actor()` in `app/main.py`.
- Wrapped known cross-tenant lookup paths in explicit internal-service context:
  - API credential lookup by key hash.
  - API credential `last_used_at` touch by credential id.
  - inbound webhook lookup by webhook id before workspace is known.
  - marketplace app catalog DB operations that need global published-app and slug visibility.
  - platform-role writes.
  - system integration provider bootstrap writes.
- Added migration `app/migrations/052_rls_tenant_isolation.sql` with:
  - helper functions under `octo_security`
  - RLS enablement for tenant-owned tables
  - default tenant policies keyed by `org_id`, `tenant_id`, or `workspace_id`
  - special policies for workspace membership, platform roles, and shared marketplace/provider catalogs
  - Supabase Storage object policies for `attachments` and `branding` buckets when the migration role can manage `storage.objects`; otherwise it raises a warning and storage policies must be applied manually.
- Updated `scripts/security_check.py --strict` so it fails on missing RLS, missing ownership fields, or missing storage policy coverage.

## Deployment Requirements

1. Confirm production DB connection role is not `postgres`, not superuser, and not `BYPASSRLS`.
2. Apply migrations through the normal migration pipeline.
3. Run a smoke test with `USE_DB=1` for:
   - login/workspace resolution
   - module bootstrap
   - records list/get/create/update/delete
   - attachment upload/link/list/download/delete
   - API credential auth
   - inbound webhook ingest
4. Run `python3 scripts/security_check.py --strict`.
5. Verify Supabase Storage bucket privacy and policy existence in the Supabase dashboard. If the migration warns that it skipped `storage.objects`, add the equivalent storage policies manually.

## Known Limitations

- RLS cannot protect queries made by a superuser or role with `BYPASSRLS`; deployment role separation is mandatory.
- `app.internal_service` is an explicit app-side bypass context. Its usage must stay small and reviewed.
- This first RLS migration focuses on existing platform tables. Future migrations must add policies at the same time as new tenant-owned tables.
- Generated module records are covered by `records_generic.tenant_id`; Studio must not introduce independent physical tables without ownership fields and RLS.

## Next Work

- Add integration tests against real Postgres/Supabase rather than memory stores only.
- Add route-level attachment RLS tests with `USE_DB=1`.
- Add a startup check warning/failing if the DB user is `postgres` or `BYPASSRLS` in production.
- Move cross-tenant lookups to narrowly scoped `SECURITY DEFINER` RPCs if the internal-service GUC bypass becomes too broad.
