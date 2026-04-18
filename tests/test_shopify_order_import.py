import importlib.util
import os
import sys
import unittest
from pathlib import Path


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


def _load_order_import_module():
    path = Path(ROOT) / "manifests" / "true_essentials" / "import_shopify_orders.py"
    spec = importlib.util.spec_from_file_location("import_shopify_orders", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load import_shopify_orders.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestShopifyOrderImport(unittest.TestCase):
    def test_order_status_mapping_prefers_cancel_and_refund(self) -> None:
        module = _load_order_import_module()
        self.assertEqual(module.order_status("paid", "fulfilled", "2026-04-18T00:00:00Z"), "cancelled")
        self.assertEqual(module.order_status("refunded", "unfulfilled", None), "refunded")
        self.assertEqual(module.order_status("paid", "fulfilled", None), "fulfilled")
        self.assertEqual(module.order_status("paid", "unfulfilled", None), "paid")
        self.assertEqual(module.order_status("pending", "unfulfilled", None), "open")

    def test_build_line_values_links_snapshot_fields(self) -> None:
        module = _load_order_import_module()
        product_row = module.LocalRecord(
            "prod-1",
            {
                "te_product.uom": "EA",
                "te_product.effective_cost_nzd": 17.36,
            },
        )
        values = module.build_line_values(
            None,
            {
                "id": 1001,
                "product_id": 2001,
                "variant_id": 3001,
                "sku": "A-0002",
                "title": "Medicube Collagen Jelly Cream",
                "variant_title": "Mini",
                "quantity": 2,
                "fulfillable_quantity": 1,
                "price": "51.00",
                "total_discount": "5.00",
                "tax_lines": [{"price": "7.65"}],
            },
            sales_order_id="order-1",
            product_row=product_row,
            currency="NZD",
        )
        self.assertEqual(values["te_sales_order_line.sales_order_id"], "order-1")
        self.assertEqual(values["te_sales_order_line.product_id"], "prod-1")
        self.assertEqual(values["te_sales_order_line.shopify_variant_id"], "3001")
        self.assertEqual(values["te_sales_order_line.description"], "Medicube Collagen Jelly Cream - Mini")
        self.assertEqual(values["te_sales_order_line.line_discount_total"], 5.0)
        self.assertEqual(values["te_sales_order_line.line_tax_total"], 7.65)
        self.assertEqual(values["te_sales_order_line.unit_cost_snapshot"], 17.36)

    def test_find_product_link_matches_numeric_variant_id_to_gid_product_link(self) -> None:
        module = _load_order_import_module()
        product_row = module.LocalRecord(
            "prod-1",
            {
                "te_product.shopify_variant_id": "gid://shopify/ProductVariant/3001",
                "te_product.sku": "A-0002",
            },
        )
        by_variant_id, by_sku, duplicate_skus = module.index_te_products([product_row])
        found = module.find_product_link(
            {"variant_id": 3001, "sku": ""},
            by_variant_id=by_variant_id,
            by_sku=by_sku,
            duplicate_skus=duplicate_skus,
        )
        self.assertIsNotNone(found)
        self.assertEqual(found.record_id, "prod-1")

    def test_apply_local_patch_preserves_manual_order_fields(self) -> None:
        module = _load_order_import_module()
        existing = module.LocalRecord(
            "order-1",
            {
                "te_sales_order.internal_owner": "Nick",
                "te_sales_order.customer_email": "old@example.com",
            },
        )
        patched = module.apply_local_patch(
            existing,
            {
                "te_sales_order.customer_email": "new@example.com",
                "te_sales_order.shopify_last_sync_status": "imported",
            },
        )
        self.assertEqual(patched.record["te_sales_order.internal_owner"], "Nick")
        self.assertEqual(patched.record["te_sales_order.customer_email"], "new@example.com")

    def test_build_order_values_links_customer_record_when_present(self) -> None:
        module = _load_order_import_module()
        customer_row = module.LocalRecord("cust-1", {"te_customer.name": "Kelly"})
        values = module.build_order_values(
            None,
            {
                "id": 1001,
                "name": "#1001",
                "financial_status": "paid",
                "fulfillment_status": "unfulfilled",
                "created_at": "2026-04-18T12:00:00Z",
                "currency": "NZD",
                "email": "kelly@example.com",
                "customer": {
                    "id": 101,
                    "first_name": "Kelly",
                    "last_name": "Collier",
                    "email": "kelly@example.com",
                },
            },
            admin_url="",
            customer_row=customer_row,
        )
        self.assertEqual(values["te_sales_order.customer_id"], "cust-1")


if __name__ == "__main__":
    unittest.main()
