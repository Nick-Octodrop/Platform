alter table doc_templates
  add column if not exists variables_schema jsonb not null default '{}'::jsonb;
