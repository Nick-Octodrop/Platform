import copy
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
from app.manifest_validate import validate_manifest_raw
from app.stores import (
    MemoryAttachmentStore,
    MemoryAutomationStore,
    MemoryConnectionStore,
    MemoryDocTemplateStore,
    MemoryEmailStore,
    MemoryJobStore,
)
from app.worker import _handle_doc_generate, _run_automation


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


def _fake_builder_response(calls: list[dict]) -> dict:
    return {
        "choices": [
            {
                "message": {
                    "content": json.dumps(
                        {
                            "plan": {"goal": "Update module", "steps": ["Read manifest", "Apply changes"]},
                            "calls": calls,
                            "ops_by_module": [],
                            "notes": "ok",
                        }
                    )
                }
            }
        ]
    }


def _quote_entity_def() -> dict:
    return {
        "id": "entity.biz_quote",
        "label": "Quote",
        "fields": [
            {"id": "biz_quote.quote_number", "label": "Quote Number", "type": "string"},
            {"id": "biz_quote.customer_name", "label": "Customer Name", "type": "string"},
            {"id": "biz_quote.customer_email", "label": "Customer Email", "type": "email"},
            {"id": "biz_quote.grand_total", "label": "Grand Total", "type": "currency"},
        ],
    }


def _quote_line_entity_def() -> dict:
    return {
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
            {"id": "biz_quote_line.line_total", "label": "Line Total", "type": "currency"},
        ],
    }


class TestAiEndToEndScenarios(unittest.TestCase):
    def _assert_rendered_artifact_has_no_template_leaks(self, rendered: str) -> None:
        text = str(rendered or "")
        lowered = text.lower()
        self.assertNotIn("{{", text)
        self.assertNotIn("}}", text)
        self.assertNotIn("{%", text)
        self.assertNotIn("%}", text)
        self.assertNotIn("undefinederror", lowered)
        self.assertNotIn("templatesyntaxerror", lowered)
        self.assertNotIn("traceback", lowered)
        self.assertNotIn("lorem ipsum", lowered)
        self.assertNotIn("placeholder", lowered)

    def _assert_rendered_email_quality(
        self,
        *,
        subject: str,
        html: str,
        text: str,
        expected_tokens: list[str],
    ) -> None:
        self.assertGreaterEqual(len((subject or "").strip()), 8)
        self.assertGreaterEqual(len((html or "").strip()), 20)
        self.assertGreaterEqual(len((text or "").strip()), 20)
        self.assertIn("<", html)
        self.assertIn(">", html)
        self._assert_rendered_artifact_has_no_template_leaks(subject)
        self._assert_rendered_artifact_has_no_template_leaks(html)
        self._assert_rendered_artifact_has_no_template_leaks(text)
        for token in expected_tokens:
            present = token in (subject or "") or token in (html or "") or token in (text or "")
            self.assertTrue(present, f"expected rendered email to contain {token!r}")

    def _assert_rendered_document_quality(
        self,
        *,
        html: str,
        expected_tokens: list[str],
        expect_tabular: bool = False,
    ) -> None:
        lowered = (html or "").lower()
        self.assertGreaterEqual(len((html or "").strip()), 40)
        self._assert_rendered_artifact_has_no_template_leaks(html)
        self.assertTrue(
            any(tag in lowered for tag in ("<h1", "<h2", "<table", "<section", "<div", "<p")),
            "expected rendered document html to contain recognizable document structure",
        )
        if expect_tabular:
            self.assertIn("<table", lowered)
            self.assertIn("<tr", lowered)
        for token in expected_tokens:
            self.assertIn(token, html)

    def _assert_manifest_quality(self, manifest: dict, *, primary_entity_id: str) -> None:
        entities = {
            entity.get("id"): entity
            for entity in (manifest.get("entities") or [])
            if isinstance(entity, dict) and isinstance(entity.get("id"), str)
        }
        self.assertIn(primary_entity_id, entities)
        entity = entities[primary_entity_id]
        field_ids = [
            field.get("id")
            for field in (entity.get("fields") or [])
            if isinstance(field, dict) and isinstance(field.get("id"), str)
        ]
        self.assertGreaterEqual(len(field_ids), 2, field_ids)
        self.assertTrue(entity.get("display_field"), entity)

        slug = primary_entity_id.split(".", 1)[1]
        pages = {
            page.get("id"): page
            for page in (manifest.get("pages") or [])
            if isinstance(page, dict) and isinstance(page.get("id"), str)
        }
        views = {
            view.get("id"): view
            for view in (manifest.get("views") or [])
            if isinstance(view, dict) and isinstance(view.get("id"), str)
        }
        app_config = manifest.get("app") or {}
        home_ref = app_config.get("home")
        self.assertTrue(isinstance(home_ref, str) and home_ref.startswith("page:"), app_config)
        if isinstance(home_ref, str) and home_ref.startswith("page:"):
            self.assertIn(home_ref[5:], pages, pages)

        nav_targets: list[str] = []
        for group in (app_config.get("nav") or []):
            if isinstance(group, dict):
                for item in (group.get("items") or []):
                    if isinstance(item, dict) and isinstance(item.get("to"), str):
                        nav_targets.append(item["to"])
        self.assertTrue(nav_targets, app_config)
        self.assertTrue(any(target.startswith("page:") and target[5:] in pages for target in nav_targets), nav_targets)

        list_view = views.get(f"{slug}.list") or {}
        self.assertEqual(list_view.get("kind"), "list")
        self.assertEqual(list_view.get("entity"), primary_entity_id)
        list_columns = [
            item.get("field_id")
            for item in (list_view.get("columns") or [])
            if isinstance(item, dict) and isinstance(item.get("field_id"), str)
        ]
        self.assertTrue(list_columns, list_view)
        self.assertTrue(any(field_id in field_ids for field_id in list_columns), (list_columns, field_ids))

        form_view = views.get(f"{slug}.form") or {}
        self.assertEqual(form_view.get("kind"), "form")
        self.assertEqual(form_view.get("entity"), primary_entity_id)
        form_sections = [section for section in (form_view.get("sections") or []) if isinstance(section, dict)]
        self.assertTrue(form_sections, form_view)
        self.assertTrue(any(section.get("fields") for section in form_sections), form_sections)

        list_page = pages.get(f"{slug}.list_page") or {}
        form_page = pages.get(f"{slug}.form_page") or {}
        if list_page and form_page:
            self.assertTrue(list_page.get("content"), list_page)
            self.assertTrue(form_page.get("content"), form_page)
        else:
            entity_pages = [
                page
                for page in pages.values()
                if isinstance(page, dict)
                and (
                    f"view:{slug}.list" in str(page.get("content") or "")
                    or f"view:{slug}.form" in str(page.get("content") or "")
                    or primary_entity_id in str(page.get("content") or "")
                )
            ]
            self.assertTrue(entity_pages, pages)
            self.assertTrue(any((page.get("content") or []) for page in entity_pages), entity_pages)

    def _assert_entity_field_semantics(
        self,
        manifest: dict,
        *,
        entity_id: str,
        required_suffixes: list[str],
        banned_suffixes: list[str] | None = None,
    ) -> None:
        entities = {
            entity.get("id"): entity
            for entity in (manifest.get("entities") or [])
            if isinstance(entity, dict) and isinstance(entity.get("id"), str)
        }
        self.assertIn(entity_id, entities)
        entity = entities[entity_id]
        slug = entity_id.split(".", 1)[1]
        field_ids = [
            field.get("id")
            for field in (entity.get("fields") or [])
            if isinstance(field, dict) and isinstance(field.get("id"), str)
        ]
        for suffix in required_suffixes:
            self.assertIn(f"{slug}.{suffix}", field_ids, field_ids)
        for suffix in banned_suffixes or []:
            self.assertNotIn(f"{slug}.{suffix}", field_ids, field_ids)

    def _assert_automation_quality(
        self,
        automation: dict,
        *,
        expected_action_ids: list[str] | None = None,
        expected_trigger_kind: str | None = None,
    ) -> None:
        self.assertIsInstance(automation, dict)
        trigger = automation.get("trigger") or {}
        if expected_trigger_kind is not None:
            self.assertEqual(trigger.get("kind"), expected_trigger_kind, trigger)
        self.assertTrue(
            (trigger.get("event_types") or trigger.get("cron") or trigger.get("schedule")),
            trigger,
        )
        steps = [step for step in (automation.get("steps") or []) if isinstance(step, dict)]
        self.assertTrue(steps, automation)
        self.assertTrue(all(step.get("kind") == "action" for step in steps), steps)
        for step in steps:
            self.assertTrue(isinstance(step.get("action_id"), str) and step.get("action_id"), step)
            self.assertIsInstance(step.get("inputs") or {}, dict)
        if expected_action_ids is not None:
            self.assertEqual([step.get("action_id") for step in steps], expected_action_ids)

    def _assert_candidate_plan_quality(
        self,
        ops: list[dict],
        allowed_email_template_ids: set[str] | None = None,
        allowed_document_template_ids: set[str] | None = None,
    ) -> None:
        self.assertTrue(ops, ops)
        module_entity_ids: set[str] = set()
        email_template_ids: set[str] = set()
        document_template_ids: set[str] = set()
        allowed_email_template_ids = set(allowed_email_template_ids or set())
        allowed_document_template_ids = set(allowed_document_template_ids or set())

        for op in ops:
            op_name = op.get("op")
            if op_name in {"create_module", "create_module_record"}:
                manifest = op.get("manifest") or op.get("module") or {}
                if isinstance(manifest, dict) and manifest.get("entities"):
                    primary_entity = next(
                        (
                            entity.get("id")
                            for entity in (manifest.get("entities") or [])
                            if isinstance(entity, dict) and isinstance(entity.get("id"), str)
                        ),
                        None,
                    )
                    if primary_entity:
                        module_entity_ids.add(primary_entity)
                if isinstance(manifest, dict) and manifest.get("manifest_version"):
                    primary_entity = next(
                        (
                            entity.get("id")
                            for entity in (manifest.get("entities") or [])
                            if isinstance(entity, dict) and isinstance(entity.get("id"), str)
                        ),
                        None,
                    )
                    if primary_entity:
                        self._assert_manifest_quality(manifest, primary_entity_id=primary_entity)
            elif op_name == "create_email_template_record":
                template = op.get("email_template") or {}
                self.assertTrue(template.get("subject"), template)
                self.assertTrue(template.get("body_html") or template.get("body_text"), template)
                entity_id = ((template.get("variables_schema") or {}).get("entity_id"))
                self.assertTrue(entity_id, template)
                email_template_ids.add(op.get("artifact_id"))
                if module_entity_ids:
                    self.assertIn(entity_id, module_entity_ids)
            elif op_name == "create_document_template_record":
                template = op.get("document_template") or {}
                self.assertTrue(template.get("filename_pattern"), template)
                self.assertTrue(template.get("html"), template)
                entity_id = ((template.get("variables_schema") or {}).get("entity_id"))
                self.assertTrue(entity_id, template)
                document_template_ids.add(op.get("artifact_id"))
                if module_entity_ids:
                    self.assertIn(entity_id, module_entity_ids)
            elif op_name == "create_automation_record":
                automation = op.get("automation") or {}
                self._assert_automation_quality(automation, expected_trigger_kind="event")
                for step in [step for step in (automation.get("steps") or []) if isinstance(step, dict)]:
                    inputs = step.get("inputs") or {}
                    template_id = inputs.get("template_id")
                    action_id = step.get("action_id")
                    if action_id == "system.send_email" and template_id:
                        self.assertIn(template_id, email_template_ids | allowed_email_template_ids)
                    if action_id == "system.generate_document" and template_id:
                        self.assertIn(template_id, document_template_ids | allowed_document_template_ids)

    def test_email_template_ai_plan_preview_renders_quote_values_end_to_end(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/email/templates",
                json={
                    "name": "Quote Ready",
                    "description": "",
                    "subject": "Stored",
                    "body_html": "<p>Stored</p>",
                    "body_text": "Stored",
                    "variables_schema": {"entity_id": "entity.biz_quote"},
                },
            ).json()
            template_id = created["template"]["id"]

        def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
            return _fake_response(
                {
                    "summary": "Created a customer-ready quote email.",
                    "draft": {
                        "name": "Quote Ready",
                        "description": "Send a quote summary to the customer.",
                        "subject": "Quote {{ record['biz_quote.quote_number'] }} for {{ record['biz_quote.customer_name'] }}",
                        "body_html": (
                            "<p>Dear {{ record['biz_quote.customer_name'] }},</p>"
                            "<p>Your quote <strong>{{ record['biz_quote.quote_number'] }}</strong> totals "
                            "{{ record['biz_quote.grand_total'] }}.</p>"
                        ),
                        "body_text": (
                            "Dear {{ record['biz_quote.customer_name'] }},\n\n"
                            "Your quote {{ record['biz_quote.quote_number'] }} totals {{ record['biz_quote.grand_total'] }}."
                        ),
                        "variables_schema": {"entity_id": "entity.biz_quote"},
                    },
                    "assumptions": [],
                    "warnings": [],
                }
            )

        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.object(main, "_openai_chat_completion", fake_openai),
            patch.object(main, "_openai_configured", lambda: True),
        ):
            plan_res = client.post(
                f"/email/templates/{template_id}/ai/plan",
                json={
                    "prompt": "Create a customer-ready quote email.",
                    "draft": created["template"],
                },
            )
        plan_body = plan_res.json()
        self.assertEqual(plan_res.status_code, 200, plan_body)
        self.assertTrue((plan_body.get("validation") or {}).get("compiled_ok"), plan_body)

        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            preview_res = client.post(
                f"/email/templates/{template_id}/preview",
                json={
                    "draft": plan_body["draft"],
                    "sample": {
                        "entity_id": "entity.biz_quote",
                        "record": {
                            "biz_quote.quote_number": "QUO-2026-1001",
                            "biz_quote.customer_name": "Northwind",
                            "biz_quote.grand_total": "$1,250.00",
                        },
                    },
                },
            )
        preview_body = preview_res.json()
        self.assertEqual(preview_res.status_code, 200, preview_body)
        self.assertEqual(preview_body.get("rendered_subject"), "Quote QUO-2026-1001 for Northwind")
        self._assert_rendered_email_quality(
            subject=preview_body.get("rendered_subject", ""),
            html=preview_body.get("rendered_html", ""),
            text=preview_body.get("rendered_text", ""),
            expected_tokens=["Northwind", "QUO-2026-1001", "$1,250.00"],
        )

    def test_document_template_ai_plan_preview_renders_quote_line_items_end_to_end(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/documents/templates",
                json={
                    "name": "Quote PDF",
                    "description": "",
                    "filename_pattern": "placeholder",
                    "html": "<p>Placeholder</p>",
                    "variables_schema": {"entity_id": "entity.biz_quote"},
                },
            ).json()
            template_id = created["template"]["id"]

        def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
            return _fake_response(
                {
                    "summary": "Created a quote PDF.",
                    "draft": {
                        "name": "Quote PDF",
                        "description": "Customer-facing quote PDF.",
                        "filename_pattern": "quote_{{ record['biz_quote.quote_number'] }}",
                        "html": (
                            "<h1>Quote {{ record['biz_quote.quote_number'] }}</h1>"
                            "<p>{{ record['biz_quote.customer_name'] }}</p>"
                            "<table>{% for line in lines %}"
                            "<tr><td>{{ line['biz_quote_line.description'] }}</td>"
                            "<td>{{ line['biz_quote_line.quantity'] }}</td>"
                            "<td>{{ line['biz_quote_line.line_total'] }}</td></tr>"
                            "{% endfor %}</table>"
                            "<p>Total {{ record['biz_quote.grand_total'] }}</p>"
                        ),
                        "variables_schema": {"entity_id": "entity.biz_quote"},
                    },
                    "assumptions": [],
                    "warnings": [],
                }
            )

        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.object(main, "_openai_chat_completion", fake_openai),
            patch.object(main, "_openai_configured", lambda: True),
        ):
            plan_res = client.post(
                f"/documents/templates/{template_id}/ai/plan",
                json={
                    "prompt": "Create a customer-ready quote PDF.",
                    "draft": created["template"],
                },
            )
        plan_body = plan_res.json()
        self.assertEqual(plan_res.status_code, 200, plan_body)
        self.assertTrue((plan_body.get("validation") or {}).get("compiled_ok"), plan_body)

        captured: dict[str, object] = {}
        fake_pdf = b"%PDF-1.4\nquote-pdf\n%%EOF"

        def fake_find_entity(_request, entity_id):
            if entity_id in {"entity.biz_quote", "biz_quote"}:
                return ("quotes", _quote_entity_def(), "hash")
            if entity_id in {"entity.biz_quote_line", "biz_quote_line"}:
                return ("quotes", _quote_line_entity_def(), "hash")
            return None

        def fake_render_pdf(html, paper_size, margins, header_html, footer_html):
            captured["html"] = html
            captured["paper_size"] = paper_size
            return fake_pdf

        def fake_store_bytes(_org_id, filename, data, mime_type="application/octet-stream"):
            captured["filename"] = filename
            return {"size": len(data or b""), "storage_key": "preview/quote.pdf", "sha256": "quote-preview"}

        with (
            patch.object(main, "_resolve_actor", lambda _request: _template_manager_actor()),
            patch.object(main, "_find_entity_def", fake_find_entity),
            patch.object(
                main,
                "_find_entity_def_global",
                lambda entity_id: _quote_line_entity_def()
                if entity_id in {"entity.biz_quote_line", "biz_quote_line"}
                else _quote_entity_def()
                if entity_id in {"entity.biz_quote", "biz_quote"}
                else None,
            ),
            patch.object(main, "render_pdf", fake_render_pdf),
            patch.object(main, "store_bytes", fake_store_bytes),
            patch.object(main, "_branding_context_for_org", lambda _org_id: {"workspace": {}, "company": {}, "branding": {}}),
            patch.object(
                main.generic_records,
                "get",
                lambda entity_id, record_id: {
                    "record": {
                        "id": "quote_1",
                        "biz_quote.quote_number": "QUO-2026-2001",
                        "biz_quote.customer_name": "Contoso",
                        "biz_quote.grand_total": "$980.00",
                    }
                }
                if entity_id in {"entity.biz_quote", "biz_quote"} and record_id == "quote_1"
                else None,
            ),
            patch.object(
                main.generic_records,
                "list",
                lambda entity_id, limit=1000: [
                    {
                        "record_id": "line_1",
                        "record": {
                            "id": "line_1",
                            "biz_quote_line.quote_id": "quote_1",
                            "biz_quote_line.description": "Site visit",
                            "biz_quote_line.quantity": 2,
                            "biz_quote_line.line_total": "$400.00",
                        },
                    },
                    {
                        "record_id": "line_2",
                        "record": {
                            "id": "line_2",
                            "biz_quote_line.quote_id": "quote_1",
                            "biz_quote_line.description": "Install",
                            "biz_quote_line.quantity": 1,
                            "biz_quote_line.line_total": "$580.00",
                        },
                    },
                ]
                if entity_id in {"entity.biz_quote_line", "biz_quote_line"}
                else [],
            ),
        ):
            preview_res = client.post(
                f"/docs/templates/{template_id}/preview",
                json={
                    "draft": plan_body["draft"],
                    "sample": {
                        "entity_id": "entity.biz_quote",
                        "record_id": "quote_1",
                    },
                },
            )
        preview_body = preview_res.json()
        self.assertEqual(preview_res.status_code, 200, preview_body)
        self.assertEqual(preview_body.get("filename"), "quote_QUO-2026-2001.pdf")
        self._assert_rendered_document_quality(
            html=str(captured.get("html") or ""),
            expected_tokens=["Contoso", "Site visit", "Install", "$980.00"],
            expect_tabular=True,
        )

    def test_automation_ai_plan_runtime_quote_email_succeeds_end_to_end(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/automations",
                json={
                    "name": "Quote Accepted",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["biz_quotes.action.quote_mark_accepted.clicked"], "filters": []},
                    "steps": [
                        {
                            "kind": "action",
                            "action_id": "system.notify",
                            "inputs": {"recipient_user_id": "user-1", "title": "Placeholder", "body": "Placeholder"},
                        }
                    ],
                },
            ).json()
            automation_id = created["automation"]["id"]

        fake_meta = {
            "current_user_id": "user-1",
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
                        {"id": "biz_quote.quote_number", "label": "Quote Number", "type": "string"},
                        {"id": "biz_quote.customer_name", "label": "Customer Name", "type": "string"},
                        {"id": "biz_quote.customer_email", "label": "Customer Email", "type": "email"},
                    ],
                }
            ],
            "members": [{"user_id": "user-1", "email": "admin@example.com"}],
            "connections": [],
            "email_templates": [],
            "doc_templates": [],
        }

        def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
            return _fake_response(
                {
                    "summary": "Email the customer when the quote is accepted.",
                    "draft": {
                        "name": "Quote Accepted",
                        "description": "",
                        "trigger": {"kind": "event", "event_types": ["biz_quotes.action.quote_mark_accepted.clicked"], "filters": []},
                        "steps": [
                            {
                                "id": "step_send_email",
                                "kind": "action",
                                "action_id": "system.send_email",
                                "inputs": {
                                    "entity_id": "entity.biz_quote",
                                    "to": "customer email",
                                    "subject": "Quote {{ record['biz_quote.quote_number'] }} accepted",
                                    "body_html": (
                                        "<p>Dear {{ record['biz_quote.customer_name'] }},</p>"
                                        "<p>Your quote {{ record['biz_quote.quote_number'] }} has been accepted.</p>"
                                    ),
                                    "body_text": (
                                        "Dear {{ record['biz_quote.customer_name'] }},\n\n"
                                        "Your quote {{ record['biz_quote.quote_number'] }} has been accepted."
                                    ),
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
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.object(main, "_artifact_ai_automation_meta", lambda request, actor: fake_meta),
            patch.object(main, "_openai_chat_completion", fake_openai),
            patch.object(main, "_openai_configured", lambda: True),
        ):
            plan_res = client.post(
                f"/automations/{automation_id}/ai/plan",
                json={
                    "prompt": "Email the customer when the quote is accepted.",
                    "draft": created["automation"],
                },
            )
        plan_body = plan_res.json()
        self.assertEqual(plan_res.status_code, 200, plan_body)
        self.assertTrue((plan_body.get("validation") or {}).get("compiled_ok"), plan_body)
        step_inputs = (((plan_body.get("draft") or {}).get("steps") or [{}])[0].get("inputs") or {})
        self.assertEqual(step_inputs.get("to_field_ids"), ["biz_quote.customer_email"])
        self.assertNotIn("to", step_inputs)

        store = MemoryAutomationStore()
        job_store = MemoryJobStore()
        runtime_draft = copy.deepcopy(plan_body["draft"])
        runtime_draft["status"] = "published"
        automation = store.create(runtime_draft)
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
                        "flat": {
                            "biz_quote.quote_number": "QUO-2026-3001",
                            "biz_quote.customer_name": "Fabrikam",
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
                            "biz_quote.quote_number": "QUO-2026-3001",
                            "biz_quote.customer_name": "Fabrikam",
                            "biz_quote.customer_email": "customer@example.com",
                        }
                    }
                return None

        with (
            patch("app.worker.DbEmailStore", return_value=_FakeEmailStore()),
            patch("app.worker.DbConnectionStore", return_value=_FakeConnectionStore()),
            patch("app.worker.DbGenericRecordStore", return_value=_FakeRecordStore()),
            patch("app.worker._find_entity_def", return_value=_quote_entity_def()),
        ):
            _run_automation({"payload": {"run_id": run["id"]}}, "default", automation_store=store, job_store=job_store)

        run_after = store.get_run(run["id"])
        self.assertEqual(run_after["status"], "succeeded", run_after)
        self.assertEqual(len(created_outbox), 1, created_outbox)
        self.assertEqual(created_outbox[0]["to"], ["customer@example.com"])
        self.assertEqual(created_outbox[0]["subject"], "Quote QUO-2026-3001 accepted")
        self.assertIn("Dear Fabrikam", created_outbox[0]["body_html"])

    def test_shopify_inbound_runtime_notifies_and_emails_from_upserted_sales_order_record(self) -> None:
        store = MemoryAutomationStore()
        job_store = MemoryJobStore()
        automation = store.create(
            {
                "name": "Shopify Phase 2 - Orders Inbound",
                "status": "published",
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
                        "id": "upsert_shopify_order",
                        "kind": "action",
                        "action_id": "system.shopify_upsert_order_webhook",
                        "inputs": {
                            "payload": {"var": "trigger.payload"},
                            "connection_id": {"var": "trigger.connection_id"},
                        },
                    },
                    {
                        "id": "notify_team",
                        "kind": "action",
                        "action_id": "system.notify",
                        "inputs": {
                            "title": "New Shopify Order {{ record['te_sales_order.order_number'] }}",
                            "body": "A new Shopify order is ready.",
                            "link_mode": "trigger_record",
                            "recipient_user_ids": ["user-nick", "user-kelly"],
                        },
                    },
                    {
                        "id": "email_team",
                        "kind": "action",
                        "action_id": "system.send_email",
                        "inputs": {
                            "subject": "New Shopify order {{ record['te_sales_order.order_number'] }}",
                            "body_text": "A new Shopify order has arrived.",
                            "to_internal_emails": ["ops@example.com"],
                        },
                    },
                ],
            }
        )
        run = store.create_run(
            {
                "automation_id": automation["id"],
                "status": "queued",
                "trigger_type": "integration.webhook.shopify.orders.create",
                "trigger_payload": {
                    "event": "integration.webhook.shopify.orders.create",
                    "connection_id": "conn_shopify",
                    "payload": {"id": "shopify-order-1"},
                },
            }
        )

        created_notifications: list[dict] = []
        created_outbox: list[dict] = []

        class _FakeNotificationStore:
            def create(self, payload):
                item = {"id": f"notif_{len(created_notifications) + 1}", **payload}
                created_notifications.append(item)
                return item

        class _FakeEmailStore:
            def create_outbox(self, payload):
                item = {"id": "outbox_1", **payload, "created_at": datetime.now(timezone.utc).isoformat()}
                created_outbox.append(item)
                return item

        class _FakeConnectionStore:
            def get(self, connection_id):
                if connection_id == "conn_shopify":
                    return {"id": "conn_shopify", "provider": "shopify", "config": {}}
                return None

            def get_default_email(self):
                return {"id": "conn_default", "config": {"from_email": "noreply@example.com"}}

        fake_app = SimpleNamespace(
            _enrich_template_record=lambda record_data, entity_def: dict(record_data or {}),
            _build_template_render_context=lambda record_data, entity_def, entity_id, branding: {
                "record": dict(record_data or {}),
                "entity_id": entity_id,
                **(branding or {}),
            },
            _branding_context_for_org=lambda _org_id: {},
        )

        with (
            patch("app.worker.DbNotificationStore", return_value=_FakeNotificationStore()),
            patch("app.worker.DbEmailStore", return_value=_FakeEmailStore()),
            patch("app.worker.DbConnectionStore", return_value=_FakeConnectionStore()),
            patch("app.worker.DbAttachmentStore", return_value=MemoryAttachmentStore()),
            patch("app.worker._get_app_main", return_value=fake_app),
            patch(
                "app.worker._shopify_upsert_order_record",
                return_value={
                    "ok": True,
                    "entity_id": "entity.te_sales_order",
                    "record_id": "sales_order_1",
                    "action": "created",
                },
            ),
            patch("app.worker._fetch_record_payload", return_value={"te_sales_order.order_number": "SO-1001"}),
            patch("app.worker._find_entity_def", return_value=None),
        ):
            _run_automation({"payload": {"run_id": run["id"]}}, "default", automation_store=store, job_store=job_store)

        run_after = store.get_run(run["id"])
        self.assertEqual(run_after["status"], "succeeded", run_after)
        self.assertEqual(len(created_notifications), 2, created_notifications)
        self.assertEqual(created_notifications[0]["title"], "New Shopify Order SO-1001")
        self.assertEqual(created_notifications[0]["link_to"], "/data/te_sales_order/sales_order_1")
        self.assertEqual(len(created_outbox), 1, created_outbox)
        self.assertEqual(created_outbox[0]["subject"], "New Shopify order SO-1001")
        self.assertEqual(created_outbox[0]["to"], ["ops@example.com"])

    def test_studio_agent_chat_rewrites_legacy_source_list_page_when_adding_field(self) -> None:
        client = TestClient(main.app)
        module_id = f"inventory_{uuid.uuid4().hex[:6]}"
        base_manifest = {
            "manifest_version": "1.3",
            "module": {"id": module_id, "name": "Inventory"},
            "app": {"home": "page:item.list_page", "nav": [{"group": "Main", "items": [{"label": "Items", "to": "page:item.list_page"}]}]},
            "entities": [
                {
                    "id": "entity.item",
                    "label": "Item",
                    "display_field": "item.name",
                    "fields": [
                        {"id": "item.code", "type": "string", "label": "Code"},
                        {"id": "item.name", "type": "string", "label": "Name"},
                    ],
                }
            ],
            "views": [
                {
                    "id": "item.list",
                    "kind": "list",
                    "entity": "entity.item",
                    "columns": [{"field_id": "item.code"}, {"field_id": "item.name"}],
                },
                {
                    "id": "item.form",
                    "kind": "form",
                    "entity": "entity.item",
                    "sections": [{"id": "main", "title": "Details", "fields": ["item.code", "item.name"]}],
                },
            ],
            "pages": [
                {
                    "id": "item.list_page",
                    "title": "Items",
                    "layout": "single",
                    "content": [{"id": "item_legacy_list", "kind": "view", "source": "view:item.list"}],
                },
                {
                    "id": "item.form_page",
                    "title": "Item",
                    "layout": "single",
                    "content": [{"kind": "record", "entity_id": "entity.item", "record_id_query": "record", "content": [{"kind": "view", "target": "view:item.form"}]}],
                },
            ],
            "actions": [{"id": "action.item_new", "kind": "create_record", "entity_id": "entity.item", "target": "page:item.form_page", "label": "New"}],
            "workflows": [],
        }
        main.drafts.upsert_draft(module_id, base_manifest, updated_by="test", base_snapshot_id=None)

        entity = copy.deepcopy(base_manifest["entities"][0])
        entity["fields"].append({"id": "item.preferred_supplier", "type": "string", "label": "Preferred Supplier"})
        calls = [{"tool": "ensure_entity", "module_id": module_id, "entity": entity}]

        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.object(main, "_openai_chat_completion", lambda _messages, model=None: _fake_builder_response(calls)),
            patch.object(main, "_openai_configured", lambda: True),
        ):
            res = client.post(
                "/studio2/agent/chat",
                json={"module_id": module_id, "message": "add a preferred supplier field"},
            )
        body = res.json()
        self.assertTrue(body.get("ok"), body)
        draft = (((body.get("data") or {}).get("drafts") or {}).get(module_id)) or {}
        normalized, errors, warnings = validate_manifest_raw(draft, expected_module_id=module_id)
        self.assertEqual(errors, [], {"warnings": warnings})
        self._assert_manifest_quality(normalized, primary_entity_id="entity.item")

        page_by_id = {page.get("id"): page for page in (normalized.get("pages") or []) if isinstance(page, dict)}
        list_page = page_by_id.get("item.list_page") or {}
        content = list_page.get("content") or []
        self.assertEqual(len(content), 1, list_page)
        self.assertEqual((content[0] or {}).get("kind"), "container", list_page)
        nested = ((content[0] or {}).get("content") or [None])[0] or {}
        self.assertEqual(nested.get("kind"), "view_modes", list_page)
        self.assertEqual((nested.get("modes") or [{}])[0].get("target"), "view:item.list", list_page)
        legacy_blocks = [
            block
            for block in content
            if isinstance(block, dict) and block.get("kind") == "view" and block.get("source") == "view:item.list"
        ]
        self.assertEqual(legacy_blocks, [], list_page)

    def test_email_template_entity_choice_follow_up_renders_selected_quote_preview_end_to_end(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/email/templates",
                json={
                    "name": "Customer Update",
                    "description": "",
                    "subject": "Hello",
                    "body_html": "<p>Hello</p>",
                    "body_text": "Hello",
                },
            ).json()
            template_id = created["template"]["id"]

        fake_entities = [
            _quote_entity_def(),
            {
                "id": "entity.biz_job",
                "label": "Job",
                "fields": [{"id": "biz_job.job_number", "label": "Job Number", "type": "string"}],
            },
        ]

        class FakeConnectionStore:
            def get_default_email(self):
                return {"id": "conn_default", "status": "active"}

            def list(self, status=None):
                return [{"id": "conn_default", "status": "active"}]

        openai_calls = {"count": 0}

        def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
            openai_calls["count"] += 1
            if openai_calls["count"] == 1:
                return _fake_response(
                    {
                        "summary": "Drafted the email template.",
                        "draft": {
                            "name": "Customer Update",
                            "description": "Send an update to the customer.",
                            "subject": "Customer update",
                            "body_html": "<p>Hello</p>",
                            "body_text": "Hello",
                        },
                        "assumptions": [],
                        "warnings": [],
                    }
                )
            return _fake_response(
                {
                    "summary": "Created a quote acceptance email.",
                    "draft": {
                        "name": "Customer Update",
                        "description": "Send a quote acceptance note to the customer.",
                        "subject": "Quote {{ record['biz_quote.quote_number'] }} accepted",
                        "body_html": (
                            "<p>Dear {{ record['biz_quote.customer_name'] }},</p>"
                            "<p>Your quote total is {{ record['biz_quote.grand_total'] }}.</p>"
                        ),
                        "body_text": (
                            "Dear {{ record['biz_quote.customer_name'] }},\n\n"
                            "Your quote total is {{ record['biz_quote.grand_total'] }}."
                        ),
                        "variables_schema": {"entity_id": "entity.biz_quote"},
                    },
                    "assumptions": [],
                    "warnings": [],
                }
            )

        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.object(main, "_artifact_ai_entities", lambda _request: copy.deepcopy(fake_entities)),
            patch.object(
                main,
                "_find_entity_def_global",
                lambda entity_id: copy.deepcopy(_quote_entity_def())
                if entity_id in {"entity.biz_quote", "biz_quote"}
                else {
                    "id": "entity.biz_job",
                    "label": "Job",
                    "fields": [{"id": "biz_job.job_number", "label": "Job Number", "type": "string"}],
                }
                if entity_id in {"entity.biz_job", "biz_job"}
                else None,
            ),
            patch.object(main, "connection_store", FakeConnectionStore()),
            patch.object(main, "_openai_chat_completion", fake_openai),
            patch.object(main, "_openai_configured", lambda: True),
        ):
            first_res = client.post(
                f"/email/templates/{template_id}/ai/plan",
                json={"prompt": "Create a customer email template.", "draft": created["template"]},
            )
            second_res = client.post(
                f"/email/templates/{template_id}/ai/plan",
                json={
                    "prompt": "Create a customer email template.",
                    "draft": created["template"],
                    "hints": {
                        "entity_id": "entity.biz_quote",
                        "selected_option_value": "entity.biz_quote",
                        "selected_option_label": "Quote",
                    },
                },
            )
        first_body = first_res.json()
        second_body = second_res.json()
        self.assertEqual(first_res.status_code, 200, first_body)
        self.assertEqual((first_body.get("required_question_meta") or {}).get("slot_kind"), "template_entity_choice")
        self.assertEqual(second_res.status_code, 200, second_body)
        self.assertIsNone(second_body.get("required_question_meta"))
        self.assertEqual(((second_body.get("draft") or {}).get("variables_schema") or {}).get("entity_id"), "entity.biz_quote")

        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            preview_res = client.post(
                f"/email/templates/{template_id}/preview",
                json={
                    "draft": second_body["draft"],
                    "sample": {
                        "entity_id": "entity.biz_quote",
                        "record": {
                            "biz_quote.quote_number": "QUO-2026-4101",
                            "biz_quote.customer_name": "Adventure Works",
                            "biz_quote.grand_total": "$640.00",
                        },
                    },
                },
            )
        preview_body = preview_res.json()
        self.assertEqual(preview_res.status_code, 200, preview_body)
        self.assertEqual(preview_body.get("rendered_subject"), "Quote QUO-2026-4101 accepted")
        self._assert_rendered_email_quality(
            subject=preview_body.get("rendered_subject", ""),
            html=preview_body.get("rendered_html", ""),
            text=preview_body.get("rendered_text", ""),
            expected_tokens=["Adventure Works", "QUO-2026-4101", "$640.00"],
        )

    def test_document_template_entity_choice_follow_up_renders_selected_quote_pdf_end_to_end(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/documents/templates",
                json={
                    "name": "Customer Quote PDF",
                    "description": "",
                    "filename_pattern": "placeholder",
                    "html": "<p>Placeholder</p>",
                },
            ).json()
            template_id = created["template"]["id"]

        fake_entities = [
            _quote_entity_def(),
            {
                "id": "entity.biz_job",
                "label": "Job",
                "fields": [{"id": "biz_job.job_number", "label": "Job Number", "type": "string"}],
            },
        ]

        openai_calls = {"count": 0}

        def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
            openai_calls["count"] += 1
            if openai_calls["count"] == 1:
                return _fake_response(
                    {
                        "summary": "Drafted the document template.",
                        "draft": {
                            "name": "Customer Quote PDF",
                            "description": "Customer-facing document.",
                            "filename_pattern": "document",
                            "html": "<p>Hello</p>",
                        },
                        "assumptions": [],
                        "warnings": [],
                    }
                )
            return _fake_response(
                {
                    "summary": "Created a quote PDF template.",
                    "draft": {
                        "name": "Customer Quote PDF",
                        "description": "Customer-facing quote summary.",
                        "filename_pattern": "quote_{{ record['biz_quote.quote_number'] }}",
                        "html": (
                            "<h1>Quote {{ record['biz_quote.quote_number'] }}</h1>"
                            "<p>{{ record['biz_quote.customer_name'] }}</p>"
                            "<p>Total {{ record['biz_quote.grand_total'] }}</p>"
                        ),
                        "variables_schema": {"entity_id": "entity.biz_quote"},
                    },
                    "assumptions": [],
                    "warnings": [],
                }
            )

        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.object(main, "_artifact_ai_entities", lambda _request: copy.deepcopy(fake_entities)),
            patch.object(
                main,
                "_find_entity_def_global",
                lambda entity_id: copy.deepcopy(_quote_entity_def())
                if entity_id in {"entity.biz_quote", "biz_quote"}
                else {
                    "id": "entity.biz_job",
                    "label": "Job",
                    "fields": [{"id": "biz_job.job_number", "label": "Job Number", "type": "string"}],
                }
                if entity_id in {"entity.biz_job", "biz_job"}
                else None,
            ),
            patch.object(main, "_openai_chat_completion", fake_openai),
            patch.object(main, "_openai_configured", lambda: True),
        ):
            first_res = client.post(
                f"/documents/templates/{template_id}/ai/plan",
                json={"prompt": "Create a customer document template.", "draft": created["template"]},
            )
            second_res = client.post(
                f"/documents/templates/{template_id}/ai/plan",
                json={
                    "prompt": "Create a customer document template.",
                    "draft": created["template"],
                    "hints": {
                        "entity_id": "entity.biz_quote",
                        "selected_option_value": "entity.biz_quote",
                        "selected_option_label": "Quote",
                    },
                },
            )
        first_body = first_res.json()
        second_body = second_res.json()
        self.assertEqual(first_res.status_code, 200, first_body)
        self.assertEqual((first_body.get("required_question_meta") or {}).get("slot_kind"), "template_entity_choice")
        self.assertEqual(second_res.status_code, 200, second_body)
        self.assertIsNone(second_body.get("required_question_meta"))
        self.assertEqual(((second_body.get("draft") or {}).get("variables_schema") or {}).get("entity_id"), "entity.biz_quote")

        captured: dict[str, object] = {}

        def fake_render_pdf(html, paper_size, margins, header_html, footer_html):
            captured["html"] = html
            return b"%PDF-1.4\nquote\n%%EOF"

        def fake_store_bytes(_org_id, filename, data, mime_type="application/octet-stream"):
            captured["filename"] = filename
            return {"size": len(data or b""), "storage_key": "preview/quote.pdf", "sha256": "quote-preview"}

        with (
            patch.object(main, "_resolve_actor", lambda _request: _template_manager_actor()),
            patch.object(main, "render_pdf", fake_render_pdf),
            patch.object(main, "store_bytes", fake_store_bytes),
            patch.object(main, "_branding_context_for_org", lambda _org_id: {"workspace": {}, "company": {}, "branding": {}}),
        ):
            preview_res = client.post(
                f"/docs/templates/{template_id}/preview",
                json={
                    "draft": second_body["draft"],
                    "sample": {
                        "entity_id": "entity.biz_quote",
                        "record": {
                            "biz_quote.quote_number": "QUO-2026-4201",
                            "biz_quote.customer_name": "Tailspin",
                            "biz_quote.grand_total": "$2,450.00",
                        },
                    },
                },
            )
        preview_body = preview_res.json()
        self.assertEqual(preview_res.status_code, 200, preview_body)
        self.assertEqual(preview_body.get("filename"), "quote_QUO-2026-4201.pdf")
        self._assert_rendered_document_quality(
            html=str(captured.get("html") or ""),
            expected_tokens=["Tailspin", "QUO-2026-4201", "$2,450.00"],
        )

    def test_automation_notify_recipient_choice_follow_up_applies_selected_member_end_to_end(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            created = client.post(
                "/automations",
                json={
                    "name": "Quote Created Notify",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["biz_quotes.record.biz_quote.created"], "filters": []},
                    "steps": [
                        {
                            "id": "step_notify_seed",
                            "kind": "action",
                            "action_id": "system.notify",
                            "inputs": {"recipient_user_id": "user-admin", "title": "Placeholder", "body": "Placeholder"},
                        }
                    ],
                },
            ).json()
            automation_id = created["automation"]["id"]

        fake_meta = {
            "current_user_id": "user-admin",
            "entities": [
                {
                    "id": "entity.biz_quote",
                    "label": "Quote",
                    "fields": [{"id": "biz_quote.quote_number", "label": "Quote Number", "type": "string"}],
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
                {"user_id": "user-admin", "email": "admin@example.com"},
                {"user_id": "user-ops", "email": "ops@example.com"},
            ],
            "connections": [],
            "email_templates": [],
            "doc_templates": [],
        }

        def fake_openai(_messages, model=None, temperature=0.2, response_format=None):
            return _fake_response(
                {
                    "summary": "Notify the team when a quote is created.",
                    "draft": {
                        "name": "Quote Created Notify",
                        "description": "",
                        "trigger": {"kind": "event", "event_types": ["biz_quotes.record.biz_quote.created"], "filters": []},
                        "steps": [
                            {
                                "id": "step_notify",
                                "kind": "action",
                                "action_id": "system.notify",
                                "inputs": {
                                    "title": "New quote",
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

        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.object(main, "_artifact_ai_automation_meta", lambda request, actor: copy.deepcopy(fake_meta)),
            patch.object(
                main,
                "_ai_workspace_member_decision_options",
                lambda workspace_id, limit=8: [
                    {"id": "member:user-ops", "label": "Ops", "value": "ops@example.com", "hints": {"recipient_email": "ops@example.com"}},
                    {"id": "member:user-admin", "label": "Admin", "value": "admin@example.com", "hints": {"recipient_email": "admin@example.com"}},
                ],
            ),
            patch.object(main, "_openai_chat_completion", fake_openai),
            patch.object(main, "_openai_configured", lambda: True),
        ):
            first_res = client.post(
                f"/automations/{automation_id}/ai/plan",
                json={"prompt": "Send a notification when a quote is created.", "draft": created["automation"]},
            )
            second_res = client.post(
                f"/automations/{automation_id}/ai/plan",
                json={
                    "prompt": "Send a notification when a quote is created.",
                    "draft": created["automation"],
                    "hints": {
                        "recipient_email": "ops@example.com",
                        "selected_option_value": "ops@example.com",
                        "selected_option_label": "Ops",
                    },
                },
            )
        first_body = first_res.json()
        second_body = second_res.json()
        self.assertEqual(first_res.status_code, 200, first_body)
        self.assertEqual((first_body.get("required_question_meta") or {}).get("slot_kind"), "notify_recipient")
        self.assertEqual(second_res.status_code, 200, second_body)
        self.assertIsNone(second_body.get("required_question_meta"))
        step_inputs = ((((second_body.get("draft") or {}).get("steps") or [{}])[0]).get("inputs") or {})
        self.assertEqual(step_inputs.get("recipient_user_id"), "user-ops")
        self.assertEqual(step_inputs.get("recipient_user_ids"), ["user-ops"])

    def test_studio_agent_chat_repeated_field_changes_keep_single_modern_list_surface_end_to_end(self) -> None:
        client = TestClient(main.app)
        module_id = f"inventory_{uuid.uuid4().hex[:6]}"
        base_manifest = {
            "manifest_version": "1.3",
            "module": {"id": module_id, "name": "Inventory"},
            "app": {"home": "page:item.list_page", "nav": [{"group": "Main", "items": [{"label": "Items", "to": "page:item.list_page"}]}]},
            "entities": [
                {
                    "id": "entity.item",
                    "label": "Item",
                    "display_field": "item.name",
                    "fields": [
                        {"id": "item.code", "type": "string", "label": "Code"},
                        {"id": "item.name", "type": "string", "label": "Name"},
                    ],
                }
            ],
            "views": [
                {
                    "id": "item.list",
                    "kind": "list",
                    "entity": "entity.item",
                    "columns": [{"field_id": "item.code"}, {"field_id": "item.name"}],
                },
                {
                    "id": "item.form",
                    "kind": "form",
                    "entity": "entity.item",
                    "sections": [{"id": "main", "title": "Details", "fields": ["item.code", "item.name"]}],
                },
            ],
            "pages": [
                {
                    "id": "item.list_page",
                    "title": "Items",
                    "layout": "single",
                    "content": [{"id": "item_legacy_list", "kind": "view", "source": "view:item.list"}],
                },
                {
                    "id": "item.form_page",
                    "title": "Item",
                    "layout": "single",
                    "content": [{"kind": "record", "entity_id": "entity.item", "record_id_query": "record", "content": [{"kind": "view", "target": "view:item.form"}]}],
                },
            ],
            "actions": [{"id": "action.item_new", "kind": "create_record", "entity_id": "entity.item", "target": "page:item.form_page", "label": "New"}],
            "workflows": [],
        }
        main.drafts.upsert_draft(module_id, base_manifest, updated_by="test", base_snapshot_id=None)

        def fake_builder(messages, model=None, temperature=0.2, response_format=None):
            task_text = "\n".join(
                msg.get("content", "") for msg in (messages or []) if isinstance(msg, dict) and isinstance(msg.get("content"), str)
            ).lower()
            current = main.drafts.get_draft(module_id) or base_manifest
            entity = copy.deepcopy((current.get("entities") or [base_manifest["entities"][0]])[0])
            fields = copy.deepcopy(entity.get("fields") or [])
            if "preferred supplier" in task_text and not any(field.get("id") == "item.preferred_supplier" for field in fields):
                fields.append({"id": "item.preferred_supplier", "type": "string", "label": "Preferred Supplier"})
            if "buy price" in task_text and not any(field.get("id") == "item.buy_price" for field in fields):
                fields.append({"id": "item.buy_price", "type": "number", "label": "Buy Price"})
            entity["fields"] = fields
            return _fake_builder_response([{"tool": "ensure_entity", "module_id": module_id, "entity": entity}])

        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.object(main, "_openai_chat_completion", fake_builder),
            patch.object(main, "_openai_configured", lambda: True),
        ):
            first_res = client.post("/studio2/agent/chat", json={"module_id": module_id, "message": "add a preferred supplier field"})
            first_body = first_res.json()
            self.assertTrue(first_body.get("ok"), first_body)
            first_draft = (((first_body.get("data") or {}).get("drafts") or {}).get(module_id)) or {}
            main.drafts.upsert_draft(module_id, first_draft, updated_by="test", base_snapshot_id=None)

            second_res = client.post("/studio2/agent/chat", json={"module_id": module_id, "message": "also add a buy price field"})
        second_body = second_res.json()
        self.assertTrue(second_body.get("ok"), second_body)
        final_draft = (((second_body.get("data") or {}).get("drafts") or {}).get(module_id)) or {}
        normalized, errors, warnings = validate_manifest_raw(final_draft, expected_module_id=module_id)
        self.assertEqual(errors, [], {"warnings": warnings})
        self._assert_manifest_quality(normalized, primary_entity_id="entity.item")

        item_entity = next(entity for entity in (normalized.get("entities") or []) if entity.get("id") == "entity.item")
        field_ids = [field.get("id") for field in (item_entity.get("fields") or []) if isinstance(field, dict)]
        self.assertIn("item.preferred_supplier", field_ids)
        self.assertIn("item.buy_price", field_ids)

        list_page = next(page for page in (normalized.get("pages") or []) if page.get("id") == "item.list_page")
        content = list_page.get("content") or []
        self.assertEqual(len(content), 1, list_page)
        container = content[0] or {}
        self.assertEqual(container.get("kind"), "container", list_page)
        nested = ((container.get("content") or [None])[0]) or {}
        self.assertEqual(nested.get("kind"), "view_modes", list_page)
        blocks: list[dict] = []

        def walk(value):
            if isinstance(value, dict):
                blocks.append(value)
                for child in value.values():
                    walk(child)
            elif isinstance(value, list):
                for child in value:
                    walk(child)

        walk(list_page.get("content") or [])
        modern_surfaces = [block for block in blocks if isinstance(block, dict) and block.get("kind") == "view_modes"]
        legacy_surfaces = [
            block
            for block in blocks
            if isinstance(block, dict)
            and block.get("kind") == "view"
            and (block.get("source") == "view:item.list" or block.get("target") == "view:item.list")
        ]
        self.assertEqual(len(modern_surfaces), 1, list_page)
        self.assertEqual(legacy_surfaces, [], list_page)

    def test_octo_ai_session_follow_up_keeps_module_context_for_notification_plan_end_to_end(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            session = client.post("/octo-ai/sessions", json={"title": "Cooker build"}).json()["session"]

        captured_hints: list[dict] = []

        def fake_plan(_request, _session, message_text, explicit_scope=None, answer_hints=None):
            if isinstance(answer_hints, dict) and answer_hints:
                captured_hints.append(copy.deepcopy(answer_hints))
                recipient_value = answer_hints.get("recipient_email") or answer_hints.get("selected_option_value")
                return (
                    {
                        "scope": {"mode": "auto"},
                        "affected_artifacts": [],
                        "candidate_operations": [
                            {
                                "op": "create_module_record",
                                "module_id": "cooker",
                                "module": {"id": "cooker", "name": "Cooker"},
                            },
                            {
                                "op": "create_automation_record",
                                "artifact_type": "automation",
                                "automation": {
                                    "name": "Recipe created notification",
                                    "trigger": {"kind": "event", "event_types": ["cooker.record.cooker.created"], "filters": []},
                                    "steps": [
                                        {
                                            "kind": "action",
                                            "action_id": "system.notify",
                                            "inputs": {"recipient_email": recipient_value},
                                        }
                                    ],
                                    "status": "draft",
                                },
                            },
                        ],
                        "proposed_changes": [],
                        "assumptions": [],
                        "advisories": [],
                        "required_questions": ["Confirm this plan?"],
                        "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                        "risk_flags": [],
                        "planner_state": {"intent": "create_module_record", "requested_module_name": "Cooker"},
                        "resolved_without_changes": False,
                    },
                    {"status": "waiting_input", "affected_modules": []},
                )
            self.assertIn("cooker", message_text.lower())
            return (
                {
                    "scope": {"mode": "auto"},
                    "affected_artifacts": [],
                    "candidate_operations": [
                        {
                            "op": "create_module_record",
                            "module_id": "cooker",
                            "module": {"id": "cooker", "name": "Cooker"},
                        }
                    ],
                    "proposed_changes": [],
                    "assumptions": [],
                    "advisories": [],
                    "required_questions": ["Who should receive this notification?"],
                    "required_question_meta": {
                        "id": "notify_recipient",
                        "kind": "decision_slot",
                        "slot_kind": "notify_recipient",
                        "hint_field": "recipient_email",
                        "options": [
                            {
                                "id": "member:ops",
                                "label": "Ops",
                                "value": "ops@example.com",
                                "hints": {"recipient_email": "ops@example.com"},
                            }
                        ],
                    },
                    "decision_slots": [
                        {
                            "id": "notify_recipient",
                            "kind": "notify_recipient",
                            "prompt": "Who should receive this notification?",
                            "hint_field": "recipient_email",
                            "options": [
                                {
                                    "id": "member:ops",
                                    "label": "Ops",
                                    "value": "ops@example.com",
                                    "hints": {"recipient_email": "ops@example.com"},
                                }
                            ],
                        }
                    ],
                    "risk_flags": [],
                    "planner_state": {"intent": "create_module_record", "requested_module_name": "Cooker"},
                    "resolved_without_changes": False,
                },
                {"status": "waiting_input", "affected_modules": []},
            )

        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.object(main, "_ai_plan_from_message", side_effect=fake_plan),
        ):
            first_res = client.post(
                f"/octo-ai/sessions/{session['id']}/chat",
                json={"message": "Create me a new module called Cooker. Track recipes and ingredients and send a notification when I create a recipe."},
            )
            second_res = client.post(
                f"/octo-ai/sessions/{session['id']}/questions/answer",
                json={
                    "action": "custom",
                    "hints": {
                        "recipient_email": "ops@example.com",
                        "selected_option_value": "ops@example.com",
                        "selected_option_label": "Ops",
                    },
                },
            )
        first_body = first_res.json()
        second_body = second_res.json()
        self.assertEqual(first_res.status_code, 200, first_body)
        self.assertTrue(first_body.get("ok"), first_body)
        self.assertEqual(second_res.status_code, 200, second_body)
        self.assertEqual(captured_hints[-1].get("selected_option_value"), "ops@example.com")
        ops = [item for item in ((second_body.get("plan") or {}).get("candidate_operations") or []) if isinstance(item, dict)]
        self.assertEqual([item.get("op") for item in ops], ["create_module_record", "create_automation_record"])
        self._assert_candidate_plan_quality(ops)
        automation_op = ops[1]
        self._assert_automation_quality(
            automation_op.get("automation") or {},
            expected_action_ids=["system.notify"],
            expected_trigger_kind="event",
        )
        recipient = ((((automation_op.get("automation") or {}).get("steps") or [{}])[0]).get("inputs") or {}).get("recipient_email")
        self.assertEqual(recipient, "ops@example.com")
        self.assertEqual(((second_body.get("plan") or {}).get("required_question_meta") or {}).get("id"), "confirm_plan")

    def test_quote_accepted_runtime_sends_email_and_generates_document_end_to_end(self) -> None:
        email_store = MemoryEmailStore()
        doc_store = MemoryDocTemplateStore()
        connection_store = MemoryConnectionStore()
        attachment_store = MemoryAttachmentStore()
        automation_store = MemoryAutomationStore()
        job_store = MemoryJobStore()

        email_template = email_store.create_template(
            {
                "id": f"email_tpl_quote_accept_{uuid.uuid4().hex[:6]}",
                "workspace_id": "default",
                "name": "Quote Accepted",
                "subject": "Quote {{ record['biz_quote.quote_number'] }} accepted",
                "body_html": (
                    "<p>Dear {{ record['biz_quote.customer_name'] }},</p>"
                    "<p>Your quote total is {{ record['biz_quote.grand_total'] }}.</p>"
                ),
                "body_text": (
                    "Dear {{ record['biz_quote.customer_name'] }},\n\n"
                    "Your quote total is {{ record['biz_quote.grand_total'] }}."
                ),
            }
        )
        document_template = doc_store.create(
            {
                "id": f"doc_tpl_quote_accept_{uuid.uuid4().hex[:6]}",
                "workspace_id": "default",
                "name": "Quote Accepted PDF",
                "filename_pattern": "quote_{{ record['biz_quote.quote_number'] }}",
                "html": (
                    "<h1>Quote {{ record['biz_quote.quote_number'] }}</h1>"
                    "<p>{{ record['biz_quote.customer_name'] }}</p>"
                    "<p>Total {{ record['biz_quote.grand_total'] }}</p>"
                ),
                "paper_size": "A4",
            }
        )
        connection_store.create(
            {
                "id": "conn_default",
                "workspace_id": "default",
                "type": "smtp",
                "config": {"from_email": "quotes@example.com"},
            }
        )

        automation = automation_store.create(
            {
                "name": "Quote Accepted Fulfilment",
                "status": "published",
                "trigger": {"kind": "event", "event_types": ["biz_quotes.action.quote_mark_accepted.clicked"], "filters": []},
                "steps": [
                    {
                        "id": "step_send_email",
                        "kind": "action",
                        "action_id": "system.send_email",
                        "inputs": {
                            "entity_id": "entity.biz_quote",
                            "template_id": email_template["id"],
                            "to_field_ids": ["biz_quote.customer_email"],
                        },
                    },
                    {
                        "id": "step_generate_document",
                        "kind": "action",
                        "action_id": "system.generate_document",
                        "inputs": {
                            "entity_id": "entity.biz_quote",
                            "template_id": document_template["id"],
                            "purpose": "quote_pack",
                        },
                    },
                ],
            }
        )
        run = automation_store.create_run(
            {
                "automation_id": automation["id"],
                "status": "queued",
                "trigger_type": "biz_quotes.action.quote_mark_accepted.clicked",
                "trigger_payload": {
                    "event": "biz_quotes.action.quote_mark_accepted.clicked",
                    "entity_id": "entity.biz_quote",
                    "record_id": "quote_runtime_1",
                    "record": {
                        "flat": {
                            "biz_quote.quote_number": "QUO-2026-5101",
                            "biz_quote.customer_name": "Blue Yonder",
                            "biz_quote.customer_email": "buyer@example.com",
                            "biz_quote.grand_total": "$1,480.00",
                        }
                    },
                },
            }
        )

        record_store_state = {
            "entity.biz_quote": {
                "quote_runtime_1": {
                    "record": {
                        "id": "quote_runtime_1",
                        "biz_quote.quote_number": "QUO-2026-5101",
                        "biz_quote.customer_name": "Blue Yonder",
                        "biz_quote.customer_email": "buyer@example.com",
                        "biz_quote.grand_total": "$1,480.00",
                    }
                }
            }
        }

        class _FakeRecordStore:
            def get(self, entity_id, record_id):
                return copy.deepcopy((record_store_state.get(entity_id) or {}).get(record_id))

            def update(self, entity_id, record_id, updates):
                existing = (record_store_state.get(entity_id) or {}).get(record_id)
                if not existing:
                    return None
                existing["record"] = copy.deepcopy(updates)
                return copy.deepcopy(existing)

        rendered_doc: dict[str, object] = {}

        def fake_render_html(template_html, context):
            return main.render_template(template_html, context, strict=True)

        def fake_render_pdf(html, paper_size, margins, header_html, footer_html):
            rendered_doc["html"] = html
            rendered_doc["paper_size"] = paper_size
            rendered_doc["margins"] = copy.deepcopy(margins)
            return b"%PDF-1.4\nquote-runtime\n%%EOF"

        def fake_store_bytes(org_id, filename, data, mime_type="application/octet-stream"):
            rendered_doc["filename"] = filename
            rendered_doc["mime_type"] = mime_type
            return {"size": len(data or b""), "storage_key": f"{org_id}/{filename}", "sha256": "quote-runtime"}

        def fake_entity_resolver():
            return (
                lambda _registry, _snapshot_getter, entity_id: ("quotes", _quote_entity_def(), {})
                if entity_id in {"entity.biz_quote", "biz_quote"}
                else None
            )

        with (
            patch("app.worker.DbEmailStore", return_value=email_store),
            patch("app.worker.DbConnectionStore", return_value=connection_store),
            patch("app.worker.DbDocTemplateStore", return_value=doc_store),
            patch("app.worker.DbAttachmentStore", return_value=attachment_store),
            patch("app.worker.DbGenericRecordStore", return_value=_FakeRecordStore()),
            patch("app.worker._find_entity_def", return_value=_quote_entity_def()),
            patch("app.worker._get_entity_def_resolver", fake_entity_resolver),
            patch("app.worker._get_doc_render_helpers", lambda: (fake_render_html, fake_render_pdf, lambda margins: margins)),
            patch("app.worker._get_attachment_helpers", lambda: (fake_store_bytes, lambda *_args, **_kwargs: b"", lambda *_args, **_kwargs: None)),
            patch.object(main, "_branding_context_for_org", lambda _org_id: {"workspace": {}, "company": {}, "branding": {}}),
            patch.object(main, "_localization_context_for_actor", lambda _actor: {}),
        ):
            _run_automation({"payload": {"run_id": run["id"]}}, "default", automation_store=automation_store, job_store=job_store)
            doc_jobs = job_store.list("default", job_type="doc.generate")
            self.assertEqual(len(doc_jobs), 1, doc_jobs)
            _handle_doc_generate(doc_jobs[0], "default")

        run_after = automation_store.get_run(run["id"])
        self.assertEqual(run_after["status"], "succeeded", run_after)

        email_jobs = job_store.list("default", job_type="email.send")
        self.assertEqual(len(email_jobs), 1, email_jobs)
        outbox = email_store.get_outbox((email_jobs[0].get("payload") or {}).get("outbox_id"))
        self.assertIsInstance(outbox, dict)
        self.assertEqual(outbox.get("to"), ["buyer@example.com"])
        self.assertEqual(outbox.get("subject"), "Quote QUO-2026-5101 accepted")
        self._assert_rendered_email_quality(
            subject=outbox.get("subject", ""),
            html=outbox.get("body_html", ""),
            text=outbox.get("body_text", ""),
            expected_tokens=["Blue Yonder", "QUO-2026-5101", "$1,480.00"],
        )

        quote_links = [
            link
            for link in attachment_store._links.values()
            if isinstance(link, dict)
            and link.get("entity_id") == "entity.biz_quote"
            and link.get("record_id") == "quote_runtime_1"
        ]
        purposes = sorted(link.get("purpose") for link in quote_links if isinstance(link, dict))
        self.assertIn(f"template:{document_template['id']}", purposes)
        self.assertIn("quote_pack", purposes)
        self.assertEqual(rendered_doc.get("filename"), "quote_QUO-2026-5101.pdf")
        self._assert_rendered_document_quality(
            html=str(rendered_doc.get("html") or ""),
            expected_tokens=["Blue Yonder", "QUO-2026-5101", "$1,480.00"],
        )

    def test_octo_ai_session_confirm_applies_cross_artifact_stack_end_to_end(self) -> None:
        client = TestClient(main.app)
        module_id = f"quote_ops_{uuid.uuid4().hex[:6]}"
        email_id = f"email_tpl_quote_stack_{uuid.uuid4().hex[:6]}"
        doc_id = f"doc_tpl_quote_stack_{uuid.uuid4().hex[:6]}"
        automation_id = f"auto_quote_stack_{uuid.uuid4().hex[:6]}"
        sandbox_workspace_id = f"ws_quote_stack_{uuid.uuid4().hex[:6]}"
        module_manifest = {
            "manifest_version": "1.3",
            "module": {"id": module_id, "name": "Quote Operations"},
            "app": {
                "home": "page:quote.list_page",
                "nav": [{"group": "Main", "items": [{"label": "Quotes", "to": "page:quote.list_page"}]}],
            },
            "entities": [
                {
                    "id": "entity.quote_request",
                    "label": "Quote Request",
                    "display_field": "quote_request.name",
                    "fields": [
                        {"id": "quote_request.name", "type": "string", "label": "Name"},
                        {"id": "quote_request.customer_email", "type": "string", "label": "Customer Email"},
                        {"id": "quote_request.status", "type": "string", "label": "Status"},
                    ],
                }
            ],
            "views": [
                {
                    "id": "quote_request.list",
                    "kind": "list",
                    "entity": "entity.quote_request",
                    "columns": [{"field_id": "quote_request.name"}, {"field_id": "quote_request.status"}],
                },
                {
                    "id": "quote_request.form",
                    "kind": "form",
                    "entity": "entity.quote_request",
                    "sections": [{"id": "main", "title": "Details", "fields": ["quote_request.name", "quote_request.customer_email", "quote_request.status"]}],
                },
            ],
            "pages": [
                {
                    "id": "quote.list_page",
                    "title": "Quotes",
                    "layout": "single",
                    "content": [
                        {
                            "kind": "container",
                            "content": [
                                {
                                    "kind": "view_modes",
                                    "entity_id": "entity.quote_request",
                                    "default_mode": "list",
                                    "modes": [{"mode": "list", "target": "view:quote_request.list"}],
                                }
                            ],
                        }
                    ],
                },
                {
                    "id": "quote.form_page",
                    "title": "Quote",
                    "layout": "single",
                    "content": [{"kind": "record", "entity_id": "entity.quote_request", "record_id_query": "record", "content": [{"kind": "view", "target": "view:quote_request.form"}]}],
                },
            ],
            "actions": [{"id": "action.quote_request_new", "kind": "create_record", "entity_id": "entity.quote_request", "target": "page:quote.form_page", "label": "New"}],
            "workflows": [],
        }

        def fake_plan(_request, _session, _message_text, explicit_scope=None, answer_hints=None):
            candidate_ops = [
                {"op": "create_module", "artifact_type": "module", "artifact_id": module_id, "manifest": copy.deepcopy(module_manifest)},
                {
                    "op": "create_email_template_record",
                    "artifact_type": "email_template",
                    "artifact_id": email_id,
                    "email_template": {
                        "name": "Quote Accepted Customer Email",
                        "subject": "Quote {{ record['quote_request.name'] }} approved",
                        "body_html": "<p>Your quote is approved.</p>",
                        "body_text": "Your quote is approved.",
                        "variables_schema": {"entity_id": "entity.quote_request"},
                    },
                },
                {
                    "op": "create_document_template_record",
                    "artifact_type": "document_template",
                    "artifact_id": doc_id,
                    "document_template": {
                        "name": "Quote Summary PDF",
                        "filename_pattern": "quote-{{ record['quote_request.name'] }}",
                        "html": "<h1>{{ record['quote_request.name'] }}</h1>",
                        "paper_size": "A4",
                        "margin_top": "12mm",
                        "margin_right": "12mm",
                        "margin_bottom": "12mm",
                        "margin_left": "12mm",
                        "variables_schema": {"entity_id": "entity.quote_request"},
                    },
                },
                {
                    "op": "create_automation_record",
                    "artifact_type": "automation",
                    "artifact_id": automation_id,
                    "automation": {
                        "name": "Quote Accepted Customer Pack",
                        "status": "draft",
                        "trigger": {"kind": "event", "event_types": ["quote_request.status.approved"], "filters": []},
                        "steps": [
                            {
                                "id": "step_send_email",
                                "kind": "action",
                                "action_id": "system.send_email",
                                "inputs": {
                                    "entity_id": "entity.quote_request",
                                    "template_id": email_id,
                                    "to_field_ids": ["quote_request.customer_email"],
                                },
                            },
                            {
                                "id": "step_generate_document",
                                "kind": "action",
                                "action_id": "system.generate_document",
                                "inputs": {
                                    "entity_id": "entity.quote_request",
                                    "template_id": doc_id,
                                    "purpose": "quote_pack",
                                },
                            },
                        ],
                    },
                },
            ]
            confirm_plan = bool(isinstance(answer_hints, dict) and answer_hints.get("confirm_plan"))
            return (
                {
                    "scope": {"mode": explicit_scope or "auto"},
                    "affected_artifacts": [],
                    "affected_modules": [module_id],
                    "candidate_operations": candidate_ops,
                    "required_questions": [] if confirm_plan else ["Confirm this plan?"],
                    "required_question_meta": None
                    if confirm_plan
                    else {"id": "confirm_plan", "kind": "confirm_plan", "question": "Confirm this plan?"},
                    "resolved_without_changes": False,
                },
                {"status": "ready_to_apply" if confirm_plan else "waiting_input", "affected_modules": [module_id]},
            )

        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            session = client.post("/octo-ai/sessions", json={"title": "Quote stack"}).json()["session"]
        main._ai_update_record(
            main._AI_ENTITY_SESSION,
            session["id"],
            {"sandbox_workspace_id": sandbox_workspace_id, "sandbox_status": "active"},
        )

        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.object(main, "_ai_plan_from_message", side_effect=fake_plan),
        ):
            first_res = client.post(
                f"/octo-ai/sessions/{session['id']}/chat",
                json={"message": "Build a quote workflow with a module, customer email, PDF, and automation. Show me the plan first."},
            )
            approve_res = client.post(
                f"/octo-ai/sessions/{session['id']}/questions/answer",
                json={"action": "custom", "text": "Approved."},
            )

        first_body = first_res.json()
        approve_body = approve_res.json()
        self.assertEqual(first_res.status_code, 200, first_body)
        self.assertEqual(((first_body.get("plan") or {}).get("required_question_meta") or {}).get("id"), "confirm_plan")
        self.assertEqual(approve_res.status_code, 200, approve_body)
        approved_ops = [op for op in ((approve_body.get("plan") or {}).get("candidate_operations") or []) if isinstance(op, dict)]
        self.assertEqual(
            [op.get("op") for op in approved_ops],
            ["create_module", "create_email_template_record", "create_document_template_record", "create_automation_record"],
        )
        self._assert_candidate_plan_quality(approved_ops)

        patchset_res = client.post(f"/octo-ai/sessions/{session['id']}/patchsets/generate", json={})
        patchset_body = patchset_res.json()
        self.assertEqual(patchset_res.status_code, 200, patchset_body)
        patchset_id = ((patchset_body.get("patchset") or {}).get("id")) or ""
        self.assertTrue(patchset_id)

        apply_res = client.post(f"/octo-ai/patchsets/{patchset_id}/apply", json={"approved": True})
        apply_body = apply_res.json()
        self.assertEqual(apply_res.status_code, 200, apply_body)
        self.assertTrue(apply_body.get("ok"), apply_body)

        sandbox_request = SimpleNamespace(state=SimpleNamespace(cache={}, actor={}))
        with main._ai_ops_workspace_scope(sandbox_request, sandbox_workspace_id, {"workspace_id": sandbox_workspace_id}):
            sandbox_module = main._get_module(sandbox_request, module_id)
            sandbox_email = main.email_store.get_template(email_id)
            sandbox_doc = main.doc_template_store.get(doc_id)
            sandbox_automation = main.automation_store.get(automation_id)

        self.assertIsInstance(sandbox_module, dict)
        self.assertEqual(sandbox_module.get("module_id"), module_id)
        self.assertIsInstance(sandbox_email, dict)
        self.assertEqual((sandbox_email or {}).get("subject"), "Quote {{ record['quote_request.name'] }} approved")
        self.assertIsInstance(sandbox_doc, dict)
        self.assertEqual((sandbox_doc or {}).get("filename_pattern"), "quote-{{ record['quote_request.name'] }}")
        self._assert_automation_quality(
            sandbox_automation or {},
            expected_action_ids=["system.send_email", "system.generate_document"],
            expected_trigger_kind="event",
        )

    def test_octo_ai_session_confirm_applies_multi_module_handoff_bundle_end_to_end(self) -> None:
        client = TestClient(main.app)
        sandbox_workspace_id = f"ws_bundle_{uuid.uuid4().hex[:6]}"
        request_message = "Create Quotes and Jobs modules. When a Quote is approved, create a Job and carry the client name and due date across."

        def fake_plan(_request, _session, message_text, explicit_scope=None, answer_hints=None):
            bundle = main._ai_build_create_module_bundle(message_text, [], {}, answer_hints=answer_hints)
            candidate_ops = [op for op in (bundle.get("candidate_ops") or []) if isinstance(op, dict)]
            affected_modules = [item for item in (bundle.get("affected_modules") or []) if isinstance(item, str)]
            confirm_plan = bool(isinstance(answer_hints, dict) and answer_hints.get("confirm_plan"))
            return (
                {
                    "scope": {"mode": explicit_scope or "auto"},
                    "affected_artifacts": [],
                    "affected_modules": affected_modules,
                    "candidate_operations": candidate_ops,
                    "required_questions": [] if confirm_plan else ["Confirm this plan?"],
                    "required_question_meta": None
                    if confirm_plan
                    else {"id": "confirm_plan", "kind": "confirm_plan", "question": "Confirm this plan?"},
                    "resolved_without_changes": False,
                },
                {"status": "ready_to_apply" if confirm_plan else "waiting_input", "affected_modules": affected_modules},
            )

        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            session = client.post("/octo-ai/sessions", json={"title": "Quotes and Jobs"}).json()["session"]
        main._ai_update_record(
            main._AI_ENTITY_SESSION,
            session["id"],
            {"sandbox_workspace_id": sandbox_workspace_id, "sandbox_status": "active"},
        )

        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.object(main, "_ai_plan_from_message", side_effect=fake_plan),
        ):
            first_res = client.post(
                f"/octo-ai/sessions/{session['id']}/chat",
                json={"message": request_message},
            )
            approve_res = client.post(
                f"/octo-ai/sessions/{session['id']}/questions/answer",
                json={"action": "custom", "text": "Approved."},
            )

        first_body = first_res.json()
        approve_body = approve_res.json()
        self.assertEqual(first_res.status_code, 200, first_body)
        self.assertEqual(((first_body.get("plan") or {}).get("required_question_meta") or {}).get("id"), "confirm_plan")
        self.assertEqual(approve_res.status_code, 200, approve_body)
        approved_ops = [op for op in ((approve_body.get("plan") or {}).get("candidate_operations") or []) if isinstance(op, dict)]
        self._assert_candidate_plan_quality(approved_ops)
        create_module_ops = [op for op in approved_ops if op.get("op") == "create_module"]
        automation_ops = [op for op in approved_ops if op.get("op") == "create_automation_record"]
        self.assertEqual(len(create_module_ops), 2, approved_ops)
        self.assertTrue(automation_ops, approved_ops)

        patchset_res = client.post(f"/octo-ai/sessions/{session['id']}/patchsets/generate", json={})
        patchset_body = patchset_res.json()
        self.assertEqual(patchset_res.status_code, 200, patchset_body)
        patchset_id = ((patchset_body.get("patchset") or {}).get("id")) or ""
        self.assertTrue(patchset_id)

        apply_res = client.post(f"/octo-ai/patchsets/{patchset_id}/apply", json={"approved": True})
        apply_body = apply_res.json()
        self.assertEqual(apply_res.status_code, 200, apply_body)
        self.assertTrue(apply_body.get("ok"), apply_body)

        sandbox_request = SimpleNamespace(state=SimpleNamespace(cache={}, actor={}))
        with main._ai_ops_workspace_scope(sandbox_request, sandbox_workspace_id, {"workspace_id": sandbox_workspace_id}):
            created_modules = [main._get_module(sandbox_request, op.get("artifact_id")) for op in create_module_ops]
            created_automation = main.automation_store.get(automation_ops[0].get("artifact_id"))

        self.assertTrue(all(isinstance(item, dict) for item in created_modules), created_modules)
        self._assert_automation_quality(
            created_automation or {},
            expected_action_ids=["system.create_record"],
            expected_trigger_kind="event",
        )
        trigger_filters = ((created_automation.get("trigger") or {}).get("filters") or [])
        self.assertTrue(any(isinstance(item, dict) and item.get("path") == "entity_id" and item.get("value") == "entity.quote" for item in trigger_filters))
        self.assertTrue(any(isinstance(item, dict) and item.get("path") == "to" and item.get("value") == "approved" for item in trigger_filters))
        first_step = (((created_automation.get("steps") or [None])[0]) or {})
        self.assertEqual(first_step.get("action_id"), "system.create_record")
        inputs = first_step.get("inputs") or {}
        self.assertEqual(inputs.get("entity_id"), "entity.job")
        values = inputs.get("values") or {}
        self.assertEqual(values.get("job.source_quote_id"), "{{trigger.record_id}}")
        self.assertEqual(values.get("job.client_name"), "{{trigger.record.fields.quote.client_name}}")

    def test_studio_edit_keeps_existing_automation_and_template_artifacts_unchanged_end_to_end(self) -> None:
        client = TestClient(main.app)
        module_id = f"service_ops_{uuid.uuid4().hex[:6]}"

        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            email_created = client.post(
                "/email/templates",
                json={
                    "name": "Service Follow Up",
                    "subject": "Service update",
                    "body_html": "<p>Service update</p>",
                    "body_text": "Service update",
                    "variables_schema": {"entity_id": "entity.ticket"},
                },
            ).json()["template"]
            document_created = client.post(
                "/documents/templates",
                json={
                    "name": "Service Report",
                    "filename_pattern": "service-report",
                    "html": "<h1>Service Report</h1>",
                    "variables_schema": {"entity_id": "entity.ticket"},
                },
            ).json()["template"]
            automation_created = client.post(
                "/automations",
                json={
                    "name": "Service Follow Up Automation",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["service.ticket.closed"], "filters": []},
                    "steps": [
                        {
                            "id": "step_send_email",
                            "kind": "action",
                            "action_id": "system.send_email",
                            "inputs": {"entity_id": "entity.ticket", "template_id": email_created["id"], "to_field_ids": ["ticket.customer_email"]},
                        },
                        {
                            "id": "step_generate_document",
                            "kind": "action",
                            "action_id": "system.generate_document",
                            "inputs": {"entity_id": "entity.ticket", "template_id": document_created["id"], "purpose": "service_report"},
                        },
                    ],
                },
            ).json()["automation"]

        email_before = main.email_store.get_template(email_created["id"])
        document_before = main.doc_template_store.get(document_created["id"])
        automation_before = main.automation_store.get(automation_created["id"])

        base_manifest = {
            "manifest_version": "1.3",
            "module": {"id": module_id, "name": "Service Operations"},
            "app": {"home": "page:ticket.list_page", "nav": [{"group": "Main", "items": [{"label": "Tickets", "to": "page:ticket.list_page"}]}]},
            "entities": [
                {
                    "id": "entity.ticket",
                    "label": "Ticket",
                    "display_field": "ticket.subject",
                    "fields": [
                        {"id": "ticket.subject", "type": "string", "label": "Subject"},
                        {"id": "ticket.customer_email", "type": "string", "label": "Customer Email"},
                    ],
                }
            ],
            "views": [
                {
                    "id": "ticket.list",
                    "kind": "list",
                    "entity": "entity.ticket",
                    "columns": [{"field_id": "ticket.subject"}, {"field_id": "ticket.customer_email"}],
                },
                {
                    "id": "ticket.form",
                    "kind": "form",
                    "entity": "entity.ticket",
                    "sections": [{"id": "main", "title": "Details", "fields": ["ticket.subject", "ticket.customer_email"]}],
                },
            ],
            "pages": [
                {
                    "id": "ticket.list_page",
                    "title": "Tickets",
                    "layout": "single",
                    "content": [
                        {
                            "kind": "container",
                            "content": [
                                {
                                    "kind": "view_modes",
                                    "entity_id": "entity.ticket",
                                    "default_mode": "list",
                                    "modes": [{"mode": "list", "target": "view:ticket.list"}],
                                }
                            ],
                        }
                    ],
                },
                {
                    "id": "ticket.form_page",
                    "title": "Ticket",
                    "layout": "single",
                    "content": [{"kind": "record", "entity_id": "entity.ticket", "record_id_query": "record", "content": [{"kind": "view", "target": "view:ticket.form"}]}],
                },
            ],
            "actions": [{"id": "action.ticket_new", "kind": "create_record", "entity_id": "entity.ticket", "target": "page:ticket.form_page", "label": "New"}],
            "workflows": [],
        }
        main.drafts.upsert_draft(module_id, base_manifest, updated_by="test", base_snapshot_id=None)

        def fake_builder(_messages, model=None, temperature=0.2, response_format=None):
            entity = copy.deepcopy(base_manifest["entities"][0])
            entity["fields"].append({"id": "ticket.internal_priority", "type": "string", "label": "Internal Priority"})
            return _fake_builder_response([{"tool": "ensure_entity", "module_id": module_id, "entity": entity}])

        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.object(main, "_openai_chat_completion", fake_builder),
            patch.object(main, "_openai_configured", lambda: True),
        ):
            response = client.post("/studio2/agent/chat", json={"module_id": module_id, "message": "add an internal priority field"})

        body = response.json()
        self.assertTrue(body.get("ok"), body)
        self.assertEqual(((body.get("data") or {}).get("stop_reason")), "pass", body)
        draft = (((body.get("data") or {}).get("drafts") or {}).get(module_id)) or {}
        normalized, errors, warnings = validate_manifest_raw(draft, expected_module_id=module_id)
        self.assertEqual(errors, [], {"warnings": warnings})
        self._assert_manifest_quality(normalized, primary_entity_id="entity.ticket")

        ticket_entity = next(entity for entity in (normalized.get("entities") or []) if entity.get("id") == "entity.ticket")
        field_ids = [field.get("id") for field in (ticket_entity.get("fields") or []) if isinstance(field, dict)]
        self.assertIn("ticket.internal_priority", field_ids)

        email_after = main.email_store.get_template(email_created["id"])
        document_after = main.doc_template_store.get(document_created["id"])
        automation_after = main.automation_store.get(automation_created["id"])

        self.assertEqual((email_after or {}).get("subject"), (email_before or {}).get("subject"))
        self.assertEqual((document_after or {}).get("filename_pattern"), (document_before or {}).get("filename_pattern"))
        self.assertEqual(
            [step.get("inputs", {}).get("template_id") for step in ((automation_after or {}).get("steps") or []) if isinstance(step, dict)],
            [step.get("inputs", {}).get("template_id") for step in ((automation_before or {}).get("steps") or []) if isinstance(step, dict)],
        )

    def test_artifact_ai_planned_templates_feed_automation_runtime_end_to_end(self) -> None:
        client = TestClient(main.app)
        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            email_created = client.post(
                "/email/templates",
                json={
                    "name": "Quote Customer Email",
                    "description": "",
                    "subject": "Placeholder",
                    "body_html": "<p>Placeholder</p>",
                    "body_text": "Placeholder",
                    "variables_schema": {"entity_id": "entity.biz_quote"},
                },
            ).json()["template"]
            document_created = client.post(
                "/documents/templates",
                json={
                    "name": "Quote PDF",
                    "description": "",
                    "filename_pattern": "placeholder",
                    "html": "<p>Placeholder</p>",
                    "variables_schema": {"entity_id": "entity.biz_quote"},
                },
            ).json()["template"]
            automation_created = client.post(
                "/automations",
                json={
                    "name": "Quote Accepted Pack",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["biz_quotes.action.quote_mark_accepted.clicked"], "filters": []},
                    "steps": [
                        {
                            "id": "step_notify_owner",
                            "kind": "action",
                            "action_id": "system.notify",
                            "inputs": {"recipient_user_id": "user-1", "title": "Placeholder", "body": "Placeholder"},
                        }
                    ],
                },
            ).json()["automation"]

        fake_entities = [_quote_entity_def(), _quote_line_entity_def()]

        def fake_email_openai(_messages, model=None, temperature=0.2, response_format=None):
            return _fake_response(
                {
                    "summary": "Created a customer quote acceptance email.",
                    "draft": {
                        "name": "Quote Customer Email",
                        "description": "Send the customer a quote acceptance notice.",
                        "subject": "Quote {{ record['biz_quote.quote_number'] }} accepted",
                        "body_html": (
                            "<p>Dear {{ record['biz_quote.customer_name'] }},</p>"
                            "<p>Your quote total is {{ record['biz_quote.grand_total'] }}.</p>"
                        ),
                        "body_text": (
                            "Dear {{ record['biz_quote.customer_name'] }},\n\n"
                            "Your quote total is {{ record['biz_quote.grand_total'] }}."
                        ),
                        "variables_schema": {"entity_id": "entity.biz_quote"},
                    },
                    "assumptions": [],
                    "warnings": [],
                }
            )

        def fake_doc_openai(_messages, model=None, temperature=0.2, response_format=None):
            return _fake_response(
                {
                    "summary": "Created a quote summary PDF.",
                    "draft": {
                        "name": "Quote PDF",
                        "description": "Customer-facing accepted quote PDF.",
                        "filename_pattern": "quote_{{ record['biz_quote.quote_number'] }}",
                        "html": (
                            "<h1>Quote {{ record['biz_quote.quote_number'] }}</h1>"
                            "<p>{{ record['biz_quote.customer_name'] }}</p>"
                            "<p>Total {{ record['biz_quote.grand_total'] }}</p>"
                        ),
                        "variables_schema": {"entity_id": "entity.biz_quote"},
                    },
                    "assumptions": [],
                    "warnings": [],
                }
            )

        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.object(main, "_artifact_ai_entities", lambda _request: copy.deepcopy(fake_entities)),
            patch.object(main, "_openai_chat_completion", fake_email_openai),
            patch.object(main, "_openai_configured", lambda: True),
        ):
            email_plan_res = client.post(
                f"/email/templates/{email_created['id']}/ai/plan",
                json={"prompt": "Create a quote accepted email for customers.", "draft": email_created},
            )
        email_plan_body = email_plan_res.json()
        self.assertEqual(email_plan_res.status_code, 200, email_plan_body)
        self.assertTrue((email_plan_body.get("validation") or {}).get("compiled_ok"), email_plan_body)

        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.object(main, "_artifact_ai_entities", lambda _request: copy.deepcopy(fake_entities)),
            patch.object(main, "_openai_chat_completion", fake_doc_openai),
            patch.object(main, "_openai_configured", lambda: True),
        ):
            doc_plan_res = client.post(
                f"/documents/templates/{document_created['id']}/ai/plan",
                json={"prompt": "Create a quote accepted PDF for customers.", "draft": document_created},
            )
        doc_plan_body = doc_plan_res.json()
        self.assertEqual(doc_plan_res.status_code, 200, doc_plan_body)
        self.assertTrue((doc_plan_body.get("validation") or {}).get("compiled_ok"), doc_plan_body)

        updated_email = main.email_store.update_template(email_created["id"], email_plan_body["draft"])
        updated_document = main.doc_template_store.update(document_created["id"], doc_plan_body["draft"])
        self.assertIsInstance(updated_email, dict)
        self.assertIsInstance(updated_document, dict)

        fake_meta = {
            "current_user_id": "user-1",
            "event_catalog": [
                {
                    "id": "biz_quotes.action.quote_mark_accepted.clicked",
                    "label": "Quote accepted",
                    "event": "action.clicked",
                    "entity_id": "entity.biz_quote",
                }
            ],
            "event_types": ["biz_quotes.action.quote_mark_accepted.clicked"],
            "system_actions": [
                {"id": "system.send_email", "label": "Send email"},
                {"id": "system.generate_document", "label": "Generate document"},
            ],
            "module_actions": [],
            "entities": copy.deepcopy(fake_entities),
            "members": [{"user_id": "user-1", "email": "admin@example.com"}],
            "connections": [],
            "email_templates": [copy.deepcopy(updated_email)],
            "doc_templates": [copy.deepcopy(updated_document)],
        }

        def fake_automation_openai(_messages, model=None, temperature=0.2, response_format=None):
            return _fake_response(
                {
                    "summary": "Email the customer and generate the quote PDF when accepted.",
                    "draft": {
                        "name": "Quote Accepted Pack",
                        "description": "",
                        "trigger": {"kind": "event", "event_types": ["biz_quotes.action.quote_mark_accepted.clicked"], "filters": []},
                        "steps": [
                            {
                                "id": "step_send_email",
                                "kind": "action",
                                "action_id": "system.send_email",
                                "inputs": {
                                    "entity_id": "entity.biz_quote",
                                    "template_id": email_created["id"],
                                    "to_field_ids": ["biz_quote.customer_email"],
                                },
                            },
                            {
                                "id": "step_generate_document",
                                "kind": "action",
                                "action_id": "system.generate_document",
                                "inputs": {
                                    "entity_id": "entity.biz_quote",
                                    "template_id": document_created["id"],
                                    "purpose": "quote_pack",
                                },
                            },
                        ],
                        "status": "draft",
                    },
                    "assumptions": [],
                    "warnings": [],
                }
            )

        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.object(main, "_artifact_ai_automation_meta", lambda request, actor: copy.deepcopy(fake_meta)),
            patch.object(main, "_openai_chat_completion", fake_automation_openai),
            patch.object(main, "_openai_configured", lambda: True),
        ):
            automation_plan_res = client.post(
                f"/automations/{automation_created['id']}/ai/plan",
                json={"prompt": "When a quote is accepted, email the customer and attach a PDF.", "draft": automation_created},
            )
        automation_plan_body = automation_plan_res.json()
        self.assertEqual(automation_plan_res.status_code, 200, automation_plan_body)
        self.assertTrue((automation_plan_body.get("validation") or {}).get("compiled_ok"), automation_plan_body)

        email_store = MemoryEmailStore()
        doc_store = MemoryDocTemplateStore()
        connection_store = MemoryConnectionStore()
        attachment_store = MemoryAttachmentStore()
        automation_store = MemoryAutomationStore()
        job_store = MemoryJobStore()

        email_store.create_template({**email_plan_body["draft"], "id": email_created["id"], "workspace_id": "default"})
        doc_store.create({**doc_plan_body["draft"], "id": document_created["id"], "workspace_id": "default"})
        connection_store.create(
            {
                "id": "conn_default",
                "workspace_id": "default",
                "type": "smtp",
                "config": {"from_email": "quotes@example.com"},
            }
        )
        automation = automation_store.create({**automation_plan_body["draft"], "id": automation_created["id"], "status": "published"})
        run = automation_store.create_run(
            {
                "automation_id": automation["id"],
                "status": "queued",
                "trigger_type": "biz_quotes.action.quote_mark_accepted.clicked",
                "trigger_payload": {
                    "event": "biz_quotes.action.quote_mark_accepted.clicked",
                    "entity_id": "entity.biz_quote",
                    "record_id": "quote_e2e_1",
                    "record": {
                        "flat": {
                            "biz_quote.quote_number": "QUO-2026-6201",
                            "biz_quote.customer_name": "Acme Foods",
                            "biz_quote.customer_email": "buyer@example.com",
                            "biz_quote.grand_total": "$1,920.00",
                        }
                    },
                },
            }
        )

        record_store_state = {
            "entity.biz_quote": {
                "quote_e2e_1": {
                    "record": {
                        "id": "quote_e2e_1",
                        "biz_quote.quote_number": "QUO-2026-6201",
                        "biz_quote.customer_name": "Acme Foods",
                        "biz_quote.customer_email": "buyer@example.com",
                        "biz_quote.grand_total": "$1,920.00",
                    }
                }
            }
        }

        class _FakeRecordStore:
            def get(self, entity_id, record_id):
                return copy.deepcopy((record_store_state.get(entity_id) or {}).get(record_id))

            def update(self, entity_id, record_id, updates):
                existing = (record_store_state.get(entity_id) or {}).get(record_id)
                if not existing:
                    return None
                existing["record"] = copy.deepcopy(updates)
                return copy.deepcopy(existing)

        rendered_doc: dict[str, object] = {}

        def fake_render_html(template_html, context):
            return main.render_template(template_html, context, strict=True)

        def fake_render_pdf(html, paper_size, margins, header_html, footer_html):
            rendered_doc["html"] = html
            rendered_doc["paper_size"] = paper_size
            return b"%PDF-1.4\nplanned-stack\n%%EOF"

        def fake_store_bytes(org_id, filename, data, mime_type="application/octet-stream"):
            rendered_doc["filename"] = filename
            return {"size": len(data or b""), "storage_key": f"{org_id}/{filename}", "sha256": "planned-stack"}

        with (
            patch("app.worker.DbEmailStore", return_value=email_store),
            patch("app.worker.DbConnectionStore", return_value=connection_store),
            patch("app.worker.DbDocTemplateStore", return_value=doc_store),
            patch("app.worker.DbAttachmentStore", return_value=attachment_store),
            patch("app.worker.DbGenericRecordStore", return_value=_FakeRecordStore()),
            patch("app.worker._find_entity_def", return_value=_quote_entity_def()),
            patch("app.worker._get_doc_render_helpers", lambda: (fake_render_html, fake_render_pdf, lambda margins: margins)),
            patch("app.worker._get_attachment_helpers", lambda: (fake_store_bytes, lambda *_args, **_kwargs: b"", lambda *_args, **_kwargs: None)),
            patch.object(main, "_branding_context_for_org", lambda _org_id: {"workspace": {}, "company": {}, "branding": {}}),
            patch.object(main, "_localization_context_for_actor", lambda _actor: {}),
        ):
            _run_automation({"payload": {"run_id": run["id"]}}, "default", automation_store=automation_store, job_store=job_store)
            doc_jobs = job_store.list("default", job_type="doc.generate")
            self.assertEqual(len(doc_jobs), 1, doc_jobs)
            _handle_doc_generate(doc_jobs[0], "default")

        run_after = automation_store.get_run(run["id"])
        self.assertEqual(run_after["status"], "succeeded", run_after)
        email_jobs = job_store.list("default", job_type="email.send")
        self.assertEqual(len(email_jobs), 1, email_jobs)
        outbox = email_store.get_outbox((email_jobs[0].get("payload") or {}).get("outbox_id"))
        self.assertIsInstance(outbox, dict)
        self.assertEqual(outbox.get("to"), ["buyer@example.com"])
        self.assertEqual(outbox.get("subject"), "Quote QUO-2026-6201 accepted")
        self._assert_rendered_email_quality(
            subject=outbox.get("subject", ""),
            html=outbox.get("body_html", ""),
            text=outbox.get("body_text", ""),
            expected_tokens=["Acme Foods", "QUO-2026-6201", "$1,920.00"],
        )
        self.assertEqual(rendered_doc.get("filename"), "quote_QUO-2026-6201.pdf")
        self._assert_rendered_document_quality(
            html=str(rendered_doc.get("html") or ""),
            expected_tokens=["Acme Foods", "QUO-2026-6201", "$1,920.00"],
        )

    def test_studio_edit_upgrades_placeholder_home_and_form_shell_while_preserving_artifacts_end_to_end(self) -> None:
        client = TestClient(main.app)
        module_id = f"service_desk_{uuid.uuid4().hex[:6]}"

        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            email_created = client.post(
                "/email/templates",
                json={
                    "name": "Ticket Update",
                    "subject": "Ticket update",
                    "body_html": "<p>Ticket update</p>",
                    "body_text": "Ticket update",
                    "variables_schema": {"entity_id": "entity.ticket"},
                },
            ).json()["template"]
            document_created = client.post(
                "/documents/templates",
                json={
                    "name": "Ticket Report",
                    "filename_pattern": "ticket-report",
                    "html": "<h1>Ticket Report</h1>",
                    "variables_schema": {"entity_id": "entity.ticket"},
                },
            ).json()["template"]
            automation_created = client.post(
                "/automations",
                json={
                    "name": "Ticket Follow Up Automation",
                    "description": "",
                    "trigger": {"kind": "event", "event_types": ["service.ticket.closed"], "filters": []},
                    "steps": [
                        {
                            "id": "step_send_email",
                            "kind": "action",
                            "action_id": "system.send_email",
                            "inputs": {"entity_id": "entity.ticket", "template_id": email_created["id"], "to_field_ids": ["ticket.customer_email"]},
                        },
                        {
                            "id": "step_generate_document",
                            "kind": "action",
                            "action_id": "system.generate_document",
                            "inputs": {"entity_id": "entity.ticket", "template_id": document_created["id"], "purpose": "service_report"},
                        },
                    ],
                },
            ).json()["automation"]

        email_before = main.email_store.get_template(email_created["id"])
        document_before = main.doc_template_store.get(document_created["id"])
        automation_before = main.automation_store.get(automation_created["id"])

        base_manifest = {
            "manifest_version": "1.3",
            "module": {"id": module_id, "name": "Service Desk"},
            "app": {"home": "page:home", "nav": [{"group": "Main", "items": [{"label": "Home", "to": "page:home"}]}]},
            "entities": [
                {
                    "id": "entity.ticket",
                    "label": "Ticket",
                    "display_field": "ticket.subject",
                    "fields": [
                        {"id": "ticket.subject", "type": "string", "label": "Subject"},
                        {"id": "ticket.status", "type": "enum", "label": "Status", "options": ["open", "closed"]},
                        {"id": "ticket.customer_email", "type": "string", "label": "Customer Email"},
                        {"id": "ticket.attachments", "type": "attachments", "label": "Attachments"},
                        {"id": "ticket.due_date", "type": "date", "label": "Due Date"},
                    ],
                }
            ],
            "views": [
                {
                    "id": "ticket.list",
                    "kind": "list",
                    "entity": "entity.ticket",
                    "columns": [{"field_id": "ticket.subject"}, {"field_id": "ticket.status"}],
                },
                {
                    "id": "ticket.form",
                    "kind": "form",
                    "entity": "entity.ticket",
                    "sections": [
                        {
                            "id": "main",
                            "title": "Details",
                            "fields": ["ticket.subject", "ticket.status", "ticket.customer_email", "ticket.attachments", "ticket.due_date"],
                        }
                    ],
                },
            ],
            "pages": [
                {"id": "home", "title": "Home", "layout": "single", "content": []},
                {"id": "ticket.list_page", "title": "Tickets", "layout": "single", "content": [{"kind": "view", "source": "view:ticket.list"}]},
                {
                    "id": "ticket.form_page",
                    "title": "Ticket",
                    "layout": "single",
                    "content": [
                        {
                            "kind": "record",
                            "entity_id": "entity.ticket",
                            "record_id_query": "record",
                            "content": [{"kind": "view", "target": "view:ticket.form"}],
                        }
                    ],
                },
            ],
            "actions": [{"id": "action.ticket_new", "kind": "create_record", "entity_id": "entity.ticket", "target": "page:ticket.form_page", "label": "New"}],
            "workflows": [],
        }
        main.drafts.upsert_draft(module_id, base_manifest, updated_by="test", base_snapshot_id=None)

        def fake_builder(_messages, model=None, temperature=0.2, response_format=None):
            entity = copy.deepcopy(base_manifest["entities"][0])
            entity["fields"].append({"id": "ticket.priority", "type": "string", "label": "Priority"})
            return _fake_builder_response([{"tool": "ensure_entity", "module_id": module_id, "entity": entity}])

        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.object(main, "_openai_chat_completion", fake_builder),
            patch.object(main, "_openai_configured", lambda: True),
        ):
            response = client.post("/studio2/agent/chat", json={"module_id": module_id, "message": "add a priority field"})

        body = response.json()
        self.assertTrue(body.get("ok"), body)
        self.assertEqual(((body.get("data") or {}).get("stop_reason")), "pass", body)
        draft = (((body.get("data") or {}).get("drafts") or {}).get(module_id)) or {}
        normalized, errors, warnings = validate_manifest_raw(draft, expected_module_id=module_id)
        self.assertEqual(errors, [], {"warnings": warnings})
        self._assert_manifest_quality(normalized, primary_entity_id="entity.ticket")

        app_config = normalized.get("app") or {}
        self.assertEqual(app_config.get("home"), "page:ticket.list_page")
        nav_items = []
        for group in (app_config.get("nav") or []):
            if isinstance(group, dict):
                nav_items.extend(group.get("items") or [])
        self.assertTrue(any(isinstance(item, dict) and item.get("to") == "page:ticket.list_page" for item in nav_items), nav_items)
        self.assertFalse(any(isinstance(item, dict) and item.get("to") == "page:home" for item in nav_items), nav_items)

        page_by_id = {page.get("id"): page for page in (normalized.get("pages") or []) if isinstance(page, dict)}
        form_page = page_by_id["ticket.form_page"]
        form_record = ((form_page.get("content") or [None])[0]) or {}
        self.assertEqual(form_record.get("kind"), "record")
        grid = ((form_record.get("content") or [None])[0]) or {}
        self.assertEqual(grid.get("kind"), "grid")
        grid_items = grid.get("items") or []
        self.assertEqual([item.get("span") for item in grid_items if isinstance(item, dict)][:2], [8, 4], grid_items)
        chatter = (((((grid_items[1] or {}).get("content") or [None])[0] or {}).get("content") or [None])[0]) or {}
        self.assertEqual(chatter.get("kind"), "chatter")
        self.assertEqual(chatter.get("entity_id"), "entity.ticket")

        form_view = next(view for view in (normalized.get("views") or []) if isinstance(view, dict) and view.get("id") == "ticket.form")
        activity = form_view.get("activity") or {}
        self.assertTrue(activity.get("enabled"))
        self.assertTrue(activity.get("allow_attachments"))
        self.assertIn("ticket.status", activity.get("tracked_fields") or [])
        self.assertIn("ticket.due_date", activity.get("tracked_fields") or [])

        email_after = main.email_store.get_template(email_created["id"])
        document_after = main.doc_template_store.get(document_created["id"])
        automation_after = main.automation_store.get(automation_created["id"])
        self.assertEqual((email_after or {}).get("subject"), (email_before or {}).get("subject"))
        self.assertEqual((document_after or {}).get("filename_pattern"), (document_before or {}).get("filename_pattern"))
        self.assertEqual(
            [step.get("inputs", {}).get("template_id") for step in ((automation_after or {}).get("steps") or []) if isinstance(step, dict)],
            [step.get("inputs", {}).get("template_id") for step in ((automation_before or {}).get("steps") or []) if isinstance(step, dict)],
        )

    def test_octo_ai_recipe_stack_apply_keeps_family_aware_surfaces_and_companion_templates_end_to_end(self) -> None:
        client = TestClient(main.app)
        sandbox_workspace_id = f"ws_recipe_stack_{uuid.uuid4().hex[:6]}"
        request_message = "Create a module called Kitchen Recipes to track recipes and ingredients as line items. Also create a printable recipe card and a recipe sharing email."

        bundle = main._ai_build_create_module_bundle(request_message, [], {})
        candidate_ops = [copy.deepcopy(op) for op in (bundle.get("candidate_ops") or []) if isinstance(op, dict)]
        create_module_op = next(op for op in candidate_ops if op.get("op") == "create_module")
        module_manifest = copy.deepcopy(create_module_op.get("manifest") or {})
        module_id = create_module_op.get("artifact_id")
        recipe_entity = next(entity for entity in (module_manifest.get("entities") or []) if isinstance(entity, dict) and isinstance(entity.get("id"), str) and entity.get("id").startswith("entity."))
        entity_id = recipe_entity["id"]
        entity_slug = entity_id[7:]
        email_id = f"email_tpl_recipe_stack_{uuid.uuid4().hex[:6]}"
        doc_id = f"doc_tpl_recipe_stack_{uuid.uuid4().hex[:6]}"

        candidate_ops.extend(
            [
                {
                    "op": "create_email_template_record",
                    "artifact_type": "email_template",
                    "artifact_id": email_id,
                    "email_template": {
                        "name": "Recipe Sharing Email",
                        "subject": "Recipe {{ record['%s.name'] }} ready to share" % entity_slug,
                        "body_html": "<p>{{ record['%s.name'] }}</p>" % entity_slug,
                        "body_text": "{{ record['%s.name'] }}" % entity_slug,
                        "variables_schema": {"entity_id": entity_id},
                    },
                },
                {
                    "op": "create_document_template_record",
                    "artifact_type": "document_template",
                    "artifact_id": doc_id,
                    "document_template": {
                        "name": "Recipe Card",
                        "filename_pattern": "recipe-{{ record['%s.name'] }}" % entity_slug,
                        "html": "<h1>{{ record['%s.name'] }}</h1>" % entity_slug,
                        "paper_size": "A4",
                        "variables_schema": {"entity_id": entity_id},
                    },
                },
            ]
        )

        def fake_plan(_request, _session, _message_text, explicit_scope=None, answer_hints=None):
            confirm_plan = bool(isinstance(answer_hints, dict) and answer_hints.get("confirm_plan"))
            return (
                {
                    "scope": {"mode": explicit_scope or "auto"},
                    "affected_artifacts": [],
                    "affected_modules": [module_id],
                    "candidate_operations": copy.deepcopy(candidate_ops),
                    "required_questions": [] if confirm_plan else ["Confirm this plan?"],
                    "required_question_meta": None
                    if confirm_plan
                    else {"id": "confirm_plan", "kind": "confirm_plan", "question": "Confirm this plan?"},
                    "resolved_without_changes": False,
                },
                {"status": "ready_to_apply" if confirm_plan else "waiting_input", "affected_modules": [module_id]},
            )

        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            session = client.post("/octo-ai/sessions", json={"title": "Kitchen Recipes"}).json()["session"]
        main._ai_update_record(
            main._AI_ENTITY_SESSION,
            session["id"],
            {"sandbox_workspace_id": sandbox_workspace_id, "sandbox_status": "active"},
        )

        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.object(main, "_ai_plan_from_message", side_effect=fake_plan),
        ):
            first_res = client.post(f"/octo-ai/sessions/{session['id']}/chat", json={"message": request_message})
            approve_res = client.post(f"/octo-ai/sessions/{session['id']}/questions/answer", json={"action": "custom", "text": "Approved."})

        first_body = first_res.json()
        approve_body = approve_res.json()
        self.assertEqual(first_res.status_code, 200, first_body)
        self.assertEqual(((first_body.get("plan") or {}).get("required_question_meta") or {}).get("id"), "confirm_plan")
        self.assertEqual(approve_res.status_code, 200, approve_body)
        self._assert_candidate_plan_quality(
            [op for op in ((approve_body.get("plan") or {}).get("candidate_operations") or []) if isinstance(op, dict)]
        )

        patchset_res = client.post(f"/octo-ai/sessions/{session['id']}/patchsets/generate", json={})
        patchset_body = patchset_res.json()
        self.assertEqual(patchset_res.status_code, 200, patchset_body)
        patchset_id = ((patchset_body.get("patchset") or {}).get("id")) or ""
        self.assertTrue(patchset_id)

        apply_res = client.post(f"/octo-ai/patchsets/{patchset_id}/apply", json={"approved": True})
        apply_body = apply_res.json()
        self.assertEqual(apply_res.status_code, 200, apply_body)
        self.assertTrue(apply_body.get("ok"), apply_body)

        sandbox_request = SimpleNamespace(state=SimpleNamespace(cache={}, actor={}))
        with main._ai_ops_workspace_scope(sandbox_request, sandbox_workspace_id, {"workspace_id": sandbox_workspace_id}):
            sandbox_module = main._get_module(sandbox_request, module_id)
            _sandbox_module_row, installed_manifest = main._get_installed_manifest(sandbox_request, module_id)
            sandbox_email = main.email_store.get_template(email_id)
            sandbox_doc = main.doc_template_store.get(doc_id)

        self.assertIsInstance(sandbox_module, dict)
        self.assertIsInstance(sandbox_email, dict)
        self.assertIsInstance(sandbox_doc, dict)
        self.assertEqual(((sandbox_email or {}).get("variables_schema") or {}).get("entity_id"), entity_id)
        self.assertEqual(((sandbox_doc or {}).get("variables_schema") or {}).get("entity_id"), entity_id)

        manifest = installed_manifest or {}
        self._assert_manifest_quality(manifest, primary_entity_id=entity_id)
        app_config = manifest.get("app") or {}
        self.assertEqual(app_config.get("home"), f"page:{entity_slug}.list_page")
        nav_items = []
        for group in (app_config.get("nav") or []):
            if isinstance(group, dict):
                nav_items.extend(group.get("items") or [])
        self.assertTrue(any(isinstance(item, dict) and item.get("to") == f"page:{entity_slug}.list_page" for item in nav_items), nav_items)
        self.assertFalse(any(isinstance(item, dict) and item.get("to") == "page:home" for item in nav_items), nav_items)

        views = [view for view in (manifest.get("views") or []) if isinstance(view, dict)]
        view_by_id = {view.get("id"): view for view in views if isinstance(view.get("id"), str)}
        list_view = view_by_id.get(f"{entity_slug}.list") or {}
        kanban_view = view_by_id.get(f"{entity_slug}.kanban") or {}
        form_view = view_by_id.get(f"{entity_slug}.form") or {}

        pages = {page.get("id"): page for page in (manifest.get("pages") or []) if isinstance(page, dict)}
        list_page = pages.get(f"{entity_slug}.list_page") or {}
        view_modes = main._manifest_find_first_view_modes_block(list_page.get("content")) or {}
        modes = [item.get("mode") for item in (view_modes.get("modes") or []) if isinstance(item, dict)]
        self.assertEqual(view_modes.get("default_mode"), "kanban")
        self.assertIn("kanban", modes)
        self.assertNotIn("calendar", modes)

        list_columns = [item.get("field_id") for item in (list_view.get("columns") or []) if isinstance(item, dict)]
        self.assertTrue(any(field_id and field_id.endswith(".meal_type") for field_id in list_columns), list_columns)
        self.assertTrue(any(field_id and field_id.endswith(".cuisine") for field_id in list_columns), list_columns)
        subtitle_fields = (((kanban_view.get("card") or {}).get("subtitle_fields")) or [])
        self.assertTrue(any(field_id and field_id.endswith(".meal_type") for field_id in subtitle_fields), subtitle_fields)
        self.assertTrue(any(field_id and field_id.endswith(".cuisine") for field_id in subtitle_fields), subtitle_fields)
        badge_fields = (((kanban_view.get("card") or {}).get("badge_fields")) or [])
        self.assertTrue(
            any(
                field_id and (
                    field_id.endswith(".servings")
                    or field_id.endswith(".meal_type")
                    or field_id.endswith(".cuisine")
                )
                for field_id in badge_fields
            ),
            badge_fields,
        )
        self.assertFalse(any(field_id and field_id.endswith(".status") for field_id in badge_fields), badge_fields)
        bulk_actions = (((list_view.get("header") or {}).get("bulk_actions")) or [])
        bulk_action_ids = [item.get("action_id") for item in bulk_actions if isinstance(item, dict)]
        self.assertTrue(
            any(isinstance(action_id, str) and action_id.startswith(f"action.{entity_slug}_bulk_") for action_id in bulk_action_ids),
            bulk_action_ids,
        )
        search_cfg = ((list_view.get("header") or {}).get("search")) or {}
        self.assertTrue(search_cfg.get("enabled"))
        search_fields = search_cfg.get("fields") or []
        self.assertTrue(any(field_id and field_id.endswith(".name") for field_id in search_fields), search_fields)
        self.assertTrue(any(field_id and field_id.endswith(".meal_type") for field_id in search_fields), search_fields)
        self.assertTrue(((form_view.get("activity") or {}).get("enabled")))

    def test_octo_ai_trade_services_architecture_bundle_applies_coherent_self_serve_rollout_end_to_end(self) -> None:
        client = TestClient(main.app)
        sandbox_workspace_id = f"ws_trade_services_{uuid.uuid4().hex[:6]}"
        sales_module_id = f"sales_{uuid.uuid4().hex[:6]}"
        jobs_module_id = f"jobs_{uuid.uuid4().hex[:6]}"
        billing_module_id = f"billing_{uuid.uuid4().hex[:6]}"
        reminder_email_id = f"email_tpl_overdue_{uuid.uuid4().hex[:6]}"
        completion_doc_id = f"doc_tpl_completion_{uuid.uuid4().hex[:6]}"
        quote_handoff_id = f"auto_quote_handoff_{uuid.uuid4().hex[:6]}"
        job_pack_id = f"auto_job_pack_{uuid.uuid4().hex[:6]}"
        invoice_reminder_id = f"auto_invoice_reminder_{uuid.uuid4().hex[:6]}"

        sales_manifest = {
            "manifest_version": "1.3",
            "module": {"id": sales_module_id, "name": "Sales"},
            "app": {
                "home": "page:trade_quote.list_page",
                "nav": [{"group": "Main", "items": [{"label": "Quotes", "to": "page:trade_quote.list_page"}]}],
            },
            "entities": [
                {
                    "id": "entity.trade_quote",
                    "label": "Quote",
                    "display_field": "trade_quote.number",
                    "fields": [
                        {"id": "trade_quote.number", "type": "string", "label": "Quote Number"},
                        {"id": "trade_quote.customer_name", "type": "string", "label": "Customer Name"},
                        {"id": "trade_quote.customer_email", "type": "string", "label": "Customer Email"},
                        {"id": "trade_quote.status", "type": "string", "label": "Status"},
                    ],
                }
            ],
            "views": [
                {"id": "trade_quote.list", "kind": "list", "entity": "entity.trade_quote", "columns": [{"field_id": "trade_quote.number"}, {"field_id": "trade_quote.customer_name"}, {"field_id": "trade_quote.status"}]},
                {"id": "trade_quote.form", "kind": "form", "entity": "entity.trade_quote", "sections": [{"id": "main", "title": "Details", "fields": ["trade_quote.number", "trade_quote.customer_name", "trade_quote.customer_email", "trade_quote.status"]}]},
            ],
            "pages": [
                {"id": "trade_quote.list_page", "title": "Quotes", "header": {"variant": "none"}, "layout": "single", "content": [{"kind": "container", "variant": "card", "content": [{"kind": "view_modes", "entity_id": "entity.trade_quote", "default_mode": "list", "modes": [{"mode": "list", "target": "view:trade_quote.list"}]}]}]},
                {"id": "trade_quote.form_page", "title": "Quote", "header": {"variant": "none"}, "layout": "single", "content": [{"kind": "record", "entity_id": "entity.trade_quote", "record_id_query": "record", "content": [{"kind": "view", "target": "view:trade_quote.form"}]}]},
            ],
            "actions": [{"id": "action.trade_quote_new", "kind": "create_record", "entity_id": "entity.trade_quote", "target": "page:trade_quote.form_page", "label": "New"}],
            "workflows": [],
        }
        jobs_manifest = {
            "manifest_version": "1.3",
            "module": {"id": jobs_module_id, "name": "Jobs"},
            "app": {
                "home": "page:trade_job.list_page",
                "nav": [{"group": "Main", "items": [{"label": "Jobs", "to": "page:trade_job.list_page"}]}],
            },
            "entities": [
                {
                    "id": "entity.trade_job",
                    "label": "Job",
                    "display_field": "trade_job.number",
                    "fields": [
                        {"id": "trade_job.number", "type": "string", "label": "Job Number"},
                        {"id": "trade_job.quote_id", "type": "string", "label": "Source Quote"},
                        {"id": "trade_job.customer_name", "type": "string", "label": "Customer Name"},
                        {"id": "trade_job.status", "type": "string", "label": "Status"},
                    ],
                }
            ],
            "views": [
                {"id": "trade_job.list", "kind": "list", "entity": "entity.trade_job", "columns": [{"field_id": "trade_job.number"}, {"field_id": "trade_job.customer_name"}, {"field_id": "trade_job.status"}]},
                {"id": "trade_job.form", "kind": "form", "entity": "entity.trade_job", "sections": [{"id": "main", "title": "Details", "fields": ["trade_job.number", "trade_job.quote_id", "trade_job.customer_name", "trade_job.status"]}]},
            ],
            "pages": [
                {"id": "trade_job.list_page", "title": "Jobs", "header": {"variant": "none"}, "layout": "single", "content": [{"kind": "container", "variant": "card", "content": [{"kind": "view_modes", "entity_id": "entity.trade_job", "default_mode": "list", "modes": [{"mode": "list", "target": "view:trade_job.list"}]}]}]},
                {"id": "trade_job.form_page", "title": "Job", "header": {"variant": "none"}, "layout": "single", "content": [{"kind": "record", "entity_id": "entity.trade_job", "record_id_query": "record", "content": [{"kind": "view", "target": "view:trade_job.form"}]}]},
            ],
            "actions": [{"id": "action.trade_job_new", "kind": "create_record", "entity_id": "entity.trade_job", "target": "page:trade_job.form_page", "label": "New"}],
            "workflows": [],
        }
        billing_manifest = {
            "manifest_version": "1.3",
            "module": {"id": billing_module_id, "name": "Billing"},
            "app": {
                "home": "page:trade_invoice.list_page",
                "nav": [{"group": "Main", "items": [{"label": "Invoices", "to": "page:trade_invoice.list_page"}]}],
            },
            "entities": [
                {
                    "id": "entity.trade_invoice",
                    "label": "Invoice",
                    "display_field": "trade_invoice.number",
                    "fields": [
                        {"id": "trade_invoice.number", "type": "string", "label": "Invoice Number"},
                        {"id": "trade_invoice.customer_name", "type": "string", "label": "Customer Name"},
                        {"id": "trade_invoice.customer_email", "type": "string", "label": "Customer Email"},
                        {"id": "trade_invoice.status", "type": "string", "label": "Status"},
                    ],
                }
            ],
            "views": [
                {"id": "trade_invoice.list", "kind": "list", "entity": "entity.trade_invoice", "columns": [{"field_id": "trade_invoice.number"}, {"field_id": "trade_invoice.customer_name"}, {"field_id": "trade_invoice.status"}]},
                {"id": "trade_invoice.form", "kind": "form", "entity": "entity.trade_invoice", "sections": [{"id": "main", "title": "Details", "fields": ["trade_invoice.number", "trade_invoice.customer_name", "trade_invoice.customer_email", "trade_invoice.status"]}]},
            ],
            "pages": [
                {"id": "trade_invoice.list_page", "title": "Invoices", "header": {"variant": "none"}, "layout": "single", "content": [{"kind": "container", "variant": "card", "content": [{"kind": "view_modes", "entity_id": "entity.trade_invoice", "default_mode": "list", "modes": [{"mode": "list", "target": "view:trade_invoice.list"}]}]}]},
                {"id": "trade_invoice.form_page", "title": "Invoice", "header": {"variant": "none"}, "layout": "single", "content": [{"kind": "record", "entity_id": "entity.trade_invoice", "record_id_query": "record", "content": [{"kind": "view", "target": "view:trade_invoice.form"}]}]},
            ],
            "actions": [{"id": "action.trade_invoice_new", "kind": "create_record", "entity_id": "entity.trade_invoice", "target": "page:trade_invoice.form_page", "label": "New"}],
            "workflows": [],
        }

        candidate_ops = [
            {"op": "create_module", "artifact_type": "module", "artifact_id": sales_module_id, "manifest": copy.deepcopy(sales_manifest)},
            {"op": "create_module", "artifact_type": "module", "artifact_id": jobs_module_id, "manifest": copy.deepcopy(jobs_manifest)},
            {"op": "create_module", "artifact_type": "module", "artifact_id": billing_module_id, "manifest": copy.deepcopy(billing_manifest)},
            {
                "op": "create_email_template_record",
                "artifact_type": "email_template",
                "artifact_id": reminder_email_id,
                "email_template": {
                    "name": "Overdue Invoice Reminder",
                    "subject": "Invoice {{ record['trade_invoice.number'] }} is overdue",
                    "body_html": "<p>Hello {{ record['trade_invoice.customer_name'] }}, your invoice is overdue.</p>",
                    "body_text": "Hello {{ record['trade_invoice.customer_name'] }}, your invoice is overdue.",
                    "variables_schema": {"entity_id": "entity.trade_invoice"},
                },
            },
            {
                "op": "create_document_template_record",
                "artifact_type": "document_template",
                "artifact_id": completion_doc_id,
                "document_template": {
                    "name": "Completion Pack",
                    "filename_pattern": "completion-{{ record['trade_job.number'] }}",
                    "html": "<h1>Completion Pack</h1><p>{{ record['trade_job.customer_name'] }}</p>",
                    "paper_size": "A4",
                    "variables_schema": {"entity_id": "entity.trade_job"},
                },
            },
            {
                "op": "create_automation_record",
                "artifact_type": "automation",
                "artifact_id": quote_handoff_id,
                "automation": {
                    "name": "Quote Approved to Job",
                    "status": "draft",
                    "trigger": {"kind": "event", "event_types": ["sales.workflow.quote.approved"], "filters": []},
                    "steps": [
                        {
                            "id": "step_create_job",
                            "kind": "action",
                            "action_id": "system.create_record",
                            "inputs": {
                                "entity_id": "entity.trade_job",
                                "values": {
                                    "trade_job.quote_id": "{{trigger.record_id}}",
                                    "trade_job.customer_name": "{{trigger.record.fields.trade_quote.customer_name}}",
                                },
                            },
                        }
                    ],
                },
            },
            {
                "op": "create_automation_record",
                "artifact_type": "automation",
                "artifact_id": job_pack_id,
                "automation": {
                    "name": "Job Completion Pack",
                    "status": "draft",
                    "trigger": {"kind": "event", "event_types": ["jobs.workflow.job.completed"], "filters": []},
                    "steps": [
                        {
                            "id": "step_generate_pack",
                            "kind": "action",
                            "action_id": "system.generate_document",
                            "inputs": {"entity_id": "entity.trade_job", "template_id": completion_doc_id, "purpose": "completion_pack"},
                        }
                    ],
                },
            },
            {
                "op": "create_automation_record",
                "artifact_type": "automation",
                "artifact_id": invoice_reminder_id,
                "automation": {
                    "name": "Overdue Invoice Reminder",
                    "status": "draft",
                    "trigger": {"kind": "event", "event_types": ["billing.workflow.invoice.overdue"], "filters": []},
                    "steps": [
                        {
                            "id": "step_send_reminder",
                            "kind": "action",
                            "action_id": "system.send_email",
                            "inputs": {"entity_id": "entity.trade_invoice", "template_id": reminder_email_id, "to_field_ids": ["trade_invoice.customer_email"]},
                        }
                    ],
                },
            },
        ]

        request_message = (
            "We are a trade services company. We need Sales for quotes, Jobs for delivery, and Billing for invoices. "
            "When a quote is approved create a job. When a job is completed generate a completion pack. "
            "When an invoice becomes overdue send a branded reminder email."
        )

        def fake_plan(_request, _session, _message_text, explicit_scope=None, answer_hints=None):
            confirm_plan = bool(isinstance(answer_hints, dict) and answer_hints.get("confirm_plan"))
            return (
                {
                    "scope": {"mode": explicit_scope or "auto"},
                    "affected_artifacts": [],
                    "affected_modules": [sales_module_id, jobs_module_id, billing_module_id],
                    "candidate_operations": copy.deepcopy(candidate_ops),
                    "required_questions": [] if confirm_plan else ["Confirm this plan?"],
                    "required_question_meta": None if confirm_plan else {"id": "confirm_plan", "kind": "confirm_plan", "question": "Confirm this plan?"},
                    "resolved_without_changes": False,
                },
                {"status": "ready_to_apply" if confirm_plan else "waiting_input", "affected_modules": [sales_module_id, jobs_module_id, billing_module_id]},
            )

        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            session = client.post("/octo-ai/sessions", json={"title": "Trade Services Architecture"}).json()["session"]
        main._ai_update_record(
            main._AI_ENTITY_SESSION,
            session["id"],
            {"sandbox_workspace_id": sandbox_workspace_id, "sandbox_status": "active"},
        )

        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.object(main, "_ai_plan_from_message", side_effect=fake_plan),
        ):
            first_res = client.post(f"/octo-ai/sessions/{session['id']}/chat", json={"message": request_message})
            approve_res = client.post(f"/octo-ai/sessions/{session['id']}/questions/answer", json={"action": "custom", "text": "Approved."})

        first_body = first_res.json()
        approve_body = approve_res.json()
        self.assertEqual(first_res.status_code, 200, first_body)
        self.assertEqual(((first_body.get("plan") or {}).get("required_question_meta") or {}).get("id"), "confirm_plan")
        self.assertEqual(approve_res.status_code, 200, approve_body)
        approved_ops = [op for op in ((approve_body.get("plan") or {}).get("candidate_operations") or []) if isinstance(op, dict)]
        self._assert_candidate_plan_quality(approved_ops)

        patchset_res = client.post(f"/octo-ai/sessions/{session['id']}/patchsets/generate", json={})
        patchset_body = patchset_res.json()
        self.assertEqual(patchset_res.status_code, 200, patchset_body)
        patchset_id = ((patchset_body.get("patchset") or {}).get("id")) or ""
        self.assertTrue(patchset_id)

        apply_res = client.post(f"/octo-ai/patchsets/{patchset_id}/apply", json={"approved": True})
        apply_body = apply_res.json()
        self.assertEqual(apply_res.status_code, 200, apply_body)
        self.assertTrue(apply_body.get("ok"), apply_body)

        sandbox_request = SimpleNamespace(state=SimpleNamespace(cache={}, actor={}))
        with main._ai_ops_workspace_scope(sandbox_request, sandbox_workspace_id, {"workspace_id": sandbox_workspace_id}):
            sales_module = main._get_module(sandbox_request, sales_module_id)
            jobs_module = main._get_module(sandbox_request, jobs_module_id)
            billing_module = main._get_module(sandbox_request, billing_module_id)
            _sales_row, sales_installed = main._get_installed_manifest(sandbox_request, sales_module_id)
            _jobs_row, jobs_installed = main._get_installed_manifest(sandbox_request, jobs_module_id)
            _billing_row, billing_installed = main._get_installed_manifest(sandbox_request, billing_module_id)
            reminder_email = main.email_store.get_template(reminder_email_id)
            completion_doc = main.doc_template_store.get(completion_doc_id)
            quote_handoff = main.automation_store.get(quote_handoff_id)
            job_pack = main.automation_store.get(job_pack_id)
            invoice_reminder = main.automation_store.get(invoice_reminder_id)

        self.assertTrue(all(isinstance(item, dict) for item in [sales_module, jobs_module, billing_module]))
        self._assert_manifest_quality(sales_installed or {}, primary_entity_id="entity.trade_quote")
        self._assert_manifest_quality(jobs_installed or {}, primary_entity_id="entity.trade_job")
        self._assert_manifest_quality(billing_installed or {}, primary_entity_id="entity.trade_invoice")
        self.assertEqual(((reminder_email or {}).get("variables_schema") or {}).get("entity_id"), "entity.trade_invoice")
        self.assertEqual(((completion_doc or {}).get("variables_schema") or {}).get("entity_id"), "entity.trade_job")
        self._assert_automation_quality(quote_handoff or {}, expected_action_ids=["system.create_record"], expected_trigger_kind="event")
        self._assert_automation_quality(job_pack or {}, expected_action_ids=["system.generate_document"], expected_trigger_kind="event")
        self._assert_automation_quality(invoice_reminder or {}, expected_action_ids=["system.send_email"], expected_trigger_kind="event")
        self.assertEqual((((job_pack or {}).get("steps") or [{}])[0].get("inputs") or {}).get("template_id"), completion_doc_id)
        self.assertEqual((((invoice_reminder or {}).get("steps") or [{}])[0].get("inputs") or {}).get("template_id"), reminder_email_id)

    def test_octo_ai_service_agency_architecture_bundle_applies_coherent_multi_step_handoffs_end_to_end(self) -> None:
        client = TestClient(main.app)
        sandbox_workspace_id = f"ws_service_agency_{uuid.uuid4().hex[:6]}"
        sales_module_id = f"sales_{uuid.uuid4().hex[:6]}"
        projects_module_id = f"projects_{uuid.uuid4().hex[:6]}"
        billing_module_id = f"billing_{uuid.uuid4().hex[:6]}"
        quote_email_id = f"email_tpl_quote_{uuid.uuid4().hex[:6]}"
        reminder_email_id = f"email_tpl_invoice_{uuid.uuid4().hex[:6]}"
        handover_doc_id = f"doc_tpl_handover_{uuid.uuid4().hex[:6]}"
        quote_handoff_id = f"auto_quote_handoff_{uuid.uuid4().hex[:6]}"
        project_handover_id = f"auto_project_handover_{uuid.uuid4().hex[:6]}"
        invoice_reminder_id = f"auto_invoice_reminder_{uuid.uuid4().hex[:6]}"

        sales_manifest = {
            "manifest_version": "1.3",
            "module": {"id": sales_module_id, "name": "Sales"},
            "app": {
                "home": "page:client_quote.list_page",
                "nav": [{"group": "Main", "items": [{"label": "Quotes", "to": "page:client_quote.list_page"}]}],
            },
            "entities": [
                {
                    "id": "entity.client_quote",
                    "label": "Quote",
                    "display_field": "client_quote.number",
                    "fields": [
                        {"id": "client_quote.number", "type": "string", "label": "Quote Number"},
                        {"id": "client_quote.customer_name", "type": "string", "label": "Customer Name"},
                        {"id": "client_quote.customer_email", "type": "string", "label": "Customer Email"},
                        {"id": "client_quote.status", "type": "string", "label": "Status"},
                    ],
                }
            ],
            "views": [
                {"id": "client_quote.list", "kind": "list", "entity": "entity.client_quote", "columns": [{"field_id": "client_quote.number"}, {"field_id": "client_quote.customer_name"}, {"field_id": "client_quote.status"}]},
                {"id": "client_quote.form", "kind": "form", "entity": "entity.client_quote", "sections": [{"id": "main", "title": "Details", "fields": ["client_quote.number", "client_quote.customer_name", "client_quote.customer_email", "client_quote.status"]}]},
            ],
            "pages": [
                {"id": "client_quote.list_page", "title": "Quotes", "header": {"variant": "none"}, "layout": "single", "content": [{"kind": "container", "variant": "card", "content": [{"kind": "view_modes", "entity_id": "entity.client_quote", "default_mode": "list", "modes": [{"mode": "list", "target": "view:client_quote.list"}]}]}]},
                {"id": "client_quote.form_page", "title": "Quote", "header": {"variant": "none"}, "layout": "single", "content": [{"kind": "record", "entity_id": "entity.client_quote", "record_id_query": "record", "content": [{"kind": "view", "target": "view:client_quote.form"}]}]},
            ],
            "actions": [{"id": "action.client_quote_new", "kind": "create_record", "entity_id": "entity.client_quote", "target": "page:client_quote.form_page", "label": "New"}],
            "workflows": [],
        }
        projects_manifest = {
            "manifest_version": "1.3",
            "module": {"id": projects_module_id, "name": "Projects"},
            "app": {
                "home": "page:client_project.list_page",
                "nav": [{"group": "Main", "items": [{"label": "Projects", "to": "page:client_project.list_page"}]}],
            },
            "entities": [
                {
                    "id": "entity.client_project",
                    "label": "Project",
                    "display_field": "client_project.number",
                    "fields": [
                        {"id": "client_project.number", "type": "string", "label": "Project Number"},
                        {"id": "client_project.quote_id", "type": "string", "label": "Source Quote"},
                        {"id": "client_project.customer_name", "type": "string", "label": "Customer Name"},
                        {"id": "client_project.customer_email", "type": "string", "label": "Customer Email"},
                        {"id": "client_project.status", "type": "string", "label": "Status"},
                    ],
                }
            ],
            "views": [
                {"id": "client_project.list", "kind": "list", "entity": "entity.client_project", "columns": [{"field_id": "client_project.number"}, {"field_id": "client_project.customer_name"}, {"field_id": "client_project.status"}]},
                {"id": "client_project.form", "kind": "form", "entity": "entity.client_project", "sections": [{"id": "main", "title": "Details", "fields": ["client_project.number", "client_project.quote_id", "client_project.customer_name", "client_project.customer_email", "client_project.status"]}]},
            ],
            "pages": [
                {"id": "client_project.list_page", "title": "Projects", "header": {"variant": "none"}, "layout": "single", "content": [{"kind": "container", "variant": "card", "content": [{"kind": "view_modes", "entity_id": "entity.client_project", "default_mode": "list", "modes": [{"mode": "list", "target": "view:client_project.list"}]}]}]},
                {"id": "client_project.form_page", "title": "Project", "header": {"variant": "none"}, "layout": "single", "content": [{"kind": "record", "entity_id": "entity.client_project", "record_id_query": "record", "content": [{"kind": "view", "target": "view:client_project.form"}]}]},
            ],
            "actions": [{"id": "action.client_project_new", "kind": "create_record", "entity_id": "entity.client_project", "target": "page:client_project.form_page", "label": "New"}],
            "workflows": [],
        }
        billing_manifest = {
            "manifest_version": "1.3",
            "module": {"id": billing_module_id, "name": "Billing"},
            "app": {
                "home": "page:client_invoice.list_page",
                "nav": [{"group": "Main", "items": [{"label": "Invoices", "to": "page:client_invoice.list_page"}]}],
            },
            "entities": [
                {
                    "id": "entity.client_invoice",
                    "label": "Invoice",
                    "display_field": "client_invoice.number",
                    "fields": [
                        {"id": "client_invoice.number", "type": "string", "label": "Invoice Number"},
                        {"id": "client_invoice.project_id", "type": "string", "label": "Project"},
                        {"id": "client_invoice.customer_name", "type": "string", "label": "Customer Name"},
                        {"id": "client_invoice.customer_email", "type": "string", "label": "Customer Email"},
                        {"id": "client_invoice.status", "type": "string", "label": "Status"},
                    ],
                }
            ],
            "views": [
                {"id": "client_invoice.list", "kind": "list", "entity": "entity.client_invoice", "columns": [{"field_id": "client_invoice.number"}, {"field_id": "client_invoice.customer_name"}, {"field_id": "client_invoice.status"}]},
                {"id": "client_invoice.form", "kind": "form", "entity": "entity.client_invoice", "sections": [{"id": "main", "title": "Details", "fields": ["client_invoice.number", "client_invoice.project_id", "client_invoice.customer_name", "client_invoice.customer_email", "client_invoice.status"]}]},
            ],
            "pages": [
                {"id": "client_invoice.list_page", "title": "Invoices", "header": {"variant": "none"}, "layout": "single", "content": [{"kind": "container", "variant": "card", "content": [{"kind": "view_modes", "entity_id": "entity.client_invoice", "default_mode": "list", "modes": [{"mode": "list", "target": "view:client_invoice.list"}]}]}]},
                {"id": "client_invoice.form_page", "title": "Invoice", "header": {"variant": "none"}, "layout": "single", "content": [{"kind": "record", "entity_id": "entity.client_invoice", "record_id_query": "record", "content": [{"kind": "view", "target": "view:client_invoice.form"}]}]},
            ],
            "actions": [{"id": "action.client_invoice_new", "kind": "create_record", "entity_id": "entity.client_invoice", "target": "page:client_invoice.form_page", "label": "New"}],
            "workflows": [],
        }

        candidate_ops = [
            {"op": "create_module", "artifact_type": "module", "artifact_id": sales_module_id, "manifest": copy.deepcopy(sales_manifest)},
            {"op": "create_module", "artifact_type": "module", "artifact_id": projects_module_id, "manifest": copy.deepcopy(projects_manifest)},
            {"op": "create_module", "artifact_type": "module", "artifact_id": billing_module_id, "manifest": copy.deepcopy(billing_manifest)},
            {
                "op": "create_email_template_record",
                "artifact_type": "email_template",
                "artifact_id": quote_email_id,
                "email_template": {
                    "name": "Quote Approved Welcome",
                    "subject": "Your project is starting for quote {{ record['client_quote.number'] }}",
                    "body_html": "<p>Hello {{ record['client_quote.customer_name'] }}, your quote has been approved and we are starting the project.</p>",
                    "body_text": "Hello {{ record['client_quote.customer_name'] }}, your quote has been approved and we are starting the project.",
                    "variables_schema": {"entity_id": "entity.client_quote"},
                },
            },
            {
                "op": "create_email_template_record",
                "artifact_type": "email_template",
                "artifact_id": reminder_email_id,
                "email_template": {
                    "name": "Invoice Reminder",
                    "subject": "Invoice {{ record['client_invoice.number'] }} is now overdue",
                    "body_html": "<p>Hello {{ record['client_invoice.customer_name'] }}, invoice {{ record['client_invoice.number'] }} is overdue.</p>",
                    "body_text": "Hello {{ record['client_invoice.customer_name'] }}, invoice {{ record['client_invoice.number'] }} is overdue.",
                    "variables_schema": {"entity_id": "entity.client_invoice"},
                },
            },
            {
                "op": "create_document_template_record",
                "artifact_type": "document_template",
                "artifact_id": handover_doc_id,
                "document_template": {
                    "name": "Project Handover Pack",
                    "filename_pattern": "handover-{{ record['client_project.number'] }}",
                    "html": "<h1>Project Handover Pack</h1><p>{{ record['client_project.customer_name'] }}</p><p>Status: {{ record['client_project.status'] }}</p>",
                    "paper_size": "A4",
                    "variables_schema": {"entity_id": "entity.client_project"},
                },
            },
            {
                "op": "create_automation_record",
                "artifact_type": "automation",
                "artifact_id": quote_handoff_id,
                "automation": {
                    "name": "Quote Approved Handoff",
                    "status": "draft",
                    "trigger": {"kind": "event", "event_types": ["sales.workflow.quote.approved"], "filters": []},
                    "steps": [
                        {
                            "id": "step_create_project",
                            "kind": "action",
                            "action_id": "system.create_record",
                            "inputs": {
                                "entity_id": "entity.client_project",
                                "values": {
                                    "client_project.quote_id": "{{trigger.record_id}}",
                                    "client_project.customer_name": "{{trigger.record.fields.client_quote.customer_name}}",
                                    "client_project.customer_email": "{{trigger.record.fields.client_quote.customer_email}}",
                                },
                            },
                        },
                        {
                            "id": "step_send_welcome",
                            "kind": "action",
                            "action_id": "system.send_email",
                            "inputs": {
                                "entity_id": "entity.client_quote",
                                "template_id": quote_email_id,
                                "to_field_ids": ["client_quote.customer_email"],
                            },
                        },
                    ],
                },
            },
            {
                "op": "create_automation_record",
                "artifact_type": "automation",
                "artifact_id": project_handover_id,
                "automation": {
                    "name": "Project Completed Handover",
                    "status": "draft",
                    "trigger": {"kind": "event", "event_types": ["projects.workflow.project.completed"], "filters": []},
                    "steps": [
                        {
                            "id": "step_generate_handover",
                            "kind": "action",
                            "action_id": "system.generate_document",
                            "inputs": {"entity_id": "entity.client_project", "template_id": handover_doc_id, "purpose": "handover"},
                        },
                        {
                            "id": "step_mark_handover_sent",
                            "kind": "action",
                            "action_id": "system.update_record",
                            "inputs": {
                                "entity_id": "entity.client_project",
                                "record_id": "{{trigger.record_id}}",
                                "patch": {"client_project.status": "handover_sent"},
                            },
                        },
                    ],
                },
            },
            {
                "op": "create_automation_record",
                "artifact_type": "automation",
                "artifact_id": invoice_reminder_id,
                "automation": {
                    "name": "Invoice Overdue Reminder",
                    "status": "draft",
                    "trigger": {"kind": "event", "event_types": ["billing.workflow.invoice.overdue"], "filters": []},
                    "steps": [
                        {
                            "id": "step_send_invoice_reminder",
                            "kind": "action",
                            "action_id": "system.send_email",
                            "inputs": {
                                "entity_id": "entity.client_invoice",
                                "template_id": reminder_email_id,
                                "to_field_ids": ["client_invoice.customer_email"],
                            },
                        }
                    ],
                },
            },
        ]

        request_message = (
            "We are a service agency. We need Sales for quotes, Projects for delivery, and Billing for invoices. "
            "When a quote is approved create a project and send a welcome email. "
            "When a project is completed generate a handover pack and update the project status. "
            "When an invoice becomes overdue send a reminder email."
        )

        def fake_plan(_request, _session, _message_text, explicit_scope=None, answer_hints=None):
            confirm_plan = bool(isinstance(answer_hints, dict) and answer_hints.get("confirm_plan"))
            return (
                {
                    "scope": {"mode": explicit_scope or "auto"},
                    "affected_artifacts": [],
                    "affected_modules": [sales_module_id, projects_module_id, billing_module_id],
                    "candidate_operations": copy.deepcopy(candidate_ops),
                    "required_questions": [] if confirm_plan else ["Confirm this plan?"],
                    "required_question_meta": None if confirm_plan else {"id": "confirm_plan", "kind": "confirm_plan", "question": "Confirm this plan?"},
                    "resolved_without_changes": False,
                },
                {"status": "ready_to_apply" if confirm_plan else "waiting_input", "affected_modules": [sales_module_id, projects_module_id, billing_module_id]},
            )

        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            session = client.post("/octo-ai/sessions", json={"title": "Service Agency Architecture"}).json()["session"]
        main._ai_update_record(
            main._AI_ENTITY_SESSION,
            session["id"],
            {"sandbox_workspace_id": sandbox_workspace_id, "sandbox_status": "active"},
        )

        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.object(main, "_ai_plan_from_message", side_effect=fake_plan),
        ):
            first_res = client.post(f"/octo-ai/sessions/{session['id']}/chat", json={"message": request_message})
            approve_res = client.post(f"/octo-ai/sessions/{session['id']}/questions/answer", json={"action": "custom", "text": "Approved."})

        first_body = first_res.json()
        approve_body = approve_res.json()
        self.assertEqual(first_res.status_code, 200, first_body)
        self.assertEqual(((first_body.get("plan") or {}).get("required_question_meta") or {}).get("id"), "confirm_plan")
        self.assertEqual(approve_res.status_code, 200, approve_body)
        approved_ops = [op for op in ((approve_body.get("plan") or {}).get("candidate_operations") or []) if isinstance(op, dict)]
        self._assert_candidate_plan_quality(approved_ops)

        patchset_res = client.post(f"/octo-ai/sessions/{session['id']}/patchsets/generate", json={})
        patchset_body = patchset_res.json()
        self.assertEqual(patchset_res.status_code, 200, patchset_body)
        patchset_id = ((patchset_body.get("patchset") or {}).get("id")) or ""
        self.assertTrue(patchset_id)

        apply_res = client.post(f"/octo-ai/patchsets/{patchset_id}/apply", json={"approved": True})
        apply_body = apply_res.json()
        self.assertEqual(apply_res.status_code, 200, apply_body)
        self.assertTrue(apply_body.get("ok"), apply_body)

        sandbox_request = SimpleNamespace(state=SimpleNamespace(cache={}, actor={}))
        with main._ai_ops_workspace_scope(sandbox_request, sandbox_workspace_id, {"workspace_id": sandbox_workspace_id}):
            _sales_row, sales_installed = main._get_installed_manifest(sandbox_request, sales_module_id)
            _projects_row, projects_installed = main._get_installed_manifest(sandbox_request, projects_module_id)
            _billing_row, billing_installed = main._get_installed_manifest(sandbox_request, billing_module_id)
            quote_email = main.email_store.get_template(quote_email_id)
            reminder_email = main.email_store.get_template(reminder_email_id)
            handover_doc = main.doc_template_store.get(handover_doc_id)
            quote_handoff = main.automation_store.get(quote_handoff_id)
            project_handover = main.automation_store.get(project_handover_id)
            invoice_reminder = main.automation_store.get(invoice_reminder_id)

        self._assert_manifest_quality(sales_installed or {}, primary_entity_id="entity.client_quote")
        self._assert_manifest_quality(projects_installed or {}, primary_entity_id="entity.client_project")
        self._assert_manifest_quality(billing_installed or {}, primary_entity_id="entity.client_invoice")
        self.assertEqual(((quote_email or {}).get("variables_schema") or {}).get("entity_id"), "entity.client_quote")
        self.assertEqual(((reminder_email or {}).get("variables_schema") or {}).get("entity_id"), "entity.client_invoice")
        self.assertEqual(((handover_doc or {}).get("variables_schema") or {}).get("entity_id"), "entity.client_project")
        self.assertIn("starting the project", (quote_email or {}).get("body_text") or "")
        self.assertIn("handover", ((handover_doc or {}).get("html") or "").lower())
        self._assert_automation_quality(
            quote_handoff or {},
            expected_action_ids=["system.create_record", "system.send_email"],
            expected_trigger_kind="event",
        )
        self._assert_automation_quality(
            project_handover or {},
            expected_action_ids=["system.generate_document", "system.update_record"],
            expected_trigger_kind="event",
        )
        self._assert_automation_quality(
            invoice_reminder or {},
            expected_action_ids=["system.send_email"],
            expected_trigger_kind="event",
        )
        quote_handoff_steps = (quote_handoff or {}).get("steps") or []
        project_handover_steps = (project_handover or {}).get("steps") or []
        invoice_reminder_steps = (invoice_reminder or {}).get("steps") or []
        self.assertEqual(((quote_handoff_steps[0].get("inputs") or {}).get("entity_id")), "entity.client_project")
        self.assertEqual(((quote_handoff_steps[1].get("inputs") or {}).get("template_id")), quote_email_id)
        self.assertEqual(((project_handover_steps[0].get("inputs") or {}).get("template_id")), handover_doc_id)
        self.assertEqual(
            (((project_handover_steps[1].get("inputs") or {}).get("patch") or {}).get("client_project.status")),
            "handover_sent",
        )
        self.assertEqual(((invoice_reminder_steps[0].get("inputs") or {}).get("template_id")), reminder_email_id)

    def test_octo_ai_property_services_architecture_bundle_applies_coherent_booking_completion_and_billing_rollout_end_to_end(self) -> None:
        client = TestClient(main.app)
        sandbox_workspace_id = f"ws_property_services_{uuid.uuid4().hex[:6]}"
        bookings_module_id = f"bookings_{uuid.uuid4().hex[:6]}"
        workorders_module_id = f"workorders_{uuid.uuid4().hex[:6]}"
        billing_module_id = f"billing_{uuid.uuid4().hex[:6]}"
        booking_email_id = f"email_tpl_booking_{uuid.uuid4().hex[:6]}"
        reminder_email_id = f"email_tpl_overdue_{uuid.uuid4().hex[:6]}"
        service_report_id = f"doc_tpl_service_report_{uuid.uuid4().hex[:6]}"
        booking_confirm_id = f"auto_booking_confirm_{uuid.uuid4().hex[:6]}"
        completion_invoice_id = f"auto_completion_invoice_{uuid.uuid4().hex[:6]}"
        overdue_invoice_id = f"auto_overdue_invoice_{uuid.uuid4().hex[:6]}"

        bookings_manifest = {
            "manifest_version": "1.3",
            "module": {"id": bookings_module_id, "name": "Bookings"},
            "app": {
                "home": "page:service_booking.list_page",
                "nav": [{"group": "Main", "items": [{"label": "Bookings", "to": "page:service_booking.list_page"}]}],
            },
            "entities": [
                {
                    "id": "entity.service_booking",
                    "label": "Booking",
                    "display_field": "service_booking.number",
                    "fields": [
                        {"id": "service_booking.number", "type": "string", "label": "Booking Number"},
                        {"id": "service_booking.customer_name", "type": "string", "label": "Customer Name"},
                        {"id": "service_booking.customer_email", "type": "string", "label": "Customer Email"},
                        {"id": "service_booking.address", "type": "string", "label": "Service Address"},
                        {"id": "service_booking.status", "type": "string", "label": "Status"},
                    ],
                }
            ],
            "views": [
                {"id": "service_booking.list", "kind": "list", "entity": "entity.service_booking", "columns": [{"field_id": "service_booking.number"}, {"field_id": "service_booking.customer_name"}, {"field_id": "service_booking.status"}]},
                {"id": "service_booking.form", "kind": "form", "entity": "entity.service_booking", "sections": [{"id": "main", "title": "Details", "fields": ["service_booking.number", "service_booking.customer_name", "service_booking.customer_email", "service_booking.address", "service_booking.status"]}]},
            ],
            "pages": [
                {"id": "service_booking.list_page", "title": "Bookings", "header": {"variant": "none"}, "layout": "single", "content": [{"kind": "container", "variant": "card", "content": [{"kind": "view_modes", "entity_id": "entity.service_booking", "default_mode": "list", "modes": [{"mode": "list", "target": "view:service_booking.list"}]}]}]},
                {"id": "service_booking.form_page", "title": "Booking", "header": {"variant": "none"}, "layout": "single", "content": [{"kind": "record", "entity_id": "entity.service_booking", "record_id_query": "record", "content": [{"kind": "view", "target": "view:service_booking.form"}]}]},
            ],
            "actions": [{"id": "action.service_booking_new", "kind": "create_record", "entity_id": "entity.service_booking", "target": "page:service_booking.form_page", "label": "New"}],
            "workflows": [],
        }
        workorders_manifest = {
            "manifest_version": "1.3",
            "module": {"id": workorders_module_id, "name": "Work Orders"},
            "app": {
                "home": "page:service_work_order.list_page",
                "nav": [{"group": "Main", "items": [{"label": "Work Orders", "to": "page:service_work_order.list_page"}]}],
            },
            "entities": [
                {
                    "id": "entity.service_work_order",
                    "label": "Work Order",
                    "display_field": "service_work_order.number",
                    "fields": [
                        {"id": "service_work_order.number", "type": "string", "label": "Work Order Number"},
                        {"id": "service_work_order.booking_id", "type": "string", "label": "Booking"},
                        {"id": "service_work_order.customer_name", "type": "string", "label": "Customer Name"},
                        {"id": "service_work_order.customer_email", "type": "string", "label": "Customer Email"},
                        {"id": "service_work_order.status", "type": "string", "label": "Status"},
                    ],
                }
            ],
            "views": [
                {"id": "service_work_order.list", "kind": "list", "entity": "entity.service_work_order", "columns": [{"field_id": "service_work_order.number"}, {"field_id": "service_work_order.customer_name"}, {"field_id": "service_work_order.status"}]},
                {"id": "service_work_order.form", "kind": "form", "entity": "entity.service_work_order", "sections": [{"id": "main", "title": "Details", "fields": ["service_work_order.number", "service_work_order.booking_id", "service_work_order.customer_name", "service_work_order.customer_email", "service_work_order.status"]}]},
            ],
            "pages": [
                {"id": "service_work_order.list_page", "title": "Work Orders", "header": {"variant": "none"}, "layout": "single", "content": [{"kind": "container", "variant": "card", "content": [{"kind": "view_modes", "entity_id": "entity.service_work_order", "default_mode": "list", "modes": [{"mode": "list", "target": "view:service_work_order.list"}]}]}]},
                {"id": "service_work_order.form_page", "title": "Work Order", "header": {"variant": "none"}, "layout": "single", "content": [{"kind": "record", "entity_id": "entity.service_work_order", "record_id_query": "record", "content": [{"kind": "view", "target": "view:service_work_order.form"}]}]},
            ],
            "actions": [{"id": "action.service_work_order_new", "kind": "create_record", "entity_id": "entity.service_work_order", "target": "page:service_work_order.form_page", "label": "New"}],
            "workflows": [],
        }
        billing_manifest = {
            "manifest_version": "1.3",
            "module": {"id": billing_module_id, "name": "Billing"},
            "app": {
                "home": "page:service_invoice.list_page",
                "nav": [{"group": "Main", "items": [{"label": "Invoices", "to": "page:service_invoice.list_page"}]}],
            },
            "entities": [
                {
                    "id": "entity.service_invoice",
                    "label": "Invoice",
                    "display_field": "service_invoice.number",
                    "fields": [
                        {"id": "service_invoice.number", "type": "string", "label": "Invoice Number"},
                        {"id": "service_invoice.work_order_id", "type": "string", "label": "Work Order"},
                        {"id": "service_invoice.customer_name", "type": "string", "label": "Customer Name"},
                        {"id": "service_invoice.customer_email", "type": "string", "label": "Customer Email"},
                        {"id": "service_invoice.status", "type": "string", "label": "Status"},
                    ],
                }
            ],
            "views": [
                {"id": "service_invoice.list", "kind": "list", "entity": "entity.service_invoice", "columns": [{"field_id": "service_invoice.number"}, {"field_id": "service_invoice.customer_name"}, {"field_id": "service_invoice.status"}]},
                {"id": "service_invoice.form", "kind": "form", "entity": "entity.service_invoice", "sections": [{"id": "main", "title": "Details", "fields": ["service_invoice.number", "service_invoice.work_order_id", "service_invoice.customer_name", "service_invoice.customer_email", "service_invoice.status"]}]},
            ],
            "pages": [
                {"id": "service_invoice.list_page", "title": "Invoices", "header": {"variant": "none"}, "layout": "single", "content": [{"kind": "container", "variant": "card", "content": [{"kind": "view_modes", "entity_id": "entity.service_invoice", "default_mode": "list", "modes": [{"mode": "list", "target": "view:service_invoice.list"}]}]}]},
                {"id": "service_invoice.form_page", "title": "Invoice", "header": {"variant": "none"}, "layout": "single", "content": [{"kind": "record", "entity_id": "entity.service_invoice", "record_id_query": "record", "content": [{"kind": "view", "target": "view:service_invoice.form"}]}]},
            ],
            "actions": [{"id": "action.service_invoice_new", "kind": "create_record", "entity_id": "entity.service_invoice", "target": "page:service_invoice.form_page", "label": "New"}],
            "workflows": [],
        }

        candidate_ops = [
            {"op": "create_module", "artifact_type": "module", "artifact_id": bookings_module_id, "manifest": copy.deepcopy(bookings_manifest)},
            {"op": "create_module", "artifact_type": "module", "artifact_id": workorders_module_id, "manifest": copy.deepcopy(workorders_manifest)},
            {"op": "create_module", "artifact_type": "module", "artifact_id": billing_module_id, "manifest": copy.deepcopy(billing_manifest)},
            {
                "op": "create_email_template_record",
                "artifact_type": "email_template",
                "artifact_id": booking_email_id,
                "email_template": {
                    "name": "Booking Confirmed",
                    "subject": "Your service booking {{ record['service_booking.number'] }} is confirmed",
                    "body_html": "<p>Hello {{ record['service_booking.customer_name'] }}, your visit to {{ record['service_booking.address'] }} is confirmed.</p>",
                    "body_text": "Hello {{ record['service_booking.customer_name'] }}, your visit to {{ record['service_booking.address'] }} is confirmed.",
                    "variables_schema": {"entity_id": "entity.service_booking"},
                },
            },
            {
                "op": "create_email_template_record",
                "artifact_type": "email_template",
                "artifact_id": reminder_email_id,
                "email_template": {
                    "name": "Overdue Invoice Reminder",
                    "subject": "Invoice {{ record['service_invoice.number'] }} is overdue",
                    "body_html": "<p>Hello {{ record['service_invoice.customer_name'] }}, invoice {{ record['service_invoice.number'] }} is overdue.</p>",
                    "body_text": "Hello {{ record['service_invoice.customer_name'] }}, invoice {{ record['service_invoice.number'] }} is overdue.",
                    "variables_schema": {"entity_id": "entity.service_invoice"},
                },
            },
            {
                "op": "create_document_template_record",
                "artifact_type": "document_template",
                "artifact_id": service_report_id,
                "document_template": {
                    "name": "Service Report",
                    "filename_pattern": "service-report-{{ record['service_work_order.number'] }}",
                    "html": "<h1>Service Report</h1><p>{{ record['service_work_order.customer_name'] }}</p><p>Status: {{ record['service_work_order.status'] }}</p>",
                    "paper_size": "A4",
                    "variables_schema": {"entity_id": "entity.service_work_order"},
                },
            },
            {
                "op": "create_automation_record",
                "artifact_type": "automation",
                "artifact_id": booking_confirm_id,
                "automation": {
                    "name": "Booking Confirmation",
                    "status": "draft",
                    "trigger": {"kind": "event", "event_types": ["bookings.workflow.booking.confirmed"], "filters": []},
                    "steps": [
                        {
                            "id": "step_create_work_order",
                            "kind": "action",
                            "action_id": "system.create_record",
                            "inputs": {
                                "entity_id": "entity.service_work_order",
                                "values": {
                                    "service_work_order.booking_id": "{{trigger.record_id}}",
                                    "service_work_order.customer_name": "{{trigger.record.fields.service_booking.customer_name}}",
                                    "service_work_order.customer_email": "{{trigger.record.fields.service_booking.customer_email}}",
                                },
                            },
                        },
                        {
                            "id": "step_send_booking_email",
                            "kind": "action",
                            "action_id": "system.send_email",
                            "inputs": {
                                "entity_id": "entity.service_booking",
                                "template_id": booking_email_id,
                                "to_field_ids": ["service_booking.customer_email"],
                            },
                        },
                    ],
                },
            },
            {
                "op": "create_automation_record",
                "artifact_type": "automation",
                "artifact_id": completion_invoice_id,
                "automation": {
                    "name": "Work Order Completion Billing",
                    "status": "draft",
                    "trigger": {"kind": "event", "event_types": ["workorders.workflow.work_order.completed"], "filters": []},
                    "steps": [
                        {
                            "id": "step_generate_service_report",
                            "kind": "action",
                            "action_id": "system.generate_document",
                            "inputs": {"entity_id": "entity.service_work_order", "template_id": service_report_id, "purpose": "service_report"},
                        },
                        {
                            "id": "step_create_invoice",
                            "kind": "action",
                            "action_id": "system.create_record",
                            "inputs": {
                                "entity_id": "entity.service_invoice",
                                "values": {
                                    "service_invoice.work_order_id": "{{trigger.record_id}}",
                                    "service_invoice.customer_name": "{{trigger.record.fields.service_work_order.customer_name}}",
                                    "service_invoice.customer_email": "{{trigger.record.fields.service_work_order.customer_email}}",
                                },
                            },
                        },
                    ],
                },
            },
            {
                "op": "create_automation_record",
                "artifact_type": "automation",
                "artifact_id": overdue_invoice_id,
                "automation": {
                    "name": "Overdue Invoice Reminder",
                    "status": "draft",
                    "trigger": {"kind": "event", "event_types": ["billing.workflow.invoice.overdue"], "filters": []},
                    "steps": [
                        {
                            "id": "step_send_overdue_email",
                            "kind": "action",
                            "action_id": "system.send_email",
                            "inputs": {
                                "entity_id": "entity.service_invoice",
                                "template_id": reminder_email_id,
                                "to_field_ids": ["service_invoice.customer_email"],
                            },
                        }
                    ],
                },
            },
        ]

        request_message = (
            "We are a property services company. We need Bookings, Work Orders, and Billing. "
            "When a booking is confirmed create a work order and send a booking confirmation email. "
            "When a work order is completed generate a service report and create an invoice. "
            "When an invoice becomes overdue send a reminder email."
        )

        def fake_plan(_request, _session, _message_text, explicit_scope=None, answer_hints=None):
            confirm_plan = bool(isinstance(answer_hints, dict) and answer_hints.get("confirm_plan"))
            return (
                {
                    "scope": {"mode": explicit_scope or "auto"},
                    "affected_artifacts": [],
                    "affected_modules": [bookings_module_id, workorders_module_id, billing_module_id],
                    "candidate_operations": copy.deepcopy(candidate_ops),
                    "required_questions": [] if confirm_plan else ["Confirm this plan?"],
                    "required_question_meta": None if confirm_plan else {"id": "confirm_plan", "kind": "confirm_plan", "question": "Confirm this plan?"},
                    "resolved_without_changes": False,
                },
                {"status": "ready_to_apply" if confirm_plan else "waiting_input", "affected_modules": [bookings_module_id, workorders_module_id, billing_module_id]},
            )

        with patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()):
            session = client.post("/octo-ai/sessions", json={"title": "Property Services Architecture"}).json()["session"]
        main._ai_update_record(
            main._AI_ENTITY_SESSION,
            session["id"],
            {"sandbox_workspace_id": sandbox_workspace_id, "sandbox_status": "active"},
        )

        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.object(main, "_ai_plan_from_message", side_effect=fake_plan),
        ):
            first_res = client.post(f"/octo-ai/sessions/{session['id']}/chat", json={"message": request_message})
            approve_res = client.post(f"/octo-ai/sessions/{session['id']}/questions/answer", json={"action": "custom", "text": "Approved."})

        first_body = first_res.json()
        approve_body = approve_res.json()
        self.assertEqual(first_res.status_code, 200, first_body)
        self.assertEqual(((first_body.get("plan") or {}).get("required_question_meta") or {}).get("id"), "confirm_plan")
        self.assertEqual(approve_res.status_code, 200, approve_body)
        approved_ops = [op for op in ((approve_body.get("plan") or {}).get("candidate_operations") or []) if isinstance(op, dict)]
        self._assert_candidate_plan_quality(approved_ops)

        patchset_res = client.post(f"/octo-ai/sessions/{session['id']}/patchsets/generate", json={})
        patchset_body = patchset_res.json()
        self.assertEqual(patchset_res.status_code, 200, patchset_body)
        patchset_id = ((patchset_body.get("patchset") or {}).get("id")) or ""
        self.assertTrue(patchset_id)

        apply_res = client.post(f"/octo-ai/patchsets/{patchset_id}/apply", json={"approved": True})
        apply_body = apply_res.json()
        self.assertEqual(apply_res.status_code, 200, apply_body)
        self.assertTrue(apply_body.get("ok"), apply_body)

        sandbox_request = SimpleNamespace(state=SimpleNamespace(cache={}, actor={}))
        with main._ai_ops_workspace_scope(sandbox_request, sandbox_workspace_id, {"workspace_id": sandbox_workspace_id}):
            _bookings_row, bookings_installed = main._get_installed_manifest(sandbox_request, bookings_module_id)
            _workorders_row, workorders_installed = main._get_installed_manifest(sandbox_request, workorders_module_id)
            _billing_row, billing_installed = main._get_installed_manifest(sandbox_request, billing_module_id)
            booking_email = main.email_store.get_template(booking_email_id)
            reminder_email = main.email_store.get_template(reminder_email_id)
            service_report = main.doc_template_store.get(service_report_id)
            booking_confirm = main.automation_store.get(booking_confirm_id)
            completion_invoice = main.automation_store.get(completion_invoice_id)
            overdue_invoice = main.automation_store.get(overdue_invoice_id)

        self._assert_manifest_quality(bookings_installed or {}, primary_entity_id="entity.service_booking")
        self._assert_manifest_quality(workorders_installed or {}, primary_entity_id="entity.service_work_order")
        self._assert_manifest_quality(billing_installed or {}, primary_entity_id="entity.service_invoice")
        self.assertEqual(((booking_email or {}).get("variables_schema") or {}).get("entity_id"), "entity.service_booking")
        self.assertEqual(((reminder_email or {}).get("variables_schema") or {}).get("entity_id"), "entity.service_invoice")
        self.assertEqual(((service_report or {}).get("variables_schema") or {}).get("entity_id"), "entity.service_work_order")
        self.assertIn("confirmed", ((booking_email or {}).get("body_text") or "").lower())
        self.assertIn("service report", ((service_report or {}).get("html") or "").lower())
        self._assert_automation_quality(
            booking_confirm or {},
            expected_action_ids=["system.create_record", "system.send_email"],
            expected_trigger_kind="event",
        )
        self._assert_automation_quality(
            completion_invoice or {},
            expected_action_ids=["system.generate_document", "system.create_record"],
            expected_trigger_kind="event",
        )
        self._assert_automation_quality(
            overdue_invoice or {},
            expected_action_ids=["system.send_email"],
            expected_trigger_kind="event",
        )
        booking_confirm_steps = (booking_confirm or {}).get("steps") or []
        completion_invoice_steps = (completion_invoice or {}).get("steps") or []
        overdue_invoice_steps = (overdue_invoice or {}).get("steps") or []
        self.assertEqual(((booking_confirm_steps[0].get("inputs") or {}).get("entity_id")), "entity.service_work_order")
        self.assertEqual(((booking_confirm_steps[1].get("inputs") or {}).get("template_id")), booking_email_id)
        self.assertEqual(((completion_invoice_steps[0].get("inputs") or {}).get("template_id")), service_report_id)
        self.assertEqual(((completion_invoice_steps[1].get("inputs") or {}).get("entity_id")), "entity.service_invoice")
        self.assertEqual(((overdue_invoice_steps[0].get("inputs") or {}).get("template_id")), reminder_email_id)

    def test_octo_ai_create_module_bundle_for_fleet_maintenance_keeps_vehicle_primary_and_service_history(self) -> None:
        request_message = (
            "Create a module for tracking vehicle maintenance for our fleet, "
            "including service history, odometer readings, assigned drivers, and next service dates."
        )
        bundle = main._ai_build_create_module_bundle(request_message, [], {})
        candidate_ops = [copy.deepcopy(op) for op in (bundle.get("candidate_ops") or []) if isinstance(op, dict)]
        create_module_op = next(op for op in candidate_ops if op.get("op") == "create_module")
        manifest = copy.deepcopy(create_module_op.get("manifest") or {})
        self._assert_manifest_quality(manifest, primary_entity_id="entity.vehicle")
        entities = {
            entity.get("id"): entity
            for entity in (manifest.get("entities") or [])
            if isinstance(entity, dict) and isinstance(entity.get("id"), str)
        }
        self.assertIn("entity.vehicle", entities)
        self.assertIn("entity.maintenance_record", entities)
        vehicle_field_ids = [
            field.get("id")
            for field in (entities["entity.vehicle"].get("fields") or [])
            if isinstance(field, dict) and isinstance(field.get("id"), str)
        ]
        self.assertIn("vehicle.registration_number", vehicle_field_ids)
        self.assertIn("vehicle.odometer", vehicle_field_ids)
        self.assertIn("vehicle.service_due_date", vehicle_field_ids)
        maintenance_field_ids = [
            field.get("id")
            for field in (entities["entity.maintenance_record"].get("fields") or [])
            if isinstance(field, dict) and isinstance(field.get("id"), str)
        ]
        self.assertIn("maintenance_record.vehicle_id", maintenance_field_ids)
        self.assertIn("maintenance_record.service_date", maintenance_field_ids)
        self.assertIn("maintenance_record.service_type", maintenance_field_ids)

    def test_octo_ai_create_module_bundle_for_instagram_influencers_keeps_influencer_primary_and_sent_products(self) -> None:
        request_message = (
            "hi, i want to add a new module to our collection, i want to track instagram influencers "
            "that we are sending products too, we need to track their handle, their coupon code, "
            "maybe track if they were good or not, maybe how many followers / purchases etc, and "
            "line items on what we sent them from our catalog. look at our other modules but dont change them"
        )
        bundle = main._ai_build_create_module_bundle(request_message, [], {})
        candidate_ops = [copy.deepcopy(op) for op in (bundle.get("candidate_ops") or []) if isinstance(op, dict)]
        create_module_op = next(op for op in candidate_ops if op.get("op") == "create_module")
        manifest = copy.deepcopy(create_module_op.get("manifest") or {})
        self.assertEqual(((manifest.get("module") or {}).get("name")), "Influencers")
        self._assert_manifest_quality(manifest, primary_entity_id="entity.influencer")
        entities = {
            entity.get("id"): entity
            for entity in (manifest.get("entities") or [])
            if isinstance(entity, dict) and isinstance(entity.get("id"), str)
        }
        self.assertIn("entity.influencer", entities)
        self.assertIn("entity.sent_product", entities)
        self.assertNotIn("entity.line_item", entities)
        self._assert_entity_field_semantics(
            manifest,
            entity_id="entity.influencer",
            required_suffixes=[
                "instagram_handle",
                "coupon_code",
                "follower_count",
                "purchase_count",
                "performance_rating",
            ],
            banned_suffixes=[
                "catalog_item",
                "spent_by",
                "purchase_amount",
                "sales_amount",
                "amount_owed",
                "margin_amount",
                "owed_to",
                "supplier_name",
            ],
        )
        sent_product_field_ids = [
            field.get("id")
            for field in (entities["entity.sent_product"].get("fields") or [])
            if isinstance(field, dict) and isinstance(field.get("id"), str)
        ]
        self.assertIn("sent_product.influencer_id", sent_product_field_ids)
        self.assertIn("sent_product.catalog_item", sent_product_field_ids)
        self.assertIn("sent_product.quantity", sent_product_field_ids)
        self.assertIn("sent_product.sent_on", sent_product_field_ids)

    def test_octo_ai_create_module_bundle_for_creator_ambassadors_with_catalog_context_keeps_influencer_family(self) -> None:
        request_message = (
            "create a Creator Partners module to track brand ambassadors we send products to from our catalog. "
            "we need their instagram handle, promo code, followers, purchases, whether they were good or not, "
            "and line items for the products sent"
        )
        catalog_manifest = {
            "module": {"id": "catalog", "key": "catalog", "name": "Catalog", "version": "1.0.0"},
            "entities": [
                {
                    "id": "entity.catalog_item",
                    "label": "Catalog Item",
                    "fields": [
                        {"id": "catalog_item.name", "type": "string", "label": "Name"},
                        {"id": "catalog_item.sku", "type": "string", "label": "SKU"},
                    ],
                }
            ],
        }

        bundle = main._ai_build_create_module_bundle(request_message, [], {"catalog": {"manifest": catalog_manifest}})
        candidate_ops = [copy.deepcopy(op) for op in (bundle.get("candidate_ops") or []) if isinstance(op, dict)]
        create_module_op = next(op for op in candidate_ops if op.get("op") == "create_module")
        self.assertEqual(((create_module_op.get("design_spec") or {}).get("family")), "influencer")
        manifest = copy.deepcopy(create_module_op.get("manifest") or {})
        self._assert_manifest_quality(manifest, primary_entity_id="entity.creator_partner")
        entities = {
            entity.get("id"): entity
            for entity in (manifest.get("entities") or [])
            if isinstance(entity, dict) and isinstance(entity.get("id"), str)
        }
        self.assertIn("entity.creator_partner", entities)
        self.assertIn("entity.sent_product", entities)
        self._assert_entity_field_semantics(
            manifest,
            entity_id="entity.creator_partner",
            required_suffixes=[
                "instagram_handle",
                "coupon_code",
                "follower_count",
                "purchase_count",
            ],
            banned_suffixes=[
                "catalog_item",
                "spent_by",
                "purchase_amount",
                "sales_amount",
                "amount_owed",
                "margin_amount",
                "owed_to",
            ],
        )

    def test_octo_ai_create_module_bundle_for_brand_ambassadors_with_catalog_context_avoids_commerce_sludge(self) -> None:
        request_message = (
            "Create a Brand Ambassadors module. We gift products from our catalog to creators and want to track "
            "their instagram handle, promo code, followers, purchases, whether they were a good fit, and the "
            "products we sent them."
        )
        catalog_manifest = {
            "module": {"id": "catalog", "key": "catalog", "name": "Catalog", "version": "1.0.0"},
            "entities": [
                {
                    "id": "entity.catalog_item",
                    "label": "Catalog Item",
                    "fields": [
                        {"id": "catalog_item.name", "type": "string", "label": "Name"},
                        {"id": "catalog_item.sku", "type": "string", "label": "SKU"},
                    ],
                }
            ],
        }

        bundle = main._ai_build_create_module_bundle(request_message, [], {"catalog": {"manifest": catalog_manifest}})
        candidate_ops = [copy.deepcopy(op) for op in (bundle.get("candidate_ops") or []) if isinstance(op, dict)]
        create_module_op = next(op for op in candidate_ops if op.get("op") == "create_module")
        self.assertEqual(((create_module_op.get("design_spec") or {}).get("family")), "influencer")
        manifest = copy.deepcopy(create_module_op.get("manifest") or {})
        self._assert_manifest_quality(manifest, primary_entity_id="entity.brand_ambassador")
        self._assert_entity_field_semantics(
            manifest,
            entity_id="entity.brand_ambassador",
            required_suffixes=[
                "instagram_handle",
                "coupon_code",
                "follower_count",
                "purchase_count",
                "performance_rating",
            ],
            banned_suffixes=[
                "catalog_item",
                "spent_by",
                "purchase_amount",
                "sales_amount",
                "amount_owed",
                "margin_amount",
                "owed_to",
                "sales_channel",
            ],
        )
        entity_ids = [
            entity.get("id")
            for entity in (manifest.get("entities") or [])
            if isinstance(entity, dict) and isinstance(entity.get("id"), str)
        ]
        self.assertIn("entity.sent_product", entity_ids)
        self.assertNotIn("entity.line_item", entity_ids)

    def test_octo_ai_create_module_bundle_for_hiring_pipeline_avoids_sales_pipeline_sludge(self) -> None:
        request_message = (
            "Create a Hiring Pipeline module to track applicants from resume to interview to offer. "
            "We need candidate email, phone number, CV, recruiter owner, interview date, and expected start date."
        )

        bundle = main._ai_build_create_module_bundle(request_message, [], {})
        candidate_ops = [copy.deepcopy(op) for op in (bundle.get("candidate_ops") or []) if isinstance(op, dict)]
        create_module_op = next(op for op in candidate_ops if op.get("op") == "create_module")
        self.assertEqual(((create_module_op.get("design_spec") or {}).get("family")), "recruiting")
        manifest = copy.deepcopy(create_module_op.get("manifest") or {})
        self._assert_manifest_quality(manifest, primary_entity_id="entity.hiring_pipeline")
        self._assert_entity_field_semantics(
            manifest,
            entity_id="entity.hiring_pipeline",
            required_suffixes=[
                "candidate_email",
                "phone_number",
                "recruiter_name",
                "resume_url",
                "interview_date",
                "offer_status",
                "expected_start_date",
            ],
            banned_suffixes=[
                "company_name",
                "contact_name",
                "value",
            ],
        )
        entity_ids = [
            entity.get("id")
            for entity in (manifest.get("entities") or [])
            if isinstance(entity, dict) and isinstance(entity.get("id"), str)
        ]
        self.assertIn("entity.interview_round", entity_ids)

    def test_octo_ai_create_module_bundle_for_supplier_onboarding_avoids_request_sludge(self) -> None:
        request_message = (
            "Create a Supplier Onboarding module for insurance expiry, safety documents, approved categories, "
            "onboarding status, certificate renewals, and review notes before vendors can be approved."
        )

        bundle = main._ai_build_create_module_bundle(request_message, [], {})
        candidate_ops = [copy.deepcopy(op) for op in (bundle.get("candidate_ops") or []) if isinstance(op, dict)]
        create_module_op = next(op for op in candidate_ops if op.get("op") == "create_module")
        self.assertEqual(((create_module_op.get("design_spec") or {}).get("family")), "compliance")
        manifest = copy.deepcopy(create_module_op.get("manifest") or {})
        self._assert_manifest_quality(manifest, primary_entity_id="entity.supplier_onboarding")
        self._assert_entity_field_semantics(
            manifest,
            entity_id="entity.supplier_onboarding",
            required_suffixes=[
                "insurance_expiry",
                "safety_docs",
                "onboarding_status",
                "approved_categories",
                "review_notes",
                "next_review_date",
            ],
            banned_suffixes=[
                "request_type",
                "priority",
                "requested_date",
                "due_date",
                "requester_name",
                "approver_name",
                "amount",
            ],
        )

    def test_octo_ai_create_module_bundle_for_service_operations_avoids_request_sludge(self) -> None:
        request_message = (
            "Create a Service Operations module for work orders, technician scheduling, customer visits, "
            "job notes, service reports, and completion status."
        )

        bundle = main._ai_build_create_module_bundle(request_message, [], {})
        candidate_ops = [copy.deepcopy(op) for op in (bundle.get("candidate_ops") or []) if isinstance(op, dict)]
        create_module_op = next(op for op in candidate_ops if op.get("op") == "create_module")
        self.assertEqual(((create_module_op.get("design_spec") or {}).get("family")), "field_service")
        manifest = copy.deepcopy(create_module_op.get("manifest") or {})
        self._assert_manifest_quality(manifest, primary_entity_id="entity.work_order")
        self._assert_entity_field_semantics(
            manifest,
            entity_id="entity.work_order",
            required_suffixes=[
                "customer_name",
                "site_address",
                "technician_name",
                "scheduled_start",
                "scheduled_end",
                "completion_notes",
            ],
            banned_suffixes=[
                "client_name",
                "request_type",
                "requested_date",
                "requester_name",
                "approver_name",
                "amount",
            ],
        )
        entity_ids = [
            entity.get("id")
            for entity in (manifest.get("entities") or [])
            if isinstance(entity, dict) and isinstance(entity.get("id"), str)
        ]
        self.assertIn("entity.job_note", entity_ids)

    def test_octo_ai_create_module_bundle_for_dispatch_board_keeps_dispatch_shape(self) -> None:
        request_message = (
            "Create a Dispatch Board module for technician assignments, route planning, daily routes, "
            "service windows, crew assignment, and dispatch notes."
        )

        bundle = main._ai_build_create_module_bundle(request_message, [], {})
        candidate_ops = [copy.deepcopy(op) for op in (bundle.get("candidate_ops") or []) if isinstance(op, dict)]
        create_module_op = next(op for op in candidate_ops if op.get("op") == "create_module")
        self.assertEqual(((create_module_op.get("design_spec") or {}).get("family")), "field_service")
        manifest = copy.deepcopy(create_module_op.get("manifest") or {})
        self._assert_manifest_quality(manifest, primary_entity_id="entity.dispatch")
        self._assert_entity_field_semantics(
            manifest,
            entity_id="entity.dispatch",
            required_suffixes=[
                "assigned_technician",
                "route_name",
                "dispatch_date",
                "service_window_start",
                "service_window_end",
                "dispatch_notes",
            ],
            banned_suffixes=[
                "technician_name",
                "scheduled_start",
                "scheduled_end",
                "completion_notes",
                "request_type",
                "requested_date",
                "requester_name",
                "approver_name",
                "amount",
            ],
        )
        entity_ids = [
            entity.get("id")
            for entity in (manifest.get("entities") or [])
            if isinstance(entity, dict) and isinstance(entity.get("id"), str)
        ]
        self.assertIn("entity.route_stop", entity_ids)

    def test_octo_ai_create_module_bundle_for_service_desk_keeps_ticket_shape(self) -> None:
        request_message = (
            "Create a Service Desk module for customer tickets, help desk inbox, issue type, priority, "
            "SLA response times, assigned agents, and resolution notes."
        )

        bundle = main._ai_build_create_module_bundle(request_message, [], {})
        candidate_ops = [copy.deepcopy(op) for op in (bundle.get("candidate_ops") or []) if isinstance(op, dict)]
        create_module_op = next(op for op in candidate_ops if op.get("op") == "create_module")
        self.assertEqual(((create_module_op.get("design_spec") or {}).get("family")), "service_desk")
        manifest = copy.deepcopy(create_module_op.get("manifest") or {})
        self._assert_manifest_quality(manifest, primary_entity_id="entity.ticket")
        self._assert_entity_field_semantics(
            manifest,
            entity_id="entity.ticket",
            required_suffixes=[
                "customer_name",
                "customer_email",
                "issue_type",
                "assigned_agent",
                "response_due_at",
                "resolution_summary",
            ],
            banned_suffixes=[
                "request_type",
                "requested_date",
                "requester_name",
                "approver_name",
                "amount",
                "technician_name",
                "scheduled_start",
                "scheduled_end",
                "service_window_start",
                "service_window_end",
                "route_name",
            ],
        )
        entity_ids = [
            entity.get("id")
            for entity in (manifest.get("entities") or [])
            if isinstance(entity, dict) and isinstance(entity.get("id"), str)
        ]
        self.assertIn("entity.internal_note", entity_ids)

    def test_octo_ai_create_module_bundle_for_equipment_maintenance_register_avoids_request_sludge(self) -> None:
        request_message = (
            "Create an Equipment Maintenance Register to track tools and equipment, service history, "
            "next service dates, condition, location, and maintenance logs."
        )

        bundle = main._ai_build_create_module_bundle(request_message, [], {})
        candidate_ops = [copy.deepcopy(op) for op in (bundle.get("candidate_ops") or []) if isinstance(op, dict)]
        create_module_op = next(op for op in candidate_ops if op.get("op") == "create_module")
        self.assertEqual(((create_module_op.get("design_spec") or {}).get("family")), "fleet")
        manifest = copy.deepcopy(create_module_op.get("manifest") or {})
        self._assert_manifest_quality(manifest, primary_entity_id="entity.asset")
        self._assert_entity_field_semantics(
            manifest,
            entity_id="entity.asset",
            required_suffixes=[
                "service_due_date",
                "last_service_date",
                "location",
                "condition",
            ],
            banned_suffixes=[
                "request_type",
                "requested_date",
                "requester_name",
                "approver_name",
                "amount",
            ],
        )
        entity_ids = [
            entity.get("id")
            for entity in (manifest.get("entities") or [])
            if isinstance(entity, dict) and isinstance(entity.get("id"), str)
        ]
        self.assertIn("entity.maintenance_record", entity_ids)

    def test_octo_ai_create_module_bundle_for_audit_findings_avoids_compliance_sludge(self) -> None:
        request_message = (
            "Create an Audit Findings module to track audit findings, severity, root cause analysis, "
            "corrective actions, corrective due dates, and follow up actions."
        )

        bundle = main._ai_build_create_module_bundle(request_message, [], {})
        candidate_ops = [copy.deepcopy(op) for op in (bundle.get("candidate_ops") or []) if isinstance(op, dict)]
        create_module_op = next(op for op in candidate_ops if op.get("op") == "create_module")
        self.assertEqual(((create_module_op.get("design_spec") or {}).get("family")), "incident")
        manifest = copy.deepcopy(create_module_op.get("manifest") or {})
        self._assert_manifest_quality(manifest, primary_entity_id="entity.audit_finding")
        self._assert_entity_field_semantics(
            manifest,
            entity_id="entity.audit_finding",
            required_suffixes=[
                "reported_on",
                "severity",
                "root_cause",
                "follow_up",
                "corrective_action_owner",
                "corrective_due_date",
            ],
            banned_suffixes=[
                "insurance_expiry",
                "safety_docs",
                "approved_categories",
                "review_notes",
                "approval_date",
                "next_review_date",
                "certificate_reference",
                "request_type",
                "requested_date",
                "requester_name",
                "approver_name",
                "amount",
            ],
        )
        workflow = next(
            (
                item
                for item in (manifest.get("workflows") or [])
                if isinstance(item, dict) and item.get("entity") == "entity.audit_finding"
            ),
            None,
        )
        self.assertIsInstance(workflow, dict)
        state_ids = [
            item.get("id")
            for item in (workflow.get("states") or [])
            if isinstance(item, dict) and isinstance(item.get("id"), str)
        ]
        self.assertEqual(state_ids, ["reported", "investigating", "corrective_action_pending", "closed"])
        action_labels = [
            item.get("label")
            for item in (manifest.get("actions") or [])
            if isinstance(item, dict)
            and item.get("kind") == "update_record"
            and item.get("entity_id") == "entity.audit_finding"
            and isinstance(item.get("label"), str)
        ]
        self.assertIn("Start Investigation", action_labels)
        self.assertIn("Assign Corrective Action", action_labels)
        self.assertIn("Close", action_labels)

    def test_octo_ai_create_module_bundle_for_safety_incidents_includes_closeout_workflow(self) -> None:
        request_message = (
            "Create a Safety Incidents module to track incidents and near misses with incident type, severity, "
            "reported on date, root cause analysis, corrective action owner, corrective due date, closeout summary, and closure date."
        )

        bundle = main._ai_build_create_module_bundle(request_message, [], {})
        candidate_ops = [copy.deepcopy(op) for op in (bundle.get("candidate_ops") or []) if isinstance(op, dict)]
        create_module_op = next(op for op in candidate_ops if op.get("op") == "create_module")
        self.assertEqual(((create_module_op.get("design_spec") or {}).get("family")), "incident")
        manifest = copy.deepcopy(create_module_op.get("manifest") or {})
        self._assert_manifest_quality(manifest, primary_entity_id="entity.safety_incident")
        self._assert_entity_field_semantics(
            manifest,
            entity_id="entity.safety_incident",
            required_suffixes=[
                "incident_type",
                "severity",
                "root_cause",
                "corrective_action_owner",
                "corrective_due_date",
                "closeout_summary",
                "closed_on",
            ],
            banned_suffixes=[
                "approved_categories",
                "review_notes",
                "request_type",
                "requested_date",
                "requester_name",
                "approver_name",
            ],
        )
        workflow = next(
            (
                item
                for item in (manifest.get("workflows") or [])
                if isinstance(item, dict) and item.get("entity") == "entity.safety_incident"
            ),
            None,
        )
        self.assertIsInstance(workflow, dict)
        state_ids = [
            item.get("id")
            for item in (workflow.get("states") or [])
            if isinstance(item, dict) and isinstance(item.get("id"), str)
        ]
        self.assertEqual(state_ids, ["reported", "investigating", "corrective_action_pending", "closed"])

    def test_octo_ai_create_module_bundle_for_safety_incidents_adds_alert_and_reminder_automations(self) -> None:
        request_message = (
            "Create a Safety Incidents module to track incidents and near misses with incident type, severity, "
            "reported on date, root cause analysis, corrective action owner, corrective due date, closeout summary, and closure date. "
            "Email safety@octodrop.com when a critical incident is reported, and send a reminder email to safety@octodrop.com "
            "when corrective action is pending."
        )

        bundle = main._ai_build_create_module_bundle(request_message, [], {})
        candidate_ops = [copy.deepcopy(op) for op in (bundle.get("candidate_ops") or []) if isinstance(op, dict)]
        create_module_op = next(op for op in candidate_ops if op.get("op") == "create_module")
        self.assertEqual(((create_module_op.get("design_spec") or {}).get("family")), "incident")

        automation_ops = [op for op in candidate_ops if op.get("op") == "create_automation_record"]
        self.assertEqual(len(automation_ops), 2)

        automations_by_name = {
            (op.get("automation") or {}).get("name"): (op.get("automation") or {})
            for op in automation_ops
            if isinstance((op.get("automation") or {}).get("name"), str)
        }
        critical = automations_by_name.get("Critical Incident Alert") or {}
        reminder = automations_by_name.get("Corrective Action Reminder") or {}

        self._assert_automation_quality(critical, expected_action_ids=["system.send_email"], expected_trigger_kind="event")
        critical_filters = ((critical.get("trigger") or {}).get("filters") or [])
        self.assertTrue(any(isinstance(item, dict) and item.get("path") == "to" and item.get("value") == "reported" for item in critical_filters))
        self.assertTrue(any(isinstance(item, dict) and item.get("path") == "record.severity" and item.get("value") == "critical" for item in critical_filters))
        critical_inputs = (((critical.get("steps") or [{}])[-1].get("inputs")) or {})
        self.assertEqual(critical_inputs.get("to"), "safety@octodrop.com")

        reminder_trigger = reminder.get("trigger") or {}
        self.assertEqual(reminder_trigger.get("kind"), "event")
        reminder_filters = ((reminder.get("trigger") or {}).get("filters") or [])
        self.assertTrue(any(isinstance(item, dict) and item.get("path") == "to" and item.get("value") == "corrective_action_pending" for item in reminder_filters))
        reminder_steps = reminder.get("steps") or []
        self.assertEqual(reminder_steps[0].get("kind"), "delay")
        self.assertEqual(reminder_steps[0].get("seconds"), 86400)
        self.assertEqual(reminder_steps[-1].get("action_id"), "system.send_email")
        reminder_inputs = (((reminder_steps[-1].get("inputs")) or {}))
        self.assertEqual(reminder_inputs.get("to"), "safety@octodrop.com")

    def test_octo_ai_create_module_bundle_for_service_desk_notifies_assigned_agent(self) -> None:
        request_message = (
            "Create a Service Desk module for customer tickets, issue type, priority, SLA response times, "
            "assigned agents, and resolution notes. Notify the assigned agent when a ticket is resolved."
        )

        bundle = main._ai_build_create_module_bundle(request_message, [], {})
        candidate_ops = [copy.deepcopy(op) for op in (bundle.get("candidate_ops") or []) if isinstance(op, dict)]
        create_module_op = next(op for op in candidate_ops if op.get("op") == "create_module")
        self.assertEqual(((create_module_op.get("design_spec") or {}).get("family")), "service_desk")
        manifest = copy.deepcopy(create_module_op.get("manifest") or {})
        self._assert_manifest_quality(manifest, primary_entity_id="entity.ticket")
        ticket_entity = next(
            item for item in (manifest.get("entities") or [])
            if isinstance(item, dict) and item.get("id") == "entity.ticket"
        )
        ticket_fields = {
            field.get("id"): field
            for field in (ticket_entity.get("fields") or [])
            if isinstance(field, dict) and isinstance(field.get("id"), str)
        }
        self.assertEqual((ticket_fields.get("ticket.assigned_agent") or {}).get("type"), "user")

        automation_ops = [op for op in candidate_ops if op.get("op") == "create_automation_record"]
        self.assertEqual(len(automation_ops), 1)
        automation = (automation_ops[0].get("automation") or {})
        self._assert_automation_quality(automation, expected_action_ids=["system.notify"], expected_trigger_kind="event")
        filters = ((automation.get("trigger") or {}).get("filters") or [])
        self.assertTrue(any(isinstance(item, dict) and item.get("path") == "to" and item.get("value") == "resolved" for item in filters))
        step_inputs = (((automation.get("steps") or [{}])[-1].get("inputs")) or {})
        self.assertEqual(step_inputs.get("recipient_user_ids"), [{"var": "trigger.record.fields.assigned_agent"}])

    def test_octo_ai_create_module_bundle_for_service_desk_notifies_named_workspace_member(self) -> None:
        request_message = (
            "Create a Service Desk module for customer tickets, issue type, priority, SLA response times, "
            "assigned agents, and resolution notes. Notify Ops when a ticket is resolved."
        )

        with patch.object(
            main,
            "list_workspace_members",
            lambda workspace_id: [
                {"user_id": "user-ops", "email": "ops@example.com", "full_name": "Ops", "role": "member"},
                {"user_id": "user-admin", "email": "admin@example.com", "full_name": "Admin", "role": "admin"},
            ],
        ):
            bundle = main._ai_build_create_module_bundle(request_message, [], {})
        candidate_ops = [copy.deepcopy(op) for op in (bundle.get("candidate_ops") or []) if isinstance(op, dict)]
        create_module_op = next(op for op in candidate_ops if op.get("op") == "create_module")
        self.assertEqual(((create_module_op.get("design_spec") or {}).get("family")), "service_desk")

        automation_ops = [op for op in candidate_ops if op.get("op") == "create_automation_record"]
        self.assertEqual(len(automation_ops), 1)
        automation = (automation_ops[0].get("automation") or {})
        self._assert_automation_quality(automation, expected_action_ids=["system.notify"], expected_trigger_kind="event")
        filters = ((automation.get("trigger") or {}).get("filters") or [])
        self.assertTrue(any(isinstance(item, dict) and item.get("path") == "to" and item.get("value") == "resolved" for item in filters))
        step_inputs = (((automation.get("steps") or [{}])[-1].get("inputs")) or {})
        self.assertEqual(step_inputs.get("recipient_user_ids"), ["user-ops"])

    def test_octo_ai_create_module_bundle_for_service_desk_notifies_named_workspace_team(self) -> None:
        request_message = (
            "Create a Service Desk module for customer tickets, issue type, priority, SLA response times, "
            "assigned agents, and resolution notes. Notify Finance when a ticket is resolved."
        )

        with patch.object(
            main,
            "list_workspace_members",
            lambda workspace_id: [
                {
                    "user_id": "user-finance-lead",
                    "email": "finance.lead@example.com",
                    "full_name": "Finance Lead",
                    "title": "Finance",
                    "role": "member",
                },
                {
                    "user_id": "user-finance-analyst",
                    "email": "finance.analyst@example.com",
                    "full_name": "Finance Analyst",
                    "department": "Finance",
                    "role": "member",
                },
                {"user_id": "user-ops", "email": "ops@example.com", "full_name": "Ops", "role": "member"},
            ],
        ):
            bundle = main._ai_build_create_module_bundle(request_message, [], {})
        candidate_ops = [copy.deepcopy(op) for op in (bundle.get("candidate_ops") or []) if isinstance(op, dict)]
        create_module_op = next(op for op in candidate_ops if op.get("op") == "create_module")
        self.assertEqual(((create_module_op.get("design_spec") or {}).get("family")), "service_desk")

        automation_ops = [op for op in candidate_ops if op.get("op") == "create_automation_record"]
        self.assertEqual(len(automation_ops), 1)
        automation = (automation_ops[0].get("automation") or {})
        self._assert_automation_quality(automation, expected_action_ids=["system.notify"], expected_trigger_kind="event")
        filters = ((automation.get("trigger") or {}).get("filters") or [])
        self.assertTrue(any(isinstance(item, dict) and item.get("path") == "to" and item.get("value") == "resolved" for item in filters))
        step_inputs = (((automation.get("steps") or [{}])[-1].get("inputs")) or {})
        self.assertEqual(step_inputs.get("recipient_user_ids"), ["user-finance-lead", "user-finance-analyst"])

    def test_octo_ai_create_module_bundle_for_service_desk_notifies_indirect_role_group(self) -> None:
        request_message = (
            "Create a Service Desk module for customer tickets, issue type, priority, SLA response times, "
            "assigned agents, and resolution notes. Notify the account managers when a ticket is resolved."
        )

        with patch.object(
            main,
            "list_workspace_members",
            lambda workspace_id: [
                {
                    "user_id": "user-csm",
                    "email": "ava@example.com",
                    "full_name": "Ava Cole",
                    "title": "Customer Success Manager",
                    "role": "member",
                },
                {
                    "user_id": "user-client-success",
                    "email": "milo@example.com",
                    "full_name": "Milo Hart",
                    "job_title": "Client Success Manager",
                    "role": "member",
                },
                {
                    "user_id": "user-finance",
                    "email": "finance@example.com",
                    "full_name": "Finance Lead",
                    "department": "Finance",
                    "role": "member",
                },
            ],
        ):
            bundle = main._ai_build_create_module_bundle(request_message, [], {})
        candidate_ops = [copy.deepcopy(op) for op in (bundle.get("candidate_ops") or []) if isinstance(op, dict)]
        create_module_op = next(op for op in candidate_ops if op.get("op") == "create_module")
        self.assertEqual(((create_module_op.get("design_spec") or {}).get("family")), "service_desk")

        automation_ops = [op for op in candidate_ops if op.get("op") == "create_automation_record"]
        self.assertEqual(len(automation_ops), 1)
        automation = (automation_ops[0].get("automation") or {})
        self._assert_automation_quality(automation, expected_action_ids=["system.notify"], expected_trigger_kind="event")
        filters = ((automation.get("trigger") or {}).get("filters") or [])
        self.assertTrue(any(isinstance(item, dict) and item.get("path") == "to" and item.get("value") == "resolved" for item in filters))
        step_inputs = (((automation.get("steps") or [{}])[-1].get("inputs")) or {})
        self.assertEqual(step_inputs.get("recipient_user_ids"), ["user-csm", "user-client-success"])

    def test_octo_ai_create_module_bundle_for_safety_incidents_reminds_corrective_action_owner(self) -> None:
        request_message = (
            "Create a Safety Incidents module to track incidents and near misses with incident type, severity, "
            "root cause analysis, corrective action owner, corrective due date, and closeout summary. "
            "Remind the corrective action owner when corrective action is pending."
        )

        bundle = main._ai_build_create_module_bundle(request_message, [], {})
        candidate_ops = [copy.deepcopy(op) for op in (bundle.get("candidate_ops") or []) if isinstance(op, dict)]
        create_module_op = next(op for op in candidate_ops if op.get("op") == "create_module")
        self.assertEqual(((create_module_op.get("design_spec") or {}).get("family")), "incident")
        manifest = copy.deepcopy(create_module_op.get("manifest") or {})
        self._assert_manifest_quality(manifest, primary_entity_id="entity.safety_incident")
        incident_entity = next(
            item for item in (manifest.get("entities") or [])
            if isinstance(item, dict) and item.get("id") == "entity.safety_incident"
        )
        incident_fields = {
            field.get("id"): field
            for field in (incident_entity.get("fields") or [])
            if isinstance(field, dict) and isinstance(field.get("id"), str)
        }
        self.assertEqual((incident_fields.get("safety_incident.corrective_action_owner") or {}).get("type"), "user")

        automation_ops = [op for op in candidate_ops if op.get("op") == "create_automation_record"]
        reminder_op = next(op for op in automation_ops if ((op.get("automation") or {}).get("name")) == "Corrective Action Reminder")
        reminder = reminder_op.get("automation") or {}
        reminder_filters = ((reminder.get("trigger") or {}).get("filters") or [])
        self.assertTrue(any(isinstance(item, dict) and item.get("path") == "to" and item.get("value") == "corrective_action_pending" for item in reminder_filters))
        reminder_steps = reminder.get("steps") or []
        self.assertEqual(reminder_steps[0].get("kind"), "delay")
        self.assertEqual(reminder_steps[0].get("seconds"), 86400)
        self.assertEqual(reminder_steps[-1].get("action_id"), "system.notify")
        reminder_inputs = (((reminder_steps[-1].get("inputs")) or {}))
        self.assertEqual(reminder_inputs.get("recipient_user_ids"), [{"var": "trigger.record.fields.corrective_action_owner"}])

    def test_octo_ai_create_module_bundle_reuses_named_workspace_templates_for_existing_draft_steps(self) -> None:
        manifest = main._build_scaffold_single_entity(
            "jobs",
            "Jobs",
            "job",
            "Job",
            [
                {"id": "job.name", "type": "string", "label": "Job", "required": True},
                {"id": "job.customer_email", "type": "string", "label": "Customer Email"},
            ],
            nav_label="Jobs",
        )
        package = {
            "manifest": manifest,
            "design_spec": {"family": "field_service", "entity_slug": "job", "entity_label": "Job"},
            "quality": {},
            "automation_ops": [
                {
                    "op": "create_automation_record",
                    "artifact_type": "automation",
                    "artifact_id": "auto_job_completion_customer_follow_up",
                    "automation": {
                        "name": "Job Completion Customer Follow-up",
                        "status": "draft",
                        "trigger": {"kind": "event", "event_types": ["workflow.status_changed"], "filters": [{"path": "to", "op": "eq", "value": "completed"}]},
                        "steps": [
                            {
                                "id": "step_send_email",
                                "kind": "action",
                                "action_id": "system.send_email",
                                "inputs": {
                                    "entity_id": "entity.job",
                                    "to_field_ids": ["job.customer_email"],
                                    "subject": "Your job is complete",
                                    "body_text": "Please review the completion pack.",
                                },
                            },
                            {
                                "id": "step_generate_pack",
                                "kind": "action",
                                "action_id": "system.generate_document",
                                "inputs": {
                                    "entity_id": "entity.job",
                                    "record_id": "{{trigger.record_id}}",
                                },
                            },
                        ],
                    },
                }
            ],
        }

        with (
            patch.object(main, "_ai_extract_requested_new_module_labels", lambda *args, **kwargs: ["Jobs"]),
            patch.object(main, "_ai_build_new_module_package", lambda *args, **kwargs: copy.deepcopy(package)),
            patch.object(
                main,
                "_ai_workspace_template_decision_options",
                lambda kind, workspace_id, limit=8: (
                    [
                        {
                            "id": "email_tpl_completion_follow_up",
                            "label": "Completion Follow-up",
                            "value": "email_tpl_completion_follow_up",
                            "hints": {"email_template_id": "email_tpl_completion_follow_up"},
                        }
                    ]
                    if kind == "email_template"
                    else [
                        {
                            "id": "doc_tpl_completion_pack",
                            "label": "Completion Pack",
                            "value": "doc_tpl_completion_pack",
                            "hints": {"document_template_id": "doc_tpl_completion_pack"},
                        }
                    ]
                ),
            ),
        ):
            bundle = main._ai_build_create_module_bundle(
                "Create a Jobs module. When a job is completed send the Completion Follow-up email template to the customer and generate the Completion Pack document template.",
                [],
                {},
            )

        candidate_ops = [copy.deepcopy(op) for op in (bundle.get("candidate_ops") or []) if isinstance(op, dict)]
        self._assert_candidate_plan_quality(
            candidate_ops,
            allowed_email_template_ids={"email_tpl_completion_follow_up"},
            allowed_document_template_ids={"doc_tpl_completion_pack"},
        )
        automation_ops = [op for op in candidate_ops if op.get("op") == "create_automation_record"]
        self.assertEqual(len(automation_ops), 1)
        automation = (automation_ops[0].get("automation") or {})
        self._assert_automation_quality(
            automation,
            expected_action_ids=["system.send_email", "system.generate_document"],
            expected_trigger_kind="event",
        )
        steps = automation.get("steps") or []
        email_inputs = (steps[0].get("inputs") or {}) if steps and isinstance(steps[0], dict) else {}
        document_inputs = (steps[1].get("inputs") or {}) if len(steps) > 1 and isinstance(steps[1], dict) else {}
        self.assertEqual(email_inputs.get("template_id"), "email_tpl_completion_follow_up")
        self.assertNotIn("subject", email_inputs)
        self.assertNotIn("body_text", email_inputs)
        self.assertEqual(document_inputs.get("template_id"), "doc_tpl_completion_pack")

    def test_octo_ai_create_module_bundle_matches_existing_workspace_templates_from_partial_aliases(self) -> None:
        manifest = main._build_scaffold_single_entity(
            "jobs",
            "Jobs",
            "job",
            "Job",
            [
                {"id": "job.name", "type": "string", "label": "Job", "required": True},
                {"id": "job.customer_email", "type": "string", "label": "Customer Email"},
            ],
            nav_label="Jobs",
        )
        package = {
            "manifest": manifest,
            "design_spec": {"family": "field_service", "entity_slug": "job", "entity_label": "Job"},
            "quality": {},
            "automation_ops": [
                {
                    "op": "create_automation_record",
                    "artifact_type": "automation",
                    "artifact_id": "auto_job_completion_customer_follow_up",
                    "automation": {
                        "name": "Job Completion Customer Follow-up",
                        "status": "draft",
                        "trigger": {"kind": "event", "event_types": ["workflow.status_changed"], "filters": [{"path": "to", "op": "eq", "value": "completed"}]},
                        "steps": [
                            {
                                "id": "step_send_email",
                                "kind": "action",
                                "action_id": "system.send_email",
                                "inputs": {
                                    "entity_id": "entity.job",
                                    "to_field_ids": ["job.customer_email"],
                                    "subject": "Your job is complete",
                                    "body_text": "Please review the attached documents.",
                                },
                            },
                            {
                                "id": "step_generate_pack",
                                "kind": "action",
                                "action_id": "system.generate_document",
                                "inputs": {
                                    "entity_id": "entity.job",
                                    "record_id": "{{trigger.record_id}}",
                                },
                            },
                        ],
                    },
                }
            ],
        }

        with (
            patch.object(main, "_ai_extract_requested_new_module_labels", lambda *args, **kwargs: ["Jobs"]),
            patch.object(main, "_ai_build_new_module_package", lambda *args, **kwargs: copy.deepcopy(package)),
            patch.object(
                main,
                "_ai_workspace_template_decision_options",
                lambda kind, workspace_id, limit=8: (
                    [
                        {
                            "id": "email_tpl_completion_approved",
                            "label": "Completion Approved",
                            "value": "email_tpl_completion_approved",
                            "hints": {"email_template_id": "email_tpl_completion_approved"},
                        },
                        {
                            "id": "email_tpl_customer_notice",
                            "label": "Customer Notice",
                            "value": "email_tpl_customer_notice",
                            "hints": {"email_template_id": "email_tpl_customer_notice"},
                        },
                    ]
                    if kind == "email_template"
                    else [
                        {
                            "id": "doc_tpl_job_completion_pack",
                            "label": "Job Completion Pack",
                            "value": "doc_tpl_job_completion_pack",
                            "hints": {"document_template_id": "doc_tpl_job_completion_pack"},
                        },
                        {
                            "id": "doc_tpl_service_report",
                            "label": "Service Report",
                            "value": "doc_tpl_service_report",
                            "hints": {"document_template_id": "doc_tpl_service_report"},
                        },
                    ]
                ),
            ),
        ):
            bundle = main._ai_build_create_module_bundle(
                "Create a Jobs module. When a job is completed, use our completion approval email for the customer and generate the existing completion pack.",
                [],
                {},
            )

        candidate_ops = [copy.deepcopy(op) for op in (bundle.get("candidate_ops") or []) if isinstance(op, dict)]
        self._assert_candidate_plan_quality(
            candidate_ops,
            allowed_email_template_ids={"email_tpl_completion_approved"},
            allowed_document_template_ids={"doc_tpl_job_completion_pack"},
        )
        automation_ops = [op for op in candidate_ops if op.get("op") == "create_automation_record"]
        self.assertEqual(len(automation_ops), 1)
        automation = (automation_ops[0].get("automation") or {})
        self._assert_automation_quality(
            automation,
            expected_action_ids=["system.send_email", "system.generate_document"],
            expected_trigger_kind="event",
        )
        steps = automation.get("steps") or []
        email_inputs = (steps[0].get("inputs") or {}) if steps and isinstance(steps[0], dict) else {}
        document_inputs = (steps[1].get("inputs") or {}) if len(steps) > 1 and isinstance(steps[1], dict) else {}
        self.assertEqual(email_inputs.get("template_id"), "email_tpl_completion_approved")
        self.assertNotIn("subject", email_inputs)
        self.assertNotIn("body_text", email_inputs)
        self.assertEqual(document_inputs.get("template_id"), "doc_tpl_job_completion_pack")

    def test_octo_ai_create_module_bundle_prefers_workspace_templates_matching_step_entity_when_names_tie(self) -> None:
        manifest = main._build_scaffold_single_entity(
            "jobs",
            "Jobs",
            "job",
            "Job",
            [
                {"id": "job.name", "type": "string", "label": "Job", "required": True},
                {"id": "job.customer_email", "type": "string", "label": "Customer Email"},
            ],
            nav_label="Jobs",
        )
        package = {
            "manifest": manifest,
            "design_spec": {"family": "field_service", "entity_slug": "job", "entity_label": "Job"},
            "quality": {},
            "automation_ops": [
                {
                    "op": "create_automation_record",
                    "artifact_type": "automation",
                    "artifact_id": "auto_job_completion_customer_follow_up",
                    "automation": {
                        "name": "Job Completion Customer Follow-up",
                        "status": "draft",
                        "trigger": {"kind": "event", "event_types": ["workflow.status_changed"], "filters": [{"path": "to", "op": "eq", "value": "completed"}]},
                        "steps": [
                            {
                                "id": "step_send_email",
                                "kind": "action",
                                "action_id": "system.send_email",
                                "inputs": {
                                    "entity_id": "entity.job",
                                    "to_field_ids": ["job.customer_email"],
                                    "subject": "Your job is complete",
                                    "body_text": "Please review the attached documents.",
                                },
                            },
                            {
                                "id": "step_generate_pack",
                                "kind": "action",
                                "action_id": "system.generate_document",
                                "inputs": {
                                    "entity_id": "entity.job",
                                    "record_id": "{{trigger.record_id}}",
                                },
                            },
                        ],
                    },
                }
            ],
        }

        with (
            patch.object(main, "_ai_extract_requested_new_module_labels", lambda *args, **kwargs: ["Jobs"]),
            patch.object(main, "_ai_build_new_module_package", lambda *args, **kwargs: copy.deepcopy(package)),
            patch.object(
                main,
                "_ai_workspace_template_decision_options",
                lambda kind, workspace_id, limit=8: (
                    [
                        {
                            "id": "email_tpl_completion_approved_quote",
                            "label": "Completion Approved",
                            "value": "email_tpl_completion_approved_quote",
                            "hints": {
                                "email_template_id": "email_tpl_completion_approved_quote",
                                "entity_id": "entity.quote",
                            },
                        },
                        {
                            "id": "email_tpl_completion_approved_job",
                            "label": "Completion Approved",
                            "value": "email_tpl_completion_approved_job",
                            "hints": {
                                "email_template_id": "email_tpl_completion_approved_job",
                                "entity_id": "entity.job",
                            },
                        },
                    ]
                    if kind == "email_template"
                    else [
                        {
                            "id": "doc_tpl_completion_pack_quote",
                            "label": "Completion Pack",
                            "value": "doc_tpl_completion_pack_quote",
                            "hints": {
                                "document_template_id": "doc_tpl_completion_pack_quote",
                                "entity_id": "entity.quote",
                            },
                        },
                        {
                            "id": "doc_tpl_completion_pack_job",
                            "label": "Completion Pack",
                            "value": "doc_tpl_completion_pack_job",
                            "hints": {
                                "document_template_id": "doc_tpl_completion_pack_job",
                                "entity_id": "entity.job",
                            },
                        },
                    ]
                ),
            ),
        ):
            bundle = main._ai_build_create_module_bundle(
                "Create a Jobs module. When a job is completed, use our completion approved email for the customer and generate the existing completion pack.",
                [],
                {},
            )

        candidate_ops = [copy.deepcopy(op) for op in (bundle.get("candidate_ops") or []) if isinstance(op, dict)]
        self._assert_candidate_plan_quality(
            candidate_ops,
            allowed_email_template_ids={"email_tpl_completion_approved_job"},
            allowed_document_template_ids={"doc_tpl_completion_pack_job"},
        )
        automation_ops = [op for op in candidate_ops if op.get("op") == "create_automation_record"]
        self.assertEqual(len(automation_ops), 1)
        automation = (automation_ops[0].get("automation") or {})
        self._assert_automation_quality(
            automation,
            expected_action_ids=["system.send_email", "system.generate_document"],
            expected_trigger_kind="event",
        )
        steps = automation.get("steps") or []
        email_inputs = (steps[0].get("inputs") or {}) if steps and isinstance(steps[0], dict) else {}
        document_inputs = (steps[1].get("inputs") or {}) if len(steps) > 1 and isinstance(steps[1], dict) else {}
        self.assertEqual(email_inputs.get("template_id"), "email_tpl_completion_approved_job")
        self.assertEqual(document_inputs.get("template_id"), "doc_tpl_completion_pack_job")

    def test_octo_ai_create_module_bundle_prefers_workspace_templates_matching_message_purpose_when_labels_tie(self) -> None:
        manifest = main._build_scaffold_single_entity(
            "jobs",
            "Jobs",
            "job",
            "Job",
            [
                {"id": "job.name", "type": "string", "label": "Job", "required": True},
                {"id": "job.customer_email", "type": "string", "label": "Customer Email"},
            ],
            nav_label="Jobs",
        )
        package = {
            "manifest": manifest,
            "design_spec": {"family": "field_service", "entity_slug": "job", "entity_label": "Job"},
            "quality": {},
            "automation_ops": [
                {
                    "op": "create_automation_record",
                    "artifact_type": "automation",
                    "artifact_id": "auto_job_completion_customer_follow_up",
                    "automation": {
                        "name": "Job Completion Customer Follow-up",
                        "status": "draft",
                        "trigger": {"kind": "event", "event_types": ["workflow.status_changed"], "filters": [{"path": "to", "op": "eq", "value": "completed"}]},
                        "steps": [
                            {
                                "id": "step_send_email",
                                "kind": "action",
                                "action_id": "system.send_email",
                                "inputs": {
                                    "entity_id": "entity.job",
                                    "to_field_ids": ["job.customer_email"],
                                    "subject": "Your job is complete",
                                    "body_text": "Please review the attached documents.",
                                },
                            },
                            {
                                "id": "step_generate_pack",
                                "kind": "action",
                                "action_id": "system.generate_document",
                                "inputs": {
                                    "entity_id": "entity.job",
                                    "record_id": "{{trigger.record_id}}",
                                },
                            },
                        ],
                    },
                }
            ],
        }

        with (
            patch.object(main, "_ai_extract_requested_new_module_labels", lambda *args, **kwargs: ["Jobs"]),
            patch.object(main, "_ai_build_new_module_package", lambda *args, **kwargs: copy.deepcopy(package)),
            patch.object(
                main,
                "_ai_workspace_template_decision_options",
                lambda kind, workspace_id, limit=8: (
                    [
                        {
                            "id": "email_tpl_job_customer_update",
                            "label": "Job Customer Update",
                            "value": "email_tpl_job_customer_update",
                            "description": "Reminder about upcoming work",
                            "hints": {
                                "email_template_id": "email_tpl_job_customer_update",
                                "entity_id": "entity.job",
                            },
                        },
                        {
                            "id": "email_tpl_job_customer_update_approved",
                            "label": "Job Customer Update",
                            "value": "email_tpl_job_customer_update_approved",
                            "description": "Completion approval sent to customer",
                            "hints": {
                                "email_template_id": "email_tpl_job_customer_update_approved",
                                "entity_id": "entity.job",
                            },
                        },
                    ]
                    if kind == "email_template"
                    else [
                        {
                            "id": "doc_tpl_job_document_bundle",
                            "label": "Job Document Bundle",
                            "value": "doc_tpl_job_document_bundle",
                            "description": "inspection-report",
                            "hints": {
                                "document_template_id": "doc_tpl_job_document_bundle",
                                "entity_id": "entity.job",
                            },
                        },
                        {
                            "id": "doc_tpl_job_document_bundle_completion",
                            "label": "Job Document Bundle",
                            "value": "doc_tpl_job_document_bundle_completion",
                            "description": "completion-pack",
                            "hints": {
                                "document_template_id": "doc_tpl_job_document_bundle_completion",
                                "entity_id": "entity.job",
                            },
                        },
                    ]
                ),
            ),
        ):
            bundle = main._ai_build_create_module_bundle(
                "Create a Jobs module. When a job is completed, use our approval email for the customer and generate our completion pack.",
                [],
                {},
            )

        candidate_ops = [copy.deepcopy(op) for op in (bundle.get("candidate_ops") or []) if isinstance(op, dict)]
        self._assert_candidate_plan_quality(
            candidate_ops,
            allowed_email_template_ids={"email_tpl_job_customer_update_approved"},
            allowed_document_template_ids={"doc_tpl_job_document_bundle_completion"},
        )
        automation_ops = [op for op in candidate_ops if op.get("op") == "create_automation_record"]
        self.assertEqual(len(automation_ops), 1)
        automation = (automation_ops[0].get("automation") or {})
        self._assert_automation_quality(
            automation,
            expected_action_ids=["system.send_email", "system.generate_document"],
            expected_trigger_kind="event",
        )
        steps = automation.get("steps") or []
        email_inputs = (steps[0].get("inputs") or {}) if steps and isinstance(steps[0], dict) else {}
        document_inputs = (steps[1].get("inputs") or {}) if len(steps) > 1 and isinstance(steps[1], dict) else {}
        self.assertEqual(email_inputs.get("template_id"), "email_tpl_job_customer_update_approved")
        self.assertEqual(document_inputs.get("template_id"), "doc_tpl_job_document_bundle_completion")

    def test_octo_ai_create_module_bundle_reuses_multiple_existing_workspace_templates_across_bundle_steps(self) -> None:
        manifest = main._build_scaffold_single_entity(
            "jobs",
            "Jobs",
            "job",
            "Job",
            [
                {"id": "job.name", "type": "string", "label": "Job", "required": True},
                {"id": "job.customer_email", "type": "string", "label": "Customer Email"},
            ],
            nav_label="Jobs",
        )
        package = {
            "manifest": manifest,
            "design_spec": {"family": "field_service", "entity_slug": "job", "entity_label": "Job"},
            "quality": {},
            "automation_ops": [
                {
                    "op": "create_automation_record",
                    "artifact_type": "automation",
                    "artifact_id": "auto_job_approved_customer_notice",
                    "automation": {
                        "name": "Job Approved Customer Notice",
                        "status": "draft",
                        "trigger": {"kind": "event", "event_types": ["workflow.status_changed"], "filters": [{"path": "to", "op": "eq", "value": "approved"}]},
                        "steps": [
                            {
                                "id": "step_send_approval_email",
                                "kind": "action",
                                "action_id": "system.send_email",
                                "inputs": {
                                    "entity_id": "entity.job",
                                    "to_field_ids": ["job.customer_email"],
                                    "subject": "Your job has been approved",
                                    "body_text": "Approval details.",
                                },
                            },
                            {
                                "id": "step_generate_inspection_report",
                                "kind": "action",
                                "action_id": "system.generate_document",
                                "inputs": {
                                    "entity_id": "entity.job",
                                    "record_id": "{{trigger.record_id}}",
                                    "title": "Inspection Report",
                                },
                            },
                        ],
                    },
                },
                {
                    "op": "create_automation_record",
                    "artifact_type": "automation",
                    "artifact_id": "auto_job_completed_customer_notice",
                    "automation": {
                        "name": "Job Completed Customer Notice",
                        "status": "draft",
                        "trigger": {"kind": "event", "event_types": ["workflow.status_changed"], "filters": [{"path": "to", "op": "eq", "value": "completed"}]},
                        "steps": [
                            {
                                "id": "step_send_completion_email",
                                "kind": "action",
                                "action_id": "system.send_email",
                                "inputs": {
                                    "entity_id": "entity.job",
                                    "to_field_ids": ["job.customer_email"],
                                    "subject": "Your job is complete",
                                    "body_text": "Completion details.",
                                },
                            },
                            {
                                "id": "step_generate_completion_pack",
                                "kind": "action",
                                "action_id": "system.generate_document",
                                "inputs": {
                                    "entity_id": "entity.job",
                                    "record_id": "{{trigger.record_id}}",
                                    "title": "Completion Pack",
                                },
                            },
                        ],
                    },
                },
            ],
        }

        with (
            patch.object(main, "_ai_extract_requested_new_module_labels", lambda *args, **kwargs: ["Jobs"]),
            patch.object(main, "_ai_build_new_module_package", lambda *args, **kwargs: copy.deepcopy(package)),
            patch.object(
                main,
                "_ai_workspace_template_decision_options",
                lambda kind, workspace_id, limit=8: (
                    [
                        {
                            "id": "email_tpl_job_customer_update_approved",
                            "label": "Job Customer Update",
                            "value": "email_tpl_job_customer_update_approved",
                            "description": "Approval notice for approved jobs",
                            "hints": {
                                "email_template_id": "email_tpl_job_customer_update_approved",
                                "entity_id": "entity.job",
                            },
                        },
                        {
                            "id": "email_tpl_job_customer_update_completed",
                            "label": "Job Customer Update",
                            "value": "email_tpl_job_customer_update_completed",
                            "description": "Completion notice for finished jobs",
                            "hints": {
                                "email_template_id": "email_tpl_job_customer_update_completed",
                                "entity_id": "entity.job",
                            },
                        },
                    ]
                    if kind == "email_template"
                    else [
                        {
                            "id": "doc_tpl_job_bundle_inspection",
                            "label": "Job Document Bundle",
                            "value": "doc_tpl_job_bundle_inspection",
                            "description": "inspection-report",
                            "hints": {
                                "document_template_id": "doc_tpl_job_bundle_inspection",
                                "entity_id": "entity.job",
                            },
                        },
                        {
                            "id": "doc_tpl_job_bundle_completion",
                            "label": "Job Document Bundle",
                            "value": "doc_tpl_job_bundle_completion",
                            "description": "completion-pack",
                            "hints": {
                                "document_template_id": "doc_tpl_job_bundle_completion",
                                "entity_id": "entity.job",
                            },
                        },
                    ]
                ),
            ),
        ):
            bundle = main._ai_build_create_module_bundle(
                "Create a Jobs module. When a job is approved, use our approval email and generate our inspection report. "
                "When a job is completed, use our completion email and generate our completion pack.",
                [],
                {},
            )

        candidate_ops = [copy.deepcopy(op) for op in (bundle.get("candidate_ops") or []) if isinstance(op, dict)]
        self._assert_candidate_plan_quality(
            candidate_ops,
            allowed_email_template_ids={
                "email_tpl_job_customer_update_approved",
                "email_tpl_job_customer_update_completed",
            },
            allowed_document_template_ids={
                "doc_tpl_job_bundle_inspection",
                "doc_tpl_job_bundle_completion",
            },
        )
        automation_ops = [op for op in candidate_ops if op.get("op") == "create_automation_record"]
        self.assertEqual(len(automation_ops), 2)
        by_name = {((op.get("automation") or {}).get("name")): (op.get("automation") or {}) for op in automation_ops}
        approved = by_name.get("Job Approved Customer Notice") or {}
        completed = by_name.get("Job Completed Customer Notice") or {}
        self._assert_automation_quality(
            approved,
            expected_action_ids=["system.send_email", "system.generate_document"],
            expected_trigger_kind="event",
        )
        self._assert_automation_quality(
            completed,
            expected_action_ids=["system.send_email", "system.generate_document"],
            expected_trigger_kind="event",
        )
        approved_steps = approved.get("steps") or []
        completed_steps = completed.get("steps") or []
        self.assertEqual((((approved_steps[0].get("inputs") or {}).get("template_id"))), "email_tpl_job_customer_update_approved")
        self.assertEqual((((approved_steps[1].get("inputs") or {}).get("template_id"))), "doc_tpl_job_bundle_inspection")
        self.assertEqual((((completed_steps[0].get("inputs") or {}).get("template_id"))), "email_tpl_job_customer_update_completed")
        self.assertEqual((((completed_steps[1].get("inputs") or {}).get("template_id"))), "doc_tpl_job_bundle_completion")


if __name__ == "__main__":
    unittest.main()
