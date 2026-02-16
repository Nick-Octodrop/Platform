"""Workflow runtime (single-step, transactional)."""

from __future__ import annotations

from typing import Any, Dict, List

from event_bus import make_event


Issue = Dict[str, Any]


def _issue(code: str, message: str, path: str | None = None, detail: dict | None = None) -> Issue:
    return {"code": code, "message": message, "path": path, "detail": detail}


def apply_workflow_step(workflow: dict, instance_id: str, ctx: dict, deps: dict) -> dict:
    errors: List[Issue] = []
    warnings: List[Issue] = []
    events_enqueued: List[str] = []
    action_results: Dict[str, Any] = {}

    store = deps.get("store")
    planner = deps.get("workflow_plan")
    action_plan = deps.get("action_plan")
    action_exec = deps.get("action_exec")
    tx_mgr = deps.get("tx")
    outbox = deps.get("outbox")
    action_decls = deps.get("action_decls")

    if store is None or planner is None or action_plan is None or action_exec is None or tx_mgr is None or outbox is None:
        errors.append(_issue("WORKFLOW_DEPS_MISSING", "Required deps missing", "$"))
        return {
            "ok": False,
            "errors": errors,
            "warnings": warnings,
            "instance": None,
            "transition_id": None,
            "action_results": None,
            "events_enqueued": [],
        }

    try:
        instance = store.get_instance(instance_id)
    except Exception:
        errors.append(_issue("WORKFLOW_INSTANCE_NOT_FOUND", "Instance not found", "instance_id"))
        return {
            "ok": False,
            "errors": errors,
            "warnings": warnings,
            "instance": None,
            "transition_id": None,
            "action_results": None,
            "events_enqueued": [],
        }

    plan_result = planner(workflow, instance["current_state"], ctx, depth_limit=10)
    if not plan_result.get("ok"):
        return {
            "ok": False,
            "errors": plan_result.get("errors", []),
            "warnings": plan_result.get("warnings", []),
            "instance": None,
            "transition_id": None,
            "action_results": None,
            "events_enqueued": [],
        }

    warnings.extend(plan_result.get("warnings", []))
    plan = plan_result.get("plan")
    if not plan or plan.get("chosen_transition_id") is None:
        return {
            "ok": True,
            "errors": errors,
            "warnings": warnings,
            "instance": instance,
            "transition_id": None,
            "action_results": None,
            "events_enqueued": [],
        }

    tx = tx_mgr.begin()
    to_emit = plan.get("events") or []

    try:
        instance["current_state"] = plan.get("next_state")
        instance["updated_at"] = _now()
        instance["history"].append(
            {
                "at": instance["updated_at"],
                "actor": ctx.get("actor"),
                "from_state": plan.get("current_state"),
                "to_state": plan.get("next_state"),
                "transition_id": plan.get("chosen_transition_id"),
                "actions": plan.get("actions") or [],
                "events": to_emit,
                "status": "applied",
                "detail": None,
            }
        )

        for action_ref in plan.get("actions") or []:
            decl = None
            if isinstance(action_decls, dict):
                decl = action_decls.get(action_ref)
            if decl is None:
                raise RuntimeError("WORKFLOW_ACTION_DECL_MISSING")
            planned = action_plan(decl, params={}, ctx=ctx)
            if not planned.get("ok"):
                raise RuntimeError("WORKFLOW_ACTION_PLAN_FAILED")
            exec_result = action_exec(planned.get("plan"), ctx, deps)
            if not exec_result.get("ok"):
                raise RuntimeError("WORKFLOW_ACTION_EXEC_FAILED")
            action_results[action_ref] = exec_result.get("result")

        tx.commit()
    except RuntimeError as exc:
        tx.rollback()
        code = str(exc)
        errors.append(_issue(code, code, "$.actions"))
        return {
            "ok": False,
            "errors": errors,
            "warnings": warnings,
            "instance": None,
            "transition_id": None,
            "action_results": None,
            "events_enqueued": [],
        }
    except Exception as exc:
        tx.rollback()
        errors.append(_issue("WORKFLOW_EXEC_FAILED", str(exc), "$"))
        return {
            "ok": False,
            "errors": errors,
            "warnings": warnings,
            "instance": None,
            "transition_id": None,
            "action_results": None,
            "events_enqueued": [],
        }

    manifest_hash = ctx.get("manifest_hash")
    if not isinstance(manifest_hash, str):
        errors.append(_issue("WORKFLOW_CTX_INVALID", "ctx.manifest_hash required", "ctx.manifest_hash"))
        return {
            "ok": False,
            "errors": errors,
            "warnings": warnings,
            "instance": None,
            "transition_id": plan.get("chosen_transition_id"),
            "action_results": action_results or None,
            "events_enqueued": [],
        }

    for event in to_emit:
        envelope = make_event(
            event["name"],
            event.get("payload") or {},
            {
                "module_id": ctx.get("module_id"),
                "manifest_hash": manifest_hash,
                "actor": ctx.get("actor"),
                "trace_id": ctx.get("trace_id"),
            },
        )
        outbox.enqueue(envelope)
        events_enqueued.append(envelope["meta"]["event_id"])

    store.update_instance(instance)

    return {
        "ok": True,
        "errors": errors,
        "warnings": warnings,
        "instance": instance,
        "transition_id": plan.get("chosen_transition_id"),
        "action_results": action_results or None,
        "events_enqueued": events_enqueued,
    }


def _now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
