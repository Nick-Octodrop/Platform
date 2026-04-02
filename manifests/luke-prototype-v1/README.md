# Luke Prototype v1

Prototype workspace target for a tailored Octodrop demo for Luke / N-Light.

- Display label: `Luke Prototype v1`
- Title: `N-Light Workflow Prototype`
- Subtitle: `Quote to Order to PO to Invoice demo`

## Modules

This prototype is split into six installable manifests:

1. `01_contacts.json`
2. `02_products.json`
3. `03_purchase_orders.json`
4. `04_invoices.json`
5. `05_customer_orders.json`
6. `06_quotes.json`

`06_quotes.json` owns the prototype dashboard/home page and the left-nav order.

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

## Prototype Scope

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
- N-Light themed demo data

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
