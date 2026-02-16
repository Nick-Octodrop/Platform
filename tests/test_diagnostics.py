import unittest

from manifest_store import ManifestStore
from module_registry import ModuleRegistry
from app.diagnostics import build_diagnostics


class TestDiagnostics(unittest.TestCase):
    def test_build_diagnostics_includes_home(self) -> None:
        store = ManifestStore()
        registry = ModuleRegistry(store)
        manifest = {
            "manifest_version": "1.0",
            "module": {"id": "diag", "version": "1.0.0"},
            "entities": [
                {"id": "entity.item", "fields": [{"id": "item.name", "type": "string"}]}
            ],
            "views": [
                {"id": "item.list", "entity": "item", "kind": "list", "columns": [{"field_id": "item.name"}]}
            ],
            "app": {"home": "view:item.list"},
            "pages": [],
        }
        store.init_module("diag", manifest)
        registry.register("diag", "Diag", actor=None)
        registry.set_enabled("diag", True, actor=None, reason="test")

        data = build_diagnostics(registry, lambda mid, h: store.get_snapshot(mid, h))
        modules = data["modules"]
        self.assertEqual(len(modules), 1)
        mod = modules[0]
        self.assertEqual(mod["module_id"], "diag")
        self.assertTrue(mod["has_app_home"])
        self.assertEqual(mod["home_type"], "view")
        self.assertEqual(mod["home_id"], "item.list")
        self.assertEqual(mod["counts"]["views"], 1)
        self.assertEqual(mod["counts"]["entities"], 1)


if __name__ == "__main__":
    unittest.main()
