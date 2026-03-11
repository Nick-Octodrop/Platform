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


class TestRecordTransformations(unittest.TestCase):
    def _install_manifest(self, module_id: str) -> None:
        manifest = {
            "manifest_version": "1.3",
            "module": {"id": module_id, "name": "Quote To Job"},
            "entities": [
                {
                    "id": "entity.quote",
                    "display_field": "quote.number",
                    "fields": [
                        {"id": "quote.number", "type": "string", "required": True},
                        {
                            "id": "quote.status",
                            "type": "enum",
                            "required": True,
                            "options": [
                                {"label": "Draft", "value": "draft"},
                                {"label": "Accepted", "value": "accepted"},
                                {"label": "Converted", "value": "converted"},
                            ],
                        },
                        {"id": "quote.customer_id", "type": "string"},
                        {"id": "quote.job_id", "type": "string"},
                    ],
                },
                {
                    "id": "entity.quote_line",
                    "display_field": "quote_line.description",
                    "fields": [
                        {"id": "quote_line.quote_id", "type": "lookup", "entity": "entity.quote", "display_field": "quote.number", "required": True},
                        {"id": "quote_line.description", "type": "string", "required": True},
                        {"id": "quote_line.qty", "type": "number"},
                    ],
                },
                {
                    "id": "entity.job",
                    "display_field": "job.number",
                    "fields": [
                        {"id": "job.number", "type": "string", "required": True},
                        {
                            "id": "job.status",
                            "type": "enum",
                            "required": True,
                            "options": [
                                {"label": "New", "value": "new"},
                                {"label": "Open", "value": "open"},
                            ],
                        },
                        {"id": "job.customer_id", "type": "string"},
                        {"id": "job.source_quote_id", "type": "string"},
                    ],
                },
                {
                    "id": "entity.job_line",
                    "display_field": "job_line.description",
                    "fields": [
                        {"id": "job_line.job_id", "type": "lookup", "entity": "entity.job", "display_field": "job.number", "required": True},
                        {"id": "job_line.description", "type": "string", "required": True},
                        {"id": "job_line.qty", "type": "number"},
                        {"id": "job_line.source_quote_line_id", "type": "string"},
                    ],
                },
            ],
            "transformations": [
                {
                    "key": "quote_to_job",
                    "source_entity_id": "entity.quote",
                    "target_entity_id": "entity.job",
                    "field_mappings": {
                        "job.number": {"from": "quote.number"},
                        "job.customer_id": {"from": "quote.customer_id"},
                        "job.status": {"value": "new"},
                    },
                    "child_mappings": [
                        {
                            "source_entity_id": "entity.quote_line",
                            "target_entity_id": "entity.job_line",
                            "source_link_field": "quote_line.quote_id",
                            "target_link_field": "job_line.job_id",
                            "field_mappings": {
                                "job_line.description": {"from": "quote_line.description"},
                                "job_line.qty": {"from": "quote_line.qty"},
                                "job_line.source_quote_line_id": {"ref": "$source.id"},
                            },
                        }
                    ],
                    "link_fields": {
                        "source_to_target": "quote.job_id",
                        "target_to_source": "job.source_quote_id",
                    },
                    "source_update": {"patch": {"quote.status": "converted"}},
                    "activity": {"enabled": True, "event_type": "transform", "targets": ["source", "target"]},
                    "feed": {"enabled": True, "targets": ["source"], "message": "Created {target.entity_id} {target.id}"},
                    "hooks": {"emit_events": ["quote.transformed_to_job"]},
                    "validation": {
                        "require_source_fields": ["quote.number"],
                        "require_child_records": True,
                        "prevent_if_target_linked": True,
                    },
                }
            ],
            "actions": [
                {
                    "id": "action.quote_to_job",
                    "kind": "transform_record",
                    "entity_id": "entity.quote",
                    "label": "Convert To Job",
                    "transformation_key": "quote_to_job",
                    "confirm": {
                        "title": "Convert Quote",
                        "body": "This will create a new job from this quote.",
                    },
                }
            ],
            "views": [],
            "pages": [],
            "workflows": [],
        }
        main.store.init_module(module_id, manifest, actor={"id": "test"})
        main.registry.register(module_id, "Quote To Job", actor=None)
        main.registry.set_enabled(module_id, True, actor=None, reason="test")
        main._cache_invalidate("registry_list")

    def test_quote_to_job_transform(self):
        module_id = f"quote_to_job_{uuid.uuid4().hex[:8]}"
        self._install_manifest(module_id)
        client = TestClient(main.app)

        quote_res = client.post(
            "/records/entity.quote",
            json={"record": {"quote.number": "Q-001", "quote.status": "accepted", "quote.customer_id": "customer-1"}},
        )
        quote_body = quote_res.json()
        self.assertTrue(quote_body.get("ok"), quote_body)
        quote_id = quote_body.get("record_id")
        self.assertTrue(isinstance(quote_id, str) and quote_id)

        line1 = client.post(
            "/records/entity.quote_line",
            json={"record": {"quote_line.quote_id": quote_id, "quote_line.description": "Cabinet A", "quote_line.qty": 2}},
        )
        self.assertTrue(line1.json().get("ok"), line1.json())
        line2 = client.post(
            "/records/entity.quote_line",
            json={"record": {"quote_line.quote_id": quote_id, "quote_line.description": "Cabinet B", "quote_line.qty": 1}},
        )
        self.assertTrue(line2.json().get("ok"), line2.json())

        run_res = client.post(
            "/actions/run",
            json={
                "module_id": module_id,
                "action_id": "action.quote_to_job",
                "context": {"record_id": quote_id},
            },
        )
        run_body = run_res.json()
        self.assertTrue(run_body.get("ok"), run_body)
        result = run_body.get("result") or {}
        job_id = result.get("record_id")
        self.assertTrue(isinstance(job_id, str) and job_id)
        self.assertEqual(result.get("entity_id"), "entity.job")
        self.assertEqual(result.get("child_created"), 2)

        quote_after = client.get(f"/records/entity.quote/{quote_id}").json()
        self.assertTrue(quote_after.get("ok"), quote_after)
        self.assertEqual(quote_after["record"].get("quote.status"), "converted")
        self.assertEqual(quote_after["record"].get("quote.job_id"), job_id)

        job_after = client.get(f"/records/entity.job/{job_id}").json()
        self.assertTrue(job_after.get("ok"), job_after)
        self.assertEqual(job_after["record"].get("job.number"), "Q-001")
        self.assertEqual(job_after["record"].get("job.customer_id"), "customer-1")
        self.assertEqual(job_after["record"].get("job.source_quote_id"), quote_id)

        job_lines = client.get("/records/entity.job_line").json()
        self.assertTrue(job_lines.get("ok"), job_lines)
        scoped_job_lines = [
            row
            for row in job_lines.get("records", [])
            if isinstance(row, dict)
            and isinstance(row.get("record"), dict)
            and row.get("record", {}).get("job_line.job_id") == job_id
        ]
        self.assertEqual(len(scoped_job_lines), 2)

        activity_res = client.get(f"/activity/events?entity_id=entity.quote&record_id={quote_id}&limit=20").json()
        self.assertTrue(activity_res.get("ok"), activity_res)
        self.assertTrue(
            any(event.get("event_type") == "transform" for event in activity_res.get("items", [])),
            activity_res,
        )

        duplicate_run = client.post(
            "/actions/run",
            json={
                "module_id": module_id,
                "action_id": "action.quote_to_job",
                "context": {"record_id": quote_id},
            },
        ).json()
        self.assertFalse(duplicate_run.get("ok"), duplicate_run)
        self.assertEqual((duplicate_run.get("errors") or [{}])[0].get("code"), "TRANSFORMATION_ALREADY_LINKED")


if __name__ == "__main__":
    unittest.main()
