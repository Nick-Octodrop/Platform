# Backup And Restore Verification

Date: 2026-04-07

## Goal

Backups are not production-ready until restore has been tested. The requirement is to prove Octodrop can restore tenant data, module manifests, attachments metadata, and integration state without breaking tenant isolation.

## Backup Scope

Minimum database coverage:

- tenant records: `records_generic`
- module registry/snapshots/audit: `modules_installed`, `manifest_snapshots`, `module_audit`, `module_versions`
- access/security config: `workspace_access_profiles`, `workspace_access_profile_assignments`, `workspace_access_policy_rules`, `user_platform_roles`, `workspace_members`
- files metadata: `attachments`, `attachment_links`
- integrations/secrets metadata: `connections`, `secrets`, `integration_connection_secrets`, `integration_webhooks`, `webhook_events`, `sync_checkpoints`
- automations/jobs: `automations`, `automation_runs`, `automation_step_runs`, `jobs`, `job_events`
- activity/audit: `record_activity_events`, `api_request_logs`, `integration_request_logs`
- document numbering: `document_sequence_definitions`, `document_sequence_counters`, `document_sequence_assignment_logs`

Storage coverage:

- `attachments` bucket
- `branding` bucket if it stores customer-specific assets

## Restore Test Procedure

1. Create a staging restore target isolated from production.
2. Restore the latest database backup into the restore target.
3. Restore or copy storage buckets into the restore target.
4. Apply migrations if the backup predates current schema.
5. Run:

```bash
SUPABASE_DB_URL="<restore-db-url>" python3 scripts/runtime_security_verify.py
python3 scripts/security_check.py --strict
```

6. Start API/worker against restore target with production-like env but non-production credentials.
7. Verify:
   - login works
   - workspace membership resolves correctly
   - a tenant A user cannot access tenant B records
   - attachments download only after app authorization
   - module manifests load
   - document numbering does not regress or duplicate
   - integrations are disabled or sandboxed to prevent outbound production calls
8. Record restore duration, errors, and manual fixes.

## Cadence

- Full restore test: quarterly.
- Backup integrity spot check: monthly.
- Restore test after major schema/security migration: required before production deploy.

## Acceptance Criteria

- Restore completes within the agreed RTO.
- Restored data meets RPO expectations.
- Runtime security verifier has no high/critical findings.
- Staging cross-tenant tests pass on restored data.
- No production integrations fire from restore environment.

