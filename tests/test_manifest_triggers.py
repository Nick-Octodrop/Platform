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
        "actions": [
            {"id": "action.refresh", "kind": "refresh", "label": "Refresh"},
            {"id": "action.open", "kind": "open_form", "label": "Open", "target": "work.form"},
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
            },
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
    }


class TestManifestTriggers(unittest.TestCase):
    def test_trigger_valid(self):
        manifest = base_manifest()
        manifest["triggers"] = [
            {"id": "t1", "event": "record.created", "entity_id": "entity.work_item"},
            {"id": "t2", "event": "action.clicked", "action_id": "action.refresh"},
            {"id": "t3", "event": "workflow.status_changed", "entity_id": "entity.work_item", "status_field": "work.status"},
        ]
        errors, _ = validate_manifest(manifest)
        self.assertEqual(errors, [])

    def test_trigger_requires_id(self):
        manifest = base_manifest()
        manifest["triggers"] = [{"event": "record.created", "entity_id": "entity.work_item"}]
        errors, _ = validate_manifest(manifest)
        self.assertTrue(any(e["code"] == "MANIFEST_TRIGGER_ID_INVALID" for e in errors))

    def test_trigger_requires_known_event(self):
        manifest = base_manifest()
        manifest["triggers"] = [{"id": "t1", "event": "record.deleted", "entity_id": "entity.work_item"}]
        errors, _ = validate_manifest(manifest)
        self.assertTrue(any(e["code"] == "MANIFEST_TRIGGER_EVENT_INVALID" for e in errors))

    def test_trigger_unknown_entity(self):
        manifest = base_manifest()
        manifest["triggers"] = [{"id": "t1", "event": "record.updated", "entity_id": "entity.missing"}]
        errors, _ = validate_manifest(manifest)
        self.assertTrue(any(e["code"] == "MANIFEST_TRIGGER_ENTITY_UNKNOWN" for e in errors))

    def test_trigger_unknown_action(self):
        manifest = base_manifest()
        manifest["triggers"] = [{"id": "t1", "event": "action.clicked", "action_id": "action.missing"}]
        errors, _ = validate_manifest(manifest)
        self.assertTrue(any(e["code"] == "MANIFEST_TRIGGER_ACTION_UNKNOWN" for e in errors))


if __name__ == "__main__":
    unittest.main()
