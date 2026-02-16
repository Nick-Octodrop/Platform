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
from app.manifest_validate import validate_manifest_raw


class TestStudio2LookupRelation(unittest.TestCase):
    def test_lookup_relation_normalizes_and_autocreates(self) -> None:
        manifest = {
            "manifest_version": "1.3",
            "module": {"id": "jobs", "name": "Jobs"},
            "entities": [
                {
                    "id": "entity.job",
                    "label": "Job",
                    "display_field": "job.title",
                    "fields": [
                        {"id": "job.title", "type": "string", "label": "Title"},
                        {
                            "id": "job.assigned_to",
                            "type": "lookup",
                            "label": "Assigned To",
                            "entity": "contact",
                            "display_field": "contact.name",
                        },
                    ],
                }
            ],
            "views": [
                {
                    "id": "job.list",
                    "kind": "list",
                    "entity": "entity.job",
                    "columns": [{"field_id": "job.title"}, {"field_id": "job.assigned_to"}],
                },
                {
                    "id": "job.form",
                    "kind": "form",
                    "entity": "entity.job",
                    "sections": [{"id": "main", "title": "Main", "fields": ["job.title", "job.assigned_to"]}],
                },
            ],
            "pages": [
                {"id": "job.list_page", "title": "Jobs", "layout": "single", "content": [{"kind": "view", "target": "job.list"}]},
                {"id": "job.form_page", "title": "Job", "layout": "single", "content": [{"kind": "view", "target": "job.form"}]},
            ],
            "actions": [],
            "workflows": [],
            "app": {"home": "page:job.list_page", "nav": [{"group": "Main", "items": [{"label": "Jobs", "to": "page:job.list_page"}]}]},
        }

        relation_def = {
            "from_entity": "entity.job",
            "from_field": "job.assigned_to",
            "to_entity": "entity.contact",
            "to_field": "contact.id",
            "label_field": "contact.name",
        }
        manifest = main._studio2_tool_ensure_relation(manifest, relation_def)
        normalized, _ = main.normalize_manifest_v13(manifest, module_id="jobs", cache={})
        normalized, errors, _ = validate_manifest_raw(normalized, expected_module_id="jobs")
        self.assertEqual(errors, [])
        relations = normalized.get("relations") or []
        self.assertTrue(any(rel.get("from") == "job.assigned_to" and rel.get("to") == "contact.id" for rel in relations))
        contact = next((e for e in normalized.get("entities", []) if e.get("id") == "entity.contact"), None)
        self.assertIsNotNone(contact)
        self.assertEqual(contact.get("display_field"), "contact.name")


if __name__ == "__main__":
    unittest.main()
