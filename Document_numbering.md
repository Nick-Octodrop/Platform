Octodrop Document Numbering Engine — Architecture Spec for Codex
Objective

Build a reusable kernel-level document numbering engine for Octodrop so all modules can generate consistent, configurable, unique business numbers such as:

Quote Number
Customer Order Number
Purchase Order Number
Work Order Number
Invoice Number
Credit Note Number
Job Number
Ticket Number
Project Number

This must be implemented as a platform capability, not as per-module custom logic.

The engine should support:

configurable numbering patterns
scoped counters (global / entity / workspace)
reset policies (never / yearly / monthly)
assignment timing (create / save / confirm / issue)
immutable numbering for issued documents
admin-facing settings UI

The goal is to give customers flexibility while keeping numbering safe, auditable, and maintainable.

Core Design Principles
1. Kernel capability, not module-specific

Do not embed numbering logic separately inside Quotes, Orders, Invoices, etc. All modules must call a shared numbering service.

2. Admin-configurable, user-safe

Admins should configure numbering patterns in settings. Normal users should not manually define numbering rules.

3. Predictable and auditable

Once a document reaches an official status, its number should be locked by default.

4. Support real business needs without overengineering

V1 should support the most common business requirements cleanly. Avoid building a scripting language.

5. Scalable across modules and tenants

The engine must work for multiple workspaces, multiple modules, and multi-entity customers.

Functional Requirements

The numbering engine must allow a module to request the next number using something like:

target model
sequence code
current workspace
current entity (optional)
current date/time
assignment event

It must return a unique number such as:

QUO-2026-0001
ORD-NL-2026-0045
PO-UAE-00012
INV-2026-04-0018
V1 Scope
In scope
sequence definitions
scoped counters
tokenized patterns
admin settings UI
preview generation
locking after assignment
global and entity-scoped numbering
yearly/monthly/no reset
assignment on lifecycle event
Out of scope for V1
arbitrary formula language
user-defined custom code execution
per-user numbering scopes
retroactive mass renumbering
legal compliance engines for country-specific invoice numbering
complicated gapless accounting guarantees
branch/site/customer-specific advanced scopes unless easy to add later
Data Model

Create a kernel-backed numbering system with at least these core models.

1. Sequence Definition

Model suggestion: kernel.sequence_definition

Purpose

Stores the configuration for a sequence type.

Fields
code — unique internal key, e.g. sales.quote, sales.order, billing.invoice
name — user-facing label, e.g. Quote Number
target_model — model the sequence applies to
description — optional help text
is_active — boolean
pattern — formatting pattern, e.g. QUO-{YYYY}-{SEQ:4}
scope_type — enum: global, entity, workspace
reset_policy — enum: never, yearly, monthly
assign_on — enum: create, save, confirm, issue, custom
lock_after_assignment — boolean
allow_admin_override — boolean
next_value_preview — computed preview only, not source of truth
notes — optional admin notes
sort_order — optional integer for settings UI
workspace_id — if definitions are per workspace
default_entity_fallback — optional
created_at
updated_at
Constraints
code must be unique per workspace
pattern cannot be blank
target_model cannot be blank
2. Sequence Counter

Model suggestion: kernel.sequence_counter

Purpose

Stores the current counter state per effective scope and period.

Fields
sequence_definition_id
workspace_id
scope_key — resolved scope key, e.g. global, entity:nlight_bv
year — nullable, used for yearly/monthly resets
month — nullable, used for monthly resets
current_value — integer
created_at
updated_at
Constraints

Unique constraint on:

sequence_definition_id
workspace_id
scope_key
year
month

This prevents duplicate counters for the same reset bucket.

3. Optional Number Assignment Log (recommended)

Model suggestion: kernel.sequence_assignment_log

Purpose

Auditability and debugging.

Fields
sequence_definition_id
target_model
record_id
assigned_number
assigned_on_event
workspace_id
scope_key
assigned_at
assigned_by

This is optional for v1, but strongly recommended because it helps trace numbering issues.

Pattern / Token System

Use a restricted token system, not freeform code.

Supported V1 tokens
{YYYY} → 4-digit year
{YY} → 2-digit year
{MM} → 2-digit month
{DD} → 2-digit day
{SEQ} → raw sequence number
{SEQ:4} → padded sequence number to length 4
{ENTITY} → resolved entity code or short label
{WORKSPACE} → workspace code if available
{MODEL} → optional short model code
Example patterns
QUO-{YYYY}-{SEQ:4}
ORD-{ENTITY}-{YYYY}-{SEQ:4}
PO-{ENTITY}-{SEQ:5}
INV-{YYYY}-{MM}-{SEQ:4}
JOB-{SEQ:6}
Pattern validation rules

Codex must validate that:

pattern contains at least one {SEQ} token variant
tokens are from approved list only
formatting is syntactically valid
padding number is reasonable, e.g. 1–12

If invalid, reject save with clear admin-facing error.

Scope Resolution

The engine must support these V1 scopes.

1. Global

One counter for the sequence across the workspace.

Examples:

QUO-2026-0001
QUO-2026-0002
2. Entity

Separate counters per entity.

Examples:

INV-NL-0001
INV-NL-0002
INV-UAE-0001

Requires the numbering request context to provide entity code or entity identifier.

3. Workspace

Mostly same as global if each workspace is isolated, but keep explicit option for future-proofing.

Scope key examples
global → global
entity NLight BV → entity:nlight_bv
entity EcoTech FZCO → entity:ecotech_fzco
Reset Policies
1. Never

Counter increments forever.

2. Yearly

Counter resets every year. Counter bucket uses year.

Example:

QUO-2026-0001
QUO-2027-0001
3. Monthly

Counter resets every month. Counter bucket uses year + month.

Example:

INV-2026-04-0001
INV-2026-05-0001
Assignment Timing

Each sequence definition must support when the number is assigned.

Options
create
save
confirm
issue
custom
Recommended usage by document type
Quotes → create or save
Customer Orders → confirm
Jobs → create or confirm
Purchase Orders → create or confirm
Work Orders → create
Invoices → issue
Credit Notes → issue
Important rule

The engine should not assign a new number twice to the same record unless explicitly configured to allow override. If a record already has a locked assigned number, return existing value.

Locking / Immutability Rules
Default rule

Once a number is assigned to an official document and lock_after_assignment = true, users cannot edit it except admins with explicit override permission.

Recommended behavior
Draft records may remain editable if desired
Official records should be locked
Invoices and credit notes should almost always lock on issue
Purchase orders should usually lock on creation/confirmation
Quotes can be flexible, but once sent externally they should generally be locked
Admin override

If allow_admin_override = true, allow admin-only controlled editing through a dedicated action. Do not allow casual inline editing of issued document numbers.

Service Layer Design

Create a shared service such as:

SequenceService
or generate_next_number(...)
Core methods
1. preview_number(sequence_code, context)

Returns a sample number without incrementing the counter. Used in settings UI.

2. assign_number(sequence_code, record, context, event)

Main entry point. Responsibilities:

load sequence definition
verify event matches assign_on
if record already has a locked number, return existing
resolve scope
resolve reset bucket
acquire/update counter safely
build final string from pattern
persist assigned number to record
write audit log if enabled
3. validate_pattern(pattern)

Ensures token syntax is valid.

4. resolve_scope_key(sequence_definition, context)

Returns global, entity:xyz, etc.

5. resolve_counter_bucket(sequence_definition, context_date)

Returns year/month bucket depending on reset policy.

6. format_number(pattern, sequence_value, context)

Expands tokens into final output.

Concurrency / Safety Requirements

This part is critical.

When two records are created at the same time, they must not receive the same number.

Codex requirements

Implement counter increment using a safe transactional approach:

DB transaction
row-level lock on counter record, or equivalent safe atomic increment
create counter row if absent inside transaction

Do not use naive read-increment-write without locking.

Desired outcome

Even under concurrent record creation, numbers remain unique.

Module Integration Contract

Every module that needs numbering should define:

number field on model, e.g. quote_number, invoice_number
lifecycle event where numbering is requested
corresponding sequence definition code
Example mapping
sales.quote.quote_number → sequence code sales.quote
sales.order.order_number → sales.order
purchasing.purchase_order.po_number → purchasing.purchase_order
billing.invoice.invoice_number → billing.invoice
operations.work_order.work_order_number → operations.work_order
Preferred implementation pattern

Numbering should be triggered from shared lifecycle hooks, not hand-written separately in every module.

Admin Settings UI

Create a clean admin-facing settings page titled:

Document Numbering

This should not be a technical developer page. It should be understandable by business admins.

Settings list/table columns
Name
Target Model
Pattern
Scope
Reset Policy
Assign On
Next Preview
Active
Form / edit view fields
Name
Code
Target Model
Pattern
Scope Type
Reset Policy
Assign On
Lock After Assignment
Allow Admin Override
Active
Notes
Preview Sample
UX requirements
show live preview when pattern changes
show simple help text for available tokens
show warnings when changing a sequence already in use
show current effective next number preview
Token help block

Include a static help card listing supported tokens and examples.

Example:

{YYYY} = 2026
{MM} = 04
{SEQ:4} = 0001
{ENTITY} = NL
Safe Change Rules

Changing numbering rules after go-live can create confusion.

Required behavior

If a sequence definition is already in use:

allow future changes to pattern/settings
but do not retroactively update existing document numbers
show warning: changes apply to future records only
Do not do in V1
retroactive renumbering wizard
rewriting historical numbers automatically
Defaults / Seed Sequence Definitions

Codex should seed default sequence definitions for common business objects.

Suggested defaults
Quotes
Code: sales.quote
Name: Quote Number
Pattern: QUO-{YYYY}-{SEQ:4}
Scope: global
Reset: yearly
Assign On: create
Lock After Assignment: true
Customer Orders
Code: sales.order
Name: Customer Order Number
Pattern: ORD-{YYYY}-{SEQ:4}
Scope: global
Reset: yearly
Assign On: confirm
Lock After Assignment: true
Purchase Orders
Code: purchasing.purchase_order
Name: Purchase Order Number
Pattern: PO-{ENTITY}-{YYYY}-{SEQ:4}
Scope: entity
Reset: yearly
Assign On: create
Lock After Assignment: true
Invoices
Code: billing.invoice
Name: Invoice Number
Pattern: INV-{ENTITY}-{YYYY}-{SEQ:4}
Scope: entity
Reset: yearly
Assign On: issue
Lock After Assignment: true
Credit Notes
Code: billing.credit_note
Name: Credit Note Number
Pattern: CRN-{ENTITY}-{YYYY}-{SEQ:4}
Scope: entity
Reset: yearly
Assign On: issue
Lock After Assignment: true
Work Orders
Code: operations.work_order
Name: Work Order Number
Pattern: WO-{YYYY}-{SEQ:5}
Scope: global
Reset: yearly
Assign On: create
Lock After Assignment: true
Jobs
Code: operations.job
Name: Job Number
Pattern: JOB-{YYYY}-{SEQ:4}
Scope: global
Reset: yearly
Assign On: create
Lock After Assignment: true
Record-Level UX Rules
Display

Document numbers should appear prominently in list and form headers.

Read-only behavior

Once assigned and locked, the number field should be read-only in normal forms.

Draft behavior

If the module assigns number later in the lifecycle, show placeholder such as:

Not assigned yet
or blank

Do not generate fake temporary numbers unless intentionally designed.

Error Handling

Codex must handle these failure cases gracefully.

Examples
missing sequence definition
invalid pattern
missing required entity for entity-scoped sequence
assignment attempted on wrong lifecycle event
concurrency conflict / lock failure
Expected behavior

Return clear system/admin-facing messages, e.g.:

No active sequence definition found for billing.invoice
Sequence pattern must include a SEQ token
Entity-scoped numbering requires an entity in context
API / Internal Contract Suggestions

If Octodrop exposes internal APIs or actions, standardize the interface.

Example input
sequence_code
workspace_id
entity_code
date
event
record_id
target_model
Example output
assigned number string
metadata about counter bucket/scope if useful for debugging
Testing Requirements

Codex should add tests for the numbering engine.

Minimum test cases
Pattern formatting
expands {YYYY} correctly
pads {SEQ:4} correctly
rejects invalid tokens
Scope behavior
global scope increments one shared counter
entity scope keeps separate counters
Reset behavior
yearly reset creates fresh counter for new year
monthly reset creates fresh counter for new month
never reset continues same counter
Assignment behavior
assigns on correct lifecycle event only
does not assign twice when locked
Concurrency
two simultaneous requests produce two distinct numbers
Change safety
changing pattern affects future numbers only
existing assigned numbers remain unchanged
Recommended Build Order for Codex
Phase 1 — Kernel engine
Create sequence definition model
Create sequence counter model
Build pattern validator/formatter
Build assignment service
Add concurrency-safe increment logic
Phase 2 — Settings UI
Build Document Numbering admin page
Add preview and token help
Seed default sequence definitions
Phase 3 — Module adoption
Connect Quotes
Connect Orders
Connect Purchase Orders
Connect Invoices
Connect Work Orders / Jobs
Phase 4 — Polish
Add audit log if not already done
Improve warnings/help text
Add tests and edge-case handling
What Codex Must Avoid

Do not:

hardcode numbering logic independently inside each module
let users freely type invoice/PO numbers by default
retroactively renumber records automatically
allow issued accounting docs to be casually renamed
build an overcomplicated token language in v1
rely on non-transactional counter increments
Final Outcome

When complete, Octodrop should have a reusable numbering engine that:

works across modules
supports customer-specific numbering formats
handles multi-entity environments
stays safe under concurrency
gives admins control without creating chaos
feels like a real ERP/business platform capability

This should become a foundational kernel feature used by all current and future document-based modules.