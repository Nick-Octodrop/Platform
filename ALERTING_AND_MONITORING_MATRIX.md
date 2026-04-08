# Alerting And Monitoring Matrix

Date: 2026-04-07

## Alert Signals

| Signal | Source | Threshold | Severity | Why |
| --- | --- | --- | --- | --- |
| Repeated missing bearer/API tokens | App logs: `auth_missing_token` | >50 per 5 min per IP or >200 per 5 min global | Medium | Detect scanners and broken clients. |
| Invalid JWTs | App logs: `auth_invalid_token` | >20 per 5 min per IP/user agent | High | Detect token guessing, stale stolen tokens, or integration misuse. |
| Invalid API keys | App logs: `auth_invalid_api_key` | >10 per 5 min per IP or credential prefix pattern | High | Detect brute force or leaked integration config. |
| 401/403 spike | API gateway/access logs | 3x baseline over 10 min | Medium | Detect permission probing and broken deploys. |
| Cross-tenant denial attempts | API logs with `RECORD_NOT_FOUND`, `FORBIDDEN`, `WORKSPACE_FORBIDDEN` plus mismatched workspace context | Any clear repeated pattern | High | Detect tenant boundary probing. Dedicated security event still recommended. |
| Webhook signature failure | `webhook_events.status='rejected'` or API response `WEBHOOK_SIGNATURE_INVALID` | >5 per webhook per 10 min | High | Detect forged webhook attempts or broken signing config. |
| Webhook replay/expired timestamp | webhook verification reason/log if available | Any repeated event | High | Detect replay attempts. |
| Admin permission change | `user_platform_roles` changes and access profile assignment changes | Any production change outside change window | High | Privilege escalation risk. Needs explicit audit event. |
| Module/Studio apply/delete/rollback | `module_audit` | Any production change outside change window | High | Generated modules can affect authorization and data shape. |
| Internal bypass usage | Code paths using `db_internal_service()` | New path or unexpected volume | High | Bypass contexts cross normal RLS boundaries. Needs metric/event instrumentation. |
| Public attachments bucket | `scripts/runtime_security_verify.py` finding `ATTACHMENTS_BUCKET_PUBLIC` | Any | Critical | Direct file exposure. |
| Runtime DB role unsafe | `RUNTIME_ROLE_SUPERUSER` or `RUNTIME_ROLE_BYPASSRLS` | Any | Critical | RLS ineffective. |
| RLS/policy missing | `scripts/runtime_security_verify.py` high finding | Any | Critical | Tenant isolation may be ineffective. |

## Example Database Checks

Rejected webhooks:

```sql
select org_id, connection_id, count(*) as rejected_count
from webhook_events
where status = 'rejected'
  and received_at >= now() - interval '10 minutes'
group by org_id, connection_id
having count(*) > 5;
```

External API 401/403 volume:

```sql
select org_id, api_credential_id, status_code, count(*) as total
from api_request_logs
where created_at >= now() - interval '10 minutes'
  and status_code in (401, 403, 429)
group by org_id, api_credential_id, status_code
order by total desc;
```

Module audit changes:

```sql
select org_id, module_id, audit_id, audit, created_at
from module_audit
where created_at >= now() - interval '24 hours'
order by created_at desc;
```

## Required Instrumentation Improvements

- Add a dedicated `security_events` table or structured log event for:
  - cross-tenant record denial
  - workspace forbidden
  - platform role change
  - access profile assignment change
  - `db_internal_service()` usage
- Add dashboard/alert wiring in the chosen logging platform.
- Add request id, workspace id, actor id, route, status code, and client IP to every security-relevant log.

## Security Center

Octodrop includes a superadmin-only Security Center at `/security`.

Use it for investigation and review of existing security-relevant telemetry:

- external API request denials and 5xx responses from `api_request_logs`
- rejected or failed webhook events from `webhook_events`
- failed integration calls from `integration_request_logs`
- module install/apply/rollback activity from `module_audit`
- current `superadmin` platform role rows

This page is not the paging channel. Production critical alerts should still be routed through the deployment/logging
provider to Slack, email, or on-call tooling.
