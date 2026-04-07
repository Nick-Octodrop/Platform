# Storage Policy Review

## Current Storage Model

`app/attachments.py` stores objects under:

```text
<workspace_id>/<sha256>_<safe_filename>
```

Default buckets:

- Private attachments: `attachments`
- Branding/logo assets: `branding`

## Policies Added

Migration `app/migrations/052_rls_tenant_isolation.sql` attempts to add Supabase Storage policies on `storage.objects` for:

- `octo_attachments_storage_select`
- `octo_attachments_storage_insert`
- `octo_attachments_storage_update`
- `octo_attachments_storage_delete`
- `octo_branding_storage_select`
- `octo_branding_storage_insert`
- `octo_branding_storage_update`
- `octo_branding_storage_delete`

All policies require:

```sql
bucket_id = '<bucket>'
and octo_security.path_workspace_id(name) = octo_security.current_org_id()
```

The migration skips this section with a warning if the current SQL role does not own or inherit ownership of Supabase's managed `storage.objects` table. In that case the tenant-table RLS migration can still succeed, but the storage policies must be added through the Supabase Storage policy UI or a role that can manage `storage.objects`.

## Important Limitation

Backend storage calls still use `SUPABASE_SERVICE_ROLE_KEY`, which bypasses storage RLS. Therefore app-layer authorization remains mandatory for server-side upload/download/delete. The storage policies are for direct authenticated Supabase access and defense in depth.

## Required Manual Supabase Review

- Confirm `attachments` bucket is private.
- Confirm `branding` bucket public/private decision is intentional.
- Confirm the storage policies above exist after deployment; if migration printed a skip warning, create them manually in Supabase.
- Confirm no other public bucket contains tenant files.
- Confirm direct unauthenticated access to `attachments/<workspace_id>/...` fails.
- Confirm authenticated user for workspace A cannot access `attachments/<workspace B>/...`.

## Next Controls

- Add signed URL issuance only after app authorization.
- Add content type/extension allowlist for high-risk file types.
- Add malware scanning if customer uploads can contain untrusted office/PDF files.
