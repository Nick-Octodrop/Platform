import os
import sys
import unittest


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "src")
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
if SRC not in sys.path:
    sys.path.insert(0, SRC)

from manifest_store import ManifestStore
from octo.manifest_hash import manifest_hash


class TestManifestStore(unittest.TestCase):
    def setUp(self) -> None:
        self.store = ManifestStore()
        self.manifest = {"module": {"id": "m1"}, "entities": []}
        self.head = self.store.init_module("m1", self.manifest, actor={"id": "u1"})

    def _approved_preview(self, ops) -> dict:
        return {
            "patch": {
                "patch_id": "p1",
                "target_module_id": "m1",
                "target_manifest_hash": self.head,
                "mode": "preview",
                "reason": "test",
                "metadata": None,
            },
            "preview": {
                "ok": True,
                "resolved_ops": ops,
            },
            "approved_by": {"id": "u1", "roles": ["admin"]},
            "approved_at": "2026-01-29T01:23:45Z",
        }

    def test_init_sets_head(self) -> None:
        self.assertEqual(self.store.get_head("m1"), self.head)

    def test_apply_success(self) -> None:
        approved = self._approved_preview([
            {"op": "add", "path": "/entities/0", "value": {"id": "entity.job"}}
        ])
        result = self.store.apply_approved_preview(approved)
        self.assertTrue(result["ok"])
        self.assertNotEqual(result["to_hash"], self.head)

    def test_apply_hash_mismatch(self) -> None:
        approved = self._approved_preview([])
        approved["patch"]["target_manifest_hash"] = "sha256:bad"
        result = self.store.apply_approved_preview(approved)
        self.assertFalse(result["ok"])

    def test_apply_audit_record(self) -> None:
        approved = self._approved_preview([
            {"op": "add", "path": "/entities/0", "value": {"id": "entity.job"}}
        ])
        result = self.store.apply_approved_preview(approved)
        history = self.store.list_history("m1")
        self.assertEqual(history[0]["action"], "apply")
        self.assertEqual(history[0]["audit_id"], result["audit_id"])

    def test_rollback(self) -> None:
        approved = self._approved_preview([
            {"op": "add", "path": "/entities/0", "value": {"id": "entity.job"}}
        ])
        result = self.store.apply_approved_preview(approved)
        new_hash = result["to_hash"]
        rb = self.store.rollback("m1", self.head, actor={"id": "u1"}, reason="rollback")
        self.assertTrue(rb["ok"])
        self.assertEqual(self.store.get_head("m1"), self.head)
        history = self.store.list_history("m1")
        self.assertEqual(history[0]["action"], "rollback")
        self.assertEqual(history[0]["from_hash"], new_hash)

    def test_get_snapshot_returns_copy(self) -> None:
        snap = self.store.get_snapshot("m1", self.head)
        snap["module"]["id"] = "mutated"
        fresh = self.store.get_snapshot("m1", self.head)
        self.assertEqual(fresh["module"]["id"], "m1")

    def test_history_newest_first(self) -> None:
        approved = self._approved_preview([
            {"op": "add", "path": "/entities/0", "value": {"id": "entity.job"}}
        ])
        self.store.apply_approved_preview(approved)
        self.store.rollback("m1", self.head, actor={"id": "u1"}, reason="rollback")
        history = self.store.list_history("m1")
        self.assertEqual(history[0]["action"], "rollback")
        self.assertEqual(history[1]["action"], "apply")

    def test_apply_manifest_changes_hash(self) -> None:
        approved = self._approved_preview([
            {"op": "add", "path": "/entities/0", "value": {"id": "entity.job"}}
        ])
        result = self.store.apply_approved_preview(approved)
        self.assertNotEqual(result["to_hash"], self.head)
        snapshot = self.store.get_snapshot("m1", result["to_hash"])
        self.assertEqual(snapshot["entities"][0]["id"], "entity.job")


if __name__ == "__main__":
    unittest.main()
