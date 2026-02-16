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
from module_registry import ModuleRegistry


class TestModuleRegistry(unittest.TestCase):
    def setUp(self) -> None:
        self.store = ManifestStore()
        self.registry = ModuleRegistry(self.store)
        self.manifest = {"module": {"id": "m1"}, "entities": []}
        self.head = self.store.init_module("m1", self.manifest, actor={"id": "u1"})

    def _approved(self, from_hash=None):
        return {
            "patch": {
                "patch_id": "p1",
                "target_module_id": "m1",
                "target_manifest_hash": from_hash or self.head,
                "mode": "preview",
                "reason": "install",
                "metadata": None,
            },
            "preview": {
                "ok": True,
                "resolved_ops": [{"op": "add", "path": "/entities/0", "value": {"id": "entity.job"}}],
            },
            "approved_by": {"id": "u1", "roles": ["admin"]},
            "approved_at": "2026-01-29T01:23:45Z",
        }

    def test_install_auto_register(self) -> None:
        result = self.registry.install(self._approved())
        self.assertTrue(result["ok"])
        module = result["module"]
        self.assertTrue(module["enabled"])
        self.assertEqual(module["module_id"], "m1")
        self.assertEqual(module["status"], "installed")
        self.assertIsNotNone(module.get("active_version"))

    def test_upgrade_requires_module(self) -> None:
        result = self.registry.upgrade(self._approved())
        self.assertFalse(result["ok"])
        self.assertEqual(result["errors"][0]["code"], "MODULE_NOT_FOUND")

    def test_upgrade_updates_hash(self) -> None:
        install = self.registry.install(self._approved())
        self.assertTrue(install["ok"])
        first_hash = install["module"]["current_hash"]
        approved = self._approved(from_hash=first_hash)
        approved["preview"]["resolved_ops"] = [{"op": "add", "path": "/entities/1", "value": {"id": "entity.note"}}]
        result = self.registry.upgrade(approved)
        self.assertTrue(result["ok"])
        self.assertNotEqual(result["module"]["current_hash"], first_hash)
        self.assertNotEqual(result["module"]["active_version"], install["module"]["active_version"])

    def test_rollback_updates_current_hash(self) -> None:
        install = self.registry.install(self._approved())
        self.assertTrue(install["ok"])
        latest_hash = install["module"]["current_hash"]
        versions = self.registry.list_versions("m1")
        first_version = versions[0]
        rollback = self.registry.rollback("m1", self.head, actor={"id": "u1"}, reason="rollback", to_version_id=first_version["version_id"])
        self.assertTrue(rollback["ok"])
        module = self.registry.get("m1")
        self.assertEqual(module["current_hash"], first_version["manifest_hash"])
        history = self.registry.history("m1")
        self.assertEqual(history[0]["action"], "rollback")
        self.assertEqual(history[0]["from_hash"], latest_hash)

    def test_enable_disable(self) -> None:
        self.registry.install(self._approved())
        res = self.registry.set_enabled("m1", False, actor={"id": "u1"}, reason="disable")
        self.assertTrue(res["ok"])
        self.assertFalse(res["module"]["enabled"])
        res = self.registry.set_enabled("m1", True, actor={"id": "u1"}, reason="enable")
        self.assertTrue(res["ok"])
        self.assertTrue(res["module"]["enabled"])

    def test_history_newest_first(self) -> None:
        self.registry.install(self._approved())
        self.registry.set_enabled("m1", False, actor={"id": "u1"}, reason="disable")
        history = self.registry.history("m1")
        self.assertEqual(history[0]["action"], "disable")
        self.assertEqual(history[1]["action"], "install")

    def test_install_propagates_store_failure(self) -> None:
        approved = self._approved(from_hash="sha256:bad")
        result = self.registry.install(approved)
        self.assertFalse(result["ok"])
        self.assertIsNone(self.registry.get("m1"))

    def test_module_id_mismatch(self) -> None:
        approved = self._approved()
        approved["patch"]["target_module_id"] = "m2"
        result = self.registry.install(approved)
        self.assertFalse(result["ok"])

    def test_deep_copy_immutability(self) -> None:
        self.registry.install(self._approved())
        module = self.registry.get("m1")
        module["enabled"] = False
        fresh = self.registry.get("m1")
        self.assertTrue(fresh["enabled"])


if __name__ == "__main__":
    unittest.main()
