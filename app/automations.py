from __future__ import annotations

import copy
from typing import Any

from condition_eval import eval_condition


class AutomationMatchError(RuntimeError):
    pass


def _get_path(payload: dict, path: str) -> Any:
    current: Any = payload
    for part in path.split("."):
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current


def _get_snapshot_path(snapshot: dict, path: str) -> Any:
    value = _get_path(snapshot, path)
    if value is not None:
        return value
    fields = snapshot.get("fields") if isinstance(snapshot, dict) else None
    if isinstance(fields, dict):
        if path in fields:
            return fields.get(path)
        short_path = path.split(".")[-1]
        if short_path in fields:
            return fields.get(short_path)
    flat = snapshot.get("flat") if isinstance(snapshot, dict) else None
    if isinstance(flat, dict):
        if path in flat:
            return flat.get(path)
        short_path = path.split(".")[-1]
        if short_path in flat:
            return flat.get(short_path)
    return None


def _matches_filter(payload: dict, filt: dict) -> bool:
    if not isinstance(filt, dict):
        return False
    path = filt.get("path")
    op = filt.get("op")
    if not isinstance(path, str) or not isinstance(op, str):
        return False
    normalized_path = path.strip()
    value = _get_path(payload, normalized_path)
    if value is None and normalized_path.startswith("trigger."):
        normalized_path = normalized_path[len("trigger.") :]
        value = _get_path(payload, normalized_path)
    target = filt.get("value")
    if op == "eq":
        return value == target
    if op == "neq":
        return value != target
    if op == "gt":
        return isinstance(value, (int, float)) and isinstance(target, (int, float)) and value > target
    if op == "gte":
        return isinstance(value, (int, float)) and isinstance(target, (int, float)) and value >= target
    if op == "lt":
        return isinstance(value, (int, float)) and isinstance(target, (int, float)) and value < target
    if op == "lte":
        return isinstance(value, (int, float)) and isinstance(target, (int, float)) and value <= target
    if op == "in":
        if not isinstance(target, list):
            return False
        return value in target
    if op == "not_in":
        if not isinstance(target, list):
            return False
        return value not in target
    if op == "exists":
        return value is not None
    if op == "not_exists":
        return value is None
    if op == "contains":
        if isinstance(value, list):
            return target in value
        if isinstance(value, str) and isinstance(target, str):
            return target in value
        return False
    if op == "changed":
        changed_fields = payload.get("changed_fields")
        if isinstance(changed_fields, list):
            return path in changed_fields or path.split(".")[-1] in changed_fields
        before_val = _get_snapshot_path(payload.get("before") or {}, path)
        after_val = _get_snapshot_path(payload.get("after") or {}, path)
        return before_val != after_val
    if op == "changed_to":
        changed_fields = payload.get("changed_fields")
        short_path = path.split(".")[-1]
        if isinstance(changed_fields, list) and path not in changed_fields and short_path not in changed_fields:
            return False
        after_val = _get_snapshot_path(payload.get("after") or {}, path)
        return after_val == target
    if op == "changed_from":
        changed_fields = payload.get("changed_fields")
        short_path = path.split(".")[-1]
        if isinstance(changed_fields, list) and path not in changed_fields and short_path not in changed_fields:
            return False
        before_val = _get_snapshot_path(payload.get("before") or {}, path)
        return before_val == target
    return False


def match_event(trigger: dict, event_type: str, payload: dict) -> bool:
    if not isinstance(trigger, dict):
        return False
    kind = trigger.get("kind")
    if kind != "event":
        return False
    event_types = trigger.get("event_types")
    if not isinstance(event_types, list) or event_type not in event_types:
        return False
    expr = trigger.get("expr")
    if isinstance(expr, dict):
        try:
            if not bool(eval_condition(expr, {"trigger": payload, "payload": payload})):
                return False
        except Exception:
            return False
    filters = trigger.get("filters") or []
    if not isinstance(filters, list):
        return False
    for filt in filters:
        if not _matches_filter(payload, filt):
            return False
    return True


def eval_condition_step(expr: dict, ctx: dict) -> bool:
    return bool(eval_condition(expr, ctx))


def deep_merge(base: dict, extra: dict) -> dict:
    merged = copy.deepcopy(base)
    for key, value in (extra or {}).items():
        merged[key] = copy.deepcopy(value)
    return merged
