import os
import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
from starlette.requests import Request

os.environ.setdefault("USE_DB", "0")
os.environ.setdefault("OCTO_DISABLE_AUTH", "1")
os.environ.setdefault("SUPABASE_URL", "http://localhost")

import app.main as main  # noqa: E402
from app.main import (  # noqa: E402
    _AI_ENTITY_MESSAGE,
    _AI_ENTITY_PATCHSET,
    _AI_ENTITY_PLAN,
    _AI_ENTITY_RELEASE,
    _AI_ENTITY_SESSION,
    _AI_ENTITY_SNAPSHOT,
    _ai_answer_restarts_request,
    _ai_page_block_digest,
    _ai_page_semantic_summary,
    _ai_module_semantic_summary,
    _ai_module_brief_for_semantic_planner,
    _ai_relevant_references,
    _ai_build_structured_plan,
    _ai_collect_answer_hints,
    _ai_detect_planning_mode,
    _ai_text_includes_revision_request,
    _ai_create_record,
    _ai_extract_explicit_module_targets_from_text,
    _ai_extract_field_label,
    _ai_extract_field_labels,
    _ai_focus_request_text,
    _ai_infer_field_type,
    _ai_get_record,
    _ai_parse_placement_answer,
    _ai_preflight_candidate_ops,
    _ai_extract_module_target_from_text,
    _ai_find_module_by_alias,
    _ai_is_create_module_request,
    _ai_latest_plan_for_session,
    _ai_merge_followup_candidate_ops,
    _ai_module_manifest_index,
    _ai_ops_workspace_id_for_session,
    _ai_plan_from_message,
    _ai_plan_assistant_text,
    _ai_record_data,
    _ai_strict_sandbox_workspace_id_for_session,
    _ai_session_release_records,
    _ai_resolve_field_reference,
    _ai_slot_based_plan,
    _ai_suggest_form_field_refs,
    _ai_update_record,
    _ai_validate_patchset_against_workspace,
    _ai_workspace_change_context_modules,
)


class TestOctoAiFieldResolution(unittest.TestCase):
    def test_page_semantic_summary_highlights_dashboard_elements(self) -> None:
        summary = _ai_page_semantic_summary(
            {
                "id": "construction.dashboard_page",
                "title": "Operations Dashboard",
                "layout": "single",
                "content": [
                    {
                        "kind": "stat_cards",
                        "cards": [
                            {
                                "id": "workers_on_site_today",
                                "label": "Workers On Site Today",
                                "entity_id": "entity.time_entry",
                                "measure": "count_distinct:time_entry.worker_id",
                            },
                            {
                                "id": "materials_logged_today",
                                "label": "Materials Logged Today",
                                "entity_id": "entity.material_log",
                                "measure": "count",
                                "target": "page:construction.material_report_page",
                            },
                        ],
                    },
                    {
                        "kind": "container",
                        "title": "Cost Breakdown",
                        "variant": "card",
                        "content": [
                            {
                                "kind": "view_modes",
                                "entity_id": "entity.construction_expense",
                                "default_mode": "graph",
                                "modes": [{"mode": "graph", "target": "view:construction_cost_summary.graph"}],
                            }
                        ],
                    },
                ],
            }
        )

        self.assertIn("Operations Dashboard", summary)
        self.assertIn("Workers On Site Today", summary)
        self.assertIn("Materials Logged Today", summary)
        self.assertIn("Cost Breakdown", summary)
        self.assertIn("material report page", summary)

    def test_page_block_digest_captures_dashboard_surfaces(self) -> None:
        digest = _ai_page_block_digest(
            [
                {
                    "kind": "stat_cards",
                    "cards": [
                        {
                            "id": "materials_logged_today",
                            "label": "Materials Logged Today",
                            "entity_id": "entity.material_log",
                            "measure": "count",
                            "target": "page:construction.material_report_page",
                        }
                    ],
                },
                {
                    "kind": "container",
                    "title": "Cost Breakdown",
                    "variant": "card",
                    "content": [
                        {
                            "kind": "view_modes",
                            "entity_id": "entity.construction_expense",
                            "default_mode": "graph",
                            "modes": [{"mode": "graph", "target": "view:construction_cost_summary.graph"}],
                        }
                    ],
                },
            ]
        )

        self.assertIn("stat_cards", digest["block_kinds"])
        self.assertIn("container", digest["block_kinds"])
        self.assertEqual(digest["stat_cards"][0]["label"], "Materials Logged Today")
        self.assertIn("construction.material_report_page", digest["linked_pages"])
        self.assertEqual(digest["view_modes"][0]["entity_id"], "entity.construction_expense")
        self.assertIn("graph", digest["view_modes"][0]["modes"])
        self.assertEqual(digest["containers"][0]["title"], "Cost Breakdown")

    def test_module_semantic_summary_mentions_dashboard_signals(self) -> None:
        manifest = {
            "module": {
                "id": "construction",
                "key": "construction",
                "name": "Construction",
                "description": "Unified construction management for projects and daily site operations.",
            },
            "entities": [
                {"id": "entity.construction_project"},
                {"id": "entity.material_log"},
            ],
            "pages": [
                {
                    "id": "construction.dashboard_page",
                    "title": "Operations Dashboard",
                    "layout": "single",
                    "content": [
                        {
                            "kind": "stat_cards",
                            "cards": [
                                {
                                    "id": "labour_hours_today",
                                    "label": "Total Labour Hours Today",
                                    "entity_id": "entity.time_entry",
                                    "measure": "sum:time_entry.hours_worked",
                                }
                            ],
                        }
                    ],
                }
            ],
        }

        summary = _ai_module_semantic_summary("construction", manifest)

        self.assertIn("Construction", summary)
        self.assertIn("Unified construction management", summary)
        self.assertIn("construction project", summary)
        self.assertIn("Operations Dashboard", summary)
        self.assertIn("Total Labour Hours Today", summary)

    def test_module_brief_includes_page_block_digest_for_dashboard_pages(self) -> None:
        manifest = {
            "module": {"id": "construction", "key": "construction", "name": "Construction"},
            "entities": [],
            "views": [],
            "pages": [
                {
                    "id": "construction.dashboard_page",
                    "title": "Operations Dashboard",
                    "layout": "single",
                    "content": [
                        {
                            "kind": "stat_cards",
                            "cards": [
                                {
                                    "id": "labour_hours_today",
                                    "label": "Total Labour Hours Today",
                                    "entity_id": "entity.time_entry",
                                    "measure": "sum:time_entry.hours_worked",
                                }
                            ],
                        }
                    ],
                }
            ],
            "actions": [],
        }

        brief = _ai_module_brief_for_semantic_planner("construction", manifest)

        self.assertEqual(brief["pages"][0]["id"], "construction.dashboard_page")
        self.assertEqual(
            brief["pages"][0]["page_block_digest"]["stat_cards"][0]["label"],
            "Total Labour Hours Today",
        )
        self.assertIn("Construction", brief["semantic_summary"])
        self.assertIn("Total Labour Hours Today", brief["pages"][0]["semantic_summary"])

    def test_relevant_references_include_construction_module_doc_for_dashboard_query(self) -> None:
        manifest_path = Path("manifests/construction_ops_v3/construction.json")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        module_index = {"construction": {"manifest": manifest}}

        references = _ai_relevant_references(
            "construction dashboard materials logged today cost breakdown daily reports",
            ["construction"],
            module_index,
            limit=10,
        )

        self.assertTrue(
            any(item.get("kind") == "module_doc" and "construction_ops_v3/README.md" in str(item.get("path")) for item in references),
            references,
        )

    def test_detect_planning_mode_prefers_preview_then_create_then_workspace(self) -> None:
        self.assertEqual(
            _ai_detect_planning_mode("preview this change", create_module_intent=True, preview_only=True),
            "preview_only",
        )
        self.assertEqual(
            _ai_detect_planning_mode("make me a new module for recipes", create_module_intent=True, preview_only=False),
            "create_module_design",
        )
        self.assertEqual(
            _ai_detect_planning_mode("add a button in Jobs that updates Invoices", create_module_intent=False, preview_only=False),
            "workspace_change",
        )

    def test_workspace_change_context_modules_prefers_dependency_slice(self) -> None:
        module_index = {
            "jobs": {"manifest": {"module": {"name": "Jobs"}}},
            "invoices": {"manifest": {"module": {"name": "Invoices"}}},
            "contacts": {"manifest": {"module": {"name": "Contacts"}}},
            "tasks": {"manifest": {"module": {"name": "Tasks"}}},
        }
        graph = {
            "nodes": [
                {"type": "module", "key": "jobs"},
                {"type": "module", "key": "invoices"},
                {"type": "module", "key": "contacts"},
                {"type": "module", "key": "tasks"},
            ],
            "edges": [
                {"from": "jobs", "type": "depends_on", "to": "invoices"},
                {"from": "invoices", "type": "depends_on", "to": "contacts"},
            ],
        }

        context_modules = _ai_workspace_change_context_modules(graph, module_index, ["jobs"], limit=4)

        self.assertEqual(context_modules[:3], ["jobs", "invoices", "contacts"])
        self.assertIn("tasks", context_modules)

    def test_semantic_planner_sends_workspace_change_context_slice_to_model(self) -> None:
        module_index = {
            "jobs": {"manifest": {"module": {"id": "jobs", "key": "jobs", "name": "Jobs"}, "entities": [], "views": [], "actions": []}},
            "invoices": {"manifest": {"module": {"id": "invoices", "key": "invoices", "name": "Invoices"}, "entities": [], "views": [], "actions": []}},
            "contacts": {"manifest": {"module": {"id": "contacts", "key": "contacts", "name": "Contacts"}, "entities": [], "views": [], "actions": []}},
            "tasks": {"manifest": {"module": {"id": "tasks", "key": "tasks", "name": "Tasks"}, "entities": [], "views": [], "actions": []}},
        }
        graph = {
            "nodes": [
                {"type": "module", "key": "jobs"},
                {"type": "module", "key": "invoices"},
                {"type": "module", "key": "contacts"},
                {"type": "module", "key": "tasks"},
            ],
            "edges": [
                {"from": "jobs", "type": "depends_on", "to": "invoices"},
                {"from": "invoices", "type": "depends_on", "to": "contacts"},
            ],
        }
        captured: dict = {}

        def fake_chat_completion(messages, **_kwargs):
            user_content = messages[1]["content"]
            start = user_content.find("```json\n") + len("```json\n")
            end = user_content.rfind("\n```")
            captured["context"] = main.json.loads(user_content[start:end])
            return {
                "choices": [
                    {
                        "message": {
                            "content": {
                                "affected_modules": ["jobs", "invoices"],
                                "proposed_changes": [],
                                "required_questions": [],
                                "assumptions": [],
                                "risk_flags": [],
                                "advisories": [],
                                "plan_v1": {
                                    "version": "1",
                                    "intent": "workspace_change",
                                    "summary": "Coordinate Jobs and Invoices changes.",
                                    "requested_scope": {"requested_modules": ["Jobs", "Invoices"], "missing_modules": []},
                                    "modules": [],
                                    "changes": [],
                                    "sections": [],
                                    "clarifications": {"items": [], "meta": {}},
                                    "assumptions": [],
                                    "risks": [],
                                    "noop_notes": [],
                                },
                            }
                        }
                    }
                ]
            }

        request = SimpleNamespace(state=SimpleNamespace(actor={"workspace_id": "ws_123"}))
        session = {"scope_mode": "auto", "selected_artifact_type": "module", "selected_artifact_key": "jobs"}

        with (
            patch.object(main, "USE_AI", True),
            patch.object(main, "_openai_configured", lambda: True),
            patch.object(main, "_openai_chat_completion", fake_chat_completion),
        ):
            result = main._ai_semantic_plan_from_model(
                request,
                session,
                "Add a button in Jobs that updates Invoices when a job is completed.",
                module_index,
                graph,
                ["jobs", "invoices"],
                planning_mode="workspace_change",
                answer_hints={},
            )

        self.assertIsInstance(result, dict)
        context = captured["context"]
        self.assertEqual(context["planning_mode"], "workspace_change")
        self.assertEqual(context["workspace_context_scope"]["seed_modules"], ["jobs", "invoices"])
        self.assertEqual(context["workspace_context_scope"]["context_modules"][:3], ["jobs", "invoices", "contacts"])
        self.assertEqual(
            [item["module_id"] for item in context["workspace_modules"][:3]],
            ["jobs", "invoices", "contacts"],
        )
        self.assertIn("semantic_summary", context["workspace_modules"][0])
        self.assertTrue(context["workspace_modules"][0]["semantic_summary"])
        self.assertIn("semantic_summary", context["workspace_kernel_digest"]["modules"][0])
        self.assertNotIn("tasks", context["workspace_context_scope"]["context_modules"][:3])

    def test_ops_workspace_prefers_real_sandbox_workspace_for_active_session(self) -> None:
        self.assertEqual(
            _ai_ops_workspace_id_for_session(
                {
                    "sandbox_workspace_id": "ws_sandbox_123",
                    "sandbox_status": "active",
                },
                "ws_live_456",
            ),
            "ws_sandbox_123",
        )

    def test_ops_workspace_falls_back_when_sandbox_is_virtual_or_discarded(self) -> None:
        self.assertEqual(
            _ai_ops_workspace_id_for_session(
                {
                    "sandbox_workspace_id": "sandbox_abc123",
                    "sandbox_status": "active",
                },
                "ws_live_456",
            ),
            "ws_live_456",
        )

    def test_strict_sandbox_workspace_unwraps_record_payload_and_never_falls_back(self) -> None:
        self.assertEqual(
            _ai_strict_sandbox_workspace_id_for_session(
                {
                    "record": {
                        "workspace_id": "ws_live_456",
                        "sandbox_workspace_id": "ws_sandbox_123",
                        "sandbox_status": "active",
                    }
                }
            ),
            "ws_sandbox_123",
        )
        self.assertIsNone(
            _ai_strict_sandbox_workspace_id_for_session(
                {
                    "record": {
                        "workspace_id": "ws_live_456",
                        "sandbox_workspace_id": "sandbox_virtual_only",
                        "sandbox_status": "active",
                    }
                }
            )
        )
        self.assertEqual(
            _ai_ops_workspace_id_for_session(
                {
                    "sandbox_workspace_id": "ws_sandbox_123",
                    "sandbox_status": "discarded",
                },
                "ws_live_456",
            ),
            "ws_live_456",
        )

    def test_ai_get_record_falls_back_to_list_scan_when_direct_get_misses(self) -> None:
        class _FallbackStore:
            def get(self, entity_id: str, record_id: str):  # type: ignore[no-untyped-def]
                return None

            def list(self, entity_id: str, limit: int = 5000):  # type: ignore[no-untyped-def]
                return [{"id": "session-123", "title": "Recovered session"}]

        with patch.object(main, "generic_records", _FallbackStore()):
            record = _ai_get_record(_AI_ENTITY_SESSION, " session-123 ")

        self.assertEqual(record, {"id": "session-123", "title": "Recovered session"})

    def test_bootstrap_cache_invalidation_only_clears_changed_module_entries(self) -> None:
        main._response_cache.clear()
        org_id = main.get_org_id()
        contacts_key = f"bootstrap:{org_id}:user-1:admin::contacts:hash-1:contact.form_page:::"
        jobs_key = f"bootstrap:{org_id}:user-1:admin::jobs:hash-2:job.form_page:::"
        records_key = f"records:get:{org_id}:entity.contact:record-1:"
        main._response_cache[contacts_key] = {"value": {"ok": True}, "ts": 0}
        main._response_cache[jobs_key] = {"value": {"ok": True}, "ts": 0}
        main._response_cache[records_key] = {"value": {"ok": True}, "ts": 0}

        main._resp_cache_invalidate_module_bootstrap("contacts")

        self.assertNotIn(contacts_key, main._response_cache)
        self.assertIn(jobs_key, main._response_cache)
        self.assertIn(records_key, main._response_cache)

    def test_infer_field_type_handles_dates_and_notes(self) -> None:
        self.assertEqual(_ai_infer_field_type("Add a Birthday field to Contacts."), "date")
        self.assertEqual(_ai_infer_field_type("Add an Anniversary Date field to Contacts."), "date")
        self.assertEqual(_ai_infer_field_type("Add Account Manager Notes to Contacts."), "text")
        self.assertEqual(_ai_infer_field_type("Make that field an int number field."), "int")

    def test_plan_text_stays_plain_language(self) -> None:
        text = _ai_plan_assistant_text(
            {
                "required_questions": ["Confirm this plan?"],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": [],
                "risk_flags": ["Cross-module impact detected; review dependencies before apply."],
                "advisories": [],
                "affected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "neetones"},
                    {"artifact_type": "module", "artifact_id": "module_27052f"},
                ],
                "proposed_changes": [
                    {
                        "op": "create_module",
                        "artifact_id": "neetones",
                        "manifest": {"module": {"name": "Neetones"}},
                    },
                    {
                        "op": "add_field",
                        "artifact_id": "module_27052f",
                        "field": {"label": "On Hold Reason", "type": "string"},
                    },
                ],
                "planner_state": {"intent": "create_module", "module_name": "Neetones"},
            },
            {
                "request_summary": "Create Neetones and add On Hold Reason to Contacts.",
                "full_selected_artifacts": [
                    {
                        "artifact_type": "module",
                        "artifact_id": "module_27052f",
                        "manifest": {"module": {"name": "Contacts"}},
                    }
                ],
            },
        )
        self.assertIn("Create a new module 'Neetones'.", text)
        self.assertIn("Create module 'Neetones'.", text)
        self.assertIn("Add field 'On Hold Reason' (string) in Contacts.", text)
        self.assertNotIn("candidate_operations", text)
        self.assertNotIn("artifact_id", text)
        self.assertNotIn("manifest", text.lower())

    def test_create_module_plan_text_uses_human_name_even_when_module_id_is_suffixed(self) -> None:
        manifest = main._ai_build_new_module_scaffold(
            "neetones_2",
            "Neetones",
            "Create a simple module for managing gym training sessions. Call it Neetones. Make it clean and modern.",
        )
        text = _ai_plan_assistant_text(
            {
                "required_questions": ["Confirm this plan?"],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": [],
                "risk_flags": [],
                "advisories": [],
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "neetones_2"}],
                "proposed_changes": [
                    {
                        "op": "create_module",
                        "artifact_id": "neetones_2",
                        "manifest": manifest,
                    }
                ],
                "planner_state": {"intent": "create_module", "module_name": "Neetones"},
            },
            {"request_summary": "Create a simple module for managing gym training sessions. Call it Neetones.", "full_selected_artifacts": []},
        )
        self.assertIn("Create a new module 'Neetones'.", text)
        self.assertNotIn("Neetones 2", text)

    def test_create_module_plan_text_compacts_duplicate_detail_sections(self) -> None:
        prompt = "Create a simple module for managing gym training sessions. Call it Neetones. Make it clean and modern."
        manifest = main._ai_build_new_module_scaffold("neetones_2", "Neetones", prompt)
        design_spec = main._ai_generate_module_design_spec("neetones_2", "Neetones", prompt)

        text = _ai_plan_assistant_text(
            {
                "required_questions": ["Confirm this plan?"],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": ["Built a richer starter scaffold based on the module type inferred from the request."],
                "risk_flags": [],
                "advisories": [],
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "neetones_2"}],
                "proposed_changes": [
                    {
                        "op": "create_module",
                        "artifact_type": "module",
                        "artifact_id": "neetones_2",
                        "manifest": manifest,
                        "design_spec": design_spec,
                    }
                ],
                "planner_state": {"intent": "create_module", "module_name": "Neetones"},
            },
            {"request_summary": prompt, "full_selected_artifacts": []},
        )

        self.assertIn("Module Blueprint:", text)
        self.assertIn("What to check in sandbox:", text)
        self.assertNotIn("Fields:\n", text)
        self.assertNotIn("Placement:\n", text)
        self.assertNotIn("Workflow & actions:\n", text)
        self.assertNotIn("Dependencies:\n", text)
        self.assertNotIn("Views & pages:\n", text)
        self.assertNotIn("Pages: Neetones, Neetones, Neetones Calendar.", text)

    def test_design_spec_blueprint_items_dedupes_duplicate_page_titles(self) -> None:
        items = main._ai_design_spec_blueprint_items(
            {
                "family": "training",
                "fields": [{"id": "session.name", "label": "Session Name", "type": "string"}],
                "workflow": {
                    "states": [
                        {"label": "Planned", "value": "planned"},
                        {"label": "Completed", "value": "completed"},
                    ],
                    "action_labels": ["Complete", "Complete"],
                },
                "experience": {
                    "views": ["list", "form", "list"],
                    "pages": [
                        {"id": "session.home", "title": "Sessions"},
                        {"id": "session.list", "title": "Sessions"},
                        {"id": "session.calendar", "title": "Sessions Calendar"},
                    ],
                    "interfaces": ["schedulable", "schedulable"],
                },
                "layout": {
                    "tabs": [
                        {"id": "overview", "label": "Overview"},
                        {"id": "overview_copy", "label": "Overview"},
                    ]
                },
            }
        )

        self.assertIn("Workflow buttons: Complete.", items)
        self.assertIn("Views: list, form.", items)
        self.assertIn("Pages: Sessions, Sessions Calendar.", items)
        self.assertIn("Form tabs: Overview.", items)
        self.assertIn("Interfaces: schedulable.", items)

    def test_structured_plan_normalizes_modules_changes_and_questions(self) -> None:
        structured = _ai_build_structured_plan(
            {
                "required_questions": ["Confirm this plan or tell me what to change."],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": ["Use the existing Contacts form."],
                "risk_flags": ["Review downstream automations before apply."],
                "affected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "contacts"},
                ],
                "proposed_changes": [
                    {
                        "op": "add_field",
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "field": {"label": "Level notes", "type": "text"},
                    }
                ],
                "planner_state": {"intent": "add_field"},
            },
            {
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "contacts", "manifest": {"module": {"name": "Contacts"}}},
                ],
            },
        )

        self.assertEqual(structured["intent"], "add_field")
        self.assertEqual(structured["version"], "1")
        self.assertEqual(structured["summary"], "Add a new field 'Level notes' to Contacts.")
        self.assertEqual(
            structured["modules"],
            [{"module_id": "contacts", "module_label": "Contacts", "status": "planned"}],
        )
        self.assertEqual(structured["changes"][0]["op"], "add_field")
        self.assertEqual(structured["changes"][0]["module_id"], "contacts")
        self.assertEqual(structured["changes"][0]["summary"], "Add field 'Level notes' (text) in Contacts.")
        self.assertEqual(
            structured["sections"],
            [
                {
                    "key": "fields",
                    "title": "Fields",
                    "items": ["Contacts: add 'Level notes' as a text field."],
                },
                {
                    "key": "sandbox_checks",
                    "title": "What to check in sandbox",
                    "items": ["Open Contacts and look for the 'Level notes' field on the affected form or view."],
                },
            ],
        )
        self.assertEqual(
            structured["requested_scope"],
            {"requested_modules": [], "missing_modules": []},
        )
        self.assertEqual(
            structured["clarifications"],
            {
                "items": ["Confirm this plan or tell me what to change."],
                "meta": {
                    "id": "confirm_plan",
                    "kind": "confirm_plan",
                    "prompt": "Confirm this plan or tell me what to change.",
                },
            },
        )
        self.assertEqual(structured["questions"]["meta"]["id"], "confirm_plan")
        self.assertEqual(structured["assumptions"], ["Use the existing Contacts form."])
        self.assertEqual(structured["risks"], ["Review downstream automations before apply."])

    def test_structured_plan_prefers_semantic_plan_v1_when_present(self) -> None:
        structured = _ai_build_structured_plan(
            {
                "required_questions": ["Confirm this plan or tell me what to change."],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "contacts"}],
                "proposed_changes": [
                    {
                        "op": "add_field",
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "field": {"label": "Render", "type": "string"},
                    }
                ],
                "planner_state": {"intent": "add_field"},
                "plan_v1": {
                    "version": "1",
                    "intent": "semantic_add_field",
                    "summary": "Add the Render field to Contacts and place it on the Master tab.",
                    "modules": [{"module_id": "contacts", "module_label": "Contacts", "status": "planned"}],
                    "changes": [
                        {
                            "op": "add_field",
                            "module_id": "contacts",
                            "module_label": "Contacts",
                            "summary": "Add field 'Render' (string) in Contacts.",
                        }
                    ],
                    "sections": [
                        {"key": "fields", "title": "Fields", "items": ["Contacts: add 'Render' as a string field."]},
                        {"key": "placement", "title": "Placement", "items": ["Place 'Render' on the Master tab in Contacts."]},
                    ],
                    "clarifications": {
                        "items": ["Confirm this plan or tell me what to change."],
                        "meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                    },
                    "assumptions": ["Use the existing Contacts form."],
                    "risks": ["Review downstream automations before apply."],
                    "noop_notes": [],
                },
            },
            {
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "contacts", "manifest": {"module": {"name": "Contacts"}}},
                ],
            },
        )

        self.assertEqual(structured["source"], "semantic_plan_v1")
        self.assertEqual(structured["intent"], "semantic_add_field")
        self.assertEqual(structured["summary"], "Add the Render field to Contacts and place it on the Master tab.")
        self.assertEqual(
            structured["sections"],
            [
                {"key": "fields", "title": "Fields", "items": ["Contacts: add 'Render' as a string field."]},
                {"key": "placement", "title": "Placement", "items": ["Place 'Render' on the Master tab in Contacts."]},
                {"key": "sandbox_checks", "title": "What to check in sandbox", "items": ["Open Contacts and look for the 'Render' field on the affected form or view."]},
            ],
        )
        self.assertEqual(structured["questions"]["meta"]["id"], "confirm_plan")

    def test_structured_plan_ignores_low_signal_semantic_summary_and_keeps_fallback(self) -> None:
        structured = _ai_build_structured_plan(
            {
                "required_questions": ["Confirm this plan?"],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "contacts"}],
                "proposed_changes": [
                    {
                        "op": "add_field",
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "field": {"label": "Render", "type": "string"},
                    }
                ],
                "planner_state": {"intent": "add_field"},
                "plan_v1": {
                    "version": "1",
                    "intent": "semantic_add_field",
                    "summary": "Update the workspace based on this request: add render",
                    "sections": [{"key": "fields", "title": "Fields", "items": ["Contacts: add 'Render' as a string field."]}],
                    "clarifications": {"items": ["Confirm this plan?"], "meta": {"id": "confirm_plan", "kind": "confirm_plan"}},
                },
            },
            {"full_selected_artifacts": [{"artifact_type": "module", "artifact_id": "contacts", "manifest": {"module": {"name": "Contacts"}}}]},
        )

        self.assertEqual(structured["summary"], "Add a new field 'Render' to Contacts.")

    def test_structured_plan_persists_design_spec_and_planning_mode_for_create_module(self) -> None:
        structured = _ai_build_structured_plan(
            {
                "required_questions": ["Confirm this plan?"],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "kitchen_recipes"}],
                "proposed_changes": [
                    {
                        "op": "create_module",
                        "artifact_type": "module",
                        "artifact_id": "kitchen_recipes",
                        "manifest": {
                            "module": {"name": "Kitchen Recipes"},
                            "entities": [{"id": "entity.kitchen_recipe", "label": "Kitchen Recipe", "fields": []}],
                            "views": [],
                            "pages": [],
                        },
                        "design_spec": {
                            "family": "recipe",
                            "fields": [
                                {"id": "kitchen_recipe.name", "label": "Recipe Name", "type": "string"},
                                {"id": "kitchen_recipe.ingredient_list", "label": "Ingredients", "type": "text"},
                            ],
                            "workflow": {
                                "states": [{"label": "Draft", "value": "draft"}, {"label": "Cooked", "value": "cooked"}],
                                "action_labels": ["Cook"],
                            },
                            "experience": {
                                "views": ["list", "form", "calendar"],
                                "pages": [{"id": "kitchen_recipe.list_page", "title": "Kitchen Recipes"}],
                                "interfaces": ["dashboardable", "schedulable"],
                            },
                            "layout": {
                                "tabs": [{"id": "overview_tab", "label": "Overview", "sections": ["overview"]}],
                            },
                        },
                    }
                ],
                "planner_state": {"intent": "create_module", "module_name": "Kitchen Recipes"},
            },
            {},
        )

        self.assertEqual(structured["planning_mode"], "create_module_design")
        self.assertEqual((structured.get("design_spec") or {}).get("family"), "recipe")
        self.assertEqual(structured["sections"][0]["key"], "module_blueprint")
        self.assertIn("Core fields: Recipe Name, Ingredients.", structured["sections"][0]["items"])

    def test_plan_assistant_text_renders_module_blueprint_section(self) -> None:
        text = _ai_plan_assistant_text(
            {
                "required_questions": ["Confirm this plan?"],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "kitchen_recipes"}],
                "proposed_changes": [
                    {
                        "op": "create_module",
                        "artifact_type": "module",
                        "artifact_id": "kitchen_recipes",
                        "manifest": {
                            "module": {"name": "Kitchen Recipes"},
                            "entities": [{"id": "entity.kitchen_recipe", "label": "Kitchen Recipe", "fields": []}],
                            "views": [],
                            "pages": [],
                        },
                        "design_spec": {
                            "family": "recipe",
                            "fields": [
                                {"id": "kitchen_recipe.name", "label": "Recipe Name", "type": "string"},
                                {"id": "kitchen_recipe.ingredient_list", "label": "Ingredients", "type": "text"},
                            ],
                            "workflow": {
                                "states": [{"label": "Draft", "value": "draft"}, {"label": "Cooked", "value": "cooked"}],
                                "action_labels": ["Cook"],
                            },
                            "experience": {
                                "views": ["list", "form", "calendar"],
                                "pages": [{"id": "kitchen_recipe.list_page", "title": "Kitchen Recipes"}],
                                "interfaces": ["dashboardable", "schedulable"],
                            },
                            "layout": {
                                "tabs": [{"id": "overview_tab", "label": "Overview", "sections": ["overview"]}],
                            },
                        },
                    }
                ],
                "planner_state": {"intent": "create_module", "module_name": "Kitchen Recipes"},
            },
            {},
        )

        self.assertIn("Module Blueprint:", text)
        self.assertIn("Design family: recipe.", text)
        self.assertIn("Core fields: Recipe Name, Ingredients.", text)

    def test_plan_assistant_text_prefers_semantic_summary_when_concrete(self) -> None:
        text = _ai_plan_assistant_text(
            {
                "required_questions": ["Confirm this plan?"],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "contacts"}],
                "proposed_changes": [
                    {
                        "op": "add_field",
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "field": {"label": "Render", "type": "string"},
                    }
                ],
                "planner_state": {"intent": "add_field"},
                "plan_v1": {
                    "version": "1",
                    "summary": "Add the Render field to Contacts and place it on the Master tab.",
                    "modules": [{"module_id": "contacts", "module_label": "Contacts", "status": "planned"}],
                    "changes": [{"op": "add_field", "module_id": "contacts", "module_label": "Contacts", "summary": "Add field 'Render' (string) in Contacts."}],
                    "sections": [{"key": "fields", "title": "Fields", "items": ["Contacts: add 'Render' as a string field."]}],
                    "clarifications": {"items": ["Confirm this plan?"], "meta": {"id": "confirm_plan", "kind": "confirm_plan"}},
                },
            },
            {"full_selected_artifacts": [{"artifact_type": "module", "artifact_id": "contacts", "manifest": {"module": {"name": "Contacts"}}}]},
        )

        self.assertIn("I understand this as:\n- Add the Render field to Contacts and place it on the Master tab.", text)

    def test_structured_plan_adds_dynamic_field_and_placement_sections_only_when_relevant(self) -> None:
        structured = _ai_build_structured_plan(
            {
                "required_questions": ["Confirm this plan or tell me what to change."],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": [],
                "risk_flags": [],
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "contacts"}],
                "proposed_changes": [
                    {
                        "op": "add_field",
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "field": {"id": "contact.render", "label": "Render", "type": "string"},
                    },
                    {
                        "op": "insert_section_field",
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "view_id": "contact.form",
                        "section_id": "master",
                        "field_id": "contact.render",
                        "placement_kind": "tab",
                        "placement_label": "Master",
                    },
                ],
                "planner_state": {"intent": "add_field"},
            },
            {
                "full_selected_artifacts": [
                    {
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "manifest": {
                            "module": {"name": "Contacts"},
                            "entities": [{"id": "entity.contact", "fields": [{"id": "contact.render", "label": "Render", "type": "string"}]}],
                            "views": [
                                {
                                    "id": "contact.form",
                                    "kind": "form",
                                    "header": {"tabs": {"tabs": [{"id": "master_tab", "label": "Master", "sections": ["master"]}]}},
                                    "sections": [{"id": "master", "title": "Master", "fields": []}],
                                }
                            ],
                        },
                    }
                ],
            },
        )

        section_titles = [section["title"] for section in structured["sections"]]
        self.assertEqual(section_titles, ["Fields", "Placement", "What to check in sandbox"])
        self.assertIn("Contacts: add 'Render' as a string field.", structured["sections"][0]["items"])
        self.assertIn("Contacts: put 'Render' in the 'Master' tab.", structured["sections"][1]["items"])

    def test_plan_text_includes_dynamic_relevant_sections_only(self) -> None:
        text = _ai_plan_assistant_text(
            {
                "required_questions": ["Confirm this plan or tell me what to change."],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": [],
                "risk_flags": [],
                "advisories": [],
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "contacts"}],
                "proposed_changes": [
                    {
                        "op": "add_field",
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "field": {"id": "contact.floor_plans", "label": "Floor plans", "type": "attachments"},
                    },
                    {
                        "op": "insert_section_field",
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "view_id": "contact.form",
                        "section_id": "master",
                        "field_id": "contact.floor_plans",
                        "placement_kind": "tab",
                        "placement_label": "Master",
                    },
                ],
                "planner_state": {"intent": "add_field"},
            },
            {
                "full_selected_artifacts": [
                    {
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "manifest": {
                            "module": {"name": "Contacts"},
                            "entities": [{"id": "entity.contact", "fields": [{"id": "contact.floor_plans", "label": "Floor plans", "type": "attachments"}]}],
                            "views": [
                                {
                                    "id": "contact.form",
                                    "kind": "form",
                                    "header": {"tabs": {"tabs": [{"id": "master_tab", "label": "Master", "sections": ["master"]}]}},
                                    "sections": [{"id": "master", "title": "Master", "fields": []}],
                                }
                            ],
                        },
                    }
                ],
            },
        )

        self.assertIn("Fields:", text)
        self.assertIn("Placement:", text)
        self.assertIn("What to check in sandbox:", text)
        self.assertNotIn("Workflow & actions:", text)
        self.assertIn("draft patchset for sandbox validation", text)

    def test_structured_plan_attachment_field_uses_plain_english_grammar_and_upload_check(self) -> None:
        structured = _ai_build_structured_plan(
            {
                "required_questions": ["Confirm this plan or tell me what to change."],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": [],
                "risk_flags": [],
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "contacts"}],
                "proposed_changes": [
                    {
                        "op": "add_field",
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "field": {"id": "contact.floor_plans", "label": "Floor plans", "type": "attachments"},
                    }
                ],
                "planner_state": {"intent": "add_field"},
            },
            {
                "full_selected_artifacts": [
                    {
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "manifest": {
                            "module": {"name": "Contacts"},
                            "entities": [{"id": "entity.contact", "fields": [{"id": "contact.floor_plans", "label": "Floor plans", "type": "attachments"}]}],
                            "views": [],
                        },
                    }
                ],
            },
        )

        sections_by_key = {section["key"]: section["items"] for section in structured["sections"]}
        self.assertIn("Contacts: add 'Floor plans' as an attachment field.", sections_by_key["fields"])
        self.assertIn(
            "Open Contacts, upload a sample file through 'Floor plans', and confirm it appears in sandbox.",
            sections_by_key["sandbox_checks"],
        )

    def test_structured_plan_covers_remove_trigger_dependency_and_page_block_changes(self) -> None:
        jobs_manifest = {
            "module": {"id": "jobs", "key": "jobs", "name": "Jobs"},
            "entities": [{"id": "entity.job", "fields": [{"id": "job.legacy_code", "label": "Legacy Code", "type": "string"}]}],
            "views": [
                {"id": "job.calendar", "kind": "calendar", "entity": "entity.job"},
            ],
        }
        contacts_manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [{"id": "entity.contact", "fields": []}],
            "views": [],
        }
        structured = _ai_build_structured_plan(
            {
                "required_questions": ["Confirm this plan or tell me what to change."],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": [],
                "risk_flags": [],
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "jobs"}],
                "proposed_changes": [
                    {"op": "remove_field", "artifact_type": "module", "artifact_id": "jobs", "field_id": "job.legacy_code"},
                    {"op": "remove_view", "artifact_type": "module", "artifact_id": "jobs", "view_id": "job.calendar"},
                    {
                        "op": "add_trigger",
                        "artifact_type": "module",
                        "artifact_id": "jobs",
                        "trigger": {"id": "job.follow_up", "label": "Follow-up Reminder"},
                    },
                    {"op": "add_page_block", "artifact_type": "module", "artifact_id": "jobs", "page_id": "dispatch_board"},
                    {
                        "op": "update_dependency",
                        "artifact_type": "module",
                        "artifact_id": "jobs",
                        "dependency": {"module": "contacts"},
                    },
                ],
                "planner_state": {"intent": "multi_request"},
            },
            {
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "jobs", "manifest": jobs_manifest},
                    {"artifact_type": "module", "artifact_id": "contacts", "manifest": contacts_manifest},
                ],
            },
        )

        sections_by_key = {section["key"]: section["items"] for section in structured["sections"]}
        self.assertIn("Jobs: remove 'Legacy Code'.", sections_by_key["fields"])
        self.assertIn("Jobs: add workflow trigger 'Follow-up Reminder'.", sections_by_key["workflow_actions"])
        self.assertIn("Jobs: update dependency settings for Contacts.", sections_by_key["dependencies"])
        self.assertIn("Jobs: remove the calendar view.", sections_by_key["views"])
        self.assertIn("Jobs: add a new block to page 'Dispatch Board'.", sections_by_key["views"])
        self.assertIn(
            "Open the module setup for Jobs and confirm the dependency on Contacts is reflected in sandbox.",
            sections_by_key["sandbox_checks"],
        )

    def test_structured_plan_humanizes_added_views_disabled_conditions_and_named_action_updates(self) -> None:
        contacts_manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [
                {
                    "id": "entity.contact",
                    "fields": [
                        {"id": "contact.notes", "label": "Internal Notes", "type": "text"},
                        {"id": "contact.approval_status", "label": "Approval Status", "type": "string"},
                    ],
                }
            ],
            "views": [],
            "actions": [{"id": "action.approve", "label": "Approve"}],
        }
        structured = _ai_build_structured_plan(
            {
                "required_questions": ["Confirm this plan or tell me what to change."],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": [],
                "risk_flags": [],
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "contacts"}],
                "proposed_changes": [
                    {
                        "op": "add_view",
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "view": {"id": "contact.calendar", "kind": "calendar", "entity": "entity.contact"},
                    },
                    {
                        "op": "update_field",
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "field_id": "contact.notes",
                        "changes": {
                            "disabled_when": {"op": "eq", "field": "contact.approval_status", "value": "approved"},
                        },
                    },
                    {
                        "op": "update_action",
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "action_id": "action.approve",
                        "changes": {
                            "enabled_when": {"op": "eq", "field": "contact.approval_status", "value": "pending"},
                        },
                    },
                ],
                "planner_state": {"intent": "multi_request"},
            },
            {
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "contacts", "manifest": contacts_manifest},
                ],
            },
        )

        sections_by_key = {section["key"]: section["items"] for section in structured["sections"]}
        self.assertIn("Contacts: add the calendar view.", sections_by_key["views"])
        self.assertIn("Contacts: update action 'Approve'.", sections_by_key["workflow_actions"])
        self.assertIn(
            "Contacts: 'Internal Notes' disabled when Approval Status is 'approved'.",
            sections_by_key["conditions"],
        )
        self.assertIn(
            "Open Contacts and confirm the calendar view is available in sandbox.",
            sections_by_key["sandbox_checks"],
        )
        self.assertIn(
            "Open Contacts, open a record, and confirm action 'Approve' is available in sandbox.",
            sections_by_key["sandbox_checks"],
        )

    def test_plan_text_uses_plain_english_for_field_and_action_conditions(self) -> None:
        contacts_manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [
                {
                    "id": "entity.contact",
                    "fields": [
                        {"id": "contact.name", "label": "Name", "type": "string"},
                        {"id": "contact.approval_status", "label": "Approval Status", "type": "string"},
                    ],
                }
            ],
            "views": [],
            "actions": [{"id": "action.approve", "label": "Approve"}],
        }

        text = _ai_plan_assistant_text(
            {
                "required_questions": ["Confirm this plan?"],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": [],
                "risk_flags": [],
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "contacts"}],
                "proposed_changes": [
                    {
                        "op": "add_field",
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "field": {
                            "id": "contact.manager_comments",
                            "label": "Manager Comments",
                            "type": "text",
                            "required_when": {"op": "eq", "field": "contact.approval_status", "value": "rejected"},
                        },
                    },
                    {
                        "op": "update_action",
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "action_id": "action.approve",
                        "changes": {
                            "enabled_when": {"op": "eq", "field": "contact.approval_status", "value": "pending"},
                        },
                    },
                ],
                "planner_state": {"intent": "multi_request"},
            },
            {
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "contacts", "manifest": contacts_manifest},
                ],
            },
        )

        self.assertIn("Add field 'Manager Comments' (text) in Contacts.", text)
        self.assertIn(
            "Make field 'Manager Comments' required when Approval Status is 'rejected' in Contacts.",
            text,
        )
        self.assertIn(
            "Enable action 'Approve' when Approval Status is 'pending' in Contacts.",
            text,
        )

    def test_structured_plan_adds_page_and_list_view_sandbox_checks(self) -> None:
        jobs_manifest = {
            "module": {"id": "jobs", "key": "jobs", "name": "Jobs"},
            "entities": [{"id": "entity.job", "fields": []}],
            "views": [{"id": "job.list", "kind": "list", "entity": "entity.job"}],
            "pages": [{"id": "dispatch_board", "title": "Dispatch Board"}],
        }
        structured = _ai_build_structured_plan(
            {
                "required_questions": ["Confirm this plan or tell me what to change."],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": [],
                "risk_flags": [],
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "jobs"}],
                "proposed_changes": [
                    {"op": "update_view_columns", "artifact_type": "module", "artifact_id": "jobs", "view_id": "job.list", "columns": ["job.number", "job.status"]},
                    {
                        "op": "add_page",
                        "artifact_type": "module",
                        "artifact_id": "jobs",
                        "page": {"id": "operations_console", "title": "Operations Console", "layout": "single", "content": []},
                    },
                    {
                        "op": "update_page",
                        "artifact_type": "module",
                        "artifact_id": "jobs",
                        "page_id": "dispatch_board",
                        "changes": {"title": "Dispatch Board", "content": [{"kind": "text", "text": "Updated"}]},
                    },
                ],
                "planner_state": {"intent": "multi_request"},
            },
            {
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "jobs", "manifest": jobs_manifest},
                ],
            },
        )

        sections_by_key = {section["key"]: section["items"] for section in structured["sections"]}
        self.assertIn("Jobs: update the columns in the list view.", sections_by_key["views"])
        self.assertIn("Jobs: add page 'Operations Console'.", sections_by_key["views"])
        self.assertIn("Jobs: update page 'Dispatch Board'.", sections_by_key["views"])
        self.assertIn(
            "Open Jobs and confirm the list view shows the updated columns in sandbox.",
            sections_by_key["sandbox_checks"],
        )
        self.assertIn(
            "Open page 'Operations Console' in Jobs and confirm it is available in sandbox.",
            sections_by_key["sandbox_checks"],
        )
        self.assertIn(
            "Open page 'Dispatch Board' in Jobs and confirm the updated layout renders in sandbox.",
            sections_by_key["sandbox_checks"],
        )

    def test_collect_answer_hints_keeps_existing_tab_target_after_tab_exists_resolution(self) -> None:
        session = _ai_create_record(
            _AI_ENTITY_SESSION,
            {"title": "tab follow-up", "status": "waiting_input", "created_at": main._ai_now()},
        )
        session_id = _ai_record_data(session)["id"]
        _ai_create_record(
            _AI_ENTITY_PLAN,
            {
                "session_id": session_id,
                "status": "draft",
                "questions_json": ["A form tab named 'Internal Notes' already exists. Should I update that tab instead?"],
                "required_question_meta": {
                    "id": "tab_exists_resolution",
                    "kind": "text",
                    "prompt": "A form tab named 'Internal Notes' already exists. Should I update that tab instead?",
                    "defaults": {"tab_target": "Internal Notes"},
                },
                "plan_json": {
                    "plan": {
                        "planner_state": {"intent": "add_field", "tab_label": "Internal Notes", "matched_tab": "Internal Notes"},
                        "candidate_operations": [],
                    }
                },
                "created_at": main._ai_now(),
            },
        )
        _ai_update_record(_AI_ENTITY_SESSION, session_id, {"latest_plan_id": _ai_latest_plan_for_session(session_id)["id"]})
        _ai_create_record(
            _AI_ENTITY_MESSAGE,
            {
                "session_id": session_id,
                "role": "user",
                "body": "can you add a field in contacts module in the internal notes tab called Billie",
                "message_type": "chat",
                "created_at": main._ai_now(),
            },
        )
        _ai_create_record(
            _AI_ENTITY_MESSAGE,
            {
                "session_id": session_id,
                "role": "user",
                "body": "i want you to add a field to that tab called billie",
                "message_type": "answer",
                "question_id": "tab_exists_resolution",
                "answer_json": {"tab_target": "Internal Notes", "answer_text": "i want you to add a field to that tab called billie"},
                "created_at": main._ai_now(),
            },
        )

        hints = _ai_collect_answer_hints(session_id)

        self.assertEqual(hints.get("tab_target"), "Internal Notes")

    def test_structured_plan_marks_noop_modules_truthfully(self) -> None:
        structured = _ai_build_structured_plan(
            {
                "required_questions": [],
                "required_question_meta": None,
                "assumptions": [],
                "risk_flags": [],
                "affected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "contacts"},
                ],
                "proposed_changes": [],
                "resolved_without_changes": True,
                "planner_state": {"intent": "field_missing_noop", "field_ref": "Legacy Code"},
            },
            {
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "contacts", "manifest": {"module": {"name": "Contacts"}}},
                ],
            },
        )

        self.assertEqual(
            structured["modules"],
            [{"module_id": "contacts", "module_label": "Contacts", "status": "no_change"}],
        )
        self.assertEqual(structured["summary"], "Field 'Legacy Code' does not appear in Contacts.")

    def test_structured_plan_marks_preview_only_modules_and_uses_ops_when_artifacts_are_missing(self) -> None:
        structured = _ai_build_structured_plan(
            {
                "required_questions": ["Confirm this plan?"],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": [],
                "risk_flags": [],
                "affected_artifacts": [],
                "proposed_changes": [
                    {
                        "op": "create_module",
                        "artifact_type": "module",
                        "artifact_id": "vendor_compliance",
                        "manifest": {"module": {"name": "Vendor Compliance"}},
                    }
                ],
                "resolved_without_changes": False,
                "planner_state": {
                    "intent": "preview_only_plan",
                    "requested_module_labels": ["Vendor Compliance", "Invoices"],
                    "missing_module_labels": ["Invoices"],
                },
            },
            {
                "request_summary": "For Vendor Compliance and Invoices, show me the rollout before you build anything.",
                "full_selected_artifacts": [],
            },
        )

        self.assertEqual(
            structured["modules"],
            [
                {"module_id": "vendor_compliance", "module_label": "Vendor Compliance", "status": "preview_only"},
                {"module_id": None, "module_label": "Invoices", "status": "missing_from_workspace"},
            ],
        )
        self.assertEqual(structured["questions"]["meta"]["id"], "confirm_plan")

    def test_structured_plan_tracks_mixed_operation_families(self) -> None:
        structured = _ai_build_structured_plan(
            {
                "required_questions": [],
                "required_question_meta": None,
                "assumptions": [],
                "risk_flags": [],
                "affected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "jobs"},
                ],
                "proposed_changes": [
                    {
                        "op": "add_field",
                        "artifact_type": "module",
                        "artifact_id": "jobs",
                        "field": {"label": "Owner Email", "type": "string"},
                    },
                    {
                        "op": "add_trigger",
                        "artifact_type": "module",
                        "artifact_id": "jobs",
                        "trigger": {"id": "jobs.created.notify", "event": "record.created"},
                    },
                    {
                        "op": "update_view",
                        "artifact_type": "module",
                        "artifact_id": "jobs",
                        "view_id": "job.form",
                        "changes": {"header": {"tabs": {"style": "lifted"}}},
                    },
                ],
                "planner_state": {"intent": "multi_request"},
            },
            {
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "jobs", "manifest": {"module": {"name": "Jobs"}}},
                ],
            },
        )

        self.assertEqual(
            structured["operation_families"],
            ["data_model_change", "automation_change", "ui_layout_change"],
        )
        self.assertEqual(structured["primary_operation_family"], "data_model_change")
        self.assertFalse(structured["needs_clarification"])

    def test_structured_plan_adds_cross_module_family_for_multi_module_ops(self) -> None:
        structured = _ai_build_structured_plan(
            {
                "required_questions": [],
                "required_question_meta": None,
                "assumptions": [],
                "risk_flags": [],
                "affected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "contacts"},
                    {"artifact_type": "module", "artifact_id": "jobs"},
                ],
                "proposed_changes": [
                    {
                        "op": "add_field",
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "field": {"label": "Priority", "type": "string"},
                    },
                    {
                        "op": "add_field",
                        "artifact_type": "module",
                        "artifact_id": "jobs",
                        "field": {"label": "Priority", "type": "string"},
                    },
                ],
                "planner_state": {"intent": "multi_request"},
            },
            {
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "contacts", "manifest": {"module": {"name": "Contacts"}}},
                    {"artifact_type": "module", "artifact_id": "jobs", "manifest": {"module": {"name": "Jobs"}}},
                ],
            },
        )

        self.assertEqual(
            structured["operation_families"],
            ["data_model_change", "cross_module_change"],
        )
        self.assertEqual(structured["primary_operation_family"], "data_model_change")

    def test_structured_plan_marks_clarification_state(self) -> None:
        structured = _ai_build_structured_plan(
            {
                "required_questions": ["Should this be a new module or an extension of Jobs?"],
                "required_question_meta": {"id": "scope_choice", "kind": "text"},
                "assumptions": [],
                "risk_flags": [],
                "affected_artifacts": [],
                "proposed_changes": [],
                "planner_state": {"intent": "multi_request"},
            },
            {"full_selected_artifacts": []},
        )

        self.assertTrue(structured["needs_clarification"])
        self.assertEqual(structured["clarifications"]["items"], ["Should this be a new module or an extension of Jobs?"])

    def test_structured_plan_keeps_template_family_for_preview_only_request(self) -> None:
        message = "Create a Service Report PDF template that includes customer details, work performed, technician notes, photos, and customer signoff."

        structured = _ai_build_structured_plan(
            {
                "required_questions": ["Confirm this plan?"],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": [],
                "risk_flags": [],
                "affected_artifacts": [],
                "proposed_changes": [],
                "planner_state": {"intent": "preview_only_plan"},
            },
            {"full_selected_artifacts": [], "request_summary": message},
        )

        self.assertEqual(structured["operation_families"], ["template_change"])
        self.assertEqual(structured["primary_operation_family"], "template_change")
        self.assertEqual(main._ai_preview_automation_lines(message), [])

    def test_structured_plan_keeps_integration_family_for_preview_only_request(self) -> None:
        message = "Set up Xero sync so approved Contacts and Invoices can be sent across, but only when the accounting fields are complete."

        structured = _ai_build_structured_plan(
            {
                "required_questions": ["Confirm this plan?"],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": [],
                "risk_flags": [],
                "affected_artifacts": [],
                "proposed_changes": [],
                "planner_state": {"intent": "preview_only_plan"},
            },
            {"full_selected_artifacts": [], "request_summary": message},
        )

        self.assertEqual(structured["operation_families"], ["integration_change"])
        self.assertEqual(structured["primary_operation_family"], "integration_change")

    def test_plan_text_lists_rollout_and_dependency_notes_for_cross_module_changes(self) -> None:
        text = _ai_plan_assistant_text(
            {
                "required_questions": ["Confirm this plan?"],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": [],
                "risk_flags": [],
                "advisories": [],
                "affected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "contacts"},
                    {"artifact_type": "module", "artifact_id": "jobs"},
                    {"artifact_type": "module", "artifact_id": "sales"},
                ],
                "proposed_changes": [
                    {
                        "op": "add_field",
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "field": {"label": "Customer Priority", "type": "string"},
                    },
                    {
                        "op": "add_field",
                        "artifact_type": "module",
                        "artifact_id": "jobs",
                        "field": {"label": "Customer Priority", "type": "string"},
                    },
                    {
                        "op": "add_field",
                        "artifact_type": "module",
                        "artifact_id": "sales",
                        "field": {"label": "Customer Priority", "type": "string"},
                    },
                ],
                "planner_state": {"intent": "multi_request"},
            },
            {
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "contacts", "manifest": {"module": {"name": "Contacts"}}},
                    {"artifact_type": "module", "artifact_id": "jobs", "manifest": {"module": {"name": "Jobs"}}},
                    {"artifact_type": "module", "artifact_id": "sales", "manifest": {"module": {"name": "Quotes"}}},
                ],
                "dependency_facts": {
                    "edges": [
                        {"from": "jobs", "to": "contacts", "type": "depends_on"},
                        {"from": "jobs", "to": "sales", "type": "depends_on"},
                        {"from": "sales", "to": "contacts", "type": "depends_on"},
                        {"from": "sales", "to": "jobs", "type": "depends_on"},
                    ]
                },
            },
        )

        self.assertIn("Rollout:", text)
        self.assertIn("Contacts: add 'Customer Priority'.", text)
        self.assertIn("Jobs: add 'Customer Priority'.", text)
        self.assertIn("Quotes: add 'Customer Priority'.", text)
        self.assertIn("Dependency notes:", text)
        self.assertIn("Jobs depends on Contacts and Quotes.", text)
        self.assertIn("dependency", text)

    def test_plan_text_rollout_humanizes_workflow_and_tab_changes_across_modules(self) -> None:
        text = _ai_plan_assistant_text(
            {
                "required_questions": ["Confirm this plan?"],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": [],
                "risk_flags": [],
                "advisories": [],
                "affected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "contacts"},
                    {"artifact_type": "module", "artifact_id": "jobs"},
                ],
                "proposed_changes": [
                    {
                        "op": "update_field",
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "field_id": "contact.status",
                        "changes": {
                            "options": [
                                {"value": "new", "label": "New"},
                                {"value": "contacted", "label": "Contacted"},
                            ]
                        },
                    },
                    {
                        "op": "update_workflow",
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "workflow_id": "workflow.contact_status",
                        "changes": {"states": [{"id": "new", "label": "New"}, {"id": "contacted", "label": "Contacted"}]},
                    },
                    {
                        "op": "update_view",
                        "artifact_type": "module",
                        "artifact_id": "jobs",
                        "view_id": "job.form",
                        "tab_label": "Master",
                    },
                    {
                        "op": "add_field",
                        "artifact_type": "module",
                        "artifact_id": "jobs",
                        "field": {"id": "job.master_notes", "label": "Master Notes", "type": "text"},
                    },
                ],
                "planner_state": {"intent": "multi_request"},
            },
            {
                "full_selected_artifacts": [
                    {
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "manifest": {
                            "module": {"name": "Contacts"},
                            "entities": [
                                {
                                    "id": "entity.contact",
                                    "fields": [
                                        {"id": "contact.status", "label": "Status", "type": "enum"},
                                    ],
                                }
                            ],
                            "views": [],
                        },
                    },
                    {
                        "artifact_type": "module",
                        "artifact_id": "jobs",
                        "manifest": {
                            "module": {"name": "Jobs"},
                            "entities": [
                                {
                                    "id": "entity.job",
                                    "fields": [
                                        {"id": "job.master_notes", "label": "Master Notes", "type": "text"},
                                    ],
                                }
                            ],
                            "views": [{"id": "job.form", "kind": "form"}],
                        },
                    },
                ]
            },
        )

        self.assertIn("Rollout:", text)
        self.assertIn("Contacts: add status 'Contacted' and update the status workflow and action buttons.", text)
        self.assertIn("Jobs: create tab 'Master' and add 'Master Notes'.", text)

    def test_plan_text_uses_page_titles_for_page_changes_and_lists_sandbox_checks(self) -> None:
        text = _ai_plan_assistant_text(
            {
                "required_questions": ["Confirm this plan?"],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": [],
                "risk_flags": [],
                "advisories": [],
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "jobs"}],
                "proposed_changes": [
                    {"op": "update_view_columns", "artifact_type": "module", "artifact_id": "jobs", "view_id": "job.list", "columns": ["job.number", "job.status"]},
                    {
                        "op": "add_page",
                        "artifact_type": "module",
                        "artifact_id": "jobs",
                        "page": {"id": "operations_console", "title": "Operations Console", "layout": "single", "content": []},
                    },
                    {
                        "op": "update_page",
                        "artifact_type": "module",
                        "artifact_id": "jobs",
                        "page_id": "dispatch_board",
                        "changes": {"title": "Dispatch Board", "content": [{"kind": "text", "text": "Updated"}]},
                    },
                ],
                "planner_state": {"intent": "multi_request"},
            },
            {
                "request_summary": "In Jobs, update the dispatch board page, add an operations console page, and tighten the list columns.",
                "full_selected_artifacts": [
                    {
                        "artifact_type": "module",
                        "artifact_id": "jobs",
                        "manifest": {
                            "module": {"name": "Jobs"},
                            "entities": [{"id": "entity.job", "fields": []}],
                            "views": [{"id": "job.list", "kind": "list", "entity": "entity.job"}],
                            "pages": [{"id": "dispatch_board", "title": "Dispatch Board"}],
                        },
                    }
                ],
            },
        )

        self.assertIn("Update page 'Dispatch Board' in Jobs.", text)
        self.assertIn("Add page 'Operations Console' in Jobs.", text)
        self.assertIn("Views & pages:", text)
        self.assertIn("What to check in sandbox:", text)
        self.assertIn("Open page 'Dispatch Board' in Jobs and confirm the updated layout renders in sandbox.", text)
        self.assertIn("Open page 'Operations Console' in Jobs and confirm it is available in sandbox.", text)

    def test_module_alias_resolution_ignores_articles(self) -> None:
        module_index = {
            "module_27052f": {
                "manifest": {
                    "module": {
                        "id": "module_27052f",
                        "key": "contacts",
                        "name": "Contacts",
                    }
                }
            }
        }

        self.assertEqual(
            _ai_find_module_by_alias("the Contacts", ["module_27052f"], module_index),
            "module_27052f",
        )
        self.assertEqual(
            _ai_extract_module_target_from_text(
                "Add a field called On Hold Reason to the Contacts module and put it in the Internal Notes tab.",
                ["module_27052f"],
                module_index,
            ),
            "module_27052f",
        )
        self.assertEqual(
            _ai_extract_module_target_from_text(
                "Move the roblux field into the Internal Notes tab in Contacts.",
                ["module_27052f"],
                module_index,
            ),
            "module_27052f",
        )

    def test_cross_module_rollout_keeps_scoped_modules_when_field_label_contains_module_alias(self) -> None:
        with TestClient(main.app):
            request = Request({"type": "http", "method": "GET", "headers": []})
            request.state.actor = {"workspace_id": "default", "user_id": "test-user"}
            module_index = _ai_module_manifest_index(request)

        plan = _ai_slot_based_plan(
            "Across Contacts, Jobs, and Quotes, add a Customer Priority field and keep it consistent everywhere. Show me the module-by-module rollout and any dependency notes before you build it.",
            list(module_index.keys()),
            module_index,
            answer_hints=None,
        )

        add_ops = [op for op in (plan.get("candidate_ops") or []) if op.get("op") == "add_field"]

        self.assertEqual(plan.get("affected_modules"), ["contacts", "jobs", "sales"])
        self.assertEqual([op.get("artifact_id") for op in add_ops], ["contacts", "jobs", "sales"])
        self.assertEqual([op.get("field", {}).get("label") for op in add_ops], ["Customer Priority", "Customer Priority", "Customer Priority"])

    def test_extract_requested_module_labels_handles_connector_style_cross_module_briefs(self) -> None:
        labels = main._ai_extract_requested_module_labels(
            "Set up a project handover process that links Sales, Jobs, Calendar, and Documents so operations has everything before work starts."
        )

        self.assertEqual(labels, ["Sales", "Jobs", "Calendar", "Documents"])

    def test_extract_requested_module_labels_handles_explicit_module_list_and_shared_reuse(self) -> None:
        labels = main._ai_extract_requested_module_labels(
            "Reuse the shared contacts module for client records.\n\n"
            "Build only 2 custom modules:\n\n"
            "work_management\n"
            "billing\n\n"
            "Module 1: work_management\n"
            "Module 2: billing\n"
        )

        self.assertEqual(labels, ["Contacts", "Work Management", "Billing"])

    def test_extract_field_labels_stays_generic_across_modules(self) -> None:
        labels = _ai_extract_field_labels("Remove the fields VIP Level and Legacy Code from the Jobs module.")

        self.assertEqual(labels, ["VIP Level", "Legacy Code"])

    def test_attachment_field_prompt_uses_explicit_label_instead_of_generic_attachment(self) -> None:
        with TestClient(main.app):
            request = Request({"type": "http", "method": "GET", "headers": []})
            request.state.actor = {"workspace_id": "default", "user_id": "test-user"}
            module_index = _ai_module_manifest_index(request)

        self.assertEqual(
            _ai_extract_field_label(
                "I want to add an attachment field to the Master tab in Contacts module, this attachment field should be labeled Floor plans."
            ),
            "Floor plans",
        )

        plan = _ai_slot_based_plan(
            "I want to add an attachment field to the Master tab in Contacts module, this attachment field should be labeled Floor plans.",
            list(module_index.keys()),
            module_index,
            answer_hints=None,
        )

        add_ops = [op for op in (plan.get("candidate_ops") or []) if op.get("op") == "add_field"]
        self.assertTrue(add_ops)
        self.assertEqual(add_ops[0].get("field", {}).get("label"), "Floor plans")
        self.assertEqual(add_ops[0].get("field", {}).get("type"), "attachments")

    def test_greeting_only_request_prompts_for_real_change_instead_of_field_name(self) -> None:
        plan = _ai_slot_based_plan(
            "hey",
            [],
            {},
            answer_hints=None,
        )

        self.assertEqual(plan.get("candidate_ops"), [])
        self.assertEqual(plan.get("questions"), ["What would you like me to build or change in this sandbox?"])
        self.assertEqual((plan.get("question_meta") or {}).get("id"), "open_request")
        self.assertEqual((plan.get("planner_state") or {}).get("intent"), "greeting_only")

    def test_status_request_updates_existing_status_workflow_instead_of_adding_field(self) -> None:
        with TestClient(main.app):
            request = Request({"type": "http", "method": "GET", "headers": []})
            request.state.actor = {"workspace_id": "default", "user_id": "test-user"}
            module_index = _ai_module_manifest_index(request)

        contacts_module_id = _ai_find_module_by_alias("contacts", list(module_index.keys()), module_index)
        self.assertIsInstance(contacts_module_id, str)

        plan = _ai_slot_based_plan(
            'in contacts can you create a new status with "contacted" is the status and put the relevant action buttons need to switch through our status?',
            [contacts_module_id],
            module_index,
            answer_hints=None,
        )

        ops = [op for op in (plan.get("candidate_ops") or []) if isinstance(op, dict)]
        self.assertNotIn("add_field", [op.get("op") for op in ops])

        update_field_ops = [op for op in ops if op.get("op") == "update_field"]
        update_workflow_ops = [op for op in ops if op.get("op") == "update_workflow"]

        self.assertEqual(len(update_field_ops), 1)
        self.assertEqual(len(update_workflow_ops), 1)
        self.assertEqual(update_field_ops[0].get("field_id"), "contact.status")
        self.assertIn(
            {"value": "contacted", "label": "contacted"},
            update_field_ops[0].get("changes", {}).get("options", []),
        )
        workflow_states = update_workflow_ops[0].get("changes", {}).get("states", [])
        self.assertTrue(any(isinstance(state, dict) and state.get("id") == "contacted" for state in workflow_states))
        self.assertEqual((plan.get("planner_state") or {}).get("intent"), "status_update")
        text = _ai_plan_assistant_text(
            {
                "required_questions": ["Confirm this plan or tell me what to change."],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": plan.get("assumptions") or [],
                "risk_flags": [],
                "advisories": plan.get("advisories") or [],
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": contacts_module_id}],
                "proposed_changes": ops,
                "planner_state": plan.get("planner_state") or {},
            },
            {
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": contacts_module_id, "manifest": module_index[contacts_module_id]["manifest"]},
                ],
                "request_summary": 'in contacts can you create a new status with "contacted" is the status and put the relevant action buttons need to switch through our status?',
            },
        )
        self.assertIn("Add status 'contacted' to Contacts.", text)
        self.assertIn("Update the status workflow and action buttons in Contacts.", text)

    def test_status_request_does_not_expand_scope_from_generic_records_language(self) -> None:
        contacts_manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [
                {
                    "id": "entity.contact",
                    "label": "Contact",
                    "fields": [
                        {"id": "contact.name", "label": "Name", "type": "string"},
                        {
                            "id": "contact.status",
                            "label": "Status",
                            "type": "enum",
                            "options": [
                                {"value": "new", "label": "New"},
                                {"value": "qualified", "label": "Qualified"},
                            ],
                        },
                    ],
                }
            ],
            "views": [],
            "workflows": [
                {
                    "id": "contact.status.workflow",
                    "entity": "entity.contact",
                    "status_field": "contact.status",
                    "states": [
                        {"id": "new", "label": "New"},
                        {"id": "qualified", "label": "Qualified"},
                    ],
                }
            ],
        }
        documents_manifest = {
            "module": {"id": "documents", "key": "documents", "name": "Documents"},
            "app": {
                "nav": [
                    {
                        "group": "Documents",
                        "items": [{"label": "Records", "to": "page:document_record.list_page"}],
                    }
                ]
            },
            "entities": [
                {
                    "id": "entity.document_record",
                    "label": "Document Record",
                    "fields": [
                        {
                            "id": "document_record.status",
                            "label": "Status",
                            "type": "enum",
                            "options": [{"value": "active", "label": "Active"}],
                        }
                    ],
                }
            ],
            "views": [],
            "workflows": [
                {
                    "id": "document_record.status.workflow",
                    "entity": "entity.document_record",
                    "status_field": "document_record.status",
                    "states": [{"id": "active", "label": "Active"}],
                }
            ],
        }
        module_index = {
            "contacts": {"manifest": contacts_manifest},
            "documents": {"manifest": documents_manifest},
        }
        message = "In Contacts, add a new Contacted status and add an action button called Set: Contacted so staff can move records through that status clearly."

        self.assertEqual(
            _ai_extract_explicit_module_targets_from_text(message, list(module_index.keys()), module_index),
            ["contacts"],
        )

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: module_index),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, _derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        self.assertEqual([item.get("artifact_id") for item in (plan.get("affected_artifacts") or [])], ["contacts"])
        self.assertEqual(
            [item.get("artifact_id") for item in (plan.get("proposed_changes") or []) if isinstance(item, dict)],
            ["contacts", "contacts"],
        )
        self.assertEqual((plan.get("required_question_meta") or {}).get("id"), "confirm_plan")
        text = _ai_plan_assistant_text(
            plan,
            {
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "contacts", "manifest": contacts_manifest},
                    {"artifact_type": "module", "artifact_id": "documents", "manifest": documents_manifest},
                ]
            },
        )
        self.assertIn("Add status 'Contacted' to Contacts.", text)
        self.assertNotIn("Records", text)

    def test_plan_from_message_keeps_semantic_plan_v1_payload(self) -> None:
        manifest = {
            "module": {"id": "module_contacts", "key": "contacts", "name": "Contacts"},
            "entities": [{"id": "entity.contact", "fields": [{"id": "contact.name", "label": "Name", "type": "string"}]}],
            "views": [],
        }
        module_index = {"contacts": {"manifest": manifest}}

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: module_index),
            patch.object(main, "_ai_slot_based_plan", lambda *_args, **_kwargs: None),
            patch.object(
                main,
                "_ai_semantic_plan_from_model",
                lambda *_args, **_kwargs: {
                    "candidate_ops": [
                        {
                            "op": "add_field",
                            "artifact_type": "module",
                            "artifact_id": "contacts",
                            "field": {"label": "Render", "type": "string"},
                        }
                    ],
                    "questions": ["Confirm this plan?"],
                    "question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                    "affected_modules": ["contacts"],
                    "plan_v1": {
                        "version": "1",
                        "intent": "semantic_add_field",
                        "summary": "Add Render to Contacts.",
                        "modules": [{"module_id": "contacts", "module_label": "Contacts", "status": "planned"}],
                        "changes": [
                            {
                                "op": "add_field",
                                "module_id": "contacts",
                                "module_label": "Contacts",
                                "summary": "Add field 'Render' (string) in Contacts.",
                            }
                        ],
                        "sections": [{"key": "fields", "title": "Fields", "items": ["Contacts: add 'Render' as a string field."]}],
                        "clarifications": {"items": ["Confirm this plan?"], "meta": {"id": "confirm_plan", "kind": "confirm_plan"}},
                        "assumptions": [],
                        "risks": [],
                        "noop_notes": [],
                    },
                },
            ),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                "Add a Render field to Contacts.",
                answer_hints={},
            )

        self.assertEqual(plan.get("plan_v1", {}).get("summary"), "Add Render to Contacts.")
        self.assertEqual(plan.get("plan_v1", {}).get("intent"), "semantic_add_field")
        self.assertEqual(derived.get("status"), "waiting_input")

    def test_slot_plan_uses_contacts_scope_for_field_flows(self) -> None:
        manifest = {
            "module": {"id": "module_27052f", "key": "contacts", "name": "Contacts"},
            "entities": [
                {
                    "id": "entity.contact",
                    "fields": [
                        {"id": "contact.name", "label": "Name", "type": "string"},
                        {"id": "contact.roblux", "label": "roblux", "type": "string"},
                    ],
                }
            ],
            "views": [
                {
                    "id": "contact.form",
                    "kind": "form",
                    "entity": "entity.contact",
                    "header": {
                        "tabs": {
                            "tabs": [
                                {"id": "primary_tab", "label": "Primary", "sections": ["primary"]},
                                {"id": "internal_notes", "label": "Internal Notes", "sections": ["notes"]},
                            ]
                        }
                    },
                    "sections": [
                        {"id": "primary", "fields": ["contact.name", "contact.roblux"]},
                        {"id": "notes", "fields": []},
                    ],
                }
            ],
        }
        module_index = {"module_27052f": {"manifest": manifest}}

        add_plan = _ai_slot_based_plan(
            "Add a field called On Hold Reason to the Contacts module and put it in the Internal Notes tab.",
            [],
            module_index,
            answer_hints=None,
        )
        self.assertEqual(add_plan.get("questions"), [])
        self.assertIn("module_27052f", add_plan.get("affected_modules", []))
        self.assertIn("add_field", [op.get("op") for op in add_plan.get("candidate_ops", [])])

        remove_plan = _ai_slot_based_plan(
            "Remove the roblux field from the Contacts module.",
            [],
            module_index,
            answer_hints=None,
        )
        self.assertEqual(remove_plan.get("questions"), [])
        self.assertIn("remove_field", [op.get("op") for op in remove_plan.get("candidate_ops", [])])

    def test_plan_from_message_keeps_internal_module_id_but_exposes_stable_artifact_key(self) -> None:
        manifest = {
            "module": {"id": "module_27052f", "key": "contacts", "name": "Contacts"},
            "entities": [
                {
                    "id": "entity.contact",
                    "fields": [{"id": "contact.name", "label": "Name", "type": "string"}],
                }
            ],
            "views": [
                {"id": "contact.list", "kind": "list", "entity": "entity.contact", "columns": [{"field_id": "contact.name"}]},
                {"id": "contact.form", "kind": "form", "entity": "entity.contact", "sections": [{"id": "primary", "fields": ["contact.name"]}]},
            ],
        }
        module_index = {"module_27052f": {"manifest": manifest}}

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: module_index),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                "Add a Birthday field to the Contacts module form only.",
                answer_hints={},
            )

        self.assertEqual(derived.get("affected_modules"), ["module_27052f"])
        artifact = (plan.get("affected_artifacts") or [None])[0]
        self.assertEqual((artifact or {}).get("artifact_id"), "module_27052f")
        self.assertEqual((artifact or {}).get("artifact_key"), "contacts")

    def test_slot_plan_prefers_new_field_request_over_stale_field_hints(self) -> None:
        manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [
                {
                    "id": "entity.contact",
                    "fields": [{"id": "contact.name", "label": "Name", "type": "string"}],
                }
            ],
            "views": [],
        }
        module_index = {"contacts": {"manifest": manifest}}

        plan = _ai_slot_based_plan(
            "Also add Status.",
            ["contacts"],
            module_index,
            answer_hints={
                "module_target": "contacts",
                "field_label": "Birthday",
                "field_id": "contact.birthday",
                "field_type": "date",
            },
        )

        self.assertEqual(plan.get("questions"), [])
        add_ops = [op for op in plan.get("candidate_ops", []) if op.get("op") == "add_field"]
        self.assertEqual(len(add_ops), 1)
        self.assertEqual(add_ops[0].get("artifact_id"), "contacts")
        self.assertEqual(add_ops[0].get("field", {}).get("label"), "Status")
        self.assertEqual(add_ops[0].get("field", {}).get("id"), "contact.status")
        self.assertEqual(add_ops[0].get("field", {}).get("type"), "string")

    def test_slot_plan_keeps_carried_field_context_for_pronoun_followup(self) -> None:
        manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [
                {
                    "id": "entity.contact",
                    "fields": [
                        {"id": "contact.name", "label": "Name", "type": "string"},
                        {"id": "contact.birthday", "label": "Birthday", "type": "date"},
                    ],
                }
            ],
            "views": [
                {
                    "id": "contact.form",
                    "kind": "form",
                    "entity": "entity.contact",
                    "header": {
                        "tabs": {
                            "tabs": [
                                {"id": "primary_tab", "label": "Primary", "sections": ["primary"]},
                                {"id": "internal_notes", "label": "Internal Notes", "sections": ["notes"]},
                            ]
                        }
                    },
                    "sections": [
                        {"id": "primary", "fields": ["contact.name", "contact.birthday"]},
                        {"id": "notes", "fields": []},
                    ],
                }
            ],
        }
        module_index = {"contacts": {"manifest": manifest}}

        plan = _ai_slot_based_plan(
            "Move that field into the Internal Notes tab.",
            ["contacts"],
            module_index,
            answer_hints={
                "module_target": "contacts",
                "field_label": "Birthday",
                "field_id": "contact.birthday",
            },
        )

        self.assertEqual(plan.get("questions"), [])
        move_ops = [op for op in plan.get("candidate_ops", []) if op.get("op") == "update_view"]
        self.assertEqual(len(move_ops), 1)
        self.assertEqual(move_ops[0].get("artifact_id"), "contacts")
        sections = move_ops[0].get("changes", {}).get("sections", [])
        self.assertEqual(sections[0].get("fields"), ["contact.name"])
        self.assertEqual(sections[1].get("fields"), ["contact.birthday"])
        self.assertEqual((plan.get("planner_state") or {}).get("field_ref"), "contact.birthday")

    def test_slot_plan_marks_missing_field_removal_as_noop(self) -> None:
        manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [
                {
                    "id": "entity.contact",
                    "fields": [{"id": "contact.name", "label": "Name", "type": "string"}],
                }
            ],
            "views": [],
        }
        module_index = {"contacts": {"manifest": manifest}}

        plan = _ai_slot_based_plan(
            "Remove the roblux field from the Contacts module.",
            [],
            module_index,
            answer_hints=None,
        )

        self.assertEqual(plan.get("questions"), [])
        self.assertTrue(plan.get("resolved_without_changes"))
        self.assertEqual((plan.get("planner_state") or {}).get("intent"), "field_missing_noop")

    def test_slot_plan_marks_missing_field_move_as_noop(self) -> None:
        manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [
                {
                    "id": "entity.contact",
                    "fields": [{"id": "contact.name", "label": "Name", "type": "string"}],
                }
            ],
            "views": [
                {
                    "id": "contact.form",
                    "kind": "form",
                    "entity": "entity.contact",
                    "header": {
                        "tabs": {
                            "tabs": [
                                {"id": "internal_notes", "label": "Internal Notes", "sections": ["notes"]},
                            ]
                        }
                    },
                    "sections": [{"id": "notes", "fields": []}],
                }
            ],
        }
        module_index = {"contacts": {"manifest": manifest}}

        plan = _ai_slot_based_plan(
            "Move the roblux field into the Internal Notes tab in Contacts.",
            [],
            module_index,
            answer_hints=None,
        )

        self.assertEqual(plan.get("questions"), [])
        self.assertTrue(plan.get("resolved_without_changes"))
        self.assertEqual((plan.get("planner_state") or {}).get("intent"), "field_missing_noop")

    def test_slot_plan_asks_for_field_name_when_add_request_is_unspecified(self) -> None:
        manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [
                {
                    "id": "entity.contact",
                    "fields": [{"id": "contact.name", "label": "Name", "type": "string"}],
                }
            ],
            "views": [],
        }
        module_index = {"contacts": {"manifest": manifest}}

        plan = _ai_slot_based_plan(
            "Add a field to Contacts.",
            [],
            module_index,
            answer_hints=None,
        )

        self.assertEqual(plan.get("candidate_ops"), [])
        self.assertEqual(plan.get("questions"), ["What should the new field be called?"])
        self.assertEqual((plan.get("question_meta") or {}).get("id"), "field_spec")

    def test_create_module_scope_ignores_existing_module_word_inside_new_name(self) -> None:
        tasks_manifest = {
            "module": {"id": "tasks", "key": "tasks", "name": "Tasks"},
            "entities": [{"id": "entity.task", "label": "Task", "fields": []}],
            "views": [],
        }
        module_index = {"tasks": {"manifest": tasks_manifest}}
        message = "Create a module called Onboarding Tasks with statuses To Do, In Progress, Done, owner assignment, due dates, and approval-style closeout actions."

        self.assertIsNone(_ai_extract_module_target_from_text(message, ["tasks"], module_index))
        self.assertEqual(_ai_extract_explicit_module_targets_from_text(message, ["tasks"], module_index), [])

        plan = _ai_slot_based_plan(message, ["tasks"], module_index, answer_hints=None)

        self.assertEqual(plan.get("questions"), [])
        create_ops = [op for op in (plan.get("candidate_ops") or []) if op.get("op") == "create_module"]
        self.assertEqual(len(create_ops), 1)
        self.assertEqual(create_ops[0].get("artifact_id"), "onboarding_tasks")

    def test_create_module_request_does_not_downgrade_from_generic_jobs_domain_words(self) -> None:
        jobs_manifest = {
            "module": {"id": "jobs", "key": "jobs", "name": "Jobs"},
            "entities": [{"id": "entity.job", "label": "Job", "fields": []}],
            "views": [],
        }
        module_index = {"jobs": {"manifest": jobs_manifest}}
        message = (
            "hi please make me a new module to track my contracting jobs for software engineering, "
            "please add all the features/ form fields/tabs you think ill need!"
        )

        plan = _ai_slot_based_plan(message, ["jobs"], module_index, answer_hints=None)

        self.assertEqual(plan.get("questions"), [])
        create_ops = [op for op in (plan.get("candidate_ops") or []) if op.get("op") == "create_module"]
        self.assertEqual(len(create_ops), 1)
        self.assertEqual(create_ops[0].get("artifact_id"), "software_delivery")
        self.assertEqual(((create_ops[0].get("manifest") or {}).get("module") or {}).get("name"), "Software Delivery")
        self.assertEqual((plan.get("planner_state") or {}).get("intent"), "create_module")

    def test_plan_from_message_create_module_ignores_selected_module_scope_and_prior_plan_merge(self) -> None:
        jobs_manifest = {
            "module": {"id": "jobs", "key": "jobs", "name": "Jobs"},
            "entities": [{"id": "entity.job", "label": "Job", "fields": [{"id": "job.title", "label": "Title", "type": "string"}]}],
            "views": [{"id": "job.form", "kind": "form", "entity": "entity.job", "sections": [{"id": "main", "fields": ["job.title"]}]}],
        }
        module_index = {"jobs": {"manifest": jobs_manifest}}
        session = {
            "scope_mode": "auto",
            "selected_artifact_type": "module",
            "selected_artifact_key": "jobs",
            "status": "planning",
        }
        answer_hints = {
            "pending_candidate_ops": [
                {
                    "op": "update_view",
                    "artifact_type": "module",
                    "artifact_id": "jobs",
                    "view_id": "job.form",
                    "changes": {"header": {"tabs": {"tabs": [{"id": "dates", "label": "Dates"}]}}},
                }
            ],
            "pending_affected_modules": ["jobs"],
        }

        with patch.object(main, "_ai_build_workspace_graph", lambda _request: {}), patch.object(main, "_ai_module_manifest_index", lambda _request: module_index):
            plan, derived = _ai_plan_from_message(
                None,
                session,
                "make me a new module to track software engineering contracting jobs",
                answer_hints=answer_hints,
            )

        create_ops = [op for op in (plan.get("proposed_changes") or []) if isinstance(op, dict) and op.get("op") == "create_module"]
        self.assertEqual(len(create_ops), 1)
        self.assertEqual(create_ops[0].get("artifact_id"), "software_delivery")
        self.assertEqual([item.get("artifact_id") for item in (plan.get("affected_artifacts") or [])], ["software_delivery"])
        self.assertEqual(derived.get("affected_modules"), ["software_delivery"])
        self.assertNotIn("Some proposed operations were invalid against current artifact IDs and were removed.", plan.get("risk_flags") or [])
        self.assertNotIn("I need clarification before patching", _ai_plan_assistant_text(plan, {"request_summary": "make me a new module to track software engineering contracting jobs"}))

    def test_slot_plan_create_module_to_track_equipment_servicing_stays_new_module_scoped(self) -> None:
        contacts_manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [{"id": "entity.contact", "label": "Contact", "fields": [{"id": "contact.name", "label": "Name", "type": "string"}]}],
            "views": [{"id": "contact.form", "kind": "form", "entity": "entity.contact", "sections": [{"id": "main", "fields": ["contact.name"]}]}],
        }
        module_index = {"contacts": {"manifest": contacts_manifest}}
        session = {
            "scope_mode": "auto",
            "selected_artifact_type": "module",
            "selected_artifact_key": "contacts",
            "status": "planning",
        }
        message = (
            "Create me a new module to track equipment servicing, including equipment ID, service dates, technician notes, "
            "customer history, warranty status, and automatic reminders for upcoming services. Show me the draft plan first."
        )

        plan = _ai_slot_based_plan(message, ["contacts"], module_index, answer_hints=None)

        create_ops = [op for op in (plan.get("candidate_ops") or []) if isinstance(op, dict) and op.get("op") == "create_module"]
        self.assertEqual(len(create_ops), 1)
        self.assertEqual(create_ops[0].get("artifact_id"), "equipment_servicing")
        self.assertEqual(((create_ops[0].get("manifest") or {}).get("module") or {}).get("name"), "Equipment Servicing")
        self.assertEqual(plan.get("affected_modules"), ["equipment_servicing"])
        self.assertEqual((plan.get("planner_state") or {}).get("module_id"), "equipment_servicing")

    def test_create_module_preflight_rejects_shallow_manifest_quality(self) -> None:
        shallow_manifest = {
            "manifest_version": "1.3",
            "module": {"id": "tiny_jobs", "key": "tiny_jobs", "name": "Tiny Jobs", "version": "0.1.0"},
            "app": {"home": "page:job.list_page", "nav": [{"group": "Tiny Jobs", "items": [{"label": "Tiny Jobs", "to": "page:job.list_page"}]}]},
            "entities": [
                {
                    "id": "entity.job",
                    "label": "Job",
                    "display_field": "job.name",
                    "fields": [
                        {"id": "job.id", "type": "uuid", "label": "ID"},
                        {"id": "job.name", "type": "string", "label": "Job"},
                        {"id": "job.status", "type": "enum", "label": "Status", "options": [{"label": "New", "value": "new"}, {"label": "Done", "value": "done"}]},
                        {"id": "job.created_at", "type": "datetime", "label": "Created At"},
                    ],
                }
            ],
            "views": [
                {"id": "job.list", "kind": "list", "entity": "entity.job", "columns": [{"field_id": "job.name"}]},
                {"id": "job.form", "kind": "form", "entity": "entity.job", "sections": [{"id": "main", "title": "Details", "fields": ["job.name", "job.status"]}]},
            ],
            "pages": [
                {"id": "job.list_page", "title": "Tiny Jobs", "layout": "single", "content": []},
                {"id": "job.form_page", "title": "Job", "layout": "single", "content": []},
            ],
            "actions": [],
            "workflows": [{"id": "workflow.job_status", "entity_id": "entity.job", "field_id": "job.status", "states": [{"id": "new", "label": "New"}, {"id": "done", "label": "Done"}]}],
            "relations": [],
            "queries": {},
            "interfaces": {},
        }

        valid_ops, errors = _ai_preflight_candidate_ops(
            {},
            [{"op": "create_module", "artifact_type": "module", "artifact_id": "tiny_jobs", "manifest": shallow_manifest}],
        )

        self.assertEqual(valid_ops, [])
        self.assertTrue(any(error.get("code") == "CREATE_MODULE_QUALITY" for error in errors))

    def test_workflow_transitions_cover_adjacent_publishing_states(self) -> None:
        transitions = main._ai_workflow_transitions_for_states(["draft", "testing", "approved", "published"])

        self.assertTrue(any(item.get("from") == "draft" and item.get("to") == "testing" and item.get("label") == "Start Testing" for item in transitions))
        self.assertTrue(any(item.get("from") == "testing" and item.get("to") == "approved" and item.get("label") == "Approve" for item in transitions))
        self.assertTrue(any(item.get("from") == "approved" and item.get("to") == "published" and item.get("label") == "Publish" for item in transitions))

    def test_create_module_quality_requires_lifecycle_buttons_across_longer_status_path(self) -> None:
        manifest = {
            "module": {"id": "policy_studio", "key": "policy_studio", "name": "Policy Studio"},
            "entities": [
                {
                    "id": "entity.policy",
                    "display_field": "policy.name",
                    "fields": [
                        {"id": "policy.id", "type": "uuid", "label": "ID"},
                        {"id": "policy.name", "type": "string", "label": "Policy Name"},
                        {
                            "id": "policy.status",
                            "type": "enum",
                            "label": "Status",
                            "options": [
                                {"label": "Draft", "value": "draft"},
                                {"label": "Testing", "value": "testing"},
                                {"label": "Approved", "value": "approved"},
                                {"label": "Published", "value": "published"},
                            ],
                        },
                        {"id": "policy.owner_id", "type": "user", "label": "Owner"},
                        {"id": "policy.category", "type": "string", "label": "Category"},
                        {"id": "policy.audience", "type": "string", "label": "Audience"},
                        {"id": "policy.review_cycle_days", "type": "number", "label": "Review Cycle Days"},
                        {"id": "policy.effective_date", "type": "date", "label": "Effective Date"},
                        {"id": "policy.publish_date", "type": "date", "label": "Publish Date"},
                        {"id": "policy.version_number", "type": "number", "label": "Version Number"},
                        {"id": "policy.summary", "type": "text", "label": "Summary"},
                        {"id": "policy.created_at", "type": "datetime", "label": "Created At"},
                    ],
                }
            ],
            "views": [
                {"id": "policy.list", "kind": "list", "entity": "entity.policy", "columns": [{"field_id": "policy.name"}]},
                {"id": "policy.form", "kind": "form", "entity": "entity.policy", "sections": [
                    {"id": "main", "title": "Policy", "fields": ["policy.name", "policy.status", "policy.owner_id", "policy.category", "policy.audience"]},
                    {"id": "governance", "title": "Governance", "fields": ["policy.review_cycle_days", "policy.effective_date", "policy.publish_date"]},
                ]},
                {"id": "policy.kanban", "kind": "kanban", "entity": "entity.policy"},
            ],
            "pages": [
                {"id": "policy.list_page", "title": "Policy Studio", "layout": "single", "content": []},
                {"id": "policy.form_page", "title": "Policy", "layout": "single", "content": []},
            ],
            "workflows": [
                {
                    "id": "workflow.policy_status",
                    "entity": "entity.policy",
                    "status_field": "policy.status",
                    "states": [
                        {"id": "draft", "label": "Draft"},
                        {"id": "testing", "label": "Testing"},
                        {"id": "approved", "label": "Approved"},
                        {"id": "published", "label": "Published"},
                    ],
                }
            ],
            "actions": [
                {"id": "action.policy_start_testing", "kind": "update_record", "label": "Start Testing", "entity_id": "entity.policy"},
                {"id": "action.policy_approve", "kind": "update_record", "label": "Approve", "entity_id": "entity.policy"},
            ],
        }

        report = main._ai_module_manifest_quality_report("policy_studio", manifest, family="operations")

        self.assertFalse(report["ok"])
        self.assertTrue(any("workflow action buttons" in issue for issue in report["issues"]))

    def test_new_module_scaffold_builds_adjacent_status_buttons_for_publishing_flow(self) -> None:
        manifest = main._ai_build_new_module_scaffold(
            "policy_studio",
            "Policy Studio",
            "Create a policy publishing app called Policy Studio with draft, testing, approved, and published statuses, plus action buttons for testing, approving, and publishing policies.",
        )

        workflows = [item for item in (manifest.get("workflows") or []) if isinstance(item, dict)]
        self.assertTrue(workflows)
        states = [item.get("id") for item in (workflows[0].get("states") or []) if isinstance(item, dict)]
        self.assertIn("draft", states)
        self.assertIn("testing", states)
        self.assertIn("approved", states)
        self.assertIn("published", states)

        action_labels = [
            action.get("label")
            for action in (manifest.get("actions") or [])
            if isinstance(action, dict) and action.get("kind") == "update_record"
        ]
        self.assertIn("Start Testing", action_labels)
        self.assertIn("Approve", action_labels)
        self.assertIn("Publish", action_labels)

        form_view = next(
            (
                view
                for view in (manifest.get("views") or [])
                if isinstance(view, dict) and view.get("kind") == "form"
            ),
            {},
        )
        header = form_view.get("header") if isinstance(form_view.get("header"), dict) else {}
        self.assertEqual((header.get("statusbar") or {}).get("field_id"), "policy_studio.status")
        secondary_action_ids = [
            item.get("action_id")
            for item in (header.get("secondary_actions") or [])
            if isinstance(item, dict) and isinstance(item.get("action_id"), str)
        ]
        self.assertTrue(any(action_id.endswith("start_testing") for action_id in secondary_action_ids))
        self.assertTrue(any(action_id.endswith("approve") for action_id in secondary_action_ids))
        self.assertTrue(any(action_id.endswith("publish") for action_id in secondary_action_ids))

    def test_normalize_module_design_spec_preserves_generic_related_entities(self) -> None:
        normalized = main._ai_normalize_module_design_spec(
            "project_hub",
            "Project Hub",
            "Create a project workspace with update logs.",
            {
                "family": "operations",
                "entity_slug": "project_hub",
                "entity_label": "Project",
                "nav_label": "Projects",
                "primary_label": "Project Name",
                "statuses": ["draft", "active", "completed"],
                "fields": [
                    {"id": "project_hub.name", "type": "string", "label": "Project Name"},
                    {"id": "project_hub.status", "type": "enum", "label": "Status", "options": ["draft", "active", "completed"]},
                    {"id": "project_hub.owner_id", "type": "user", "label": "Owner"},
                    {"id": "project_hub.start_date", "type": "date", "label": "Start Date"},
                ],
                "related_entities": [
                    {
                        "entity_slug": "project_update",
                        "entity_label": "Project Update",
                        "nav_label": "Updates",
                        "related_title": "Updates",
                        "related_tab_label": "Updates",
                        "fields": [
                            {"id": "project_update.update_date", "type": "date", "label": "Update Date"},
                            {"id": "project_update.summary", "type": "text", "label": "Summary"},
                        ],
                    }
                ],
            },
        )

        related_entities = [item for item in (normalized.get("related_entities") or []) if isinstance(item, dict)]
        self.assertEqual(len(related_entities), 1)
        related = related_entities[0]
        self.assertEqual(related.get("entity_slug"), "project_update")
        field_ids = [field.get("id") for field in (related.get("fields") or []) if isinstance(field, dict)]
        self.assertIn("project_update.name", field_ids)
        self.assertIn("project_update.project_hub_id", field_ids)
        self.assertIn("project_update.update_date", field_ids)

    def test_build_rich_module_scaffold_adds_related_entity_tabs_from_design_spec(self) -> None:
        design_spec = main._ai_normalize_module_design_spec(
            "project_hub",
            "Project Hub",
            "Create a project workspace with update logs.",
            {
                "family": "operations",
                "entity_slug": "project_hub",
                "entity_label": "Project",
                "nav_label": "Projects",
                "primary_label": "Project Name",
                "statuses": ["draft", "active", "completed"],
                "fields": [
                    {"id": "project_hub.name", "type": "string", "label": "Project Name"},
                    {"id": "project_hub.status", "type": "enum", "label": "Status", "options": ["draft", "active", "completed"]},
                    {"id": "project_hub.owner_id", "type": "user", "label": "Owner"},
                    {"id": "project_hub.start_date", "type": "date", "label": "Start Date"},
                    {"id": "project_hub.summary", "type": "text", "label": "Summary"},
                ],
                "related_entities": [
                    {
                        "entity_slug": "project_update",
                        "entity_label": "Project Update",
                        "nav_label": "Updates",
                        "related_title": "Updates",
                        "related_tab_label": "Updates",
                        "related_tab_id": "updates_tab",
                        "fields": [
                            {"id": "project_update.update_date", "type": "date", "label": "Update Date"},
                            {"id": "project_update.summary", "type": "text", "label": "Summary"},
                        ],
                    }
                ],
            },
        )

        manifest, _, _ = main._ai_build_rich_module_scaffold(
            "project_hub",
            "Project Hub",
            "Create a project workspace with update logs.",
            design_spec=design_spec,
        )

        entity_ids = [entity.get("id") for entity in (manifest.get("entities") or []) if isinstance(entity, dict)]
        self.assertIn("entity.project_hub", entity_ids)
        self.assertIn("entity.project_update", entity_ids)

        relation_pairs = [
            (relation.get("from"), relation.get("to"))
            for relation in (manifest.get("relations") or [])
            if isinstance(relation, dict)
        ]
        self.assertIn(("entity.project_update", "entity.project_hub"), relation_pairs)

        defaults = ((((manifest.get("app") or {}).get("defaults") or {}).get("entities") or {}))
        self.assertIn("entity.project_update", defaults)

        primary_form = next(
            (
                view
                for view in (manifest.get("views") or [])
                if isinstance(view, dict) and view.get("id") == "project_hub.form"
            ),
            {},
        )
        tabs = (((primary_form.get("header") or {}).get("tabs") or {}).get("tabs") or [])
        updates_tab = next((tab for tab in tabs if isinstance(tab, dict) and tab.get("id") == "updates_tab"), {})
        related_list = ((updates_tab.get("content") or [None])[0]) if isinstance(updates_tab, dict) else None
        self.assertEqual((related_list or {}).get("kind"), "related_list")
        self.assertEqual((related_list or {}).get("entity_id"), "entity.project_update")

    def test_normalize_module_design_spec_preserves_field_conditions(self) -> None:
        normalized = main._ai_normalize_module_design_spec(
            "vendor_approvals",
            "Vendor Approvals",
            "Create a vendor approvals app with conditional review notes and active contract dates.",
            {
                "family": "operations",
                "entity_slug": "vendor_approval",
                "entity_label": "Vendor Approval",
                "nav_label": "Vendor Approvals",
                "primary_label": "Vendor Name",
                "statuses": ["draft", "active", "rejected", "approved"],
                "fields": [
                    {"id": "vendor_approval.name", "type": "string", "label": "Vendor Name"},
                    {"id": "vendor_approval.status", "type": "enum", "label": "Status", "options": ["draft", "active", "rejected", "approved"]},
                    {"id": "vendor_approval.owner_id", "type": "user", "label": "Owner"},
                    {"id": "vendor_approval.contract_end_date", "type": "date", "label": "Contract End Date", "visible_when": {"op": "eq", "field": "status", "value": "active"}},
                    {"id": "vendor_approval.review_notes", "type": "text", "label": "Review Notes", "required_when": {"op": "eq", "field": "vendor_approval.status", "value": "rejected"}},
                ],
            },
        )

        fields_by_id = {
            field.get("id"): field
            for field in (normalized.get("fields") or [])
            if isinstance(field, dict) and isinstance(field.get("id"), str)
        }
        self.assertEqual(
            fields_by_id["vendor_approval.contract_end_date"].get("visible_when"),
            {"op": "eq", "field": "vendor_approval.status", "value": "active"},
        )
        self.assertEqual(
            fields_by_id["vendor_approval.review_notes"].get("required_when"),
            {"op": "eq", "field": "vendor_approval.status", "value": "rejected"},
        )

    def test_build_design_automation_candidate_ops_from_design_spec(self) -> None:
        design_spec = main._ai_normalize_module_design_spec(
            "vendor_approvals",
            "Vendor Approvals",
            "Create a vendor approvals app with approval notifications.",
            {
                "family": "operations",
                "entity_slug": "vendor_approval",
                "entity_label": "Vendor Approval",
                "nav_label": "Vendor Approvals",
                "primary_label": "Vendor Name",
                "statuses": ["draft", "approved", "rejected"],
                "fields": [
                    {"id": "vendor_approval.name", "type": "string", "label": "Vendor Name"},
                    {"id": "vendor_approval.status", "type": "enum", "label": "Status", "options": ["draft", "approved", "rejected"]},
                    {"id": "vendor_approval.owner_id", "type": "user", "label": "Owner"},
                    {"id": "vendor_approval.owner_email", "type": "string", "label": "Owner Email"},
                    {"id": "vendor_approval.request_date", "type": "date", "label": "Request Date"},
                    {"id": "vendor_approval.contract_end_date", "type": "date", "label": "Contract End Date"},
                    {"id": "vendor_approval.compliance_complete", "type": "bool", "label": "Compliance Complete"},
                    {"id": "vendor_approval.review_notes", "type": "text", "label": "Review Notes"},
                    {"id": "vendor_approval.summary", "type": "text", "label": "Summary"},
                ],
                "automation_intents": [
                    {
                        "id": "approved_notification",
                        "label": "Approved Notification",
                        "kind": "status_notification",
                        "channel": "email",
                        "status_values": ["approved"],
                        "recipient": "$record.owner_email",
                        "delay_seconds": 3600,
                    }
                ],
            },
        )

        manifest, _, normalized_spec = main._ai_build_rich_module_scaffold(
            "vendor_approvals",
            "Vendor Approvals",
            "Create a vendor approvals app with approval notifications.",
            design_spec=design_spec,
        )
        automation_ops = main._ai_build_design_automation_candidate_ops("vendor_approvals", manifest, normalized_spec)

        self.assertEqual(len(automation_ops), 1)
        automation_op = automation_ops[0]
        self.assertEqual(automation_op.get("op"), "create_automation_record")
        automation = automation_op.get("automation") or {}
        self.assertEqual((automation.get("trigger") or {}).get("event_types"), ["workflow.status_changed"])
        filters = (automation.get("trigger") or {}).get("filters") or []
        self.assertTrue(any(isinstance(item, dict) and item.get("path") == "to" and item.get("value") == "approved" for item in filters))
        steps = automation.get("steps") or []
        self.assertEqual(steps[0].get("kind"), "delay")
        self.assertEqual(steps[1].get("action_id"), "system.send_email")
        self.assertEqual((steps[1].get("inputs") or {}).get("to"), "{{ record.owner_email }}")

    def test_preflight_candidate_ops_accepts_create_module_with_automation_record(self) -> None:
        design_spec = main._ai_normalize_module_design_spec(
            "vendor_approvals",
            "Vendor Approvals",
            "Create a vendor approvals app with conditional notes and approval notifications.",
            {
                "family": "operations",
                "entity_slug": "vendor_approval",
                "entity_label": "Vendor Approval",
                "nav_label": "Vendor Approvals",
                "primary_label": "Vendor Name",
                "statuses": ["draft", "approved", "rejected"],
                "fields": [
                    {"id": "vendor_approval.name", "type": "string", "label": "Vendor Name"},
                    {"id": "vendor_approval.status", "type": "enum", "label": "Status", "options": ["draft", "approved", "rejected"]},
                    {"id": "vendor_approval.owner_id", "type": "user", "label": "Owner"},
                    {"id": "vendor_approval.owner_email", "type": "string", "label": "Owner Email"},
                    {"id": "vendor_approval.request_date", "type": "date", "label": "Request Date"},
                    {"id": "vendor_approval.contract_end_date", "type": "date", "label": "Contract End Date", "visible_when": {"op": "eq", "field": "status", "value": "approved"}},
                    {"id": "vendor_approval.compliance_complete", "type": "bool", "label": "Compliance Complete"},
                    {"id": "vendor_approval.review_notes", "type": "text", "label": "Review Notes", "required_when": {"op": "eq", "field": "status", "value": "rejected"}},
                    {"id": "vendor_approval.summary", "type": "text", "label": "Summary"},
                ],
                "automation_intents": [
                    {
                        "id": "approved_notification",
                        "label": "Approved Notification",
                        "kind": "status_notification",
                        "channel": "email",
                        "status_values": ["approved"],
                        "recipient": "$record.owner_email",
                    }
                ],
            },
        )
        manifest, _, normalized_spec = main._ai_build_rich_module_scaffold(
            "vendor_approvals",
            "Vendor Approvals",
            "Create a vendor approvals app with conditional notes and approval notifications.",
            design_spec=design_spec,
        )
        automation_ops = main._ai_build_design_automation_candidate_ops("vendor_approvals", manifest, normalized_spec)

        valid_ops, errors = _ai_preflight_candidate_ops(
            {},
            [
                {
                    "op": "create_module",
                    "artifact_type": "module",
                    "artifact_id": "vendor_approvals",
                    "manifest": manifest,
                    "design_spec": normalized_spec,
                },
                *automation_ops,
            ],
        )

        self.assertEqual(errors, [])
        self.assertIn("create_module", [op.get("op") for op in valid_ops])
        self.assertIn("create_automation_record", [op.get("op") for op in valid_ops])

    def test_structured_plan_includes_create_module_conditions_and_automation_intents(self) -> None:
        design_spec = main._ai_normalize_module_design_spec(
            "vendor_approvals",
            "Vendor Approvals",
            "Create a vendor approvals app with conditional notes and approval notifications.",
            {
                "family": "operations",
                "entity_slug": "vendor_approval",
                "entity_label": "Vendor Approval",
                "nav_label": "Vendor Approvals",
                "primary_label": "Vendor Name",
                "statuses": ["draft", "approved", "rejected"],
                "fields": [
                    {"id": "vendor_approval.name", "type": "string", "label": "Vendor Name"},
                    {"id": "vendor_approval.status", "type": "enum", "label": "Status", "options": ["draft", "approved", "rejected"]},
                    {"id": "vendor_approval.owner_id", "type": "user", "label": "Owner"},
                    {"id": "vendor_approval.review_notes", "type": "text", "label": "Review Notes", "required_when": {"op": "eq", "field": "status", "value": "rejected"}},
                    {"id": "vendor_approval.summary", "type": "text", "label": "Summary"},
                    {"id": "vendor_approval.request_date", "type": "date", "label": "Request Date"},
                    {"id": "vendor_approval.contract_end_date", "type": "date", "label": "Contract End Date"},
                    {"id": "vendor_approval.owner_email", "type": "string", "label": "Owner Email"},
                ],
                "automation_intents": [
                    {
                        "id": "approved_notification",
                        "label": "Approved Notification",
                        "kind": "status_notification",
                        "channel": "email",
                        "status_values": ["approved"],
                        "recipient": "$record.owner_email",
                    }
                ],
            },
        )
        manifest, _, normalized_spec = main._ai_build_rich_module_scaffold(
            "vendor_approvals",
            "Vendor Approvals",
            "Create a vendor approvals app with conditional notes and approval notifications.",
            design_spec=design_spec,
        )

        structured = _ai_build_structured_plan(
            {
                "planner_state": {"intent": "create_module", "module_name": "Vendor Approvals"},
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "vendor_approvals"}],
                "proposed_changes": [
                    {
                        "op": "create_module",
                        "artifact_type": "module",
                        "artifact_id": "vendor_approvals",
                        "manifest": manifest,
                        "design_spec": normalized_spec,
                    }
                ],
                "required_questions": ["Confirm this plan?"],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
            },
            {},
        )

        sections = {item["key"]: item["items"] for item in structured["sections"]}
        self.assertIn(
            "Vendor Approvals: 'Review Notes' required when Status is 'rejected'.",
            sections["conditions"],
        )
        self.assertIn(
            "Vendor Approvals: automation intents include Approved Notification.",
            sections["automations"],
        )
        self.assertEqual(
            structured["operation_families"],
            ["create_module", "automation_change"],
        )

    def test_build_rich_module_scaffold_adds_core_triggers_from_structure(self) -> None:
        design_spec = main._ai_normalize_module_design_spec(
            "policy_studio",
            "Policy Studio",
            "Create a policy publishing workspace.",
            {
                "family": "operations",
                "entity_slug": "policy",
                "entity_label": "Policy",
                "nav_label": "Policies",
                "primary_label": "Policy Name",
                "statuses": ["draft", "approved", "published"],
                "fields": [
                    {"id": "policy.name", "type": "string", "label": "Policy Name"},
                    {"id": "policy.status", "type": "enum", "label": "Status", "options": ["draft", "approved", "published"]},
                    {"id": "policy.owner_id", "type": "user", "label": "Owner"},
                    {"id": "policy.publish_date", "type": "date", "label": "Publish Date"},
                    {"id": "policy.summary", "type": "text", "label": "Summary"},
                ],
            },
        )

        manifest, _, _ = main._ai_build_rich_module_scaffold(
            "policy_studio",
            "Policy Studio",
            "Create a policy publishing workspace.",
            design_spec=design_spec,
        )

        trigger_ids = [
            trigger.get("id")
            for trigger in (manifest.get("triggers") or [])
            if isinstance(trigger, dict) and isinstance(trigger.get("id"), str)
        ]
        self.assertIn("policy_studio.record.created", trigger_ids)
        self.assertIn("policy_studio.record.updated", trigger_ids)
        self.assertIn("policy_studio.workflow.status_changed", trigger_ids)

    def test_module_manifest_quality_requires_triggers_for_workflow_modules(self) -> None:
        manifest = {
            "module": {"id": "policy_studio", "key": "policy_studio", "name": "Policy Studio"},
            "entities": [
                {
                    "id": "entity.policy",
                    "display_field": "policy.name",
                    "fields": [
                        {"id": "policy.id", "type": "uuid", "label": "ID"},
                        {"id": "policy.name", "type": "string", "label": "Policy Name"},
                        {
                            "id": "policy.status",
                            "type": "enum",
                            "label": "Status",
                            "options": [
                                {"label": "Draft", "value": "draft"},
                                {"label": "Approved", "value": "approved"},
                                {"label": "Published", "value": "published"},
                            ],
                        },
                        {"id": "policy.owner_id", "type": "user", "label": "Owner"},
                        {"id": "policy.summary", "type": "text", "label": "Summary"},
                        {"id": "policy.publish_date", "type": "date", "label": "Publish Date"},
                        {"id": "policy.version_number", "type": "number", "label": "Version Number"},
                        {"id": "policy.created_at", "type": "datetime", "label": "Created At"},
                    ],
                }
            ],
            "views": [
                {"id": "policy.list", "kind": "list", "entity": "entity.policy", "columns": [{"field_id": "policy.name"}]},
                {"id": "policy.form", "kind": "form", "entity": "entity.policy", "sections": [
                    {"id": "main", "title": "Policy", "fields": ["policy.name", "policy.status", "policy.owner_id", "policy.summary"]},
                    {"id": "schedule", "title": "Schedule", "fields": ["policy.publish_date", "policy.version_number"]},
                ]},
                {"id": "policy.kanban", "kind": "kanban", "entity": "entity.policy"},
                {"id": "policy.calendar", "kind": "calendar", "entity": "entity.policy"},
            ],
            "pages": [
                {"id": "policy.list_page", "title": "Policy Studio", "layout": "single", "content": []},
                {"id": "policy.form_page", "title": "Policy", "layout": "single", "content": []},
                {"id": "policy.calendar_page", "title": "Policy Calendar", "layout": "single", "content": []},
            ],
            "workflows": [
                {
                    "id": "workflow.policy_status",
                    "entity": "entity.policy",
                    "status_field": "policy.status",
                    "states": [
                        {"id": "draft", "label": "Draft"},
                        {"id": "approved", "label": "Approved"},
                        {"id": "published", "label": "Published"},
                    ],
                }
            ],
            "actions": [
                {"id": "action.policy_approve", "kind": "update_record", "label": "Approve", "entity_id": "entity.policy"},
                {"id": "action.policy_publish", "kind": "update_record", "label": "Publish", "entity_id": "entity.policy"},
            ],
            "triggers": [],
        }

        report = main._ai_module_manifest_quality_report("policy_studio", manifest, family="operations")

        self.assertFalse(report["ok"])
        self.assertTrue(any("trigger surfaces" in issue for issue in report["issues"]))

    def test_plan_from_message_follow_up_workflow_action_request_prefers_pending_new_module_over_selected_module(self) -> None:
        pending_manifest = {
            "module": {"id": "cooking", "key": "cooking", "name": "Cooking"},
            "entities": [
                {
                    "id": "entity.recipe",
                    "display_field": "recipe.name",
                    "fields": [
                        {"id": "recipe.name", "label": "Recipe Name", "type": "string"},
                        {
                            "id": "recipe.status",
                            "label": "Status",
                            "type": "enum",
                            "options": [
                                {"label": "Draft", "value": "draft"},
                                {"label": "Ready To Cook", "value": "ready_to_cook"},
                                {"label": "Cooked", "value": "cooked"},
                            ],
                        },
                    ],
                }
            ],
            "views": [{"id": "recipe.form", "kind": "form", "entity": "entity.recipe", "sections": []}],
            "workflows": [
                {
                    "id": "workflow.recipe_status",
                    "entity": "entity.recipe",
                    "status_field": "recipe.status",
                    "states": [
                        {"id": "draft", "label": "Draft", "order": 1},
                        {"id": "ready_to_cook", "label": "Ready To Cook", "order": 2},
                        {"id": "cooked", "label": "Cooked", "order": 3},
                    ],
                    "transitions": [
                        {"from": "draft", "to": "ready_to_cook", "label": "Ready To Cook"},
                        {"from": "ready_to_cook", "to": "cooked", "label": "Cooked"},
                    ],
                }
            ],
            "actions": [],
        }
        contacts_manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [{"id": "entity.contact", "fields": [{"id": "contact.name", "label": "Name", "type": "string"}]}],
            "views": [],
        }
        session = {
            "scope_mode": "auto",
            "selected_artifact_type": "module",
            "selected_artifact_key": "contacts",
            "status": "planning",
        }
        answer_hints = {
            "pending_candidate_ops": [
                {"op": "create_module", "artifact_id": "cooking", "manifest": pending_manifest}
            ],
            "pending_affected_modules": ["cooking"],
            "module_target": "cooking",
        }

        with patch.object(main, "_ai_build_workspace_graph", lambda _request: {}), patch.object(
            main,
            "_ai_module_manifest_index",
            lambda _request: {"contacts": {"manifest": contacts_manifest}},
        ):
            plan, derived = _ai_plan_from_message(
                None,
                session,
                "can you add action buttons so we can change status etc",
                answer_hints=answer_hints,
            )

        self.assertEqual(derived.get("affected_modules"), ["cooking"])
        self.assertEqual([item.get("artifact_id") for item in (plan.get("affected_artifacts") or [])], ["cooking"])
        op_names = [op.get("op") for op in (plan.get("proposed_changes") or []) if isinstance(op, dict)]
        self.assertIn("create_module", op_names)
        self.assertIn("add_action", op_names)

    def test_add_field_scope_ignores_tab_label_as_module_target(self) -> None:
        contacts_manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [
                {
                    "id": "entity.contact",
                    "label": "Contact",
                    "fields": [{"id": "contact.name", "label": "Name", "type": "string"}],
                }
            ],
            "views": [
                {
                    "id": "contact.form",
                    "kind": "form",
                    "entity": "entity.contact",
                    "header": {
                        "tabs": {
                            "tabs": [
                                {"id": "primary_tab", "label": "Primary", "sections": ["primary"]},
                                {"id": "sales_purchase_tab", "label": "Sales & Purchase", "sections": ["sales_purchase"]},
                            ]
                        }
                    },
                    "sections": [
                        {"id": "primary", "fields": ["contact.name"]},
                        {"id": "sales_purchase", "fields": []},
                    ],
                }
            ],
        }
        sales_manifest = {
            "module": {"id": "sales", "key": "sales", "name": "Sales"},
            "entities": [{"id": "entity.quote", "label": "Quote", "fields": []}],
            "views": [],
        }
        module_index = {
            "contacts": {"manifest": contacts_manifest},
            "sales": {"manifest": sales_manifest},
        }
        message = "Add a Customer Since field to Contacts and place it in the Sales & Purchase tab."

        self.assertEqual(_ai_extract_module_target_from_text(message, ["contacts", "sales"], module_index), "contacts")
        self.assertEqual(_ai_extract_explicit_module_targets_from_text(message, ["contacts", "sales"], module_index), ["contacts"])

        plan = _ai_slot_based_plan(message, ["contacts", "sales"], module_index, answer_hints=None)

        self.assertEqual(plan.get("questions"), [])
        ops = [op for op in (plan.get("candidate_ops") or []) if isinstance(op, dict)]
        self.assertEqual(ops[0].get("artifact_id"), "contacts")
        self.assertEqual([op.get("op") for op in ops], ["add_field", "insert_section_field"])
        self.assertEqual(ops[1].get("placement_label"), "Sales & Purchase")

    def test_slot_plan_marks_existing_field_form_only_request_as_noop(self) -> None:
        manifest = {
            "module": {"id": "jobs", "key": "jobs", "name": "Jobs"},
            "entities": [
                {
                    "id": "entity.job",
                    "fields": [
                        {"id": "job.title", "label": "Title", "type": "string"},
                        {"id": "job.status", "label": "Status", "type": "enum"},
                    ],
                }
            ],
            "views": [
                {
                    "id": "job.form",
                    "kind": "form",
                    "entity": "entity.job",
                    "sections": [{"id": "details", "title": "Details", "fields": ["job.title", "job.status"]}],
                }
            ],
        }
        module_index = {"jobs": {"manifest": manifest}}

        plan = _ai_slot_based_plan(
            "Add Status to Jobs and make it form only.",
            [],
            module_index,
            answer_hints=None,
        )

        self.assertEqual(plan.get("questions"), [])
        self.assertEqual(plan.get("candidate_ops"), [])
        self.assertTrue(plan.get("resolved_without_changes"))
        self.assertEqual((plan.get("planner_state") or {}).get("intent"), "field_already_exists_noop")

    def test_slot_plan_remove_calendar_prompt_detects_view_removal(self) -> None:
        manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [
                {
                    "id": "entity.contact",
                    "fields": [{"id": "contact.name", "label": "Name", "type": "string"}],
                }
            ],
            "views": [
                {"id": "contact.list", "kind": "list", "entity": "entity.contact", "columns": [{"field_id": "contact.name"}]},
                {
                    "id": "contact.calendar",
                    "kind": "calendar",
                    "entity": "entity.contact",
                    "calendar": {"title_field": "contact.name", "date_start": "contact.name"},
                },
                {"id": "contact.form", "kind": "form", "entity": "entity.contact", "sections": [{"id": "main", "fields": ["contact.name"]}]},
            ],
            "pages": [
                {
                    "id": "contact.list_page",
                    "title": "Contacts",
                    "content": [
                        {
                            "kind": "view_modes",
                            "entity_id": "entity.contact",
                            "default_mode": "calendar",
                            "modes": [
                                {"mode": "calendar", "target": "view:contact.calendar"},
                                {"mode": "list", "target": "view:contact.list"},
                            ],
                        }
                    ],
                }
            ],
        }
        module_index = {"contacts": {"manifest": manifest}}

        plan = _ai_slot_based_plan(
            "Remove the calendar from Contacts.",
            [],
            module_index,
            answer_hints=None,
        )

        self.assertEqual(plan.get("questions"), [])
        self.assertEqual((plan.get("planner_state") or {}).get("intent"), "remove_view_mode")
        self.assertEqual([op.get("op") for op in (plan.get("candidate_ops") or [])], ["update_page", "remove_view"])

    def test_slot_plan_marks_natural_move_to_tab_phrase_as_noop_when_field_missing(self) -> None:
        manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [
                {
                    "id": "entity.contact",
                    "fields": [{"id": "contact.name", "label": "Name", "type": "string"}],
                }
            ],
            "views": [
                {
                    "id": "contact.form",
                    "kind": "form",
                    "entity": "entity.contact",
                    "header": {
                        "tabs": {
                            "tabs": [
                                {"id": "details_tab", "label": "Details", "sections": ["details"]},
                                {"id": "internal_notes_tab", "label": "Internal Notes", "sections": ["notes"]},
                            ]
                        }
                    },
                    "sections": [
                        {"id": "details", "fields": ["contact.name"]},
                        {"id": "notes", "fields": []},
                    ],
                }
            ],
        }
        module_index = {"contacts": {"manifest": manifest}}

        plan = _ai_slot_based_plan(
            "Move Birthday into the Internal Notes tab in Contacts.",
            [],
            module_index,
            answer_hints=None,
        )

        self.assertEqual(plan.get("questions"), [])
        self.assertEqual(plan.get("candidate_ops"), [])
        self.assertTrue(plan.get("resolved_without_changes"))
        self.assertEqual((plan.get("planner_state") or {}).get("intent"), "field_missing_noop")

    def test_parse_placement_answer_understands_form_only_language(self) -> None:
        parsed = _ai_parse_placement_answer("custom", "Include it in form only.", {"include_form": False, "include_list": False})
        self.assertEqual(parsed, {"include_form": True, "include_list": False})

    def test_parse_placement_answer_understands_short_answers(self) -> None:
        self.assertEqual(
            _ai_parse_placement_answer("custom", "form", {"include_form": False, "include_list": False}),
            {"include_form": True, "include_list": False},
        )
        self.assertEqual(
            _ai_parse_placement_answer("custom", "list please", {"include_form": False, "include_list": False}),
            {"include_form": False, "include_list": True},
        )
        self.assertEqual(
            _ai_parse_placement_answer("custom", "both please", {"include_form": False, "include_list": False}),
            {"include_form": True, "include_list": True},
        )

    def test_create_module_detection_does_not_fire_for_tab_creation_inside_module(self) -> None:
        self.assertFalse(
            _ai_is_create_module_request(
                "can you add a new field in contacts module called Roblux. and also can you create a new tab in that module called Master. put a master notes field in that module."
            )
        )

    def test_create_module_detection_does_not_fire_for_new_field_in_existing_module(self) -> None:
        message = "can you create a new field in the CRM module, place the new field in the Extra info tab. the new field is called Revenge."
        module_index = {
            "crm": {"module": {"module_id": "crm", "name": "CRM"}},
            "contacts": {"module": {"module_id": "contacts", "name": "Contacts"}},
        }

        self.assertFalse(_ai_is_create_module_request(message))
        self.assertEqual(_ai_extract_module_target_from_text(message, ["crm", "contacts"], module_index), "crm")
        self.assertEqual(_ai_extract_explicit_module_targets_from_text(message, ["crm", "contacts"], module_index), ["crm"])

    def test_create_module_detection_does_not_fire_for_change_request_field_called_in_existing_module(self) -> None:
        message = 'can you make a change in my CRM module, i want to add a new field called "revenge" in the Extra Info tab'
        module_index = {
            "crm": {"module": {"module_id": "crm", "name": "CRM"}},
            "contacts": {"module": {"module_id": "contacts", "name": "Contacts"}},
        }

        self.assertFalse(_ai_is_create_module_request(message))
        self.assertIsNone(main._ai_extract_new_module_name(message))
        self.assertEqual(_ai_extract_field_label(message), "revenge")
        self.assertEqual(_ai_extract_module_target_from_text(message, ["crm", "contacts"], module_index), "crm")
        self.assertEqual(_ai_extract_explicit_module_targets_from_text(message, ["crm", "contacts"], module_index), ["crm"])
        self.assertFalse(main._ai_is_explicit_add_tab_request(message))

    def test_followup_field_in_existing_tab_is_not_treated_as_add_tab_request(self) -> None:
        message = "can you also add another field in the Extra Info tab called Plaster?"
        self.assertEqual(_ai_extract_field_label(message), "Plaster")
        self.assertEqual(main._ai_extract_requested_tab_label(message), "Extra Info")
        self.assertFalse(main._ai_is_explicit_add_tab_request(message))

    def test_create_module_detection_accepts_system_briefs(self) -> None:
        self.assertTrue(
            _ai_is_create_module_request(
                "Build me a small service operations system with work orders, technician scheduling, customer visits, job notes, and completion status."
            )
        )

    def test_preview_roadmap_tracks_include_job_notes_for_system_briefs(self) -> None:
        tracks = main._ai_preview_roadmap_tracks(
            "Build me a small service operations system with work orders, technician scheduling, customer visits, job notes, and completion status."
        )

        self.assertEqual(
            tracks,
            ["Site Visits", "Jobs", "Job Notes", "Technician Scheduling", "Completion Status"],
        )

    def test_focus_request_text_prefers_final_ask_for_long_requirements_brief(self) -> None:
        message = (
            "Insurance - Workflow & Requirements for Insurance v1\n\n"
            "- This document describes the first production-ready version of an insurance jobs workflow.\n"
            "- Staff must be able to store the Xero invoice reference.\n"
            "- Acceptance criteria and business rules follow.\n\n"
            "Take this requirements document and build AusPac Insurance Jobs v1 as an OCTO app. "
            "Include the main job workflow, quote checkpoints, invoice tracking, and dashboards. "
            "Show me the draft plan first."
        )

        self.assertEqual(
            _ai_focus_request_text(message),
            "Take this requirements document and build AusPac Insurance Jobs v1 as an OCTO app. Include the main job workflow, quote checkpoints, invoice tracking, and dashboards. Show me the draft plan first.",
        )

    def test_generate_module_design_spec_skips_model_for_field_rich_vendor_compliance_brief(self) -> None:
        prompt = "Create a Vendor Compliance module for insurance expiry, safety docs, onboarding status, approved categories, and review notes."

        with (
            patch.object(main, "USE_AI", True),
            patch.object(main, "_openai_configured", lambda: True),
            patch.object(
                main,
                "_openai_chat_completion",
                side_effect=AssertionError("model-backed design should be skipped for this deterministic brief"),
            ),
        ):
            design_spec = main._ai_generate_module_design_spec("vendor_compliance", "Vendor Compliance", prompt)

        self.assertEqual(design_spec.get("family"), "compliance")
        self.assertEqual(design_spec.get("design_source"), "deterministic_fallback")
        field_labels = [field.get("label") for field in (design_spec.get("fields") or []) if isinstance(field, dict)]
        self.assertIn("Insurance Expiry", field_labels)
        self.assertIn("Safety Docs", field_labels)
        self.assertIn("Onboarding Status", field_labels)
        self.assertIn("Approved Categories", field_labels)
        self.assertIn("Review Notes", field_labels)

    def test_generate_module_design_spec_skips_model_for_low_complexity_starter_brief(self) -> None:
        prompt = "Create a Holiday Planner module to manage upcoming trips, travellers, booking dates, budgets, suppliers, and notes. Call it Holiday Planner."

        with (
            patch.object(main, "USE_AI", True),
            patch.object(main, "_openai_configured", lambda: True),
            patch.object(
                main,
                "_openai_chat_completion",
                side_effect=AssertionError("model-backed design should be skipped for this starter create-module brief"),
            ),
        ):
            design_spec = main._ai_generate_module_design_spec("holiday_planner", "Holiday Planner", prompt)

        self.assertEqual(design_spec.get("family"), "planning")
        self.assertEqual(design_spec.get("design_source"), "deterministic_fallback")
        field_labels = [field.get("label") for field in (design_spec.get("fields") or []) if isinstance(field, dict)]
        self.assertIn("Start Date", field_labels)
        self.assertIn("End Date", field_labels)
        self.assertIn("Participants", field_labels)
        self.assertIn("Supplier", field_labels)
        self.assertIn("calendar", [view for view in ((design_spec.get("experience") or {}).get("views") or []) if isinstance(view, str)])

    def test_plan_from_message_vendor_compliance_keeps_requested_fields_in_preview(self) -> None:
        prompt = "Create a Vendor Compliance module for insurance expiry, safety docs, onboarding status, approved categories, and review notes."

        with (
            patch.object(main, "USE_AI", True),
            patch.object(main, "_openai_configured", lambda: True),
            patch.object(
                main,
                "_openai_chat_completion",
                side_effect=AssertionError("semantic model should not be needed for this create-module brief"),
            ),
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: {}),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                prompt,
                answer_hints={},
            )

        self.assertEqual(derived.get("status"), "waiting_input")
        self.assertEqual((plan.get("required_question_meta") or {}).get("id"), "confirm_plan")
        self.assertEqual([op.get("op") for op in (plan.get("candidate_operations") or []) if isinstance(op, dict)], ["create_module"])
        create_op = next(op for op in (plan.get("candidate_operations") or []) if isinstance(op, dict) and op.get("op") == "create_module")
        manifest = create_op.get("manifest") or {}
        entity = next((item for item in (manifest.get("entities") or []) if isinstance(item, dict)), {})
        field_labels = [field.get("label") for field in (entity.get("fields") or []) if isinstance(field, dict)]
        self.assertIn("Insurance Expiry", field_labels)
        self.assertIn("Safety Docs", field_labels)
        self.assertIn("Onboarding Status", field_labels)
        self.assertIn("Approved Categories", field_labels)
        self.assertIn("Review Notes", field_labels)

        text = _ai_plan_assistant_text(plan, {"request_summary": prompt, "full_selected_artifacts": []})
        self.assertIn("Insurance Expiry", text)
        self.assertIn("Safety Docs", text)
        self.assertIn("Onboarding Status", text)
        self.assertIn("Approved Categories", text)
        self.assertIn("Review Notes", text)

    def test_plan_from_message_holiday_planner_create_module_skips_model_design_request(self) -> None:
        prompt = "Create a Holiday Planner module to manage upcoming trips, travellers, booking dates, budgets, suppliers, and notes. Call it Holiday Planner."

        with (
            patch.object(main, "USE_AI", True),
            patch.object(main, "_openai_configured", lambda: True),
            patch.object(
                main,
                "_openai_chat_completion",
                side_effect=AssertionError("model-backed design should not be needed for this starter create-module brief"),
            ),
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: {}),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                prompt,
                answer_hints={},
            )

        self.assertEqual(derived.get("status"), "waiting_input")
        self.assertEqual((plan.get("required_question_meta") or {}).get("id"), "confirm_plan")
        create_op = next(op for op in (plan.get("candidate_operations") or []) if isinstance(op, dict) and op.get("op") == "create_module")
        self.assertEqual(create_op.get("artifact_id"), "holiday_planner")
        manifest = create_op.get("manifest") or {}
        entity = next((item for item in (manifest.get("entities") or []) if isinstance(item, dict)), {})
        field_labels = [field.get("label") for field in (entity.get("fields") or []) if isinstance(field, dict)]
        self.assertIn("Participants", field_labels)
        self.assertIn("Supplier", field_labels)

    def test_extract_new_module_name_keeps_compound_business_name_with_generic_noun(self) -> None:
        prompt = "Create a Job Hazard Analysis module to record hazards, controls, responsible people, review dates, and signoff before work starts."

        self.assertEqual(main._ai_extract_new_module_name(prompt), "Job Hazard Analysis")
        self.assertEqual(main._ai_extract_requested_new_module_labels(prompt, [], {}), ["Job Hazard Analysis"])
        self.assertEqual(main._ai_detect_new_module_family("Job Hazard Analysis", prompt), "safety")

    def test_generate_module_design_spec_skips_model_for_job_hazard_analysis_starter_brief(self) -> None:
        prompt = "Create a Job Hazard Analysis module to record hazards, controls, responsible people, review dates, and signoff before work starts."

        with (
            patch.object(main, "USE_AI", True),
            patch.object(main, "_openai_configured", lambda: True),
            patch.object(
                main,
                "_openai_chat_completion",
                side_effect=AssertionError("model-backed design should be skipped for this safety assessment starter brief"),
            ),
        ):
            design_spec = main._ai_generate_module_design_spec("job_hazard_analysis", "Job Hazard Analysis", prompt)

        self.assertEqual(design_spec.get("family"), "safety")
        self.assertEqual(design_spec.get("design_source"), "deterministic_fallback")
        field_labels = [field.get("label") for field in (design_spec.get("fields") or []) if isinstance(field, dict)]
        self.assertIn("Hazard Description", field_labels)
        self.assertIn("Controls", field_labels)
        self.assertIn("Responsible Person", field_labels)
        self.assertIn("Review Date", field_labels)

    def test_plan_from_message_job_hazard_analysis_create_module_stays_in_confirm_plan_flow(self) -> None:
        prompt = "Create a Job Hazard Analysis module to record hazards, controls, responsible people, review dates, and signoff before work starts."

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: {}),
            patch.object(main, "_openai_configured", lambda: False),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                prompt,
                answer_hints={},
            )

        self.assertEqual(derived.get("status"), "waiting_input")
        self.assertEqual((plan.get("required_question_meta") or {}).get("id"), "confirm_plan")
        self.assertEqual((plan.get("planner_state") or {}).get("intent"), "create_module")
        self.assertEqual((plan.get("planner_state") or {}).get("module_name"), "Job Hazard Analysis")
        create_op = next(op for op in (plan.get("candidate_operations") or []) if isinstance(op, dict) and op.get("op") == "create_module")
        self.assertEqual(create_op.get("artifact_id"), "job_hazard_analysis")

        text = _ai_plan_assistant_text(plan, {"request_summary": prompt, "full_selected_artifacts": []})
        self.assertIn("Create a new module 'Job Hazard Analysis'.", text)
        self.assertIn("Planned changes:", text)
        self.assertNotIn("What should the new module be called?", text)

    def test_build_create_module_dependency_ops_adds_required_dependency_for_external_lookup(self) -> None:
        contacts_manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts", "version": "1.0.0"},
            "entities": [
                {
                    "id": "entity.contact",
                    "fields": [
                        {"id": "contact.id", "type": "uuid", "label": "ID"},
                        {"id": "contact.name", "type": "string", "label": "Name"},
                    ],
                }
            ],
            "views": [],
        }
        module_index = {
            "contacts": {
                "module_key": "contacts",
                "version": "1.0.0",
                "manifest": contacts_manifest,
            }
        }
        design_spec = main._ai_normalize_module_design_spec(
            "client_projects",
            "Client Projects",
            "Create a client projects module linked to contacts.",
            {
                "family": "operations",
                "entity_slug": "client_project",
                "entity_label": "Client Project",
                "nav_label": "Client Projects",
                "primary_label": "Project Name",
                "statuses": ["draft", "active", "completed"],
                "fields": [
                    {"id": "client_project.name", "type": "string", "label": "Project Name"},
                    {
                        "id": "client_project.client_contact_id",
                        "type": "lookup",
                        "label": "Client",
                        "entity": "entity.contact",
                        "display_field": "contact.name",
                    },
                    {"id": "client_project.status", "type": "enum", "label": "Status", "options": ["draft", "active", "completed"]},
                    {"id": "client_project.start_date", "type": "date", "label": "Start Date"},
                    {"id": "client_project.notes", "type": "text", "label": "Notes"},
                ],
            },
        )
        manifest, _, normalized_spec = main._ai_build_rich_module_scaffold(
            "client_projects",
            "Client Projects",
            "Create a client projects module linked to contacts.",
            design_spec=design_spec,
        )

        dependency_ops = main._ai_build_create_module_dependency_ops("client_projects", manifest, module_index)

        self.assertEqual(
            dependency_ops,
            [
                {
                    "op": "update_dependency",
                    "artifact_type": "module",
                    "artifact_id": "client_projects",
                    "kind": "required",
                    "dependency": {"module": "contacts", "version": ">=1.0.0"},
                }
            ],
        )
        self.assertTrue(any(isinstance(item, dict) for item in (normalized_spec.get("fields") or [])))

    def test_plan_from_message_create_module_includes_dependency_ops_for_shared_lookup_modules(self) -> None:
        contacts_manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts", "version": "1.0.0"},
            "entities": [
                {
                    "id": "entity.contact",
                    "fields": [
                        {"id": "contact.id", "type": "uuid", "label": "ID"},
                        {"id": "contact.name", "type": "string", "label": "Name"},
                    ],
                }
            ],
            "views": [],
        }
        module_index = {
            "contacts": {
                "module_key": "contacts",
                "version": "1.0.0",
                "manifest": contacts_manifest,
            }
        }
        design_spec = main._ai_normalize_module_design_spec(
            "client_projects",
            "Client Projects",
            "Create a client projects module linked to contacts.",
            {
                "family": "operations",
                "entity_slug": "client_project",
                "entity_label": "Client Project",
                "nav_label": "Client Projects",
                "primary_label": "Project Name",
                "statuses": ["draft", "active", "completed"],
                "fields": [
                    {"id": "client_project.name", "type": "string", "label": "Project Name"},
                    {
                        "id": "client_project.client_contact_id",
                        "type": "lookup",
                        "label": "Client",
                        "entity": "entity.contact",
                        "display_field": "contact.name",
                    },
                    {"id": "client_project.status", "type": "enum", "label": "Status", "options": ["draft", "active", "completed"]},
                    {"id": "client_project.start_date", "type": "date", "label": "Start Date"},
                    {"id": "client_project.notes", "type": "text", "label": "Notes"},
                ],
            },
        )
        manifest, _, normalized_spec = main._ai_build_rich_module_scaffold(
            "client_projects",
            "Client Projects",
            "Create a client projects module linked to contacts.",
            design_spec=design_spec,
        )
        package = {
            "manifest": manifest,
            "family": "operations",
            "design_spec": normalized_spec,
            "quality": {"ok": True, "strengths": [], "issues": []},
            "automation_ops": [],
        }

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: module_index),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
            patch.object(main, "_ai_build_new_module_package", lambda *_args, **_kwargs: package),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                "Create a Client Projects module called Client Projects.",
                answer_hints={},
            )

        self.assertEqual(derived.get("affected_modules"), ["client_projects"])
        self.assertEqual(
            [op.get("op") for op in (plan.get("candidate_operations") or []) if isinstance(op, dict)],
            ["create_module", "update_dependency"],
        )
        dependency_op = next(
            op
            for op in (plan.get("candidate_operations") or [])
            if isinstance(op, dict) and op.get("op") == "update_dependency"
        )
        self.assertEqual((dependency_op.get("dependency") or {}).get("module"), "contacts")
        text = _ai_plan_assistant_text(
            plan,
            {
                "request_summary": "Create a Client Projects module called Client Projects.",
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "contacts", "manifest": contacts_manifest},
                ],
            },
        )
        self.assertIn("Contacts", text)

    def test_extract_requested_new_module_labels_skips_reused_existing_modules(self) -> None:
        contacts_manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts", "version": "1.0.0"},
            "entities": [
                {
                    "id": "entity.contact",
                    "fields": [
                        {"id": "contact.id", "type": "uuid", "label": "ID"},
                        {"id": "contact.name", "type": "string", "label": "Name"},
                    ],
                }
            ],
            "views": [],
        }
        module_index = {"contacts": {"manifest": contacts_manifest}}

        labels = main._ai_extract_requested_new_module_labels(
            "Reuse the shared contacts module for client records.\n\n"
            "Build only 2 custom modules:\n\n"
            "work_management\n"
            "billing\n\n"
            "Create them now.",
            ["contacts"],
            module_index,
        )

        self.assertEqual(labels, ["Work Management", "Billing"])

    def test_extract_requested_new_module_labels_reads_named_module_sections(self) -> None:
        contacts_manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts", "version": "1.0.0"},
            "entities": [
                {
                    "id": "entity.contact",
                    "fields": [
                        {"id": "contact.id", "type": "uuid", "label": "ID"},
                        {"id": "contact.name", "type": "string", "label": "Name"},
                    ],
                }
            ],
            "views": [],
        }
        module_index = {"contacts": {"manifest": contacts_manifest}}

        labels = main._ai_extract_requested_new_module_labels(
            "Create two new modules for this workflow.\n\n"
            "Contacts:\n"
            "- Reuse the existing contacts module for client records.\n\n"
            "Work Management:\n"
            "- Track projects, tasks, and time entries.\n"
            "- Add an approved-hours reminder automation.\n\n"
            "Billing module:\n"
            "- Create invoices from approved work.\n"
            "- Include an invoice PDF template with totals and payment details.\n",
            ["contacts"],
            module_index,
        )

        self.assertEqual(labels, ["Work Management", "Billing"])

    def test_create_module_bundle_scopes_named_module_sections_before_packaging(self) -> None:
        contacts_manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts", "version": "1.0.0"},
            "entities": [
                {
                    "id": "entity.contact",
                    "fields": [
                        {"id": "contact.id", "type": "uuid", "label": "ID"},
                        {"id": "contact.name", "type": "string", "label": "Name"},
                    ],
                }
            ],
            "views": [],
        }
        module_index = {
            "contacts": {
                "module_key": "contacts",
                "version": "1.0.0",
                "manifest": contacts_manifest,
            }
        }
        captured_messages: dict[str, str] = {}

        def _package_for(module_id: str, module_name: str, scoped_message: str) -> dict:
            captured_messages[module_id] = scoped_message
            manifest = {
                "module": {"id": module_id, "key": module_id, "name": module_name, "version": "0.1.0"},
                "entities": [
                    {
                        "id": f"entity.{module_id}",
                        "fields": [
                            {"id": f"{module_id}.id", "type": "uuid", "label": "ID"},
                            {"id": f"{module_id}.name", "type": "string", "label": "Name"},
                        ],
                    }
                ],
                "views": [],
                "pages": [],
                "actions": [],
                "relations": [],
            }
            automation_ops = []
            if "approved-hours reminder automation" in scoped_message.lower():
                automation_ops.append(
                    {
                        "op": "create_automation_record",
                        "artifact_type": "automation",
                        "artifact_id": f"ai_auto_{module_id}_approved_hours",
                        "automation": {"name": f"{module_name} Approved Hours Reminder"},
                    }
                )
            return {
                "manifest": manifest,
                "family": "operations",
                "design_spec": {"family": "operations"},
                "quality": {},
                "automation_ops": automation_ops,
            }

        with patch.object(main, "_ai_build_new_module_package", side_effect=_package_for):
            bundle = main._ai_build_create_module_bundle(
                "Create two new modules for this workflow.\n\n"
                "Contacts:\n"
                "- Reuse the existing contacts module for client records.\n\n"
                "Work Management:\n"
                "- Track projects, tasks, and time entries.\n"
                "- Add an approved-hours reminder automation.\n\n"
                "Billing module:\n"
                "- Create invoices from approved work.\n"
                "- Include an invoice PDF template with totals and payment details.\n",
                ["contacts"],
                module_index,
            )

        self.assertIsNotNone(bundle)
        self.assertIn("approved-hours reminder automation", captured_messages["work_management"].lower())
        self.assertNotIn("invoice pdf template", captured_messages["work_management"].lower())
        self.assertIn("invoice pdf template", captured_messages["billing"].lower())
        self.assertNotIn("approved-hours reminder automation", captured_messages["billing"].lower())
        automation_ops = [
            op
            for op in (bundle.get("candidate_ops") or [])
            if isinstance(op, dict) and op.get("op") == "create_automation_record"
        ]
        self.assertEqual([op.get("artifact_id") for op in automation_ops], ["ai_auto_work_management_approved_hours"])

    def test_plan_from_message_create_module_decomposes_explicit_missing_module_list(self) -> None:
        contacts_manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts", "version": "1.0.0"},
            "entities": [
                {
                    "id": "entity.contact",
                    "fields": [
                        {"id": "contact.id", "type": "uuid", "label": "ID"},
                        {"id": "contact.name", "type": "string", "label": "Name"},
                    ],
                }
            ],
            "views": [],
        }
        module_index = {
            "contacts": {
                "module_key": "contacts",
                "version": "1.0.0",
                "manifest": contacts_manifest,
            }
        }

        def _package_for(module_id: str, module_name: str, _message: str) -> dict:
            if module_id == "work_management":
                raw_spec = {
                    "family": "operations",
                    "entity_slug": "work_project",
                    "entity_label": "Project",
                    "nav_label": "Projects",
                    "primary_label": "Project Name",
                    "statuses": ["draft", "active", "completed"],
                    "fields": [
                        {"id": "work_project.name", "type": "string", "label": "Project Name"},
                        {
                            "id": "work_project.client_contact_id",
                            "type": "lookup",
                            "label": "Client",
                            "entity": "entity.contact",
                            "display_field": "contact.name",
                        },
                        {"id": "work_project.status", "type": "enum", "label": "Status", "options": ["draft", "active", "completed"]},
                        {"id": "work_project.start_date", "type": "date", "label": "Start Date"},
                        {"id": "work_project.default_hourly_rate", "type": "number", "label": "Default Rate"},
                        {"id": "work_project.notes", "type": "text", "label": "Notes"},
                    ],
                    "related_entities": [
                        {
                            "slug": "work_time_entry",
                            "label": "Time Entry",
                            "tab_label": "Time Entries",
                            "fields": [
                                {"id": "work_time_entry.entry_date", "type": "date", "label": "Entry Date"},
                                {
                                    "id": "work_time_entry.project_id",
                                    "type": "lookup",
                                    "label": "Project",
                                    "entity": "entity.work_project",
                                    "display_field": "work_project.name",
                                },
                                {"id": "work_time_entry.duration_hours", "type": "number", "label": "Duration Hours"},
                                {"id": "work_time_entry.status", "type": "enum", "label": "Status", "options": ["draft", "approved", "invoiced"]},
                                {"id": "work_time_entry.notes", "type": "text", "label": "Notes"},
                            ],
                        }
                    ],
                }
            elif module_id == "billing":
                raw_spec = {
                    "family": "finance",
                    "entity_slug": "invoice",
                    "entity_label": "Invoice",
                    "nav_label": "Invoices",
                    "primary_label": "Invoice Number",
                    "statuses": ["draft", "sent", "paid"],
                    "fields": [
                        {"id": "invoice.invoice_number", "type": "string", "label": "Invoice Number"},
                        {
                            "id": "invoice.contact_id",
                            "type": "lookup",
                            "label": "Client",
                            "entity": "entity.contact",
                            "display_field": "contact.name",
                        },
                        {
                            "id": "invoice.time_entry_id",
                            "type": "lookup",
                            "label": "Time Entry",
                            "entity": "entity.work_time_entry",
                            "display_field": "work_time_entry.entry_date",
                        },
                        {"id": "invoice.issue_date", "type": "date", "label": "Issue Date"},
                        {"id": "invoice.total", "type": "number", "label": "Total"},
                        {"id": "invoice.status", "type": "enum", "label": "Status", "options": ["draft", "sent", "paid"]},
                        {"id": "invoice.notes", "type": "text", "label": "Notes"},
                    ],
                }
            else:
                raise AssertionError(module_id)

            design_spec = main._ai_normalize_module_design_spec(module_id, module_name, _message, raw_spec)
            manifest, family, normalized_spec = main._ai_build_rich_module_scaffold(
                module_id,
                module_name,
                _message,
                design_spec=design_spec,
            )
            quality = main._ai_module_manifest_quality_report(module_id, manifest, family=family, design_spec=normalized_spec)
            return {
                "manifest": manifest,
                "family": family,
                "design_spec": normalized_spec,
                "quality": quality,
                "automation_ops": [],
            }

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: module_index),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
            patch.object(main, "_ai_build_new_module_package", side_effect=_package_for),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                "We want a minimal internal suite.\n\n"
                "Reuse the shared contacts module for client records.\n\n"
                "Build only 2 custom modules:\n\n"
                "work_management\n"
                "billing\n\n"
                "Create them now.",
                answer_hints={},
            )

        self.assertEqual((plan.get("planner_state") or {}).get("intent"), "create_module")
        self.assertEqual((plan.get("planner_state") or {}).get("module_ids"), ["work_management", "billing"])
        self.assertEqual(derived.get("affected_modules"), ["work_management", "billing"])
        create_ops = [
            op
            for op in (plan.get("candidate_operations") or [])
            if isinstance(op, dict) and op.get("op") == "create_module"
        ]
        self.assertEqual([op.get("artifact_id") for op in create_ops], ["work_management", "billing"])
        dependency_ops = [
            op
            for op in (plan.get("candidate_operations") or [])
            if isinstance(op, dict) and op.get("op") == "update_dependency"
        ]
        self.assertEqual(
            {
                (
                    op.get("artifact_id"),
                    ((op.get("dependency") or {}).get("module")),
                )
                for op in dependency_ops
            },
            {
                ("work_management", "contacts"),
                ("billing", "contacts"),
                ("billing", "work_management"),
            },
        )
        self.assertFalse(any(op.get("artifact_id") == "contacts" for op in create_ops))

    def test_generate_module_design_spec_for_commerce_tracking_brief_uses_reporting_fields(self) -> None:
        prompt = (
            "Create a module to track what I spend on purchases for my online business shop, "
            "pull items from catalog, track who spent what, how much sales, who gets owed how much, "
            "and use pivot reports."
        )

        with (
            patch.object(main, "USE_AI", True),
            patch.object(main, "_openai_configured", lambda: True),
            patch.object(
                main,
                "_openai_chat_completion",
                side_effect=AssertionError("model-backed design should be skipped for this deterministic commerce brief"),
            ),
        ):
            design_spec = main._ai_generate_module_design_spec("spend_sales_tracker", "Spend & Sales Tracker", prompt)

        self.assertEqual(design_spec.get("family"), "commerce")
        self.assertEqual(design_spec.get("design_source"), "deterministic_fallback")
        field_labels = [field.get("label") for field in (design_spec.get("fields") or []) if isinstance(field, dict)]
        self.assertIn("Catalog Item", field_labels)
        self.assertIn("Spent By", field_labels)
        self.assertIn("Sales Amount", field_labels)
        self.assertIn("Amount Owed", field_labels)
        self.assertIn("Margin", field_labels)
        self.assertIn("pivot", [view for view in ((design_spec.get("experience") or {}).get("views") or []) if isinstance(view, str)])

    def test_plan_from_message_commerce_tracking_brief_does_not_fall_back_to_sales_pipeline(self) -> None:
        prompt = (
            "can you create me a new module. I need this module to track what ive spent on purchases for my online business shop, "
            "we should pull items from catalog, i need to track who spent what etc, how much sales etc and ill use the pivot tool "
            "to create a spreadsheet of who gets owed how much and reports etc"
        )

        with (
            patch.object(main, "USE_AI", True),
            patch.object(main, "_openai_configured", lambda: True),
            patch.object(
                main,
                "_openai_chat_completion",
                side_effect=AssertionError("semantic model should not be needed for this deterministic commerce create-module brief"),
            ),
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: {}),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                prompt,
                answer_hints={},
            )

        self.assertEqual(derived.get("status"), "waiting_input")
        self.assertEqual((plan.get("required_question_meta") or {}).get("id"), "confirm_plan")
        create_op = next(op for op in (plan.get("candidate_operations") or []) if isinstance(op, dict) and op.get("op") == "create_module")
        manifest = create_op.get("manifest") or {}
        self.assertNotEqual(((manifest.get("module") or {}).get("name") or ""), "Sales Pipeline")
        entity = next((item for item in (manifest.get("entities") or []) if isinstance(item, dict)), {})
        field_labels = [field.get("label") for field in (entity.get("fields") or []) if isinstance(field, dict)]
        self.assertIn("Catalog Item", field_labels)
        self.assertIn("Sales Amount", field_labels)
        self.assertIn("Amount Owed", field_labels)
        text = _ai_plan_assistant_text(plan, {"request_summary": prompt, "full_selected_artifacts": []})
        self.assertIn("Catalog Item", text)
        self.assertIn("pivot", text.lower())
        self.assertIn("commerce", text.lower())
        self.assertNotIn("Sales Pipeline", text)
        self.assertNotIn("Root Cause", text)
        self.assertNotIn("Reported On", text)

    def test_slot_plan_treats_scoped_list_first_brief_as_new_module(self) -> None:
        module_index = {
            "contacts": {"manifest": {"module": {"id": "contacts", "name": "Contacts"}}},
            "calendar": {"manifest": {"module": {"id": "calendar", "name": "Calendar"}}},
        }

        plan = _ai_slot_based_plan(
            "For Neetones, make it list-first with useful views.",
            [],
            module_index,
            answer_hints=None,
        )

        self.assertEqual(plan.get("questions"), [])
        self.assertEqual((plan.get("planner_state") or {}).get("intent"), "create_module")
        create_ops = [op for op in plan.get("candidate_ops", []) if op.get("op") == "create_module"]
        self.assertEqual(len(create_ops), 1)
        self.assertEqual(create_ops[0].get("artifact_id"), "neetones")
        self.assertEqual(((create_ops[0].get("manifest") or {}).get("module") or {}).get("name"), "Neetones")

    def test_slot_plan_keeps_existing_module_on_scoped_list_first_brief(self) -> None:
        manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [
                {
                    "id": "entity.contact",
                    "fields": [{"id": "contact.name", "label": "Name", "type": "string"}],
                }
            ],
            "views": [
                {"id": "contact.list", "kind": "list", "entity": "entity.contact", "columns": [{"field_id": "contact.name", "label": "Name"}]},
                {"id": "contact.form", "kind": "form", "entity": "entity.contact", "sections": [{"id": "primary", "fields": ["contact.name"]}]},
            ],
            "pages": [
                {"id": "contact.home", "type": "dashboard", "title": "Contacts", "blocks": []},
                {"id": "contact.list_page", "type": "view", "title": "All Contacts", "view_id": "contact.list"},
                {"id": "contact.form_page", "type": "view", "title": "Contact", "view_id": "contact.form"},
            ],
            "actions": [],
        }
        module_index = {"contacts": {"manifest": manifest}}

        plan = _ai_slot_based_plan(
            "For Contacts, make it list-first with useful views.",
            [],
            module_index,
            answer_hints=None,
        )

        self.assertEqual(plan.get("questions"), [])
        self.assertEqual((plan.get("planner_state") or {}).get("intent"), "upgrade_module_style")
        self.assertIn("contacts", plan.get("affected_modules", []))
        self.assertFalse(any(op.get("op") == "create_module" for op in plan.get("candidate_ops", [])))

    def test_plan_from_message_forces_preview_confirm_when_style_review_preflight_is_technical(self) -> None:
        documents_manifest = {
            "module": {"id": "documents", "key": "documents", "name": "Documents"},
            "entities": [
                {
                    "id": "entity.document",
                    "label": "Documents",
                    "fields": [{"id": "document.title", "label": "Title", "type": "string"}],
                }
            ],
            "views": [],
            "pages": [],
            "actions": [],
        }
        module_index = {"documents": {"manifest": documents_manifest}}

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: module_index),
            patch.object(main, "_ai_preflight_candidate_ops", lambda _module_index, _ops: ([], [{"message": "view not found"}])),
        ):
            plan, _derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                "Review the Documents module for modern layout improvements.",
                answer_hints={},
            )

        self.assertEqual((plan.get("required_question_meta") or {}).get("id"), "confirm_plan")
        self.assertEqual((plan.get("planner_state") or {}).get("intent"), "preview_only_plan")
        text = _ai_plan_assistant_text(
            plan,
            {
                "request_summary": "Review the Documents module for modern layout improvements.",
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "documents", "manifest": documents_manifest},
                ],
            },
        )
        self.assertIn("Documents", text)
        self.assertIn("Confirm this plan?", plan.get("required_questions") or [])
        self.assertNotIn("view not found", text.lower())
        self.assertNotIn("specific layout or view change", text.lower())

    def test_resolve_entity_and_view_backed_fields(self) -> None:
        manifest = {
            "entities": [
                {
                    "id": "entity.contact",
                    "fields": [
                        {"id": "contact.name", "label": "Name", "type": "string"},
                        {"id": "contact.a_new", "label": "A New", "type": "string"},
                    ],
                }
            ],
            "views": [
                {
                    "id": "contact.list",
                    "kind": "list",
                    "entity": "entity.contact",
                    "columns": [
                        {"field_id": "contact.a_new", "label": "A New"},
                        {
                            "field_id": "contact.headshots",
                            "label": "A New Attachment Field Upload Called Headshots For Them",
                        },
                    ],
                },
                {
                    "id": "contact.form",
                    "kind": "form",
                    "entity": "entity.contact",
                    "sections": [
                        {"id": "primary", "fields": ["contact.name", "contact.a_new"]},
                        {"id": "notes", "fields": ["contact.headshots"]},
                    ],
                },
            ],
        }
        entity = manifest["entities"][0]

        direct = _ai_resolve_field_reference(manifest, entity, "A New")
        self.assertEqual(direct.get("field_id"), "contact.a_new")
        self.assertTrue(direct.get("entity_field_exists"))

        view_backed = _ai_resolve_field_reference(
            manifest,
            entity,
            "A New Attachment Field Upload Called Headshots For Them",
        )
        self.assertEqual(view_backed.get("field_id"), "contact.headshots")
        self.assertFalse(view_backed.get("entity_field_exists"))

    def test_suggestions_prefer_semantic_overlap(self) -> None:
        manifest = {
            "entities": [
                {
                    "id": "entity.contact",
                    "fields": [
                        {"id": "contact.name", "label": "Name", "type": "string"},
                        {"id": "contact.mobile", "label": "Mobile", "type": "string"},
                        {"id": "contact.language", "label": "Language", "type": "string"},
                    ],
                }
            ],
            "views": [],
        }

        self.assertEqual(_ai_suggest_form_field_refs(manifest, "roblux"), [])

    def test_noop_patchset_validates_and_plan_text_is_clear(self) -> None:
        validation = _ai_validate_patchset_against_workspace(
            None,
            {"patch_json": {"operations": [], "noop": True, "reason": "field_missing_noop"}},
        )
        self.assertTrue(validation.get("ok"))
        self.assertEqual(validation.get("errors"), [])
        self.assertIn("already absent", (validation.get("warnings") or [{}])[0].get("message", ""))
        self.assertNotIn("field_missing_noop", (validation.get("warnings") or [{}])[0].get("message", ""))

        text = _ai_plan_assistant_text(
            {
                "required_questions": [],
                "required_question_meta": None,
                "assumptions": [],
                "risk_flags": [],
                "advisories": ["The requested field is already absent."],
                "proposed_changes": [],
                "resolved_without_changes": True,
                "planner_state": {"intent": "field_missing_noop", "field_ref": "roblux"},
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "contacts"}],
            },
            {
                "full_selected_artifacts": [
                    {
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "manifest": {"module": {"name": "Contacts"}},
                    }
                ]
            },
        )
        self.assertIn("Field 'roblux' does not appear in Contacts.", text)
        self.assertIn("No changes are needed right now.", text)
        self.assertIn("The sandbox can stay as it is.", text)
        self.assertNotIn("manifest", text.lower())

    def test_plan_text_keeps_mixed_noop_notes_out_of_suggestions(self) -> None:
        text = _ai_plan_assistant_text(
            {
                "required_questions": ["Confirm this plan?"],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": [],
                "risk_flags": [],
                "advisories": ["Field 'roblux' is already absent in Contacts."],
                "noop_notes": ["Field 'roblux' is already absent in Contacts."],
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "contacts"}],
                "proposed_changes": [
                    {
                        "op": "add_field",
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "field": {"id": "contact.birthday", "label": "Birthday", "type": "date"},
                    }
                ],
                "planner_state": {"intent": "multi_request"},
            },
            {
                "full_selected_artifacts": [
                    {
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "manifest": {"module": {"name": "Contacts"}},
                    }
                ]
            },
        )

        self.assertIn("Planned changes:", text)
        self.assertIn("Add field 'Birthday' (date) in Contacts.", text)
        self.assertIn("No-change notes:", text)
        self.assertIn("Field 'roblux' is already absent in Contacts.", text)
        self.assertNotIn("Suggestions:\n- Field 'roblux' is already absent in Contacts.", text)

    def test_noop_preview_in_confirm_flow_includes_canonical_noop_sentence(self) -> None:
        text = _ai_plan_assistant_text(
            {
                "required_questions": ["Confirm this plan?"],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": [],
                "risk_flags": [],
                "advisories": ["Field 'roblux' is already absent in Contacts."],
                "noop_notes": ["Field 'roblux' is already absent in Contacts."],
                "proposed_changes": [],
                "resolved_without_changes": True,
                "planner_state": {"intent": "field_missing_noop", "field_ref": "roblux"},
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "contacts"}],
            },
            {
                "full_selected_artifacts": [
                    {
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "manifest": {"module": {"name": "Contacts"}},
                    }
                ]
            },
        )

        self.assertIn("No changes are needed right now.", text)
        self.assertIn("If this looks right, confirm the plan", text)

    def test_plan_text_keeps_existing_module_changes_in_plain_language(self) -> None:
        text = _ai_plan_assistant_text(
            {
                "required_questions": ["Confirm this plan?"],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": [],
                "risk_flags": [],
                "advisories": [],
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "contacts"}],
                "proposed_changes": [
                    {
                        "op": "insert_section_field",
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "view_id": "contact.form",
                        "section_id": "client_details",
                        "field_id": "contact.birthday",
                    },
                    {
                        "op": "remove_field",
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "entity_id": "entity.contact",
                        "field_id": "contact.legacy_code",
                    },
                ],
                "planner_state": {"intent": "add_field", "field_label": "Birthday", "field_id": "contact.birthday"},
            },
            {
                "full_selected_artifacts": [
                    {
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "manifest": {
                            "module": {"name": "Contacts"},
                            "entities": [
                                {
                                    "id": "entity.contact",
                                    "fields": [
                                        {"id": "contact.birthday", "label": "Birthday", "type": "date"},
                                        {"id": "contact.legacy_code", "label": "Legacy Code", "type": "string"},
                                    ],
                                }
                            ],
                            "views": [
                                {
                                    "id": "contact.form",
                                    "kind": "form",
                                    "entity": "entity.contact",
                                    "sections": [
                                        {"id": "client_details", "title": "Client Details", "fields": ["contact.birthday"]},
                                    ],
                                }
                            ],
                        },
                    }
                ]
            },
        )

        self.assertIn("Place field 'Birthday' in the 'Client Details' section in Contacts.", text)
        self.assertIn("Remove field 'Legacy Code' from Contacts.", text)
        self.assertNotIn("contact.birthday", text)
        self.assertNotIn("contact.legacy_code", text)

    def test_plan_text_preserves_requested_tab_label_for_existing_section_match(self) -> None:
        text = _ai_plan_assistant_text(
            {
                "required_questions": ["Confirm this plan?"],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": [],
                "risk_flags": [],
                "advisories": [],
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "contacts"}],
                "proposed_changes": [
                    {
                        "op": "add_field",
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "entity_id": "entity.contact",
                        "field": {"id": "contact.relationship_notes", "label": "Relationship Notes", "type": "text"},
                    },
                    {
                        "op": "insert_section_field",
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "view_id": "contact.form",
                        "section_id": "notes",
                        "field_id": "contact.relationship_notes",
                        "placement_label": "Client Notes",
                        "placement_kind": "tab",
                    },
                ],
                "planner_state": {
                    "intent": "add_field",
                    "field_label": "Relationship Notes",
                    "field_id": "contact.relationship_notes",
                    "matched_tab": "Client Notes",
                    "resolved_tab_label": "Internal Notes",
                },
            },
            {
                "full_selected_artifacts": [
                    {
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "manifest": {
                            "module": {"name": "Contacts"},
                            "entities": [
                                {
                                    "id": "entity.contact",
                                    "fields": [
                                        {"id": "contact.relationship_notes", "label": "Relationship Notes", "type": "text"},
                                    ],
                                }
                            ],
                            "views": [
                                {
                                    "id": "contact.form",
                                    "kind": "form",
                                    "entity": "entity.contact",
                                    "header": {
                                        "tabs": {
                                            "tabs": [
                                                {"id": "internal_notes", "label": "Internal Notes", "sections": ["notes"]},
                                            ]
                                        }
                                    },
                                    "sections": [
                                        {"id": "notes", "title": "Internal Notes", "fields": ["contact.relationship_notes"]},
                                    ],
                                }
                            ],
                        },
                    }
                ]
            },
        )

        self.assertIn("Add a new field 'Relationship Notes' to Contacts and place it in the 'Client Notes' tab.", text)
        self.assertIn("Place field 'Relationship Notes' in the 'Client Notes' tab in Contacts.", text)
        self.assertNotIn("Consider whether 'Relationship Notes' belongs in a specific tab or section instead of the default placement.", text)

    def test_plan_text_explicitly_mentions_multiple_modules(self) -> None:
        text = _ai_plan_assistant_text(
            {
                "required_questions": ["Confirm this plan?"],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": [],
                "risk_flags": [],
                "advisories": [],
                "affected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "contacts"},
                    {"artifact_type": "module", "artifact_id": "jobs"},
                ],
                "proposed_changes": [
                    {
                        "op": "add_field",
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "field": {"label": "Customer Tier", "type": "string"},
                    },
                    {
                        "op": "add_field",
                        "artifact_type": "module",
                        "artifact_id": "jobs",
                        "field": {"label": "Preferred Technician", "type": "string"},
                    },
                ],
                "planner_state": {"intent": "multi_request"},
            },
            {
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "contacts", "manifest": {"module": {"name": "Contacts"}}},
                    {"artifact_type": "module", "artifact_id": "jobs", "manifest": {"module": {"name": "Jobs"}}},
                ]
            },
        )

        self.assertIn("This affects 2 modules: Contacts and Jobs.", text)
        self.assertIn("confirm the plan", text.lower())

    def test_plan_text_infers_confirm_plan_flow_when_meta_is_missing(self) -> None:
        text = _ai_plan_assistant_text(
            {
                "required_questions": ["Confirm this plan?"],
                "required_question_meta": None,
                "assumptions": [],
                "risk_flags": [],
                "advisories": [],
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "contacts"}],
                "proposed_changes": [
                    {
                        "op": "add_field",
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "field": {"label": "Escalation Note", "type": "text"},
                    }
                ],
                "planner_state": {"intent": "add_field"},
            },
            {
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "contacts", "manifest": {"module": {"name": "Contacts"}}},
                ]
            },
        )

        self.assertIn("If this looks right, confirm the plan", text)
        self.assertIn("draft patchset for sandbox validation", text)
        self.assertNotIn("I need one clarification before I finalize the plan", text)
        self.assertNotIn("apply the validated change to this sandbox", text)

    def test_plan_text_keeps_confirmed_plan_in_draft_patchset_flow(self) -> None:
        text = _ai_plan_assistant_text(
            {
                "required_questions": [],
                "required_question_meta": None,
                "assumptions": [],
                "risk_flags": [],
                "advisories": [],
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "contacts"}],
                "proposed_changes": [
                    {
                        "op": "add_field",
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "field": {"label": "Escalation Note", "type": "text"},
                    }
                ],
                "planner_state": {"intent": "add_field"},
            },
            {
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "contacts", "manifest": {"module": {"name": "Contacts"}}},
                ]
            },
        )

        self.assertIn("Plan confirmed.", text)
        self.assertIn("draft patchset for sandbox validation", text)
        self.assertNotIn("apply the validated change to this sandbox now", text)

    def test_plan_text_humanizes_dependency_changes_and_large_bundles(self) -> None:
        text = _ai_plan_assistant_text(
            {
                "required_questions": ["Confirm this plan?"],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": [],
                "risk_flags": [],
                "advisories": [],
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "contacts"}],
                "proposed_changes": [
                    {"op": "update_dependency", "artifact_type": "module", "artifact_id": "contacts", "dependency": {"module": "jobs"}},
                    {"op": "add_action", "artifact_type": "module", "artifact_id": "contacts", "action": {"id": "action.one"}},
                    {"op": "add_trigger", "artifact_type": "module", "artifact_id": "contacts", "trigger": {"id": "trigger.one"}},
                    {"op": "add_page_block", "artifact_type": "module", "artifact_id": "contacts", "page_id": "contact_dashboard", "block": {"kind": "metric"}},
                    {"op": "update_view", "artifact_type": "module", "artifact_id": "contacts", "view_id": "contact.form", "changes": {}},
                    {"op": "update_field", "artifact_type": "module", "artifact_id": "contacts", "field_id": "contact.name", "changes": {"label": "Full Name"}},
                    {"op": "unknown_internal_op", "artifact_type": "module", "artifact_id": "contacts"},
                ],
                "planner_state": {"intent": "multi_request"},
            },
            {
                "full_selected_artifacts": [
                    {
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "manifest": {
                            "module": {"name": "Contacts"},
                            "entities": [{"id": "entity.contact", "fields": [{"id": "contact.name", "label": "Name", "type": "string"}]}],
                            "views": [{"id": "contact.form", "kind": "form"}],
                        },
                    }
                ]
            },
        )

        self.assertIn("Update the module dependency settings for Contacts.", text)
        self.assertIn("Add a new action in Contacts.", text)
        self.assertIn("Add a workflow trigger in Contacts.", text)
        self.assertIn("Add a new block to page 'Contact Dashboard' in Contacts.", text)
        self.assertIn("Plus 1 more planned change.", text)
        self.assertNotIn("update_dependency", text)
        self.assertNotIn("unknown_internal_op", text)

    def test_plan_text_humanizes_added_views_and_named_action_updates(self) -> None:
        text = _ai_plan_assistant_text(
            {
                "required_questions": ["Confirm this plan?"],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": [],
                "risk_flags": [],
                "advisories": [],
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "contacts"}],
                "proposed_changes": [
                    {
                        "op": "add_view",
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "view": {"id": "contact.calendar", "kind": "calendar", "entity": "entity.contact"},
                    },
                    {
                        "op": "update_action",
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "action_id": "action.approve",
                        "changes": {"enabled_when": {"op": "eq", "field": "contact.approval_status", "value": "pending"}},
                    },
                ],
                "planner_state": {"intent": "multi_request"},
            },
            {
                "full_selected_artifacts": [
                    {
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "manifest": {
                            "module": {"name": "Contacts"},
                            "entities": [
                                {
                                    "id": "entity.contact",
                                    "fields": [
                                        {"id": "contact.approval_status", "label": "Approval Status", "type": "string"},
                                    ],
                                }
                            ],
                            "views": [],
                            "actions": [{"id": "action.approve", "label": "Approve"}],
                        },
                    }
                ]
            },
        )

        self.assertIn("Add the calendar view in Contacts.", text)
        self.assertIn("Update action 'Approve' in Contacts.", text)
        self.assertIn("Views & pages:", text)
        self.assertIn("Workflow & actions:", text)
        self.assertNotIn("add_view", text)
        self.assertNotIn("update_action", text)

    def test_plan_text_does_not_leak_field_ids_in_understanding_line(self) -> None:
        text = _ai_plan_assistant_text(
            {
                "required_questions": ["Confirm this plan?"],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": [],
                "risk_flags": [],
                "advisories": [],
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "contacts"}],
                "proposed_changes": [
                    {
                        "op": "remove_field",
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "entity_id": "entity.contact",
                        "field_id": "contact.birthday",
                    }
                ],
                "planner_state": {"intent": "remove_field", "field_ref": "contact.birthday"},
            },
            {
                "full_selected_artifacts": [
                    {
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "manifest": {
                            "module": {"name": "Contacts"},
                            "entities": [
                                {
                                    "id": "entity.contact",
                                    "fields": [
                                        {"id": "contact.birthday", "label": "Birthday", "type": "date"},
                                    ],
                                }
                            ],
                        },
                    }
                ]
            },
        )

        self.assertIn("Remove field 'Birthday' from Contacts.", text)
        self.assertNotIn("contact.birthday", text)

    def test_multi_request_same_module_bundle_returns_combined_plan(self) -> None:
        manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [
                {
                    "id": "entity.contact",
                    "fields": [{"id": "contact.name", "label": "Name", "type": "string"}],
                }
            ],
            "views": [
                {
                    "id": "contact.form",
                    "kind": "form",
                    "entity": "entity.contact",
                    "header": {
                        "tabs": {
                            "tabs": [
                                {"id": "primary_tab", "label": "Primary", "sections": ["primary"]},
                            ]
                        }
                    },
                    "sections": [{"id": "primary", "fields": ["contact.name"]}],
                }
            ],
        }
        module_index = {"contacts": {"manifest": manifest}}

        plan = _ai_slot_based_plan(
            "Add a new field in the Contacts module called Roblux. Create a new tab in that module called Master. Put a Master Notes field in that tab.",
            [],
            module_index,
            answer_hints=None,
        )

        self.assertEqual(plan.get("questions"), [])
        op_names = [op.get("op") for op in plan.get("candidate_ops", [])]
        self.assertGreaterEqual(op_names.count("add_field"), 2)
        self.assertIn("update_view", op_names)
        self.assertIn("contacts", plan.get("affected_modules", []))

    def test_multi_request_same_module_bundle_splits_without_punctuation(self) -> None:
        manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [
                {
                    "id": "entity.contact",
                    "fields": [{"id": "contact.name", "label": "Name", "type": "string"}],
                }
            ],
            "views": [
                {
                    "id": "contact.form",
                    "kind": "form",
                    "entity": "entity.contact",
                    "header": {
                        "tabs": {
                            "tabs": [
                                {"id": "primary_tab", "label": "Primary", "sections": ["primary"]},
                            ]
                        }
                    },
                    "sections": [{"id": "primary", "fields": ["contact.name"]}],
                }
            ],
        }
        module_index = {"contacts": {"manifest": manifest}}

        plan = _ai_slot_based_plan(
            "Add a new field in the Contacts module called Roblux and create a new tab in that module called Master and put a Master Notes field in that tab.",
            [],
            module_index,
            answer_hints=None,
        )

        self.assertEqual(plan.get("questions"), [])
        op_names = [op.get("op") for op in plan.get("candidate_ops", [])]
        self.assertGreaterEqual(op_names.count("add_field"), 2)
        self.assertIn("update_view", op_names)
        self.assertIn("insert_section_field", op_names)
        self.assertIn("contacts", plan.get("affected_modules", []))

        text = _ai_plan_assistant_text(
            {
                "required_questions": ["Confirm this plan?"],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": plan.get("assumptions") or [],
                "risk_flags": [],
                "advisories": plan.get("advisories") or [],
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "contacts"}],
                "proposed_changes": [op for op in (plan.get("candidate_ops") or []) if isinstance(op, dict)],
                "planner_state": plan.get("planner_state") or {},
            },
            {
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "contacts", "manifest": manifest},
                ]
            },
        )
        self.assertIn("Create tab 'Master' in Contacts.", text)
        self.assertNotIn("Create module 'Contacts'.", text)

    def test_multi_request_tab_then_field_in_that_tab_uses_requested_labels(self) -> None:
        manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [
                {
                    "id": "entity.contact",
                    "fields": [{"id": "contact.name", "label": "Name", "type": "string"}],
                }
            ],
            "views": [
                {
                    "id": "contact.form",
                    "kind": "form",
                    "entity": "entity.contact",
                    "header": {
                        "tabs": {
                            "tabs": [
                                {"id": "primary_tab", "label": "Primary", "sections": ["primary"]},
                            ]
                        }
                    },
                    "sections": [{"id": "primary", "fields": ["contact.name"]}],
                }
            ],
        }
        module_index = {"contacts": {"manifest": manifest}}

        plan = _ai_slot_based_plan(
            "hi, can you add a new tab in contacts called Levels, and then add a new notes field in that tab called Level notes.",
            [],
            module_index,
            answer_hints=None,
        )

        self.assertEqual(plan.get("questions"), [])
        ops = [op for op in plan.get("candidate_ops", []) if isinstance(op, dict)]
        self.assertEqual([op.get("op") for op in ops], ["update_view", "add_field", "insert_section_field"])
        self.assertEqual(ops[0].get("tab_label"), "Levels")
        self.assertEqual(ops[1].get("field", {}).get("label"), "Level notes")
        self.assertEqual(ops[2].get("placement_label"), "Levels")
        self.assertEqual(plan.get("affected_modules"), ["contacts"])

    def test_multi_request_existing_tab_stays_in_confirm_flow_and_keeps_requested_tab_preview(self) -> None:
        manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [
                {
                    "id": "entity.contact",
                    "fields": [{"id": "contact.name", "label": "Name", "type": "string"}],
                }
            ],
            "views": [
                {
                    "id": "contact.form",
                    "kind": "form",
                    "entity": "entity.contact",
                    "header": {
                        "tabs": {
                            "tabs": [
                                {"id": "primary_tab", "label": "Primary", "sections": ["primary"]},
                                {"id": "master_tab", "label": "Master", "sections": ["master"]},
                            ]
                        }
                    },
                    "sections": [
                        {"id": "primary", "fields": ["contact.name"]},
                        {"id": "master", "fields": []},
                    ],
                }
            ],
        }
        module_index = {"contacts": {"manifest": manifest}}

        plan = _ai_slot_based_plan(
            "Add a new field in the Contacts module called Roblux. Create a new tab in that module called Master. Put a Master Notes field in that tab.",
            [],
            module_index,
            answer_hints=None,
        )

        self.assertEqual(plan.get("questions"), [])
        ops = [op for op in (plan.get("candidate_ops") or []) if isinstance(op, dict)]
        self.assertEqual([op.get("op") for op in ops], ["add_field", "add_field", "insert_section_field"])
        self.assertEqual(ops[2].get("section_id"), "master")
        self.assertIn("Create tab 'Master' in Contacts.", plan.get("requested_change_lines", []))

        text = _ai_plan_assistant_text(
            {
                "required_questions": ["Confirm this plan?"],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": plan.get("assumptions") or [],
                "risk_flags": plan.get("risk_flags") or [],
                "advisories": plan.get("advisories") or [],
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "contacts"}],
                "proposed_changes": ops,
                "planner_state": plan.get("planner_state") or {},
                "requested_change_lines": plan.get("requested_change_lines") or [],
            },
            {
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "contacts", "manifest": manifest},
                ]
            },
        )
        self.assertIn("Create tab 'Master' in Contacts.", text)
        self.assertNotIn("I need one clarification before I finalize the plan", text)

    def test_multi_request_bundle_keeps_noop_note_alongside_actionable_change(self) -> None:
        manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [
                {
                    "id": "entity.contact",
                    "fields": [{"id": "contact.name", "label": "Name", "type": "string"}],
                }
            ],
            "views": [],
        }
        module_index = {"contacts": {"manifest": manifest}}

        plan = _ai_slot_based_plan(
            "Remove the roblux field from Contacts and add a Birthday field to Contacts.",
            [],
            module_index,
            answer_hints=None,
        )

        self.assertEqual(plan.get("questions"), [])
        self.assertFalse(plan.get("resolved_without_changes"))
        self.assertEqual([op.get("op") for op in plan.get("candidate_ops", [])], ["add_field"])
        self.assertIn("Field 'roblux' is already absent in Contacts.", plan.get("noop_notes", []))

    def test_status_request_with_existing_status_keeps_requested_status_preview_and_syncs_actions(self) -> None:
        manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [
                {
                    "id": "entity.contact",
                    "fields": [
                        {"id": "contact.name", "label": "Name", "type": "string"},
                        {
                            "id": "contact.status",
                            "label": "Status",
                            "type": "enum",
                            "options": [
                                {"value": "new", "label": "New"},
                                {"value": "contacted", "label": "Contacted"},
                            ],
                        },
                    ],
                }
            ],
            "views": [
                {
                    "id": "contact.form",
                    "kind": "form",
                    "entity": "entity.contact",
                    "header": {},
                    "sections": [{"id": "primary", "fields": ["contact.name", "contact.status"]}],
                }
            ],
            "workflows": [
                {
                    "id": "workflow.contact_status",
                    "entity": "entity.contact",
                    "status_field": "contact.status",
                    "states": [
                        {"id": "new", "label": "New", "order": 1},
                        {"id": "contacted", "label": "Contacted", "order": 2},
                    ],
                    "transitions": [
                        {"from": "new", "to": "contacted", "label": "Set: Contacted"},
                    ],
                }
            ],
            "actions": [],
        }
        module_index = {"contacts": {"manifest": manifest}}
        message = "In Contacts, add a new Contacted status and add an action button called Set: Contacted so staff can move records through that status clearly."

        plan = _ai_slot_based_plan(
            message,
            [],
            module_index,
            answer_hints=None,
        )

        self.assertEqual(plan.get("questions"), [])
        op_names = [op.get("op") for op in (plan.get("candidate_ops") or []) if isinstance(op, dict)]
        self.assertIn("add_action", op_names)
        self.assertIn("update_view", op_names)
        self.assertIn("Add status 'Contacted' to Contacts.", plan.get("requested_change_lines", []))

        text = _ai_plan_assistant_text(
            {
                "required_questions": ["Confirm this plan?"],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": plan.get("assumptions") or [],
                "risk_flags": plan.get("risk_flags") or [],
                "advisories": plan.get("advisories") or [],
                "noop_notes": plan.get("noop_notes") or [],
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "contacts"}],
                "proposed_changes": [op for op in (plan.get("candidate_ops") or []) if isinstance(op, dict)],
                "planner_state": plan.get("planner_state") or {},
                "requested_change_lines": plan.get("requested_change_lines") or [],
            },
            {
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "contacts", "manifest": manifest},
                ]
            },
        )
        self.assertIn("Add status 'Contacted' to Contacts.", text)

    def test_status_request_with_existing_status_refreshes_stale_workflow_preview(self) -> None:
        manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [
                {
                    "id": "entity.contact",
                    "fields": [
                        {"id": "contact.name", "label": "Name", "type": "string"},
                        {
                            "id": "contact.status",
                            "label": "Status",
                            "type": "enum",
                            "options": [
                                {"value": "active", "label": "Active"},
                                {"value": "inactive", "label": "Inactive"},
                                {"value": "contacted", "label": "Contacted"},
                            ],
                        },
                    ],
                }
            ],
            "views": [
                {
                    "id": "contact.form",
                    "kind": "form",
                    "entity": "entity.contact",
                    "header": {},
                    "sections": [{"id": "primary", "fields": ["contact.name", "contact.status"]}],
                }
            ],
            "workflows": [
                {
                    "id": "workflow.contact_status",
                    "entity": "entity.contact",
                    "status_field": "contact.status",
                    "states": [
                        {"id": "active", "label": "Active", "order": 1},
                        {"id": "inactive", "label": "Inactive", "order": 2},
                    ],
                    "transitions": [
                        {"from": "active", "to": "inactive", "label": "Deactivate"},
                        {"from": "inactive", "to": "active", "label": "Activate"},
                    ],
                }
            ],
            "actions": [
                {
                    "id": "action.contact_deactivate",
                    "kind": "update_record",
                    "label": "Deactivate",
                    "entity_id": "entity.contact",
                    "patch": {"contact.status": "inactive"},
                    "enabled_when": {"op": "eq", "field": "contact.status", "value": "active"},
                    "visible_when": {"op": "eq", "field": "contact.status", "value": "active"},
                },
                {
                    "id": "action.contact_activate",
                    "kind": "update_record",
                    "label": "Activate",
                    "entity_id": "entity.contact",
                    "patch": {"contact.status": "active"},
                    "enabled_when": {"op": "eq", "field": "contact.status", "value": "inactive"},
                    "visible_when": {"op": "eq", "field": "contact.status", "value": "inactive"},
                },
            ],
        }
        module_index = {"contacts": {"manifest": manifest}}
        message = "In Contacts, add a new Contacted status and add an action button called Set: Contacted so staff can move records through that status clearly."

        plan = _ai_slot_based_plan(
            message,
            [],
            module_index,
            answer_hints=None,
        )

        ops = [op for op in (plan.get("candidate_ops") or []) if isinstance(op, dict)]
        self.assertIn("update_workflow", [op.get("op") for op in ops])
        workflow_op = next(op for op in ops if op.get("op") == "update_workflow")
        workflow_states = workflow_op.get("changes", {}).get("states", [])
        self.assertTrue(any(isinstance(state, dict) and state.get("id") == "contacted" for state in workflow_states))

        text = _ai_plan_assistant_text(
            {
                "required_questions": ["Confirm this plan?"],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": plan.get("assumptions") or [],
                "risk_flags": plan.get("risk_flags") or [],
                "advisories": plan.get("advisories") or [],
                "noop_notes": plan.get("noop_notes") or [],
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "contacts"}],
                "proposed_changes": ops,
                "planner_state": plan.get("planner_state") or {},
                "requested_change_lines": plan.get("requested_change_lines") or [],
            },
            {
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "contacts", "manifest": manifest},
                ]
            },
        )

        self.assertIn("Update the status workflow and action buttons in Contacts.", text)
        self.assertIn("Workflow & actions:", text)
        self.assertNotIn("module_27052f", text)

    def test_slot_plan_uses_planned_tab_section_from_follow_up_hints(self) -> None:
        manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [
                {
                    "id": "entity.contact",
                    "fields": [{"id": "contact.name", "label": "Name", "type": "string"}],
                }
            ],
            "views": [
                {
                    "id": "contact.form",
                    "kind": "form",
                    "entity": "entity.contact",
                    "header": {
                        "tabs": {
                            "tabs": [
                                {"id": "primary_tab", "label": "Primary", "sections": ["primary"]},
                            ]
                        }
                    },
                    "sections": [{"id": "primary", "fields": ["contact.name"]}],
                }
            ],
        }
        module_index = {"contacts": {"manifest": manifest}}

        plan = _ai_slot_based_plan(
            "Also put Master Notes in that tab.",
            ["contacts"],
            module_index,
            answer_hints={
                "module_target": "contacts",
                "tab_target": "Master",
                "planned_section_id": "master",
            },
        )

        self.assertEqual(plan.get("questions"), [])
        op_names = [op.get("op") for op in plan.get("candidate_ops", [])]
        self.assertIn("add_field", op_names)
        insert_ops = [op for op in plan.get("candidate_ops", []) if op.get("op") == "insert_section_field"]
        self.assertEqual(len(insert_ops), 1)
        self.assertEqual(insert_ops[0].get("section_id"), "master")

    def test_slot_plan_preserves_requested_tab_label_when_matching_existing_notes_tab(self) -> None:
        manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [
                {
                    "id": "entity.contact",
                    "fields": [{"id": "contact.name", "label": "Name", "type": "string"}],
                }
            ],
            "views": [
                {
                    "id": "contact.form",
                    "kind": "form",
                    "entity": "entity.contact",
                    "header": {
                        "tabs": {
                            "tabs": [
                                {"id": "primary_tab", "label": "Primary", "sections": ["primary"]},
                                {"id": "internal_notes", "label": "Internal Notes", "sections": ["notes"]},
                            ]
                        }
                    },
                    "sections": [
                        {"id": "primary", "fields": ["contact.name"]},
                        {"id": "notes", "title": "Internal Notes", "fields": []},
                    ],
                }
            ],
        }
        module_index = {"contacts": {"manifest": manifest}}

        plan = _ai_slot_based_plan(
            "Add Relationship Notes to Contacts and put it in the Client Notes tab.",
            [],
            module_index,
            answer_hints=None,
        )

        self.assertEqual(plan.get("questions"), [])
        insert_ops = [op for op in plan.get("candidate_ops", []) if op.get("op") == "insert_section_field"]
        self.assertEqual(len(insert_ops), 1)
        self.assertEqual(insert_ops[0].get("section_id"), "notes")
        self.assertEqual(insert_ops[0].get("placement_label"), "Client Notes")
        self.assertEqual(insert_ops[0].get("placement_kind"), "tab")
        self.assertEqual((plan.get("planner_state") or {}).get("matched_tab"), "Client Notes")
        self.assertEqual((plan.get("planner_state") or {}).get("resolved_tab_label"), "Internal Notes")

    def test_multi_request_cross_module_bundle_returns_combined_plan(self) -> None:
        contacts_manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [{"id": "entity.contact", "fields": [{"id": "contact.name", "label": "Name", "type": "string"}]}],
            "views": [],
        }
        jobs_manifest = {
            "module": {"id": "jobs", "key": "jobs", "name": "Jobs"},
            "entities": [{"id": "entity.job", "fields": [{"id": "job.title", "label": "Title", "type": "string"}]}],
            "views": [],
        }
        module_index = {"contacts": {"manifest": contacts_manifest}, "jobs": {"manifest": jobs_manifest}}

        plan = _ai_slot_based_plan(
            "In Contacts, add a Customer Tier field. In Jobs, add a Preferred Technician field and show both plans clearly before you build anything.",
            [],
            module_index,
            answer_hints=None,
        )

        self.assertEqual(plan.get("questions"), [])
        affected = set(plan.get("affected_modules", []))
        self.assertEqual(affected, {"contacts", "jobs"})
        added_fields = [op.get("field", {}).get("label") for op in plan.get("candidate_ops", []) if op.get("op") == "add_field"]
        self.assertIn("Customer Tier", added_fields)
        self.assertIn("Preferred Technician", added_fields)

    def test_multi_request_cross_module_bundle_splits_same_sentence_scope_switch(self) -> None:
        contacts_manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [{"id": "entity.contact", "fields": [{"id": "contact.name", "label": "Name", "type": "string"}]}],
            "views": [],
        }
        jobs_manifest = {
            "module": {"id": "jobs", "key": "jobs", "name": "Jobs"},
            "entities": [{"id": "entity.job", "fields": [{"id": "job.title", "label": "Title", "type": "string"}]}],
            "views": [],
        }
        module_index = {"contacts": {"manifest": contacts_manifest}, "jobs": {"manifest": jobs_manifest}}

        plan = _ai_slot_based_plan(
            "In Contacts add a Customer Tier field and in Jobs add a Preferred Technician field.",
            [],
            module_index,
            answer_hints=None,
        )

        self.assertEqual(plan.get("questions"), [])
        affected = set(plan.get("affected_modules", []))
        self.assertEqual(affected, {"contacts", "jobs"})
        added_fields = [op.get("field", {}).get("label") for op in plan.get("candidate_ops", []) if op.get("op") == "add_field"]
        self.assertIn("Customer Tier", added_fields)
        self.assertIn("Preferred Technician", added_fields)

    def test_create_module_preview_mentions_workflow_states(self) -> None:
        plan_text = _ai_plan_assistant_text(
            {
                "required_questions": ["Confirm this plan?"],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": [],
                "risk_flags": [],
                "advisories": [],
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "candidate_pipeline"}],
                "proposed_changes": [
                    {
                        "op": "create_module",
                        "artifact_id": "candidate_pipeline",
                        "manifest": {
                            "module": {"name": "Candidate Pipeline"},
                            "entities": [{"id": "entity.candidate", "label": "Candidate"}],
                            "views": [{"id": "candidate.list", "kind": "list"}, {"id": "candidate.form", "kind": "form"}, {"id": "candidate.kanban", "kind": "kanban"}],
                            "workflows": [
                                {
                                    "id": "workflow.candidate_stage",
                                    "states": [
                                        {"id": "applied", "label": "Applied"},
                                        {"id": "screen", "label": "Screen"},
                                        {"id": "interview", "label": "Interview"},
                                        {"id": "offer", "label": "Offer"},
                                        {"id": "hired", "label": "Hired"},
                                    ],
                                }
                            ],
                        },
                    }
                ],
                "planner_state": {"intent": "create_module", "module_name": "Candidate Pipeline"},
            },
            {},
        )

        self.assertIn("Applied", plan_text)
        self.assertIn("Interview", plan_text)
        self.assertIn("Hired", plan_text)

    def test_create_module_preview_mentions_fields_buttons_and_pages(self) -> None:
        plan_text = _ai_plan_assistant_text(
            {
                "required_questions": ["Confirm this plan?"],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": [],
                "risk_flags": [],
                "advisories": [],
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "software_delivery"}],
                "proposed_changes": [
                    {
                        "op": "create_module",
                        "artifact_id": "software_delivery",
                        "manifest": {
                            "module": {"name": "Software Delivery"},
                            "entities": [
                                {
                                    "id": "entity.software_delivery",
                                    "label": "Software Delivery",
                                    "fields": [
                                        {"id": "software_delivery.id", "label": "ID", "type": "uuid"},
                                        {"id": "software_delivery.name", "label": "Work Item", "type": "string"},
                                        {"id": "software_delivery.status", "label": "Status", "type": "enum"},
                                        {"id": "software_delivery.client_name", "label": "Client", "type": "string"},
                                        {"id": "software_delivery.project_name", "label": "Project", "type": "string"},
                                        {"id": "software_delivery.estimate_hours", "label": "Estimate Hours", "type": "number"},
                                    ],
                                }
                            ],
                            "views": [
                                {"id": "software_delivery.list", "kind": "list"},
                                {"id": "software_delivery.form", "kind": "form"},
                                {"id": "software_delivery.kanban", "kind": "kanban"},
                                {"id": "software_delivery.calendar", "kind": "calendar"},
                            ],
                            "pages": [
                                {"id": "software_delivery.list_page", "title": "Software Delivery"},
                                {"id": "software_delivery.form_page", "title": "Software Delivery Record"},
                                {"id": "software_delivery.calendar_page", "title": "Software Delivery Calendar"},
                            ],
                            "workflows": [
                                {
                                    "id": "workflow.software_delivery_status",
                                    "states": [
                                        {"id": "scoped", "label": "Scoped"},
                                        {"id": "ready", "label": "Ready"},
                                        {"id": "in_progress", "label": "In Progress"},
                                        {"id": "done", "label": "Done"},
                                    ],
                                }
                            ],
                            "actions": [
                                {"id": "action.software_delivery_start", "kind": "update_record", "label": "Start"},
                                {"id": "action.software_delivery_complete", "kind": "update_record", "label": "Complete"},
                            ],
                        },
                    }
                ],
                "planner_state": {"intent": "create_module", "module_name": "Software Delivery"},
            },
            {},
        )

        self.assertIn("Client", plan_text)
        self.assertIn("Project", plan_text)
        self.assertIn("Estimate Hours", plan_text)
        self.assertIn("Start", plan_text)
        self.assertIn("Complete", plan_text)
        self.assertIn("Software Delivery Calendar", plan_text)

    def test_multi_request_create_module_bundle_keeps_new_module_scope(self) -> None:
        plan = _ai_slot_based_plan(
            "Create a new module called Vendor Compliance. Add an Escalation Owner field to that module.",
            [],
            {},
            answer_hints=None,
        )

        self.assertIsNotNone(plan)
        self.assertEqual(plan.get("questions"), [])
        self.assertEqual(plan.get("affected_modules"), ["vendor_compliance"])
        create_ops = [op for op in (plan.get("candidate_ops") or []) if op.get("op") == "create_module"]
        add_ops = [op for op in (plan.get("candidate_ops") or []) if op.get("op") == "add_field"]
        self.assertEqual(len(create_ops), 1)
        self.assertEqual(len(add_ops), 1)
        self.assertEqual(add_ops[0].get("artifact_id"), "vendor_compliance")
        self.assertEqual(add_ops[0].get("field", {}).get("label"), "Escalation Owner")

    def test_plan_from_message_supports_create_module_then_follow_up_edit(self) -> None:
        with patch.object(main, "_ai_build_workspace_graph", lambda _request: {}), patch.object(main, "_ai_module_manifest_index", lambda _request: {}):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                "Create a new module called Vendor Compliance. Add an Escalation Owner field to that module.",
                answer_hints={},
            )

        self.assertEqual(derived.get("affected_modules"), ["vendor_compliance"])
        self.assertEqual([item.get("artifact_id") for item in (plan.get("affected_artifacts") or [])], ["vendor_compliance"])
        self.assertEqual((plan.get("required_question_meta") or {}).get("id"), "confirm_plan")
        op_names = [op.get("op") for op in (plan.get("candidate_operations") or [])]
        self.assertIn("create_module", op_names)
        self.assertIn("add_field", op_names)

    def test_follow_up_tab_request_keeps_pending_new_module_scope(self) -> None:
        pending_manifest = {
            "module": {"id": "cooking", "name": "Cooking"},
            "entities": [{"id": "entity.recipe", "display_field": "recipe.name", "fields": []}],
            "views": [{"id": "recipe.form", "kind": "form", "entity": "entity.recipe", "sections": []}],
        }
        answer_hints = {
            "pending_candidate_ops": [
                {"op": "create_module", "artifact_id": "cooking", "manifest": pending_manifest}
            ],
            "pending_affected_modules": ["cooking"],
            "module_target": "cooking",
        }
        plan = _ai_slot_based_plan(
            "add an Ingredients tab, and we can add item lists as ingredients",
            ["cooking"],
            {
                "cooking": {
                    "manifest": pending_manifest,
                    "module": {"module_id": "cooking", "name": "Cooking", "current_hash": None},
                }
            },
            answer_hints=answer_hints,
        )

        self.assertIsNotNone(plan)
        self.assertEqual(plan.get("affected_modules"), ["cooking"])
        op_artifacts = [op.get("artifact_id") for op in (plan.get("candidate_ops") or []) if isinstance(op, dict)]
        self.assertTrue(op_artifacts)
        self.assertTrue(all(item == "cooking" for item in op_artifacts))

    def test_follow_up_workflow_action_request_keeps_pending_new_module_scope(self) -> None:
        pending_manifest = {
            "module": {"id": "cooking", "name": "Cooking"},
            "entities": [
                {
                    "id": "entity.recipe",
                    "display_field": "recipe.name",
                    "fields": [
                        {"id": "recipe.name", "label": "Recipe Name", "type": "string"},
                        {
                            "id": "recipe.status",
                            "label": "Status",
                            "type": "enum",
                            "options": [
                                {"label": "Draft", "value": "draft"},
                                {"label": "Ready To Cook", "value": "ready_to_cook"},
                                {"label": "Cooked", "value": "cooked"},
                            ],
                        },
                    ],
                }
            ],
            "views": [{"id": "recipe.form", "kind": "form", "entity": "entity.recipe", "sections": []}],
            "workflows": [
                {
                    "id": "workflow.recipe_status",
                    "entity": "entity.recipe",
                    "status_field": "recipe.status",
                    "states": [
                        {"id": "draft", "label": "Draft", "order": 1},
                        {"id": "ready_to_cook", "label": "Ready To Cook", "order": 2},
                        {"id": "cooked", "label": "Cooked", "order": 3},
                    ],
                    "transitions": [
                        {"from": "draft", "to": "ready_to_cook", "label": "Ready To Cook"},
                        {"from": "ready_to_cook", "to": "cooked", "label": "Cooked"},
                    ],
                }
            ],
            "actions": [],
        }
        answer_hints = {
            "pending_candidate_ops": [
                {"op": "create_module", "artifact_id": "cooking", "manifest": pending_manifest}
            ],
            "pending_affected_modules": ["cooking"],
            "module_target": "cooking",
        }
        plan = _ai_slot_based_plan(
            "can you add action buttons so we can change status etc",
            ["cooking"],
            {
                "cooking": {
                    "manifest": pending_manifest,
                    "module": {"module_id": "cooking", "name": "Cooking", "current_hash": None},
                }
            },
            answer_hints=answer_hints,
        )

        self.assertIsNotNone(plan)
        self.assertEqual(plan.get("affected_modules"), ["cooking"])
        op_names = [op.get("op") for op in (plan.get("candidate_ops") or []) if isinstance(op, dict)]
        self.assertIn("add_action", op_names)
        self.assertIn("update_view", op_names)
        self.assertTrue(all(op.get("artifact_id") == "cooking" for op in (plan.get("candidate_ops") or []) if isinstance(op, dict)))

    def test_plan_text_humanizes_new_module_follow_up_changes(self) -> None:
        text = _ai_plan_assistant_text(
            {
                "required_questions": ["Confirm this plan?"],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": [],
                "risk_flags": [],
                "advisories": [],
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "vendor_compliance"}],
                "proposed_changes": [
                    {
                        "op": "create_module",
                        "artifact_type": "module",
                        "artifact_id": "vendor_compliance",
                        "manifest": {
                            "module": {"id": "vendor_compliance", "name": "Vendor Compliance"},
                            "entities": [{"id": "entity.vendor_compliance", "label": "Vendor Compliance"}],
                            "views": [{"id": "vendor_compliance.list", "kind": "list"}],
                        },
                    },
                    {
                        "op": "add_field",
                        "artifact_type": "module",
                        "artifact_id": "vendor_compliance",
                        "field": {"id": "vendor_compliance.escalation_owner", "label": "Escalation Owner", "type": "string"},
                    },
                ],
                "planner_state": {"intent": "multi_request"},
            },
            {},
        )

        self.assertIn("Create module 'Vendor Compliance'.", text)
        self.assertIn("Add field 'Escalation Owner' (string) in Vendor Compliance.", text)
        self.assertNotIn("vendor_compliance", text)

    def test_latest_plan_selection_prefers_session_pointer(self) -> None:
        session = _ai_create_record(
            _AI_ENTITY_SESSION,
            {
                "status": "planning",
                "summary": "",
                "last_activity_at": "2026-03-18T00:00:00Z",
            },
        )
        session_id = _ai_record_data(session)["id"]
        first_plan = _ai_create_record(
            _AI_ENTITY_PLAN,
            {
                "session_id": session_id,
                "created_at": "2026-03-18T00:01:00Z",
                "questions_json": ["Which module should receive this change?"],
                "plan_json": {"plan": {"required_questions": ["Which module should receive this change?"]}},
            },
        )
        second_plan = _ai_create_record(
            _AI_ENTITY_PLAN,
            {
                "session_id": session_id,
                "created_at": "2026-03-18T00:00:00Z",
                "questions_json": [],
                "plan_json": {"plan": {"required_questions": [], "resolved_without_changes": True}},
            },
        )
        second_plan_id = _ai_record_data(second_plan)["id"]
        _ai_update_record(_AI_ENTITY_SESSION, session_id, {"latest_plan_id": second_plan_id})

        latest = _ai_latest_plan_for_session(session_id)

        self.assertIsNotNone(latest)
        self.assertEqual(latest.get("id"), second_plan_id)
        self.assertNotEqual(latest.get("id"), _ai_record_data(first_plan)["id"])

    def test_collect_answer_hints_keeps_single_module_scope_across_fresh_chat(self) -> None:
        session = _ai_create_record(
            _AI_ENTITY_SESSION,
            {
                "status": "planning",
                "summary": "",
                "last_activity_at": "2026-03-18T00:00:00Z",
            },
        )
        session_id = _ai_record_data(session)["id"]
        plan = _ai_create_record(
            _AI_ENTITY_PLAN,
            {
                "session_id": session_id,
                "created_at": "2026-03-18T00:00:00Z",
                "affected_artifacts_json": [{"artifact_type": "module", "artifact_id": "contacts"}],
                "plan_json": {"plan": {"planner_state": {"intent": "add_field", "field_label": "Birthday"}}},
            },
        )
        _ai_update_record(_AI_ENTITY_SESSION, session_id, {"latest_plan_id": _ai_record_data(plan)["id"]})
        _ai_create_record(
            _AI_ENTITY_MESSAGE,
            {
                "session_id": session_id,
                "role": "user",
                "message_type": "chat",
                "body": "Also add status.",
                "created_at": "2026-03-18T00:01:00Z",
            },
        )

        hints = _ai_collect_answer_hints(session_id)

        self.assertEqual(hints.get("module_target"), "contacts")
        self.assertEqual(hints.get("planner_intent"), "add_field")
        self.assertEqual(hints.get("field_label"), "Birthday")

    def test_collect_answer_hints_prefers_latest_answer_text_after_new_chat(self) -> None:
        session = _ai_create_record(
            _AI_ENTITY_SESSION,
            {
                "status": "planning",
                "summary": "",
                "last_activity_at": "2026-03-18T00:00:00Z",
            },
        )
        session_id = _ai_record_data(session)["id"]
        _ai_create_record(
            _AI_ENTITY_MESSAGE,
            {
                "session_id": session_id,
                "role": "user",
                "message_type": "chat",
                "body": "Add a field to Contacts.",
                "created_at": "2026-03-18T00:00:00Z",
            },
        )
        _ai_create_record(
            _AI_ENTITY_MESSAGE,
            {
                "session_id": session_id,
                "role": "user",
                "message_type": "answer",
                "question_id": "field_spec",
                "body": "Birthday",
                "answer_json": {"field_label": "Birthday", "answer_text": "Birthday"},
                "created_at": "2026-03-18T00:01:00Z",
            },
        )
        _ai_create_record(
            _AI_ENTITY_MESSAGE,
            {
                "session_id": session_id,
                "role": "user",
                "message_type": "answer",
                "question_id": "confirm_plan",
                "body": "Actually add Status in Jobs instead.",
                "answer_json": {"answer_text": "Actually add Status in Jobs instead.", "module_target": "jobs"},
                "created_at": "2026-03-18T00:02:00Z",
            },
        )

        hints = _ai_collect_answer_hints(session_id)

        self.assertEqual(hints.get("answer_text"), "Actually add Status in Jobs instead.")
        self.assertEqual(hints.get("module_target"), "jobs")

    def test_collect_answer_hints_humanizes_field_ids_from_latest_plan(self) -> None:
        session = _ai_create_record(
            _AI_ENTITY_SESSION,
            {
                "status": "planning",
                "summary": "",
                "last_activity_at": "2026-03-18T00:00:00Z",
            },
        )
        session_id = _ai_record_data(session)["id"]
        plan = _ai_create_record(
            _AI_ENTITY_PLAN,
            {
                "session_id": session_id,
                "created_at": "2026-03-18T00:00:00Z",
                "affected_artifacts_json": [{"artifact_type": "module", "artifact_id": "contacts"}],
                "plan_json": {"plan": {"planner_state": {"intent": "move_form_field", "field_ref": "contact.birthday"}}},
            },
        )
        _ai_update_record(_AI_ENTITY_SESSION, session_id, {"latest_plan_id": _ai_record_data(plan)["id"]})

        hints = _ai_collect_answer_hints(session_id)

        self.assertEqual(hints.get("field_id"), "contact.birthday")
        self.assertEqual(hints.get("field_label"), "Birthday")

    def test_collect_answer_hints_keeps_pending_plan_context_for_tab_follow_ups(self) -> None:
        session = _ai_create_record(
            _AI_ENTITY_SESSION,
            {
                "status": "waiting_input",
                "summary": "",
                "last_activity_at": "2026-03-18T00:00:00Z",
            },
        )
        session_id = _ai_record_data(session)["id"]
        plan = _ai_create_record(
            _AI_ENTITY_PLAN,
            {
                "session_id": session_id,
                "created_at": "2026-03-18T00:00:00Z",
                "affected_artifacts_json": [{"artifact_type": "module", "artifact_id": "contacts"}],
                "plan_json": {
                    "plan": {
                        "candidate_operations": [
                            {
                                "op": "update_view",
                                "artifact_type": "module",
                                "artifact_id": "contacts",
                                "view_id": "contact.form",
                                "tab_label": "Master",
                                "changes": {"sections": [{"id": "master", "title": "Master", "fields": []}]},
                            }
                        ],
                        "planner_state": {
                            "intent": "add_form_tab",
                            "module_id": "contacts",
                            "tab_label": "Master",
                            "planned_section_id": "master",
                            "view_id": "contact.form",
                        },
                    }
                },
            },
        )
        _ai_update_record(_AI_ENTITY_SESSION, session_id, {"latest_plan_id": _ai_record_data(plan)["id"]})

        hints = _ai_collect_answer_hints(session_id)

        self.assertEqual(hints.get("module_target"), "contacts")
        self.assertEqual(hints.get("tab_target"), "Master")
        self.assertEqual(hints.get("planned_section_id"), "master")
        self.assertEqual(hints.get("planned_view_id"), "contact.form")
        self.assertEqual(len(hints.get("pending_candidate_ops") or []), 1)

    def test_merge_followup_candidate_ops_keeps_prior_draft_for_additive_chat(self) -> None:
        module_index = {
            "contacts": {"manifest": {"module": {"id": "contacts", "name": "Contacts"}}},
        }

        merged_ops, merged_modules, merged_assumptions = _ai_merge_followup_candidate_ops(
            "Also put Master Notes in that tab.",
            {"status": "waiting_input"},
            {
                "pending_candidate_ops": [
                    {
                        "op": "update_view",
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "view_id": "contact.form",
                        "tab_label": "Master",
                        "changes": {"sections": [{"id": "master", "title": "Master", "fields": []}]},
                    }
                ],
                "pending_affected_modules": ["contacts"],
            },
            module_index,
            [
                {
                    "op": "add_field",
                    "artifact_type": "module",
                    "artifact_id": "contacts",
                    "entity_id": "entity.contact",
                    "field": {"id": "contact.master_notes", "label": "Master Notes", "type": "text"},
                },
                {
                    "op": "insert_section_field",
                    "artifact_type": "module",
                    "artifact_id": "contacts",
                    "view_id": "contact.form",
                    "section_id": "master",
                    "field_id": "contact.master_notes",
                    "index": 0,
                },
            ],
            ["contacts"],
            [],
        )

        self.assertEqual([op.get("op") for op in merged_ops], ["update_view", "add_field", "insert_section_field"])
        self.assertEqual(merged_modules, ["contacts"])
        self.assertIn("Kept the earlier draft plan and added this follow-up request to it.", merged_assumptions)

    def test_merge_followup_candidate_ops_keeps_prior_draft_for_add_another_chat(self) -> None:
        module_index = {
            "contacts": {"manifest": {"module": {"id": "contacts", "name": "Contacts"}}},
        }

        merged_ops, merged_modules, merged_assumptions = _ai_merge_followup_candidate_ops(
            "Add another field called Priority.",
            {"status": "waiting_input"},
            {
                "pending_candidate_ops": [
                    {
                        "op": "add_field",
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "entity_id": "entity.contact",
                        "field": {"id": "contact.status", "label": "Status", "type": "string"},
                    }
                ],
                "pending_affected_modules": ["contacts"],
            },
            module_index,
            [
                {
                    "op": "add_field",
                    "artifact_type": "module",
                    "artifact_id": "contacts",
                    "entity_id": "entity.contact",
                    "field": {"id": "contact.priority", "label": "Priority", "type": "string"},
                }
            ],
            ["contacts"],
            [],
        )

        self.assertEqual([op.get("field", {}).get("label") for op in merged_ops], ["Status", "Priority"])
        self.assertEqual(merged_modules, ["contacts"])
        self.assertIn("Kept the earlier draft plan and added this follow-up request to it.", merged_assumptions)

    def test_merge_followup_candidate_ops_extends_to_new_module_when_followup_is_additive(self) -> None:
        module_index = {
            "contacts": {"manifest": {"module": {"id": "contacts", "name": "Contacts"}}},
            "jobs": {"manifest": {"module": {"id": "jobs", "name": "Jobs"}}},
        }

        merged_ops, merged_modules, merged_assumptions = _ai_merge_followup_candidate_ops(
            "Also add Preferred Technician in Jobs.",
            {"status": "waiting_input"},
            {
                "pending_candidate_ops": [
                    {
                        "op": "add_field",
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "entity_id": "entity.contact",
                        "field": {"id": "contact.customer_tier", "label": "Customer Tier", "type": "string"},
                    }
                ],
                "pending_affected_modules": ["contacts"],
            },
            module_index,
            [
                {
                    "op": "add_field",
                    "artifact_type": "module",
                    "artifact_id": "jobs",
                    "entity_id": "entity.job",
                    "field": {"id": "job.preferred_technician", "label": "Preferred Technician", "type": "string"},
                }
            ],
            ["jobs"],
            [],
        )

        self.assertEqual([op.get("artifact_id") for op in merged_ops], ["contacts", "jobs"])
        self.assertEqual(merged_modules, ["contacts", "jobs"])
        self.assertIn("Kept the earlier draft plan and added this follow-up request to it.", merged_assumptions)

    def test_merge_followup_candidate_ops_extends_to_new_module_when_followup_uses_next_scope_switch(self) -> None:
        module_index = {
            "contacts": {"manifest": {"module": {"id": "contacts", "name": "Contacts"}}},
            "jobs": {"manifest": {"module": {"id": "jobs", "name": "Jobs"}}},
        }

        merged_ops, merged_modules, merged_assumptions = _ai_merge_followup_candidate_ops(
            "Next, in Jobs add Preferred Technician.",
            {"status": "waiting_input"},
            {
                "pending_candidate_ops": [
                    {
                        "op": "add_field",
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "entity_id": "entity.contact",
                        "field": {"id": "contact.customer_tier", "label": "Customer Tier", "type": "string"},
                    }
                ],
                "pending_affected_modules": ["contacts"],
            },
            module_index,
            [
                {
                    "op": "add_field",
                    "artifact_type": "module",
                    "artifact_id": "jobs",
                    "entity_id": "entity.job",
                    "field": {"id": "job.preferred_technician", "label": "Preferred Technician", "type": "string"},
                }
            ],
            ["jobs"],
            [],
        )

        self.assertEqual([op.get("artifact_id") for op in merged_ops], ["contacts", "jobs"])
        self.assertEqual(merged_modules, ["contacts", "jobs"])
        self.assertIn("Kept the earlier draft plan and added this follow-up request to it.", merged_assumptions)

    def test_confirm_plan_answer_can_restart_request_on_scope_switch(self) -> None:
        module_index = {
            "contacts": {"manifest": {"module": {"id": "contacts", "name": "Contacts"}}},
            "jobs": {"manifest": {"module": {"id": "jobs", "name": "Jobs"}}},
        }

        self.assertTrue(_ai_answer_restarts_request("confirm_plan", "Actually add Status in Jobs instead.", module_index))
        self.assertTrue(_ai_answer_restarts_request("field_spec", "Actually add Status in Jobs instead.", module_index))
        self.assertTrue(_ai_answer_restarts_request("field_spec", "Use Jobs instead.", module_index))
        self.assertFalse(_ai_answer_restarts_request("confirm_plan", "Approved.", module_index))
        self.assertFalse(_ai_answer_restarts_request("field_spec", "Put it in Jobs.", module_index))
        self.assertFalse(_ai_answer_restarts_request("field_spec", "Please call it Birthday.", module_index))
        self.assertFalse(_ai_answer_restarts_request("field_target", "Jobs", module_index))

    def test_revision_detector_catches_approval_with_extra_change_request(self) -> None:
        module_index = {
            "contacts": {"manifest": {"module": {"id": "contacts", "name": "Contacts"}}},
            "jobs": {"manifest": {"module": {"id": "jobs", "name": "Jobs"}}},
        }

        self.assertTrue(_ai_text_includes_revision_request("Looks right, but also add Priority in Contacts.", module_index))
        self.assertTrue(_ai_text_includes_revision_request("Approved, and remove the legacy field too.", module_index))
        self.assertFalse(_ai_text_includes_revision_request("Looks right, generate the draft patchset.", module_index))

    def test_slot_plan_prefers_latest_answer_scope_over_stale_prompt(self) -> None:
        contacts_manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [{"id": "entity.contact", "fields": [{"id": "contact.name", "label": "Name", "type": "string"}]}],
            "views": [],
        }
        jobs_manifest = {
            "module": {"id": "jobs", "key": "jobs", "name": "Jobs"},
            "entities": [{"id": "entity.job", "fields": [{"id": "job.title", "label": "Title", "type": "string"}]}],
            "views": [],
        }
        module_index = {"contacts": {"manifest": contacts_manifest}, "jobs": {"manifest": jobs_manifest}}

        plan = _ai_slot_based_plan(
            "Add a Status field to the Contacts module.",
            ["contacts", "jobs"],
            module_index,
            answer_hints={
                "answer_text": "Actually add Status in Jobs instead.",
                "module_target": "jobs",
                "field_label": "Status",
                "field_type": "string",
            },
        )

        self.assertEqual(plan.get("questions"), [])
        add_ops = [op for op in plan.get("candidate_ops", []) if op.get("op") == "add_field"]
        self.assertEqual(len(add_ops), 1)
        self.assertEqual(add_ops[0].get("artifact_id"), "jobs")
        self.assertEqual(add_ops[0].get("field", {}).get("label"), "Status")

    def test_slot_plan_prefers_short_scope_switch_answer_over_original_prompt(self) -> None:
        contacts_manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [{"id": "entity.contact", "fields": [{"id": "contact.name", "label": "Name", "type": "string"}]}],
            "views": [],
        }
        jobs_manifest = {
            "module": {"id": "jobs", "key": "jobs", "name": "Jobs"},
            "entities": [{"id": "entity.job", "fields": [{"id": "job.title", "label": "Title", "type": "string"}]}],
            "views": [],
        }
        module_index = {"contacts": {"manifest": contacts_manifest}, "jobs": {"manifest": jobs_manifest}}

        plan = _ai_slot_based_plan(
            "Add a Status field to the Contacts module.",
            ["contacts", "jobs"],
            module_index,
            answer_hints={
                "answer_text": "Use Jobs.",
                "module_target": "jobs",
                "field_label": "Status",
                "field_type": "string",
            },
        )

        self.assertEqual(plan.get("questions"), [])
        add_ops = [op for op in plan.get("candidate_ops", []) if op.get("op") == "add_field"]
        self.assertEqual(len(add_ops), 1)
        self.assertEqual(add_ops[0].get("artifact_id"), "jobs")
        self.assertEqual(add_ops[0].get("field", {}).get("label"), "Status")

    def test_plan_from_message_prefers_explicit_module_over_stale_answer_scope(self) -> None:
        contacts_manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [{"id": "entity.contact", "fields": [{"id": "contact.name", "label": "Name", "type": "string"}]}],
            "views": [],
        }
        jobs_manifest = {
            "module": {"id": "jobs", "key": "jobs", "name": "Jobs"},
            "entities": [{"id": "entity.job", "fields": [{"id": "job.title", "label": "Title", "type": "string"}]}],
            "views": [],
        }
        module_index = {"contacts": {"manifest": contacts_manifest}, "jobs": {"manifest": jobs_manifest}}

        with patch.object(main, "_ai_build_workspace_graph", lambda _request: {}), patch.object(main, "_ai_module_manifest_index", lambda _request: module_index):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                "Add a Status field to the Contacts module.",
                answer_hints={
                    "answer_text": "Put it in Jobs.",
                    "module_target": "jobs",
                    "field_label": "Status",
                    "field_type": "string",
                },
            )

        self.assertEqual([item.get("artifact_id") for item in (plan.get("affected_artifacts") or [])], ["contacts"])
        self.assertEqual(derived.get("affected_modules"), ["contacts"])
        self.assertEqual((plan.get("planner_state") or {}).get("intent"), "add_field")
        self.assertNotIn("Jobs", " ".join(plan.get("required_questions") or []))

    def test_plan_from_message_prefers_short_scope_switch_answer_over_original_prompt(self) -> None:
        contacts_manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [{"id": "entity.contact", "fields": [{"id": "contact.name", "label": "Name", "type": "string"}]}],
            "views": [],
        }
        jobs_manifest = {
            "module": {"id": "jobs", "key": "jobs", "name": "Jobs"},
            "entities": [{"id": "entity.job", "fields": [{"id": "job.title", "label": "Title", "type": "string"}]}],
            "views": [],
        }
        module_index = {"contacts": {"manifest": contacts_manifest}, "jobs": {"manifest": jobs_manifest}}

        with patch.object(main, "_ai_build_workspace_graph", lambda _request: {}), patch.object(main, "_ai_module_manifest_index", lambda _request: module_index):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                "Add a Status field to the Contacts module.",
                answer_hints={
                    "answer_text": "Use Jobs.",
                    "module_target": "jobs",
                    "field_label": "Status",
                    "field_type": "string",
                },
            )

        self.assertEqual([item.get("artifact_id") for item in (plan.get("affected_artifacts") or [])], ["jobs"])
        self.assertEqual(derived.get("affected_modules"), ["jobs"])
        self.assertEqual((plan.get("planner_state") or {}).get("intent"), "add_field")
        add_ops = [op for op in (plan.get("candidate_operations") or []) if isinstance(op, dict) and op.get("op") == "add_field"]
        self.assertEqual(len(add_ops), 1)
        self.assertEqual(add_ops[0].get("artifact_id"), "jobs")

    def test_plan_from_message_inherits_single_module_scope_for_additive_followup(self) -> None:
        crm_manifest = {
            "module": {"id": "crm", "key": "crm", "name": "CRM"},
            "entities": [{"id": "entity.crm", "fields": [{"id": "crm.name", "label": "Name", "type": "string"}]}],
            "views": [],
        }
        contacts_manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [{"id": "entity.contact", "fields": [{"id": "contact.name", "label": "Name", "type": "string"}]}],
            "views": [],
        }
        module_index = {"crm": {"manifest": crm_manifest}, "contacts": {"manifest": contacts_manifest}}

        with patch.object(main, "_ai_build_workspace_graph", lambda _request: {}), patch.object(main, "_ai_module_manifest_index", lambda _request: module_index):
            plan, derived = _ai_plan_from_message(
                SimpleNamespace(state=SimpleNamespace(actor={})),
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": "", "status": "planning"},
                'can you also add another field in the Extra Info tab called Plaster?',
                answer_hints={
                    "pending_affected_modules": ["crm"],
                    "pending_candidate_ops": [
                        {
                            "op": "add_field",
                            "artifact_type": "module",
                            "artifact_id": "crm",
                            "entity_id": "entity.crm",
                            "field": {"id": "crm.revenge", "label": "Revenge", "type": "string"},
                        }
                    ],
                    "module_target": "crm",
                },
            )

        self.assertEqual([item.get("artifact_id") for item in (plan.get("affected_artifacts") or [])], ["crm"])
        self.assertEqual(derived.get("affected_modules"), ["crm"])
        self.assertNotEqual((plan.get("planner_state") or {}).get("intent"), "preview_only_plan")
        add_field_ops = [op for op in (plan.get("candidate_operations") or []) if isinstance(op, dict) and op.get("op") == "add_field"]
        self.assertEqual(len(add_field_ops), 2)
        self.assertEqual({(op.get("field") or {}).get("label") for op in add_field_ops}, {"Revenge", "Plaster"})
        self.assertNotEqual((plan.get("planner_state") or {}).get("intent"), "preview_only_plan")

    def test_plan_from_message_followup_ignores_prior_answer_text_noise_when_extending_request(self) -> None:
        crm_manifest = {
            "module": {"id": "crm", "key": "crm", "name": "CRM"},
            "entities": [{"id": "entity.crm", "fields": [{"id": "crm.name", "label": "Name", "type": "string"}]}],
            "views": [],
        }
        module_index = {"crm": {"manifest": crm_manifest}}

        with patch.object(main, "_ai_build_workspace_graph", lambda _request: {}), patch.object(main, "_ai_module_manifest_index", lambda _request: module_index), patch.object(main, "USE_AI", False):
            plan, derived = _ai_plan_from_message(
                SimpleNamespace(state=SimpleNamespace(actor={})),
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": "", "status": "applied"},
                'can you also add another field in the Extra Info tab called Plaster?',
                answer_hints={
                    "pending_affected_modules": ["crm"],
                    "pending_candidate_ops": [
                        {
                            "op": "add_field",
                            "artifact_type": "module",
                            "artifact_id": "crm",
                            "entity_id": "entity.crm",
                            "field": {"id": "crm.revenge", "label": "Revenge", "type": "string"},
                        }
                    ],
                    "module_target": "crm",
                    "answer_text": "Plan approved. Ready for sandbox: Add a new field 'Revenge' to CRM and place it in the 'Extra Info' tab. Prepared revision: - Add field 'revenge' (string) in CRM. - Place field 'Revenge' in the 'Extra Info' tab in CRM. Next step: Apply to Sandbox.",
                },
            )

        self.assertEqual(derived.get("affected_modules"), ["crm"])
        self.assertNotEqual((plan.get("planner_state") or {}).get("intent"), "preview_only_plan")
        add_field_ops = [op for op in (plan.get("candidate_operations") or []) if isinstance(op, dict) and op.get("op") == "add_field"]
        self.assertEqual(len(add_field_ops), 1)
        self.assertEqual((add_field_ops[0].get("field") or {}).get("label"), "Plaster")

    def test_plan_from_message_remove_followup_uses_applied_revision_field_context(self) -> None:
        crm_manifest = {
            "module": {"id": "crm", "key": "crm", "name": "CRM"},
            "entities": [{"id": "entity.crm", "fields": [{"id": "crm.name", "label": "Name", "type": "string"}]}],
            "views": [],
        }
        module_index = {"crm": {"manifest": crm_manifest}}

        with patch.object(main, "_ai_build_workspace_graph", lambda _request: {}), patch.object(main, "_ai_module_manifest_index", lambda _request: module_index), patch.object(main, "USE_AI", False):
            plan, derived = _ai_plan_from_message(
                SimpleNamespace(state=SimpleNamespace(actor={})),
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": "", "status": "applied"},
                "can you now remove the revenge field?",
                answer_hints={
                    "pending_affected_modules": ["crm"],
                    "module_target": "crm",
                    "applied_candidate_ops": [
                        {
                            "op": "add_field",
                            "artifact_type": "module",
                            "artifact_id": "crm",
                            "entity_id": "entity.crm",
                            "field": {"id": "crm.revenge", "label": "Revenge", "type": "string"},
                        },
                        {
                            "op": "insert_section_field",
                            "artifact_type": "module",
                            "artifact_id": "crm",
                            "view_id": "crm.form",
                            "field_id": "crm.revenge",
                            "placement_label": "Extra Info",
                        },
                    ],
                },
            )

        self.assertEqual(derived.get("affected_modules"), ["crm"])
        self.assertEqual((plan.get("required_questions") or []), ["Confirm this plan?"])
        self.assertEqual(((plan.get("required_question_meta") or {}).get("kind")), "confirm_plan")
        remove_ops = [op for op in (plan.get("candidate_operations") or []) if isinstance(op, dict) and op.get("op") == "remove_field"]
        self.assertEqual(len(remove_ops), 1)
        self.assertEqual(remove_ops[0].get("field_id"), "crm.revenge")

    def test_plan_from_message_same_tab_followup_stays_in_current_module(self) -> None:
        crm_manifest = {
            "module": {"id": "crm", "key": "crm", "name": "CRM"},
            "entities": [{"id": "entity.crm", "fields": [{"id": "crm.name", "label": "Name", "type": "string"}]}],
            "views": [],
        }
        contacts_manifest = {
            "module": {"id": "module_27052f", "key": "contacts", "name": "Contacts"},
            "entities": [{"id": "entity.contact", "fields": [{"id": "contact.name", "label": "Name", "type": "string"}]}],
            "views": [],
        }
        module_index = {"crm": {"manifest": crm_manifest}, "module_27052f": {"manifest": contacts_manifest}}

        with patch.object(main, "_ai_build_workspace_graph", lambda _request: {}), patch.object(main, "_ai_module_manifest_index", lambda _request: module_index), patch.object(main, "USE_AI", False):
            plan, derived = _ai_plan_from_message(
                SimpleNamespace(state=SimpleNamespace(actor={})),
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": "", "status": "applied"},
                "can you add another field in the same tab called Pluto",
                answer_hints={
                    "pending_affected_modules": ["crm"],
                    "module_target": "crm",
                    "tab_target": "Extra Info",
                    "applied_candidate_ops": [
                        {
                            "op": "add_field",
                            "artifact_type": "module",
                            "artifact_id": "crm",
                            "entity_id": "entity.crm",
                            "field": {"id": "crm.revenge", "label": "Revenge", "type": "string"},
                        },
                        {
                            "op": "insert_section_field",
                            "artifact_type": "module",
                            "artifact_id": "crm",
                            "view_id": "crm.form",
                            "field_id": "crm.revenge",
                            "placement_label": "Extra Info",
                        },
                    ],
                },
            )

        self.assertEqual(derived.get("affected_modules"), ["crm"])
        self.assertNotIn("module_27052f", derived.get("affected_modules") or [])
        add_field_ops = [op for op in (plan.get("candidate_operations") or []) if isinstance(op, dict) and op.get("op") == "add_field"]
        self.assertEqual(len(add_field_ops), 1)
        self.assertEqual((add_field_ops[0].get("field") or {}).get("label"), "Pluto")

    def test_plan_from_message_rename_followup_stays_in_current_module(self) -> None:
        contacts_manifest = {
            "module": {"id": "module_27052f", "key": "contacts", "name": "Contacts"},
            "entities": [
                {
                    "id": "entity.contact",
                    "fields": [
                        {"id": "contact.name", "label": "Name", "type": "string"},
                        {"id": "contact.trade_role", "label": "Trade Role", "type": "string"},
                    ],
                }
            ],
            "views": [],
        }
        module_index = {"module_27052f": {"manifest": contacts_manifest}}

        with patch.object(main, "_ai_build_workspace_graph", lambda _request: {}), patch.object(main, "_ai_module_manifest_index", lambda _request: module_index), patch.object(main, "USE_AI", False):
            plan, derived = _ai_plan_from_message(
                SimpleNamespace(state=SimpleNamespace(actor={})),
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": "", "status": "applied"},
                "now rename trade role to public trade role",
                answer_hints={
                    "pending_affected_modules": ["module_27052f"],
                    "module_target": "module_27052f",
                    "field_id": "contact.trade_role",
                    "field_label": "Trade Role",
                    "applied_candidate_ops": [
                        {
                            "op": "add_field",
                            "artifact_type": "module",
                            "artifact_id": "module_27052f",
                            "entity_id": "entity.contact",
                            "field": {"id": "contact.trade_role", "label": "Trade Role", "type": "string"},
                        }
                    ],
                },
            )

        self.assertEqual(derived.get("affected_modules"), ["module_27052f"])
        self.assertEqual(plan.get("required_questions"), ["Confirm this plan?"])
        update_ops = [op for op in (plan.get("candidate_operations") or []) if isinstance(op, dict) and op.get("op") == "update_field"]
        self.assertEqual(len(update_ops), 1)
        self.assertEqual(update_ops[0].get("field_id"), "contact.trade_role")
        self.assertEqual((update_ops[0].get("changes") or {}).get("label"), "Public Trade Role")

    def test_plan_from_message_prefers_heuristic_rename_ops_over_vague_semantic_question(self) -> None:
        contacts_manifest = {
            "module": {"id": "module_27052f", "key": "contacts", "name": "Contacts"},
            "entities": [
                {
                    "id": "entity.contact",
                    "fields": [
                        {"id": "contact.trade_role", "label": "Trade Role", "type": "string"},
                    ],
                }
            ],
            "views": [],
        }
        module_index = {"module_27052f": {"manifest": contacts_manifest}}

        with patch.object(main, "_ai_build_workspace_graph", lambda _request: {}), patch.object(main, "_ai_module_manifest_index", lambda _request: module_index), patch.object(main, "_ai_semantic_plan_from_model", lambda *args, **kwargs: {"candidate_ops": [], "questions": ["I need clarification before patching: entity not found"], "question_meta": {"id": "entity_target", "kind": "text"}}), patch.object(main, "USE_AI", True):
            plan, derived = _ai_plan_from_message(
                SimpleNamespace(state=SimpleNamespace(actor={})),
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": "", "status": "applied"},
                "now rename trade role to public trade role",
                answer_hints={
                    "pending_affected_modules": ["module_27052f"],
                    "module_target": "module_27052f",
                    "field_id": "contact.trade_role",
                    "field_label": "Trade Role",
                },
            )

        self.assertEqual(derived.get("affected_modules"), ["module_27052f"])
        self.assertEqual(plan.get("required_questions"), ["Confirm this plan?"])
        update_ops = [op for op in (plan.get("candidate_operations") or []) if isinstance(op, dict) and op.get("op") == "update_field"]
        self.assertEqual(len(update_ops), 1)
        self.assertEqual(update_ops[0].get("field_id"), "contact.trade_role")
        self.assertEqual((update_ops[0].get("changes") or {}).get("label"), "Public Trade Role")

    def test_collect_answer_hints_followup_prefers_explicit_new_field_label(self) -> None:
        session = _ai_create_record(
            _AI_ENTITY_SESSION,
            {
                "title": "Persisted follow-up field label",
                "status": "applied",
                "sandbox_status": "active",
                "sandbox_workspace_id": "ws_sandbox_followup_field",
                "created_at": "2026-03-23T00:00:00Z",
            },
        )
        session_id = _ai_record_data(session)["id"]
        _ai_create_record(
            _AI_ENTITY_PLAN,
            {
                "session_id": session_id,
                "status": "draft",
                "affected_artifacts_json": [{"artifact_type": "module", "artifact_id": "module_694ee7"}],
                "plan_json": {
                    "plan": {
                        "candidate_operations": [
                            {
                                "op": "add_field",
                                "artifact_type": "module",
                                "artifact_id": "module_694ee7",
                                "entity_id": "entity.crm",
                                "field": {"id": "crm.orbit", "label": "Orbit", "type": "string"},
                            },
                            {
                                "op": "insert_section_field",
                                "artifact_type": "module",
                                "artifact_id": "module_694ee7",
                                "view_id": "crm.form",
                                "field_id": "crm.orbit",
                                "placement_label": "Extra Info",
                            },
                        ],
                        "planner_state": {
                            "intent": "add_field",
                            "module_id": "module_694ee7",
                            "field_label": "Orbit",
                            "field_id": "crm.orbit",
                            "tab_label": "Extra Info",
                        },
                    }
                },
                "created_at": "2026-03-23T00:00:01Z",
            },
        )
        _ai_create_record(
            _AI_ENTITY_PATCHSET,
            {
                "session_id": session_id,
                "status": "applied",
                "patch_json": {
                    "operations": [
                        {
                            "op": "add_field",
                            "artifact_type": "module",
                            "artifact_id": "module_694ee7",
                            "entity_id": "entity.crm",
                            "field": {"id": "crm.orbit", "label": "Orbit", "type": "string"},
                        },
                        {
                            "op": "insert_section_field",
                            "artifact_type": "module",
                            "artifact_id": "module_694ee7",
                            "view_id": "crm.form",
                            "field_id": "crm.orbit",
                            "placement_label": "Extra Info",
                        },
                    ]
                },
                "created_at": "2026-03-23T00:00:02Z",
                "applied_at": "2026-03-23T00:00:02Z",
            },
        )
        _ai_create_record(
            _AI_ENTITY_MESSAGE,
            {
                "session_id": session_id,
                "role": "user",
                "message_type": "chat",
                "body": "In CRM, put a plain text field named Orbit inside Extra Info.",
                "created_at": "2026-03-23T00:00:00Z",
            },
        )

        hints = main._ai_collect_answer_hints(session_id)
        crm_manifest = {
            "module": {"id": "module_694ee7", "key": "crm", "name": "CRM"},
            "entities": [{"id": "entity.crm", "fields": [{"id": "crm.name", "label": "Name", "type": "string"}]}],
            "views": [],
        }
        module_index = {"module_694ee7": {"manifest": crm_manifest}}

        with patch.object(main, "_ai_build_workspace_graph", lambda _request: {}), patch.object(main, "_ai_module_manifest_index", lambda _request: module_index), patch.object(main, "USE_AI", False):
            plan, derived = _ai_plan_from_message(
                SimpleNamespace(state=SimpleNamespace(actor={})),
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": "", "status": "applied"},
                "Also place another text field called Pluto in that same tab.",
                answer_hints=hints,
            )

        self.assertEqual(derived.get("affected_modules"), ["module_694ee7"])
        add_field_ops = [op for op in (plan.get("candidate_operations") or []) if isinstance(op, dict) and op.get("op") == "add_field"]
        self.assertEqual(len(add_field_ops), 1)
        self.assertEqual((add_field_ops[0].get("field") or {}).get("label"), "Pluto")
        self.assertEqual((add_field_ops[0].get("field") or {}).get("id"), "crm.pluto")

    def test_followup_field_type_change_keeps_existing_field_label(self) -> None:
        session = _ai_create_record(
            _AI_ENTITY_SESSION,
            {
                "title": "Contacts accounting field type follow-up",
                "status": "planning",
                "sandbox_status": "active",
                "sandbox_workspace_id": "ws_sandbox_blush_field_type",
                "created_at": "2026-03-30T00:00:00Z",
            },
        )
        session_id = _ai_record_data(session)["id"]
        plan = _ai_create_record(
            _AI_ENTITY_PLAN,
            {
                "session_id": session_id,
                "status": "draft",
                "affected_artifacts_json": [{"artifact_type": "module", "artifact_id": "contacts"}],
                "plan_json": {
                    "plan": {
                        "candidate_operations": [
                            {
                                "op": "add_field",
                                "artifact_type": "module",
                                "artifact_id": "contacts",
                                "entity_id": "entity.contact",
                                "field": {"id": "contact.blush", "label": "Blush", "type": "string"},
                            },
                            {
                                "op": "insert_section_field",
                                "artifact_type": "module",
                                "artifact_id": "contacts",
                                "view_id": "contact.form",
                                "field_id": "contact.blush",
                                "placement_label": "Accounting",
                            },
                        ],
                        "planner_state": {
                            "intent": "add_field",
                            "module_id": "contacts",
                            "field_label": "Blush",
                            "field_id": "contact.blush",
                            "tab_label": "Accounting",
                        },
                    }
                },
                "created_at": "2026-03-30T00:00:01Z",
            },
        )
        _ai_update_record(_AI_ENTITY_SESSION, session_id, {"latest_plan_id": _ai_record_data(plan)["id"]})
        _ai_create_record(
            _AI_ENTITY_MESSAGE,
            {
                "session_id": session_id,
                "role": "user",
                "message_type": "chat",
                "body": "Add a field called Blush into the accounting tab in my contacts module.",
                "created_at": "2026-03-30T00:00:00Z",
            },
        )

        hints = main._ai_collect_answer_hints(session_id)
        contacts_manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [{"id": "entity.contact", "fields": [{"id": "contact.name", "label": "Name", "type": "string"}]}],
            "views": [],
        }
        module_index = {"contacts": {"manifest": contacts_manifest}}

        with patch.object(main, "_ai_build_workspace_graph", lambda _request: {}), patch.object(main, "_ai_module_manifest_index", lambda _request: module_index), patch.object(main, "USE_AI", False):
            plan, derived = _ai_plan_from_message(
                SimpleNamespace(state=SimpleNamespace(actor={})),
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": "", "status": "planning"},
                "Can you make that field an int number field?",
                answer_hints=hints,
            )

        self.assertEqual(derived.get("affected_modules"), ["contacts"])
        update_ops = [op for op in (plan.get("candidate_operations") or []) if isinstance(op, dict) and op.get("op") == "update_field"]
        self.assertEqual(len(update_ops), 1)
        self.assertEqual(update_ops[0].get("field_id"), "contact.blush")
        self.assertEqual((update_ops[0].get("changes") or {}).get("type"), "int")
        self.assertEqual((plan.get("planner_state") or {}).get("field_label"), "Blush")

    def test_apply_patchset_creates_post_apply_assistant_message(self) -> None:
        with TestClient(main.app) as client:
            create_response = client.post("/octo-ai/sessions", json={"title": "Stacked CRM change"})
            self.assertEqual(create_response.status_code, 200, create_response.text)
            session_id = create_response.json()["session"]["id"]
            _ai_update_record(
                _AI_ENTITY_SESSION,
                session_id,
                {"sandbox_workspace_id": "ws_sandbox_apply_message", "sandbox_status": "active"},
            )
            patchset = _ai_create_record(
                _AI_ENTITY_PATCHSET,
                {
                    "session_id": session_id,
                    "status": "validated",
                    "base_snapshot_refs_json": [],
                    "patch_json": {
                        "operations": [
                            {
                                "op": "add_field",
                                "artifact_type": "module",
                                "artifact_id": "crm",
                                "entity_id": "entity.crm",
                                "field": {"id": "crm.revenge", "label": "Revenge", "type": "string"},
                            }
                        ],
                        "noop": True,
                    },
                    "validation_json": None,
                    "apply_log_json": [],
                    "created_at": "2026-03-23T00:00:00Z",
                    "applied_at": None,
                },
            )
            patchset_id = _ai_record_data(patchset)["id"]

            apply_response = client.post(f"/octo-ai/patchsets/{patchset_id}/apply", json={"approved": True})
            self.assertEqual(apply_response.status_code, 200, apply_response.text)

        messages = [
            _ai_record_data(item)
            for item in main._ai_sort(main._ai_list_records(_AI_ENTITY_MESSAGE, limit=200), field="created_at", reverse=True)
            if _ai_record_data(item).get("session_id") == session_id and _ai_record_data(item).get("role") == "assistant"
        ]
        self.assertTrue(messages)
        self.assertIn("Sandbox updated.", messages[0].get("body") or "")
        self.assertIn("Next step: Test the sandbox result", messages[0].get("body") or "")

    def test_apply_patchset_clears_stale_confirm_question(self) -> None:
        with TestClient(main.app) as client:
            create_response = client.post("/octo-ai/sessions", json={"title": "Applied question reset"})
            self.assertEqual(create_response.status_code, 200, create_response.text)
            session_id = create_response.json()["session"]["id"]
            _ai_update_record(
                _AI_ENTITY_SESSION,
                session_id,
                {"sandbox_workspace_id": "ws_sandbox_clear_question", "sandbox_status": "active"},
            )
            _ai_create_record(
                _AI_ENTITY_PLAN,
                {
                    "session_id": session_id,
                    "status": "draft",
                    "questions_json": ["Confirm this plan?"],
                    "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan", "prompt": "Confirm this plan or tell me what to change."},
                    "plan_json": {"plan": {"required_questions": ["Confirm this plan?"], "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan", "prompt": "Confirm this plan or tell me what to change."}}},
                    "created_at": "2026-03-23T00:00:00Z",
                },
            )
            patchset = _ai_create_record(
                _AI_ENTITY_PATCHSET,
                {
                    "session_id": session_id,
                    "status": "validated",
                    "base_snapshot_refs_json": [],
                    "patch_json": {
                        "operations": [
                            {
                                "op": "add_field",
                                "artifact_type": "module",
                                "artifact_id": "crm",
                                "entity_id": "entity.crm",
                                "field": {"id": "crm.revenge", "label": "Revenge", "type": "string"},
                            }
                        ],
                        "noop": True,
                    },
                    "validation_json": None,
                    "apply_log_json": [],
                    "created_at": "2026-03-23T00:01:00Z",
                    "applied_at": None,
                },
            )
            patchset_id = _ai_record_data(patchset)["id"]

            apply_response = client.post(f"/octo-ai/patchsets/{patchset_id}/apply", json={"approved": True})
            self.assertEqual(apply_response.status_code, 200, apply_response.text)

            self.assertIsNone(main._ai_active_question_for_session(session_id))
            self.assertIsNone(main._ai_active_question_meta_for_session(session_id))

            answer_response = client.post(
                f"/octo-ai/sessions/{session_id}/questions/answer",
                json={"action": "custom", "text": "Also add Pluto in the same tab."},
            )
            self.assertEqual(answer_response.status_code, 400, answer_response.text)
            payload = answer_response.json()
            self.assertEqual(((payload.get("errors") or [{}])[0]).get("code"), "AI_NO_ACTIVE_QUESTION")

    def test_sandbox_applied_status_text_uses_validated_module_name(self) -> None:
        text = main._ai_sandbox_applied_status_text(
            {"title": "CRM tweak"},
            {
                "patch_json": {
                    "operations": [
                        {
                            "op": "add_field",
                            "artifact_id": "module_694ee7",
                            "field": {"id": "crm.revenge", "label": "Revenge", "type": "string"},
                        }
                    ]
                },
                "validation_json": {
                    "results": [
                        {
                            "module_id": "module_694ee7",
                            "manifest": {"module": {"name": "CRM", "key": "crm"}},
                        }
                    ]
                },
            },
        )
        self.assertIn("Add field 'Revenge' in CRM.", text)
        self.assertNotIn("module_694ee7", text)

    def test_preview_notification_lines_ignore_text_field_requests(self) -> None:
        lines = main._ai_preview_notification_lines(
            "Also add another text field called Pluto in the same tab."
        )
        self.assertEqual(lines, [])

    def test_force_preview_fallback_ignores_text_field_requests(self) -> None:
        self.assertFalse(main._ai_should_force_preview_fallback("Also place another text field called Pluto in that same tab.", ["module_694ee7"], [], [], None))
        self.assertFalse(
            main._ai_should_force_preview_fallback(
                "In CRM, put a plain text field named Orbit inside Extra Info.",
                ["crm"],
                [],
                ["What specific field should be used?"],
                {"id": "field_spec", "kind": "field_spec"},
            )
        )

    def test_extract_field_label_ignores_inside_tab_phrase(self) -> None:
        label = main._ai_extract_field_label(
            "In CRM, put a plain text field named Orbit inside Extra Info."
        )
        self.assertEqual(label, "Orbit")

    def test_extract_module_target_prefers_latest_explicit_module_mention(self) -> None:
        module_index = {
            "contacts": {"manifest": {"module": {"id": "contacts", "key": "contacts", "name": "Contacts"}}},
            "jobs": {"manifest": {"module": {"id": "jobs", "key": "jobs", "name": "Jobs"}}},
        }

        target = _ai_extract_module_target_from_text(
            "Add a Status field to Contacts. Actually add it in Jobs instead.",
            ["contacts", "jobs"],
            module_index,
        )

        self.assertEqual(target, "jobs")

    def test_extract_explicit_module_targets_ignores_module_alias_inside_field_label(self) -> None:
        module_index = {
            "contacts": {"manifest": {"module": {"id": "contacts", "key": "contacts", "name": "Contacts"}}},
            "jobs": {"manifest": {"module": {"id": "jobs", "key": "jobs", "name": "Jobs"}}},
        }

        targets = _ai_extract_explicit_module_targets_from_text(
            "Add a Jobs History field to the Contacts module.",
            ["contacts", "jobs"],
            module_index,
        )

        self.assertEqual(targets, ["contacts"])

    def test_extract_explicit_module_targets_keeps_later_scoped_module_after_cross_module_clause(self) -> None:
        module_index = {
            "contacts": {"manifest": {"module": {"id": "contacts", "key": "contacts", "name": "Contacts"}}},
            "jobs": {"manifest": {"module": {"id": "jobs", "key": "jobs", "name": "Jobs"}}},
            "invoices": {"manifest": {"module": {"id": "invoices", "key": "invoices", "name": "Invoices"}}},
        }

        targets = _ai_extract_explicit_module_targets_from_text(
            "Across Contacts and Jobs, add Service Level, then in Invoices add Billing Tier.",
            ["contacts", "jobs", "invoices"],
            module_index,
        )

        self.assertEqual(targets, ["contacts", "jobs", "invoices"])

    def test_extract_requested_module_scope_does_not_fall_back_to_generic_request_aliases(self) -> None:
        req = type("R", (), {"state": type("S", (), {"cache": {}})()})()
        main._octo_ai_seed_in_memory_baseline_modules()
        module_index = _ai_module_manifest_index(req)

        self.assertIsNone(
            _ai_extract_module_target_from_text(
                "For Purchase Requests, add Pending Approval, Approved, and Rejected statuses, plus action buttons for managers to approve or reject with comments.",
                list(module_index.keys()),
                module_index,
            )
        )
        self.assertEqual(
            _ai_extract_explicit_module_targets_from_text(
                "For Purchase Requests, add Pending Approval, Approved, and Rejected statuses, plus action buttons for managers to approve or reject with comments.",
                list(module_index.keys()),
                module_index,
            ),
            [],
        )

    def test_extract_requested_module_labels_handles_missing_module_scope_without_comma(self) -> None:
        labels = main._ai_extract_requested_module_labels(
            "For Purchase Requests require manager comments when rejecting."
        )

        self.assertEqual(labels, ["Purchase Requests"])

    def test_extract_explicit_module_targets_uses_require_scope_without_field_label_drift(self) -> None:
        module_index = {
            "contacts": {"manifest": {"module": {"id": "contacts", "key": "contacts", "name": "Contacts"}}},
            "jobs": {"manifest": {"module": {"id": "jobs", "key": "jobs", "name": "Jobs"}}},
        }

        target = _ai_extract_module_target_from_text(
            "In Jobs require After Hours Contact when the job type is Emergency.",
            ["contacts", "jobs"],
            module_index,
        )
        targets = _ai_extract_explicit_module_targets_from_text(
            "In Jobs require After Hours Contact when the job type is Emergency.",
            ["contacts", "jobs"],
            module_index,
        )

        self.assertEqual(target, "jobs")
        self.assertEqual(targets, ["jobs"])

    def test_extract_explicit_module_targets_handles_hide_rename_and_sync_clauses(self) -> None:
        module_index = {
            "contacts": {"manifest": {"module": {"id": "contacts", "key": "contacts", "name": "Contacts"}}},
            "jobs": {"manifest": {"module": {"id": "jobs", "key": "jobs", "name": "Jobs"}}},
            "invoices": {"manifest": {"module": {"id": "invoices", "key": "invoices", "name": "Invoices"}}},
        }

        text = "In Contacts hide Legacy Code, then in Jobs rename Status to Stage, and in Invoices sync payment status."
        labels = main._ai_extract_requested_module_labels(text)
        targets = _ai_extract_explicit_module_targets_from_text(
            text,
            ["contacts", "jobs", "invoices"],
            module_index,
        )

        self.assertEqual(labels, ["Contacts", "Jobs", "Invoices"])
        self.assertEqual(targets, ["contacts", "jobs", "invoices"])

    def test_extract_module_target_ignores_module_alias_inside_tab_label(self) -> None:
        module_index = {
            "contacts": {"manifest": {"module": {"id": "contacts", "key": "contacts", "name": "Contacts"}}},
            "module_9e87b6": {
                "manifest": {
                    "module": {"id": "module_9e87b6", "key": "module_9e87b6", "name": "Levels"},
                    "entities": [{"id": "entity.level", "label": "Levels", "fields": []}],
                }
            },
        }

        target = _ai_extract_module_target_from_text(
            "Add a new tab in Contacts called Levels, and then add a new notes field in that tab called Level notes.",
            ["contacts", "module_9e87b6"],
            module_index,
        )
        targets = _ai_extract_explicit_module_targets_from_text(
            "Add a new tab in Contacts called Levels, and then add a new notes field in that tab called Level notes.",
            ["contacts", "module_9e87b6"],
            module_index,
        )

        self.assertEqual(target, "contacts")
        self.assertEqual(targets, ["contacts"])

    def test_plan_from_message_keeps_single_module_scope_when_tab_label_matches_other_module(self) -> None:
        contacts_manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [{"id": "entity.contact", "fields": [{"id": "contact.name", "label": "Name", "type": "string"}]}],
            "views": [
                {
                    "id": "contact.form",
                    "kind": "form",
                    "entity": "entity.contact",
                    "header": {
                        "tabs": {
                            "tabs": [
                                {"id": "primary_tab", "label": "Primary", "sections": ["primary"]},
                            ]
                        }
                    },
                    "sections": [{"id": "primary", "fields": ["contact.name"]}],
                }
            ],
        }
        levels_manifest = {
            "module": {"id": "module_9e87b6", "key": "module_9e87b6", "name": "Levels"},
            "entities": [{"id": "entity.level", "fields": [{"id": "level.name", "label": "Name", "type": "string"}]}],
            "views": [],
        }
        module_index = {
            "contacts": {"manifest": contacts_manifest},
            "module_9e87b6": {"manifest": levels_manifest},
        }

        with patch.object(main, "_ai_build_workspace_graph", lambda _request: {}), patch.object(main, "_ai_module_manifest_index", lambda _request: module_index):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                "Add a new tab in Contacts called Levels, and then add a new notes field in that tab called Level notes.",
                answer_hints={},
            )

        self.assertEqual([item.get("artifact_id") for item in (plan.get("affected_artifacts") or [])], ["contacts"])
        self.assertEqual(derived.get("affected_modules"), ["contacts"])
        text = _ai_plan_assistant_text(
            plan,
            {
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "contacts", "manifest": contacts_manifest},
                ]
            },
        )
        self.assertIn("Contacts", text)
        self.assertNotIn("module_9e87b6", text)
        self.assertNotIn("This affects 2 modules", text)

    def test_slot_plan_treats_actually_instead_scope_switch_as_revision(self) -> None:
        contacts_manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [{"id": "entity.contact", "fields": [{"id": "contact.name", "label": "Name", "type": "string"}]}],
            "views": [],
        }
        jobs_manifest = {
            "module": {"id": "jobs", "key": "jobs", "name": "Jobs"},
            "entities": [{"id": "entity.job", "fields": [{"id": "job.title", "label": "Title", "type": "string"}]}],
            "views": [],
        }
        module_index = {"contacts": {"manifest": contacts_manifest}, "jobs": {"manifest": jobs_manifest}}

        plan = _ai_slot_based_plan(
            "Add a Status field to Contacts. Actually add it in Jobs instead.",
            ["contacts", "jobs"],
            module_index,
            answer_hints=None,
        )

        self.assertEqual(plan.get("questions"), [])
        add_ops = [op for op in plan.get("candidate_ops", []) if op.get("op") == "add_field"]
        self.assertEqual(len(add_ops), 1)
        self.assertEqual(add_ops[0].get("artifact_id"), "jobs")
        self.assertEqual(plan.get("affected_modules"), ["jobs"])

    def test_plan_from_message_treats_actually_instead_scope_switch_as_revision(self) -> None:
        contacts_manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [{"id": "entity.contact", "fields": [{"id": "contact.name", "label": "Name", "type": "string"}]}],
            "views": [],
        }
        jobs_manifest = {
            "module": {"id": "jobs", "key": "jobs", "name": "Jobs"},
            "entities": [{"id": "entity.job", "fields": [{"id": "job.title", "label": "Title", "type": "string"}]}],
            "views": [],
        }
        module_index = {"contacts": {"manifest": contacts_manifest}, "jobs": {"manifest": jobs_manifest}}

        with patch.object(main, "_ai_build_workspace_graph", lambda _request: {}), patch.object(main, "_ai_module_manifest_index", lambda _request: module_index):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                "Add a Status field to Contacts. Actually add it in Jobs instead.",
                answer_hints={},
            )

        self.assertEqual([item.get("artifact_id") for item in (plan.get("affected_artifacts") or [])], ["jobs"])
        self.assertEqual(derived.get("affected_modules"), ["jobs"])
        self.assertEqual([op.get("artifact_id") for op in (plan.get("candidate_operations") or [])], ["jobs"])

    def test_slot_plan_handles_cross_module_clause_inside_larger_multi_request(self) -> None:
        contacts_manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [{"id": "entity.contact", "fields": [{"id": "contact.name", "label": "Name", "type": "string"}]}],
            "views": [],
        }
        jobs_manifest = {
            "module": {"id": "jobs", "key": "jobs", "name": "Jobs"},
            "entities": [{"id": "entity.job", "fields": [{"id": "job.title", "label": "Title", "type": "string"}]}],
            "views": [],
        }
        invoices_manifest = {
            "module": {"id": "invoices", "key": "invoices", "name": "Invoices"},
            "entities": [{"id": "entity.invoice", "fields": [{"id": "invoice.number", "label": "Number", "type": "string"}]}],
            "views": [],
        }
        module_index = {
            "contacts": {"manifest": contacts_manifest},
            "jobs": {"manifest": jobs_manifest},
            "invoices": {"manifest": invoices_manifest},
        }

        plan = _ai_slot_based_plan(
            "Across Contacts and Jobs, add Service Level, then in Invoices add Billing Tier.",
            ["contacts", "jobs", "invoices"],
            module_index,
            answer_hints=None,
        )

        add_ops = [op for op in plan.get("candidate_ops", []) if op.get("op") == "add_field"]
        self.assertEqual(
            [(op.get("artifact_id"), op.get("field", {}).get("label")) for op in add_ops],
            [("contacts", "Service Level"), ("jobs", "Service Level"), ("invoices", "Billing Tier")],
        )
        self.assertEqual(plan.get("affected_modules"), ["contacts", "jobs", "invoices"])

    def test_plan_from_message_keeps_single_module_scope_when_field_label_mentions_other_module(self) -> None:
        contacts_manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [{"id": "entity.contact", "fields": [{"id": "contact.name", "label": "Name", "type": "string"}]}],
            "views": [],
        }
        jobs_manifest = {
            "module": {"id": "jobs", "key": "jobs", "name": "Jobs"},
            "entities": [{"id": "entity.job", "fields": [{"id": "job.title", "label": "Title", "type": "string"}]}],
            "views": [],
        }
        module_index = {"contacts": {"manifest": contacts_manifest}, "jobs": {"manifest": jobs_manifest}}

        with patch.object(main, "_ai_build_workspace_graph", lambda _request: {}), patch.object(main, "_ai_module_manifest_index", lambda _request: module_index):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                "Add a Jobs History field to the Contacts module.",
                answer_hints={},
            )

        self.assertEqual([item.get("artifact_id") for item in (plan.get("affected_artifacts") or [])], ["contacts"])
        self.assertEqual(derived.get("affected_modules"), ["contacts"])
        add_ops = [op for op in (plan.get("candidate_operations") or []) if isinstance(op, dict) and op.get("op") == "add_field"]
        self.assertEqual(len(add_ops), 1)
        self.assertEqual(add_ops[0].get("artifact_id"), "contacts")
        self.assertEqual(add_ops[0].get("field", {}).get("label"), "Jobs History")

    def test_plan_from_message_keeps_additive_followup_when_new_module_is_explicit(self) -> None:
        contacts_manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [{"id": "entity.contact", "fields": [{"id": "contact.name", "label": "Name", "type": "string"}]}],
            "views": [],
        }
        jobs_manifest = {
            "module": {"id": "jobs", "key": "jobs", "name": "Jobs"},
            "entities": [{"id": "entity.job", "fields": [{"id": "job.title", "label": "Title", "type": "string"}]}],
            "views": [],
        }
        module_index = {"contacts": {"manifest": contacts_manifest}, "jobs": {"manifest": jobs_manifest}}

        with patch.object(main, "_ai_build_workspace_graph", lambda _request: {}), patch.object(main, "_ai_module_manifest_index", lambda _request: module_index):
            plan, derived = _ai_plan_from_message(
                None,
                {"status": "waiting_input", "scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                "Also add a Preferred Technician field in Jobs.",
                answer_hints={
                    "pending_candidate_ops": [
                        {
                            "op": "add_field",
                            "artifact_type": "module",
                            "artifact_id": "contacts",
                            "entity_id": "entity.contact",
                            "field": {"id": "contact.customer_tier", "label": "Customer Tier", "type": "string"},
                        }
                    ],
                    "pending_affected_modules": ["contacts"],
                },
            )

        self.assertEqual([item.get("artifact_id") for item in (plan.get("affected_artifacts") or [])], ["contacts", "jobs"])
        self.assertEqual(derived.get("affected_modules"), ["contacts", "jobs"])
        self.assertEqual((plan.get("required_question_meta") or {}).get("id"), "confirm_plan")

        text = _ai_plan_assistant_text(
            plan,
            {
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "contacts", "manifest": contacts_manifest},
                    {"artifact_type": "module", "artifact_id": "jobs", "manifest": jobs_manifest},
                ]
            },
        )
        self.assertIn("This affects 2 modules: Contacts and Jobs.", text)
        self.assertIn("Add field 'Customer Tier' (string) in Contacts.", text)
        self.assertIn("Add field 'Preferred Technician' (string) in Jobs.", text)

    def test_plan_from_message_rolls_shared_field_out_across_all_explicit_modules(self) -> None:
        contacts_manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [{"id": "entity.contact", "fields": [{"id": "contact.name", "label": "Name", "type": "string"}]}],
            "views": [],
        }
        jobs_manifest = {
            "module": {"id": "jobs", "key": "jobs", "name": "Jobs"},
            "entities": [{"id": "entity.job", "fields": [{"id": "job.title", "label": "Title", "type": "string"}]}],
            "views": [],
        }
        quotes_manifest = {
            "module": {"id": "quotes", "key": "quotes", "name": "Quotes"},
            "entities": [{"id": "entity.quote", "fields": [{"id": "quote.title", "label": "Title", "type": "string"}]}],
            "views": [],
        }
        module_index = {
            "contacts": {"manifest": contacts_manifest},
            "jobs": {"manifest": jobs_manifest},
            "quotes": {"manifest": quotes_manifest},
        }

        with patch.object(main, "_ai_build_workspace_graph", lambda _request: {}), patch.object(main, "_ai_module_manifest_index", lambda _request: module_index):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                "Across Contacts, Jobs, and Quotes, add a Customer Priority field and keep it consistent everywhere. Show me the module-by-module rollout and any dependency notes before you build it.",
                answer_hints={},
            )

        self.assertEqual([item.get("artifact_id") for item in (plan.get("affected_artifacts") or [])], ["contacts", "jobs", "quotes"])
        self.assertEqual(derived.get("affected_modules"), ["contacts", "jobs", "quotes"])
        add_ops = [op for op in (plan.get("candidate_operations") or []) if op.get("op") == "add_field"]
        self.assertEqual([op.get("artifact_id") for op in add_ops], ["contacts", "jobs", "quotes"])
        self.assertTrue(all(op.get("field", {}).get("label") == "Customer Priority" for op in add_ops))

        text = _ai_plan_assistant_text(
            plan,
            {
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "contacts", "manifest": contacts_manifest},
                    {"artifact_type": "module", "artifact_id": "jobs", "manifest": jobs_manifest},
                    {"artifact_type": "module", "artifact_id": "quotes", "manifest": quotes_manifest},
                ]
            },
        )
        self.assertIn("This affects 3 modules: Contacts, Jobs, and Quotes.", text)
        self.assertIn("Customer Priority", text)
        self.assertIn("dependenc", text.lower())
        self.assertIn("workspace impact", text.lower())

    def test_plan_from_message_rolls_service_level_field_out_across_explicit_modules(self) -> None:
        contacts_manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [{"id": "entity.contact", "fields": [{"id": "contact.name", "label": "Name", "type": "string"}]}],
            "views": [],
        }
        jobs_manifest = {
            "module": {"id": "jobs", "key": "jobs", "name": "Jobs"},
            "entities": [{"id": "entity.job", "fields": [{"id": "job.title", "label": "Title", "type": "string"}]}],
            "views": [],
        }
        invoices_manifest = {
            "module": {"id": "invoices", "key": "invoices", "name": "Invoices"},
            "entities": [{"id": "entity.invoice", "fields": [{"id": "invoice.number", "label": "Invoice Number", "type": "string"}]}],
            "views": [],
        }
        module_index = {
            "contacts": {"manifest": contacts_manifest},
            "jobs": {"manifest": jobs_manifest},
            "invoices": {"manifest": invoices_manifest},
        }

        with patch.object(main, "_ai_build_workspace_graph", lambda _request: {}), patch.object(main, "_ai_module_manifest_index", lambda _request: module_index):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                "Across Contacts, Jobs, and Invoices, add a Service Level field and keep it consistent everywhere. Show me the module-by-module rollout and any dependency notes before you build it.",
                answer_hints={},
            )

        self.assertEqual([item.get("artifact_id") for item in (plan.get("affected_artifacts") or [])], ["contacts", "jobs", "invoices"])
        self.assertEqual(derived.get("affected_modules"), ["contacts", "jobs", "invoices"])
        add_ops = [op for op in (plan.get("candidate_operations") or []) if op.get("op") == "add_field"]
        self.assertEqual([op.get("artifact_id") for op in add_ops], ["contacts", "jobs", "invoices"])
        self.assertTrue(all(op.get("field", {}).get("label") == "Service Level" for op in add_ops))

    def test_plan_preview_mentions_explicit_module_that_is_missing_from_workspace(self) -> None:
        contacts_manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [{"id": "entity.contact", "fields": [{"id": "contact.name", "label": "Name", "type": "string"}]}],
            "views": [],
        }
        jobs_manifest = {
            "module": {"id": "jobs", "key": "jobs", "name": "Jobs"},
            "entities": [{"id": "entity.job", "fields": [{"id": "job.title", "label": "Title", "type": "string"}]}],
            "views": [],
        }
        module_index = {
            "contacts": {"manifest": contacts_manifest},
            "jobs": {"manifest": jobs_manifest},
        }

        with patch.object(main, "_ai_build_workspace_graph", lambda _request: {}), patch.object(main, "_ai_module_manifest_index", lambda _request: module_index):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                "Across Contacts, Jobs, and Invoices, add a Service Level field and keep it consistent everywhere. Show me the module-by-module rollout and any dependency notes before you build it.",
                answer_hints={},
            )

        self.assertEqual([item.get("artifact_id") for item in (plan.get("affected_artifacts") or [])], ["contacts", "jobs"])
        self.assertEqual(derived.get("affected_modules"), ["contacts", "jobs"])
        text = _ai_plan_assistant_text(
            plan,
            {
                "request_summary": "Across Contacts, Jobs, and Invoices, add a Service Level field and keep it consistent everywhere. Show me the module-by-module rollout and any dependency notes before you build it.",
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "contacts", "manifest": contacts_manifest},
                    {"artifact_type": "module", "artifact_id": "jobs", "manifest": jobs_manifest},
                ],
            },
        )
        self.assertIn("Invoices", text)
        self.assertIn("not currently in this workspace", text)
        self.assertIn("Contacts and Jobs", text)
        self.assertIn("Service Level", text)
        self.assertIn("If this looks right, confirm the plan", text)

    def test_plan_preview_mentions_missing_module_from_leading_scope_list(self) -> None:
        contacts_manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [{"id": "entity.contact", "fields": [{"id": "contact.name", "label": "Name", "type": "string"}]}],
            "views": [],
        }
        module_index = {
            "contacts": {"manifest": contacts_manifest},
        }

        with patch.object(main, "_ai_build_workspace_graph", lambda _request: {}), patch.object(main, "_ai_module_manifest_index", lambda _request: module_index):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                "In Contacts and Invoices, add a Service Level field and show me the rollout first.",
                answer_hints={},
            )

        self.assertEqual([item.get("artifact_id") for item in (plan.get("affected_artifacts") or [])], ["contacts"])
        self.assertEqual(derived.get("affected_modules"), ["contacts"])
        self.assertEqual((plan.get("planner_state") or {}).get("requested_module_labels"), ["Contacts", "Invoices"])
        self.assertEqual((plan.get("planner_state") or {}).get("missing_module_labels"), ["Invoices"])

        text = _ai_plan_assistant_text(
            plan,
            {
                "request_summary": "In Contacts and Invoices, add a Service Level field and show me the rollout first.",
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "contacts", "manifest": contacts_manifest},
                ],
            },
        )
        self.assertIn("You named 2 modules: Contacts and Invoices.", text)
        self.assertIn("Invoices is not currently in this workspace", text)
        self.assertIn("this draft only changes Contacts", text)
        self.assertIn("Service Level", text)

    def test_plan_text_keeps_dependency_notes_for_preview_drafts_with_missing_modules(self) -> None:
        jobs_manifest = {
            "module": {"id": "jobs", "key": "jobs", "name": "Jobs"},
            "entities": [{"id": "entity.job", "fields": [{"id": "job.title", "label": "Title", "type": "string"}]}],
            "views": [],
        }

        text = _ai_plan_assistant_text(
            {
                "required_questions": ["Confirm this plan?"],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": [],
                "risk_flags": [],
                "advisories": [],
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "jobs"}],
                "proposed_changes": [],
                "resolved_without_changes": False,
                "planner_state": {
                    "intent": "preview_only_plan",
                    "requested_module_labels": ["Jobs", "Purchase Orders", "Invoices"],
                    "missing_module_labels": ["Purchase Orders", "Invoices"],
                },
            },
            {
                "request_summary": "Across Jobs, Purchase Orders, and Invoices, add release approval actions and conditional fields so the right form sections only appear after release approval. Show the workspace rollout and dependencies before building anything.",
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "jobs", "manifest": jobs_manifest},
                ],
            },
        )

        self.assertIn("Dependency notes:", text)
        self.assertIn("Review dependency links across Jobs, Purchase Orders, and Invoices before apply.", text)
        self.assertIn(
            "This rollout still depends on bringing Purchase Orders and Invoices into this workspace",
            text,
        )
        self.assertIn("If this looks right, confirm the plan", text)

    def test_plan_text_sanitizes_internal_jargon_from_preview_assumptions(self) -> None:
        sales_manifest = {
            "module": {"id": "sales", "key": "sales", "name": "Quote"},
            "entities": [{"id": "entity.quote", "fields": [{"id": "quote.title", "label": "Title", "type": "string"}]}],
            "views": [],
        }
        jobs_manifest = {
            "module": {"id": "jobs", "key": "jobs", "name": "Jobs"},
            "entities": [{"id": "entity.job", "fields": [{"id": "job.title", "label": "Title", "type": "string"}]}],
            "views": [],
        }
        contacts_manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [{"id": "entity.contact", "fields": [{"id": "contact.name", "label": "Name", "type": "string"}]}],
            "views": [],
        }

        text = _ai_plan_assistant_text(
            {
                "required_questions": ["Confirm this plan?"],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": [
                    "The Job entity exists and has the necessary fields to copy customer and site details.",
                    "The action to notify the coordinator is handled outside of this manifest.",
                ],
                "risk_flags": ["Cross-module impact detected; review dependencies before apply."],
                "advisories": [],
                "affected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "sales"},
                    {"artifact_type": "module", "artifact_id": "jobs"},
                    {"artifact_type": "module", "artifact_id": "contacts"},
                ],
                "proposed_changes": [],
                "resolved_without_changes": False,
                "planner_state": {
                    "intent": "preview_only_plan",
                    "requested_module_labels": ["Quote", "Jobs", "Contacts"],
                },
            },
            {
                "request_summary": "When a Quote is approved, automatically create a Job, copy the customer and site details across, and notify the coordinator.",
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "sales", "manifest": sales_manifest},
                    {"artifact_type": "module", "artifact_id": "jobs", "manifest": jobs_manifest},
                    {"artifact_type": "module", "artifact_id": "contacts", "manifest": contacts_manifest},
                ],
            },
        )

        self.assertIn("outside this workspace setup", text)
        self.assertNotIn("manifest", text.lower())
        self.assertNotIn("artifact_id", text)
        self.assertNotIn("candidate_operations", text)

    def test_plan_from_message_keeps_module_specific_workspace_bundle_split_by_module(self) -> None:
        contacts_manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [{"id": "entity.contact", "fields": [{"id": "contact.name", "label": "Name", "type": "string"}]}],
            "views": [],
        }
        jobs_manifest = {
            "module": {"id": "jobs", "key": "jobs", "name": "Jobs"},
            "entities": [{"id": "entity.job", "fields": [{"id": "job.title", "label": "Title", "type": "string"}]}],
            "views": [],
        }
        quotes_manifest = {
            "module": {"id": "quotes", "key": "quotes", "name": "Quotes"},
            "entities": [{"id": "entity.quote", "fields": [{"id": "quote.title", "label": "Title", "type": "string"}]}],
            "views": [],
        }
        module_index = {
            "contacts": {"manifest": contacts_manifest},
            "jobs": {"manifest": jobs_manifest},
            "quotes": {"manifest": quotes_manifest},
        }

        with patch.object(main, "_ai_build_workspace_graph", lambda _request: {}), patch.object(main, "_ai_module_manifest_index", lambda _request: module_index):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                "Add approvals to our Jobs workspace flow. I want approval status in Jobs, approved-by details in Contacts, and approval history visible in Quotes. Explain the workspace impact clearly before building anything.",
                answer_hints={},
            )

        self.assertEqual([item.get("artifact_id") for item in (plan.get("affected_artifacts") or [])], ["jobs", "contacts", "quotes"])
        self.assertEqual(derived.get("affected_modules"), ["jobs", "contacts", "quotes"])
        add_ops = [op for op in (plan.get("candidate_operations") or []) if op.get("op") == "add_field"]
        self.assertEqual(
            [(op.get("artifact_id"), op.get("field", {}).get("label")) for op in add_ops],
            [("jobs", "Approval Status"), ("contacts", "Approved-By Details"), ("quotes", "Approval History")],
        )

        text = _ai_plan_assistant_text(
            plan,
            {
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "jobs", "manifest": jobs_manifest},
                    {"artifact_type": "module", "artifact_id": "contacts", "manifest": contacts_manifest},
                    {"artifact_type": "module", "artifact_id": "quotes", "manifest": quotes_manifest},
                ]
            },
        )
        self.assertIn("Jobs", text)
        self.assertIn("Contacts", text)
        self.assertIn("Quotes", text)
        self.assertIn("Approval History", text)
        self.assertIn("approval", text)
        self.assertIn("workspace impact", text.lower())

    def test_business_area_labels_cover_invoicing_and_quote_variants(self) -> None:
        module_index = {
            "sales": {
                "manifest": {
                    "module": {"id": "sales", "key": "sales", "name": "Sales"},
                    "entities": [{"id": "entity.quote", "label": "Quote", "fields": []}],
                    "views": [],
                    "app": {"nav": [{"group": "Sales", "items": [{"label": "Quotes", "to": "page:quote.list_page"}]}]},
                }
            },
            "invoices": {
                "manifest": {
                    "module": {"id": "invoices", "key": "invoices", "name": "Invoices"},
                    "entities": [{"id": "entity.invoice", "label": "Invoice", "fields": []}],
                    "views": [],
                }
            },
        }

        self.assertEqual(main._ai_extract_requested_module_labels("We need to change invoicing and quote approvals."), ["Invoices", "Quotes"])
        self.assertEqual(_ai_find_module_by_alias("invoicing", ["invoices", "sales"], module_index), "invoices")
        self.assertEqual(_ai_find_module_by_alias("quote approvals", ["sales"], module_index), "sales")

    def test_preview_only_dispatch_request_stays_in_confirmable_preview_flow(self) -> None:
        field_service_manifest = {
            "module": {"id": "field_service", "key": "field_service", "name": "Field Service"},
            "entities": [{"id": "entity.site_visit", "label": "Site Visit", "fields": [{"id": "site_visit.status", "label": "Status", "type": "enum"}]}],
            "views": [],
            "app": {"nav": [{"group": "Field Service", "items": [{"label": "Dispatch", "to": "page:site_visit.dispatch"}]}]},
        }
        module_index = {"field_service": {"manifest": field_service_manifest}}

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: module_index),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                "Build a dispatch system for field work, but explain the sandbox, preview, validation, and rollout steps before anything is applied to my live workspace.",
                answer_hints={},
            )

        self.assertEqual(derived.get("affected_modules"), ["field_service"])
        self.assertEqual((plan.get("required_question_meta") or {}).get("id"), "confirm_plan")
        self.assertEqual(plan.get("candidate_operations"), [])
        text = _ai_plan_assistant_text(
            plan,
            {
                "request_summary": "Build a dispatch system for field work, but explain the sandbox, preview, validation, and rollout steps before anything is applied to my live workspace.",
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "field_service", "manifest": field_service_manifest},
                ],
            },
        )
        self.assertIn("sandbox", text.lower())
        self.assertIn("preview", text.lower())
        self.assertIn("validation", text.lower())
        self.assertIn("rollout", text.lower())
        self.assertNotIn("Could you clarify", text)

    def test_jobs_conditional_field_request_stays_in_confirm_plan_flow(self) -> None:
        jobs_manifest = {
            "module": {"id": "jobs", "key": "jobs", "name": "Jobs"},
            "entities": [
                {
                    "id": "entity.job",
                    "fields": [
                        {"id": "job.title", "label": "Title", "type": "string"},
                        {
                            "id": "job.status",
                            "label": "Status",
                            "type": "enum",
                            "options": [
                                {"value": "new", "label": "New"},
                                {"value": "in_progress", "label": "In Progress"},
                                {"value": "done", "label": "Done"},
                                {"value": "completed", "label": "Completed"},
                            ],
                        },
                    ],
                }
            ],
            "views": [],
            "workflows": [
                {
                    "id": "job.status.workflow",
                    "entity": "entity.job",
                    "status_field": "job.status",
                    "states": [
                        {"id": "new", "label": "New"},
                        {"id": "in_progress", "label": "In Progress"},
                        {"id": "done", "label": "Done"},
                        {"id": "completed", "label": "Completed"},
                    ],
                }
            ],
        }
        module_index = {"jobs": {"manifest": jobs_manifest}}

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: module_index),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                "In Jobs, add a Completion Notes field that only shows when the status is Completed, and make a Follow-up Date required in that state.",
                answer_hints={},
            )

        self.assertEqual(derived.get("affected_modules"), ["jobs"])
        self.assertEqual((plan.get("required_question_meta") or {}).get("id"), "confirm_plan")
        self.assertEqual([op.get("op") for op in (plan.get("candidate_operations") or [])], ["add_field", "add_field"])
        text = _ai_plan_assistant_text(
            plan,
            {
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "jobs", "manifest": jobs_manifest},
                ]
            },
        )
        self.assertIn("Jobs", text)
        self.assertIn("Completion Notes", text)
        self.assertIn("Follow-up Date", text)
        self.assertNotIn("What should the new status be called?", text)

    def test_jobs_on_hold_noop_preview_stays_in_confirm_plan_flow(self) -> None:
        req = type("R", (), {"state": type("S", (), {"cache": {}})()})()
        main._octo_ai_seed_in_memory_baseline_modules()
        baseline_index = _ai_module_manifest_index(req)
        module_index = {"jobs": baseline_index["jobs"]}

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: module_index),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                "In Jobs, add an On Hold status with Resume and Set: On Hold actions so the team can pause work cleanly.",
                answer_hints={},
            )

        self.assertEqual(derived.get("affected_modules"), ["jobs"])
        self.assertTrue(plan.get("resolved_without_changes"))
        self.assertEqual((plan.get("required_question_meta") or {}).get("id"), "confirm_plan")
        text = _ai_plan_assistant_text(
            plan,
            {
                "request_summary": "In Jobs, add an On Hold status with Resume and Set: On Hold actions so the team can pause work cleanly.",
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "jobs", "manifest": module_index["jobs"]["manifest"]},
                ],
            },
        )
        self.assertIn("Planned changes:", text)
        self.assertIn("Jobs", text)
        self.assertIn("On Hold", text)
        self.assertIn("confirm the plan", text.lower())

    def test_missing_field_noop_preview_skips_confirm_plan_question(self) -> None:
        req = type("R", (), {"state": type("S", (), {"cache": {}})()})()
        main._octo_ai_seed_in_memory_baseline_modules()
        baseline_index = _ai_module_manifest_index(req)
        module_index = {"contacts": baseline_index["contacts"]}

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: module_index),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                "Remove the roblux field from the Contacts module.",
                answer_hints={},
            )

        self.assertEqual(derived.get("affected_modules"), ["contacts"])
        self.assertTrue(plan.get("resolved_without_changes"))
        self.assertEqual(plan.get("required_questions"), [])
        self.assertIsNone(plan.get("required_question_meta"))
        text = _ai_plan_assistant_text(
            plan,
            {
                "request_summary": "Remove the roblux field from the Contacts module.",
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "contacts", "manifest": module_index["contacts"]["manifest"]},
                ],
            },
        )
        self.assertIn("Field 'roblux' does not appear in Contacts.", text)
        self.assertIn("No changes are needed right now.", text)
        self.assertIn("The sandbox can stay as it is.", text)
        self.assertNotIn("confirm the plan", text.lower())

    def test_xero_sync_preview_prefers_confirm_plan_over_placement_question(self) -> None:
        req = type("R", (), {"state": type("S", (), {"cache": {}})()})()
        main._octo_ai_seed_in_memory_baseline_modules()
        baseline_index = _ai_module_manifest_index(req)
        module_index = {"contacts": baseline_index["contacts"]}
        message = "Set up Xero sync so approved Contacts and Invoices can be sent across, but only when the accounting fields are complete."

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: module_index),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        self.assertEqual(derived.get("affected_modules"), ["contacts"])
        self.assertEqual((plan.get("required_question_meta") or {}).get("id"), "confirm_plan")
        self.assertNotEqual((plan.get("required_question_meta") or {}).get("id"), "placement")
        text = _ai_plan_assistant_text(
            plan,
            {
                "request_summary": message,
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "contacts", "manifest": module_index["contacts"]["manifest"]},
                ],
            },
        )
        self.assertIn("Planned changes:", text)
        self.assertIn("Xero", text)
        self.assertIn("approved", text.lower())
        self.assertIn("accounting fields are complete", text.lower())
        self.assertIn("Invoices", text)

    def test_mailchimp_sync_preview_forces_plain_english_confirm_plan(self) -> None:
        req = type("R", (), {"state": type("S", (), {"cache": {}})()})()
        main._octo_ai_seed_in_memory_baseline_modules()
        baseline_index = _ai_module_manifest_index(req)
        module_index = {"contacts": baseline_index["contacts"]}
        message = "Sync marketing opt-in Contacts to Mailchimp, but only include customers who have consented to newsletters."

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: module_index),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        self.assertEqual(derived.get("affected_modules"), ["contacts"])
        self.assertEqual((plan.get("required_question_meta") or {}).get("id"), "confirm_plan")
        self.assertEqual(plan.get("candidate_operations"), [])
        text = _ai_plan_assistant_text(
            plan,
            {
                "request_summary": message,
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "contacts", "manifest": module_index["contacts"]["manifest"]},
                ],
            },
        )
        self.assertIn("Planned changes:", text)
        self.assertIn("Mailchimp", text)
        self.assertIn("newsletter consent", text.lower())
        self.assertIn("confirm the plan", text.lower())

    def test_twilio_sms_preview_fallback_keeps_confirm_plan_and_plain_english_preview(self) -> None:
        req = type("R", (), {"state": type("S", (), {"cache": {}})()})()
        main._octo_ai_seed_in_memory_baseline_modules()
        baseline_index = _ai_module_manifest_index(req)
        module_index = {"jobs": baseline_index["jobs"]}
        message = "Set up Twilio SMS so technicians get a text when a Job is dispatched with job number, site, and booking window."

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: module_index),
            patch.object(
                main,
                "_ai_semantic_plan_from_model",
                lambda *_args, **_kwargs: {
                    "candidate_ops": [
                        {
                            "op": "add_trigger",
                            "artifact_type": "module",
                            "artifact_id": "jobs",
                        }
                    ],
                    "questions": [],
                    "affected_modules": ["jobs"],
                },
            ),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        self.assertEqual(derived.get("affected_modules"), ["jobs"])
        self.assertEqual((plan.get("required_question_meta") or {}).get("id"), "confirm_plan")
        self.assertEqual(plan.get("candidate_operations"), [])
        text = _ai_plan_assistant_text(
            plan,
            {
                "request_summary": message,
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "jobs", "manifest": module_index["jobs"]["manifest"]},
                ],
            },
        )
        self.assertIn("Twilio", text)
        self.assertIn("SMS", text)
        self.assertIn("technicians", text)
        self.assertIn("job number", text.lower())
        self.assertIn("booking window", text.lower())
        self.assertIn("confirm the plan", text.lower())
        self.assertNotIn("trigger object", text.lower())
        self.assertNotIn("artifact ids", text.lower())

    def test_zapier_webhook_request_prefers_confirm_plan_preview_flow(self) -> None:
        req = type("R", (), {"state": type("S", (), {"cache": {}})()})()
        main._octo_ai_seed_in_memory_baseline_modules()
        baseline_index = _ai_module_manifest_index(req)
        message = "Send a webhook to Zapier when a new customer onboarding is marked complete so downstream systems can be updated."

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: baseline_index),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        self.assertGreaterEqual(len(derived.get("affected_modules") or []), 1)
        self.assertEqual((plan.get("required_question_meta") or {}).get("id"), "confirm_plan")
        self.assertEqual((plan.get("planner_state") or {}).get("intent"), "preview_only_plan")
        self.assertEqual(plan.get("candidate_operations"), [])
        text = _ai_plan_assistant_text(
            plan,
            {
                "request_summary": message,
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": module_id, "manifest": baseline_index[module_id]["manifest"]}
                    for module_id in (derived.get("affected_modules") or [])
                    if module_id in baseline_index
                ],
            },
        )
        self.assertIn("Planned changes:", text)
        self.assertIn("Zapier", text)
        self.assertIn("webhook", text.lower())
        self.assertIn("confirm the plan", text.lower())
        self.assertNotIn("What should the new field be called?", text)

    def test_automation_preview_request_lists_trigger_followup_and_notification_changes(self) -> None:
        jobs_manifest = {
            "module": {"id": "jobs", "key": "jobs", "name": "Jobs"},
            "entities": [{"id": "entity.job", "fields": [{"id": "job.title", "label": "Title", "type": "string"}]}],
            "views": [],
        }
        sales_manifest = {
            "module": {"id": "sales", "key": "sales", "name": "Quotes"},
            "entities": [{"id": "entity.quote", "fields": [{"id": "quote.title", "label": "Title", "type": "string"}]}],
            "views": [],
        }
        module_index = {"jobs": {"manifest": jobs_manifest}, "sales": {"manifest": sales_manifest}}
        message = "When a Quote is approved, automatically create a Job, copy the customer and site details across, and notify the coordinator."

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: module_index),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, _derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        text = _ai_plan_assistant_text(
            plan,
            {
                "request_summary": message,
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "sales", "manifest": sales_manifest},
                    {"artifact_type": "module", "artifact_id": "jobs", "manifest": jobs_manifest},
                ],
            },
        )

        self.assertIn("Planned changes:", text)
        self.assertIn("Add an automatic workflow that runs when a Quote is approved.", text)
        self.assertIn("Create a Job automatically when that rule is met.", text)
        self.assertIn("Carry across the customer and site details.", text)
        self.assertIn("Notify the coordinator automatically.", text)
        self.assertNotIn("Only send approved records across.", text)

    def test_cross_module_quote_handoff_prefers_action_update_plan(self) -> None:
        sales_manifest = main.json.loads((main.ROOT / "manifests" / "marketplace_v1" / "sales.json").read_text(encoding="utf-8"))
        jobs_manifest = {"module": {"id": "jobs", "key": "jobs", "name": "Jobs"}, "entities": [{"id": "entity.job", "fields": []}]}
        contacts_manifest = {"module": {"id": "contacts", "key": "contacts", "name": "Contacts"}, "entities": [{"id": "entity.contact", "fields": []}]}
        module_index = {
            "sales": {"manifest": sales_manifest},
            "jobs": {"manifest": jobs_manifest},
            "contacts": {"manifest": contacts_manifest},
        }
        message = "In Sales, when a quote is approved, create a Job in Jobs, copy the customer and site details from Contacts, and notify the coordinator."

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: module_index),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, _derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        ops = [op for op in (plan.get("candidate_operations") or []) if isinstance(op, dict)]
        self.assertTrue(any(op.get("op") == "update_action" for op in ops))
        self.assertIn("Notify the coordinator automatically.", _ai_plan_assistant_text(plan, {"request_summary": message, "full_selected_artifacts": []}))

    def test_cross_module_job_completion_documents_prefers_action_update_plan(self) -> None:
        jobs_manifest = main.json.loads((main.ROOT / "manifests" / "marketplace_v1" / "jobs.json").read_text(encoding="utf-8"))
        documents_manifest = {"module": {"id": "documents", "key": "documents", "name": "Documents"}, "entities": [{"id": "entity.document_record", "fields": []}]}
        contacts_manifest = {"module": {"id": "contacts", "key": "contacts", "name": "Contacts"}, "entities": [{"id": "entity.contact", "fields": []}]}
        module_index = {
            "jobs": {"manifest": jobs_manifest},
            "documents": {"manifest": documents_manifest},
            "contacts": {"manifest": contacts_manifest},
        }
        message = "In Jobs, when a job is completed, generate a completion pack in Documents, attach the service report PDF, and mark the customer follow-up in Contacts."

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: module_index),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, _derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        ops = [op for op in (plan.get("candidate_operations") or []) if isinstance(op, dict)]
        self.assertTrue(any(op.get("op") == "update_action" for op in ops))
        text = _ai_plan_assistant_text(plan, {"request_summary": message, "full_selected_artifacts": []})
        self.assertIn("Generate the completion pack in Documents automatically.", text)
        self.assertIn("Attach the service report PDF", text)
        self.assertIn("Mark the customer follow-up in Contacts.", text)

    def test_cross_module_crm_lead_to_quote_prefers_action_update_plan(self) -> None:
        crm_manifest = main.json.loads((main.ROOT / "manifests" / "marketplace_v1" / "crm.json").read_text(encoding="utf-8"))
        sales_manifest = {"module": {"id": "sales", "key": "sales", "name": "Sales"}, "entities": [{"id": "entity.quote", "fields": []}]}
        contacts_manifest = {"module": {"id": "contacts", "key": "contacts", "name": "Contacts"}, "entities": [{"id": "entity.contact", "fields": []}]}
        module_index = {
            "crm": {"manifest": crm_manifest},
            "sales": {"manifest": sales_manifest},
            "contacts": {"manifest": contacts_manifest},
        }
        message = "When a CRM lead becomes qualified, add the flow to create a draft quote in Sales and carry over contact details from Contacts."

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: module_index),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, _derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        ops = [op for op in (plan.get("candidate_operations") or []) if isinstance(op, dict)]
        self.assertTrue(any(op.get("op") == "update_action" for op in ops))
        text = _ai_plan_assistant_text(plan, {"request_summary": message, "full_selected_artifacts": []})
        self.assertIn("Create a draft quote in Sales automatically.", text)
        self.assertIn("Carry over the contact details from Contacts.", text)

    def test_template_preview_request_lists_named_template_and_requested_content(self) -> None:
        jobs_manifest = {
            "module": {"id": "jobs", "key": "jobs", "name": "Jobs"},
            "entities": [{"id": "entity.job", "fields": [{"id": "job.title", "label": "Title", "type": "string"}]}],
            "views": [],
        }
        module_index = {"jobs": {"manifest": jobs_manifest}}
        message = "Create a Service Report PDF template that includes customer details, work performed, technician notes, photos, and customer signoff."

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: module_index),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, _derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        text = _ai_plan_assistant_text(
            plan,
            {
                "request_summary": message,
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "jobs", "manifest": jobs_manifest},
                ],
            },
        )

        self.assertIn("Planned changes:", text)
        self.assertIn("Create the Service Report PDF template.", text)
        self.assertIn("Include customer details, work performed, technician notes, photos, and customer signoff.", text)
        self.assertNotIn("Map the first draft plan across Jobs.", text)

    def test_integration_preview_request_lists_provider_and_flow(self) -> None:
        contacts_manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [{"id": "entity.contact", "fields": [{"id": "contact.name", "label": "Name", "type": "string"}]}],
            "views": [],
        }
        sales_manifest = {
            "module": {"id": "sales", "key": "sales", "name": "Sales"},
            "entities": [{"id": "entity.invoice", "fields": [{"id": "invoice.number", "label": "Invoice Number", "type": "string"}]}],
            "views": [],
        }
        module_index = {"contacts": {"manifest": contacts_manifest}, "sales": {"manifest": sales_manifest}}
        message = "Set up Xero sync so approved Contacts and Invoices can be sent across, but only when the accounting fields are complete."

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: module_index),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, _derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        text = _ai_plan_assistant_text(plan, {"request_summary": message, "full_selected_artifacts": []})

        self.assertIn("Set up the requested Xero integration.", text)
        self.assertIn("Keep the integration flow so approved Contacts and Invoices can be sent across, but only when the accounting fields are complete.", text)

    def test_automation_preview_request_populates_structured_automation_details(self) -> None:
        jobs_manifest = {
            "module": {"id": "jobs", "key": "jobs", "name": "Jobs"},
            "entities": [{"id": "entity.job", "fields": [{"id": "job.title", "label": "Title", "type": "string"}]}],
            "views": [],
        }
        sales_manifest = {
            "module": {"id": "sales", "key": "sales", "name": "Quotes"},
            "entities": [{"id": "entity.quote", "fields": [{"id": "quote.title", "label": "Title", "type": "string"}]}],
            "views": [],
        }
        module_index = {"jobs": {"manifest": jobs_manifest}, "sales": {"manifest": sales_manifest}}
        message = "When a Quote is approved, automatically create a Job, copy the customer and site details across, and notify the coordinator."

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: module_index),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, _derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        structured = _ai_build_structured_plan(
            plan,
            {
                "request_summary": message,
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "sales", "manifest": sales_manifest},
                    {"artifact_type": "module", "artifact_id": "jobs", "manifest": jobs_manifest},
                ],
            },
        )

        self.assertIn("automation_change", structured["operation_families"])
        self.assertTrue(any("automatic workflow" in item["summary"] for item in structured["changes"]))
        sections = {item["key"]: item["items"] for item in structured["sections"]}
        self.assertIn("automations", sections)
        self.assertIn("Add an automatic workflow that runs when a Quote is approved.", sections["automations"])
        self.assertIn("Notify the coordinator automatically.", sections["automations"])

    def test_template_preview_request_populates_structured_template_details(self) -> None:
        message = "Create a Holiday Itinerary PDF template with traveller details, travel dates, bookings, flights, hotels, and activity notes."

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: {}),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, _derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        structured = _ai_build_structured_plan(
            plan,
            {
                "request_summary": message,
                "full_selected_artifacts": [],
            },
        )

        self.assertIn("template_change", structured["operation_families"])
        self.assertEqual(structured["summary"], "Create the Holiday Itinerary PDF template.")
        self.assertTrue(any("Holiday Itinerary PDF template" in item["summary"] for item in structured["changes"]))
        sections = {item["key"]: item["items"] for item in structured["sections"]}
        self.assertIn("templates", sections)
        self.assertIn("Create the Holiday Itinerary PDF template.", sections["templates"])
        self.assertIn("Include traveller details, travel dates, bookings, flights, hotels, and activity notes.", sections["templates"])

    def test_integration_preview_request_populates_structured_integration_and_condition_details(self) -> None:
        message = "Set up Xero sync so approved Contacts and Invoices can be sent across, but only when the accounting fields are complete."

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: {}),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, _derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        structured = _ai_build_structured_plan(
            plan,
            {
                "request_summary": message,
                "full_selected_artifacts": [],
            },
        )

        self.assertIn("integration_change", structured["operation_families"])
        self.assertEqual(structured["summary"], "Set up the requested Xero integration.")
        self.assertTrue(any("Xero integration" in item["summary"] for item in structured["changes"]))
        sections = {item["key"]: item["items"] for item in structured["sections"]}
        self.assertIn("dependencies", sections)
        self.assertIn("Set up the requested Xero integration.", sections["dependencies"])
        self.assertIn("conditions", sections)
        self.assertIn("Only send approved records across.", sections["conditions"])
        self.assertIn("Only send records across when the accounting fields are complete.", sections["conditions"])

    def test_automation_preview_request_uses_specific_summary_instead_of_generic_rollout(self) -> None:
        message = "When a Quote is approved, automatically create a Job, copy the customer and site details across, and notify the coordinator."

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: {}),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, _derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        structured = _ai_build_structured_plan(
            plan,
            {
                "request_summary": message,
                "full_selected_artifacts": [],
            },
        )

        self.assertEqual(structured["summary"], "Add an automatic workflow that runs when a Quote is approved.")

    def test_preview_contract_request_populates_structured_validation_section(self) -> None:
        message = "For Invoices and Quotes, walk me through the sandbox, validation, and rollback plan before you build anything."

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: {}),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, _derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        structured = _ai_build_structured_plan(
            plan,
            {
                "request_summary": message,
                "full_selected_artifacts": [],
            },
        )

        sections = {item["key"]: item["items"] for item in structured["sections"]}
        self.assertIn("validation", sections)
        self.assertIn("sandbox first: keep this as a draft plan so nothing touches the live workspace yet.", sections["validation"])
        self.assertIn("validation: check the change in the sandbox before you approve it.", sections["validation"])
        self.assertIn("rollback: keep the current module snapshots so the rollout can be reversed safely if staff struggle with the new flow.", sections["validation"])

    def test_dispatch_sandbox_preview_request_builds_plan_without_scope_label_crash(self) -> None:
        message = (
            "Build a dispatch system for field work, but explain the sandbox, preview, validation, "
            "and rollout steps before anything is applied to my live workspace."
        )
        plan = {
            "planner_state": {"intent": "preview_only_plan"},
            "affected_artifacts": [],
            "proposed_changes": [],
        }

        structured = _ai_build_structured_plan(
            plan,
            {
                "request_summary": message,
                "full_selected_artifacts": [],
            },
        )
        text = _ai_plan_assistant_text(
            plan,
            {
                "request_summary": message,
                "full_selected_artifacts": [],
            },
        )

        self.assertIn("sandbox", text.lower())
        self.assertIn("validation", text.lower())
        self.assertTrue(structured["summary"])
        sections = {item["key"]: item["items"] for item in structured["sections"]}
        self.assertIn("validation", sections)
        self.assertIn("sandbox first: keep this as a draft plan so nothing touches the live workspace yet.", sections["validation"])

    def test_preview_contract_field_request_skips_semantic_model_when_preview_plan_is_enough(self) -> None:
        jobs_manifest = {
            "module": {"id": "jobs", "key": "jobs", "name": "Jobs"},
            "entities": [
                {
                    "id": "entity.job",
                    "fields": [
                        {"id": "job.id", "type": "uuid", "label": "ID"},
                        {"id": "job.title", "type": "string", "label": "Title"},
                        {
                            "id": "job.job_type",
                            "type": "enum",
                            "label": "Job Type",
                            "options": [
                                {"value": "standard", "label": "Standard"},
                                {"value": "emergency", "label": "Emergency"},
                            ],
                        },
                    ],
                }
            ],
            "views": [],
        }
        module_index = {"jobs": {"manifest": jobs_manifest}}
        message = "In Jobs, if the job type is Emergency, show After Hours Contact and Callout Reason fields and make them required."

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: module_index),
            patch.object(
                main,
                "_ai_semantic_plan_from_model",
                side_effect=AssertionError("semantic model should not run for preview-only field requests"),
            ),
        ):
            plan, _derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        self.assertEqual((plan.get("planner_state") or {}).get("intent"), "preview_only_plan")
        self.assertEqual(plan.get("required_questions"), ["Confirm this plan?"])

    def test_preview_contract_field_request_keeps_field_wording_without_automation_drift(self) -> None:
        message = "In Jobs, if the job type is Emergency, show After Hours Contact and Callout Reason fields and make them required."

        text = _ai_plan_assistant_text(
            {
                "required_questions": ["Confirm this plan?"],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": [],
                "risk_flags": [],
                "advisories": [],
                "affected_artifacts": [],
                "proposed_changes": [],
                "planner_state": {"intent": "preview_only_plan"},
            },
            {
                "request_summary": message,
                "full_selected_artifacts": [],
            },
        )

        self.assertIn("Add fields for After Hours Contact and Callout Reason.", text)
        self.assertIn("Show After Hours Contact and Callout Reason only when the job type is Emergency.", text)
        self.assertIn("Make After Hours Contact and Callout Reason required when the job type is Emergency.", text)
        self.assertNotIn("Add an automatic workflow", text)

    def test_dashboard_preview_request_lists_dashboard_and_metrics(self) -> None:
        jobs_manifest = {
            "module": {"id": "jobs", "key": "jobs", "name": "Jobs"},
            "entities": [{"id": "entity.job", "fields": [{"id": "job.title", "label": "Title", "type": "string"}]}],
            "views": [],
        }
        module_index = {"jobs": {"manifest": jobs_manifest}}
        message = "Build a Jobs dashboard showing jobs by status, jobs by technician, overdue jobs, and completed jobs this week."

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: module_index),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, _derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        text = _ai_plan_assistant_text(
            plan,
            {
                "request_summary": message,
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "jobs", "manifest": jobs_manifest},
                ],
            },
        )

        self.assertIn("Planned changes:", text)
        self.assertIn("Build the Jobs dashboard.", text)
        self.assertIn("Show jobs by status, jobs by technician, overdue jobs, and completed jobs this week.", text)
        self.assertNotIn("Map the first draft plan across Jobs.", text)

    def test_dashboard_preview_without_exact_module_match_stays_in_confirm_plan_flow(self) -> None:
        message = "Create a staff training dashboard that highlights expired certificates, upcoming renewals, and completion by team."

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: {}),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        self.assertEqual(derived.get("affected_modules"), [])
        self.assertEqual((plan.get("required_question_meta") or {}).get("id"), "confirm_plan")
        self.assertEqual((plan.get("planner_state") or {}).get("intent"), "preview_only_plan")
        self.assertEqual((plan.get("planner_state") or {}).get("requested_module_labels"), ["Staff Training"])
        self.assertEqual((plan.get("planner_state") or {}).get("missing_module_labels"), ["Staff Training"])

        text = _ai_plan_assistant_text(
            plan,
            {
                "request_summary": message,
                "full_selected_artifacts": [],
            },
        )

        self.assertIn("Planned changes:", text)
        self.assertIn("Build the staff training dashboard.", text)
        self.assertIn("Show expired certificates, upcoming renewals, and completion by team.", text)
        self.assertIn("draft patchset for sandbox validation", text)
        self.assertNotIn("Which module should receive this change?", text)

    def test_dashboard_preview_improve_wording_without_exact_module_match_stays_in_confirm_plan_flow(self) -> None:
        message = (
            "Improve the Construction operations dashboard so supervisors can see workers on site today, "
            "total labour hours today, materials logged today, total cost today, cost breakdown, recent time entries, "
            "and today's material logs."
        )

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: {}),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        self.assertEqual(derived.get("affected_modules"), [])
        self.assertEqual((plan.get("required_question_meta") or {}).get("id"), "confirm_plan")
        self.assertEqual((plan.get("planner_state") or {}).get("intent"), "preview_only_plan")

        text = _ai_plan_assistant_text(
            plan,
            {
                "request_summary": message,
                "full_selected_artifacts": [],
            },
        )

        self.assertIn("Planned changes:", text)
        self.assertIn("Construction operations dashboard", text)
        self.assertIn("workers on site today", text)
        self.assertNotIn("Which module should receive this change?", text)

    def test_workspace_graph_preview_keeps_approval_and_conditional_wording(self) -> None:
        jobs_manifest = {
            "module": {"id": "jobs", "key": "jobs", "name": "Jobs"},
            "entities": [{"id": "entity.job", "fields": [{"id": "job.title", "label": "Title", "type": "string"}]}],
            "views": [],
        }
        sales_manifest = {
            "module": {"id": "sales", "key": "sales", "name": "Quotes"},
            "entities": [{"id": "entity.quote", "fields": [{"id": "quote.title", "label": "Title", "type": "string"}]}],
            "views": [],
        }
        module_index = {"jobs": {"manifest": jobs_manifest}, "sales": {"manifest": sales_manifest}}
        message = (
            "Across Jobs, Quotes, and Invoices, add approval actions and conditional fields so the right form sections only appear "
            "after approval. Show the workspace rollout and dependencies before building anything."
        )

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: module_index),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, _derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        text = _ai_plan_assistant_text(
            plan,
            {
                "request_summary": message,
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "jobs", "manifest": jobs_manifest},
                    {"artifact_type": "module", "artifact_id": "sales", "manifest": sales_manifest},
                ],
            },
        )

        self.assertIn("approval steps and action buttons", text)
        self.assertIn("conditional fields and form sections", text)
        self.assertIn("Dependency notes:", text)
        self.assertIn("Invoices", text)

    def test_large_service_ops_brief_prefers_preview_only_plan(self) -> None:
        jobs_manifest = {
            "module": {"id": "jobs", "key": "jobs", "name": "Jobs"},
            "entities": [{"id": "entity.job", "fields": [{"id": "job.title", "label": "Title", "type": "string"}]}],
            "views": [],
        }
        module_index = {"jobs": {"manifest": jobs_manifest}}

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: module_index),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, _derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                "Build me a small service operations system with work orders, technician scheduling, customer visits, job notes, and completion status. Explain everything you plan to add before building it.",
                answer_hints={},
            )

        self.assertEqual((plan.get("required_question_meta") or {}).get("id"), "confirm_plan")
        self.assertEqual(plan.get("candidate_operations"), [])
        self.assertEqual((plan.get("planner_state") or {}).get("intent"), "preview_only_plan")
        text = _ai_plan_assistant_text(
            plan,
            {
                "request_summary": "Build me a small service operations system with work orders, technician scheduling, customer visits, job notes, and completion status. Explain everything you plan to add before building it.",
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "jobs", "manifest": jobs_manifest},
                ],
            },
        )
        self.assertIn("Planned changes:", text)
        self.assertIn("plain-english system build", text.lower())
        self.assertIn("Job Notes", text)
        self.assertIn("Technician Scheduling", text)
        self.assertIn("Completion Status", text)
        self.assertIn("plain-english draft plan first", text.lower())

    def test_create_module_preview_brief_without_existing_scope_stays_in_confirm_flow(self) -> None:
        message = (
            "Create a module for training compliance with due dates, certificate uploads, expiry reminders, "
            "and manager signoff. Explain everything you plan to add before building it."
        )

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: {}),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        self.assertEqual(derived.get("affected_modules"), [])
        self.assertEqual((plan.get("required_question_meta") or {}).get("id"), "confirm_plan")
        self.assertEqual(plan.get("candidate_operations"), [])
        self.assertEqual((plan.get("planner_state") or {}).get("intent"), "preview_only_plan")
        self.assertEqual((plan.get("planner_state") or {}).get("module_name"), "Training Compliance")
        self.assertEqual((plan.get("planner_state") or {}).get("requested_module_labels"), ["Training Compliance"])
        text = _ai_plan_assistant_text(plan, {"request_summary": message, "full_selected_artifacts": []})
        self.assertIn("Training Compliance", text)
        self.assertIn("new module", text.lower())
        self.assertIn("draft plan before any build work starts", text)
        self.assertNotIn("concrete module/entity/view target", text)
        self.assertNotIn("I need one clarification", text)

    def test_create_module_plan_echoes_requested_capabilities_in_preview(self) -> None:
        message = (
            "Create a training operations app called Training Operations with courses, attendees, due dates, "
            "reminders, completion certificates, automated overdue follow-ups, and rich action buttons."
        )

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: {}),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, _derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        text = _ai_plan_assistant_text(plan, {"request_summary": message, "full_selected_artifacts": []})
        self.assertIn("reminders", text.lower())
        self.assertIn("completion certificates", text.lower())
        self.assertIn("overdue follow-ups", text.lower())

    def test_create_module_status_request_stays_in_confirm_plan_flow_and_keeps_human_name(self) -> None:
        message = "Create a module called Training Compliance with due, booked, completed, and overdue statuses."

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: {}),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        self.assertEqual(derived.get("affected_modules"), ["training_compliance"])
        self.assertEqual((plan.get("required_question_meta") or {}).get("id"), "confirm_plan")
        self.assertIn("create_module", [op.get("op") for op in (plan.get("candidate_operations") or []) if isinstance(op, dict)])
        text = _ai_plan_assistant_text(plan, {"request_summary": message, "full_selected_artifacts": []})
        self.assertIn("Training Compliance", text)
        self.assertNotIn("training_compliance", text)
        self.assertNotIn("I need one clarification", text)

    def test_preview_only_finance_request_mentions_quotes_and_missing_invoices(self) -> None:
        sales_manifest = {
            "module": {"id": "sales", "key": "sales", "name": "Sales"},
            "entities": [{"id": "entity.quote", "label": "Quote", "fields": [{"id": "quote.status", "label": "Status", "type": "enum"}]}],
            "views": [],
            "app": {"nav": [{"group": "Sales", "items": [{"label": "Quotes", "to": "page:quote.list_page"}]}]},
        }
        module_index = {"sales": {"manifest": sales_manifest}}

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: module_index),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                "We need to change invoicing and quote approvals, but I want a safe rollback path if the new flow confuses staff. Explain the validation and rollback plan before you build it.",
                answer_hints={},
            )

        self.assertEqual(derived.get("affected_modules"), ["sales"])
        self.assertEqual((plan.get("required_question_meta") or {}).get("id"), "confirm_plan")
        self.assertEqual((plan.get("planner_state") or {}).get("requested_module_labels"), ["Invoices", "Quotes"])
        self.assertEqual((plan.get("planner_state") or {}).get("missing_module_labels"), ["Invoices"])
        text = _ai_plan_assistant_text(
            plan,
            {
                "request_summary": "We need to change invoicing and quote approvals, but I want a safe rollback path if the new flow confuses staff. Explain the validation and rollback plan before you build it.",
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "sales", "manifest": sales_manifest},
                ],
            },
        )
        self.assertIn("Quotes", text)
        self.assertIn("Invoices", text)
        self.assertIn("validation", text.lower())
        self.assertIn("rollback", text.lower())
        self.assertNotIn("What specific changes", text)

    def test_preview_only_finance_request_prefers_specific_quotes_and_invoices_modules_over_sales_fallback(self) -> None:
        sales_manifest = {
            "module": {"id": "sales", "key": "sales", "name": "Sales"},
            "entities": [{"id": "entity.order", "label": "Order", "fields": [{"id": "order.status", "label": "Status", "type": "enum"}]}],
            "views": [],
        }
        quotes_manifest = {
            "module": {"id": "quotes", "key": "quotes", "name": "Quotes"},
            "entities": [{"id": "entity.quote", "label": "Quote", "fields": [{"id": "quote.status", "label": "Status", "type": "enum"}]}],
            "views": [],
        }
        invoices_manifest = {
            "module": {"id": "invoices", "key": "invoices", "name": "Invoices"},
            "entities": [{"id": "entity.invoice", "label": "Invoice", "fields": [{"id": "invoice.status", "label": "Status", "type": "enum"}]}],
            "views": [],
        }
        module_index = {
            "sales": {"manifest": sales_manifest},
            "quotes": {"manifest": quotes_manifest},
            "invoices": {"manifest": invoices_manifest},
        }
        message = "We need to change invoicing and quote approvals, but I want a safe rollout preview before you build anything."

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: module_index),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        self.assertEqual(derived.get("affected_modules"), ["invoices", "quotes"])
        self.assertNotIn("sales", derived.get("affected_modules") or [])
        self.assertEqual((plan.get("planner_state") or {}).get("requested_module_labels"), ["Invoices", "Quotes"])
        self.assertFalse((plan.get("planner_state") or {}).get("missing_module_labels"))
        self.assertEqual(main._ai_preview_track_modules(message, module_index), ["quotes", "invoices"])

    def test_long_guide_service_business_request_stays_in_preview_flow(self) -> None:
        main._octo_ai_seed_in_memory_baseline_modules()
        req = type("R", (), {"state": type("S", (), {"cache": {}})()})()
        module_index = _ai_module_manifest_index(req)
        message = (
            "Use this guide to design the workspace: We run a service business with leads, site visits, quotes, jobs, "
            "technicians, suppliers, invoices, and follow-up care. We need intake through completion, strong handoffs, "
            "customer history, technician schedules, supplier tracking, and operational reporting. Explain the phased "
            "system you would build, which modules are involved, and what you would deliver first before applying anything."
        )

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: module_index),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        self.assertEqual((plan.get("required_question_meta") or {}).get("id"), "confirm_plan")
        self.assertEqual(plan.get("candidate_operations"), [])
        self.assertFalse(plan.get("resolved_without_changes"))
        self.assertIn("field_service", derived.get("affected_modules") or [])
        text = _ai_plan_assistant_text(
            plan,
            {
                "request_summary": message,
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": module_id, "manifest": (module_index.get(module_id) or {}).get("manifest")}
                    for module_id in (derived.get("affected_modules") or [])
                ],
            },
        )
        self.assertIn("phased", text.lower())
        self.assertIn("Leads", text)
        self.assertIn("Quotes", text)
        self.assertIn("Jobs", text)
        self.assertIn("Invoices", text)
        self.assertIn("Phase 1", text)
        self.assertIn("Recommended module architecture", text)
        self.assertIn("multi-module workspace", text)
        self.assertNotIn("What should the new field be called?", text)

    def test_long_guide_manufacturing_request_mentions_build_roadmap(self) -> None:
        main._octo_ai_seed_in_memory_baseline_modules()
        req = type("R", (), {"state": type("S", (), {"cache": {}})()})()
        module_index = _ai_module_manifest_index(req)
        message = (
            "Plan a manufacturing workspace from this brief: sales orders feed production jobs, production consumes stock, "
            "purchasing replenishes parts, quality checks sign off each stage, and dispatch confirms delivery. I want a "
            "plain-English build roadmap, the modules you would create or change, and the rollout order before anything is built."
        )

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: module_index),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        self.assertEqual((plan.get("required_question_meta") or {}).get("id"), "confirm_plan")
        self.assertEqual(plan.get("candidate_operations"), [])
        text = _ai_plan_assistant_text(
            plan,
            {
                "request_summary": message,
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": module_id, "manifest": (module_index.get(module_id) or {}).get("manifest")}
                    for module_id in (derived.get("affected_modules") or [])
                ],
            },
        )
        self.assertIn("build roadmap", text.lower())
        self.assertIn("Sales Orders", text)
        self.assertIn("Production", text)
        self.assertIn("Purchasing", text)
        self.assertIn("Dispatch", text)
        self.assertIn("Phase 1", text)
        self.assertNotIn("What should the new field be called?", text)

    def test_requirements_document_prompt_uses_final_ask_not_background_document_noise(self) -> None:
        main._octo_ai_seed_in_memory_baseline_modules()
        req = type("R", (), {"state": type("S", (), {"cache": {}})()})()
        module_index = _ai_module_manifest_index(req)
        requirements_doc = Path("manifests/AUSPAC_INSURANCE_V1_REQUIREMENTS.md").read_text(encoding="utf-8")
        message = (
            requirements_doc
            + "\n\nTake this requirements document and build AusPac Insurance Jobs v1 as an OCTO app. "
            + "Include the main job workflow, supporting activity and rate line records, insurer/customer/installer relationships, "
            + "scheduling and confirmation tracking, quote/proposal checkpoints, completion/reporting, invoice tracking, "
            + "and useful dashboards. Show me the draft plan first."
        )

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: module_index),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        self.assertEqual((plan.get("required_question_meta") or {}).get("id"), "confirm_plan")
        self.assertEqual(plan.get("candidate_operations"), [])
        self.assertEqual((plan.get("planner_state") or {}).get("intent"), "preview_only_plan")
        self.assertIn("sales", derived.get("affected_modules") or [])
        text = _ai_plan_assistant_text(
            plan,
            {
                "request_summary": message,
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": module_id, "manifest": (module_index.get(module_id) or {}).get("manifest")}
                    for module_id in (derived.get("affected_modules") or [])
                ],
            },
        )
        self.assertIn("Quotes", text)
        self.assertIn("Jobs", text)
        self.assertIn("Invoices", text)
        self.assertIn("Recommended module architecture", text)
        self.assertIn("multi-module workspace", text)
        self.assertNotIn("Xero integration", text)
        self.assertNotIn("Production", text)
        self.assertNotIn("Purchasing", text)

    def test_structured_plan_adds_architecture_decisions_and_first_delivery_slice_for_preview_brief(self) -> None:
        plan = {
            "planner_state": {
                "intent": "preview_only_plan",
                "request_summary": (
                    "Use this guide to design the workspace: We run a service business with leads, quotes, jobs, "
                    "technicians, invoices, and follow-up care. Explain the phased system and what you would deliver first."
                ),
            },
            "affected_artifacts": [
                {"artifact_type": "module", "artifact_id": "crm"},
                {"artifact_type": "module", "artifact_id": "sales"},
                {"artifact_type": "module", "artifact_id": "jobs"},
                {"artifact_type": "module", "artifact_id": "invoices"},
            ],
            "proposed_changes": [],
            "required_questions": ["Confirm this plan?"],
            "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
        }
        context = {
            "request_summary": plan["planner_state"]["request_summary"],
            "full_selected_artifacts": [
                {"artifact_type": "module", "artifact_id": "crm", "manifest": {"module": {"name": "CRM"}}},
                {"artifact_type": "module", "artifact_id": "sales", "manifest": {"module": {"name": "Sales"}}},
                {"artifact_type": "module", "artifact_id": "jobs", "manifest": {"module": {"name": "Jobs"}}},
                {"artifact_type": "module", "artifact_id": "invoices", "manifest": {"module": {"name": "Invoices"}}},
            ],
        }

        structured = _ai_build_structured_plan(plan, context)

        self.assertIn("Treat this as a coordinated multi-module workspace, not one oversized module.", structured["architecture_decisions"])
        self.assertTrue(any(item.startswith("Phase 1: deliver ") for item in structured["first_delivery_slice"]))
        sections = {item["key"]: item["items"] for item in structured["sections"]}
        self.assertIn("architecture", sections)
        self.assertIn("first_delivery", sections)

    def test_preview_plan_prefers_reuse_then_new_module_when_scope_is_mixed(self) -> None:
        plan = {
            "planner_state": {
                "intent": "preview_only_plan",
                "request_summary": "Plan a contractor compliance rollout that extends Contacts and adds Compliance for approvals and expiry reminders.",
                "requested_module_labels": ["Contacts", "Compliance"],
                "missing_module_labels": ["Compliance"],
            },
            "affected_artifacts": [
                {"artifact_type": "module", "artifact_id": "contacts"},
            ],
            "proposed_changes": [],
            "required_questions": ["Confirm this plan?"],
            "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
        }
        context = {
            "request_summary": plan["planner_state"]["request_summary"],
            "full_selected_artifacts": [
                {"artifact_type": "module", "artifact_id": "contacts", "manifest": {"module": {"name": "Contacts"}}},
            ],
        }

        structured = _ai_build_structured_plan(plan, context)

        self.assertTrue(
            any("Reuse existing Contacts" in item and "Compliance" in item for item in structured["architecture_decisions"])
        )
        self.assertTrue(
            any(item.startswith("Phase 1: extend Contacts first, then add Compliance") for item in structured["first_delivery_slice"])
        )

    def test_clockify_replacement_brief_prefers_reuse_minimal_modules_and_existing_platform_patterns(self) -> None:
        contacts_manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [],
            "views": [],
        }
        module_index = {"contacts": {"manifest": contacts_manifest}}
        message = (
            "We want to build a minimal internal time tracking + invoicing suite in Octodrop so we can replace Clockify for our own company workflow.\n\n"
            "Architecture decision\n\n"
            "Reuse the shared contacts module for client records.\n\n"
            "Build only 2 custom modules:\n\n"
            "work_management\n"
            "billing\n\n"
            "Important platform rule\n\n"
            "For v1, do not introduce kernel-level timer infrastructure.\n\n"
            "Build order\n\n"
            "Implement in this order:\n\n"
            "reuse shared contacts\n"
            "build work_management\n"
            "build billing\n"
            "build invoice PDF template\n"
            "build invoice creation flow from selected billable time entries\n\n"
            "Show me the draft plan first."
        )

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: module_index),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        self.assertEqual((plan.get("planner_state") or {}).get("intent"), "preview_only_plan")
        self.assertEqual((plan.get("planner_state") or {}).get("requested_module_labels"), ["Contacts", "Work Management", "Billing"])
        self.assertEqual((plan.get("planner_state") or {}).get("missing_module_labels"), ["Work Management", "Billing"])
        self.assertEqual(derived.get("affected_modules"), ["contacts"])

        structured = _ai_build_structured_plan(
            plan,
            {
                "request_summary": message,
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "contacts", "manifest": contacts_manifest},
                ],
            },
        )

        self.assertTrue(
            any("Reuse existing Contacts" in item and "Work Management" in item and "Billing" in item for item in structured["architecture_decisions"])
        )
        self.assertTrue(
            any("kernel or runtime infrastructure" in item for item in structured["architecture_decisions"])
        )
        self.assertTrue(
            any(item.startswith("Phase 1: start with reuse shared contacts and build Work Management") for item in structured["first_delivery_slice"])
        )
        self.assertTrue(
            any(item.startswith("Phase 2: follow with build Billing") for item in structured["first_delivery_slice"])
        )
        self.assertEqual(
            structured["operation_families"],
            ["create_module", "cross_module_change", "template_change"],
        )
        self.assertEqual(structured["primary_operation_family"], "create_module")

    def test_create_module_structured_plan_adds_first_delivery_slice(self) -> None:
        plan = {
            "planner_state": {
                "intent": "create_module",
                "module_name": "Equipment Servicing",
            },
            "affected_artifacts": [],
            "proposed_changes": [
                {
                    "op": "create_module",
                    "artifact_id": "equipment_servicing",
                    "design_spec": {
                        "experience": {"interfaces": ["dashboardable", "documentable"]},
                    },
                    "manifest": {
                        "module": {"name": "Equipment Servicing"},
                    },
                }
            ],
            "required_questions": ["Confirm this plan?"],
            "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
        }

        structured = _ai_build_structured_plan(plan, {"request_summary": "Create a new equipment servicing module."})

        self.assertIn("Start with one strong module for Equipment Servicing before splitting anything further.", structured["architecture_decisions"])
        self.assertIn(
            "Phase 1: land the core Equipment Servicing record, workflow, and starter views before any downstream automations or templates.",
            structured["first_delivery_slice"],
        )

    def test_project_handover_connector_brief_prefers_preview_only_plan(self) -> None:
        module_index = {
            "sales": {"manifest": {"module": {"id": "sales", "key": "sales", "name": "Sales"}, "entities": [], "views": []}},
            "jobs": {"manifest": {"module": {"id": "jobs", "key": "jobs", "name": "Jobs"}, "entities": [], "views": []}},
            "calendar": {"manifest": {"module": {"id": "calendar", "key": "calendar", "name": "Calendar"}, "entities": [], "views": []}},
            "documents": {"manifest": {"module": {"id": "documents", "key": "documents", "name": "Documents"}, "entities": [], "views": []}},
        }
        message = (
            "Set up a project handover process that links Sales, Jobs, Calendar, and Documents "
            "so operations has everything before work starts."
        )

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: module_index),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        self.assertEqual((plan.get("required_question_meta") or {}).get("id"), "confirm_plan")
        self.assertEqual((plan.get("planner_state") or {}).get("intent"), "preview_only_plan")
        self.assertEqual(derived.get("affected_modules"), ["sales", "jobs", "calendar", "documents"])
        text = _ai_plan_assistant_text(
            plan,
            {
                "request_summary": message,
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": module_id, "manifest": (module_index.get(module_id) or {}).get("manifest")}
                    for module_id in (derived.get("affected_modules") or [])
                ],
            },
        )
        self.assertIn("Plan a preview-first rollout across Sales, Jobs, Calendar, and Documents.", text)
        self.assertIn("Planned changes:", text)
        self.assertNotIn("Which module should receive this change?", text)

    def test_confirmed_preview_only_plan_becomes_patchset_safe_noop(self) -> None:
        sales_manifest = {
            "module": {"id": "sales", "key": "sales", "name": "Sales"},
            "entities": [{"id": "entity.quote", "label": "Quote", "fields": [{"id": "quote.status", "label": "Status", "type": "enum"}]}],
            "views": [],
            "app": {"nav": [{"group": "Sales", "items": [{"label": "Quotes", "to": "page:quote.list_page"}]}]},
        }
        module_index = {"sales": {"manifest": sales_manifest}}

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: module_index),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                "We need to change invoicing and quote approvals, but I want a safe rollback path if the new flow confuses staff. Explain the validation and rollback plan before you build it.",
                answer_hints={"confirm_plan": True, "answer_text": "Approved."},
            )

        self.assertEqual(derived.get("affected_modules"), ["sales"])
        self.assertEqual(plan.get("required_questions"), [])
        self.assertTrue(plan.get("resolved_without_changes"))
        self.assertEqual((plan.get("planner_state") or {}).get("intent"), "preview_only_noop")
        context = {
            "request_summary": "We need to change invoicing and quote approvals, but I want a safe rollback path if the new flow confuses staff. Explain the validation and rollback plan before you build it.",
            "full_selected_artifacts": [
                {"artifact_type": "module", "artifact_id": "sales", "manifest": sales_manifest},
            ],
        }
        reason = main._ai_noop_reason_text(
            plan,
            context,
        )
        self.assertIn("planning-only draft", reason)
        text = _ai_plan_assistant_text(plan, context)
        self.assertIn("planning-only", text)
        self.assertIn("draft patchset", text)
        self.assertNotIn("No changes are needed right now.", text)
        validation = _ai_validate_patchset_against_workspace(
            None,
            {"patch_json": {"operations": [], "noop": True, "reason": reason}},
        )
        self.assertTrue(validation.get("ok"))
        warning_message = (validation.get("warnings") or [{}])[0].get("message", "")
        self.assertIn("planning-only draft", warning_message)
        self.assertNotIn("No changes were required.", warning_message)

    def test_preview_only_request_with_only_missing_modules_stays_truthful_and_patchset_safe(self) -> None:
        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: {}),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                "For Invoices and Quotes, walk me through the sandbox, validation, and rollback plan before you build anything.",
                answer_hints={},
            )

        self.assertEqual(derived.get("affected_modules"), [])
        self.assertEqual((plan.get("required_question_meta") or {}).get("id"), "confirm_plan")
        self.assertEqual((plan.get("planner_state") or {}).get("requested_module_labels"), ["Invoices", "Quotes"])
        self.assertEqual((plan.get("planner_state") or {}).get("missing_module_labels"), ["Invoices", "Quotes"])

        text = _ai_plan_assistant_text(
            plan,
            {
                "request_summary": "For Invoices and Quotes, walk me through the sandbox, validation, and rollback plan before you build anything.",
                "full_selected_artifacts": [],
            },
        )
        self.assertIn("Plan a preview-first rollout across Invoices and Quotes.", text)
        self.assertIn("Invoices and Quotes", text)
        self.assertIn("do not currently exist in this workspace", text)
        self.assertIn("sandbox", text.lower())
        self.assertIn("validation", text.lower())
        self.assertIn("rollback", text.lower())

        with (
            patch.object(main, "_resolve_actor", lambda _request: {
                "user_id": "test-user",
                "email": "test@example.com",
                "role": "admin",
                "workspace_role": "admin",
                "platform_role": "superadmin",
                "workspace_id": "default",
                "workspaces": [{"workspace_id": "default", "role": "admin", "workspace_name": "Default"}],
                "claims": {},
            }),
            patch.object(main, "_ai_module_manifest_index", lambda _request: {}),
        ):
            client = TestClient(main.app)
            session = _ai_create_record(
                _AI_ENTITY_SESSION,
                {
                    "title": "preview_only_missing_modules",
                    "status": "ready_to_apply",
                    "scope_mode": "auto",
                    "selected_artifact_type": "none",
                    "selected_artifact_key": "",
                    "last_activity_at": "2026-03-18T00:00:00Z",
                },
            )
            session_id = _ai_record_data(session)["id"]
            plan_record = _ai_create_record(
                _AI_ENTITY_PLAN,
                {
                    "session_id": session_id,
                    "created_at": "2026-03-18T00:01:00Z",
                    "questions_json": [],
                    "required_question_meta": None,
                    "affected_artifacts_json": [],
                    "plan_json": {
                        "plan": {
                            "required_questions": [],
                            "candidate_operations": [],
                            "resolved_without_changes": True,
                            "planner_state": {
                                "intent": "preview_only_noop",
                                "requested_module_labels": ["Invoices", "Quotes"],
                                "missing_module_labels": ["Invoices", "Quotes"],
                            },
                            "affected_artifacts": [],
                        },
                        "context": {"full_selected_artifacts": []},
                    },
                },
            )
            _ai_update_record(_AI_ENTITY_SESSION, session_id, {"latest_plan_id": _ai_record_data(plan_record)["id"]})

            response = client.post(f"/octo-ai/sessions/{session_id}/patchsets/generate", json={})
            body = response.json()

        self.assertTrue(body.get("ok"), body)
        patchset = body.get("patchset") or {}
        reason = ((patchset.get("patch_json") or {}).get("reason") or "")
        self.assertIn("Invoices and Quotes", reason)
        self.assertIn("not currently in this workspace", reason)

        validation = _ai_validate_patchset_against_workspace(None, patchset)
        self.assertTrue(validation.get("ok"))
        warning_message = (validation.get("warnings") or [{}])[0].get("message", "")
        self.assertIn("Invoices and Quotes", warning_message)
        self.assertIn("not currently in this workspace", warning_message)

    def test_field_spec_answer_can_restart_as_new_request(self) -> None:
        actor = {
            "user_id": "test-user",
            "email": "test@example.com",
            "role": "admin",
            "workspace_role": "admin",
            "platform_role": "superadmin",
            "workspace_id": "default",
            "workspaces": [{"workspace_id": "default", "role": "admin", "workspace_name": "Default"}],
            "claims": {},
        }
        with patch.object(main, "_resolve_actor", lambda _request: actor):
            client = TestClient(main.app)
            main._octo_ai_seed_in_memory_baseline_modules()
            session = _ai_create_record(
                _AI_ENTITY_SESSION,
                {
                    "title": "field_spec_restart",
                    "status": "waiting_input",
                    "scope_mode": "auto",
                    "selected_artifact_type": "none",
                    "selected_artifact_key": "",
                    "last_activity_at": "2026-03-18T00:00:00Z",
                },
            )
            session_id = _ai_record_data(session)["id"]
            _ai_create_record(
                _AI_ENTITY_MESSAGE,
                {
                    "session_id": session_id,
                    "role": "user",
                    "message_type": "chat",
                    "body": "Add a field to the Contacts module.",
                    "created_at": "2026-03-18T00:00:00Z",
                },
            )
            plan = _ai_create_record(
                _AI_ENTITY_PLAN,
                {
                    "session_id": session_id,
                    "created_at": "2026-03-18T00:01:00Z",
                    "questions_json": ["What should the new field be called?"],
                    "required_question_meta": {"id": "field_spec", "kind": "field_spec", "prompt": "What should the new field be called?"},
                    "affected_artifacts_json": [{"artifact_type": "module", "artifact_id": "contacts"}],
                    "plan_json": {
                        "plan": {
                            "required_questions": ["What should the new field be called?"],
                            "required_question_meta": {"id": "field_spec", "kind": "field_spec", "prompt": "What should the new field be called?"},
                            "planner_state": {"intent": "add_field", "module_id": "contacts"},
                        }
                    },
                },
            )
            _ai_update_record(_AI_ENTITY_SESSION, session_id, {"latest_plan_id": _ai_record_data(plan)["id"]})

            answer_res = client.post(
                f"/octo-ai/sessions/{session_id}/questions/answer",
                json={"action": "custom", "text": "Actually add Status in Jobs instead."},
            )
            answer_body = answer_res.json()
            self.assertTrue(answer_body.get("ok"), answer_body)
            plan = answer_body.get("plan") or {}
            affected = [item.get("artifact_id") for item in (plan.get("affected_artifacts") or []) if isinstance(item, dict)]
            self.assertIn("jobs", affected)
            self.assertNotEqual((plan.get("required_question_meta") or {}).get("id"), "field_spec")
            self.assertIn("Jobs", answer_body.get("assistant_text") or "")
            self.assertIn("Status", answer_body.get("assistant_text") or "")

    def test_field_spec_answer_short_scope_switch_restarts_without_error(self) -> None:
        actor = {
            "user_id": "test-user",
            "email": "test@example.com",
            "role": "admin",
            "workspace_role": "admin",
            "platform_role": "superadmin",
            "workspace_id": "default",
            "workspaces": [{"workspace_id": "default", "role": "admin", "workspace_name": "Default"}],
            "claims": {},
        }
        with patch.object(main, "_resolve_actor", lambda _request: actor):
            client = TestClient(main.app)
            main._octo_ai_seed_in_memory_baseline_modules()
            session = _ai_create_record(
                _AI_ENTITY_SESSION,
                {
                    "title": "field_spec_short_scope_switch",
                    "status": "waiting_input",
                    "scope_mode": "auto",
                    "selected_artifact_type": "none",
                    "selected_artifact_key": "",
                    "last_activity_at": "2026-03-18T00:00:00Z",
                },
            )
            session_id = _ai_record_data(session)["id"]
            _ai_create_record(
                _AI_ENTITY_MESSAGE,
                {
                    "session_id": session_id,
                    "role": "user",
                    "message_type": "chat",
                    "body": "Add a field to the Contacts module.",
                    "created_at": "2026-03-18T00:00:00Z",
                },
            )
            plan = _ai_create_record(
                _AI_ENTITY_PLAN,
                {
                    "session_id": session_id,
                    "created_at": "2026-03-18T00:01:00Z",
                    "questions_json": ["What should the new field be called?"],
                    "required_question_meta": {"id": "field_spec", "kind": "field_spec", "prompt": "What should the new field be called?"},
                    "affected_artifacts_json": [{"artifact_type": "module", "artifact_id": "contacts"}],
                    "plan_json": {
                        "plan": {
                            "required_questions": ["What should the new field be called?"],
                            "required_question_meta": {"id": "field_spec", "kind": "field_spec", "prompt": "What should the new field be called?"},
                            "planner_state": {"intent": "add_field", "module_id": "contacts"},
                        }
                    },
                },
            )
            _ai_update_record(_AI_ENTITY_SESSION, session_id, {"latest_plan_id": _ai_record_data(plan)["id"]})

            answer_res = client.post(
                f"/octo-ai/sessions/{session_id}/questions/answer",
                json={"action": "custom", "text": "Use Jobs instead."},
            )
            answer_body = answer_res.json()

        self.assertTrue(answer_body.get("ok"), answer_body)
        plan = answer_body.get("plan") or {}
        affected = [item.get("artifact_id") for item in (plan.get("affected_artifacts") or []) if isinstance(item, dict)]
        self.assertEqual(affected, ["jobs"])
        self.assertEqual((plan.get("required_question_meta") or {}).get("id"), "field_spec")
        self.assertIn("Jobs", answer_body.get("assistant_text") or "")

    def test_confirm_plan_answer_accepts_plain_english_approval(self) -> None:
        actor = {
            "user_id": "test-user",
            "email": "test@example.com",
            "role": "admin",
            "workspace_role": "admin",
            "platform_role": "superadmin",
            "workspace_id": "default",
            "workspaces": [{"workspace_id": "default", "role": "admin", "workspace_name": "Default"}],
            "claims": {},
        }
        with patch.object(main, "_resolve_actor", lambda _request: actor):
            client = TestClient(main.app)
            main._octo_ai_seed_in_memory_baseline_modules()
            session = _ai_create_record(
                _AI_ENTITY_SESSION,
                {
                    "title": "confirm_plan_approval",
                    "status": "waiting_input",
                    "scope_mode": "auto",
                    "selected_artifact_type": "none",
                    "selected_artifact_key": "",
                    "last_activity_at": "2026-03-18T00:00:00Z",
                },
            )
            session_id = _ai_record_data(session)["id"]
            _ai_create_record(
                _AI_ENTITY_MESSAGE,
                {
                    "session_id": session_id,
                    "role": "user",
                    "message_type": "chat",
                    "body": "Add an Escalation Note field to the Contacts module.",
                    "created_at": "2026-03-18T00:00:00Z",
                },
            )
            plan = _ai_create_record(
                _AI_ENTITY_PLAN,
                {
                    "session_id": session_id,
                    "created_at": "2026-03-18T00:01:00Z",
                    "questions_json": ["Confirm this plan?"],
                    "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan", "prompt": "Confirm this plan or tell me what to change."},
                    "affected_artifacts_json": [{"artifact_type": "module", "artifact_id": "contacts"}],
                    "plan_json": {
                        "plan": {
                            "required_questions": ["Confirm this plan?"],
                            "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan", "prompt": "Confirm this plan or tell me what to change."},
                            "candidate_operations": [
                                {
                                    "op": "add_field",
                                    "artifact_type": "module",
                                    "artifact_id": "contacts",
                                    "entity_id": "entity.contact",
                                    "field": {"id": "contact.escalation_note", "label": "Escalation Note", "type": "text"},
                                }
                            ],
                            "affected_artifacts": [{"artifact_type": "module", "artifact_id": "contacts"}],
                            "planner_state": {
                                "intent": "add_field",
                                "module_id": "contacts",
                                "field_label": "Escalation Note",
                                "field_id": "contact.escalation_note",
                            },
                        }
                    },
                },
            )
            _ai_update_record(_AI_ENTITY_SESSION, session_id, {"latest_plan_id": _ai_record_data(plan)["id"]})

            answer_res = client.post(
                f"/octo-ai/sessions/{session_id}/questions/answer",
                json={"action": "custom", "text": "Looks right, generate the draft patchset."},
            )
            answer_body = answer_res.json()

        self.assertTrue(answer_body.get("ok"), answer_body)
        plan = answer_body.get("plan") or {}
        self.assertEqual(plan.get("required_questions"), [])
        self.assertNotEqual((plan.get("required_question_meta") or {}).get("id"), "confirm_plan")
        op_names = [op.get("op") for op in (plan.get("candidate_operations") or []) if isinstance(op, dict)]
        self.assertIn("add_field", op_names)
        self.assertIn("Plan approved.", answer_body.get("assistant_text") or "")
        self.assertIn("Next step: Apply to Sandbox.", answer_body.get("assistant_text") or "")
        self.assertNotIn("I understand this as:", answer_body.get("assistant_text") or "")
        self.assertNotIn("draft patchset for sandbox validation", answer_body.get("assistant_text") or "")

    def test_confirm_plan_answer_accepts_plain_english_approval_when_meta_is_missing(self) -> None:
        actor = {
            "user_id": "test-user",
            "email": "test@example.com",
            "role": "admin",
            "workspace_role": "admin",
            "platform_role": "superadmin",
            "workspace_id": "default",
            "workspaces": [{"workspace_id": "default", "role": "admin", "workspace_name": "Default"}],
            "claims": {},
        }
        with patch.object(main, "_resolve_actor", lambda _request: actor):
            client = TestClient(main.app)
            main._octo_ai_seed_in_memory_baseline_modules()
            session = _ai_create_record(
                _AI_ENTITY_SESSION,
                {
                    "title": "confirm_plan_approval_missing_meta",
                    "status": "waiting_input",
                    "scope_mode": "auto",
                    "selected_artifact_type": "none",
                    "selected_artifact_key": "",
                    "last_activity_at": "2026-03-18T00:00:00Z",
                },
            )
            session_id = _ai_record_data(session)["id"]
            _ai_create_record(
                _AI_ENTITY_MESSAGE,
                {
                    "session_id": session_id,
                    "role": "user",
                    "message_type": "chat",
                    "body": "Add an Escalation Note field to the Contacts module.",
                    "created_at": "2026-03-18T00:00:00Z",
                },
            )
            plan = _ai_create_record(
                _AI_ENTITY_PLAN,
                {
                    "session_id": session_id,
                    "created_at": "2026-03-18T00:01:00Z",
                    "questions_json": ["Confirm this plan?"],
                    "required_question_meta": None,
                    "affected_artifacts_json": [{"artifact_type": "module", "artifact_id": "contacts"}],
                    "plan_json": {
                        "plan": {
                            "required_questions": ["Confirm this plan?"],
                            "required_question_meta": None,
                            "candidate_operations": [
                                {
                                    "op": "add_field",
                                    "artifact_type": "module",
                                    "artifact_id": "contacts",
                                    "entity_id": "entity.contact",
                                    "field": {"id": "contact.escalation_note", "label": "Escalation Note", "type": "text"},
                                }
                            ],
                            "affected_artifacts": [{"artifact_type": "module", "artifact_id": "contacts"}],
                            "planner_state": {
                                "intent": "add_field",
                                "module_id": "contacts",
                                "field_label": "Escalation Note",
                                "field_id": "contact.escalation_note",
                            },
                        }
                    },
                },
            )
            _ai_update_record(_AI_ENTITY_SESSION, session_id, {"latest_plan_id": _ai_record_data(plan)["id"]})

            answer_res = client.post(
                f"/octo-ai/sessions/{session_id}/questions/answer",
                json={"action": "custom", "text": "Approved."},
            )
            answer_body = answer_res.json()

        self.assertTrue(answer_body.get("ok"), answer_body)
        plan = answer_body.get("plan") or {}
        self.assertEqual(plan.get("required_questions"), [])
        op_names = [op.get("op") for op in (plan.get("candidate_operations") or []) if isinstance(op, dict)]
        self.assertIn("add_field", op_names)
        self.assertIn("Plan confirmed.", answer_body.get("assistant_text") or "")
        self.assertIn("draft patchset for sandbox validation", answer_body.get("assistant_text") or "")

    def test_confirm_plan_approval_parser_accepts_ship_it_style_phrases(self) -> None:
        self.assertTrue(main._ai_text_is_approval_response("Works for me, ship it."))
        self.assertTrue(main._ai_text_is_approval_response("All good, let's do it."))
        self.assertTrue(main._ai_text_is_approval_response("Ready to go."))

    def test_confirm_plan_revision_parser_treats_tweak_language_as_revision(self) -> None:
        self.assertTrue(_ai_text_includes_revision_request("One tweak: add a Priority field.", {}))
        self.assertTrue(_ai_text_includes_revision_request("Small change, move it to the Summary tab.", {}))
        self.assertFalse(_ai_text_includes_revision_request("Works for me, ship it.", {}))

    def test_confirm_plan_answer_accepts_create_module_approval_when_module_is_pending_only(self) -> None:
        actor = {
            "user_id": "test-user",
            "email": "test@example.com",
            "role": "admin",
            "workspace_role": "admin",
            "platform_role": "superadmin",
            "workspace_id": "default",
            "workspaces": [{"workspace_id": "default", "role": "admin", "workspace_name": "Default"}],
            "claims": {},
        }
        with patch.object(main, "_resolve_actor", lambda _request: actor):
            client = TestClient(main.app)
            main._octo_ai_seed_in_memory_baseline_modules()
            manifest = main._ai_build_new_module_scaffold(
                "candidate_pipeline",
                "Candidate Pipeline",
                "Create a recruitment module called Candidate Pipeline with stage flow Applied, Screen, Interview, Offer, Hired and kanban-first pipeline support.",
            )
            session = _ai_create_record(
                _AI_ENTITY_SESSION,
                {
                    "title": "confirm_plan_create_module_approval",
                    "status": "waiting_input",
                    "scope_mode": "auto",
                    "selected_artifact_type": "none",
                    "selected_artifact_key": "",
                    "last_activity_at": "2026-03-18T00:00:00Z",
                },
            )
            session_id = _ai_record_data(session)["id"]
            _ai_create_record(
                _AI_ENTITY_MESSAGE,
                {
                    "session_id": session_id,
                    "role": "user",
                    "message_type": "chat",
                    "body": "Create a recruitment module called Candidate Pipeline with stage flow Applied, Screen, Interview, Offer, Hired and kanban-first pipeline support.",
                    "created_at": "2026-03-18T00:00:00Z",
                },
            )
            plan = _ai_create_record(
                _AI_ENTITY_PLAN,
                {
                    "session_id": session_id,
                    "created_at": "2026-03-18T00:01:00Z",
                    "questions_json": ["Confirm this plan?"],
                    "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan", "prompt": "Confirm this plan or tell me what to change."},
                    "affected_artifacts_json": [{"artifact_type": "module", "artifact_id": "candidate_pipeline"}],
                    "plan_json": {
                        "plan": {
                            "required_questions": ["Confirm this plan?"],
                            "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan", "prompt": "Confirm this plan or tell me what to change."},
                            "candidate_operations": [
                                {
                                    "op": "create_module",
                                    "artifact_type": "module",
                                    "artifact_id": "candidate_pipeline",
                                    "manifest": manifest,
                                }
                            ],
                            "affected_artifacts": [{"artifact_type": "module", "artifact_id": "candidate_pipeline"}],
                            "planner_state": {
                                "intent": "create_module",
                                "module_id": "candidate_pipeline",
                                "module_name": "Candidate Pipeline",
                            },
                        }
                    },
                },
            )
            _ai_update_record(_AI_ENTITY_SESSION, session_id, {"latest_plan_id": _ai_record_data(plan)["id"]})

            answer_res = client.post(
                f"/octo-ai/sessions/{session_id}/questions/answer",
                json={"action": "custom", "text": "Approved."},
            )
            answer_body = answer_res.json()

        self.assertTrue(answer_body.get("ok"), answer_body)
        plan = answer_body.get("plan") or {}
        self.assertEqual(plan.get("required_questions"), [])
        self.assertEqual([op.get("op") for op in (plan.get("candidate_operations") or []) if isinstance(op, dict)], ["create_module"])
        self.assertEqual([item.get("artifact_id") for item in (plan.get("affected_artifacts") or []) if isinstance(item, dict)], ["candidate_pipeline"])
        self.assertIn("Candidate Pipeline", answer_body.get("assistant_text") or "")
        self.assertIn("Plan confirmed.", answer_body.get("assistant_text") or "")
        self.assertIn("draft patchset for sandbox validation", answer_body.get("assistant_text") or "")

    def test_confirm_plan_revision_reply_reprompts_for_confirmation(self) -> None:
        actor = {
            "user_id": "test-user",
            "email": "test@example.com",
            "role": "admin",
            "workspace_role": "admin",
            "platform_role": "superadmin",
            "workspace_id": "default",
            "workspaces": [{"workspace_id": "default", "role": "admin", "workspace_name": "Default"}],
            "claims": {},
        }
        with patch.object(main, "_resolve_actor", lambda _request: actor):
            client = TestClient(main.app)
            main._octo_ai_seed_in_memory_baseline_modules()
            session = _ai_create_record(
                _AI_ENTITY_SESSION,
                {
                    "title": "confirm_plan_revision",
                    "status": "waiting_input",
                    "scope_mode": "auto",
                    "selected_artifact_type": "none",
                    "selected_artifact_key": "",
                    "last_activity_at": "2026-03-18T00:00:00Z",
                },
            )
            session_id = _ai_record_data(session)["id"]
            _ai_create_record(
                _AI_ENTITY_MESSAGE,
                {
                    "session_id": session_id,
                    "role": "user",
                    "message_type": "chat",
                    "body": "Add an Escalation Note field to the Contacts module.",
                    "created_at": "2026-03-18T00:00:00Z",
                },
            )
            plan = _ai_create_record(
                _AI_ENTITY_PLAN,
                {
                    "session_id": session_id,
                    "created_at": "2026-03-18T00:01:00Z",
                    "questions_json": ["Confirm this plan?"],
                    "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan", "prompt": "Confirm this plan or tell me what to change."},
                    "affected_artifacts_json": [{"artifact_type": "module", "artifact_id": "contacts"}],
                    "plan_json": {
                        "plan": {
                            "required_questions": ["Confirm this plan?"],
                            "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan", "prompt": "Confirm this plan or tell me what to change."},
                            "candidate_operations": [
                                {
                                    "op": "add_field",
                                    "artifact_type": "module",
                                    "artifact_id": "contacts",
                                    "entity_id": "entity.contact",
                                    "field": {"id": "contact.escalation_note", "label": "Escalation Note", "type": "text"},
                                }
                            ],
                            "affected_artifacts": [{"artifact_type": "module", "artifact_id": "contacts"}],
                            "planner_state": {
                                "intent": "add_field",
                                "module_id": "contacts",
                                "field_label": "Escalation Note",
                                "field_id": "contact.escalation_note",
                            },
                        }
                    },
                },
            )
            _ai_update_record(_AI_ENTITY_SESSION, session_id, {"latest_plan_id": _ai_record_data(plan)["id"]})

            answer_res = client.post(
                f"/octo-ai/sessions/{session_id}/questions/answer",
                json={"action": "custom", "text": "Looks right, but also add a Priority field to Contacts."},
            )
            answer_body = answer_res.json()

        self.assertTrue(answer_body.get("ok"), answer_body)
        plan = answer_body.get("plan") or {}
        self.assertEqual((plan.get("required_question_meta") or {}).get("id"), "confirm_plan")
        self.assertEqual(plan.get("required_questions"), ["Confirm this plan?"])
        labels = [
            ((op.get("field") or {}).get("label"))
            for op in (plan.get("candidate_operations") or [])
            if isinstance(op, dict) and op.get("op") == "add_field"
        ]
        self.assertIn("Escalation Note", labels)
        self.assertIn("Priority", labels)
        self.assertIn("If this looks right, confirm the plan", answer_body.get("assistant_text") or "")
        self.assertNotIn("Plan confirmed.", answer_body.get("assistant_text") or "")

    def test_collect_answer_hints_does_not_guess_one_module_from_cross_module_plan(self) -> None:
        session = _ai_create_record(
            _AI_ENTITY_SESSION,
            {
                "status": "planning",
                "summary": "",
                "last_activity_at": "2026-03-18T00:00:00Z",
            },
        )
        session_id = _ai_record_data(session)["id"]
        plan = _ai_create_record(
            _AI_ENTITY_PLAN,
            {
                "session_id": session_id,
                "created_at": "2026-03-18T00:00:00Z",
                "affected_artifacts_json": [
                    {"artifact_type": "module", "artifact_id": "contacts"},
                    {"artifact_type": "module", "artifact_id": "jobs"},
                ],
                "plan_json": {"plan": {"planner_state": {"intent": "multi_request"}}},
            },
        )
        _ai_update_record(_AI_ENTITY_SESSION, session_id, {"latest_plan_id": _ai_record_data(plan)["id"]})
        _ai_create_record(
            _AI_ENTITY_MESSAGE,
            {
                "session_id": session_id,
                "role": "user",
                "message_type": "chat",
                "body": "Also add status.",
                "created_at": "2026-03-18T00:01:00Z",
            },
        )

        hints = _ai_collect_answer_hints(session_id)

        self.assertIsNone(hints.get("module_target"))

    def test_patchset_validation_rejects_unsupported_artifact_operations(self) -> None:
        validation = _ai_validate_patchset_against_workspace(
            None,
            {
                "patch_json": {
                    "operations": [
                        {"op": "add_field", "artifact_type": "automation", "artifact_id": "auto_1"},
                    ]
                }
            },
        )

        self.assertFalse(validation.get("ok"))
        self.assertEqual(validation.get("results"), [])
        self.assertEqual(validation.get("errors")[0].get("code"), "AI_PATCHSET_UNSUPPORTED_ARTIFACT")

    def test_generate_noop_patchset_keeps_plain_language_reason(self) -> None:
        actor = {
            "user_id": "test-user",
            "email": "test@example.com",
            "role": "admin",
            "workspace_role": "admin",
            "platform_role": "superadmin",
            "workspace_id": "default",
            "workspaces": [{"workspace_id": "default", "role": "admin", "workspace_name": "Default"}],
            "claims": {},
        }
        with patch.object(main, "_resolve_actor", lambda _request: actor):
            client = TestClient(main.app)
            session = _ai_create_record(
                _AI_ENTITY_SESSION,
                {
                    "title": "noop_reason",
                    "status": "ready_to_apply",
                    "scope_mode": "auto",
                    "selected_artifact_type": "none",
                    "selected_artifact_key": "",
                    "last_activity_at": "2026-03-18T00:00:00Z",
                },
            )
            session_id = _ai_record_data(session)["id"]
            plan = _ai_create_record(
                _AI_ENTITY_PLAN,
                {
                    "session_id": session_id,
                    "created_at": "2026-03-18T00:01:00Z",
                    "questions_json": [],
                    "required_question_meta": None,
                    "affected_artifacts_json": [{"artifact_type": "module", "artifact_id": "contacts"}],
                    "plan_json": {
                        "plan": {
                            "required_questions": [],
                            "candidate_operations": [],
                            "resolved_without_changes": True,
                            "planner_state": {"intent": "field_missing_noop", "field_ref": "contact.roblux"},
                            "affected_artifacts": [{"artifact_type": "module", "artifact_id": "contacts"}],
                        },
                        "context": {
                            "full_selected_artifacts": [
                                {
                                    "artifact_type": "module",
                                    "artifact_id": "contacts",
                                    "manifest": {
                                        "module": {"name": "Contacts"},
                                        "entities": [{"id": "entity.contact", "fields": [{"id": "contact.roblux", "label": "Roblux", "type": "string"}]}],
                                    },
                                }
                            ]
                        },
                    },
                },
            )
            _ai_update_record(_AI_ENTITY_SESSION, session_id, {"latest_plan_id": _ai_record_data(plan)["id"]})

            response = client.post(f"/octo-ai/sessions/{session_id}/patchsets/generate", json={})
            body = response.json()

        self.assertTrue(body.get("ok"), body)
        patchset = body.get("patchset") or {}
        reason = ((patchset.get("patch_json") or {}).get("reason") or "")
        self.assertIn("already absent", reason)
        self.assertNotIn("field_missing_noop", reason)

        validation = _ai_validate_patchset_against_workspace(None, patchset)
        self.assertTrue(validation.get("ok"))
        warning_message = (validation.get("warnings") or [{}])[0].get("message", "")
        self.assertIn("already absent", warning_message)
        self.assertNotIn("field_missing_noop", warning_message)

    def test_patchset_validation_accepts_create_module_with_follow_up_ops(self) -> None:
        with patch.object(main, "_ai_module_manifest_index", lambda _request: {}), patch.object(main, "_validate_dependency_state", lambda *_args, **_kwargs: ([], [])):
            validation = _ai_validate_patchset_against_workspace(
                None,
                {
                    "patch_json": {
                        "operations": [
                            {
                                "op": "create_module",
                                "artifact_type": "module",
                                "artifact_id": "vendor_compliance",
                                "manifest": {
                                    "manifest_version": "1.3",
                                    "module": {"id": "vendor_compliance", "name": "Vendor Compliance", "key": "vendor_compliance", "version": "0.1.0"},
                                    "app": {
                                        "home": "page:vendor.list_page",
                                        "nav": [{"group": "Vendor Compliance", "items": [{"label": "Vendor Compliance", "to": "page:vendor.list_page"}]}],
                                    },
                                    "entities": [
                                        {
                                            "id": "entity.vendor",
                                            "label": "Vendor",
                                            "fields": [
                                                {"id": "vendor.id", "label": "ID", "type": "uuid"},
                                                {"id": "vendor.name", "label": "Name", "type": "string"},
                                            ],
                                        }
                                    ],
                                    "views": [
                                        {
                                            "id": "vendor.form",
                                            "kind": "form",
                                            "entity": "entity.vendor",
                                            "sections": [{"id": "primary", "title": "Primary", "fields": ["vendor.name"]}],
                                        }
                                    ],
                                    "pages": [{"id": "vendor.list_page", "title": "Vendor Compliance", "content": []}],
                                    "actions": [],
                                    "relations": [],
                                },
                            },
                            {
                                "op": "add_field",
                                "artifact_type": "module",
                                "artifact_id": "vendor_compliance",
                                "entity_id": "entity.vendor",
                                "field": {"id": "vendor.due_date", "label": "Due Date", "type": "date"},
                            },
                            {
                                "op": "insert_section_field",
                                "artifact_type": "module",
                                "artifact_id": "vendor_compliance",
                                "view_id": "vendor.form",
                                "section_id": "primary",
                                "field_id": "vendor.due_date",
                            },
                        ]
                    }
                },
            )

        self.assertTrue(validation.get("ok"), validation)
        self.assertEqual(validation.get("errors"), [])
        self.assertEqual((validation.get("results") or [{}])[0].get("apply_mode"), "install")
        manifest = (validation.get("results") or [{}])[0].get("manifest") or {}
        vendor_entity = next(
            (
                entity
                for entity in (manifest.get("entities") or [])
                if isinstance(entity, dict) and entity.get("id") == "entity.vendor"
            ),
            {},
        )
        field_ids = [field.get("id") for field in (vendor_entity.get("fields") or []) if isinstance(field, dict)]
        self.assertIn("vendor.due_date", field_ids)

    def test_patchset_validation_applies_tab_creation_then_field_placement_sequentially(self) -> None:
        manifest = {
            "manifest_version": "1.3",
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts", "version": "1.0.0"},
            "app": {"home": "view:contact.form"},
            "entities": [
                {
                    "id": "entity.contact",
                    "label": "Contact",
                    "fields": [{"id": "contact.name", "label": "Name", "type": "string"}],
                }
            ],
            "views": [
                {
                    "id": "contact.form",
                    "kind": "form",
                    "entity": "entity.contact",
                    "header": {"tabs": {"tabs": [{"id": "primary_tab", "label": "Primary", "sections": ["primary"]}]}},
                    "sections": [{"id": "primary", "fields": ["contact.name"]}],
                }
            ],
            "pages": [],
            "actions": [],
            "relations": [],
        }
        module_index = {"contacts": {"manifest": manifest, "module": {"current_hash": "sha256:contacts"}}}

        with patch.object(main, "_ai_module_manifest_index", lambda _request: module_index), patch.object(main, "_validate_dependency_state", lambda *_args, **_kwargs: ([], [])):
            validation = _ai_validate_patchset_against_workspace(
                None,
                {
                    "base_snapshot_refs_json": [{"artifact_type": "module", "artifact_key": "contacts", "artifact_version": "sha256:contacts"}],
                    "patch_json": {
                        "operations": [
                            {
                                "op": "update_view",
                                "artifact_type": "module",
                                "artifact_id": "contacts",
                                "view_id": "contact.form",
                                "tab_label": "Sales & Purchase",
                                "changes": {
                                    "header": {
                                        "tabs": {
                                            "tabs": [
                                                {"id": "primary_tab", "label": "Primary", "sections": ["primary"]},
                                                {"id": "sales_purchase_tab", "label": "Sales & Purchase", "sections": ["sales_purchase"]},
                                            ]
                                        }
                                    },
                                    "sections": [
                                        {"id": "primary", "fields": ["contact.name"]},
                                        {"id": "sales_purchase", "fields": []},
                                    ],
                                },
                            },
                            {
                                "op": "add_field",
                                "artifact_type": "module",
                                "artifact_id": "contacts",
                                "entity_id": "entity.contact",
                                "field": {"id": "contact.customer_since", "label": "Customer Since", "type": "date"},
                            },
                            {
                                "op": "insert_section_field",
                                "artifact_type": "module",
                                "artifact_id": "contacts",
                                "view_id": "contact.form",
                                "section_id": "sales_purchase",
                                "field_id": "contact.customer_since",
                                "placement_label": "Sales & Purchase",
                                "placement_kind": "tab",
                            },
                        ],
                        "noop": False,
                    },
                },
            )

        self.assertTrue(validation.get("ok"), validation)
        result = (validation.get("results") or [{}])[0]
        fields = ((((result.get("manifest") or {}).get("entities") or [{}])[0].get("fields") or []))
        self.assertTrue(any(isinstance(field, dict) and field.get("id") == "contact.customer_since" for field in fields))

    def test_patchset_validation_ignores_preexisting_dependency_errors_on_upgrade(self) -> None:
        manifest = {
            "manifest_version": "1.3",
            "module": {"id": "sales", "key": "sales", "name": "Sales", "version": "1.0.0"},
            "app": {"home": "view:quote.form"},
            "entities": [
                {
                    "id": "entity.quote",
                    "label": "Quote",
                    "fields": [{"id": "quote.name", "label": "Name", "type": "string"}],
                }
            ],
            "views": [{"id": "quote.form", "kind": "form", "entity": "entity.quote", "sections": [{"id": "primary", "fields": ["quote.name"]}]}],
            "pages": [],
            "actions": [],
            "relations": [],
        }
        module_index = {"sales": {"manifest": manifest, "module": {"current_hash": "sha256:sales"}}}
        repeated_issue = {
            "code": "MODULE_DEPENDENCY_MISSING",
            "message": "required dependency is not installed",
            "path": "depends_on.required[0].module",
            "detail": {"module": "catalog", "required_by": "sales"},
        }

        with patch.object(main, "_ai_module_manifest_index", lambda _request: module_index), patch.object(main, "_validate_dependency_state", lambda *_args, **_kwargs: ([repeated_issue], [])):
            validation = _ai_validate_patchset_against_workspace(
                None,
                {
                    "base_snapshot_refs_json": [{"artifact_type": "module", "artifact_key": "sales", "artifact_version": "sha256:sales"}],
                    "patch_json": {
                        "operations": [
                            {
                                "op": "add_field",
                                "artifact_type": "module",
                                "artifact_id": "sales",
                                "entity_id": "entity.quote",
                                "field": {"id": "quote.customer_since", "label": "Customer Since", "type": "date"},
                            }
                        ],
                        "noop": False,
                    },
                },
            )

        self.assertTrue(validation.get("ok"), validation)

    def test_session_sandbox_endpoint_requires_db_backed_workspace_replica(self) -> None:
        with TestClient(main.app) as client:
            create_response = client.post(
                "/octo-ai/sessions",
                json={
                    "title": "Dispatch rollout",
                    "sandbox_name": "Dispatch Sandbox",
                    "seed_mode": "structure_only",
                    "simulation_mode": "simulate_side_effects",
                },
            )
            self.assertEqual(create_response.status_code, 200, create_response.text)
            session_id = create_response.json()["session"]["id"]

            sandbox_response = client.post(f"/octo-ai/sessions/{session_id}/sandbox", json={})
            self.assertEqual(sandbox_response.status_code, 409, sandbox_response.text)
            body = sandbox_response.json()

        self.assertFalse(body.get("ok"), body)
        errors = body.get("errors") or []
        self.assertEqual(errors[0].get("code"), "AI_SANDBOX_REQUIRES_DB")
        self.assertIn("USE_DB=1", errors[0].get("message") or "")

    def test_create_session_uses_optional_description_as_summary(self) -> None:
        with TestClient(main.app) as client:
            create_response = client.post(
                "/octo-ai/sessions",
                json={
                    "title": "Contacts cleanup",
                    "description": "Historical record for a contact cleanup sandbox session.",
                },
            )
            self.assertEqual(create_response.status_code, 200, create_response.text)
            body = create_response.json()

        self.assertTrue(body.get("ok"), body)
        session = body.get("session") or {}
        self.assertEqual(session.get("title"), "Contacts cleanup")
        self.assertEqual(session.get("summary"), "Historical record for a contact cleanup sandbox session.")

    def test_get_session_includes_release_history(self) -> None:
        with TestClient(main.app) as client:
            create_response = client.post("/octo-ai/sessions", json={"title": "Release test"})
            self.assertEqual(create_response.status_code, 200, create_response.text)
            session = create_response.json()["session"]
            session_id = session["id"]
            _ai_create_record(
                _AI_ENTITY_RELEASE,
                {
                    "session_id": session_id,
                    "patchset_id": "patch-1",
                    "title": "Release test",
                    "summary": "Promoted the draft.",
                    "status": "live",
                    "sandbox_workspace_id": "sandbox_release",
                    "sandbox_name": "Release Sandbox",
                    "result_json": {"ok": True},
                    "promoted_by": "test-user",
                    "created_at": "2026-03-19T00:00:00Z",
                },
            )
            session_response = client.get(f"/octo-ai/sessions/{session_id}")
            self.assertEqual(session_response.status_code, 200, session_response.text)
            body = session_response.json()

        self.assertTrue(body.get("ok"), body)
        releases = body.get("releases") or []
        self.assertEqual(len(releases), 1)
        self.assertEqual(releases[0].get("status"), "live")
        self.assertEqual(releases[0].get("sandbox_name"), "Release Sandbox")

    def test_apply_patchset_updates_sandbox_without_creating_release(self) -> None:
        with TestClient(main.app) as client:
            create_response = client.post("/octo-ai/sessions", json={"title": "Sandbox only apply"})
            self.assertEqual(create_response.status_code, 200, create_response.text)
            session_id = create_response.json()["session"]["id"]
            _ai_update_record(
                _AI_ENTITY_SESSION,
                session_id,
                {"sandbox_workspace_id": "ws_sandbox_apply", "sandbox_status": "active"},
            )
            patchset = _ai_create_record(
                _AI_ENTITY_PATCHSET,
                {
                    "session_id": session_id,
                    "status": "validated",
                    "base_snapshot_refs_json": [],
                    "patch_json": {"operations": [], "noop": True, "reason": "No changes required."},
                    "validation_json": None,
                    "apply_log_json": [],
                    "created_at": "2026-03-23T00:00:00Z",
                    "applied_at": None,
                },
            )
            patchset_id = _ai_record_data(patchset)["id"]

            apply_response = client.post(f"/octo-ai/patchsets/{patchset_id}/apply", json={"approved": True})
            self.assertEqual(apply_response.status_code, 200, apply_response.text)
            body = apply_response.json()

        self.assertTrue(body.get("ok"), body)
        self.assertEqual((body.get("apply") or {}).get("scope"), "sandbox")
        releases = [item for item in _ai_session_release_records(session_id) if item.get("patchset_id") == patchset_id]
        self.assertEqual(releases, [])
        session = _ai_get_record(_AI_ENTITY_SESSION, session_id)
        self.assertEqual(session.get("release_status"), "draft")
        self.assertEqual(session.get("sandbox_status"), "ready")

    def test_apply_patchset_fails_closed_without_real_sandbox_workspace(self) -> None:
        with TestClient(main.app) as client:
            create_response = client.post("/octo-ai/sessions", json={"title": "Sandbox required"})
            self.assertEqual(create_response.status_code, 200, create_response.text)
            session_id = create_response.json()["session"]["id"]
            patchset = _ai_create_record(
                _AI_ENTITY_PATCHSET,
                {
                    "session_id": session_id,
                    "status": "validated",
                    "base_snapshot_refs_json": [],
                    "patch_json": {"operations": [], "noop": True, "reason": "No changes required."},
                    "validation_json": None,
                    "apply_log_json": [],
                    "created_at": "2026-03-23T00:00:00Z",
                    "applied_at": None,
                },
            )
            patchset_id = _ai_record_data(patchset)["id"]

            apply_response = client.post(f"/octo-ai/patchsets/{patchset_id}/apply", json={"approved": True})
            self.assertEqual(apply_response.status_code, 409, apply_response.text)
            body = apply_response.json()

        self.assertFalse(body.get("ok"), body)
        self.assertEqual((body.get("errors") or [{}])[0].get("code"), "AI_SANDBOX_NOT_READY")

    def test_create_and_promote_release_are_explicit_steps(self) -> None:
        with TestClient(main.app) as client:
            create_response = client.post("/octo-ai/sessions", json={"title": "Explicit release flow"})
            self.assertEqual(create_response.status_code, 200, create_response.text)
            session_id = create_response.json()["session"]["id"]
            _ai_update_record(
                _AI_ENTITY_SESSION,
                session_id,
                {"sandbox_workspace_id": "ws_sandbox_release", "sandbox_status": "active"},
            )
            patchset = _ai_create_record(
                _AI_ENTITY_PATCHSET,
                {
                    "session_id": session_id,
                    "status": "validated",
                    "base_snapshot_refs_json": [],
                    "patch_json": {"operations": [], "noop": True, "reason": "No changes required."},
                    "validation_json": None,
                    "apply_log_json": [],
                    "created_at": "2026-03-23T00:00:00Z",
                    "applied_at": None,
                },
            )
            patchset_id = _ai_record_data(patchset)["id"]

            apply_response = client.post(f"/octo-ai/patchsets/{patchset_id}/apply", json={"approved": True})
            self.assertEqual(apply_response.status_code, 200, apply_response.text)

            release_response = client.post(f"/octo-ai/sessions/{session_id}/releases", json={"patchset_id": patchset_id})
            self.assertEqual(release_response.status_code, 200, release_response.text)
            release_body = release_response.json()
            release_id = (release_body.get("release") or {}).get("id")
            self.assertIsInstance(release_id, str)
            self.assertEqual((release_body.get("release") or {}).get("status"), "draft")

            promote_response = client.post(f"/octo-ai/releases/{release_id}/promote", json={})
            self.assertEqual(promote_response.status_code, 200, promote_response.text)
            promote_body = promote_response.json()

        self.assertTrue(promote_body.get("ok"), promote_body)
        release = _ai_get_record(_AI_ENTITY_RELEASE, release_id)
        self.assertEqual(release.get("status"), "promoted")
        session = _ai_get_record(_AI_ENTITY_SESSION, session_id)
        self.assertEqual(session.get("release_status"), "promoted")

    def test_create_release_uses_cumulative_applied_patchsets_up_to_selected_revision(self) -> None:
        with TestClient(main.app) as client:
            create_response = client.post("/octo-ai/sessions", json={"title": "Cumulative release"})
            self.assertEqual(create_response.status_code, 200, create_response.text)
            session_id = create_response.json()["session"]["id"]
            _ai_update_record(
                _AI_ENTITY_SESSION,
                session_id,
                {"sandbox_workspace_id": "ws_sandbox_cumulative_release", "sandbox_status": "ready"},
            )
            first_patchset = _ai_create_record(
                _AI_ENTITY_PATCHSET,
                {
                    "session_id": session_id,
                    "status": "applied",
                    "base_snapshot_refs_json": [{"artifact_type": "module", "artifact_key": "contacts", "artifact_version": "sha256:base"}],
                    "patch_json": {
                        "operations": [
                            {"op": "add_field", "artifact_type": "module", "artifact_id": "contacts", "field": {"id": "contacts.trade_role", "label": "Trade Role", "type": "string"}}
                        ],
                        "noop": False,
                    },
                    "validation_json": None,
                    "apply_log_json": [],
                    "created_at": "2026-03-23T00:00:00Z",
                    "applied_at": "2026-03-23T00:00:05Z",
                },
            )
            first_patchset_id = _ai_record_data(first_patchset)["id"]
            second_patchset = _ai_create_record(
                _AI_ENTITY_PATCHSET,
                {
                    "session_id": session_id,
                    "status": "applied",
                    "base_snapshot_refs_json": [{"artifact_type": "module", "artifact_key": "contacts", "artifact_version": "sha256:sandbox_after_first"}],
                    "patch_json": {
                        "operations": [
                            {"op": "update_field", "artifact_type": "module", "artifact_id": "contacts", "field_id": "contacts.trade_role", "changes": {"label": "Primary Trade Role"}}
                        ],
                        "noop": False,
                    },
                    "validation_json": None,
                    "apply_log_json": [],
                    "created_at": "2026-03-23T00:01:00Z",
                    "applied_at": "2026-03-23T00:01:05Z",
                },
            )
            second_patchset_id = _ai_record_data(second_patchset)["id"]
            _ai_update_record(_AI_ENTITY_SESSION, session_id, {"latest_patchset_id": second_patchset_id})
            main._ai_upsert_session_sandbox_record(
                _ai_get_record(_AI_ENTITY_SESSION, session_id),
                status="ready",
                last_patchset_applied_id=second_patchset_id,
                snapshot_ref=f"patchset:{second_patchset_id}",
            )

            release_response = client.post(f"/octo-ai/sessions/{session_id}/releases", json={"patchset_id": second_patchset_id})
            self.assertEqual(release_response.status_code, 200, release_response.text)
            release = release_response.json()["release"]

        result = release.get("result_json") or {}
        self.assertEqual(result.get("included_patchset_ids"), [first_patchset_id, second_patchset_id])
        release_patch_json = result.get("release_patch_json") or {}
        operations = release_patch_json.get("operations") or []
        self.assertEqual(len(operations), 2)
        self.assertEqual((operations[0].get("field") or {}).get("label"), "Trade Role")
        self.assertEqual(((operations[1].get("changes") or {}).get("label")), "Primary Trade Role")
        base_refs = result.get("release_base_snapshot_refs_json") or []
        self.assertEqual(base_refs[0].get("artifact_version"), "sha256:base")

    def test_create_release_defaults_to_current_sandbox_revision_when_latest_patchset_is_stale(self) -> None:
        with TestClient(main.app) as client:
            create_response = client.post("/octo-ai/sessions", json={"title": "Release fallback"})
            self.assertEqual(create_response.status_code, 200, create_response.text)
            session_id = create_response.json()["session"]["id"]
            _ai_update_record(
                _AI_ENTITY_SESSION,
                session_id,
                {
                    "sandbox_workspace_id": "ws_sandbox_release_fallback",
                    "sandbox_status": "ready",
                    "latest_patchset_id": "stale_patchset_id",
                },
            )
            applied_patchset = _ai_create_record(
                _AI_ENTITY_PATCHSET,
                {
                    "session_id": session_id,
                    "status": "applied",
                    "base_snapshot_refs_json": [],
                    "patch_json": {"operations": [], "noop": True, "reason": "No changes required."},
                    "validation_json": None,
                    "apply_log_json": [],
                    "created_at": "2026-03-23T00:00:00Z",
                    "applied_at": "2026-03-23T00:00:05Z",
                },
            )
            applied_patchset_id = _ai_record_data(applied_patchset)["id"]
            main._ai_upsert_session_sandbox_record(
                _ai_get_record(_AI_ENTITY_SESSION, session_id),
                status="ready",
                last_patchset_applied_id=applied_patchset_id,
                snapshot_ref=f"patchset:{applied_patchset_id}",
            )

            release_response = client.post(f"/octo-ai/sessions/{session_id}/releases", json={})
            self.assertEqual(release_response.status_code, 200, release_response.text)
            release = release_response.json()["release"]

        self.assertEqual(release.get("patchset_id"), applied_patchset_id)

    def test_rollback_patchset_updates_latest_patchset_to_remaining_applied_revision(self) -> None:
        with TestClient(main.app) as client:
            create_response = client.post("/octo-ai/sessions", json={"title": "Rollback latest patchset pointer"})
            self.assertEqual(create_response.status_code, 200, create_response.text)
            session_id = create_response.json()["session"]["id"]
            _ai_update_record(
                _AI_ENTITY_SESSION,
                session_id,
                {"sandbox_workspace_id": "ws_sandbox_rollback_latest", "sandbox_status": "active"},
            )
            first_patchset = _ai_create_record(
                _AI_ENTITY_PATCHSET,
                {
                    "session_id": session_id,
                    "status": "applied",
                    "base_snapshot_refs_json": [],
                    "patch_json": {"operations": [], "noop": True, "reason": "No changes required."},
                    "validation_json": None,
                    "apply_log_json": [],
                    "created_at": "2026-03-23T00:00:00Z",
                    "applied_at": "2026-03-23T00:00:05Z",
                },
            )
            first_patchset_id = _ai_record_data(first_patchset)["id"]
            second_patchset = _ai_create_record(
                _AI_ENTITY_PATCHSET,
                {
                    "session_id": session_id,
                    "status": "applied",
                    "base_snapshot_refs_json": [],
                    "patch_json": {"operations": [], "noop": True, "reason": "No changes required."},
                    "validation_json": None,
                    "apply_log_json": [],
                    "created_at": "2026-03-23T00:01:00Z",
                    "applied_at": "2026-03-23T00:01:05Z",
                },
            )
            second_patchset_id = _ai_record_data(second_patchset)["id"]
            _ai_update_record(_AI_ENTITY_SESSION, session_id, {"latest_patchset_id": second_patchset_id})
            main._ai_upsert_session_sandbox_record(
                _ai_get_record(_AI_ENTITY_SESSION, session_id),
                status="ready",
                last_patchset_applied_id=second_patchset_id,
                snapshot_ref=f"patchset:{second_patchset_id}",
            )
            _ai_create_record(
                _AI_ENTITY_SNAPSHOT,
                {
                    "patchset_id": second_patchset_id,
                    "release_id": "",
                    "snapshot_scope": "sandbox",
                    "artifact_type": "module",
                    "artifact_key": "contacts",
                    "artifact_version": "sha256:before-second",
                    "snapshot_json": {"module": {"id": "contacts"}},
                    "created_at": "2026-03-23T00:01:06Z",
                },
            )

            rollback_response = client.post(f"/octo-ai/patchsets/{second_patchset_id}/rollback", json={})
            self.assertEqual(rollback_response.status_code, 200, rollback_response.text)

        session = _ai_get_record(_AI_ENTITY_SESSION, session_id)
        self.assertEqual(session.get("latest_patchset_id"), first_patchset_id)
        sandbox = main._ai_latest_sandbox_record(session_id)
        self.assertEqual(sandbox.get("last_patchset_applied_id"), first_patchset_id)

    def test_sandbox_patchset_rollback_does_not_mark_promoted_release_rolled_back(self) -> None:
        with TestClient(main.app) as client:
            create_response = client.post("/octo-ai/sessions", json={"title": "Rollback boundary"})
            self.assertEqual(create_response.status_code, 200, create_response.text)
            session_id = create_response.json()["session"]["id"]
            _ai_update_record(
                _AI_ENTITY_SESSION,
                session_id,
                {"sandbox_workspace_id": "ws_sandbox_rollback", "sandbox_status": "active"},
            )
            patchset = _ai_create_record(
                _AI_ENTITY_PATCHSET,
                {
                    "session_id": session_id,
                    "status": "validated",
                    "base_snapshot_refs_json": [],
                    "patch_json": {"operations": [], "noop": True, "reason": "No changes required."},
                    "validation_json": None,
                    "apply_log_json": [],
                    "created_at": "2026-03-23T00:00:00Z",
                    "applied_at": None,
                },
            )
            patchset_id = _ai_record_data(patchset)["id"]

            self.assertEqual(client.post(f"/octo-ai/patchsets/{patchset_id}/apply", json={"approved": True}).status_code, 200)
            release_response = client.post(f"/octo-ai/sessions/{session_id}/releases", json={"patchset_id": patchset_id})
            self.assertEqual(release_response.status_code, 200, release_response.text)
            release_id = (release_response.json().get("release") or {}).get("id")
            self.assertEqual(client.post(f"/octo-ai/releases/{release_id}/promote", json={}).status_code, 200)
            _ai_create_record(
                _AI_ENTITY_SNAPSHOT,
                {
                    "patchset_id": patchset_id,
                    "release_id": "",
                    "snapshot_scope": "sandbox",
                    "artifact_type": "module",
                    "artifact_key": "contacts",
                    "artifact_version": "sha256:before",
                    "snapshot_json": {"module": {"id": "contacts"}},
                    "created_at": "2026-03-23T00:00:01Z",
                },
            )

            rollback_response = client.post(f"/octo-ai/patchsets/{patchset_id}/rollback", json={})
            self.assertEqual(rollback_response.status_code, 200, rollback_response.text)

        release = _ai_get_record(_AI_ENTITY_RELEASE, release_id)
        self.assertEqual(release.get("status"), "promoted")
        session = _ai_get_record(_AI_ENTITY_SESSION, session_id)
        self.assertEqual(session.get("release_status"), "promoted")

    def test_release_rollback_marks_release_and_session(self) -> None:
        with TestClient(main.app) as client:
            create_response = client.post("/octo-ai/sessions", json={"title": "Release rollback"})
            self.assertEqual(create_response.status_code, 200, create_response.text)
            session_id = create_response.json()["session"]["id"]
            _ai_update_record(
                _AI_ENTITY_SESSION,
                session_id,
                {"sandbox_workspace_id": "ws_sandbox_release_rollback", "sandbox_status": "active"},
            )
            patchset = _ai_create_record(
                _AI_ENTITY_PATCHSET,
                {
                    "session_id": session_id,
                    "status": "validated",
                    "base_snapshot_refs_json": [],
                    "patch_json": {"operations": [], "noop": True, "reason": "No changes required."},
                    "validation_json": None,
                    "apply_log_json": [],
                    "created_at": "2026-03-23T00:00:00Z",
                    "applied_at": None,
                },
            )
            patchset_id = _ai_record_data(patchset)["id"]

            self.assertEqual(client.post(f"/octo-ai/patchsets/{patchset_id}/apply", json={"approved": True}).status_code, 200)
            release_response = client.post(f"/octo-ai/sessions/{session_id}/releases", json={"patchset_id": patchset_id})
            self.assertEqual(release_response.status_code, 200, release_response.text)
            release_id = (release_response.json().get("release") or {}).get("id")
            self.assertEqual(client.post(f"/octo-ai/releases/{release_id}/promote", json={}).status_code, 200)

            rollback_response = client.post(f"/octo-ai/releases/{release_id}/rollback", json={})
            self.assertEqual(rollback_response.status_code, 200, rollback_response.text)

        release = _ai_get_record(_AI_ENTITY_RELEASE, release_id)
        self.assertEqual(release.get("status"), "rolled_back")
        session = _ai_get_record(_AI_ENTITY_SESSION, session_id)
        self.assertEqual(session.get("release_status"), "rolled_back")

    def test_status_label_strips_new_prefix_from_named_status(self) -> None:
        label = main._ai_extract_status_label(
            "In Contacts, add a new Contacted status and add an action button called Set: Contacted."
        )

        self.assertEqual(label, "Contacted")

    def test_plan_text_prefers_requested_jobs_scope_over_incidental_job_phrase(self) -> None:
        jobs_manifest = {
            "module": {"id": "jobs", "key": "jobs", "name": "Jobs"},
            "entities": [{"id": "entity.job", "label": "Job", "fields": []}],
            "app": {"nav": [{"items": [{"label": "All Jobs"}]}]},
        }

        text = _ai_plan_assistant_text(
            {
                "required_questions": ["Confirm this plan?"],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": [],
                "risk_flags": [],
                "advisories": [],
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "jobs"}],
                "proposed_changes": [
                    {"op": "add_field", "artifact_type": "module", "artifact_id": "jobs", "field": {"label": "After Hours Contact", "type": "string"}}
                ],
                "planner_state": {"intent": "add_field", "field_label": "After Hours Contact", "requested_module_labels": ["Jobs"]},
            },
            {
                "request_summary": "In Jobs, if the job type is Emergency, show After Hours Contact and Callout Reason fields and make them required.",
                "full_selected_artifacts": [{"artifact_type": "module", "artifact_id": "jobs", "manifest": jobs_manifest}],
            },
        )

        self.assertIn("Jobs", text)
        self.assertNotIn("to Job.", text)

    def test_plan_text_prefers_requested_site_visits_scope_label(self) -> None:
        field_service_manifest = {
            "module": {"id": "field_service", "key": "field_service", "name": "Field Service"},
            "entities": [{"id": "entity.site_visit", "label": "Site Visit", "fields": []}],
            "app": {"nav": [{"items": [{"label": "Visits"}]}]},
        }

        text = _ai_plan_assistant_text(
            {
                "required_questions": ["Confirm this plan?"],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": [],
                "risk_flags": [],
                "advisories": [],
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "field_service"}],
                "proposed_changes": [
                    {"op": "add_field", "artifact_type": "module", "artifact_id": "field_service", "field": {"label": "Site Access Notes", "type": "text"}}
                ],
                "planner_state": {"intent": "add_field", "field_label": "Site Access Notes", "requested_module_labels": ["Site Visits"]},
            },
            {
                "request_summary": "In Site Visits, add a Site Access Notes field and put it near the address and contact details so technicians see it early.",
                "full_selected_artifacts": [{"artifact_type": "module", "artifact_id": "field_service", "manifest": field_service_manifest}],
            },
        )

        self.assertIn("Site Visits", text)
        self.assertNotIn("to Visits.", text)

    def test_infer_preview_modules_ignores_field_label_module_alias_drift(self) -> None:
        req = type("R", (), {"state": type("S", (), {"cache": {}})()})()
        main._octo_ai_seed_in_memory_baseline_modules()
        baseline_index = _ai_module_manifest_index(req)
        module_index = {
            "jobs": baseline_index["jobs"],
            "contacts": baseline_index["contacts"],
        }

        inferred = main._ai_infer_preview_modules(
            "In Jobs, if the job type is Emergency, show After Hours Contact and Callout Reason fields and make them required.",
            module_index,
            [],
        )

        self.assertEqual(inferred, ["jobs"])

    def test_infer_preview_modules_prefers_explicit_scope_over_stale_current_modules(self) -> None:
        req = type("R", (), {"state": type("S", (), {"cache": {}})()})()
        main._octo_ai_seed_in_memory_baseline_modules()
        baseline_index = _ai_module_manifest_index(req)
        module_index = {
            "contacts": baseline_index["contacts"],
            "jobs": baseline_index["jobs"],
        }

        inferred = main._ai_infer_preview_modules(
            "In Jobs, add a Priority field and show me the draft plan first.",
            module_index,
            ["contacts"],
        )

        self.assertEqual(inferred, ["jobs"])

    def test_infer_preview_modules_does_not_add_unrelated_track_module_when_named_scope_is_partially_missing(self) -> None:
        req = type("R", (), {"state": type("S", (), {"cache": {}})()})()
        main._octo_ai_seed_in_memory_baseline_modules()
        baseline_index = _ai_module_manifest_index(req)
        module_index = {
            "contacts": baseline_index["contacts"],
            "jobs": baseline_index["jobs"],
        }

        inferred = main._ai_infer_preview_modules(
            "Create a supplier onboarding process across Contacts, Purchase Requests, and Vendor Compliance so new vendors cannot be used until documents are approved.",
            module_index,
            [],
        )

        self.assertEqual(inferred, ["contacts"])

    def test_named_cross_module_preview_keeps_missing_modules_truthful_without_inventing_jobs(self) -> None:
        req = type("R", (), {"state": type("S", (), {"cache": {}})()})()
        main._octo_ai_seed_in_memory_baseline_modules()
        baseline_index = _ai_module_manifest_index(req)
        message = (
            "Create a supplier onboarding process across Contacts, Purchase Requests, and Vendor Compliance "
            "so new vendors cannot be used until documents are approved."
        )

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: baseline_index),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        self.assertEqual(derived.get("affected_modules"), ["contacts"])
        self.assertEqual(
            (plan.get("planner_state") or {}).get("requested_module_labels"),
            ["Contacts", "Purchase Requests", "Vendor Compliance"],
        )
        self.assertEqual(
            (plan.get("planner_state") or {}).get("missing_module_labels"),
            ["Purchase Requests", "Vendor Compliance"],
        )
        text = _ai_plan_assistant_text(
            plan,
            {
                "request_summary": message,
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "contacts", "manifest": baseline_index["contacts"]["manifest"]},
                ],
            },
        )
        self.assertIn("Contacts", text)
        self.assertIn("Purchase Requests", text)
        self.assertIn("Vendor Compliance", text)
        self.assertNotIn("Jobs", text)

    def test_missing_named_module_uses_preview_flow_instead_of_generic_target_question(self) -> None:
        message = "In Equipment Hire, add a Bond Paid checkbox and a Bond Receipt attachment field that only shows when Bond Paid is ticked."

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: {}),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        self.assertEqual(derived.get("affected_modules"), [])
        self.assertEqual((plan.get("required_question_meta") or {}).get("id"), "confirm_plan")
        self.assertEqual((plan.get("planner_state") or {}).get("requested_module_labels"), ["Equipment Hire"])
        self.assertEqual((plan.get("planner_state") or {}).get("missing_module_labels"), ["Equipment Hire"])

        text = _ai_plan_assistant_text(
            plan,
            {
                "request_summary": message,
                "full_selected_artifacts": [],
            },
        )

        self.assertIn("Planned changes:", text)
        self.assertIn("Equipment Hire", text)
        self.assertIn("draft patchset for sandbox validation", text)
        self.assertNotIn("Which module should receive this change?", text)

    def test_missing_named_module_without_comma_stays_previewable_and_truthful(self) -> None:
        message = "For Purchase Requests require manager comments when rejecting."

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: {}),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        self.assertEqual(derived.get("affected_modules"), [])
        self.assertEqual((plan.get("planner_state") or {}).get("requested_module_labels"), ["Purchase Requests"])
        self.assertEqual((plan.get("planner_state") or {}).get("missing_module_labels"), ["Purchase Requests"])
        text = _ai_plan_assistant_text(
            plan,
            {
                "request_summary": message,
                "full_selected_artifacts": [],
            },
        )

        self.assertIn("Purchase Requests", text)
        self.assertIn("draft patchset for sandbox validation", text)
        self.assertNotIn("Which module should receive this change?", text)

    def test_scope_free_template_request_uses_confirm_plan_preview(self) -> None:
        message = "Create a Holiday Itinerary PDF template with traveller details, travel dates, bookings, flights, hotels, and activity notes."

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: {}),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        self.assertEqual(derived.get("affected_modules"), [])
        self.assertEqual((plan.get("required_question_meta") or {}).get("id"), "confirm_plan")
        self.assertEqual((plan.get("planner_state") or {}).get("intent"), "preview_only_plan")

        text = _ai_plan_assistant_text(
            plan,
            {
                "request_summary": message,
                "full_selected_artifacts": [],
            },
        )

        self.assertIn("Planned changes:", text)
        self.assertIn("Holiday Itinerary PDF template", text)
        self.assertIn("traveller details", text)
        self.assertNotIn("Which module should receive this change?", text)

    def test_create_module_prompt_with_module_typo_overrides_generic_module_question(self) -> None:
        message = (
            "hi, can you create me a really good mobule for managing my cooking recipes, "
            "we need to add ingredients as line items, full recipe details and images of "
            "the recipe for my upcoming cook book. call it Cooking."
        )

        semantic_question = {
            "candidate_ops": [],
            "questions": ["Which module should receive this change?"],
            "question_meta": {"id": "module_target", "kind": "text", "prompt": "Which module should receive this change?"},
            "assumptions": ["No explicit module match found; planner remained workspace-aware but conservative."],
            "risk_flags": [],
            "advisories": [],
            "affected_modules": [],
            "plan_v1": None,
        }

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: {}),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: semantic_question),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        create_ops = [op for op in (plan.get("proposed_changes") or []) if isinstance(op, dict) and op.get("op") == "create_module"]
        self.assertEqual(len(create_ops), 1)
        self.assertEqual(create_ops[0].get("artifact_id"), "cooking")
        self.assertEqual(derived.get("affected_modules"), ["cooking"])
        self.assertEqual((plan.get("required_question_meta") or {}).get("id"), "confirm_plan")

        text = _ai_plan_assistant_text(
            plan,
            {
                "request_summary": message,
                "full_selected_artifacts": [],
            },
        )

        self.assertIn("Cooking", text)
        self.assertIn("draft patchset for sandbox validation", text)
        self.assertNotIn("Which module should receive this change?", text)

    def test_missing_named_module_stays_missing_even_when_workspace_has_attachment_modules(self) -> None:
        req = type("R", (), {"state": type("S", (), {"cache": {}})()})()
        main._octo_ai_seed_in_memory_baseline_modules()
        baseline_index = _ai_module_manifest_index(req)
        message = "In Equipment Hire, add a Bond Paid checkbox and a Bond Receipt attachment field that only shows when Bond Paid is ticked."

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: baseline_index),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        self.assertEqual(derived.get("affected_modules"), [])
        self.assertEqual((plan.get("required_question_meta") or {}).get("id"), "confirm_plan")
        self.assertEqual((plan.get("planner_state") or {}).get("requested_module_labels"), ["Equipment Hire"])
        self.assertEqual((plan.get("planner_state") or {}).get("missing_module_labels"), ["Equipment Hire"])

        text = _ai_plan_assistant_text(
            plan,
            {
                "request_summary": message,
                "full_selected_artifacts": [],
            },
        )

        self.assertIn("Equipment Hire", text)
        self.assertNotIn("Documents", text)

    def test_missing_named_module_overrides_selected_module_scope(self) -> None:
        req = type("R", (), {"state": type("S", (), {"cache": {}})()})()
        main._octo_ai_seed_in_memory_baseline_modules()
        baseline_index = _ai_module_manifest_index(req)
        message = "In Equipment Hire, add a Bond Paid checkbox and a Bond Receipt attachment field that only shows when Bond Paid is ticked."

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: baseline_index),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "module", "selected_artifact_key": "contacts"},
                message,
                answer_hints={},
            )

        self.assertEqual(derived.get("affected_modules"), [])
        self.assertEqual((plan.get("planner_state") or {}).get("requested_module_labels"), ["Equipment Hire"])
        self.assertEqual((plan.get("planner_state") or {}).get("missing_module_labels"), ["Equipment Hire"])
        text = _ai_plan_assistant_text(
            plan,
            {
                "request_summary": message,
                "full_selected_artifacts": [],
            },
        )
        self.assertIn("Equipment Hire", text)
        self.assertNotIn("Contacts", text)

    def test_missing_named_module_discards_semantic_module_drift(self) -> None:
        req = type("R", (), {"state": type("S", (), {"cache": {}})()})()
        main._octo_ai_seed_in_memory_baseline_modules()
        baseline_index = _ai_module_manifest_index(req)
        message = "For Purchase Requests, add Pending Approval, Approved, and Rejected statuses, plus action buttons for managers to approve or reject with comments."

        semantic_drift = {
            "candidate_ops": [],
            "questions": [],
            "question_meta": None,
            "assumptions": ["The closest installed module is CRM."],
            "risk_flags": [],
            "advisories": [],
            "affected_modules": ["crm"],
            "plan_v1": None,
        }

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: baseline_index),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: semantic_drift),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        self.assertEqual(derived.get("affected_modules"), [])
        self.assertEqual((plan.get("planner_state") or {}).get("requested_module_labels"), ["Purchase Requests"])
        self.assertEqual((plan.get("planner_state") or {}).get("missing_module_labels"), ["Purchase Requests"])
        self.assertEqual(plan.get("affected_artifacts"), [])
        text = _ai_plan_assistant_text(
            plan,
            {
                "request_summary": message,
                "full_selected_artifacts": [],
            },
        )
        self.assertIn("Purchase Requests", text)
        self.assertNotIn("CRM", text)
        self.assertNotIn("draft only changes", text)

    def test_plan_text_keeps_planned_changes_section_when_scope_is_known_but_detail_is_pending(self) -> None:
        plan = {
            "affected_artifacts": [
                {"artifact_type": "module", "artifact_id": "contacts"},
                {"artifact_type": "module", "artifact_id": "crm"},
            ],
            "proposed_changes": [],
            "required_questions": ["What should the webhook payload include?"],
            "required_question_meta": {"id": "clarification", "kind": "text", "prompt": "What should the webhook payload include?"},
            "risk_flags": ["Cross-module impact detected; review dependencies before apply."],
        }
        text = _ai_plan_assistant_text(
            plan,
            {
                "request_summary": "Send a webhook to downstream systems when customer onboarding is complete.",
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "contacts", "manifest": {"module": {"name": "Contacts"}}},
                    {"artifact_type": "module", "artifact_id": "crm", "manifest": {"module": {"name": "CRM"}}},
                ],
            },
        )

        self.assertIn("Planned changes:", text)
        self.assertIn("Draft the requested updates across Contacts and CRM once the remaining detail is confirmed.", text)
        self.assertIn("I need one clarification before I finalize the plan:", text)

    def test_plan_text_skips_unrelated_setup_issue_suggestions_for_direct_field_change(self) -> None:
        contacts_manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [
                {
                    "id": "entity.contact",
                    "fields": [
                        {"id": "contact.name", "label": "Name", "type": "string"},
                        {"id": "contact.supplier_rating", "label": "Supplier Rating", "type": "number"},
                        {"id": "contact.supplier_rating", "label": "Supplier Rating", "type": "number"},
                    ],
                }
            ],
            "views": [
                {
                    "id": "contact.form",
                    "kind": "form",
                    "entity": "entity.contact",
                    "sections": [{"id": "primary", "fields": ["contact.name"]}],
                }
            ],
        }
        plan = {
            "affected_artifacts": [{"artifact_type": "module", "artifact_id": "contacts"}],
            "proposed_changes": [
                {
                    "op": "add_field",
                    "artifact_type": "module",
                    "artifact_id": "contacts",
                    "entity_id": "entity.contact",
                    "field": {"id": "contact.portal_access", "label": "Portal Access", "type": "bool"},
                },
                {
                    "op": "insert_section_field",
                    "artifact_type": "module",
                    "artifact_id": "contacts",
                    "view_id": "contact.form",
                    "section_id": "primary",
                    "field_id": "contact.portal_access",
                    "placement_label": "Primary Details",
                },
            ],
            "required_questions": ["Confirm this plan?"],
            "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan", "prompt": "Confirm this plan or tell me what to change."},
            "planner_state": {"intent": "add_field", "module_id": "contacts", "field_label": "Portal Access", "field_id": "contact.portal_access"},
        }
        text = _ai_plan_assistant_text(
            plan,
            {
                "request_summary": "Add a Portal Access checkbox to Contacts form only.",
                "full_selected_artifacts": [
                    {
                        "artifact_type": "module",
                        "artifact_id": "contacts",
                        "manifest": contacts_manifest,
                        "summary": {"notable_issues": ["entity.contact has duplicate field ids: contact.supplier_rating"]},
                    }
                ],
            },
        )

        self.assertIn("Portal Access", text)
        self.assertNotIn("Clean up existing setup issue", text)
        self.assertNotIn("duplicate field ids", text)

    def test_plan_text_summarizes_single_field_addition_even_when_intent_is_multi_request(self) -> None:
        contacts_manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [{"id": "entity.contact", "fields": [{"id": "contact.name", "label": "Name", "type": "string"}]}],
            "views": [
                {
                    "id": "contact.form",
                    "kind": "form",
                    "entity": "entity.contact",
                    "sections": [{"id": "primary", "fields": ["contact.name"]}],
                }
            ],
        }
        plan = {
            "affected_artifacts": [{"artifact_type": "module", "artifact_id": "contacts"}],
            "proposed_changes": [
                {
                    "op": "add_field",
                    "artifact_type": "module",
                    "artifact_id": "contacts",
                    "entity_id": "entity.contact",
                    "field": {"id": "contact.portal_access", "label": "Portal Access", "type": "bool"},
                },
                {
                    "op": "insert_section_field",
                    "artifact_type": "module",
                    "artifact_id": "contacts",
                    "view_id": "contact.form",
                    "section_id": "primary",
                    "field_id": "contact.portal_access",
                    "placement_label": "Primary Details",
                },
            ],
            "required_questions": ["Confirm this plan?"],
            "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan", "prompt": "Confirm this plan or tell me what to change."},
            "planner_state": {"intent": "multi_request", "module_id": "contacts"},
        }
        text = _ai_plan_assistant_text(
            plan,
            {
                "request_summary": "Add a Portal Access checkbox to Contacts form only.",
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "contacts", "manifest": contacts_manifest},
                ],
            },
        )

        self.assertIn("Add a new field 'Portal Access' to Contacts and place it in the 'Primary Details' tab.", text)
        self.assertNotIn("Make several changes in Contacts.", text)

    def test_missing_named_module_preview_does_not_invent_sync_wording_for_approval_request(self) -> None:
        req = type("R", (), {"state": type("S", (), {"cache": {}})()})()
        main._octo_ai_seed_in_memory_baseline_modules()
        baseline_index = _ai_module_manifest_index(req)
        message = "For Purchase Requests, add Pending Approval, Approved, and Rejected statuses, plus action buttons for managers to approve or reject with comments."

        with (
            patch.object(main, "_ai_build_workspace_graph", lambda _request: {}),
            patch.object(main, "_ai_module_manifest_index", lambda _request: baseline_index),
            patch.object(main, "_ai_semantic_plan_from_model", lambda *_args, **_kwargs: None),
        ):
            plan, derived = _ai_plan_from_message(
                None,
                {"scope_mode": "auto", "selected_artifact_type": "none", "selected_artifact_key": ""},
                message,
                answer_hints={},
            )

        self.assertEqual(derived.get("affected_modules"), [])
        self.assertEqual((plan.get("planner_state") or {}).get("requested_module_labels"), ["Purchase Requests"])
        self.assertEqual((plan.get("planner_state") or {}).get("missing_module_labels"), ["Purchase Requests"])
        text = _ai_plan_assistant_text(
            plan,
            {
                "request_summary": message,
                "full_selected_artifacts": [],
            },
        )
        self.assertIn("Purchase Requests", text)
        self.assertNotIn("Only send approved records across.", text)
        self.assertNotIn("draft only changes Requests", text)

    def test_slot_plan_requires_manager_comments_when_rejecting_existing_workflow(self) -> None:
        manifest = {
            "module": {"id": "purchase_requests", "key": "purchase_requests", "name": "Purchase Requests"},
            "entities": [
                {
                    "id": "entity.purchase_request",
                    "label": "Purchase Request",
                    "display_field": "purchase_request.title",
                    "fields": [
                        {"id": "purchase_request.title", "label": "Title", "type": "string"},
                        {
                            "id": "purchase_request.status",
                            "label": "Status",
                            "type": "enum",
                            "options": [
                                {"label": "Pending Approval", "value": "pending_approval"},
                                {"label": "Approved", "value": "approved"},
                                {"label": "Rejected", "value": "rejected"},
                            ],
                        },
                    ],
                }
            ],
            "views": [
                {
                    "id": "purchase_request.form",
                    "kind": "form",
                    "entity": "entity.purchase_request",
                    "sections": [{"id": "primary", "title": "Primary", "fields": ["purchase_request.title", "purchase_request.status"]}],
                }
            ],
            "actions": [],
            "workflows": [
                {
                    "id": "workflow.purchase_request_status",
                    "entity": "entity.purchase_request",
                    "status_field": "purchase_request.status",
                    "states": [
                        {"id": "pending_approval", "label": "Pending Approval"},
                        {"id": "approved", "label": "Approved"},
                        {"id": "rejected", "label": "Rejected"},
                    ],
                    "transitions": [
                        {"id": "approve", "from": "pending_approval", "to": "approved", "label": "Approve"},
                        {"id": "reject", "from": "pending_approval", "to": "rejected", "label": "Reject"},
                    ],
                }
            ],
        }
        module_index = {"purchase_requests": {"manifest": manifest}}

        plan = _ai_slot_based_plan(
            "For Purchase Requests require manager comments when rejecting.",
            ["purchase_requests"],
            module_index,
            answer_hints=None,
        )

        self.assertEqual(plan.get("questions"), [])
        self.assertEqual(plan.get("affected_modules"), ["purchase_requests"])
        op_names = [op.get("op") for op in (plan.get("candidate_ops") or [])]
        self.assertIn("add_field", op_names)
        self.assertIn("insert_section_field", op_names)
        add_field = next(op for op in (plan.get("candidate_ops") or []) if op.get("op") == "add_field")
        self.assertEqual((add_field.get("field") or {}).get("label"), "Manager Comments")
        self.assertEqual((add_field.get("field") or {}).get("type"), "text")
        self.assertEqual(
            (add_field.get("field") or {}).get("required_when"),
            {"op": "eq", "field": "purchase_request.status", "value": "rejected"},
        )

    def test_workflow_action_sync_keeps_comment_requirement_in_plain_language(self) -> None:
        manifest = {
            "module": {"id": "purchase_requests", "key": "purchase_requests", "name": "Purchase Requests"},
            "entities": [
                {
                    "id": "entity.purchase_request",
                    "label": "Purchase Request",
                    "display_field": "purchase_request.title",
                    "fields": [
                        {"id": "purchase_request.title", "label": "Title", "type": "string"},
                        {
                            "id": "purchase_request.status",
                            "label": "Status",
                            "type": "enum",
                            "options": [
                                {"label": "Pending Approval", "value": "pending_approval"},
                                {"label": "Approved", "value": "approved"},
                                {"label": "Rejected", "value": "rejected"},
                            ],
                        },
                    ],
                }
            ],
            "views": [
                {
                    "id": "purchase_request.form",
                    "kind": "form",
                    "entity": "entity.purchase_request",
                    "sections": [{"id": "primary", "title": "Primary", "fields": ["purchase_request.title", "purchase_request.status"]}],
                }
            ],
            "actions": [],
            "workflows": [
                {
                    "id": "workflow.purchase_request_status",
                    "entity": "entity.purchase_request",
                    "status_field": "purchase_request.status",
                    "states": [
                        {"id": "pending_approval", "label": "Pending Approval"},
                        {"id": "approved", "label": "Approved"},
                        {"id": "rejected", "label": "Rejected"},
                    ],
                    "transitions": [
                        {"id": "approve", "from": "pending_approval", "to": "approved", "label": "Approve"},
                        {"id": "reject", "from": "pending_approval", "to": "rejected", "label": "Reject"},
                    ],
                }
            ],
        }
        module_index = {"purchase_requests": {"manifest": manifest}}

        plan = _ai_slot_based_plan(
            "In Purchase Requests, add action buttons for managers to approve or reject with comments.",
            ["purchase_requests"],
            module_index,
            answer_hints=None,
        )

        self.assertEqual(plan.get("questions"), [])
        op_names = [op.get("op") for op in (plan.get("candidate_ops") or [])]
        self.assertIn("add_action", op_names)
        self.assertIn("add_field", op_names)
        text = _ai_plan_assistant_text(
            {
                "required_questions": ["Confirm this plan?"],
                "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                "assumptions": plan.get("assumptions") or [],
                "risk_flags": plan.get("risk_flags") or [],
                "advisories": plan.get("advisories") or [],
                "affected_artifacts": [{"artifact_type": "module", "artifact_id": "purchase_requests"}],
                "proposed_changes": plan.get("candidate_ops") or [],
                "planner_state": plan.get("planner_state") or {},
            },
            {
                "request_summary": "In Purchase Requests, add action buttons for managers to approve or reject with comments.",
                "full_selected_artifacts": [
                    {"artifact_type": "module", "artifact_id": "purchase_requests", "manifest": manifest},
                ],
            },
        )

        self.assertIn("Manager Comments", text)
        self.assertIn("Workflow & actions:", text)
        self.assertIn("Conditions:", text)

    def test_plan_change_lines_include_automation_summary(self) -> None:
        lines = main._ai_plan_change_lines(
            {
                "proposed_changes": [
                    {
                        "op": "create_automation_record",
                        "artifact_type": "automation",
                        "artifact_id": "ai_auto_contacts_inactive_notify",
                        "automation": {
                            "name": "Contacts Inactive Notification",
                            "trigger": {"kind": "event", "event_types": ["workflow.status_changed"]},
                            "steps": [
                                {
                                    "kind": "action",
                                    "action_id": "system.send_email",
                                    "inputs": {"to": "nick@octodrop.com"},
                                }
                            ],
                        },
                    }
                ]
            },
            {"request_summary": "When a contact is marked inactive, email nick@octodrop.com."},
        )

        self.assertTrue(lines)
        self.assertIn("Create automation 'Contacts Inactive Notification' to email nick@octodrop.com when workflow status changes.", lines[0])

    def test_validate_patchset_accepts_automation_ops(self) -> None:
        request = SimpleNamespace(state=SimpleNamespace(actor={}))
        patchset = {
            "patch_json": {
                "operations": [
                    {
                        "op": "create_automation_record",
                        "artifact_type": "automation",
                        "artifact_id": "ai_auto_contacts_inactive_notify",
                        "automation": {
                            "name": "Contacts Inactive Notification",
                            "description": "Email Nick when a contact is marked inactive.",
                            "status": "draft",
                            "trigger": {
                                "kind": "event",
                                "event_types": ["workflow.status_changed"],
                                "filters": [
                                    {"field": "entity_id", "op": "eq", "value": "entity.contact"},
                                    {"field": "to", "op": "eq", "value": "inactive"},
                                ],
                            },
                            "steps": [
                                {
                                    "kind": "action",
                                    "action_id": "system.send_email",
                                    "inputs": {
                                        "to": "nick@octodrop.com",
                                        "subject": "Contact marked inactive",
                                        "body_text": "A contact was marked inactive.",
                                    },
                                }
                            ],
                        },
                    }
                ]
            },
            "base_snapshot_refs_json": [],
        }

        result = main._ai_validate_patchset_against_workspace(request, patchset)

        self.assertTrue(result.get("ok"), result)
        self.assertEqual((result.get("results") or [{}])[0].get("artifact_type"), "automation")
        self.assertEqual((result.get("results") or [{}])[0].get("artifact_key"), "ai_auto_contacts_inactive_notify")

    def test_status_notification_request_builds_automation_candidate(self) -> None:
        manifest = {
            "module": {"id": "contacts", "key": "contacts", "name": "Contacts"},
            "entities": [
                {
                    "id": "entity.contact",
                    "label": "Contact",
                    "fields": [
                        {
                            "id": "contact.status",
                            "label": "Status",
                            "type": "enum",
                            "options": [
                                {"label": "Active", "value": "active"},
                                {"label": "Inactive", "value": "inactive"},
                            ],
                        }
                    ],
                }
            ],
            "workflows": [
                {
                    "id": "workflow.contact_status",
                    "entity": "entity.contact",
                    "status_field": "contact.status",
                    "states": [
                        {"id": "active", "label": "Active"},
                        {"id": "inactive", "label": "Inactive"},
                    ],
                    "transitions": [],
                }
            ],
        }

        candidate = main._ai_build_status_notification_automation_candidate(
            "hey can you make an automation for when i mark a contact inactive, it sends nick@octodrop.com a notification?",
            "contacts",
            manifest,
            "entity.contact",
        )

        self.assertIsInstance(candidate, dict)
        ops = [op for op in (candidate.get("candidate_ops") or []) if isinstance(op, dict)]
        self.assertEqual(len(ops), 1)
        self.assertEqual(ops[0].get("op"), "create_automation_record")
        self.assertEqual((ops[0].get("automation") or {}).get("name"), "Contacts Inactive Notification")

    def test_apply_and_promote_automation_patchset_creates_draft_then_published_record(self) -> None:
        class ScopedAutomationStore:
            def __init__(self) -> None:
                self._items: dict[tuple[str, str], dict] = {}

            def create(self, record: dict) -> dict:
                item = main.copy.deepcopy(record)
                item.setdefault("status", "draft")
                item.setdefault("created_at", "2026-03-24T00:00:00Z")
                item.setdefault("updated_at", "2026-03-24T00:00:00Z")
                key = (main.get_org_id(), item["id"])
                self._items[key] = item
                return main.copy.deepcopy(item)

            def update(self, automation_id: str, updates: dict) -> dict | None:
                key = (main.get_org_id(), automation_id)
                item = self._items.get(key)
                if not item:
                    return None
                item.update(main.copy.deepcopy(updates))
                item["updated_at"] = "2026-03-24T00:05:00Z"
                self._items[key] = item
                return main.copy.deepcopy(item)

            def get(self, automation_id: str) -> dict | None:
                item = self._items.get((main.get_org_id(), automation_id))
                return main.copy.deepcopy(item) if item else None

            def list(self, status: str | None = None) -> list[dict]:
                items = [main.copy.deepcopy(item) for (org_id, _), item in self._items.items() if org_id == main.get_org_id()]
                if status:
                    items = [item for item in items if item.get("status") == status]
                return items

            def delete(self, automation_id: str) -> bool:
                return self._items.pop((main.get_org_id(), automation_id), None) is not None

        with patch.object(main, "automation_store", ScopedAutomationStore()):
            with TestClient(main.app) as client:
                create_response = client.post("/octo-ai/sessions", json={"title": "Inactive contact automation"})
                self.assertEqual(create_response.status_code, 200, create_response.text)
                session_id = create_response.json()["session"]["id"]
                live_workspace_id = "ws_live_contacts_inactive"
                sandbox_workspace_id = "ws_auto_contacts_inactive"
                _ai_update_record(
                    _AI_ENTITY_SESSION,
                    session_id,
                    {"workspace_id": live_workspace_id, "sandbox_workspace_id": sandbox_workspace_id, "sandbox_status": "active"},
                )
                patchset = _ai_create_record(
                    _AI_ENTITY_PATCHSET,
                    {
                        "session_id": session_id,
                        "status": "validated",
                        "base_snapshot_refs_json": [],
                        "patch_json": {
                            "operations": [
                                {
                                    "op": "create_automation_record",
                                    "artifact_type": "automation",
                                    "artifact_id": "ai_auto_contacts_inactive_notify",
                                    "automation": {
                                        "name": "Contacts Inactive Notification",
                                        "description": "Email Nick when a contact is marked inactive.",
                                        "status": "draft",
                                        "trigger": {
                                            "kind": "event",
                                            "event_types": ["workflow.status_changed"],
                                            "filters": [
                                                {"field": "entity_id", "op": "eq", "value": "entity.contact"},
                                                {"field": "to", "op": "eq", "value": "inactive"},
                                            ],
                                        },
                                        "steps": [
                                            {
                                                "kind": "action",
                                                "action_id": "system.send_email",
                                                "inputs": {
                                                    "to": "nick@octodrop.com",
                                                    "subject": "Contact marked inactive",
                                                    "body_text": "A contact was marked inactive.",
                                                },
                                            }
                                        ],
                                    },
                                }
                            ],
                            "noop": False,
                        },
                        "validation_json": None,
                        "apply_log_json": [],
                        "created_at": "2026-03-24T00:00:00Z",
                        "applied_at": None,
                    },
                )
                patchset_id = _ai_record_data(patchset)["id"]

                apply_response = client.post(f"/octo-ai/patchsets/{patchset_id}/apply", json={"approved": True})
                self.assertEqual(apply_response.status_code, 200, apply_response.text)

                sandbox_request = SimpleNamespace(state=SimpleNamespace(actor={}))
                with main._ai_ops_workspace_scope(sandbox_request, sandbox_workspace_id, {"workspace_id": sandbox_workspace_id}):
                    sandbox_automation = main.automation_store.get("ai_auto_contacts_inactive_notify")
                self.assertIsInstance(sandbox_automation, dict)
                self.assertEqual(sandbox_automation.get("status"), "draft")

                live_request = SimpleNamespace(state=SimpleNamespace(actor={}))
                with main._ai_ops_workspace_scope(live_request, live_workspace_id, {"workspace_id": live_workspace_id}):
                    live_before = main.automation_store.get("ai_auto_contacts_inactive_notify")
                self.assertIsNone(live_before)

                release_response = client.post(f"/octo-ai/sessions/{session_id}/releases", json={})
                self.assertEqual(release_response.status_code, 200, release_response.text)
                release_id = release_response.json()["release"]["id"]

                promote_response = client.post(f"/octo-ai/releases/{release_id}/promote", json={})
                self.assertEqual(promote_response.status_code, 200, promote_response.text)

                live_request = SimpleNamespace(state=SimpleNamespace(actor={}))
                with main._ai_ops_workspace_scope(live_request, live_workspace_id, {"workspace_id": live_workspace_id}):
                    live_after = main.automation_store.get("ai_auto_contacts_inactive_notify")
                self.assertIsInstance(live_after, dict)
                self.assertEqual(live_after.get("status"), "published")


if __name__ == "__main__":
    unittest.main()
