# Manifest v1 Example Index

Use these files as the in-repo reference implementation for how OCTO v1.3 manifests should actually be structured.

Read these alongside:
- `MANIFEST_CONTRACT.md`
- `manifests/marketplace/README.md`
- `manifests/marketplace/docs/LAYOUT_STYLE_GUIDE.md`
- `manifests/marketplace/docs/AUTOMATION_TEMPLATES.md`

## Core marketplace reference modules
- `manifests/marketplace/contacts.json`
- `manifests/marketplace/crm.json`
- `manifests/marketplace/sales.json`
- `manifests/marketplace/jobs.json`
- `manifests/marketplace/tasks.json`
- `manifests/marketplace/field_service.json`
- `manifests/marketplace/maintenance.json`
- `manifests/marketplace/variations.json`
- `manifests/marketplace/calendar.json`
- `manifests/marketplace/documents.json`
- `manifests/marketplace/catalog.json`

## Demo manifests with richer business patterns
- `manifests/contacts.json`
- `manifests/crm_demo.json`
- `manifests/holiday_planner_demo.json`
- `manifests/workorders_demo.json`
- `manifests/projects.json`
- `manifests/auspac_insurance_jobs_demo.json`
- `manifests/joinery_kitchen_quoting_demo.json`
- `manifests/quote_job_transform_demo.json`
- `manifests/items_pricing_demo.json`
- `manifests/item_tracker.json`
- `manifests/request_lab.json`

## What to copy from these examples

### Pages and layout
- Use page-first navigation, not raw view targets.
- Follow the list-page + two-card form-page pattern from `LAYOUT_STYLE_GUIDE.md`.
- Keep page headers quiet unless the module genuinely needs louder chrome.
- Use card containers for major surfaces.

### Forms and sections
- Follow the tab/section organization style used in Contacts, Jobs, Sales, and CRM.
- Prefer workflow-oriented grouping, not arbitrary field dumps.
- Put chatter/activity in the separate right-hand card where appropriate.

### Views
- Use `view_modes` patterns from marketplace manifests.
- Match list/form/kanban/graph/calendar support to the actual entity and workflow.
- Use stable ids and predictable naming (`list_page`, `form_page`, etc).

### Workflows and actions
- Study workflow/state/action patterns in marketplace modules.
- When statusbars are used, workflows and matching actions should exist and stay coherent.
- Action buttons should look like the patterns already used in Contacts, Jobs, Tasks, Sales, and Variations.

### Automations
- Use `manifests/marketplace/docs/AUTOMATION_TEMPLATES.md` as the source of truth for:
  - trigger structure
  - event filters
  - notification actions
  - variable paths
  - published automation shape

### Documents, templates, and interfaces
- Use the demo manifests to understand how documentable/dashboardable interfaces are declared.
- Follow existing attachment/document patterns instead of inventing new shapes.

### Dependencies and identity
- Respect `module.key`, `module.id`, versioning, and dependency conventions from marketplace manifests.
- Keep marketplace-safe/stable keys and ids where required.

## How to use this index in AI/self-heal work
- When fixing planner or compiler behavior, prefer aligning output with these example manifests over inventing new structure.
- When adding eval coverage, create scenarios that reflect these module patterns.
- When sandbox results look wrong, compare the generated plan/patch against the closest matching reference manifest here.
