# Operational Security Plan

Date: 2026-04-07

## Objective

Move Octodrop from secure-by-design controls to production operating readiness: detection, response, recovery, rotation, and recurring review.

## Current Control Baseline

- Auth failures emit structured warning logs from `app/auth.py`:
  - `auth_missing_token`
  - `auth_invalid_token`
  - `auth_invalid_api_key`
- API credential traffic is persisted in `api_request_logs`.
- Webhook ingestion writes `webhook_events`, including rejected signature state.
- Module install/apply/delete/rollback/upgrade paths write `module_audit`.
- Record activity events exist for record changes and attachments where activity is enabled.
- RLS and storage verification tooling exists:
  - `scripts/security_check.py --strict`
  - `scripts/runtime_security_verify.py`

## Operational Gaps

- Cross-tenant access denials are enforced but not yet consistently emitted as a dedicated `security_event`.
- Platform-role updates are controlled but need explicit audit entries beyond DB row state.
- `db_internal_service()` bypass paths are documented but not emitted as a metric/event per use.
- Webhook replay attempts are rejected by signing logic when timestamped verification is used, but replay-specific alerting depends on webhook secrets and event ids being configured.
- Backup restore is not yet proven by a timed test restore.
- Secret rotation exists at the store level, but there is no enforced rotation calendar or stale-secret alert.

## Production Operating Model

- Treat security logs and audit tables as operational signals, not just debugging output.
- Aggregate API logs into the deployment logging platform.
- Export database audit/activity tables to a retention layer if Supabase retention is insufficient.
- Review alert thresholds monthly after observing real traffic.
- Block go-live if runtime RLS verification fails or if the `attachments` bucket is public.

## Minimum Weekly Tasks

- Review auth failure trends.
- Review webhook signature failures and rejected webhook events.
- Review `api_request_logs` for unusual credential usage and rate-limit proximity.
- Review admin/module audit activity.
- Confirm no unreviewed `db_internal_service()` usage was added.

## Minimum Monthly Tasks

- Run `python3 scripts/security_check.py --strict`.
- Run `python3 scripts/runtime_security_verify.py` against staging and production.
- Review dependency audit results.
- Review stale secrets and upcoming rotation windows.
- Run one targeted cross-tenant staging test pass.

## Escalation Rules

- Any confirmed cross-tenant data exposure is a Severity 1 incident.
- Any public `attachments` bucket is a Severity 1 incident until fixed.
- Runtime DB role with `SUPERUSER` or `BYPASSRLS` is a Severity 1 incident.
- Active token/secret leak is at least Severity 2, Severity 1 if customer data is reachable.

