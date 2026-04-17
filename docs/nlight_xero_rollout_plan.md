# NLight Xero Rollout Plan

## Purpose

This document is the current source of truth for how NLight's Xero integration should be introduced into Octodrop.

The goal is to move carefully, avoid duplicate finance records, and prove the commercial workflow before any broad or automatic accounting sync is enabled.

## Business Context

NLight's target workflow is:

1. Lead / opportunity starts in Octodrop CRM
2. Quote is created in Octodrop
3. Accepted quote becomes a customer order
4. Customer order raises a linked purchase order to the OEM supplier
5. Deposit, progress, final, and credit-note invoicing are managed against the order
6. Finance truth ultimately lives in Xero

Relevant module coverage already exists in `manifests/commercial_v2`:

- `crm.json`: CRM/deal workspace and sales handoff
- `quotes.json`: quoting, entity/currency, line margin control
- `orders.json`: order chain, deposit invoice, final invoice, linked PO
- `purchase_orders.json`: linked supplier PO flow
- `invoices.json`: deposit, progress, final, credit note
- `contacts.json`: customer, supplier, factory partner separation

## Current Platform Reality

### What is solid already

- Xero OAuth connection
- Tenant selection and tenant header handling
- Manual API explorer and saved request templates
- Request-template reuse inside automations
- Integration mappings for provider -> Octodrop translation

### What is not production-safe yet for broad finance sync

- No clear Xero external ID fields on core commercial records
  - Example: no obvious `xero_contact_id`, `xero_invoice_id`, `xero_credit_note_id`
- No obvious chart-of-accounts / tax-code fields on products or invoice lines
- Current Xero sync runtime is constrained to inbound/provider-owned mode
- Current mapping model is strongest for inbound translation, not full outbound finance posting

## Guiding Principles

1. Do not enable "sync everything".
2. Choose one source of truth per object type before writing any data.
3. Start with one entity only.
4. Start with manual or controlled outbound posting before any automatic posting.
5. Payment status can come back from Xero only after invoice posting is stable.
6. Purchase-order finance sync must wait until customer invoice sync is proven.
7. CRM and commercial workflow should stay inside Octodrop for this rollout; Xero is finance, not pipeline management.

## Source Of Truth Matrix

### Phase 1 source of truth

| Object | Source of truth | Notes |
|---|---|---|
| CRM lead / deal | Octodrop | No Pipedrive dependency in this rollout |
| Quote | Octodrop | Not pushed to Xero |
| Customer Order | Octodrop | Operational record only |
| Purchase Order | Octodrop | Operational only in phase 1 |
| Customer Invoice draft / commercial intent | Octodrop | Octodrop creates the finance payload |
| Posted invoice / payment / receivable truth | Xero | Once invoice is posted, finance truth lives in Xero |
| Contact used operationally | Octodrop | But only pushed to Xero in a controlled way |
| Product catalogue | Octodrop | No live Xero item sync in phase 1 |

### Phase 2 source of truth

| Object | Source of truth | Notes |
|---|---|---|
| Payment status | Xero | Pulled back into Octodrop |
| Credit note status | Xero + Octodrop link | Only after invoice IDs are stable |

## Rollout Scope

## Phase 0: Connection and Discovery

Scope:

- Connect `NLight BV` Xero only
- Do not write any records yet
- Pull and inspect:
  - contacts
  - chart of accounts
  - tax rates
  - currencies
  - tracking categories, if used

Exit criteria:

- Connection stable
- We understand NLight BV's Xero structure
- We know which accounts and tax rates the first invoice export must use

### Discovery findings: NLight BV

The first live discovery pass against the connected NLight BV Xero tenant confirmed:

- Organisation
  - `Name`: `NLight B.V.`
  - `OrganisationID`: `f4f2c982-550a-4609-afe1-77ade7f5ab70`
  - `BaseCurrency`: `EUR`
  - `CountryCode`: `NL`
  - `DefaultSalesTax`: `Tax Exclusive`
  - `DefaultPurchasesTax`: `Tax Exclusive`

- Xero connections endpoint
  - `GET /connections` under the normal accounting base URL returned `404`
  - This is not a finance-data problem. The Xero connections endpoint lives on the separate global endpoint and is already covered by the connection test flow.
  - Do not treat this as a rollout blocker.

- Accounts
  - Default sales account candidate:
    - `Code 200` / `Sales`
  - Direct-cost / purchase-side accounts exist already:
    - `310` / `COGS – Materials`
    - `311` / `COGS – Freight-In`
    - `330` / `COGS – Project Freight`
  - Receivables / payables system accounts exist:
    - `610` / `Accounts Receivable`
    - `800` / `Accounts Payable`

- Tax rates
  - Local standard sales:
    - `TAX001` / `1a. Local Sales Standard (21%)`
  - Non-EU goods export:
    - `TAX009` / `3a. Non-EU Export of Goods (Zero-rated)`
  - EU goods reverse charge:
    - `TAX016` / `3b. EU Sales of goods (Reverse charged)`
  - Ex Works tax-exempt special case:
    - `TAX018` / `Tax Exempt - Sales (ExWorks - T1)`

- Contacts
  - NLight BV already has a large live contact set in Xero.
  - This confirms duplicate-contact risk is real.
  - We should not bulk push operational contacts into Xero until matching rules are defined.

## Phase 1: Controlled Invoice Export

Scope:

- Start with customer invoices only
- Start with `deposit` and `final` invoices only
- Export from Octodrop to Xero as a controlled action
- Prefer draft creation first, not background automatic posting

Explicitly out of scope:

- automatic invoice posting on status change
- purchase order sync
- product/item sync
- bi-directional contact sync
- EcoTech FZCO

Exit criteria:

- An Octodrop invoice can be exported once
- A second export does not create a duplicate
- Returned Xero invoice ID is stored on the Octodrop record
- User can see that the invoice has been posted to Xero

### Recommended phase-1 defaults for NLight BV

Unless finance says otherwise, phase 1 should start with these defaults:

- Entity:
  - `NLight BV` only
- Invoice creation mode:
  - Create in Xero as `draft`
- Default sales account:
  - `200 / Sales`
- Invoice tax handling:
  - Tax-exclusive
- Tax-rate starting map:
  - Dutch local sale -> `TAX001`
  - Non-EU export of goods -> `TAX009`
  - EU goods reverse charge -> `TAX016`
  - Ex Works tax-exempt case -> `TAX018`
- Contact handling:
  - Match existing Xero contact first
  - Do not bulk-create all Octodrop contacts in Xero
  - Only create a Xero contact when no safe match exists and the invoice export is explicitly approved

## Phase 2: Payment Status Pullback

Scope:

- Pull payment / amount-due / paid-state back from Xero for invoices that already have a linked Xero ID
- Reflect that in Octodrop for operational visibility

Explicitly out of scope:

- full invoice mutation sync back into Octodrop
- re-authoring Octodrop commercial totals from Xero

Exit criteria:

- Finance team can post or reconcile payment in Xero
- Octodrop reflects paid / part-paid / balance state without manual re-entry

## Phase 3: Contact Sync Review

Scope:

- Decide whether customer contacts should be:
  - created in Octodrop then pushed to Xero
  - or matched to pre-existing Xero contacts first

Recommendation:

- Use Octodrop as the operational source for customer contacts
- Only create/update Xero contacts through an explicit controlled action with stored Xero contact IDs

## Phase 4: Purchase-Side Finance Review

Scope:

- Review whether NLight actually needs purchase orders mirrored into Xero in phase 1/2
- If yes, design it separately from customer invoice export

Recommendation:

- Do not sync purchase orders to Xero until invoice export and payment pullback are proven
- Keep supplier POs operational in Octodrop first

## Entity Rollout Order

Recommended order:

1. `NLight BV`
2. Validate invoice posting and payment pullback
3. Only then assess `EcoTech FZCO`

Reason:

- NLight BV is the sales-facing entity Luke cares about most
- Adding the UAE purchasing entity too early increases duplication and ownership risk

## Required Platform Additions Before Live Finance Posting

These should exist before invoice export is considered production-ready:

- `xero_contact_id` on contact records
- `xero_invoice_id` on invoice records
- `xero_credit_note_id` on invoice or linked credit-note records
- `xero_last_sync_at`
- `xero_last_sync_status`
- `xero_last_sync_error`
- an idempotent "already exported" guard

Likely also needed shortly after:

- account-code mapping
- tax-rate mapping
- per-entity export defaults

## First Safe Outbound Use Case

The first write path should be:

- `NLight BV` customer invoice
- created from an Octodrop invoice record
- pushed to Xero as a draft sales invoice
- linked back by stored `xero_invoice_id`

That is safer than:

- pushing contacts first
- pushing purchase orders first
- enabling generic automation-driven finance writes first

## What We Should Not Do Yet

- No broad Xero sync toggle
- No bidirectional contact sync
- No automatic PO push to Xero
- No automatic "every invoice status change posts to Xero"
- No live EcoTech finance sync until NLight BV is proven
- No field ownership ambiguity between Octodrop and Xero

## Operational Checklists

### Pre-flight checklist

- Xero connection tested successfully
- NLight BV tenant confirmed
- Accounts and tax rates reviewed
- Invoice template and numbering validated in Octodrop
- Manual export action decided
- Duplicate-prevention rule decided

### Go-live checklist for phase 1

- Export one test deposit invoice
- Verify totals, currency, customer, and tax in Xero
- Re-run export and confirm no duplicate is created
- Export one test final invoice
- Confirm returned IDs are stored
- Confirm finance user is comfortable posting from that state

## Recommended Next Build Slice

Build in this order:

1. Add Xero linkage fields to contacts and invoices
2. Add controlled "Export invoice to Xero" flow for `NLight BV`
3. Add duplicate prevention and sync status surface
4. Add payment pullback for linked invoices

Do not start with:

1. full generic sync
2. PO sync
3. contact bidirectional sync
4. EcoTech finance sync

## Phase 1 Detailed Build Spec

This section turns phase 1 into an implementation blueprint for a workspace-configured Xero bridge.

The design principle is:

- commercial actions stay inside Octodrop manifests
- Xero behavior is configured per workspace in Integrations and Automations
- record-level Xero fields are only for linkage, visibility, idempotency, and diagnostics

### Exact record fields to add

These are the exact linkage fields phase 1 should add to the commercial workspace.

#### On contacts

Entity: `entity.biz_contact`

- `biz_contact.xero_contact_id`
  - type: `string`
  - purpose: stable link to the Xero contact once matched or created
- `biz_contact.xero_last_sync_status`
  - type: `string`
  - purpose: latest contact sync state such as `linked`, `created`, `needs_review`, `failed`
- `biz_contact.xero_last_sync_at`
  - type: `string` or datetime-formatted string
  - purpose: last successful or attempted contact link/sync time
- `biz_contact.xero_last_sync_error`
  - type: `text`
  - purpose: latest contact matching or sync error shown to the user

#### On invoices

Entity: `entity.biz_invoice`

- `biz_invoice.xero_invoice_id`
  - type: `string`
  - purpose: stable link to the Xero invoice created from Octodrop
- `biz_invoice.xero_credit_note_id`
  - type: `string`
  - purpose: reserved for phase 2+ credit-note linkage
- `biz_invoice.xero_last_sync_status`
  - type: `string`
  - purpose: latest invoice export state such as `queued`, `exported`, `needs_review`, `failed`
- `biz_invoice.xero_last_sync_at`
  - type: `string` or datetime-formatted string
  - purpose: last export attempt or last successful Xero refresh time
- `biz_invoice.xero_last_sync_error`
  - type: `text`
  - purpose: latest export error, duplicate warning, or review message

#### Xero Link tabs

Add a `Xero Link` section/tab to:

- contact form
- invoice form

It should show the above linkage and status fields only. It should not contain the export action itself.

### Workspace integration config

These are not record fields. They are per-workspace Xero settings and should live in the workspace integration/automation setup.

Required phase-1 config:

- target Xero connection
- target Xero tenant
- enabled entity list
  - phase 1 value: `NLight BV` only
- export mode
  - phase 1 value: `draft`
- default sales account code
  - phase 1 value: `200`
- tax handling mode
  - phase 1 value: `Tax Exclusive`
- tax code map
  - local Dutch sale -> `TAX001`
  - non-EU export -> `TAX009`
  - EU reverse charge goods sale -> `TAX016`
  - Ex Works tax-exempt -> `TAX018`

### Exact request templates to save

Save these request templates on the Xero connection. These become the reusable building blocks for automations.

#### Discovery / setup templates

1. `organisation_get`
   - method: `GET`
   - path: `/Organisation`
   - purpose: confirm tenant and organisation details

2. `accounts_list`
   - method: `GET`
   - path: `/Accounts`
   - purpose: confirm account codes and account types

3. `tax_rates_list`
   - method: `GET`
   - path: `/TaxRates`
   - purpose: confirm workspace tax code map

4. `contacts_list`
   - method: `GET`
   - path: `/Contacts`
   - purpose: one-off review and troubleshooting only

#### Runtime templates for phase 1

5. `contacts_find`
   - method: `GET`
   - path: `/Contacts`
   - default query:
     - `summaryOnly=true`
   - automation overrides:
     - `where`
   - purpose: search for a candidate contact before creating one

6. `contacts_create`
   - method: `POST`
   - path: `/Contacts`
   - purpose: create a Xero contact only when no safe match exists

7. `invoices_create`
   - method: `POST`
   - path: `/Invoices`
   - purpose: create the Xero sales invoice as `DRAFT`

8. `invoices_find`
   - method: `GET`
   - path: `/Invoices`
   - default query:
     - `summaryOnly=true`
   - automation overrides:
     - `where`
   - purpose: idempotency check and later refresh lookups

#### Phase 2 templates to add later, not in phase 1

- `invoices_get_by_id`
- `payments_list`
- `credit_notes_create`
- `credit_notes_find`

### Exact automations to create

Phase 1 should create two live automations and one optional admin repair automation.

#### Automation 1: `xero_export_invoice_on_issue`

Purpose:

- export an Octodrop invoice to Xero when the invoice becomes commercially issued

Recommended trigger:

- `record.updated` on `entity.biz_invoice`

Trigger conditions:

- `biz_invoice.status = issued`
- `biz_invoice.invoice_type in [deposit, final]`
- `biz_invoice.xero_invoice_id` is blank
- `biz_invoice.sales_entity = nlight_bv`
- workspace Xero integration is enabled

Steps:

1. Query the related customer contact from `entity.biz_contact`.
2. Resolve or create the Xero contact using the contact-resolution rules below.
3. Run an idempotency check against Xero before invoice creation.
4. If a matching Xero invoice already exists:
   - write back `biz_invoice.xero_invoice_id`
   - set `biz_invoice.xero_last_sync_status = exported`
   - stop without creating a duplicate
5. If no matching Xero invoice exists:
   - call `invoices_create`
   - create a `DRAFT` Xero invoice
6. Write back:
   - `biz_invoice.xero_invoice_id`
   - `biz_invoice.xero_last_sync_status = exported`
   - `biz_invoice.xero_last_sync_at`
   - clear `biz_invoice.xero_last_sync_error`
7. On failure:
   - set `biz_invoice.xero_last_sync_status = failed`
   - set `biz_invoice.xero_last_sync_at`
   - set `biz_invoice.xero_last_sync_error`

#### Automation 2: `xero_refresh_invoice_payment_state`

Purpose:

- refresh Xero-backed finance state for invoices already linked to Xero

Recommended trigger:

- scheduled automation
  - phase 1 frequency: every 1-4 hours during business hours, or nightly at minimum

Scope conditions:

- `biz_invoice.xero_invoice_id` exists
- `biz_invoice.sales_entity = nlight_bv`

Steps:

1. Query Xero for the linked invoice using `invoices_find`.
2. Map back:
   - Xero status
   - amount paid
   - balance due
3. Update Octodrop:
   - `biz_invoice.amount_paid`
   - `biz_invoice.balance_due`
   - `biz_invoice.status`
     - `issued` if unpaid
     - `part_paid` if partially paid
     - `paid` if fully paid
   - `biz_invoice.xero_last_sync_status = refreshed`
   - `biz_invoice.xero_last_sync_at`
4. On failure:
   - keep the Octodrop commercial record
   - set `biz_invoice.xero_last_sync_status = failed`
   - set `biz_invoice.xero_last_sync_error`

#### Optional admin repair automation: `xero_relink_contact_or_invoice`

Purpose:

- retry failed exports or relink records after manual cleanup in Xero

Use cases:

- a user fixed a duplicate in Xero
- a finance user created the invoice manually in Xero and wants Octodrop linked cleanly
- a contact match was ambiguous earlier and now has been reviewed

This should be manual/admin-only, not part of normal live flow.

### Exact matching rules for contact resolution

The rule is: only create a Xero contact at first finance write, not at Octodrop contact creation time.

Resolution order:

1. If `biz_contact.xero_contact_id` exists:
   - use it directly

2. Try exact safe-match checks against Xero:
   - exact VAT / tax number match
   - else exact company / registration number match
   - else exact normalized email plus exact normalized contact/company name
   - else exact normalized legal/company name only

Normalization rules:

- trim leading and trailing whitespace
- lowercase for comparison
- collapse repeated internal spaces
- strip punctuation differences where reasonable for name comparison
- do not treat partial or fuzzy matches as safe

Safe-match rule:

- exactly one candidate must pass the current step

If zero candidates pass:

- create the Xero contact from Octodrop customer data
- store returned `biz_contact.xero_contact_id`
- set `biz_contact.xero_last_sync_status = created`

If more than one candidate passes:

- do not create anything
- set:
  - `biz_contact.xero_last_sync_status = needs_review`
  - `biz_contact.xero_last_sync_error = multiple_xero_contact_matches`
- fail the invoice export cleanly

Fields to send when creating the Xero contact:

- name / legal name
- email
- phone
- billing address
- tax number
- registration / company number if present

Do not try to keep full bidirectional contact field parity in phase 1.

### Invoice idempotency rule

Phase 1 must not create duplicates.

Before `invoices_create`, the automation should query Xero for an existing invoice using a strict where-clause built from:

- invoice number
- invoice type
- contact reference
- total amount

Preferred duplicate guard:

- if Xero invoice exists with the same Octodrop invoice number and same linked contact and same total, treat it as the canonical export and link back to it instead of creating a new invoice

### Exact phase-1 scope

This is the boundary for the first live release.

In scope:

- `NLight BV` only
- customer invoices only
- invoice types:
  - `deposit`
  - `final`
- Xero contact match-or-create on first invoice export
- Xero invoice creation as `DRAFT`
- writeback of `xero_contact_id` and `xero_invoice_id`
- payment-state pullback for linked invoices

Out of scope:

- `EcoTech FZCO`
- quote sync
- customer order sync
- purchase order sync
- supplier bill sync
- progress invoices
- credit-note export
- automatic push on every status mutation
- broad contact import from Xero
- bidirectional contact sync
- product / item sync
- tracking-category sync

### Recommended go-live sequence for this spec

1. Add the Xero Link fields and form sections.
2. Save the Xero request templates on the workspace connection.
3. Build `xero_export_invoice_on_issue`.
4. Test one deposit invoice end to end.
5. Re-run the same invoice export to prove idempotency.
6. Test one final invoice end to end.
7. Build `xero_refresh_invoice_payment_state`.
8. Confirm payment updates flow back into Octodrop without manual finance edits.

## Product Positioning For Luke

For Luke, the message should be:

- Octodrop now owns CRM as well as the commercial workflow
- Octodrop runs the commercial workflow
- Xero remains the accounting system of record
- We are introducing the finance bridge in controlled phases
- We are deliberately starting with low-risk invoice posting before any wider sync

That is the safest implementation path and the easiest one to defend if finance data quality is questioned later.


