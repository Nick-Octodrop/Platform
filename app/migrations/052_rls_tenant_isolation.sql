-- Phase 2 security: tenant isolation at the database/storage layer.
-- App code sets transaction-local app.org_id/app.user_id/app.internal_service
-- before DB operations. These policies provide database-level defense in depth;
-- production DB roles must not be superuser or BYPASSRLS roles.

create schema if not exists octo_security;

create or replace function octo_security.current_org_id()
returns text
language sql
stable
as $$
  select nullif(current_setting('app.org_id', true), '')
$$;

create or replace function octo_security.current_user_id()
returns text
language sql
stable
as $$
  select nullif(current_setting('app.user_id', true), '')
$$;

create or replace function octo_security.is_internal_service()
returns boolean
language sql
stable
as $$
  select coalesce(nullif(current_setting('app.internal_service', true), ''), 'false') = 'true'
$$;

create or replace function octo_security.path_workspace_id(object_name text)
returns text
language sql
immutable
as $$
  select nullif(split_part(coalesce(object_name, ''), '/', 1), '')
$$;

do $$
declare
  item text[];
  tbl regclass;
  table_name text;
  owner_column text;
begin
  foreach item slice 1 in array array[
    array['org_members','org_id'],
    array['modules_installed','org_id'],
    array['manifest_snapshots','org_id'],
    array['manifest_audit','org_id'],
    array['module_audit','org_id'],
    array['jobs','org_id'],
    array['workflow_instances','org_id'],
    array['contacts','org_id'],
    array['templates','org_id'],
    array['module_drafts','org_id'],
    array['records_chatter','org_id'],
    array['module_draft_versions','org_id'],
    array['saved_filters','org_id'],
    array['user_entity_prefs','org_id'],
    array['module_versions','org_id'],
    array['job_events','org_id'],
    array['notifications','org_id'],
    array['email_templates','org_id'],
    array['email_outbox','org_id'],
    array['attachments','org_id'],
    array['attachment_links','org_id'],
    array['doc_templates','org_id'],
    array['secrets','org_id'],
    array['connections','org_id'],
    array['automations','org_id'],
    array['automation_runs','org_id'],
    array['automation_step_runs','org_id'],
    array['workflow_instance_events','org_id'],
    array['workspace_ui_prefs','org_id'],
    array['user_ui_prefs','org_id'],
    array['record_activity_events','org_id'],
    array['integration_connection_secrets','org_id'],
    array['integration_mappings','org_id'],
    array['integration_webhooks','org_id'],
    array['webhook_events','org_id'],
    array['sync_checkpoints','org_id'],
    array['integration_request_logs','org_id'],
    array['api_credentials','org_id'],
    array['api_request_logs','org_id'],
    array['external_webhook_subscriptions','org_id'],
    array['workspace_access_profiles','org_id'],
    array['workspace_access_profile_assignments','org_id'],
    array['workspace_access_policy_rules','org_id'],
    array['document_sequence_definitions','org_id'],
    array['document_sequence_counters','org_id'],
    array['document_sequence_assignment_logs','org_id'],
    array['records_generic','tenant_id'],
    array['workspace_invites','workspace_id']
  ] loop
    table_name := item[1];
    owner_column := item[2];
    tbl := to_regclass(format('public.%I', table_name));
    if tbl is null then
      continue;
    end if;

    execute format('alter table %s enable row level security', tbl);
    execute format('alter table %s force row level security', tbl);

    execute format('drop policy if exists octo_tenant_select on %s', tbl);
    execute format('drop policy if exists octo_tenant_insert on %s', tbl);
    execute format('drop policy if exists octo_tenant_update on %s', tbl);
    execute format('drop policy if exists octo_tenant_delete on %s', tbl);

    execute format(
      'create policy octo_tenant_select on %s for select using (%I::text = octo_security.current_org_id() or octo_security.is_internal_service())',
      tbl,
      owner_column
    );
    execute format(
      'create policy octo_tenant_insert on %s for insert with check (%I::text = octo_security.current_org_id() or octo_security.is_internal_service())',
      tbl,
      owner_column
    );
    execute format(
      'create policy octo_tenant_update on %s for update using (%I::text = octo_security.current_org_id() or octo_security.is_internal_service()) with check (%I::text = octo_security.current_org_id() or octo_security.is_internal_service())',
      tbl,
      owner_column,
      owner_column
    );
    execute format(
      'create policy octo_tenant_delete on %s for delete using (%I::text = octo_security.current_org_id() or octo_security.is_internal_service())',
      tbl,
      owner_column
    );
  end loop;
end $$;

do $$
declare
  tbl regclass;
  table_name text;
begin
  tbl := to_regclass('public.workspaces');
  if tbl is not null then
    execute format('alter table %s enable row level security', tbl);
    execute format('alter table %s force row level security', tbl);
    execute format('drop policy if exists octo_workspaces_select on %s', tbl);
    execute format('drop policy if exists octo_workspaces_insert on %s', tbl);
    execute format('drop policy if exists octo_workspaces_update on %s', tbl);
    execute format('drop policy if exists octo_workspaces_delete on %s', tbl);
    execute format('create policy octo_workspaces_select on %s for select using (id::text = octo_security.current_org_id() or owner_user_id::text = octo_security.current_user_id() or octo_security.is_internal_service())', tbl);
    execute format('create policy octo_workspaces_insert on %s for insert with check (owner_user_id::text = octo_security.current_user_id() or octo_security.is_internal_service())', tbl);
    execute format('create policy octo_workspaces_update on %s for update using (id::text = octo_security.current_org_id() or owner_user_id::text = octo_security.current_user_id() or octo_security.is_internal_service()) with check (id::text = octo_security.current_org_id() or owner_user_id::text = octo_security.current_user_id() or octo_security.is_internal_service())', tbl);
    execute format('create policy octo_workspaces_delete on %s for delete using (id::text = octo_security.current_org_id() or owner_user_id::text = octo_security.current_user_id() or octo_security.is_internal_service())', tbl);
  end if;

  tbl := to_regclass('public.workspace_members');
  if tbl is not null then
    execute format('alter table %s enable row level security', tbl);
    execute format('alter table %s force row level security', tbl);
    execute format('drop policy if exists octo_workspace_members_select on %s', tbl);
    execute format('drop policy if exists octo_workspace_members_insert on %s', tbl);
    execute format('drop policy if exists octo_workspace_members_update on %s', tbl);
    execute format('drop policy if exists octo_workspace_members_delete on %s', tbl);
    execute format('create policy octo_workspace_members_select on %s for select using (workspace_id::text = octo_security.current_org_id() or user_id::text = octo_security.current_user_id() or octo_security.is_internal_service())', tbl);
    execute format('create policy octo_workspace_members_insert on %s for insert with check (workspace_id::text = octo_security.current_org_id() or octo_security.is_internal_service())', tbl);
    execute format('create policy octo_workspace_members_update on %s for update using (workspace_id::text = octo_security.current_org_id() or octo_security.is_internal_service()) with check (workspace_id::text = octo_security.current_org_id() or octo_security.is_internal_service())', tbl);
    execute format('create policy octo_workspace_members_delete on %s for delete using (workspace_id::text = octo_security.current_org_id() or octo_security.is_internal_service())', tbl);
  end if;

  tbl := to_regclass('public.orgs');
  if tbl is not null then
    execute format('alter table %s enable row level security', tbl);
    execute format('alter table %s force row level security', tbl);
    execute format('drop policy if exists octo_orgs_select on %s', tbl);
    execute format('drop policy if exists octo_orgs_insert on %s', tbl);
    execute format('drop policy if exists octo_orgs_update on %s', tbl);
    execute format('drop policy if exists octo_orgs_delete on %s', tbl);
    execute format('create policy octo_orgs_select on %s for select using (id::text = octo_security.current_org_id() or octo_security.is_internal_service())', tbl);
    execute format('create policy octo_orgs_insert on %s for insert with check (id::text = octo_security.current_org_id() or octo_security.is_internal_service())', tbl);
    execute format('create policy octo_orgs_update on %s for update using (id::text = octo_security.current_org_id() or octo_security.is_internal_service()) with check (id::text = octo_security.current_org_id() or octo_security.is_internal_service())', tbl);
    execute format('create policy octo_orgs_delete on %s for delete using (id::text = octo_security.current_org_id() or octo_security.is_internal_service())', tbl);
  end if;

  tbl := to_regclass('public.user_platform_roles');
  if tbl is not null then
    execute format('alter table %s enable row level security', tbl);
    execute format('alter table %s force row level security', tbl);
    execute format('drop policy if exists octo_user_platform_roles_select on %s', tbl);
    execute format('drop policy if exists octo_user_platform_roles_write on %s', tbl);
    execute format('create policy octo_user_platform_roles_select on %s for select using (user_id::text = octo_security.current_user_id() or octo_security.is_internal_service())', tbl);
    execute format('create policy octo_user_platform_roles_write on %s for all using (octo_security.is_internal_service()) with check (octo_security.is_internal_service())', tbl);
  end if;

  tbl := to_regclass('public.marketplace_apps');
  if tbl is not null then
    table_name := 'marketplace_apps';
    execute format('alter table %s enable row level security', tbl);
    execute format('alter table %s force row level security', tbl);
    execute format('drop policy if exists octo_marketplace_apps_select on %s', tbl);
    execute format('drop policy if exists octo_marketplace_apps_insert on %s', tbl);
    execute format('drop policy if exists octo_marketplace_apps_update on %s', tbl);
    execute format('drop policy if exists octo_marketplace_apps_delete on %s', tbl);
    execute format('create policy octo_marketplace_apps_select on %s for select using (status=''published'' or source_org_id::text = octo_security.current_org_id() or octo_security.is_internal_service())', tbl);
    execute format('create policy octo_marketplace_apps_insert on %s for insert with check (source_org_id::text = octo_security.current_org_id() or octo_security.is_internal_service())', tbl);
    execute format('create policy octo_marketplace_apps_update on %s for update using (source_org_id::text = octo_security.current_org_id() or octo_security.is_internal_service()) with check (source_org_id::text = octo_security.current_org_id() or octo_security.is_internal_service())', tbl);
    execute format('create policy octo_marketplace_apps_delete on %s for delete using (source_org_id::text = octo_security.current_org_id() or octo_security.is_internal_service())', tbl);
  end if;

  tbl := to_regclass('public.integration_providers');
  if tbl is not null then
    execute format('alter table %s enable row level security', tbl);
    execute format('drop policy if exists octo_integration_providers_select on %s', tbl);
    execute format('drop policy if exists octo_integration_providers_write on %s', tbl);
    execute format('create policy octo_integration_providers_select on %s for select using (octo_security.current_user_id() is not null or octo_security.current_org_id() is not null or octo_security.is_internal_service())', tbl);
    execute format('create policy octo_integration_providers_write on %s for all using (octo_security.is_internal_service()) with check (octo_security.is_internal_service())', tbl);
  end if;

  tbl := to_regclass('public.module_icons');
  if tbl is not null then
    execute format('alter table %s enable row level security', tbl);
    execute format('drop policy if exists octo_module_icons_read on %s', tbl);
    execute format('drop policy if exists octo_module_icons_write on %s', tbl);
    execute format('create policy octo_module_icons_read on %s for select using (octo_security.current_user_id() is not null or octo_security.current_org_id() is not null or octo_security.is_internal_service())', tbl);
    execute format('create policy octo_module_icons_write on %s for all using (octo_security.current_org_id() is not null or octo_security.is_internal_service()) with check (octo_security.current_org_id() is not null or octo_security.is_internal_service())', tbl);
  end if;
end $$;

-- Supabase Storage policy coverage for tenant-scoped object paths.
-- Private attachment objects must live under <workspace_id>/... in the attachments bucket.
-- Branding objects follow the same path convention; public branding delivery should be handled via bucket configuration.
do $$
declare
  storage_objects_oid oid;
  storage_objects_owner oid;
begin
  storage_objects_oid := to_regclass('storage.objects');
  if storage_objects_oid is not null then
    select relowner into storage_objects_owner from pg_class where oid = storage_objects_oid;
    if not pg_has_role(current_user, storage_objects_owner, 'MEMBER') then
      raise warning 'Skipping storage.objects policies: current role % is not owner/member of storage.objects owner role. Apply the storage policies via Supabase Storage policy UI or a role that owns storage.objects.', current_user;
      return;
    end if;

    alter table storage.objects enable row level security;

    drop policy if exists octo_attachments_storage_select on storage.objects;
    drop policy if exists octo_attachments_storage_insert on storage.objects;
    drop policy if exists octo_attachments_storage_update on storage.objects;
    drop policy if exists octo_attachments_storage_delete on storage.objects;
    drop policy if exists octo_branding_storage_select on storage.objects;
    drop policy if exists octo_branding_storage_insert on storage.objects;
    drop policy if exists octo_branding_storage_update on storage.objects;
    drop policy if exists octo_branding_storage_delete on storage.objects;

    create policy octo_attachments_storage_select on storage.objects
      for select to authenticated
      using (bucket_id = 'attachments' and octo_security.path_workspace_id(name) = octo_security.current_org_id());
    create policy octo_attachments_storage_insert on storage.objects
      for insert to authenticated
      with check (bucket_id = 'attachments' and octo_security.path_workspace_id(name) = octo_security.current_org_id());
    create policy octo_attachments_storage_update on storage.objects
      for update to authenticated
      using (bucket_id = 'attachments' and octo_security.path_workspace_id(name) = octo_security.current_org_id())
      with check (bucket_id = 'attachments' and octo_security.path_workspace_id(name) = octo_security.current_org_id());
    create policy octo_attachments_storage_delete on storage.objects
      for delete to authenticated
      using (bucket_id = 'attachments' and octo_security.path_workspace_id(name) = octo_security.current_org_id());

    create policy octo_branding_storage_select on storage.objects
      for select to authenticated
      using (bucket_id = 'branding' and octo_security.path_workspace_id(name) = octo_security.current_org_id());
    create policy octo_branding_storage_insert on storage.objects
      for insert to authenticated
      with check (bucket_id = 'branding' and octo_security.path_workspace_id(name) = octo_security.current_org_id());
    create policy octo_branding_storage_update on storage.objects
      for update to authenticated
      using (bucket_id = 'branding' and octo_security.path_workspace_id(name) = octo_security.current_org_id())
      with check (bucket_id = 'branding' and octo_security.path_workspace_id(name) = octo_security.current_org_id());
    create policy octo_branding_storage_delete on storage.objects
      for delete to authenticated
      using (bucket_id = 'branding' and octo_security.path_workspace_id(name) = octo_security.current_org_id());
  end if;
exception
  when insufficient_privilege then
    raise warning 'Skipping storage.objects policies due to insufficient privileges for role %. Apply equivalent Supabase Storage policies manually.', current_user;
end $$;
