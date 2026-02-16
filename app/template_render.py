from __future__ import annotations

from typing import Any, Iterable, Tuple

from jinja2 import TemplateSyntaxError, UndefinedError, meta
from jinja2.sandbox import ImmutableSandboxedEnvironment

_ALLOWED_FILTERS = {
    "default",
    "lower",
    "upper",
    "title",
    "trim",
    "replace",
    "round",
    "length",
    "int",
    "float",
}

_ALLOWED_TESTS = {
    "defined",
    "undefined",
    "none",
    "equalto",
}


class _LockedSandbox(ImmutableSandboxedEnvironment):
    def is_safe_attribute(self, obj, attr, value) -> bool:
        return False

    def is_safe_callable(self, obj) -> bool:
        return False


def _env(strict: bool) -> _LockedSandbox:
    if strict:
        from jinja2 import StrictUndefined
        undefined_cls = StrictUndefined
    else:
        from jinja2 import Undefined
        undefined_cls = Undefined
    env = _LockedSandbox(autoescape=False, undefined=undefined_cls)
    env.globals = {"range": range}
    env.filters = {key: val for key, val in env.filters.items() if key in _ALLOWED_FILTERS}
    env.tests = {key: val for key, val in env.tests.items() if key in _ALLOWED_TESTS}
    return env


def _sanitize_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(key): _sanitize_value(val) for key, val in value.items()}
    if isinstance(value, (list, tuple)):
        return [_sanitize_value(val) for val in value]
    return str(value)


def _sanitize_context(context: dict[str, Any] | None) -> dict[str, Any]:
    return _sanitize_value(context or {}) or {}


def collect_undeclared_vars(template_text: str | None) -> set[str]:
    if not template_text:
        return set()
    env = _env(strict=False)
    parsed = env.parse(template_text)
    return set(meta.find_undeclared_variables(parsed))


def _extract_undefined_var(message: str) -> str | None:
    if not isinstance(message, str):
        return None
    if "'" in message:
        parts = message.split("'")
        if len(parts) >= 2:
            return parts[1]
    return None


def validate_templates(
    templates: Iterable[Tuple[str, str | None]],
    context: dict[str, Any] | None = None,
) -> tuple[list[dict], set[str], set[str]]:
    errors: list[dict] = []
    undeclared: set[str] = set()
    actual_undefined: set[str] = set()
    env = _env(strict=False)
    strict_context = _sanitize_context(context)
    for label, text in templates:
        if not text:
            continue
        try:
            parsed = env.parse(text)
            undeclared.update(meta.find_undeclared_variables(parsed))
        except TemplateSyntaxError as exc:
            errors.append(
                {
                    "message": f"{label}: {exc.message}",
                    "line": exc.lineno or 1,
                    "col": getattr(exc, "offset", None) or 1,
                }
            )
            continue
        if context is not None:
            try:
                render_template(text, strict_context, strict=True)
            except UndefinedError as exc:
                var_name = _extract_undefined_var(str(exc))
                if var_name:
                    actual_undefined.add(var_name)
            except TemplateSyntaxError as exc:
                errors.append(
                    {
                        "message": f"{label}: {exc.message}",
                        "line": exc.lineno or 1,
                        "col": getattr(exc, "offset", None) or 1,
                    }
                )
    return errors, undeclared, actual_undefined


def render_template(text: str | None, context: dict[str, Any], strict: bool = True) -> str:
    env = _env(strict=strict)
    tmpl = env.from_string(text or "")
    return tmpl.render(_sanitize_context(context))
