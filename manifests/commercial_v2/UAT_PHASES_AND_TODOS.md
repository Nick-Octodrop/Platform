# NLight UAT Phases and Todo Plan

Last updated: 2026-05-03

This plan is based on the current NLight/Shelly/Luke chat history and the current Commercial V2 build. It separates what must be ready for first UAT/go-live from follow-up work that should not block initial sales and quoting usage.

## Target Outcome

NLight can test and then go live on the core Octodrop workflow for CRM, quoting, orders, invoicing, catalog products, document generation, and role-based access.

Target first go-live window from chat: Monday 4 May 2026.

## Current Readiness Position - 2026-05-03

This is the current status after checking Shelly's 30.04 feedback, Natalie's mandatory-fields document, the chat history, and the Commercial V2 manifests.

What is now structurally in place:

- Commercial manifests validate with zero manifest errors.
- CRM opportunity mandatory stage gates are implemented in the CRM manifest.
- Mandatory-field exception request, approval, rejection, and audit fields exist on opportunities.
- Exception approval actions are restricted to the nominated approver, not general Sales users.
- On Hold follow-up task automation is configured.
- Opportunity to quote and opportunity to order transformations exist.
- Opportunity line items now copy into order line items when creating an order from CRM.
- Rotting-deal detection is configured through workspace automations, not a hardcoded platform setting.
- Opportunity can be moved back to lead.
- Proposal/negotiation stage requires a quote or an approved exception.
- `en-GB` is available as a user/workspace locale option.
- Contacts now distinguish company/account records more clearly from people records.
- Company, billing, default delivery, and CRM site full-address snapshots are now carried into CRM, quotes, and orders.
- Pending and approved mandatory-field gate exceptions are visible from opportunity lists and CRM dashboard cards.
- UAT setup can set workspace defaults to English UK and Europe/London.

Current UAT risk:

- Contacts/sites/address handling has been tightened for company, billing, site, and default delivery addresses. It still needs browser UAT across Contacts -> CRM -> Quote -> Order before marking complete.
- Access profiles must still be tested by actually logging in as each user type, not just by reading rules.
- Xero setup now supports one automation/mapping set per selling entity, but NLight BV and EcoTech FZCO tenant/account-code/tax-code values must still be explicitly verified before real finance testing.
- Proposal and Claude scope is not Phase 1-ready unless a proposal model and example are supplied.
- Outlook calendar/email logging is not part of the first go-live unless it is pulled forward as a hard requirement.
- Exact missing-field messages and logging a blocked stage attempt will need a generic platform change, because current manifest conditions can disable actions but cannot yet explain every failed condition or log disabled-button attempts.
- Rotting-deal automation needs elapsed-time live UAT because the 14-day checks run after delayed automation waits.

Hard rule:

- Do not hardcode NLight-specific business rules into generic platform code.
- Generic platform code may support reusable capabilities, such as actor-aware action guards, locale fallback, line-item performance, audit trails, and generic validation.
- NLight-specific setup belongs in `manifests/commercial_v2`, setup scripts, workspace automations, access profiles, templates, and seeded data.

## Phase 0 - UAT Workspace Reset and Setup

Goal: create a clean, repeatable UAT workspace with modules, catalogue, roles, numbering, templates, and automations installed.

Status: ready to run once API token/workspace details are set.

Required commands:

```powershell
$env:OCTO_BASE_URL="https://app.octodrop.com"
$env:OCTO_API_TOKEN="your-token"
$env:OCTO_WORKSPACE_ID="nlight-workspace-id"
```

Clean setup:

```powershell
python manifests/commercial_v2/clear_workspace_data.py --dry-run
python manifests/commercial_v2/clear_workspace_data.py --continue-on-error
python manifests/commercial_v2/install_all.py
python manifests/commercial_v2/cleanup_removed_modules.py
python manifests/commercial_v2/setup_document_registry_metadata.py
python manifests/commercial_v2/setup_document_numbering.py
python manifests/commercial_v2/setup_quote_document_templates.py
python manifests/commercial_v2/setup_quote_scripts.py
python manifests/commercial_v2/seed_catalog_items.py
python manifests/commercial_v2/setup_access_profiles.py
python manifests/commercial_v2/setup_commercial_automations.py --publish
```

Single runner:

```powershell
python manifests/commercial_v2/setup_uat_workspace.py --clear-records --publish-automations
```

Phase 0 todos:

- [ ] Apply latest database migrations, including `061_records_generic_field_values.sql`.
- [ ] Run clean workspace setup in UAT.
- [ ] Confirm commercial modules install without manifest errors.
- [ ] Confirm quote document template exists and document automation has the resolved template id.
- [ ] Seed catalogue items from Shelly's workbook.
- [ ] Confirm supplier contacts are created but hidden from Sales profiles.
- [ ] Confirm document numbering starts at the required prefixes/counters for UAT.
- [ ] Confirm quote scripts from supplied Word docs are available in quote script selector.
- [ ] Confirm quote PDF filename does not double append `.pdf`.
- [ ] Confirm generated quote stays attached to the quote and does not navigate the user away unexpectedly.

## Phase 1 - Initial UAT and Sales Go-Live

Goal: NLight users can operate the core sales flow day to day.

Target: ready for testing before Monday 4 May 2026.

Included scope:

- CRM and sales workflow inside Octodrop.
- NLight BV and EcoTech sales separation.
- Catalogue products and custom quote lines.
- Quote scripts and quote document generation.
- Quote to order conversion.
- Core order/job visibility.
- Customer invoicing.
- Xero Phase 1: contacts and sales invoices.
- User creation, access profiles, and role restrictions.
- Performance sanity checks for home, record forms, lookups, autosave, and line items.

Phase 1 todos:

- [x] Set UAT workspace defaults to English UK and Europe/London.
- [ ] Confirm user-level timezone/locale override works for Netherlands, CIS, and remote users.
- [ ] Create staged users with temporary passwords.
- [ ] Log in as each role before handoff and verify permissions.
- [ ] Force password change only after internal access testing is complete.
- [ ] Remove "managed account" state/badge once user has created their own password.
- [ ] Confirm users do not get their own workspace automatically.
- [ ] Confirm each user belongs only to the intended workspace.
- [ ] Assign Luke, Matthew, Walter, Shelly, and Tamzin full/operational/finance access as per access sheet.
- [ ] Assign Joost and Joram to Sales NLight BV only.
- [ ] Confirm CIS/EcoTech sales users cannot see NLight BV sales records, and vice versa.
- [ ] Confirm Sales users cannot see suppliers, supplier contacts, buy price, EcoTech purchase cost, intercompany cost, or product supplier source rows.
- [ ] Confirm Sales users can still quote using product catalogue labels, sell prices, descriptions, and allowed specs.
- [ ] Confirm Dutch, English, French, and Russian localisation coverage for core modules.
- [ ] Add Russian localisation pass if still incomplete.
- [ ] Confirm `/home` load time is acceptable from UK/Netherlands.
- [ ] Confirm record autosave does not revert changes.
- [ ] Confirm lookup fields load quickly and keep selected values stable.
- [ ] Confirm leaving an unsaved create/edit page warns or preserves the draft instead of silently losing work.
- [ ] Confirm back navigation from people, sites, activities, quotes, and orders returns to the source company/opportunity where possible.
- [ ] Confirm quote line items appear immediately, then calculations catch up without blocking entry.
- [ ] Confirm expression totals recalculate after line item changes.
- [ ] Confirm quote generate document requirements stay correct when opening existing quotes with existing line items.
- [ ] Confirm disabled action buttons show exact unmet requirements, not only "requirements not met". Platform approval required.
- [ ] Confirm quote "Send quote" wording and confirmation modal are clear.
- [ ] Confirm quote PDF template sits on the supplied NLight letterhead and does not render white boxes over the background.
- [ ] Confirm quote scripts can be selected, edited, and included in generated quote documents.
- [ ] Confirm generated quote PDF includes catalogue and custom lines.
- [ ] Confirm product specs display where useful without exposing hidden supplier/cost data.
- [ ] Confirm quote to order runs in seconds, not around one minute.
- [ ] Confirm order contains quote line snapshots and customer/order chain links.
- [x] Confirm order created directly from CRM contains CRM opportunity line snapshots structurally. Browser UAT still required.
- [ ] Confirm sales invoice creation from order.
- [ ] Confirm Xero contact create/link flow.
- [ ] Confirm Xero sales invoice export to the correct Xero organisation and chart of accounts.
- [ ] Confirm Xero payment refresh updates invoice/payment status in Octodrop.
- [ ] Confirm backups/export/outage support notes are documented for Shelly/Luke.

Phase 1 UAT scenarios:

1. User access: log in as full access, operations, finance, and Sales NLight BV. Confirm each sees only the expected modules, records, and fields.
2. CRM: create a lead, convert to opportunity, create quote from opportunity, and verify customer/contact data carries cleanly.
3. Quote build: add catalogue LED fixture, accessory, disposal fee, delivery charge, and custom item.
4. Quote pricing: adjust sell price/margin on individual lines while buy/supplier fields remain hidden to Sales.
5. Quote document: generate quote PDF, verify filename, formatting, script text, line items, specs, attachments, and document registry.
6. Quote status: use Send quote/mark sent flow and confirm status/history updates.
7. Quote to order: convert accepted quote to order and verify line snapshots, totals, customer, sales entity, and source links.
8. Invoice: create invoice against order, export to Xero, then refresh Xero payment/status.
9. Performance: repeat common flows and confirm no record save reverts, lookup flicker, or excessive wait times.
10. Recovery: confirm data export/backups and support escalation route are clearly communicated.

Phase 1 blockers or decisions:

- [ ] Final user emails and roles from `Users and access.xlsx` must be confirmed before staged users are handed over.
- [ ] Decide whether Sales can see all contacts or only contacts within their assigned sales entity.
- [ ] Decide whether supplier contacts live in Contacts but hidden from Sales, or in a separate procurement-only supplier area.
- [ ] Confirm default sales entity per user/profile for new contacts, leads, opportunities, and quotes.
- [ ] Xero organisation mappings need final confirmation for NLight BV and EcoTech FZCO. Setup script now namespaces Xero automations/mappings per selling entity.
- [ ] Xero account codes/tax types need confirmation per organisation.
- [ ] Invoice template reference is still needed if the current invoice output must match an existing layout.
- [ ] Clean quote PDF reference is useful if current Simpro export formatting is not reliable.
- [ ] Proposal example is needed because proposals are separate from quotes.

## Shelly 30.04 Feedback Map

This section maps the 30.04 feedback document to concrete readiness checks.

Done or mostly done:

- English UK locale option exists as `en-GB`; missing locale files fall back safely.
- Lead to qualified opportunity flow exists.
- Lead disqualify/qualified visibility should be covered by board/view defaults, but still needs browser UAT.
- Create Quote from opportunity maps to `biz_quote.sector`; the old `biz-sector` mismatch should no longer be present.
- Opportunity can move back to lead.
- Proposal/negotiation movement now requires a quote or approved exception.
- Opportunity line items copy into quotes and orders.

Needs implementation or UAT hardening:

- Workspace default should be set to English UK and Europe/London in the UAT setup path. Done in setup script; still needs live UAT run.
- Contacts UI should make it clearer when the user is creating a company vs a person. Done for English UAT labels.
- `+ Contact` wording should be reviewed because Shelly reads this as person/contact, not company. Done for English UAT labels.
- Sales entity defaults should be applied consistently when creating records from profile context.
- Payment terms should use the full customer-facing wording required on quotes.
- Company, billing, site, and delivery addresses need a consistent cross-module model. First pass implemented; browser UAT required.
- Multiple sites per company are supported through CRM sites from the company record. Browser UAT required.
- Multiple delivery locations per job/order need a defined model before go-live if required.
- Creating/editing a person from a company needs source-record return navigation.
- Duplicate detection/merge is not implemented and should be treated as Phase 2 unless required for go-live.
- Activity owner should default from lead/opportunity owner when created in context.
- Activity company/lead/opportunity context should be prefilled when launched from a parent record.
- New lead/opportunity drafts should not disappear if the user leaves before save completes.
- Opportunity site search and site address pull-through need full address snapshots, not only address line 1. Done structurally.
- Commercial site address should pull from the selected site and remain editable as a snapshot. Done structurally.

## Module-by-Module UAT Repair Plan

Use this order so fixes move from foundation modules into downstream commercial flows.

### Contacts and Sites

Goal: Contacts become the reliable address book and site source for CRM, quoting, ordering, and delivery.

- [x] Rename or relabel company creation actions so users understand they are creating a company record.
- [x] Keep people as child records of companies, but add a clear "back to company" route after editing a person. Browser UAT still required.
- [x] Add or confirm related lists for company people, CRM sites, leads, opportunities, quotes, orders, invoices, and documents. Browser UAT still required.
- [ ] Decide if `crm_site` remains owned by CRM or becomes a generic contacts/site entity shared across modules.
- [x] Add full site address snapshot fields where only line 1 is currently copied.
- [x] Add explicit address roles: registered/company, billing, site, and delivery.
- [ ] Decide whether delivery locations are a reusable site record, an order child entity, or both.
- [ ] Add default sales entity where needed without exposing other entities to restricted Sales profiles.
- [ ] Confirm supplier contacts are hidden from Sales profiles.
- [ ] Defer duplicate merge unless Shelly/Luke make it a UAT blocker.

### CRM

Goal: Contacts flow into Lead, Opportunity, Quote, and Order without missing mandatory data or confusing stage changes.

- [ ] Browser-test Lead create, save, mark contacted, qualify, disqualify, and reopen/list visibility.
- [ ] Browser-test Opportunity create from Lead, direct Opportunity create, stage movement, back movement, lost, won, on hold, and resume.
- [ ] Confirm every blocked stage move gives the exact missing field list.
- [ ] Confirm exception request creates an approval task and only the nominated approver can approve/reject.
- [ ] Confirm approved exception unblocks only the intended gate and leaves an audit trail.
- [ ] Confirm rejected exception leaves the stage blocked.
- [ ] Confirm Opportunity line items stay in original order after add/edit/save/reload.
- [x] Confirm Create Quote from Opportunity copies CRM line items and requires at least one line structurally. Browser UAT still required.
- [x] Confirm Create Order from Opportunity copies CRM line items and requires at least one line structurally. Browser UAT still required.
- [x] Add "rotting deals" saved views/dashboard alerts for inactive opportunities. Elapsed-time live UAT still required.
- [ ] Confirm On Hold creates a follow-up task with the right owner/date/context.

### Quotes and Proposals

Goal: Quotes are fast and reliable for Phase 1; proposals stay explicitly separate.

- [ ] Confirm quote scripts can be selected, edited, saved, and rendered.
- [ ] Confirm line items add immediately and are replaced by persisted rows without flicker, duplicate rows, or reorder.
- [ ] Confirm document generation waits for pending line-item writes before allowing a quote PDF to generate.
- [ ] Confirm quote PDF includes the right script, line items, totals, terms, disposal fee, and delivery terms.
- [ ] Confirm quote can exist without a proposal.
- [ ] Confirm proposal should be a separate entity/document, not just a quote field.
- [ ] Collect proposal example before building Claude-assisted proposal generation.
- [ ] Decide if "Create Proposal" should require an existing quote or create one automatically.

### Orders

Goal: Accepted quotes and won CRM opportunities produce usable orders with line snapshots and delivery context.

- [ ] Confirm Quote to Order copies quote lines, customer, contact person, sales entity, payment terms, delivery terms, site, and source links.
- [ ] Confirm CRM Opportunity to Order copies opportunity lines, customer, contact person, sales entity, payment terms, delivery target, and source links.
- [ ] Confirm order line edits do not reorder existing rows.
- [ ] Decide if orders need one delivery address, multiple delivery locations, or delivery location child rows.
- [ ] Confirm order status flow makes sense for operations and finance.
- [x] Confirm order documents, tasks, calendar events, quotes, invoices, and purchase orders are visible from the order structurally. Browser UAT still required.

### Purchase Orders

Goal: POs support operations/finance without exposing supplier details to Sales.

- [ ] Confirm PO creation path: from order, from product requirement, or manual.
- [ ] Confirm PO lines copy required order/product details and supplier-side data for procurement users.
- [ ] Confirm Sales cannot view supplier cost, supplier identity, or purchase documents.
- [ ] Confirm PO PDF template against Tamzin/Shelly examples, avoiding the grey Simpro box.
- [ ] Confirm only documents attached to the PO sync to Xero.
- [ ] Confirm PO sync target organisation and account/tax mappings before enabling live Xero writes.

### Finance and Xero

Goal: Phase 1 finance works for contacts and sales invoices; Phase 2 adds POs.

- [ ] Confirm there are two distinct Xero organisation mappings: NLight BV and EcoTech FZCO.
- [ ] Confirm sales entity decides the Xero organisation unless Finance needs manual override.
- [ ] Confirm customer contact sync to the correct Xero organisation.
- [ ] Confirm invoice export, payment refresh, and status sync in UAT only before live writes.
- [ ] Confirm purchase order sync is disabled until PO Phase 2 mapping is approved.
- [ ] Confirm finance access can see invoice/PO/accounting fields and Sales cannot.

### Products

Goal: Sales can quote from the catalogue without seeing protected procurement data.

- [ ] Confirm catalogue seed from Shelly's workbook matches expected product count.
- [ ] Confirm supplier field, supplier source row, buy price, EcoTech purchase cost, and intercompany cost are hidden from Sales.
- [ ] Confirm NLight and EcoTech product prices/costs are selected by sales entity.
- [ ] Confirm disposal fee is available for Netherlands quotes and has no markup.
- [ ] Confirm delivery can be entered as a manual quote/order cost where required.
- [ ] Confirm one-off/custom products still produce clean quote/order lines.

### Documents

Goal: Generated documents are fast, correctly attached, and traceable.

- [ ] Confirm quote document preview and generation are fast after the recent renderer improvements.
- [ ] Confirm generated PDFs are attached to the correct source record and related customer/order chain.
- [ ] Confirm document registry metadata and numbering are correct.
- [ ] Confirm document generation does not navigate users away unexpectedly.
- [ ] Confirm PO attached documents can be selected for Xero sync in Phase 2.

### Tasks and Calendar

Goal: CRM activity and operational tasks support daily work without confusing overdue dates.

- [ ] Confirm workspace timezone is Europe/London and user timezone overrides work.
- [ ] Confirm activity due dates use the user/workspace timezone for overdue calculation.
- [ ] Confirm activity owner defaults from lead/opportunity owner.
- [ ] Confirm On Hold auto follow-up task appears on task/calendar views.
- [ ] Confirm Outlook calendar sync remains a deferred integration unless pulled into Phase 1.
- [ ] Confirm email logging is deferred after calendar sync unless Shelly changes priority.

### Access Profiles

Goal: Profiles match Shelly's access sheet and protect entity/cost data.

- [ ] Log in as full access/director.
- [ ] Log in as operations.
- [ ] Log in as finance.
- [ ] Log in as procurement.
- [ ] Log in as NLight BV sales.
- [ ] Log in as EcoTech/CIS sales.
- [ ] Confirm NLight BV sales cannot see EcoTech/CIS deals.
- [ ] Confirm EcoTech/CIS sales cannot see NLight BV deals.
- [ ] Confirm Sales can request mandatory-field exceptions but cannot approve them.
- [ ] Confirm only nominated approver can approve or reject a gate exception.
- [ ] Confirm Sales cannot see suppliers, buy prices, cost of sale, margin, PO internals, or supplier documents.

### Integrations

Goal: Keep Phase 1 integrations narrow and safe, then layer in advanced workflows.

- [ ] Xero Phase 1: contacts and sales invoices only.
- [ ] Xero Phase 2: purchase orders and PO attachments once mapping is approved.
- [ ] Outlook Phase 2/3: calendar first, then email logging and multiple inbox support.
- [ ] Claude Phase 3: proposals only after proposal model, examples, and data-sharing rules are approved.
- [ ] ClickUp Phase 3: define trigger, target workspace/list/folder, task fields, and sync direction.
- [ ] Simpro/Pipedrive migration: import only after field mappings and duplicate strategy are clear.

## Phase 2 - Purchasing, Xero Purchase Orders, and Data Migration

Goal: complete operations/finance depth after the core sales workflow is stable.

Target: following week after Phase 1 UAT/go-live, subject to feedback and data availability.

Included scope:

- Purchase order document flow.
- Purchase order sync into Xero.
- Purchase order status refresh if supported by the chosen Xero flow.
- Actual supplier-side purchasing against EcoTech FZCO.
- Job/order profitability refinement.
- Simpro data import for products, active quotes, open orders.
- Pipedrive data migration/import where needed.

Phase 2 todos:

- [ ] Confirm whether each purchase order should be pushed to EcoTech Xero, NLight BV Xero, or selected by sales entity.
- [ ] Confirm Xero PO account mapping and tax rules.
- [ ] Add/update Xero PO integration setup script if not already complete.
- [ ] Build and test PO export from Octodrop to Xero.
- [ ] Confirm whether Xero PO receipt/status should sync back to Octodrop.
- [ ] Generate purchase order PDF template using NLight/EcoTech branding rules.
- [x] Confirm PO-to-order/customer chain is visible for internal users structurally. Browser UAT still required.
- [ ] Confirm Sales cannot see supplier-side PO details.
- [ ] Confirm job/order profitability compares customer sales, EcoTech supplier cost, NLight intercompany cost, delivery cost, disposal fee, and final margin.
- [ ] Import Simpro product catalogue after cleanup/standardisation.
- [ ] Import active Simpro quotes.
- [ ] Import open Simpro orders.
- [ ] Reconcile imported customer/product codes against Pipedrive data.
- [ ] Run post-import validation counts against source exports.
- [ ] Archive or clean old test records before production cutover.

Phase 2 required inputs:

- [ ] Simpro product CSV export.
- [ ] Simpro active quotes export.
- [ ] Simpro open orders export.
- [ ] Any Simpro customer/contact export if Pipedrive export is incomplete.
- [ ] Xero PO chart of accounts/tax mapping per organisation.
- [ ] PO template/layout preference.
- [ ] Confirmation of how deposit/progress/final invoices should be represented in Xero.

## Phase 3 - Proposals, Claude, ClickUp, and Advanced Automation

Goal: add the workflows that are valuable but should not block first go-live.

Included scope:

- Proposal records/documents separate from quotes.
- Claude-assisted proposal generation.
- Option to generate proposal text from quote/customer/product/project details.
- Option to import Claude-generated proposal content into Octodrop.
- ClickUp logistics/project task integration.
- Pipedrive replacement refinements if the team fully moves CRM into Octodrop.
- Dashboards/reports for operational visibility.

Phase 3 todos:

- [ ] Define proposal entity/model separately from quote.
- [ ] Confirm whether proposal always includes a quote attachment/section or can exist independently.
- [ ] Confirm whether quote updates should automatically refresh linked proposal content.
- [ ] Collect proposal example PDF/DOCX from NLight.
- [ ] Build proposal document template.
- [ ] Add proposal generation action using Claude/API provider.
- [ ] Add proposal review/edit step before sending to customer.
- [ ] Add "create quote from proposal" or "create proposal from quote" flow if required.
- [ ] Define Claude prompt guardrails and which fields can be sent externally.
- [ ] Confirm whether Claude should generate full proposal from scratch, improve an existing script, or both.
- [ ] Define ClickUp trigger: likely deposit paid or order accepted.
- [ ] Confirm ClickUp workspace/list/folder structure.
- [ ] Confirm ClickUp task fields: customer, order value, products, delivery details, documents, shipping milestones.
- [ ] Build ClickUp task/project creation integration.
- [ ] Sync key ClickUp statuses back into Octodrop if required.
- [ ] Build management dashboards for pipeline, quotes, orders, POs, invoices, and margin.

Phase 3 required inputs:

- [ ] Proposal examples.
- [ ] Claude API/provider credentials or preferred integration approach.
- [ ] Approved data-sharing rules for Claude.
- [ ] ClickUp access.
- [ ] ClickUp target workspace/list/folder mappings.
- [ ] Desired logistics/shipping workflow stages.

## Pipedrive Migration and Replacement Notes

Current direction from Shelly: use Octodrop for CRM and replicate/mirror Pipedrive setup.

Pipedrive accounts mentioned:

- NLight: Dutch sales team, entity NLight BV, Joost and Joram.
- NLightCIS: CIS sales team, entity EcoTech, Alexey and Andrey.

Todos:

- [ ] Mirror deal stages from both Pipedrive accounts into Octodrop CRM workflows.
- [ ] Mirror mandatory fields where they are operationally important.
- [ ] Mirror useful report settings as dashboards or saved views.
- [ ] Export customer data into Octodrop contacts.
- [ ] Export open deals into Octodrop leads/opportunities.
- [ ] Map Pipedrive product codes to Octodrop product codes.
- [ ] Confirm no cross-entity deal visibility between Dutch/NLight BV and CIS/EcoTech sales teams.
- [ ] Decide whether Pipedrive remains connected after go-live or becomes read-only during transition.
- [ ] If Pipedrive stays active temporarily, define one-way or two-way sync rules to avoid duplicate records.

## User and Access Matrix

Initial users from Luke:

- Luke Handley: Director, full access.
- Matthew Beeby: Director, full access.
- Walter Hung: Procurement, full access or procurement/operations.
- Shelly Hemsley: Operations, full access or operations.
- Tamzin Curcic: Finance, finance access.
- Joost Van Rooij: Sales, NLight BV only.
- Joram Wijnaendts van Resandt: Sales, NLight BV only.

Access principles:

- Sales can create/edit customers, leads, opportunities, quotes, and quote lines inside their sales entity.
- Sales can use the product catalogue but cannot see supplier identity, supplier rows, buy price, EcoTech purchase cost, intercompany cost, procurement supplier, or margin fields.
- Sales users for NLight BV cannot see EcoTech/CIS deals.
- EcoTech/CIS sales users cannot see NLight BV deals.
- Operations/procurement/finance can see purchasing and supplier-side data according to profile.
- Superadmin-only staged user creation may be used for temporary access testing before handoff.

## Product Catalogue Rules

Catalogue rules from Shelly:

- Supplier is column B and must be hidden from Sales.
- EcoTech purchases from supplier at column M, USD.
- NLight BV purchases from EcoTech at column N, USD.
- Quote cost of sale uses column O, EUR, currently based on 0.85 FX rate.
- Disposal fee applies only to Netherlands customers, is mandatory, and has no markup.
- Delivery charge varies per quote and must be manually entered/requested from head office.

Todos:

- [ ] Confirm seeded catalogue count matches workbook.
- [ ] Confirm product type/spec fields are enough for line item display and quote output.
- [ ] Confirm Sales sees the right catalogue labels/specs but not supplier/cost data.
- [ ] Confirm disposal fee behaviour for Netherlands customers.
- [ ] Confirm delivery charge requires manual cost entry and is visible/usable in quotes.
- [ ] Confirm whether customer sell prices are entered manually, margin-derived, or should be seeded later.
- [ ] Confirm if any product variants need grouping or parent/child product structure.

## Xero Scope

Phase 1:

- Contacts.
- Customer invoices.
- Payment/status refresh.

Phase 2:

- Purchase orders.
- Any deeper purchase/accounting flows.

Todos:

- [ ] Confirm both Xero connections are active.
- [ ] Confirm NLight BV sales invoice mapping.
- [ ] Confirm EcoTech FZCO sales/purchase mapping.
- [ ] Confirm tax code per invoice/PO scenario.
- [ ] Confirm account code per sales entity and document type.
- [ ] Confirm whether invoices should be exported as draft or authorised.
- [ ] Confirm deposit/progress/final invoice statuses and Xero behaviour.
- [ ] Confirm credit note requirement and whether it is Phase 2 or later.

## Documentation and Handover

Before Phase 1 go-live:

- [ ] Short user guide for Sales: CRM -> Quote -> Generate PDF -> Send quote -> Accepted.
- [ ] Short user guide for Operations: Quote -> Order -> order tracking.
- [ ] Short user guide for Finance: Invoice -> Xero sync -> payment refresh.
- [ ] Admin guide for user creation/access profiles.
- [ ] Backup/export/outage support note for Shelly and Luke.
- [ ] Known limitations list for anything intentionally deferred to Phase 2/3.

## Go-Live Readiness Checklist

Do not call Phase 1 ready until all of these are true:

- [ ] Users can log in and are assigned correct access profiles.
- [ ] Sales entity separation is verified with real staged users.
- [ ] Supplier and cost data is hidden from Sales profiles.
- [ ] CRM, quote, order, invoice flow works end to end.
- [ ] Quote PDF generation works and output is acceptable.
- [ ] Xero sales invoice export works in the target organisation.
- [ ] Record autosave is stable and does not revert user changes.
- [ ] Line item lookup and calculation performance is acceptable.
- [ ] Existing quote line items are recognised when reopening a quote.
- [ ] Required action button reasons are clear.
- [ ] Backup/export/support process is documented.
- [ ] Phase 2/3 deferred items are explicitly accepted by Luke/Shelly.

## Known Deferred Items

These should not block Phase 1 unless Luke/Shelly explicitly move them forward:

- Simpro import of active quotes and open orders.
- Purchase order sync to Xero.
- ClickUp logistics workflow.
- Claude proposal automation.
- Separate proposal document model.
- Full Pipedrive historical migration if current CRM UAT is enough first.
- Advanced dashboards/reports.
