import json
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
from app.manifest_validate import validate_manifest_raw


def _contacts_manifest(module_id: str) -> dict:
    return {
        "manifest_version": "1.3",
        "module": {"id": module_id, "name": "Contacts"},
        "entities": [
            {
                "id": "entity.contact",
                "label": "Contact",
                "display_field": "contact.name",
                "fields": [
                    {"id": "contact.name", "type": "string", "label": "Name"},
                    {"id": "contact.email", "type": "string", "label": "Email"},
                ],
            }
        ],
        "views": [],
        "pages": [],
        "actions": [],
        "workflows": [],
        "app": {"home": "page:home", "nav": [{"group": "Main", "items": [{"label": "Home", "to": "page:home"}]}]},
    }


def _fake_builder_response(calls: list[dict]) -> dict:
    content = json.dumps(
        {
            "plan": {"goal": "Build contacts", "steps": ["Ensure entity", "Add pages"]},
            "calls": calls,
            "ops_by_module": [],
            "notes": "ok",
        }
    )
    return {"choices": [{"message": {"content": content}}]}


class TestStudio2AgentSmoke(unittest.TestCase):
    def test_studio2_ai_endpoints_require_superadmin(self) -> None:
        client = TestClient(main.app)
        standard_actor = {
            "user_id": "user-1",
            "email": "member@example.com",
            "role": "member",
            "workspace_role": "member",
            "platform_role": "standard",
            "workspace_id": "default",
            "workspaces": [{"workspace_id": "default", "role": "member", "workspace_name": "Default"}],
            "claims": {},
        }
        calls = [
            ("post", "/studio2/agent/chat", {"module_id": "contacts", "message": "help"}),
            ("post", "/studio2/agent/chat/stream", {"module_id": "contacts", "message": "help"}),
            ("post", "/studio2/agent/plan", {"module_id": "contacts", "message": "help"}),
            ("post", "/studio2/ai/plan", {"module_id": "contacts", "prompt": "help"}),
            ("post", "/studio2/ai/fix_json", {"text": "{\"module\": {}}", "error": {"line": 1, "col": 1}}),
            ("get", "/studio2/agent/status", None),
        ]

        with patch.object(main, "_resolve_actor", lambda _request: standard_actor):
            for method, path, payload in calls:
                if method == "get":
                    res = client.get(path)
                else:
                    res = client.post(path, json=payload)
                self.assertEqual(res.status_code, 403, {"path": path, "body": res.json()})
                body = res.json()
                self.assertFalse(body.get("ok"), {"path": path, "body": body})

    def test_ai_reference_documents_use_current_marketplace_paths(self) -> None:
        docs = main._ai_reference_documents([], {}, "plan a workflow with automation and template guidance")
        paths = {
            str(item.get("path") or "").replace("\\", "/")
            for item in docs
            if isinstance(item, dict)
        }
        self.assertIn("docs/module-authoring/README.md", paths)
        self.assertIn("manifests/marketplace/README.md", paths)
        self.assertIn("manifests/marketplace/docs/LAYOUT_STYLE_GUIDE.md", paths)
        self.assertIn("manifests/marketplace/docs/AUTOMATION_TEMPLATES.md", paths)
        self.assertNotIn("manifests/marketplace_v1/README.md", paths)

    def test_agent_no_tool_calls_when_errors(self) -> None:
        client = TestClient(main.app)
        module_id = f"no_tools_{uuid.uuid4().hex[:6]}"
        res = client.post("/studio2/modules", json={"module_id": module_id, "name": "No Tools"})
        payload = res.json()
        self.assertTrue(payload.get("ok"), payload)

        def fake_openai(_messages, model=None):
            return _fake_builder_response([])

        def fake_validate(manifest, expected_module_id=None):
            return manifest, [{"code": "MANIFEST_VIEW_ENTITY_INVALID", "message": "view entity required", "path": "views[0].entity"}], []

        build_spec = {"goal": "Build jobs", "entities": [{"id": "entity.job"}]}
        with (
            patch.object(main, "_openai_chat_completion", fake_openai),
            patch.object(main, "_openai_configured", lambda: True),
            patch.object(main, "validate_manifest_raw", fake_validate),
        ):
            res = client.post(
                "/studio2/agent/chat",
                json={"module_id": module_id, "message": "build jobs app", "build_spec": build_spec},
            )
        body = res.json()
        self.assertTrue(body.get("ok"), body)
        data = body.get("data") or {}
        self.assertEqual(data.get("stop_reason"), "no_effect")
        errors = (data.get("validation") or {}).get("errors") or []
        self.assertTrue(any(err.get("code") == "AGENT_NO_TOOL_CALLS" for err in errors))

    def test_agent_chat_contacts_smoke(self) -> None:
        client = TestClient(main.app)
        module_id = f"contacts_smoke_{uuid.uuid4().hex[:6]}"
        res = client.post("/studio2/modules", json={"module_id": module_id, "name": "Contacts"})
        payload = res.json()
        self.assertTrue(payload.get("ok"), payload)

        calls = [
            {
                "tool": "ensure_entity",
                "module_id": module_id,
                "entity": {
                    "id": "entity.contact",
                    "label": "Contact",
                    "display_field": "contact.first_name",
                    "fields": [
                        {"id": "contact.first_name", "type": "string", "label": "First Name", "required": True},
                        {"id": "contact.last_name", "type": "string", "label": "Last Name", "required": True},
                        {"id": "contact.email", "type": "string", "label": "Email"},
                        {"id": "contact.type", "type": "enum", "label": "Type", "options": ["lead", "customer"]},
                    ],
                },
            },
            {"tool": "ensure_entity_pages", "module_id": module_id, "entity_id": "entity.contact"},
            {"tool": "ensure_nav", "module_id": module_id},
        ]

        def fake_openai(_messages, model=None):
            return _fake_builder_response(calls)

        build_spec = {"goal": "Build contacts", "entities": [{"id": "entity.contact"}]}
        with patch.object(main, "_openai_chat_completion", fake_openai), patch.object(main, "_openai_configured", lambda: True):
            res = client.post(
                "/studio2/agent/chat",
                json={"module_id": module_id, "message": "build contacts app", "build_spec": build_spec},
            )
        body = res.json()
        self.assertTrue(body.get("ok"), body)
        data = body.get("data") or {}
        self.assertEqual(data.get("ops_by_module"), [])
        draft = data.get("drafts", {}).get(module_id)
        self.assertIsNotNone(draft)
        normalized, errors, _ = validate_manifest_raw(draft, expected_module_id=module_id)
        self.assertEqual(errors, [])
        contact = normalized["entities"][0]
        enum_field = next(f for f in contact["fields"] if f.get("id") == "contact.type")
        self.assertTrue(all(isinstance(opt, dict) for opt in enum_field.get("options", [])))
        form_view = next(v for v in normalized["views"] if v.get("id") == "contact.form")
        self.assertTrue("statusbar" not in (form_view.get("header") or {}))

    def test_agent_builder_context_includes_reference_contract(self) -> None:
        client = TestClient(main.app)
        module_id = f"ctx_{uuid.uuid4().hex[:6]}"
        res = client.post("/studio2/modules", json={"module_id": module_id, "name": "Contacts"})
        payload = res.json()
        self.assertTrue(payload.get("ok"), payload)

        captured: dict[str, object] = {}
        calls = [
            {
                "tool": "ensure_entity",
                "module_id": module_id,
                "entity": {
                    "id": "entity.contact",
                    "label": "Contact",
                    "display_field": "contact.name",
                    "fields": [{"id": "contact.name", "type": "string", "label": "Name"}],
                },
            }
        ]

        def fake_openai(messages, model=None):
            captured["messages"] = messages
            return _fake_builder_response(calls)

        build_spec = {"goal": "Build contacts", "entities": [{"id": "entity.contact"}]}
        with patch.object(main, "_openai_chat_completion", fake_openai), patch.object(main, "_openai_configured", lambda: True):
            res = client.post(
                "/studio2/agent/chat",
                json={"module_id": module_id, "message": "build contacts app", "build_spec": build_spec},
            )
        body = res.json()
        self.assertTrue(body.get("ok"), body)
        messages = captured.get("messages") or []
        context_messages = [
            item.get("content")
            for item in messages
            if isinstance(item, dict) and isinstance(item.get("content"), str) and item.get("content", "").startswith("context.json")
        ]
        self.assertEqual(len(context_messages), 1)
        context_text = context_messages[0]
        self.assertIn("\"reference_contract\"", context_text)
        self.assertIn("\"entity_ids\"", context_text)
        self.assertIn("\"view_ids\"", context_text)
        self.assertIn("\"workflow_ids\"", context_text)

    def test_agent_rejects_entity_pages_for_missing_entity(self) -> None:
        client = TestClient(main.app)
        module_id = f"missing_entity_{uuid.uuid4().hex[:6]}"
        res = client.post("/studio2/modules", json={"module_id": module_id, "name": "No Entity"})
        payload = res.json()
        self.assertTrue(payload.get("ok"), payload)

        calls = [{"tool": "ensure_entity_pages", "module_id": module_id, "entity_id": "entity.missing"}]

        def fake_openai(_messages, model=None):
            return _fake_builder_response(calls)

        build_spec = {"goal": "Build pages", "entities": []}
        with patch.object(main, "_openai_chat_completion", fake_openai), patch.object(main, "_openai_configured", lambda: True):
            res = client.post(
                "/studio2/agent/chat",
                json={"module_id": module_id, "message": "add pages", "build_spec": build_spec},
            )
        body = res.json()
        self.assertTrue(body.get("ok"), body)
        data = body.get("data") or {}
        errors = (data.get("validation") or {}).get("errors") or []
        self.assertTrue(any(err.get("code") == "CALL_INVALID" for err in errors), errors)
        self.assertTrue(any("requires an existing entity_id" in str(err.get("message")) for err in errors), errors)

    def test_agent_read_manifest_cross_module(self) -> None:
        client = TestClient(main.app)
        contacts_id = f"contacts_{uuid.uuid4().hex[:6]}"
        jobs_id = f"jobs_{uuid.uuid4().hex[:6]}"
        main.store.init_module(contacts_id, _contacts_manifest(contacts_id), actor={"id": "test"})
        main.registry.register(contacts_id, "Contacts", actor=None)
        main.registry.set_enabled(contacts_id, True, actor=None, reason="test")

        res = client.post("/studio2/modules", json={"module_id": jobs_id, "name": "Jobs"})
        payload = res.json()
        self.assertTrue(payload.get("ok"), payload)

        calls = [
            {"tool": "read_manifest", "module_id": contacts_id, "level": "summary"},
            {
                "tool": "ensure_entity",
                "module_id": jobs_id,
                "entity": {
                    "id": "entity.job",
                    "label": "Job",
                    "display_field": "job.title",
                    "fields": [
                        {"id": "job.title", "type": "string", "label": "Title", "required": True},
                        {
                            "id": "job.contact_id",
                            "type": "lookup",
                            "label": "Contact",
                            "entity": "entity.contact",
                            "display_field": "contact.name",
                        },
                    ],
                },
            },
            {"tool": "ensure_entity_pages", "module_id": jobs_id, "entity_id": "entity.job"},
            {"tool": "ensure_nav", "module_id": jobs_id},
        ]

        def fake_openai(_messages, model=None):
            return _fake_builder_response(calls)

        build_spec = {"goal": "Build jobs", "entities": [{"id": "entity.job"}]}
        with patch.object(main, "_openai_chat_completion", fake_openai), patch.object(main, "_openai_configured", lambda: True):
            res = client.post(
                "/studio2/agent/chat",
                json={"module_id": jobs_id, "message": "jobs with contacts lookup", "build_spec": build_spec},
            )
        body = res.json()
        self.assertTrue(body.get("ok"), body)
        data = body.get("data") or {}
        calls_applied = data.get("calls") or []
        self.assertTrue(any(call.get("tool") == "read_manifest" for call in calls_applied))
        draft = data.get("drafts", {}).get(jobs_id)
        normalized, errors, _ = validate_manifest_raw(draft, expected_module_id=jobs_id)
        self.assertEqual(errors, [])


if __name__ == "__main__":
    unittest.main()
