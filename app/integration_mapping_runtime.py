from __future__ import annotations

import importlib
import json
import os
from datetime import date, datetime, timezone
from types import SimpleNamespace
from typing import Any

from condition_eval import eval_condition

from app.stores_db import DbGenericRecordStore


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _today_iso() -> str:
    return date.today().isoformat()


def _get_app_main():
    from app import main as app_main

    app_env = os.getenv("APP_ENV", os.getenv("ENV", "dev")).strip().lower() or "dev"
    if app_env == "dev":
        importlib.invalidate_caches()
        app_main = importlib.reload(app_main)
    return app_main


def _get_entity_def_resolver():
    from app import records_validation

    app_env = os.getenv("APP_ENV", os.getenv("ENV", "dev")).strip().lower() or "dev"
    if app_env == "dev":
        importlib.invalidate_caches()
        records_validation = importlib.reload(records_validation)
    return records_validation.find_entity_def


def _candidate_entity_ids(entity_id: str | None) -> list[str]:
    if not isinstance(entity_id, str) or not entity_id:
        return []
    if entity_id.startswith("entity."):
        return [entity_id, entity_id[7:]]
    return [entity_id, f"entity.{entity_id}"]


def _internal_request() -> object:
    actor = {
        "user_id": "system",
        "id": "system",
        "name": "System",
        "email": None,
        "workspace_role": "admin",
        "platform_role": "superadmin",
    }
    return SimpleNamespace(
        state=SimpleNamespace(cache={}, actor=actor, user=actor),
        headers={},
    )


def _find_entity_context(entity_id: str | None) -> tuple[str, dict, dict] | None:
    if not isinstance(entity_id, str) or not entity_id:
        return None
    app_main = _get_app_main()
    find_entity_def_in_registry = _get_entity_def_resolver()

    class _RegistryProxy:
        def list(self):
            return app_main.registry.list()

    for candidate in _candidate_entity_ids(entity_id):
        found = find_entity_def_in_registry(
            _RegistryProxy(),
            lambda module_id, manifest_hash: app_main.store.get_snapshot(module_id, manifest_hash),
            candidate,
        )
        if isinstance(found, tuple) and len(found) >= 3 and isinstance(found[1], dict) and isinstance(found[2], dict):
            return found[0], found[1], found[2]
    return None


def _get_path_value(payload: Any, path: str) -> Any:
    if not isinstance(path, str) or not path.strip():
        return payload
    current: Any = payload
    for raw_part in path.split("."):
        part = raw_part.strip()
        if not part:
            continue
        while True:
            bracket_index = part.find("[")
            if bracket_index == -1:
                if isinstance(current, dict):
                    current = current.get(part)
                else:
                    return None
                break
            key = part[:bracket_index]
            if key:
                if not isinstance(current, dict):
                    return None
                current = current.get(key)
            end_index = part.find("]", bracket_index)
            if end_index == -1 or not isinstance(current, list):
                return None
            index_text = part[bracket_index + 1 : end_index].strip()
            try:
                list_index = int(index_text)
            except Exception:
                return None
            if list_index < 0:
                list_index = len(current) + list_index
            if list_index < 0 or list_index >= len(current):
                return None
            current = current[list_index]
            part = part[end_index + 1 :]
            if not part:
                break
    return current


def _normalize_field_mappings(field_mappings: Any) -> list[dict]:
    if isinstance(field_mappings, list):
        return [item for item in field_mappings if isinstance(item, dict)]
    if isinstance(field_mappings, dict):
        out = []
        for target_field, spec in field_mappings.items():
            if not isinstance(target_field, str) or not target_field:
                continue
            if isinstance(spec, str):
                out.append({"to": target_field, "path": spec})
            elif isinstance(spec, dict):
                out.append({"to": target_field, **spec})
        return out
    return []


def _value_missing(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (list, tuple, dict, set)):
        return len(value) == 0
    return False


def _coerce_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return False


def _coerce_number(value: Any, *, integer: bool = False) -> Any:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value) if integer else value
    if isinstance(value, str):
        text = value.strip().replace(",", "")
        if not text:
            return None
        try:
            numeric = float(text)
        except Exception:
            return None
        return int(numeric) if integer else numeric
    return None


def _apply_transform(value: Any, transform: str) -> Any:
    name = str(transform or "").strip().lower()
    if not name:
        return value
    if name == "trim":
        return value.strip() if isinstance(value, str) else value
    if name == "lower":
        return value.lower() if isinstance(value, str) else value
    if name == "upper":
        return value.upper() if isinstance(value, str) else value
    if name == "string":
        return "" if value is None else str(value)
    if name == "number":
        return _coerce_number(value, integer=False)
    if name == "integer":
        return _coerce_number(value, integer=True)
    if name == "boolean":
        return _coerce_bool(value)
    if name == "null_if_empty":
        return None if _value_missing(value) else value
    return value


def _resolve_ref(ref: str, source_record: dict, context: dict) -> Any:
    if not isinstance(ref, str) or not ref:
        return None
    if ref == "$today":
        return _today_iso()
    if ref == "$now":
        return _now_iso()
    if ref == "$source":
        return source_record
    if ref.startswith("$source."):
        return _get_path_value(source_record, ref[len("$source.") :])
    if ref == "$connection.id":
        return context.get("connection_id")
    if ref == "$connection.name":
        connection = context.get("connection")
        return connection.get("name") if isinstance(connection, dict) else None
    if ref == "$resource_key":
        return context.get("resource_key")
    if ref.startswith("$context."):
        return _get_path_value(context, ref[len("$context.") :])
    return None


def _resolve_mapping_value(mapping: dict, source_record: dict, context: dict) -> tuple[bool, Any]:
    has_from = isinstance(mapping.get("from"), str) and mapping.get("from")
    has_path = isinstance(mapping.get("path"), str) and mapping.get("path")
    has_ref = isinstance(mapping.get("ref"), str) and mapping.get("ref")
    has_value = "value" in mapping
    supplied = sum([bool(has_from), bool(has_path), bool(has_ref), bool(has_value)])
    if supplied != 1:
        return False, None
    if has_from:
        return True, source_record.get(mapping.get("from"))
    if has_path:
        return True, _get_path_value(source_record, mapping.get("path"))
    if has_ref:
        return True, _resolve_ref(mapping.get("ref"), source_record, context)
    return True, mapping.get("value")


def preview_integration_mapping(mapping_json: dict, source_record: dict, context: dict | None = None) -> dict:
    context = dict(context or {})
    source_record = source_record if isinstance(source_record, dict) else {}
    field_mappings = _normalize_field_mappings(mapping_json.get("field_mappings"))
    values: dict[str, Any] = {}
    errors: list[dict] = []
    skipped: list[dict] = []
    for idx, mapping in enumerate(field_mappings):
        target_field = mapping.get("to")
        if not isinstance(target_field, str) or not target_field:
            errors.append({"code": "MAPPING_TARGET_REQUIRED", "message": "Mapping target field is required", "path": f"field_mappings[{idx}].to"})
            continue
        when = mapping.get("when")
        if isinstance(when, dict):
            try:
              should_run = bool(eval_condition(when, {"record": source_record, "source": source_record, "context": context}))
            except Exception as exc:
              errors.append({"code": "MAPPING_CONDITION_INVALID", "message": str(exc), "path": f"field_mappings[{idx}].when"})
              continue
            if not should_run:
              skipped.append({"to": target_field, "reason": "condition_false"})
              continue
        present, value = _resolve_mapping_value(mapping, source_record, context)
        if not present:
            errors.append({"code": "MAPPING_SOURCE_INVALID", "message": "Use exactly one of from, path, ref, or value", "path": f"field_mappings[{idx}]"})
            continue
        if _value_missing(value) and "default" in mapping:
            value = mapping.get("default")
        transforms = mapping.get("transforms")
        if isinstance(mapping.get("transform"), str) and mapping.get("transform").strip():
            transforms = [mapping.get("transform"), *(transforms if isinstance(transforms, list) else [])]
        if isinstance(transforms, list):
            for transform in transforms:
                if isinstance(transform, str):
                    value = _apply_transform(value, transform)
        if mapping.get("null_if_empty") is True and _value_missing(value):
            value = None
        if _value_missing(value) and mapping.get("skip_if_missing") is True:
            skipped.append({"to": target_field, "reason": "missing_value"})
            continue
        values[target_field] = value
    return {
        "values": values,
        "errors": errors,
        "skipped": skipped,
        "field_count": len(values),
    }


def _iter_all_records(entity_id: str) -> list[dict]:
    store = DbGenericRecordStore()
    records: list[dict] = []
    try:
        rows = store.list(entity_id, limit=1000, offset=0)
        for row in rows if isinstance(rows, list) else []:
            if isinstance(row, dict) and isinstance(row.get("record"), dict):
                records.append(row)
        return records
    except Exception:
        cursor = None
        while True:
            items, next_cursor = store.list_page(entity_id, limit=200, cursor=cursor)
            for row in items if isinstance(items, list) else []:
                if isinstance(row, dict) and isinstance(row.get("record"), dict):
                    records.append(row)
            if not next_cursor:
                break
            cursor = next_cursor
        return records


def _find_match_record(entity_id: str, mapped_values: dict, match_on: list[str]) -> dict | None:
    if not match_on:
        return None
    comparable = {field_id: mapped_values.get(field_id) for field_id in match_on if field_id in mapped_values}
    if len(comparable) != len(match_on):
        return None
    for row in _iter_all_records(entity_id):
        record = row.get("record") if isinstance(row, dict) else None
        if not isinstance(record, dict):
            continue
        if all(record.get(field_id) == value for field_id, value in comparable.items()):
            return row
    return None


def execute_integration_mapping(mapping: dict, source_record: dict, context: dict | None = None) -> dict:
    context = dict(context or {})
    mapping_json = mapping.get("mapping_json") if isinstance(mapping.get("mapping_json"), dict) else {}
    target_entity_id = mapping.get("target_entity")
    if not isinstance(target_entity_id, str) or not target_entity_id.strip():
        raise RuntimeError("Mapping target_entity is required")
    target_ctx = _find_entity_context(target_entity_id)
    if not target_ctx:
        raise RuntimeError("Target entity not found")
    _, target_entity_def, target_manifest = target_ctx
    preview = preview_integration_mapping(mapping_json, source_record if isinstance(source_record, dict) else {}, context)
    if preview["errors"]:
        raise RuntimeError(f"Mapping preview failed: {preview['errors']}")

    values = preview["values"]
    mode = str(mapping_json.get("record_mode") or mapping_json.get("mode") or "create").strip().lower()
    match_on = mapping_json.get("match_on")
    if isinstance(match_on, str):
        match_on = [part.strip() for part in match_on.split(",") if part.strip()]
    if not isinstance(match_on, list):
        match_on = []

    app_main = _get_app_main()
    request = _internal_request()
    workflow = app_main._find_entity_workflow(target_manifest, target_entity_def.get("id"))
    matched = _find_match_record(target_entity_def.get("id"), values, match_on) if mode == "upsert" else None

    if matched:
        existing_record = matched.get("record") or {}
        record_id = matched.get("record_id")
        errors, updated = app_main._validate_patch_payload(target_entity_def, values, existing_record, workflow=workflow)
        if errors:
            raise RuntimeError(f"Mapping update validation failed: {errors}")
        record = app_main._update_record_with_computed_fields(request, target_entity_def.get("id"), target_entity_def, record_id, updated)
        return {
            "mode": "upsert",
            "operation": "updated",
            "record_id": record.get("record_id"),
            "record": record.get("record"),
            "target_entity": target_entity_def.get("id"),
            "preview": preview,
        }

    if mode == "upsert" and mapping_json.get("skip_if_no_match") is True:
        return {
            "mode": "upsert",
            "operation": "skipped",
            "record_id": None,
            "record": None,
            "target_entity": target_entity_def.get("id"),
            "preview": preview,
            "reason": "no_match",
        }

    errors, clean = app_main._validate_record_payload(target_entity_def, values, for_create=True, workflow=workflow)
    lookup_errors = app_main._validate_lookup_fields(
        target_entity_def,
        app_main._registry_for_request(request),
        lambda mod_id, manifest_hash: app_main._get_snapshot(request, mod_id, manifest_hash),
    )
    errors.extend(lookup_errors)
    domain_errors = app_main._enforce_lookup_domains(target_entity_def, clean if isinstance(clean, dict) else {})
    errors.extend(domain_errors)
    if errors:
        raise RuntimeError(f"Mapping create validation failed: {errors}")
    record = app_main._create_record_with_computed_fields(request, target_entity_def.get("id"), target_entity_def, clean)
    return {
        "mode": mode,
        "operation": "created",
        "record_id": record.get("record_id"),
        "record": record.get("record"),
        "target_entity": target_entity_def.get("id"),
        "preview": preview,
    }

