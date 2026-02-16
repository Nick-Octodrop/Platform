import unittest

from manifest_store import ManifestStore
from module_registry import ModuleRegistry
from app.manifest_validate import validate_manifest_raw
from app.records_validation import validate_record_payload, validate_lookup_fields


class TestDefaultsAndLookup(unittest.TestCase):
    def test_field_default_type_validation(self) -> None:
        manifest = {
            "manifest_version": "1.0",
            "module": {"id": "m1"},
            "entities": [
                {
                    "id": "entity.item",
                    "fields": [
                        {"id": "item.name", "type": "string", "default": 123}
                    ],
                }
            ],
            "views": [
                {"id": "item.list", "entity": "item", "kind": "list", "columns": [{"field_id": "item.name"}]}
            ],
        }
        _, errors, _ = validate_manifest_raw(manifest, expected_module_id="m1")
        self.assertTrue(any(err["code"] == "MANIFEST_FIELD_DEFAULT_INVALID" for err in errors))

    def test_required_readonly_requires_default(self) -> None:
        manifest = {
            "manifest_version": "1.0",
            "module": {"id": "m1"},
            "entities": [
                {
                    "id": "entity.item",
                    "fields": [
                        {"id": "item.status", "type": "string", "required": True, "readonly": True}
                    ],
                }
            ],
            "views": [
                {"id": "item.list", "entity": "item", "kind": "list", "columns": [{"field_id": "item.status"}]}
            ],
        }
        _, errors, _ = validate_manifest_raw(manifest, expected_module_id="m1")
        self.assertTrue(any(err["code"] == "MANIFEST_FIELD_REQUIRED_READONLY_INVALID" for err in errors))

    def test_default_applied_on_create(self) -> None:
        entity = {
            "id": "entity.item",
            "fields": [
                {"id": "item.name", "type": "string", "required": True, "default": "hello"}
            ],
        }
        errors, clean = validate_record_payload(entity, {}, for_create=True)
        self.assertEqual(errors, [])
        self.assertEqual(clean["item.name"], "hello")

    def test_lookup_manifest_shape(self) -> None:
        manifest = {
            "manifest_version": "1.0",
            "module": {"id": "m1"},
            "entities": [
                {
                    "id": "entity.child",
                    "fields": [
                        {"id": "child.parent_id", "type": "lookup"}
                    ],
                },
                {
                    "id": "entity.parent",
                    "fields": [
                        {"id": "parent.name", "type": "string"}
                    ],
                },
            ],
            "views": [
                {"id": "child.list", "entity": "child", "kind": "list", "columns": [{"field_id": "child.parent_id"}]}
            ],
        }
        _, errors, _ = validate_manifest_raw(manifest, expected_module_id="m1")
        self.assertTrue(any(err["code"].startswith("MANIFEST_LOOKUP") for err in errors))

    def test_lookup_validation_requires_target_enabled(self) -> None:
        store = ManifestStore()
        registry = ModuleRegistry(store)
        manifest = {
            "manifest_version": "1.0",
            "module": {"id": "mod"},
            "entities": [
                {
                    "id": "entity.child",
                    "fields": [
                        {
                            "id": "child.parent_id",
                            "type": "lookup",
                            "entity": "entity.parent",
                            "display_field": "parent.name",
                        }
                    ],
                }
            ],
            "views": [
                {"id": "child.list", "entity": "child", "kind": "list", "columns": [{"field_id": "child.parent_id"}]}
            ],
        }
        store.init_module("mod", manifest)
        registry.register("mod", "Mod", actor=None)
        registry.set_enabled("mod", True, actor=None, reason="test")

        errors = validate_lookup_fields(manifest["entities"][0], registry, lambda mid, h: store.get_snapshot(mid, h))
        self.assertTrue(any(err["code"] == "LOOKUP_TARGET_UNKNOWN" for err in errors))

    def test_lookup_record_type(self) -> None:
        entity = {
            "id": "entity.child",
            "fields": [
                {
                    "id": "child.parent_id",
                    "type": "lookup",
                    "entity": "entity.parent",
                    "display_field": "parent.name",
                }
            ],
        }
        errors, _ = validate_record_payload(entity, {"child.parent_id": 123}, for_create=True)
        self.assertTrue(any(err["code"] == "TYPE_MISMATCH" for err in errors))
        errors_ok, _ = validate_record_payload(entity, {"child.parent_id": "abc"}, for_create=True)
        self.assertEqual(errors_ok, [])


if __name__ == "__main__":
    unittest.main()
