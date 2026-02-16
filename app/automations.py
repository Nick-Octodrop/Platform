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


def _matches_filter(payload: dict, filt: dict) -> bool:
    if not isinstance(filt, dict):
        return False
    path = filt.get("path")
    op = filt.get("op")
    if not isinstance(path, str) or not isinstance(op, str):
        return False
    value = _get_path(payload, path)
    target = filt.get("value")
    if op == "eq":
        return value == target
    if op == "neq":
        return value != target
    if op == "in":
        if not isinstance(target, list):
            return False
        return value in target
    if op == "exists":
        return value is not None
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
