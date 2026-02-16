-- Template studio fields for email/doc templates

alter table email_templates
  add column if not exists is_active boolean not null default true,
  add column if not exists default_connection_id text null;

alter table email_outbox
  add column if not exists template_id uuid null;

alter table doc_templates
  add column if not exists filename_pattern text null,
  add column if not exists paper_size text not null default 'A4',
  add column if not exists margin_top text not null default '12mm',
  add column if not exists margin_right text not null default '12mm',
  add column if not exists margin_bottom text not null default '12mm',
  add column if not exists margin_left text not null default '12mm',
  add column if not exists header_html text null,
  add column if not exists footer_html text null;
