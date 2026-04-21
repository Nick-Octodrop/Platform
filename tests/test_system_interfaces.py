import os
import sys
import unittest
import uuid

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

os.environ["USE_DB"] = "0"
os.environ["OCTO_DISABLE_AUTH"] = "1"
os.environ["SUPABASE_URL"] = "http://localhost"

from fastapi.testclient import TestClient

import app.main as main


def _base_manifest(module_id: str) -> dict:
    return {
        "manifest_version": "1.3",
        "module": {"id": module_id, "name": module_id},
        "entities": [
            {
                "id": "entity.job",
                "display_field": "job.title",
                "fields": [
                    {"id": "job.title", "type": "string"},
                    {"id": "job.start_at", "type": "datetime"},
                    {"id": "job.end_at", "type": "datetime"},
                    {"id": "job.owner_id", "type": "string"},
                    {"id": "job.status", "type": "enum", "options": [{"value": "new", "label": "New"}]},
                    {"id": "job.attachments", "type": "attachments"},
                    {"id": "job.total", "type": "number"},
                ],
            }
        ],
        "interfaces": {
            "schedulable": [
                {
                    "entity_id": "entity.job",
                    "title_field": "job.title",
                    "date_start": "job.start_at",
                    "date_end": "job.end_at",
                    "owner_field": "job.owner_id",
                }
            ],
            "documentable": [
                {
                    "entity_id": "entity.job",
                    "attachment_field": "job.attachments",
                    "title_field": "job.title",
                    "owner_field": "job.owner_id",
                }
            ],
            "dashboardable": [
                {
                    "entity_id": "entity.job",
                    "date_field": "job.start_at",
                    "group_bys": ["job.status"],
                    "measures": ["count", "sum:job.total"],
                    "default_widgets": [{"id": "jobs_by_status", "type": "group", "group_by": "job.status", "measure": "count"}],
                }
            ],
        },
        "views": [
            {"id": "job.list", "kind": "list", "entity": "entity.job", "columns": [{"field_id": "job.title"}]},
        ],
        "pages": [],
        "actions": [],
        "workflows": [],
    }


class TestSystemInterfaces(unittest.TestCase):
    def _install(self, manifest: dict) -> str:
        module_id = manifest["module"]["id"]
        main.store.init_module(module_id, manifest, actor={"id": "test"})
        main.registry.register(module_id, module_id, actor=None)
        main.registry.set_enabled(module_id, True, actor=None, reason="test")
        main._cache_invalidate("registry_list")
        return module_id

    def test_discovery_and_aggregate_endpoints(self):
        module_id = f"iface_{uuid.uuid4().hex[:8]}"
        self._install(_base_manifest(module_id))
        client = TestClient(main.app)

        rec1 = client.post(
            "/records/entity.job",
            json={
                "record": {
                    "job.title": "A",
                    "job.start_at": "2026-03-01T09:00:00Z",
                    "job.end_at": "2026-03-01T10:00:00Z",
                    "job.owner_id": "test-user",
                    "job.status": "new",
                    "job.total": 100,
                    "job.attachments": [{"id": "att-1", "filename": "a.pdf"}],
                }
            },
        ).json()
        self.assertTrue(rec1.get("ok"), rec1)

        src = client.get("/system/interfaces/sources").json()
        self.assertTrue(src.get("ok"), src)
        self.assertTrue(len(src.get("sources", {}).get("schedulable", [])) >= 1, src)

        calendar = client.get("/system/calendar/events?mine=true&limit=20").json()
        self.assertTrue(calendar.get("ok"), calendar)
        self.assertTrue(len(calendar.get("events", [])) >= 1, calendar)

        docs = client.get("/system/documents/items?mine=true&limit=20").json()
        self.assertTrue(docs.get("ok"), docs)
        self.assertTrue(len(docs.get("items", [])) >= 1, docs)

        dashboard_sources = client.get("/system/dashboard/sources").json()
        self.assertTrue(dashboard_sources.get("ok"), dashboard_sources)
        first_source = next(
            (
                item
                for item in (dashboard_sources.get("sources") or [])
                if isinstance(item, dict) and item.get("module_id") == module_id and item.get("entity_id") == "entity.job"
            ),
            None,
        )
        self.assertTrue(isinstance(first_source, dict), dashboard_sources)
        query = client.post(
            "/system/dashboard/query",
            json={"source_key": first_source.get("source_key"), "group_by": "job.status", "measure": "count"},
        ).json()
        self.assertTrue(query.get("ok"), query)
        self.assertTrue(len(query.get("groups", [])) >= 1, query)

    def test_system_notify_accepts_multi_recipient_payload_shapes(self):
        client = TestClient(main.app)
        res = client.post(
            "/system/notify",
            json={
                "title": "New Shopify Order!",
                "body": "A new Shopify order was received.",
                "recipient_user_id": "user-nick",
                "recipient_user_ids": ["user-nick", "user-kelly"],
            },
        )
        body = res.json()
        self.assertEqual(res.status_code, 200, body)
        self.assertTrue(body.get("ok"), body)
        notifications = body.get("notifications") or []
        self.assertEqual(len(notifications), 2, body)
        self.assertEqual(
            [item.get("recipient_user_id") for item in notifications],
            ["user-nick", "user-kelly"],
        )


if __name__ == "__main__":
    unittest.main()
