# Module Authoring Pack

This folder is a parallel, canonical authoring pack for creating Octodrop modules.

It does not replace the current AI/context system.
It does not change existing prompt wiring.
It does not refactor or move current docs.

Use this pack intentionally when you want cleaner, lower-friction module generation.

## What This Pack Is For

- writing new manifest modules against the current platform contract
- briefing AI or humans with the minimum correct structure
- reducing rework caused by vague briefs or half-valid manifests
- standardising what "done" means before install/testing

## What This Pack Is Not

- not a full repo docs refactor
- not a replacement for runtime validation
- not a replacement for current operational docs
- not a theory document

## Start Here

1. Read [MANIFEST_SPEC.md](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/docs/module-authoring/MANIFEST_SPEC.md).
2. Read [UI_CONTRACT.md](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/docs/module-authoring/UI_CONTRACT.md).
3. Fill out [MODULE_BRIEF_TEMPLATE.md](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/docs/module-authoring/MODULE_BRIEF_TEMPLATE.md).
4. Build against [MODULE_ACCEPTANCE_CHECKLIST.md](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/docs/module-authoring/MODULE_ACCEPTANCE_CHECKLIST.md).
5. Use the examples in:
   - [contacts](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/docs/module-authoring/examples/contacts)
   - [work_orders](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/docs/module-authoring/examples/work_orders)

## Canonical Rules

- Prefer explicit pages over relying on incidental defaults.
- Always define `module.id`, `module.key`, `module.name`, `manifest_version`.
- Always define `app.home` and per-entity app defaults for the main entities.
- Always define at least one list view and one form view per main entity.
- Always define pages the app can navigate to.
- Use top-level `actions` and reference them from page/view headers.
- Use field ids consistently in fully-qualified form, e.g. `job.status`.
- Use manifest conditions for visibility/actionability, not UI-only assumptions.
- Treat validation errors as contract failures, not suggestions.

## Source Of Truth Used For This Pack

This pack is extracted from the current working platform patterns, especially:

- [MANIFEST_CONTRACT.md](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/MANIFEST_CONTRACT.md)
- [manifest_validate.py](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/app/manifest_validate.py)
- [AppShell.jsx](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/apps/AppShell.jsx)
- [FormViewRenderer.jsx](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/web/src/ui/FormViewRenderer.jsx)
- [contacts.json](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/manifests/commercial_v2/contacts.json)
- [jobs.json](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/manifests/marketplace/jobs.json)

## Anti-Patterns

- Do not invent new manifest keys because they "feel right".
- Do not omit pages and expect the shell to infer everything.
- Do not hardcode workspace-specific values into canonical modules.
- Do not ship a module with only forms and no clear list/home route.
- Do not make a brief that says "like Odoo" without naming actual entities, pages, and actions.
