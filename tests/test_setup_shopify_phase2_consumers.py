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
    def test_orders_consumer_targets_shopify_order_webhook_action(self) -> None:
        module = _load_setup_module()
        automation = module.build_orders_consumer_automation(status="draft")
        self.assertEqual(automation["name"], "Shopify Phase 2 - Orders Inbound")
        self.assertEqual(
            automation["trigger"]["event_types"],
            [
                "integration.webhook.shopify.orders.create",
                "integration.webhook.shopify.orders.updated",
                "integration.webhook.shopify.orders.cancelled",
            ],
        )
        step = automation["steps"][0]
        self.assertEqual(step["action_id"], "system.shopify_upsert_order_webhook")
        self.assertEqual(step["inputs"]["connection_id"], {"var": "trigger.connection_id"})
        self.assertEqual(step["inputs"]["payload"], {"var": "trigger.payload"})

    def test_customer_and_product_consumers_use_raw_webhook_payload(self) -> None:
        module = _load_setup_module()
        customer = module.build_customers_consumer_automation(status="draft")
        product = module.build_products_consumer_automation(status="draft")
        self.assertEqual(customer["steps"][0]["action_id"], "system.shopify_upsert_customer_webhook")
        self.assertEqual(product["steps"][0]["action_id"], "system.shopify_upsert_product_webhook")
        self.assertEqual(customer["steps"][0]["inputs"]["payload"], {"var": "trigger.payload"})
        self.assertEqual(product["steps"][0]["inputs"]["payload"], {"var": "trigger.payload"})

    def test_refund_consumer_refreshes_order_from_webhook(self) -> None:
        module = _load_setup_module()
        automation = module.build_refunds_consumer_automation(status="published")
        self.assertEqual(automation["status"], "published")
        self.assertEqual(automation["trigger"]["event_types"], ["integration.webhook.shopify.refunds.create"])
        self.assertEqual(automation["steps"][0]["action_id"], "system.shopify_refresh_order_from_refund_webhook")


if __name__ == "__main__":
    unittest.main()
