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
        self.assertEqual(automation["steps"][0]["action_id"], "system.query_records")
        self.assertEqual(automation["steps"][1]["action_id"], "system.query_records")
        decision = automation["steps"][2]
        self.assertEqual(decision["kind"], "condition")
        self.assertEqual(decision["then_steps"][0]["then_steps"][0]["action_id"], "system.update_record")
        self.assertEqual(decision["then_steps"][0]["else_steps"][0]["action_id"], "system.create_record")
        self.assertEqual(decision["else_steps"][0]["then_steps"][0]["action_id"], "system.update_record")


if __name__ == "__main__":
    unittest.main()
