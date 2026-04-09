create index if not exists records_generic_data_path_idx
  on records_generic using gin (data jsonb_path_ops);
