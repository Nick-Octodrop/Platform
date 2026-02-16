"""Workflow planning (guards -> actions/events) without execution."""

from __future__ import annotations

from typing import Any, Dict, List

import condition_eval


Issue = Dict[str, Any]
WorkflowPlan = Dict[str, Any]


def _issue(code: str, message: str, path: str | None = None, detail: dict | None = None) -> Issue:
    return {"code": code, "message": message, "path": path, "detail": detail}


def _validate_workflow(workflow: dict, errors: List[Issue]) -> None:
    if not isinstance(workflow.get("id"), str) or not workflow.get("id"):
        errors.append(_issue("WORKFLOW_INVALID", "workflow.id must be non-empty string", "$.id"))
    if not isinstance(workflow.get("initial_state"), str) or not workflow.get("initial_state"):
        errors.append(_issue("WORKFLOW_INVALID", "initial_state must be non-empty string", "$.initial_state"))

    states = workflow.get("states")
    if not isinstance(states, list):
        errors.append(_issue("WORKFLOW_INVALID", "states must be list", "$.states"))
        return

    state_ids = []
    for idx, state in enumerate(states):
        if not isinstance(state, dict) or not isinstance(state.get("id"), str) or not state.get("id"):
            errors.append(_issue("WORKFLOW_INVALID", "state.id must be non-empty string", f"$.states[{idx}].id"))
        else:
            state_ids.append(state["id"])

    if len(set(state_ids)) != len(state_ids):
        errors.append(_issue("WORKFLOW_INVALID", "state ids must be unique", "$.states"))

    transitions = workflow.get("transitions")
    if not isinstance(transitions, list):
        errors.append(_issue("WORKFLOW_INVALID", "transitions must be list", "$.transitions"))
        return

    transition_ids = []
    for idx, tr in enumerate(transitions):
        if not isinstance(tr, dict) or not isinstance(tr.get("id"), str) or not tr.get("id"):
            errors.append(_issue("WORKFLOW_INVALID", "transition.id must be non-empty string", f"$.transitions[{idx}].id"))
        else:
            transition_ids.append(tr["id"])

        from_state = tr.get("from")
        to_state = tr.get("to")
        if not isinstance(from_state, str) or not isinstance(to_state, str):
            errors.append(_issue("WORKFLOW_INVALID", "transition.from/to must be strings", f"$.transitions[{idx}]"))
        else:
            if from_state not in state_ids:
                errors.append(_issue("WORKFLOW_INVALID", "transition.from unknown state", f"$.transitions[{idx}].from"))
            if to_state not in state_ids:
                errors.append(_issue("WORKFLOW_INVALID", "transition.to unknown state", f"$.transitions[{idx}].to"))

        actions = tr.get("actions")
        if actions is not None:
            if not isinstance(actions, list) or not all(isinstance(a, str) and a for a in actions):
                errors.append(_issue("WORKFLOW_INVALID", "actions must be list of non-empty strings", f"$.transitions[{idx}].actions"))

        emits = tr.get("emits")
        if emits is not None:
            if not isinstance(emits, list):
                errors.append(_issue("WORKFLOW_INVALID", "emits must be list", f"$.transitions[{idx}].emits"))
            else:
                for eidx, evt in enumerate(emits):
                    if not isinstance(evt, dict) or not isinstance(evt.get("name"), str) or not evt.get("name"):
                        errors.append(_issue("WORKFLOW_INVALID", "event.name must be non-empty string", f"$.transitions[{idx}].emits[{eidx}].name"))
                    payload = evt.get("payload")
                    if payload is not None and not isinstance(payload, dict):
                        errors.append(_issue("WORKFLOW_INVALID", "event.payload must be object", f"$.transitions[{idx}].emits[{eidx}].payload"))

    if len(set(transition_ids)) != len(transition_ids):
        errors.append(_issue("WORKFLOW_INVALID", "transition ids must be unique", "$.transitions"))


def plan_workflow_step(workflow: dict, current_state: str, ctx: dict, depth_limit: int = 10) -> dict:
    errors: List[Issue] = []
    warnings: List[Issue] = []

    if not isinstance(workflow, dict):
        errors.append(_issue("WORKFLOW_INVALID", "workflow must be object", "$"))
        return {"ok": False, "errors": errors, "warnings": warnings, "plan": None}

    _validate_workflow(workflow, errors)
    if errors:
        return {"ok": False, "errors": errors, "warnings": warnings, "plan": None}

    if not isinstance(current_state, str) or not current_state:
        errors.append(_issue("WORKFLOW_INVALID", "current_state must be non-empty string", "$.current_state"))
        return {"ok": False, "errors": errors, "warnings": warnings, "plan": None}

    vars_ctx = ctx.get("vars") if isinstance(ctx, dict) else None
    if not isinstance(vars_ctx, dict):
        errors.append(_issue("WORKFLOW_INVALID", "ctx.vars must be object", "$.ctx.vars"))
        return {"ok": False, "errors": errors, "warnings": warnings, "plan": None}

    transitions = workflow.get("transitions", [])
    candidates = [t for t in transitions if t.get("from") == current_state]

    allowed: List[dict] = []
    for idx, tr in enumerate(candidates):
        guard = tr.get("guard")
        if guard is None:
            allowed.append(tr)
            continue
        try:
            ok = condition_eval.eval_condition(guard, vars_ctx, depth_limit=depth_limit)
        except condition_eval.ConditionEvalError as exc:
            errors.append(
                _issue(
                    "WORKFLOW_GUARD_ERROR",
                    str(exc),
                    "$.transitions.guard",
                    {"transition_id": tr.get("id"), "error_code": exc.code},
                )
            )
            return {"ok": False, "errors": errors, "warnings": warnings, "plan": None}
        if ok:
            allowed.append(tr)

    if not allowed:
        plan: WorkflowPlan = {
            "workflow_id": workflow["id"],
            "current_state": current_state,
            "chosen_transition_id": None,
            "next_state": None,
            "actions": [],
            "events": [],
        }
        return {"ok": True, "errors": errors, "warnings": warnings, "plan": plan}

    if len(allowed) > 1:
        ids = sorted(tr.get("id") for tr in allowed if isinstance(tr.get("id"), str))
        warnings.append(
            _issue(
                "WORKFLOW_MULTIPLE_TRANSITIONS",
                "Multiple transitions allowed; choosing lexicographically smallest id",
                "$.transitions",
                {"allowed": ids},
            )
        )
        chosen = sorted(allowed, key=lambda t: t.get("id"))[0]
    else:
        chosen = allowed[0]

    plan = {
        "workflow_id": workflow["id"],
        "current_state": current_state,
        "chosen_transition_id": chosen.get("id"),
        "next_state": chosen.get("to"),
        "actions": chosen.get("actions") or [],
        "events": chosen.get("emits") or [],
    }

    return {"ok": True, "errors": errors, "warnings": warnings, "plan": plan}
