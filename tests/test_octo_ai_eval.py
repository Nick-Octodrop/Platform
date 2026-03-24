import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.build_octo_ai_business_suite import build_suite as build_business_suite
from scripts.build_octo_ai_business_suite import business_change_scenario, create_module_scenario
from scripts.octo_ai_curriculum import MUTATION_LIBRARY, _build_provisional_scenario
from scripts.octo_ai_eval import InProcessClient, RemoteClient, _affected_module_ids, _assert_step, _run_scenario


ROOT = Path(__file__).resolve().parents[1]


class _FakeClient:
    def __init__(self) -> None:
        self._session_id = "session-1"

    def request(self, method: str, path: str, body=None):  # type: ignore[no-untyped-def]
        if method == "POST" and path == "/octo-ai/sessions":
            return {"status_code": 200, "body": {"ok": True, "session": {"id": self._session_id}}}
        if method == "POST" and path.endswith("/chat"):
            return {
                "status_code": 200,
                "body": {
                    "ok": True,
                    "assistant_text": "I understand this as adding a Birthday field.",
                    "plan": {"candidate_operations": [{"op": "add_field"}]},
                    "session": {"id": self._session_id},
                },
            }
        if method == "POST" and path.endswith("/patchsets/generate"):
            return {"status_code": 400, "body": {"ok": False, "errors": [{"message": "No candidate operations"}]}}
        if method == "GET" and path.endswith(self._session_id):
            return {"status_code": 200, "body": {"ok": True, "session": {"id": self._session_id}}}
        if method == "DELETE" and path.endswith(self._session_id):
            return {"status_code": 200, "body": {"ok": True}}
        raise AssertionError(f"Unexpected request: {method} {path}")


class _FlakySessionClient:
    def __init__(self) -> None:
        self._session_ids = ["session-1", "session-2"]
        self._create_count = 0

    def request(self, method: str, path: str, body=None):  # type: ignore[no-untyped-def]
        if method == "POST" and path == "/octo-ai/sessions":
            session_id = self._session_ids[min(self._create_count, len(self._session_ids) - 1)]
            self._create_count += 1
            return {"status_code": 200, "body": {"ok": True, "session": {"id": session_id}}}
        if method == "POST" and path == "/octo-ai/sessions/session-1/chat":
            return {
                "status_code": 404,
                "body": {
                    "ok": False,
                    "errors": [{"code": "AI_SESSION_NOT_FOUND", "message": "Session not found", "path": "session_id"}],
                },
            }
        if method == "POST" and path == "/octo-ai/sessions/session-2/chat":
            return {
                "status_code": 200,
                "body": {
                    "ok": True,
                    "assistant_text": "Create a new module 'Vehicle Logbook'.",
                    "plan": {
                        "candidate_operations": [{"op": "create_module"}],
                        "required_questions": ["Confirm this plan?"],
                        "required_question_meta": {"id": "confirm_plan", "kind": "confirm_plan"},
                    },
                    "session": {"id": "session-2", "status": "waiting_input"},
                },
            }
        if method == "GET" and path.endswith("session-2"):
            return {"status_code": 200, "body": {"ok": True, "session": {"id": "session-2"}}}
        if method == "DELETE" and path.endswith("session-2"):
            return {"status_code": 200, "body": {"ok": True}}
        if method == "GET" and path.endswith("session-1"):
            return {
                "status_code": 404,
                "body": {
                    "ok": False,
                    "errors": [{"code": "AI_SESSION_NOT_FOUND", "message": "Session not found", "path": "session_id"}],
                },
            }
        if method == "DELETE" and path.endswith("session-1"):
            return {
                "status_code": 404,
                "body": {
                    "ok": False,
                    "errors": [{"code": "AI_SESSION_NOT_FOUND", "message": "Session not found", "path": "session_id"}],
                },
            }
        raise AssertionError(f"Unexpected request: {method} {path}")


class TestOctoAiEvalRunner(unittest.TestCase):
    def test_create_module_scenario_applies_generic_richness_defaults(self) -> None:
        scenario = create_module_scenario(
            "create_ops_control",
            "Ops Control",
            "Create an Odoo-style operational module with workflow, action buttons, schedule views, and reporting.",
            tags=["complete_module", "workflow"],
        )
        validate = next(step for step in scenario["steps"] if step.get("validate_patchset"))
        expect = validate["expect"]
        manifest_expect = expect["manifest_expect"]
        preview_expect = expect["preview_expect"]

        self.assertGreaterEqual(manifest_expect["min_useful_field_count"], 8)
        self.assertGreaterEqual(manifest_expect["min_action_count"], 2)
        self.assertGreaterEqual(manifest_expect["min_workflow_state_count"], 3)
        self.assertTrue(manifest_expect["statusbar_required"])
        self.assertIn("kanban", manifest_expect["view_kinds_include"])
        self.assertIn("calendar", manifest_expect["view_kinds_include"])
        self.assertIn("schedulable", manifest_expect["interfaces_include"])
        self.assertIn("dashboardable", manifest_expect["interfaces_include"])
        self.assertIn("workflow", preview_expect["text_contains"])
        self.assertIn("status", preview_expect["text_contains"])

    def test_business_change_scenario_applies_cross_module_defaults(self) -> None:
        scenario = business_change_scenario(
            "cross_module_quote_flow",
            "When a Sales quote is approved, create a Job in Jobs and copy customer details from Contacts.",
            tags=["cross_module", "automation", "workflow"],
        )
        validate = next(step for step in scenario["steps"] if step.get("validate_patchset"))
        expect = validate["expect"]
        manifest_expect = expect["manifest_expect"]
        preview_expect = expect["preview_expect"]

        self.assertGreaterEqual(manifest_expect["min_dependency_count"], 1)
        self.assertGreaterEqual(manifest_expect["min_trigger_count"], 1)
        self.assertGreaterEqual(manifest_expect["min_action_count"], 2)
        self.assertGreaterEqual(manifest_expect["min_workflow_state_count"], 3)
        self.assertTrue(manifest_expect["statusbar_required"])
        self.assertIn("Sales", preview_expect["text_contains"])
        self.assertIn("Jobs", preview_expect["text_contains"])
        self.assertIn("Contacts", preview_expect["text_contains"])

    def test_business_suite_prioritizes_rich_scenarios_ahead_of_contacts_edits(self) -> None:
        suite = build_business_suite()
        positions = {item["name"]: idx for idx, item in enumerate(suite)}
        self.assertLess(positions["create_cookbook_studio"], positions["contacts_add_payment_hold"])
        self.assertLess(positions["cross_module_quote_approval_creates_job"], positions["contacts_add_payment_hold"])

    def test_affected_module_ids_prefer_stable_artifact_keys(self) -> None:
        plan = {
            "affected_artifacts": [
                {"artifact_type": "module", "artifact_id": "module_27052f", "artifact_key": "contacts"},
                {"artifact_type": "module", "artifact_id": "fleet_defects"},
            ]
        }

        self.assertEqual(_affected_module_ids(plan), ["contacts", "fleet_defects"])

    def test_assert_step_enforces_manifest_expectations(self) -> None:
        step = {
            "expect": {
                "ok": True,
                "validation_ok": True,
                "manifest_expect": {
                    "min_useful_field_count": 3,
                    "min_action_count": 2,
                    "min_workflow_state_count": 3,
                    "field_labels_include": ["Recipe Name", "Ingredients"],
                    "action_labels_include": ["Plan", "Cook"],
                    "workflow_state_labels_include": ["Draft", "Cooked"],
                    "view_kinds_include": ["list", "form", "calendar"],
                    "page_titles_include": ["My Cooking"],
                    "interfaces_include": ["dashboardable", "schedulable"],
                },
            }
        }
        response = {
            "status_code": 200,
            "body": {
                "ok": True,
                "validation": {
                    "ok": True,
                    "results": [
                        {
                            "manifest": {
                                "entities": [
                                    {
                                        "fields": [
                                            {"id": "my_cooking.id", "label": "ID"},
                                            {"id": "my_cooking.name", "label": "Recipe Name"},
                                            {"id": "my_cooking.ingredients", "label": "Ingredients"},
                                            {"id": "my_cooking.method", "label": "Method"},
                                        ]
                                    }
                                ],
                                "actions": [
                                    {"label": "Plan"},
                                    {"label": "Cook"},
                                ],
                                "workflows": [
                                    {
                                        "states": [{"label": "Draft"}, {"label": "Ready To Cook"}, {"label": "Cooked"}],
                                        "transitions": [{"label": "Plan"}, {"label": "Cook"}],
                                    }
                                ],
                                "views": [{"kind": "list"}, {"kind": "form"}, {"kind": "calendar"}],
                                "pages": [{"title": "My Cooking"}],
                                "interfaces": {"dashboardable": [{}], "schedulable": [{}]},
                            }
                        }
                    ],
                },
            },
        }
        _assert_step(step, response, {})

    def test_assert_step_fails_when_manifest_is_structurally_too_shallow(self) -> None:
        step = {
            "expect": {
                "ok": True,
                "validation_ok": True,
                "manifest_expect": {
                    "min_action_count": 2,
                },
            }
        }
        response = {
            "status_code": 200,
            "body": {
                "ok": True,
                "validation": {
                    "ok": True,
                    "results": [
                        {
                            "manifest": {
                                "entities": [{"fields": [{"id": "x.name", "label": "Title"}]}],
                                "actions": [{"label": "Only One"}],
                            }
                        }
                    ],
                },
            },
        }
        with self.assertRaisesRegex(Exception, "action count 1 below minimum 2"):
            _assert_step(step, response, {})

    def test_assert_step_enforces_preview_and_manifest_alignment(self) -> None:
        step = {
            "expect": {
                "ok": True,
                "validation_ok": True,
                "preview_expect": {
                    "text_contains": ["cookbook", "pantry"],
                    "field_labels_include": ["Recipe Name", "Ingredients"],
                    "action_labels_include": ["Plan", "Cook"],
                    "view_kinds_include": ["list", "form", "calendar"],
                    "interfaces_include": ["dashboardable", "schedulable"],
                },
            }
        }
        response = {
            "status_code": 200,
            "body": {
                "ok": True,
                "validation": {
                    "ok": True,
                    "results": [
                        {
                            "manifest": {
                                "entities": [
                                    {
                                        "fields": [
                                            {"id": "cookbook.recipe_name", "label": "Recipe Name"},
                                            {"id": "cookbook.ingredients", "label": "Ingredients"},
                                        ]
                                    }
                                ],
                                "actions": [{"label": "Plan"}, {"label": "Cook"}],
                                "views": [{"kind": "list"}, {"kind": "form"}, {"kind": "calendar"}],
                                "interfaces": {"dashboardable": [{}], "schedulable": [{}]},
                            }
                        }
                    ],
                },
            },
        }
        state = {
            "latest_assistant_text": "Create a cookbook app with pantry tracking, Recipe Name, Ingredients, Plan and Cook buttons, plus list, form, and calendar views with dashboardable and schedulable interfaces."
        }
        _assert_step(step, response, state)

    def test_assert_step_fails_when_preview_promises_what_manifest_lacks(self) -> None:
        step = {
            "expect": {
                "ok": True,
                "validation_ok": True,
                "preview_expect": {
                    "action_labels_include": ["Plan", "Cook"],
                },
            }
        }
        response = {
            "status_code": 200,
            "body": {
                "ok": True,
                "validation": {
                    "ok": True,
                    "results": [
                        {
                            "manifest": {
                                "entities": [{"fields": [{"id": "cookbook.name", "label": "Recipe Name"}]}],
                                "actions": [{"label": "Plan"}],
                            }
                        }
                    ],
                },
            },
        }
        state = {"latest_assistant_text": "I will add Plan and Cook buttons to the cookbook module."}
        with self.assertRaisesRegex(Exception, "preview expected action label 'Cook', but manifest did not contain it"):
            _assert_step(step, response, state)

    def test_assert_step_enforces_workflow_and_condition_manifest_expectations(self) -> None:
        step = {
            "expect": {
                "ok": True,
                "validation_ok": True,
                "manifest_expect": {
                    "statusbar_required": True,
                    "secondary_action_labels_include": ["Plan", "Cook"],
                    "min_condition_count": 2,
                },
            }
        }
        response = {
            "status_code": 200,
            "body": {
                "ok": True,
                "validation": {
                    "ok": True,
                    "results": [
                        {
                            "manifest": {
                                "entities": [
                                    {
                                        "fields": [
                                            {"id": "cookbook.status", "label": "Status", "required_when": {"op": "eq", "field": "cookbook.status", "value": "cooked"}},
                                            {"id": "cookbook.follow_up", "label": "Follow Up", "visible_when": {"op": "eq", "field": "cookbook.status", "value": "cooked"}},
                                        ]
                                    }
                                ],
                                "actions": [
                                    {"id": "action.plan", "label": "Plan", "visible_when": {"op": "eq", "field": "cookbook.status", "value": "draft"}},
                                    {"id": "action.cook", "label": "Cook", "enabled_when": {"op": "eq", "field": "cookbook.status", "value": "ready"}},
                                ],
                                "views": [
                                    {
                                        "kind": "form",
                                        "header": {
                                            "statusbar": {"field_id": "cookbook.status"},
                                            "secondary_actions": [{"action_id": "action.plan"}, {"action_id": "action.cook"}],
                                        },
                                    }
                                ],
                            }
                        }
                    ],
                },
            },
        }
        _assert_step(step, response, {})

    def test_assert_step_enforces_cross_module_behavior_expectations(self) -> None:
        step = {
            "expect": {
                "ok": True,
                "validation_ok": True,
                "manifest_expect": {
                    "min_trigger_count": 1,
                    "min_transformation_count": 1,
                    "min_dependency_count": 1,
                },
            }
        }
        response = {
            "status_code": 200,
            "body": {
                "ok": True,
                "validation": {
                    "ok": True,
                    "results": [
                        {
                            "manifest": {
                                "triggers": [{"id": "t1"}],
                                "transformations": [{"id": "x1"}],
                                "depends_on": {"required": [{"module": "contacts"}]},
                            }
                        }
                    ],
                },
            },
        }
        _assert_step(step, response, {})

    def test_business_suite_regressions_pass_in_process(self) -> None:
        suite = json.loads((ROOT / "specs" / "octo_ai_eval_business_suite.json").read_text(encoding="utf-8"))
        scenarios = {
            item["name"]: item
            for item in suite
            if isinstance(item, dict) and item.get("name") in {
                "contacts_add_payment_hold",
                "contacts_cleanup_duplicate_supplier_rating",
                "create_candidate_pipeline",
                "real_world_vendor_compliance_module",
            }
        }
        self.assertEqual(len(scenarios), 4)
        client = InProcessClient()
        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                outdir = Path(tmpdir)
                for name in (
                    "contacts_add_payment_hold",
                    "contacts_cleanup_duplicate_supplier_rating",
                    "create_candidate_pipeline",
                    "real_world_vendor_compliance_module",
                ):
                    result = _run_scenario(client, scenarios[name], outdir, fail_fast=False)
                    self.assertTrue(result.get("passed"), json.dumps(result, indent=2))
        finally:
            client.close()

    def test_preview_suite_multi_request_contacts_bundle_passes_in_process(self) -> None:
        suite = json.loads((ROOT / "specs" / "octo_ai_eval_planner_preview_suite.json").read_text(encoding="utf-8"))
        scenarios = {
            item["name"]: item
            for item in suite
            if isinstance(item, dict) and item.get("name") == "preview_multi_request_contacts_master_bundle"
        }
        self.assertEqual(len(scenarios), 1)
        client = InProcessClient()
        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                result = _run_scenario(
                    client,
                    scenarios["preview_multi_request_contacts_master_bundle"],
                    Path(tmpdir),
                    fail_fast=False,
                )
                self.assertTrue(result.get("passed"), json.dumps(result, indent=2))
        finally:
            client.close()

    def test_preview_suite_create_vehicle_logbook_passes_in_process(self) -> None:
        suite = json.loads((ROOT / "specs" / "octo_ai_eval_planner_preview_suite.json").read_text(encoding="utf-8"))
        scenarios = {
            item["name"]: item
            for item in suite
            if isinstance(item, dict) and item.get("name") == "preview_create_vehicle_logbook"
        }
        self.assertEqual(len(scenarios), 1)
        client = InProcessClient()
        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                result = _run_scenario(
                    client,
                    scenarios["preview_create_vehicle_logbook"],
                    Path(tmpdir),
                    fail_fast=False,
                )
                self.assertTrue(result.get("passed"), json.dumps(result, indent=2))
        finally:
            client.close()

    def test_preview_suite_workspace_graph_field_rollout_passes_in_process(self) -> None:
        suite = json.loads((ROOT / "specs" / "octo_ai_eval_planner_preview_suite.json").read_text(encoding="utf-8"))
        scenarios = {
            item["name"]: item
            for item in suite
            if isinstance(item, dict) and item.get("name") == "preview_workspace_graph_field_rollout"
        }
        self.assertEqual(len(scenarios), 1)
        client = InProcessClient()
        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                result = _run_scenario(
                    client,
                    scenarios["preview_workspace_graph_field_rollout"],
                    Path(tmpdir),
                    fail_fast=False,
                )
                self.assertTrue(result.get("passed"), json.dumps(result, indent=2))
        finally:
            client.close()

    def test_preview_suite_workspace_graph_service_level_rollout_passes_in_process(self) -> None:
        scenario = {
            "name": "preview_workspace_graph_field_rollout__service_level_rollout",
            "session": {
                "title": "preview_workspace_graph_field_rollout__service_level_rollout",
                "scope_mode": "auto",
                "selected_artifact_type": "none",
                "selected_artifact_key": "",
            },
            "steps": [
                {
                    "chat": "Across Contacts, Jobs, and Invoices, add a Service Level field and keep it consistent everywhere. Show me the module-by-module rollout and any dependency notes before you build it.",
                    "expect": {
                        "ok": True,
                        "question_required": True,
                        "question_id": "confirm_plan",
                        "assistant_text_contains": [
                            "Contacts",
                            "Jobs",
                            "Invoices",
                            "Service Level",
                            "dependency",
                        ],
                        "assistant_text_not_contains": [
                            "candidate_operations",
                            "artifact_id",
                            "manifest",
                        ],
                    },
                }
            ],
        }
        client = InProcessClient()
        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                result = _run_scenario(
                    client,
                    scenario,
                    Path(tmpdir),
                    fail_fast=False,
                )
                self.assertTrue(result.get("passed"), json.dumps(result, indent=2))
        finally:
            client.close()

    def test_preview_suite_workspace_graph_approvals_bundle_passes_in_process(self) -> None:
        suite = json.loads((ROOT / "specs" / "octo_ai_eval_planner_preview_suite.json").read_text(encoding="utf-8"))
        scenarios = {
            item["name"]: item
            for item in suite
            if isinstance(item, dict) and item.get("name") == "preview_workspace_graph_approvals_bundle"
        }
        self.assertEqual(len(scenarios), 1)
        client = InProcessClient()
        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                result = _run_scenario(
                    client,
                    scenarios["preview_workspace_graph_approvals_bundle"],
                    Path(tmpdir),
                    fail_fast=False,
                )
                self.assertTrue(result.get("passed"), json.dumps(result, indent=2))
        finally:
            client.close()

    def test_preview_suite_missing_field_noop_regressions_pass_in_process(self) -> None:
        suite = json.loads((ROOT / "specs" / "octo_ai_eval_planner_preview_suite.json").read_text(encoding="utf-8"))
        base_scenarios = {
            item["name"]: item
            for item in suite
            if isinstance(item, dict) and item.get("name") in {
                "preview_contacts_remove_roblux_noop",
                "preview_scope_switch_to_contacts_remove_roblux",
            }
        }
        self.assertEqual(
            set(base_scenarios.keys()),
            {"preview_contacts_remove_roblux_noop", "preview_scope_switch_to_contacts_remove_roblux"},
        )
        vip_flag_mutation = MUTATION_LIBRARY["preview_contacts_remove_roblux_noop"][0]
        scenarios = {
            **base_scenarios,
            "preview_contacts_remove_roblux_noop__vip_flag_noop": _build_provisional_scenario(
                base_scenarios["preview_contacts_remove_roblux_noop"],
                vip_flag_mutation,
            ),
        }
        client = InProcessClient()
        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                outdir = Path(tmpdir)
                for name in (
                    "preview_contacts_remove_roblux_noop",
                    "preview_contacts_remove_roblux_noop__vip_flag_noop",
                    "preview_scope_switch_to_contacts_remove_roblux",
                ):
                    result = _run_scenario(client, scenarios[name], outdir, fail_fast=False)
                    self.assertTrue(result.get("passed"), json.dumps(result, indent=2))
        finally:
            client.close()

    def test_preview_suite_long_guide_regressions_pass_in_process(self) -> None:
        suite = json.loads((ROOT / "specs" / "octo_ai_eval_planner_preview_suite.json").read_text(encoding="utf-8"))
        scenarios = {
            item["name"]: item
            for item in suite
            if isinstance(item, dict) and item.get("name") in {
                "preview_long_guide_service_business_platform",
                "preview_long_guide_manufacturing_workspace",
            }
        }
        self.assertEqual(len(scenarios), 2)
        client = InProcessClient()
        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                outdir = Path(tmpdir)
                for name in (
                    "preview_long_guide_service_business_platform",
                    "preview_long_guide_manufacturing_workspace",
                ):
                    result = _run_scenario(client, scenarios[name], outdir, fail_fast=False)
                    self.assertTrue(result.get("passed"), json.dumps(result, indent=2))
        finally:
            client.close()

    def test_preview_real_world_quote_to_job_uses_requested_module_names(self) -> None:
        scenario = {
            "name": "preview_real_world_quote_to_job_uses_requested_module_names",
            "session": {
                "title": "preview_real_world_quote_to_job_uses_requested_module_names",
                "scope_mode": "auto",
                "selected_artifact_type": "none",
                "selected_artifact_key": "",
            },
            "steps": [
                {
                    "chat": "When a Quote is approved, automatically create a Job, copy the customer and site details across, and notify the coordinator.",
                    "expect": {
                        "ok": True,
                        "question_required": True,
                        "question_id": "confirm_plan",
                        "assistant_text_contains": [
                            "Quotes",
                            "Jobs",
                        ],
                        "assistant_text_not_contains": [
                            "Sales module",
                            "sales and Contacts modules",
                        ],
                    },
                }
            ],
        }
        client = InProcessClient()
        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                result = _run_scenario(client, scenario, Path(tmpdir), fail_fast=False)
                self.assertTrue(result.get("passed"), json.dumps(result, indent=2))
        finally:
            client.close()

    def test_preview_real_world_requested_scope_summary_stays_user_facing(self) -> None:
        scenario = {
            "name": "preview_real_world_requested_scope_summary_stays_user_facing",
            "session": {
                "title": "preview_real_world_requested_scope_summary_stays_user_facing",
                "scope_mode": "auto",
                "selected_artifact_type": "none",
                "selected_artifact_key": "",
            },
            "steps": [
                {
                    "chat": "Across Jobs, Quotes, and Invoices, add approval actions and conditional fields so the right form sections only appear after approval. Show the workspace rollout and dependencies before building anything.",
                    "expect": {
                        "ok": True,
                        "question_required": True,
                        "question_id": "confirm_plan",
                        "assistant_text_contains": [
                            "Plan a preview-first rollout across Jobs, Quotes, and Invoices.",
                            "You named 3 modules: Jobs, Quotes, and Invoices.",
                        ],
                        "assistant_text_not_contains": [
                            "Sales and Contacts modules",
                        ],
                    },
                }
            ],
        }
        client = InProcessClient()
        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                result = _run_scenario(client, scenario, Path(tmpdir), fail_fast=False)
                self.assertTrue(result.get("passed"), json.dumps(result, indent=2))
        finally:
            client.close()

    def test_failed_scenario_report_keeps_response_context(self) -> None:
        scenario = {
            "name": "contacts_add_birthday",
            "steps": [
                {"chat": "Add Birthday to Contacts.", "expect": {"ok": True}},
                {"generate_patchset": True, "expect": {"ok": True}},
            ],
        }
        with tempfile.TemporaryDirectory() as tmpdir:
            result = _run_scenario(_FakeClient(), scenario, Path(tmpdir), fail_fast=False)
            self.assertEqual(result.get("status"), "failed")
            self.assertFalse(result.get("passed"))
            self.assertEqual(result.get("failure_stage"), "generate_patchset")
            self.assertTrue(any(step.get("response", {}).get("status_code") == 400 for step in result.get("steps", [])))

    def test_runner_recovers_from_missing_session_during_chat(self) -> None:
        scenario = {
            "name": "preview_create_vehicle_logbook",
            "session": {"title": "preview_create_vehicle_logbook"},
            "steps": [
                {
                    "chat": "Create a simple module to track vehicle usage, odometer readings, drivers, and notes. Call it Vehicle Logbook.",
                    "expect": {
                        "ok": True,
                        "question_required": True,
                        "question_id": "confirm_plan",
                        "assistant_text_contains": ["Create a new module 'Vehicle Logbook'."],
                    },
                }
            ],
        }
        with tempfile.TemporaryDirectory() as tmpdir:
            result = _run_scenario(_FlakySessionClient(), scenario, Path(tmpdir), fail_fast=False)
            self.assertTrue(result.get("passed"), json.dumps(result, indent=2))
            self.assertEqual(result.get("session_id"), "session-2")
            self.assertEqual(len(result.get("session_recoveries") or []), 1)

    def test_remote_client_retries_transient_connection_reset_once(self) -> None:
        class _Response:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def read(self) -> bytes:
                return b'{"ok": true}'

        client = RemoteClient("http://example.test")
        calls = {"count": 0}

        def _fake_urlopen(req, timeout=60):  # type: ignore[no-untyped-def]
            calls["count"] += 1
            if calls["count"] == 1:
                raise ConnectionResetError("[WinError 10054] An existing connection was forcibly closed by the remote host")
            return _Response()

        with patch("scripts.octo_ai_eval.urllib.request.urlopen", side_effect=_fake_urlopen), patch("scripts.octo_ai_eval.time.sleep", return_value=None):
            response = client.request("POST", "/octo-ai/sessions/session-1/chat", {"message": "hello"})

        self.assertEqual(calls["count"], 2)
        self.assertEqual(response.get("status_code"), 200)
        self.assertTrue(response.get("body", {}).get("ok"))

    def test_smoke_suite_passes(self) -> None:
        scenario_file = ROOT / "specs" / "octo_ai_eval_smoke.json"
        script = ROOT / "scripts" / "octo_ai_eval.py"
        python_bin = ROOT / ".venv" / "Scripts" / "python.exe"
        python_cmd = str(python_bin) if python_bin.exists() else sys.executable
        with tempfile.TemporaryDirectory() as tmpdir:
            env = os.environ.copy()
            env.setdefault("USE_DB", "0")
            env.setdefault("OCTO_DISABLE_AUTH", "1")
            env.setdefault("SUPABASE_URL", "http://localhost")
            proc = subprocess.run(
                [python_cmd, str(script), "--scenario-file", str(scenario_file), "--output-dir", tmpdir],
                cwd=str(ROOT),
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(proc.returncode, 0, proc.stdout + "\n" + proc.stderr)

            summary_path = Path(tmpdir) / "summary.json"
            self.assertTrue(summary_path.exists(), proc.stdout + "\n" + proc.stderr)
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
            self.assertEqual(summary.get("scenario_failures"), 0, summary)

    def test_contacts_edit_flow_passes_with_local_baseline_seed(self) -> None:
        script = ROOT / "scripts" / "octo_ai_eval.py"
        python_bin = ROOT / ".venv" / "Scripts" / "python.exe"
        python_cmd = str(python_bin) if python_bin.exists() else sys.executable
        scenario = [
            {
                "name": "contacts_add_birthday_local_seed",
                "session": {
                    "title": "contacts_add_birthday_local_seed",
                    "scope_mode": "auto",
                    "selected_artifact_type": "none",
                    "selected_artifact_key": "",
                },
                "steps": [
                    {"chat": "Add a Birthday field to the Contacts module form only."},
                    {
                        "answer_if_question": {
                            "question_id": "field_spec",
                            "text": "Birthday",
                            "hints": {"field_label": "Birthday", "field_type": "date"},
                        }
                    },
                    {"answer_if_question": {"question_id": "placement", "text": "Include it in form only."}},
                    {"answer_if_question": {"question_id": "confirm_plan", "text": "Approved."}},
                    {"generate_patchset": True, "expect": {"ok": True, "patchset_status": "draft"}},
                    {
                        "validate_patchset": True,
                        "expect": {"ok": True, "patchset_status": "validated", "validation_ok": True},
                    },
                ],
            }
        ]
        with tempfile.TemporaryDirectory() as tmpdir:
            scenario_path = Path(tmpdir) / "scenario.json"
            scenario_path.write_text(json.dumps(scenario), encoding="utf-8")
            env = os.environ.copy()
            env.setdefault("USE_DB", "0")
            env.setdefault("OCTO_DISABLE_AUTH", "1")
            env.setdefault("SUPABASE_URL", "http://localhost")
            proc = subprocess.run(
                [python_cmd, str(script), "--scenario-file", str(scenario_path), "--output-dir", tmpdir],
                cwd=str(ROOT),
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(proc.returncode, 0, proc.stdout + "\n" + proc.stderr)

            summary_path = Path(tmpdir) / "summary.json"
            self.assertTrue(summary_path.exists(), proc.stdout + "\n" + proc.stderr)
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
            self.assertEqual(summary.get("scenario_failures"), 0, summary)


if __name__ == "__main__":
    unittest.main()
