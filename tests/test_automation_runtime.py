import unittest
from unittest.mock import patch
from types import SimpleNamespace
from datetime import datetime, timezone

import app.main as app_main
from app.stores import MemoryAutomationStore, MemoryJobStore
from app.worker import _emit_automation_event, _handle_system_action, _run_automation


class TestAutomationRuntime(unittest.TestCase):
    def test_emit_triggers_still_reaches_automations_without_manifest_trigger(self):
        handled: list[dict] = []
        published: list[dict] = []

        request = SimpleNamespace(
            state=SimpleNamespace(actor={"workspace_id": "org_test"}),
            headers={},
        )
        manifest = {"module": {"id": "te_catalog"}, "triggers": []}
        fake_bus = SimpleNamespace(publish=lambda event: published.append(event))

        def fake_make_event(name, payload, meta):
            return {"name": name, "payload": payload, "meta": meta}

        with (
            patch.object(app_main, "_get_module", return_value={"current_hash": "hash_test"}),
            patch.object(app_main, "make_event", side_effect=fake_make_event),
            patch.object(app_main, "event_bus", fake_bus),
            patch.object(app_main, "_handle_automation_event", side_effect=lambda event: handled.append(event)),
        ):
            app_main._emit_triggers(
                request,
                "module_dafacb",
                manifest,
                "action.clicked",
                {
                    "action_id": "action.te_product_push_shopify_inventory",
                    "entity_id": "entity.te_product",
                    "record_id": "prod_123",
                },
                action_id="action.te_product_push_shopify_inventory",
            )

        self.assertTrue(any(item["payload"]["event"] == "action.clicked" for item in handled))
        self.assertTrue(any(item["payload"]["event"] == "action.clicked" for item in published))

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

    def test_send_email_step_renders_record_placeholders_at_action_runtime(self):
        store = MemoryAutomationStore()
        job_store = MemoryJobStore()
        automation = store.create(
            {
                "name": "Quote Accepted Email",
                "status": "published",
                "trigger": {"kind": "event", "event_types": ["biz_quotes.action.quote_mark_accepted.clicked"]},
                "steps": [
                    {
                        "id": "step_send_email",
                        "kind": "action",
                        "action_id": "system.send_email",
                        "inputs": {
                            "entity_id": "entity.biz_quote",
                            "to_field_ids": ["biz_quote.customer_email"],
                            "subject": "Your Quote {{ record['biz_quote.quote_number'] }} has been Accepted",
                            "body_html": "<p>Dear {{ record['biz_quote.customer_name'] }},</p><p>Your quote <strong>{{ record['biz_quote.quote_number'] }}</strong> has been accepted.</p>",
                            "body_text": "Dear {{ record['biz_quote.customer_name'] }},\n\nYour quote {{ record['biz_quote.quote_number'] }} has been accepted.",
                        },
                    }
                ],
            }
        )
        run = store.create_run(
            {
                "automation_id": automation["id"],
                "status": "queued",
                "trigger_type": "biz_quotes.action.quote_mark_accepted.clicked",
                "trigger_payload": {
                    "event": "biz_quotes.action.quote_mark_accepted.clicked",
                    "entity_id": "entity.biz_quote",
                    "record_id": "quote_1",
                    "record": {
                        "fields": {
                            "biz_quote.quote_number": "QUO-2026-0028",
                            "biz_quote.customer_name": "Neetones",
                            "biz_quote.customer_email": "customer@example.com",
                        },
                        "flat": {
                            "biz_quote.quote_number": "QUO-2026-0028",
                            "biz_quote.customer_name": "Neetones",
                            "biz_quote.customer_email": "customer@example.com",
                        }
                    },
                },
            }
        )
        created_outbox: list[dict] = []

        class _FakeEmailStore:
            def create_outbox(self, payload):
                item = {"id": "outbox_1", **payload, "created_at": datetime.now(timezone.utc).isoformat()}
                created_outbox.append(item)
                return item

        class _FakeConnectionStore:
            def get(self, _connection_id):
                return None

            def get_default_email(self):
                return {"id": "conn_default", "config": {"from_email": "noreply@example.com"}}

        class _FakeRecordStore:
            def get(self, entity_id, record_id):
                if entity_id in {"entity.biz_quote", "biz_quote"} and record_id == "quote_1":
                    return {
                        "record": {
                            "id": "quote_1",
                            "biz_quote.quote_number": "QUO-2026-0028",
                            "biz_quote.customer_name": "Neetones",
                            "biz_quote.customer_email": "customer@example.com",
                        }
                    }
                return None

        entity_def = {
            "id": "entity.biz_quote",
            "fields": [
                {"id": "biz_quote.quote_number", "label": "Quote Number", "type": "string"},
                {"id": "biz_quote.customer_name", "label": "Customer Name", "type": "string"},
                {"id": "biz_quote.customer_email", "label": "Customer Email", "type": "email"},
            ],
        }

        with (
            patch("app.worker.DbEmailStore", return_value=_FakeEmailStore()),
            patch("app.worker.DbConnectionStore", return_value=_FakeConnectionStore()),
            patch("app.worker.DbGenericRecordStore", return_value=_FakeRecordStore()),
            patch("app.worker._find_entity_def", return_value=entity_def),
        ):
            _run_automation({"payload": {"run_id": run["id"]}}, "default", automation_store=store, job_store=job_store)

        run_after = store.get_run(run["id"])
        self.assertEqual(run_after["status"], "succeeded", run_after)
        self.assertEqual(len(created_outbox), 1, created_outbox)
        self.assertEqual(created_outbox[0]["to"], ["customer@example.com"])
        self.assertEqual(created_outbox[0]["subject"], "Your Quote QUO-2026-0028 has been Accepted")
        self.assertIn("Dear Neetones", created_outbox[0]["body_html"])
        self.assertIn("QUO-2026-0028", created_outbox[0]["body_text"])

    def test_notify_step_uses_last_step_record_when_trigger_has_no_record(self):
        created_notifications: list[dict] = []

        class _FakeNotificationStore:
            def create(self, payload):
                item = {"id": f"notif_{len(created_notifications) + 1}", **payload}
                created_notifications.append(item)
                return item

        fake_app = SimpleNamespace(
            _enrich_template_record=lambda record_data, entity_def: dict(record_data or {}),
            _branding_context_for_org=lambda _org_id: {},
        )

        with (
            patch("app.worker.DbNotificationStore", return_value=_FakeNotificationStore()),
            patch("app.worker._get_app_main", return_value=fake_app),
            patch("app.worker._fetch_record_payload", return_value={"te_sales_order.order_number": "SO-1001"}),
            patch("app.worker._find_entity_def", return_value=None),
        ):
            result = _handle_system_action(
                "system.notify",
                {
                    "recipient_user_ids": ["user-ops", "user-nick"],
                    "title": "New order {{ record['te_sales_order.order_number'] }}",
                    "body": "A new order is ready.",
                    "link_mode": "trigger_record",
                },
                {
                    "trigger": {"event": "integration.webhook.shopify.orders.create"},
                    "steps": {
                        "upsert_shopify_order": {
                            "entity_id": "entity.te_sales_order",
                            "record_id": "sales_order_1",
                        }
                    },
                    "last": {
                        "entity_id": "entity.te_sales_order",
                        "record_id": "sales_order_1",
                    },
                },
                MemoryJobStore(),
            )

        self.assertEqual(len(created_notifications), 2, created_notifications)
        self.assertEqual(created_notifications[0]["title"], "New order SO-1001")
        self.assertEqual(created_notifications[0]["link_to"], "/data/te_sales_order/sales_order_1")
        self.assertEqual(result["notifications"][0]["recipient_user_id"], "user-ops")

    def test_send_email_step_uses_last_step_record_when_trigger_has_no_record(self):
        created_outbox: list[dict] = []

        class _FakeEmailStore:
            def create_outbox(self, payload):
                item = {"id": "outbox_1", **payload, "created_at": datetime.now(timezone.utc).isoformat()}
                created_outbox.append(item)
                return item

        class _FakeConnectionStore:
            def get(self, _connection_id):
                return None

            def get_default_email(self):
                return {"id": "conn_default", "config": {"from_email": "noreply@example.com"}}

        fake_app = SimpleNamespace(
            _build_template_render_context=lambda record_data, entity_def, entity_id, branding: {
                "record": dict(record_data or {}),
                "entity_id": entity_id,
                **(branding or {}),
            },
            _branding_context_for_org=lambda _org_id: {},
        )

        with (
            patch("app.worker._get_app_main", return_value=fake_app),
            patch("app.worker.DbAttachmentStore"),
            patch("app.worker.DbEmailStore", return_value=_FakeEmailStore()),
            patch("app.worker.DbConnectionStore", return_value=_FakeConnectionStore()),
            patch("app.worker._fetch_record_payload", return_value={"te_sales_order.order_number": "SO-1001"}),
            patch("app.worker._find_entity_def", return_value=None),
        ):
            result = _handle_system_action(
                "system.send_email",
                {
                    "to_internal_emails": ["ops@example.com"],
                    "subject": "New order {{ record['te_sales_order.order_number'] }}",
                    "body_text": "A new order has arrived.",
                },
                {
                    "trigger": {"event": "integration.webhook.shopify.orders.create"},
                    "steps": {
                        "upsert_shopify_order": {
                            "entity_id": "entity.te_sales_order",
                            "record_id": "sales_order_1",
                        }
                    },
                    "last": {
                        "entity_id": "entity.te_sales_order",
                        "record_id": "sales_order_1",
                    },
                },
                MemoryJobStore(),
            )

        self.assertEqual(len(created_outbox), 1, created_outbox)
        self.assertEqual(created_outbox[0]["subject"], "New order SO-1001")
        self.assertEqual(created_outbox[0]["to"], ["ops@example.com"])
        self.assertIn("job", result)

    def test_create_record_step_renders_trigger_field_templates_at_action_runtime(self):
        store = MemoryAutomationStore()
        job_store = MemoryJobStore()
        automation = store.create(
            {
                "name": "Create Job From Quote",
                "status": "published",
                "trigger": {"kind": "event", "event_types": ["biz_quotes.action.quote_mark_accepted.clicked"]},
                "steps": [
                    {
                        "id": "step_create_job",
                        "kind": "action",
                        "action_id": "system.create_record",
                        "inputs": {
                            "entity_id": "entity.biz_job",
                            "values": {
                                "biz_job.reference": "JOB-{{trigger.record.fields.biz_quote.quote_number}}",
                                "biz_job.source_quote_number": "{{trigger.record.fields.biz_quote.quote_number}}",
                                "biz_job.customer_name": "{{trigger.record.fields.biz_quote.customer_name}}",
                                "biz_job.customer_email": "{{trigger.record.fields.biz_quote.customer_email}}",
                                "biz_job.status": "new",
                            },
                        },
                    }
                ],
            }
        )
        run = store.create_run(
            {
                "automation_id": automation["id"],
                "status": "queued",
                "trigger_type": "biz_quotes.action.quote_mark_accepted.clicked",
                "trigger_payload": {
                    "event": "biz_quotes.action.quote_mark_accepted.clicked",
                    "entity_id": "entity.biz_quote",
                    "record_id": "quote_1",
                    "record": {
                        "fields": {
                            "biz_quote": {
                                "quote_number": "QUO-2026-0028",
                                "customer_name": "Neetones",
                                "customer_email": "customer@example.com",
                            },
                            "quote_number": "QUO-2026-0028",
                            "customer_name": "Neetones",
                            "customer_email": "customer@example.com",
                        },
                        "flat": {
                            "biz_quote.quote_number": "QUO-2026-0028",
                            "biz_quote.customer_name": "Neetones",
                            "biz_quote.customer_email": "customer@example.com",
                        }
                    },
                },
            }
        )
        created_records: list[dict] = []
        entity_def = {
            "id": "entity.biz_job",
            "fields": [
                {"id": "biz_job.reference", "label": "Reference", "type": "string"},
                {"id": "biz_job.source_quote_number", "label": "Source Quote Number", "type": "string"},
                {"id": "biz_job.customer_name", "label": "Customer Name", "type": "string"},
                {"id": "biz_job.customer_email", "label": "Customer Email", "type": "email"},
                {"id": "biz_job.status", "label": "Status", "type": "string"},
            ],
        }

        class _FakeAppMain:
            def _find_entity_workflow(self, manifest, entity_id):
                return None

            def _validate_record_payload(self, entity_def, values, for_create=True, workflow=None):
                return [], dict(values)

            def _validate_lookup_fields(self, entity_def, registry, snapshot_fn):
                return []

            def _registry_for_request(self, request):
                return {}

            def _get_snapshot(self, request, module_id, manifest_hash):
                return None

            def _enforce_lookup_domains(self, entity_def, clean):
                return []

            def _create_record_with_computed_fields(self, request, entity_id, entity_def, clean):
                record = {"id": "job_1", **dict(clean)}
                created_records.append(record)
                return {"record_id": "job_1", "record": record}

            def _add_chatter_entry(self, *args, **kwargs):
                return None

            def _activity_add_record_created_event(self, *args, **kwargs):
                return None

            def _automation_record_snapshot(self, record_data, entity_def):
                return {"flat": dict(record_data)}

        with (
            patch("app.worker._get_app_main", return_value=_FakeAppMain()),
            patch("app.worker._find_entity_context", return_value=("jobs_module", entity_def, {"module": {"id": "jobs_module"}})),
            patch("app.worker._emit_automation_event"),
        ):
            _run_automation({"payload": {"run_id": run["id"]}}, "default", automation_store=store, job_store=job_store)

        run_after = store.get_run(run["id"])
        self.assertEqual(run_after["status"], "succeeded", run_after)
        self.assertEqual(len(created_records), 1, created_records)
        self.assertEqual(created_records[0]["biz_job.reference"], "JOB-QUO-2026-0028")
        self.assertEqual(created_records[0]["biz_job.source_quote_number"], "QUO-2026-0028")
        self.assertEqual(created_records[0]["biz_job.customer_name"], "Neetones")
        self.assertEqual(created_records[0]["biz_job.customer_email"], "customer@example.com")
        self.assertEqual(created_records[0]["biz_job.status"], "new")

    def test_create_record_step_renders_record_bracket_templates_at_action_runtime(self):
        store = MemoryAutomationStore()
        job_store = MemoryJobStore()
        automation = store.create(
            {
                "name": "Create Lead From Contact",
                "status": "published",
                "trigger": {"kind": "event", "event_types": ["biz_contacts.record.biz_contact.created"]},
                "steps": [
                    {
                        "id": "step_create_lead",
                        "kind": "action",
                        "action_id": "system.create_record",
                        "inputs": {
                            "entity_id": "entity.crm_lead",
                            "values": {
                                "crm_lead.title": "{{ record['biz_contact.name'] }}",
                                "crm_lead.contact_name": "{{ record['biz_contact.name'] }}",
                                "crm_lead.contact_email": "{{ record['biz_contact.email'] }}",
                                "crm_lead.company_id": "{{ record['biz_contact.company_entity_scope'] }}",
                            },
                        },
                    }
                ],
            }
        )
        run = store.create_run(
            {
                "automation_id": automation["id"],
                "status": "queued",
                "trigger_type": "biz_contacts.record.biz_contact.created",
                "trigger_payload": {
                    "event": "biz_contacts.record.biz_contact.created",
                    "entity_id": "entity.biz_contact",
                    "record_id": "contact_1",
                    "record": {
                        "fields": {
                            "biz_contact": {
                                "name": "Nico",
                                "email": "nico@example.com",
                                "company_entity_scope": "company_1",
                            },
                            "name": "Nico",
                            "email": "nico@example.com",
                            "company_entity_scope": "company_1",
                        },
                        "flat": {
                            "biz_contact.name": "Nico",
                            "biz_contact.email": "nico@example.com",
                            "biz_contact.company_entity_scope": "company_1",
                        },
                    },
                },
            }
        )
        created_records: list[dict] = []
        entity_def = {
            "id": "entity.crm_lead",
            "fields": [
                {"id": "crm_lead.title", "label": "Lead", "type": "string"},
                {"id": "crm_lead.contact_name", "label": "Contact Name", "type": "string"},
                {"id": "crm_lead.contact_email", "label": "Contact Email", "type": "email"},
                {"id": "crm_lead.company_id", "label": "Company", "type": "lookup"},
            ],
        }

        class _FakeAppMain:
            def _find_entity_workflow(self, manifest, entity_id):
                return None

            def _validate_record_payload(self, entity_def, values, for_create=True, workflow=None):
                return [], dict(values)

            def _validate_lookup_fields(self, entity_def, registry, snapshot_fn):
                return []

            def _registry_for_request(self, request):
                return {}

            def _get_snapshot(self, request, module_id, manifest_hash):
                return None

            def _enforce_lookup_domains(self, entity_def, clean):
                return []

            def _create_record_with_computed_fields(self, request, entity_id, entity_def, clean):
                record = {"id": "lead_1", **dict(clean)}
                created_records.append(record)
                return {"record_id": "lead_1", "record": record}

            def _add_chatter_entry(self, *args, **kwargs):
                return None

            def _activity_add_record_created_event(self, *args, **kwargs):
                return None

            def _automation_record_snapshot(self, record_data, entity_def):
                return {"flat": dict(record_data)}

        with (
            patch("app.worker._get_app_main", return_value=_FakeAppMain()),
            patch("app.worker._find_entity_context", return_value=("crm_module", entity_def, {"module": {"id": "crm_module"}})),
            patch("app.worker._emit_automation_event"),
        ):
            _run_automation({"payload": {"run_id": run["id"]}}, "default", automation_store=store, job_store=job_store)

        run_after = store.get_run(run["id"])
        self.assertEqual(run_after["status"], "succeeded", run_after)
        self.assertEqual(len(created_records), 1, created_records)
        self.assertEqual(created_records[0]["crm_lead.title"], "Nico")
        self.assertEqual(created_records[0]["crm_lead.contact_name"], "Nico")
        self.assertEqual(created_records[0]["crm_lead.contact_email"], "nico@example.com")
        self.assertEqual(created_records[0]["crm_lead.company_id"], "company_1")

    def test_create_then_update_record_steps_share_outputs_and_render_templates(self):
        store = MemoryAutomationStore()
        job_store = MemoryJobStore()
        automation = store.create(
            {
                "name": "Create Then Update Job",
                "status": "published",
                "trigger": {"kind": "event", "event_types": ["biz_quotes.action.quote_mark_accepted.clicked"]},
                "steps": [
                    {
                        "id": "step_create_job",
                        "kind": "action",
                        "action_id": "system.create_record",
                        "store_as": "create_job",
                        "inputs": {
                            "entity_id": "entity.biz_job",
                            "values": {
                                "biz_job.reference": "JOB-{{trigger.record.fields.biz_quote.quote_number}}",
                                "biz_job.source_quote_number": "{{trigger.record.fields.biz_quote.quote_number}}",
                                "biz_job.customer_name": "{{trigger.record.fields.biz_quote.customer_name}}",
                                "biz_job.status": "draft",
                            },
                        },
                    },
                    {
                        "id": "step_update_job",
                        "kind": "action",
                        "action_id": "system.update_record",
                        "inputs": {
                            "entity_id": "entity.biz_job",
                            "record_id": "{{steps.step_create_job.record_id}}",
                            "patch": {
                                "biz_job.status": "scheduled",
                                "biz_job.customer_name": "{{trigger.after.fields.biz_quote.customer_name}}",
                            },
                        },
                    },
                ],
            }
        )
        run = store.create_run(
            {
                "automation_id": automation["id"],
                "status": "queued",
                "trigger_type": "biz_quotes.action.quote_mark_accepted.clicked",
                "trigger_payload": {
                    "event": "biz_quotes.action.quote_mark_accepted.clicked",
                    "entity_id": "entity.biz_quote",
                    "record_id": "quote_1",
                    "record": {
                        "fields": {
                            "biz_quote": {
                                "quote_number": "QUO-2026-0042",
                                "customer_name": "Northwind",
                            },
                            "quote_number": "QUO-2026-0042",
                            "customer_name": "Northwind",
                        },
                        "flat": {
                            "biz_quote.quote_number": "QUO-2026-0042",
                            "biz_quote.customer_name": "Northwind",
                        }
                    },
                    "after": {
                        "fields": {
                            "biz_quote": {
                                "customer_name": "Northwind Holdings",
                            },
                            "customer_name": "Northwind Holdings",
                        },
                        "flat": {
                            "biz_quote.customer_name": "Northwind Holdings",
                        }
                    },
                },
            }
        )
        entity_def = {
            "id": "entity.biz_job",
            "fields": [
                {"id": "biz_job.reference", "label": "Reference", "type": "string"},
                {"id": "biz_job.source_quote_number", "label": "Source Quote Number", "type": "string"},
                {"id": "biz_job.customer_name", "label": "Customer Name", "type": "string"},
                {"id": "biz_job.status", "label": "Status", "type": "string"},
            ],
        }
        records_by_id: dict[str, dict] = {}

        class _FakeAppMain:
            def _find_entity_workflow(self, manifest, entity_id):
                return None

            def _validate_record_payload(self, entity_def, values, for_create=True, workflow=None):
                return [], dict(values)

            def _validate_lookup_fields(self, entity_def, registry, snapshot_fn):
                return []

            def _registry_for_request(self, request):
                return {}

            def _get_snapshot(self, request, module_id, manifest_hash):
                return None

            def _enforce_lookup_domains(self, entity_def, clean):
                return []

            def _create_record_with_computed_fields(self, request, entity_id, entity_def, clean):
                record = {"id": "job_1", **dict(clean)}
                records_by_id["job_1"] = record
                return {"record_id": "job_1", "record": dict(record)}

            def _validate_patch_payload(self, entity_def, patch, before_record, workflow=None):
                updated = dict(before_record or {})
                updated.update(dict(patch))
                return [], updated

            def _update_record_with_computed_fields(self, request, entity_id, entity_def, record_id, updated):
                records_by_id[record_id] = dict(updated)
                return {"record_id": record_id, "record": dict(updated)}

            def _add_chatter_entry(self, *args, **kwargs):
                return None

            def _activity_add_record_created_event(self, *args, **kwargs):
                return None

            def _automation_record_snapshot(self, record_data, entity_def):
                return {"flat": dict(record_data)}

            def _changed_fields(self, before_record, after_record):
                changed = []
                before_record = before_record or {}
                after_record = after_record or {}
                for key in sorted(set(before_record) | set(after_record)):
                    if before_record.get(key) != after_record.get(key):
                        changed.append(key)
                return changed

        def fake_find_existing_record(entity_id, record_id):
            record = records_by_id.get(record_id)
            if not isinstance(record, dict):
                return None
            return entity_id, {"record": dict(record)}

        with (
            patch("app.worker._get_app_main", return_value=_FakeAppMain()),
            patch("app.worker._find_entity_context", return_value=("jobs_module", entity_def, {"module": {"id": "jobs_module"}})),
            patch("app.worker._find_existing_record", side_effect=fake_find_existing_record),
            patch("app.worker._emit_automation_event"),
        ):
            _run_automation({"payload": {"run_id": run["id"]}}, "default", automation_store=store, job_store=job_store)

        run_after = store.get_run(run["id"])
        self.assertEqual(run_after["status"], "succeeded", run_after)
        self.assertEqual(records_by_id["job_1"]["biz_job.reference"], "JOB-QUO-2026-0042")
        self.assertEqual(records_by_id["job_1"]["biz_job.source_quote_number"], "QUO-2026-0042")
        self.assertEqual(records_by_id["job_1"]["biz_job.customer_name"], "Northwind Holdings")
        self.assertEqual(records_by_id["job_1"]["biz_job.status"], "scheduled")

    def test_create_record_action_resolves_var_references_before_validation(self):
        created_records: list[dict] = []
        entity_def = {
            "id": "entity.crm_lead",
            "fields": [
                {"id": "crm_lead.contact_name", "label": "Contact Name", "type": "string"},
                {"id": "crm_lead.contact_email", "label": "Contact Email", "type": "email"},
                {"id": "crm_lead.contact_phone", "label": "Contact Phone", "type": "string"},
            ],
        }

        class _FakeAppMain:
            def _find_entity_workflow(self, manifest, entity_id):
                return None

            def _validate_record_payload(self, entity_def, values, for_create=True, workflow=None):
                return [], dict(values)

            def _validate_lookup_fields(self, entity_def, registry, snapshot_fn):
                return []

            def _registry_for_request(self, request):
                return {}

            def _get_snapshot(self, request, module_id, manifest_hash):
                return None

            def _enforce_lookup_domains(self, entity_def, clean):
                return []

            def _create_record_with_computed_fields(self, request, entity_id, entity_def, clean):
                record = {"id": "lead_1", **dict(clean)}
                created_records.append(record)
                return {"record_id": "lead_1", "record": record}

            def _add_chatter_entry(self, *args, **kwargs):
                return None

            def _activity_add_record_created_event(self, *args, **kwargs):
                return None

            def _automation_record_snapshot(self, record_data, entity_def):
                return {"flat": dict(record_data)}

        ctx = {
            "trigger": {
                "entity_id": "entity.biz_contact",
                "record_id": "contact_1",
                "record": {
                    "fields": {
                        "biz_contact": {
                            "name": "Nico",
                            "email": "nico@example.com",
                            "phone": "021000111",
                        },
                        "name": "Nico",
                        "email": "nico@example.com",
                        "phone": "021000111",
                    }
                },
            }
        }

        with (
            patch("app.worker._get_app_main", return_value=_FakeAppMain()),
            patch("app.worker._find_entity_context", return_value=("crm_module", entity_def, {"module": {"id": "crm_module"}})),
            patch("app.worker._emit_automation_event"),
        ):
            result = _handle_system_action(
                "system.create_record",
                {
                    "entity_id": "entity.crm_lead",
                    "values": {
                        "crm_lead.contact_name": {"var": "trigger.record.fields.biz_contact.name"},
                        "crm_lead.contact_email": {"var": "trigger.record.fields.biz_contact.email"},
                        "crm_lead.contact_phone": {"var": "trigger.record.fields.biz_contact.phone"},
                    },
                },
                ctx,
                None,
            )

        self.assertEqual(result["record_id"], "lead_1")
        self.assertEqual(
            created_records,
            [
                {
                    "id": "lead_1",
                    "crm_lead.contact_name": "Nico",
                    "crm_lead.contact_email": "nico@example.com",
                    "crm_lead.contact_phone": "021000111",
                }
            ],
        )


if __name__ == "__main__":
    unittest.main()
