import importlib.util
import os
import sys
import unittest
from pathlib import Path

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from app.template_render import render_template


def _load_setup_module():
    path = Path(ROOT) / "manifests" / "true_essentials" / "setup_shopify_phase1.py"
    spec = importlib.util.spec_from_file_location("setup_shopify_phase1", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load setup_shopify_phase1.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestShopifySetup(unittest.TestCase):
    def test_request_templates_include_shopify_graphql_templates(self) -> None:
        module = _load_setup_module()
        templates = module.build_request_templates()
        product_template = next((item for item in templates if item.get("id") == "shopify_graphql_product_set"), None)
        list_template = next((item for item in templates if item.get("id") == "shopify_graphql_products_list"), None)
        inventory_template = next((item for item in templates if item.get("id") == "shopify_graphql_inventory_set_quantities"), None)
        self.assertIsNotNone(product_template, templates)
        self.assertIsNotNone(list_template, templates)
        self.assertIsNotNone(inventory_template, templates)
        self.assertEqual(product_template.get("method"), "POST")
        self.assertEqual(product_template.get("path"), "/graphql.json")
        self.assertEqual(list_template.get("method"), "POST")
        self.assertEqual(list_template.get("path"), "/graphql.json")
        self.assertEqual(inventory_template.get("method"), "POST")
        self.assertEqual(inventory_template.get("path"), "/graphql.json")

    def test_push_automation_targets_te_product_push_action(self) -> None:
        module = _load_setup_module()
        automation = module.build_push_automation(
            connection_id="conn-123",
            status="draft",
            default_vendor="True Essentials",
        )
        self.assertEqual(automation.get("name"), "Shopify Phase 1 - Push Products")
        trigger = automation.get("trigger") or {}
        self.assertEqual(trigger.get("kind"), "event")
        self.assertIn("action.clicked", trigger.get("event_types") or [])
        filters = trigger.get("filters") or []
        self.assertIn({"path": "entity_id", "op": "eq", "value": "entity.te_product"}, filters)
        self.assertIn({"path": "action_id", "op": "eq", "value": "action.te_product_push_shopify"}, filters)
        push_step = next((item for item in automation.get("steps") or [] if item.get("id") == "push_shopify_product"), None)
        self.assertIsNotNone(push_step, automation.get("steps"))
        inputs = push_step.get("inputs") or {}
        self.assertEqual(inputs.get("connection_id"), "conn-123")
        self.assertEqual(inputs.get("template_id"), "shopify_graphql_product_set")
        self.assertIn("productSet", inputs.get("body") or "")
        self.assertIn("slugify", inputs.get("body") or "")
        graphql_check = next((item for item in automation.get("steps") or [] if item.get("id") == "graphql_errors_found"), None)
        product_saved = next((item for item in (graphql_check or {}).get("else_steps") or [] if item.get("id") == "user_errors_found"), None)
        product_saved = next((item for item in (product_saved or {}).get("else_steps") or [] if item.get("id") == "product_saved"), None)
        nested_steps = (product_saved or {}).get("then_steps") or []
        media_step = next((item for item in nested_steps if item.get("id") == "push_shopify_media"), None)
        self.assertIsNotNone(media_step, nested_steps)
        self.assertEqual((media_step or {}).get("action_id"), "system.shopify_sync_product_media")
        media_inputs = (media_step or {}).get("inputs") or {}
        self.assertEqual(media_inputs.get("attachment_field_id"), "te_product.shopify_image_attachments")
        self.assertEqual(media_inputs.get("attachment_purpose"), "field:te_product.shopify_image_attachments")

    def test_push_body_template_renders_valid_graphql_json(self) -> None:
        module = _load_setup_module()
        template = module.build_product_push_body_template("True Essentials")
        rendered = render_template(
            template,
            {
                "trigger": {
                    "record": {
                        "fields": {
                            "title": "Magnesium Sleep Support",
                            "sku": "TE MAG 001",
                            "variant_name": "",
                            "shopify_handle": "",
                            "shopify_product_id": "",
                            "shopify_description_html": "<p>Sleep better</p>",
                            "shopify_status": "",
                            "status": "active",
                            "retail_price": 39.9,
                            "compare_at_price": 49.9,
                            "track_stock": True,
                        }
                    }
                }
            },
            strict=True,
        )
        payload = __import__("json").loads(rendered)
        self.assertEqual(payload["variables"]["input"]["handle"], "te-mag-001")
        self.assertEqual(payload["variables"]["input"]["variants"][0]["compareAtPrice"], 49.9)
        self.assertTrue(payload["variables"]["input"]["variants"][0]["inventoryItem"]["tracked"])

    def test_push_body_template_allows_missing_optional_shopify_fields(self) -> None:
        module = _load_setup_module()
        template = module.build_product_push_body_template("True Essentials")
        rendered = render_template(
            template,
            {
                "trigger": {
                    "record": {
                        "fields": {
                            "title": "Portable water flosser",
                            "sku": "A-0013",
                            "status": "active",
                            "retail_price": 89,
                            "track_stock": True,
                        }
                    }
                }
            },
            strict=True,
        )
        payload = __import__("json").loads(rendered)
        self.assertIsNone(payload["variables"]["identifier"])
        self.assertEqual(payload["variables"]["input"]["title"], "Portable water flosser")
        self.assertEqual(payload["variables"]["input"]["handle"], "a-0013")
        self.assertEqual(payload["variables"]["input"]["status"], "ACTIVE")
        self.assertEqual(payload["variables"]["input"]["variants"][0]["compareAtPrice"], None)
        self.assertTrue(payload["variables"]["input"]["variants"][0]["inventoryItem"]["tracked"])

    def test_inventory_push_automation_targets_inventory_action(self) -> None:
        module = _load_setup_module()
        automation = module.build_inventory_push_automation(
            connection_id="conn-123",
            status="draft",
            location_id="gid://shopify/Location/123456789",
        )
        self.assertEqual(automation.get("name"), "Shopify Phase 1 - Push Inventory")
        trigger = automation.get("trigger") or {}
        self.assertEqual(trigger.get("kind"), "event")
        self.assertIn("action.clicked", trigger.get("event_types") or [])
        filters = trigger.get("filters") or []
        self.assertIn({"path": "entity_id", "op": "eq", "value": "entity.te_product"}, filters)
        self.assertIn({"path": "action_id", "op": "eq", "value": "action.te_product_push_shopify_inventory"}, filters)
        push_step = next((item for item in automation.get("steps") or [] if item.get("id") == "push_shopify_inventory"), None)
        self.assertIsNotNone(push_step, automation.get("steps"))
        inputs = push_step.get("inputs") or {}
        self.assertEqual(inputs.get("connection_id"), "conn-123")
        self.assertEqual(inputs.get("template_id"), "shopify_graphql_inventory_set_quantities")
        self.assertIn("inventorySetQuantities", inputs.get("body") or "")
        graphql_check = next((item for item in automation.get("steps") or [] if item.get("id") == "inventory_graphql_errors_found"), None)
        self.assertEqual((graphql_check or {}).get("expr"), {"op": "exists", "left": {"var": "steps.push_shopify_inventory.body_json.errors[0].message"}})

    def test_product_push_automation_uses_exists_for_error_checks(self) -> None:
        module = _load_setup_module()
        automation = module.build_push_automation(
            connection_id="conn-123",
            status="draft",
            default_vendor="True Essentials",
        )
        graphql_check = next((item for item in automation.get("steps") or [] if item.get("id") == "graphql_errors_found"), None)
        self.assertEqual((graphql_check or {}).get("expr"), {"op": "exists", "left": {"var": "steps.push_shopify_product.body_json.errors[0].message"}})

    def test_inventory_body_template_renders_valid_graphql_json(self) -> None:
        module = _load_setup_module()
        template = module.build_inventory_push_body_template("gid://shopify/Location/123456789")
        rendered = render_template(
            template,
            {
                "trigger": {
                    "record_id": "prod-123",
                    "record": {
                        "fields": {
                            "shopify_inventory_item_id": "gid://shopify/InventoryItem/987654321",
                            "stock_available": 14,
                        }
                    },
                }
            },
            strict=True,
        )
        payload = __import__("json").loads(rendered)
        quantities = payload["variables"]["input"]["quantities"]
        self.assertEqual(len(quantities), 1)
        self.assertEqual(quantities[0]["inventoryItemId"], "gid://shopify/InventoryItem/987654321")
        self.assertEqual(quantities[0]["locationId"], "gid://shopify/Location/123456789")
        self.assertEqual(quantities[0]["quantity"], 14)
        self.assertEqual(payload["variables"]["input"]["referenceDocumentUri"], "gid://octodrop/te_product/prod-123")


if __name__ == "__main__":
    unittest.main()
