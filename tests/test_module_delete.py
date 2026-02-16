import unittest

from manifest_store import ManifestStore
from module_registry import ModuleRegistry
from app.stores import MemoryGenericRecordStore, MemoryDraftStore
from app.module_delete import delete_module_memory


class TestModuleDelete(unittest.TestCase):
    def setUp(self) -> None:
        self.store = ManifestStore()
        self.registry = ModuleRegistry(self.store)
        self.generic_records = MemoryGenericRecordStore()
        self.drafts = MemoryDraftStore()

    def _manifest(self, module_id: str) -> dict:
        return {
            "manifest_version": "1.0",
            "module": {"id": module_id, "name": module_id},
            "entities": [
                {"id": "entity.item", "fields": [{"id": "item.name", "type": "string"}]}
            ],
            "views": [
                {"id": "item.list", "entity": "item", "kind": "list", "columns": [{"field_id": "item.name"}]}
            ],
            "app": {"home": "view:item.list"},
            "pages": [],
        }

    def test_install_into_empty_registry(self) -> None:
        self.store.init_module("mod1", self._manifest("mod1"))
        result = self.registry.register("mod1", "mod1", actor=None)
        self.assertTrue(result.get("ok"))
        enable = self.registry.set_enabled("mod1", True, actor=None, reason="test")
        self.assertTrue(enable.get("ok"))
        self.assertIsNotNone(self.registry.get("mod1"))

    def test_delete_module_clears_records(self) -> None:
        self.store.init_module("mod2", self._manifest("mod2"))
        self.registry.register("mod2", "mod2", actor=None)
        self.registry.set_enabled("mod2", True, actor=None, reason="test")
        self.drafts.upsert_draft("mod2", {"module": {"id": "mod2"}}, updated_by="user1", base_snapshot_id=None)
        self.generic_records.create("item", {"item.name": "Hello"})
        self.assertEqual(len(self.generic_records.list("item")), 1)

        result = delete_module_memory("mod2", self.registry, self.store, self.generic_records, drafts=self.drafts, actor=None, reason="delete", force=True)
        self.assertTrue(result.get("ok"))
        record = self.registry.get("mod2")
        self.assertIsNotNone(record)
        self.assertTrue(record.get("archived"))
        self.assertFalse(record.get("enabled"))
        self.assertEqual(len(self.generic_records.list("item")), 0)
        self.assertIsNone(self.drafts.get_draft("mod2"))


if __name__ == "__main__":
    unittest.main()
