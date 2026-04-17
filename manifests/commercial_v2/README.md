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

Scripts:
- `python3 manifests/commercial_v2/install_all.py`
- `python3 manifests/commercial_v2/cleanup_removed_modules.py`
- `python3 manifests/commercial_v2/setup_document_numbering.py`
- `python3 manifests/commercial_v2/setup_xero_phase1.py --connection-name "<your xero connection>" --sales-entity "<your sales entity>"`
- `python3 manifests/commercial_v2/seed_dummy_examples.py`
- `python3 manifests/commercial_v2/setup_access_profiles.py --skip-assignments`

Recommended setup order:
- `python3 manifests/commercial_v2/install_all.py`
- `python3 manifests/commercial_v2/setup_document_numbering.py`
- `python3 manifests/commercial_v2/setup_xero_phase1.py --connection-name "<your xero connection>" --sales-entity "<your sales entity>"`
- `python3 manifests/commercial_v2/seed_dummy_examples.py`
- `python3 manifests/commercial_v2/setup_access_profiles.py`

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





