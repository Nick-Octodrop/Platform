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
from app.manifest_normalize import normalize_manifest


def base_manifest():
    return {
        "manifest_version": "1.3",
        "module": {"id": "work", "name": "Work"},
        "entities": [
            {
                "id": "entity.work_item",
                "fields": [
                    {"id": "work.status", "type": "enum", "options": [{"label": "Open", "value": "open"}]},
                    {"id": "work.title", "type": "string"},
                ],
            }
        ],
        "views": [
            {
                "id": "work.list",
                "kind": "list",
                "entity": "work_item",
                "columns": [{"field_id": "work.title"}],
            },
            {
                "id": "work.form",
                "kind": "form",
                "entity": "work_item",
                "sections": [{"id": "main", "fields": ["work.title"]}],
            }
        ],
        "app": {"home": "page:home", "nav": [{"group": "Main", "items": [{"label": "Home", "to": "page:home"}]}]},
        "pages": [
            {
                "id": "home",
                "title": "Home",
                "layout": "single",
                "content": [
                    {
                        "kind": "record",
                        "entity_id": "entity.work_item",
                        "record_id_query": "record",
                        "content": [
                            {"kind": "statusbar", "field_id": "work.status"},
                            {"kind": "view", "target": "work.form"},
                        ],
                    }
                ],
            }
        ],
        "actions": [],
    }


class TestManifestV13(unittest.TestCase):
    def test_view_entity_normalized(self):
        manifest = base_manifest()
        normalized = normalize_manifest(manifest)
        view = normalized["views"][0]
        self.assertEqual(view["entity"], "entity.work_item")

    def test_enum_options_normalized_from_strings(self):
        manifest = base_manifest()
        manifest["entities"][0]["fields"][0]["options"] = ["open", "done"]
        normalized = normalize_manifest(manifest)
        options = normalized["entities"][0]["fields"][0]["options"]
        self.assertEqual(options, [{"value": "open", "label": "Open"}, {"value": "done", "label": "Done"}])

    def test_statusbar_enum_validation(self):
        manifest = base_manifest()
        errors, _ = validate_manifest(manifest)
        self.assertEqual(errors, [])

    def test_enum_options_shape_invalid(self):
        manifest = base_manifest()
        manifest["entities"][0]["fields"][0]["options"] = ["open", "done"]
        errors, _ = validate_manifest(manifest)
        self.assertTrue(any(e["code"] == "MANIFEST_ENUM_OPTIONS_SHAPE_INVALID" for e in errors))

    def test_statusbar_header_requires_enum(self):
        manifest = base_manifest()
        manifest["entities"][0]["fields"][0]["type"] = "string"
        manifest["views"][1]["header"] = {"statusbar": {"field_id": "work.status"}}
        errors, _ = validate_manifest(manifest)
        self.assertTrue(any(e["code"] == "MANIFEST_VIEW_HEADER_INVALID" for e in errors))

    def test_view_header_search_fields_must_exist(self):
        manifest = base_manifest()
        manifest["views"][0]["header"] = {
            "search": {"enabled": True, "fields": ["work.missing"]},
            "primary_actions": [{"kind": "refresh"}],
        }
        errors, _ = validate_manifest(manifest)
        self.assertTrue(any(e["code"] == "MANIFEST_VIEW_FIELD_UNKNOWN" for e in errors))

    def test_view_header_bulk_actions_only_list(self):
        manifest = base_manifest()
        manifest["actions"] = [{"id": "action.bulk", "kind": "bulk_update", "entity_id": "entity.work_item", "patch": {"work.status": "open"}}]
        manifest["views"][1]["header"] = {
            "bulk_actions": [{"action_id": "action.bulk"}]
        }
        errors, _ = validate_manifest(manifest)
        self.assertTrue(any(e["code"] == "MANIFEST_VIEW_HEADER_INVALID" for e in errors))

    def test_view_create_behavior_invalid(self):
        manifest = base_manifest()
        manifest["views"][0]["create_behavior"] = "instant"
        errors, _ = validate_manifest(manifest)
        self.assertTrue(any(e["code"] == "MANIFEST_VIEW_CREATE_BEHAVIOR_INVALID" for e in errors))


if __name__ == "__main__":
    unittest.main()
