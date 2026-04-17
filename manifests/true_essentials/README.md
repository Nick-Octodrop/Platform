# True Essentials Manifest Suite

## Modules created

### `te_catalog.json`
- Product master records for the Shopify-facing catalog
- Product forms designed as operational work surfaces with clean pricing, Shopify, notes, and activity structure
- Products now support retail sell pricing in NZD alongside separate buy-side pricing, FX conversion into NZD, landed-cost overrides, gross margin visibility, manual stock controls, Shopify compare-at pricing, storefront description fields, and a dedicated Shopify image attachment field
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
- Purchase orders with a real statusbar workflow: `draft -> placed -> received / cancelled`
- Supplier-aware purchase order lines filtered to compatible supplier-linked products
- Purchase order lines now support ordered, received, and open quantity tracking for a cleaner operational bridge into stock control
- Line items in their own tab, notes/documents in their own tab, activity enabled, cancellation modal included
- Currency-aware totals and landed-cost estimate

### `te_finance.json`
- Internal owner/company finance entries for expenses, contributions, reimbursements, and adjustments
- NZD-friendly reporting fields and balances
- Home dashboard focused on company funds available, owner balances owed, unreimbursed spend, and contributions
- Receipt/proof attachments and activity enabled

### `te_sales.json`
- Customer-facing sales orders with a clean split between order header state and sales order lines
- Built to receive Shopify-originated orders into a real operational entity instead of overloading catalog or sync tables
- Tracks customer/shipping snapshots, line totals, paid/balance-due visibility, and gross margin against catalog cost snapshots
- Links order lines back to `te_product` so imported Shopify orders can still roll into product-level operational reporting later

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
2. Create and authorize a Shopify integration connection in Octodrop.
3. Bind the manual product-push automation to that connection:
   - `python manifests/true_essentials/setup_shopify_phase1.py --connection-name "True Essentials Shopify" --publish`

The phase-1 Shopify setup currently creates two manual actions on `te_product` records:
- `Push To Shopify`
- `Push Stock To Shopify`

The product push sends the catalog master into Shopify using GraphQL `productSet` and writes back Shopify product, variant, inventory-item, status, and URL fields onto the same Octodrop product record.

The stock push sends `stock_available` into one configured Shopify location using GraphQL `inventorySetQuantities`. It expects the product to have already been pushed once so that the Shopify inventory item ID is known.
