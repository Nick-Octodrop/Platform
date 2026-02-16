import os
import sys
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "src")
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
if SRC not in sys.path:
    sys.path.insert(0, SRC)

from app.manifest_validate import validate_manifest
from app.records_validation import validate_record_payload


def base_manifest():
    return {
        "manifest_version": "1.2",
        "module": {"id": "test_mod", "name": "Test"},
        "entities": [
            {
                "id": "entity.test",
                "fields": [
                    {"id": "test.id", "type": "uuid", "label": "ID", "readonly": True},
                    {"id": "test.status", "type": "enum", "label": "Status", "options": [{"label": "Open", "value": "open"}, {"label": "Done", "value": "done"}]},
                    {"id": "test.note", "type": "text", "label": "Note"},
                ],
                "display_field": "test.status",
            }
        ],
        "views": [
            {"id": "test.list", "entity": "entity.test", "kind": "list", "columns": [{"field_id": "test.status"}]},
            {"id": "test.form", "entity": "entity.test", "kind": "form", "sections": [{"id": "main", "fields": ["test.status", "test.note"]}]},
        ],
        "app": {
            "home": "page:home",
            "nav": [{"group": "Test", "items": [{"label": "Home", "to": "page:home"}]}],
        },
        "pages": [
            {"id": "home", "title": "Home", "layout": "single", "content": [{"kind": "view", "target": "test.list"}]},
        ],
        "actions": [
            {"id": "action.refresh", "kind": "refresh", "label": "Refresh"},
        ],
    }


class TestManifestV12(unittest.TestCase):
    def test_required_when_valid(self):
        manifest = base_manifest()
        manifest["entities"][0]["fields"].append(
            {
                "id": "test.conditional",
                "type": "string",
                "label": "Conditional",
                "required_when": {"op": "eq", "field": "test.status", "value": "done"},
            }
        )
        errors, warnings = validate_manifest(manifest)
        self.assertEqual(errors, [])

    def test_required_when_requires_v12(self):
        manifest = base_manifest()
        manifest["manifest_version"] = "1.1"
        manifest["entities"][0]["fields"].append(
            {"id": "test.conditional", "type": "string", "required_when": {"op": "eq", "field": "test.status", "value": "done"}}
        )
        errors, _ = validate_manifest(manifest)
        self.assertTrue(any(e["code"] == "MANIFEST_FIELD_CONDITION_INVALID" for e in errors))

    def test_action_reference(self):
        manifest = base_manifest()
        manifest["pages"][0]["header"] = {"actions": [{"action_id": "action.refresh"}]}
        errors, _ = validate_manifest(manifest)
        self.assertEqual(errors, [])

    def test_chatter_block(self):
        manifest = base_manifest()
        manifest["pages"][0]["content"].append(
            {"kind": "chatter", "entity_id": "entity.test", "record_ref": "$record.id"}
        )
        errors, _ = validate_manifest(manifest)
        self.assertEqual(errors, [])

    def test_required_when_enforced(self):
        entity = base_manifest()["entities"][0]
        entity["fields"].append(
            {
                "id": "test.conditional",
                "type": "string",
                "required_when": {"op": "eq", "field": "test.status", "value": "done"},
            }
        )
        errors, _ = validate_record_payload(entity, {"test.status": "done"}, for_create=True)
        self.assertTrue(any(e["code"] == "REQUIRED_FIELD" for e in errors))


if __name__ == "__main__":
    unittest.main()
