#!/usr/bin/env python3
import argparse
import copy
import json
from pathlib import Path
from typing import Any


LEVELS = [
    {
        "level": 1,
        "name": "foundation",
        "description": "Single-module basics and simple no-op handling.",
        "min_pass_rate": 90.0,
        "required_streak": 2,
    },
    {
        "level": 2,
        "name": "refinement",
        "description": "Scope switches, upgrades, tabs, and follow-up refinements.",
        "min_pass_rate": 85.0,
        "required_streak": 2,
    },
    {
        "level": 3,
        "name": "bundles",
        "description": "Multi-request same-module planning.",
        "min_pass_rate": 80.0,
        "required_streak": 2,
    },
    {
        "level": 4,
        "name": "cross_module",
        "description": "Cross-module planning and previews.",
        "min_pass_rate": 80.0,
        "required_streak": 2,
    },
    {
        "level": 5,
        "name": "system_briefs",
        "description": "Large business briefs and system-building previews.",
        "min_pass_rate": 75.0,
        "required_streak": 2,
    },
    {
        "level": 6,
        "name": "workspace_graph",
        "description": "Workspace-scale planning across multiple manifests with dependency-aware previews.",
        "min_pass_rate": 75.0,
        "required_streak": 2,
    },
    {
        "level": 7,
        "name": "sandbox_rollout",
        "description": "Preview-first sandbox, validation, promotion, and rollback reasoning.",
        "min_pass_rate": 75.0,
        "required_streak": 2,
    },
    {
        "level": 8,
        "name": "long_guides",
        "description": "Long-form business guides turned into phased workspace build plans.",
        "min_pass_rate": 70.0,
        "required_streak": 2,
    },
]


MUTATION_LIBRARY: dict[str, list[dict[str, Any]]] = {
    "preview_create_vehicle_logbook": [
        {
            "id": "fleet_register",
            "replacements": {
                "Vehicle Logbook": "Fleet Register",
                "vehicle usage": "fleet usage",
                "drivers": "assigned drivers",
            },
        },
        {
            "id": "equipment_register",
            "replacements": {
                "Vehicle Logbook": "Equipment Register",
                "vehicle usage": "equipment usage",
                "odometer readings": "service meter readings",
                "drivers": "operators",
            },
        },
    ],
    "preview_contacts_add_birthday": [
        {
            "id": "anniversary_date",
            "replacements": {
                "Birthday": "Anniversary Date",
                "birthday": "anniversary date",
            },
        }
    ],
    "preview_contacts_remove_roblux_noop": [
        {
            "id": "vip_flag_noop",
            "replacements": {
                "roblux": "VIP Flag",
                "Roblux": "VIP Flag",
            },
        }
    ],
    "preview_create_training_compliance_human_name": [
        {
            "id": "certification_tracker",
            "replacements": {
                "Training Compliance": "Certification Tracker",
                "training_compliance": "certification_tracker",
            },
        }
    ],
    "preview_contacts_add_account_manager_notes": [
        {
            "id": "relationship_notes",
            "replacements": {
                "Account Manager Notes": "Relationship Notes",
                "Internal Notes": "Client Notes",
            },
        }
    ],
    "preview_multi_request_contacts_master_bundle": [
        {
            "id": "operations_bundle",
            "replacements": {
                "Roblux": "VIP Level",
                "Master": "Operations",
                "Master Notes": "Operations Notes",
            },
        }
    ],
    "preview_cross_module_contacts_jobs_bundle": [
        {
            "id": "service_bundle",
            "replacements": {
                "Customer Tier": "Support Tier",
                "Preferred Technician": "Backup Technician",
            },
        }
    ],
    "preview_contacts_status_action_contacted": [
        {
            "id": "qualified_status_action",
            "replacements": {
                "Contacted": "Qualified",
                "contacted": "qualified",
            },
        }
    ],
    "preview_contacts_master_attachment_floor_plans": [
        {
            "id": "site_photos_attachment",
            "replacements": {
                "Floor plans": "Site Photos",
                "Master": "Internal Notes",
            },
        }
    ],
    "preview_jobs_conditional_completion_fields": [
        {
            "id": "service_report_gate",
            "replacements": {
                "Completion Notes": "Service Report Notes",
                "Follow-up Date": "Customer Review Date",
                "Completed": "Done",
            },
        }
    ],
    "preview_large_brief_candidate_pipeline": [
        {
            "id": "hiring_pipeline",
            "replacements": {
                "Candidate Pipeline": "Hiring Pipeline",
                "candidate pipeline": "hiring pipeline",
            },
        }
    ],
    "preview_workspace_graph_conditional_ops_rollout": [
        {
            "id": "service_release_controls",
            "replacements": {
                "approval": "release approval",
                "Jobs, Quotes, and Invoices": "Jobs, Purchase Orders, and Invoices",
                "Quotes": "Purchase Orders",
            },
        }
    ],
    "preview_workspace_graph_field_rollout": [
        {
            "id": "service_level_rollout",
            "replacements": {
                "Customer Priority": "Service Level",
                "Contacts, Jobs, and Quotes": "Contacts, Jobs, and Invoices",
                "Quotes": "Invoices",
            },
        }
    ],
    "preview_sandbox_rollout_dispatch_system": [
        {
            "id": "service_desk_rollout",
            "replacements": {
                "dispatch system for field work": "service desk workspace for maintenance teams",
                "dispatch": "service desk",
            },
        }
    ],
    "preview_long_guide_service_business_platform": [
        {
            "id": "trade_operations_platform",
            "replacements": {
                "service business": "trade operations business",
                "site visits": "onsite inspections",
                "follow-up care": "aftercare service",
            },
        }
    ],
}


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _replace_strings(value: Any, replacements: dict[str, str]) -> Any:
    if isinstance(value, str):
        updated = value
        for old, new in replacements.items():
            updated = updated.replace(old, new)
        return updated
    if isinstance(value, list):
        return [_replace_strings(item, replacements) for item in value]
    if isinstance(value, dict):
        return {key: _replace_strings(item, replacements) for key, item in value.items()}
    return value


def _default_state() -> dict[str, Any]:
    return {
        "current_level": 1,
        "level_streaks": {},
        "provisional_progress": {},
        "promoted_scenarios": [],
        "run_history": [],
    }


def load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return _default_state()
    try:
        raw = _read_json(path)
    except Exception:
        return _default_state()
    if not isinstance(raw, dict):
        return _default_state()
    state = _default_state()
    state.update(raw)
    return state


def _max_level(base_suite: list[dict]) -> int:
    return max(int(item.get("level") or 1) for item in base_suite if isinstance(item, dict))


def _promoted_keys(state: dict[str, Any]) -> set[str]:
    promoted = state.get("promoted_scenarios") if isinstance(state.get("promoted_scenarios"), list) else []
    keys: set[str] = set()
    for item in promoted:
        if not isinstance(item, dict):
            continue
        meta = item.get("curriculum") if isinstance(item.get("curriculum"), dict) else {}
        key = meta.get("provisional_key")
        if isinstance(key, str) and key:
            keys.add(key)
    return keys


def _build_provisional_scenario(base: dict[str, Any], mutation: dict[str, Any]) -> dict[str, Any]:
    replacements = mutation.get("replacements") if isinstance(mutation.get("replacements"), dict) else {}
    scenario = copy.deepcopy(base)
    scenario = _replace_strings(scenario, replacements)
    mutation_id = str(mutation.get("id") or "variant")
    scenario["name"] = f"{base.get('name')}__{mutation_id}"
    scenario["curriculum"] = {
        "kind": "provisional",
        "source_name": base.get("name"),
        "mutation_id": mutation_id,
        "provisional_key": f"{base.get('name')}::{mutation_id}",
    }
    tags = scenario.get("tags") if isinstance(scenario.get("tags"), list) else []
    if "provisional" not in tags:
        scenario["tags"] = [*tags, "provisional"]
    return scenario


def build_active_suite(
    base_suite_path: Path,
    state_path: Path,
    output_path: Path,
    max_provisional: int = 4,
) -> dict[str, Any]:
    base_suite_raw = _read_json(base_suite_path)
    base_suite = [item for item in base_suite_raw if isinstance(item, dict)]
    state = load_state(state_path)
    current_level = max(1, min(int(state.get("current_level") or 1), _max_level(base_suite)))
    promoted = [item for item in state.get("promoted_scenarios", []) if isinstance(item, dict)]
    promoted_keys = _promoted_keys(state)

    active: list[dict[str, Any]] = []
    for item in base_suite:
        if int(item.get("level") or 1) <= current_level:
            active.append(copy.deepcopy(item))

    provisional: list[dict[str, Any]] = []
    for item in base_suite:
        if int(item.get("level") or 1) > current_level:
            continue
        for mutation in MUTATION_LIBRARY.get(str(item.get("name")), []):
            provisional_key = f"{item.get('name')}::{mutation.get('id')}"
            if provisional_key in promoted_keys:
                continue
            provisional.append(_build_provisional_scenario(item, mutation))
            if len(provisional) >= max_provisional:
                break
        if len(provisional) >= max_provisional:
            break

    active.extend(copy.deepcopy(promoted))
    active.extend(provisional)
    _write_json(output_path, active)

    return {
        "current_level": current_level,
        "level_name": LEVELS[current_level - 1]["name"],
        "active_count": len(active),
        "provisional_count": len(provisional),
        "promoted_count": len(promoted),
        "scenario_file": str(output_path),
    }


def _result_map(run_dir: Path) -> dict[str, dict[str, Any]]:
    iteration_dir = run_dir / "iteration_001"
    results: dict[str, dict[str, Any]] = {}
    if not iteration_dir.exists():
        return results
    for path in sorted(iteration_dir.glob("*.json")):
        try:
            raw = _read_json(path)
        except Exception:
            continue
        if not isinstance(raw, dict):
            continue
        name = raw.get("name") or path.stem
        results[str(name)] = raw
    return results


def _pass_rate(items: list[dict[str, Any]], results: dict[str, dict[str, Any]]) -> float:
    if not items:
        return 0.0
    passed = 0
    for item in items:
        result = results.get(str(item.get("name")), {})
        if bool(result.get("passed")) or result.get("status") == "passed":
            passed += 1
    return round((passed / len(items)) * 100, 1)


def update_curriculum_state(
    run_dir: Path,
    scenario_file: Path,
    state_path: Path,
) -> dict[str, Any]:
    state = load_state(state_path)
    scenario_specs_raw = _read_json(scenario_file)
    scenario_specs = [item for item in scenario_specs_raw if isinstance(item, dict)]
    results = _result_map(run_dir)
    current_level = int(state.get("current_level") or 1)
    evaluated_level = current_level
    level_rule = LEVELS[current_level - 1]

    current_level_specs = [item for item in scenario_specs if int(item.get("level") or 1) == current_level]
    current_pass_rate = _pass_rate(current_level_specs, results)
    streaks = state.get("level_streaks") if isinstance(state.get("level_streaks"), dict) else {}
    level_key = str(current_level)
    if current_pass_rate >= float(level_rule["min_pass_rate"]):
        streaks[level_key] = int(streaks.get(level_key) or 0) + 1
    else:
        streaks[level_key] = 0
    state["level_streaks"] = streaks

    provisional_progress = state.get("provisional_progress") if isinstance(state.get("provisional_progress"), dict) else {}
    promoted_scenarios = state.get("promoted_scenarios") if isinstance(state.get("promoted_scenarios"), list) else []
    promoted_keys = _promoted_keys(state)
    promotions: list[str] = []
    for item in scenario_specs:
        meta = item.get("curriculum") if isinstance(item.get("curriculum"), dict) else {}
        provisional_key = meta.get("provisional_key")
        if not isinstance(provisional_key, str) or not provisional_key:
            continue
        result = results.get(str(item.get("name")), {})
        passed = bool(result.get("passed")) or result.get("status") == "passed"
        progress = provisional_progress.get(provisional_key) if isinstance(provisional_progress.get(provisional_key), dict) else {}
        pass_streak = int(progress.get("pass_streak") or 0)
        attempts = int(progress.get("attempts") or 0) + 1
        if passed:
            pass_streak += 1
        else:
            pass_streak = 0
        progress = {"pass_streak": pass_streak, "attempts": attempts}
        provisional_progress[provisional_key] = progress
        if pass_streak >= 2 and provisional_key not in promoted_keys:
            promoted = copy.deepcopy(item)
            promoted["curriculum"] = {
                **meta,
                "kind": "promoted",
                "promoted_after_attempts": attempts,
            }
            promoted_scenarios.append(promoted)
            promoted_keys.add(provisional_key)
            promotions.append(str(item.get("name")))

    state["provisional_progress"] = provisional_progress
    state["promoted_scenarios"] = promoted_scenarios

    unlocked_level = None
    if (
        int(streaks.get(level_key) or 0) >= int(level_rule["required_streak"])
        and current_level < max(level["level"] for level in LEVELS)
    ):
        current_level += 1
        state["current_level"] = current_level
        unlocked_level = current_level
    else:
        state["current_level"] = current_level

    history = state.get("run_history") if isinstance(state.get("run_history"), list) else []
    history.append(
        {
            "run_dir": str(run_dir),
            "evaluated_level": evaluated_level,
            "current_level_pass_rate": current_pass_rate,
            "current_level_after_run": state["current_level"],
            "promotions": promotions,
        }
    )
    state["run_history"] = history[-20:]
    _write_json(state_path, state)

    status = {
        "run_dir": str(run_dir),
        "evaluated_level": evaluated_level,
        "current_level_pass_rate": current_pass_rate,
        "streak": int(streaks.get(level_key) or 0),
        "required_streak": int(level_rule["required_streak"]),
        "min_pass_rate": float(level_rule["min_pass_rate"]),
        "current_level_after_run": int(state["current_level"]),
        "unlocked_level": unlocked_level,
        "promotions": promotions,
        "promoted_count": len(promoted_scenarios),
    }
    _write_json(run_dir / "curriculum_status.json", status)
    lines = [
        "# Octo AI Curriculum Status",
        "",
        f"- Evaluated level: `{status['evaluated_level']}`",
        f"- Current level after run: `{status['current_level_after_run']}`",
        f"- Current level pass rate: `{status['current_level_pass_rate']}%`",
        f"- Streak: `{status['streak']}/{status['required_streak']}` at `{status['min_pass_rate']}%` threshold",
        f"- Promoted scenarios: `{status['promoted_count']}`",
    ]
    if unlocked_level:
        lines.append(f"- Unlocked next level: `{unlocked_level}`")
    if promotions:
        lines.append("")
        lines.append("## New Promotions")
        for name in promotions:
            lines.append(f"- `{name}`")
    (run_dir / "curriculum_status.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return status


def main() -> int:
    parser = argparse.ArgumentParser(description="Build or update the Octo AI curriculum suite.")
    parser.add_argument("--base-scenario-file", required=True)
    parser.add_argument("--state-file", required=True)
    parser.add_argument("--output-file", required=True)
    parser.add_argument("--run-dir", default="")
    parser.add_argument("--update-after-run", action="store_true")
    parser.add_argument("--max-provisional", type=int, default=4)
    args = parser.parse_args()

    base_scenario_file = Path(args.base_scenario_file).resolve()
    state_file = Path(args.state_file).resolve()
    output_file = Path(args.output_file).resolve()

    if args.update_after_run:
        if not args.run_dir:
            parser.error("--run-dir is required with --update-after-run")
        status = update_curriculum_state(Path(args.run_dir).resolve(), output_file, state_file)
        print(json.dumps(status, indent=2))
        return 0

    status = build_active_suite(base_scenario_file, state_file, output_file, max_provisional=args.max_provisional)
    print(json.dumps(status, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
