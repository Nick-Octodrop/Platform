"""Computed field helpers for manifest-driven record calculations."""

from __future__ import annotations

import math
from typing import Any, Callable

from app.conditions import eval_condition

FetchRecords = Callable[..., list[dict]]
FetchRecord = Callable[[str, str], dict | None]
FetchEntityDef = Callable[[str], dict | None]


def _normalize_entity_id(entity_id: str | None) -> str | None:
    if not isinstance(entity_id, str) or not entity_id:
        return None
    return entity_id if entity_id.startswith("entity.") else f"entity.{entity_id}"


def _computed_fields(entity_def: dict) -> list[dict]:
    fields = entity_def.get("fields") if isinstance(entity_def, dict) else None
    if not isinstance(fields, list):
        return []
    return [field for field in fields if isinstance(field, dict) and isinstance(field.get("compute"), dict)]


def _field_list(entity_def: dict | None) -> list[dict]:
    fields = entity_def.get("fields") if isinstance(entity_def, dict) else None
    return fields if isinstance(fields, list) else []


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


def _enum_label_for_value(field: dict, value: Any) -> str | None:
    options = field.get("options") if isinstance(field, dict) else None
    if not isinstance(options, list):
        return None
    for option in options:
        if not isinstance(option, dict) or option.get("value") != value:
            continue
        label = option.get("label")
        if label in (None, ""):
            return None
        return label if isinstance(label, str) else str(label)
    return None


def _lookup_display_value(record: dict | None, display_field: str | None) -> str | None:
    if not isinstance(record, dict) or not isinstance(display_field, str) or not display_field:
        return None
    field_candidates = [display_field]
    prefix = display_field.split(".", 1)[0] if "." in display_field else None
    if prefix:
        field_candidates.extend([f"{prefix}.display_name", f"{prefix}.name", f"{prefix}.full_name"])
    else:
        field_candidates.extend(["display_name", "name", "full_name"])
    for field_id in field_candidates:
        label = record.get(field_id)
        if label in (None, ""):
            continue
        return label if isinstance(label, str) else str(label)
    return None


def _unwrap_record(record: dict | None) -> dict | None:
    if not isinstance(record, dict):
        return None
    nested = record.get("record")
    return nested if isinstance(nested, dict) else record


def _related_prefix_aliases(field_id: str) -> list[str]:
    base = field_id[:-3] if field_id.endswith("_id") else field_id
    aliases = [base]
    if "." in base:
        local = base.split(".", 1)[1].strip()
        if local:
            aliases.append(local)
    return aliases


def _enrich_record_for_compute(
    record: dict,
    entity_def: dict | None,
    fetch_record: FetchRecord | None,
    fetch_entity_def: FetchEntityDef | None,
    *,
    expand_lookup_aliases: bool = True,
) -> dict:
    enriched = dict(record or {})
    for field in _field_list(entity_def):
        field_id = field.get("id")
        if not isinstance(field_id, str) or not field_id:
            continue
        value = enriched.get(field_id)
        field_type = field.get("type")
        if field_type == "enum":
            label = _enum_label_for_value(field, value)
            if label:
                enriched[f"{field_id}_label"] = label
            continue
        if field_type != "lookup" or not expand_lookup_aliases:
            continue
        if not callable(fetch_record) or not callable(fetch_entity_def):
            continue
        if not isinstance(value, str) or not value.strip():
            continue
        target_entity = _normalize_entity_id(field.get("entity"))
        if not target_entity:
            continue
        target_record = _unwrap_record(fetch_record(target_entity, value))
        if not isinstance(target_record, dict):
            continue
        display_field = field.get("display_field")
        label = _lookup_display_value(target_record, display_field if isinstance(display_field, str) else None)
        if label:
            enriched.setdefault(f"{field_id}_label", label)
            if field_id.endswith("_id"):
                for prefix in _related_prefix_aliases(field_id):
                    enriched.setdefault(f"{prefix}_name", label)
        target_entity_def = fetch_entity_def(target_entity)
        target_enriched = _enrich_record_for_compute(
            target_record,
            target_entity_def,
            fetch_record,
            fetch_entity_def,
            expand_lookup_aliases=False,
        )
        for target_key, target_value in target_enriched.items():
            if not isinstance(target_key, str) or "." not in target_key:
                continue
            if isinstance(target_value, (dict, list, tuple, set)):
                continue
            suffix = target_key.split(".", 1)[1].strip()
            if not suffix:
                continue
            suffix_key = suffix.replace(".", "_")
            for prefix in _related_prefix_aliases(field_id):
                enriched.setdefault(f"{prefix}_{suffix_key}", target_value)
    return enriched


def _resolve_ref(ref: str, context: dict) -> Any:
    if not isinstance(ref, str):
        return None
    current = context.get("current") if isinstance(context.get("current"), dict) else {}
    parent = context.get("parent") if isinstance(context.get("parent"), dict) else {}
    record = context.get("record") if isinstance(context.get("record"), dict) else current
    if ref.startswith("$current."):
        return _get_by_path(current, ref[len("$current.") :])
    if ref.startswith("$parent."):
        return _get_by_path(parent, ref[len("$parent.") :])
    if ref.startswith("$record."):
        return _get_by_path(record, ref[len("$record.") :])
    value = _get_by_path(current, ref)
    if value is not None:
        return value
    value = _get_by_path(record, ref)
    if value is not None:
        return value
    value = _get_by_path(parent, ref)
    if value is not None:
        return value
    return None


def _simple_parent_eq_field(where: Any) -> str | None:
    if not isinstance(where, dict):
        return None
    if str(where.get("op") or "").strip().lower() != "eq":
        return None
    field_id = where.get("field")
    value = where.get("value")
    if not isinstance(field_id, str) or not field_id.strip():
        return None
    if not isinstance(value, dict) or str(value.get("ref") or "").strip() != "$parent.id":
        return None
    return field_id.strip()


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


def _as_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


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
    if op == "concat":
        return "".join(_as_text(arg) for arg in resolved_args)
    if op == "join":
        separator = expr.get("separator")
        if not isinstance(separator, str):
            separator = " "
        skip_empty = expr.get("skip_empty")
        if skip_empty is None:
            skip_empty = True
        parts = [_as_text(arg) for arg in resolved_args]
        if skip_empty:
            parts = [part for part in parts if part]
        return separator.join(parts)
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


def _compute_aggregate(
    spec: dict,
    record: dict,
    entity_def: dict | None,
    fetch_records: FetchRecords,
    fetch_record: FetchRecord | None = None,
    fetch_entity_def: FetchEntityDef | None = None,
) -> Any:
    target_entity = _normalize_entity_id(spec.get("entity"))
    if not target_entity:
        return None
    op = spec.get("op") or spec.get("measure") or "sum"
    if not isinstance(op, str):
        op = "sum"
    op = op.lower()
    target_entity_def = fetch_entity_def(target_entity) if callable(fetch_entity_def) else None
    parent_record = _enrich_record_for_compute(record, entity_def, fetch_record, fetch_entity_def)
    where = spec.get("where")
    field_id = spec.get("field")
    simple_parent_field = _simple_parent_eq_field(where)
    if simple_parent_field:
        parent_id = parent_record.get("id")
        if parent_id not in (None, ""):
            try:
                rows = fetch_records(target_entity, simple_parent_field, parent_id) or []
            except TypeError:
                rows = fetch_records(target_entity) or []
            else:
                if op == "count":
                    return len([row for row in rows if isinstance(row, dict)])
                fast_values = []
                for row in rows:
                    if not isinstance(row, dict):
                        continue
                    if isinstance(field_id, str) and field_id:
                        fast_values.append(_get_by_path(row, field_id))
                numeric = [_as_number(value) for value in fast_values]
                if op == "sum":
                    return sum(numeric)
                if op == "avg":
                    return (sum(numeric) / len(numeric)) if numeric else 0
                if op == "min":
                    return min(numeric) if numeric else 0
                if op == "max":
                    return max(numeric) if numeric else 0
    rows = fetch_records(target_entity) or []
    values: list[Any] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        current_record = _enrich_record_for_compute(row, target_entity_def, fetch_record, fetch_entity_def)
        ctx = {"record": current_record, "current": current_record, "parent": parent_record}
        if isinstance(where, dict) and not eval_condition(where, ctx):
            continue
        if op == "count":
            values.append(1)
            continue
        if isinstance(field_id, str) and field_id:
            values.append(_resolve_ref(field_id, ctx))
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


def compute_field_value(
    field: dict,
    record: dict,
    entity_def: dict | None,
    fetch_records: FetchRecords,
    fetch_record: FetchRecord | None = None,
    fetch_entity_def: FetchEntityDef | None = None,
) -> Any:
    compute = field.get("compute") if isinstance(field, dict) else None
    if not isinstance(compute, dict):
        return record.get(field.get("id"))
    if isinstance(compute.get("aggregate"), dict):
        return _compute_aggregate(
            compute.get("aggregate"),
            record,
            entity_def,
            fetch_records,
            fetch_record,
            fetch_entity_def,
        )
    if "expression" in compute:
        enriched_record = _enrich_record_for_compute(record, entity_def, fetch_record, fetch_entity_def)
        return _eval_expression(
            compute.get("expression"),
            {
                "record": enriched_record,
                "current": enriched_record,
                "parent": enriched_record,
            },
        )
    return record.get(field.get("id"))


def recompute_record(
    entity_def: dict,
    record: dict,
    fetch_records: FetchRecords,
    fetch_record: FetchRecord | None = None,
    fetch_entity_def: FetchEntityDef | None = None,
) -> dict:
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
            value = compute_field_value(field, updated, entity_def, fetch_records, fetch_record, fetch_entity_def)
            if updated.get(field_id) != value:
                updated[field_id] = value
                changed = True
        if not changed:
            break
    return updated
