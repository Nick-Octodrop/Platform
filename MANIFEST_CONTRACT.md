# Manifest Contract v1 / v1.1 / v1.2 / v1.3 (Product Layer)

This contract defines the **stable, AI‑friendly** shape for module manifests at the product layer. The kernel remains unchanged; manifests describe **intent**, not UI behavior.

Legacy manifests continue to work (defaulting to `manifest_version: "0.x"`), while v1 enables app runtime primitives.

## Top‑level structure (v1)

```json
{
  "manifest_version": "1.3",
  "module": { "id": "jobs", "key": "jobs", "name": "Jobs", "version": "1.0.0" },
  "app": { "home": "page:home", "nav": [ ... ] },
  "pages": [ ... ],
  "entities": [ ... ],
  "views": [ ... ],
  "relations": [ ... ],
  "workflows": [ ... ],
  "depends_on": { ... },
  "transformations": [ ... ],
  "actions": [ ... ],
  "modals": [ ... ],
  "queries": { ... },
  "interfaces": { ... }
}
```

Required:
- `manifest_version` (for v1; legacy defaults to `0.x`)
- `module.id` (string)
- `entities` (list)
- `views` (list)

Module identity:
- `module.id` remains the runtime module instance identifier in Studio routes/install targets.
- `module.key` (optional, recommended) is the stable logical module key for portable dependencies and marketplace upgrades.
- Dependency declarations (`depends_on.*[].module`) should reference stable module keys.

Optional:
- `depends_on` for module dependency declarations (`required` / `optional`).

### Manifest versioning

- Legacy manifests omit `manifest_version` and are treated as `"0.x"`.
- Any manifest that defines `app` or `pages` must set `manifest_version` to a v1 value (e.g., `"1.0"`).
- v1 manifests **reject unknown keys** (top‑level and within v1 blocks).

## App definition (v1)

```json
"app": {
  "home": "page:home" | "view:job.list",
  "defaults": {
    "entity_home_page": "page:job.list_page",
    "entity_form_page": "page:job.form_page",
    "entities": {
      "entity.job": {
        "entity_home_page": "page:job.list_page",
        "entity_form_page": "page:job.form_page"
      }
    }
  },
  "nav": [
    {
      "group": "Jobs",
      "items": [
        { "label": "Home", "to": "page:home" },
        { "label": "All Jobs", "to": "view:job.list" }
      ]
    }
  ]
}
```

Rules:
- `app.home` must be `page:<id>` or `view:<id>`.
- `app.defaults.entity_home_page` (optional) should be a `page:<id>` for list/home.
- `app.defaults.entity_form_page` (optional) should be a `page:<id>` for create/edit.
- `app.defaults.entities` (optional) maps entity id → per‑entity defaults; values must be `page:<id>` targets.
- `app.nav[].items[].to` must be `page:<id>` or `view:<id>`.
- All targets must exist.

## Pages (v1)

```json
{
  "id": "home",
  "title": "Jobs",
  "layout": "single",
  "header": {
    "variant": "none",
    "actions": [
      { "kind": "refresh", "label": "Refresh" },
      { "kind": "open_form", "label": "New Job", "target": "job.form" },
      { "kind": "navigate", "label": "All Jobs", "target": "view:job.list" }
    ]
  },
  "content": [
    { "kind": "view", "target": "job.list" }
  ]
}
```

Rules:
- `page.layout` (optional) must be `"single"` in v1.
- v1.0: `page.content[]` only supports blocks of `kind: "view"`.
- v1.1: `page.content[]` supports a block DSL (view/stack/grid/tabs/text).
- v1.2: `page.content[]` also supports a `chatter` block.
- v1.3: `page.content[]` adds structured UI composition blocks (container/toolbar/statusbar/record).
- `page.header.variant` (optional) may be `"default"` or `"none"` (use `"none"` to suppress the page title card).
- `page.header.actions[]` may reference top-level actions (including `create_record`, `update_record`, `bulk_update`, `transform_record`) via `action_id`.
- Inline `page.header.actions[]` kinds are `navigate`, `open_form`, `refresh`.
- `page.header.actions[]` may also set `modal_id` to open a top-level modal.
- `navigate` targets are `page:<id>` or `view:<id>`.
- `open_form` targets a **view id** (no prefix).
- All targets must exist.

## Page content blocks (v1.1)

### Block: view
```json
{ "kind": "view", "target": "view:job.list" }
```
`target` may be `view:<id>` or `<id>`.

### Block: stack
```json
{ "kind": "stack", "gap": "sm|md|lg", "content": [ ... ] }
```

### Block: grid (12 columns)
```json
{
  "kind": "grid",
  "columns": 12,
  "gap": "sm|md|lg",
  "items": [
    { "span": 4, "content": [ ... ] },
    { "span": 8, "content": [ ... ] }
  ]
}
```

### Block: tabs
```json
{
  "kind": "tabs",
  "style": "boxed|lifted|bordered",
  "tabs": [
    { "id": "details", "label": "Details", "content": [ ... ] }
  ],
  "default_tab": "details"
}
```

### Block: text
```json
{ "kind": "text", "text": "Notes..." }
```

### Block: chatter (v1.2)
```json
{ "kind": "chatter", "entity_id": "entity.job", "record_ref": "$record.id" }
```

### Block: container (v1.3)
```json
{
  "kind": "container",
  "variant": "card|panel|flat",
  "title": "Optional title",
  "content": [ ... ]
}
```

### Block: toolbar (v1.3)
```json
{
  "kind": "toolbar",
  "align": "left|right|between",
  "actions": [
    { "action_id": "action.refresh" }
  ]
}
```

### Block: statusbar (v1.3)
```json
{
  "kind": "statusbar",
  "entity_id": "entity.job",
  "record_ref": "$record.id",
  "field_id": "job.status",
  "mode": "display"
}
```

### Block: record (v1.3)
```json
{
  "kind": "record",
  "entity_id": "entity.job",
  "record_id_query": "record",
  "content": [ ... ]
}
```

### Block: view_modes (v1.4-style, supported)
```json
{
  "kind": "view_modes",
  "entity_id": "entity.contact",
  "record_domain": {
    "op": "eq",
    "field": "contact.account_id",
    "value": { "ref": "$record.id" }
  },
  "default_mode": "list",
  "modes": [
    { "mode": "list", "target": "view:contact.list" },
    { "mode": "kanban", "target": "view:contact.kanban", "default_group_by": "contact.company_type" },
    { "mode": "graph", "target": "view:contact.graph" }
  ],
  "default_filter_id": "filter.all"
}
```
Rules:
- `modes[]` must be non-empty; each item requires `mode` and `target`.
- `mode` allowlist: `list`, `kanban`, `graph`, `calendar`, `pivot` (pivot can be disabled in UI).
- `target` must be a valid view id (or `view:<id>`).
- `default_mode` optional; falls back to first mode.
- `default_group_by` optional; used for kanban/pivot.
- `default_filter_id` optional; may refer to a manifest filter id or user-saved filter id.
- `record_domain` optional; when used inside a `record` block, it can reference `$record.*` for embedded related lists.

### Block: related_list (v1.3)
```json
{
  "kind": "related_list",
  "entity_id": "entity.workorder_line",
  "target": "view:workorder_line.list_inline",
  "record_domain": {
    "op": "eq",
    "field": "workorder_line.workorder_id",
    "value": { "ref": "$record.id" }
  },
  "create_modal": true,
  "create_defaults": {
    "workorder_line.workorder_id": { "ref": "$record.id" },
    "workorder_line.qty": 1
  }
}
```
Rules:
- Renders a list-only embedded table intended for form/page composition.
- `target` (or `view`) must point to a list view.
- `record_domain` supports `$record.*` refs inside a `record` block.
- `create_modal` opens quick-create modal from `+` (default: `true`).
- `create_defaults` pre-fills quick-create values and supports `{ "ref": "$record.*" }`.

Validation:
- Max block nesting depth is limited.
- `grid.columns` must be 12 and `span` must be 1..12.
- `tabs` must have unique `id` values; `default_tab` must exist.

## Entity schema

```json
{
  "id": "entity.job",
  "display_field": "job.title",
  "fields": [ ... ]
}
```

- `id` must be stable and unique.
- `display_field` must exist in `fields` when provided.

## Field schema

```json
{
  "id": "job.title",
  "type": "string",
  "label": "Title",
  "required": true,
  "readonly": false,
  "options": [ {"value":"low","label":"Low"} ]
}
```

Allowed `type` values:
- `string`, `text`, `number`, `bool`, `date`, `datetime`, `enum`, `uuid`, `lookup`, `tags`, `attachments`

Rules:
- `id` and `type` required.
- `required` is boolean (if present).
- `default` (optional) is allowed for `string`, `text`, `number`, `bool`, `date`, `enum`.
- `readonly` + `required` is allowed only when `default` is present or the field is system-set.
- `enum` must define `options` (non‑empty list).
- `lookup` should specify `entity` or be resolvable via `relations`.

### Computed fields (v1.3)

Number and other fields may declare manifest-driven computed values.

Expression compute:
```json
{
  "id": "invoice.total",
  "type": "number",
  "readonly": true,
  "compute": {
    "expression": {
      "op": "round",
      "args": [
        {
          "op": "add",
          "args": [
            { "ref": "invoice.subtotal" },
            { "ref": "invoice.tax" }
          ]
        },
        2
      ]
    }
  }
}
```

Aggregate compute:
```json
{
  "id": "invoice.subtotal",
  "type": "number",
  "readonly": true,
  "compute": {
    "aggregate": {
      "op": "sum",
      "entity": "entity.invoice_line",
      "field": "invoice_line.amount",
      "where": {
        "op": "eq",
        "field": "invoice_line.invoice_id",
        "value": { "ref": "$parent.id" }
      }
    }
  }
}
```

Rules:
- `compute` is optional and must be an object.
- Supported compute modes:
  - `compute.expression`
  - `compute.aggregate`
- Computed fields are recomputed by the shared engine; modules should not hardcode the same logic in custom UI code.
- Computed fields are commonly `readonly: true`, especially when they derive from other inputs.
- Expression refs resolve against the current draft/record and may use:
  - direct field ids like `"invoice.subtotal"`
  - `$current.<field>`
  - `$record.<field>`
  - `$parent.<field>` (primarily inside aggregate `where`)
- Expression ops currently supported:
  - arithmetic: `add`, `sub`, `mul`, `div`, `mod`, `min`, `max`, `abs`, `neg`, `round`, `ceil`, `floor`
  - logic/comparison: `and`, `or`, `not`, `eq`, `neq`, `gt`, `gte`, `lt`, `lte`
  - value helpers: `coalesce`, `if`
- Aggregate ops currently supported:
  - `sum`, `avg`, `min`, `max`, `count`
- Aggregate specs require:
  - `entity`
  - `op`
  - `field` for all aggregate ops except `count`
- Aggregate `where` uses the normal condition DSL and evaluates child rows as `$current` / `$record`, with the parent row available as `$parent`.

Authoring guidance:
- Prefer canonical numeric storage with computed derivations for totals, taxes, discounts, margins, durations, and rollups.
- Do not store symbols or formatted text inside computed numeric fields.
- Keep formulas declarative in manifests so the same behavior works in forms, lists, automations, and documents.

### Number formatting semantics (v1.3)

Numeric fields may declare display semantics via `format`.

```json
{
  "id": "invoice.total",
  "type": "number",
  "format": {
    "kind": "currency",
    "currency_field": "invoice.currency_code",
    "precision": 2
  }
}
```

```json
{
  "id": "product.weight",
  "type": "number",
  "format": {
    "kind": "measurement",
    "unit": "kg",
    "precision": 3
  }
}
```

Supported format keys:
- `kind`
- `currency`
- `currency_field`
- `unit`
- `unit_field`
- `precision`

Supported `format.kind` values:
- `plain`
- `currency`
- `percent`
- `measurement`
- `duration`

Rules:
- `format` is optional and currently applies to `type: "number"` fields.
- Formatting changes presentation only; stored values remain raw canonical values.
- `currency_field` / `unit_field` allow per-record formatting metadata.
- `currency` / `unit` provide static fallback metadata.
- `precision` controls rendered decimal places.

Authoring guidance:
- Money:
  - store numeric values only
  - store currency code separately when it can vary per record
  - prefer `currency_field` for invoices, quotes, expenses, and rates
- Percent:
  - store the business value consistently across the module (for example `10` for 10%)
  - use `format.kind: "percent"` for display
- Measurements and durations:
  - store raw numeric values
  - use `unit` / `unit_field` for labels like `kg`, `m`, `hrs`, `days`
- Documents, forms, and lists should all rely on the shared formatting engine instead of hand-built symbols or suffixes.

### Field UI (v1.2)
```json
"ui": { "widget": "steps" }
```
Supported widgets:
- `steps` (enum only, renders DaisyUI steps)

Attachments field UI options:
- `ui.title` (optional): section title shown above attachment gallery.
- `ui.description` (optional): helper text shown below title.
- `ui.button_label` (optional): upload button label (defaults to `Attach`).

### Field conditions (v1.2)
```json
"visible_when": { "op": "eq", "field": "job.status", "value": "done" }
"disabled_when": { "op": "eq", "field": "job.status", "value": "cancelled" }
"required_when": { "op": "eq", "field": "job.status", "value": "done" }
```

Condition DSL:
```json
{ "op": "eq", "field": "job.status", "value": "done" }
{ "op": "and", "conditions": [ ... ] }
{ "op": "or", "conditions": [ ... ] }
{ "op": "not", "condition": { ... } }
{ "op": "eq", "left": { "ref": "$record.job.status" }, "right": { "ref": "$candidate.job.status" } }
```

Allowed ops: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `contains`, `exists`, `and`, `or`, `not`.

### Lookup domain (v1.2)
```json
"domain": {
  "op": "eq",
  "left": { "ref": "$candidate.customer_id" },
  "right": { "ref": "$record.customer_id" }
}
```

Domains filter lookup options and are enforced server‑side.

## Actions (v1.2)

Top‑level actions:
```json
"actions": [
  { "id": "action.refresh", "kind": "refresh", "label": "Refresh" },
  { "id": "action.new_job", "kind": "create_record", "entity_id": "entity.job", "defaults": { "job.status": "new" } },
  { "id": "action.bulk_close", "kind": "bulk_update", "entity_id": "entity.job", "patch": { "job.status": "done" },
    "enabled_when": { "op": "exists", "field": "job.status" } },
  {
    "id": "action.quote_to_job",
    "kind": "transform_record",
    "entity_id": "entity.quote",
    "transformation_key": "quote_to_job",
    "confirm": { "title": "Convert quote?", "body": "Create a job and copy quote lines." }
  }
]
```

Template refs in `defaults` / `patch`:
- Values can use `{ "ref": "$record.id" }` or `{ "ref": "$record.<field>" }` and will resolve from the current record context at runtime.
- Actions may include `modal_id` to open a manifest-defined modal before follow-up actions run.
- `transform_record` actions must include `transformation_key`.
- `transform_record.entity_id` (when present) must match the transformation `source_entity_id`.
- `transform_record.selection_mode` may be `"selected_records"` when the action should consume list-view selections instead of a single `record_id`.

Page header actions can reference actions:
```json
"header": {
  "actions": [
    { "action_id": "action.refresh" },
    { "kind": "navigate", "label": "All Jobs", "target": "view:job.list" }
  ]
}
```

Action guards (v1.2):
- `visible_when` and `enabled_when` accept the condition DSL and evaluate against the current record draft.
- `confirm` may provide `{ "title": "...", "body": "..." }` for a confirmation dialog.

## Modals (v1.3 extension)

Top-level modals define reusable dialog flows:
```json
"modals": [
  {
    "id": "modal.workorder_on_hold_reason",
    "title": "Put Work Order On Hold",
    "description": "Add a reason before moving this work order to On Hold.",
    "entity_id": "entity.workorder",
    "fields": ["workorder.on_hold_reason"],
    "defaults": { "workorder.on_hold_reason": "" },
    "actions": [
      { "action_id": "action.put_on_hold_decline", "label": "Decline", "variant": "soft", "close_on_success": true },
      { "action_id": "action.put_on_hold_confirm", "label": "Confirm Hold", "variant": "primary", "close_on_success": true }
    ]
  }
]
```

Rules:
- Open a modal from any action via `modal_id`.
- `fields[]` are rendered against `entity_id` field definitions.
- `defaults` supports template refs (`$record.*`) and seeds modal draft values.
- `actions[]` can reference top-level actions (`action_id`) or provide inline actions.
- Modal action context is passed as `record_draft`, so refs like `{ "ref": "$record.<field>" }` resolve from modal values.
- `variant` is UI-only (`primary` / `soft`).
- `close_on_success` controls auto-close behavior.
- Modal-local `kind: "close_modal"` is supported as a UI-only action.

## Triggers (v1.3)

Top‑level triggers declare runtime events emitted by the system. Triggers are validated at install/upgrade time and emitted at runtime.

```json
"triggers": [
  { "id": "trigger.job.created", "event": "record.created", "entity_id": "entity.job" },
  { "id": "trigger.job.updated", "event": "record.updated", "entity_id": "entity.job" },
  { "id": "trigger.job.status", "event": "workflow.status_changed", "entity_id": "entity.job", "status_field": "job.status" },
  { "id": "trigger.job.close", "event": "action.clicked", "action_id": "action.bulk_close" }
]
```

Allowed events:
- `record.created`
- `record.updated`
- `action.clicked`
- `workflow.status_changed`

Payload schema (minimum stable fields):
```json
{
  "event": "record.updated",
  "entity_id": "entity.job",
  "record_id": "uuid",
  "changed_fields": ["job.status"],
  "user_id": "user_uuid",
  "timestamp": "2026-02-07T12:34:56Z"
}
```

Notes:
- `record.*` and `workflow.status_changed` require `entity_id`.
- `action.clicked` requires `action_id`.
- `status_field` is optional but recommended for workflow triggers.

## Transformations (v1.3 extension)

Top-level transformations define reusable source→target record conversion logic using stable keys only.

```json
"transformations": [
  {
    "key": "quote_to_job",
    "source_entity_id": "entity.quote",
    "target_entity_id": "entity.job",
    "field_mappings": {
      "job.number": { "from": "quote.number" },
      "job.customer_id": { "from": "quote.customer_id" },
      "job.status": { "value": "new" }
    },
    "child_mappings": [
      {
        "source_entity_id": "entity.quote_line",
        "target_entity_id": "entity.job_line",
        "source_link_field": "quote_line.quote_id",
        "target_link_field": "job_line.job_id",
        "field_mappings": {
          "job_line.description": { "from": "quote_line.description" },
          "job_line.qty": { "from": "quote_line.qty" },
          "job_line.source_quote_line_id": { "ref": "$source.id" }
        }
      }
    ],
    "link_fields": {
      "source_to_target": "quote.job_id",
      "target_to_source": "job.source_quote_id"
    },
    "source_update": {
      "patch": { "quote.status": "converted" }
    },
    "activity": {
      "enabled": true,
      "event_type": "transform",
      "targets": ["source", "target"]
    },
    "feed": {
      "enabled": true,
      "message": "Created {target.entity_id} {target.id} from {source.entity_id} {source.id}",
      "targets": ["source"]
    },
    "hooks": {
      "emit_events": ["quote.transformed_to_job"]
    },
    "validation": {
      "require_source_fields": ["quote.number"],
      "require_child_records": true,
      "prevent_if_target_linked": true
    }
  }
]
```

Rules:
- `key` is required and must be unique within the manifest.
- `source_entity_id` and `target_entity_id` are required.
- `field_mappings` supports either:
  - object form: `{ "<target_field>": "<source_field>" | { "from" | "value" | "ref" } }`
  - list form: `[ { "to": "<target_field>", "from" | "value" | "ref": ... } ]`
- Each mapping must define exactly one source (`from`, `value`, or `ref`).
- `child_mappings[]` supports parent-child conversion via current lookup conventions:
  - `source_link_field`: child→source parent field
  - `target_link_field`: child→target parent field
- `child_mappings[].source_scope` may be `"selected_records"` to copy directly from the selected source rows instead of loading linked child records.
- `link_fields.source_to_target` writes target id back to the source record.
- `link_fields.target_to_source` writes source id to the target record.
- `source_update.patch` applies a patch to source after target creation (for status changes, etc.).
- `validation.require_source_fields` enforces source prerequisites.
- `validation.require_child_records` can block transforms with zero matching source children.
- `validation.prevent_if_target_linked` can block duplicate transforms when source already linked.
- `validation.require_uniform_fields` can require selected source rows to share the same field values before a grouped transform runs.
- `validation.selected_record_domain` can validate each selected source row with the condition DSL.
- Transform refs also support `$today`, `$now`, and `$selection.sum.<field_id>` for grouped target values.
- `hooks.emit_events[]` publishes custom events for downstream automations.

Reference expressions for transformation mappings:
- `$source.id`, `$source.<field>`
- `$target.id`, `$target.<field>` (useful in child mapping contexts)
- `$context.record_id`, `$context.record.<field>`

## Dependencies (v1.3 extension)

Top-level `depends_on` declares module dependencies using stable module keys.

```json
"depends_on": {
  "required": [
    { "module": "contacts", "version": ">=1.0.0" }
  ],
  "optional": [
    { "module": "crm", "version": ">=1.0.0, <2.0.0" }
  ]
}
```

Rules:
- `depends_on` is optional and must be an object.
- Supported keys: `required`, `optional`.
- Each list item requires:
  - `module` (stable module id string)
  - `version` (optional semver constraint string)
- `module` cannot reference the current module (`self` dependency rejected).
- Duplicate module entries across/within `required` and `optional` are rejected.
- Invalid constraint strings are rejected.
- Circular required dependency graphs are rejected at install/enable validation time.
- `required` deps must be installed before install/upgrade and installed+enabled before enable.
- `optional` deps may be absent.

Version constraints (v1):
- Operators: `=`, `==`, `>`, `<`, `>=`, `<=`
- Terms can be comma-separated to form AND constraints, for example:
  - `">=1.0.0, <2.0.0"`

## Interfaces (v1.3 extension)

`interfaces` is the manifest-driven opt-in surface for cross-module system capabilities.  
Global system apps discover participating entities dynamically from enabled modules.

```json
"interfaces": {
  "schedulable": [
    {
      "entity_id": "entity.job",
      "enabled": true,
      "scope": "module_and_global",
      "title_field": "job.title",
      "date_start": "job.scheduled_start",
      "date_end": "job.scheduled_end",
      "owner_field": "job.owner_id",
      "location_field": "job.site_address",
      "status_field": "job.status",
      "all_day_field": "job.is_all_day",
      "color_field": "job.owner_id"
    }
  ],
  "documentable": [
    {
      "entity_id": "entity.quote",
      "enabled": true,
      "scope": "module_and_global",
      "attachment_field": "quote.attachments",
      "title_field": "quote.number",
      "owner_field": "quote.owner_id",
      "category_field": "quote.stage",
      "date_field": "quote.updated_at",
      "record_label_field": "quote.number",
      "preview_enabled": true,
      "allow_delete": false,
      "allow_download": true
    }
  ],
  "dashboardable": [
    {
      "entity_id": "entity.job",
      "enabled": true,
      "scope": "module_and_global",
      "date_field": "job.created_at",
      "measures": ["count", "sum:job.total"],
      "group_bys": ["job.status", "job.owner_id"],
      "default_widgets": [
        { "id": "jobs_by_status", "type": "group", "title": "Jobs by Status", "group_by": "job.status", "measure": "count" }
      ],
      "default_filters": [
        { "op": "eq", "field": "job.archived", "value": false }
      ]
    }
  ]
}
```

Rules:
- `interfaces` is optional and must be an object when present.
- Supported keys: `schedulable`, `documentable`, `dashboardable`.
- Each key maps to a list of declarations.
- Shared declaration fields:
  - `entity_id` (required): target entity.
  - `enabled` (optional bool, default `true`).
  - `scope` (optional): `module_only | global_only | module_and_global` (default `module_and_global`).

### `schedulable` rules
- Required fields: `title_field`, `date_start`.
- Optional fields: `date_end`, `owner_field`, `location_field`, `status_field`, `all_day_field`, `color_field`.
- Used by global calendar aggregation; local/module calendar views remain unchanged.

### `documentable` rules
- Required fields: `attachment_field`.
- Optional fields: `title_field`, `owner_field`, `category_field`, `date_field`, `record_label_field`.
- Optional behavior flags: `preview_enabled`, `allow_delete`, `allow_download`.
- Used by global document aggregation; local attachment rendering remains unchanged.

### `dashboardable` rules
- Optional fields: `date_field`, `measures`, `group_bys`, `default_widgets`, `default_filters`.
- `default_widgets[].type` allowlist: `metric`, `group`, `time_series`, `table`.
- `default_filters[]` uses the condition DSL.
- Used by global dashboard aggregation; local analytics views remain unchanged.

Discovery/runtime behavior:
- System scans enabled installed modules and reads `interfaces.*` declarations.
- New Studio-created modules appear automatically in global aggregate apps after install/enable if they opt in.
- Discovery uses stable keys only (`module_id`, `entity_id`, field ids), never DB/workspace-specific IDs.

## View schema

Supports `kind` or `type` (both accepted). Entity reference may be `entity`, `entity_id`, or `entityId`.

List view:
```json
{ "id":"job.list", "entity":"job", "kind":"list", "create_behavior":"open_form", "columns":[ {"field_id":"job.title"} ] }
```

Form view:
```json
{ "id":"job.form", "entity":"entity.job", "kind":"form", "sections":[ {"id":"main","fields":["job.title"]} ] }
```

Kanban view:
```json
{
  "id": "contact.kanban",
  "kind": "kanban",
  "entity": "entity.contact",
  "card": {
    "title_field": "contact.full_name",
    "subtitle_fields": ["contact.email", "contact.phone"],
    "badge_fields": ["contact.tags"]
  }
}
```

Graph view:
```json
{
  "id": "contact.graph",
  "kind": "graph",
  "entity": "entity.contact",
  "default": { "type": "bar", "group_by": "contact.country", "measure": "count" }
}
```

Calendar view:
```json
{
  "id": "workorder.calendar",
  "kind": "calendar",
  "entity": "entity.workorder",
  "calendar": {
    "title_field": "workorder.title",
    "date_start": "workorder.scheduled_start",
    "date_end": "workorder.scheduled_end",
    "all_day_field": "workorder.is_all_day",
    "color_field": "workorder.assignee_id",
    "default_scale": "month"
  }
}
```

Rules:
- Views must reference a known entity.
- All referenced fields must exist in the entity.
- Calendar views require `calendar.title_field` and `calendar.date_start`.
- Calendar views support optional `calendar.date_end`, `calendar.all_day_field`, `calendar.color_field`.
- `calendar.default_scale` (optional) can be `month`, `week`, `day`, or `year`.
- `section.layout` (v1.3) can be `"columns"` with `columns: 2` for 2‑col layouts.
- List views may include `open_record` to control row click navigation:
```json
"open_record": { "to": "page:job.form_page", "param": "record" }
```
- List view headers may include `open_record_target` to override row click target.
- List views may include `create_behavior`:
  - `open_form` (default): open the form in create mode.
  - `create_record`: create immediately (only safe if required fields have defaults).

### Form section line editor (v1.3 extension)

```json
{
  "id": "line_items",
  "title": "Line Items",
  "line_editor": {
    "entity_id": "entity.workorder_line",
    "parent_field": "workorder_line.workorder_id",
    "item_lookup_field": "workorder_line.item_id",
    "item_lookup_entity": "entity.item",
    "item_lookup_display_field": "item.name",
    "item_field_map": {
      "workorder_line.unit_price": "item.unit_price",
      "workorder_line.tax_rate": "item.tax_rate",
      "workorder_line.description": "item.description"
    },
    "description_field": "workorder_line.description",
    "defaults": { "workorder_line.qty": 1 },
    "columns": [
      { "field_id": "workorder_line.item_id", "label": "Item", "readonly": true },
      { "field_id": "workorder_line.qty", "label": "Qty", "type": "number" }
    ]
  }
}
```

Optional fallback map at form-view level:
```json
"line_editors": {
  "line_items": { "...same config..." }
}
```

Rules:
- `line_editor.entity_id` is the child entity edited inline.
- `parent_field` links child rows to the current parent record id.
- `item_lookup_*` drives the bottom lookup/search row.
- `item_field_map` copies values from selected lookup record into new child row.
- `columns[]` controls editable table columns.

### View header (v1.4-compatible extension)
Odoo-style headers for list/form views:

```json
"header": {
  "title_field": "optional",
  "primary_actions": [{ "action_id": "action.new_record" }],
  "secondary_actions": [{ "action_id": "action.export" }],
  "bulk_actions": [{ "action_id": "action.bulk_done" }],
  "search": { "enabled": true, "placeholder": "Search...", "fields": ["job.title"] },
  "filters": [
    { "id": "new", "label": "New", "domain": { "op": "eq", "field": "job.status", "value": "new" } }
  ],
  "save_mode": "top|bottom|both",
  "auto_save": true,
  "auto_save_debounce_ms": 750,
  "statusbar": { "field_id": "job.status" },
  "tabs": {
    "style": "lifted",
    "default_tab": "details",
    "tabs": [
      { "id": "details", "label": "Details", "sections": ["main"] },
      { "id": "approval", "label": "Approval", "sections": ["approval"] }
    ]
  }
}
```

Rules:
- `title_field` (optional) must be a field on the view entity.
- `primary_actions`, `secondary_actions`, `bulk_actions` items must reference existing actions (`action_id`) or use inline `navigate/open_form/refresh`.
- Header action entries may set `modal_id` to launch a top-level modal.
- `bulk_actions` only valid on list views.
- `search.fields` must be fields on the view entity.
- `filters[].domain` uses the condition DSL and requires v1.2+.
- `save_mode` only valid on form views; default is `"bottom"`.
- `auto_save` only valid on form views; default is `false`.
- `auto_save_debounce_ms` only valid on form views; default is 750ms.
- `statusbar` only valid on form views and must reference an enum field on the entity.
- `tabs` only valid on form views; each tab’s `sections[]` must reference section ids defined on the view.

### List row navigation (view.open_record)
Allow list views to control where row click navigates:

```json
"open_record": {
  "to": "page:job.detail",
  "param": "record"
}
```

Rules:
- `to` must be `page:<id>` or `view:<id>`.
- `param` is optional and defaults to `record`.

## Lookup fields

```json
{
  "id": "job.contact_id",
  "type": "lookup",
  "label": "Contact",
  "entity": "entity.contact",
  "display_field": "contact.full_name"
}
```

Rules (v1):
- `entity` is required and must reference a known entity.
- `display_field` is required and must exist on the target entity.

## Relations

```json
{ "from": "job.contact_id", "to": "contact.id", "label_field": "contact.full_name" }
```

Used to resolve lookup relationships. `label_field` should exist on the target entity.

## Stable IDs

IDs should be stable and deterministic. Avoid auto‑generated IDs.

## Manifest vs System Responsibilities

**Manifest decides:** entities, fields, relations, workflows, views, app navigation, pages.

**System decides:** layout mapping to UI components, caching, navigation, permissions, audit, storage.

## UI Composition Contract (Surfaces vs Content)

These rules keep the UI consistent and AI‑safe:

- **Surfaces come only from manifest containers.**
  - `container.variant: "card"` is the only way to create a card surface.
  - `panel` and `flat` are also explicit surfaces.
- **View renderers are flat.**
  - Form/List renderers must not add card/panel/rounded/border wrappers around content.
  - View renderers may only add spacing (`space‑y`, `gap`, `px/py`).
- **Nested cards require explicit containers.**
  - If a “card inside a card” is desired, it must be defined in the manifest using a nested `container`.
- **Direct view routes are neutral.**
  - `/apps/:id/view/:viewId` should render the view without implicit card wrappers.

## DSL References

Conditions and expressions may be used only where supported by kernel DSLs. No UI behavior encoded in manifests.
