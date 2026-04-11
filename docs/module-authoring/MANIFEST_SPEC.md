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

Business-facing identity:
- do not use UUIDs as user-facing identifiers
- where a record needs a formal number, design for a real business identifier
- where settings-driven numbering exists, do not hardcode numbering formats into the module
- document-like records should be authored with numbering expectations in mind

Typical numbered records:
- Quote Number
- Sales Order Number
- Purchase Order Number
- Invoice Number
- Work Order Number

### Field Modeling Beyond CRUD

Do not model fields only for storage.
Model them so conditions, expressions, automations, and future builders can reason over them.

Expressions / conditions:
- enums should have explicit options
- numeric and date fields should use real numeric/date types
- booleans should be booleans, not strings
- lookups and users should use real typed fields, not copied labels

Currency / UOM awareness:
- if a record includes monetary values, define currency handling intentionally
- if a record includes measurable quantities, define UOM-related fields intentionally
- avoid plain number fields when the business meaning requires amount + currency or quantity + unit context

Good:
- `invoice.total_amount` + `invoice.currency`
- `line.quantity` + `line.uom`

Bad:
- `invoice.total` as an unqualified number
- `quantity` with no unit where unit context matters

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

### Workflow Awareness

If a record has meaningful lifecycle state:
- design a real workflow, not just a decorative enum
- align status actions to real transitions
- make required fields by state intentional where appropriate

Do not:
- create a status field with no real process meaning
- add transition actions that do not map to real lifecycle steps

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

## 7. Action Authoring Guidance

Actions are not limited to CRUD and simple workflow buttons.
Author the actions that users actually expect for the record lifecycle.

Valid action categories may include:
- create new related/business record
- workflow transition
- navigate
- refresh
- transform record
- generate document
- create/send email
- upload/request attachment
- archive / duplicate
- start automation or trigger an operational process
- open modal for confirmation or additional input
- other contextual business actions that are meaningful for the record type

Rules:
- actions should be intentional and relevant to the record lifecycle
- document/email/automation actions should be included where they are a normal user expectation for that record type
- attachment upload/request actions should be included where supporting files are operationally important
- use the same `visible_when` / `enabled_when` discipline for these actions as for workflow actions
- rarely used actions should live in the overflow menu, not the primary header area
- one obvious next action should usually be visible for the current state
- destructive/admin actions should not dominate the header
- archive is usually safer than delete for operational records
- do not add actions just because the runtime supports them
- actions must match the real business workflow of the record, not generic CRUD expectations

Modal-aware actions:
- use modal-backed actions where confirmation, reason capture, review, or additional options are needed
- do not fire consequential actions immediately if user input is expected

Good modal candidates:
- Send Email
- Generate Document
- Cancel / Reject
- Convert / Transform
- operational process actions with options

Attachment guidance:
- where record-specific files matter, name attachment flows by purpose where possible
- prefer business labels like `Upload Signed Quote` over vague labels like `Upload`
- important attachment uploads should usually be visible in activity and/or attachment tabs
- transitions should match workflow states
- transform actions should map cleanly from source to target records
- document/email/automation actions should have clear record context and real workflow meaning

Examples of good contextual actions:
- quote: Generate PDF, Send Quote, Convert to Order
- order: Create Purchase Order, Generate Packing Slip, Send Confirmation Email
- invoice: Generate Invoice PDF, Email Invoice
- task/work order: Start Automation, Create Follow-up Task

## 8. Form Record Standards

When authoring form-based records:
- keep the main form body for core record fields
- put line items in their own tab
- put embedded related lists in their own tab
- use activity for operational records
- use explicit status/workflow actions where the record is process-driven

If a record type normally produces documents, emails, or downstream records:
- include those actions explicitly where they fit the workflow
- decide which are primary and which belong in overflow
- ensure important outcomes post to activity where appropriate
- keep dashboard/status cards off normal record/list surfaces unless they are clearly justified

## 9. Transformations

If a record naturally converts into another business record:
- design with transformation potential in mind
- prefer explicit transformations over ad hoc action side effects
- keep field naming and entity boundaries clean enough to support source/target mapping

Examples:
- quote -> order
- order -> invoice
- lead -> opportunity

If conversion is part of the real workflow, it should be authored intentionally.

## 10. Shared Interfaces

Consider whether an entity should participate in shared platform interfaces such as:
- dashboardable
- documentable
- schedulable

Rules:
- only enable them where the record type truly belongs in that surface
- do not enable every interface just because it exists
- field modeling should support the interface cleanly
- dashboard surfaces should be purposeful, not generic decoration

Examples:
- meetings/appointments may be schedulable
- quotes/orders/invoices may be documentable
- analytical or KPI-relevant entities may be dashboardable

## 11. Cross-Module Awareness

Author modules with future interoperability in mind.

Rules:
- use stable, explicit field naming
- avoid hardcoded assumptions that block later integration
- think about dependencies and downstream transformations early
- keep entity boundaries clean enough for other modules to reference them

Good:
- reusable customer/contact/site lookups
- consistent status/date/title fields
- explicit source/target mappings

Bad:
- free-text references to external records
- one module baking in assumptions that prevent later reuse

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
