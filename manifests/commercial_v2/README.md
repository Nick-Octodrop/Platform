# Commercial V2

Commercial quoting, orders, purchasing, invoicing, and document-control pack for the NLight demo workspace.

Contents:
- `contacts.json`
- `products.json`
- `quotes.json`
- `orders.json`
- `purchase_orders.json`
- `invoices.json`
- `documents.json`

Scripts:
- `python3 manifests/commercial_v2/install_all.py`
- `python3 manifests/commercial_v2/cleanup_removed_modules.py`
- `python3 manifests/commercial_v2/setup_document_numbering.py`
- `python3 manifests/commercial_v2/seed_dummy_examples.py`
- `python3 manifests/commercial_v2/setup_access_profiles.py --skip-assignments`

Environment:
- `OCTO_BASE_URL`
- `OCTO_API_TOKEN`
- `OCTO_WORKSPACE_ID`
