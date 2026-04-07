# Go-Live Security Status

Date: 2026-04-07

## Completed Controls

- App-layer tenant context now propagates into DB session settings:
  - `app.org_id`
  - `app.user_id`
  - `app.internal_service`
- RLS migration added for known tenant-owned tables.
- Explicit policies added for workspace membership, platform roles, shared marketplace catalog, integration providers, and module icons.
- Supabase Storage policies are defined for tenant-scoped `attachments` and `branding` object paths, with a migration warning path when the SQL role cannot manage `storage.objects`.
- Runtime verifier added: `scripts/runtime_security_verify.py`.
- Strict local guardrail updated: `scripts/security_check.py --strict`.
- Service-role/internal-bypass paths documented in `SERVICE_ROLE_REVIEW.md`.
- Staging integration security tests added behind `OCTO_RUN_STAGING_SECURITY_TESTS=1`.

## Current Status

Code and migration guardrails are ready for staging verification. Production go-live is not approved until the runtime verifier and staging penetration tests pass against the deployed environment.

## Residual Risks

- Storage policies may need manual Supabase UI setup if the migration role cannot alter `storage.objects`.
- Backend storage operations still use service-role credentials, so app-layer authorization remains mandatory.
- RLS does not protect queries made by superuser or `BYPASSRLS` roles.
- Cross-tenant tests require real staging fixtures and are skipped by default.
- Worker tenant-context coverage still needs staging verification with real jobs.
- Webhook replay protection depends on signing secrets being configured for production webhooks.

## Required Pre-Production Checks

- Revoke/rotate the API token previously exposed in documentation.
- Apply `052_rls_tenant_isolation.sql` in staging and production.
- Run `python3 scripts/runtime_security_verify.py` against staging and production.
- Run `python3 scripts/security_check.py --strict`.
- Run `tests/test_staging_security_integration.py` against staging using two real workspaces.
- Verify `attachments` bucket is private.
- Verify storage policies exist, either via migration or manual Supabase policy setup.
- Verify runtime DB role is not superuser and does not have `BYPASSRLS`.

## Recommended Monitoring And Alerts

- Alert on 403/404 spikes for direct record-id access attempts across workspaces.
- Alert on webhook signature failures and timestamp replay failures.
- Alert on `db_internal_service()` error paths and unexpected usage growth.
- Alert on storage download failures by attachment id.
- Alert if `OCTO_DISABLE_AUTH` or payload logging env vars are ever enabled in production.
- Review logs for any `Skipping storage.objects policies` migration warning and require manual closure evidence.

## Go-Live Decision

Go-live should be blocked until:

- Runtime verifier returns no high/critical findings.
- Staging cross-tenant tests pass.
- Storage policy verification is complete.
- Exposed token rotation is confirmed.

