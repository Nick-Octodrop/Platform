from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


DEFAULT_LOCALE = "en-NZ"
DEFAULT_TIMEZONE = "UTC"
DEFAULT_CURRENCY = "NZD"
FALLBACK_LOCALE = DEFAULT_LOCALE

_LOCALE_RE = re.compile(r"^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$")
_CURRENCY_RE = re.compile(r"^[A-Za-z]{3}$")
_LOCALES_ROOT = Path(__file__).resolve().parents[1] / "web" / "src" / "locales"


def normalize_locale(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    raw = value.strip()
    if not raw or not _LOCALE_RE.match(raw):
        return None
    parts = raw.split("-")
    normalized: list[str] = []
    for index, part in enumerate(parts):
        if index == 0:
            normalized.append(part.lower())
        elif len(part) == 2:
            normalized.append(part.upper())
        elif len(part) == 4:
            normalized.append(part[:1].upper() + part[1:].lower())
        else:
            normalized.append(part)
    return "-".join(normalized)


def normalize_timezone(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    raw = value.strip()
    if not raw:
        return None
    try:
        ZoneInfo(raw)
    except Exception:
        return None
    return raw


def normalize_currency_code(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    raw = value.strip().upper()
    if not raw or not _CURRENCY_RE.match(raw):
        return None
    return raw


def resolve_locale(user_locale: Any = None, workspace_locale: Any = None, fallback: str = DEFAULT_LOCALE) -> str:
    return normalize_locale(user_locale) or normalize_locale(workspace_locale) or fallback


def resolve_timezone(user_timezone: Any = None, workspace_timezone: Any = None, fallback: str = DEFAULT_TIMEZONE) -> str:
    return normalize_timezone(user_timezone) or normalize_timezone(workspace_timezone) or fallback


def resolve_default_currency(workspace_currency: Any = None, fallback: str = DEFAULT_CURRENCY) -> str:
    return normalize_currency_code(workspace_currency) or fallback


def build_locale_context(
    *,
    workspace: dict[str, Any] | None = None,
    user: dict[str, Any] | None = None,
    messages: dict[str, Any] | None = None,
) -> dict[str, Any]:
    workspace_prefs = workspace or {}
    user_prefs = user or {}
    resolved_locale = resolve_locale(user_prefs.get("locale"), workspace_prefs.get("default_locale"))
    resolved_timezone = resolve_timezone(user_prefs.get("timezone"), workspace_prefs.get("default_timezone"))
    default_currency = resolve_default_currency(workspace_prefs.get("default_currency"))
    return {
        "locale": resolved_locale,
        "timezone": resolved_timezone,
        "default_currency": default_currency,
        "fallback_locale": FALLBACK_LOCALE,
        "workspace": {
            "default_locale": normalize_locale(workspace_prefs.get("default_locale")) or DEFAULT_LOCALE,
            "default_timezone": normalize_timezone(workspace_prefs.get("default_timezone")) or DEFAULT_TIMEZONE,
            "default_currency": default_currency,
        },
        "user": {
            "locale": normalize_locale(user_prefs.get("locale")),
            "timezone": normalize_timezone(user_prefs.get("timezone")),
        },
        "messages": messages or {},
    }


def _currency_config(field: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(field, dict):
        return {}
    config: dict[str, Any] = {}
    for key in ("currency_code", "currency_field", "currency_source"):
        if key in field:
            config[key] = field.get(key)
    fmt = field.get("format")
    if isinstance(fmt, dict):
        if "currency_code" not in config and fmt.get("currency_code") is not None:
            config["currency_code"] = fmt.get("currency_code")
        if "currency_field" not in config and fmt.get("currency_field") is not None:
            config["currency_field"] = fmt.get("currency_field")
        if "currency_source" not in config and fmt.get("currency_source") is not None:
            config["currency_source"] = fmt.get("currency_source")
        if "currency_code" not in config and fmt.get("currency") is not None:
            config["currency_code"] = fmt.get("currency")
    return config


def _record_value(record: dict[str, Any] | None, field_id: Any) -> Any:
    if not isinstance(record, dict) or not isinstance(field_id, str) or not field_id:
        return None
    if field_id.endswith(".id"):
        return record.get("id")
    return record.get(field_id)


def resolve_currency_for_field(
    field: dict[str, Any] | None,
    record: dict[str, Any] | None = None,
    workspace_default_currency: str | None = None,
    fallback: str = DEFAULT_CURRENCY,
) -> str:
    config = _currency_config(field)
    explicit_code = normalize_currency_code(config.get("currency_code"))
    if explicit_code:
        return explicit_code
    record_code = normalize_currency_code(_record_value(record, config.get("currency_field")))
    if record_code:
        return record_code
    if str(config.get("currency_source") or "").strip().lower() == "workspace_default":
        return resolve_default_currency(workspace_default_currency, fallback)
    return resolve_default_currency(workspace_default_currency, fallback)


def load_locale_namespace(locale: str, namespace: str) -> dict[str, Any]:
    normalized_locale = normalize_locale(locale) or DEFAULT_LOCALE
    safe_namespace = str(namespace or "").strip()
    if not safe_namespace:
        return {}
    path = _LOCALES_ROOT / normalized_locale / f"{safe_namespace}.json"
    if not path.exists() and normalized_locale != FALLBACK_LOCALE:
        path = _LOCALES_ROOT / FALLBACK_LOCALE / f"{safe_namespace}.json"
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def load_locale_messages(locale: str, namespaces: list[str] | tuple[str, ...]) -> dict[str, Any]:
    messages: dict[str, Any] = {}
    for namespace in namespaces:
        safe_namespace = str(namespace or "").strip()
        if not safe_namespace:
            continue
        messages[safe_namespace] = load_locale_namespace(locale, safe_namespace)
    return messages
