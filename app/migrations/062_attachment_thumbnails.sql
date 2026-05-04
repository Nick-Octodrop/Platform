alter table attachments
  add column if not exists thumbnail_storage_key text null,
  add column if not exists thumbnail_mime_type text null,
  add column if not exists thumbnail_size int null,
  add column if not exists thumbnail_sha256 text null,
  add column if not exists thumbnail_bucket text null;

