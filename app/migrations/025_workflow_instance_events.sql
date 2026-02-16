-- Split workflow history into append-only events to avoid large row rewrites

create table if not exists workflow_instance_events (
  org_id text not null,
  instance_id text not null,
  event_id bigserial primary key,
  event jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists workflow_instance_events_org_instance_idx
  on workflow_instance_events (org_id, instance_id, event_id);

create index if not exists workflow_instances_org_module_workflow_idx
  on workflow_instances (org_id, module_id, workflow_id);

create index if not exists workflow_instances_org_module_idx
  on workflow_instances (org_id, module_id);
