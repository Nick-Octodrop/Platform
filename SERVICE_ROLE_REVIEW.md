# Service Role Review

## Service-Role / Bypass Paths Found

| Path | Component | Why it bypasses normal tenant policy | Required control |
| --- | --- | --- | --- |
| Supabase Storage operations | `app/attachments.py` | Uses `SUPABASE_SERVICE_ROLE_KEY` for upload/download/delete | Keep bucket private; app authorization before every object operation; storage policies for direct client access. |
| API credential lookup | `app/auth.py` -> `DbApiCredentialStore.get_by_key_hash_any` | Needs to find credential before workspace is known | Wrapped in `db_internal_service()`; query is by key hash only. |
| API credential last-used update | `app/auth.py` -> `touch_last_used_any` | Updates by credential id after credential auth | Wrapped in `db_internal_service()`; should later move to scoped RPC. |
| Inbound webhook lookup | `app/main.py` -> `integration_webhook_store.get_any` | Needs to resolve workspace from opaque webhook id | Wrapped in `db_internal_service()`; webhook id must remain high entropy. |
| Marketplace app catalog operations | `app/main.py` | Published app catalog and global slug/status operations cross workspace boundaries | Wrapped in `db_internal_service()` for marketplace DB operations; route still enforces superadmin where mutation is allowed. |
| Platform role updates | `app/workspaces.py` | Platform roles are global security metadata, not tenant-owned rows | Wrapped in `db_internal_service()` for role upsert only. |
| Integration provider bootstrap | `app/stores_db.py` | System provider definitions are shared platform metadata | Wrapped in `db_internal_service()` for bootstrap upserts only. |
| Workers | `app/worker.py` | Workers process jobs outside request middleware | Must set org context from job payload before DB/storage operations. |
| Migration runner | deployment | Migrations need DDL privileges | Use migration-only credentials, not runtime API credentials. |

## Production Requirements

- Runtime DB user must not be superuser and must not have `BYPASSRLS`.
- `SUPABASE_SERVICE_ROLE_KEY` must exist only in backend/worker secrets, never frontend envs.
- Every use of `db_internal_service()` must be listed here and reviewed.
- Any new cross-tenant lookup should prefer a narrow `SECURITY DEFINER` RPC over broad service context.

## Open Follow-Ups

- Add startup check to detect unsafe production DB role where possible.
- Add worker tests proving org context is set before DB/storage operations.
- Replace internal GUC bypasses with audited RPCs if the set grows.
