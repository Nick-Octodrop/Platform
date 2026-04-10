"""Condition evaluation for manifest-driven rules."""

from __future__ import annotations

from typing import Any
from datetime import datetime, timezone


ALLOWED_OPS = {
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "in",
    "not_in",
    "contains",
    "exists",
    "not_exists",
    "and",
    "or",
    "not",
}


def _get_by_path(data: dict, path: str) -> Any:
    if not isinstance(data, dict):
        return None
    if path in data:
        return data.get(path)
    cur: Any = data
    for part in path.split("."):
        if isinstance(cur, dict) and part in cur:
            cur = cur.get(part)
        else:
            return None
    return cur


def _resolve_ref(ref: str, context: dict) -> Any:
    if not isinstance(ref, str):
        return None
    # Automation expressions commonly use plain context paths like
    # `trigger.record.fields.status` rather than `$record.foo`.
    if not ref.startswith("$"):
        direct = _get_by_path(context, ref)
        if direct is not None:
            return direct
    if ref == "$today":
        return datetime.now().date().isoformat()
    if ref == "$now":
        return datetime.now(timezone.utc).isoformat()
    if ref == "$actor":
        return context.get("actor", {})
    if ref.startswith("$actor."):
        return _get_by_path(context.get("actor", {}), ref[len("$actor.") :])
    if ref == "$user":
        return context.get("actor", {})
    if ref.startswith("$user."):
        return _get_by_path(context.get("actor", {}), ref[len("$user.") :])
    if ref.startswith("$record."):
        return _get_by_path(context.get("record", {}), ref[len("$record.") :])
    if ref.startswith("$current."):
        return _get_by_path(context.get("current", {}), ref[len("$current.") :])
    if ref == "$parent":
        return context.get("parent", {})
    if ref.startswith("$parent."):
        return _get_by_path(context.get("parent", {}), ref[len("$parent.") :])
    if ref.startswith("$candidate."):
        return _get_by_path(context.get("candidate", {}), ref[len("$candidate.") :])
    candidate_value = _get_by_path(context.get("candidate", {}), ref)
    if candidate_value is not None:
        return candidate_value
    return _get_by_path(context.get("record", {}), ref)


def _resolve_operand(operand: Any, context: dict) -> Any:
    if isinstance(operand, dict):
        if "ref" in operand:
            return _resolve_ref(operand.get("ref"), context)
        # Automation editor uses `{ var: "trigger.record_id" }` and
        # `{ literal: ... }` rather than manifest `{ ref: ... }`.
        if "var" in operand:
            return _resolve_ref(operand.get("var"), context)
        if "literal" in operand:
            return operand.get("literal")
    return operand


def eval_condition(condition: dict | None, context: dict) -> bool:
    if not condition or not isinstance(condition, dict):
        return False
    op = condition.get("op")
    if op not in ALLOWED_OPS:
        return False

    if op == "and":
        items = condition.get("conditions")
        if not isinstance(items, list):
            items = condition.get("children") or []
        return all(eval_condition(c, context) for c in items)
    if op == "or":
        items = condition.get("conditions")
        if not isinstance(items, list):
            items = condition.get("children") or []
        return any(eval_condition(c, context) for c in items)
    if op == "not":
        return not eval_condition(condition.get("condition") or condition.get("child"), context)

    if "left" in condition or "right" in condition:
        left = _resolve_operand(condition.get("left"), context)
        right = _resolve_operand(condition.get("right"), context)
    else:
        field = condition.get("field")
        left = _resolve_ref(field, context) if isinstance(field, str) else None
        right = _resolve_operand(condition.get("value"), context)

    if op == "exists":
        return left is not None and left != ""
    if op == "not_exists":
        return left is None or left == ""
    if op == "eq":
        return left == right
    if op == "neq":
        return left != right
    if op == "gt":
        return left is not None and right is not None and left > right
    if op == "gte":
        return left is not None and right is not None and left >= right
    if op == "lt":
        return left is not None and right is not None and left < right
    if op == "lte":
        return left is not None and right is not None and left <= right
    if op == "in":
        return isinstance(right, list) and left in right
    if op == "not_in":
        return isinstance(right, list) and left not in right
    if op == "contains":
        if isinstance(left, list):
            return right in left
        if isinstance(left, str) and isinstance(right, str):
            return right in left
        return False
    return False
