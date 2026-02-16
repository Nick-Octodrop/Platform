alter table if exists workspace_ui_prefs
  add column if not exists logo_url text null;
