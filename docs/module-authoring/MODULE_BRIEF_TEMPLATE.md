# Module Brief Template

Use this template before generating a module.
If the brief is weak, the manifest will be weak.

Fill in all required sections.

---

## 1. Module Identity

Required:
- Module name:
- Module id:
- Stable module key:
- Category:
- One-sentence purpose:

Optional:
- Icon preference:
- Depends on modules:

## 2. Main User Outcome

Required:
- What problem does this module solve?
- What should a user be able to do end to end?
- What should the home screen open to?

## 3. Main Entities

For each entity, specify:
- Entity id:
- Entity label:
- User-facing title/display field:
- Is it a main entity or supporting entity?

Example:

```text
Entity id: entity.work_order
Label: Work Order
Display field: work_order.number
Role: main
```

## 4. Fields Per Entity

For each field, specify:
- Field id
- Type
- Label
- Required or optional
- Default if any
- Readonly if any
- Enum options if enum
- Lookup target entity if lookup
- Display field if lookup

Important:
- use full field ids
- do not say "standard fields"
- list the actual fields

## 5. Views

Required per main entity:
- list view
- form view

Optional as needed:
- kanban
- graph
- calendar
- pivot

For each view specify:
- view id
- kind
- entity
- main purpose
- key columns/sections/cards

## 6. Pages

Required:
- app home page id
- list page ids
- form page ids

For each page specify:
- page id
- title
- what block(s) it should render

## 7. Navigation

Specify:
- nav group labels
- nav item labels
- page targets

Do not say "normal nav".
List the actual items.

## 8. Actions

List all top-level actions that matter:
- id
- kind
- label
- target/entity
- when it should be visible
- when it should be enabled

Examples:
- New record
- Activate / Deactivate
- Convert
- Approve
- Raise invoice

## 9. Workflow

If applicable, define:
- status field id
- workflow states
- state labels
- transition labels
- required fields by state

If there is no real workflow:
- explicitly say no workflow

## 10. Related Records

List:
- parent/child relationships
- related lists needed on forms
- field mappings or transformations between records

## 11. Activity / Attachments

For each main entity:
- activity enabled? yes/no
- comments enabled? yes/no
- attachments enabled? yes/no
- tracked fields

## 12. Automations / Triggers

Only include if needed.

List:
- trigger event
- intended action
- required condition fields

## 13. Shared Interfaces

State if the entity should participate in:
- scheduling/calendar
- documents
- dashboards

If yes, specify which entity and which fields drive it.

## 14. Example Records

Provide 3-5 realistic example records:
- realistic names/numbers
- realistic statuses
- realistic related records

This dramatically reduces bad demo data generation.

## 15. Non-Negotiables

List explicit must-haves:
- fields that must exist
- exact action names
- route/page expectations
- workflow/state requirements
- things that must not be generated

## 16. Anti-Patterns To Avoid

Write brief-specific anti-patterns, for example:
- no manufacturing concepts
- no extra approval states
- no customer portal pages
- no invoicing in this module

---

## Minimum Good Brief Standard

A brief is good enough only if it names:
- the entities
- the fields
- the pages
- the views
- the actions
- the workflow

If those are missing, the module request is still too vague.
