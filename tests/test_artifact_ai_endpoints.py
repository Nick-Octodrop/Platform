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


def _template_manager_actor() -> dict:
    return {
        "user_id": "user-3",
        "email": "templates@example.com",
        "role": "custom",
        "workspace_role": "custom",
        "platform_role": "standard",
        "workspace_id": "default",
        "workspaces": [{"workspace_id": "default", "role": "custom", "workspace_name": "Default"}],
        "api_scopes": ["templates.manage"],
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

    def test_ai_capabilities_endpoint_returns_shared_quick_actions(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            res = client.get("/ai/capabilities")
        body = res.json()
        self.assertEqual(res.status_code, 200, body)
        capabilities = body.get("capabilities") or {}
        artifacts = capabilities.get("artifacts") or {}
        self.assertIn("module", artifacts)
        self.assertIn("automation", artifacts)
        self.assertIn("email_template", artifacts)
        self.assertIn("document_template", artifacts)
        module_actions = artifacts["module"].get("quick_actions") or []
        self.assertTrue(any(action.get("id") == "improve-ux" for action in module_actions))
        self.assertIn("focus_guidance", artifacts["module"])
        self.assertIn("focus_inference_signals", artifacts["automation"])
        email_actions = artifacts["email_template"].get("quick_actions") or []
        self.assertTrue(any(action.get("id") == "apply-branding" for action in email_actions))
        self.assertTrue(any(action.get("focus") == "validation" for action in email_actions))
        self.assertTrue(any(action.get("id") == "improve-design" and action.get("label") == "Design refresh" for action in email_actions))
        email_design_action = next(action for action in email_actions if action.get("id") == "improve-design")
        self.assertIn("top-tier agency", email_design_action.get("prompt_template", ""))
        document_actions = artifacts["document_template"].get("quick_actions") or []
        self.assertTrue(any(action.get("id") == "improve-design" and action.get("label") == "Design refresh" for action in document_actions))
        document_design_action = next(action for action in document_actions if action.get("id") == "improve-design")
        self.assertIn("top-tier agency", document_design_action.get("prompt_template", ""))

    def test_shared_capability_catalog_drives_focus_inference_and_module_guidance(self) -> None:
        self.assertEqual(main._studio2_agent_focus(None, "Improve labels and helper text in this module."), "content")
        self.assertEqual(main._studio2_agent_focus(None, "Improve workflow logic and actions."), "logic")
        self.assertEqual(main._artifact_ai_requested_focus("document_template", None, "Improve layout and print readability."), "design")
        self.assertEqual(
            main._artifact_ai_requested_focus(
                "document_template",
                None,
                "Make this invoice document look professionally designed like a graphic designer prepared it with our branding.",
            ),
            "design",
        )
        self.assertEqual(
            main._artifact_ai_requested_focus(
                "email_template",
                None,
                "Give this reminder email an agency-grade branded redesign with better hierarchy and spacing.",
            ),
            "design",
        )
        self.assertEqual(
            main._artifact_ai_requested_focus(
                "document_template",
                None,
                "Improve this invoice layout and branding but keep the current structure and variables the same.",
            ),
            "design",
        )
        self.assertEqual(
            main._artifact_ai_requested_focus(
                "email_template",
                None,
                "Refresh this reminder email to feel more professionally designed but keep the existing structure and variables.",
            ),
            "design",
        )
        self.assertEqual(main._artifact_ai_requested_focus("automation", None, "Tighten the notification copy."), "content")
        instruction = main._studio2_agent_focus_instruction("design")
        self.assertIn("Focus mode: design.", instruction)
        self.assertIn("navigation clarity", instruction)

    def test_document_template_design_playbook_guides_realistic_invoice_layout(self) -> None:
        playbook = main._artifact_ai_template_design_playbook(
            "document_template",
            {"branding": {"primary_color": "#f97316", "accent_color": "#ea580c"}},
            {
                "id": "entity.billing_invoice",
                "label": "Billing Invoice",
                "fields": [
                    {"id": "billing_invoice.invoice_number", "type": "string"},
                    {"id": "billing_invoice.issue_date", "type": "date"},
                    {"id": "billing_invoice.total", "type": "currency"},
                ],
            },
            {"supports_line_items": True},
        )
        self.assertIn(
            "contemporary invoice/report structure",
            " ".join(playbook.get("design_principles") or []).lower(),
        )
        self.assertIn(
            "muted dividers",
            " ".join(playbook.get("style_guardrails") or []).lower(),
        )
        self.assertTrue(
            any("itemized table" in str(item).lower() for item in (playbook.get("component_priority") or [])),
            playbook,
        )

    def test_email_template_design_playbook_guides_realistic_branded_layout(self) -> None:
        playbook = main._artifact_ai_template_design_playbook(
            "email_template",
            {"branding": {"primary_color": "#2563eb", "accent_color": "#0f172a"}},
            {
                "id": "entity.billing_invoice",
                "label": "Billing Invoice",
                "fields": [
                    {"id": "billing_invoice.invoice_number", "type": "string"},
                    {"id": "billing_invoice.issue_date", "type": "date"},
                    {"id": "billing_invoice.total", "type": "currency"},
                ],
            },
            {"supports_line_items": True},
        )
        self.assertIn(
            "art direction",
            " ".join(playbook.get("design_principles") or []).lower(),
        )
        self.assertTrue(
            any("cta" in str(item).lower() for item in (playbook.get("component_priority") or [])),
            playbook,
        )

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
                            "footer_html": "<div>Page <span class=\"pageNumber\"></span> of <span class=\"totalPages\"></span></div>",
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

    def test_document_template_ai_plan_context_exposes_lookup_aliases_and_runtime_examples(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/documents/templates",
                json={
                    "name": "PO Document",
                    "description": "",
                    "filename_pattern": "po-document",
                    "html": "<p>PO</p>",
                },
            ).json()
            template_id = created["template"]["id"]

        captured: dict[str, object] = {}
        fake_entities = [
            {
                "id": "entity.biz_purchase_order",
                "label": "Purchase Order",
                "fields": [
                    {"id": "biz_purchase_order.po_number", "label": "PO Number", "type": "string"},
                    {
                        "id": "biz_purchase_order.supplier_id",
                        "label": "Supplier",
                        "type": "lookup",
                        "entity": "entity.biz_contact",
                        "display_field": "biz_contact.name",
                    },
                ],
            }
        ]
        fake_contact_entity = {
            "id": "entity.biz_contact",
            "label": "Contact",
            "fields": [
                {"id": "biz_contact.name", "label": "Name", "type": "string"},
                {"id": "biz_contact.email", "label": "Email", "type": "email"},
            ],
        }
        fake_purchase_order_line_entity = {
            "id": "entity.biz_purchase_order_line",
            "label": "Purchase Order Line",
            "fields": [
                {
                    "id": "biz_purchase_order_line.product_id",
                    "label": "Product",
                    "type": "lookup",
                    "entity": "entity.biz_product",
                    "display_field": "biz_product.name",
                },
                {"id": "biz_purchase_order_line.quantity", "label": "Quantity", "type": "number"},
                {"id": "biz_purchase_order_line.unit_cost", "label": "Unit Cost", "type": "currency"},
                {"id": "biz_purchase_order_line.line_total", "label": "Line Total", "type": "currency"},
            ],
        }
        fake_product_entity = {
            "id": "entity.biz_product",
            "label": "Product",
            "fields": [
                {"id": "biz_product.name", "label": "Name", "type": "string"},
            ],
        }

        def fake_openai(messages, model=None, temperature=0.2, response_format=None):
            captured["messages"] = messages
            return _fake_response(
                {
                    "summary": "Improved the purchase order document.",
                    "draft": {
                        "name": "PO Document",
                        "description": "Supplier-facing PDF.",
                        "filename_pattern": "PO-{{ record['biz_purchase_order.po_number'] }}",
                        "html": "<p>Hello {{ record['biz_purchase_order.supplier_name'] }}</p>",
                        "header_html": "<div>PO</div>",
                        "footer_html": "<div>Page <span class=\"pageNumber\"></span></div>",
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

        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.object(main, "_artifact_ai_entities", lambda _request: fake_entities),
            patch.object(
                main,
                "_find_entity_def_global",
                lambda entity_id: (
                    fake_contact_entity
                    if entity_id == "biz_contact" or entity_id == "entity.biz_contact"
                    else fake_purchase_order_line_entity
                    if entity_id == "biz_purchase_order_line" or entity_id == "entity.biz_purchase_order_line"
                    else fake_product_entity
                    if entity_id == "biz_product" or entity_id == "entity.biz_product"
                    else None
                ),
            ),
            patch.object(main, "_openai_chat_completion", fake_openai),
            patch.object(main, "_openai_configured", lambda: True),
        ):
            res = client.post(
                f"/documents/templates/{template_id}/ai/plan",
                json={
                    "prompt": "Create a supplier-facing purchase order document.",
                    "draft": {**created["template"], "variables_schema": {"entity_id": "entity.biz_purchase_order"}},
                    "sample": {"entity_id": "entity.biz_purchase_order"},
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
        self.assertIn("\"accessible_record_keys\"", context_text)
        self.assertIn("\"biz_purchase_order.supplier_name\"", context_text)
        self.assertIn("\"lookup_alias_keys\"", context_text)
        self.assertIn("\"document_runtime_examples\"", context_text)
        self.assertIn("\"pagination_footer_example\"", context_text)
        self.assertIn("\"accessible_line_item_keys\"", context_text)
        self.assertIn("\"preferred_line_item_keys\"", context_text)
        self.assertIn("\"example_row_columns\"", context_text)
        self.assertIn("\"biz_purchase_order_line.quantity\"", context_text)
        self.assertIn("\"line_item_table_example\"", context_text)
        self.assertIn("\"document_masthead_example\"", context_text)

    def test_document_template_ai_plan_context_for_billing_invoice_design_refresh_exposes_invoice_scaffolding(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/documents/templates",
                json={
                    "name": "Billing Invoice Template",
                    "description": "",
                    "filename_pattern": "invoice-document",
                    "html": "<p>Invoice</p>",
                },
            ).json()
            template_id = created["template"]["id"]

        captured: dict[str, object] = {}
        fake_entities = [
            {
                "id": "entity.billing_invoice",
                "label": "Billing Invoice",
                "fields": [
                    {"id": "billing_invoice.invoice_number", "label": "Invoice Number", "type": "string"},
                    {"id": "billing_invoice.issue_date", "label": "Issue Date", "type": "date"},
                    {"id": "billing_invoice.due_date", "label": "Due Date", "type": "date"},
                    {"id": "billing_invoice.status", "label": "Status", "type": "enum"},
                    {"id": "billing_invoice.subtotal", "label": "Subtotal", "type": "currency"},
                    {"id": "billing_invoice.tax", "label": "Tax", "type": "currency"},
                    {"id": "billing_invoice.total", "label": "Total", "type": "currency"},
                    {
                        "id": "billing_invoice.contact_id",
                        "label": "Client",
                        "type": "lookup",
                        "entity": "entity.biz_contact",
                        "display_field": "biz_contact.name",
                    },
                ],
            }
        ]
        fake_contact_entity = {
            "id": "entity.biz_contact",
            "label": "Contact",
            "fields": [
                {"id": "biz_contact.name", "label": "Name", "type": "string"},
                {"id": "biz_contact.email", "label": "Email", "type": "email"},
            ],
        }
        fake_invoice_line_entity = {
            "id": "entity.billing_invoice_line",
            "label": "Billing Invoice Line",
            "fields": [
                {
                    "id": "billing_invoice_line.invoice_id",
                    "label": "Invoice",
                    "type": "lookup",
                    "entity": "entity.billing_invoice",
                },
                {"id": "billing_invoice_line.description", "label": "Description", "type": "string"},
                {"id": "billing_invoice_line.quantity_hours", "label": "Quantity", "type": "number"},
                {"id": "billing_invoice_line.invoice_tax_rate", "label": "Tax Rate", "type": "number"},
                {"id": "billing_invoice_line.invoice_subtotal", "label": "Line Total", "type": "currency"},
            ],
        }

        def fake_openai(messages, model=None, temperature=0.2, response_format=None):
            captured["messages"] = messages
            return _fake_response(
                {
                    "summary": "Improved the invoice template.",
                    "draft": {
                        "name": "Billing Invoice Template",
                        "description": "Branded billing invoice.",
                        "filename_pattern": "Invoice - {{ record['billing_invoice.invoice_number'] }}",
                        "html": "<div>Invoice {{ record['billing_invoice.invoice_number'] }}</div>",
                        "header_html": "",
                        "footer_html": "<div>Page <span class=\"pageNumber\"></span></div>",
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

        with (
            patch.object(main, "_artifact_ai_entities", lambda _request: fake_entities),
            patch.object(
                main,
                "_find_entity_def_global",
                lambda entity_id: (
                    fake_contact_entity
                    if entity_id in {"biz_contact", "entity.biz_contact"}
                    else fake_invoice_line_entity
                    if entity_id in {"billing_invoice_line", "entity.billing_invoice_line"}
                    else None
                ),
            ),
            patch.object(main, "_openai_chat_completion", fake_openai),
            patch.object(main, "_openai_configured", lambda: True),
        ):
            res = client.post(
                f"/documents/templates/{template_id}/ai/plan",
                json={
                    "prompt": "Create a professionally designed branded invoice document for the billing module with modern layout and strong hierarchy.",
                    "draft": {**created["template"], "variables_schema": {"entity_id": "entity.billing_invoice"}},
                    "sample": {"entity_id": "entity.billing_invoice"},
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
        self.assertIn("\"requested_focus\": \"design\"", context_text)
        self.assertIn("\"supports_line_items\": true", context_text)
        self.assertIn("\"document_masthead_example\"", context_text)
        self.assertIn("\"line_item_table_example\"", context_text)
        self.assertIn("\"billing_invoice.contact_id_label\"", context_text)
        self.assertIn("\"billing_invoice_line.description\"", context_text)
        self.assertIn("\"billing_invoice_line.quantity_hours\"", context_text)
        self.assertIn("metadata band", context_text.lower())
        self.assertIn("muted dividers", context_text.lower())

    def test_template_ai_system_prompt_explicitly_forbids_bare_line_item_keys(self) -> None:
        email_prompt = main._artifact_ai_system_prompt("email_template")
        document_prompt = main._artifact_ai_system_prompt("document_template")

        self.assertIn("Bare line keys such as line['quantity']", email_prompt)
        self.assertIn("line_item_table_example", email_prompt)
        self.assertIn("preferred_line_item_keys", email_prompt)
        self.assertIn("Bare line keys such as line['quantity']", document_prompt)
        self.assertIn("line_item_table_example", document_prompt)
        self.assertIn("preferred_line_item_keys", document_prompt)
        self.assertIn("Prefer the branded masthead and logo inside draft.html, not header_html.", document_prompt)

    def test_email_template_ai_plan_returns_entity_decision_slot_when_entity_missing(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/email/templates",
                json={
                    "name": "Entityless Email",
                    "description": "",
                    "subject": "Hello",
                    "body_html": "<p>Hello</p>",
                    "body_text": "Hello",
                },
            ).json()
            template_id = created["template"]["id"]

        fake_entities = [
            {"id": "entity.biz_purchase_order", "label": "Purchase Order", "fields": []},
            {"id": "entity.biz_job", "label": "Job", "fields": []},
        ]

        def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
            return _fake_response(
                {
                    "summary": "Drafted the email template.",
                    "draft": {
                        "name": "Entityless Email",
                        "subject": "Hello",
                        "body_html": "<p>Hello</p>",
                        "body_text": "Hello",
                    },
                    "assumptions": [],
                    "warnings": [],
                }
            )

        class FakeConnectionStore:
            def get_default_email(self):
                return None

            def list(self, status=None):
                return []

        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.object(main, "_artifact_ai_entities", lambda _request: fake_entities),
            patch.object(main, "_openai_chat_completion", fake_openai),
            patch.object(main, "_openai_configured", lambda: True),
            patch.object(main, "connection_store", FakeConnectionStore()),
        ):
            res = client.post(
                f"/email/templates/{template_id}/ai/plan",
                json={"prompt": "Create a customer email template.", "draft": created["template"]},
            )
        body = res.json()
        self.assertEqual(res.status_code, 200, body)
        meta = body.get("required_question_meta") or {}
        self.assertEqual(meta.get("kind"), "decision_slot")
        self.assertEqual(meta.get("slot_kind"), "template_entity_choice")
        values = [item.get("value") for item in (meta.get("options") or []) if isinstance(item, dict)]
        self.assertEqual(values, ["entity.biz_purchase_order", "entity.biz_job"])

    def test_email_template_ai_plan_applies_selected_entity_and_connection_hints(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/email/templates",
                json={
                    "name": "Hinted Email",
                    "description": "",
                    "subject": "Hello",
                    "body_html": "<p>Hello</p>",
                    "body_text": "Hello",
                },
            ).json()
            template_id = created["template"]["id"]

        fake_entities = [
            {"id": "entity.biz_purchase_order", "label": "Purchase Order", "fields": []},
        ]

        def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
            return _fake_response(
                {
                    "summary": "Drafted the email template.",
                    "draft": {
                        "name": "Hinted Email",
                        "subject": "PO {{ record['biz_purchase_order.po_number'] }}",
                        "body_html": "<p>Hello</p>",
                        "body_text": "Hello",
                    },
                    "assumptions": [],
                    "warnings": [],
                }
            )

        class FakeConnectionStore:
            def get_default_email(self):
                return None

            def list(self, status=None):
                return [
                    {
                        "id": "conn_smtp_1",
                        "name": "Primary SMTP",
                        "type": "smtp",
                        "status": "active",
                        "config": {"from_email": "ops@example.com"},
                    }
                ]

        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.object(main, "_artifact_ai_entities", lambda _request: fake_entities),
            patch.object(main, "_openai_chat_completion", fake_openai),
            patch.object(main, "_openai_configured", lambda: True),
            patch.object(main, "connection_store", FakeConnectionStore()),
        ):
            res = client.post(
                f"/email/templates/{template_id}/ai/plan",
                json={
                    "prompt": "Create a customer email template.",
                    "draft": created["template"],
                    "hints": {
                        "selected_entity_id": "entity.biz_purchase_order",
                        "default_connection_id": "conn_smtp_1",
                    },
                },
            )
        body = res.json()
        self.assertEqual(res.status_code, 200, body)
        self.assertEqual(body.get("required_questions") or [], [])
        self.assertIsNone(body.get("required_question_meta"))
        draft = body.get("draft") or {}
        self.assertEqual((draft.get("variables_schema") or {}).get("entity_id"), "entity.biz_purchase_order")
        self.assertEqual(draft.get("default_connection_id"), "conn_smtp_1")

    def test_email_template_ai_plan_returns_connection_decision_slot_when_multiple_active_connections(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/email/templates",
                json={
                    "name": "Connection Choice Email",
                    "description": "",
                    "subject": "Hello",
                    "body_html": "<p>Hello</p>",
                    "body_text": "Hello",
                },
            ).json()
            template_id = created["template"]["id"]

        fake_entities = [{"id": "entity.biz_purchase_order", "label": "Purchase Order", "fields": []}]

        def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
            return _fake_response(
                {
                    "summary": "Drafted the email template.",
                    "draft": {
                        "name": "Connection Choice Email",
                        "subject": "Hello",
                        "body_html": "<p>Hello</p>",
                        "body_text": "Hello",
                    },
                    "assumptions": [],
                    "warnings": [],
                }
            )

        class FakeConnectionStore:
            def get_default_email(self):
                return None

            def list(self, status=None):
                return [
                    {
                        "id": "conn_smtp_1",
                        "name": "Primary SMTP",
                        "type": "smtp",
                        "status": "active",
                        "config": {"from_email": "ops@example.com"},
                    },
                    {
                        "id": "conn_postmark_1",
                        "name": "Postmark",
                        "type": "postmark",
                        "status": "active",
                        "config": {"from_email": "support@example.com"},
                    },
                ]

        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.object(main, "_artifact_ai_entities", lambda _request: fake_entities),
            patch.object(main, "_openai_chat_completion", fake_openai),
            patch.object(main, "_openai_configured", lambda: True),
            patch.object(main, "connection_store", FakeConnectionStore()),
        ):
            res = client.post(
                f"/email/templates/{template_id}/ai/plan",
                json={
                    "prompt": "Create a customer email template.",
                    "draft": created["template"],
                    "hints": {"selected_entity_id": "entity.biz_purchase_order"},
                },
            )
        body = res.json()
        self.assertEqual(res.status_code, 200, body)
        meta = body.get("required_question_meta") or {}
        self.assertEqual(meta.get("kind"), "decision_slot")
        self.assertEqual(meta.get("slot_kind"), "email_connection_choice")
        values = [item.get("value") for item in (meta.get("options") or []) if isinstance(item, dict)]
        self.assertEqual(values, ["conn_smtp_1", "conn_postmark_1"])

    def test_document_template_ai_plan_returns_entity_decision_slot_when_entity_missing(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/documents/templates",
                json={
                    "name": "Entityless Document",
                    "description": "",
                    "html": "<p>Hello</p>",
                    "variables_schema": {},
                },
            ).json()
            template_id = created["template"]["id"]

        fake_entities = [
            {"id": "entity.biz_purchase_order", "label": "Purchase Order", "fields": []},
            {"id": "entity.biz_job", "label": "Job", "fields": []},
        ]

        def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
            return _fake_response(
                {
                    "summary": "Drafted the document template.",
                    "draft": {
                        "name": "Entityless Document",
                        "html": "<p>Hello</p>",
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
                f"/documents/templates/{template_id}/ai/plan",
                json={"prompt": "Create a supplier-facing purchase order document.", "draft": created["template"]},
            )
        body = res.json()
        self.assertEqual(res.status_code, 200, body)
        meta = body.get("required_question_meta") or {}
        self.assertEqual(meta.get("kind"), "decision_slot")
        self.assertEqual(meta.get("slot_kind"), "template_entity_choice")
        values = [item.get("value") for item in (meta.get("options") or []) if isinstance(item, dict)]
        self.assertEqual(values, ["entity.biz_purchase_order", "entity.biz_job"])

    def test_document_template_ai_plan_overrides_wrong_current_entity_when_prompt_targets_different_entity(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/documents/templates",
                json={
                    "name": "Quote Template",
                    "description": "",
                    "filename_pattern": "quote.pdf",
                    "html": "<p>{{ record['biz_purchase_order.po_number'] }}</p>",
                    "variables_schema": {"entity_id": "entity.biz_purchase_order"},
                },
            ).json()
            template_id = created["template"]["id"]

        fake_entities = [
            {
                "id": "entity.biz_purchase_order",
                "label": "Purchase Order",
                "fields": [{"id": "biz_purchase_order.po_number", "label": "PO Number", "type": "string"}],
            },
            {
                "id": "entity.biz_quote",
                "label": "Quote",
                "fields": [{"id": "biz_quote.quote_number", "label": "Quote Number", "type": "string"}],
            },
        ]
        captured_context = {}

        def fake_find_entity(entity_id):
            for entity in fake_entities:
                if entity_id in {entity.get("id"), str(entity.get("id") or "").split(".")[-1]}:
                    return entity
            return None

        def fake_openai(messages, model=None, temperature=0.2, response_format=None):
            context_message = next(
                (
                    item.get("content")
                    for item in messages
                    if isinstance(item, dict)
                    and isinstance(item.get("content"), str)
                    and item.get("content", "").startswith("context.json")
                ),
                "",
            )
            payload = context_message.split("```json\n", 1)[1].rsplit("\n```", 1)[0]
            captured_context["value"] = json.loads(payload)
            return _fake_response(
                {
                    "summary": "Updated the template for quotes.",
                    "draft": {
                        "name": "Quote Template",
                        "filename_pattern": "quote_{{ record['biz_quote.quote_number'] }}.pdf",
                        "html": "<h1>Quote {{ record['biz_quote.quote_number'] }}</h1>",
                    },
                    "assumptions": [],
                    "warnings": [],
                }
            )

        prompt = (
            "Fix only the validation errors in this document template draft.\n\n"
            "Current goal: Updated the document template from a Purchase Order to a Quote.\n\n"
            "Errors:\n"
            "- filename_pattern: invalid record key 'biz_quote.quote_number'. Try record['biz_purchase_order.po_number'] instead.\n"
        )

        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.object(main, "_artifact_ai_entities", lambda _request: fake_entities),
            patch.object(main, "_find_entity_def_global", fake_find_entity),
            patch.object(main, "_openai_chat_completion", fake_openai),
            patch.object(main, "_openai_configured", lambda: True),
        ):
            res = client.post(
                f"/documents/templates/{template_id}/ai/plan",
                json={"prompt": prompt, "draft": created["template"]},
            )

        body = res.json()
        self.assertEqual(res.status_code, 200, body)
        self.assertEqual((captured_context.get("value") or {}).get("selected_entity_id"), "entity.biz_quote")
        draft = body.get("draft") or {}
        self.assertEqual((draft.get("variables_schema") or {}).get("entity_id"), "entity.biz_quote")
        self.assertTrue((body.get("validation") or {}).get("compiled_ok"), body)

    def test_document_template_validation_flags_invalid_record_key_and_pagination_jinja(self) -> None:
        fake_purchase_order_entity = {
            "id": "entity.biz_purchase_order",
            "label": "Purchase Order",
            "fields": [
                {"id": "biz_purchase_order.po_number", "label": "PO Number", "type": "string"},
                {
                    "id": "biz_purchase_order.supplier_id",
                    "label": "Supplier",
                    "type": "lookup",
                    "entity": "entity.biz_contact",
                    "display_field": "biz_contact.name",
                },
            ],
        }
        fake_contact_entity = {
            "id": "entity.biz_contact",
            "label": "Contact",
            "fields": [
                {"id": "biz_contact.name", "label": "Name", "type": "string"},
                {"id": "biz_contact.email", "label": "Email", "type": "email"},
            ],
        }

        def fake_find_entity(entity_id):
            if entity_id in {"entity.biz_purchase_order", "biz_purchase_order"}:
                return fake_purchase_order_entity
            if entity_id in {"entity.biz_contact", "biz_contact"}:
                return fake_contact_entity
            return None

        with patch.object(main, "_find_entity_def_global", fake_find_entity):
            validation = main._artifact_ai_validate_doc_template_draft(
                {
                    "name": "PO Document",
                    "filename_pattern": "PO-{{ record['biz_purchase_order.po_number'] }}",
                    "html": "<p>Hello {{ record['biz_contact.name'] }}</p>",
                    "header_html": "<div>PO</div>",
                    "footer_html": "<div>Page {{ pageNumber }}</div>",
                    "paper_size": "A4",
                    "margin_top": "12mm",
                    "margin_right": "12mm",
                    "margin_bottom": "12mm",
                    "margin_left": "12mm",
                    "variables_schema": {"entity_id": "entity.biz_purchase_order"},
                }
            )

        self.assertFalse(validation.get("compiled_ok"))
        messages = [item.get("message") for item in (validation.get("errors") or []) if isinstance(item, dict)]
        self.assertTrue(any("invalid record key 'biz_contact.name'" in str(message) for message in messages), messages)
        self.assertTrue(any('class="pageNumber"' in str(message) for message in messages), messages)

    def test_document_template_validation_flags_invalid_line_item_key_and_suggests_full_field_id(self) -> None:
        fake_purchase_order_entity = {
            "id": "entity.biz_purchase_order",
            "label": "Purchase Order",
            "fields": [
                {"id": "biz_purchase_order.po_number", "label": "PO Number", "type": "string"},
            ],
        }
        fake_purchase_order_line_entity = {
            "id": "entity.biz_purchase_order_line",
            "label": "Purchase Order Line",
            "fields": [
                {"id": "biz_purchase_order_line.quantity", "label": "Quantity", "type": "number"},
                {"id": "biz_purchase_order_line.unit_cost", "label": "Unit Cost", "type": "currency"},
                {"id": "biz_purchase_order_line.line_total", "label": "Line Total", "type": "currency"},
            ],
        }

        def fake_find_entity(entity_id):
            if entity_id in {"entity.biz_purchase_order", "biz_purchase_order"}:
                return fake_purchase_order_entity
            if entity_id in {"entity.biz_purchase_order_line", "biz_purchase_order_line"}:
                return fake_purchase_order_line_entity
            return None

        with patch.object(main, "_find_entity_def_global", fake_find_entity):
            validation = main._artifact_ai_validate_doc_template_draft(
                {
                    "name": "PO Document",
                    "filename_pattern": "PO-{{ record['biz_purchase_order.po_number'] }}",
                    "html": (
                        "<table>{% for line in lines %}"
                        "<tr><td>{{ line['quantity'] }}</td><td>{{ line['unit_cost'] }}</td></tr>"
                        "{% endfor %}</table>"
                    ),
                    "paper_size": "A4",
                    "margin_top": "12mm",
                    "margin_right": "12mm",
                    "margin_bottom": "12mm",
                    "margin_left": "12mm",
                    "variables_schema": {"entity_id": "entity.biz_purchase_order"},
                }
            )

        self.assertFalse(validation.get("compiled_ok"))
        messages = [item.get("message") for item in (validation.get("errors") or []) if isinstance(item, dict)]
        self.assertTrue(any("invalid line item key 'quantity'" in str(message) for message in messages), messages)
        self.assertTrue(any("line['biz_purchase_order_line.quantity']" in str(message) for message in messages), messages)

    def test_document_template_normalizer_rewrites_bare_line_item_keys_to_full_field_ids(self) -> None:
        fake_purchase_order_line_entity = {
            "id": "entity.biz_purchase_order_line",
            "label": "Purchase Order Line",
            "fields": [
                {"id": "biz_purchase_order_line.quantity", "label": "Quantity", "type": "number"},
                {"id": "biz_purchase_order_line.unit_cost", "label": "Unit Cost", "type": "currency"},
                {"id": "biz_purchase_order_line.line_total", "label": "Line Total", "type": "currency"},
            ],
        }

        def fake_find_entity(entity_id):
            if entity_id in {"entity.biz_purchase_order_line", "biz_purchase_order_line"}:
                return fake_purchase_order_line_entity
            return None

        with patch.object(main, "_find_entity_def_global", fake_find_entity):
            normalized = main._artifact_ai_normalize_doc_template_draft(
                {},
                {
                    "name": "PO Document",
                    "html": (
                        "<table>{% for line in lines %}"
                        "<tr><td>{{ line['quantity'] }}</td><td>{{ line['unit_cost'] }}</td><td>{{ line.line_total }}</td></tr>"
                        "{% endfor %}</table>"
                    ),
                    "variables_schema": {"entity_id": "entity.biz_purchase_order"},
                },
            )

        html = normalized.get("html") or ""
        self.assertIn("line['biz_purchase_order_line.quantity']", html)
        self.assertIn("line['biz_purchase_order_line.unit_cost']", html)
        self.assertIn("line['biz_purchase_order_line.line_total']", html)

    def test_document_template_normalizer_rewrites_quote_line_item_keys_with_generic_line_detection(self) -> None:
        fake_quote_line_entity = {
            "id": "entity.biz_quote_line",
            "label": "Quote Line",
            "fields": [
                {
                    "id": "biz_quote_line.quote_id",
                    "label": "Quote",
                    "type": "lookup",
                    "entity": "entity.biz_quote",
                },
                {"id": "biz_quote_line.description", "label": "Description", "type": "string"},
                {"id": "biz_quote_line.quantity", "label": "Quantity", "type": "number"},
                {"id": "biz_quote_line.unit_price", "label": "Unit Price", "type": "currency"},
                {"id": "biz_quote_line.line_total", "label": "Line Total", "type": "currency"},
            ],
        }

        def fake_find_entity(entity_id):
            if entity_id in {"entity.biz_quote_line", "biz_quote_line"}:
                return fake_quote_line_entity
            return None

        with patch.object(main, "_find_entity_def_global", fake_find_entity):
            normalized = main._artifact_ai_normalize_doc_template_draft(
                {},
                {
                    "name": "Quote Document",
                    "html": (
                        "<table>{% for line in lines %}"
                        "<tr><td>{{ line['description'] }}</td><td>{{ line.quantity }}</td>"
                        "<td>{{ line['unit_price'] }}</td><td>{{ line.line_total }}</td></tr>"
                        "{% endfor %}</table>"
                    ),
                    "variables_schema": {"entity_id": "entity.biz_quote"},
                },
            )

        html = normalized.get("html") or ""
        self.assertIn("line['biz_quote_line.description']", html)
        self.assertIn("line['biz_quote_line.quantity']", html)
        self.assertIn("line['biz_quote_line.unit_price']", html)
        self.assertIn("line['biz_quote_line.line_total']", html)

    def test_template_helpers_prioritize_generic_commercial_quote_line_fields(self) -> None:
        fake_quote_line_entity = {
            "id": "entity.biz_quote_line",
            "label": "Quote Line",
            "fields": [
                {"id": "biz_quote_line.id", "label": "ID", "type": "string"},
                {
                    "id": "biz_quote_line.quote_id",
                    "label": "Quote",
                    "type": "lookup",
                    "entity": "entity.biz_quote",
                },
                {"id": "biz_quote_line.product_id", "label": "Product", "type": "lookup", "entity": "entity.biz_product"},
                {"id": "biz_quote_line.description", "label": "Description", "type": "string"},
                {"id": "biz_quote_line.quantity", "label": "Quantity", "type": "number"},
                {"id": "biz_quote_line.unit_price", "label": "Unit Price", "type": "currency"},
                {"id": "biz_quote_line.line_total", "label": "Line Total", "type": "currency"},
            ],
        }
        fake_product_entity = {
            "id": "entity.biz_product",
            "label": "Product",
            "fields": [{"id": "biz_product.name", "label": "Name", "type": "string"}],
        }

        def fake_find_entity(entity_id):
            if entity_id in {"entity.biz_quote_line", "biz_quote_line"}:
                return fake_quote_line_entity
            if entity_id in {"entity.biz_product", "biz_product"}:
                return fake_product_entity
            return None

        with patch.object(main, "_find_entity_def_global", fake_find_entity):
            helpers = main._artifact_ai_template_helpers("entity.biz_quote")

        preferred_keys = helpers.get("preferred_line_item_keys") or []
        self.assertGreaterEqual(len(preferred_keys), 4)
        self.assertEqual(preferred_keys[:4], [
            "biz_quote_line.product_name",
            "biz_quote_line.description",
            "biz_quote_line.quantity",
            "biz_quote_line.unit_price",
        ])
        example_columns = helpers.get("example_row_columns") or []
        self.assertEqual(
            [item.get("label") for item in example_columns[:4]],
            ["Product", "Description", "Quantity", "Unit Price"],
        )

    def test_template_safe_jinja_examples_use_preferred_fields_for_quote_documents(self) -> None:
        fake_quote_entity = {
            "id": "entity.biz_quote",
            "label": "Quote",
            "display_field": "biz_quote.quote_number",
            "fields": [
                {"id": "biz_quote.id", "label": "ID", "type": "string"},
                {"id": "biz_quote.quote_number", "label": "Quote Number", "type": "string"},
                {"id": "biz_quote.quote_date", "label": "Quote Date", "type": "date"},
                {"id": "biz_quote.customer_reference", "label": "Customer Reference", "type": "string"},
            ],
        }
        fake_quote_line_entity = {
            "id": "entity.biz_quote_line",
            "label": "Quote Line",
            "fields": [
                {
                    "id": "biz_quote_line.quote_id",
                    "label": "Quote",
                    "type": "lookup",
                    "entity": "entity.biz_quote",
                },
                {"id": "biz_quote_line.description", "label": "Description", "type": "string"},
                {"id": "biz_quote_line.quantity", "label": "Quantity", "type": "number"},
                {"id": "biz_quote_line.unit_price", "label": "Unit Price", "type": "currency"},
                {"id": "biz_quote_line.line_total", "label": "Line Total", "type": "currency"},
            ],
        }

        def fake_find_entity(entity_id):
            if entity_id in {"entity.biz_quote", "biz_quote"}:
                return fake_quote_entity
            if entity_id in {"entity.biz_quote_line", "biz_quote_line"}:
                return fake_quote_line_entity
            return None

        with patch.object(main, "_find_entity_def_global", fake_find_entity):
            examples = main._artifact_ai_template_safe_jinja_examples(fake_quote_entity)

        self.assertIn("record['biz_quote.quote_number']", examples.get("record_field_example") or "")
        self.assertIn("line['biz_quote_line.description']", examples.get("line_item_field_example") or "")
        masthead_example = examples.get("document_masthead_example") or ""
        self.assertIn("workspace.logo_url", masthead_example)
        self.assertIn("<img src=", masthead_example)
        self.assertIn("Document Title", masthead_example)
        table_example = examples.get("line_item_table_example") or ""
        self.assertIn("<th>Description</th>", table_example)
        self.assertIn("<th>Quantity</th>", table_example)
        self.assertIn("<th>Unit Price</th>", table_example)
        self.assertIn("line['biz_quote_line.line_total']", table_example)

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
        self.assertIn("\"shared_capability_catalog\"", context_text)
        self.assertIn("\"quick_actions\"", context_text)
        self.assertIn("\"module\"", context_text)
        self.assertIn("\"automation\"", context_text)
        self.assertIn("\"design_playbook\"", context_text)
        self.assertIn("\"design_principles\"", context_text)
        self.assertIn("\"component_priority\"", context_text)
        self.assertIn("\"adaptation_rules\"", context_text)
        self.assertIn("\"design_signals\"", context_text)
        self.assertIn("\"quote.number\"", context_text)
        self.assertIn("\"field_ids_by_type\"", context_text)
        self.assertIn("\"accessible_record_keys\"", context_text)
        self.assertIn("\"record_field_example\"", context_text)

    def test_email_template_ai_plan_context_exposes_lookup_alias_record_keys(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/email/templates",
                json={
                    "name": "PO Notice",
                    "description": "",
                    "subject": "PO",
                    "body_html": "<p>Hello</p>",
                    "body_text": "Hello",
                },
            ).json()
            template_id = created["template"]["id"]

        captured: dict[str, object] = {}
        fake_entities = [
            {
                "id": "entity.biz_purchase_order",
                "label": "Purchase Order",
                "fields": [
                    {"id": "biz_purchase_order.po_number", "label": "PO Number", "type": "string"},
                    {
                        "id": "biz_purchase_order.supplier_id",
                        "label": "Supplier",
                        "type": "lookup",
                        "entity": "entity.biz_contact",
                        "display_field": "biz_contact.name",
                    },
                ],
            }
        ]
        fake_contact_entity = {
            "id": "entity.biz_contact",
            "label": "Contact",
            "fields": [
                {"id": "biz_contact.name", "label": "Name", "type": "string"},
                {"id": "biz_contact.email", "label": "Email", "type": "email"},
            ],
        }

        def fake_openai(messages, model=None, temperature=0.2, response_format=None):
            captured["messages"] = messages
            return _fake_response(
                {
                    "summary": "Improved the purchase order email.",
                    "draft": {
                        "name": "PO Notice",
                        "description": "Supplier notice.",
                        "subject": "Purchase order {{ record['biz_purchase_order.po_number'] }}",
                        "body_html": "<p>Hello {{ record['biz_purchase_order.supplier_name'] }}</p>",
                        "body_text": "Hello {{ record['biz_purchase_order.supplier_name'] }}",
                    },
                    "assumptions": [],
                    "warnings": [],
                }
            )

        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.object(main, "_artifact_ai_entities", lambda _request: fake_entities),
            patch.object(main, "_find_entity_def_global", lambda entity_id: fake_contact_entity if entity_id == "biz_contact" or entity_id == "entity.biz_contact" else None),
            patch.object(main, "_openai_chat_completion", fake_openai),
            patch.object(main, "_openai_configured", lambda: True),
        ):
            res = client.post(
                f"/email/templates/{template_id}/ai/plan",
                json={
                    "prompt": "Create a supplier-facing purchase order email.",
                    "draft": created["template"],
                    "sample": {"entity_id": "entity.biz_purchase_order"},
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
        self.assertIn("\"accessible_record_keys\"", context_text)
        self.assertIn("\"biz_purchase_order.supplier_name\"", context_text)
        self.assertIn("\"lookup_alias_keys\"", context_text)
        self.assertIn("\"lookup_alias_example\"", context_text)

    def test_email_template_validation_flags_invalid_record_key_and_suggests_lookup_alias(self) -> None:
        fake_purchase_order_entity = {
            "id": "entity.biz_purchase_order",
            "label": "Purchase Order",
            "fields": [
                {"id": "biz_purchase_order.po_number", "label": "PO Number", "type": "string"},
                {
                    "id": "biz_purchase_order.supplier_id",
                    "label": "Supplier",
                    "type": "lookup",
                    "entity": "entity.biz_contact",
                    "display_field": "biz_contact.name",
                },
            ],
        }
        fake_contact_entity = {
            "id": "entity.biz_contact",
            "label": "Contact",
            "fields": [
                {"id": "biz_contact.name", "label": "Name", "type": "string"},
                {"id": "biz_contact.email", "label": "Email", "type": "email"},
            ],
        }

        def fake_find_entity(entity_id):
            if entity_id in {"entity.biz_purchase_order", "biz_purchase_order"}:
                return fake_purchase_order_entity
            if entity_id in {"entity.biz_contact", "biz_contact"}:
                return fake_contact_entity
            return None

        with patch.object(main, "_find_entity_def_global", fake_find_entity):
            validation = main._artifact_ai_validate_email_template_draft(
                {
                    "name": "PO Notice",
                    "subject": "Purchase order {{ record['biz_purchase_order.po_number'] }}",
                    "body_html": "<p>Hello {{ record['biz_contact.name'] }}</p>",
                    "body_text": "Hello {{ record['biz_contact.name'] }}",
                    "variables_schema": {"entity_id": "entity.biz_purchase_order"},
                }
            )

        self.assertFalse(validation.get("compiled_ok"))
        messages = [item.get("message") for item in (validation.get("errors") or []) if isinstance(item, dict)]
        self.assertTrue(any("invalid record key 'biz_contact.name'" in str(message) for message in messages), messages)
        self.assertTrue(any("record['biz_purchase_order.supplier_name']" in str(message) for message in messages), messages)

    def test_validate_email_template_endpoint_flags_invalid_record_key(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/email/templates",
                json={
                    "name": "PO Notice",
                    "description": "",
                    "subject": "PO",
                    "body_html": "<p>Hello</p>",
                    "body_text": "Hello",
                },
            ).json()
            template_id = created["template"]["id"]

        fake_purchase_order_entity = {
            "id": "entity.biz_purchase_order",
            "label": "Purchase Order",
            "fields": [
                {"id": "biz_purchase_order.po_number", "label": "PO Number", "type": "string"},
                {
                    "id": "biz_purchase_order.supplier_id",
                    "label": "Supplier",
                    "type": "lookup",
                    "entity": "entity.biz_contact",
                    "display_field": "biz_contact.name",
                },
            ],
        }
        fake_contact_entity = {
            "id": "entity.biz_contact",
            "label": "Contact",
            "fields": [
                {"id": "biz_contact.name", "label": "Name", "type": "string"},
                {"id": "biz_contact.email", "label": "Email", "type": "email"},
            ],
        }

        def fake_find_entity(entity_id):
            if entity_id in {"entity.biz_purchase_order", "biz_purchase_order"}:
                return fake_purchase_order_entity
            if entity_id in {"entity.biz_contact", "biz_contact"}:
                return fake_contact_entity
            return None

        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.object(main, "_find_entity_def_global", fake_find_entity),
        ):
            res = client.post(
                f"/email/templates/{template_id}/validate",
                json={
                    "draft": {
                        **created["template"],
                        "subject": "Purchase order {{ record['biz_purchase_order.po_number'] }}",
                        "body_html": "<p>Hello {{ record['biz_contact.name'] }}</p>",
                        "body_text": "Hello {{ record['biz_contact.name'] }}",
                        "variables_schema": {"entity_id": "entity.biz_purchase_order"},
                    }
                },
            )
        body = res.json()
        self.assertEqual(res.status_code, 200, body)
        self.assertFalse(body.get("compiled_ok"), body)
        validation_errors = body.get("errors") or []
        messages = [item.get("message") for item in validation_errors if isinstance(item, dict)]
        self.assertTrue(any("invalid record key 'biz_contact.name'" in str(message) for message in messages), messages)

    def test_send_test_email_template_uses_draft_override_instead_of_stored_template(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/email/templates",
                json={
                    "name": "Order Notice",
                    "description": "",
                    "subject": "PO {{ record['te_purchase_order.po_number'] }}",
                    "body_html": "<p>Supplier {{ record['te_purchase_order.supplier_name'] }}</p>",
                    "body_text": "Supplier {{ record['te_purchase_order.supplier_name'] }}",
                    "variables_schema": {"entity_id": "entity.te_purchase_order"},
                },
            ).json()
            template_id = created["template"]["id"]

        fake_connection = {
            "id": "conn-email",
            "type": "email",
            "config": {"from_email": "noreply@example.com"},
        }

        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.object(main.connection_store, "get_default_email", return_value=fake_connection),
        ):
            res = client.post(
                f"/email/templates/{template_id}/send_test",
                json={
                    "to_email": "nick@example.com",
                    "draft": {
                        **created["template"],
                        "subject": "SO {{ record['te_supplier_order.order_number'] }}",
                        "body_html": "<p>Customer {{ record['te_supplier_order.customer_name'] }}</p>",
                        "body_text": "Customer {{ record['te_supplier_order.customer_name'] }}",
                        "variables_schema": {"entity_id": "entity.te_supplier_order"},
                    },
                    "sample": {
                        "entity_id": "entity.te_supplier_order",
                        "record_id": "so-1",
                        "record": {
                            "te_supplier_order.order_number": "SO-1001",
                            "te_supplier_order.customer_name": "Northwind",
                        },
                    },
                },
            )

        body = res.json()
        self.assertEqual(res.status_code, 200, body)
        outbox = main.email_store.get_outbox(body.get("outbox_id"))
        self.assertIsInstance(outbox, dict)
        self.assertEqual(outbox.get("subject"), "SO SO-1001")
        self.assertIn("Northwind", str(outbox.get("body_html") or ""))
        self.assertNotIn("te_purchase_order", str(outbox.get("body_html") or ""))

    def test_send_test_email_template_falls_back_to_draft_entity_when_sample_entity_missing(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/email/templates",
                json={
                    "name": "Order Notice",
                    "description": "",
                    "subject": "PO {{ record['te_purchase_order.po_number'] }}",
                    "body_html": "<p>Supplier {{ record['te_purchase_order.supplier_name'] }}</p>",
                    "body_text": "Supplier {{ record['te_purchase_order.supplier_name'] }}",
                    "variables_schema": {"entity_id": "entity.te_purchase_order"},
                },
            ).json()
            template_id = created["template"]["id"]

        fake_connection = {
            "id": "conn-email",
            "type": "email",
            "config": {"from_email": "noreply@example.com"},
        }

        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.object(main.connection_store, "get_default_email", return_value=fake_connection),
        ):
            res = client.post(
                f"/email/templates/{template_id}/send_test",
                json={
                    "to_email": "nick@example.com",
                    "draft": {
                        **created["template"],
                        "subject": "SO {{ record['te_supplier_order.order_number'] }}",
                        "body_html": "<p>Customer {{ record['te_supplier_order.customer_name'] }}</p>",
                        "body_text": "Customer {{ record['te_supplier_order.customer_name'] }}",
                        "variables_schema": {"entity_id": "entity.te_supplier_order"},
                    },
                    "sample": {
                        "record": {
                            "te_supplier_order.order_number": "SO-1001",
                            "te_supplier_order.customer_name": "Northwind",
                        },
                    },
                },
            )

        body = res.json()
        self.assertEqual(res.status_code, 200, body)
        outbox = main.email_store.get_outbox(body.get("outbox_id"))
        self.assertIsInstance(outbox, dict)
        self.assertEqual(outbox.get("subject"), "SO SO-1001")
        self.assertIn("Northwind", str(outbox.get("body_html") or ""))
        self.assertNotIn("te_purchase_order", str(outbox.get("body_html") or ""))

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

    def test_email_template_ai_plan_normalizes_scalar_assumptions_and_warnings(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/email/templates",
                json={
                    "name": "Purchase Order Email",
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
                        "summary": "Created a purchase order email template with appropriate branding and dynamic fields.",
                        "draft": {
                            "name": "Purchase Order Email",
                            "description": "",
                            "subject": "Purchase Order {{ record['purchase_order.number'] }}",
                            "body_html": "<p>Please find purchase order {{ record['purchase_order.number'] }} attached.</p>",
                            "body_text": "Please find purchase order {{ record['purchase_order.number'] }} attached.",
                        },
                        "assumptions": "The email template is designed to send purchase order notifications to clients, utilizing the purchase order entity and its fields.",
                        "warnings": "Send from the correct mailbox before going live.",
                    }
                )

            with patch.object(main, "_openai_chat_completion", fake_openai), patch.object(main, "_openai_configured", lambda: True):
                res = client.post(
                    f"/email/templates/{template_id}/ai/plan",
                    json={
                        "prompt": "Create me an email template to send purchase orders off to client!",
                        "draft": created["template"],
                    },
                )
        body = res.json()
        self.assertEqual(res.status_code, 200, body)
        self.assertEqual(
            body.get("assumptions"),
            ["The email template is designed to send purchase order notifications to clients, utilizing the purchase order entity and its fields."],
        )
        self.assertEqual(body.get("warnings"), ["Send from the correct mailbox before going live."])

    def test_email_template_preview_uses_draft_override(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/email/templates",
                json={
                    "name": "Welcome",
                    "description": "",
                    "subject": "Stored subject",
                    "body_html": "<p>Stored body</p>",
                    "body_text": "Stored body",
                },
            ).json()
            template_id = created["template"]["id"]
            res = client.post(
                f"/email/templates/{template_id}/preview",
                json={
                    "sample": {
                        "entity_id": "entity.quote",
                        "record": {
                            "quote.number": "Q-1001",
                        },
                    },
                    "draft": {
                        **created["template"],
                        "subject": "Draft subject",
                        "body_html": "<p>Draft body</p>",
                        "body_text": "Draft body",
                    },
                },
            )
        body = res.json()
        self.assertEqual(res.status_code, 200, body)
        self.assertEqual(body.get("rendered_subject"), "Draft subject")
        self.assertIn("Draft body", body.get("rendered_html", ""))

    def test_email_template_preview_falls_back_to_draft_entity_when_sample_entity_missing(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/email/templates",
                json={
                    "name": "Welcome",
                    "description": "",
                    "subject": "Stored {{ record['te_purchase_order.po_number'] }}",
                    "body_html": "<p>Stored {{ record['te_purchase_order.supplier_name'] }}</p>",
                    "body_text": "Stored {{ record['te_purchase_order.supplier_name'] }}",
                    "variables_schema": {"entity_id": "entity.te_purchase_order"},
                },
            ).json()
            template_id = created["template"]["id"]
            res = client.post(
                f"/email/templates/{template_id}/preview",
                json={
                    "sample": {
                        "record": {
                            "te_supplier_order.order_number": "SO-1001",
                            "te_supplier_order.customer_name": "Northwind",
                        },
                    },
                    "draft": {
                        **created["template"],
                        "subject": "Draft {{ record['te_supplier_order.order_number'] }}",
                        "body_html": "<p>Draft {{ record['te_supplier_order.customer_name'] }}</p>",
                        "body_text": "Draft {{ record['te_supplier_order.customer_name'] }}",
                        "variables_schema": {"entity_id": "entity.te_supplier_order"},
                    },
                },
            )
        body = res.json()
        self.assertEqual(res.status_code, 200, body)
        self.assertEqual(body.get("rendered_subject"), "Draft SO-1001")
        self.assertIn("Northwind", body.get("rendered_html", ""))
        self.assertNotIn("te_purchase_order", body.get("rendered_html", ""))

    def test_email_template_preview_uses_rich_render_context(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/email/templates",
                json={
                    "name": "Purchase Order",
                    "description": "",
                    "subject": "PO {{ company.name }}",
                    "body_html": (
                        "<div>"
                        "<img src=\"{{ workspace.logo_url }}\" />"
                        "<p>Hello {{ record['biz_purchase_order.supplier_name'] }}</p>"
                        "<p>{{ company.name }}</p>"
                        "</div>"
                    ),
                    "body_text": "PO {{ company.name }}",
                    "variables_schema": {"entity_id": "entity.biz_purchase_order"},
                },
            ).json()
            template_id = created["template"]["id"]
            with patch.object(main, "_branding_context_for_org", lambda _org_id: {
                "workspace": {"logo_url": "https://example.com/logo.png", "name": "Mekka"},
                "company": {"name": "Mekka"},
                "branding": {"logo_url": "https://example.com/logo.png"},
            }):
                res = client.post(
                    f"/email/templates/{template_id}/preview",
                    json={
                        "sample": {
                            "entity_id": "entity.biz_purchase_order",
                            "record": {
                                "biz_purchase_order.po_number": "PO-1001",
                                "biz_purchase_order.supplier_name": "Umma",
                            },
                        },
                    },
                )
        body = res.json()
        self.assertEqual(res.status_code, 200, body)
        self.assertEqual(body.get("rendered_subject"), "PO Mekka")
        self.assertIn("https://example.com/logo.png", body.get("rendered_html", ""))
        self.assertIn("Hello Umma", body.get("rendered_html", ""))
        self.assertIn("Mekka", body.get("rendered_html", ""))

    def test_email_template_validate_without_sample_uses_placeholder_branding_context(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/email/templates",
                json={
                    "name": "Invoicing Email Template",
                    "description": "",
                    "subject": "Invoice {{ record['billing_invoice.invoice_number'] }}",
                    "body_html": (
                        "<div>"
                        "<img src=\"{{ workspace.logo_url }}\" alt=\"Company Logo\" />"
                        "<p style=\"color: {{ branding.colors.primary }};\">"
                        "Invoice {{ record['billing_invoice.invoice_number'] }}"
                        "</p>"
                        "</div>"
                    ),
                    "body_text": "Invoice {{ record['billing_invoice.invoice_number'] }}",
                    "variables_schema": {"entity_id": "entity.billing_invoice"},
                },
            ).json()
            template_id = created["template"]["id"]
            with patch.object(main, "_branding_context_for_org", lambda _org_id: {
                "workspace": {"logo_url": "https://example.com/logo.png", "name": "Octodrop"},
                "company": {"name": "Octodrop"},
                "branding": {"logo_url": "https://example.com/logo.png", "colors": {"primary": "#ff6a00"}},
            }):
                res = client.post(f"/email/templates/{template_id}/validate", json={})
        body = res.json()
        self.assertEqual(res.status_code, 200, body)
        self.assertEqual(body.get("errors"), [], body)
        undefined = set(body.get("undefined") or [])
        self.assertFalse({"branding", "workspace", "record"} & undefined, body)

    def test_document_template_validate_without_sample_uses_placeholder_branding_and_lines(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/documents/templates",
                json={
                    "name": "Billing Invoice Template",
                    "description": "",
                    "filename_pattern": "invoice_{{ record['billing_invoice.invoice_number'] }}",
                    "html": (
                        "<div style=\"font-family: Arial, sans-serif;\">"
                        "<img src=\"{{ workspace.logo_url }}\" alt=\"Company Logo\" />"
                        "<h1 style=\"color: {{ branding.colors.primary }};\">Invoice</h1>"
                        "<p>{{ record['billing_invoice.invoice_number'] }}</p>"
                        "<table><tbody>{% for line in lines %}"
                        "<tr><td>{{ line['billing_invoice_line.description'] }}</td></tr>"
                        "{% endfor %}</tbody></table>"
                        "</div>"
                    ),
                    "variables_schema": {"entity_id": "entity.billing_invoice"},
                },
            ).json()
            template_id = created["template"]["id"]
            with patch.object(main, "_branding_context_for_org", lambda _org_id: {
                "workspace": {"logo_url": "https://example.com/logo.png", "name": "Octodrop"},
                "company": {"name": "Octodrop"},
                "branding": {"logo_url": "https://example.com/logo.png", "colors": {"primary": "#ff6a00"}},
            }):
                res = client.post(f"/docs/templates/{template_id}/validate", json={})
        body = res.json()
        self.assertEqual(res.status_code, 200, body)
        self.assertEqual(body.get("errors"), [], body)
        undefined = set(body.get("undefined") or [])
        self.assertFalse({"branding", "workspace", "record", "lines"} & undefined, body)

    def test_document_template_draft_validation_supports_branding_and_lines_without_sample(self) -> None:
        with patch.object(main, "_branding_context_for_org", lambda _org_id: {
            "workspace": {"logo_url": "https://example.com/logo.png", "name": "Octodrop"},
            "company": {"name": "Octodrop"},
            "branding": {"logo_url": "https://example.com/logo.png", "colors": {"primary": "#ff6a00"}},
        }):
            validation = main._artifact_ai_validate_doc_template_draft(
                {
                    "name": "Billing Invoice Template",
                    "filename_pattern": "invoice_{{ record['billing_invoice.invoice_number'] }}",
                    "html": (
                        "<div>"
                        "<img src=\"{{ workspace.logo_url }}\" alt=\"Company Logo\" />"
                        "<h1 style=\"color: {{ branding.colors.primary }};\">Invoice</h1>"
                        "{% for line in lines %}<span>{{ line['billing_invoice_line.description'] }}</span>{% endfor %}"
                        "</div>"
                    ),
                    "variables_schema": {"entity_id": "entity.billing_invoice"},
                }
            )
        self.assertTrue(validation.get("compiled_ok"), validation)
        self.assertEqual(validation.get("errors"), [], validation)
        undefined = set(validation.get("undefined") or [])
        self.assertFalse({"branding", "workspace", "record", "lines"} & undefined, validation)

    def test_document_template_draft_validation_supports_lookup_label_alias_without_sample(self) -> None:
        fake_invoice_entity = {
            "id": "entity.billing_invoice",
            "label": "Billing Invoice",
            "fields": [
                {"id": "billing_invoice.invoice_number", "label": "Invoice Number", "type": "string"},
                {
                    "id": "billing_invoice.contact_id",
                    "label": "Contact",
                    "type": "lookup",
                    "entity": "entity.biz_contact",
                    "display_field": "biz_contact.name",
                },
            ],
        }
        fake_contact_entity = {
            "id": "entity.biz_contact",
            "label": "Contact",
            "fields": [
                {"id": "biz_contact.name", "label": "Name", "type": "string"},
                {"id": "biz_contact.email", "label": "Email", "type": "email"},
            ],
        }

        def fake_find_entity(entity_id):
            if entity_id in {"entity.billing_invoice", "billing_invoice"}:
                return fake_invoice_entity
            if entity_id in {"entity.biz_contact", "biz_contact"}:
                return fake_contact_entity
            return None

        with patch.object(main, "_find_entity_def_global", fake_find_entity):
            validation = main._artifact_ai_validate_doc_template_draft(
                {
                    "name": "Invoice Template",
                    "filename_pattern": "invoice_{{ record['billing_invoice.invoice_number'] }}",
                    "html": "<p>{{ record['billing_invoice.contact_id_label'] }}</p>",
                    "variables_schema": {"entity_id": "entity.billing_invoice"},
                }
            )

        self.assertTrue(validation.get("compiled_ok"), validation)
        self.assertEqual(validation.get("errors"), [], validation)
        undefined = set(validation.get("undefined") or [])
        self.assertNotIn("billing_invoice.contact_id_label", undefined, validation)

    def test_document_template_preview_tolerates_missing_lookup_label_alias_in_sample_record(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/documents/templates",
                json={
                    "name": "Invoice",
                    "description": "",
                    "html": "<h1>Placeholder</h1>",
                    "filename_pattern": "placeholder",
                    "variables_schema": {"entity_id": "entity.billing_invoice"},
                },
            ).json()
            template_id = created["template"]["id"]

        fake_invoice_entity = {
            "id": "entity.billing_invoice",
            "label": "Billing Invoice",
            "fields": [
                {"id": "billing_invoice.invoice_number", "label": "Invoice Number", "type": "string"},
                {
                    "id": "billing_invoice.contact_id",
                    "label": "Contact",
                    "type": "lookup",
                    "entity": "entity.biz_contact",
                    "display_field": "biz_contact.name",
                },
            ],
        }
        fake_contact_entity = {
            "id": "entity.biz_contact",
            "label": "Contact",
            "fields": [
                {"id": "biz_contact.name", "label": "Name", "type": "string"},
            ],
        }

        def fake_find_entity_global(entity_id):
            if entity_id in {"entity.billing_invoice", "billing_invoice"}:
                return fake_invoice_entity
            if entity_id in {"entity.biz_contact", "biz_contact"}:
                return fake_contact_entity
            return None

        def fake_find_entity_def(_request, entity_id):
            if entity_id in {"entity.billing_invoice", "billing_invoice"}:
                return ("billing", fake_invoice_entity, "hash")
            return None

        captured: dict[str, str] = {}

        def fake_render_pdf(html, paper_size, margins, header_html, footer_html):
            captured["html"] = html
            return b"%PDF-1.4\ninvoice-preview\n%%EOF"

        with (
            patch.object(main, "_resolve_actor", lambda _request: _template_manager_actor()),
            patch.object(main, "_find_entity_def_global", fake_find_entity_global),
            patch.object(main, "_find_entity_def", fake_find_entity_def),
            patch.object(main, "using_supabase_storage", lambda: True),
            patch.object(main, "render_pdf", fake_render_pdf),
        ):
            preview_res = client.post(
                f"/docs/templates/{template_id}/preview",
                json={
                    "draft": {
                        "name": "Invoice Template",
                        "filename_pattern": "invoice_{{ record['billing_invoice.invoice_number'] }}",
                        "html": "<p>{{ record['billing_invoice.contact_id_label'] }}</p>",
                        "variables_schema": {"entity_id": "entity.billing_invoice"},
                    },
                    "sample": {
                        "entity_id": "entity.billing_invoice",
                        "record": {
                            "billing_invoice.invoice_number": "INV-10001",
                            "billing_invoice.contact_id": "contact-1",
                        },
                    },
                },
            )

        body = preview_res.json()
        self.assertEqual(preview_res.status_code, 200, body)
        self.assertIn("pdf_base64", body)
        self.assertEqual(captured.get("html"), "<p></p>")

    def test_document_template_preview_falls_back_to_draft_entity_when_sample_entity_missing(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/documents/templates",
                json={
                    "name": "Purchase Order",
                    "description": "",
                    "html": "<h1>{{ record['te_purchase_order.po_number'] }}</h1>",
                    "filename_pattern": "po-{{ record['te_purchase_order.po_number'] }}",
                    "variables_schema": {"entity_id": "entity.te_purchase_order"},
                },
            ).json()
            template_id = created["template"]["id"]

        fake_pdf = b"%PDF-1.4\npreview\n%%EOF"
        with (
            patch.object(main, "_resolve_actor", lambda _request: _template_manager_actor()),
            patch.object(main, "using_supabase_storage", lambda: True),
            patch.object(main, "render_pdf", lambda html, paper_size, margins, header_html, footer_html: fake_pdf),
        ):
            preview_res = client.post(
                f"/docs/templates/{template_id}/preview",
                json={
                    "draft": {
                        **created["template"],
                        "html": "<h1>{{ record['te_supplier_order.order_number'] }}</h1>",
                        "filename_pattern": "supplier-order-{{ record['te_supplier_order.order_number'] }}",
                        "variables_schema": {"entity_id": "entity.te_supplier_order"},
                    },
                    "sample": {
                        "record": {
                            "te_supplier_order.order_number": "SO-1001",
                        },
                    },
                },
            )

        body = preview_res.json()
        self.assertEqual(preview_res.status_code, 200, body)
        self.assertEqual(body.get("filename"), "supplier-order-SO-1001.pdf")

    def test_document_template_preview_attachment_download_allows_template_manager_without_records_read(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/documents/templates",
                json={
                    "name": "Purchase Order",
                    "description": "",
                    "html": "<h1>PO {{ record['biz_purchase_order.po_number'] }}</h1>",
                    "filename_pattern": "po-{{ record['biz_purchase_order.po_number'] }}",
                    "variables_schema": {"entity_id": "entity.biz_purchase_order"},
                },
            ).json()
            template_id = created["template"]["id"]
        fake_pdf = b"%PDF-1.4\npreview\n%%EOF"
        with (
            patch.object(main, "_resolve_actor", lambda _request: _template_manager_actor()),
            patch.object(main, "using_supabase_storage", lambda: False),
            patch.object(main, "store_bytes", lambda _org_id, _filename, data, mime_type="application/octet-stream": {
                "size": len(data or b""),
                "storage_key": "preview/test.pdf",
                "sha256": "preview-sha",
            }),
            patch.object(main, "read_bytes", lambda _org_id, _storage_key: fake_pdf),
        ):
            preview_res = client.post(
                f"/docs/templates/{template_id}/preview",
                json={
                    "sample": {
                        "entity_id": "entity.biz_purchase_order",
                        "record": {
                            "biz_purchase_order.po_number": "PO-1001",
                        },
                    },
                },
            )
            preview_body = preview_res.json()
            self.assertEqual(preview_res.status_code, 200, preview_body)
            attachment_id = preview_body.get("attachment_id")
            download_res = client.get(f"/attachments/{attachment_id}/download")
        self.assertEqual(download_res.status_code, 200, download_res.text)
        self.assertEqual(download_res.headers.get("content-type"), "application/pdf")
        self.assertEqual(download_res.content, fake_pdf)

    def test_document_template_preview_renders_ai_style_purchase_order_draft_with_line_items(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/documents/templates",
                json={
                    "name": "Purchase Order",
                    "description": "",
                    "html": "<h1>Placeholder</h1>",
                    "filename_pattern": "placeholder",
                    "variables_schema": {"entity_id": "entity.biz_purchase_order"},
                },
            ).json()
            template_id = created["template"]["id"]

        fake_pdf = b"%PDF-1.4\npo-preview\n%%EOF"
        with (
            patch.object(main, "_resolve_actor", lambda _request: _template_manager_actor()),
            patch.object(main, "using_supabase_storage", lambda: False),
            patch.object(main, "_branding_context_for_org", lambda _org_id: {
                "workspace": {"logo_url": "https://example.com/logo.png", "name": "Mekka"},
                "company": {"name": "Mekka"},
                "branding": {"logo_url": "https://example.com/logo.png"},
            }),
            patch.object(main, "render_pdf", lambda html, paper_size, margins, header_html, footer_html: fake_pdf),
            patch.object(main, "store_bytes", lambda _org_id, _filename, data, mime_type="application/octet-stream": {
                "size": len(data or b""),
                "storage_key": "preview/po-ai-style.pdf",
                "sha256": "preview-po-ai-style",
            }),
        ):
            preview_res = client.post(
                f"/docs/templates/{template_id}/preview",
                json={
                    "draft": {
                        "name": "Purchase Order Template",
                        "filename_pattern": "purchase_order_{{ record['biz_purchase_order.po_number'] }}",
                        "html": (
                            "<div>"
                            "<img src='{{ workspace.logo_url }}' alt='Company Logo' />"
                            "<h1>Purchase Order</h1>"
                            "<p>PO Number: {{ record['biz_purchase_order.po_number'] }}</p>"
                            "<p>Supplier: {{ record['biz_purchase_order.supplier_id_label'] }}</p>"
                            "<table>{% for line in lines %}"
                            "<tr>"
                            "<td>{{ line['biz_purchase_order_line.product_id'] }}</td>"
                            "<td>{{ line['biz_purchase_order_line.quantity'] }}</td>"
                            "<td>{{ line['biz_purchase_order_line.unit_cost'] }}</td>"
                            "<td>{{ line['biz_purchase_order_line.line_total'] }}</td>"
                            "</tr>"
                            "{% endfor %}</table>"
                            "<p>Total: {{ record['biz_purchase_order.po_total'] }}</p>"
                            "<p>{{ company.name }}</p>"
                            "</div>"
                        ),
                    },
                    "sample": {
                        "entity_id": "entity.biz_purchase_order",
                        "record": {
                            "biz_purchase_order.po_number": "PO-1001",
                            "biz_purchase_order.supplier_id_label": "Umma",
                            "biz_purchase_order.po_total": "$125.00",
                            "lines": [
                                {
                                    "biz_purchase_order_line.product_id": "Medicube Vita C Capsule Cream",
                                    "biz_purchase_order_line.quantity": 5,
                                    "biz_purchase_order_line.unit_cost": "$10.00",
                                    "biz_purchase_order_line.line_total": "$50.00",
                                },
                                {
                                    "biz_purchase_order_line.product_id": "Beauty of Joseon Dynasty Cream",
                                    "biz_purchase_order_line.quantity": 3,
                                    "biz_purchase_order_line.unit_cost": "$25.00",
                                    "biz_purchase_order_line.line_total": "$75.00",
                                },
                            ],
                        },
                    },
                },
            )
        preview_body = preview_res.json()
        self.assertEqual(preview_res.status_code, 200, preview_body)
        self.assertTrue(isinstance(preview_body.get("attachment_id"), str) and preview_body.get("attachment_id"))
        self.assertEqual(preview_body.get("filename"), "purchase_order_PO-1001.pdf")

    def test_document_template_preview_renders_quote_draft_with_generic_line_items(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/documents/templates",
                json={
                    "name": "Quote",
                    "description": "",
                    "html": "<h1>Placeholder</h1>",
                    "filename_pattern": "placeholder",
                    "variables_schema": {"entity_id": "entity.biz_quote"},
                },
            ).json()
            template_id = created["template"]["id"]

        fake_quote_entity = {
            "id": "entity.biz_quote",
            "label": "Quote",
            "fields": [
                {"id": "biz_quote.quote_number", "label": "Quote Number", "type": "string"},
                {"id": "biz_quote.quote_date", "label": "Quote Date", "type": "date"},
                {"id": "biz_quote.customer_reference", "label": "Customer Reference", "type": "string"},
                {"id": "biz_quote.subtotal", "label": "Subtotal", "type": "currency"},
                {"id": "biz_quote.tax_total", "label": "Tax", "type": "currency"},
                {"id": "biz_quote.grand_total", "label": "Grand Total", "type": "currency"},
                {"id": "biz_quote.payment_terms", "label": "Payment Terms", "type": "string"},
            ],
        }

        def fake_find_entity(_request, entity_id):
            if entity_id in {"entity.biz_quote", "biz_quote"}:
                return ("quotes", fake_quote_entity, "hash")
            return None

        fake_pdf = b"%PDF-1.4\nquote-preview\n%%EOF"
        with (
            patch.object(main, "_resolve_actor", lambda _request: _template_manager_actor()),
            patch.object(main, "using_supabase_storage", lambda: False),
            patch.object(main, "_find_entity_def", fake_find_entity),
            patch.object(main, "_branding_context_for_org", lambda _org_id: {
                "workspace": {"logo_url": "https://example.com/logo.png", "name": "Octodrop"},
                "company": {"name": "Octodrop"},
                "branding": {"logo_url": "https://example.com/logo.png"},
            }),
            patch.object(main, "render_pdf", lambda html, paper_size, margins, header_html, footer_html: fake_pdf),
            patch.object(main, "store_bytes", lambda _org_id, _filename, data, mime_type="application/octet-stream": {
                "size": len(data or b""),
                "storage_key": "preview/quote-ai-style.pdf",
                "sha256": "preview-quote-style",
            }),
        ):
            preview_res = client.post(
                f"/docs/templates/{template_id}/preview",
                json={
                    "draft": {
                        "name": "Customer Quote",
                        "filename_pattern": "quote_{{ record['biz_quote.quote_number'] }}",
                        "html": (
                            "<div>"
                            "<img src='{{ workspace.logo_url }}' alt='Company Logo' />"
                            "<h1>Quote</h1>"
                            "<p>Quote Number: {{ record['biz_quote.quote_number'] }}</p>"
                            "<p>Date: {{ record['biz_quote.quote_date'] }}</p>"
                            "<p>Reference: {{ record['biz_quote.customer_reference'] }}</p>"
                            "<table>{% for line in lines %}"
                            "<tr>"
                            "<td>{{ line['biz_quote_line.description'] }}</td>"
                            "<td>{{ line['biz_quote_line.quantity'] }}</td>"
                            "<td>{{ line['biz_quote_line.unit_price'] }}</td>"
                            "<td>{{ line['biz_quote_line.line_total'] }}</td>"
                            "</tr>"
                            "{% endfor %}</table>"
                            "<p>Subtotal: {{ record['biz_quote.subtotal'] }}</p>"
                            "<p>Tax: {{ record['biz_quote.tax_total'] }}</p>"
                            "<p>Total: {{ record['biz_quote.grand_total'] }}</p>"
                            "<p>Payment Terms: {{ record['biz_quote.payment_terms'] }}</p>"
                            "<p>{{ company.name }}</p>"
                            "</div>"
                        ),
                        "footer_html": "<div>Page <span class=\"pageNumber\"></span> of <span class=\"totalPages\"></span></div>",
                    },
                    "sample": {
                        "entity_id": "entity.biz_quote",
                        "record": {
                            "biz_quote.quote_number": "Q-1001",
                            "biz_quote.quote_date": "2026-04-20",
                            "biz_quote.customer_reference": "ACME-42",
                            "biz_quote.subtotal": "$100.00",
                            "biz_quote.tax_total": "$15.00",
                            "biz_quote.grand_total": "$115.00",
                            "biz_quote.payment_terms": "50% deposit, balance before dispatch",
                            "lines": [
                                {
                                    "biz_quote_line.description": "Solar inverter",
                                    "biz_quote_line.quantity": 1,
                                    "biz_quote_line.unit_price": "$100.00",
                                    "biz_quote_line.line_total": "$100.00",
                                }
                            ],
                        },
                    },
                },
            )
        preview_body = preview_res.json()
        self.assertEqual(preview_res.status_code, 200, preview_body)
        self.assertTrue(isinstance(preview_body.get("attachment_id"), str) and preview_body.get("attachment_id"))
        self.assertEqual(preview_body.get("filename"), "quote_Q-1001.pdf")

    def test_document_template_preview_returns_inline_pdf_when_external_storage_enabled(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/documents/templates",
                json={
                    "name": "Quote",
                    "description": "",
                    "html": "<h1>{{ record['biz_quote.quote_number'] }}</h1>",
                    "filename_pattern": "quote_{{ record['biz_quote.quote_number'] }}",
                    "variables_schema": {"entity_id": "entity.biz_quote"},
                },
            ).json()
            template_id = created["template"]["id"]

        fake_pdf = b"%PDF-1.4\ninline-preview\n%%EOF"
        with (
            patch.object(main, "_resolve_actor", lambda _request: _template_manager_actor()),
            patch.object(main, "using_supabase_storage", lambda: True),
            patch.object(main, "render_pdf", lambda html, paper_size, margins, header_html, footer_html: fake_pdf),
        ):
            preview_res = client.post(
                f"/docs/templates/{template_id}/preview",
                json={
                    "sample": {
                        "entity_id": "entity.biz_quote",
                        "record": {
                            "biz_quote.quote_number": "Q-2001",
                        },
                    },
                },
            )
        preview_body = preview_res.json()
        self.assertEqual(preview_res.status_code, 200, preview_body)
        self.assertEqual(preview_body.get("filename"), "quote_Q-2001.pdf")
        self.assertFalse(preview_body.get("attachment_id"))
        self.assertTrue(isinstance(preview_body.get("pdf_base64"), str) and preview_body.get("pdf_base64"))

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
        self.assertIn("context.selected_entity_summary.accessible_record_keys", email_prompt)
        self.assertIn("Never invent related-record dotted keys", email_prompt)
        self.assertIn("clean sans-serif font stack", email_prompt)
        self.assertIn("senior business brand and product designer", email_prompt)
        self.assertIn("thin black box borders", email_prompt)
        self.assertIn("compact summary card", email_prompt)
        self.assertIn("modern summary cards", email_prompt)
        self.assertIn("keep the structure, hierarchy, or variables stable", email_prompt)
        self.assertIn("preserve the existing section order and variable usage", email_prompt)
        self.assertIn("smallest corrected draft possible", email_prompt)
        self.assertIn("Preserve existing structure, section order, copy, CTA intent, variables, styling, and branding references", email_prompt)
        self.assertIn("Do not do extra redesign, copy cleanup, or non-validation improvements", email_prompt)
        self.assertIn("context.design_playbook", document_prompt)
        self.assertIn("soft guidance", document_prompt.lower())
        self.assertIn("component_priority", document_prompt)
        self.assertIn("context.design_signals", document_prompt)
        self.assertIn("context.requested_focus", document_prompt)
        self.assertIn("If context.requested_focus is validation", document_prompt)
        self.assertIn("context.selected_entity_summary.accessible_record_keys", document_prompt)
        self.assertIn("Never invent related-record dotted keys", document_prompt)
        self.assertIn("context.document_runtime_examples", document_prompt)
        self.assertIn("Do not use Jinja variables like {{ pageNumber }}", document_prompt)
        self.assertIn("preserve it unless the user clearly asks for a redesign", document_prompt)
        self.assertIn("Avoid Times-like starter output", document_prompt)
        self.assertIn("senior business brand and editorial designer", document_prompt)
        self.assertIn("thin black table grids", document_prompt)
        self.assertIn("clearly separated totals area", document_prompt)
        self.assertIn("muted dividers", document_prompt)
        self.assertIn("keep the structure, hierarchy, or variables stable", document_prompt)
        self.assertIn("preserve the existing section order, variable usage, and overall document flow", document_prompt)
        self.assertIn("smallest corrected draft possible", document_prompt)
        self.assertIn("Preserve existing structure, section order, copy, variables, styling, totals layout, and branding references", document_prompt)
        self.assertIn("Do not do extra redesign, copy cleanup, or non-validation improvements", document_prompt)

    def test_document_template_normalizer_rewrites_header_footer_runtime_jinja_tokens(self) -> None:
        normalized = main._artifact_ai_normalize_doc_template_draft(
            {"name": "Invoice", "html": "<p>Invoice</p>"},
            {
                "footer_html": "<div>{{ date }} • {{ pageNumber }} / {{ totalPages }}</div>",
                "header_html": "<div>{{ title }}</div>",
            },
        )
        self.assertEqual(
            normalized.get("footer_html"),
            '<div><span class="date"></span> • <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
        )
        self.assertEqual(normalized.get("header_html"), '<div><span class="title"></span></div>')

    def test_document_template_normalizer_rewrites_footer_tokens_without_touching_body_layout(self) -> None:
        rich_html = (
            "<div style=\"font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif;\">"
            "<section style=\"background:#fff7ed;border-radius:18px;padding:24px;\">"
            "<h1>Invoice</h1><p>{{ record['billing_invoice.invoice_number'] }}</p>"
            "</section></div>"
        )
        normalized = main._artifact_ai_normalize_doc_template_draft(
            {"name": "Invoice", "html": rich_html},
            {
                "html": rich_html,
                "footer_html": "<div style=\"font-size:11px;color:#64748b;\">Generated {{ date }} • {{ pageNumber }}/{{ totalPages }}</div>",
            },
        )
        self.assertEqual(normalized.get("html"), rich_html)
        self.assertEqual(
            normalized.get("footer_html"),
            '<div style="font-size:11px;color:#64748b;">Generated <span class="date"></span> • <span class="pageNumber"></span>/<span class="totalPages"></span></div>',
        )

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
        self.assertIn("\"shared_capability_catalog\"", context_text)
        self.assertIn("\"quick_actions\"", context_text)
        self.assertIn("\"focus_modes\": [\"validation\", \"logic\", \"content\"]", context_text)

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

    def test_automation_ai_plan_returns_email_template_decision_slot_for_missing_template(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/automations",
                json={
                    "name": "Quote follow-up",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["biz_contacts.record.biz_contact.created"], "filters": []},
                    "steps": [self._seed_automation_step()],
                },
            ).json()
            automation_id = created["automation"]["id"]

            def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
                return _fake_response(
                    {
                        "summary": "Email the customer when the trigger fires.",
                        "draft": {
                            "name": "Quote follow-up",
                            "description": "",
                            "trigger": {"kind": "event", "event_types": ["biz_contacts.record.biz_contact.created"], "filters": []},
                            "steps": [
                                {
                                    "kind": "action",
                                    "action_id": "system.send_email",
                                    "inputs": {
                                        "entity_id": "entity.biz_contact",
                                        "to_field_ids": ["biz_contact.email"],
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
                "entities": [
                    {
                        "id": "entity.biz_contact",
                        "label": "Contact",
                        "fields": [
                            {"id": "biz_contact.email", "label": "Email", "type": "email"},
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
                "system_actions": [{"id": "system.send_email", "label": "Send email"}],
                "module_actions": [],
                "members": [{"user_id": "user-current", "email": "nick@octodrop.com"}],
                "connections": [],
                "email_templates": [
                    {"id": "email_tpl_follow_up", "name": "Quote Follow Up", "subject": "Thanks"},
                    {"id": "email_tpl_quote_ready", "name": "Quote Ready", "subject": "Your quote"},
                ],
                "doc_templates": [],
            }

            with (
                patch.object(main, "_artifact_ai_automation_meta", lambda request, actor: fake_meta),
                patch.object(main, "_ai_workspace_template_decision_options", lambda kind, workspace_id, limit=8: [
                    {"id": "email_tpl_follow_up", "label": "Quote Follow Up", "value": "email_tpl_follow_up", "hints": {"email_template_id": "email_tpl_follow_up"}},
                    {"id": "email_tpl_quote_ready", "label": "Quote Ready", "value": "email_tpl_quote_ready", "hints": {"email_template_id": "email_tpl_quote_ready"}},
                ] if kind == "email_template" else []),
                patch.object(main, "_openai_chat_completion", fake_openai),
                patch.object(main, "_openai_configured", lambda: True),
            ):
                res = client.post(
                    f"/automations/{automation_id}/ai/plan",
                    json={
                        "prompt": "Use an email template to email the customer when this automation runs.",
                        "draft": created["automation"],
                    },
                )
            body = res.json()
            self.assertEqual(res.status_code, 200, body)
            self.assertTrue(body.get("ok"), body)
            meta = body.get("required_question_meta") or {}
            self.assertEqual(meta.get("kind"), "decision_slot")
            self.assertEqual(meta.get("slot_kind"), "email_template_choice")
            values = [item.get("value") for item in (meta.get("options") or []) if isinstance(item, dict)]
            self.assertEqual(values, ["email_tpl_follow_up", "email_tpl_quote_ready"])

    def test_automation_ai_plan_applies_selected_email_template_hint(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/automations",
                json={
                    "name": "Quote follow-up",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["biz_contacts.record.biz_contact.created"], "filters": []},
                    "steps": [self._seed_automation_step()],
                },
            ).json()
            automation_id = created["automation"]["id"]

            def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
                return _fake_response(
                    {
                        "summary": "Email the customer when the trigger fires.",
                        "draft": {
                            "name": "Quote follow-up",
                            "description": "",
                            "trigger": {"kind": "event", "event_types": ["biz_contacts.record.biz_contact.created"], "filters": []},
                            "steps": [
                                {
                                    "kind": "action",
                                    "action_id": "system.send_email",
                                    "inputs": {
                                        "entity_id": "entity.biz_contact",
                                        "to_field_ids": ["biz_contact.email"],
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
                "entities": [
                    {
                        "id": "entity.biz_contact",
                        "label": "Contact",
                        "fields": [
                            {"id": "biz_contact.email", "label": "Email", "type": "email"},
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
                "system_actions": [{"id": "system.send_email", "label": "Send email"}],
                "module_actions": [],
                "members": [{"user_id": "user-current", "email": "nick@octodrop.com"}],
                "connections": [],
                "email_templates": [{"id": "email_tpl_follow_up"}],
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
                        "prompt": "Use an email template to email the customer when this automation runs.",
                        "draft": created["automation"],
                        "hints": {"email_template_id": "email_tpl_follow_up"},
                    },
                )
            body = res.json()
            self.assertEqual(res.status_code, 200, body)
            self.assertTrue(body.get("ok"), body)
            step = (body.get("draft", {}).get("steps") or [{}])[0]
            self.assertEqual(step.get("inputs", {}).get("template_id"), "email_tpl_follow_up")
            self.assertEqual(body.get("required_questions") or [], [])
            self.assertIsNone(body.get("required_question_meta"))
            validation = body.get("validation") or {}
            self.assertTrue(validation.get("compiled_ok"), validation)

    def test_automation_ai_plan_auto_selects_named_email_template_from_prompt(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/automations",
                json={
                    "name": "Quote follow-up",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["biz_contacts.record.biz_contact.created"], "filters": []},
                    "steps": [self._seed_automation_step()],
                },
            ).json()
            automation_id = created["automation"]["id"]

            def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
                return _fake_response(
                    {
                        "summary": "Email the customer when the trigger fires.",
                        "draft": {
                            "name": "Quote follow-up",
                            "description": "",
                            "trigger": {"kind": "event", "event_types": ["biz_contacts.record.biz_contact.created"], "filters": []},
                            "steps": [
                                {
                                    "kind": "action",
                                    "action_id": "system.send_email",
                                    "inputs": {
                                        "entity_id": "entity.biz_contact",
                                        "to_field_ids": ["biz_contact.email"],
                                        "subject": "Thanks for your enquiry",
                                        "body_text": "We will send your quote soon.",
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
                "entities": [
                    {
                        "id": "entity.biz_contact",
                        "label": "Contact",
                        "fields": [
                            {"id": "biz_contact.email", "label": "Email", "type": "email"},
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
                "system_actions": [{"id": "system.send_email", "label": "Send email"}],
                "module_actions": [],
                "members": [{"user_id": "user-current", "email": "nick@octodrop.com"}],
                "connections": [],
                "email_templates": [
                    {"id": "email_tpl_quote_follow_up", "name": "Quote Follow Up", "subject": "Thanks"},
                    {"id": "email_tpl_quote_ready", "name": "Quote Ready", "subject": "Your quote"},
                ],
                "doc_templates": [],
            }

            with (
                patch.object(main, "_artifact_ai_automation_meta", lambda request, actor: fake_meta),
                patch.object(main, "_ai_workspace_template_decision_options", lambda kind, workspace_id, limit=8: [
                    {"id": "email_tpl_quote_follow_up", "label": "Quote Follow Up", "value": "email_tpl_quote_follow_up", "hints": {"email_template_id": "email_tpl_quote_follow_up"}},
                    {"id": "email_tpl_quote_ready", "label": "Quote Ready", "value": "email_tpl_quote_ready", "hints": {"email_template_id": "email_tpl_quote_ready"}},
                ] if kind == "email_template" else []),
                patch.object(main, "_openai_chat_completion", fake_openai),
                patch.object(main, "_openai_configured", lambda: True),
            ):
                res = client.post(
                    f"/automations/{automation_id}/ai/plan",
                    json={
                        "prompt": "Use the Quote Follow Up email template to email the customer when this automation runs.",
                        "draft": created["automation"],
                    },
                )
            body = res.json()
            self.assertEqual(res.status_code, 200, body)
            self.assertTrue(body.get("ok"), body)
            step = (body.get("draft", {}).get("steps") or [{}])[0]
            inputs = step.get("inputs", {})
            self.assertEqual(inputs.get("template_id"), "email_tpl_quote_follow_up")
            self.assertNotIn("subject", inputs)
            self.assertNotIn("body_text", inputs)
            self.assertEqual(body.get("required_questions") or [], [])
            self.assertIsNone(body.get("required_question_meta"))
            validation = body.get("validation") or {}
            self.assertTrue(validation.get("compiled_ok"), validation)

    def test_automation_ai_plan_returns_document_template_decision_slot_for_missing_template(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/automations",
                json={
                    "name": "Completion pack",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["biz_jobs.record.biz_job.created"], "filters": []},
                    "steps": [self._seed_automation_step()],
                },
            ).json()
            automation_id = created["automation"]["id"]

            def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
                return _fake_response(
                    {
                        "summary": "Generate a completion pack when the job is created.",
                        "draft": {
                            "name": "Completion pack",
                            "description": "",
                            "trigger": {"kind": "event", "event_types": ["biz_jobs.record.biz_job.created"], "filters": []},
                            "steps": [
                                {
                                    "kind": "action",
                                    "action_id": "system.generate_document",
                                    "inputs": {"record_id": "{{trigger.record_id}}"},
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
                        "id": "biz_jobs.record.biz_job.created",
                        "label": "Job created",
                        "event": "record.created",
                        "entity_id": "entity.biz_job",
                    }
                ],
                "event_types": ["biz_jobs.record.biz_job.created"],
                "system_actions": [{"id": "system.generate_document", "label": "Generate document"}],
                "module_actions": [],
                "members": [{"user_id": "user-current", "email": "nick@octodrop.com"}],
                "connections": [],
                "email_templates": [],
                "doc_templates": [
                    {"id": "doc_tpl_completion_pack"},
                    {"id": "doc_tpl_job_summary"},
                ],
            }

            with (
                patch.object(main, "_artifact_ai_automation_meta", lambda request, actor: fake_meta),
                patch.object(main, "_ai_workspace_template_decision_options", lambda kind, workspace_id, limit=8: [
                    {"id": "doc_tpl_completion_pack", "label": "Completion Pack", "value": "doc_tpl_completion_pack", "hints": {"document_template_id": "doc_tpl_completion_pack"}},
                    {"id": "doc_tpl_job_summary", "label": "Job Summary", "value": "doc_tpl_job_summary", "hints": {"document_template_id": "doc_tpl_job_summary"}},
                ] if kind == "document_template" else []),
                patch.object(main, "_openai_chat_completion", fake_openai),
                patch.object(main, "_openai_configured", lambda: True),
            ):
                res = client.post(
                    f"/automations/{automation_id}/ai/plan",
                    json={
                        "prompt": "Use a document template to generate a completion pack.",
                        "draft": created["automation"],
                    },
                )
            body = res.json()
            self.assertEqual(res.status_code, 200, body)
            self.assertTrue(body.get("ok"), body)
            meta = body.get("required_question_meta") or {}
            self.assertEqual(meta.get("kind"), "decision_slot")
            self.assertEqual(meta.get("slot_kind"), "document_template_choice")
            values = [item.get("value") for item in (meta.get("options") or []) if isinstance(item, dict)]
            self.assertEqual(values, ["doc_tpl_completion_pack", "doc_tpl_job_summary"])

    def test_automation_ai_plan_auto_selects_named_document_template_from_prompt(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/automations",
                json={
                    "name": "Completion pack",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["biz_jobs.record.biz_job.created"], "filters": []},
                    "steps": [self._seed_automation_step()],
                },
            ).json()
            automation_id = created["automation"]["id"]

            def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
                return _fake_response(
                    {
                        "summary": "Generate a completion pack when the job is created.",
                        "draft": {
                            "name": "Completion pack",
                            "description": "",
                            "trigger": {"kind": "event", "event_types": ["biz_jobs.record.biz_job.created"], "filters": []},
                            "steps": [
                                {
                                    "kind": "action",
                                    "action_id": "system.generate_document",
                                    "inputs": {"record_id": "{{trigger.record_id}}"},
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
                        "id": "biz_jobs.record.biz_job.created",
                        "label": "Job created",
                        "event": "record.created",
                        "entity_id": "entity.biz_job",
                    }
                ],
                "event_types": ["biz_jobs.record.biz_job.created"],
                "system_actions": [{"id": "system.generate_document", "label": "Generate document"}],
                "module_actions": [],
                "members": [{"user_id": "user-current", "email": "nick@octodrop.com"}],
                "connections": [],
                "email_templates": [],
                "doc_templates": [
                    {"id": "doc_tpl_completion_pack", "name": "Completion Pack"},
                    {"id": "doc_tpl_job_summary", "name": "Job Summary"},
                ],
            }

            with (
                patch.object(main, "_artifact_ai_automation_meta", lambda request, actor: fake_meta),
                patch.object(main, "_ai_workspace_template_decision_options", lambda kind, workspace_id, limit=8: [
                    {"id": "doc_tpl_completion_pack", "label": "Completion Pack", "value": "doc_tpl_completion_pack", "hints": {"document_template_id": "doc_tpl_completion_pack"}},
                    {"id": "doc_tpl_job_summary", "label": "Job Summary", "value": "doc_tpl_job_summary", "hints": {"document_template_id": "doc_tpl_job_summary"}},
                ] if kind == "document_template" else []),
                patch.object(main, "_openai_chat_completion", fake_openai),
                patch.object(main, "_openai_configured", lambda: True),
            ):
                res = client.post(
                    f"/automations/{automation_id}/ai/plan",
                    json={
                        "prompt": "Use the Completion Pack document template when this automation runs.",
                        "draft": created["automation"],
                    },
                )
            body = res.json()
            self.assertEqual(res.status_code, 200, body)
            self.assertTrue(body.get("ok"), body)
            step = (body.get("draft", {}).get("steps") or [{}])[0]
            inputs = step.get("inputs", {})
            self.assertEqual(inputs.get("template_id"), "doc_tpl_completion_pack")
            self.assertEqual(body.get("required_questions") or [], [])
            self.assertIsNone(body.get("required_question_meta"))
            validation = body.get("validation") or {}
            self.assertTrue(validation.get("compiled_ok"), validation)

    def test_automation_ai_plan_returns_notify_recipient_decision_slot_when_missing(self) -> None:
        client = TestClient(main.app)
        actor = _superadmin_actor()
        actor["user_id"] = "user-current"
        with patch.object(main, "_resolve_actor", lambda _request: actor):
            created = client.post(
                "/automations",
                json={
                    "name": "Notify on contact",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["biz_contacts.record.biz_contact.created"], "filters": []},
                    "steps": [self._seed_automation_step()],
                },
            ).json()
            automation_id = created["automation"]["id"]

            def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
                return _fake_response(
                    {
                        "summary": "Notify the team when the trigger fires.",
                        "draft": {
                            "name": "Notify on contact",
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
                patch.object(main, "_ai_workspace_member_decision_options", lambda workspace_id, limit=8: [
                    {"id": "member:user-current", "label": "Nick", "value": "nick@octodrop.com", "hints": {"recipient_email": "nick@octodrop.com"}},
                ]),
                patch.object(main, "_openai_chat_completion", fake_openai),
                patch.object(main, "_openai_configured", lambda: True),
            ):
                res = client.post(
                    f"/automations/{automation_id}/ai/plan",
                    json={
                        "prompt": "Send a notification when a contact is created.",
                        "draft": created["automation"],
                    },
                )
            body = res.json()
            self.assertEqual(res.status_code, 200, body)
            self.assertTrue(body.get("ok"), body)
            meta = body.get("required_question_meta") or {}
            self.assertEqual(meta.get("kind"), "decision_slot")
            self.assertEqual(meta.get("slot_kind"), "notify_recipient")
            self.assertEqual(meta.get("hint_field"), "recipient_email")
            values = [item.get("value") for item in (meta.get("options") or []) if isinstance(item, dict)]
            self.assertEqual(values, ["nick@octodrop.com"])

    def test_automation_validation_flags_invalid_field_refs_and_template_ids(self) -> None:
        fake_meta = {
            "event_types": ["biz_contacts.record.biz_contact.created"],
            "event_catalog": [
                {
                    "id": "biz_contacts.record.biz_contact.created",
                    "label": "Contact created",
                    "event": "record.created",
                    "entity_id": "entity.biz_contact",
                }
            ],
            "system_actions": [
                {"id": "system.send_email", "label": "Send email"},
                {"id": "system.generate_document", "label": "Generate document"},
                {"id": "system.update_record", "label": "Update record"},
            ],
            "module_actions": [],
            "entities": [
                {
                    "id": "entity.biz_contact",
                    "label": "Contact",
                    "fields": [
                        {"id": "biz_contact.name", "label": "Name", "type": "string"},
                        {"id": "biz_contact.email", "label": "Email", "type": "email"},
                    ],
                }
            ],
            "field_path_catalog": [
                {
                    "entity_id": "entity.biz_contact",
                    "fields": [
                        {
                            "field_id": "biz_contact.name",
                            "label": "Name",
                            "type": "string",
                            "paths": [
                                "trigger.record.fields.biz_contact.name",
                                "trigger.before.fields.biz_contact.name",
                                "trigger.after.fields.biz_contact.name",
                            ],
                        },
                        {
                            "field_id": "biz_contact.email",
                            "label": "Email",
                            "type": "email",
                            "paths": [
                                "trigger.record.fields.biz_contact.email",
                                "trigger.before.fields.biz_contact.email",
                                "trigger.after.fields.biz_contact.email",
                            ],
                        },
                    ],
                }
            ],
            "email_templates": [{"id": "email_tpl_valid"}],
            "doc_templates": [{"id": "doc_tpl_valid"}],
        }

        validation = main._artifact_ai_validate_automation_draft(
            {
                "name": "Broken automation",
                "trigger": {
                    "kind": "event",
                    "event_types": ["biz_contacts.record.biz_contact.created"],
                    "filters": [],
                    "expr": {
                        "op": "eq",
                        "left": {"var": "trigger.record.fields.biz_contact.full_name"},
                        "right": {"literal": "nick"},
                    },
                },
                "steps": [
                    {
                        "kind": "action",
                        "action_id": "system.send_email",
                        "inputs": {
                            "to_field_ids": ["biz_contact.full_name"],
                            "template_id": "email_tpl_missing",
                            "subject": "Hi",
                        },
                    },
                    {
                        "kind": "action",
                        "action_id": "system.generate_document",
                        "inputs": {"template_id": "doc_tpl_missing", "record_id": "{{trigger.record_id}}"},
                    },
                    {
                        "kind": "action",
                        "action_id": "system.update_record",
                        "inputs": {
                            "entity_id": "entity.biz_contact",
                            "record_id": "{{trigger.record_id}}",
                            "patch": {"biz_contact.full_name": "Nick"},
                        },
                    },
                ],
            },
            fake_meta,
        )

        self.assertFalse(validation.get("compiled_ok"), validation)
        messages = [item.get("message") for item in (validation.get("errors") or []) if isinstance(item, dict)]
        self.assertTrue(any("Unknown automation field reference" in str(message) for message in messages), messages)
        self.assertTrue(any("Unknown email field id 'biz_contact.full_name'" in str(message) for message in messages), messages)
        self.assertTrue(any("Unknown email template id 'email_tpl_missing'" in str(message) for message in messages), messages)
        self.assertTrue(any("Unknown document template id 'doc_tpl_missing'" in str(message) for message in messages), messages)
        self.assertTrue(any("Unknown field id 'biz_contact.full_name'" in str(message) for message in messages), messages)

    def test_automation_validation_accepts_cross_module_quote_to_job_handoff_payload(self) -> None:
        fake_meta = {
            "event_types": ["sales.workflow.quote.status_changed"],
            "event_catalog": [
                {
                    "id": "sales.workflow.quote.status_changed",
                    "label": "Quote status changed",
                    "event": "workflow.status_changed",
                    "entity_id": "entity.quote",
                }
            ],
            "system_actions": [
                {"id": "system.create_record", "label": "Create record"},
                {"id": "system.send_email", "label": "Send email"},
            ],
            "module_actions": [],
            "entities": [
                {
                    "id": "entity.quote",
                    "label": "Quote",
                    "fields": [
                        {"id": "quote.status", "label": "Status", "type": "enum"},
                        {"id": "quote.contact_id", "label": "Customer", "type": "lookup"},
                        {"id": "quote.owner_email", "label": "Owner Email", "type": "email"},
                    ],
                },
                {
                    "id": "entity.job",
                    "label": "Job",
                    "fields": [
                        {"id": "job.source_quote_id", "label": "Source Quote", "type": "string"},
                        {"id": "job.contact_id", "label": "Customer", "type": "lookup"},
                        {"id": "job.status", "label": "Status", "type": "string"},
                    ],
                },
            ],
            "field_path_catalog": [
                {
                    "entity_id": "entity.quote",
                    "fields": [
                        {
                            "field_id": "quote.status",
                            "label": "Status",
                            "type": "enum",
                            "paths": [
                                "trigger.record.fields.quote.status",
                                "trigger.before.fields.quote.status",
                                "trigger.after.fields.quote.status",
                            ],
                        },
                        {
                            "field_id": "quote.contact_id",
                            "label": "Customer",
                            "type": "lookup",
                            "paths": [
                                "trigger.record.fields.quote.contact_id",
                                "trigger.before.fields.quote.contact_id",
                                "trigger.after.fields.quote.contact_id",
                            ],
                        },
                    ],
                }
            ],
            "email_templates": [{"id": "email_tpl_quote_job_ready"}],
            "doc_templates": [],
        }

        validation = main._artifact_ai_validate_automation_draft(
            {
                "name": "Quote Approved Job Handoff",
                "description": "Create a job and notify the customer when a quote is approved.",
                "trigger": {
                    "kind": "event",
                    "event_types": ["sales.workflow.quote.status_changed"],
                    "filters": [
                        {"path": "entity_id", "op": "eq", "value": "entity.quote"},
                        {"path": "to", "op": "eq", "value": "approved"},
                    ],
                    "expr": {
                        "op": "eq",
                        "left": {"var": "trigger.after.fields.quote.status"},
                        "right": {"literal": "approved"},
                    },
                },
                "steps": [
                    {
                        "kind": "action",
                        "action_id": "system.create_record",
                        "inputs": {
                            "entity_id": "entity.job",
                            "values": {
                                "job.source_quote_id": "{{trigger.record_id}}",
                                "job.contact_id": "{{trigger.record.fields.quote.contact_id}}",
                                "job.status": "new",
                            },
                        },
                    },
                    {
                        "kind": "action",
                        "action_id": "system.send_email",
                        "inputs": {
                            "entity_id": "entity.quote",
                            "template_id": "email_tpl_quote_job_ready",
                            "to_lookup_field_ids": ["quote.contact_id"],
                            "subject": "Your quote is approved",
                        },
                    },
                ],
                "status": "draft",
            },
            fake_meta,
        )

        self.assertTrue(validation.get("compiled_ok"), validation)
        self.assertEqual(validation.get("errors"), [], validation)

    def test_automation_validation_flags_invalid_inline_email_record_keys(self) -> None:
        fake_meta = {
            "event_types": ["biz_quotes.action.quote_mark_accepted.clicked"],
            "event_catalog": [
                {
                    "id": "biz_quotes.action.quote_mark_accepted.clicked",
                    "label": "Quote accepted",
                    "event": "action.clicked",
                    "entity_id": "entity.biz_quote",
                }
            ],
            "system_actions": [
                {"id": "system.send_email", "label": "Send email"},
            ],
            "module_actions": [],
            "entities": [
                {
                    "id": "entity.biz_quote",
                    "label": "Quote",
                    "display_field": "biz_quote.quote_number",
                    "fields": [
                        {"id": "biz_quote.quote_number", "label": "Quote Number", "type": "string"},
                        {"id": "biz_quote.customer_name", "label": "Customer Name", "type": "string"},
                        {"id": "biz_quote.customer_email", "label": "Customer Email", "type": "email"},
                    ],
                }
            ],
            "field_path_catalog": [],
            "email_templates": [],
            "doc_templates": [],
        }

        validation = main._artifact_ai_validate_automation_draft(
            {
                "name": "Quote Accepted Email",
                "trigger": {
                    "kind": "event",
                    "event_types": ["biz_quotes.action.quote_mark_accepted.clicked"],
                    "filters": [{"path": "entity_id", "op": "eq", "value": "entity.biz_quote"}],
                },
                "steps": [
                    {
                        "kind": "action",
                        "action_id": "system.send_email",
                        "inputs": {
                            "entity_id": "entity.biz_quote",
                            "to_field_ids": ["biz_quote.customer_email"],
                            "subject": "Quote {{ record['biz_quote.quote_number'] }} accepted",
                            "body_text": "Dear {{ record['biz_quote.customer_contact_name'] }}, your quote {{ record['biz_quote.quote_number'] }} was accepted.",
                        },
                    }
                ],
            },
            fake_meta,
        )

        self.assertFalse(validation.get("compiled_ok"), validation)
        messages = [item.get("message") for item in (validation.get("errors") or []) if isinstance(item, dict)]
        self.assertTrue(any("invalid record key 'biz_quote.customer_contact_name'" in str(message) for message in messages), messages)
        self.assertTrue(any("Try record['biz_quote.customer_name'] instead." in str(message) for message in messages), messages)

    def test_automation_validation_flags_cross_module_handoff_reference_errors(self) -> None:
        fake_meta = {
            "event_types": ["sales.workflow.quote.status_changed"],
            "event_catalog": [
                {
                    "id": "sales.workflow.quote.status_changed",
                    "label": "Quote status changed",
                    "event": "workflow.status_changed",
                    "entity_id": "entity.quote",
                }
            ],
            "system_actions": [
                {"id": "system.create_record", "label": "Create record"},
                {"id": "system.send_email", "label": "Send email"},
            ],
            "module_actions": [],
            "entities": [
                {
                    "id": "entity.quote",
                    "label": "Quote",
                    "fields": [
                        {"id": "quote.status", "label": "Status", "type": "enum"},
                        {"id": "quote.contact_id", "label": "Customer", "type": "lookup"},
                    ],
                },
                {
                    "id": "entity.job",
                    "label": "Job",
                    "fields": [
                        {"id": "job.source_quote_id", "label": "Source Quote", "type": "string"},
                        {"id": "job.contact_id", "label": "Customer", "type": "lookup"},
                        {"id": "job.status", "label": "Status", "type": "string"},
                    ],
                },
            ],
            "field_path_catalog": [
                {
                    "entity_id": "entity.quote",
                    "fields": [
                        {
                            "field_id": "quote.status",
                            "label": "Status",
                            "type": "enum",
                            "paths": [
                                "trigger.record.fields.quote.status",
                                "trigger.before.fields.quote.status",
                                "trigger.after.fields.quote.status",
                            ],
                        }
                    ],
                }
            ],
            "email_templates": [{"id": "email_tpl_quote_job_ready"}],
            "doc_templates": [],
        }

        validation = main._artifact_ai_validate_automation_draft(
            {
                "name": "Broken Quote Handoff",
                "trigger": {
                    "kind": "event",
                    "event_types": ["sales.workflow.quote.changed"],
                    "filters": [{"path": "entity_id", "op": "eq", "value": "entity.quote"}],
                    "expr": {
                        "op": "eq",
                        "left": {"var": "trigger.after.fields.quote.approval_status"},
                        "right": {"literal": "approved"},
                    },
                },
                "steps": [
                    {
                        "kind": "action",
                        "action_id": "system.create_record",
                        "inputs": {
                            "entity_id": "entity.job",
                            "values": {
                                "job.source_quote_id": "{{trigger.record_id}}",
                                "job.quote_total": "{{trigger.record.fields.quote.total}}",
                            },
                        },
                    },
                    {
                        "kind": "action",
                        "action_id": "system.send_email",
                        "inputs": {
                            "entity_id": "entity.quote",
                            "template_id": "email_tpl_missing",
                            "to_lookup_field_ids": ["quote.customer_id"],
                            "subject": "Your quote is approved",
                        },
                    },
                ],
            },
            fake_meta,
        )

        self.assertFalse(validation.get("compiled_ok"), validation)
        messages = [item.get("message") for item in (validation.get("errors") or []) if isinstance(item, dict)]
        self.assertTrue(any("Unknown event type 'sales.workflow.quote.changed'" in str(message) for message in messages), messages)
        self.assertTrue(any("Unknown automation field reference 'trigger.after.fields.quote.approval_status'" in str(message) for message in messages), messages)
        self.assertTrue(any("Unknown field id 'job.quote_total'" in str(message) for message in messages), messages)
        self.assertTrue(any("Unknown lookup field id 'quote.customer_id'" in str(message) for message in messages), messages)
        self.assertTrue(any("Unknown email template id 'email_tpl_missing'" in str(message) for message in messages), messages)

    def test_automation_ai_plan_prefers_direct_customer_email_field_over_lookup(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/automations",
                json={
                    "name": "Quote Accepted Email",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["biz_quotes.action.quote_mark_accepted.clicked"], "filters": []},
                    "steps": [self._seed_automation_step()],
                },
            ).json()
            automation_id = created["automation"]["id"]

            fake_meta = {
                "event_catalog": [
                    {
                        "id": "biz_quotes.action.quote_mark_accepted.clicked",
                        "label": "Quote accepted",
                        "event": "action.clicked",
                        "entity_id": "entity.biz_quote",
                    }
                ],
                "event_types": ["biz_quotes.action.quote_mark_accepted.clicked"],
                "system_actions": [{"id": "system.send_email", "label": "Send email"}],
                "module_actions": [],
                "entities": [
                    {
                        "id": "entity.biz_quote",
                        "label": "Quote",
                        "fields": [
                            {"id": "biz_quote.customer_id", "label": "Customer", "type": "lookup", "entity": "entity.biz_contact"},
                            {"id": "biz_quote.customer_email", "label": "Customer Email", "type": "email"},
                            {"id": "biz_quote.quote_number", "label": "Quote Number", "type": "string"},
                        ],
                    }
                ],
                "members": [],
                "connections": [],
                "email_templates": [],
                "doc_templates": [],
            }

            def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
                return _fake_response(
                    {
                        "summary": "Email the customer when a quote is accepted.",
                        "draft": {
                            "name": "Quote Accepted Email",
                            "description": "",
                            "trigger": {"kind": "event", "event_types": ["biz_quotes.action.quote_mark_accepted.clicked"], "filters": []},
                            "steps": [
                                {
                                    "kind": "action",
                                    "action_id": "system.send_email",
                                    "inputs": {
                                        "entity_id": "entity.biz_quote",
                                        "to_lookup_field_ids": ["biz_quote.customer_id"],
                                        "subject": "Quote accepted",
                                        "body_text": "Your quote was accepted.",
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
                        "prompt": "When the quote is accepted send an email to the customer email.",
                        "draft": created["automation"],
                    },
                )

            body = res.json()
            self.assertEqual(res.status_code, 200, body)
            self.assertTrue(body.get("ok"), body)
            step_inputs = (((body.get("draft", {}).get("steps") or [None])[0]) or {}).get("inputs") or {}
            self.assertEqual(step_inputs.get("to_field_ids"), ["biz_quote.customer_email"])
            self.assertNotIn("to_lookup_field_ids", step_inputs)

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

    def test_automation_ai_plan_resolves_module_action_label_to_exposed_action_id(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/automations",
                json={
                    "name": "Quote to Job Handoff",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["sales.workflow.quote.status_changed"], "filters": []},
                    "steps": [self._seed_automation_step()],
                },
            ).json()
            automation_id = created["automation"]["id"]

            def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
                return _fake_response(
                    {
                        "summary": "Run the exposed quote acceptance action when the quote is approved.",
                        "draft": {
                            "name": "Quote to Job Handoff",
                            "description": "",
                            "trigger": {"kind": "event", "event_types": ["sales.workflow.quote.status_changed"], "filters": []},
                            "steps": [
                                {
                                    "kind": "action",
                                    "action_id": "Mark Ready for Job",
                                    "inputs": {
                                        "record_id": "{{trigger.record_id}}",
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
                "entities": [
                    {
                        "id": "entity.quote",
                        "label": "Quote",
                        "fields": [
                            {"id": "quote.status", "label": "Status", "type": "enum"},
                        ],
                    }
                ],
                "event_catalog": [
                    {
                        "id": "sales.workflow.quote.status_changed",
                        "label": "Quote status changed",
                        "event": "workflow.status_changed",
                        "entity_id": "entity.quote",
                    }
                ],
                "event_types": ["sales.workflow.quote.status_changed"],
                "system_actions": [],
                "module_actions": [
                    {
                        "module_id": "sales",
                        "module_name": "Sales",
                        "actions": [
                            {
                                "id": "quote_mark_ready_for_job",
                                "label": "Mark Ready for Job",
                                "kind": "update_record",
                                "entity_id": "entity.quote",
                                "display_id": "sales.quote_mark_ready_for_job",
                            }
                        ],
                    }
                ],
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
                        "prompt": "When a quote is approved, run the Mark Ready for Job action.",
                        "draft": created["automation"],
                    },
                )

            body = res.json()
            self.assertEqual(res.status_code, 200, body)
            self.assertTrue(body.get("ok"), body)
            steps = body.get("draft", {}).get("steps") or []
            self.assertEqual(steps[0].get("action_id"), "quote_mark_ready_for_job")
            validation = body.get("validation") or {}
            self.assertTrue(validation.get("compiled_ok"), validation)

    def test_automation_ai_plan_resolves_module_action_display_id_to_exposed_action_id(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/automations",
                json={
                    "name": "Quote to Job Handoff",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["sales.workflow.quote.status_changed"], "filters": []},
                    "steps": [self._seed_automation_step()],
                },
            ).json()
            automation_id = created["automation"]["id"]

            def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
                return _fake_response(
                    {
                        "summary": "Run the exposed quote acceptance action when the quote is approved.",
                        "draft": {
                            "name": "Quote to Job Handoff",
                            "description": "",
                            "trigger": {"kind": "event", "event_types": ["sales.workflow.quote.status_changed"], "filters": []},
                            "steps": [
                                {
                                    "kind": "action",
                                    "action_id": "sales.quote_mark_ready_for_job",
                                    "inputs": {
                                        "record_id": "{{trigger.record_id}}",
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
                "entities": [
                    {
                        "id": "entity.quote",
                        "label": "Quote",
                        "fields": [
                            {"id": "quote.status", "label": "Status", "type": "enum"},
                        ],
                    }
                ],
                "event_catalog": [
                    {
                        "id": "sales.workflow.quote.status_changed",
                        "label": "Quote status changed",
                        "event": "workflow.status_changed",
                        "entity_id": "entity.quote",
                    }
                ],
                "event_types": ["sales.workflow.quote.status_changed"],
                "system_actions": [],
                "module_actions": [
                    {
                        "module_id": "sales",
                        "module_name": "Sales",
                        "actions": [
                            {
                                "id": "quote_mark_ready_for_job",
                                "label": "Mark Ready for Job",
                                "kind": "update_record",
                                "entity_id": "entity.quote",
                                "display_id": "sales.quote_mark_ready_for_job",
                            }
                        ],
                    }
                ],
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
                        "prompt": "When a quote is approved, run the sales.quote_mark_ready_for_job action.",
                        "draft": created["automation"],
                    },
                )

            body = res.json()
            self.assertEqual(res.status_code, 200, body)
            self.assertTrue(body.get("ok"), body)
            steps = body.get("draft", {}).get("steps") or []
            self.assertEqual(steps[0].get("action_id"), "quote_mark_ready_for_job")
            validation = body.get("validation") or {}
            self.assertTrue(validation.get("compiled_ok"), validation)

    def test_automation_ai_plan_resolves_module_prefixed_action_label_to_exposed_action_id(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/automations",
                json={
                    "name": "Quote to Job Handoff",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["sales.workflow.quote.status_changed"], "filters": []},
                    "steps": [self._seed_automation_step()],
                },
            ).json()
            automation_id = created["automation"]["id"]

            def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
                return _fake_response(
                    {
                        "summary": "Run the Sales: Mark Ready for Job action when the quote is approved.",
                        "draft": {
                            "name": "Quote to Job Handoff",
                            "description": "",
                            "trigger": {"kind": "event", "event_types": ["sales.workflow.quote.status_changed"], "filters": []},
                            "steps": [
                                {
                                    "kind": "action",
                                    "action_id": "Sales: Mark Ready for Job",
                                    "inputs": {
                                        "record_id": "{{trigger.record_id}}",
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
                "entities": [
                    {
                        "id": "entity.quote",
                        "label": "Quote",
                        "fields": [
                            {"id": "quote.status", "label": "Status", "type": "enum"},
                        ],
                    }
                ],
                "event_catalog": [
                    {
                        "id": "sales.workflow.quote.status_changed",
                        "label": "Quote status changed",
                        "event": "workflow.status_changed",
                        "entity_id": "entity.quote",
                    }
                ],
                "event_types": ["sales.workflow.quote.status_changed"],
                "system_actions": [],
                "module_actions": [
                    {
                        "module_id": "sales",
                        "module_name": "Sales",
                        "actions": [
                            {
                                "id": "quote_mark_ready_for_job",
                                "label": "Mark Ready for Job",
                                "kind": "update_record",
                                "entity_id": "entity.quote",
                                "display_id": "sales.quote_mark_ready_for_job",
                            }
                        ],
                    }
                ],
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
                        "prompt": "When a quote is approved, run the Sales: Mark Ready for Job action.",
                        "draft": created["automation"],
                    },
                )

            body = res.json()
            self.assertEqual(res.status_code, 200, body)
            self.assertTrue(body.get("ok"), body)
            steps = body.get("draft", {}).get("steps") or []
            self.assertEqual(steps[0].get("action_id"), "quote_mark_ready_for_job")
            validation = body.get("validation") or {}
            self.assertTrue(validation.get("compiled_ok"), validation)

    def test_automation_ai_plan_resolves_nested_module_action_labels_in_condition_branches(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/automations",
                json={
                    "name": "Quote to Job Handoff",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["sales.workflow.quote.status_changed"], "filters": []},
                    "steps": [self._seed_automation_step()],
                },
            ).json()
            automation_id = created["automation"]["id"]

            def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
                return _fake_response(
                    {
                        "summary": "Run the exposed sales action in the approved branch and notify the team otherwise.",
                        "draft": {
                            "name": "Quote to Job Handoff",
                            "description": "",
                            "trigger": {
                                "kind": "event",
                                "event_types": ["sales.workflow.quote.status_changed"],
                                "filters": [],
                            },
                            "steps": [
                                {
                                    "kind": "condition",
                                    "expr": {
                                        "op": "eq",
                                        "left": {"var": "trigger.after.fields.quote.status"},
                                        "right": {"literal": "approved"},
                                    },
                                    "then_steps": [
                                        {
                                            "kind": "action",
                                            "action_id": "Sales: Mark Ready for Job",
                                            "inputs": {"record_id": "{{trigger.record_id}}"},
                                        }
                                    ],
                                    "else_steps": [
                                        {
                                            "kind": "action",
                                            "action_id": "system.notify",
                                            "inputs": {
                                                "recipient_user_id": "user-1",
                                                "title": "Quote not approved",
                                                "body": "Leave the quote in review.",
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
                "entities": [
                    {
                        "id": "entity.quote",
                        "label": "Quote",
                        "fields": [
                            {"id": "quote.status", "label": "Status", "type": "enum"},
                        ],
                    }
                ],
                "event_catalog": [
                    {
                        "id": "sales.workflow.quote.status_changed",
                        "label": "Quote status changed",
                        "event": "workflow.status_changed",
                        "entity_id": "entity.quote",
                    }
                ],
                "event_types": ["sales.workflow.quote.status_changed"],
                "system_actions": [
                    {"id": "system.notify", "label": "Notify"},
                ],
                "module_actions": [
                    {
                        "module_id": "sales",
                        "module_name": "Sales",
                        "actions": [
                            {
                                "id": "quote_mark_ready_for_job",
                                "label": "Mark Ready for Job",
                                "kind": "update_record",
                                "entity_id": "entity.quote",
                                "display_id": "sales.quote_mark_ready_for_job",
                            }
                        ],
                    }
                ],
                "members": [{"id": "user-1", "name": "Ops Lead"}],
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
                        "prompt": "When a quote is approved, run the Sales: Mark Ready for Job action, otherwise notify Ops.",
                        "draft": created["automation"],
                    },
                )

            body = res.json()
            self.assertEqual(res.status_code, 200, body)
            self.assertTrue(body.get("ok"), body)
            steps = body.get("draft", {}).get("steps") or []
            self.assertEqual(len(steps), 1)
            condition_step = steps[0]
            then_step = (condition_step.get("then_steps") or [{}])[0]
            else_step = (condition_step.get("else_steps") or [{}])[0]
            self.assertEqual(then_step.get("action_id"), "quote_mark_ready_for_job")
            self.assertEqual(else_step.get("action_id"), "system.notify")
            validation = body.get("validation") or {}
            self.assertTrue(validation.get("compiled_ok"), validation)

    def test_automation_ai_plan_normalizes_foreach_action_alias_with_nested_module_action_label(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/automations",
                json={
                    "name": "Quote Line Processing",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["sales.workflow.quote.status_changed"], "filters": []},
                    "steps": [self._seed_automation_step()],
                },
            ).json()
            automation_id = created["automation"]["id"]

            def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
                return _fake_response(
                    {
                        "summary": "Loop through quote lines and run the exposed ready-for-job action.",
                        "draft": {
                            "name": "Quote Line Processing",
                            "description": "",
                            "trigger": {
                                "kind": "event",
                                "event_types": ["sales.workflow.quote.status_changed"],
                                "filters": [],
                            },
                            "steps": [
                                {
                                    "kind": "foreach",
                                    "over": "{{trigger.record.lines}}",
                                    "actions": [
                                        {
                                            "kind": "action",
                                            "action_id": "Sales: Mark Ready for Job",
                                            "inputs": {"record_id": "{{trigger.record_id}}"},
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
                "entities": [
                    {
                        "id": "entity.quote",
                        "label": "Quote",
                        "fields": [
                            {"id": "quote.status", "label": "Status", "type": "enum"},
                        ],
                    }
                ],
                "event_catalog": [
                    {
                        "id": "sales.workflow.quote.status_changed",
                        "label": "Quote status changed",
                        "event": "workflow.status_changed",
                        "entity_id": "entity.quote",
                    }
                ],
                "event_types": ["sales.workflow.quote.status_changed"],
                "system_actions": [],
                "module_actions": [
                    {
                        "module_id": "sales",
                        "module_name": "Sales",
                        "actions": [
                            {
                                "id": "quote_mark_ready_for_job",
                                "label": "Mark Ready for Job",
                                "kind": "update_record",
                                "entity_id": "entity.quote",
                                "display_id": "sales.quote_mark_ready_for_job",
                            }
                        ],
                    }
                ],
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
                        "prompt": "For each quote line, run the Sales: Mark Ready for Job action.",
                        "draft": created["automation"],
                    },
                )

            body = res.json()
            self.assertEqual(res.status_code, 200, body)
            self.assertTrue(body.get("ok"), body)
            steps = body.get("draft", {}).get("steps") or []
            self.assertEqual(len(steps), 1)
            loop_step = steps[0]
            self.assertEqual(loop_step.get("kind"), "foreach")
            nested_steps = loop_step.get("steps") or []
            self.assertEqual(len(nested_steps), 1, loop_step)
            self.assertEqual(nested_steps[0].get("action_id"), "quote_mark_ready_for_job")
            self.assertNotIn("actions", loop_step)
            validation = body.get("validation") or {}
            self.assertTrue(validation.get("compiled_ok"), validation)

    def test_automation_ai_plan_normalizes_foreach_over_aliases_and_nested_actions(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/automations",
                json={
                    "name": "Quote Line Processing",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["sales.workflow.quote.status_changed"], "filters": []},
                    "steps": [self._seed_automation_step()],
                },
            ).json()
            automation_id = created["automation"]["id"]

            def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
                return _fake_response(
                    {
                        "summary": "Loop through quote lines and run the exposed ready-for-job action.",
                        "draft": {
                            "name": "Quote Line Processing",
                            "description": "",
                            "trigger": {
                                "kind": "event",
                                "event_types": ["sales.workflow.quote.status_changed"],
                                "filters": [],
                            },
                            "steps": [
                                {
                                    "kind": "foreach",
                                    "items": "{{trigger.record.lines}}",
                                    "actions": [
                                        {
                                            "kind": "action",
                                            "action_id": "Sales: Mark Ready for Job",
                                            "inputs": {"record_id": "{{trigger.record_id}}"},
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
                "entities": [
                    {
                        "id": "entity.quote",
                        "label": "Quote",
                        "fields": [
                            {"id": "quote.status", "label": "Status", "type": "enum"},
                        ],
                    }
                ],
                "event_catalog": [
                    {
                        "id": "sales.workflow.quote.status_changed",
                        "label": "Quote status changed",
                        "event": "workflow.status_changed",
                        "entity_id": "entity.quote",
                    }
                ],
                "event_types": ["sales.workflow.quote.status_changed"],
                "system_actions": [],
                "module_actions": [
                    {
                        "module_id": "sales",
                        "module_name": "Sales",
                        "actions": [
                            {
                                "id": "quote_mark_ready_for_job",
                                "label": "Mark Ready for Job",
                                "kind": "update_record",
                                "entity_id": "entity.quote",
                                "display_id": "sales.quote_mark_ready_for_job",
                            }
                        ],
                    }
                ],
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
                        "prompt": "For each quote line, run the Sales: Mark Ready for Job action.",
                        "draft": created["automation"],
                    },
                )

            body = res.json()
            self.assertEqual(res.status_code, 200, body)
            self.assertTrue(body.get("ok"), body)
            steps = body.get("draft", {}).get("steps") or []
            self.assertEqual(len(steps), 1)
            loop_step = steps[0]
            self.assertEqual(loop_step.get("kind"), "foreach")
            self.assertEqual(loop_step.get("over"), "{{trigger.record.lines}}")
            self.assertNotIn("items", loop_step)
            self.assertNotIn("actions", loop_step)
            nested_steps = loop_step.get("steps") or []
            self.assertEqual(len(nested_steps), 1, loop_step)
            self.assertEqual(nested_steps[0].get("action_id"), "quote_mark_ready_for_job")
            validation = body.get("validation") or {}
            self.assertTrue(validation.get("compiled_ok"), validation)

    def test_automation_ai_plan_normalizes_delay_duration_aliases(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/automations",
                json={
                    "name": "Quote Follow Up",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["sales.workflow.quote.status_changed"], "filters": []},
                    "steps": [self._seed_automation_step()],
                },
            ).json()
            automation_id = created["automation"]["id"]

            def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
                return _fake_response(
                    {
                        "summary": "Wait 15 minutes before notifying operations.",
                        "draft": {
                            "name": "Quote Follow Up",
                            "description": "",
                            "trigger": {
                                "kind": "event",
                                "event_types": ["sales.workflow.quote.status_changed"],
                                "filters": [],
                            },
                            "steps": [
                                {"kind": "delay", "minutes": 15},
                                {
                                    "kind": "action",
                                    "action_id": "system.notify",
                                    "inputs": {
                                        "recipient_user_id": "user-1",
                                        "title": "Quote follow-up",
                                        "body": "Review the quote after the delay.",
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
                    {"id": "entity.quote", "label": "Quote", "fields": [{"id": "quote.status", "label": "Status", "type": "enum"}]},
                ],
                "event_catalog": [
                    {
                        "id": "sales.workflow.quote.status_changed",
                        "label": "Quote status changed",
                        "event": "workflow.status_changed",
                        "entity_id": "entity.quote",
                    }
                ],
                "event_types": ["sales.workflow.quote.status_changed"],
                "system_actions": [{"id": "system.notify", "label": "Notify"}],
                "module_actions": [],
                "members": [{"id": "user-1", "name": "Ops Lead"}],
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
                        "prompt": "Wait 15 minutes and then notify Ops.",
                        "draft": created["automation"],
                    },
                )

            body = res.json()
            self.assertEqual(res.status_code, 200, body)
            self.assertTrue(body.get("ok"), body)
            steps = body.get("draft", {}).get("steps") or []
            self.assertEqual(steps[0].get("kind"), "delay")
            self.assertEqual(steps[0].get("seconds"), 900)
            self.assertNotIn("minutes", steps[0])
            validation = body.get("validation") or {}
            self.assertTrue(validation.get("compiled_ok"), validation)

    def test_automation_ai_plan_normalizes_delay_time_aliases(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/automations",
                json={
                    "name": "Quote Follow Up",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["sales.workflow.quote.status_changed"], "filters": []},
                    "steps": [self._seed_automation_step()],
                },
            ).json()
            automation_id = created["automation"]["id"]

            def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
                return _fake_response(
                    {
                        "summary": "Wait until the next morning before notifying operations.",
                        "draft": {
                            "name": "Quote Follow Up",
                            "description": "",
                            "trigger": {
                                "kind": "event",
                                "event_types": ["sales.workflow.quote.status_changed"],
                                "filters": [],
                            },
                            "steps": [
                                {"kind": "delay", "wait_until": "2026-05-01T09:00:00Z"},
                                {
                                    "kind": "action",
                                    "action_id": "system.notify",
                                    "inputs": {
                                        "recipient_user_id": "user-1",
                                        "title": "Quote follow-up",
                                        "body": "Review the quote in the morning.",
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
                    {"id": "entity.quote", "label": "Quote", "fields": [{"id": "quote.status", "label": "Status", "type": "enum"}]},
                ],
                "event_catalog": [
                    {
                        "id": "sales.workflow.quote.status_changed",
                        "label": "Quote status changed",
                        "event": "workflow.status_changed",
                        "entity_id": "entity.quote",
                    }
                ],
                "event_types": ["sales.workflow.quote.status_changed"],
                "system_actions": [{"id": "system.notify", "label": "Notify"}],
                "module_actions": [],
                "members": [{"id": "user-1", "name": "Ops Lead"}],
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
                        "prompt": "Wait until tomorrow at 9am and then notify Ops.",
                        "draft": created["automation"],
                    },
                )

            body = res.json()
            self.assertEqual(res.status_code, 200, body)
            self.assertTrue(body.get("ok"), body)
            steps = body.get("draft", {}).get("steps") or []
            self.assertEqual(steps[0].get("kind"), "delay")
            self.assertEqual(steps[0].get("target_time"), "2026-05-01T09:00:00Z")
            self.assertNotIn("wait_until", steps[0])
            validation = body.get("validation") or {}
            self.assertTrue(validation.get("compiled_ok"), validation)

    def test_automation_ai_plan_normalizes_create_and_update_payload_aliases(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/automations",
                json={
                    "name": "Quote Accepted Handoff",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["sales.workflow.quote.status_changed"], "filters": []},
                    "steps": [self._seed_automation_step()],
                },
            ).json()
            automation_id = created["automation"]["id"]

            def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
                return _fake_response(
                    {
                        "summary": "Create a job from the approved quote and update the quote status for handoff.",
                        "draft": {
                            "name": "Quote Accepted Handoff",
                            "description": "",
                            "trigger": {
                                "kind": "event",
                                "event_types": ["sales.workflow.quote.status_changed"],
                                "filters": [],
                            },
                            "steps": [
                                {
                                    "kind": "action",
                                    "action_id": "system.create_record",
                                    "entity_id": "entity.job",
                                    "data": {
                                        "job.source_quote_id": "{{trigger.record_id}}",
                                        "job.contact_id": "{{trigger.record.fields.quote.contact_id}}",
                                        "job.status": "new",
                                    },
                                },
                                {
                                    "kind": "action",
                                    "action_id": "system.update_record",
                                    "entity_id": "entity.quote",
                                    "record_id": "{{trigger.record_id}}",
                                    "fields": {
                                        "quote.status": "handoff_scheduled",
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
                        "id": "entity.quote",
                        "label": "Quote",
                        "fields": [
                            {"id": "quote.status", "label": "Status", "type": "enum"},
                            {"id": "quote.contact_id", "label": "Customer", "type": "lookup"},
                        ],
                    },
                    {
                        "id": "entity.job",
                        "label": "Job",
                        "fields": [
                            {"id": "job.source_quote_id", "label": "Source Quote", "type": "string"},
                            {"id": "job.contact_id", "label": "Customer", "type": "lookup"},
                            {"id": "job.status", "label": "Status", "type": "string"},
                        ],
                    },
                ],
                "event_catalog": [
                    {
                        "id": "sales.workflow.quote.status_changed",
                        "label": "Quote status changed",
                        "event": "workflow.status_changed",
                        "entity_id": "entity.quote",
                    }
                ],
                "event_types": ["sales.workflow.quote.status_changed"],
                "system_actions": [
                    {"id": "system.create_record", "label": "Create record"},
                    {"id": "system.update_record", "label": "Update record"},
                ],
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
                        "prompt": "When a quote is approved, create a job from it and update the quote status to handoff scheduled.",
                        "draft": created["automation"],
                    },
                )

            body = res.json()
            self.assertEqual(res.status_code, 200, body)
            self.assertTrue(body.get("ok"), body)
            steps = body.get("draft", {}).get("steps") or []
            self.assertEqual(len(steps), 2, steps)
            create_step = steps[0]
            self.assertEqual(create_step.get("action_id"), "system.create_record")
            self.assertEqual(create_step.get("inputs", {}).get("entity_id"), "entity.job")
            self.assertEqual(
                create_step.get("inputs", {}).get("values"),
                {
                    "job.source_quote_id": "{{trigger.record_id}}",
                    "job.contact_id": "{{trigger.record.fields.quote.contact_id}}",
                    "job.status": "new",
                },
            )
            self.assertNotIn("data", create_step)
            update_step = steps[1]
            self.assertEqual(update_step.get("action_id"), "system.update_record")
            self.assertEqual(update_step.get("inputs", {}).get("entity_id"), "entity.quote")
            self.assertEqual(update_step.get("inputs", {}).get("record_id"), "{{trigger.record_id}}")
            self.assertEqual(update_step.get("inputs", {}).get("patch"), {"quote.status": "handoff_scheduled"})
            self.assertNotIn("fields", update_step)
            validation = body.get("validation") or {}
            self.assertTrue(validation.get("compiled_ok"), validation)

    def test_automation_ai_plan_normalizes_trigger_aliases_for_workflow_event(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/automations",
                json={
                    "name": "Quote Approval Follow Up",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["record.updated"], "filters": []},
                    "steps": [self._seed_automation_step()],
                },
            ).json()
            automation_id = created["automation"]["id"]

            def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
                return _fake_response(
                    {
                        "summary": "Notify operations when the quote moves to approved.",
                        "draft": {
                            "name": "Quote Approval Follow Up",
                            "description": "",
                            "trigger": {
                                "kind": "webhook",
                                "event": "workflow.status_changed",
                                "conditions": [
                                    {"path": "entity_id", "op": "eq", "value": "entity.quote"},
                                    {"path": "to", "op": "eq", "value": "approved"},
                                ],
                                "condition": {
                                    "op": "eq",
                                    "left": {"var": "trigger.after.fields.quote.status"},
                                    "right": {"literal": "approved"},
                                },
                            },
                            "steps": [
                                {
                                    "kind": "action",
                                    "action_id": "system.notify",
                                    "inputs": {
                                        "recipient_user_id": "user-1",
                                        "title": "Quote approved",
                                        "body": "Prepare the handoff.",
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
                "entities": [
                    {
                        "id": "entity.quote",
                        "label": "Quote",
                        "fields": [
                            {"id": "quote.status", "label": "Status", "type": "enum"},
                        ],
                    }
                ],
                "event_catalog": [
                    {
                        "id": "sales.workflow.quote.status_changed",
                        "label": "Quote status changed",
                        "event": "workflow.status_changed",
                        "entity_id": "entity.quote",
                    }
                ],
                "event_types": ["sales.workflow.quote.status_changed"],
                "system_actions": [{"id": "system.notify", "label": "Notify"}],
                "module_actions": [],
                "members": [{"id": "user-1", "name": "Ops Lead"}],
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
                        "prompt": "Notify Ops when a quote moves to approved.",
                        "draft": created["automation"],
                    },
                )

            body = res.json()
            self.assertEqual(res.status_code, 200, body)
            self.assertTrue(body.get("ok"), body)
            trigger = body.get("draft", {}).get("trigger") or {}
            self.assertEqual(trigger.get("kind"), "event")
            self.assertEqual(trigger.get("event_types"), ["sales.workflow.quote.status_changed"])
            filters = trigger.get("filters") or []
            self.assertEqual(len(filters), 2, trigger)
            self.assertEqual(filters[0].get("path"), "entity_id")
            self.assertEqual(filters[1].get("path"), "to")
            self.assertEqual(
                trigger.get("expr"),
                {
                    "op": "eq",
                    "left": {"var": "trigger.after.fields.quote.status"},
                    "right": {"literal": "approved"},
                },
            )
            validation = body.get("validation") or {}
            self.assertTrue(validation.get("compiled_ok"), validation)

    def test_automation_ai_plan_normalizes_step_kind_aliases_in_mixed_flow(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/automations",
                json={
                    "name": "Quote Review Flow",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["sales.workflow.quote.status_changed"], "filters": []},
                    "steps": [self._seed_automation_step()],
                },
            ).json()
            automation_id = created["automation"]["id"]

            def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
                return _fake_response(
                    {
                        "summary": "Loop through quote lines, branch on approval, then wait until the follow-up time.",
                        "draft": {
                            "name": "Quote Review Flow",
                            "description": "",
                            "trigger": {
                                "kind": "event",
                                "event_types": ["sales.workflow.quote.status_changed"],
                                "filters": [],
                            },
                            "steps": [
                                {
                                    "kind": "for_each",
                                    "items": "{{trigger.record.lines}}",
                                    "actions": [
                                        {
                                            "kind": "if",
                                            "expr": {
                                                "op": "eq",
                                                "left": {"var": "trigger.after.fields.quote.status"},
                                                "right": {"literal": "approved"},
                                            },
                                            "when_true": [
                                                {
                                                    "kind": "action",
                                                    "action_id": "Sales: Mark Ready for Job",
                                                    "inputs": {"record_id": "{{trigger.record_id}}"},
                                                }
                                            ],
                                            "otherwise_steps": [
                                                {
                                                    "kind": "action",
                                                    "action_id": "system.notify",
                                                    "inputs": {
                                                        "recipient_user_id": "user-1",
                                                        "title": "Quote still in review",
                                                        "body": "Keep reviewing the quote before handoff.",
                                                    },
                                                }
                                            ],
                                        }
                                    ],
                                },
                                {"kind": "wait", "until": "2026-05-01T09:00:00Z"},
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
                        "id": "entity.quote",
                        "label": "Quote",
                        "fields": [
                            {"id": "quote.status", "label": "Status", "type": "enum"},
                        ],
                    }
                ],
                "event_catalog": [
                    {
                        "id": "sales.workflow.quote.status_changed",
                        "label": "Quote status changed",
                        "event": "workflow.status_changed",
                        "entity_id": "entity.quote",
                    }
                ],
                "event_types": ["sales.workflow.quote.status_changed"],
                "system_actions": [{"id": "system.notify", "label": "Notify"}],
                "module_actions": [
                    {
                        "module_id": "sales",
                        "module_name": "Sales",
                        "actions": [
                            {
                                "id": "quote_mark_ready_for_job",
                                "label": "Mark Ready for Job",
                                "kind": "update_record",
                                "entity_id": "entity.quote",
                                "display_id": "sales.quote_mark_ready_for_job",
                            }
                        ],
                    }
                ],
                "members": [{"id": "user-1", "name": "Ops Lead"}],
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
                        "prompt": "For each quote line, if the quote is approved run the Sales: Mark Ready for Job action, otherwise notify Ops, then wait until tomorrow at 9am.",
                        "draft": created["automation"],
                    },
                )

            body = res.json()
            self.assertEqual(res.status_code, 200, body)
            self.assertTrue(body.get("ok"), body)
            steps = body.get("draft", {}).get("steps") or []
            self.assertEqual(len(steps), 2, steps)
            loop_step = steps[0]
            self.assertEqual(loop_step.get("kind"), "foreach")
            self.assertEqual(loop_step.get("over"), "{{trigger.record.lines}}")
            nested_steps = loop_step.get("steps") or []
            self.assertEqual(len(nested_steps), 1, loop_step)
            condition_step = nested_steps[0]
            self.assertEqual(condition_step.get("kind"), "condition")
            then_step = (condition_step.get("then_steps") or [{}])[0]
            else_step = (condition_step.get("else_steps") or [{}])[0]
            self.assertEqual(then_step.get("action_id"), "quote_mark_ready_for_job")
            self.assertEqual(else_step.get("action_id"), "system.notify")
            delay_step = steps[1]
            self.assertEqual(delay_step.get("kind"), "delay")
            self.assertEqual(delay_step.get("target_time"), "2026-05-01T09:00:00Z")
            self.assertNotIn("until", delay_step)
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

    def test_automation_ai_plan_does_not_silently_keep_current_user_when_prompt_did_not_specify_recipient(self) -> None:
        client = TestClient(main.app)
        actor = _superadmin_actor()
        actor["user_id"] = "user-current"
        with patch.object(main, "_resolve_actor", lambda _request: actor):
            created = client.post(
                "/automations",
                json={
                    "name": "Quote Notification",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["biz_quotes.record.biz_quote.created"], "filters": []},
                    "steps": [{"kind": "action", "action_id": "system.notify", "inputs": {"recipient_user_id": "user-current", "title": "Automation", "body": "Body"}}],
                },
            ).json()
            automation_id = created["automation"]["id"]

            def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
                return _fake_response(
                    {
                        "summary": "Notify when a quote is created.",
                        "draft": {
                            "name": "Quote Notification",
                            "description": "",
                            "trigger": {"kind": "event", "event_types": ["biz_quotes.record.biz_quote.created"], "filters": []},
                            "steps": [
                                {
                                    "kind": "action",
                                    "action_id": "system.notify",
                                    "inputs": {
                                        "recipient_user_id": "user-current",
                                        "title": "New Quote",
                                        "body": "A new quote was created.",
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
                        "id": "biz_quotes.record.biz_quote.created",
                        "label": "Quote created",
                        "event": "record.created",
                        "entity_id": "entity.biz_quote",
                    }
                ],
                "event_types": ["biz_quotes.record.biz_quote.created"],
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
                        "prompt": "Notify when a quote is created.",
                        "draft": created["automation"],
                    },
                )
            body = res.json()
            self.assertEqual(res.status_code, 200, body)
            self.assertTrue(body.get("ok"), body)
            meta = body.get("required_question_meta") or {}
            self.assertEqual(meta.get("kind"), "decision_slot")
            self.assertEqual(meta.get("slot_kind"), "notify_recipient")
            step = (body.get("draft", {}).get("steps") or [{}])[0]
            self.assertFalse(step.get("inputs", {}).get("recipient_user_id"))
            self.assertFalse(step.get("inputs", {}).get("recipient_user_ids"))

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

    def test_automation_ai_plan_unwraps_comparison_expr_and_strips_condition_action_inputs(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/automations",
                json={
                    "name": "Quote Notification",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["biz_quotes.record.biz_quote.created"], "filters": []},
                    "steps": [{"kind": "action", "action_id": "system.notify", "inputs": {"recipient_user_id": "user-1", "title": "Automation", "body": "Body"}}],
                },
            ).json()
            automation_id = created["automation"]["id"]

            def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
                return _fake_response(
                    {
                        "summary": "Notify differently for Nick.",
                        "draft": {
                            "name": "Quote Notification",
                            "description": "",
                            "trigger": {"kind": "event", "event_types": ["biz_quotes.record.biz_quote.created"], "filters": []},
                            "steps": [
                                {
                                    "kind": "condition",
                                    "expr": {
                                        "comparison": {
                                            "op": "equals",
                                            "left": {"var": "trigger.record.fields.biz_quote.customer_contact_name"},
                                            "right": {"literal": "Nick Sansom"},
                                        }
                                    },
                                    "inputs": {
                                        "entity_id": "entity.biz_quote",
                                        "recipient_user_id": "user-1",
                                        "title": "Automation",
                                        "body": "Bad root action payload",
                                    },
                                    "then_steps": [
                                        {
                                            "kind": "action",
                                            "action_id": "system.notify",
                                            "inputs": {"recipient_user_id": "user-1", "title": "New quote from Nick", "body": "Nick quote."},
                                        }
                                    ],
                                    "else_steps": [
                                        {
                                            "kind": "action",
                                            "action_id": "system.notify",
                                            "inputs": {"recipient_user_id": "user-1", "title": "New Quote", "body": "General quote."},
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
                "entities": [
                    {
                        "id": "entity.biz_quote",
                        "label": "Quote",
                        "fields": [
                            {"id": "biz_quote.customer_contact_name", "label": "Customer Contact", "type": "string"},
                        ],
                    }
                ],
                "event_catalog": [
                    {
                        "id": "biz_quotes.record.biz_quote.created",
                        "label": "Quote created",
                        "event": "record.created",
                        "entity_id": "entity.biz_quote",
                    }
                ],
                "event_types": ["biz_quotes.record.biz_quote.created"],
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
                        "prompt": "If the new quote has Nick Sansom as the customer send one notification otherwise send another.",
                        "draft": created["automation"],
                    },
                )
            body = res.json()
            self.assertEqual(res.status_code, 200, body)
            self.assertTrue(body.get("ok"), body)
            step = (body.get("draft", {}).get("steps") or [{}])[0]
            self.assertEqual(
                step.get("expr"),
                {
                    "op": "eq",
                    "left": {"var": "trigger.record.fields.biz_quote.customer_contact_name"},
                    "right": {"literal": "Nick Sansom"},
                },
            )
            self.assertEqual(step.get("inputs"), {"entity_id": "entity.biz_quote"})

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

    def test_automation_ai_plan_exact_quote_notification_prompt_requires_recipient_and_keeps_condition_shape(self) -> None:
        client = TestClient(main.app)
        automation_id = f"auto_{uuid.uuid4().hex[:8]}"
        stored_item = {
            "id": automation_id,
            "name": "New Quote Notification",
            "description": "",
            "trigger": {"kind": "event", "event_types": ["biz_quotes.record.biz_quote.created"], "filters": []},
            "steps": [],
            "status": "draft",
        }

        def fake_openai(messages, model=None, temperature=0.2, response_format=None):
            return _fake_response(
                {
                    "summary": "Build a conditional notification for new quotes.",
                    "draft": {
                        "name": "New Quote Notification",
                        "description": "Notify when a new quote is created.",
                        "trigger": {"kind": "event", "event_types": ["biz_quotes.record.biz_quote.created"], "filters": []},
                        "steps": [
                            {
                                "id": "step_check_customer",
                                "kind": "condition",
                                "expr": {
                                    "comparison": {
                                        "op": "eq",
                                        "left": {"var": "trigger.record.fields.biz_quote.customer_contact_name"},
                                        "right": {"literal": "Nick Sansom"},
                                    }
                                },
                                "then_steps": [
                                    {
                                        "id": "step_notify_nick",
                                        "kind": "action",
                                        "action_id": "system.notify",
                                        "inputs": {
                                            "recipient_user_id": "user-current",
                                            "title": "New quote from Nick",
                                            "body": "A new quote has been created for Nick Sansom.",
                                        },
                                    }
                                ],
                                "else_steps": [
                                    {
                                        "id": "step_notify_general",
                                        "kind": "action",
                                        "action_id": "system.notify",
                                        "inputs": {
                                            "recipient_user_id": "user-current",
                                            "title": "New Quote",
                                            "body": "A new quote has been created.",
                                        },
                                    }
                                ],
                                "inputs": {
                                    "title": "Automation",
                                    "body": "bad root inputs",
                                    "recipient_user_id": "user-current",
                                    "entity_id": "entity.biz_quote",
                                },
                            }
                        ],
                        "status": "draft",
                    },
                    "assumptions": [
                        "The customer contact name is stored in the field 'customer_contact_name' of the quote entity.",
                        "The current user ID is used for sending notifications.",
                    ],
                    "warnings": [],
                }
            )

        fake_meta = {
            "current_user_id": "user-current",
            "entities": [
                {
                    "id": "entity.biz_quote",
                    "label": "Quote",
                    "fields": [
                        {"id": "biz_quote.customer_contact_name", "label": "Customer Contact", "type": "string"},
                    ],
                }
            ],
            "event_catalog": [
                {
                    "id": "biz_quotes.record.biz_quote.created",
                    "label": "Quote created",
                    "event": "record.created",
                    "entity_id": "entity.biz_quote",
                }
            ],
            "event_types": ["biz_quotes.record.biz_quote.created"],
            "system_actions": [{"id": "system.notify", "label": "Notify workspace users"}],
            "module_actions": [],
            "members": [
                {"user_id": "user-nick", "email": "nick@octodrop.com"},
                {"user_id": "user-kelly", "email": "kelly@octodrop.com"},
            ],
            "connections": [],
            "email_templates": [],
            "doc_templates": [],
        }

        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.object(main.automation_store, "get", lambda _automation_id: stored_item if _automation_id == automation_id else None),
            patch.object(main, "_artifact_ai_automation_meta", lambda request, actor: fake_meta),
            patch.object(main, "_openai_chat_completion", fake_openai),
            patch.object(main, "_openai_configured", lambda: True),
        ):
            res = client.post(
                f"/automations/{automation_id}/ai/plan",
                json={
                    "prompt": 'i want a automation to send a notification if a new quote has been created, if the new quote has Nick Sansom as the customer send notification "New quote from Nick" if it doesnt then send notification New Quote',
                    "draft": stored_item,
                },
            )
        body = res.json()
        self.assertEqual(res.status_code, 200, body)
        self.assertTrue(body.get("ok"), body)
        step = (body.get("draft", {}).get("steps") or [{}])[0]
        self.assertEqual(
            step.get("expr"),
            {
                "op": "eq",
                "left": {"var": "trigger.record.fields.biz_quote.customer_contact_name"},
                "right": {"literal": "Nick Sansom"},
            },
        )
        self.assertEqual(step.get("inputs"), {"entity_id": "entity.biz_quote"})
        then_step = ((step.get("then_steps") or [{}])[0].get("inputs") or {})
        else_step = ((step.get("else_steps") or [{}])[0].get("inputs") or {})
        self.assertFalse(then_step.get("recipient_user_id"))
        self.assertFalse(then_step.get("recipient_user_ids"))
        self.assertFalse(else_step.get("recipient_user_id"))
        self.assertFalse(else_step.get("recipient_user_ids"))
        meta = body.get("required_question_meta") or {}
        self.assertEqual(meta.get("kind"), "decision_slot")
        self.assertEqual(meta.get("slot_kind"), "notify_recipient")

    def test_automation_ai_plan_exact_quote_notification_prompt_applies_selected_recipient_hint(self) -> None:
        client = TestClient(main.app)
        automation_id = f"auto_{uuid.uuid4().hex[:8]}"
        stored_item = {
            "id": automation_id,
            "name": "New Quote Notification",
            "description": "",
            "trigger": {"kind": "event", "event_types": ["biz_quotes.record.biz_quote.created"], "filters": []},
            "steps": [],
            "status": "draft",
        }

        def fake_openai(messages, model=None, temperature=0.2, response_format=None):
            return _fake_response(
                {
                    "summary": "Build a conditional notification for new quotes.",
                    "draft": {
                        "name": "New Quote Notification",
                        "description": "Notify when a new quote is created.",
                        "trigger": {"kind": "event", "event_types": ["biz_quotes.record.biz_quote.created"], "filters": []},
                        "steps": [
                            {
                                "id": "step_check_customer",
                                "kind": "condition",
                                "expr": {
                                    "comparison": {
                                        "op": "eq",
                                        "left": {"var": "trigger.record.fields.biz_quote.customer_contact_name"},
                                        "right": {"literal": "Nick Sansom"},
                                    }
                                },
                                "then_steps": [
                                    {
                                        "id": "step_notify_nick",
                                        "kind": "action",
                                        "action_id": "system.notify",
                                        "inputs": {
                                            "recipient_user_id": "user-current",
                                            "title": "New quote from Nick",
                                            "body": "A new quote has been created for Nick Sansom.",
                                        },
                                    }
                                ],
                                "else_steps": [
                                    {
                                        "id": "step_notify_general",
                                        "kind": "action",
                                        "action_id": "system.notify",
                                        "inputs": {
                                            "recipient_user_id": "user-current",
                                            "title": "New Quote",
                                            "body": "A new quote has been created.",
                                        },
                                    }
                                ],
                                "status": "draft",
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
                    "id": "entity.biz_quote",
                    "label": "Quote",
                    "fields": [
                        {"id": "biz_quote.customer_contact_name", "label": "Customer Contact", "type": "string"},
                    ],
                }
            ],
            "event_catalog": [
                {
                    "id": "biz_quotes.record.biz_quote.created",
                    "label": "Quote created",
                    "event": "record.created",
                    "entity_id": "entity.biz_quote",
                }
            ],
            "event_types": ["biz_quotes.record.biz_quote.created"],
            "system_actions": [{"id": "system.notify", "label": "Notify workspace users"}],
            "module_actions": [],
            "members": [
                {"user_id": "user-nick", "email": "nick@octodrop.com"},
                {"user_id": "user-kelly", "email": "kelly@octodrop.com"},
            ],
            "connections": [],
            "email_templates": [],
            "doc_templates": [],
        }

        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.object(main.automation_store, "get", lambda _automation_id: stored_item if _automation_id == automation_id else None),
            patch.object(main, "_artifact_ai_automation_meta", lambda request, actor: fake_meta),
            patch.object(main, "_openai_chat_completion", fake_openai),
            patch.object(main, "_openai_configured", lambda: True),
        ):
            res = client.post(
                f"/automations/{automation_id}/ai/plan",
                json={
                    "prompt": 'i want a automation to send a notification if a new quote has been created, if the new quote has Nick Sansom as the customer send notification "New quote from Nick" if it doesnt then send notification New Quote',
                    "draft": stored_item,
                    "hints": {
                        "selected_option_value": "nick@octodrop.com",
                        "recipient_email": "nick@octodrop.com",
                    },
                },
            )
        body = res.json()
        self.assertEqual(res.status_code, 200, body)
        self.assertTrue(body.get("ok"), body)
        step = (body.get("draft", {}).get("steps") or [{}])[0]
        self.assertEqual(
            step.get("expr"),
            {
                "op": "eq",
                "left": {"var": "trigger.record.fields.biz_quote.customer_contact_name"},
                "right": {"literal": "Nick Sansom"},
            },
        )
        self.assertIsNone(body.get("required_question_meta"))
        then_step = ((step.get("then_steps") or [{}])[0].get("inputs") or {})
        else_step = ((step.get("else_steps") or [{}])[0].get("inputs") or {})
        self.assertEqual(then_step.get("recipient_user_ids"), ["user-nick"])
        self.assertEqual(then_step.get("recipient_user_id"), "user-nick")
        self.assertEqual(else_step.get("recipient_user_ids"), ["user-nick"])
        self.assertEqual(else_step.get("recipient_user_id"), "user-nick")

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
        self.assertIn("\"reference_contract\"", context_text)
        self.assertIn("\"event_type_ids\"", context_text)
        self.assertIn("\"action_ids\"", context_text)
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

    def test_octo_chat_uses_selected_automation_scope_and_normalizes_module_action_labels(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/automations",
                json={
                    "name": "Quote to Job Handoff",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["sales.workflow.quote.status_changed"], "filters": []},
                    "steps": [self._seed_automation_step()],
                },
            ).json()
            automation_id = created["automation"]["id"]
            session = client.post(
                "/octo-ai/sessions",
                json={
                    "title": "Automation change",
                    "selected_artifact_type": "automation",
                    "selected_artifact_key": automation_id,
                },
            ).json()["session"]

            def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
                return _fake_response(
                    {
                        "summary": "Updated the selected automation.",
                        "draft": {
                            "name": "Quote to Job Handoff",
                            "description": "Run the ready-for-job action when the quote is approved.",
                            "trigger": {"kind": "event", "event_types": ["sales.workflow.quote.status_changed"], "filters": []},
                            "steps": [
                                {
                                    "kind": "action",
                                    "action_id": "Sales: Mark Ready for Job",
                                    "inputs": {
                                        "record_id": "{{trigger.record_id}}",
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
                "entities": [
                    {
                        "id": "entity.quote",
                        "label": "Quote",
                        "fields": [
                            {"id": "quote.status", "label": "Status", "type": "enum"},
                        ],
                    }
                ],
                "event_catalog": [
                    {
                        "id": "sales.workflow.quote.status_changed",
                        "label": "Quote status changed",
                        "event": "workflow.status_changed",
                        "entity_id": "entity.quote",
                    }
                ],
                "event_types": ["sales.workflow.quote.status_changed"],
                "system_actions": [],
                "module_actions": [
                    {
                        "module_id": "sales",
                        "module_name": "Sales",
                        "actions": [
                            {
                                "id": "quote_mark_ready_for_job",
                                "label": "Mark Ready for Job",
                                "kind": "update_record",
                                "entity_id": "entity.quote",
                                "display_id": "sales.quote_mark_ready_for_job",
                            }
                        ],
                    }
                ],
                "members": [],
                "connections": [],
                "email_templates": [],
                "doc_templates": [],
            }

            with (
                patch.object(main, "_artifact_ai_automation_meta", lambda request, actor: fake_meta),
                patch.object(main, "_openai_chat_completion", fake_openai),
            ):
                res = client.post(
                    f"/octo-ai/sessions/{session['id']}/chat",
                    json={"message": "Update this automation to run the Sales: Mark Ready for Job action when a quote is approved."},
                )

            body = res.json()
            self.assertEqual(res.status_code, 200, body)
            self.assertTrue(body.get("ok"), body)
            plan = body.get("plan") or {}
            ops = [item for item in (plan.get("candidate_operations") or []) if isinstance(item, dict)]
            self.assertEqual(len(ops), 1)
            self.assertEqual(ops[0].get("artifact_type"), "automation")
            self.assertEqual(ops[0].get("op"), "update_automation_record")
            steps = ((ops[0].get("automation") or {}).get("steps") or [])
            self.assertEqual(steps[0].get("action_id"), "quote_mark_ready_for_job")
            artifacts = [item for item in (plan.get("affected_artifacts") or []) if isinstance(item, dict)]
            self.assertTrue(any(item.get("artifact_type") == "automation" and item.get("artifact_id") == automation_id for item in artifacts))

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

    def test_octo_chat_named_artifact_merge_keeps_missing_artifact_when_semantic_already_has_one(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            session = client.post("/octo-ai/sessions", json={"title": "Workspace orchestrator"}).json()["session"]

            semantic_plan = {
                "candidate_ops": [
                    {
                        "op": "update_automation_record",
                        "artifact_type": "automation",
                        "artifact_id": "automation_a",
                        "automation": {
                            "name": "Automation A",
                            "status": "draft",
                            "trigger": {"kind": "event", "event_types": ["record.updated"], "filters": []},
                            "steps": [self._seed_automation_step()],
                        },
                    }
                ],
                "questions": [],
                "question_meta": None,
                "assumptions": [],
                "risk_flags": [],
                "advisories": [],
                "affected_modules": [],
                "plan_v1": None,
            }
            named_plan = {
                "candidate_ops": [
                    {
                        "op": "update_automation_record",
                        "artifact_type": "automation",
                        "artifact_id": "automation_a",
                        "automation": {
                            "name": "Automation A",
                            "status": "draft",
                            "trigger": {"kind": "event", "event_types": ["record.updated"], "filters": []},
                            "steps": [self._seed_automation_step()],
                        },
                    },
                    {
                        "op": "update_email_template_record",
                        "artifact_type": "email_template",
                        "artifact_id": "email_a",
                        "email_template": {
                            "name": "Email A",
                            "subject": "Updated",
                            "body_html": "<p>Updated</p>",
                            "body_text": "Updated",
                        },
                    },
                ],
                "questions": [],
                "question_meta": None,
                "assumptions": ["Matched named artifacts from the request."],
                "risk_flags": [],
                "advisories": [],
                "requested_change_lines": ["Update Automation A.", "Update Email A."],
                "affected_artifacts": [
                    {"artifact_type": "automation", "artifact_id": "automation_a", "artifact_key": "automation_a"},
                    {"artifact_type": "email_template", "artifact_id": "email_a", "artifact_key": "email_a"},
                ],
                "planner_state": {
                    "intent": "mixed_artifact_change",
                    "artifact_matches": [
                        {"artifact_type": "automation", "artifact_id": "automation_a", "artifact_label": "Automation A"},
                        {"artifact_type": "email_template", "artifact_id": "email_a", "artifact_label": "Email A"},
                    ],
                },
                "resolved_without_changes": False,
            }

            with (
                patch.object(main, "_ai_semantic_plan_from_model", lambda *args, **kwargs: semantic_plan),
                patch.object(main, "_ai_named_artifact_plan", lambda *args, **kwargs: named_plan),
                patch.object(main, "_ai_slot_based_plan", lambda *args, **kwargs: None),
                patch.object(main, "_ai_scoped_artifact_plan", lambda *args, **kwargs: None),
            ):
                res = client.post(
                    f"/octo-ai/sessions/{session['id']}/chat",
                    json={"message": "Update Automation A and Email A from the workspace brief."},
                )
            body = res.json()
            self.assertEqual(res.status_code, 200, body)
            self.assertTrue(body.get("ok"), body)
            plan = body.get("plan") or {}
            ops = [item for item in (plan.get("candidate_operations") or []) if isinstance(item, dict)]
            self.assertEqual(
                [(item.get("artifact_type"), item.get("artifact_id"), item.get("op")) for item in ops],
                [
                    ("automation", "automation_a", "update_automation_record"),
                    ("email_template", "email_a", "update_email_template_record"),
                ],
            )

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
