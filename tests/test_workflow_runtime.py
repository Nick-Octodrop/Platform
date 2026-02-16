import os
import sys
import unittest


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "src")
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
if SRC not in sys.path:
    sys.path.insert(0, SRC)

from action_plan import plan_action
from action_exec import execute_plan
from event_bus import EventBus
from outbox import Outbox
from workflow_plan import plan_workflow_step
from workflow_runtime import apply_workflow_step
from workflow_store import WorkflowStore


class FakeTx:
    def __init__(self) -> None:
        self.committed = False
        self.rolled_back = False

    def commit(self) -> None:
        self.committed = True

    def rollback(self) -> None:
        self.rolled_back = True


class FakeTxMgr:
    def __init__(self) -> None:
        self.last_tx = None

    def begin(self) -> FakeTx:
        self.last_tx = FakeTx()
        return self.last_tx


class FakeRecordStore:
    def __init__(self) -> None:
        self.fail = False

    def update_record(self, tx, entity, record_id, changes) -> None:
        if self.fail:
            raise KeyError("missing")

    def create_record(self, tx, entity, values) -> dict:
        return {"id": "new1"}


class FakeActions:
    def call(self, tx, action_ref, params, ctx):
        return {"ok": True}


class FakeQueries:
    def run(self, tx, query_ref, params, ctx):
        return []


class TestWorkflowRuntime(unittest.TestCase):
    def setUp(self) -> None:
        self.store = WorkflowStore()
        self.instance = self.store.create_instance("m1", "wf", "s1", None, None)
        self.tx_mgr = FakeTxMgr()
        self.records = FakeRecordStore()
        self.outbox = Outbox()
        self.ctx = {
            "actor": {"id": "u1", "roles": ["admin"]},
            "module_id": "m1",
            "manifest_hash": "sha256:abcd",
            "vars": {"ok": True},
        }
        self.workflow = {
            "id": "wf",
            "initial_state": "s1",
            "states": [{"id": "s1", "label": None}, {"id": "s2", "label": None}],
            "transitions": [
                {
                    "id": "t1",
                    "from": "s1",
                    "to": "s2",
                    "guard": {"op": "eq", "left": {"var": "ok"}, "right": {"literal": True}},
                    "actions": ["action.close"],
                    "emits": [{"name": "wf.done", "payload": {"ok": True}}],
                }
            ],
        }
        self.action_decl = {
            "id": "action.close",
            "type": "update_record",
            "params_schema": None,
            "effect": {
                "record_ref": {"entity": "entity.job", "id": {"literal": "j1"}},
                "changes": {"job.status": {"literal": "closed"}},
            },
        }

    def _deps(self):
        return {
            "store": self.store,
            "workflow_plan": plan_workflow_step,
            "action_plan": plan_action,
            "action_exec": execute_plan,
            "tx": self.tx_mgr,
            "outbox": self.outbox,
            "action_decls": {"action.close": self.action_decl},
            "records": self.records,
            "actions": FakeActions(),
            "queries": FakeQueries(),
        }

    def test_no_transition_no_tx(self) -> None:
        self.ctx["vars"]["ok"] = False
        result = apply_workflow_step(self.workflow, self.instance["instance_id"], self.ctx, self._deps())
        self.assertTrue(result["ok"])
        self.assertIsNone(self.tx_mgr.last_tx)

    def test_success_updates_state_and_history(self) -> None:
        result = apply_workflow_step(self.workflow, self.instance["instance_id"], self.ctx, self._deps())
        self.assertTrue(result["ok"])
        inst = result["instance"]
        self.assertEqual(inst["current_state"], "s2")
        self.assertEqual(inst["history"][-1]["transition_id"], "t1")
        self.assertTrue(self.tx_mgr.last_tx.committed)

    def test_missing_action_decl_rolls_back(self) -> None:
        deps = self._deps()
        deps["action_decls"] = {}
        result = apply_workflow_step(self.workflow, self.instance["instance_id"], self.ctx, deps)
        self.assertFalse(result["ok"])
        self.assertTrue(self.tx_mgr.last_tx.rolled_back)
        inst = self.store.get_instance(self.instance["instance_id"])
        self.assertEqual(inst["current_state"], "s1")

    def test_action_exec_failure_rolls_back(self) -> None:
        self.records.fail = True
        result = apply_workflow_step(self.workflow, self.instance["instance_id"], self.ctx, self._deps())
        self.assertFalse(result["ok"])
        self.assertTrue(self.tx_mgr.last_tx.rolled_back)
        inst = self.store.get_instance(self.instance["instance_id"])
        self.assertEqual(inst["current_state"], "s1")

    def test_workflow_events_enqueued_after_commit(self) -> None:
        result = apply_workflow_step(self.workflow, self.instance["instance_id"], self.ctx, self._deps())
        self.assertTrue(result["ok"])
        self.assertEqual(len(self.outbox.pending()), 1)
        self.assertTrue(self.tx_mgr.last_tx.committed)


if __name__ == "__main__":
    unittest.main()
