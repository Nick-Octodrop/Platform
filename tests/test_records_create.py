import os
import sys
import unittest
import uuid

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from fastapi.testclient import TestClient

os.environ["USE_DB"] = "0"
os.environ["OCTO_DISABLE_AUTH"] = "1"
os.environ["SUPABASE_URL"] = "http://localhost"

import app.main as main


class TestRecordsCreate(unittest.TestCase):
    def test_contacts_minimal_create(self):
        module_id = f"contacts_test_{uuid.uuid4().hex[:8]}"
        manifest = {
            "manifest_version": "1.3",
            "module": {"id": module_id, "name": "Contacts"},
            "entities": [
                {
                    "id": "entity.contact",
                    "display_field": "contact.first_name",
                    "fields": [
                        {"id": "contact.first_name", "type": "string", "required": True},
                        {"id": "contact.last_name", "type": "string", "required": True},
                        {"id": "contact.email", "type": "string"},
                    ],
                }
            ],
            "views": [],
            "pages": [],
            "actions": [],
            "workflows": [],
        }
        main.store.init_module(module_id, manifest, actor={"id": "test"})
        main.registry.register(module_id, "Contacts", actor=None)
        main.registry.set_enabled(module_id, True, actor=None, reason="test")
        main._cache_invalidate("registry_list")

        client = TestClient(main.app)
        res = client.post("/records/entity.contact", json={"record": {"contact.first_name": "Ada", "contact.last_name": "Lovelace"}})
        body = res.json()
        self.assertTrue(body.get("ok"), body)
        self.assertIn("record", body)
        self.assertIn("record_id", body)


if __name__ == "__main__":
    unittest.main()
