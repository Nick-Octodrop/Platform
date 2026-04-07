# Tenant Isolation Test Matrix

| Area | Test | Current status |
| --- | --- | --- |
| Generic records get | Workspace A cannot get workspace B record by id | Memory test exists; DB/RLS test needed. |
| Generic records list/search | Workspace A list/search never returns workspace B rows | DB/RLS test needed. |
| Generic records update/delete | Workspace A cannot mutate workspace B rows | DB/RLS test needed. |
| Attachments download | Active workspace A cannot download workspace B attachment id | App-layer fix added; route test needed. |
| Attachments link/list/delete | User must have record read/write access before file link/list/delete | App-layer fix added; route test needed. |
| Admin endpoints | Standard user cannot access settings, access profiles, Studio admin, integrations admin | Partial helper tests exist; route matrix needed. |
| API credentials | Key hash lookup works only through internal context; normal users cannot enumerate cross-tenant credentials | DB/RLS test needed. |
| Inbound webhooks | Opaque webhook id resolves under internal context and writes event in resolved org only | DB/RLS test needed. |
| Worker jobs | Worker sets org context from job payload before DB/storage operations | Test needed. |
| Studio generated modules | Generated records stay in `records_generic.tenant_id`; no generated physical table without ownership/RLS | Manifest security test needed. |
| Storage objects | Authenticated workspace A cannot read/write/delete `attachments/<workspace B>/...` | Supabase integration test needed. |
| Migration guardrail | Strict scanner fails if tenant table lacks ownership/RLS/storage policy coverage | Unit tests added for ownership/storage checks. |

## Minimum DB Integration Test Harness

Use a non-superuser, non-`BYPASSRLS` role against a disposable Postgres/Supabase database:

1. Apply migrations.
2. Insert rows for `tenant-a` and `tenant-b` using migration/admin credentials.
3. Connect as runtime role.
4. `set_config('app.org_id', 'tenant-a', true)`.
5. Assert tenant B rows are invisible and not mutable.
6. Repeat for records, attachments metadata, jobs, secrets, integrations, access policies, and numbering tables.

## Required Negative Tests

- No `app.org_id` set should return no tenant rows.
- Wrong `app.org_id` should return no tenant rows.
- `app.internal_service=false` should not bypass policies.
- `app.internal_service=true` should only be used in explicitly reviewed tests for API credential/webhook lookup paths.
