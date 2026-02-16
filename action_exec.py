"""Action execution engine (apply-mode only, transactional semantics)."""

from __future__ import annotations

import math
from typing import Any, Dict, List

from event_bus import make_event


Issue = Dict[str, Any]
RecordRef = Dict[str, Any]


def _issue(code: str, message: str, path: str | None = None, detail: dict | None = None) -> Issue:
    return {"code": code, "message": message, "path": path, "detail": detail}


def _resolve_var(vars_ctx: dict, name: str, path: str) -> Any:
    current: Any = vars_ctx
    for part in name.split("."):
        if not isinstance(current, dict) or part not in current:
            raise KeyError(f"Unresolved var: {name}")
        current = current[part]
    return current


def _ensure_no_nonfinite(value: Any) -> None:
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError("Non-finite number")
    if isinstance(value, list):
        for item in value:
            _ensure_no_nonfinite(item)
    elif isinstance(value, dict):
        for item in value.values():
            _ensure_no_nonfinite(item)


def _resolve_value_node(node: Any, vars_ctx: dict) -> Any:
    if not isinstance(node, dict):
        raise TypeError("Value node must be object")
    if set(node.keys()) == {"literal"}:
        value = node.get("literal")
        _ensure_no_nonfinite(value)
        return value
    if set(node.keys()) == {"var"}:
        if not isinstance(node.get("var"), str):
            raise TypeError("var must be string")
        value = _resolve_var(vars_ctx, node["var"], "var")
        _ensure_no_nonfinite(value)
        return value
    if set(node.keys()) == {"array"}:
        arr = node.get("array")
        if not isinstance(arr, list):
            raise TypeError("array must be list")
        return [_resolve_value_node(item, vars_ctx) for item in arr]
    raise TypeError("Invalid value node")


def _extract_created_id(created: dict) -> Any:
    if "id" in created:
        return created.get("id")
    for key, value in created.items():
        if isinstance(key, str) and key.endswith(".id"):
            return value
    return None


def execute_plan(plan: dict, ctx: dict, deps: dict) -> dict:
    errors: List[Issue] = []
    warnings: List[Issue] = []

    effects = {
        "updated": [],
        "created": [],
        "events_enqueued": [],
    }
    result: Dict[str, Any] = {}

    tx_mgr = deps.get("tx")
    records = deps.get("records")
    actions = deps.get("actions")
    queries = deps.get("queries")
    outbox = deps.get("outbox")

    if not isinstance(plan, dict):
        errors.append(_issue("EXEC_PLAN_INVALID", "plan must be object", "$"))
        return {"ok": False, "errors": errors, "warnings": warnings, "result": None, "effects": effects}

    steps = plan.get("steps")
    if not isinstance(steps, list):
        errors.append(_issue("EXEC_PLAN_INVALID", "steps must be list", "$.steps"))
        return {"ok": False, "errors": errors, "warnings": warnings, "result": None, "effects": effects}

    if tx_mgr is None or records is None:
        errors.append(_issue("EXEC_DEPS_MISSING", "tx and records deps required", "$"))
        return {"ok": False, "errors": errors, "warnings": warnings, "result": None, "effects": effects}

    tx = tx_mgr.begin()
    to_emit: List[dict] = []

    vars_base = ctx.get("vars", {})
    if not isinstance(vars_base, dict):
        errors.append(_issue("EXEC_CTX_INVALID", "ctx.vars must be object", "ctx.vars"))
        tx.rollback()
        return {"ok": False, "errors": errors, "warnings": warnings, "result": None, "effects": effects}

    for idx, step in enumerate(steps):
        path = f"$.steps[{idx}]"
        if not isinstance(step, dict):
            errors.append(_issue("EXEC_STEP_INVALID", "step must be object", path))
            break
        kind = step.get("kind")

        overlay = dict(vars_base)
        overlay.update(result)

        try:
            if kind == "update_record":
                record_ref = step.get("record_ref")
                changes = step.get("changes")
                if not isinstance(record_ref, dict) or not isinstance(changes, dict):
                    raise TypeError("Invalid update_record step")
                entity = record_ref.get("entity")
                if not isinstance(entity, str):
                    raise TypeError("record_ref.entity must be string")
                record_id = _resolve_value_node(record_ref.get("id"), overlay)
                resolved_changes = {}
                for field, node in changes.items():
                    resolved_changes[field] = _resolve_value_node(node, overlay)
                records.update_record(tx, entity, record_id, resolved_changes)
                effects["updated"].append({"entity": entity, "id": record_id})

            elif kind == "create_record":
                entity = step.get("entity")
                values = step.get("values")
                if not isinstance(entity, str) or not isinstance(values, dict):
                    raise TypeError("Invalid create_record step")
                resolved_values = {}
                for field, node in values.items():
                    resolved_values[field] = _resolve_value_node(node, overlay)
                created = records.create_record(tx, entity, resolved_values)
                if not isinstance(created, dict):
                    raise TypeError("create_record must return object")
                created_id = _extract_created_id(created)
                if created_id is not None:
                    effects["created"].append({"entity": entity, "id": created_id})
                returns = step.get("returns")
                if returns is not None:
                    alias = returns.get("as")
                    fields = returns.get("fields")
                    if isinstance(alias, str):
                        if isinstance(fields, list):
                            out = {}
                            for field in fields:
                                if field in created:
                                    out[field] = created[field]
                                else:
                                    warnings.append(
                                        _issue("EXEC_RETURN_FIELD_MISSING", "Return field missing", f"{path}.returns.fields", {"field": field})
                                    )
                            result[alias] = out
                        else:
                            result[alias] = created

            elif kind == "call_action":
                if actions is None:
                    raise TypeError("actions dep missing")
                action_ref = step.get("action_ref")
                params = step.get("params")
                if not isinstance(action_ref, str):
                    raise TypeError("action_ref must be string")
                resolved_params = None
                if params is not None:
                    if not isinstance(params, dict):
                        raise TypeError("params must be object")
                    resolved_params = {
                        key: _resolve_value_node(node, overlay)
                        for key, node in params.items()
                    }
                call_result = actions.call(tx, action_ref, resolved_params or {}, ctx)
                returns = step.get("returns")
                if returns is not None:
                    alias = returns.get("as")
                    if isinstance(alias, str):
                        result[alias] = call_result

            elif kind == "run_query":
                if queries is None:
                    raise TypeError("queries dep missing")
                query_ref = step.get("query_ref")
                params = step.get("params")
                if not isinstance(query_ref, str):
                    raise TypeError("query_ref must be string")
                resolved_params = None
                if params is not None:
                    if not isinstance(params, dict):
                        raise TypeError("params must be object")
                    resolved_params = {
                        key: _resolve_value_node(node, overlay)
                        for key, node in params.items()
                    }
                query_result = queries.run(tx, query_ref, resolved_params or {}, ctx)
                returns = step.get("returns")
                if returns is not None:
                    alias = returns.get("as")
                    if isinstance(alias, str):
                        result[alias] = query_result

            elif kind == "publish_event":
                name = step.get("name")
                payload = step.get("payload")
                if not isinstance(name, str):
                    raise TypeError("name must be string")
                resolved_payload = {}
                if payload is not None:
                    if not isinstance(payload, dict):
                        raise TypeError("payload must be object")
                    for key, node in payload.items():
                        resolved_payload[key] = _resolve_value_node(node, overlay)
                to_emit.append({"name": name, "payload": resolved_payload})

            else:
                raise TypeError("Unknown step kind")

        except KeyError as exc:
            errors.append(_issue("EXEC_VAR_UNRESOLVED", str(exc), path))
            break
        except ValueError as exc:
            errors.append(_issue("EXEC_VALUE_INVALID", str(exc), path))
            break
        except TypeError as exc:
            errors.append(_issue("EXEC_STEP_INVALID", str(exc), path))
            break
        except Exception as exc:
            errors.append(_issue("EXEC_ERROR", str(exc), path))
            break

    if errors:
        tx.rollback()
        return {"ok": False, "errors": errors, "warnings": warnings, "result": None, "effects": effects}

    tx.commit()

    manifest_hash = ctx.get("manifest_hash")
    if not isinstance(manifest_hash, str):
        errors.append(_issue("EXEC_CTX_INVALID", "ctx.manifest_hash required", "ctx.manifest_hash"))
        return {"ok": False, "errors": errors, "warnings": warnings, "result": result or None, "effects": effects}

    for event in to_emit:
        envelope = make_event(
            event["name"],
            event["payload"],
            {
                "module_id": ctx.get("module_id"),
                "manifest_hash": manifest_hash,
                "actor": ctx.get("actor"),
                "trace_id": ctx.get("trace_id"),
            },
        )
        outbox.enqueue(envelope)
        effects["events_enqueued"].append(envelope["meta"]["event_id"])

    return {
        "ok": True,
        "errors": errors,
        "warnings": warnings,
        "result": result or None,
        "effects": effects,
    }
