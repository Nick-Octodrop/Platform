import unittest

from app.manifest_validate import validate_manifest_raw


class TestManifestV1Validation(unittest.TestCase):
    def test_valid_v1_targets(self) -> None:
        manifest = {
            "manifest_version": "1.0",
            "module": {"id": "m1", "name": "M1"},
            "entities": [
                {
                    "id": "entity.item",
                    "fields": [
                        {"id": "item.id", "type": "uuid"},
                        {"id": "item.name", "type": "string", "required": True},
                    ],
                }
            ],
            "views": [
                {"id": "item.list", "entity": "item", "kind": "list", "columns": [{"field_id": "item.name"}]},
                {"id": "item.form", "entity": "item", "kind": "form", "sections": [{"id": "main", "fields": ["item.name"]}]},
            ],
            "app": {
                "home": "page:home",
                "nav": [
                    {"group": "Main", "items": [{"label": "Home", "to": "page:home"}, {"label": "Items", "to": "view:item.list"}]}
                ],
            },
            "pages": [
                {
                    "id": "home",
                    "layout": "single",
                    "header": {
                        "actions": [
                            {"kind": "refresh", "label": "Refresh"},
                            {"kind": "open_form", "label": "New", "target": "item.form"},
                            {"kind": "navigate", "label": "All", "target": "view:item.list"},
                        ]
                    },
                    "content": [{"kind": "view", "target": "item.list"}],
                }
            ],
        }
        normalized, errors, warnings = validate_manifest_raw(manifest, expected_module_id="m1")
        self.assertEqual(errors, [])

    def test_invalid_targets(self) -> None:
        manifest = {
            "manifest_version": "1.0",
            "module": {"id": "m1", "name": "M1"},
            "entities": [{"id": "entity.item", "fields": [{"id": "item.name", "type": "string"}]}],
            "views": [{"id": "item.list", "entity": "item", "kind": "list", "columns": [{"field_id": "item.name"}]}],
            "app": {"home": "page:missing", "nav": [{"group": "Main", "items": [{"label": "Bad", "to": "view:missing"}]}]},
            "pages": [{"id": "home", "content": [{"kind": "view", "target": "missing.view"}]}],
        }
        _, errors, _ = validate_manifest_raw(manifest, expected_module_id="m1")
        self.assertTrue(any(err["code"] == "MANIFEST_TARGET_UNKNOWN" for err in errors))

    def test_unknown_keys_rejected(self) -> None:
        manifest = {
            "manifest_version": "1.0",
            "module": {"id": "m1", "name": "M1"},
            "entities": [],
            "views": [],
            "app": {"home": "page:home"},
            "pages": [],
            "extra": "nope",
        }
        _, errors, _ = validate_manifest_raw(manifest, expected_module_id="m1")
        self.assertTrue(any(err["code"] == "MANIFEST_UNKNOWN_KEY" for err in errors))

    def test_version_required_for_app_pages(self) -> None:
        manifest = {
            "module": {"id": "m1", "name": "M1"},
            "entities": [],
            "views": [],
            "app": {"home": "page:home"},
            "pages": [],
        }
        _, errors, _ = validate_manifest_raw(manifest, expected_module_id="m1")
        self.assertTrue(any(err["code"] == "MANIFEST_VERSION_REQUIRED" for err in errors))


if __name__ == "__main__":
    unittest.main()
