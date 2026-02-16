"""Action planning (validation + execution plan compilation) without side effects."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Tuple


Issue = Dict[str, Any]
ActionPlan = Dict[str, Any]
ValueNode = Dict[str, Any]


_ALLOWED_ACTION_TYPES = {
    "update_record",
    "create_record",
    "call_action",
    "publish_event",
    "run_query",
}


@dataclass
class ConditionError(Exception):
    message: str
    path: str

    def __str__(self) -> str:  # pragma: no cover - simple formatting
        return f"{self.message} (path={self.path})"


def _issue(code: str, message: str, path: str | None = None, detail: dict | None = None) -> Issue:
    return {
        "code": code,
        "message": message,
        "path": path,
        "detail": detail,
    }


def _resolve_var(vars_dict: dict, var_name: str) -> Any:
    current = vars_dict
    for part in var_name.split("."):
        if not isinstance(current, dict) or part not in current:
            raise ConditionError("Variable not found", var_name)
        current = current[part]
    return current


def _eval_value_node(node: Any, vars_dict: dict, path: str, depth: int) -> Any:
    if depth > 10:
        raise ConditionError("Condition depth exceeded", path)
    if not isinstance(node, dict):
        raise ConditionError("Invalid value node", path)
    if "var" in node:
        if not isinstance(node["var"], str):
            raise ConditionError("Invalid var name", path)
        return _resolve_var(vars_dict, node["var"])
    if "literal" in node:
        return node["literal"]
    if "array" in node:
        arr = node["array"]
        if not isinstance(arr, list):
            raise ConditionError("Invalid array node", path)
        return [_eval_value_node(item, vars_dict, f"{path}.array", depth + 1) for item in arr]
    raise ConditionError("Unknown value node", path)


def _eval_condition(cond: dict, vars_dict: dict, path: str, depth: int) -> bool:
    if depth > 10:
        raise ConditionError("Condition depth exceeded", path)
    if not isinstance(cond, dict):
        raise ConditionError("Condition must be object", path)
    op = cond.get("op")
    if op in {"and", "or"}:
        children = cond.get("children")
        if not isinstance(children, list) or not children:
            raise ConditionError("Children required", path)
        results = [
            _eval_condition(child, vars_dict, f"{path}.children", depth + 1)
            for child in children
        ]
        return all(results) if op == "and" else any(results)
    if op == "not":
        children = cond.get("children")
        if not isinstance(children, list) or len(children) != 1:
            raise ConditionError("Not requires single child", path)
        return not _eval_condition(children[0], vars_dict, f"{path}.children", depth + 1)
    if op in {"eq", "neq"}:
        left = _eval_value_node(cond.get("left"), vars_dict, f"{path}.left", depth + 1)
        right = _eval_value_node(cond.get("right"), vars_dict, f"{path}.right", depth + 1)
        return left == right if op == "eq" else left != right
    if op in {"exists", "not_exists"}:
        left = _eval_value_node(cond.get("left"), vars_dict, f"{path}.left", depth + 1)
        exists = left is not None
        return exists if op == "exists" else not exists
    raise ConditionError("Unsupported op", path)


def _validate_value_node(node: Any, path: str, errors: List[Issue]) -> None:
    if not isinstance(node, dict):
        errors.append(_issue("VALUE_NODE_INVALID", "Value node must be object", path))
        return
    keys = set(node.keys())
    if keys == {"var"}:
        if not isinstance(node.get("var"), str):
            errors.append(_issue("VALUE_NODE_INVALID", "var must be string", path))
        return
    if keys == {"literal"}:
        return
    if keys == {"array"}:
        arr = node.get("array")
        if not isinstance(arr, list):
            errors.append(_issue("VALUE_NODE_INVALID", "array must be list", path))
            return
        for idx, item in enumerate(arr):
            _validate_value_node(item, f"{path}.array[{idx}]", errors)
        return
    errors.append(_issue("VALUE_NODE_INVALID", "Invalid value node shape", path))


def _validate_record_ref(ref: Any, path: str, errors: List[Issue]) -> None:
    if not isinstance(ref, dict):
        errors.append(_issue("RECORD_REF_INVALID", "record_ref must be object", path))
        return
    if not isinstance(ref.get("entity"), str):
        errors.append(_issue("RECORD_REF_INVALID", "entity must be string", f"{path}.entity"))
    if "id" not in ref:
        errors.append(_issue("RECORD_REF_INVALID", "id required", f"{path}.id"))
    else:
        _validate_value_node(ref.get("id"), f"{path}.id", errors)


def _validate_params_schema(params: Any, schema: dict, errors: List[Issue]) -> None:
    if not isinstance(params, dict):
        errors.append(_issue("PARAMS_NOT_OBJECT", "params must be object", "params"))
        return
    if schema.get("type") not in {None, "object"}:
        errors.append(_issue("PARAMS_SCHEMA_INVALID", "params_schema.type must be 'object'", "params_schema.type"))
        return

    required = schema.get("required", [])
    if required is not None and not isinstance(required, list):
        errors.append(_issue("PARAMS_SCHEMA_INVALID", "required must be list", "params_schema.required"))
        return

    properties = schema.get("properties", {})
    if properties is not None and not isinstance(properties, dict):
        errors.append(_issue("PARAMS_SCHEMA_INVALID", "properties must be object", "params_schema.properties"))
        return

    for key in required or []:
        if key not in params:
            errors.append(_issue("PARAMS_REQUIRED_MISSING", f"Missing required param: {key}", f"params.{key}"))

    for key, value in params.items():
        if properties and key in properties:
            spec = properties[key]
            if not isinstance(spec, dict):
                errors.append(_issue("PARAMS_SCHEMA_INVALID", "property spec must be object", f"params_schema.properties.{key}"))
                continue
            expected = spec.get("type")
            if expected:
                if expected == "string" and not isinstance(value, str):
                    errors.append(_issue("PARAMS_TYPE_INVALID", f"{key} must be string", f"params.{key}"))
                elif expected == "boolean" and not isinstance(value, bool):
                    errors.append(_issue("PARAMS_TYPE_INVALID", f"{key} must be boolean", f"params.{key}"))
                elif expected == "integer":
                    if not isinstance(value, int) or isinstance(value, bool):
                        errors.append(_issue("PARAMS_TYPE_INVALID", f"{key} must be integer", f"params.{key}"))
                elif expected == "number":
                    if not isinstance(value, (int, float)) or isinstance(value, bool):
                        errors.append(_issue("PARAMS_TYPE_INVALID", f"{key} must be number", f"params.{key}"))
                elif expected == "object" and not isinstance(value, dict):
                    errors.append(_issue("PARAMS_TYPE_INVALID", f"{key} must be object", f"params.{key}"))
                elif expected == "array" and not isinstance(value, list):
                    errors.append(_issue("PARAMS_TYPE_INVALID", f"{key} must be array", f"params.{key}"))
        else:
            if schema.get("additionalProperties") is False:
                errors.append(_issue("PARAMS_ADDITIONAL_FORBIDDEN", f"Unknown param: {key}", f"params.{key}"))


def _validate_permissions(permissions: dict, ctx: dict, errors: List[Issue]) -> None:
    roles = permissions.get("roles") if isinstance(permissions, dict) else None
    condition = permissions.get("condition") if isinstance(permissions, dict) else None

    if roles is not None:
        actor_roles = ctx.get("actor", {}).get("roles", [])
        if not isinstance(actor_roles, list) or not set(actor_roles).intersection(set(roles)):
            errors.append(
                _issue("ACTION_FORBIDDEN_ROLE", "Actor lacks required role", "permissions.roles")
            )
            return

    if condition is not None:
        try:
            allowed = _eval_condition(condition, ctx.get("vars", {}), "permissions.condition", 1)
            if not allowed:
                errors.append(
                    _issue(
                        "ACTION_FORBIDDEN_CONDITION",
                        "Permission condition evaluated to false",
                        "permissions.condition",
                    )
                )
        except ConditionError as exc:
            errors.append(
                _issue(
                    "CONDITION_INVALID",
                    str(exc),
                    "permissions.condition",
                    {"path": exc.path},
                )
            )


def _validate_action_decl(action_decl: dict, errors: List[Issue]) -> None:
    if not isinstance(action_decl.get("id"), str):
        errors.append(_issue("ACTION_ID_INVALID", "action.id must be string", "id"))
    if action_decl.get("type") not in _ALLOWED_ACTION_TYPES:
        errors.append(_issue("ACTION_TYPE_INVALID", "Unsupported action type", "type"))
    if not isinstance(action_decl.get("effect"), dict):
        errors.append(_issue("ACTION_EFFECT_INVALID", "effect must be object", "effect"))


def _validate_effect_update_record(effect: dict, errors: List[Issue]) -> ActionPlan | None:
    allowed = {"record_ref", "changes"}
    for key in effect.keys():
        if key not in allowed:
            errors.append(_issue("EFFECT_KEY_INVALID", f"Unknown key: {key}", f"effect.{key}"))
    if "record_ref" not in effect or "changes" not in effect:
        errors.append(_issue("EFFECT_INVALID", "record_ref and changes required", "effect"))
        return None
    _validate_record_ref(effect.get("record_ref"), "effect.record_ref", errors)
    changes = effect.get("changes")
    if not isinstance(changes, dict):
        errors.append(_issue("EFFECT_INVALID", "changes must be object", "effect.changes"))
        return None
    for field_id, node in changes.items():
        _validate_value_node(node, f"effect.changes.{field_id}", errors)
    return {
        "kind": "update_record",
        "record_ref": effect.get("record_ref"),
        "changes": changes,
    }


def _validate_effect_create_record(effect: dict, errors: List[Issue]) -> ActionPlan | None:
    allowed = {"entity", "values", "returns"}
    for key in effect.keys():
        if key not in allowed:
            errors.append(_issue("EFFECT_KEY_INVALID", f"Unknown key: {key}", f"effect.{key}"))
    if not isinstance(effect.get("entity"), str):
        errors.append(_issue("EFFECT_INVALID", "entity must be string", "effect.entity"))
        return None
    values = effect.get("values")
    if not isinstance(values, dict):
        errors.append(_issue("EFFECT_INVALID", "values must be object", "effect.values"))
        return None
    for field_id, node in values.items():
        _validate_value_node(node, f"effect.values.{field_id}", errors)
    returns = effect.get("returns")
    if returns is not None:
        if not isinstance(returns, dict) or not isinstance(returns.get("as"), str):
            errors.append(_issue("EFFECT_INVALID", "returns must include as", "effect.returns"))
            return None
        fields = returns.get("fields")
        if fields is not None and not (isinstance(fields, list) and all(isinstance(f, str) for f in fields)):
            errors.append(_issue("EFFECT_INVALID", "returns.fields must be list of strings", "effect.returns.fields"))
            return None
    return {
        "kind": "create_record",
        "entity": effect.get("entity"),
        "values": values,
        "returns": returns if returns is not None else None,
    }


def _validate_effect_call_action(effect: dict, errors: List[Issue]) -> ActionPlan | None:
    allowed = {"action_ref", "params", "returns"}
    for key in effect.keys():
        if key not in allowed:
            errors.append(_issue("EFFECT_KEY_INVALID", f"Unknown key: {key}", f"effect.{key}"))
    if not isinstance(effect.get("action_ref"), str):
        errors.append(_issue("EFFECT_INVALID", "action_ref must be string", "effect.action_ref"))
        return None
    params = effect.get("params")
    if params is not None:
        if not isinstance(params, dict):
            errors.append(_issue("EFFECT_INVALID", "params must be object", "effect.params"))
            return None
        for key, node in params.items():
            _validate_value_node(node, f"effect.params.{key}", errors)
    returns = effect.get("returns")
    if returns is not None:
        if not isinstance(returns, dict) or not isinstance(returns.get("as"), str):
            errors.append(_issue("EFFECT_INVALID", "returns must include as", "effect.returns"))
            return None
    return {
        "kind": "call_action",
        "action_ref": effect.get("action_ref"),
        "params": params,
        "returns": returns if returns is not None else None,
    }


def _validate_effect_publish_event(effect: dict, errors: List[Issue]) -> ActionPlan | None:
    allowed = {"name", "payload"}
    for key in effect.keys():
        if key not in allowed:
            errors.append(_issue("EFFECT_KEY_INVALID", f"Unknown key: {key}", f"effect.{key}"))
    if not isinstance(effect.get("name"), str):
        errors.append(_issue("EFFECT_INVALID", "name must be string", "effect.name"))
        return None
    payload = effect.get("payload")
    if payload is not None:
        if not isinstance(payload, dict):
            errors.append(_issue("EFFECT_INVALID", "payload must be object", "effect.payload"))
            return None
        for key, node in payload.items():
            _validate_value_node(node, f"effect.payload.{key}", errors)
    return {
        "kind": "publish_event",
        "name": effect.get("name"),
        "payload": payload,
    }


def _validate_effect_run_query(effect: dict, errors: List[Issue]) -> ActionPlan | None:
    allowed = {"query_ref", "params", "returns"}
    for key in effect.keys():
        if key not in allowed:
            errors.append(_issue("EFFECT_KEY_INVALID", f"Unknown key: {key}", f"effect.{key}"))
    if not isinstance(effect.get("query_ref"), str):
        errors.append(_issue("EFFECT_INVALID", "query_ref must be string", "effect.query_ref"))
        return None
    params = effect.get("params")
    if params is not None:
        if not isinstance(params, dict):
            errors.append(_issue("EFFECT_INVALID", "params must be object", "effect.params"))
            return None
        for key, node in params.items():
            _validate_value_node(node, f"effect.params.{key}", errors)
    returns = effect.get("returns")
    if returns is not None:
        if not isinstance(returns, dict) or not isinstance(returns.get("as"), str):
            errors.append(_issue("EFFECT_INVALID", "returns must include as", "effect.returns"))
            return None
    return {
        "kind": "run_query",
        "query_ref": effect.get("query_ref"),
        "params": params,
        "returns": returns if returns is not None else None,
    }


def plan_action(action_decl: dict, params: dict, ctx: dict) -> dict:
    errors: List[Issue] = []
    warnings: List[Issue] = []

    if not isinstance(action_decl, dict):
        errors.append(_issue("ACTION_DECL_INVALID", "action_decl must be object", "action_decl"))
        return {"ok": False, "errors": errors, "warnings": warnings, "plan": None}

    _validate_action_decl(action_decl, errors)
    if errors:
        return {"ok": False, "errors": errors, "warnings": warnings, "plan": None}

    schema = action_decl.get("params_schema")
    if schema is not None:
        if not isinstance(schema, dict):
            errors.append(_issue("PARAMS_SCHEMA_INVALID", "params_schema must be object", "params_schema"))
            return {"ok": False, "errors": errors, "warnings": warnings, "plan": None}
        _validate_params_schema(params, schema, errors)
    else:
        if not isinstance(params, dict):
            errors.append(_issue("PARAMS_NOT_OBJECT", "params must be object", "params"))

    permissions = action_decl.get("permissions")
    if permissions is not None:
        if not isinstance(permissions, dict):
            errors.append(_issue("PERMISSIONS_INVALID", "permissions must be object", "permissions"))
        else:
            _validate_permissions(permissions, ctx, errors)

    if errors:
        return {"ok": False, "errors": errors, "warnings": warnings, "plan": None}

    effect = action_decl.get("effect")
    action_type = action_decl.get("type")

    step = None
    if action_type == "update_record":
        step = _validate_effect_update_record(effect, errors)
    elif action_type == "create_record":
        step = _validate_effect_create_record(effect, errors)
    elif action_type == "call_action":
        step = _validate_effect_call_action(effect, errors)
    elif action_type == "publish_event":
        step = _validate_effect_publish_event(effect, errors)
    elif action_type == "run_query":
        step = _validate_effect_run_query(effect, errors)

    if errors or step is None:
        return {"ok": False, "errors": errors, "warnings": warnings, "plan": None}

    plan: ActionPlan = {
        "action_id": action_decl.get("id"),
        "type": action_type,
        "steps": [step],
    }
    return {"ok": True, "errors": errors, "warnings": warnings, "plan": plan}
