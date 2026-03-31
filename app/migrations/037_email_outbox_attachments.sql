alter table email_outbox
  add column if not exists attachments_json jsonb null;
