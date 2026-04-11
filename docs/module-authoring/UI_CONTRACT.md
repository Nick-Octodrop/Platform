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
- `format`
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

Display formatting behavior:
- numeric money fields should use `format.kind: "currency"` with a real `currency_field`
- quantity fields that need visible unit context in forms/lists should use `format.kind: "measurement"` with `unit` or `unit_field`
- time-quantity fields like lead times should use `format.kind: "duration"` with `unit`
- percentage inputs should use `format.kind: "percent"` so the `%` affix is rendered by the runtime
- money summary/stat cards should use `format: "currency"`
- do not rely on users inferring currency from nearby labels when the runtime can render the amount properly
- if a quantity matters operationally, show its UOM in the same list/form surface rather than leaving quantity context implicit

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

## 6. Record UX Standards

Operational record pages should follow a stable pattern.
Do not improvise record layouts page by page.

### Header-first record design

Operational records should usually present the core business context immediately:
- human-readable title
- visible status/statusbar where lifecycle matters
- primary business actions
- overflow / three-dot menu for secondary or admin actions

The header should make the record understandable without scrolling.

### Record as workspace

A record form should usually feel like a working surface, not a field dump.

Typical shape:
- header
- core fields and main business sections
- tabs for related and secondary data
- activity pane for operational records

If the user needs to act on the record, review its state, and move to related work, the form should support that directly.

The record should guide the user toward the next correct business step, not just expose raw fields.

### Form structure

Use a consistent form structure:
- header area for the record title, status, and actions
- main form body for the core record fields
- related tabs for secondary record surfaces

Rules:
- line items must be in their own tab
- embedded related lists inside a form must be in their own tab
- the main form body should be reserved for the record itself, not related tables/lists
- if a record has multiple logical surfaces, prefer tabs over one giant long form
- if the child rows are true operational line items, use the form `line_editor` pattern instead of embedding a generic related list
- generic related lists are for secondary child records; inline line editors are for rows users are expected to add/edit/remove directly as part of the parent workflow
- child people/master-data records such as contacts, addresses, or approvers should normally stay as real child entities surfaced through `related_list`, not be forced into a line-editor pattern
- when embedding a child record list on its parent form, prefer a dedicated inline list view that hides redundant parent columns and shows the fields users actually scan there

Good:
- Summary tab for core fields
- Line Items tab
- Documents tab
- Activity on the side or in the record activity area
- purchase order lines authored as a real line entity but edited inline through `section.line_editor`

Bad:
- line items mixed into the main summary section
- child lists inserted between core record fields
- one giant form with no structural separation
- purchase order/invoice/order lines shown as a generic related-list table when the platform supports inline line editing
- supplier/customer contact subrecords authored as fake line items just to keep them inside the parent form

### Business section grouping

Group fields by business meaning, not arbitrary layout balance.

Common section patterns:
- General
- Customer / Supplier
- Scheduling
- Financials
- Assignment
- Delivery / Fulfilment
- Internal Notes

Do not create random sections like `Left Column` or `Extra Details`.

### Money and quantity presentation

If users read a number as money or quantity, the UI should make that obvious immediately.

Rules:
- money fields should render with currency-aware formatting, not bare decimals
- if the record carries multiple currencies, the relevant currency field should drive display formatting
- dashboard/home cards that summarise money should use currency formatting too
- quantity fields should be paired with visible UOM fields wherever quantities drive decisions
- do not hide the UOM on line-item style records where the unit changes purchasing, pricing, fulfilment, or reporting meaning

Good:
- `Unit Cost` rendered from a numeric field with currency formatting
- `Open Value` stat card rendered as currency
- line items showing `Quantity`, `Order UOM`, and `Unit Cost` together

Bad:
- `1250.00` shown with no currency context
- quantity shown in a list while the unit is only buried in the form

### Status and workflow UX

Most operational records should have:
- a real status field
- a visible status bar/stepper when workflow is important
- explicit transition actions

Rules:
- workflow actions should reflect real transitions, not generic toggles
- actions that move status forward/back should only appear when they are valid
- invalid transition actions should be hidden rather than shown disabled unless there is a strong UX reason to explain why the action is blocked
- status bars and visible status actions should be used when the record lifecycle is meaningful to users

### Smart buttons / related counters

Where related records matter operationally, surface them as smart counters or quick related actions.

Good examples:
- Quotes
- Orders
- Invoices
- Tasks
- Documents

Use these intentionally where they improve navigation and cross-module flow.

### Readonly by state

Where governance or process matters, forms should become more readonly as records progress.

Typical pattern:
- draft: mostly editable
- confirmed/approved: partially locked
- completed/closed: largely readonly

### Required by state

Required fields do not always need to be required from the first keystroke.

Typical pattern:
- draft can allow partial entry
- confirm/approve/complete may require more fields

Use state-dependent requirements where that matches the real process.

### Archive over delete

For many operational/business records, archive is safer than delete.

Delete should usually be limited to:
- early-stage draft records
- safe configuration/reference data

### Duplicate where relevant

Consider Duplicate where repetitive records are common.

Typical examples:
- quotes
- orders
- templates
- repetitive work records

### Action hierarchy

Header actions should be intentional.

Rules:
- primary actions are for the most important workflow/business actions only
- less common or secondary actions should go in the overflow / three-dot menu
- do not overcrowd the header with too many visible actions
- one obvious next action should usually be visible for the current state
- destructive/admin actions should not dominate the header

Good primary actions:
- Approve
- Send Quote
- Convert to Order
- Mark Shipped

Good overflow actions:
- Duplicate
- Archive
- Generate PDF
- Send by Email
- Trigger Automation

Do not design actions generically.
Actions should match the real business workflow of the record.

### Activity pane

Operational records should generally have activity enabled.
Reference/config entities can omit it where appropriate.

Important events that should usually post to activity:
- status changes
- key field changes
- attachment uploads
- document creation
- email/send actions
- transformation actions
- cancellation/rejection actions with reasons
- important cross-record linking events
- notable automation-triggered outcomes where appropriate
- important workflow/business actions where appropriate

### Dashboard / status card discipline

Status cards and dashboard-style KPIs should be used intentionally.

Good use:
- module home pages
- dedicated dashboard pages

Avoid:
- placing dashboard/status cards at the top of normal list pages unless there is a strong operational reason
- placing dashboard/status cards at the top of normal form pages unless they are genuinely part of the working surface

Overuse adds clutter and weakens the actual record workflow.

### Navigation

Navigation should support useful entry points, not just one generic page.

Encouraged patterns:
- My Records
- Open Records
- Due This Week
- Drafts
- Awaiting Approval

Use filtered list pages / quick-filter entry pages where they genuinely help users enter the workflow faster.

### View mode selection

Choose view modes based on the record/data shape.
Do not expose modes just because the runtime supports them.

Use:
- list for tabular records
- kanban for status-driven records
- calendar for date-driven records
- graph/pivot for analytical records

Rules:
- include only modes that make sense
- hide irrelevant modes rather than showing disabled modes

### Search, filter, and grouping expectations

List pages should feel operationally useful, not raw database tables.

Where relevant, define:
- quick filters
- owner/my-record filters
- state filters
- date filters
- group-by options such as status, owner, customer, project, month

The list surface should help users work the queue, not browse raw data.

### Field typing

Field types must be intentional because the runtime depends on them.

Rules:
- use structured address fields where address autocomplete / mapping is expected
- use correct lookup, user, enum, date, and datetime types so the UI and automations can render good editors
- keep address field naming aligned with recognised patterns if you expect Google Places and structured address behavior to work
- structure fields so dynamic controls and future builders can reason over them cleanly

### Helper text and user guidance

Use helper text intentionally where it reduces mistakes or explains business intent.

Good uses:
- why a field becomes required at a given state
- what an action will do
- why a lookup is filtered
- what an attachment type is for
- what a cancellation reason will be used for

Rules:
- use helper text where a field is confusing, important, or commonly misunderstood
- use helper text where validation expectations are not obvious
- use helper text for actions/modals where the consequence needs clarification
- do not add helper text to obvious fields just to fill space

## 7. Actions in the UI

The shell and form headers expect actions to be explicit and evaluable.

Use:
- `primary_actions`
- `secondary_actions`
- page header `actions`

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
- other contextual actions that are meaningful for the record type

Rules:
- actions should be intentional and relevant to the record lifecycle
- document/email/automation actions should be included where they are a normal user expectation for that record type
- upload/request attachment actions should be included where supporting files are part of the real process
- these actions should follow the same visibility/enabled rules as workflow actions
- rarely used actions should live in the overflow menu
- one obvious next action should usually be visible for the current state
- destructive/admin actions should not dominate the header
- do not add actions just for completeness; they should match the real workflow

Action categories Codex should consider where relevant:
- workflow transitions
- create related records
- transformations
- document generation
- email sending
- automation triggers
- upload/request attachment
- archive / duplicate

Operational records should usually be designed with:
- workflow-driven actions
- contextual document actions
- contextual email/send actions
- named attachment actions where supporting files matter
- automation/process entry-point actions where the business flow expects them

If actions should disable/hide based on record state:
- use `enabled_when`
- use `visible_when`

The current UI will explain many disabled actions if the condition is explicit enough.

### Modal usage for actions

Use modals intentionally when an action needs:
- confirmation
- extra context
- a reason
- additional user input
- review before sending/generating/transforming
- more than one important option before execution

Good examples:
- Send Email
- Generate Document
- Cancel Job
- Reject Approval
- Convert / Transform record
- Trigger an operational process with options

Rules:
- do not fire sensitive or consequential actions immediately if user input or confirmation is expected
- modal copy should explain what will happen
- do not use a modal for every trivial action
- include explanation, confirmation, and optional extra input where that reduces user mistakes

Modal inputs may include:
- confirmation
- reason text
- comments/notes
- recipient options
- template/document options
- transformation choices

### Attachment UX

Where record-specific attachments matter, attachment handling should be obvious and named by purpose where appropriate.

Good examples:
- Upload Signed Quote
- Upload Supplier Invoice
- Upload Site Photo
- Upload Delivery Docket

Rules:
- important record-specific attachments should be clearly available
- attachment buttons/areas should be named by purpose/type where that helps users
- important uploads should appear in activity and/or attachment tabs where appropriate
- operational records that depend on supporting files should not hide attachments behind vague generic affordances
- attachments should feel part of the workflow, not an afterthought

## 8. List and Page Surfaces

Preferred patterns:
- page -> container(card) -> view
- page -> container(card) -> view_modes
- form pages and list pages should usually be separate page ids

Why:
- this matches the current shell padding/card structure
- it produces stable routing targets
- it avoids brittle runtime inference

## 9. View Modes

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

## 10. Workflows and Status UI

If an entity is truly workflow-driven:
- define a workflow
- use a real status enum field
- optionally use `ui.widget: "steps"` on the enum where that presentation is wanted

Do not:
- fake workflow with just a random enum and no transitions if header/status behavior matters

## 11. Dynamic Controls in Automation/Rules UI

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
- author fields so conditions and expressions stay simple and typed, not stringly

## 12. Known UI Anti-Patterns

- missing `display_field`
- record pages without form pages
- list pages without `open_record_target`
- giant ungrouped forms with no sections
- line items and related lists mixed into the main form body
- too many visible header actions
- workflow actions shown when they are not valid
- activity enabled on every config entity
- lookup fields without target metadata
- enum fields without options
