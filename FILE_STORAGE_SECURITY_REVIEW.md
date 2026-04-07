# File Storage Security Review

## Current Model

Uploads are handled by FastAPI, then stored via `app/attachments.py` using local filesystem or Supabase Storage. Attachment metadata is tenant-scoped. Downloads are proxied through the API.

## Fixes Applied

- Direct attachment download now checks only the active workspace instead of all actor workspaces.
- Attachment link/list/delete now validates the target record's read/write access.
- Uploads now enforce `OCTO_MAX_UPLOAD_BYTES`, defaulting to 10MB.

## Remaining Gaps

- Uploads are still read into memory before storage.
- Content type and file extension allowlists are not yet enforced.
- Live Supabase bucket privacy and storage policies were not verified from code alone.
- Virus/malware scanning is not implemented.
- Public branding/logo bucket must remain isolated from private attachment storage.

## Required Next Steps

- Verify private attachment bucket and public branding bucket configuration in Supabase.
- Add storage RLS/policies and tests.
- Add streaming upload limits.
- Add optional malware scanning for high-risk file types.
- Add signed preview/download URLs only after app authorization, with short expiry.

