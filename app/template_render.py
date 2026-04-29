from __future__ import annotations

import re
import unicodedata
from functools import lru_cache
from typing import Any, Iterable, Tuple

from jinja2 import StrictUndefined, TemplateSyntaxError, UndefinedError, meta
from jinja2.exceptions import SecurityError
from jinja2.runtime import LoopContext
from jinja2.sandbox import ImmutableSandboxedEnvironment

from app.rich_text import render_rich_text

_ALLOWED_DICT_METHODS = {"get", "items", "keys", "values"}

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
    "tojson",
}

_ALLOWED_TESTS = {
    "defined",
    "undefined",
    "none",
    "equalto",
}


class _LockedSandbox(ImmutableSandboxedEnvironment):
    def is_safe_attribute(self, obj, attr, value) -> bool:
        if isinstance(obj, dict) and attr in _ALLOWED_DICT_METHODS:
            return True
        if isinstance(obj, LoopContext) and attr in {
            "index",
            "index0",
            "revindex",
            "revindex0",
            "first",
            "last",
            "length",
        }:
            return True
        return False

    def is_safe_callable(self, obj) -> bool:
        if obj is range:
            return True
        owner = getattr(obj, "__self__", None)
        name = getattr(obj, "__name__", "")
        if isinstance(owner, dict) and name in _ALLOWED_DICT_METHODS:
            return True
        return False


class _StrictChainableUndefined(StrictUndefined):
    """Strict on final use, but chainable so `|default(...)` can recover."""

    __slots__ = ()

    def __getattr__(self, name: str) -> "_StrictChainableUndefined":
        if name[:2] == "__":
            raise AttributeError(name)
        return self

    def __getitem__(self, key: Any) -> "_StrictChainableUndefined":
        return self


def _slugify(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    normalized = unicodedata.normalize("NFKD", text)
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    lowered = ascii_text.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", lowered).strip("-")
    return slug


@lru_cache(maxsize=2)
def _env(strict: bool) -> _LockedSandbox:
    if strict:
        undefined_cls = _StrictChainableUndefined
    else:
        from jinja2 import Undefined
        undefined_cls = Undefined
    env = _LockedSandbox(autoescape=False, undefined=undefined_cls)
    env.globals = {"range": range}
    env.filters = {key: val for key, val in env.filters.items() if key in _ALLOWED_FILTERS}
    env.filters["slugify"] = _slugify
    env.filters["richtext"] = render_rich_text
    env.tests = {key: val for key, val in env.tests.items() if key in _ALLOWED_TESTS}
    return env


@lru_cache(maxsize=256)
def _compiled_template(strict: bool, text: str):
    env = _env(strict=strict)
    return env.from_string(text or "")


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


def describe_template_render_error(exc: BaseException) -> str:
    message = str(exc) or exc.__class__.__name__
    if isinstance(exc, SecurityError) and "safely callable" in message:
        if "Undefined is not safely callable" in message:
            return (
                "Template tried to call a missing or unsupported value. "
                "Use field lookups like {{ record['field.id'] }}, record.get('field.id'), "
                "record.items(), and filters; remove unsupported calls like helper(), now(), or custom functions."
            )
        return (
            "Template tried to call an unsupported helper. "
            "Only safe dictionary reads such as record.get('field.id') and record.items() are callable."
        )
    return message


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
            except SecurityError as exc:
                errors.append(
                    {
                        "message": f"{label}: {describe_template_render_error(exc)}",
                        "line": getattr(exc, "lineno", None) or 1,
                        "col": 1,
                    }
                )
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
    tmpl = _compiled_template(strict, text or "")
    return tmpl.render(_sanitize_context(context))
