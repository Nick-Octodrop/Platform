"""Computed field helpers for manifest-driven record calculations."""

from __future__ import annotations

import math
from typing import Any, Callable

from app.conditions import eval_condition


def _normalize_entity_id(entity_id: str | None) -> str | None:
    if not isinstance(entity_id, str) or not entity_id:
        return None
    return entity_id if entity_id.startswith("entity.") else f"entity.{entity_id}"


def _computed_fields(entity_def: dict) -> list[dict]:
    fields = entity_def.get("fields") if isinstance(entity_def, dict) else None
    if not isinstance(fields, list):
        return []
    return [field for field in fields if isinstance(field, dict) and isinstance(field.get("compute"), dict)]


def has_computed_fields(entity_def: dict) -> bool:
    return len(_computed_fields(entity_def)) > 0


def depends_on_aggregate_entity(entity_def: dict, source_entity_id: str) -> bool:
    normalized = _normalize_entity_id(source_entity_id)
    if not normalized:
        return False
    for field in _computed_fields(entity_def):
        compute = field.get("compute") if isinstance(field, dict) else None
        aggregate = compute.get("aggregate") if isinstance(compute, dict) else None
        if not isinstance(aggregate, dict):
            continue
        target = _normalize_entity_id(aggregate.get("entity"))
        if target == normalized:
            return True
    return False


def _resolve_ref(ref: str, context: dict) -> Any:
    if not isinstance(ref, str):
        return None
    current = context.get("current") if isinstance(context.get("current"), dict) else {}
    parent = context.get("parent") if isinstance(context.get("parent"), dict) else {}
    record = context.get("record") if isinstance(context.get("record"), dict) else current
    if ref.startswith("$current."):
        return current.get(ref[len("$current.") :])
    if ref.startswith("$parent."):
        return parent.get(ref[len("$parent.") :])
    if ref.startswith("$record."):
        return record.get(ref[len("$record.") :])
    if ref in current:
        return current.get(ref)
    if ref in record:
        return record.get(ref)
    if ref in parent:
        return parent.get(ref)
    return None


def _as_number(value: Any) -> float:
    if value is None or value == "":
        return 0.0
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(value)
    except Exception:
        return 0.0


def _eval_expression(expr: Any, context: dict) -> Any:
    if isinstance(expr, (int, float, bool)) or expr is None:
        return expr
    if isinstance(expr, str):
        return expr
    if isinstance(expr, dict) and "ref" in expr:
        return _resolve_ref(expr.get("ref"), context)
    if not isinstance(expr, dict):
        return expr

    op = expr.get("op")
    args = expr.get("args")
    if isinstance(args, list):
        resolved_args = [_eval_expression(arg, context) for arg in args]
    else:
        resolved_args = []

    if op == "add":
        return sum(_as_number(arg) for arg in resolved_args)
    if op == "sub":
        if not resolved_args:
            return 0
        head = _as_number(resolved_args[0])
        for arg in resolved_args[1:]:
            head -= _as_number(arg)
        return head
    if op == "mul":
        result = 1.0
        for arg in resolved_args:
            result *= _as_number(arg)
        return result
    if op == "div":
        if not resolved_args:
            return 0
        head = _as_number(resolved_args[0])
        for arg in resolved_args[1:]:
            denom = _as_number(arg)
            if denom == 0:
                return 0
            head /= denom
        return head
    if op == "mod":
        if len(resolved_args) < 2:
            return 0
        denom = _as_number(resolved_args[1])
        if denom == 0:
            return 0
        return _as_number(resolved_args[0]) % denom
    if op == "min":
        return min((_as_number(arg) for arg in resolved_args), default=0)
    if op == "max":
        return max((_as_number(arg) for arg in resolved_args), default=0)
    if op == "abs":
        return abs(_as_number(resolved_args[0] if resolved_args else 0))
    if op == "neg":
        return -_as_number(resolved_args[0] if resolved_args else 0)
    if op == "round":
        if not resolved_args:
            return 0
        precision = int(_as_number(resolved_args[1])) if len(resolved_args) > 1 else 0
        return round(_as_number(resolved_args[0]), precision)
    if op == "ceil":
        return math.ceil(_as_number(resolved_args[0] if resolved_args else 0))
    if op == "floor":
        return math.floor(_as_number(resolved_args[0] if resolved_args else 0))
    if op == "coalesce":
        for arg in resolved_args:
            if arg not in (None, ""):
                return arg
        return None
    if op == "and":
        return all(bool(arg) for arg in resolved_args)
    if op == "or":
        return any(bool(arg) for arg in resolved_args)
    if op == "not":
        return not bool(resolved_args[0] if resolved_args else False)
    if op == "eq":
        return len(resolved_args) >= 2 and resolved_args[0] == resolved_args[1]
    if op == "neq":
        return len(resolved_args) >= 2 and resolved_args[0] != resolved_args[1]
    if op == "gt":
        return len(resolved_args) >= 2 and _as_number(resolved_args[0]) > _as_number(resolved_args[1])
    if op == "gte":
        return len(resolved_args) >= 2 and _as_number(resolved_args[0]) >= _as_number(resolved_args[1])
    if op == "lt":
        return len(resolved_args) >= 2 and _as_number(resolved_args[0]) < _as_number(resolved_args[1])
    if op == "lte":
        return len(resolved_args) >= 2 and _as_number(resolved_args[0]) <= _as_number(resolved_args[1])
    if op == "if":
        condition = expr.get("condition")
        if_true = expr.get("then")
        if_false = expr.get("else")
        return _eval_expression(if_true, context) if eval_condition(condition, context) else _eval_expression(if_false, context)

    return None


def _compute_aggregate(spec: dict, record: dict, fetch_records: Callable[[str], list[dict]]) -> Any:
    target_entity = _normalize_entity_id(spec.get("entity"))
    if not target_entity:
        return None
    op = spec.get("op") or spec.get("measure") or "sum"
    if not isinstance(op, str):
        op = "sum"
    op = op.lower()
    rows = fetch_records(target_entity) or []
    where = spec.get("where")
    field_id = spec.get("field")
    values: list[Any] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        ctx = {"record": row, "current": row, "parent": record}
        if isinstance(where, dict) and not eval_condition(where, ctx):
            continue
        if op == "count":
            values.append(1)
            continue
        if isinstance(field_id, str) and field_id:
            values.append(row.get(field_id))
    if op == "count":
        return len(values)
    numeric = [_as_number(value) for value in values]
    if op == "sum":
        return sum(numeric)
    if op == "avg":
        return (sum(numeric) / len(numeric)) if numeric else 0
    if op == "min":
        return min(numeric) if numeric else 0
    if op == "max":
        return max(numeric) if numeric else 0
    return None


def compute_field_value(field: dict, record: dict, fetch_records: Callable[[str], list[dict]]) -> Any:
    compute = field.get("compute") if isinstance(field, dict) else None
    if not isinstance(compute, dict):
        return record.get(field.get("id"))
    if isinstance(compute.get("aggregate"), dict):
        return _compute_aggregate(compute.get("aggregate"), record, fetch_records)
    if "expression" in compute:
        return _eval_expression(
            compute.get("expression"),
            {
                "record": record,
                "current": record,
                "parent": record,
            },
        )
    return record.get(field.get("id"))


def recompute_record(entity_def: dict, record: dict, fetch_records: Callable[[str], list[dict]]) -> dict:
    if not isinstance(record, dict):
        return {}
    updated = dict(record)
    fields = _computed_fields(entity_def)
    if not fields:
        return updated
    # Iterate until dependent computed fields stabilize.
    for _ in range(max(1, len(fields) + 1)):
        changed = False
        for field in fields:
            field_id = field.get("id")
            if not isinstance(field_id, str) or not field_id:
                continue
            value = compute_field_value(field, updated, fetch_records)
            if updated.get(field_id) != value:
                updated[field_id] = value
                changed = True
        if not changed:
            break
    return updated
