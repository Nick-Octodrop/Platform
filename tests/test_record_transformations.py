import os
import sys
import unittest
import uuid
from unittest.mock import patch

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from fastapi.testclient import TestClient

os.environ["USE_DB"] = "0"
os.environ["OCTO_DISABLE_AUTH"] = "1"
os.environ["SUPABASE_URL"] = "http://localhost"

import app.main as main


class TestRecordTransformations(unittest.TestCase):
    def _no_document_sequences(self):
        return patch.object(main, "list_document_sequences", return_value=[])

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
                },
                {
                    "id": "action.quote_to_job_guarded",
                    "kind": "transform_record",
                    "entity_id": "entity.quote",
                    "label": "Convert To Job Guarded",
                    "transformation_key": "quote_to_job",
                    "enabled_when": {"op": "eq", "field": "quote.status", "value": "accepted"},
                },
            ],
            "views": [],
            "pages": [],
            "workflows": [],
        }
        main.store.init_module(module_id, manifest, actor={"id": "test"})
        main.registry.register(module_id, "Quote To Job", actor=None)
        main.registry.set_enabled(module_id, True, actor=None, reason="test")
        main._cache_invalidate("registry_list")

    def _install_group_invoice_manifest(self, module_id: str) -> None:
        manifest = {
            "manifest_version": "1.3",
            "module": {"id": module_id, "name": "Grouped Invoice Transform"},
            "entities": [
                {
                    "id": "entity.time_entry",
                    "display_field": "time_entry.description",
                    "fields": [
                        {"id": "time_entry.contact_id", "type": "string", "required": True},
                        {"id": "time_entry.description", "type": "string"},
                        {"id": "time_entry.amount", "type": "number"},
                        {"id": "time_entry.billable", "type": "bool"},
                        {
                            "id": "time_entry.status",
                            "type": "enum",
                            "required": True,
                            "options": [
                                {"label": "Draft", "value": "draft"},
                                {"label": "Approved", "value": "approved"},
                                {"label": "Invoiced", "value": "invoiced"},
                            ],
                        },
                    ],
                },
                {
                    "id": "entity.invoice",
                    "display_field": "invoice.number",
                    "fields": [
                        {"id": "invoice.number", "type": "string", "required": True},
                        {"id": "invoice.contact_id", "type": "string", "required": True},
                        {"id": "invoice.issue_date", "type": "date", "required": True},
                        {"id": "invoice.subtotal", "type": "number"},
                        {"id": "invoice.total", "type": "number"},
                        {
                            "id": "invoice.status",
                            "type": "enum",
                            "required": True,
                            "options": [
                                {"label": "Draft", "value": "draft"},
                                {"label": "Sent", "value": "sent"},
                            ],
                        },
                    ],
                },
                {
                    "id": "entity.invoice_line",
                    "display_field": "invoice_line.description",
                    "fields": [
                        {"id": "invoice_line.invoice_id", "type": "lookup", "entity": "entity.invoice", "display_field": "invoice.number", "required": True},
                        {"id": "invoice_line.time_entry_id", "type": "string"},
                        {"id": "invoice_line.description", "type": "string", "required": True},
                        {"id": "invoice_line.amount", "type": "number"},
                    ],
                },
            ],
            "transformations": [
                {
                    "key": "selected_time_entries_to_invoice",
                    "source_entity_id": "entity.time_entry",
                    "target_entity_id": "entity.invoice",
                    "field_mappings": {
                        "invoice.number": {"ref": "$source.id"},
                        "invoice.contact_id": {"from": "time_entry.contact_id"},
                        "invoice.issue_date": {"ref": "$today"},
                        "invoice.subtotal": {"ref": "$selection.sum.time_entry.amount"},
                        "invoice.total": {"ref": "$selection.sum.time_entry.amount"},
                        "invoice.status": {"value": "draft"},
                    },
                    "child_mappings": [
                        {
                            "source_entity_id": "entity.time_entry",
                            "source_scope": "selected_records",
                            "target_entity_id": "entity.invoice_line",
                            "target_link_field": "invoice_line.invoice_id",
                            "field_mappings": {
                                "invoice_line.time_entry_id": {"ref": "$source.id"},
                                "invoice_line.description": {"from": "time_entry.description"},
                                "invoice_line.amount": {"from": "time_entry.amount"},
                            },
                        }
                    ],
                    "source_update": {"patch": {"time_entry.status": "invoiced"}},
                    "validation": {
                        "require_source_fields": ["time_entry.contact_id", "time_entry.description"],
                        "require_child_records": True,
                        "require_uniform_fields": ["time_entry.contact_id"],
                        "selected_record_domain": {
                            "op": "and",
                            "conditions": [
                                {"op": "eq", "field": "time_entry.billable", "value": True},
                                {"op": "eq", "field": "time_entry.status", "value": "approved"},
                            ],
                        },
                    },
                }
            ],
            "actions": [
                {
                    "id": "action.time_entry_create_invoice",
                    "kind": "transform_record",
                    "entity_id": "entity.time_entry",
                    "label": "Create Draft Invoice",
                    "selection_mode": "selected_records",
                    "transformation_key": "selected_time_entries_to_invoice",
                }
            ],
            "views": [],
            "pages": [],
            "workflows": [],
        }
        main.store.init_module(module_id, manifest, actor={"id": "test"})
        main.registry.register(module_id, "Grouped Invoice Transform", actor=None)
        main.registry.set_enabled(module_id, True, actor=None, reason="test")
        main._cache_invalidate("registry_list")

    def test_quote_to_job_transform(self):
        module_id = f"quote_to_job_{uuid.uuid4().hex[:8]}"
        self._install_manifest(module_id)
        with self._no_document_sequences():
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

    def test_transform_child_mapping_uses_link_field_lookup(self):
        module_id = f"quote_to_job_{uuid.uuid4().hex[:8]}"
        self._install_manifest(module_id)
        with self._no_document_sequences():
            client = TestClient(main.app)

            quote_res = client.post(
                "/records/entity.quote",
                json={"record": {"quote.number": "Q-LOOKUP", "quote.status": "accepted", "quote.customer_id": "customer-1"}},
            ).json()
            self.assertTrue(quote_res.get("ok"), quote_res)
            quote_id = quote_res["record_id"]

            for idx in range(5):
                unrelated = client.post(
                    "/records/entity.quote",
                    json={"record": {"quote.number": f"Q-OTHER-{idx}", "quote.status": "accepted", "quote.customer_id": "customer-2"}},
                ).json()
                self.assertTrue(unrelated.get("ok"), unrelated)
                line = client.post(
                    "/records/entity.quote_line",
                    json={
                        "record": {
                            "quote_line.quote_id": unrelated["record_id"],
                            "quote_line.description": f"Unrelated {idx}",
                            "quote_line.qty": 1,
                        }
                    },
                ).json()
                self.assertTrue(line.get("ok"), line)

            line_res = client.post(
                "/records/entity.quote_line",
                json={"record": {"quote_line.quote_id": quote_id, "quote_line.description": "Only selected quote line", "quote_line.qty": 1}},
            ).json()
            self.assertTrue(line_res.get("ok"), line_res)

            with patch.object(main.generic_records, "list", side_effect=AssertionError("full child entity scan should not be used")):
                run_body = client.post(
                    "/actions/run",
                    json={
                        "module_id": module_id,
                        "action_id": "action.quote_to_job",
                        "context": {"record_id": quote_id},
                    },
                ).json()
            self.assertTrue(run_body.get("ok"), run_body)
            self.assertEqual((run_body.get("result") or {}).get("child_created"), 1)

    def test_selected_records_transform_creates_one_invoice_with_multiple_lines(self):
        module_id = f"grouped_invoice_{uuid.uuid4().hex[:8]}"
        self._install_group_invoice_manifest(module_id)
        with self._no_document_sequences():
            client = TestClient(main.app)

            first = client.post(
                "/records/entity.time_entry",
                json={"record": {"time_entry.contact_id": "contact-1", "time_entry.description": "Design", "time_entry.amount": 125, "time_entry.billable": True, "time_entry.status": "approved"}},
            ).json()
            second = client.post(
                "/records/entity.time_entry",
                json={"record": {"time_entry.contact_id": "contact-1", "time_entry.description": "Build", "time_entry.amount": 175, "time_entry.billable": True, "time_entry.status": "approved"}},
            ).json()
            self.assertTrue(first.get("ok"), first)
            self.assertTrue(second.get("ok"), second)

            run_body = client.post(
                "/actions/run",
                json={
                    "module_id": module_id,
                    "action_id": "action.time_entry_create_invoice",
                    "context": {"selected_ids": [first["record_id"], second["record_id"]]},
                },
            ).json()
            self.assertTrue(run_body.get("ok"), run_body)
            result = run_body.get("result") or {}
            invoice_id = result.get("record_id")
            self.assertTrue(isinstance(invoice_id, str) and invoice_id)
            self.assertEqual(result.get("entity_id"), "entity.invoice")
            self.assertEqual(result.get("child_created"), 2)
            self.assertEqual(result.get("source_record_ids"), [first["record_id"], second["record_id"]])

            invoice_after = client.get(f"/records/entity.invoice/{invoice_id}").json()
            self.assertTrue(invoice_after.get("ok"), invoice_after)
            self.assertEqual(invoice_after["record"].get("invoice.contact_id"), "contact-1")
            self.assertEqual(invoice_after["record"].get("invoice.subtotal"), 300)
            self.assertEqual(invoice_after["record"].get("invoice.total"), 300)
            self.assertEqual(invoice_after["record"].get("invoice.status"), "draft")

            first_after = client.get(f"/records/entity.time_entry/{first['record_id']}").json()
            second_after = client.get(f"/records/entity.time_entry/{second['record_id']}").json()
            self.assertEqual(first_after["record"].get("time_entry.status"), "invoiced")
            self.assertEqual(second_after["record"].get("time_entry.status"), "invoiced")

            invoice_lines = client.get("/records/entity.invoice_line").json()
            self.assertTrue(invoice_lines.get("ok"), invoice_lines)
            scoped_lines = [
                row
                for row in invoice_lines.get("records", [])
                if isinstance(row, dict)
                and isinstance(row.get("record"), dict)
                and row.get("record", {}).get("invoice_line.invoice_id") == invoice_id
            ]
            self.assertEqual(len(scoped_lines), 2)

    def test_selected_records_transform_requires_uniform_fields(self):
        module_id = f"grouped_invoice_{uuid.uuid4().hex[:8]}"
        self._install_group_invoice_manifest(module_id)
        with self._no_document_sequences():
            client = TestClient(main.app)

            first = client.post(
                "/records/entity.time_entry",
                json={"record": {"time_entry.contact_id": "contact-1", "time_entry.description": "Design", "time_entry.amount": 125, "time_entry.billable": True, "time_entry.status": "approved"}},
            ).json()
            second = client.post(
                "/records/entity.time_entry",
                json={"record": {"time_entry.contact_id": "contact-2", "time_entry.description": "Build", "time_entry.amount": 175, "time_entry.billable": True, "time_entry.status": "approved"}},
            ).json()

            run_body = client.post(
                "/actions/run",
                json={
                    "module_id": module_id,
                    "action_id": "action.time_entry_create_invoice",
                    "context": {"selected_ids": [first["record_id"], second["record_id"]]},
                },
            ).json()
            self.assertFalse(run_body.get("ok"), run_body)
            self.assertEqual((run_body.get("errors") or [{}])[0].get("code"), "TRANSFORMATION_SOURCE_MISMATCH")

    def test_selected_records_transform_requires_source_fields_for_each_selected_row(self):
        module_id = f"grouped_invoice_{uuid.uuid4().hex[:8]}"
        self._install_group_invoice_manifest(module_id)
        with self._no_document_sequences():
            client = TestClient(main.app)

            first = client.post(
                "/records/entity.time_entry",
                json={"record": {"time_entry.contact_id": "contact-1", "time_entry.description": "Design", "time_entry.amount": 125, "time_entry.billable": True, "time_entry.status": "approved"}},
            ).json()
            second = client.post(
                "/records/entity.time_entry",
                json={"record": {"time_entry.contact_id": "contact-1", "time_entry.amount": 175, "time_entry.billable": True, "time_entry.status": "approved"}},
            ).json()

            run_body = client.post(
                "/actions/run",
                json={
                    "module_id": module_id,
                    "action_id": "action.time_entry_create_invoice",
                    "context": {"selected_ids": [first["record_id"], second["record_id"]]},
                },
            ).json()
            self.assertFalse(run_body.get("ok"), run_body)
            first_error = (run_body.get("errors") or [{}])[0]
            self.assertEqual(first_error.get("code"), "TRANSFORMATION_SOURCE_REQUIRED")
            self.assertEqual(first_error.get("path"), "selected_ids[1].time_entry.description")

    def test_transform_action_guard_blocks_when_source_status_not_allowed(self):
        module_id = f"quote_to_job_{uuid.uuid4().hex[:8]}"
        self._install_manifest(module_id)
        with self._no_document_sequences():
            client = TestClient(main.app)

            quote_res = client.post(
                "/records/entity.quote",
                json={"record": {"quote.number": "Q-002", "quote.status": "draft", "quote.customer_id": "customer-1"}},
            ).json()
            self.assertTrue(quote_res.get("ok"), quote_res)

            run_body = client.post(
                "/actions/run",
                json={
                    "module_id": module_id,
                    "action_id": "action.quote_to_job_guarded",
                    "context": {"record_id": quote_res["record_id"]},
                },
            ).json()
            self.assertFalse(run_body.get("ok"), run_body)
            first_error = (run_body.get("errors") or [{}])[0]
            self.assertEqual(first_error.get("code"), "ACTION_DISABLED")

    def test_transform_action_guard_merges_persisted_record_with_draft_context(self):
        module_id = f"quote_to_job_{uuid.uuid4().hex[:8]}"
        self._install_manifest(module_id)
        with self._no_document_sequences():
            client = TestClient(main.app)

            quote_res = client.post(
                "/records/entity.quote",
                json={"record": {"quote.number": "Q-003", "quote.status": "accepted", "quote.customer_id": "customer-1"}},
            ).json()
            self.assertTrue(quote_res.get("ok"), quote_res)
            quote_id = quote_res["record_id"]
            line_res = client.post(
                "/records/entity.quote_line",
                json={"record": {"quote_line.quote_id": quote_id, "quote_line.description": "Cabinet C", "quote_line.qty": 1}},
            ).json()
            self.assertTrue(line_res.get("ok"), line_res)

            run_body = client.post(
                "/actions/run",
                json={
                    "module_id": module_id,
                    "action_id": "action.quote_to_job_guarded",
                    "context": {
                        "record_id": quote_id,
                        "record_draft": {"quote.customer_id": "customer-1"},
                    },
                },
            ).json()
            self.assertTrue(run_body.get("ok"), run_body)
            self.assertEqual((run_body.get("result") or {}).get("entity_id"), "entity.job")

    def test_selected_records_transform_rejects_rows_outside_domain(self):
        module_id = f"grouped_invoice_{uuid.uuid4().hex[:8]}"
        self._install_group_invoice_manifest(module_id)
        with self._no_document_sequences():
            client = TestClient(main.app)

            first = client.post(
                "/records/entity.time_entry",
                json={"record": {"time_entry.contact_id": "contact-1", "time_entry.description": "Design", "time_entry.amount": 125, "time_entry.billable": True, "time_entry.status": "approved"}},
            ).json()
            second = client.post(
                "/records/entity.time_entry",
                json={"record": {"time_entry.contact_id": "contact-1", "time_entry.description": "Admin", "time_entry.amount": 60, "time_entry.billable": False, "time_entry.status": "approved"}},
            ).json()
            self.assertTrue(first.get("ok"), first)
            self.assertTrue(second.get("ok"), second)

            run_body = client.post(
                "/actions/run",
                json={
                    "module_id": module_id,
                    "action_id": "action.time_entry_create_invoice",
                    "context": {"selected_ids": [first["record_id"], second["record_id"]]},
                },
            ).json()
            self.assertFalse(run_body.get("ok"), run_body)
            first_error = (run_body.get("errors") or [{}])[0]
            self.assertEqual(first_error.get("code"), "TRANSFORMATION_SELECTION_INVALID")


if __name__ == "__main__":
    unittest.main()
