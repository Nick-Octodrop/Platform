# Octodrop Security Audit

Date: 2026-04-07

Scope: FastAPI backend, Supabase/Postgres/Auth usage, generic record store, attachments, integrations/webhooks, workers, Studio/module generation, frontend auth handling, configuration, and CI guardrails. Baselines: OWASP ASVS 5.0, OWASP Top 10 2025, OWASP API Security Top 10 2023.

## Executive Summary

Octodrop has meaningful app-layer tenant scoping in the generic record store and actor/workspace resolution, but it is not yet production-grade for a multi-tenant SaaS because tenant isolation depends primarily on application code. The most important remaining gap is the absence of Supabase/Postgres Row Level Security in local migrations. If any DB path, RPC, SQL console, worker, or future endpoint bypasses the app store abstractions, tenant data could be exposed.

Several immediate controls were added during this audit:

- Production CORS defaults now deny local/preview origins unless explicitly configured.
- Trusted host support and baseline security headers were added.
- Raw 500 error details are hidden in production.
- Invalid JWT error detail is hidden in production.
- Attachment downloads are constrained to the active workspace instead of searching all workspaces for the actor.
- Attachment link/list/delete now verifies record visibility/write authorization.
- Upload size limits were added for attachments and logos.
- A committed JWT-like token in `manifests/marketplace/README.md` was replaced with a placeholder.
- CI/local security guardrails were added via `scripts/security_check.py`, `make security`, and `.github/workflows/security.yml`.
- Security tests were added for secret scanning, tenant-scoped memory storage, and webhook signature verification.

## Critical Findings

### C1. Missing database RLS for tenant isolation

Affected components: `app/migrations/*.sql`, `app/stores_db.py`, Supabase/Postgres.

Risk: The application does use `tenant_id` / `org_id` filters in core DB store paths, but local migrations do not show `ENABLE ROW LEVEL SECURITY` or `CREATE POLICY`. This means database-layer isolation is not enforced if a query path misses a tenant predicate or if service-role/worker code is misused.

Exploit scenario: A newly added SQL query or RPC reads from `records_generic` without `tenant_id = current tenant`, returning another workspace's records.

Recommended fix: Add RLS to every tenant-scoped table, define policies based on authenticated workspace membership claims or secure RPC wrappers, and add migration tests that fail when tenant tables lack RLS.

Status: Partially fixed. `app/migrations/052_rls_tenant_isolation.sql` now enables RLS and creates default-deny tenant policies for known tenant-owned tables plus Supabase Storage path policies. `scripts/security_check.py --strict` now fails on missing RLS, missing ownership fields, and missing storage policy coverage. Production still requires applying the migration and verifying the runtime DB role is not superuser/BYPASSRLS.

### C2. Committed JWT-like access token

Affected component: `manifests/marketplace/README.md`.

Risk: A live-looking bearer token was present in documentation. Anyone with repository access or logs containing this file could use it until expiry or revocation.

Exploit scenario: An attacker copies the token and calls the API as that user while the token remains valid.

Recommended fix: Revoke/rotate the exposed token, invalidate sessions if possible, and keep examples as placeholders only.

Status: Fixed in repo; token rotation still required operationally.

### C3. Auth can be disabled by environment

Affected components: `app/auth.py`, `app/main.py`, deployment config.

Risk: `OCTO_DISABLE_AUTH=1` produces a privileged local actor. If this is set in production, the app is effectively unauthenticated.

Exploit scenario: A misconfigured production deploy accepts requests without bearer tokens and grants admin-like access.

Recommended fix: Fail startup in production when `OCTO_DISABLE_AUTH` is true. The added security check blocks this in CI/deploy validation, but runtime startup should also fail.

Status: Partially fixed by `scripts/security_check.py`; runtime startup guard still recommended.

## High Findings

### H1. Attachment object authorization was too broad

Affected component: `app/main.py` attachment routes.

Risk: Direct download lookup previously searched across all actor workspaces, not just the active workspace. Record attachment list/link/delete paths did not consistently validate the target record's visibility/write policy.

Exploit scenario: A user with memberships in multiple workspaces guesses or obtains an attachment id and downloads it outside the active workspace context, or links an attachment to a record they should not write.

Recommended fix: Restrict attachment download to active workspace and validate record read/write before list/link/delete.

Status: Fixed in `app/main.py`.

### H2. File uploads lacked size limits

Affected component: `app/main.py` attachment and logo upload routes.

Risk: Upload handlers read files fully into memory and had no configured cap, enabling memory exhaustion or oversized storage writes.

Exploit scenario: Authenticated user uploads very large files repeatedly to exhaust API memory or storage.

Recommended fix: Enforce a conservative upload size limit and add streaming upload checks later.

Status: Partially fixed with `OCTO_MAX_UPLOAD_BYTES` defaulting to 10MB. Streaming/content-type controls still recommended.

### H3. Unsigned or legacy webhook ingestion

Affected components: `app/main.py`, `app/webhook_signing.py`.

Risk: Inbound webhook verification is conditional on a stored signing secret. Legacy payload-only signatures can be accepted when timestamp is absent.

Exploit scenario: An attacker posts forged integration events to an unsigned webhook id and triggers workflow state changes or data ingestion.

Recommended fix: Require signing secrets for production webhooks, require timestamped signatures, and reject stale timestamps.

Status: Open. Tests now cover strict timestamped verification behavior.

### H4. Broad credentialed CORS defaults

Affected component: `app/main.py`.

Risk: Credentialed CORS was permissive for local and Netlify origins by default.

Exploit scenario: A malicious preview domain can make browser-authenticated requests if broad preview regexes are allowed in production.

Recommended fix: Allow only explicit production origins and disable preview regexes unless intentionally enabled.

Status: Fixed in `app/main.py`; production must set `OCTO_CORS_ORIGINS`.

### H5. Raw backend error detail leakage

Affected components: `app/main.py`, `app/auth.py`.

Risk: Raw exception strings can expose implementation details, SQL errors, auth validation internals, or secrets in edge cases.

Exploit scenario: An attacker probes endpoints and uses error detail to tune an exploit.

Recommended fix: Log details server-side and return generic errors in production.

Status: Fixed for generic 500s and invalid JWT responses.

### H6. Supabase storage uses service-role access

Affected component: `app/attachments.py`.

Risk: Service-role storage operations bypass Supabase RLS/storage policies. App-layer authorization must be perfect, and buckets must be private except explicitly public branding assets.

Exploit scenario: A bug in attachment id lookup or public bucket configuration exposes private tenant files.

Recommended fix: Keep private attachments in a private bucket, proxy downloads after app authorization, add storage policies, and test direct URL denial.

Status: Partially fixed. `app/migrations/052_rls_tenant_isolation.sql` adds path-scoped policies for `storage.objects` in the `attachments` and `branding` buckets. Server-side Supabase Storage operations still use service-role credentials, so live bucket privacy and direct URL denial must be verified after migration.

### H7. Missing broad API rate limiting

Affected components: `app/main.py`, auth middleware, deployment edge.

Risk: Rate limiting currently focuses on external API credentials. Interactive routes, auth-adjacent routes, Studio, and upload endpoints lack broad protection.

Exploit scenario: Credential stuffing, expensive search calls, AI route abuse, or upload abuse degrades service.

Recommended fix: Add user/IP/workspace rate limits at middleware or edge gateway; use stricter limits for auth, Studio, webhook, and upload routes.

Status: Open.

## Medium Findings

### M1. No CSP response header

Affected components: `web/src`, `app/main.py`.

Risk: Supabase tokens are held in browser storage by the frontend stack. XSS would be high impact.

Recommended fix: Add a tested Content-Security-Policy with script/style/connect/img allowances for the actual deployment domains.

Status: Open. Basic headers were added, but CSP requires frontend compatibility testing.

### M2. Secrets encryption lacks rotation/KMS plan

Affected component: `app/secrets.py`.

Risk: `APP_SECRET_KEY` protects stored integration secrets. Loss or rotation is not yet operationalized.

Recommended fix: Add key rotation metadata, versioned encryption keys, and a runbook for rotating `APP_SECRET_KEY`.

Status: Open.

### M3. Studio/module generation is high privilege

Affected components: `app/main.py`, Studio routes, manifest apply pipeline.

Risk: Generated modules can influence forms/actions/views and may create unsafe workflow surfaces if validation misses a case.

Recommended fix: Keep Studio behind `modules.manage`/superadmin gates, validate manifests deny-by-default, reject unsafe system actions, and add generated-manifest security tests.

Status: Partially controlled; further tests recommended.

### M4. Outbound integration SSRF risk needs review

Affected components: integration connection/request execution in `app/main.py` and worker paths.

Risk: Provider URLs and webhook targets can become SSRF vectors if arbitrary internal/private network URLs are allowed.

Recommended fix: Add URL allowlists or private IP/range blocking for outbound integration calls and webhook targets.

Status: Open.

## Low Findings

### L1. Generated/build artifacts were not fully ignored

Affected component: `.gitignore`.

Risk: Built frontend artifacts can accidentally capture old config or keys.

Status: Fixed for `construction-worker-pwa/dist/`.

### L2. Logs may include operational identifiers

Affected components: backend logging.

Risk: Logs include paths, ids, and some errors. This is useful but should be reviewed for PII and secret leakage.

Status: Open.
