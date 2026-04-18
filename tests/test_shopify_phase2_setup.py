import importlib.util
import os
import sys
import unittest
from pathlib import Path


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


def _load_setup_module():
    path = Path(ROOT) / "manifests" / "true_essentials" / "setup_shopify_phase2.py"
    spec = importlib.util.spec_from_file_location("setup_shopify_phase2", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load setup_shopify_phase2.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestShopifyPhase2Setup(unittest.TestCase):
    def test_topic_specs_cover_expected_shopify_resources(self) -> None:
        module = _load_setup_module()
        topics = {item["topic"]: item["event_key"] for item in module.TOPIC_SPECS}
        self.assertEqual(topics["ORDERS_CREATE"], "shopify.orders.create")
        self.assertEqual(topics["ORDERS_UPDATED"], "shopify.orders.updated")
        self.assertEqual(topics["CUSTOMERS_CREATE"], "shopify.customers.create")
        self.assertEqual(topics["PRODUCTS_UPDATE"], "shopify.products.update")
        scopes = {item["topic"]: item.get("required_scopes") for item in module.TOPIC_SPECS}
        self.assertEqual(scopes["CUSTOMERS_CREATE"], ["read_customers"])
        self.assertEqual(scopes["REFUNDS_CREATE"], ["read_orders"])

    def test_choose_signing_secret_id_prefers_signing_secret_before_client_secret(self) -> None:
        module = _load_setup_module()
        connection = {
            "secret_refs": {
                "client_secret": "secret-client",
                "signing_secret": "secret-signing",
            }
        }
        self.assertEqual(module.choose_signing_secret_id(connection), "secret-signing")
        self.assertEqual(module.choose_signing_secret_id({"secret_refs": {"client_secret": "secret-client"}}), "secret-client")

    def test_callback_url_uses_ingest_endpoint(self) -> None:
        module = _load_setup_module()
        url = module.endpoint_callback_url("https://octodrop-platform-api.fly.dev", "webhook-123")
        self.assertEqual(url, "https://octodrop-platform-api.fly.dev/integrations/webhooks/webhook-123/ingest")


if __name__ == "__main__":
    unittest.main()
