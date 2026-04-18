import importlib.util
import os
import sys
import unittest
from pathlib import Path


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


def _load_module():
    path = Path(ROOT) / "manifests" / "true_essentials" / "sync_sales_to_finance.py"
    spec = importlib.util.spec_from_file_location("sync_sales_to_finance", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load sync_sales_to_finance.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestSalesFinanceSync(unittest.TestCase):
    def test_build_finance_values_from_paid_order(self) -> None:
        module = _load_module()
        values = module.build_finance_values_from_sales_order(
            "sales-1",
            {
                "te_sales_order.order_number": "#1009",
                "te_sales_order.order_date": "2026-04-18",
                "te_sales_order.currency": "NZD",
                "te_sales_order.financial_status": "paid",
                "te_sales_order.order_total": 38,
                "te_sales_order.total_paid": 38,
                "te_sales_order.customer_name": "Karen Collier",
                "te_sales_order.shopify_order_id": "gid://shopify/Order/123",
            },
        )
        assert values is not None
        self.assertEqual(values["te_finance_entry.entry_type"], "company_income")
        self.assertEqual(values["te_finance_entry.category"], "sales")
        self.assertEqual(values["te_finance_entry.company_cash_effect_nzd"], 38)
        self.assertEqual(values["te_finance_entry.source_order_number"], "#1009")
        self.assertEqual(values["te_finance_entry.shopify_order_id"], "gid://shopify/Order/123")

    def test_build_finance_values_skips_non_paid_order(self) -> None:
        module = _load_module()
        values = module.build_finance_values_from_sales_order(
            "sales-2",
            {
                "te_sales_order.financial_status": "pending",
                "te_sales_order.order_total": 99,
                "te_sales_order.total_paid": 0,
            },
        )
        self.assertIsNone(values)


if __name__ == "__main__":
    unittest.main()
