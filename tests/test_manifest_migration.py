import unittest

from app.manifest_normalize import normalize_manifest


class TestManifestMigration(unittest.TestCase):
    def test_v1_fields_migrate_to_columns_and_sections(self) -> None:
        manifest = {
            "manifest_version": "1.0",
            "module_id": "legacy",
            "name": "Legacy",
            "entities": [{"id": "item", "fields": [{"id": "item.name", "type": "string"}]}],
            "views": [
                {"id": "item.list", "type": "list", "entity": "item", "fields": ["item.name"]},
                {"id": "item.form", "type": "form", "entity": "item", "fields": ["item.name"]},
            ],
            "pages": [],
        }
        normalized = normalize_manifest(manifest)
        self.assertEqual(normalized["module"]["id"], "legacy")
        list_view = normalized["views"][0]
        form_view = normalized["views"][1]
        self.assertEqual(list_view.get("kind"), "list")
        self.assertEqual(list_view.get("columns"), [{"field_id": "item.name"}])
        self.assertEqual(form_view.get("kind"), "form")
        self.assertEqual(form_view.get("sections")[0]["fields"], ["item.name"])
        self.assertEqual(list_view.get("entity"), "item")
        self.assertEqual(form_view.get("entity"), "item")


if __name__ == "__main__":
    unittest.main()
