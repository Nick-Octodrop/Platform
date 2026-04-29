# Commercial V2

Commercial quoting, orders, purchasing, invoicing, CRM, tasks, calendar, and document-control pack for the demo workspace.

Contents:
- `contacts.json`
- `products.json`
- `quotes.json`
- `orders.json`
- `purchase_orders.json`
- `invoices.json`
- `documents.json`
- `crm.json`
- `tasks.json`
- `calendar.json`

Planning:
- `UAT_PHASES_AND_TODOS.md`

Scripts:
- `python3 manifests/commercial_v2/install_all.py`
- `python3 manifests/commercial_v2/cleanup_removed_modules.py`
- `python3 manifests/commercial_v2/setup_uat_workspace.py`
- `python3 manifests/commercial_v2/clear_workspace_data.py --dry-run`
- `python3 manifests/commercial_v2/setup_document_numbering.py`
- `python3 manifests/commercial_v2/setup_xero_phase1.py --connection-name "<your xero connection>" --sales-entity "<your sales entity>"`
- `python3 manifests/commercial_v2/seed_catalog_items.py`
- `python3 manifests/commercial_v2/seed_dummy_examples.py`
- `python3 manifests/commercial_v2/setup_access_profiles.py --skip-assignments`

Recommended setup order:
- `python3 manifests/commercial_v2/setup_uat_workspace.py --dry-run`
- `python3 manifests/commercial_v2/setup_uat_workspace.py --clear-records --publish-automations`

Manual setup order:
- `python3 manifests/commercial_v2/install_all.py`
- `python3 manifests/commercial_v2/setup_document_registry_metadata.py`
- `python3 manifests/commercial_v2/setup_document_numbering.py`
- `python3 manifests/commercial_v2/setup_quote_document_templates.py`
- `python3 manifests/commercial_v2/setup_quote_scripts.py`
- `python3 manifests/commercial_v2/seed_catalog_items.py`
- `python3 manifests/commercial_v2/setup_access_profiles.py`
- `python3 manifests/commercial_v2/setup_commercial_automations.py --quote-document-template-id "<template id>" --publish`
- `python3 manifests/commercial_v2/setup_xero_phase1.py --connection-name "<your xero connection>" --sales-entity "<your sales entity>"`
- `python3 manifests/commercial_v2/seed_dummy_examples.py`

Catalogue seed notes:
- `seed_catalog_items.py` creates/updates supplier contacts, product catalogue rows, and product supplier source rows from the NLight catalogue workbook.
- Supplier contacts, supplier source rows, purchase costs, intercompany costs, quote costs, and margins are hidden from Sales through the commercial access profiles.
- LED fixture/specification fields are copied from products onto quote/order line snapshots so generated quote documents remain stable if the catalogue changes later.
- Delivery charge is seeded with `Quote Cost Mode = Manual Per Quote`; head office must enter the cost-of-sale on each quote.
- Disposal fee is seeded as a pass-through service item with matching sales price and quote cost.

Xero phase 1 notes:
- Pass an explicit `--sales-account-code` and `--default-tax-type` for the target Xero tenant instead of relying on generic defaults.
- The tax type must be a live code in that tenant. If Xero shows an archived tax rate on exported drafts, rerun `setup_xero_phase1.py` with the correct `--default-tax-type` and republish.
- Invoice headers in `invoices.json` now prefer summed `biz_invoice_line.line_total` values whenever invoice lines exist, so Octodrop totals stay aligned with exported Xero line totals.

Seed coverage:
- core NLight and EcoTech commercial story records
- accepted-not-converted quote state
- paid deposit invoice state
- in-production and shipped purchasing/order scenarios
- CRM, tasks, calendar, and document examples
- generated demo packs for Loom/demo density

Environment:
- `OCTO_BASE_URL`
- `OCTO_API_TOKEN`
- `OCTO_WORKSPACE_ID`





