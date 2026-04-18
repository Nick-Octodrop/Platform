import importlib.util
import os
import sys
import unittest
from pathlib import Path


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


def _load_module():
    path = Path(ROOT) / "manifests" / "true_essentials" / "setup_sales_finance_sync.py"
    spec = importlib.util.spec_from_file_location("setup_sales_finance_sync", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load setup_sales_finance_sync.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestSetupSalesFinanceSync(unittest.TestCase):
    def test_build_sales_finance_sync_automation(self) -> None:
        module = _load_module()
        automation = module.build_sales_finance_sync_automation(status="draft")
        self.assertEqual(automation["name"], "TE Sales -> Finance Income")
        self.assertEqual(automation["trigger"]["event_types"], ["record.created", "record.updated"])
        self.assertIn({"path": "entity_id", "op": "eq", "value": "entity.te_sales_order"}, automation["trigger"]["filters"])
        step = automation["steps"][0]
        self.assertEqual(step["action_id"], "system.sync_sales_order_to_finance")
        self.assertEqual(step["inputs"]["entity_id"], "entity.te_sales_order")
        self.assertEqual(step["inputs"]["record_id"], "{{ trigger.record_id }}")


if __name__ == "__main__":
    unittest.main()
