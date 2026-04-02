create table if not exists document_sequence_definitions (
  id text primary key,
  org_id text not null,
  code text not null,
  name text not null,
  target_entity_id text not null,
  number_field_id text not null,
  description text null,
  is_active boolean not null default true,
  pattern text not null,
  scope_type text not null default 'global',
  scope_field_id text null,
  reset_policy text not null default 'never',
  assign_on text not null default 'create',
  trigger_status_values_json jsonb not null default '[]'::jsonb,
  lock_after_assignment boolean not null default true,
  allow_admin_override boolean not null default false,
  notes text null,
  sort_order integer not null default 100,
  created_by text null,
  updated_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_sequence_definitions_scope_type_chk
    check (scope_type in ('global', 'entity', 'workspace')),
  constraint document_sequence_definitions_reset_policy_chk
    check (reset_policy in ('never', 'yearly', 'monthly')),
  constraint document_sequence_definitions_assign_on_chk
    check (assign_on in ('create', 'save', 'confirm', 'issue', 'custom'))
);

create unique index if not exists document_sequence_definitions_org_code_idx
  on document_sequence_definitions (org_id, code);

create unique index if not exists document_sequence_definitions_org_target_field_idx
  on document_sequence_definitions (org_id, target_entity_id, number_field_id);

create index if not exists document_sequence_definitions_org_entity_idx
  on document_sequence_definitions (org_id, target_entity_id, is_active, sort_order, created_at);

create table if not exists document_sequence_counters (
  id text primary key,
  org_id text not null,
  sequence_definition_id text not null references document_sequence_definitions (id) on delete cascade,
  scope_key text not null,
  bucket_year integer null,
  bucket_month integer null,
  current_value bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists document_sequence_counters_org_bucket_idx
  on document_sequence_counters (org_id, sequence_definition_id, scope_key, bucket_year, bucket_month);

create index if not exists document_sequence_counters_org_sequence_idx
  on document_sequence_counters (org_id, sequence_definition_id, updated_at desc);

create table if not exists document_sequence_assignment_logs (
  id text primary key,
  org_id text not null,
  sequence_definition_id text not null references document_sequence_definitions (id) on delete cascade,
  target_entity_id text not null,
  target_record_id text not null,
  number_field_id text not null,
  assigned_number text not null,
  assigned_on_event text not null,
  scope_key text not null,
  bucket_year integer null,
  bucket_month integer null,
  counter_value bigint not null,
  assigned_by text null,
  created_at timestamptz not null default now()
);

create unique index if not exists document_sequence_assignment_logs_org_record_idx
  on document_sequence_assignment_logs (org_id, sequence_definition_id, target_record_id);

create unique index if not exists document_sequence_assignment_logs_org_number_idx
  on document_sequence_assignment_logs (org_id, sequence_definition_id, assigned_number);

create index if not exists document_sequence_assignment_logs_org_entity_idx
  on document_sequence_assignment_logs (org_id, target_entity_id, created_at desc);
