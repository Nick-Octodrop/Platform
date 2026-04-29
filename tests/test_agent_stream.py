import json
import os
import sys
import unittest
from unittest.mock import patch

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from fastapi.testclient import TestClient

os.environ["USE_DB"] = "0"
os.environ["OCTO_DISABLE_AUTH"] = "1"
os.environ["SUPABASE_URL"] = "http://localhost"

from app.agent_stream import summarize_build_spec, diff_manifest, preview_calls
import app.main as main


class TestAgentStreamHelpers(unittest.TestCase):
    def test_summarize_build_spec(self) -> None:
        spec = {
            "goal": "Build contacts",
            "entities": [{"id": "entity.contact"}],
            "relations": [{"from_entity": "entity.job"}],
            "ui_patterns": [{"pattern": "entity_list_form", "entity": "entity.contact"}],
        }
        bullets = summarize_build_spec(spec)
        self.assertTrue(any("Goal" in item for item in bullets))
        self.assertTrue(any("entity.contact" in item for item in bullets))

    def test_diff_manifest_counts(self) -> None:
        before = {"entities": [{"id": "entity.a"}], "pages": []}
        after = {"entities": [{"id": "entity.a"}, {"id": "entity.b"}], "pages": [{"id": "p1"}]}
        summary = diff_manifest(before, after)
        self.assertEqual(summary["entities_added"], 1)
        self.assertEqual(summary["pages_added"], 1)

    def test_preview_calls(self) -> None:
        calls = [
            {"tool": "ensure_entity", "module_id": "m1", "entity_id": "entity.contact"},
            {"tool": "ensure_nav", "module_id": "m1"},
        ]
        preview = preview_calls(calls, debug=False)
        self.assertEqual(preview[0]["tool"], "ensure_entity")


class TestAgentStreamEndpoint(unittest.TestCase):
    @staticmethod
    def _stream_event_names(response) -> list[str]:
        events = []
        for line in response.iter_lines():
            if line.startswith("event:"):
                events.append(line.replace("event: ", ""))
            if line.startswith("event: done"):
                break
        return events

    @staticmethod
    def _stream_frames(response) -> list[tuple[str, dict]]:
        frames = []
        current_event = ""
        for line in response.iter_lines():
            if line.startswith("event:"):
                current_event = line.replace("event: ", "")
            elif line.startswith("data:"):
                raw = line.replace("data: ", "")
                try:
                    payload = json.loads(raw)
                except Exception:
                    payload = {}
                frames.append((current_event, payload))
                if current_event == "done":
                    break
        return frames

    def test_stream_event_order(self) -> None:
        build_spec = {"goal": "Build contacts", "entities": [{"id": "entity.contact"}]}

        def fake_openai(_messages, model=None):
            content = json.dumps(
                {
                    "plan": {"goal": "Build contacts", "steps": ["Ensure entity"]},
                    "calls": [
                        {
                            "tool": "ensure_entity",
                            "module_id": "module_test",
                            "entity_id": "entity.contact",
                        }
                    ],
                    "ops_by_module": [],
                    "notes": "ok",
                }
            )
            return {"choices": [{"message": {"content": content}}]}

        with TestClient(main.app) as client, patch.object(main, "_openai_chat_completion", fake_openai), patch.object(
            main, "_openai_configured", lambda: True
        ), patch.object(main, "validate_manifest_raw", lambda manifest, expected_module_id=None: (manifest, [], [])), patch.object(
            main, "_studio2_strict_validate", lambda manifest, expected_module_id=None: []
        ), patch.object(main, "_studio2_completeness_check", lambda manifest: []), patch.object(
            main, "_studio2_design_warnings", lambda manifest: []
        ):
            with client.stream(
                "POST",
                "/studio2/agent/chat/stream",
                json={"module_id": "module_test", "message": "Build contacts", "build_spec": build_spec},
            ) as resp:
                events = self._stream_event_names(resp)
                # Ensure key phases appear in order
                self.assertIn("run_started", events)
                self.assertIn("stage_started", events)
                self.assertIn("stage_done", events)
                self.assertIn("planner_result", events)
                self.assertIn("planner_done", events)
                self.assertIn("builder_started", events)
                self.assertIn("builder_done", events)
                self.assertIn("apply_result", events)
                self.assertIn("apply_done", events)
                self.assertIn("validate_result", events)
                self.assertIn("validate_done", events)
                self.assertIn("final_done", events)
                self.assertIn("done", events)

    def test_document_template_ai_plan_stream_event_order(self) -> None:
        actor = {
            "user_id": "user-1",
            "email": "templates@example.com",
            "role": "owner",
            "workspace_role": "owner",
            "platform_role": "superadmin",
            "workspace_id": "default",
            "workspaces": [{"workspace_id": "default", "role": "owner", "workspace_name": "Default"}],
            "api_scopes": ["templates.manage"],
            "claims": {},
        }
        with TestClient(main.app) as client, patch.object(main, "_resolve_actor", lambda _request: actor):
            created = client.post(
                "/documents/templates",
                json={
                    "name": "Invoice",
                    "description": "",
                    "filename_pattern": "invoice",
                    "html": "<table><tr><td>Invoice</td></tr></table>",
                    "header_html": "<div><img src='{{ workspace.logo_url }}' /></div>",
                },
            ).json()
            template_id = created["template"]["id"]

            def fake_plan(*args, **kwargs):
                return {
                    "summary": "Prepared a document template proposal.",
                    "draft": {
                        "name": "Invoice",
                        "description": "Customer invoice",
                        "filename_pattern": "invoice-{{ record['invoice.number'] }}",
                        "html": "<h1>Invoice</h1><p>{{ record['invoice.number'] }}</p>",
                        "header_html": "",
                        "footer_html": "",
                    },
                    "warnings": [],
                    "assumptions": [],
                }

            with patch.object(main, "_artifact_ai_generate_plan", fake_plan), patch.object(main, "_openai_configured", lambda: True):
                with client.stream(
                    "POST",
                    f"/documents/templates/{template_id}/ai/plan/stream",
                    json={
                        "prompt": "Improve the invoice layout.",
                        "draft": created["template"],
                        "focus": "design",
                        "hints": {"selected_entity_id": "entity.billing_invoice"},
                    },
                ) as resp:
                    events = self._stream_event_names(resp)
                with client.stream(
                    "POST",
                    f"/documents/templates/{template_id}/ai/plan/stream",
                    json={
                        "prompt": "Improve the invoice layout.",
                        "draft": created["template"],
                        "focus": "design",
                        "hints": {"selected_entity_id": "entity.billing_invoice"},
                    },
                ) as resp:
                    frames = self._stream_frames(resp)
        self.assertIn("run_started", events)
        self.assertIn("stage_started", events)
        self.assertIn("context_resolved", events)
        self.assertIn("draft_loaded", events)
        self.assertIn("plan_requested", events)
        self.assertIn("draft_refined", events)
        self.assertIn("plan_result", events)
        self.assertIn("stage_done", events)
        self.assertIn("validate_result", events)
        self.assertIn("final_done", events)
        self.assertIn("done", events)
        context_frame = next(payload for event_name, payload in frames if event_name == "context_resolved")
        self.assertEqual(context_frame.get("data", {}).get("selected_entity_label"), "Billing Invoice")
        self.assertEqual(context_frame.get("data", {}).get("requested_focus_label"), "design")
        self.assertTrue("supports_line_items" in (context_frame.get("data") or {}))
        self.assertTrue(context_frame.get("data", {}).get("uses_table_layout"))
        self.assertTrue(context_frame.get("data", {}).get("has_header_footer_sections"))
        self.assertEqual(
            context_frame.get("data", {}).get("profile_summary"),
            "Reviewing the Billing Invoice line-item table layout for design changes.",
        )
        draft_loaded_frame = next(payload for event_name, payload in frames if event_name == "draft_loaded")
        self.assertEqual(
            draft_loaded_frame.get("data", {}).get("summary"),
            "Loaded the Billing Invoice document template draft for design changes.",
        )
        plan_requested_frame = next(payload for event_name, payload in frames if event_name == "plan_requested")
        self.assertEqual(
            plan_requested_frame.get("data", {}).get("summary"),
            "Planning the next Billing Invoice document template update for design changes.",
        )
        refine_frame = next(payload for event_name, payload in frames if event_name == "draft_refined")
        self.assertEqual(
            refine_frame.get("data", {}).get("summary"),
            "Refining the Billing Invoice document template for design changes.",
        )
        plan_frame = next(payload for event_name, payload in frames if event_name == "plan_result")
        self.assertEqual(plan_frame.get("data", {}).get("summary"), "Prepared a document template proposal.")
        validate_frame = next(payload for event_name, payload in frames if event_name == "validate_result")
        self.assertEqual(
            validate_frame.get("data", {}).get("summary"),
            "Validation passed for the proposed document template draft.",
        )

    def test_email_template_ai_plan_stream_event_order(self) -> None:
        actor = {
            "user_id": "user-1",
            "email": "templates@example.com",
            "role": "owner",
            "workspace_role": "owner",
            "platform_role": "superadmin",
            "workspace_id": "default",
            "workspaces": [{"workspace_id": "default", "role": "owner", "workspace_name": "Default"}],
            "api_scopes": ["templates.manage"],
            "claims": {},
        }
        with TestClient(main.app) as client, patch.object(main, "_resolve_actor", lambda _request: actor):
            created = client.post(
                "/email/templates",
                json={
                    "name": "Invoice Email",
                    "description": "",
                    "subject": "Invoice {{ record['billing_invoice.invoice_number'] }}",
                    "body_html": "<img src='{{ workspace.logo_url }}' /><a style='display:inline-block'>Pay now</a>",
                    "body_text": "Invoice",
                },
            ).json()
            template_id = created["template"]["id"]

            def fake_plan(*args, **kwargs):
                return {
                    "summary": "Prepared an email template proposal.",
                    "draft": {
                        "name": "Invoice Email",
                        "description": "Customer invoice email",
                        "subject": "Invoice {{ record['billing_invoice.invoice_number'] }}",
                        "body_html": "<p>Invoice {{ record['billing_invoice.invoice_number'] }}</p>",
                        "body_text": "Invoice {{ record['billing_invoice.invoice_number'] }}",
                    },
                    "warnings": [],
                    "assumptions": [],
                }

            with patch.object(main, "_artifact_ai_generate_plan", fake_plan), patch.object(main, "_openai_configured", lambda: True):
                with client.stream(
                    "POST",
                    f"/email/templates/{template_id}/ai/plan/stream",
                    json={
                        "prompt": "Tighten the invoice email wording.",
                        "draft": created["template"],
                        "focus": "content",
                        "hints": {"selected_entity_id": "entity.billing_invoice"},
                    },
                ) as resp:
                    events = self._stream_event_names(resp)
                with client.stream(
                    "POST",
                    f"/email/templates/{template_id}/ai/plan/stream",
                    json={
                        "prompt": "Tighten the invoice email wording.",
                        "draft": created["template"],
                        "focus": "content",
                        "hints": {"selected_entity_id": "entity.billing_invoice"},
                    },
                ) as resp:
                    frames = self._stream_frames(resp)
        self.assertIn("run_started", events)
        self.assertIn("stage_started", events)
        self.assertIn("context_resolved", events)
        self.assertIn("draft_loaded", events)
        self.assertIn("plan_requested", events)
        self.assertIn("draft_refined", events)
        self.assertIn("plan_result", events)
        self.assertIn("stage_done", events)
        self.assertIn("validate_result", events)
        self.assertIn("final_done", events)
        self.assertIn("done", events)
        context_frame = next(payload for event_name, payload in frames if event_name == "context_resolved")
        self.assertEqual(context_frame.get("data", {}).get("selected_entity_label"), "Billing Invoice")
        self.assertEqual(context_frame.get("data", {}).get("requested_focus_label"), "content")
        self.assertTrue(context_frame.get("data", {}).get("uses_logo_reference"))
        self.assertTrue(context_frame.get("data", {}).get("has_button_like_cta"))
        self.assertEqual(
            context_frame.get("data", {}).get("profile_summary"),
            "Reviewing the Billing Invoice CTA-driven email layout for content changes.",
        )
        draft_loaded_frame = next(payload for event_name, payload in frames if event_name == "draft_loaded")
        self.assertEqual(
            draft_loaded_frame.get("data", {}).get("summary"),
            "Loaded the Billing Invoice email template draft for content changes.",
        )
        plan_requested_frame = next(payload for event_name, payload in frames if event_name == "plan_requested")
        self.assertEqual(
            plan_requested_frame.get("data", {}).get("summary"),
            "Planning the next Billing Invoice email template update for content changes.",
        )
        refine_frame = next(payload for event_name, payload in frames if event_name == "draft_refined")
        self.assertEqual(
            refine_frame.get("data", {}).get("summary"),
            "Refining the Billing Invoice email template for content changes.",
        )
        plan_frame = next(payload for event_name, payload in frames if event_name == "plan_result")
        self.assertEqual(plan_frame.get("data", {}).get("summary"), "Prepared an email template proposal.")
        validate_frame = next(payload for event_name, payload in frames if event_name == "validate_result")
        self.assertEqual(
            validate_frame.get("data", {}).get("summary"),
            "Validation passed for the proposed email template draft.",
        )

    def test_email_template_ai_plan_stream_done_payload_replaces_generic_ready_summary(self) -> None:
        actor = {
            "user_id": "user-1",
            "email": "templates@example.com",
            "role": "owner",
            "workspace_role": "owner",
            "platform_role": "superadmin",
            "workspace_id": "default",
            "workspaces": [{"workspace_id": "default", "role": "owner", "workspace_name": "Default"}],
            "api_scopes": ["templates.manage"],
            "claims": {},
        }
        with TestClient(main.app) as client, patch.object(main, "_resolve_actor", lambda _request: actor):
            created = client.post(
                "/email/templates",
                json={
                    "name": "Welcome",
                    "description": "",
                    "subject": "Hello",
                    "body_html": "<p>Hello</p>",
                    "body_text": "Hello",
                },
            ).json()
            template_id = created["template"]["id"]

            def fake_plan(*args, **kwargs):
                return {
                    "summary": "Draft ready to apply.",
                    "draft": {
                        "name": "Sales Order Email",
                        "description": "Sent for new sales orders.",
                        "subject": "Sales order {{ record['sales_order.order_number'] }} received",
                        "body_html": "<p>New sales order received.</p>",
                        "body_text": "New sales order received.",
                        "variables_schema": {"entity_id": "entity.sales_order"},
                    },
                    "warnings": [],
                    "assumptions": [],
                }

            with patch.object(main, "_artifact_ai_generate_plan", fake_plan), patch.object(main, "_openai_configured", lambda: True):
                with client.stream(
                    "POST",
                    f"/email/templates/{template_id}/ai/plan/stream",
                    json={
                        "prompt": "Create a draft email template for sales orders.",
                        "draft": created["template"],
                        "hints": {"selected_entity_id": "entity.sales_order"},
                    },
                ) as resp:
                    frames = self._stream_frames(resp)

        done_frame = next(payload for event_name, payload in frames if event_name == "done")
        final_payload = done_frame.get("data", {}).get("final_payload", {})
        self.assertEqual(final_payload.get("summary"), "Prepared an updated email template draft.")
        self.assertFalse(final_payload.get("noop"), final_payload)

    def test_automation_ai_plan_stream_event_order(self) -> None:
        actor = {
            "user_id": "user-1",
            "email": "admin@example.com",
            "role": "owner",
            "workspace_role": "owner",
            "platform_role": "superadmin",
            "workspace_id": "default",
            "workspaces": [{"workspace_id": "default", "role": "owner", "workspace_name": "Default"}],
            "claims": {},
        }
        with TestClient(main.app) as client, patch.object(main, "_resolve_actor", lambda _request: actor):
            created = client.post(
                "/automations",
                json={
                    "name": "Notify on create",
                    "description": "",
                    "status": "draft",
                    "trigger": {"kind": "event", "event_types": ["record.created"], "filters": []},
                    "steps": [
                        {
                            "kind": "delay",
                            "seconds": 60,
                        },
                        {
                            "kind": "condition",
                            "expr": {"op": "eq", "left": {"var": "trigger.event_type"}, "right": {"literal": "record.created"}},
                            "then_steps": [
                                {
                                    "kind": "action",
                                    "action_id": "system.notify",
                                    "inputs": {
                                        "recipient_user_id": "user-1",
                                        "title": "Condition matched",
                                        "body": "The condition matched.",
                                    },
                                },
                            ],
                        },
                        {
                            "kind": "action",
                            "action_id": "system.notify",
                            "inputs": {
                                "recipient_user_id": "user-1",
                                "title": "Created",
                                "body": "A record was created.",
                            },
                        }
                    ],
                },
            ).json()
            automation_id = created["automation"]["id"]

            def fake_plan(*args, **kwargs):
                return {
                    "summary": "Prepared an automation proposal.",
                    "draft": {
                        "name": "Notify on create",
                        "description": "Updated automation",
                        "status": "draft",
                        "trigger": {"kind": "event", "event_types": ["record.created"], "filters": []},
                        "steps": [
                            {
                                "kind": "action",
                                "action_id": "system.notify",
                                "inputs": {
                                    "recipient_user_id": "user-1",
                                    "title": "Created",
                                    "body": "A record was created.",
                                },
                            }
                        ],
                    },
                    "warnings": [],
                    "assumptions": [],
                }

            with patch.object(main, "_artifact_ai_generate_plan", fake_plan), patch.object(main, "_openai_configured", lambda: True):
                with client.stream(
                    "POST",
                    f"/automations/{automation_id}/ai/plan/stream",
                    json={
                        "prompt": "Tighten the notification wording.",
                        "draft": created["automation"],
                        "focus": "content",
                    },
                ) as resp:
                    events = self._stream_event_names(resp)
                with client.stream(
                    "POST",
                    f"/automations/{automation_id}/ai/plan/stream",
                    json={
                        "prompt": "Tighten the notification wording.",
                        "draft": created["automation"],
                        "focus": "content",
                    },
                ) as resp:
                    frames = self._stream_frames(resp)
        self.assertIn("run_started", events)
        self.assertIn("stage_started", events)
        self.assertIn("context_resolved", events)
        self.assertIn("draft_loaded", events)
        self.assertIn("plan_requested", events)
        self.assertIn("draft_refined", events)
        self.assertIn("plan_result", events)
        self.assertIn("stage_done", events)
        self.assertIn("validate_result", events)
        self.assertIn("final_done", events)
        self.assertIn("done", events)
        plan_frame = next(payload for event_name, payload in frames if event_name == "plan_result")
        self.assertEqual(plan_frame.get("data", {}).get("summary"), "Prepared an automation proposal.")
        context_frame = next(payload for event_name, payload in frames if event_name == "context_resolved")
        self.assertEqual(context_frame.get("data", {}).get("step_count"), 4)
        self.assertEqual(context_frame.get("data", {}).get("requested_focus_label"), "content")
        self.assertEqual(context_frame.get("data", {}).get("trigger_kind"), "event")
        self.assertEqual(context_frame.get("data", {}).get("condition_step_count"), 1)
        self.assertEqual(context_frame.get("data", {}).get("delay_step_count"), 1)
        self.assertEqual(
            context_frame.get("data", {}).get("profile_summary"),
            "Reviewing the current event-triggered 4-step automation with 1 condition and 1 delay for content changes.",
        )
        draft_loaded_frame = next(payload for event_name, payload in frames if event_name == "draft_loaded")
        self.assertEqual(
            draft_loaded_frame.get("data", {}).get("summary"),
            "Loaded the current 3-step automation draft for content changes.",
        )
        plan_requested_frame = next(payload for event_name, payload in frames if event_name == "plan_requested")
        self.assertEqual(
            plan_requested_frame.get("data", {}).get("summary"),
            "Planning the next update for the current 3-step automation around content changes.",
        )
        refine_frame = next(payload for event_name, payload in frames if event_name == "draft_refined")
        self.assertEqual(
            refine_frame.get("data", {}).get("summary"),
            "Refining the current event-triggered 1-step automation for content changes.",
        )
        validate_frame = next(payload for event_name, payload in frames if event_name == "validate_result")
        self.assertEqual(
            validate_frame.get("data", {}).get("summary"),
            "Validation found 1 issue in the proposed automation draft.",
        )

    def test_automation_ai_plan_stream_done_payload_preserves_noop_summary(self) -> None:
        actor = {
            "user_id": "user-1",
            "email": "automation@example.com",
            "role": "owner",
            "workspace_role": "owner",
            "platform_role": "superadmin",
            "workspace_id": "default",
            "workspaces": [{"workspace_id": "default", "role": "owner", "workspace_name": "Default"}],
            "api_scopes": ["automations.manage"],
            "claims": {},
        }
        with TestClient(main.app) as client, patch.object(main, "_resolve_actor", lambda _request: actor):
            created = client.post(
                "/automations",
                json={
                    "name": "Order Email",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["record.updated"], "filters": []},
                    "steps": [
                        {
                            "kind": "action",
                            "action_id": "system.send_email",
                            "inputs": {
                                "to_internal_emails": ["ops@example.com"],
                                "subject": "New order received",
                                "body_text": "A new order arrived.",
                            },
                        }
                    ],
                },
            ).json()
            automation_id = created["automation"]["id"]

            def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
                return {
                    "choices": [{
                        "message": {
                            "content": json.dumps(
                                {
                                    "summary": "Automation draft ready to apply.",
                                    "draft": created["automation"],
                                    "assumptions": [],
                                    "warnings": [],
                                }
                            )
                        }
                    }]
                }

            with patch.object(main, "_openai_chat_completion", fake_openai), patch.object(main, "_openai_configured", lambda: True):
                with client.stream(
                    "POST",
                    f"/automations/{automation_id}/ai/plan/stream",
                    json={
                        "prompt": "can you fix it so we get notified of new orders? its not working",
                        "draft": created["automation"],
                    },
                ) as resp:
                    frames = self._stream_frames(resp)

        done_frame = next(payload for event_name, payload in frames if event_name == "done")
        final_payload = done_frame.get("data", {}).get("final_payload", {})
        self.assertTrue(final_payload.get("noop"), final_payload)
        self.assertIn("Likely issue:", final_payload.get("summary", ""))

    def test_automation_ai_plan_stream_done_payload_preserves_diagnostic_summary_when_input_is_still_required(self) -> None:
        actor = {
            "user_id": "user-1",
            "email": "automation@example.com",
            "role": "owner",
            "workspace_role": "owner",
            "platform_role": "superadmin",
            "workspace_id": "default",
            "workspaces": [{"workspace_id": "default", "role": "owner", "workspace_name": "Default"}],
            "api_scopes": ["automations.manage"],
            "claims": {},
        }
        with TestClient(main.app) as client, patch.object(main, "_resolve_actor", lambda _request: actor):
            created = client.post(
                "/automations",
                json={
                    "name": "Shopify Orders Inbound",
                    "description": "",
                    "trigger": {
                        "kind": "event",
                        "event_types": [
                            "integration.webhook.shopify.orders.create",
                            "integration.webhook.shopify.orders.updated",
                            "integration.webhook.shopify.orders.cancelled",
                        ],
                        "filters": [],
                    },
                    "steps": [
                        {
                            "kind": "action",
                            "action_id": "system.notify",
                            "inputs": {
                                "recipient_user_id": "user-1",
                                "title": "New Shopify Order!",
                                "body": "A new Shopify order arrived.",
                            },
                        },
                        {
                            "kind": "action",
                            "action_id": "system.send_email",
                            "inputs": {
                                "to_internal_emails": ["ops@example.com"],
                                "subject": "New Shopify Order!",
                                "body_text": "A new Shopify order arrived.",
                            },
                        },
                    ],
                },
            ).json()
            automation_id = created["automation"]["id"]

            def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
                return {
                    "choices": [{
                        "message": {
                            "content": json.dumps(
                                {
                                    "summary": "Automation draft ready to apply.",
                                    "draft": created["automation"],
                                    "assumptions": [],
                                    "warnings": [],
                                }
                            )
                        }
                    }]
                }

            with patch.object(main, "_openai_chat_completion", fake_openai), patch.object(main, "_openai_configured", lambda: True):
                with client.stream(
                    "POST",
                    f"/automations/{automation_id}/ai/plan/stream",
                    json={
                        "prompt": "can you fix the send notification and email? im not receiving them?",
                        "draft": created["automation"],
                    },
                ) as resp:
                    frames = self._stream_frames(resp)

        done_frame = next(payload for event_name, payload in frames if event_name == "done")
        final_payload = done_frame.get("data", {}).get("final_payload", {})
        self.assertFalse(final_payload.get("noop"), final_payload)
        self.assertIn("Needs input before apply", final_payload.get("summary", ""))
        self.assertIn("Likely issue:", final_payload.get("summary", ""))
        self.assertTrue(final_payload.get("required_questions"), final_payload)

    def test_automation_ai_plan_stream_done_payload_handles_create_new_automation_prompt_as_current_draft_update(self) -> None:
        actor = {
            "user_id": "user-1",
            "email": "automation@example.com",
            "role": "owner",
            "workspace_role": "owner",
            "platform_role": "superadmin",
            "workspace_id": "default",
            "workspaces": [{"workspace_id": "default", "role": "owner", "workspace_name": "Default"}],
            "api_scopes": ["automations.manage"],
            "claims": {},
        }
        with TestClient(main.app) as client, patch.object(main, "_resolve_actor", lambda _request: actor):
            created = client.post(
                "/automations",
                json={
                    "name": "Order Email",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["record.updated"], "filters": []},
                    "steps": [
                        {
                            "kind": "action",
                            "action_id": "system.send_email",
                            "inputs": {
                                "to_internal_emails": ["ops@example.com"],
                                "subject": "New order received",
                                "body_text": "A new order arrived.",
                            },
                        }
                    ],
                },
            ).json()
            automation_id = created["automation"]["id"]

            def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
                next_draft = {
                    **created["automation"],
                    "name": "Order Notification Email",
                    "trigger": {"kind": "event", "event_types": ["record.created"], "filters": []},
                    "steps": [
                        {
                            "kind": "action",
                            "action_id": "system.notify",
                            "inputs": {
                                "recipient_user_id": "user-1",
                                "title": "New order received",
                                "body": "A new order arrived.",
                            },
                        },
                        {
                            "kind": "action",
                            "action_id": "system.send_email",
                            "inputs": {
                                "to_internal_emails": ["ops@example.com"],
                                "subject": "New order received",
                                "body_text": "A new order arrived.",
                            },
                        },
                    ],
                }
                return {
                    "choices": [{
                        "message": {
                            "content": json.dumps(
                                {
                                    "summary": "Reshaped the current draft into an order notification and email automation.",
                                    "draft": next_draft,
                                    "assumptions": [],
                                    "warnings": [],
                                }
                            )
                        }
                    }]
                }

            with patch.object(main, "_openai_chat_completion", fake_openai), patch.object(main, "_openai_configured", lambda: True):
                with client.stream(
                    "POST",
                    f"/automations/{automation_id}/ai/plan/stream",
                    json={
                        "prompt": "can we create a new automation when we recieve an order to send a notification, and also a email",
                        "draft": created["automation"],
                    },
                ) as resp:
                    frames = self._stream_frames(resp)

        done_frame = next(payload for event_name, payload in frames if event_name == "done")
        final_payload = done_frame.get("data", {}).get("final_payload", {})
        self.assertFalse(final_payload.get("noop"), final_payload)
        self.assertEqual(final_payload.get("draft", {}).get("name"), "Order Notification Email")
        self.assertEqual(len(final_payload.get("draft", {}).get("steps") or []), 2)
        self.assertNotIn("This editor can only update the current automation", final_payload.get("summary", ""))

    def test_automation_ai_plan_stream_done_payload_rejects_ready_summary_for_invalid_changed_draft(self) -> None:
        actor = {
            "user_id": "user-1",
            "email": "automation@example.com",
            "role": "owner",
            "workspace_role": "owner",
            "platform_role": "superadmin",
            "workspace_id": "default",
            "workspaces": [{"workspace_id": "default", "role": "owner", "workspace_name": "Default"}],
            "api_scopes": ["automations.manage"],
            "claims": {},
        }
        with TestClient(main.app) as client, patch.object(main, "_resolve_actor", lambda _request: actor):
            created = client.post(
                "/automations",
                json={
                    "name": "New Automation",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["record.updated"], "filters": []},
                    "steps": [
                        {
                            "kind": "action",
                            "action_id": "system.notify",
                            "inputs": {
                                "recipient_user_id": "user-1",
                                "title": "Automation",
                                "body": "Body",
                            },
                        }
                    ],
                },
            ).json()
            automation_id = created["automation"]["id"]
            placeholder_draft = {
                "name": "New Automation",
                "description": "",
                "trigger": {"kind": "event", "event_types": [], "filters": []},
                "steps": [],
            }

            def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
                return {
                    "choices": [{
                        "message": {
                            "content": json.dumps(
                                {
                                    "summary": "Automation draft ready to apply.",
                                    "draft": {
                                        **placeholder_draft,
                                        "name": "Order alerts",
                                        "steps": [
                                            {
                                                "kind": "action",
                                                "action_id": "system.send_email",
                                                "inputs": {"subject": "New order received"},
                                            }
                                        ],
                                    },
                                    "assumptions": [],
                                    "warnings": [],
                                }
                            )
                        }
                    }]
                }

            with patch.object(main, "_openai_chat_completion", fake_openai), patch.object(main, "_openai_configured", lambda: True):
                with client.stream(
                    "POST",
                    f"/automations/{automation_id}/ai/plan/stream",
                    json={
                        "prompt": "can we create a new automation when we recieve an order to send a notification, and also a email",
                        "draft": placeholder_draft,
                    },
                ) as resp:
                    frames = self._stream_frames(resp)

        done_frame = next(payload for event_name, payload in frames if event_name == "done")
        final_payload = done_frame.get("data", {}).get("final_payload", {})
        self.assertIn("still needs fixes before apply", final_payload.get("summary", ""))
        self.assertNotEqual(final_payload.get("summary"), "Automation draft ready to apply.")

    def test_document_template_ai_plan_stream_decision_event_includes_label(self) -> None:
        actor = {
            "user_id": "user-1",
            "email": "templates@example.com",
            "role": "owner",
            "workspace_role": "owner",
            "platform_role": "superadmin",
            "workspace_id": "default",
            "workspaces": [{"workspace_id": "default", "role": "owner", "workspace_name": "Default"}],
            "api_scopes": ["templates.manage"],
            "claims": {},
        }
        with TestClient(main.app) as client, patch.object(main, "_resolve_actor", lambda _request: actor):
            created = client.post(
                "/documents/templates",
                json={
                    "name": "Invoice",
                    "description": "",
                    "filename_pattern": "invoice",
                    "html": "<p>Invoice</p>",
                },
            ).json()
            template_id = created["template"]["id"]

            def fake_plan(*args, **kwargs):
                return {
                    "summary": "Prepared a document template proposal.",
                    "draft": created["template"],
                    "warnings": [],
                    "assumptions": [],
                }

            def fake_apply(*args, **kwargs):
                return (
                    created["template"],
                    [],
                    [],
                    ["Choose which record type this invoice should target."],
                    {
                        "decision_slots": [
                            {
                                "slot_id": "target_entity",
                                "label": "Choose target entity",
                                "options": [
                                    {"id": "billing_invoice", "label": "Billing Invoice", "value": "entity.billing_invoice"},
                                ],
                            }
                        ]
                    },
                )

            with patch.object(main, "_artifact_ai_generate_plan", fake_plan), patch.object(main, "_artifact_ai_apply_scoped_template_hints", fake_apply), patch.object(main, "_openai_configured", lambda: True):
                with client.stream(
                    "POST",
                    f"/documents/templates/{template_id}/ai/plan/stream",
                    json={
                        "prompt": "Improve the invoice layout.",
                        "draft": created["template"],
                    },
                ) as resp:
                    frames = self._stream_frames(resp)
        decision_frame = next(payload for event_name, payload in frames if event_name == "decision_required")
        data = decision_frame.get("data") or {}
        self.assertEqual(data.get("slot_label"), "Choose target entity")
        self.assertEqual(data.get("question"), "Choose which record type this invoice should target.")
        self.assertEqual(
            data.get("summary"),
            "Waiting on one decision for the document template: Choose target entity.",
        )

    def test_email_template_ai_plan_stream_decision_event_includes_label(self) -> None:
        actor = {
            "user_id": "user-1",
            "email": "templates@example.com",
            "role": "owner",
            "workspace_role": "owner",
            "platform_role": "superadmin",
            "workspace_id": "default",
            "workspaces": [{"workspace_id": "default", "role": "owner", "workspace_name": "Default"}],
            "api_scopes": ["templates.manage"],
            "claims": {},
        }
        with TestClient(main.app) as client, patch.object(main, "_resolve_actor", lambda _request: actor):
            created = client.post(
                "/email/templates",
                json={
                    "name": "Invoice Email",
                    "description": "",
                    "subject": "Invoice {{ record['billing_invoice.invoice_number'] }}",
                    "body_html": "<p>Invoice</p>",
                    "body_text": "Invoice",
                },
            ).json()
            template_id = created["template"]["id"]

            def fake_plan(*args, **kwargs):
                return {
                    "summary": "Prepared an email template proposal.",
                    "draft": created["template"],
                    "warnings": [],
                    "assumptions": [],
                }

            def fake_apply(*args, **kwargs):
                return (
                    created["template"],
                    [],
                    [],
                    ["Choose which billing email tone to use."],
                    {
                        "decision_slots": [
                            {
                                "slot_id": "tone",
                                "label": "Choose email tone",
                                "options": [
                                    {"id": "formal", "label": "Formal", "value": "formal"},
                                    {"id": "friendly", "label": "Friendly", "value": "friendly"},
                                ],
                            }
                        ]
                    },
                )

            with patch.object(main, "_artifact_ai_generate_plan", fake_plan), patch.object(main, "_artifact_ai_apply_scoped_template_hints", fake_apply), patch.object(main, "_openai_configured", lambda: True):
                with client.stream(
                    "POST",
                    f"/email/templates/{template_id}/ai/plan/stream",
                    json={
                        "prompt": "Improve the invoice email copy.",
                        "draft": created["template"],
                    },
                ) as resp:
                    frames = self._stream_frames(resp)
        decision_frame = next(payload for event_name, payload in frames if event_name == "decision_required")
        data = decision_frame.get("data") or {}
        self.assertEqual(data.get("slot_label"), "Choose email tone")
        self.assertEqual(data.get("question"), "Choose which billing email tone to use.")
        self.assertEqual(
            data.get("summary"),
            "Waiting on one decision for the email template: Choose email tone.",
        )


if __name__ == "__main__":
    unittest.main()
