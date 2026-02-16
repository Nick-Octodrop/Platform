"""Expression DSL v1 evaluator."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Dict, List

import condition_eval


@dataclass
class ExpressionEvalError(Exception):
    code: str
    message: str
    path: str | None = None

    def __str__(self) -> str:  # pragma: no cover - simple formatting
        base = f"{self.code}: {self.message}"
        return f"{base} (path={self.path})" if self.path else base


class ExpressionSchemaError(ExpressionEvalError):
    def __init__(self, message: str, path: str | None = None) -> None:
        super().__init__("EXPR_SCHEMA_ERROR", message, path)


class ExpressionDepthError(ExpressionEvalError):
    def __init__(self, message: str, path: str | None = None) -> None:
        super().__init__("EXPR_DEPTH_EXCEEDED", message, path)


class ExprVarResolveError(ExpressionEvalError):
    def __init__(self, message: str, path: str | None = None) -> None:
        super().__init__("EXPR_VAR_UNRESOLVED", message, path)


class UnknownExprError(ExpressionEvalError):
    def __init__(self, message: str, path: str | None = None) -> None:
        super().__init__("EXPR_UNKNOWN", message, path)


class ExprTypeError(ExpressionEvalError):
    def __init__(self, message: str, path: str | None = None) -> None:
        super().__init__("EXPR_TYPE_ERROR", message, path)


def _depth_check(depth: int, limit: int, path: str) -> None:
    if depth > limit:
        raise ExpressionDepthError("Depth limit exceeded", path)


def _resolve_var(ctx: dict, name: str, path: str) -> Any:
    current: Any = ctx
    for part in name.split("."):
        if not isinstance(current, dict) or part not in current:
            raise ExprVarResolveError(f"Unresolved var: {name}", path)
        current = current[part]
    return current


def _ensure_no_nonfinite(value: Any, path: str) -> None:
    if isinstance(value, float) and not math.isfinite(value):
        raise ExprTypeError("Non-finite number", path)
    if isinstance(value, list):
        for idx, item in enumerate(value):
            _ensure_no_nonfinite(item, f"{path}[{idx}]")
    elif isinstance(value, dict):
        for key, item in value.items():
            _ensure_no_nonfinite(item, f"{path}.{key}")


def eval_expression(expr: dict, ctx: dict, depth_limit: int = 10) -> Any:
    if not isinstance(ctx, dict):
        raise ExpressionSchemaError("ctx must be object", "$")
    return _eval_expression(expr, ctx, "$", 1, depth_limit)


def _eval_expression(expr: Any, ctx: dict, path: str, depth: int, limit: int) -> Any:
    _depth_check(depth, limit, path)
    if not isinstance(expr, dict):
        raise ExpressionSchemaError("Expression must be object", path)

    keys = set(expr.keys())

    if keys == {"literal"}:
        value = expr.get("literal")
        _ensure_no_nonfinite(value, path)
        return value

    if keys == {"var"}:
        if not isinstance(expr.get("var"), str):
            raise ExpressionSchemaError("var must be string", path)
        value = _resolve_var(ctx, expr["var"], path)
        _ensure_no_nonfinite(value, path)
        return value

    if "expr" in expr:
        expr_type = expr.get("expr")
        if expr_type == "coalesce":
            if keys != {"expr", "args"}:
                raise ExpressionSchemaError("coalesce has invalid keys", path)
            args = expr.get("args")
            if not isinstance(args, list) or not args:
                raise ExpressionSchemaError("args must be non-empty list", f"{path}.args")
            for idx, arg in enumerate(args):
                value = _eval_expression(arg, ctx, f"{path}.args[{idx}]", depth + 1, limit)
                _ensure_no_nonfinite(value, f"{path}.args[{idx}]")
                if value is not None:
                    return value
            return None

        if expr_type == "case":
            allowed = {"expr", "cases", "else"}
            if not keys.issubset(allowed):
                raise ExpressionSchemaError("case has invalid keys", path)
            cases = expr.get("cases")
            if not isinstance(cases, list) or not cases:
                raise ExpressionSchemaError("cases must be non-empty list", f"{path}.cases")
            for idx, case in enumerate(cases):
                case_path = f"{path}.cases[{idx}]"
                if not isinstance(case, dict) or set(case.keys()) != {"when", "then"}:
                    raise ExpressionSchemaError("case items require when and then", case_path)
                when = case.get("when")
                try:
                    remaining = limit - depth + 1
                    if remaining < 1:
                        raise ExpressionDepthError("Depth limit exceeded", f"{case_path}.when")
                    matched = condition_eval.eval_condition(when, ctx, depth_limit=remaining)
                except condition_eval.ConditionEvalError as exc:
                    raise ExpressionEvalError(
                        "EXPR_CONDITION_ERROR",
                        f"Condition error: {exc.code}",
                        f"{case_path}.when",
                    ) from exc
                if matched:
                    value = _eval_expression(
                        case.get("then"), ctx, f"{case_path}.then", depth + 1, limit
                    )
                    _ensure_no_nonfinite(value, f"{case_path}.then")
                    return value
            if "else" in expr:
                value = _eval_expression(expr.get("else"), ctx, f"{path}.else", depth + 1, limit)
                _ensure_no_nonfinite(value, f"{path}.else")
                return value
            return None

        raise UnknownExprError(f"Unknown expr: {expr_type}", path)

    raise ExpressionSchemaError("Invalid expression shape", path)
