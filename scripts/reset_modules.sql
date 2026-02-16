-- DEV/RESET ONLY: This wipes all installed modules and their data.
-- It does NOT touch auth/users/settings/system metadata.

begin;

truncate table modules_installed;
truncate table manifest_snapshots;
truncate table module_audit;
truncate table records_generic;

commit;
