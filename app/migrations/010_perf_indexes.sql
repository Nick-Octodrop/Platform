create extension if not exists pg_trgm;

create index if not exists records_generic_id_idx
  on records_generic (id);

create index if not exists records_generic_data_trgm_idx
  on records_generic using gin ((data::text) gin_trgm_ops);
