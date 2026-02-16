"""Condition evaluation for manifest-driven rules."""

from __future__ import annotations

from typing import Any


ALLOWED_OPS = {
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "in",
    "contains",
    "exists",
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
    if ref.startswith("$record."):
        return _get_by_path(context.get("record", {}), ref[len("$record.") :])
    if ref.startswith("$candidate."):
        return _get_by_path(context.get("candidate", {}), ref[len("$candidate.") :])
    candidate_value = _get_by_path(context.get("candidate", {}), ref)
    if candidate_value is not None:
        return candidate_value
    return _get_by_path(context.get("record", {}), ref)


def _resolve_operand(operand: Any, context: dict) -> Any:
    if isinstance(operand, dict) and "ref" in operand:
        return _resolve_ref(operand.get("ref"), context)
    return operand


def eval_condition(condition: dict | None, context: dict) -> bool:
    if not condition or not isinstance(condition, dict):
        return False
    op = condition.get("op")
    if op not in ALLOWED_OPS:
        return False

    if op == "and":
        items = condition.get("conditions") or []
        return all(eval_condition(c, context) for c in items)
    if op == "or":
        items = condition.get("conditions") or []
        return any(eval_condition(c, context) for c in items)
    if op == "not":
        return not eval_condition(condition.get("condition"), context)

    if "left" in condition or "right" in condition:
        left = _resolve_operand(condition.get("left"), context)
        right = _resolve_operand(condition.get("right"), context)
    else:
        field = condition.get("field")
        left = _resolve_ref(field, context) if isinstance(field, str) else None
        right = condition.get("value")

    if op == "exists":
        return left is not None and left != ""
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
    if op == "contains":
        if isinstance(left, list):
            return right in left
        if isinstance(left, str) and isinstance(right, str):
            return right in left
        return False
    return False
