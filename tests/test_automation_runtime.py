import unittest
from unittest.mock import patch
from types import SimpleNamespace

from app.stores import MemoryAutomationStore, MemoryJobStore
from app.worker import _emit_automation_event, _handle_system_action, _run_automation


class TestAutomationRuntime(unittest.TestCase):
    def test_emit_automation_event_uses_sha256_manifest_hash(self):
        captured: dict[str, object] = {}

        def fake_handle(event):
            captured["event"] = event

        def fake_webhook(event_type, payload, meta):
            captured["webhook"] = {
                "event_type": event_type,
                "payload": payload,
                "meta": meta,
            }

        app_main = SimpleNamespace(
            _handle_automation_event=fake_handle,
            _emit_external_webhook_subscriptions=fake_webhook,
        )

        with (
            patch("app.worker._get_app_main", return_value=app_main),
            patch("app.worker.get_org_id", return_value="org_test"),
        ):
            _emit_automation_event("record.updated", {"record_id": "r1"})

        event = captured["event"]
        self.assertEqual(event["meta"]["manifest_hash"], "sha256:automation")
        self.assertEqual(event["meta"]["actor"]["roles"], ["system"])
        self.assertEqual(captured["webhook"]["meta"]["manifest_hash"], "sha256:automation")

    def test_query_records_uses_direct_get_for_id_filter(self):
        store = SimpleNamespace(
            get=lambda entity_id, record_id: {
                "record_id": record_id,
                "record": {
                    "id": record_id,
                    "biz_contact.name": "Test Contact",
                    "biz_contact.xero_contact_id": "xero_123",
                },
            },
            list=lambda *args, **kwargs: self.fail("list should not be used for direct id lookups"),
        )

        with patch("app.worker.DbGenericRecordStore", return_value=store):
            result = _handle_system_action(
                "system.query_records",
                {
                    "entity_id": "entity.biz_contact",
                    "filter_expr": {
                        "op": "eq",
                        "field": "biz_contact.id",
                        "value": "contact_123",
                    },
                },
                {},
                None,
            )

        self.assertEqual(result["count"], 1)
        self.assertEqual(result["first"]["record_id"], "contact_123")
        self.assertEqual(result["first"]["record"]["biz_contact"]["id"], "contact_123")
        self.assertEqual(result["first"]["record"]["biz_contact"]["name"], "Test Contact")
        self.assertEqual(result["first"]["record"]["biz_contact"]["xero_contact_id"], "xero_123")

    def test_query_records_uses_field_lookup_for_simple_eq_filter(self):
        store = SimpleNamespace(
            get=lambda *args, **kwargs: self.fail("get should not be used for non-id eq lookups"),
            list=lambda *args, **kwargs: self.fail("list should not be used for simple eq lookups"),
            list_by_field_value=lambda entity_id, field_id, value, limit=200, offset=0: [
                {
                    "record_id": "line_123",
                    "record": {
                        "id": "line_123",
                        "biz_invoice_line.invoice_id": "invoice_123",
                        "biz_invoice_line.description": "Manual line",
                        "biz_invoice_line.quantity": 1,
                        "biz_invoice_line.unit_price": 1210,
                    },
                }
            ]
            if entity_id == "entity.biz_invoice_line" and field_id == "biz_invoice_line.invoice_id" and value == "invoice_123"
            else [],
        )

        with patch("app.worker.DbGenericRecordStore", return_value=store):
            result = _handle_system_action(
                "system.query_records",
                {
                    "entity_id": "entity.biz_invoice_line",
                    "filter_expr": {
                        "op": "eq",
                        "field": "biz_invoice_line.invoice_id",
                        "value": "invoice_123",
                    },
                },
                {},
                None,
            )

        self.assertEqual(result["count"], 1)
        self.assertEqual(result["first"]["record_id"], "line_123")
        self.assertEqual(result["first"]["record"]["biz_invoice_line"]["id"], "line_123")
        self.assertEqual(result["first"]["record"]["biz_invoice_line"]["invoice_id"], "invoice_123")
        self.assertEqual(result["first"]["record"]["biz_invoice_line"]["description"], "Manual line")

    def test_delay_reschedules(self):
        store = MemoryAutomationStore()
        job_store = MemoryJobStore()
        automation = store.create(
            {
                "name": "Delay Test",
                "status": "published",
                "trigger": {"kind": "event", "event_types": ["record.created"]},
                "steps": [{"id": "delay1", "kind": "delay", "seconds": 60}],
            }
        )
        run = store.create_run(
            {
                "automation_id": automation["id"],
                "status": "queued",
                "trigger_type": "record.created",
                "trigger_payload": {"record_id": "r1"},
            }
        )
        _run_automation({"payload": {"run_id": run["id"]}}, "default", automation_store=store, job_store=job_store)
        run_after = store.get_run(run["id"])
        self.assertEqual(run_after["status"], "queued")
        jobs = job_store.list("default")
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0]["type"], "automation.run")

    def test_idempotency_skips_duplicate(self):
        store = MemoryAutomationStore()
        job_store = MemoryJobStore()
        automation = store.create(
            {
                "name": "Idem Test",
                "status": "published",
                "trigger": {"kind": "event", "event_types": ["record.created"]},
                "steps": [{"id": "noop1", "kind": "action", "action_id": "system.noop"}],
            }
        )
        run = store.create_run(
            {
                "automation_id": automation["id"],
                "status": "queued",
                "trigger_type": "record.created",
                "trigger_payload": {"record_id": "r1"},
            }
        )
        _run_automation({"payload": {"run_id": run["id"]}}, "default", automation_store=store, job_store=job_store)
        first_runs = store.list_step_runs(run["id"])
        self.assertEqual(len(first_runs), 1)
        store.update_run(run["id"], {"status": "running", "current_step_index": 0})
        _run_automation({"payload": {"run_id": run["id"]}}, "default", automation_store=store, job_store=job_store)
        second_runs = store.list_step_runs(run["id"])
        self.assertEqual(len(second_runs), 1)

    def test_retry_policy_reschedules(self):
        store = MemoryAutomationStore()
        job_store = MemoryJobStore()
        automation = store.create(
            {
                "name": "Retry Test",
                "status": "published",
                "trigger": {"kind": "event", "event_types": ["record.created"]},
                "steps": [
                    {
                        "id": "fail1",
                        "kind": "action",
                        "action_id": "system.fail",
                        "retry_policy": {"max_attempts": 2, "backoff_seconds": 1},
                    }
                ],
            }
        )
        run = store.create_run(
            {
                "automation_id": automation["id"],
                "status": "queued",
                "trigger_type": "record.created",
                "trigger_payload": {"record_id": "r1"},
            }
        )
        _run_automation({"payload": {"run_id": run["id"]}}, "default", automation_store=store, job_store=job_store)
        run_after = store.get_run(run["id"])
        self.assertEqual(run_after["status"], "queued")
        jobs = job_store.list("default")
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0]["type"], "automation.run")

    def test_step_outputs_available_to_following_conditions(self):
        store = MemoryAutomationStore()
        job_store = MemoryJobStore()
        automation = store.create(
            {
                "name": "Context Test",
                "status": "published",
                "trigger": {"kind": "event", "event_types": ["record.created"]},
                "steps": [
                    {"id": "noop1", "kind": "action", "action_id": "system.noop"},
                    {
                        "id": "check1",
                        "kind": "condition",
                        "expr": {
                            "op": "eq",
                            "left": {"var": "steps.noop1.ok"},
                            "right": {"literal": True},
                        },
                        "stop_on_false": True,
                    },
                ],
            }
        )
        run = store.create_run(
            {
                "automation_id": automation["id"],
                "status": "queued",
                "trigger_type": "record.created",
                "trigger_payload": {"record_id": "r1"},
            }
        )
        _run_automation({"payload": {"run_id": run["id"]}}, "default", automation_store=store, job_store=job_store)
        run_after = store.get_run(run["id"])
        self.assertEqual(run_after["status"], "succeeded")
        step_runs = store.list_step_runs(run["id"])
        self.assertEqual(len(step_runs), 2)
        self.assertEqual(step_runs[1]["status"], "succeeded")

    def test_foreach_repeats_action_over_list(self):
        store = MemoryAutomationStore()
        job_store = MemoryJobStore()
        automation = store.create(
            {
                "name": "Loop Test",
                "status": "published",
                "trigger": {"kind": "event", "event_types": ["record.created"]},
                "steps": [
                    {
                        "id": "loop1",
                        "kind": "foreach",
                        "over": {"var": "trigger.record_ids"},
                        "item_name": "row_id",
                        "action_id": "system.noop",
                        "store_as": "loop_result",
                    },
                    {
                        "id": "check_loop",
                        "kind": "condition",
                        "expr": {
                            "op": "eq",
                            "left": {"var": "vars.loop_result.count"},
                            "right": {"literal": 3},
                        },
                        "stop_on_false": True,
                    },
                ],
            }
        )
        run = store.create_run(
            {
                "automation_id": automation["id"],
                "status": "queued",
                "trigger_type": "record.created",
                "trigger_payload": {"record_ids": ["r1", "r2", "r3"]},
            }
        )
        _run_automation({"payload": {"run_id": run["id"]}}, "default", automation_store=store, job_store=job_store)
        run_after = store.get_run(run["id"])
        self.assertEqual(run_after["status"], "succeeded")
        step_runs = store.list_step_runs(run["id"])
        self.assertEqual(step_runs[0]["output"]["count"], 3)

    def test_condition_executes_then_branch_steps(self):
        store = MemoryAutomationStore()
        job_store = MemoryJobStore()
        automation = store.create(
            {
                "name": "Nested Condition Test",
                "status": "published",
                "trigger": {"kind": "event", "event_types": ["record.created"]},
                "steps": [
                    {
                        "id": "cond1",
                        "kind": "condition",
                        "expr": {
                            "op": "eq",
                            "left": {"var": "trigger.status"},
                            "right": {"literal": "active"},
                        },
                        "then_steps": [
                            {"id": "nested_noop", "kind": "action", "action_id": "system.noop", "store_as": "nested_result"},
                        ],
                    },
                    {
                        "id": "check_nested",
                        "kind": "condition",
                        "expr": {
                            "op": "eq",
                            "left": {"var": "vars.nested_result.ok"},
                            "right": {"literal": True},
                        },
                        "stop_on_false": True,
                    },
                ],
            }
        )
        run = store.create_run(
            {
                "automation_id": automation["id"],
                "status": "queued",
                "trigger_type": "record.created",
                "trigger_payload": {"record_id": "r1", "status": "active"},
            }
        )
        _run_automation({"payload": {"run_id": run["id"]}}, "default", automation_store=store, job_store=job_store)
        run_after = store.get_run(run["id"])
        self.assertEqual(run_after["status"], "succeeded")
        step_runs = store.list_step_runs(run["id"])
        self.assertTrue(any(item.get("step_id") == "cond1.then.nested_noop" for item in step_runs))

    def test_foreach_executes_nested_steps(self):
        store = MemoryAutomationStore()
        job_store = MemoryJobStore()
        automation = store.create(
            {
                "name": "Nested Loop Test",
                "status": "published",
                "trigger": {"kind": "event", "event_types": ["record.created"]},
                "steps": [
                    {
                        "id": "loop_nested",
                        "kind": "foreach",
                        "over": {"var": "trigger.record_ids"},
                        "item_name": "row_id",
                        "steps": [
                            {"id": "child_noop", "kind": "action", "action_id": "system.noop"},
                        ],
                        "store_as": "loop_result",
                    },
                    {
                        "id": "check_loop",
                        "kind": "condition",
                        "expr": {
                            "op": "eq",
                            "left": {"var": "vars.loop_result.count"},
                            "right": {"literal": 2},
                        },
                        "stop_on_false": True,
                    },
                ],
            }
        )
        run = store.create_run(
            {
                "automation_id": automation["id"],
                "status": "queued",
                "trigger_type": "record.created",
                "trigger_payload": {"record_ids": ["r1", "r2"]},
            }
        )
        _run_automation({"payload": {"run_id": run["id"]}}, "default", automation_store=store, job_store=job_store)
        run_after = store.get_run(run["id"])
        self.assertEqual(run_after["status"], "succeeded")
        step_runs = store.list_step_runs(run["id"])
        self.assertTrue(any(item.get("step_id") == "loop_nested.loop_1.child_noop" for item in step_runs))
        self.assertTrue(any(item.get("step_id") == "loop_nested.loop_2.child_noop" for item in step_runs))

    def test_apply_integration_mapping_action_uses_saved_mapping(self):
        store = MemoryAutomationStore()
        job_store = MemoryJobStore()
        automation = store.create(
            {
                "name": "Apply Integration Mapping",
                "status": "published",
                "trigger": {"kind": "event", "event_types": ["integration.webhook.received"]},
                "steps": [
                    {
                        "id": "map_contact",
                        "kind": "action",
                        "action_id": "system.apply_integration_mapping",
                        "store_as": "mapped_contact",
                        "inputs": {
                            "connection_id": "conn_xero",
                            "mapping_id": "map_contact",
                            "source_record": "{{trigger.payload}}",
                            "source_path": "Contacts.0",
                        },
                    },
                    {
                        "id": "check_mapping",
                        "kind": "condition",
                        "expr": {
                            "op": "eq",
                            "left": {"var": "vars.mapped_contact.record_id"},
                            "right": {"literal": "contact_123"},
                        },
                        "stop_on_false": True,
                    },
                ],
            }
        )
        run = store.create_run(
            {
                "automation_id": automation["id"],
                "status": "queued",
                "trigger_type": "integration.webhook.received",
                "trigger_payload": {
                    "payload": {
                        "Contacts": [
                            {"Name": "Nick", "EmailAddress": "nick@example.com"},
                        ]
                    }
                },
            }
        )
        captured: dict[str, object] = {}

        def fake_execute(mapping, source_record, context=None):
            captured["mapping"] = mapping
            captured["source_record"] = source_record
            captured["context"] = context or {}
            return {
                "mode": "upsert",
                "operation": "created",
                "record_id": "contact_123",
                "record": {"name": "Nick"},
                "target_entity": "entity.biz_contact",
                "preview": {"values": {"name": "Nick"}},
            }

        with (
            patch("app.worker.DbIntegrationMappingStore.get", return_value={
                "id": "map_contact",
                "connection_id": "conn_xero",
                "name": "Xero Contact -> Octodrop Contact",
                "target_entity": "entity.biz_contact",
                "mapping_json": {"resource_key": "Contacts"},
            }),
            patch("app.worker.DbConnectionStore.get", return_value={"id": "conn_xero", "name": "Xero Demo"}),
            patch("app.worker.execute_integration_mapping", side_effect=fake_execute),
        ):
            _run_automation({"payload": {"run_id": run["id"]}}, "default", automation_store=store, job_store=job_store)

        run_after = store.get_run(run["id"])
        self.assertEqual(run_after["status"], "succeeded")
        self.assertEqual(captured["source_record"], {"Name": "Nick", "EmailAddress": "nick@example.com"})
        self.assertEqual(captured["context"]["connection_id"], "conn_xero")
        self.assertEqual(captured["context"]["resource_key"], "Contacts")
        self.assertEqual(captured["context"]["source"], "automation")

    def test_apply_integration_mapping_rejects_sync_only_mapping(self):
        store = MemoryAutomationStore()
        job_store = MemoryJobStore()
        automation = store.create(
            {
                "name": "Reject Sync Mapping",
                "status": "published",
                "trigger": {"kind": "event", "event_types": ["integration.webhook.received"]},
                "steps": [
                    {
                        "id": "map_contact",
                        "kind": "action",
                        "action_id": "system.apply_integration_mapping",
                        "inputs": {
                            "connection_id": "conn_xero",
                            "mapping_id": "map_contact",
                            "source_record": {"Name": "Nick"},
                        },
                    }
                ],
            }
        )
        run = store.create_run(
            {
                "automation_id": automation["id"],
                "status": "queued",
                "trigger_type": "integration.webhook.received",
                "trigger_payload": {"payload": {"Name": "Nick"}},
            }
        )

        with patch("app.worker.DbIntegrationMappingStore.get", return_value={
            "id": "map_contact",
            "connection_id": "conn_xero",
            "name": "Xero Contact Sync Mapping",
            "target_entity": "entity.biz_contact",
            "mapping_json": {"resource_key": "Contacts", "usage_scope": "sync_only"},
        }):
            _run_automation({"payload": {"run_id": run["id"]}}, "default", automation_store=store, job_store=job_store)

        run_after = store.get_run(run["id"])
        self.assertEqual(run_after["status"], "failed")

    def test_integration_request_action_uses_saved_request_template_with_overrides(self):
        store = MemoryAutomationStore()
        job_store = MemoryJobStore()
        automation = store.create(
            {
                "name": "Run Request Template",
                "status": "published",
                "trigger": {"kind": "event", "event_types": ["record.created"]},
                "steps": [
                    {
                        "id": "call_xero",
                        "kind": "action",
                        "action_id": "system.integration_request",
                        "store_as": "xero_result",
                        "inputs": {
                            "connection_id": "conn_xero",
                            "template_id": "contacts_list",
                            "query": {"where": "Status==\"ACTIVE\""},
                            "headers": {"X-Test": "1"},
                        },
                    }
                ],
            }
        )
        run = store.create_run(
            {
                "automation_id": automation["id"],
                "status": "queued",
                "trigger_type": "record.created",
                "trigger_payload": {"record_id": "r1"},
            }
        )
        captured: dict[str, object] = {}

        def fake_execute(connection, request_config, org_id):
            captured["connection"] = connection
            captured["request_config"] = request_config
            captured["org_id"] = org_id
            return {
                "ok": True,
                "status_code": 200,
                "method": request_config.get("method"),
                "url": request_config.get("path"),
                "headers": {},
                "body_json": {"Contacts": []},
                "body_text": None,
            }

        with (
            patch("app.worker.DbConnectionStore.get", return_value={
                "id": "conn_xero",
                "name": "Xero Demo",
                "config": {
                    "request_templates": [
                        {
                            "id": "contacts_list",
                            "name": "List contacts",
                            "method": "GET",
                            "path": "/Contacts",
                            "headers": {"Accept": "application/json"},
                            "query": {"page": 1},
                        }
                    ]
                },
            }),
            patch("app.worker.execute_connection_request", side_effect=fake_execute),
            patch("app.worker.DbIntegrationRequestLogStore.create"),
        ):
            _run_automation({"payload": {"run_id": run["id"]}}, "default", automation_store=store, job_store=job_store)

        run_after = store.get_run(run["id"])
        self.assertEqual(run_after["status"], "succeeded")
        self.assertEqual(captured["request_config"]["method"], "GET")
        self.assertEqual(captured["request_config"]["path"], "/Contacts")
        self.assertEqual(captured["request_config"]["headers"]["Accept"], "application/json")
        self.assertEqual(captured["request_config"]["headers"]["X-Test"], "1")
        self.assertEqual(captured["request_config"]["query"]["page"], 1)
        self.assertEqual(captured["request_config"]["query"]["where"], "Status==\"ACTIVE\"")


if __name__ == "__main__":
    unittest.main()
