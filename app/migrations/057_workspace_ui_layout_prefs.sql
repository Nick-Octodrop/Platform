alter table if exists workspace_ui_prefs
  add column if not exists layout_prefs jsonb null;
