alter table doc_templates
  add column if not exists description text null;
