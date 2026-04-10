# Manifest Spec

This is the practical authoring contract for current Octodrop modules.

Use this instead of inventing structure ad hoc.
If this file conflicts with the validator, the validator wins.

Primary validator source:
- [manifest_validate.py](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/app/manifest_validate.py)

Supporting contract:
- [MANIFEST_CONTRACT.md](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/MANIFEST_CONTRACT.md)

## 1. Required Top-Level Shape

Minimum valid v1 module:

```json
{
  "manifest_version": "1.3",
  "module": {
    "id": "contacts",
    "key": "contacts",
    "name": "Contacts",
    "version": "1.0.0"
  },
  "app": {
    "home": "page:contact.list_page"
  },
  "entities": [],
  "views": []
}
```

Required:
- `manifest_version`
- `module.id`
- `entities`
- `views`

Strongly recommended:
- `module.key`
- `module.description`
- `module.category`
- `module.icon_key`
- `app.defaults`
- `app.nav`
- `pages`
- `actions`

Allowed top-level keys:
- `manifest_version`
- `module`
- `depends_on`
- `entities`
- `views`
- `relations`
- `workflows`
- `actions`
- `triggers`
- `queries`
- `interfaces`
- `app`
- `pages`
- `modals`
- `transformations`

## 2. Module Block

Recommended canonical shape:

```json
"module": {
  "id": "work_orders",
  "key": "work_orders",
  "name": "Work Orders",
  "version": "1.0.0",
  "description": "Operational work order management.",
  "category": "Operations",
  "icon_key": "lucide:BriefcaseBusiness"
}
```

Rules:
- `module.id` is the runtime module id.
- `module.key` should be stable across installs/upgrades.
- `module.name` is what users see.
- `module.version` should move when the manifest meaningfully changes.

## 3. App Block

Canonical shape:

```json
"app": {
  "home": "page:work_order.list_page",
  "defaults": {
    "entity_home_page": "page:work_order.list_page",
    "entity_form_page": "page:work_order.form_page",
    "entities": {
      "entity.work_order": {
        "entity_home_page": "page:work_order.list_page",
        "entity_form_page": "page:work_order.form_page"
      }
    }
  },
  "nav": [
    {
      "group": "Operations",
      "items": [
        { "label": "Work Orders", "to": "page:work_order.list_page" }
      ]
    }
  ]
}
```

Rules:
- `app.home` must point to a real page or view target.
- For production modules, prefer a page target over a raw view target.
- Define per-entity defaults for the main entities users will open.
- `nav` items must resolve to real targets.

## 4. Entities

Canonical entity shape:

```json
{
  "id": "entity.work_order",
  "label": "Work Order",
  "display_field": "work_order.number",
  "fields": []
}
```

Field rules:
- Use fully-qualified field ids: `work_order.number`, not `number`.
- Field ids must stay consistent across entities, views, actions, workflows, conditions.
- `display_field` should be a human-readable title/number field, not a UUID.

Allowed field types:
- `string`
- `text`
- `number`
- `bool`
- `date`
- `datetime`
- `enum`
- `uuid`
- `lookup`
- `tags`
- `attachments`
- `user`
- `users`

Common field guidance:
- `uuid`: internal ids, usually readonly
- `enum`: use for statuses/types with explicit `options`
- `lookup`: always define `entity`; define `display_field` where possible
- `user` / `users`: use for owner/assignee/participants
- `attachments`: use when record-owned files matter

## 5. Views

Minimum useful module:
- one list view
- one form view

Recommended:
- list
- form
- kanban if status/stage-driven
- graph if summarisation matters
- calendar if date-driven

### List view

```json
{
  "id": "work_order.list",
  "kind": "list",
  "entity": "entity.work_order",
  "columns": [
    { "field_id": "work_order.number" },
    { "field_id": "work_order.title" },
    { "field_id": "work_order.status" }
  ],
  "header": {
    "primary_actions": [{ "action_id": "action.work_order_new" }],
    "open_record_target": "page:work_order.form_page",
    "search": {
      "enabled": true,
      "fields": ["work_order.number", "work_order.title"]
    },
    "filters": [
      { "id": "all", "label": "All", "domain": { "op": "exists", "field": "work_order.number" } }
    ]
  }
}
```

### Form view

```json
{
  "id": "work_order.form",
  "kind": "form",
  "entity": "entity.work_order",
  "sections": [
    {
      "id": "main",
      "title": "Work Order",
      "layout": "columns",
      "columns": 2,
      "fields": [
        "work_order.number",
        "work_order.status"
      ]
    }
  ],
  "header": {
    "secondary_actions": []
  },
  "activity": {
    "enabled": true,
    "show_changes": true,
    "allow_comments": true,
    "allow_attachments": true,
    "tracked_fields": ["work_order.number", "work_order.status"]
  }
}
```

Rules:
- Form sections should use real field ids only.
- `activity.enabled` should be explicit when record activity matters.
- `tracked_fields` should list only fields users actually care about in the feed.

## 6. Pages

Use pages as the canonical shell targets.

Recommended list page:

```json
{
  "id": "work_order.list_page",
  "title": "Work Orders",
  "layout": "single",
  "header": { "variant": "none" },
  "content": [
    {
      "kind": "container",
      "variant": "card",
      "content": [
        { "kind": "view", "target": "view:work_order.list" }
      ]
    }
  ]
}
```

Recommended form page:

```json
{
  "id": "work_order.form_page",
  "title": "Work Order",
  "layout": "single",
  "header": { "variant": "none" },
  "content": [
    {
      "kind": "container",
      "variant": "card",
      "content": [
        { "kind": "view", "target": "view:work_order.form" }
      ]
    }
  ]
}
```

Rules:
- Prefer page targets in `app.home`, nav, open-record flows, and defaults.
- Use `container` blocks for normal app card surfaces.
- Use `view_modes` when one page must switch between list/kanban/graph/calendar generically.

## 7. Actions

Canonical pattern:

```json
"actions": [
  {
    "id": "action.work_order_new",
    "kind": "open_form",
    "label": "New Work Order",
    "target": "work_order.form"
  }
]
```

Supported action kinds:
- `navigate`
- `open_form`
- `refresh`
- `create_record`
- `update_record`
- `bulk_update`
- `transform_record`

Rules:
- Define actions once at top level and reference them from headers where possible.
- Use `enabled_when` and `visible_when` for action state.
- Use `transform_record` for record-to-record business flows.

## 8. Conditions

Conditions are used in manifests for:
- action enablement
- action visibility
- workflow/validation logic
- domains and UI gating

Canonical shape:

```json
{ "op": "eq", "field": "work_order.status", "value": "open" }
```

Composite shape:

```json
{
  "op": "and",
  "conditions": [
    { "op": "exists", "field": "work_order.assignee_id" },
    { "op": "neq", "field": "work_order.status", "value": "cancelled" }
  ]
}
```

Use only validator-supported keys in manifests:
- `op`
- `field`
- `value`
- `left`
- `right`
- `conditions`
- `condition`

Anti-pattern:
- do not mix manifest condition shape with automation-editor condition shape when writing manifests by hand

## 9. Workflows

Use workflows when the entity has a true status process, not just a decorative enum.

Canonical shape:

```json
{
  "id": "workflow.work_order",
  "entity": "entity.work_order",
  "status_field": "work_order.status",
  "states": [
    { "id": "new", "label": "New", "order": 1 },
    { "id": "in_progress", "label": "In Progress", "order": 2 },
    { "id": "completed", "label": "Completed", "order": 3 }
  ],
  "transitions": [
    { "from": "new", "to": "in_progress", "label": "Start" },
    { "from": "in_progress", "to": "completed", "label": "Complete" }
  ]
}
```

## 10. Interfaces

Use `interfaces` only when the module truly participates in shared system surfaces.

Current useful patterns:
- `schedulable`
- `documentable`
- `dashboardable`

Do not add interface config unless the entity should appear in those generic system areas.

## 11. Transformations

Use `transformations` for explicit business flows between entities.

Typical use:
- quote -> order
- order -> invoice
- job -> document

Rules:
- define source and target entities explicitly
- use field mappings, child mappings, and validation rules intentionally
- prefer transformations over opaque custom action side effects

## 12. Known Anti-Patterns

- Using UUID fields as user-facing titles
- Shipping only views with no pages/defaults
- Using hardcoded workspace labels in canonical modules
- Defining `lookup` fields without `entity`
- Creating a workflow enum without a real workflow definition where state actions matter
- Relying on hidden implicit defaults instead of explicit `app.defaults`
