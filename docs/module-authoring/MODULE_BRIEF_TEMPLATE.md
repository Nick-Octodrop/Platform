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

Where relevant, also specify:
- currency needs
- quantity / UOM needs
- structured address needs
- which money fields must display with currency formatting/symbol-aware rendering
- which lists/cards/summaries must show UOM or currency context explicitly

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
- action category
- when it should be visible
- when it should be enabled
- is it primary or overflow

Examples:
- New record
- Activate / Deactivate
- Convert
- Approve
- Raise invoice
- Generate document
- Send email
- Start automation

Also specify explicitly:
- header actions
- document actions
- email actions
- attachment actions
- automation entry-point actions
- which actions belong in the overflow / three-dot menu
- which actions should use a modal
- what the obvious next action should be in each important state
- whether duplicate and archive should exist
- any conditions or visibility logic that matter
- any source-linking or import actions
- whether destructive/admin actions should be hidden in overflow only

## 9. Workflow

If applicable, define:
- status field id
- should there be a visible statusbar? yes/no
- workflow states
- state labels
- transition labels
- required fields by state
- readonly behavior by state
- transition actions
- visibility/enabled rules that matter
- which source records must be restricted by workflow/state/consumption status

If there is no real workflow:
- explicitly say no workflow

Also state:
- what the lifecycle stages are
- how UI should change by state

## 10. Related Records

List:
- parent/child relationships
- related lists needed on forms
- which child surfaces are true line items and should use the inline `line_editor` pattern
- which child surfaces are subordinate master-data and should stay normal child entities shown through `related_list`
- smart buttons / related counters that should appear
- field mappings or transformations between records
- which lookups should be filtered by customer/supplier/parent/state
- which dependent values should clear or revalidate when the parent changes
- which values should prefill when a source/parent record is chosen

## 11. Activity / Attachments

For each main entity:
- activity enabled? yes/no
- comments enabled? yes/no
- attachments enabled? yes/no
- tracked fields
- which events should appear in activity
- what helper text is needed
- what named attachment types/flows should exist
- should the record have an attachment tab? yes/no

Typical activity events:
- status changes
- key field changes
- attachment uploads
- document creation
- email send actions
- transformation actions
- cancellation/rejection actions with reasons
- important cross-record linking events
- important automation-triggered outcomes
- source linking/unlinking
- source-based line import/prefill

## 12. Automations / Triggers

Only include if needed.

List:
- trigger event
- intended action
- required condition fields
- any automation entry-point actions users should be able to run manually
- any actions that should open a modal for confirmation, reason capture, or extra input

## 13. Shared Interfaces

State if the entity should participate in:
- scheduling/calendar
- documents
- dashboards

## 14. Display and Formatting Expectations

Where relevant, specify:
- which fields are money fields
- which currency field drives each money field
- which fields/cards must render with currency formatting
- which quantity fields require visible UOM beside them
- which home/dashboard cards should show formatted monetary totals rather than plain numbers

Example:

```text
Money fields:
- purchase_order.total_amount uses purchase_order.currency
- finance_entry.amount_nzd uses finance_entry.reporting_currency

Visible quantity/UOM pairs:
- purchase_order_line.quantity + purchase_order_line.order_uom
- supplier_offer.min_order_qty + supplier_offer.order_uom
```

If yes, specify which entity and which fields drive it.

Also state:
- should this entity be dashboardable?
- should this entity be documentable?
- should this entity be schedulable?
- does this record expect settings-driven numbering?
- should dashboard/status cards appear only on module home/dashboard pages? yes/no

## 14. Example Records

Provide 3-5 realistic example records:
- realistic names/numbers
- realistic statuses
- realistic related records

This dramatically reduces bad demo data generation.

## 15. Transformations and Cross-Module Expectations

State explicitly:
- what records this should transform into, if any
- what records may create this record, if any
- likely future module dependencies or integrations
- any cross-module assumptions that must stay stable
- which source records should be restricted by customer/supplier/status
- what relationship integrity must be validated on save/action
- what document actions should exist
- what email actions should exist
- what search filters and group-bys users will expect
- what dashboard/status cards, if any, are justified

## 16. Non-Negotiables

List explicit must-haves:
- fields that must exist
- exact action names
- route/page expectations
- workflow/state requirements
- settings-driven numbering expectations
- things that must not be generated

Include if relevant:
- no dashboard cards on normal list/form pages

## 17. Anti-Patterns To Avoid

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
