alter table modules_installed
  add column if not exists description text null,
  add column if not exists category text null,
  add column if not exists module_version text null,
  add column if not exists module_key text null,
  add column if not exists home_route text null;

update modules_installed as m
set
  description = coalesce(m.description, ms.manifest->'module'->>'description'),
  category = coalesce(m.category, ms.manifest->'module'->>'category'),
  module_version = coalesce(
    m.module_version,
    ms.manifest->'module'->>'version',
    ms.manifest->>'manifest_version'
  ),
  module_key = coalesce(
    m.module_key,
    ms.manifest->'module'->>'key',
    ms.manifest->'module'->>'id',
    m.module_id
  )
from manifest_snapshots as ms
where ms.org_id = m.org_id
  and ms.module_id = m.module_id
  and ms.manifest_hash = m.current_hash
  and (
    m.description is null
    or m.category is null
    or m.module_version is null
    or m.module_key is null
  );

create index if not exists modules_installed_org_enabled_order_idx
  on modules_installed (org_id, archived, enabled, display_order, module_id);
