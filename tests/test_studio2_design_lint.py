import os
import sys
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

os.environ["USE_DB"] = "0"
os.environ["OCTO_DISABLE_AUTH"] = "1"
os.environ["SUPABASE_URL"] = "http://localhost"

from app import main


class TestStudio2DesignLint(unittest.TestCase):
    def test_design_lint_warnings(self):
        manifest = {
            "manifest_version": "1.3",
            "module": {"id": "m1", "name": "Test"},
            "entities": [
                {
                    "id": "entity.task",
                    "label": "Task",
                    "display_field": "task.title",
                    "fields": [
                        {"id": "task.title", "type": "string", "label": "Title", "required": True},
                        {"id": "task.status", "type": "enum", "label": "Status", "options": [{"value": "new", "label": "New"}]},
                    ],
                }
            ],
            "views": [
                {"id": "task.list", "kind": "list", "entity": "entity.task", "columns": [{"field_id": "task.title"}]},
                {"id": "task.form", "kind": "form", "entity": "entity.task", "sections": []},
            ],
            "pages": [],
            "actions": [],
            "workflows": [
                {
                    "id": "workflow.task",
                    "entity": "entity.task",
                    "status_field": "task.status",
                    "states": [{"id": "new", "label": "New"}],
                }
            ],
            "app": {"home": "page:home", "nav": []},
        }
        warnings = main._studio2_design_lint(manifest)
        codes = {w.get("code") for w in warnings}
        self.assertIn("DESIGN_FORM_EMPTY", codes)
        self.assertIn("DESIGN_LIST_TOO_FEW_COLUMNS", codes)
        self.assertIn("DESIGN_WORKFLOW_NO_STATUS_ACTIONS", codes)


if __name__ == "__main__":
    unittest.main()
