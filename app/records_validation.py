"""Record validation helpers for records_generic."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from app.conditions import eval_condition


def normalize_entity_id(entity_id: str) -> str:
    return entity_id.strip("/").strip()


def entities_from_manifest(manifest: dict) -> list[dict]:
    entities = manifest.get("entities") if isinstance(manifest, dict) else None
    if isinstance(entities, list):
        return entities
    if isinstance(entities, dict):
        items = []
        for ent_id, ent in entities.items():
            if isinstance(ent, dict):
                item = {"id": ent_id, **ent}
            else:
                item = {"id": ent_id}
            items.append(item)
        return items
    return []


def match_entity_id(requested: str, declared: str) -> bool:
    if requested == declared:
        return True
    if declared.startswith("entity.") and requested == declared[len("entity.") :]:
        return True
    if requested.startswith("entity.") and requested[len("entity.") :] == declared:
        return True
    return False


def find_entity_def(registry, get_snapshot, entity_id: str) -> tuple[str, dict, dict] | None:
    entity_id = normalize_entity_id(entity_id)
    modules = registry.list() if hasattr(registry, "list") else []
    for module in modules:
        if not module.get("enabled"):
            continue
        module_id = module.get("module_id")
        manifest_hash = module.get("current_hash")
        if not module_id or not manifest_hash:
            continue
        try:
            manifest = get_snapshot(module_id, manifest_hash)
        except Exception:
            continue
        entities = entities_from_manifest(manifest)
        for ent in entities:
            ent_id = ent.get("id")
            if ent_id and match_entity_id(entity_id, ent_id):
                return (module_id, ent, manifest)
    return None


def enum_values(field: dict) -> list:
    options = field.get("options") or field.get("values") or []
    values = []
    for opt in options:
        if isinstance(opt, dict) and "value" in opt:
            values.append(opt["value"])
        else:
            values.append(opt)
    return values


def is_uuid(value: str) -> bool:
    try:
        uuid.UUID(str(value))
        return True
    except Exception:
        return False


def _apply_defaults(field_by_id: dict, data: dict) -> dict:
    updated = dict(data)
    for field_id, field in field_by_id.items():
        if "default" not in field:
            continue
        if field_id in updated and updated.get(field_id) not in (None, ""):
            continue
        updated[field_id] = field.get("default")
    return updated


def _match_entity_id_value(requested: str, declared: str) -> bool:
    if requested == declared:
        return True
    if declared.startswith("entity.") and requested == declared[len("entity.") :]:
        return True
    if requested.startswith("entity.") and requested[len("entity.") :] == declared:
        return True
    return False


def find_entity_workflow(manifest: dict, entity_id: str) -> dict | None:
    workflows = manifest.get("workflows") if isinstance(manifest, dict) else None
    if not isinstance(workflows, list):
        return None
    for wf in workflows:
        if not isinstance(wf, dict):
            continue
        wf_entity = wf.get("entity")
        if isinstance(wf_entity, str) and _match_entity_id_value(entity_id, wf_entity):
            return wf
    return None


def _workflow_required_fields(workflow: dict, status_value: str | None) -> list[str]:
    if not workflow or not status_value:
        return []
    required = []
    for state in workflow.get("states") or []:
        if not isinstance(state, dict):
            continue
        if state.get("id") == status_value:
            fields = state.get("required_fields")
            if isinstance(fields, list):
                required.extend([f for f in fields if isinstance(f, str)])
    required_map = workflow.get("required_fields_by_state")
    if isinstance(required_map, dict):
        fields = required_map.get(status_value)
        if isinstance(fields, list):
            required.extend([f for f in fields if isinstance(f, str)])
    return list(dict.fromkeys(required))


def validate_record_payload(entity: dict, data: dict, for_create: bool, workflow: dict | None = None) -> tuple[list[dict], dict]:
    errors: list[dict] = []
    if not isinstance(data, dict):
        return [
            {
                "code": "INVALID_PAYLOAD",
                "message": "Record data must be an object",
                "path": None,
                "detail": None,
            }
        ], {}
    fields = entity.get("fields") or []
    if isinstance(fields, dict):
        field_list = []
        for field_id, field_def in fields.items():
            if isinstance(field_def, dict):
                field_list.append({"id": field_id, **field_def})
            else:
                field_list.append({"id": field_id})
        fields = field_list
    field_by_id = {f.get("id"): f for f in fields if f.get("id")}

    def _add_error(code: str, message: str, path: str | None = None, detail: dict | None = None):
        errors.append({"code": code, "message": message, "path": path, "detail": detail})

    for key in data.keys():
        if key == "id":
            continue
        if key not in field_by_id:
            _add_error("UNKNOWN_FIELD", f"Unknown field: {key}", path=key)

    if for_create:
        data = _apply_defaults(field_by_id, data)
        for field_id, field in field_by_id.items():
            if field.get("required"):
                val = data.get(field_id)
                if val is None or val == "":
                    _add_error("REQUIRED_FIELD", f"Missing required field: {field_id}", path=field_id)
            required_when = field.get("required_when")
            if required_when:
                try:
                    if eval_condition(required_when, {"record": data}):
                        val = data.get(field_id)
                        if val is None or val == "":
                            _add_error("REQUIRED_FIELD", f"Missing required field: {field_id}", path=field_id)
                except Exception:
                    _add_error("REQUIRED_FIELD", f"Missing required field: {field_id}", path=field_id)

    if workflow:
        status_field = workflow.get("status_field")
        status_value = data.get(status_field) if isinstance(status_field, str) else None
        states = [s.get("id") for s in workflow.get("states") or [] if isinstance(s, dict)]
        if status_field and status_value is not None and status_value not in states:
            _add_error("INVALID_STATUS", f"{status_field} must be one of {states}", path=status_field)
        required_by_state = _workflow_required_fields(workflow, status_value)
        for field_id in required_by_state:
            val = data.get(field_id)
            if val is None or val == "":
                _add_error("REQUIRED_FIELD", f"Missing required field for status {status_value}: {field_id}", path=field_id)

    if not for_create:
        for field_id, field in field_by_id.items():
            required_when = field.get("required_when")
            if required_when:
                try:
                    if eval_condition(required_when, {"record": data}):
                        val = data.get(field_id)
                        if val is None or val == "":
                            _add_error("REQUIRED_FIELD", f"Missing required field: {field_id}", path=field_id)
                except Exception:
                    _add_error("REQUIRED_FIELD", f"Missing required field: {field_id}", path=field_id)

    for field_id, val in data.items():
        if field_id == "id":
            continue
        field = field_by_id.get(field_id)
        if not field:
            continue
        ftype = field.get("type")
        if val is None:
            continue
        if ftype in ("string", "text"):
            if not isinstance(val, str):
                _add_error("TYPE_MISMATCH", f"{field_id} must be a string", path=field_id)
        elif ftype == "number":
            if not isinstance(val, (int, float)) or isinstance(val, bool):
                _add_error("TYPE_MISMATCH", f"{field_id} must be a number", path=field_id)
        elif ftype == "boolean" or ftype == "bool":
            if not isinstance(val, bool):
                _add_error("TYPE_MISMATCH", f"{field_id} must be a boolean", path=field_id)
        elif ftype == "enum":
            allowed = enum_values(field)
            if val not in allowed:
                _add_error("INVALID_ENUM", f"{field_id} must be one of {allowed}", path=field_id)
        elif ftype == "date":
            if not isinstance(val, str):
                _add_error("TYPE_MISMATCH", f"{field_id} must be a date string", path=field_id)
            else:
                try:
                    date.fromisoformat(val)
                except Exception:
                    _add_error("INVALID_DATE", f"{field_id} must be YYYY-MM-DD", path=field_id)
        elif ftype == "datetime":
            if not isinstance(val, str):
                _add_error("TYPE_MISMATCH", f"{field_id} must be a datetime string", path=field_id)
            else:
                try:
                    datetime.fromisoformat(val.replace("Z", "+00:00"))
                except Exception:
                    _add_error("INVALID_DATETIME", f"{field_id} must be ISO8601", path=field_id)
        elif ftype == "uuid":
            if not isinstance(val, str) or not is_uuid(val):
                _add_error("TYPE_MISMATCH", f"{field_id} must be a UUID", path=field_id)
        elif ftype == "lookup":
            if not isinstance(val, str):
                _add_error("TYPE_MISMATCH", f"{field_id} must be a string", path=field_id)
        elif ftype == "tags":
            if not isinstance(val, list):
                _add_error("TYPE_MISMATCH", f"{field_id} must be a list", path=field_id)
        # ignore unknown types for now

    return errors, data


def validate_lookup_fields(entity: dict, registry, get_snapshot) -> list[dict]:
    errors: list[dict] = []
    fields = entity.get("fields") or []
    if isinstance(fields, dict):
        fields = [{"id": fid, **fdef} if isinstance(fdef, dict) else {"id": fid} for fid, fdef in fields.items()]

    for field in fields:
        if not isinstance(field, dict) or field.get("type") != "lookup":
            continue
        field_id = field.get("id")
        target = field.get("entity")
        display = field.get("display_field")
        if not isinstance(target, str) or not target:
            errors.append({"code": "LOOKUP_TARGET_MISSING", "message": "lookup target entity is required", "path": field_id, "detail": None})
            continue
        if not isinstance(display, str) or not display:
            errors.append({"code": "LOOKUP_DISPLAY_MISSING", "message": "lookup display_field is required", "path": field_id, "detail": None})
            continue
        found = find_entity_def(registry, get_snapshot, target)
        if not found:
            errors.append({"code": "LOOKUP_TARGET_UNKNOWN", "message": "lookup target entity not found or disabled", "path": field_id, "detail": None})
            continue
        _, target_entity, _ = found
        target_fields = target_entity.get("fields") or []
        if isinstance(target_fields, dict):
            target_fields = [{"id": fid, **fdef} if isinstance(fdef, dict) else {"id": fid} for fid, fdef in target_fields.items()]
        target_field_ids = {f.get("id") for f in target_fields if isinstance(f, dict)}
        if display not in target_field_ids:
            errors.append({"code": "LOOKUP_DISPLAY_UNKNOWN", "message": "lookup display_field not found on target entity", "path": field_id, "detail": None})
    return errors
