# Commercial Workflow Prototype

Prototype workspace target for a lightweight quote-to-order-to-purchasing-to-invoice demo.

- Display label: `Commercial Workflow Prototype`
- Title: `Commercial Workflow`
- Subtitle: `Quote to Order to PO to Invoice demo`

## Modules

This prototype is split into six installable manifests:

1. `01_contacts.json`
2. `02_products.json`
3. `03_purchase_orders.json`
4. `04_invoices.json`
5. `05_customer_orders.json`
6. `06_quotes.json`

`06_quotes.json` owns the dashboard/home page and the left-nav order.

## Install

Sync this folder in order:

```bash
python3 scripts/bulk_sync_manifests.py \
  --dir manifests/luke-prototype-v1 \
  --base-url http://localhost:8000 \
  --token "$TOKEN" \
  --workspace-id "$WORKSPACE_ID"
```

If you prefer explicit one-by-one sync, keep the same order as the filenames above.

## Seed Demo Data

After the manifests are installed, seed the demo records:

```bash
python3 manifests/luke-prototype-v1/seed_demo_data.py \
  --base-url http://localhost:8000 \
  --token "$TOKEN" \
  --workspace-id "$WORKSPACE_ID"
```

You can also use environment variables instead:

- `OCTO_BASE_URL`
- `OCTO_API_TOKEN`
- `OCTO_WORKSPACE_ID`

And preview the import plan without writing records:

```bash
python3 manifests/luke-prototype-v1/seed_demo_data.py --dry-run
```

## Document Numbering

These manifests now treat the main document number fields as system-managed:

- `nl_quote.quote_number`
- `nl_customer_order.order_number`
- `nl_purchase_order.po_number`
- `nl_invoice.invoice_number`

To have new records auto-number through the shared platform engine, create numbering definitions in `Settings -> Document Numbering` after install. A sensible setup is:

- Quotes: assign on `create`
- Customer Orders: assign on `confirm`
- Purchase Orders: assign on `create`
- Invoices: assign on `issue`

You can populate those definitions automatically with:

```bash
python3 manifests/luke-prototype-v1/setup_document_numbering.py \
  --base-url http://localhost:8000 \
  --token "$TOKEN" \
  --workspace-id "$WORKSPACE_ID"
```

Or preview what it will create/update:

```bash
python3 manifests/luke-prototype-v1/setup_document_numbering.py --dry-run
```

The seed script still writes explicit demo numbers for the seeded records so the prototype remains presentation-ready even before numbering rules are configured.

## Scope

Included:

- Contacts
- Products
- Quotes
- Customer Orders
- Purchase Orders
- Invoices
- Dashboard/home page
- Quote to order transform
- Order to PO transform
- Deposit / final invoice creation from order
- realistic commercial demo data

Intentionally not included:

- Pipedrive/Xero/ClickUp integrations
- inventory / shipping / manufacturing / BOM logic
- heavy analytics
- production-grade approvals

## Known Constraint

The current runtime only exposes broad workspace roles (`admin`, `member`, `readonly`) and client-side manifest `visible_when` rules do not receive actor context consistently.

That means this prototype can model sales-safe layouts and keep purchasing/profitability details visually separated, but it does not yet provide hard custom-role concealment for `Sales User` vs `Operations / Purchasing User` purely through manifests.

For this prototype:

- the sales flow is kept clean and quote-first
- purchasing and profitability details are separated into dedicated sections/modules
- true hard hiding of buy-side data remains a platform-level follow-up
