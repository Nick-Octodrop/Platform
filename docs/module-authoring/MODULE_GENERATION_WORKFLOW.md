# Module Generation Workflow

Use this workflow when creating or modifying a module.

The goal is not only a valid manifest.
The goal is a module that fits the platform, supports future workflow logic, and behaves well in the runtime.

This is the practical generation order for Codex.

## 1. Read the Canonical Inputs First

Always read:
- [MANIFEST_SPEC.md](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/docs/module-authoring/MANIFEST_SPEC.md)
- [UI_CONTRACT.md](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/docs/module-authoring/UI_CONTRACT.md)
- [MODULE_BRIEF_TEMPLATE.md](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/docs/module-authoring/MODULE_BRIEF_TEMPLATE.md)
- [MODULE_ACCEPTANCE_CHECKLIST.md](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/docs/module-authoring/MODULE_ACCEPTANCE_CHECKLIST.md)

If a relevant example exists, read that too.

## 2. Confirm the Brief Is Actually Good Enough

Do not start generating from a vague brief.

The brief should clearly cover:
- main entities
- field types
- list/form pages
- actions
- workflow/status expectations
- related records
- activity expectations
- document/email/automation expectations where relevant
- currency or UOM needs where relevant
- transformation expectations where relevant
- context-aware lookup expectations where relevant
- dependent field behavior where relevant
- save/action validation expectations for important links

If these are missing, the brief is weak and the output will be weak.

## 3. Model Entities and Field Types Carefully

Before designing pages, decide:
- what the main entities are
- which entities are supporting/reference only
- which fields are titles, statuses, dates, amounts, quantities, lookups, users, booleans, attachments

Think through platform-aware field modeling:
- use booleans, not string flags
- use explicit enum options for statuses/types
- use date/datetime/number types correctly
- use user/users/lookup fields where relationships matter
- use structured address fields where location/autocomplete matters
- model money with amount + currency context where needed
- model measurable quantities with quantity + unit context where needed
- mark money fields with runtime currency formatting where users should see symbol-aware amounts
- mark money cards/summaries with currency formatting where totals are user-facing
- decide where UOM must stay visible next to quantity rather than only existing as hidden metadata
- identify which lookups should be filtered by customer/supplier/parent/state
- identify which fields should clear or revalidate when a parent field changes
- identify which source selections should prefill downstream fields

Bad:
- `status` as free text
- `owner_name` as a plain string
- `total_amount` with no currency context
- `quantity` with no unit where units matter

## 4. Design Views, Pages, Actions, and Workflow Together

Do not design pages separately from lifecycle and actions.

For each main record type, think through:
- list view
- form view
- optional kanban/calendar/graph/pivot
- whether the record needs a visible statusbar
- header actions
- overflow actions
- the next obvious business action for each important state
- which actions need a modal for confirmation/input/review
- workflow/status presentation
- related tabs
- activity
- smart buttons / related counters
- archive / duplicate expectations
- search filters and group-bys that will make the list page operational

Operational records should usually have:
- a visible status/workflow surface
- meaningful header actions
- activity enabled
- line items/related lists separated into tabs
- true line-item records authored through the inline `line_editor` pattern when the parent record is the main working surface

Also review:
- what helper text would reduce mistakes?
- does this record need named attachment flows?
- should key actions/events be tracked in activity?
- should this record use settings-driven numbering?
- are money values rendered with currency formatting rather than plain numbers?
- are quantity and UOM visible together on operational list/form surfaces?
- should this record have dashboard/status cards, and if so only on home/dashboard surfaces?
- is the UI becoming cluttered?

## 5. Think Through Cross-Module and Shared-Platform Implications

Before finalising:
- does this record naturally transform into another record?
- should it participate in shared interfaces like dashboardable/documentable/schedulable?
- will future modules need to reference it cleanly?
- do field ids and entity boundaries support downstream reuse?
- are source records filtered by valid workflow and consumption state?
- are important links validated beyond the UI picker?

Prefer:
- explicit transformations
- stable field naming
- clear source/target mapping

Avoid:
- ad hoc action side effects when a transformation is the real workflow
- field naming that blocks later interoperability
- enabling shared interfaces just because they exist

## 6. Review Expressions, Conditions, and Action Logic

The module should support future rules/builders cleanly.

Check:
- enums have explicit options
- booleans are typed correctly
- numbers/dates are not stored as strings
- lookup and user fields are real typed fields
- action `visible_when` / `enabled_when` logic is intentional
- workflow transitions match real lifecycle states
- context-aware lookups are filtered where needed
- dependent values clear or revalidate when parent context changes
- source selections prefill obvious downstream context where appropriate
- save/action integrity checks exist for important cross-record links

If the manifest cannot support conditions cleanly, the module is not ready.

Also check:
- does this record need archive instead of delete?
- are attachment flows named clearly where supporting files matter?
- are helper text and modal copy being used to explain non-obvious behavior?
- should fields be filtered by context?
- should parent/source selections prefill other values?
- is integrity validated on save/action as well as in the UI?

## 7. Validate Against the Acceptance Checklist

Before final output, review:
- [MODULE_ACCEPTANCE_CHECKLIST.md](/mnt/c/Users/nicwi/Documents/My%20Projects/OCTO/docs/module-authoring/MODULE_ACCEPTANCE_CHECKLIST.md)

Do not stop at "manifest validates".
The module is only done when:
- the structure is valid
- the UX is coherent
- the workflow is intentional
- the actions are meaningful
- the field modeling supports future platform logic
- record linking is safe and hard to misuse

## 8. Only Then Finalise the Manifest

Final output should reflect:
- runtime-valid structure
- sensible record UX
- intentional workflow/actions
- platform-aware field modeling
- future-safe interoperability where relevant

If the module is only structurally valid but weak in workflow, conditions, transformations, activity, or interfaces, it is not finished.
