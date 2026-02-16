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

from app import main


def contacts_manifest():
    return {
        "manifest_version": "1.3",
        "module": {"id": "contacts", "name": "Contacts"},
        "entities": [
            {
                "id": "entity.contact",
                "label": "Contact",
                "display_field": "contact.first_name",
                "fields": [
                    {"id": "contact.first_name", "type": "string", "label": "First Name", "required": True},
                    {"id": "contact.last_name", "type": "string", "label": "Last Name", "required": True},
                    {"id": "contact.email", "type": "string", "label": "Email"},
                    {"id": "contact.address", "type": "text", "label": "Address"},
                    {"id": "contact.type", "type": "enum", "label": "Type", "options": ["lead", "customer"]},
                ],
            }
        ],
        "views": [
            {
                "id": "contact.list",
                "kind": "list",
                "entity": "entity.contact",
                "columns": [{"field_id": "contact.first_name"}, {"field_id": "contact.last_name"}],
            },
            {
                "id": "contact.form",
                "kind": "form",
                "entity": "entity.contact",
                "sections": [{"id": "main", "title": "Main", "fields": ["contact.first_name", "contact.last_name", "contact.email", "contact.type"]}],
            },
        ],
        "pages": [
            {"id": "contact.list_page", "title": "Contacts", "layout": "single", "content": [{"kind": "view", "target": "contact.list"}]},
            {"id": "contact.form_page", "title": "Contact", "layout": "single", "content": [{"kind": "view", "target": "contact.form"}]},
        ],
        "actions": [],
        "workflows": [],
        "app": {"home": "page:contact.list_page", "nav": [{"group": "Main", "items": [{"label": "Contacts", "to": "page:contact.list_page"}]}]},
    }


def jobs_manifest():
    return {
        "manifest_version": "1.3",
        "module": {"id": "jobs", "name": "Jobs"},
        "entities": [
            {
                "id": "entity.job",
                "label": "Job",
                "display_field": "job.title",
                "fields": [
                    {"id": "job.title", "type": "string", "label": "Title", "required": True},
                    {"id": "job.status", "type": "enum", "label": "Status", "options": ["draft", "in_progress", "done"]},
                    {"id": "job.notes", "type": "text", "label": "Notes"},
                ],
            }
        ],
        "views": [
            {
                "id": "job.list",
                "kind": "list",
                "entity": "entity.job",
                "columns": [{"field_id": "job.title"}],
            },
            {
                "id": "job.form",
                "kind": "form",
                "entity": "entity.job",
                "sections": [{"id": "main", "title": "Main", "fields": ["job.title", "job.status", "job.notes"]}],
            },
        ],
        "pages": [
            {"id": "job.list_page", "title": "Jobs", "layout": "single", "content": [{"kind": "view", "target": "job.list"}]},
            {"id": "job.form_page", "title": "Job", "layout": "single", "content": [{"kind": "view", "target": "job.form"}]},
        ],
        "actions": [],
        "workflows": [
            {
                "entity": "entity.job",
                "status_field": "job.status",
                "states": ["draft", "in_progress", "done"],
            }
        ],
        "app": {"home": "page:job.list_page", "nav": [{"group": "Main", "items": [{"label": "Jobs", "to": "page:job.list_page"}]}]},
    }


class TestStudio2Baselines(unittest.TestCase):
    def test_contacts_no_workflow_statusbar(self):
        manifest = contacts_manifest()
        normalized, _ = main.normalize_manifest_v13(manifest, module_id="contacts", cache={})
        workflows = normalized.get("workflows") or []
        self.assertEqual(workflows, [])
        form_view = next(v for v in normalized["views"] if v.get("id") == "contact.form")
        header = form_view.get("header") or {}
        self.assertTrue("statusbar" not in header)
        enum_field = next(f for f in normalized["entities"][0]["fields"] if f.get("id") == "contact.type")
        self.assertTrue(all(isinstance(opt, dict) for opt in enum_field.get("options", [])))

    def test_jobs_workflow_statusbar(self):
        manifest = jobs_manifest()
        normalized, _ = main.normalize_manifest_v13(manifest, module_id="jobs", cache={})
        workflows = normalized.get("workflows") or []
        self.assertEqual(len(workflows), 1)
        wf = workflows[0]
        form_view = next(v for v in normalized["views"] if v.get("id") == "job.form")
        header = form_view.get("header") or {}
        self.assertEqual(header.get("statusbar", {}).get("field_id"), wf.get("status_field"))
        enum_field = next(f for f in normalized["entities"][0]["fields"] if f.get("id") == "job.status")
        self.assertTrue(all(isinstance(opt, dict) for opt in enum_field.get("options", [])))
        actions = normalized.get("actions") or []
        self.assertTrue(any(a.get("kind") == "update_record" and a.get("patch", {}).get("job.status") for a in actions))

    def test_minimal_baseline_columns_and_form_fields(self):
        manifest = {
            "manifest_version": "1.3",
            "module": {"id": "m1", "name": "Test"},
            "entities": [
                {
                    "id": "entity.item",
                    "label": "Item",
                    "display_field": "item.name",
                    "fields": [
                        {"id": "item.name", "type": "string", "label": "Name", "required": True},
                        {"id": "item.code", "type": "string", "label": "Code", "required": True},
                        {"id": "item.notes", "type": "text", "label": "Notes"},
                    ],
                }
            ],
            "views": [
                {"id": "item.list", "kind": "list", "entity": "entity.item", "columns": []},
                {"id": "item.form", "kind": "form", "entity": "entity.item", "sections": [{"id": "main", "fields": []}]},
            ],
            "pages": [],
            "actions": [],
            "workflows": [],
            "app": {"home": "page:home", "nav": []},
        }
        normalized, _ = main.normalize_manifest_v13(manifest, module_id="m1", cache={})
        list_view = next(v for v in normalized["views"] if v.get("id") == "item.list")
        cols = list_view.get("columns") or []
        self.assertGreaterEqual(len(cols), 2)
        form_view = next(v for v in normalized["views"] if v.get("id") == "item.form")
        fields = form_view.get("sections", [])[0].get("fields") if form_view.get("sections") else []
        self.assertIn("item.name", fields)
        self.assertIn("item.code", fields)


if __name__ == "__main__":
    unittest.main()
