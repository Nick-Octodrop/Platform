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
    def setUp(self):
        self._original_document_sequences_for_entity = main._document_sequences_for_entity
        main._document_sequences_for_entity = lambda entity_id, active_only=True: []

    def tearDown(self):
        main._document_sequences_for_entity = self._original_document_sequences_for_entity

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

    def test_lookup_populated_readonly_snapshots_persist(self):
        suffix = uuid.uuid4().hex[:8]
        module_id = f"lookup_populate_test_{suffix}"
        customer_entity = f"entity.test_contact_{suffix}"
        person_entity = f"entity.test_contact_person_{suffix}"
        quote_entity = f"entity.test_quote_{suffix}"
        manifest = {
            "manifest_version": "1.3",
            "module": {"id": module_id, "name": "Lookup Populate Test"},
            "entities": [
                {
                    "id": customer_entity,
                    "display_field": "customer.name",
                    "fields": [
                        {"id": "customer.name", "type": "string", "required": True},
                        {"id": "customer.email", "type": "string"},
                        {"id": "customer.phone", "type": "string"},
                    ],
                },
                {
                    "id": person_entity,
                    "display_field": "person.display_name",
                    "fields": [
                        {"id": "person.display_name", "type": "string", "required": True},
                        {"id": "person.email", "type": "string"},
                        {"id": "person.phone", "type": "string"},
                    ],
                },
                {
                    "id": quote_entity,
                    "display_field": "quote.name",
                    "fields": [
                        {"id": "quote.name", "type": "string", "required": True},
                        {
                            "id": "quote.customer_id",
                            "type": "lookup",
                            "entity": customer_entity,
                            "display_field": "customer.name",
                            "ui": {
                                "populate_from_lookup": {
                                    "field_map": {
                                        "quote.customer_contact_email": "customer.email",
                                        "quote.customer_contact_phone": "customer.phone",
                                    },
                                    "clear_fields": [
                                        "quote.customer_contact_person_id",
                                        "quote.customer_contact_name",
                                        "quote.customer_contact_email",
                                        "quote.customer_contact_phone",
                                    ],
                                }
                            },
                        },
                        {
                            "id": "quote.customer_contact_person_id",
                            "type": "lookup",
                            "entity": person_entity,
                            "display_field": "person.display_name",
                            "ui": {
                                "populate_from_lookup": {
                                    "field_map": {
                                        "quote.customer_contact_name": "person.display_name",
                                        "quote.customer_contact_email": "person.email",
                                        "quote.customer_contact_phone": "person.phone",
                                    }
                                }
                            },
                        },
                        {"id": "quote.customer_contact_name", "type": "string", "readonly": True},
                        {"id": "quote.customer_contact_email", "type": "string", "readonly": True},
                        {"id": "quote.customer_contact_phone", "type": "string", "readonly": True},
                    ],
                },
            ],
            "views": [],
            "pages": [],
            "actions": [],
            "workflows": [],
        }
        main.store.init_module(module_id, manifest, actor={"id": "test"})
        main.registry.register(module_id, "Lookup Populate Test", actor=None)
        main.registry.set_enabled(module_id, True, actor=None, reason="test")
        main._cache_invalidate("registry_list")

        client = TestClient(main.app)
        customer_res = client.post(
            f"/records/{customer_entity}",
            json={
                "record": {
                    "customer.name": "Example Customer",
                    "customer.email": "company@example.test",
                    "customer.phone": "+64 9 000 000",
                }
            },
        )
        customer_body = customer_res.json()
        self.assertTrue(customer_body.get("ok"), customer_body)
        customer_id = customer_body["record_id"]

        person_res = client.post(
            f"/records/{person_entity}",
            json={
                "record": {
                    "person.display_name": "Ada Lovelace",
                    "person.email": "ada@example.test",
                    "person.phone": "+64 21 000 000",
                }
            },
        )
        person_body = person_res.json()
        self.assertTrue(person_body.get("ok"), person_body)
        person_id = person_body["record_id"]

        quote_res = client.post(
            f"/records/{quote_entity}",
            json={
                "record": {
                    "quote.name": "Q-1",
                    "quote.customer_id": customer_id,
                    "quote.customer_contact_person_id": person_id,
                }
            },
        )
        quote_body = quote_res.json()
        self.assertTrue(quote_body.get("ok"), quote_body)
        quote = quote_body["record"]
        self.assertEqual(quote.get("quote.customer_contact_person_id"), person_id)
        self.assertEqual(quote.get("quote.customer_contact_name"), "Ada Lovelace")
        self.assertEqual(quote.get("quote.customer_contact_email"), "ada@example.test")
        self.assertEqual(quote.get("quote.customer_contact_phone"), "+64 21 000 000")


if __name__ == "__main__":
    unittest.main()
