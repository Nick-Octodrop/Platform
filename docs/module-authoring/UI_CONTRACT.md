# UI Contract

This file describes what the current app shell and renderers expect from manifests.

It is not a design wishlist.
It is the practical UI contract extracted from the current runtime.

Primary runtime sources:
- [AppShell.jsx](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/apps/AppShell.jsx)
- [FormViewRenderer.jsx](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/ui/FormViewRenderer.jsx)

## 1. General Principle

Author manifests as structured intent.
Do not encode random UI hacks into the JSON.

Good:
- explicit pages
- explicit actions
- explicit workflow states
- field metadata that drives the renderer

Bad:
- assuming the shell will infer missing routes or titles
- relying on ids showing to users
- inventing new UI keys that the renderer does not understand

## 2. Titles and Breadcrumbs

To get correct titles/breadcrumbs:
- set `entity.display_field`
- set form `header.title_field` if the view uses a different preferred title
- avoid title fields that contain UUIDs

Expected result:
- breadcrumbs should show module name and human title
- record pages should show name/number/title, not ids

## 3. Form Fields

The renderer uses field metadata to choose controls and behavior.

Current useful field metadata:
- `type`
- `label`
- `required`
- `readonly`
- `default`
- `options`
- `entity`
- `display_field`
- `ui.widget` where supported

Field type behavior:
- `enum`: select/dropdown
- `bool`: toggle/boolean control
- `lookup`: searchable relation picker
- `user`: workspace member picker
- `users`: multi-user picker
- `attachments`: attachment panel/uploader
- `date`: date control
- `datetime`: datetime control

## 4. Address Autocomplete

Current address autocomplete is generic but tied to recognised address field naming patterns.

Known supported patterns include:
- `*.address_line_1`
- `*.billing_street`
- `*.shipping_street`

If you want address autocomplete and structured mapping to work cleanly:
- use those standard field naming conventions
- include the related city/state/postcode/country sibling fields

Anti-pattern:
- inventing random address field ids and expecting generic autocomplete mapping to infer them

## 5. Forms and Activity

If a record should have comments/attachments/change history, set form activity explicitly:

```json
"activity": {
  "enabled": true,
  "show_changes": true,
  "allow_comments": true,
  "allow_attachments": true,
  "tracked_fields": ["task.title", "task.status"]
}
```

Rules:
- `tracked_fields` should be intentional, not every field by default
- use activity for operational records, not every tiny config entity

## 6. Actions in the UI

The shell and form headers expect actions to be explicit and evaluable.

Use:
- `primary_actions`
- `secondary_actions`
- page header `actions`

If actions should disable/hide based on record state:
- use `enabled_when`
- use `visible_when`

The current UI will explain many disabled actions if the condition is explicit enough.

## 7. List and Page Surfaces

Preferred patterns:
- page -> container(card) -> view
- page -> container(card) -> view_modes
- form pages and list pages should usually be separate page ids

Why:
- this matches the current shell padding/card structure
- it produces stable routing targets
- it avoids brittle runtime inference

## 8. View Modes

Use `view_modes` when the user should switch between representations of the same entity set.

Good cases:
- list + kanban
- list + graph
- list + calendar

Requirements:
- explicit `modes`
- explicit `default_mode`
- explicit `entity_id`
- explicit target views

## 9. Workflows and Status UI

If an entity is truly workflow-driven:
- define a workflow
- use a real status enum field
- optionally use `ui.widget: "steps"` on the enum where that presentation is wanted

Do not:
- fake workflow with just a random enum and no transitions if header/status behavior matters

## 10. Dynamic Controls in Automation/Rules UI

The automation builder can use manifest field metadata for dynamic inputs.

Fields that should get better editors when the manifest is correct:
- enums
- booleans
- user/users
- lookups
- numbers
- dates/datetimes

So for modules intended to work well with automations:
- use correct field types
- use `options` on enums
- use `entity` and `display_field` on lookups

## 11. Known UI Anti-Patterns

- missing `display_field`
- record pages without form pages
- list pages without `open_record_target`
- giant ungrouped forms with no sections
- activity enabled on every config entity
- lookup fields without target metadata
- enum fields without options
