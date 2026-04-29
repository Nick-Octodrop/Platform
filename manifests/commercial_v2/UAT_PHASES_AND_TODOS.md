# NLight UAT Phases and Todo Plan

Last updated: 2026-04-29

This plan is based on the current NLight/Shelly/Luke chat history and the current Commercial V2 build. It separates what must be ready for first UAT/go-live from follow-up work that should not block initial sales and quoting usage.

## Target Outcome

NLight can test and then go live on the core Octodrop workflow for CRM, quoting, orders, invoicing, catalog products, document generation, and role-based access.

Target first go-live window from chat: Monday 4 May 2026.

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
- [ ] Confirm quote line items appear immediately, then calculations catch up without blocking entry.
- [ ] Confirm expression totals recalculate after line item changes.
- [ ] Confirm quote generate document requirements stay correct when opening existing quotes with existing line items.
- [ ] Confirm disabled action buttons show exact unmet requirements, not only "requirements not met".
- [ ] Confirm quote "Send quote" wording and confirmation modal are clear.
- [ ] Confirm quote PDF template sits on the supplied NLight letterhead and does not render white boxes over the background.
- [ ] Confirm quote scripts can be selected, edited, and included in generated quote documents.
- [ ] Confirm generated quote PDF includes catalogue and custom lines.
- [ ] Confirm product specs display where useful without exposing hidden supplier/cost data.
- [ ] Confirm quote to order runs in seconds, not around one minute.
- [ ] Confirm order contains quote line snapshots and customer/order chain links.
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
- [ ] Xero organisation mappings need final confirmation for NLight BV and EcoTech FZCO.
- [ ] Xero account codes/tax types need confirmation per organisation.
- [ ] Invoice template reference is still needed if the current invoice output must match an existing layout.
- [ ] Clean quote PDF reference is useful if current Simpro export formatting is not reliable.
- [ ] Proposal example is needed because proposals are separate from quotes.

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
- [ ] Confirm PO-to-order/customer chain is visible for internal users.
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

