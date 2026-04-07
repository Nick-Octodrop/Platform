# Audit Log Coverage Review

Date: 2026-04-07

## Covered Today

| Area | Coverage | Storage |
| --- | --- | --- |
| Module install/apply/delete/rollback/upgrade | Covered | `module_audit` |
| Record changes | Partially covered where activity is enabled | `record_activity_events` |
| Record comments/attachments | Partially covered | `record_activity_events` and attachment metadata |
| API credential request logs | Covered for external API requests | `api_request_logs` |
| Integration request logs | Covered for integration runtime request logs | `integration_request_logs` |
| Inbound webhook events | Covered, including rejected status | `webhook_events` |
| Document numbering assignments | Covered | `document_sequence_assignment_logs` |

## Gaps To Close

| Area | Gap | Risk | Recommendation |
| --- | --- | --- | --- |
| Platform role changes | `set_platform_role` mutates global security role without a dedicated audit event | Privilege escalation investigation is harder | Add `security_events` or `platform_role_audit` rows on every change. |
| Access profile assignments | Assignment/rule changes need explicit security audit trail | Hidden field/entity access can change silently | Add audit on profile/rule/assignment CRUD. |
| Cross-tenant denials | Denials return `404/403` but are not consistently recorded as security events | Probing can be missed | Add structured `security_event.cross_tenant_denied`. |
| Internal bypass usage | `db_internal_service()` paths are reviewed but not counted at runtime | Bypass growth may go unnoticed | Emit structured log/metric per bypass path with reason label. |
| Auth failures | Warning logs exist but not persisted in app DB | Retention depends on logging platform | Forward logs to central retention and alert on thresholds. |
| Secret reads/rotations | Secret rotation exists; read/resolve audit is limited | Secret misuse investigation is harder | Audit rotation and optionally privileged secret resolve events without secret values. |
| Worker jobs | Worker actions are logged mostly as job events/errors | Tenant context failures may be hard to trace | Include org id/job id/type in all worker security-relevant logs. |

## Audit Event Requirements

Every sensitive audit event should include:

- timestamp
- workspace/org id
- actor user id or system actor
- route/job id/source
- action
- target type and target id
- before/after metadata where safe
- request id/correlation id
- client IP/user agent for HTTP paths
- no raw secrets, tokens, or credentials

## Retention Recommendation

- Security logs: 180 days minimum.
- Admin/audit events: 1 year minimum.
- Incident evidence exports: preserve according to incident severity and legal guidance.

