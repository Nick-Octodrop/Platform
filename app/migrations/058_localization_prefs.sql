alter table if exists workspace_ui_prefs
  add column if not exists default_locale text null,
  add column if not exists default_timezone text null,
  add column if not exists default_currency text null;

alter table if exists user_ui_prefs
  add column if not exists locale text null,
  add column if not exists timezone text null;
