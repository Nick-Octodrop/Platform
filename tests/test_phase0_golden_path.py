import os
import sys
import unittest


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "src")
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
if SRC not in sys.path:
    sys.path.insert(0, SRC)

os.environ["USE_DB"] = "0"
os.environ["OCTO_DISABLE_AUTH"] = "1"
os.environ["SUPABASE_URL"] = "http://localhost"

from manifest_store import ManifestStore
from module_registry import ModuleRegistry
from app.module_delete import delete_module_memory
from app.stores import MemoryGenericRecordStore
from app import main


class TestPhase0GoldenPath(unittest.TestCase):
    def setUp(self) -> None:
        self.store = ManifestStore()
        self.registry = ModuleRegistry(self.store)
        self.records = MemoryGenericRecordStore()

    def _manifest_v1(self) -> dict:
        return {
            "manifest_version": "1.3",
            "module": {"id": "m1", "name": "Projects"},
            "app": {
                "home": "page:project.list_page",
                "defaults": {
                    "entities": {
                        "entity.project": {
                            "entity_home_page": "page:project.list_page",
                            "entity_form_page": "page:project.form_page",
                        }
                    }
                },
            },
            "entities": [
                {
                    "id": "entity.project",
                    "display_field": "project.name",
                    "fields": [
                        {"id": "project.name", "type": "string", "label": "Name", "required": True},
                    ],
                }
            ],
            "actions": [
                {"id": "action.project_new", "kind": "create_record", "label": "New", "entity_id": "entity.project"}
            ],
            "views": [
                {
                    "id": "project.list",
                    "kind": "list",
                    "entity": "entity.project",
                    "columns": [{"field_id": "project.name"}],
                    "header": {"primary_actions": [{"action_id": "action.project_new"}]},
                    "open_record": {"to": "page:project.form_page", "param": "record"},
                },
                {
                    "id": "project.form",
                    "kind": "form",
                    "entity": "entity.project",
                    "sections": [{"id": "main", "title": "Main", "fields": ["project.name"]}],
                },
            ],
            "pages": [
                {
                    "id": "project.list_page",
                    "title": "Projects",
                    "layout": "single",
                    "content": [{"kind": "view", "target": "view:project.list"}],
                },
                {
                    "id": "project.form_page",
                    "title": "Project",
                    "layout": "single",
                    "content": [{"kind": "view", "target": "view:project.form"}],
                },
            ],
        }

    def _approved(self, from_hash: str, resolved_ops: list[dict]) -> dict:
        return {
            "patch": {
                "patch_id": "p1",
                "target_module_id": "m1",
                "target_manifest_hash": from_hash,
                "mode": "preview",
                "reason": "install",
                "metadata": None,
            },
            "preview": {"ok": True, "resolved_ops": resolved_ops},
            "approved_by": {"id": "u1", "roles": ["admin"]},
            "approved_at": "2026-02-08T00:00:00Z",
        }

    def test_golden_path_install_upgrade_rollback_delete(self) -> None:
        manifest_v1 = self._manifest_v1()
        head = self.store.init_module("m1", manifest_v1, actor={"id": "u1"})

        # "New" should normalize to open_form (required field with no defaults).
        normalized, _ = main.normalize_manifest_v13(manifest_v1, module_id="m1", cache={})
        action = next((a for a in normalized.get("actions", []) if a.get("id") == "action.project_new"), None)
        self.assertIsNotNone(action)
        self.assertEqual(action.get("kind"), "open_form")

        install = self.registry.install(self._approved(head, []))
        self.assertTrue(install["ok"])
        module = install["module"]
        self.assertTrue(module["enabled"])

        # Save creates a record.
        created = self.records.create("entity.project", {"project.name": "Alpha"})
        self.assertIsNotNone(created.get("id"))

        # Upgrade to v2 (add field + column).
        upgrade_ops = [
            {"op": "add", "path": "/entities/0/fields/-", "value": {"id": "project.code", "type": "string", "label": "Code"}},
            {"op": "add", "path": "/views/0/columns/-", "value": {"field_id": "project.code"}},
        ]
        upgrade = self.registry.upgrade(self._approved(module["current_hash"], upgrade_ops))
        self.assertTrue(upgrade["ok"])

        versions = self.registry.list_versions("m1")
        self.assertEqual(len(versions), 2)

        # Rollback to v1.
        rollback = self.registry.rollback("m1", head, actor={"id": "u1"}, reason="rollback", to_version_num=1)
        self.assertTrue(rollback["ok"])

        # Delete blocked when records exist.
        blocked = delete_module_memory("m1", self.registry, self.store, self.records, actor={"id": "u1"}, reason="delete")
        self.assertFalse(blocked["ok"])
        self.assertEqual(blocked["errors"][0]["code"], "MODULE_HAS_RECORDS")

        archived = delete_module_memory("m1", self.registry, self.store, self.records, actor={"id": "u1"}, reason="archive", archive=True)
        self.assertTrue(archived["ok"])
        record = self.registry.get("m1")
        self.assertTrue(record.get("archived"))
        self.assertFalse(record.get("enabled"))


if __name__ == "__main__":
    unittest.main()
