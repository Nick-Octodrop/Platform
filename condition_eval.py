"""Full Condition DSL v1 evaluator."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Dict, List


@dataclass
class ConditionEvalError(Exception):
    code: str
    message: str
    path: str | None = None

    def __str__(self) -> str:  # pragma: no cover - simple formatting
        base = f"{self.code}: {self.message}"
        return f"{base} (path={self.path})" if self.path else base


class ConditionSchemaError(ConditionEvalError):
    def __init__(self, message: str, path: str | None = None) -> None:
        super().__init__("CONDITION_SCHEMA_ERROR", message, path)


class ConditionDepthError(ConditionEvalError):
    def __init__(self, message: str, path: str | None = None) -> None:
        super().__init__("CONDITION_DEPTH_EXCEEDED", message, path)


class VarResolveError(ConditionEvalError):
    def __init__(self, message: str, path: str | None = None) -> None:
        super().__init__("CONDITION_VAR_UNRESOLVED", message, path)


class TypeErrorInCondition(ConditionEvalError):
    def __init__(self, message: str, path: str | None = None) -> None:
        super().__init__("CONDITION_TYPE_ERROR", message, path)


class UnknownOpError(ConditionEvalError):
    def __init__(self, message: str, path: str | None = None) -> None:
        super().__init__("CONDITION_UNKNOWN_OP", message, path)


def _depth_check(depth: int, limit: int, path: str) -> None:
    if depth > limit:
        raise ConditionDepthError("Depth limit exceeded", path)


def _resolve_var(ctx: dict, name: str, path: str) -> Any:
    current: Any = ctx
    for part in name.split("."):
        if not isinstance(current, dict) or part not in current:
            raise VarResolveError(f"Unresolved var: {name}", path)
        current = current[part]
    return current


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _ensure_finite(value: Any, path: str) -> None:
    if isinstance(value, float) and not math.isfinite(value):
        raise TypeErrorInCondition("Non-finite number", path)


def _eval_value(node: Any, ctx: dict, path: str, depth: int, limit: int) -> Any:
    _depth_check(depth, limit, path)
    if not isinstance(node, dict):
        raise ConditionSchemaError("Value node must be object", path)
    if "var" in node:
        if not isinstance(node["var"], str):
            raise ConditionSchemaError("var must be string", path)
        return _resolve_var(ctx, node["var"], path)
    if "literal" in node:
        return node["literal"]
    if "array" in node:
        arr = node["array"]
        if not isinstance(arr, list):
            raise ConditionSchemaError("array must be list", path)
        return [
            _eval_value(item, ctx, f"{path}.array[{idx}]", depth + 1, limit)
            for idx, item in enumerate(arr)
        ]
    raise ConditionSchemaError("Invalid value node", path)


def _eval_exists(node: Any, ctx: dict, path: str, depth: int, limit: int) -> bool:
    _depth_check(depth, limit, path)
    if not isinstance(node, dict):
        raise ConditionSchemaError("Value node must be object", path)
    if "var" in node:
        if not isinstance(node["var"], str):
            raise ConditionSchemaError("var must be string", path)
        try:
            value = _resolve_var(ctx, node["var"], path)
        except VarResolveError:
            return False
        return value is not None
    value = _eval_value(node, ctx, path, depth + 1, limit)
    return value is not None


def _require_fields(cond: dict, fields: List[str], path: str) -> None:
    for field in fields:
        if field not in cond:
            raise ConditionSchemaError(f"Missing required field: {field}", path)


def eval_condition(cond: dict, ctx: dict, depth_limit: int = 10) -> bool:
    if not isinstance(ctx, dict):
        raise ConditionSchemaError("ctx must be object", "$")
    return _eval_condition(cond, ctx, "$", 1, depth_limit)


def _eval_condition(cond: Any, ctx: dict, path: str, depth: int, limit: int) -> bool:
    _depth_check(depth, limit, path)
    if not isinstance(cond, dict):
        raise ConditionSchemaError("Condition must be object", path)

    op = cond.get("op")
    if op is None:
        raise ConditionSchemaError("Missing op", path)

    if op in {"and", "or"}:
        _require_fields(cond, ["children"], path)
        children = cond.get("children")
        if not isinstance(children, list):
            raise ConditionSchemaError("children must be list", f"{path}.children")
        if op == "and":
            return all(
                _eval_condition(child, ctx, f"{path}.children[{i}]", depth + 1, limit)
                for i, child in enumerate(children)
            )
        return any(
            _eval_condition(child, ctx, f"{path}.children[{i}]", depth + 1, limit)
            for i, child in enumerate(children)
        )

    if op == "not":
        _require_fields(cond, ["children"], path)
        children = cond.get("children")
        if not isinstance(children, list) or len(children) != 1:
            raise ConditionSchemaError("not requires single child", f"{path}.children")
        return not _eval_condition(children[0], ctx, f"{path}.children[0]", depth + 1, limit)

    if op in {"eq", "neq"}:
        _require_fields(cond, ["left", "right"], path)
        left = _eval_value(cond.get("left"), ctx, f"{path}.left", depth + 1, limit)
        right = _eval_value(cond.get("right"), ctx, f"{path}.right", depth + 1, limit)
        return left == right if op == "eq" else left != right

    if op in {"gt", "gte", "lt", "lte"}:
        _require_fields(cond, ["left", "right"], path)
        left = _eval_value(cond.get("left"), ctx, f"{path}.left", depth + 1, limit)
        right = _eval_value(cond.get("right"), ctx, f"{path}.right", depth + 1, limit)
        if not (_is_number(left) and _is_number(right)):
            raise TypeErrorInCondition("Comparison requires numbers", path)
        _ensure_finite(left, f"{path}.left")
        _ensure_finite(right, f"{path}.right")
        if op == "gt":
            return left > right
        if op == "gte":
            return left >= right
        if op == "lt":
            return left < right
        return left <= right

    if op == "contains":
        _require_fields(cond, ["left", "right"], path)
        left = _eval_value(cond.get("left"), ctx, f"{path}.left", depth + 1, limit)
        right = _eval_value(cond.get("right"), ctx, f"{path}.right", depth + 1, limit)
        if isinstance(left, str) and isinstance(right, str):
            return right in left
        if isinstance(left, list):
            return right in left
        raise TypeErrorInCondition("contains requires string or list left", path)

    if op in {"in", "not_in"}:
        _require_fields(cond, ["left", "right"], path)
        left = _eval_value(cond.get("left"), ctx, f"{path}.left", depth + 1, limit)
        right = _eval_value(cond.get("right"), ctx, f"{path}.right", depth + 1, limit)
        if not isinstance(right, list):
            raise TypeErrorInCondition("right must be list", f"{path}.right")
        result = left in right
        return result if op == "in" else not result

    if op in {"exists", "not_exists"}:
        _require_fields(cond, ["left"], path)
        exists = _eval_exists(cond.get("left"), ctx, f"{path}.left", depth + 1, limit)
        return exists if op == "exists" else not exists

    if op in {"all", "any"}:
        _require_fields(cond, ["over", "where"], path)
        over = _eval_value(cond.get("over"), ctx, f"{path}.over", depth + 1, limit)
        if not isinstance(over, list):
            raise TypeErrorInCondition("over must be list", f"{path}.over")
        where = cond.get("where")
        if not isinstance(where, dict):
            raise ConditionSchemaError("where must be condition", f"{path}.where")
        if not over:
            return False if op == "any" else True
        results = []
        for idx, item in enumerate(over):
            child_ctx = dict(ctx)
            child_ctx["item"] = item
            results.append(
                _eval_condition(where, child_ctx, f"{path}.where", depth + 1, limit)
            )
        return any(results) if op == "any" else all(results)

    raise UnknownOpError(f"Unknown op: {op}", path)
