-- Lock down legacy/backup tables that should never be exposed through PostgREST.
-- Supabase flags these when they live in public without RLS enabled.
-- We force RLS and allow only internal-service access.

do $$
declare
  table_name text;
  tbl regclass;
begin
  foreach table_name in array array[
    'jobs_legacy',
    'records_generic_backup_contacts_projects',
    'records_generic_backup_fix_contacts_projects'
  ] loop
    tbl := to_regclass(format('public.%I', table_name));
    if tbl is null then
      continue;
    end if;

    execute format('alter table %s enable row level security', tbl);
    execute format('alter table %s force row level security', tbl);

    execute format('revoke all on table %s from public', tbl);
    execute format('revoke all on table %s from anon', tbl);
    execute format('revoke all on table %s from authenticated', tbl);

    execute format('drop policy if exists octo_internal_service_only on %s', tbl);
    execute format(
      'create policy octo_internal_service_only on %s for all using (octo_security.is_internal_service()) with check (octo_security.is_internal_service())',
      tbl
    );
  end loop;
end $$;
