alter table modules_installed
  add column if not exists display_order int null;
