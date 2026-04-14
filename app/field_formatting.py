from __future__ import annotations

import re
from typing import Any

from app.localization import resolve_currency_for_field


CURRENCY_SYMBOLS = {
    "NZD": "NZ$",
    "AUD": "A$",
    "USD": "$",
    "CAD": "CA$",
    "EUR": "€",
    "GBP": "£",
    "CHF": "CHF ",
    "JPY": "¥",
    "CNY": "CN¥",
    "HKD": "HK$",
    "SGD": "S$",
    "INR": "₹",
    "AED": "AED ",
    "SAR": "SAR ",
    "ZAR": "R",
    "SEK": "SEK ",
    "NOK": "NOK ",
    "DKK": "DKK ",
    "BRL": "R$",
    "MXN": "MX$",
}

_PLACEHOLDER_RE = re.compile(r"^\s*\{\{.+\}\}\s*$")


def _field_list(entity_def: dict | None) -> list[dict]:
    fields = entity_def.get("fields") if isinstance(entity_def, dict) else None
    if isinstance(fields, list):
        return [field for field in fields if isinstance(field, dict)]
    if isinstance(fields, dict):
        out: list[dict] = []
        for field_id, config in fields.items():
            if isinstance(config, dict):
                out.append({"id": field_id, **config})
            else:
                out.append({"id": field_id})
        return out
    return []


def _get_value(record: dict | None, field_id: str | None) -> Any:
    if not isinstance(record, dict) or not isinstance(field_id, str) or not field_id:
        return None
    if field_id.endswith(".id"):
        return record.get("id")
    return record.get(field_id)


def _placeholder_like(value: Any) -> bool:
    return isinstance(value, str) and bool(_PLACEHOLDER_RE.match(value))


def _normalize_precision(value: Any, fallback: int = 2) -> int:
    try:
        parsed = int(value)
    except Exception:
        return fallback
    return max(0, min(6, parsed))


def _number_text(value: Any, precision: int = 2) -> str:
    if _placeholder_like(value):
        return str(value)
    try:
        numeric = float(value if value not in (None, "") else 0)
    except Exception:
        return str(value)
    if precision <= 0:
        return str(int(round(numeric)))
    return f"{numeric:.{precision}f}"


def _resolve_format(field: dict | None, record: dict | None) -> dict:
    fmt = field.get("format") if isinstance(field, dict) and isinstance(field.get("format"), dict) else {}
    field_type = field.get("type") if isinstance(field, dict) else None
    kind = fmt.get("kind") if isinstance(fmt.get("kind"), str) and fmt.get("kind") else ("currency" if field_type == "currency" else "plain")
    unit = _get_value(record, fmt.get("unit_field")) or fmt.get("unit") or ""
    precision = _normalize_precision(fmt.get("precision"), 2)
    return {
        "kind": str(kind).lower(),
        "currency": resolve_currency_for_field(field, record),
        "unit": str(unit) if unit else "",
        "precision": precision,
    }


def format_field_value(field: dict | None, value: Any, record: dict | None = None, locale_context: dict | None = None) -> Any:
    if not isinstance(field, dict):
        return value
    if field.get("type") not in {"number", "currency"}:
        return value
    fmt = field.get("format")
    if field.get("type") != "currency" and not isinstance(fmt, dict):
        return value
    resolved = _resolve_format(field, record)
    kind = resolved["kind"]
    precision = resolved["precision"]
    if kind == "currency":
        symbol = CURRENCY_SYMBOLS.get(resolved["currency"], f"{resolved['currency']} ")
        if _placeholder_like(value):
            return f"{symbol}{value}"
        return f"{symbol}{_number_text(value, precision)}"
    if kind == "percent":
        if _placeholder_like(value):
            return f"{value}%"
        return f"{_number_text(value, precision)}%"
    if kind in {"measurement", "duration"}:
        suffix = f" {resolved['unit']}".rstrip()
        if _placeholder_like(value):
            return f"{value}{suffix}"
        return f"{_number_text(value, precision)}{suffix}"
    if _placeholder_like(value):
        return value
    return _number_text(value, precision)


def build_formatted_record(record: dict | None, entity_def: dict | None, locale_context: dict | None = None) -> dict:
    if not isinstance(record, dict):
        return {}
    formatted = dict(record)
    for field in _field_list(entity_def):
        field_id = field.get("id")
        if not isinstance(field_id, str) or not field_id:
            continue
        if field_id not in formatted:
            continue
        formatted[field_id] = format_field_value(field, formatted.get(field_id), record, locale_context=locale_context)
    return formatted


def expand_dotted_fields(values: dict | None) -> dict:
    nested: dict[str, Any] = {}
    for raw_key, raw_value in (values or {}).items():
        if not isinstance(raw_key, str) or not raw_key:
            continue
        parts = [part for part in raw_key.split(".") if part]
        if not parts:
            continue
        current = nested
        for idx, part in enumerate(parts):
            if idx == len(parts) - 1:
                current[part] = raw_value
                continue
            child = current.get(part)
            if not isinstance(child, dict):
                child = {}
                current[part] = child
            current = child
    return nested
