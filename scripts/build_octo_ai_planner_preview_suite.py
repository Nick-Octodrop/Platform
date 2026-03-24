#!/usr/bin/env python3
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "specs" / "octo_ai_eval_planner_preview_suite.json"
PROMPT_BANK = ROOT / "specs" / "octo_ai_real_world_prompt_bank.json"

REAL_WORLD_LEVELS = {
    "module_creation": 1,
    "workflow_status_actions": 3,
    "forms_fields_layout": 5,
    "automations_notifications": 6,
    "templates_documents": 6,
    "dashboards_reporting": 6,
    "integrations_sync": 7,
    "cross_module_rollouts": 7,
}

REAL_WORLD_TAGS = {
    "module_creation": ["create_module", "real_world"],
    "workflow_status_actions": ["workflow_actions", "real_world"],
    "forms_fields_layout": ["conditional_forms", "form_layout", "real_world"],
    "automations_notifications": ["automation", "real_world"],
    "templates_documents": ["templates", "documents", "real_world"],
    "dashboards_reporting": ["dashboard", "reporting", "real_world"],
    "integrations_sync": ["integrations", "sandbox_rollout", "real_world"],
    "cross_module_rollouts": ["workspace_graph", "cross_module", "real_world"],
}


def _session(title: str) -> dict:
    return {
        "title": title,
        "scope_mode": "auto",
        "selected_artifact_type": "none",
        "selected_artifact_key": "",
    }


def _chat_step(prompt: str, expect: dict) -> dict:
    return {"chat": prompt, "expect": expect}


def _load_prompt_bank() -> list[dict]:
    try:
        raw = json.loads(PROMPT_BANK.read_text(encoding="utf-8"))
    except Exception:
        return []
    prompts = raw.get("prompts") if isinstance(raw, dict) else None
    return [item for item in prompts if isinstance(item, dict)] if isinstance(prompts, list) else []


def _dedupe_strings(values: list[str]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for value in values:
        cleaned = value.strip()
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        output.append(cleaned)
    return output


def _module_titles_from_prompt(prompt: str, suite_seed: dict | None = None) -> list[str]:
    if isinstance(suite_seed, dict):
        module_name = suite_seed.get("module_name")
        if isinstance(module_name, str) and module_name.strip():
            return [module_name.strip()]

    prompt = prompt.strip()
    titles: list[str] = []
    across_match = re.search(
        r"^(?:Across)\s+(.+?)(?:,\s+(?:add|build|show|make|keep|include|set|sync)\b|\s+add\b|\s+build\b|\s+show\b)",
        prompt,
        re.IGNORECASE,
    )
    if across_match:
        chunk = across_match.group(1).replace(" and ", ", ")
        for part in chunk.split(","):
            title = part.strip()
            if title:
                titles.append(title)
        return _dedupe_strings(titles)

    scope_match = re.search(
        r"^(?:In|For)\s+(.+?)(?:,\s+|\s+(?:add|build|show|make|keep|give|create|set|if)\b)",
        prompt,
        re.IGNORECASE,
    )
    if scope_match:
        title = scope_match.group(1).strip()
        if title:
            titles.append(title)
    return _dedupe_strings(titles)


def _real_world_expect(item: dict) -> dict:
    prompt = item.get("prompt") if isinstance(item.get("prompt"), str) else ""
    suite_seed = item.get("suite_seed") if isinstance(item.get("suite_seed"), dict) else None
    modules = _module_titles_from_prompt(prompt, suite_seed)
    assistant_text_contains = ["Planned changes:"]
    assistant_text_contains.extend(modules[:4])
    if item.get("category") == "module_creation" and modules:
        assistant_text_contains.insert(0, f"Create a new module '{modules[0]}'.")
    return {
        "ok": True,
        "question_required": True,
        "question_id": "confirm_plan",
        "assistant_text_contains": _dedupe_strings(assistant_text_contains),
        "assistant_text_not_contains": [
            "candidate_operations",
            "artifact_id",
            "manifest",
        ],
    }


def _real_world_preview_scenario(item: dict) -> dict | None:
    prompt = item.get("prompt")
    item_id = item.get("id")
    category = item.get("category")
    if not isinstance(prompt, str) or not prompt.strip():
        return None
    if not isinstance(item_id, str) or not item_id.strip():
        return None
    if not isinstance(category, str) or category not in REAL_WORLD_LEVELS:
        return None

    tags = ["preview_contract", category]
    tags.extend(REAL_WORLD_TAGS.get(category, []))
    business_type = item.get("business_type")
    if isinstance(business_type, str) and business_type.strip():
        tags.append(f"business_{business_type.strip()}")

    return {
        "name": f"preview_real_world_{item_id.strip()}",
        "level": REAL_WORLD_LEVELS[category],
        "tags": _dedupe_strings(tags),
        "session": _session(f"preview_real_world_{item_id.strip()}"),
        "steps": [
            _chat_step(
                prompt.strip(),
                _real_world_expect(item),
            )
        ],
    }


def build_suite() -> list[dict]:
    suite = [
        {
            "name": "preview_create_vehicle_logbook",
            "level": 1,
            "tags": ["preview_contract", "create_module", "plain_language"],
            "session": _session("preview_create_vehicle_logbook"),
            "steps": [
                _chat_step(
                    "Create a simple module to track vehicle usage, odometer readings, drivers, and notes. Call it Vehicle Logbook.",
                    {
                        "ok": True,
                        "question_required": True,
                        "question_id": "confirm_plan",
                        "assistant_text_contains": [
                            "Create a new module 'Vehicle Logbook'.",
                            "Create module 'Vehicle Logbook'.",
                        ],
                        "assistant_text_not_contains": [
                            "candidate_operations",
                            "artifact_id",
                            "manifest",
                        ],
                    },
                )
            ],
        },
        {
            "name": "preview_contacts_add_birthday",
            "level": 1,
            "tags": ["preview_contract", "contacts_change", "plain_language"],
            "session": _session("preview_contacts_add_birthday"),
            "steps": [
                _chat_step(
                    "Add a Birthday field to the Contacts module form only.",
                    {
                        "ok": True,
                        "question_required": True,
                        "question_id": "confirm_plan",
                        "assistant_text_contains": [
                            "Add field 'Birthday' (date) in Contacts.",
                        ],
                        "assistant_text_not_contains": [
                            "candidate_operations",
                            "artifact_id",
                            "manifest",
                        ],
                        "affected_modules_include": ["contacts"],
                    },
                )
            ],
        },
        {
            "name": "preview_contacts_remove_roblux_noop",
            "level": 1,
            "tags": ["preview_contract", "noop", "contacts_change"],
            "session": _session("preview_contacts_remove_roblux_noop"),
            "steps": [
                _chat_step(
                    "Remove the roblux field from the Contacts module.",
                    {
                        "ok": True,
                        "question_required": False,
                        "assistant_text_contains": [
                            "No changes are needed right now.",
                        ],
                        "assistant_text_not_contains": [
                            "candidate_operations",
                            "artifact_id",
                            "manifest",
                        ],
                        "affected_modules_include": ["contacts"],
                    },
                )
            ],
        },
        {
            "name": "preview_upgrade_contacts_latest_style",
            "level": 2,
            "tags": ["preview_contract", "upgrade", "contacts_change"],
            "session": _session("preview_upgrade_contacts_latest_style"),
            "steps": [
                _chat_step(
                    "Upgrade the Contacts module to use the latest recommended module design style.",
                    {
                        "ok": True,
                        "question_required": True,
                        "question_id": "confirm_plan",
                        "assistant_text_contains": [
                            "Contacts",
                        ],
                        "assistant_text_not_contains": [
                            "candidate_operations",
                            "artifact_id",
                        ],
                        "affected_modules_include": ["contacts"],
                    },
                )
            ],
        },
        {
            "name": "preview_scope_switch_to_contacts_remove_roblux",
            "level": 2,
            "tags": ["preview_contract", "scope_switch", "contacts_change"],
            "session": _session("preview_scope_switch_to_contacts_remove_roblux"),
            "steps": [
                {"chat": "For Neetones, make it list-first with useful views."},
                _chat_step(
                    "Now remove the roblux field from the Contacts module.",
                    {
                        "ok": True,
                        "question_required": False,
                        "assistant_text_contains": [
                            "Contacts",
                            "No changes are needed right now.",
                        ],
                        "assistant_text_not_contains": [
                            "candidate_operations",
                            "artifact_id",
                            "manifest",
                        ],
                        "affected_modules_include": ["contacts"],
                    },
                ),
            ],
        },
        {
            "name": "preview_multi_request_contacts_master_bundle",
            "level": 3,
            "tags": ["preview_contract", "multi_request", "large_request"],
            "session": _session("preview_multi_request_contacts_master_bundle"),
            "steps": [
                _chat_step(
                    "Add a new field in the Contacts module called Roblux. Create a new tab in that module called Master. Put a Master Notes field in that tab.",
                    {
                        "ok": True,
                        "question_required": True,
                        "question_id": "confirm_plan",
                        "assistant_text_contains": [
                            "Add field 'Roblux'",
                            "Create tab 'Master'",
                            "Add field 'Master Notes'",
                        ],
                        "assistant_text_not_contains": [
                            "candidate_operations",
                            "artifact_id",
                            "manifest",
                        ],
                        "affected_modules_include": ["contacts"],
                    },
                )
            ],
        },
        {
            "name": "preview_contacts_status_action_contacted",
            "level": 3,
            "tags": ["preview_contract", "workflow_actions", "contacts_change", "status_update"],
            "session": _session("preview_contacts_status_action_contacted"),
            "steps": [
                _chat_step(
                    'In Contacts, add a new Contacted status and add an action button called Set: Contacted so staff can move records through that status clearly.',
                    {
                        "ok": True,
                        "question_required": True,
                        "question_id": "confirm_plan",
                        "assistant_text_contains": [
                            "Add status 'Contacted' to Contacts.",
                            "Update the status workflow and action buttons in Contacts.",
                        ],
                        "assistant_text_not_contains": [
                            "candidate_operations",
                            "artifact_id",
                            "manifest",
                        ],
                        "affected_modules_include": ["contacts"],
                    },
                )
            ],
        },
        {
            "name": "preview_contacts_master_attachment_floor_plans",
            "level": 3,
            "tags": ["preview_contract", "attachments", "form_layout", "contacts_change"],
            "session": _session("preview_contacts_master_attachment_floor_plans"),
            "steps": [
                _chat_step(
                    "In Contacts, add an attachment field in the Master tab labeled Floor plans.",
                    {
                        "ok": True,
                        "question_required": True,
                        "question_id": "confirm_plan",
                        "assistant_text_contains": [
                            "Add field 'Floor plans' (attachments) in Contacts.",
                            "Master",
                        ],
                        "assistant_text_not_contains": [
                            "candidate_operations",
                            "artifact_id",
                            "manifest",
                        ],
                        "affected_modules_include": ["contacts"],
                    },
                )
            ],
        },
        {
            "name": "preview_cross_module_contacts_jobs_bundle",
            "level": 4,
            "tags": ["preview_contract", "cross_module", "multi_request"],
            "session": _session("preview_cross_module_contacts_jobs_bundle"),
            "steps": [
                _chat_step(
                    "In Contacts, add a Customer Tier field. In Jobs, add a Preferred Technician field and show both plans clearly before you build anything.",
                    {
                        "ok": True,
                        "question_required": True,
                        "question_id": "confirm_plan",
                        "assistant_text_contains": [
                            "Contacts",
                            "Jobs",
                            "Customer Tier",
                            "Preferred Technician",
                        ],
                        "assistant_text_not_contains": [
                            "candidate_operations",
                            "artifact_id",
                            "manifest",
                        ],
                    },
                )
            ],
        },
        {
            "name": "preview_jobs_conditional_completion_fields",
            "level": 5,
            "tags": ["preview_contract", "conditional_forms", "workflow_actions", "jobs_change"],
            "session": _session("preview_jobs_conditional_completion_fields"),
            "steps": [
                _chat_step(
                    "In Jobs, add a Completion Notes field that only shows when the status is Completed, and make a Follow-up Date required in that state.",
                    {
                        "ok": True,
                        "question_required": True,
                        "question_id": "confirm_plan",
                        "assistant_text_contains": [
                            "Jobs",
                            "Completion Notes",
                            "Follow-up Date",
                        ],
                        "assistant_text_not_contains": [
                            "candidate_operations",
                            "artifact_id",
                            "manifest",
                        ],
                    },
                )
            ],
        },
        {
            "name": "preview_create_training_compliance_human_name",
            "level": 1,
            "tags": ["preview_contract", "create_module", "naming"],
            "session": _session("preview_create_training_compliance_human_name"),
            "steps": [
                _chat_step(
                    "Create a module called Training Compliance with due, booked, completed, and overdue statuses.",
                    {
                        "ok": True,
                        "question_required": True,
                        "question_id": "confirm_plan",
                        "assistant_text_contains": [
                            "Training Compliance",
                        ],
                        "assistant_text_not_contains": [
                            "training_compliance",
                            "candidate_operations",
                            "artifact_id",
                        ],
                    },
                )
            ],
        },
        {
            "name": "preview_workspace_graph_conditional_ops_rollout",
            "level": 6,
            "tags": ["preview_contract", "workspace_graph", "conditional_forms", "workflow_actions"],
            "session": _session("preview_workspace_graph_conditional_ops_rollout"),
            "steps": [
                _chat_step(
                    "Across Jobs, Quotes, and Invoices, add approval actions and conditional fields so the right form sections only appear after approval. Show the workspace rollout and dependencies before building anything.",
                    {
                        "ok": True,
                        "question_required": True,
                        "question_id": "confirm_plan",
                        "assistant_text_contains": [
                            "Jobs",
                            "Quotes",
                            "Invoices",
                            "approval",
                            "dependency",
                        ],
                        "assistant_text_not_contains": [
                            "candidate_operations",
                            "artifact_id",
                            "manifest",
                        ],
                    },
                )
            ],
        },
        {
            "name": "preview_large_brief_candidate_pipeline",
            "level": 5,
            "tags": ["preview_contract", "large_request", "create_module"],
            "session": _session("preview_large_brief_candidate_pipeline"),
            "steps": [
                _chat_step(
                    "Build a recruitment system called Candidate Pipeline with stages Applied, Screen, Interview, Offer, Hired. Include useful views, a status workflow, and clear admin-facing wording before any patching.",
                    {
                        "ok": True,
                        "question_required": True,
                        "question_id": "confirm_plan",
                        "assistant_text_contains": [
                            "Candidate Pipeline",
                            "Applied",
                            "Interview",
                            "Hired",
                        ],
                        "assistant_text_not_contains": [
                            "candidate_operations",
                            "artifact_id",
                            "manifest",
                        ],
                    },
                )
            ],
        },
        {
            "name": "preview_remove_calendar_from_contacts",
            "level": 2,
            "tags": ["preview_contract", "view_change", "contacts_change"],
            "session": _session("preview_remove_calendar_from_contacts"),
            "steps": [
                _chat_step(
                    "Remove the calendar from my Contacts module record and list experience.",
                    {
                        "ok": True,
                        "assistant_text_not_contains": [
                            "entity not found",
                            "candidate_operations",
                            "artifact_id",
                        ],
                        "affected_modules_include": ["contacts"],
                    },
                )
            ],
        },
        {
            "name": "preview_contacts_add_account_manager_notes",
            "level": 2,
            "tags": ["preview_contract", "contacts_change", "plain_language"],
            "session": _session("preview_contacts_add_account_manager_notes"),
            "steps": [
                _chat_step(
                    "Add Account Manager Notes to Contacts and put it in the Internal Notes tab.",
                    {
                        "ok": True,
                        "question_required": True,
                        "question_id": "confirm_plan",
                        "assistant_text_contains": [
                            "Add field 'Account Manager Notes' (text) in Contacts.",
                            "Internal Notes",
                        ],
                        "assistant_text_not_contains": [
                            "candidate_operations",
                            "artifact_id",
                        ],
                        "affected_modules_include": ["contacts"],
                    },
                )
            ],
        },
        {
            "name": "preview_large_system_brief_service_ops",
            "level": 5,
            "tags": ["preview_contract", "large_request", "system_build"],
            "session": _session("preview_large_system_brief_service_ops"),
            "steps": [
                _chat_step(
                    "Build me a small service operations system with work orders, technician scheduling, customer visits, job notes, and completion status. Explain everything you plan to add before building it.",
                    {
                        "ok": True,
                        "question_required": True,
                        "assistant_text_contains": [
                            "I understand this as:",
                            "Planned changes:",
                        ],
                        "assistant_text_not_contains": [
                            "candidate_operations",
                            "artifact_id",
                            "manifest",
                        ],
                    },
                )
            ],
        },
        {
            "name": "preview_workspace_graph_field_rollout",
            "level": 6,
            "tags": ["preview_contract", "workspace_graph", "cross_module", "dependency_planning"],
            "session": _session("preview_workspace_graph_field_rollout"),
            "steps": [
                _chat_step(
                    "Across Contacts, Jobs, and Quotes, add a Customer Priority field and keep it consistent everywhere. Show me the module-by-module rollout and any dependency notes before you build it.",
                    {
                        "ok": True,
                        "question_required": True,
                        "question_id": "confirm_plan",
                        "assistant_text_contains": [
                            "Contacts",
                            "Jobs",
                            "Quotes",
                            "Customer Priority",
                            "dependency",
                        ],
                        "assistant_text_not_contains": [
                            "candidate_operations",
                            "artifact_id",
                            "manifest",
                        ],
                    },
                )
            ],
        },
        {
            "name": "preview_workspace_graph_approvals_bundle",
            "level": 6,
            "tags": ["preview_contract", "workspace_graph", "cross_module", "system_build"],
            "session": _session("preview_workspace_graph_approvals_bundle"),
            "steps": [
                _chat_step(
                    "Add approvals to our Jobs workspace flow. I want approval status in Jobs, approved-by details in Contacts, and approval history visible in Quotes. Explain the workspace impact clearly before building anything.",
                    {
                        "ok": True,
                        "question_required": True,
                        "question_id": "confirm_plan",
                        "assistant_text_contains": [
                            "Jobs",
                            "Contacts",
                            "Quotes",
                            "approval",
                            "workspace impact",
                        ],
                        "assistant_text_not_contains": [
                            "candidate_operations",
                            "artifact_id",
                            "manifest",
                        ],
                    },
                )
            ],
        },
        {
            "name": "preview_sandbox_rollout_dispatch_system",
            "level": 7,
            "tags": ["preview_contract", "sandbox_rollout", "system_build", "large_request"],
            "session": _session("preview_sandbox_rollout_dispatch_system"),
            "steps": [
                _chat_step(
                    "Build a dispatch system for field work, but explain the sandbox, preview, validation, and rollout steps before anything is applied to my live workspace.",
                    {
                        "ok": True,
                        "question_required": True,
                        "question_id": "confirm_plan",
                        "assistant_text_contains": [
                            "sandbox",
                            "preview",
                            "validation",
                            "rollout",
                        ],
                        "assistant_text_not_contains": [
                            "candidate_operations",
                            "artifact_id",
                            "manifest",
                        ],
                    },
                )
            ],
        },
        {
            "name": "preview_rollback_safe_finance_changes",
            "level": 7,
            "tags": ["preview_contract", "sandbox_rollout", "rollback", "cross_module"],
            "session": _session("preview_rollback_safe_finance_changes"),
            "steps": [
                _chat_step(
                    "We need to change invoicing and quote approvals, but I want a safe rollback path if the new flow confuses staff. Explain the validation and rollback plan before you build it.",
                    {
                        "ok": True,
                        "question_required": True,
                        "question_id": "confirm_plan",
                        "assistant_text_contains": [
                            "validation",
                            "rollback",
                            "Quotes",
                            "Invoices",
                        ],
                        "assistant_text_not_contains": [
                            "candidate_operations",
                            "artifact_id",
                            "manifest",
                        ],
                    },
                )
            ],
        },
        {
            "name": "preview_long_guide_service_business_platform",
            "level": 8,
            "tags": ["preview_contract", "long_guide", "system_build", "workspace_graph"],
            "session": _session("preview_long_guide_service_business_platform"),
            "steps": [
                _chat_step(
                    "Use this guide to design the workspace: We run a service business with leads, site visits, quotes, jobs, technicians, suppliers, invoices, and follow-up care. We need intake through completion, strong handoffs, customer history, technician schedules, supplier tracking, and operational reporting. Explain the phased system you would build, which modules are involved, and what you would deliver first before applying anything.",
                    {
                        "ok": True,
                        "question_required": True,
                        "question_id": "confirm_plan",
                        "assistant_text_contains": [
                            "phased",
                            "Leads",
                            "Quotes",
                            "Jobs",
                            "Invoices",
                        ],
                        "assistant_text_not_contains": [
                            "candidate_operations",
                            "artifact_id",
                            "manifest",
                        ],
                    },
                )
            ],
        },
        {
            "name": "preview_long_guide_manufacturing_workspace",
            "level": 8,
            "tags": ["preview_contract", "long_guide", "system_build", "cross_module"],
            "session": _session("preview_long_guide_manufacturing_workspace"),
            "steps": [
                _chat_step(
                    "Plan a manufacturing workspace from this brief: sales orders feed production jobs, production consumes stock, purchasing replenishes parts, quality checks sign off each stage, and dispatch confirms delivery. I want a plain-English build roadmap, the modules you would create or change, and the rollout order before anything is built.",
                    {
                        "ok": True,
                        "question_required": True,
                        "question_id": "confirm_plan",
                        "assistant_text_contains": [
                            "build roadmap",
                            "Sales Orders",
                            "Production",
                            "Purchasing",
                            "Dispatch",
                        ],
                        "assistant_text_not_contains": [
                            "candidate_operations",
                            "artifact_id",
                            "manifest",
                        ],
                    },
                )
            ],
        },
    ]

    for item in _load_prompt_bank():
        scenario = _real_world_preview_scenario(item)
        if scenario:
            suite.append(scenario)
    return suite


def main() -> None:
    suite = build_suite()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(suite, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(suite)} planner/preview scenarios to {OUT}")


if __name__ == "__main__":
    main()
