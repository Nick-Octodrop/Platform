import importlib.util
import os
import sys
import unittest
from pathlib import Path


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


def _load_setup_module():
    path = Path(ROOT) / "manifests" / "true_essentials" / "setup_shopify_phase2_consumers.py"
    spec = importlib.util.spec_from_file_location("setup_shopify_phase2_consumers", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load setup_shopify_phase2_consumers.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestShopifyPhase2ConsumersSetup(unittest.TestCase):
    def test_builds_generic_shopify_mappings(self) -> None:
        module = _load_setup_module()
        customer = module.build_customer_mapping("conn_shopify")
        product = module.build_product_mapping("conn_shopify")
        order = module.build_sales_order_mapping("conn_shopify")
        line = module.build_sales_order_line_mapping("conn_shopify")
        self.assertEqual(customer["target_entity"], "entity.te_customer")
        self.assertEqual(product["mapping_json"]["match_on"], ["te_product.sku"])
        self.assertEqual(order["mapping_json"]["match_on"], ["te_sales_order.shopify_order_id"])
        self.assertEqual(line["mapping_json"]["match_on"], ["te_sales_order_line.shopify_line_item_id"])

    def test_orders_consumer_uses_generic_mapping_flow(self) -> None:
        module = _load_setup_module()
        automation = module.build_orders_consumer_automation(
            status="draft",
            customer_mapping_id="map_customer",
            order_mapping_id="map_order",
            order_line_mapping_id="map_order_line",
        )
        self.assertEqual(automation["name"], "Shopify Phase 2 - Orders Inbound")
        self.assertEqual(
            automation["trigger"]["event_types"],
            [
                "integration.webhook.shopify.orders.create",
                "integration.webhook.shopify.orders.updated",
                "integration.webhook.shopify.orders.cancelled",
            ],
        )
        self.assertEqual(automation["steps"][1]["action_id"], "system.apply_integration_mapping")
        self.assertEqual(automation["steps"][1]["inputs"]["mapping_id"], "map_order")
        self.assertEqual(automation["steps"][2]["kind"], "foreach")
        self.assertEqual(automation["steps"][2]["steps"][1]["action_id"], "system.apply_integration_mapping")

    def test_customer_and_product_consumers_use_mapping_action(self) -> None:
        module = _load_setup_module()
        customer = module.build_customers_consumer_automation(status="draft", customer_mapping_id="map_customer")
        product = module.build_products_consumer_automation(status="draft", product_mapping_id="map_product")
        self.assertEqual(customer["steps"][0]["action_id"], "system.apply_integration_mapping")
        self.assertEqual(customer["steps"][0]["inputs"]["mapping_id"], "map_customer")
        self.assertEqual(product["steps"][0]["kind"], "foreach")
        self.assertEqual(product["steps"][0]["steps"][0]["kind"], "condition")
        self.assertEqual(product["steps"][0]["steps"][0]["then_steps"][0]["action_id"], "system.apply_integration_mapping")

    def test_refund_consumer_fetches_order_and_reapplies_mappings(self) -> None:
        module = _load_setup_module()
        automation = module.build_refunds_consumer_automation(
            status="published",
            customer_mapping_id="map_customer",
            order_mapping_id="map_order",
            order_line_mapping_id="map_order_line",
        )
        self.assertEqual(automation["status"], "published")
        self.assertEqual(automation["trigger"]["event_types"], ["integration.webhook.shopify.refunds.create"])
        self.assertEqual(automation["steps"][0]["action_id"], "system.integration_request")
        self.assertEqual(automation["steps"][1]["then_steps"][1]["action_id"], "system.apply_integration_mapping")


if __name__ == "__main__":
    unittest.main()
