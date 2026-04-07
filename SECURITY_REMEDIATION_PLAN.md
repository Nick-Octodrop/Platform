# Security Remediation Plan

## Phase 0: Immediate

- Rotate/revoke the exposed API token from `manifests/marketplace/README.md`.
- Deploy the production-safe CORS, TrustedHost, error-redaction, attachment authorization, upload-limit, and auth error-redaction patches.
- Run `make security` in CI and locally.
- Set production env vars: `APP_ENV=production`, `OCTO_CORS_ORIGINS`, `OCTO_TRUSTED_HOSTS`, `APP_SECRET_KEY`, `SUPABASE_URL`, `SUPABASE_DB_URL`.
- Ensure `OCTO_DISABLE_AUTH` and `STUDIO2_AGENT_LOG_PAYLOAD` are not enabled in production.

## Phase 1: Tenant Isolation

- Apply `app/migrations/052_rls_tenant_isolation.sql` to production and verify it succeeds against the live Supabase schema.
- Verify the production runtime DB role is not superuser and does not have `BYPASSRLS`.
- Keep privileged operations behind narrow app-side internal service scopes or `SECURITY DEFINER` RPCs only where required and test them.
- Keep CI checks that fail if new tenant-scoped tables lack RLS, ownership fields, or storage policy coverage.
- Add cross-tenant integration tests using real Postgres/Supabase, not only memory stores.

## Phase 2: Files and Storage

- Confirm attachment bucket is private and branding bucket is the only public bucket.
- Add storage policy migrations.
- Add content-type/extension allowlists where business-safe.
- Add streaming upload size enforcement instead of full memory reads.
- Add tests for direct storage URL denial and app-proxy authorization.

## Phase 3: API Abuse and Webhooks

- Add global rate limits by IP, user, workspace, and credential.
- Add stricter limits on upload, Studio, AI, webhook, and auth-adjacent routes.
- Require signing secrets on all production webhooks.
- Require timestamped webhook signatures in production and disable legacy payload-only verification.
- Add replay protection for inbound webhook event ids.

## Phase 4: Studio and Generated Modules

- Add action allowlists for generated manifests.
- Add validation tests for role/field visibility, entity scoping, unsafe external actions, and orphan views/pages.
- Add audit logging for manifest generation, install, rollback, and publish.
- Require admin/superadmin approval on production module generation and installation paths.

## Phase 5: Operations

- Add CSP after compatibility testing.
- Define backup/restore tests and tenant-scoped restore procedures.
- Add dependency scanning and secret scanning as required checks.
- Add incident response and customer notification templates.
