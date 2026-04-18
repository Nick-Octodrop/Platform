# True Essentials Manifest Suite

## Modules created

### `te_catalog.json`
- Product master records for the Shopify-facing catalog
- Product forms designed as operational work surfaces with clean pricing, Shopify, notes, and activity structure
- Products now support retail sell pricing in NZD alongside separate buy-side pricing, FX conversion into NZD, landed-cost overrides, gross margin visibility, manual stock controls, stock-on-order visibility, Shopify-sales reservations, Shopify compare-at pricing, storefront description fields, and a dedicated Shopify image attachment field
- Catalog navigation now includes dedicated pricing-review and stock-watch pages, plus graph and pivot analysis on the main products page
- Supplier-linked product pricing now lives in `te_sourcing` to keep module installs clean and avoid circular dependencies
- Catalog records are intended to be the source of truth for product title, handle, storefront description, storefront image selection, sell price, compare-at price, and stock-tracking intent before data is pushed into Shopify

### `te_suppliers.json`
- Supplier master records with structured address, communication, lead time, and status
- Supplier contacts in a dedicated related tab

### `te_sourcing.json`
- Supplier-linked product offers with structured supplier SKU, URL, lead time, currency, and cost
- Supplier offers now support FX-to-NZD conversion so USD supplier quotes can be compared more cleanly against NZD retail pricing
- Dedicated sourcing boundary between products and suppliers
- Created as a small support module to avoid circular dependencies between `te_catalog` and `te_suppliers`

### `te_purchasing.json`
- Supplier orders with a real statusbar workflow: `draft -> ordered -> partially received -> received / cancelled`
- Supplier-aware order lines filtered to compatible supplier-linked products, with a direct product reference carried onto each line for stock reporting
- Supplier orders now support website, portal, email, phone, and formal-PO ordering methods plus external references, order URLs, and tracking details
- Line items in their own tab, notes/documents in their own tab, activity enabled, cancellation modal included
- Currency-aware totals and landed-cost estimate

### `te_finance.json`
- Internal owner/company finance entries for expenses, contributions, reimbursements, and adjustments
- NZD-friendly reporting fields and balances
- Home dashboard focused on company funds available, owner balances owed, unreimbursed spend, and contributions
- Receipt/proof attachments and activity enabled
- Finance entries can now link back to source sales orders so Shopify-originated income can be posted into finance without duplicating ledger rows

### `te_sales.json`
- Customer-facing sales orders with a clean split between order header state and sales order lines
- Built to receive Shopify-originated orders into a real operational entity instead of overloading catalog or sync tables
- Tracks customer/shipping snapshots, line totals, paid/balance-due visibility, and gross margin against catalog cost snapshots
- Links order lines back to `te_product` so imported Shopify orders can still roll into product-level operational reporting later
- Links orders to `te_customer` when imported Shopify customers already exist locally

### `te_customers.json`
- Customer master records for True Essentials with Shopify linkage, marketing-consent flags, address data, and reusable CRM fields
- Gives sales orders, email automations, and retention workflows a first-class customer entity instead of relying on free-text order snapshots

## Assumptions made

- The suite is intended to be installed together for the same workspace.
- `te_sourcing` was added intentionally because supplier-product pricing is the shared join between catalog and suppliers. Without that boundary, the suite created circular dependencies and broken standalone installs.
- Purchase order numbering is treated as settings-aware. The manifest exposes the business-facing field and guidance, but does not hardcode numbering logic.
- Finance is intentionally not full accounting. It is an operational owner/company funds tracker with explicit balance-impact fields rather than a general ledger.
- I used only current manifest/runtime patterns already present in this repo:
  - statusbars
  - workflow actions
  - modals
  - related lists
  - activity/chatter
  - stat cards on module home pages
  - typed lookups and domains
- I did not invent unsupported action kinds for email/document sending. The suite leaves room for those later where the platform/runtime contract is clearer.
- TE form design rule: when a record uses a statusbar, keep that statusbar in the form header and above tabs. Do not repeat the same workflow status field again inside the tab body unless there is a specific operational reason.

## Recommended next modules later

- `te_inventory`
  - Receiving, stock on hand automation, adjustments, and simple inventory movement history
- `te_documents`
  - More formal document templates and generation flows if purchase/supplier paperwork needs to become structured
- `te_sync`
  - Shopify/supplier import-sync support when operational data starts to move in and out automatically

## Shopify phase 1 setup

1. Install or reinstall the suite:
   - `python manifests/true_essentials/install_all.py`
   - Or on Windows PowerShell: `powershell -ExecutionPolicy Bypass -File manifests/true_essentials/install_update_all.ps1`
2. Create and authorize a Shopify integration connection in Octodrop.
   - Recommended scopes:
     - `read_products,write_products,read_inventory,write_inventory,read_orders,read_all_orders,read_customers,read_locations`
3. Bind the manual product-push automation to that connection:
   - `python manifests/true_essentials/setup_shopify_phase1.py --connection-name "True Essentials Shopify" --publish`

The phase-1 Shopify setup currently creates two manual actions on `te_product` records:
- `Push To Shopify`
- `Push Stock To Shopify`

The product push sends the catalog master into Shopify using GraphQL `productSet`, writes back Shopify product, variant, inventory-item, status, and URL fields onto the same Octodrop product record, and then syncs any linked `te_product.shopify_image_attachments` into Shopify product media.

The stock push sends `stock_available` into one configured Shopify location using GraphQL `inventorySetQuantities`. It does not use `stock_on_order`, so inbound purchasing visibility can be improved without changing the Shopify stock contract. `stock_available` now subtracts both manual reserved stock and Shopify-driven sales reservations from linked sales-order lines. It expects the product to have already been pushed once so that the Shopify inventory item ID is known.

## Shopify import-first workflow

Before pushing Octodrop products into a live Shopify store, seed the catalog from Shopify so product and inventory-item IDs are linked safely.

1. Connect Shopify and verify the connection test passes.
2. Run a dry-run import first:
   - `python manifests/true_essentials/import_shopify_products.py --connection-name "TE Shopify" --dry-run`
3. Run the real import:
   - `python manifests/true_essentials/import_shopify_products.py --connection-name "TE Shopify"`

The importer:
- pages products and variants from Shopify over the existing Octodrop Shopify connection
- links records by `shopify_variant_id` first, then by unique SKU
- creates missing `te_product` records for Shopify variants that have a SKU
- writes back Shopify product, variant, inventory item, handle, URL, and description fields
- patches only the intended Shopify-link fields plus explicitly allowed sparse local fields, so local buy price, reorder settings, and other ERP-side fields are not replaced
- fills sparse local fields conservatively instead of overwriting populated title/price data unless `--overwrite-local` is passed

Optional image import:
- add `--import-images` to also download Shopify product images and attach them into `te_product.shopify_image_attachments`
- reruns skip already linked filenames on the same record so repeated imports do not keep attaching duplicate images

## Shopify customer import

Import Shopify customers into the dedicated TE customer master before importing orders if you want orders to link back to reusable CRM records.

1. Dry run:
   - `python manifests/true_essentials/import_shopify_customers.py --connection-name "TE Shopify" --dry-run`
2. Real run:
   - `python manifests/true_essentials/import_shopify_customers.py --connection-name "TE Shopify"`

The customer importer:
- upserts `te_customer` by Shopify customer ID first, then by unique email
- writes Shopify IDs, marketing-consent state, address fields, tags, order count, and lifetime spend
- preserves populated local name/email/phone fields unless `--overwrite-local` is passed
- falls back to deriving customer records from Shopify orders when the store has guest checkouts but no formal Shopify customer objects

Important Shopify scope note:
- `read_customers` is needed to import formal Shopify customer objects from `/customers.json`
- `read_all_orders` is needed to access Shopify orders older than 60 days; without it, customer/order import will only see the recent accessible order window

Safety rule:
- unlinked `Push To Shopify` calls now create a new Shopify product instead of handle-upserting an existing one, so import-first linking is the safer default path for a live store.

## Shopify order import

After products are linked, import Shopify orders into `te_sales`:

1. Dry run:
   - `python manifests/true_essentials/import_shopify_orders.py --connection-name "TE Shopify" --dry-run`
2. Real run:
   - `python manifests/true_essentials/import_shopify_orders.py --connection-name "TE Shopify"`

The order importer:
- upserts `te_sales_order` by Shopify order ID
- upserts `te_sales_order_line` by Shopify line-item ID
- links line items back to `te_product` by Shopify variant ID first, then by unique SKU
- links orders back to `te_customer` by Shopify customer ID first, then by unique email when customer records already exist
- snapshots quantity, sell price, discounts, taxes, and current NZD cost onto each sales-order line
- writes `fulfillable_quantity` onto each sales-order line so catalog `stock_available` can reflect open Shopify demand through `te_product.stock_reserved_sales`
- patches imported order fields instead of replacing the whole record, so local ERP notes and other non-Shopify fields are preserved

## Sales to finance income sync

After orders are in `te_sales`, post eligible paid sales orders into `te_finance` as posted `company_income` entries.

1. Install or reinstall the suite so the finance source-link fields exist:
   - `python manifests/true_essentials/install_all.py`
2. Register the automation:
   - `python manifests/true_essentials/setup_sales_finance_sync.py --publish`
3. Dry-run a backfill:
   - `python manifests/true_essentials/sync_sales_to_finance.py --dry-run`
4. Run the backfill for real:
   - `python manifests/true_essentials/sync_sales_to_finance.py`

Current posting model:
- one finance row per linked sales order
- source of truth is `te_sales_order`, not raw Shopify payloads
- only fully paid orders are posted as `company_income` today
- if a previously linked order stops being fully paid, the sync can void the linked finance row with `--void-ineligible`

Current limitation:
- refunds and partial refunds are not yet posted as separate finance adjustments; they are intentionally left for a later finance-sync slice instead of guessing at payout logic

## Shopify phase 2

After the import-first setup is stable, register inbound Shopify webhooks and keep a single reconciliation command available for catch-up runs.

1. Register Shopify inbound webhooks in Octodrop and Shopify:
   - `python manifests/true_essentials/setup_shopify_phase2.py --connection-name "TE Shopify"`
2. Run a full dry-run reconciliation:
   - `python manifests/true_essentials/reconcile_shopify.py --connection-name "TE Shopify" --dry-run --import-images`
3. Run the full reconciliation for real:
   - `python manifests/true_essentials/reconcile_shopify.py --connection-name "TE Shopify" --import-images`

Phase 2 currently registers inbound webhook topics for:
- `orders/create`
- `orders/updated`
- `orders/cancelled`
- `refunds/create`
- `customers/create`
- `customers/update`
- `products/create`
- `products/update`

If Shopify rejects a topic during setup, the script now prints the topic-by-topic failures and the likely required access scope instead of stopping at the first error. Reauthorize the Shopify connection after changing scopes so the new token actually includes them.

Operational model:
- webhooks give the workspace a near-real-time inbound event stream and signed ingest endpoints
- the reconciliation runner remains the safe catch-up path for backfills, missed deliveries, and periodic re-syncs
- manual Octodrop-side stock pushes still remain available where Octodrop is the operational stock owner

## Shopify phase 2 consumers

Once webhook subscriptions are registered, install the inbound consumer automations so webhook deliveries actually upsert TE records.

1. Deploy or restart the Octodrop backend first so the new worker actions exist:
   - `system.shopify_upsert_order_webhook`
   - `system.shopify_refresh_order_from_refund_webhook`
   - `system.shopify_upsert_customer_webhook`
   - `system.shopify_upsert_product_webhook`
2. Register the inbound consumer automations:
   - `python manifests/true_essentials/setup_shopify_phase2_consumers.py --publish`

The consumer automations do this:
- `orders/create`, `orders/updated`, and `orders/cancelled` upsert `te_sales_order` plus `te_sales_order_line`
- `refunds/create` refreshes the linked Shopify order and reapplies the latest sales-order state
- `customers/create` and `customers/update` upsert `te_customer`
- `products/create` and `products/update` upsert `te_product` and import Shopify product images into `te_product.shopify_image_attachments`

Finance behavior:
- inbound order webhooks still flow through `te_sales`
- `te_finance` remains derived from `te_sales` through the Sales -> Finance income sync
- refund webhooks currently refresh order state only; separate finance refund adjustments are still a later slice
