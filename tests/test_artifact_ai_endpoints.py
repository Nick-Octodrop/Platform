import json
import os
import sys
import unittest
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from fastapi.testclient import TestClient

os.environ["USE_DB"] = "0"
os.environ["OCTO_DISABLE_AUTH"] = "1"
os.environ["SUPABASE_URL"] = "http://localhost"

import app.main as main


def _superadmin_actor() -> dict:
    return {
        "user_id": "user-1",
        "email": "admin@example.com",
        "role": "owner",
        "workspace_role": "owner",
        "platform_role": "superadmin",
        "workspace_id": "default",
        "workspaces": [{"workspace_id": "default", "role": "owner", "workspace_name": "Default"}],
        "claims": {},
    }


def _member_actor() -> dict:
    return {
        "user_id": "user-2",
        "email": "member@example.com",
        "role": "member",
        "workspace_role": "member",
        "platform_role": "standard",
        "workspace_id": "default",
        "workspaces": [{"workspace_id": "default", "role": "member", "workspace_name": "Default"}],
        "claims": {},
    }


def _fake_response(payload: dict) -> dict:
    return {"choices": [{"message": {"content": json.dumps(payload)}}]}


class TestArtifactAiEndpoints(unittest.TestCase):
    @staticmethod
    def _seed_automation_step() -> dict:
        return {
            "kind": "action",
            "action_id": "system.notify",
            "inputs": {
                "recipient_user_id": "user-1",
                "title": "Automation",
                "body": "Body",
            },
        }

    def test_email_template_ai_plan_returns_validated_draft(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
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

            def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
                return _fake_response(
                    {
                        "summary": "Updated the template for approved quote emails.",
                        "draft": {
                            "name": "Quote Approval",
                            "description": "Sent after approval.",
                            "subject": "Your quote {{ record['quote.number'] }} is approved",
                            "body_html": "<p>Thanks for approving quote {{ record['quote.number'] }}.</p>",
                            "body_text": "Thanks for approving quote {{ record['quote.number'] }}.",
                        },
                        "assumptions": ["The quote number is available in the selected entity."],
                        "warnings": [],
                    }
                )

            with patch.object(main, "_openai_chat_completion", fake_openai), patch.object(main, "_openai_configured", lambda: True):
                res = client.post(
                    f"/email/templates/{template_id}/ai/plan",
                    json={
                        "prompt": "Turn this into a quote approval email.",
                        "draft": created["template"],
                    },
                )
            body = res.json()
            self.assertEqual(res.status_code, 200, body)
            self.assertTrue(body.get("ok"), body)
            self.assertEqual(body.get("draft", {}).get("name"), "Quote Approval")
            self.assertIn("approved", body.get("draft", {}).get("subject", "").lower())
            validation = body.get("validation") or {}
            self.assertIn("compiled_ok", validation)

    def test_document_template_ai_plan_returns_validated_draft(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/documents/templates",
                json={
                    "name": "Service Report",
                    "description": "",
                    "filename_pattern": "service-report",
                    "html": "<p>Report</p>",
                },
            ).json()
            template_id = created["template"]["id"]

            def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
                return _fake_response(
                    {
                        "summary": "Expanded the service report template.",
                        "draft": {
                            "name": "Service Report",
                            "description": "Customer-facing PDF.",
                            "filename_pattern": "Service Report - {{ record['job.reference'] }}",
                            "html": "<h1>Service Report</h1><p>{{ record['job.reference'] }}</p>",
                            "header_html": "<div>Octodrop Service</div>",
                            "footer_html": "<div>Page {{ pageNumber }}</div>",
                            "paper_size": "A4",
                            "margin_top": "12mm",
                            "margin_right": "12mm",
                            "margin_bottom": "12mm",
                            "margin_left": "12mm",
                        },
                        "assumptions": [],
                        "warnings": [],
                    }
                )

            with patch.object(main, "_openai_chat_completion", fake_openai), patch.object(main, "_openai_configured", lambda: True):
                res = client.post(
                    f"/documents/templates/{template_id}/ai/plan",
                    json={
                        "prompt": "Add a proper header, footer, and job reference.",
                        "draft": created["template"],
                    },
                )
            body = res.json()
            self.assertEqual(res.status_code, 200, body)
            self.assertTrue(body.get("ok"), body)
            self.assertIn("Service Report", body.get("draft", {}).get("html", ""))
            self.assertEqual(body.get("draft", {}).get("paper_size"), "A4")
            validation = body.get("validation") or {}
            self.assertIn("compiled_ok", validation)

    def test_email_template_ai_plan_context_includes_validation_and_entity_guidance(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/email/templates",
                json={
                    "name": "Quote Approval",
                    "description": "",
                    "subject": "Quote {{ record.quote_number }} approved",
                    "body_html": "<p>Hello {{ record.quote_number }}</p>",
                    "body_text": "",
                },
            ).json()
            template_id = created["template"]["id"]

        captured: dict[str, object] = {}
        fake_entities = [
            {
                "id": "entity.quote",
                "label": "Quote",
                "fields": [
                    {"id": "quote.number", "label": "Quote Number", "type": "string"},
                    {"id": "quote.customer_email", "label": "Customer Email", "type": "email"},
                    {"id": "quote.total", "label": "Total", "type": "currency"},
                ],
            }
        ]

        def fake_openai(messages, model=None, temperature=0.2, response_format=None):
            captured["messages"] = messages
            return _fake_response(
                {
                    "summary": "Improved the email template.",
                    "draft": {
                        "name": "Quote Approval",
                        "description": "Customer approval notice.",
                        "subject": "Quote {{ record['quote.number'] }} approved",
                        "body_html": "<p>Quote {{ record['quote.number'] }} is approved.</p>",
                        "body_text": "Quote {{ record['quote.number'] }} is approved.",
                    },
                    "assumptions": [],
                    "warnings": [],
                }
            )

        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.object(main, "_artifact_ai_entities", lambda _request: fake_entities),
            patch.object(main, "_openai_chat_completion", fake_openai),
            patch.object(main, "_openai_configured", lambda: True),
        ):
            res = client.post(
                f"/email/templates/{template_id}/ai/plan",
                json={
                    "prompt": "Rewrite this as a polished quote approval email.",
                    "draft": created["template"],
                    "focus": "design",
                    "sample": {"entity_id": "entity.quote"},
                },
            )
        body = res.json()
        self.assertEqual(res.status_code, 200, body)
        self.assertTrue(body.get("ok"), body)
        messages = captured.get("messages") or []
        context_messages = [
            item.get("content")
            for item in messages
            if isinstance(item, dict) and isinstance(item.get("content"), str) and item.get("content", "").startswith("context.json")
        ]
        self.assertEqual(len(context_messages), 1)
        context_text = context_messages[0]
        self.assertIn("\"current_validation\"", context_text)
        self.assertIn("\"requested_focus\": \"design\"", context_text)
        self.assertIn("\"selected_entity_summary\"", context_text)
        self.assertIn("\"safe_jinja_examples\"", context_text)
        self.assertIn("\"design_playbook\"", context_text)
        self.assertIn("\"design_principles\"", context_text)
        self.assertIn("\"component_priority\"", context_text)
        self.assertIn("\"adaptation_rules\"", context_text)
        self.assertIn("\"design_signals\"", context_text)
        self.assertIn("\"quote.number\"", context_text)
        self.assertIn("\"field_ids_by_type\"", context_text)
        self.assertIn("\"record_field_example\"", context_text)

    def test_email_template_ai_plan_derives_plain_text_when_model_omits_it(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
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

            def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
                return _fake_response(
                    {
                        "summary": "Improved the welcome email.",
                        "draft": {
                            "name": "Welcome",
                            "description": "Welcome email.",
                            "subject": "Welcome aboard",
                            "body_html": "<div><p>Hello <strong>Customer</strong></p><p>Your account is ready.</p></div>",
                        },
                        "assumptions": [],
                        "warnings": [],
                    }
                )

            with patch.object(main, "_openai_chat_completion", fake_openai), patch.object(main, "_openai_configured", lambda: True):
                res = client.post(
                    f"/email/templates/{template_id}/ai/plan",
                    json={
                        "prompt": "Improve the welcome email.",
                        "draft": created["template"],
                    },
                )
        body = res.json()
        self.assertEqual(res.status_code, 200, body)
        self.assertTrue(body.get("ok"), body)
        self.assertEqual(body.get("draft", {}).get("body_text"), "Hello Customer Your account is ready.")

    def test_document_template_normalizer_applies_safe_defaults(self) -> None:
        normalized = main._artifact_ai_normalize_doc_template_draft(
            {},
            {
                "name": "Service Report",
                "description": "Customer-facing document.",
                "html": "<h1>Service Report</h1>",
                "paper_size": "Legal",
                "margin_top": "",
                "margin_right": None,
                "margin_bottom": " ",
                "margin_left": "",
                "filename_pattern": "",
            },
        )

        self.assertEqual(normalized.get("filename_pattern"), "Service Report")
        self.assertEqual(normalized.get("paper_size"), "A4")
        self.assertEqual(normalized.get("margin_top"), "12mm")
        self.assertEqual(normalized.get("margin_right"), "12mm")
        self.assertEqual(normalized.get("margin_bottom"), "12mm")
        self.assertEqual(normalized.get("margin_left"), "12mm")

    def test_template_ai_system_prompts_require_design_playbook(self) -> None:
        email_prompt = main._artifact_ai_system_prompt("email_template")
        document_prompt = main._artifact_ai_system_prompt("document_template")

        self.assertIn("context.design_playbook", email_prompt)
        self.assertIn("soft guidance", email_prompt.lower())
        self.assertIn("component_priority", email_prompt)
        self.assertIn("context.design_signals", email_prompt)
        self.assertIn("context.requested_focus", email_prompt)
        self.assertIn("If context.requested_focus is validation", email_prompt)
        self.assertIn("preserve it unless the user clearly asks for a redesign", email_prompt)
        self.assertIn("context.design_playbook", document_prompt)
        self.assertIn("soft guidance", document_prompt.lower())
        self.assertIn("component_priority", document_prompt)
        self.assertIn("context.design_signals", document_prompt)
        self.assertIn("context.requested_focus", document_prompt)
        self.assertIn("If context.requested_focus is validation", document_prompt)
        self.assertIn("preserve it unless the user clearly asks for a redesign", document_prompt)

    def test_automation_ai_plan_context_includes_requested_focus_and_validation(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/automations",
                json={
                    "name": "Reminder",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["record.updated"], "filters": []},
                    "steps": [self._seed_automation_step()],
                },
            ).json()
            automation_id = created["automation"]["id"]

        captured: dict[str, object] = {}

        def fake_openai(messages, model=None, temperature=0.2, response_format=None):
            captured["messages"] = messages
            return _fake_response(
                {
                    "summary": "Improved the notification copy.",
                    "draft": {
                        "name": "Reminder",
                        "description": "",
                        "trigger": {"kind": "event", "event_types": ["record.updated"], "filters": []},
                        "steps": [
                            {
                                "kind": "action",
                                "action_id": "system.notify",
                                "inputs": {
                                    "recipient_user_id": "user-1",
                                    "title": "Reminder",
                                    "body": "Please review this record.",
                                },
                            }
                        ],
                        "status": "draft",
                    },
                    "assumptions": [],
                    "warnings": [],
                }
            )

        with (
            patch.object(main, "_artifact_ai_automation_meta", lambda request, actor: {"event_catalog": [], "entities": []}),
            patch.object(main, "_openai_chat_completion", fake_openai),
            patch.object(main, "_openai_configured", lambda: True),
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
        ):
            res = client.post(
                f"/automations/{automation_id}/ai/plan",
                json={
                    "prompt": "Tighten the notification wording.",
                    "focus": "content",
                    "draft": created["automation"],
                },
            )

        body = res.json()
        self.assertEqual(res.status_code, 200, body)
        context_text = next(
            (
                msg.get("content", "")
                for msg in captured.get("messages", [])
                if isinstance(msg, dict) and isinstance(msg.get("content"), str) and msg.get("content", "").startswith("context.json")
            ),
            "",
        )
        self.assertIn("\"requested_focus\": \"content\"", context_text)
        self.assertIn("\"current_validation\"", context_text)

    def test_automation_ai_system_prompt_includes_requested_focus_guidance(self) -> None:
        automation_prompt = main._artifact_ai_system_prompt("automation")

        self.assertIn("context.current_validation", automation_prompt)
        self.assertIn("context.requested_focus", automation_prompt)
        self.assertIn("If context.requested_focus is validation", automation_prompt)
        self.assertIn("If context.requested_focus is logic", automation_prompt)
        self.assertIn("If context.requested_focus is content", automation_prompt)

    def test_ai_artifact_plan_result_infers_focus_for_scoped_automation_prompt(self) -> None:
        captured: dict[str, object] = {}

        def fake_openai(messages, model=None, temperature=0.2, response_format=None):
            captured["messages"] = messages
            return _fake_response(
                {
                    "summary": "Fixed the validation issue.",
                    "draft": {
                        "name": "Reminder",
                        "description": "",
                        "trigger": {"kind": "event", "event_types": ["record.updated"], "filters": []},
                        "steps": [self._seed_automation_step()],
                        "status": "draft",
                    },
                    "assumptions": [],
                    "warnings": [],
                }
            )

        request = SimpleNamespace(state=SimpleNamespace(actor=_superadmin_actor()))
        current = {
            "id": "auto-1",
            "name": "Reminder",
            "description": "",
            "trigger": {"kind": "event", "event_types": ["record.updated"], "filters": []},
            "steps": [self._seed_automation_step()],
            "status": "draft",
        }

        with (
            patch.object(main, "_artifact_ai_automation_meta", lambda request, actor: {"event_catalog": [], "entities": []}),
            patch.object(main, "_openai_chat_completion", fake_openai),
        ):
            result = main._ai_artifact_plan_result(
                "automation",
                "auto-1",
                "Fix validation errors in this automation while keeping the behavior the same.",
                current,
                request,
                _superadmin_actor(),
            )

        context_text = next(
            (
                msg.get("content", "")
                for msg in captured.get("messages", [])
                if isinstance(msg, dict) and isinstance(msg.get("content"), str) and msg.get("content", "").startswith("context.json")
            ),
            "",
        )
        self.assertIn("\"requested_focus\": \"validation\"", context_text)
        self.assertEqual((result.get("planner_state") or {}).get("requested_focus"), "validation")

    def test_automation_ai_plan_returns_validated_draft(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/automations",
                json={
                    "name": "Reminder",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["record.updated"], "filters": []},
                    "steps": [self._seed_automation_step()],
                },
            ).json()
            automation_id = created["automation"]["id"]

            def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
                return _fake_response(
                    {
                        "summary": "Updated the automation to send an overdue reminder email.",
                        "draft": {
                            "name": "Overdue Invoice Reminder",
                            "description": "Send a reminder when invoices become overdue.",
                            "trigger": {"kind": "event", "event_types": ["record.updated"], "filters": []},
                            "steps": [
                                {
                                    "kind": "action",
                                    "action_id": "system.send_email",
                                    "inputs": {
                                        "to": "{{ record['invoice.email'] }}",
                                        "subject": "Invoice reminder",
                                    },
                                }
                            ],
                            "status": "draft",
                        },
                        "assumptions": [],
                        "warnings": [],
                    }
                )

            with patch.object(main, "_openai_chat_completion", fake_openai), patch.object(main, "_openai_configured", lambda: True):
                res = client.post(
                    f"/automations/{automation_id}/ai/plan",
                    json={
                        "prompt": "Send an overdue invoice reminder email.",
                        "draft": created["automation"],
                    },
                )
            body = res.json()
            self.assertEqual(res.status_code, 200, body)
            self.assertTrue(body.get("ok"), body)
            self.assertEqual(body.get("draft", {}).get("name"), "Overdue Invoice Reminder")
            self.assertEqual(body.get("draft", {}).get("trigger", {}).get("kind"), "event")
            validation = body.get("validation") or {}
            self.assertTrue(validation.get("compiled_ok"))

    def test_automation_ai_plan_normalizes_contact_email_recipient_to_field_source(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/automations",
                json={
                    "name": "Contact welcome",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["biz_contacts.record.biz_contact.created"], "filters": []},
                    "steps": [self._seed_automation_step()],
                },
            ).json()
            automation_id = created["automation"]["id"]

            fake_meta = {
                "event_catalog": [
                    {
                        "id": "biz_contacts.record.biz_contact.created",
                        "label": "Contact created",
                        "event": "record.created",
                        "entity_id": "entity.biz_contact",
                    }
                ],
                "entities": [
                    {
                        "id": "entity.biz_contact",
                        "label": "Contact",
                        "fields": [
                            {"id": "biz_contact.name", "label": "Name", "type": "string"},
                            {"id": "biz_contact.email", "label": "Contact Email", "type": "email"},
                        ],
                    }
                ],
            }

            def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
                return _fake_response(
                    {
                        "summary": "Send the welcome email to the contact email field.",
                        "draft": {
                            "name": "Contact welcome",
                            "description": "",
                            "trigger": {"kind": "event", "event_types": ["biz_contacts.record.biz_contact.created"], "filters": []},
                            "steps": [
                                {
                                    "kind": "action",
                                    "action_id": "system.send_email",
                                    "inputs": {
                                        "to": "contact email",
                                        "subject": "Welcome",
                                        "body_text": "Thanks for signing up.",
                                    },
                                }
                            ],
                            "status": "draft",
                        },
                        "assumptions": [],
                        "warnings": [],
                    }
                )

            with (
                patch.object(main, "_artifact_ai_automation_meta", lambda request, actor: fake_meta),
                patch.object(main, "_openai_chat_completion", fake_openai),
                patch.object(main, "_openai_configured", lambda: True),
            ):
                res = client.post(
                    f"/automations/{automation_id}/ai/plan",
                    json={
                        "prompt": "Email the contact using the contact email field.",
                        "draft": created["automation"],
                    },
                )
            body = res.json()
            self.assertEqual(res.status_code, 200, body)
            self.assertTrue(body.get("ok"), body)
            draft = body.get("draft") or {}
            step_inputs = (((draft.get("steps") or [None])[0]) or {}).get("inputs") or {}
            self.assertEqual(step_inputs.get("to_field_ids"), ["biz_contact.email"])
            self.assertNotIn("to", step_inputs)
            validation = body.get("validation") or {}
            self.assertTrue(validation.get("compiled_ok"), validation)

    def test_automation_ai_plan_maps_partial_entity_change_to_matching_catalog_trigger(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/automations",
                json={
                    "name": "Reminder",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["biz_contacts.record.biz_contact.created"], "filters": []},
                    "steps": [self._seed_automation_step()],
                },
            ).json()
            automation_id = created["automation"]["id"]

            def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
                return _fake_response(
                    {
                        "summary": "Scoped the automation to purchase orders.",
                        "draft": {
                            "name": "Reminder",
                            "description": "",
                            "trigger": {
                                "kind": "event",
                                "filters": [{"path": "entity_id", "op": "eq", "value": "entity.biz_purchase_order"}],
                            },
                            "steps": [self._seed_automation_step()],
                            "status": "draft",
                        },
                        "assumptions": [],
                        "warnings": [],
                    }
                )

            fake_meta = {
                "event_catalog": [
                    {
                        "id": "biz_contacts.record.biz_contact.created",
                        "label": "Contact created",
                        "event": "record.created",
                        "entity_id": "entity.biz_contact",
                    },
                    {
                        "id": "biz_purchase_orders.record.biz_purchase_order.created",
                        "label": "Purchase Order created",
                        "event": "record.created",
                        "entity_id": "entity.biz_purchase_order",
                    },
                ]
            }

            with (
                patch.object(main, "_artifact_ai_automation_meta", lambda request, actor: fake_meta),
                patch.object(main, "_openai_chat_completion", fake_openai),
                patch.object(main, "_openai_configured", lambda: True),
            ):
                res = client.post(
                    f"/automations/{automation_id}/ai/plan",
                    json={
                        "prompt": "Change this from contact created to purchase order created.",
                        "draft": created["automation"],
                    },
                )
            body = res.json()
            self.assertEqual(res.status_code, 200, body)
            self.assertTrue(body.get("ok"), body)
            trigger = body.get("draft", {}).get("trigger", {})
            self.assertEqual(trigger.get("event_types"), ["biz_purchase_orders.record.biz_purchase_order.created"])
            self.assertEqual((trigger.get("filters") or [{}])[0].get("path"), "entity_id")
            validation = body.get("validation") or {}
            self.assertTrue(validation.get("compiled_ok"))

    def test_automation_ai_plan_normalizes_update_record_patch_inputs(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/automations",
                json={
                    "name": "Set Phone Number",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["biz_contacts.record.biz_contact.created"], "filters": []},
                    "steps": [{"kind": "action", "action_id": "system.notify", "inputs": {"recipient_user_id": "user-1", "title": "Automation", "body": "Body"}}],
                },
            ).json()
            automation_id = created["automation"]["id"]

            def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
                return _fake_response(
                    {
                        "summary": "Set the new contact phone number to 0000.",
                        "draft": {
                            "name": "Set Phone Number",
                            "description": "",
                            "trigger": {"kind": "event", "event_types": ["biz_contacts.record.biz_contact.created"], "filters": []},
                            "steps": [
                                {
                                    "kind": "action",
                                    "action_id": "system.update_record",
                                    "entity_id": "entity.biz_contact",
                                    "record_id": "{{trigger.record_id}}",
                                    "patch_json": {"phone_number": "0000"},
                                }
                            ],
                            "status": "draft",
                        },
                        "assumptions": [],
                        "warnings": [],
                    }
                )

            fake_meta = {
                "entities": [
                    {
                        "id": "entity.biz_contact",
                        "label": "Contact",
                        "fields": [
                            {"id": "phone_number", "label": "Phone number", "type": "string"},
                        ],
                    }
                ],
                "event_catalog": [
                    {
                        "id": "biz_contacts.record.biz_contact.created",
                        "label": "Contact created",
                        "event": "record.created",
                        "entity_id": "entity.biz_contact",
                    }
                ],
                "event_types": ["biz_contacts.record.biz_contact.created"],
                "system_actions": [{"id": "system.update_record", "label": "Update record"}],
                "module_actions": [],
                "members": [],
                "connections": [],
                "email_templates": [],
                "doc_templates": [],
            }

            with (
                patch.object(main, "_artifact_ai_automation_meta", lambda request, actor: fake_meta),
                patch.object(main, "_openai_chat_completion", fake_openai),
                patch.object(main, "_openai_configured", lambda: True),
            ):
                res = client.post(
                    f"/automations/{automation_id}/ai/plan",
                    json={
                        "prompt": "When a contact is created, set the phone number to 0000.",
                        "draft": created["automation"],
                    },
                )
            body = res.json()
            self.assertEqual(res.status_code, 200, body)
            self.assertTrue(body.get("ok"), body)
            steps = body.get("draft", {}).get("steps") or []
            self.assertEqual(steps[0].get("action_id"), "system.update_record")
            self.assertEqual(steps[0].get("inputs", {}).get("record_id"), "{{trigger.record_id}}")
            self.assertEqual(steps[0].get("inputs", {}).get("patch"), {"phone_number": "0000"})
            validation = body.get("validation") or {}
            self.assertTrue(validation.get("compiled_ok"), validation)

    def test_automation_ai_plan_normalizes_condition_branches(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/automations",
                json={
                    "name": "Nick Contact Notification",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["biz_contacts.record.biz_contact.created"], "filters": []},
                    "steps": [{"kind": "action", "action_id": "system.notify", "inputs": {"recipient_user_id": "user-1", "title": "Automation", "body": "Body"}}],
                },
            ).json()
            automation_id = created["automation"]["id"]

            def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
                return _fake_response(
                    {
                        "summary": "Notify differently depending on whether the new contact is nick.",
                        "draft": {
                            "name": "Nick Contact Notification",
                            "description": "",
                            "trigger": {"kind": "event", "event_types": ["biz_contacts.record.biz_contact.created"], "filters": []},
                            "steps": [
                                {
                                    "kind": "condition",
                                    "path": "trigger.record.fields.name",
                                    "operator": "equals",
                                    "value": "nick",
                                },
                                {
                                    "kind": "action",
                                    "action_id": "system.notify",
                                    "inputs": {
                                        "recipient_user_id": "user-1",
                                        "title": "New nick contact",
                                        "body": "new nick contact create",
                                    },
                                },
                                {
                                    "kind": "action",
                                    "action_id": "system.notify",
                                    "inputs": {
                                        "recipient_user_id": "user-1",
                                        "title": "New contact created",
                                        "body": "new contact created thats not nick",
                                    },
                                },
                            ],
                            "status": "draft",
                        },
                        "assumptions": [],
                        "warnings": [],
                    }
                )

            fake_meta = {
                "entities": [
                    {
                        "id": "entity.biz_contact",
                        "label": "Contact",
                        "fields": [
                            {"id": "biz_contact.name", "label": "Name", "type": "string"},
                        ],
                    }
                ],
                "event_catalog": [
                    {
                        "id": "biz_contacts.record.biz_contact.created",
                        "label": "Contact created",
                        "event": "record.created",
                        "entity_id": "entity.biz_contact",
                    }
                ],
                "event_types": ["biz_contacts.record.biz_contact.created"],
                "system_actions": [{"id": "system.notify", "label": "Notify workspace users"}],
                "module_actions": [],
                "members": [{"user_id": "user-1", "email": "nick@octodrop.com"}],
                "connections": [],
                "email_templates": [],
                "doc_templates": [],
            }

            with (
                patch.object(main, "_artifact_ai_automation_meta", lambda request, actor: fake_meta),
                patch.object(main, "_openai_chat_completion", fake_openai),
                patch.object(main, "_openai_configured", lambda: True),
            ):
                res = client.post(
                    f"/automations/{automation_id}/ai/plan",
                    json={
                        "prompt": "If the new contact name is nick send one notification, otherwise send another one.",
                        "draft": created["automation"],
                    },
                )
            body = res.json()
            self.assertEqual(res.status_code, 200, body)
            self.assertTrue(body.get("ok"), body)
            steps = body.get("draft", {}).get("steps") or []
            self.assertEqual(len(steps), 1, steps)
            self.assertEqual(steps[0].get("kind"), "condition")
            self.assertEqual(
                steps[0].get("expr"),
                {
                    "op": "eq",
                    "left": {"var": "trigger.record.fields.biz_contact.name"},
                    "right": {"literal": "nick"},
                },
            )
            self.assertEqual(len(steps[0].get("then_steps") or []), 1)
            self.assertEqual(len(steps[0].get("else_steps") or []), 1)
            self.assertEqual((steps[0].get("inputs") or {}).get("entity_id"), "entity.biz_contact")
            then_step = (steps[0].get("then_steps") or [{}])[0]
            else_step = (steps[0].get("else_steps") or [{}])[0]
            self.assertEqual(then_step.get("inputs", {}).get("recipient_user_id"), "user-1")
            self.assertEqual(else_step.get("inputs", {}).get("recipient_user_id"), "user-1")
            validation = body.get("validation") or {}
            self.assertTrue(validation.get("compiled_ok"), validation)

    def test_automation_ai_plan_defaults_notify_recipient_to_current_user(self) -> None:
        client = TestClient(main.app)
        actor = _superadmin_actor()
        actor["user_id"] = "user-current"
        with patch.object(main, "_resolve_actor", lambda _request: actor):
            created = client.post(
                "/automations",
                json={
                    "name": "Notify On Contact",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["biz_contacts.record.biz_contact.created"], "filters": []},
                    "steps": [{"kind": "action", "action_id": "system.notify", "inputs": {"recipient_user_id": "user-current", "title": "Automation", "body": "Body"}}],
                },
            ).json()
            automation_id = created["automation"]["id"]

            def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
                return _fake_response(
                    {
                        "summary": "Notify when a contact is created.",
                        "draft": {
                            "name": "Notify On Contact",
                            "description": "",
                            "trigger": {"kind": "event", "event_types": ["biz_contacts.record.biz_contact.created"], "filters": []},
                            "steps": [
                                {
                                    "kind": "action",
                                    "action_id": "system.notify",
                                    "inputs": {
                                        "title": "New contact created",
                                        "body": "A contact was created.",
                                    },
                                }
                            ],
                            "status": "draft",
                        },
                        "assumptions": [],
                        "warnings": [],
                    }
                )

            fake_meta = {
                "current_user_id": "user-current",
                "entities": [],
                "event_catalog": [
                    {
                        "id": "biz_contacts.record.biz_contact.created",
                        "label": "Contact created",
                        "event": "record.created",
                        "entity_id": "entity.biz_contact",
                    }
                ],
                "event_types": ["biz_contacts.record.biz_contact.created"],
                "system_actions": [{"id": "system.notify", "label": "Notify workspace users"}],
                "module_actions": [],
                "members": [{"user_id": "user-current", "email": "nick@octodrop.com"}],
                "connections": [],
                "email_templates": [],
                "doc_templates": [],
            }

            with (
                patch.object(main, "_artifact_ai_automation_meta", lambda request, actor: fake_meta),
                patch.object(main, "_openai_chat_completion", fake_openai),
                patch.object(main, "_openai_configured", lambda: True),
            ):
                res = client.post(
                    f"/automations/{automation_id}/ai/plan",
                    json={
                        "prompt": "Notify me when a contact is created.",
                        "draft": created["automation"],
                    },
                )
            body = res.json()
            self.assertEqual(res.status_code, 200, body)
            self.assertTrue(body.get("ok"), body)
            step = (body.get("draft", {}).get("steps") or [{}])[0]
            self.assertEqual(step.get("inputs", {}).get("recipient_user_id"), "user-current")
            self.assertEqual(step.get("inputs", {}).get("recipient_user_ids"), ["user-current"])
            validation = body.get("validation") or {}
            self.assertTrue(validation.get("compiled_ok"), validation)

    def test_automation_ai_plan_maps_notify_me_and_ui_style_condition_inputs(self) -> None:
        client = TestClient(main.app)
        actor = _superadmin_actor()
        actor["user_id"] = "user-current"
        with patch.object(main, "_resolve_actor", lambda _request: actor):
            created = client.post(
                "/automations",
                json={
                    "name": "Nick Contact Notification",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["biz_contacts.record.biz_contact.created"], "filters": []},
                    "steps": [{"kind": "action", "action_id": "system.notify", "inputs": {"recipient_user_id": "user-current", "title": "Automation", "body": "Body"}}],
                },
            ).json()
            automation_id = created["automation"]["id"]

            def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
                return _fake_response(
                    {
                        "summary": "Notify me differently depending on whether the new contact is nick.",
                        "draft": {
                            "name": "Nick Contact Notification",
                            "description": "",
                            "trigger": {"kind": "event", "event_types": ["biz_contacts.record.biz_contact.created"], "filters": []},
                            "steps": [
                                {
                                    "kind": "condition",
                                    "inputs": {
                                        "entity_id": "entity.biz_contact",
                                        "check": "name",
                                        "compare_using": "equals",
                                        "against": "nick",
                                    },
                                    "then_steps": [
                                        {
                                            "kind": "action",
                                            "action_id": "system.notify",
                                            "inputs": {
                                                "recipient_user_id": "me",
                                                "title": "New nick contact",
                                                "body": "new nick contact create",
                                            },
                                        }
                                    ],
                                    "else_steps": [
                                        {
                                            "kind": "action",
                                            "action_id": "system.notify",
                                            "inputs": {
                                                "recipient_user_id": "me",
                                                "title": "New contact created",
                                                "body": "new contact created thats not nick",
                                            },
                                        }
                                    ],
                                }
                            ],
                            "status": "draft",
                        },
                        "assumptions": [],
                        "warnings": [],
                    }
                )

            fake_meta = {
                "current_user_id": "user-current",
                "entities": [
                    {
                        "id": "entity.biz_contact",
                        "label": "Contact",
                        "fields": [
                            {"id": "biz_contact.name", "label": "Name", "type": "string"},
                        ],
                    }
                ],
                "event_catalog": [
                    {
                        "id": "biz_contacts.record.biz_contact.created",
                        "label": "Contact created",
                        "event": "record.created",
                        "entity_id": "entity.biz_contact",
                    }
                ],
                "event_types": ["biz_contacts.record.biz_contact.created"],
                "system_actions": [{"id": "system.notify", "label": "Notify workspace users"}],
                "module_actions": [],
                "members": [{"user_id": "user-current", "email": "nick@octodrop.com"}],
                "connections": [],
                "email_templates": [],
                "doc_templates": [],
            }

            with (
                patch.object(main, "_artifact_ai_automation_meta", lambda request, actor: fake_meta),
                patch.object(main, "_openai_chat_completion", fake_openai),
                patch.object(main, "_openai_configured", lambda: True),
            ):
                res = client.post(
                    f"/automations/{automation_id}/ai/plan",
                    json={
                        "prompt": "If the new contact name is nick notify me one way, otherwise notify me another way.",
                        "draft": created["automation"],
                    },
                )
            body = res.json()
            self.assertEqual(res.status_code, 200, body)
            self.assertTrue(body.get("ok"), body)
            steps = body.get("draft", {}).get("steps") or []
            self.assertEqual(len(steps), 1, steps)
            condition_step = steps[0]
            self.assertEqual(
                condition_step.get("expr"),
                {
                    "op": "eq",
                    "left": {"var": "trigger.record.fields.biz_contact.name"},
                    "right": {"literal": "nick"},
                },
            )
            then_step = (condition_step.get("then_steps") or [{}])[0]
            else_step = (condition_step.get("else_steps") or [{}])[0]
            self.assertEqual(then_step.get("inputs", {}).get("recipient_user_id"), "user-current")
            self.assertEqual(else_step.get("inputs", {}).get("recipient_user_id"), "user-current")
            validation = body.get("validation") or {}
            self.assertTrue(validation.get("compiled_ok"), validation)

    def test_validate_automation_payload_requires_event_type_for_event_triggers(self) -> None:
        errors = main._validate_automation_payload(
            {
                "name": "Reminder",
                "trigger": {"kind": "event", "event_types": [], "filters": []},
                "steps": [{"kind": "action", "action_id": "system.send_email"}],
            }
        )
        self.assertTrue(any((item.get("path") == "trigger.event_types") for item in errors), errors)

    def test_validate_automation_payload_requires_patch_for_update_record_steps(self) -> None:
        errors = main._validate_automation_payload(
            {
                "name": "Set Phone Number",
                "trigger": {"kind": "event", "event_types": ["record.created"], "filters": []},
                "steps": [
                    {
                        "kind": "action",
                        "action_id": "system.update_record",
                        "inputs": {
                            "record_id": "{{trigger.record_id}}",
                            "patch": {},
                        },
                    }
                ],
            }
        )
        self.assertTrue(any((item.get("path") == "steps[0].inputs.patch") for item in errors), errors)

    def test_validate_automation_payload_requires_notify_inputs(self) -> None:
        errors = main._validate_automation_payload(
            {
                "name": "Notify",
                "trigger": {"kind": "event", "event_types": ["record.created"], "filters": []},
                "steps": [
                    {
                        "kind": "action",
                        "action_id": "system.notify",
                        "inputs": {},
                    }
                ],
            }
        )
        paths = {item.get("path") for item in errors}
        self.assertIn("steps[0].inputs", paths)
        self.assertIn("steps[0].inputs.title", paths)
        self.assertIn("steps[0].inputs.body", paths)

    def test_validate_automation_payload_requires_mapping_inputs(self) -> None:
        errors = main._validate_automation_payload(
            {
                "name": "Map Xero Contact",
                "trigger": {"kind": "event", "event_types": ["integration.webhook.received"], "filters": []},
                "steps": [
                    {
                        "kind": "action",
                        "action_id": "system.apply_integration_mapping",
                        "inputs": {},
                    }
                ],
            }
        )
        paths = {item.get("path") for item in errors}
        self.assertIn("steps[0].inputs.mapping_id", paths)
        self.assertIn("steps[0].inputs.source_record", paths)

    def test_validate_automation_payload_rejects_empty_condition_steps(self) -> None:
        errors = main._validate_automation_payload(
            {
                "name": "Nick Check",
                "trigger": {"kind": "event", "event_types": ["record.created"], "filters": []},
                "steps": [
                    {
                        "kind": "condition",
                        "expr": {
                            "op": "eq",
                            "left": {"var": "trigger.record.fields.name"},
                            "right": {"literal": "nick"},
                        },
                    }
                ],
            }
        )
        self.assertTrue(any((item.get("path") == "steps[0]") for item in errors), errors)

    def test_automation_ai_plan_serializes_datetime_context(self) -> None:
        client = TestClient(main.app)
        automation_id = f"auto_{uuid.uuid4().hex[:8]}"
        captured: dict[str, object] = {}
        stored_item = {
            "id": automation_id,
            "name": "Send notification",
            "description": "",
            "trigger": {"kind": "event", "event_types": ["record.updated"], "filters": []},
            "steps": [{"kind": "action", "action_id": "system.send_email"}],
            "status": "draft",
            "created_at": datetime(2026, 4, 16, 12, 30, tzinfo=timezone.utc),
            "updated_at": datetime(2026, 4, 16, 12, 45, tzinfo=timezone.utc),
        }

        def fake_openai(messages, model=None, temperature=0.2, response_format=None):
            captured["messages"] = messages
            return _fake_response(
                {
                    "summary": "Updated the automation notification body.",
                    "draft": {
                        "name": "Send notification",
                        "description": "",
                        "trigger": {"kind": "event", "event_types": ["record.updated"], "filters": []},
                        "steps": [
                            {
                                "kind": "action",
                                "action_id": "system.send_email",
                                "inputs": {"body_text": "hello sir customer"},
                            }
                        ],
                        "status": "draft",
                    },
                    "assumptions": [],
                    "warnings": [],
                }
            )

        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.object(main.automation_store, "get", lambda _automation_id: stored_item if _automation_id == automation_id else None),
            patch.object(main, "_openai_chat_completion", fake_openai),
            patch.object(main, "_openai_configured", lambda: True),
        ):
            res = client.post(
                f"/automations/{automation_id}/ai/plan",
                json={"prompt": "Change the notification body text to hello sir customer."},
            )
        body = res.json()
        self.assertEqual(res.status_code, 200, body)
        self.assertTrue(body.get("ok"), body)
        messages = captured.get("messages") or []
        context_messages = [
            item.get("content")
            for item in messages
            if isinstance(item, dict) and isinstance(item.get("content"), str) and item.get("content", "").startswith("context.json")
        ]
        self.assertEqual(len(context_messages), 1)
        self.assertIn("2026-04-16T12:30:00+00:00", context_messages[0])
        self.assertIn("2026-04-16T12:45:00+00:00", context_messages[0])

    def test_automation_ai_plan_serializes_datetime_metadata(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/automations",
                json={
                    "name": "Reminder",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["record.updated"], "filters": []},
                    "steps": [self._seed_automation_step()],
                },
            ).json()
            automation_id = created["automation"]["id"]

        captured: dict[str, object] = {}

        def fake_openai(messages, model=None, temperature=0.2, response_format=None):
            captured["messages"] = messages
            return _fake_response(
                {
                    "summary": "Updated the automation.",
                    "draft": {
                        "name": "Reminder",
                        "description": "",
                        "trigger": {"kind": "event", "event_types": ["record.updated"], "filters": []},
                        "steps": [{"kind": "action", "action_id": "system.send_email"}],
                        "status": "draft",
                    },
                    "assumptions": [],
                    "warnings": [],
                }
            )

        fake_meta = {
            "entities": [],
            "event_types": ["record.updated"],
            "system_actions": [{"id": "system.send_email", "label": "Send email"}],
            "module_actions": [],
            "members": [{"user_id": "user-1", "joined_at": datetime(2026, 4, 16, 13, 0, tzinfo=timezone.utc)}],
            "connections": [{"id": "conn_1", "last_tested_at": datetime(2026, 4, 16, 13, 5, tzinfo=timezone.utc)}],
            "email_templates": [],
            "doc_templates": [],
        }

        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.object(main, "_artifact_ai_automation_meta", lambda request, actor: fake_meta),
            patch.object(main, "_openai_chat_completion", fake_openai),
            patch.object(main, "_openai_configured", lambda: True),
        ):
            res = client.post(
                f"/automations/{automation_id}/ai/plan",
                json={"prompt": "Update the notification wording."},
            )
        body = res.json()
        self.assertEqual(res.status_code, 200, body)
        self.assertTrue(body.get("ok"), body)
        messages = captured.get("messages") or []
        context_messages = [
            item.get("content")
            for item in messages
            if isinstance(item, dict) and isinstance(item.get("content"), str) and item.get("content", "").startswith("context.json")
        ]
        self.assertEqual(len(context_messages), 1)
        self.assertIn("2026-04-16T13:00:00+00:00", context_messages[0])
        self.assertIn("2026-04-16T13:05:00+00:00", context_messages[0])

    def test_automation_ai_prompt_context_includes_authoring_contracts(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/automations",
                json={
                    "name": "Reminder",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["record.updated"], "filters": []},
                    "steps": [{"kind": "action", "action_id": "system.notify", "inputs": {"recipient_user_id": "user-1", "title": "Automation", "body": "Body"}}],
                },
            ).json()
            automation_id = created["automation"]["id"]

        captured: dict[str, object] = {}

        def fake_openai(messages, model=None, temperature=0.2, response_format=None):
            captured["messages"] = messages
            return _fake_response(
                {
                    "summary": "Updated the automation.",
                    "draft": {
                        "name": "Reminder",
                        "description": "",
                        "trigger": {"kind": "event", "event_types": ["biz_contacts.record.biz_contact.created"], "filters": []},
                        "steps": [{"kind": "action", "action_id": "system.notify", "inputs": {"recipient_user_id": "user-1", "title": "Automation", "body": "Body"}}],
                        "status": "draft",
                    },
                    "assumptions": [],
                    "warnings": [],
                }
            )

        fake_entities = [
            {
                "id": "entity.biz_contact",
                "label": "Contact",
                "fields": [
                    {"id": "biz_contact.name", "label": "Name", "type": "string"},
                    {"id": "biz_contact.email", "label": "Email", "type": "string"},
                ],
            }
        ]
        fake_registry = [{"enabled": True, "module_id": "contacts", "name": "Contacts", "current_hash": "hash_contacts"}]
        fake_manifest = {
            "triggers": [
                {
                    "id": "biz_contacts.record.biz_contact.created",
                    "label": "Contact created",
                    "event": "record.created",
                    "entity_id": "entity.biz_contact",
                }
            ],
            "actions": [
                {
                    "id": "contacts.archive_contact",
                    "label": "Archive contact",
                    "kind": "record",
                    "entity_id": "entity.biz_contact",
                }
            ],
        }

        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.object(main, "_artifact_ai_entities", lambda _request: fake_entities),
            patch.object(main, "_get_registry_list", lambda _request: fake_registry),
            patch.object(main, "_get_snapshot", lambda _request, _module_id, _manifest_hash: fake_manifest),
            patch.object(main, "list_workspace_members", lambda _workspace_id: [{"user_id": "user-1", "email": "admin@example.com"}]),
            patch.object(main, "_openai_chat_completion", fake_openai),
            patch.object(main, "_openai_configured", lambda: True),
        ):
            res = client.post(
                f"/automations/{automation_id}/ai/plan",
                json={"prompt": "Build a complex contact automation."},
            )
        body = res.json()
        self.assertEqual(res.status_code, 200, body)
        self.assertTrue(body.get("ok"), body)
        messages = captured.get("messages") or []
        context_messages = [
            item.get("content")
            for item in messages
            if isinstance(item, dict) and isinstance(item.get("content"), str) and item.get("content", "").startswith("context.json")
        ]
        self.assertEqual(len(context_messages), 1)
        context_text = context_messages[0]
        self.assertIn("\"field_path_catalog\"", context_text)
        self.assertIn("trigger.record.fields.biz_contact.name", context_text)
        self.assertIn("\"trigger_contracts\"", context_text)
        self.assertIn("\"step_kind_contracts\"", context_text)
        self.assertIn("\"editor_settings\"", context_text)
        self.assertIn("\"severity_options\"", context_text)
        self.assertIn("\"method_options\"", context_text)
        self.assertIn("\"system.send_email\"", context_text)
        self.assertIn("\"system.generate_document\"", context_text)
        self.assertIn("\"system.integration_request\"", context_text)

    def test_artifact_ai_endpoints_require_superadmin(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            email_template = client.post(
                "/email/templates",
                json={"name": "Welcome", "subject": "Hello", "body_html": "<p>Hello</p>"},
            ).json()["template"]
            doc_template = client.post(
                "/documents/templates",
                json={"name": "Doc", "filename_pattern": "doc", "html": "<p>Doc</p>"},
            ).json()["template"]
            automation = client.post(
                "/automations",
                json={
                    "name": "Reminder",
                    "trigger": {"kind": "event", "event_types": ["record.updated"], "filters": []},
                    "steps": [self._seed_automation_step()],
                },
            ).json()["automation"]

        with patch.object(main, "_resolve_actor", lambda _request: _member_actor()):
            calls = [
                ("post", f"/email/templates/{email_template['id']}/ai/plan"),
                ("post", f"/documents/templates/{doc_template['id']}/ai/plan"),
                ("post", f"/automations/{automation['id']}/ai/plan"),
            ]
            for method, path in calls:
                res = getattr(client, method)(path, json={"prompt": "help"})
                body = res.json()
                self.assertEqual(res.status_code, 403, {"path": path, "body": body})
                self.assertFalse(body.get("ok"), {"path": path, "body": body})

    def test_octo_validate_patchset_accepts_template_ops(self) -> None:
        request = SimpleNamespace(state=SimpleNamespace(actor={}))
        email_id = f"email_{uuid.uuid4().hex[:8]}"
        doc_id = f"doc_{uuid.uuid4().hex[:8]}"
        patchset = {
            "patch_json": {
                "operations": [
                    {
                        "op": "create_email_template_record",
                        "artifact_type": "email_template",
                        "artifact_id": email_id,
                        "email_template": {
                            "name": "Quote Approved",
                            "subject": "Quote {{ record['quote.number'] }} approved",
                            "body_html": "<p>Approved</p>",
                            "body_text": "Approved",
                        },
                    },
                    {
                        "op": "create_document_template_record",
                        "artifact_type": "document_template",
                        "artifact_id": doc_id,
                        "document_template": {
                            "name": "Service Report",
                            "filename_pattern": "service-report-{{ record['job.reference'] }}",
                            "html": "<h1>Service Report</h1>",
                            "paper_size": "A4",
                            "margin_top": "12mm",
                            "margin_right": "12mm",
                            "margin_bottom": "12mm",
                            "margin_left": "12mm",
                        },
                    },
                ]
            },
            "base_snapshot_refs_json": [],
        }

        result = main._ai_validate_patchset_against_workspace(request, patchset)

        self.assertTrue(result.get("ok"), result)
        artifact_types = [item.get("artifact_type") for item in (result.get("results") or []) if isinstance(item, dict)]
        self.assertIn("email_template", artifact_types)
        self.assertIn("document_template", artifact_types)

    def test_octo_apply_patchset_persists_template_ops(self) -> None:
        client = TestClient(main.app)
        email_id = f"email_{uuid.uuid4().hex[:8]}"
        doc_id = f"doc_{uuid.uuid4().hex[:8]}"
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            create_response = client.post("/octo-ai/sessions", json={"title": "Template rollout"})
            self.assertEqual(create_response.status_code, 200, create_response.text)
            session_id = create_response.json()["session"]["id"]
            main._ai_update_record(
                main._AI_ENTITY_SESSION,
                session_id,
                {"sandbox_workspace_id": "ws_templates_apply", "sandbox_status": "active"},
            )
            patchset = main._ai_create_record(
                main._AI_ENTITY_PATCHSET,
                {
                    "session_id": session_id,
                    "status": "validated",
                    "base_snapshot_refs_json": [],
                    "patch_json": {
                        "operations": [
                            {
                                "op": "create_email_template_record",
                                "artifact_type": "email_template",
                                "artifact_id": email_id,
                                "email_template": {
                                    "name": "Quote Approved",
                                    "subject": "Quote {{ record['quote.number'] }} approved",
                                    "body_html": "<p>Approved</p>",
                                    "body_text": "Approved",
                                },
                            },
                            {
                                "op": "create_document_template_record",
                                "artifact_type": "document_template",
                                "artifact_id": doc_id,
                                "document_template": {
                                    "name": "Service Report",
                                    "filename_pattern": "service-report-{{ record['job.reference'] }}",
                                    "html": "<h1>Service Report</h1>",
                                    "paper_size": "A4",
                                    "margin_top": "12mm",
                                    "margin_right": "12mm",
                                    "margin_bottom": "12mm",
                                    "margin_left": "12mm",
                                },
                            },
                        ]
                    },
                    "validation_json": None,
                    "apply_log_json": [],
                    "created_at": "2026-04-15T00:00:00Z",
                    "applied_at": None,
                },
            )
            patchset_id = main._ai_record_data(patchset)["id"]
            res = client.post(f"/octo-ai/patchsets/{patchset_id}/apply", json={"approved": True})
            body = res.json()
            self.assertEqual(res.status_code, 200, body)
            self.assertTrue(body.get("ok"), body)

        self.assertIsNotNone(main.email_store.get_template(email_id))
        self.assertIsNotNone(main.doc_template_store.get(doc_id))

    def test_octo_chat_uses_selected_email_template_scope(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/email/templates",
                json={
                    "name": "Welcome",
                    "subject": "Hello",
                    "body_html": "<p>Hello</p>",
                    "body_text": "Hello",
                },
            ).json()
            template_id = created["template"]["id"]
            session = client.post(
                "/octo-ai/sessions",
                json={
                    "title": "Template change",
                    "selected_artifact_type": "email_template",
                    "selected_artifact_key": template_id,
                },
            ).json()["session"]

            def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
                return _fake_response(
                    {
                        "summary": "Updated the selected email template.",
                        "draft": {
                            "name": "Quote Approved",
                            "subject": "Quote approved",
                            "body_html": "<p>Approved</p>",
                            "body_text": "Approved",
                        },
                        "assumptions": [],
                        "warnings": [],
                    }
                )

            with patch.object(main, "_openai_chat_completion", fake_openai):
                res = client.post(
                    f"/octo-ai/sessions/{session['id']}/chat",
                    json={"message": "Turn this into a quote approval email."},
                )
            body = res.json()
            self.assertEqual(res.status_code, 200, body)
            self.assertTrue(body.get("ok"), body)
            plan = body.get("plan") or {}
            ops = [item for item in (plan.get("candidate_operations") or []) if isinstance(item, dict)]
            self.assertEqual(len(ops), 1)
            self.assertEqual(ops[0].get("artifact_type"), "email_template")
            self.assertEqual(ops[0].get("op"), "update_email_template_record")
            artifacts = [item for item in (plan.get("affected_artifacts") or []) if isinstance(item, dict)]
            self.assertTrue(any(item.get("artifact_type") == "email_template" and item.get("artifact_id") == template_id for item in artifacts))

    def test_octo_chat_merges_named_existing_artifacts_in_unscoped_session(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            automation_name = f"Quote Reminder {uuid.uuid4().hex[:6]}"
            email_name = f"Quote Approved {uuid.uuid4().hex[:6]}"
            automation = client.post(
                "/automations",
                json={
                    "name": automation_name,
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["record.updated"], "filters": []},
                    "steps": [self._seed_automation_step()],
                },
            ).json()["automation"]
            email_template = client.post(
                "/email/templates",
                json={
                    "name": email_name,
                    "subject": "Approved",
                    "body_html": "<p>Approved</p>",
                    "body_text": "Approved",
                },
            ).json()["template"]
            session = client.post(
                "/octo-ai/sessions",
                json={"title": "Mixed artifact change"},
            ).json()["session"]

            def fake_openai(messages, model=None, temperature=0.2, response_format=None):
                system_prompt = messages[0]["content"] if isinstance(messages, list) and messages else ""
                if "automation drafts" in system_prompt:
                    return _fake_response(
                        {
                            "summary": "Updated the automation.",
                            "draft": {
                                "name": automation_name,
                                "description": "Send a reminder.",
                                "trigger": {"kind": "event", "event_types": ["record.updated"], "filters": []},
                                "steps": [self._seed_automation_step()],
                                "status": "draft",
                            },
                            "assumptions": [],
                            "warnings": [],
                        }
                    )
                return _fake_response(
                    {
                        "summary": "Updated the email template.",
                        "draft": {
                            "name": email_name,
                            "subject": "Quote approved",
                            "body_html": "<p>Your quote is approved.</p>",
                            "body_text": "Your quote is approved.",
                        },
                        "assumptions": [],
                        "warnings": [],
                    }
                )

            with patch.object(main, "_openai_chat_completion", fake_openai), patch.object(main, "_ai_semantic_plan_from_model", lambda *args, **kwargs: None):
                res = client.post(
                    f"/octo-ai/sessions/{session['id']}/chat",
                    json={"message": f"Update the {automation_name} automation and the {email_name} email template."},
                )
            body = res.json()
            self.assertEqual(res.status_code, 200, body)
            self.assertTrue(body.get("ok"), body)
            plan = body.get("plan") or {}
            ops = [item for item in (plan.get("candidate_operations") or []) if isinstance(item, dict)]
            self.assertEqual(
                {(item.get("artifact_type"), item.get("op")) for item in ops},
                {
                    ("automation", "update_automation_record"),
                    ("email_template", "update_email_template_record"),
                },
            )
            artifacts = [item for item in (plan.get("affected_artifacts") or []) if isinstance(item, dict)]
            self.assertTrue(any(item.get("artifact_type") == "automation" and item.get("artifact_id") == automation["id"] for item in artifacts))
            self.assertTrue(any(item.get("artifact_type") == "email_template" and item.get("artifact_id") == email_template["id"] for item in artifacts))

    def test_octo_semantic_plan_resolves_workspace_artifact_labels_without_scoped_session(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            email_name = f"Quote Approved {uuid.uuid4().hex[:6]}"
            email_template = client.post(
                "/email/templates",
                json={
                    "name": email_name,
                    "subject": "Approved",
                    "body_html": "<p>Approved</p>",
                    "body_text": "Approved",
                },
            ).json()["template"]
            session = client.post(
                "/octo-ai/sessions",
                json={"title": "Semantic artifact change"},
            ).json()["session"]

            def fake_openai(messages, model=None, temperature=0.2, response_format=None):
                return _fake_response(
                    {
                        "module_id": None,
                        "affected_modules": [],
                        "proposed_changes": [
                            {
                                "op": "update_email_template_record",
                                "artifact_type": "email_template",
                                "artifact_id": email_name,
                                "email_template": {
                                    "name": email_name,
                                    "subject": "Quote approved",
                                    "body_html": "<p>Your quote is approved.</p>",
                                    "body_text": "Your quote is approved.",
                                },
                            }
                        ],
                        "required_questions": [],
                        "assumptions": [],
                        "risk_flags": [],
                        "advisories": [],
                        "plan_v1": {
                            "version": "1",
                            "intent": "template_change",
                            "summary": f"Update the {email_name} email template.",
                            "requested_scope": {
                                "requested_modules": [],
                                "missing_modules": [],
                                "requested_artifacts": [email_name],
                            },
                            "artifacts": [
                                {
                                    "artifact_type": "email_template",
                                    "artifact_id": email_name,
                                    "artifact_label": email_name,
                                    "status": "planned",
                                }
                            ],
                            "modules": [],
                            "changes": [
                                {
                                    "op": "update_email_template_record",
                                    "artifact_type": "email_template",
                                    "artifact_id": email_name,
                                    "artifact_label": email_name,
                                    "summary": f"Update email template '{email_name}'.",
                                }
                            ],
                            "sections": [],
                            "clarifications": {"items": [], "meta": {}},
                            "assumptions": [],
                            "risks": [],
                            "noop_notes": [],
                            "operation_families": ["template_change"],
                            "primary_operation_family": "template_change",
                            "needs_clarification": False,
                            "architecture_decisions": [],
                            "first_delivery_slice": [],
                        },
                    }
                )

            with (
                patch.object(main, "_openai_chat_completion", fake_openai),
                patch.object(main, "_openai_configured", lambda: True),
                patch.object(main, "_ai_named_artifact_plan", lambda *args, **kwargs: None),
                patch.object(main, "_ai_slot_based_plan", lambda *args, **kwargs: None),
            ):
                res = client.post(
                    f"/octo-ai/sessions/{session['id']}/chat",
                    json={"message": f"Update the {email_name} email template."},
                )
            body = res.json()
            self.assertEqual(res.status_code, 200, body)
            self.assertTrue(body.get("ok"), body)
            plan = body.get("plan") or {}
            ops = [item for item in (plan.get("candidate_operations") or []) if isinstance(item, dict)]
            self.assertEqual(len(ops), 1)
            self.assertEqual(ops[0].get("artifact_type"), "email_template")
            self.assertEqual(ops[0].get("artifact_id"), email_template["id"])


if __name__ == "__main__":
    unittest.main()
