import importlib.util
import os
import sys
import unittest
from pathlib import Path


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


def _load_customer_import_module():
    path = Path(ROOT) / "manifests" / "true_essentials" / "import_shopify_customers.py"
    spec = importlib.util.spec_from_file_location("import_shopify_customers", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load import_shopify_customers.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestShopifyCustomerImport(unittest.TestCase):
    def test_build_customer_payload_maps_shopify_fields(self) -> None:
        module = _load_customer_import_module()
        payload = module.build_customer_payload(
            {
                "id": 101,
                "first_name": "Kelly",
                "last_name": "Collier",
                "email": "kelly@example.com",
                "phone": "+6421000000",
                "state": "enabled",
                "currency": "NZD",
                "tags": "vip, newsletter",
                "orders_count": 4,
                "total_spent": "221.50",
                "updated_at": "2026-04-18T10:00:00+12:00",
                "email_marketing_consent": {"state": "subscribed"},
                "sms_marketing_consent": {"state": "not_subscribed"},
                "default_address": {
                    "address1": "43 Cheltenham Road",
                    "city": "Queenstown",
                    "province": "Otago",
                    "zip": "9304",
                    "country": "New Zealand",
                },
            },
            admin_base_url="https://pkijv2-5y.myshopify.com/admin",
        )
        self.assertEqual(payload["name"], "Kelly Collier")
        self.assertEqual(payload["status"], "active")
        self.assertTrue(payload["accepts_email_marketing"])
        self.assertFalse(payload["accepts_sms_marketing"])
        self.assertEqual(payload["shopify_customer_admin_url"], "https://pkijv2-5y.myshopify.com/admin/customers/101")
        self.assertEqual(payload["total_spent_nzd"], 221.5)

    def test_build_update_values_preserves_local_contact_fields_by_default(self) -> None:
        module = _load_customer_import_module()
        values = module.build_update_values(
            {
                "te_customer.name": "Local Name",
                "te_customer.email": "local@example.com",
                "te_customer.phone": "+6400000000",
                "te_customer.currency_preference": "NZD",
            },
            {
                "name": "Shopify Name",
                "email": "shopify@example.com",
                "phone": "+6411111111",
                "status": "active",
                "accepts_email_marketing": True,
                "accepts_sms_marketing": False,
                "currency_preference": "USD",
                "tags": "vip",
                "shopify_customer_id": "gid://shopify/Customer/101",
                "shopify_customer_admin_url": "https://example/admin/customers/101",
                "shopify_state": "enabled",
                "default_address_line_1": "A",
                "default_address_line_2": "",
                "default_city": "Queenstown",
                "default_region": "Otago",
                "default_postcode": "9304",
                "default_country": "New Zealand",
                "orders_count": 2,
                "total_spent_nzd": 88.0,
                "last_order_name": "#1002",
                "last_order_date": "2026-04-18",
            },
            overwrite_local=False,
        )
        self.assertEqual(values["te_customer.tags"], "vip")
        self.assertEqual(values["te_customer.shopify_customer_id"], "gid://shopify/Customer/101")
        self.assertNotIn("te_customer.name", values)
        self.assertNotIn("te_customer.email", values)
        self.assertNotIn("te_customer.phone", values)

    def test_build_order_customer_payload_supports_guest_checkout(self) -> None:
        module = _load_customer_import_module()
        payload = module.build_order_customer_payload(
            {
                "id": 2001,
                "name": "#2001",
                "email": "guest@example.com",
                "phone": "+64223334444",
                "currency": "NZD",
                "total_price": "64.00",
                "created_at": "2026-04-18T12:00:00Z",
                "shipping_address": {
                    "name": "Guest Buyer",
                    "address1": "1 Test Street",
                    "city": "Queenstown",
                    "province": "Otago",
                    "zip": "9304",
                    "country": "New Zealand",
                },
            },
            admin_base_url="https://pkijv2-5y.myshopify.com/admin",
        )
        self.assertIsNotNone(payload)
        assert payload is not None
        self.assertEqual(payload["email"], "guest@example.com")
        self.assertEqual(payload["name"], "Guest Buyer")
        self.assertEqual(payload["shopify_customer_id"], "")
        self.assertEqual(payload["orders_count"], 1)
        self.assertEqual(payload["total_spent_nzd"], 64.0)

    def test_merge_order_customer_payloads_rolls_up_spend_and_last_order(self) -> None:
        module = _load_customer_import_module()
        merged = module.merge_customer_payload(
            {
                "name": "Kelly",
                "email": "kelly@example.com",
                "orders_count": 1,
                "total_spent_nzd": 25.0,
                "last_order_name": "#1001",
                "last_order_date": "2026-04-10",
                "accepts_email_marketing": False,
            },
            {
                "name": "",
                "email": "kelly@example.com",
                "orders_count": 1,
                "total_spent_nzd": 64.0,
                "last_order_name": "#1002",
                "last_order_date": "2026-04-18",
                "accepts_email_marketing": False,
            },
        )
        self.assertEqual(merged["orders_count"], 2)
        self.assertEqual(merged["total_spent_nzd"], 89.0)
        self.assertEqual(merged["last_order_name"], "#1002")


if __name__ == "__main__":
    unittest.main()
