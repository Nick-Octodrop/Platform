# Manifest Layout Style Guide (Marketplace v1)

This guide defines the default UI composition for v1.3 manifests so all business modules feel consistent.

## 1) Core principles
- Use pages for all user-facing surfaces (not raw views directly in nav).
- Use stable keys and stable ids.
- Keep page header visually quiet by default: `"header": { "variant": "none" }`.
- Use containers for visual surfaces. No floating/unwrapped blocks on major pages.
- Prefer predictable composition over per-module custom layout experiments.

## 2) Required pages per primary entity
For each primary entity, provide:
- `list_page` (required)
- `form_page` (required)
- `board/pipeline/calendar page` (optional by workflow need)

Naming convention:
- `page:<entity>.list_page`
- `page:<entity>.form_page`
- `page:<entity>.<purpose>_page`

## 3) Standard page patterns

### 3.1 List page (default app home)
Use a single card container wrapping `view_modes` (or a single list view).

```json
{
  "id": "<entity>.list_page",
  "layout": "single",
  "header": { "variant": "none", "actions": [] },
  "content": [
    {
      "kind": "container",
      "variant": "card",
      "content": [
        {
          "kind": "view_modes",
          "entity_id": "entity.<entity>",
          "default_mode": "list",
          "modes": [
            { "mode": "list", "target": "view:<entity>.list" }
          ]
        }
      ]
    }
  ]
}
```

### 3.2 Form page (default standard)
Use 12-column grid with two separate cards:
- Left: form content (`span: 8`)
- Right: activity/chatter card (`span: 4`)

This is the canonical pattern for Contacts-style UX.

```json
{
  "id": "<entity>.form_page",
  "layout": "single",
  "header": { "variant": "none" },
  "content": [
    {
      "kind": "record",
      "entity_id": "entity.<entity>",
      "record_id_query": "record",
      "content": [
        {
          "kind": "grid",
          "columns": 12,
          "gap": "md",
          "items": [
            {
              "span": 8,
              "content": [
                {
                  "kind": "container",
                  "variant": "card",
                  "content": [
                    { "kind": "view", "target": "view:<entity>.form" }
                  ]
                }
              ]
            },
            {
              "span": 4,
              "content": [
                {
                  "kind": "container",
                  "variant": "card",
                  "content": [
                    { "kind": "chatter", "entity_id": "entity.<entity>", "record_ref": "$record.id" }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

### 3.3 Board/Pipeline page
Use a card container wrapping `view_modes` with default `kanban` (or `calendar` when time-based).

## 4) Form view conventions
- Use section layout `columns: 2` for dense business fields.
- Group sections by operator workflow, not by data type only.
- Avoid redundant section titles when obvious.
- Use statusbar only when a single lifecycle workflow exists and is declared.

## 5) Activity panel rules
- Activity belongs in a separate right-side card on form pages.
- Do not embed chatter inside the same card as form fields.
- Keep the right card present for collaboration-heavy entities (CRM, Jobs, Tasks, Sales, Field Service, Maintenance, Variations, Contacts, Documents).

## 6) Navigation rules
- `app.nav.items[].to` must target `page:<id>` only.
- No direct `view:<id>` nav targets.
- App home should point to the entity list/pipeline page, not form page.

## 7) View mode support rules
- Only reference view modes supported by runtime in that environment.
- If `kanban` is unavailable in a target environment, expose list-first page and keep board page optional/feature-flagged.

## 8) Entity completeness checklist
For each primary entity:
- list view
- form view
- list page
- form page
- create action (`open_form`)
- refresh action
- default filters on list

If status field exists:
- declare workflow if statusbar is used
- add lifecycle actions matching workflow transitions

## 9) Identity/version rules (marketplace-safe)
- `module.id`: runtime instance identity in Studio/workspace.
- `module.key`: stable logical identity across workspaces/marketplace.
- `depends_on.required[].module` must reference stable module key.
- Bump `module.version` for behavior/schema/view changes.

Recommended version policy:
- patch (`x.y.Z`): copy or UI-only safe tweaks
- minor (`x.Y.z`): backward-compatible fields/pages/actions
- major (`X.y.z`): breaking removals/renames

## 10) AI generation defaults (must follow)
When AI generates new modules:
- start from the standard list page + two-card form page scaffold.
- keep header variant `none` unless explicitly requested.
- use card containers for all major surfaces.
- produce consistent page ids (`list_page`, `form_page`).
- avoid one-off layout patterns unless user asks.
