-- Phase 1: notifications, email, attachments, documents

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  recipient_user_id text not null,
  title text not null,
  body text not null,
  severity text not null default 'info',
  link_to text null,
  created_at timestamptz not null default now(),
  read_at timestamptz null,
  source_event jsonb null
);

create index if not exists notifications_org_user_read_idx
  on notifications (org_id, recipient_user_id, read_at, created_at desc);

create table if not exists email_templates (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  name text not null,
  subject text not null,
  body_html text null,
  body_text text null,
  variables_schema jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists email_templates_org_updated_idx
  on email_templates (org_id, updated_at desc);

create table if not exists email_outbox (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  "to" jsonb not null,
  cc jsonb null,
  bcc jsonb null,
  from_email text not null,
  reply_to text null,
  subject text not null,
  body_html text null,
  body_text text null,
  status text not null default 'queued',
  provider_message_id text null,
  last_error text null,
  created_at timestamptz not null default now(),
  sent_at timestamptz null
);

create index if not exists email_outbox_org_status_idx
  on email_outbox (org_id, status, created_at desc);

create table if not exists attachments (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  filename text not null,
  mime_type text not null,
  size int not null,
  storage_key text not null,
  sha256 text not null,
  created_by text null,
  created_at timestamptz not null default now(),
  source text not null default 'upload'
);

create index if not exists attachments_org_created_idx
  on attachments (org_id, created_at desc);

create table if not exists attachment_links (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  attachment_id uuid not null references attachments(id) on delete cascade,
  entity_id text not null,
  record_id uuid not null,
  purpose text null,
  created_at timestamptz not null default now()
);

create index if not exists attachment_links_org_entity_record_idx
  on attachment_links (org_id, entity_id, record_id);

create table if not exists doc_templates (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  name text not null,
  format text not null default 'html',
  html text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists doc_templates_org_updated_idx
  on doc_templates (org_id, updated_at desc);
