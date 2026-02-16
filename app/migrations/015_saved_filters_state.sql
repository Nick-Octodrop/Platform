alter table saved_filters
  add column if not exists state jsonb;
