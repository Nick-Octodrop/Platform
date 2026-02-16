# Manifest Contract v1 / v1.1 / v1.2 / v1.3 (Product Layer)

This contract defines the **stable, AI‑friendly** shape for module manifests at the product layer. The kernel remains unchanged; manifests describe **intent**, not UI behavior.

Legacy manifests continue to work (defaulting to `manifest_version: "0.x"`), while v1 enables app runtime primitives.

## Top‑level structure (v1)

```json
{
  "manifest_version": "1.3",
  "module": { "id": "jobs", "name": "Jobs", "version": "1.0.0" },
  "app": { "home": "page:home", "nav": [ ... ] },
  "pages": [ ... ],
  "entities": [ ... ],
  "views": [ ... ],
  "relations": [ ... ],
  "workflows": [ ... ],
  "actions": [ ... ],
  "queries": { ... },
  "interfaces": { ... }
}
```

Required:
- `manifest_version` (for v1; legacy defaults to `0.x`)
- `module.id` (string)
- `entities` (list)
- `views` (list)

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
- `page.header.actions[]` allowlisted kinds: `navigate`, `open_form`, `refresh`, `create_record`, `update_record`, `bulk_update`.
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
- `mode` allowlist: `list`, `kanban`, `graph`, `pivot` (pivot can be disabled in UI).
- `target` must be a valid view id (or `view:<id>`).
- `default_mode` optional; falls back to first mode.
- `default_group_by` optional; used for kanban/pivot.
- `default_filter_id` optional; may refer to a manifest filter id or user-saved filter id.

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
- `string`, `text`, `number`, `bool`, `date`, `datetime`, `enum`, `uuid`, `lookup`, `tags`

Rules:
- `id` and `type` required.
- `required` is boolean (if present).
- `default` (optional) is allowed for `string`, `text`, `number`, `bool`, `date`, `enum`.
- `readonly` + `required` is allowed only when `default` is present or the field is system-set.
- `enum` must define `options` (non‑empty list).
- `lookup` should specify `entity` or be resolvable via `relations`.

### Field UI (v1.2)
```json
"ui": { "widget": "steps" }
```
Supported widgets:
- `steps` (enum only, renders DaisyUI steps)

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
    "enabled_when": { "op": "exists", "field": "job.status" } }
]
```

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

Rules:
- Views must reference a known entity.
- All referenced fields must exist in the entity.
- `section.layout` (v1.3) can be `"columns"` with `columns: 2` for 2‑col layouts.
- List views may include `open_record` to control row click navigation:
```json
"open_record": { "to": "page:job.form_page", "param": "record" }
```
- List view headers may include `open_record_target` to override row click target.
- List views may include `create_behavior`:
  - `open_form` (default): open the form in create mode.
  - `create_record`: create immediately (only safe if required fields have defaults).

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
