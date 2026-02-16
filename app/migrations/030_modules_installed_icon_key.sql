alter table modules_installed
  add column if not exists icon_key text null;
