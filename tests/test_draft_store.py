import unittest

from app.stores import MemoryDraftStore


class TestDraftStore(unittest.TestCase):
    def setUp(self) -> None:
        self.store = MemoryDraftStore()

    def test_create_and_list_draft(self) -> None:
        saved = self.store.upsert_draft("mod1", {"module": {"id": "mod1"}}, updated_by="user1", base_snapshot_id=None)
        self.assertEqual(saved["module_id"], "mod1")
        self.assertIsNotNone(saved.get("created_at"))
        items = self.store.list_drafts()
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["module_id"], "mod1")

    def test_update_keeps_created_at_and_base_snapshot(self) -> None:
        first = self.store.upsert_draft("mod2", {"module": {"id": "mod2"}}, updated_by="user1", base_snapshot_id="sha256:base")
        second = self.store.upsert_draft("mod2", {"module": {"id": "mod2"}, "entities": []}, updated_by="user2", base_snapshot_id=None)
        self.assertEqual(first["created_at"], second["created_at"])
        self.assertEqual(second.get("base_snapshot_id"), "sha256:base")

    def test_delete_draft(self) -> None:
        self.store.upsert_draft("mod3", {"module": {"id": "mod3"}}, updated_by="user1", base_snapshot_id=None)
        deleted = self.store.delete_draft("mod3")
        self.assertTrue(deleted)
        self.assertIsNone(self.store.get_draft("mod3"))


if __name__ == "__main__":
    unittest.main()
