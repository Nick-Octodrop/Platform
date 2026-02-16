import os
import sys
import unittest
import json

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "src")
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
if SRC not in sys.path:
    sys.path.insert(0, SRC)

os.environ["USE_DB"] = "0"
os.environ["OCTO_DISABLE_AUTH"] = "1"
os.environ["SUPABASE_URL"] = "http://localhost"

from app import main


def base_manifest():
    return {
        "manifest_version": "1.3",
        "module": {"id": "task", "name": "Task"},
        "app": {
            "home": "page:task.list_page",
            "nav": [{"group": "Main", "items": [{"label": "Tasks", "to": "page:task.list_page"}]}],
            "defaults": {
                "entities": {
                    "entity.task": {
                        "entity_home_page": "page:task.list_page",
                        "entity_form_page": "page:task.form_page",
                    }
                }
            },
        },
        "entities": [
            {
                "id": "entity.task",
                "label": "Task",
                "display_field": "task.name",
                "fields": [
                    {"id": "task.name", "type": "string", "label": "Name"},
                    {"id": "task.status", "type": "enum", "label": "Status"},
                ],
            }
        ],
        "views": [
            {
                "id": "task.list",
                "kind": "list",
                "entity": "entity.task",
                "columns": [{"field_id": "task.name"}],
                "open_record": {"to": "page:task.form_page", "param": "record"},
            },
            {
                "id": "task.form",
                "kind": "form",
                "entity": "entity.task",
                "sections": [
                    {"id": "main", "title": "Main", "fields": ["task.name"]},
                    {"id": "notes", "title": "Notes", "fields": ["task.name"]},
                ],
            },
        ],
        "pages": [
            {"id": "task.list_page", "title": "Tasks", "layout": "single", "content": [{"kind": "view", "target": "task.list"}]},
            {"id": "task.form_page", "title": "Task", "layout": "single", "content": [{"kind": "view", "target": "task.form"}]},
        ],
        "actions": [],
        "workflows": [
            {
                "entity": "entity.task",
                "status_field": "task.status",
                "states": ["draft", "done"],
            }
        ],
    }


class TestStudio2Normalize(unittest.TestCase):
    def test_enum_backfill_from_workflow(self):
        manifest = base_manifest()
        normalized, warnings = main.normalize_manifest_v13(manifest, module_id="task", cache={})
        field = normalized["entities"][0]["fields"][1]
        self.assertEqual(
            field.get("options"),
            [{"value": "draft", "label": "Draft"}, {"value": "done", "label": "Done"}],
        )
        self.assertTrue(any(w["code"] == "NORMALIZED_ENUM_OPTIONS" for w in warnings))

    def test_reachability_open_record_and_defaults(self):
        manifest = base_manifest()
        issues = main._studio2_completeness_check(manifest)
        orphan_pages = [i for i in issues if i.get("code") == "INCOMPLETE_ORPHAN_PAGE"]
        self.assertEqual(orphan_pages, [])

    def test_view_header_defaults(self):
        manifest = base_manifest()
        # strip headers to force normalization
        for view in manifest["views"]:
            if "header" in view:
                del view["header"]
        normalized, warnings = main.normalize_manifest_v13(manifest, module_id="task", cache={})
        list_view = normalized["views"][0]
        form_view = normalized["views"][1]
        self.assertIn("search", list_view.get("header", {}))
        self.assertIn("primary_actions", list_view.get("header", {}))
        self.assertIn("title_field", form_view.get("header", {}))
        self.assertIn("statusbar", form_view.get("header", {}))
        self.assertIn("tabs", form_view.get("header", {}))
        self.assertTrue(any(w["code"] == "NORMALIZED_VIEW_HEADER" for w in warnings))

    def test_normalize_idempotent(self):
        manifest = base_manifest()
        normalized1, _ = main.normalize_manifest_v13(manifest, module_id="task", cache={})
        normalized2, _ = main.normalize_manifest_v13(normalized1, module_id="task", cache={})
        self.assertEqual(json.dumps(normalized1, sort_keys=True), json.dumps(normalized2, sort_keys=True))

    def test_enum_string_list_to_object(self):
        manifest = base_manifest()
        manifest["entities"][0]["fields"][1]["options"] = ["draft", "done"]
        normalized, _ = main.normalize_manifest_v13(manifest, module_id="task", cache={})
        field = normalized["entities"][0]["fields"][1]
        self.assertEqual(
            field.get("options"),
            [{"value": "draft", "label": "Draft"}, {"value": "done", "label": "Done"}],
        )

    def test_list_primary_action_open_form_when_required_missing(self):
        manifest = base_manifest()
        manifest["entities"][0]["fields"][0]["required"] = True
        manifest["actions"] = [
            {"id": "action.task_new", "kind": "create_record", "label": "New", "entity_id": "entity.task", "defaults": {}}
        ]
        manifest["views"][0]["header"] = {"primary_actions": [{"action_id": "action.task_new"}]}
        normalized, _ = main.normalize_manifest_v13(manifest, module_id="task", cache={})
        action = next((a for a in normalized.get("actions", []) if a.get("id") == "action.task_new"), None)
        self.assertIsNotNone(action)
        self.assertEqual(action.get("kind"), "open_form")
        self.assertEqual(action.get("target"), "task.form")
        self.assertIsNone(action.get("entity_id"))


if __name__ == "__main__":
    unittest.main()
