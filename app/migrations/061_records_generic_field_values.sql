create table if not exists records_generic_field_values (
  tenant_id text not null,
  entity_id text not null,
  record_id text not null,
  field_id text not null,
  value_text text,
  value_num numeric,
  value_bool boolean,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, entity_id, record_id, field_id)
);

insert into records_generic_field_values (
  tenant_id,
  entity_id,
  record_id,
  field_id,
  value_text,
  value_num,
  value_bool,
  updated_at
)
select
  r.tenant_id,
  r.entity_id,
  r.id::text,
  item.key,
  case
    when jsonb_typeof(item.value) = 'null' then null
    else item.value #>> '{}'
  end as value_text,
  case
    when jsonb_typeof(item.value) = 'number' then (item.value #>> '{}')::numeric
    else null
  end as value_num,
  case
    when jsonb_typeof(item.value) = 'boolean' then (item.value #>> '{}')::boolean
    else null
  end as value_bool,
  r.updated_at
from records_generic r
cross join lateral jsonb_each(r.data) as item(key, value)
where jsonb_typeof(item.value) in ('string', 'number', 'boolean', 'null')
on conflict (tenant_id, entity_id, record_id, field_id)
do update set
  value_text = excluded.value_text,
  value_num = excluded.value_num,
  value_bool = excluded.value_bool,
  updated_at = excluded.updated_at;

create index if not exists records_generic_field_values_field_idx
  on records_generic_field_values (tenant_id, entity_id, field_id, updated_at desc, record_id);

drop index if exists records_generic_field_values_text_idx;

create index if not exists records_generic_field_values_text_idx
  on records_generic_field_values (tenant_id, entity_id, field_id, md5(value_text), updated_at desc, record_id)
  where value_text is not null;

drop index if exists records_generic_field_values_lower_text_idx;

create index if not exists records_generic_field_values_lower_text_idx
  on records_generic_field_values (
    tenant_id,
    entity_id,
    field_id,
    (left(lower(value_text), 512)) text_pattern_ops,
    updated_at desc,
    record_id
  )
  where value_text is not null;

create index if not exists records_generic_field_values_num_idx
  on records_generic_field_values (tenant_id, entity_id, field_id, value_num, updated_at desc, record_id)
  where value_num is not null;

create index if not exists records_generic_field_values_record_idx
  on records_generic_field_values (tenant_id, entity_id, record_id);

create or replace function records_generic_field_values_cleanup()
returns trigger
language plpgsql
as $$
begin
  delete from records_generic_field_values
  where tenant_id = old.tenant_id
    and entity_id = old.entity_id
    and record_id = old.id::text;
  return old;
end $$;

drop trigger if exists records_generic_field_values_cleanup_trigger on records_generic;

create trigger records_generic_field_values_cleanup_trigger
after delete on records_generic
for each row
execute function records_generic_field_values_cleanup();

do $$
declare
  tbl regclass;
begin
  tbl := to_regclass('public.records_generic_field_values');
  if tbl is null then
    return;
  end if;

  execute format('alter table %s enable row level security', tbl);
  execute format('alter table %s force row level security', tbl);

  execute format('drop policy if exists octo_tenant_select on %s', tbl);
  execute format('drop policy if exists octo_tenant_insert on %s', tbl);
  execute format('drop policy if exists octo_tenant_update on %s', tbl);
  execute format('drop policy if exists octo_tenant_delete on %s', tbl);

  execute format(
    'create policy octo_tenant_select on %s for select using (tenant_id::text = octo_security.current_org_id() or octo_security.is_internal_service())',
    tbl
  );
  execute format(
    'create policy octo_tenant_insert on %s for insert with check (tenant_id::text = octo_security.current_org_id() or octo_security.is_internal_service())',
    tbl
  );
  execute format(
    'create policy octo_tenant_update on %s for update using (tenant_id::text = octo_security.current_org_id() or octo_security.is_internal_service()) with check (tenant_id::text = octo_security.current_org_id() or octo_security.is_internal_service())',
    tbl
  );
  execute format(
    'create policy octo_tenant_delete on %s for delete using (tenant_id::text = octo_security.current_org_id() or octo_security.is_internal_service())',
    tbl
  );
end $$;
