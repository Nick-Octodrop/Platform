import os
import sys
import unittest


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "src")
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
if SRC not in sys.path:
    sys.path.insert(0, SRC)

from action_exec import execute_plan
from outbox import Outbox


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
        self.updated = []
        self.created = []
        self.fail_update = False

    def update_record(self, tx, entity, record_id, changes) -> None:
        if self.fail_update:
            raise KeyError("not found")
        self.updated.append((entity, record_id, changes))

    def create_record(self, tx, entity, values) -> dict:
        created = {"id": "new1"}
        created.update(values)
        self.created.append((entity, values))
        return created


class FakeActions:
    def __init__(self) -> None:
        self.calls = []

    def call(self, tx, action_ref, params, ctx):
        self.calls.append((action_ref, params))
        return {"ok": True}


class FakeQueries:
    def __init__(self) -> None:
        self.calls = []

    def run(self, tx, query_ref, params, ctx):
        self.calls.append((query_ref, params))
        return [1, 2]


class TestActionExec(unittest.TestCase):
    def setUp(self) -> None:
        self.tx_mgr = FakeTxMgr()
        self.records = FakeRecordStore()
        self.actions = FakeActions()
        self.queries = FakeQueries()
        self.outbox = Outbox()
        self.ctx = {
            "actor": {"id": "u1", "roles": ["admin"]},
            "module_id": "job_management",
            "manifest_hash": "sha256:abcd",
            "vars": {"job": {"id": "j1"}},
            "trace_id": None,
        }

    def test_update_create_order_and_commit(self) -> None:
        plan = {
            "action_id": "a",
            "type": "update_record",
            "steps": [
                {
                    "kind": "update_record",
                    "record_ref": {"entity": "entity.job", "id": {"var": "job.id"}},
                    "changes": {"job.status": {"literal": "closed"}},
                },
                {
                    "kind": "create_record",
                    "entity": "entity.note",
                    "values": {"note.text": {"literal": "hi"}},
                    "returns": {"as": "created", "fields": ["id", "note.text"]},
                },
            ],
        }
        result = execute_plan(
            plan,
            self.ctx,
            {"tx": self.tx_mgr, "records": self.records, "actions": self.actions, "queries": self.queries, "outbox": self.outbox},
        )
        self.assertTrue(result["ok"])
        self.assertTrue(self.tx_mgr.last_tx.committed)
        self.assertFalse(self.tx_mgr.last_tx.rolled_back)
        self.assertEqual(len(self.records.updated), 1)
        self.assertEqual(len(self.records.created), 1)

    def test_rollback_on_failure(self) -> None:
        self.records.fail_update = True
        plan = {
            "action_id": "a",
            "type": "update_record",
            "steps": [
                {
                    "kind": "update_record",
                    "record_ref": {"entity": "entity.job", "id": {"var": "job.id"}},
                    "changes": {"job.status": {"literal": "closed"}},
                }
            ],
        }
        result = execute_plan(
            plan,
            self.ctx,
            {"tx": self.tx_mgr, "records": self.records, "actions": self.actions, "queries": self.queries, "outbox": self.outbox},
        )
        self.assertFalse(result["ok"])
        self.assertTrue(self.tx_mgr.last_tx.rolled_back)
        self.assertFalse(self.tx_mgr.last_tx.committed)

    def test_publish_event_after_commit(self) -> None:
        plan = {
            "action_id": "a",
            "type": "publish_event",
            "steps": [
                {
                    "kind": "publish_event",
                    "name": "job.created",
                    "payload": {"job_id": {"literal": "j1"}},
                }
            ],
        }
        result = execute_plan(
            plan,
            self.ctx,
            {"tx": self.tx_mgr, "records": self.records, "actions": self.actions, "queries": self.queries, "outbox": self.outbox},
        )
        self.assertTrue(result["ok"])
        self.assertEqual(len(self.outbox.pending()), 1)
        self.assertTrue(self.tx_mgr.last_tx.committed)

    def test_var_resolution_with_returns(self) -> None:
        plan = {
            "action_id": "a",
            "type": "create_record",
            "steps": [
                {
                    "kind": "create_record",
                    "entity": "entity.note",
                    "values": {"note.text": {"literal": "hi"}},
                    "returns": {"as": "created", "fields": ["id"]},
                },
                {
                    "kind": "update_record",
                    "record_ref": {"entity": "entity.note", "id": {"var": "created.id"}},
                    "changes": {"note.text": {"literal": "bye"}},
                },
            ],
        }
        result = execute_plan(
            plan,
            self.ctx,
            {"tx": self.tx_mgr, "records": self.records, "actions": self.actions, "queries": self.queries, "outbox": self.outbox},
        )
        self.assertTrue(result["ok"])
        self.assertEqual(self.records.updated[0][1], "new1")

    def test_unresolved_var_rolls_back(self) -> None:
        plan = {
            "action_id": "a",
            "type": "update_record",
            "steps": [
                {
                    "kind": "update_record",
                    "record_ref": {"entity": "entity.job", "id": {"var": "missing.id"}},
                    "changes": {"job.status": {"literal": "closed"}},
                }
            ],
        }
        result = execute_plan(
            plan,
            self.ctx,
            {"tx": self.tx_mgr, "records": self.records, "actions": self.actions, "queries": self.queries, "outbox": self.outbox},
        )
        self.assertFalse(result["ok"])
        self.assertTrue(self.tx_mgr.last_tx.rolled_back)

    def test_nan_rejected(self) -> None:
        plan = {
            "action_id": "a",
            "type": "update_record",
            "steps": [
                {
                    "kind": "update_record",
                    "record_ref": {"entity": "entity.job", "id": {"var": "job.id"}},
                    "changes": {"job.status": {"literal": float("nan")}},
                }
            ],
        }
        result = execute_plan(
            plan,
            self.ctx,
            {"tx": self.tx_mgr, "records": self.records, "actions": self.actions, "queries": self.queries, "outbox": self.outbox},
        )
        self.assertFalse(result["ok"])

    def test_missing_return_fields_warning(self) -> None:
        plan = {
            "action_id": "a",
            "type": "create_record",
            "steps": [
                {
                    "kind": "create_record",
                    "entity": "entity.note",
                    "values": {"note.text": {"literal": "hi"}},
                    "returns": {"as": "created", "fields": ["id", "missing"]},
                }
            ],
        }
        result = execute_plan(
            plan,
            self.ctx,
            {"tx": self.tx_mgr, "records": self.records, "actions": self.actions, "queries": self.queries, "outbox": self.outbox},
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["warnings"][0]["code"], "EXEC_RETURN_FIELD_MISSING")


if __name__ == "__main__":
    unittest.main()
