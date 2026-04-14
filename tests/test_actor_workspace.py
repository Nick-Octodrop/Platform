import os
import sys
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "src")
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
if SRC not in sys.path:
    sys.path.insert(0, SRC)

os.environ.setdefault("USE_DB", "0")
os.environ.setdefault("OCTO_DISABLE_AUTH", "1")
os.environ.setdefault("SUPABASE_URL", "http://localhost")
os.environ.setdefault("SUPABASE_JWT_AUD", "authenticated")

try:
    import fastapi  # noqa: F401
except ImportError:
    fastapi = None

if fastapi is not None:
    import app.main as main
    from fastapi.testclient import TestClient


class DummyRequest:
    def __init__(self, user, headers=None):
        self.state = SimpleNamespace(user=user)
        self.headers = headers or {}


def _json_body(response):
    return json.loads(response.body.decode("utf-8"))


if fastapi is None:
    class TestActorWorkspace(unittest.TestCase):
        def test_fastapi_missing(self):
            self.skipTest("fastapi not installed")
else:
    class TestActorWorkspace(unittest.TestCase):
        def setUp(self):
            self._use_db = main.USE_DB
            self._list_memberships = main.list_memberships
            self._list_user_workspaces = main.list_user_workspaces
            self._list_all_workspaces = main.list_all_workspaces
            self._get_membership = main.get_membership
            self._get_platform_role = main.get_platform_role
            self._create_workspace_for_user = main.create_workspace_for_user
            self._generic_records = main.generic_records
            self._resolve_actor = main._resolve_actor
            self._octo_ai_chat_plan_payload = main._octo_ai_chat_plan_payload
            self._ai_slot_based_plan = main._ai_slot_based_plan
            self._ai_semantic_plan_from_model = main._ai_semantic_plan_from_model

        def tearDown(self):
            main.USE_DB = self._use_db
            main.list_memberships = self._list_memberships
            main.list_user_workspaces = self._list_user_workspaces
            main.list_all_workspaces = self._list_all_workspaces
            main.get_membership = self._get_membership
            main.get_platform_role = self._get_platform_role
            main.create_workspace_for_user = self._create_workspace_for_user
            main.generic_records = self._generic_records
            main._resolve_actor = self._resolve_actor
            main._octo_ai_chat_plan_payload = self._octo_ai_chat_plan_payload
            main._ai_slot_based_plan = self._ai_slot_based_plan
            main._ai_semantic_plan_from_model = self._ai_semantic_plan_from_model

        def test_prefers_first_user_workspace_for_multiple_memberships(self):
            main.USE_DB = True
            main.list_memberships = lambda user_id: [
                {"workspace_id": "w1", "role": "member"},
                {"workspace_id": "w2", "role": "member"},
            ]
            main.list_user_workspaces = lambda user_id: [
                {"workspace_id": "w2", "role": "admin", "workspace_name": "Two"},
                {"workspace_id": "w1", "role": "member", "workspace_name": "One"},
            ]
            main.get_platform_role = lambda user_id: "standard"
            main.get_membership = lambda user_id, workspace_id: None
            request = DummyRequest({"id": "u1", "email": "u@example.com"})
            actor = main._resolve_actor(request)
            self.assertEqual(actor["workspace_id"], "w2")
            self.assertEqual(actor["workspace_role"], "admin")

        def test_falls_back_to_first_membership_when_workspace_list_missing(self):
            main.USE_DB = True
            main.list_memberships = lambda user_id: [
                {"workspace_id": "w1", "role": "member"},
                {"workspace_id": "w2", "role": "admin"},
            ]
            main.list_user_workspaces = lambda user_id: []
            main.get_platform_role = lambda user_id: "standard"
            main.get_membership = lambda user_id, workspace_id: None
            request = DummyRequest({"id": "u1", "email": "u@example.com"})
            actor = main._resolve_actor(request)
            self.assertEqual(actor["workspace_id"], "w1")
            self.assertEqual(actor["workspace_role"], "member")

        def test_workspace_header_forbidden_when_not_member(self):
            main.USE_DB = True
            main.list_memberships = lambda user_id: [{"workspace_id": "w1", "role": "member"}]
            main.list_user_workspaces = lambda user_id: [{"workspace_id": "w1", "role": "member", "workspace_name": "One"}]
            main.get_platform_role = lambda user_id: "standard"
            main.get_membership = lambda user_id, workspace_id: None
            request = DummyRequest({"id": "u1", "email": "u@example.com"}, headers={"X-Workspace-Id": "w2"})
            response = main._resolve_actor(request)
            self.assertEqual(response.status_code, 403)
            body = _json_body(response)
            self.assertEqual(body["errors"][0]["code"], "WORKSPACE_FORBIDDEN")

        def test_bootstrap_workspace_when_none_exist(self):
            main.USE_DB = True
            main.list_memberships = lambda user_id: []
            main.list_user_workspaces = lambda user_id: []
            main.get_platform_role = lambda user_id: "standard"
            main.get_membership = lambda user_id, workspace_id: None
            main.create_workspace_for_user = lambda user: "w-new"
            request = DummyRequest({"id": "u1", "email": "u@example.com"})
            actor = main._resolve_actor(request)
            self.assertEqual(actor["workspace_id"], "w-new")
            self.assertEqual(actor["role"], "admin")
            self.assertEqual(actor["workspace_role"], "admin")

        def test_auth_disabled_local_actor_respects_workspace_header(self):
            request = DummyRequest(None, headers={"X-Workspace-Id": "w-local"})
            actor = main._resolve_actor(request)
            self.assertEqual(actor["user_id"], "test-user")
            self.assertEqual(actor["workspace_id"], "w-local")
            self.assertEqual(actor["role"], "admin")
            self.assertEqual(actor["workspace_role"], "admin")
            self.assertEqual(actor["platform_role"], "superadmin")
            self.assertEqual(actor["workspaces"][0]["workspace_id"], "w-local")

        def test_superadmin_without_workspace_header_prefers_user_workspace(self):
            main.USE_DB = True
            main.list_memberships = lambda user_id: [
                {"workspace_id": "w-zeta", "role": "member"},
                {"workspace_id": "w-alpha", "role": "admin"},
            ]
            main.list_user_workspaces = lambda user_id: [
                {"workspace_id": "w-alpha", "role": "admin", "workspace_name": "Alpha"},
                {"workspace_id": "w-zeta", "role": "member", "workspace_name": "Zeta"},
            ]
            main.list_all_workspaces = lambda: (_ for _ in ()).throw(AssertionError("should not list all workspaces"))
            main.get_platform_role = lambda user_id: "superadmin"
            main.get_membership = lambda user_id, workspace_id: None
            request = DummyRequest({"id": "u1", "email": "u@example.com"})
            actor = main._resolve_actor(request)
            self.assertEqual(actor["workspace_id"], "w-alpha")
            self.assertEqual(actor["workspace_role"], "admin")
            self.assertEqual(actor["platform_role"], "superadmin")

        def test_octo_ai_chat_falls_back_to_session_workspace(self):
            main.generic_records = main.MemoryGenericRecordStore()
            active_workspace = {"id": "w-alpha"}

            def _actor_for_request(_request):
                workspace_id = active_workspace["id"]
                role = "admin" if workspace_id == "w-alpha" else "member"
                return {
                    "user_id": "u1",
                    "email": "u@example.com",
                    "role": role,
                    "workspace_role": role,
                    "platform_role": "superadmin",
                    "workspace_id": workspace_id,
                    "workspaces": [
                        {"workspace_id": "w-alpha", "role": "admin", "workspace_name": "Alpha"},
                        {"workspace_id": "w-zeta", "role": "member", "workspace_name": "Zeta"},
                    ],
                    "claims": {},
                }

            def _fake_chat_plan_payload(request, session_id, session_data, message_text, explicit_scope=None):
                self.assertEqual(session_id, session_data["id"])
                self.assertEqual(request.state.actor["workspace_id"], "w-alpha")
                return (
                    {"workspace_id": request.state.actor["workspace_id"]},
                    {"candidate_operations": [{"op": "create_module"}], "required_questions": ["confirm_plan"]},
                    {"id": "plan-1"},
                    "Create a new module 'Vehicle Logbook'.",
                )

            main._resolve_actor = _actor_for_request
            main._octo_ai_chat_plan_payload = _fake_chat_plan_payload

            client = TestClient(main.app)
            try:
                create_response = client.post("/octo-ai/sessions", json={"title": "vehicle-logbook"})
                self.assertEqual(create_response.status_code, 200, create_response.text)
                session_id = create_response.json()["session"]["id"]

                active_workspace["id"] = "w-zeta"
                chat_response = client.post(
                    f"/octo-ai/sessions/{session_id}/chat",
                    json={"message": "Create a simple module to track vehicle usage."},
                )
                self.assertEqual(chat_response.status_code, 200, chat_response.text)
                body = chat_response.json()
                self.assertTrue(body["ok"])
                self.assertIn("Vehicle Logbook", body["assistant_text"])
            finally:
                client.close()

        def test_octo_ai_chat_recovers_session_for_superadmin_after_workspace_context_switch(self):
            main.generic_records = main.MemoryGenericRecordStore()
            active_state = {
                "workspace_id": "w-alpha",
                "workspaces": [{"workspace_id": "w-alpha", "role": "admin", "workspace_name": "Alpha"}],
            }

            def _actor_for_request(_request):
                return {
                    "user_id": "u1",
                    "email": "u@example.com",
                    "role": "admin",
                    "workspace_role": "admin",
                    "platform_role": "superadmin",
                    "workspace_id": active_state["workspace_id"],
                    "workspaces": active_state["workspaces"],
                    "claims": {},
                }

            def _fake_chat_plan_payload(request, session_id, session_data, message_text, explicit_scope=None):
                self.assertEqual(session_id, session_data["id"])
                self.assertEqual(request.state.actor["workspace_id"], "w-alpha")
                return (
                    {"workspace_id": request.state.actor["workspace_id"]},
                    {"candidate_operations": [{"op": "create_module"}], "required_questions": ["confirm_plan"]},
                    {"id": "plan-1"},
                    "Create a new module 'Vehicle Logbook'.",
                )

            main._resolve_actor = _actor_for_request
            main._octo_ai_chat_plan_payload = _fake_chat_plan_payload

            client = TestClient(main.app)
            try:
                create_response = client.post("/octo-ai/sessions", json={"title": "vehicle-logbook"})
                self.assertEqual(create_response.status_code, 200, create_response.text)
                session_id = create_response.json()["session"]["id"]

                active_state["workspace_id"] = "w-zeta"
                active_state["workspaces"] = [{"workspace_id": "w-zeta", "role": "admin", "workspace_name": "Zeta"}]

                chat_response = client.post(
                    f"/octo-ai/sessions/{session_id}/chat",
                    json={"message": "Create a simple module to track vehicle usage."},
                )
                self.assertEqual(chat_response.status_code, 200, chat_response.text)
                body = chat_response.json()
                self.assertTrue(body["ok"])
                self.assertIn("Vehicle Logbook", body["assistant_text"])

                fetch_response = client.get(f"/octo-ai/sessions/{session_id}")
                self.assertEqual(fetch_response.status_code, 200, fetch_response.text)
                self.assertEqual(fetch_response.json()["session"]["workspace_id"], "w-alpha")
            finally:
                client.close()

        def test_octo_ai_chat_plan_payload_persists_results_in_session_workspace(self):
            seen = {}

            def _fake_context_package(_request, _session_data, _message_text, answer_hints=None):
                return {"answer_hints": answer_hints or {}}

            def _fake_plan_from_message(_request, _session_data, _message_text, explicit_scope=None, answer_hints=None):
                return (
                    {"candidate_operations": [{"op": "create_module"}], "required_questions": []},
                    {"status": "planning"},
                )

            def _fake_persist(session_id, plan, context, derived):
                seen["workspace_id"] = main.get_org_id()
                seen["session_id"] = session_id
                return {"id": "plan-1"}, "Create a new module 'Vehicle Logbook'."

            request = DummyRequest(
                {
                    "user_id": "u1",
                    "workspace_id": "ws-sandbox",
                    "role": "admin",
                    "workspace_role": "admin",
                    "platform_role": "superadmin",
                    "workspaces": [
                        {"workspace_id": "ws-live", "role": "admin", "workspace_name": "Live"},
                        {"workspace_id": "ws-sandbox", "role": "admin", "workspace_name": "Sandbox"},
                    ],
                }
            )

            with (
                patch.object(main, "_ai_collect_answer_hints", return_value={}),
                patch.object(main, "_ai_context_package", side_effect=_fake_context_package),
                patch.object(main, "_ai_plan_from_message", side_effect=_fake_plan_from_message),
                patch.object(main, "_ai_persist_plan_result", side_effect=_fake_persist),
            ):
                token = main.set_org_id("ws-sandbox")
                try:
                    _context, _plan, plan_record, assistant_text = main._octo_ai_chat_plan_payload(
                        request,
                        "session-1",
                        {"id": "session-1", "workspace_id": "ws-live"},
                        "Create a vehicle logbook module.",
                    )
                finally:
                    main.reset_org_id(token)

            self.assertEqual(seen["workspace_id"], "ws-live")
            self.assertEqual(seen["session_id"], "session-1")
            self.assertEqual(plan_record["id"], "plan-1")
            self.assertIn("Vehicle Logbook", assistant_text)

        def test_octo_ai_generate_patchset_falls_back_to_session_workspace(self):
            main.generic_records = main.MemoryGenericRecordStore()
            active_workspace = {"id": "w-alpha"}

            def _actor_for_request(_request):
                workspace_id = active_workspace["id"]
                role = "admin" if workspace_id == "w-alpha" else "member"
                return {
                    "user_id": "u1",
                    "email": "u@example.com",
                    "role": role,
                    "workspace_role": role,
                    "platform_role": "superadmin",
                    "workspace_id": workspace_id,
                    "workspaces": [
                        {"workspace_id": "w-alpha", "role": "admin", "workspace_name": "Alpha"},
                        {"workspace_id": "w-zeta", "role": "member", "workspace_name": "Zeta"},
                    ],
                    "claims": {},
                }

            main._resolve_actor = _actor_for_request

            client = TestClient(main.app)
            try:
                create_response = client.post("/octo-ai/sessions", json={"title": "vehicle-logbook"})
                self.assertEqual(create_response.status_code, 200, create_response.text)
                session_id = create_response.json()["session"]["id"]

                plan_record = main.generic_records.create(
                    main._AI_ENTITY_PLAN,
                    {
                        "session_id": session_id,
                        "assistant_text": "Create a new module 'Vehicle Logbook'.",
                        "plan_json": {
                            "plan": {
                                "candidate_operations": [
                                    {
                                        "op": "create_module",
                                        "artifact_type": "module",
                                        "artifact_id": "vehicle_logbook",
                                        "manifest": {"module": {"id": "vehicle_logbook", "name": "Vehicle Logbook"}},
                                    }
                                ],
                                "required_questions": [],
                            }
                        },
                        "created_at": "2026-03-18T10:05:30Z",
                    },
                    tenant_id="w-alpha",
                )
                main.generic_records.update(
                    main._AI_ENTITY_SESSION,
                    session_id,
                    {"latest_plan_id": plan_record["id"]},
                    tenant_id="w-alpha",
                )

                active_workspace["id"] = "w-zeta"
                patchset_response = client.post(f"/octo-ai/sessions/{session_id}/patchsets/generate", json={})
                self.assertEqual(patchset_response.status_code, 200, patchset_response.text)
                body = patchset_response.json()
                self.assertTrue(body["ok"])
                patchset_id = body["patchset"]["id"]

                stored_patchset = main.generic_records.get(main._AI_ENTITY_PATCHSET, patchset_id, tenant_id="w-alpha")
                self.assertIsNotNone(stored_patchset)
                updated_session = main.generic_records.get(main._AI_ENTITY_SESSION, session_id, tenant_id="w-alpha")
                self.assertEqual(updated_session["status"], "ready_to_apply")
            finally:
                client.close()

        def test_octo_ai_generate_patchset_blocks_explicit_operations_until_plan_is_confirmed(self):
            main.generic_records = main.MemoryGenericRecordStore()
            active_workspace = {"id": "w-alpha"}

            def _actor_for_request(_request):
                workspace_id = active_workspace["id"]
                role = "admin" if workspace_id == "w-alpha" else "member"
                return {
                    "user_id": "u1",
                    "email": "u@example.com",
                    "role": role,
                    "workspace_role": role,
                    "platform_role": "superadmin",
                    "workspace_id": workspace_id,
                    "workspaces": [
                        {"workspace_id": "w-alpha", "role": "admin", "workspace_name": "Alpha"},
                        {"workspace_id": "w-zeta", "role": "member", "workspace_name": "Zeta"},
                    ],
                    "claims": {},
                }

            main._resolve_actor = _actor_for_request

            client = TestClient(main.app)
            try:
                create_response = client.post("/octo-ai/sessions", json={"title": "vehicle-logbook"})
                self.assertEqual(create_response.status_code, 200, create_response.text)
                session_id = create_response.json()["session"]["id"]

                plan_record = main.generic_records.create(
                    main._AI_ENTITY_PLAN,
                    {
                        "session_id": session_id,
                        "assistant_text": "Create a new module 'Vehicle Logbook'.",
                        "plan_json": {
                            "plan": {
                                "candidate_operations": [
                                    {
                                        "op": "create_module",
                                        "artifact_type": "module",
                                        "artifact_id": "vehicle_logbook",
                                        "manifest": {"module": {"id": "vehicle_logbook", "name": "Vehicle Logbook"}},
                                    }
                                ],
                                "required_questions": ["Confirm this plan?"],
                                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                            }
                        },
                        "created_at": "2026-03-18T10:05:30Z",
                    },
                    tenant_id="w-alpha",
                )
                main.generic_records.update(
                    main._AI_ENTITY_SESSION,
                    session_id,
                    {"latest_plan_id": plan_record["id"]},
                    tenant_id="w-alpha",
                )

                patchset_response = client.post(
                    f"/octo-ai/sessions/{session_id}/patchsets/generate",
                    json={
                        "plan_id": plan_record["id"],
                        "operations": [
                            {
                                "op": "create_module",
                                "artifact_type": "module",
                                "artifact_id": "vehicle_logbook",
                                "manifest": {"module": {"id": "vehicle_logbook", "name": "Vehicle Logbook"}},
                            }
                        ],
                    },
                )
                self.assertEqual(patchset_response.status_code, 400, patchset_response.text)
                body = patchset_response.json()
                self.assertEqual(body["errors"][0]["code"], "AI_PLAN_QUESTIONS_REQUIRED")
            finally:
                client.close()

        def test_octo_ai_generate_patchset_rejects_stale_plan_payload(self):
            main.generic_records = main.MemoryGenericRecordStore()
            active_workspace = {"id": "w-alpha"}

            def _actor_for_request(_request):
                workspace_id = active_workspace["id"]
                role = "admin" if workspace_id == "w-alpha" else "member"
                return {
                    "user_id": "u1",
                    "email": "u@example.com",
                    "role": role,
                    "workspace_role": role,
                    "platform_role": "superadmin",
                    "workspace_id": workspace_id,
                    "workspaces": [
                        {"workspace_id": "w-alpha", "role": "admin", "workspace_name": "Alpha"},
                        {"workspace_id": "w-zeta", "role": "member", "workspace_name": "Zeta"},
                    ],
                    "claims": {},
                }

            main._resolve_actor = _actor_for_request

            client = TestClient(main.app)
            try:
                create_response = client.post("/octo-ai/sessions", json={"title": "vehicle-logbook"})
                self.assertEqual(create_response.status_code, 200, create_response.text)
                session_id = create_response.json()["session"]["id"]

                first_plan = main.generic_records.create(
                    main._AI_ENTITY_PLAN,
                    {
                        "session_id": session_id,
                        "assistant_text": "Create a new module 'Vehicle Logbook'.",
                        "plan_json": {
                            "plan": {
                                "candidate_operations": [
                                    {
                                        "op": "create_module",
                                        "artifact_type": "module",
                                        "artifact_id": "vehicle_logbook",
                                        "manifest": {"module": {"id": "vehicle_logbook", "name": "Vehicle Logbook"}},
                                    }
                                ],
                                "required_questions": [],
                            }
                        },
                        "created_at": "2026-03-18T10:05:30Z",
                    },
                    tenant_id="w-alpha",
                )
                latest_plan = main.generic_records.create(
                    main._AI_ENTITY_PLAN,
                    {
                        "session_id": session_id,
                        "assistant_text": "Create a new module 'Fleet Logbook'.",
                        "plan_json": {
                            "plan": {
                                "candidate_operations": [
                                    {
                                        "op": "create_module",
                                        "artifact_type": "module",
                                        "artifact_id": "fleet_logbook",
                                        "manifest": {"module": {"id": "fleet_logbook", "name": "Fleet Logbook"}},
                                    }
                                ],
                                "required_questions": [],
                            }
                        },
                        "created_at": "2026-03-18T10:06:00Z",
                    },
                    tenant_id="w-alpha",
                )
                main.generic_records.update(
                    main._AI_ENTITY_SESSION,
                    session_id,
                    {"latest_plan_id": latest_plan["id"]},
                    tenant_id="w-alpha",
                )

                patchset_response = client.post(
                    f"/octo-ai/sessions/{session_id}/patchsets/generate",
                    json={
                        "plan_id": first_plan["id"],
                        "operations": [
                            {
                                "op": "create_module",
                                "artifact_type": "module",
                                "artifact_id": "vehicle_logbook",
                                "manifest": {"module": {"id": "vehicle_logbook", "name": "Vehicle Logbook"}},
                            }
                        ],
                    },
                )
                self.assertEqual(patchset_response.status_code, 409, patchset_response.text)
                body = patchset_response.json()
                self.assertEqual(body["errors"][0]["code"], "AI_PLAN_OUT_OF_SYNC")
            finally:
                client.close()

        def test_octo_ai_generate_patchset_uses_latest_plan_when_unpinned_operations_are_stale(self):
            main.generic_records = main.MemoryGenericRecordStore()
            active_workspace = {"id": "w-alpha"}

            def _actor_for_request(_request):
                workspace_id = active_workspace["id"]
                role = "admin" if workspace_id == "w-alpha" else "member"
                return {
                    "user_id": "u1",
                    "email": "u@example.com",
                    "role": role,
                    "workspace_role": role,
                    "platform_role": "superadmin",
                    "workspace_id": workspace_id,
                    "workspaces": [
                        {"workspace_id": "w-alpha", "role": "admin", "workspace_name": "Alpha"},
                        {"workspace_id": "w-zeta", "role": "member", "workspace_name": "Zeta"},
                    ],
                    "claims": {},
                }

            main._resolve_actor = _actor_for_request

            client = TestClient(main.app)
            try:
                create_response = client.post("/octo-ai/sessions", json={"title": "scope-switch"})
                self.assertEqual(create_response.status_code, 200, create_response.text)
                session_id = create_response.json()["session"]["id"]

                first_plan = main.generic_records.create(
                    main._AI_ENTITY_PLAN,
                    {
                        "session_id": session_id,
                        "assistant_text": "Create a new module 'Neetones'.",
                        "plan_json": {
                            "plan": {
                                "candidate_operations": [
                                    {
                                        "op": "create_module",
                                        "artifact_type": "module",
                                        "artifact_id": "neetones",
                                        "manifest": {"module": {"id": "neetones", "name": "Neetones"}},
                                    }
                                ],
                                "required_questions": [],
                            }
                        },
                        "created_at": "2026-03-18T10:05:30Z",
                    },
                    tenant_id="w-alpha",
                )
                latest_plan = main.generic_records.create(
                    main._AI_ENTITY_PLAN,
                    {
                        "session_id": session_id,
                        "assistant_text": "No changes are needed right now.",
                        "plan_json": {
                            "plan": {
                                "candidate_operations": [],
                                "required_questions": [],
                                "resolved_without_changes": True,
                                "planner_state": {"intent": "field_missing_noop", "field_ref": "roblux"},
                                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "contacts"}],
                            },
                            "context": {
                                "full_selected_artifacts": [
                                    {
                                        "artifact_type": "module",
                                        "artifact_id": "contacts",
                                        "manifest": {"module": {"name": "Contacts"}},
                                    }
                                ]
                            },
                        },
                        "created_at": "2026-03-18T10:06:00Z",
                    },
                    tenant_id="w-alpha",
                )
                main.generic_records.update(
                    main._AI_ENTITY_SESSION,
                    session_id,
                    {"latest_plan_id": latest_plan["id"]},
                    tenant_id="w-alpha",
                )

                patchset_response = client.post(
                    f"/octo-ai/sessions/{session_id}/patchsets/generate",
                    json={
                        "operations": [
                            {
                                "op": "create_module",
                                "artifact_type": "module",
                                "artifact_id": "neetones",
                                "manifest": {"module": {"id": "neetones", "name": "Neetones"}},
                            }
                        ]
                    },
                )
                self.assertEqual(patchset_response.status_code, 200, patchset_response.text)
                body = patchset_response.json()
                self.assertTrue(body["ok"])
                patchset = body["patchset"]
                self.assertEqual(patchset["plan_id"], latest_plan["id"])
                self.assertTrue(patchset["patch_json"]["noop"])
                self.assertEqual(patchset["patch_json"]["operations"], [])
            finally:
                client.close()

        def test_octo_ai_validate_patchset_falls_back_to_patchset_workspace(self):
            main.generic_records = main.MemoryGenericRecordStore()
            active_workspace = {"id": "w-alpha"}

            def _actor_for_request(_request):
                workspace_id = active_workspace["id"]
                role = "admin" if workspace_id == "w-alpha" else "member"
                return {
                    "user_id": "u1",
                    "email": "u@example.com",
                    "role": role,
                    "workspace_role": role,
                    "platform_role": "superadmin",
                    "workspace_id": workspace_id,
                    "workspaces": [
                        {"workspace_id": "w-alpha", "role": "admin", "workspace_name": "Alpha"},
                        {"workspace_id": "w-zeta", "role": "member", "workspace_name": "Zeta"},
                    ],
                    "claims": {},
                }

            main._resolve_actor = _actor_for_request

            client = TestClient(main.app)
            try:
                create_response = client.post("/octo-ai/sessions", json={"title": "vehicle-logbook"})
                self.assertEqual(create_response.status_code, 200, create_response.text)
                session_id = create_response.json()["session"]["id"]

                patchset = main.generic_records.create(
                    main._AI_ENTITY_PATCHSET,
                    {
                        "session_id": session_id,
                        "status": "draft",
                        "base_snapshot_refs_json": [],
                        "patch_json": {"operations": [], "noop": True, "reason": "No changes are needed right now."},
                        "validation_json": None,
                        "apply_log_json": [],
                        "created_at": "2026-03-18T10:05:35Z",
                        "applied_at": None,
                    },
                    tenant_id="w-alpha",
                )

                active_workspace["id"] = "w-zeta"
                validate_response = client.post(f"/octo-ai/patchsets/{patchset['id']}/validate", json={})
                self.assertEqual(validate_response.status_code, 200, validate_response.text)
                body = validate_response.json()
                self.assertTrue(body["ok"])
                self.assertTrue(body["validation"]["ok"])

                updated_patchset = main.generic_records.get(main._AI_ENTITY_PATCHSET, patchset["id"], tenant_id="w-alpha")
                self.assertEqual(updated_patchset["status"], "validated")
                updated_session = main.generic_records.get(main._AI_ENTITY_SESSION, session_id, tenant_id="w-alpha")
                self.assertEqual(updated_session["status"], "ready_to_apply")
            finally:
                client.close()

        def test_extract_candidate_ops_keeps_create_module_requests_in_create_mode(self):
            prompt = "Build a Customer Site Assets module so we can track equipment installed at each customer site, serial numbers, warranty dates, service history, and photos."
            module_index = {
                "contacts": {
                    "manifest": {
                        "module": {"id": "contacts", "name": "Contacts"},
                        "entities": [{"id": "entity.contact", "label": "Contact", "fields": []}],
                    }
                }
            }

            candidate_ops, questions, question_meta = main._ai_extract_candidate_ops(
                prompt,
                ["contacts"],
                module_index,
            )

            self.assertEqual(questions, [])
            self.assertIsNone(question_meta)
            self.assertEqual(len(candidate_ops), 1)
            self.assertEqual(candidate_ops[0]["op"], "create_module")
            self.assertEqual(candidate_ops[0]["artifact_id"], "customer_site_assets")

        def test_plan_from_message_create_module_ignores_stale_selected_module_when_fallback_runs(self):
            main._ai_slot_based_plan = lambda *args, **kwargs: None
            main._ai_semantic_plan_from_model = lambda *args, **kwargs: None
            request = SimpleNamespace(state=SimpleNamespace(cache={}))
            session = {
                "id": "s-create-module",
                "workspace_id": "default",
                "scope_mode": "auto",
                "selected_artifact_type": "module",
                "selected_artifact_key": "contacts",
            }

            for prompt, expected_module_id in [
                (
                    "Build a Customer Site Assets module so we can track equipment installed at each customer site, serial numbers, warranty dates, service history, and photos.",
                    "customer_site_assets",
                ),
                (
                    "Create a Warranty Claims module for faulty products, claim dates, supplier responses, replacement status, and customer updates.",
                    "warranty_claims",
                ),
            ]:
                plan, _derived = main._ai_plan_from_message(request, session, prompt, answer_hints={})
                candidate_ops = plan.get("candidate_operations") or []
                affected_artifacts = plan.get("affected_artifacts") or []

                self.assertEqual(plan.get("required_questions"), ["Confirm this plan?"])
                self.assertEqual(len(candidate_ops), 1)
                self.assertEqual(candidate_ops[0]["op"], "create_module")
                self.assertEqual(candidate_ops[0]["artifact_id"], expected_module_id)
                self.assertEqual(
                    affected_artifacts,
                    [{"artifact_type": "module", "artifact_id": expected_module_id}],
                )

        def test_terminal_noop_plan_skips_confirm_for_existing_field(self):
            def _fake_slot_plan(*_args, **_kwargs):
                return {
                    "candidate_ops": [],
                    "questions": [],
                    "question_meta": None,
                    "assumptions": [],
                    "risk_flags": [],
                    "advisories": [],
                    "affected_modules": ["contacts"],
                    "planner_state": {
                        "intent": "field_already_exists_noop",
                        "module_id": "contacts",
                        "field_id": "contact.email",
                        "field_label": "Email",
                        "include_form": True,
                    },
                    "resolved_without_changes": True,
                }

            main._ai_slot_based_plan = _fake_slot_plan
            request = SimpleNamespace(state=SimpleNamespace(cache={}))
            session = {
                "id": "s-noop",
                "workspace_id": "default",
                "scope_mode": "auto",
                "selected_artifact_type": "module",
                "selected_artifact_key": "contacts",
            }

            plan, derived = main._ai_plan_from_message(request, session, "Add an email field to contacts.", answer_hints={})

            self.assertTrue(plan.get("resolved_without_changes"))
            self.assertEqual(plan.get("required_questions"), [])
            self.assertEqual(derived.get("status"), "ready_to_apply")

        def test_cleanup_duplicates_noop_assistant_text_is_specific(self):
            with open(os.path.join(ROOT, "manifests", "marketplace_v1", "contacts.json"), "r", encoding="utf-8") as fh:
                contacts_manifest = json.load(fh)

            plan = {
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "contacts"}],
                "proposed_changes": [],
                "candidate_operations": [],
                "required_questions": [],
                "required_question_meta": None,
                "resolved_without_changes": True,
                "planner_state": {
                    "intent": "cleanup_duplicates",
                    "module_id": "contacts",
                    "field_id": "contact.email",
                    "field_ref": "contact.email",
                },
                "assumptions": ["Field 'contact.email' is not currently duplicated."],
                "advisories": ["Field 'Email' is not currently duplicated in contacts."],
                "risk_flags": [],
                "noop_notes": ["Field 'Email' is not currently duplicated in contacts."],
            }
            context = {
                "full_selected_artifacts": [
                    {
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "manifest": contacts_manifest,
                    }
                ]
            }

            assistant_text = main._ai_plan_assistant_text(plan, context)

            self.assertIn("Field 'Email' is not currently duplicated in Contacts.", assistant_text)
            self.assertNotIn("Confirm this plan?", assistant_text)

        def test_create_module_prompt_generates_patchset_after_confirm_when_fallback_runs(self):
            main.generic_records = main.MemoryGenericRecordStore()
            main._ai_slot_based_plan = lambda *args, **kwargs: None
            main._ai_semantic_plan_from_model = lambda *args, **kwargs: None

            def _actor_for_request(_request):
                return {
                    "user_id": "u1",
                    "email": "u@example.com",
                    "role": "admin",
                    "workspace_role": "admin",
                    "platform_role": "superadmin",
                    "workspace_id": "default",
                    "workspaces": [{"workspace_id": "default", "role": "admin", "workspace_name": "Default"}],
                    "claims": {},
                }

            main._resolve_actor = _actor_for_request

            client = TestClient(main.app)
            try:
                create_response = client.post("/octo-ai/sessions", json={"title": "customer-site-assets"})
                self.assertEqual(create_response.status_code, 200, create_response.text)
                session_id = create_response.json()["session"]["id"]

                main.generic_records.update(
                    main._AI_ENTITY_SESSION,
                    session_id,
                    {"selected_artifact_type": "module", "selected_artifact_key": "contacts"},
                    tenant_id="default",
                )

                chat_response = client.post(
                    f"/octo-ai/sessions/{session_id}/chat",
                    json={
                        "message": "Build a Customer Site Assets module so we can track equipment installed at each customer site, serial numbers, warranty dates, service history, and photos."
                    },
                )
                self.assertEqual(chat_response.status_code, 200, chat_response.text)
                chat_body = chat_response.json()["plan"]
                self.assertEqual(chat_body["required_question_meta"]["id"], "confirm_plan")
                self.assertEqual(chat_body["candidate_operations"][0]["op"], "create_module")
                self.assertEqual(chat_body["candidate_operations"][0]["artifact_id"], "customer_site_assets")

                answer_response = client.post(
                    f"/octo-ai/sessions/{session_id}/questions/answer",
                    json={"action": "approve", "text": "Approved."},
                )
                self.assertEqual(answer_response.status_code, 200, answer_response.text)
                answer_body = answer_response.json()["plan"]
                self.assertEqual(answer_body["required_questions"], [])
                self.assertEqual(answer_body["candidate_operations"][0]["artifact_id"], "customer_site_assets")

                patchset_response = client.post(f"/octo-ai/sessions/{session_id}/patchsets/generate", json={})
                self.assertEqual(patchset_response.status_code, 200, patchset_response.text)
                patchset_body = patchset_response.json()
                self.assertTrue(patchset_body["ok"])
                self.assertEqual(patchset_body["patchset"]["status"], "draft")
            finally:
                client.close()


if __name__ == "__main__":
    unittest.main()
