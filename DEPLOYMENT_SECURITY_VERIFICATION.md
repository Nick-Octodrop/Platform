# Deployment Security Verification

Date: 2026-04-07

## Purpose

This checklist verifies that tenant isolation and storage controls are actually present in staging/production after deployment. Do not treat migration files or local unit tests as proof that the live database is protected.

## Required Pre-Deployment Checks

- Confirm the exposed API token previously pasted into documentation has been revoked/rotated.
- Confirm `APP_ENV=production` for production.
- Confirm `OCTO_DISABLE_AUTH` is not set to `1`, `true`, or `yes`.
- Confirm `OCTO_CORS_ORIGINS` is explicit and does not use broad preview domains in production.
- Confirm `OCTO_TRUSTED_HOSTS` is set for production API hosts.
- Confirm `SUPABASE_DB_URL` points to the intended staging/production database.
- Confirm the runtime DB role is not `postgres`, not superuser, and not `BYPASSRLS`.

## Migration Verification

1. Apply migrations through the normal migration pipeline.
2. Confirm `app/migrations/052_rls_tenant_isolation.sql` ran successfully.
3. If it prints a warning about `storage.objects`, continue the DB migration but create the equivalent storage policies in Supabase Storage policy UI or with a storage-owner role.
4. Restart API and worker processes after migration so DB context wiring is active.

## Runtime Verification Commands

Run against staging first:

```bash
SUPABASE_DB_URL="<staging-db-url>" python3 scripts/runtime_security_verify.py
python3 scripts/security_check.py --strict
```

Run against production before go-live:

```bash
SUPABASE_DB_URL="<production-db-url>" python3 scripts/runtime_security_verify.py
python3 scripts/security_check.py --strict
```

For environments where Supabase Storage is managed separately and cannot be inspected by the runtime role, use this only as a temporary staging diagnostic:

```bash
SUPABASE_DB_URL="<db-url>" python3 scripts/runtime_security_verify.py --allow-missing-storage
```

Do not use `--allow-missing-storage` as a production acceptance condition unless the storage policies have been verified manually and recorded.

## Staging Security Tests

Run with two real users/tokens in two separate workspaces:

```bash
OCTO_RUN_STAGING_SECURITY_TESTS=1 \
OCTO_STAGING_BASE_URL="https://staging.example.com" \
OCTO_STAGING_TOKEN_A="<workspace-a-user-token>" \
OCTO_STAGING_TOKEN_B="<workspace-b-user-token>" \
OCTO_STAGING_WORKSPACE_A="<workspace-a-id>" \
OCTO_STAGING_WORKSPACE_B="<workspace-b-id>" \
OCTO_STAGING_ENTITY_ID="<entity-id>" \
OCTO_STAGING_RECORD_ID_A="<record-id-owned-by-workspace-a>" \
./.venv/Scripts/python.exe -m pytest tests/test_staging_security_integration.py
```

Optional:

```bash
OCTO_STAGING_ATTACHMENT_ID_A="<attachment-id-owned-by-workspace-a>"
OCTO_STAGING_WEBHOOK_ID="<signed-webhook-id>"
OCTO_STAGING_WEBHOOK_SECRET="<webhook-secret>"
```

## Acceptance Criteria

- `scripts/runtime_security_verify.py` returns exit code `0`.
- `scripts/security_check.py --strict` returns exit code `0`.
- Staging cross-tenant direct ID, list/search, update/delete, and attachment tests pass.
- Forged and replayed webhook tests pass where webhook secret test fixtures are available.
- No production runtime DB role is superuser or `BYPASSRLS`.
- `attachments` bucket is private.
- Storage policies exist or are manually verified if the migration role could not manage `storage.objects`.

