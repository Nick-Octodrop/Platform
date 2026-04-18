import importlib.util
import os
import sys
import unittest
from pathlib import Path


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


def _load_import_module():
    path = Path(ROOT) / "manifests" / "true_essentials" / "import_shopify_products.py"
    spec = importlib.util.spec_from_file_location("import_shopify_products", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load import_shopify_products.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestShopifyImport(unittest.TestCase):
    def test_product_image_payloads_emit_deterministic_filenames(self) -> None:
        module = _load_import_module()
        rows = module.product_image_payloads(
            {
                "title": "Cordless Water Flosser",
                "handle": "cordless-water-flosser",
                "images": {
                    "nodes": [
                        {"url": "https://cdn.shopify.com/products/flosser-main.jpg?v=1", "altText": "Main"},
                        {"url": "https://cdn.shopify.com/products/flosser-side.png", "altText": "Side"},
                    ]
                },
            }
        )
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["filename"], "cordless-water-flosser-1.jpg")
        self.assertEqual(rows[1]["filename"], "cordless-water-flosser-2.png")
        self.assertEqual(rows[0]["alt_text"], "Main")

    def test_shopify_variant_payloads_emit_one_row_per_sku_variant(self) -> None:
        module = _load_import_module()
        rows = module.shopify_variant_payloads(
            {
                "id": "gid://shopify/Product/10",
                "title": "Medicube Collagen Jelly Cream",
                "handle": "medicube-collagen-jelly-cream",
                "descriptionHtml": "<p>Hydration</p>",
                "status": "ACTIVE",
                "onlineStoreUrl": "https://shop.example/products/medicube-collagen-jelly-cream",
                "images": {"nodes": []},
                "variants": {
                    "nodes": [
                        {
                            "id": "gid://shopify/ProductVariant/11",
                            "title": "Default Title",
                            "sku": "A-0002",
                            "price": "51.00",
                            "compareAtPrice": None,
                            "inventoryItem": {"id": "gid://shopify/InventoryItem/12", "tracked": True},
                        },
                        {
                            "id": "gid://shopify/ProductVariant/13",
                            "title": "Mini",
                            "sku": "A-0002-MINI",
                            "price": "29.00",
                            "compareAtPrice": "35.00",
                            "inventoryItem": {"id": "gid://shopify/InventoryItem/14", "tracked": False},
                        },
                    ]
                },
            },
            shop_currency="NZD",
        )
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["sku"], "A-0002")
        self.assertEqual(rows[0]["variant_name"], "")
        self.assertEqual(rows[1]["sku"], "A-0002-MINI")
        self.assertEqual(rows[1]["variant_name"], "Mini")
        self.assertEqual(rows[1]["compare_at_price"], 35.0)
        self.assertEqual(rows[1]["shopify_inventory_item_id"], "gid://shopify/InventoryItem/14")

    def test_product_variants_includes_rows_even_without_sku(self) -> None:
        module = _load_import_module()
        variants = module.product_variants(
            {
                "variants": {
                    "nodes": [
                        {"id": "gid://shopify/ProductVariant/11", "sku": ""},
                        {"id": "gid://shopify/ProductVariant/12", "sku": "ABC"},
                    ]
                }
            }
        )
        self.assertEqual(len(variants), 2)

    def test_build_update_values_preserves_local_title_and_price_by_default(self) -> None:
        module = _load_import_module()
        values = module.build_update_values(
            {
                "te_product.sku": "A-0002",
                "te_product.title": "Local Title",
                "te_product.variant_name": "",
                "te_product.retail_price": 51,
                "te_product.compare_at_price": 0,
                "te_product.buy_price": 17.36,
                "te_product.track_stock": True,
                "te_product.shopify_variant_id": "",
            },
            {
                "sku": "A-0002",
                "title": "Shopify Title",
                "variant_name": "Mini",
                "status": "active",
                "retail_price": 99.0,
                "compare_at_price": 120.0,
                "track_stock": False,
                "shopify_handle": "shopify-title",
                "shopify_description_html": "<p>Shopify</p>",
                "shopify_product_url": "https://shop.example/products/shopify-title",
                "shopify_product_id": "gid://shopify/Product/10",
                "shopify_variant_id": "gid://shopify/ProductVariant/11",
                "shopify_inventory_item_id": "gid://shopify/InventoryItem/12",
                "shopify_status": "ACTIVE",
            },
            overwrite_local=False,
        )
        self.assertNotIn("te_product.title", values)
        self.assertNotIn("te_product.retail_price", values)
        self.assertEqual(values["te_product.compare_at_price"], 120.0)
        self.assertEqual(values["te_product.variant_name"], "Mini")
        self.assertEqual(values["te_product.shopify_variant_id"], "gid://shopify/ProductVariant/11")
        self.assertNotIn("te_product.buy_price", values)

    def test_apply_local_patch_preserves_unrelated_fields(self) -> None:
        module = _load_import_module()
        existing = module.LocalRecord(
            "prod-1",
            {
                "te_product.sku": "A-0002",
                "te_product.buy_price": 17.36,
                "te_product.reorder_point": 5,
                "te_product.shopify_variant_id": "",
            },
        )
        patched = module.apply_local_patch(
            existing,
            {
                "te_product.shopify_variant_id": "gid://shopify/ProductVariant/11",
                "te_product.shopify_product_id": "gid://shopify/Product/10",
            },
        )
        self.assertEqual(patched.record["te_product.buy_price"], 17.36)
        self.assertEqual(patched.record["te_product.reorder_point"], 5)
        self.assertEqual(patched.record["te_product.shopify_variant_id"], "gid://shopify/ProductVariant/11")


if __name__ == "__main__":
    unittest.main()
