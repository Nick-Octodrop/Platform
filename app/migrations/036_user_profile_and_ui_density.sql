alter table if exists workspace_ui_prefs
  add column if not exists ui_density text null;

alter table if exists user_ui_prefs
  add column if not exists ui_density text null,
  add column if not exists first_name text null,
  add column if not exists last_name text null,
  add column if not exists phone text null;

