from __future__ import annotations

import math
import os
import json
import logging
import httpx
import sys
import time
import traceback
import uuid
import importlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from condition_eval import eval_condition

def _load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_env_file(ROOT / "app" / ".env")

from app.email import get_provider, render_template
from app.integration_mapping_runtime import execute_integration_mapping
from app.integrations_runtime import execute_connection_request, execute_connection_sync
from app.secrets import SecretStoreError
from app.secrets import resolve_secret
from app.stores import MemoryAutomationStore, MemoryJobStore
from app.stores_db import (
    DbAttachmentStore,
    DbChatterStore,
    DbConnectionStore,
    DbDocTemplateStore,
    DbEmailStore,
    DbExternalWebhookSubscriptionStore,
    DbGenericRecordStore,
    DbIntegrationMappingStore,
    DbIntegrationRequestLogStore,
    DbIntegrationWebhookStore,
    DbJobStore,
    DbNotificationStore,
    DbAutomationStore,
    DbSyncCheckpointStore,
    DbWebhookEventStore,
    get_org_id,
    set_org_id,
    reset_org_id,
)
from app.webhook_signing import build_webhook_signature_headers


logger = logging.getLogger("octo.worker")


def _get_attachment_helpers():
    from app.attachments import delete_storage, read_bytes, store_bytes

    return store_bytes, read_bytes, delete_storage


def _get_doc_render_helpers():
    from app.doc_render import normalize_margins, render_html, render_pdf

    return render_html, render_pdf, normalize_margins


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
    find_entity_def_in_registry = records_validation.find_entity_def

    return find_entity_def_in_registry


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _backoff_seconds(attempt: int) -> int:
    return min(60 * (2 ** max(0, attempt - 1)), 3600)


def _entity_id_matches(left: str | None, right: str | None) -> bool:
    if not isinstance(left, str) or not isinstance(right, str):
        return False
    if left == right:
        return True
    if left.startswith("entity.") and left[7:] == right:
        return True
    if right.startswith("entity.") and right[7:] == left:
        return True
    return False


def _extract_attachment_refs(value: object) -> list[dict]:
    if value is None:
        return []
    if isinstance(value, list):
        items: list[dict] = []
        for item in value:
            items.extend(_extract_attachment_refs(item))
        return items
    if isinstance(value, dict):
        return [value]
    if isinstance(value, str) and value:
        return [{"id": value}]
    return []


def _attachment_item(attachment: dict) -> dict:
    return {
        "id": attachment.get("id"),
        "filename": attachment.get("filename"),
        "mime_type": attachment.get("mime_type"),
        "size": attachment.get("size"),
        "storage_key": attachment.get("storage_key"),
    }


def _find_documentable_attachment_field(manifest: dict | None, entity_id: str | None) -> str | None:
    if not isinstance(manifest, dict) or not isinstance(entity_id, str) or not entity_id:
        return None
    interfaces = manifest.get("interfaces")
    if not isinstance(interfaces, dict):
        return None
    items = interfaces.get("documentable")
    if not isinstance(items, list):
        return None
    for item in items:
        if not isinstance(item, dict):
            continue
        if item.get("enabled") is False:
            continue
        if not _entity_id_matches(item.get("entity_id"), entity_id):
            continue
        attachment_field = item.get("attachment_field")
        if isinstance(attachment_field, str) and attachment_field:
            return attachment_field
    return None


def _sync_attachment_field(records: DbGenericRecordStore, entity_id: str, record_id: str, record_data: dict, attachment_field: str | None, attachment: dict) -> None:
    if not isinstance(attachment_field, str) or not attachment_field:
        return
    existing_items = _extract_attachment_refs(record_data.get(attachment_field))
    attachment_id = attachment.get("id")
    if isinstance(attachment_id, str) and any(item.get("id") == attachment_id for item in existing_items if isinstance(item, dict)):
        return
    updated_record = dict(record_data)
    updated_record[attachment_field] = [*existing_items, _attachment_item(attachment)]
    records.update(entity_id, record_id, updated_record)


def _resolve_linked_attachments(
    attach_store: DbAttachmentStore,
    *,
    entity_id: str | None,
    record_id: str | None,
    purpose: str | None = None,
    attachment_ids: object = None,
    record_data: dict | None = None,
    attachment_field: str | None = None,
) -> list[dict]:
    refs: list[dict] = []
    refs.extend(_extract_attachment_refs(attachment_ids))
    if isinstance(record_data, dict) and isinstance(attachment_field, str) and attachment_field:
        refs.extend(_extract_attachment_refs(record_data.get(attachment_field)))
    if isinstance(entity_id, str) and entity_id and isinstance(record_id, str) and record_id and isinstance(purpose, str) and purpose:
        for link in attach_store.list_links(entity_id, record_id, purpose):
            if isinstance(link, dict) and link.get("attachment_id"):
                refs.append({"id": link.get("attachment_id")})
    resolved: list[dict] = []
    seen: set[str] = set()
    for ref in refs:
        if not isinstance(ref, dict):
            continue
        attachment_id = ref.get("id") or ref.get("attachment_id")
        if not isinstance(attachment_id, str) or not attachment_id or attachment_id in seen:
            continue
        attachment = attach_store.get_attachment(attachment_id)
        if not isinstance(attachment, dict):
            continue
        seen.add(attachment_id)
        resolved.append(attachment)
    return resolved


def _load_outbox_attachments(outbox: dict, org_id: str) -> list[dict]:
    if not isinstance(outbox, dict):
        return []
    _, read_bytes, _ = _get_attachment_helpers()
    attach_store = DbAttachmentStore()
    resolved: list[dict] = []
    for item in outbox.get("attachments_json") or []:
        if not isinstance(item, dict):
            continue
        attachment = None
        attachment_id = item.get("attachment_id")
        if isinstance(attachment_id, str) and attachment_id:
            attachment = attach_store.get_attachment(attachment_id)
        if not isinstance(attachment, dict):
            attachment = item
        storage_key = attachment.get("storage_key")
        if not isinstance(storage_key, str) or not storage_key:
            continue
        try:
            data = read_bytes(org_id, storage_key)
        except Exception:
            continue
        resolved.append(
            {
                "id": attachment.get("id") or attachment_id,
                "filename": attachment.get("filename") or item.get("filename") or "attachment",
                "mime_type": attachment.get("mime_type") or item.get("mime_type") or "application/octet-stream",
                "data": data,
            }
        )
    return resolved


def _handle_email_send(job: dict, org_id: str) -> None:
    email_store = DbEmailStore()
    conn_store = DbConnectionStore()
    payload = job.get("payload") or {}
    outbox_id = payload.get("outbox_id")
    connection_id = payload.get("connection_id")
    if not outbox_id:
        raise RuntimeError("Missing outbox_id")
    outbox = email_store.get_outbox(outbox_id)
    if not outbox:
        raise RuntimeError("Outbox not found")
    connection = conn_store.get(connection_id) if connection_id else conn_store.get_default_email()
    if not connection:
        raise RuntimeError("Email connection not found")
    provider = get_provider(connection.get("type"))
    result = provider.send(
        {
            "to": outbox.get("to") or [],
            "cc": outbox.get("cc") or [],
            "bcc": outbox.get("bcc") or [],
            "from_email": outbox.get("from_email"),
            "reply_to": outbox.get("reply_to"),
            "subject": outbox.get("subject"),
            "body_html": outbox.get("body_html"),
            "body_text": outbox.get("body_text"),
            "attachments": _load_outbox_attachments(outbox, org_id),
        },
        connection,
        connection.get("secret_ref"),
        org_id,
    )
    email_store.update_outbox(
        outbox_id,
        {
            "status": "sent",
            "provider_message_id": result.get("MessageID") or result.get("id"),
            "sent_at": _now().strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
    )


def _handle_doc_generate(job: dict, org_id: str) -> None:
    render_html, render_pdf, normalize_margins = _get_doc_render_helpers()
    store_bytes, _, _ = _get_attachment_helpers()
    app_main = _get_app_main()
    find_entity_def_in_registry = _get_entity_def_resolver()
    doc_store = DbDocTemplateStore()
    attach_store = DbAttachmentStore()
    records = DbGenericRecordStore()
    payload = job.get("payload") or {}
    template_id = payload.get("template_id")
    entity_id = payload.get("entity_id")
    record_id = payload.get("record_id")
    purpose = payload.get("purpose") or "default"
    if not (template_id and entity_id and record_id):
        raise RuntimeError("Missing template_id/entity_id/record_id")
    template = doc_store.get(template_id)
    if not template:
        raise RuntimeError("Template not found")
    record = records.get(entity_id, record_id)
    if not record:
        raise RuntimeError("Record not found")
    class _RegistryProxy:
        def list(self):
            return app_main.registry.list()

    found = find_entity_def_in_registry(
        _RegistryProxy(),
        lambda module_id, manifest_hash: app_main.store.get_snapshot(module_id, manifest_hash),
        entity_id,
    )
    entity_def = found[1] if found else None
    record_data = record.get("record") or {}
    context = app_main._build_template_render_context(
        record_data,
        entity_def,
        entity_id,
        app_main._branding_context_for_org(org_id),
        localization=app_main._localization_context_for_actor(None),
    )
    html = render_html(template.get("html") or "", context)
    filename_pattern = template.get("filename_pattern") or template.get("name") or "document"
    filename = render_template(filename_pattern, context, strict=True)
    header_html = template.get("header_html") or ""
    footer_html = template.get("footer_html") or ""
    if header_html:
        header_html = render_template(header_html, context, strict=True)
    if footer_html:
        footer_html = render_template(footer_html, context, strict=True)
    margins = {
        "top": template.get("margin_top") or "12mm",
        "right": template.get("margin_right") or "12mm",
        "bottom": template.get("margin_bottom") or "12mm",
        "left": template.get("margin_left") or "12mm",
    }
    margins = normalize_margins(margins)
    paper_size = template.get("paper_size") or "A4"
    pdf_bytes = render_pdf(
        html,
        paper_size=paper_size,
        margins=margins,
        header_html=header_html,
        footer_html=footer_html,
    )
    stored = store_bytes(org_id, f"{filename}.pdf", pdf_bytes)
    attachment = attach_store.create_attachment(
        {
            "filename": f"{filename}.pdf",
            "mime_type": "application/pdf",
            "size": stored["size"],
            "storage_key": stored["storage_key"],
            "sha256": stored["sha256"],
            "created_by": "worker",
            "source": "generated",
        }
    )
    attach_store.link(
        {
            "attachment_id": attachment.get("id"),
            "entity_id": entity_id,
            "record_id": record_id,
            "purpose": f"template:{template_id}",
        }
    )
    if purpose and purpose != "default":
        attach_store.link(
            {
                "attachment_id": attachment.get("id"),
                "entity_id": entity_id,
                "record_id": record_id,
                "purpose": purpose,
            }
        )
    attachment_field = _find_documentable_attachment_field(found[2] if isinstance(found, tuple) and len(found) >= 3 else None, entity_id)
    _sync_attachment_field(records, entity_id, record_id, record_data, attachment_field, attachment)


def _handle_attachments_cleanup(job: dict, org_id: str) -> None:
    _, delete_storage = _get_attachment_helpers()
    attach_store = DbAttachmentStore()
    payload = job.get("payload") or {}
    source = payload.get("source") or "preview"
    hours = payload.get("older_than_hours") or 24
    limit = payload.get("limit") or 200
    try:
        hours_val = int(hours)
    except Exception:
        hours_val = 24
    cutoff = (_now() - timedelta(hours=hours_val)).strftime("%Y-%m-%dT%H:%M:%SZ")
    deleted = attach_store.delete_by_source_before(source, cutoff, limit=int(limit))
    for item in deleted:
        storage_key = item.get("storage_key")
        if storage_key:
            delete_storage(org_id, storage_key)


def _lookup_path(ctx: dict, path: str) -> object:
    current: object = ctx
    for part in path.split("."):
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current


def _lookup_nested_path(value: object, path: str) -> object:
    current = value
    for part in str(path or "").split("."):
        key = part.strip()
        if not key:
            return None
        if isinstance(current, list):
            if not key.isdigit():
                return None
            index = int(key)
            if index < 0 or index >= len(current):
                return None
            current = current[index]
            continue
        if isinstance(current, dict):
            if key not in current:
                return None
            current = current[key]
            continue
        return None
    return current


def _resolve_raw_template_ref(value: str, ctx: dict) -> object:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    if not (stripped.startswith("{{") and stripped.endswith("}}")):
        return None
    inner = stripped[2:-2].strip()
    if not inner or any(token in inner for token in ("|", "(", ")", "[", "]", "{", "}", "+", "-", "*", "/", "~", ",")):
        return None
    return _lookup_path(ctx, inner)


def _resolve_value(value: object, ctx: dict) -> object:
    if isinstance(value, dict) and set(value.keys()) == {"var"}:
        var_name = value.get("var")
        if isinstance(var_name, str):
            return _lookup_path(ctx, var_name)
    if isinstance(value, str):
        raw_ref = _resolve_raw_template_ref(value, ctx)
        if raw_ref is not None:
            return raw_ref
    if isinstance(value, list):
        return [_resolve_value(item, ctx) for item in value]
    if isinstance(value, dict):
        return {key: _resolve_value(val, ctx) for key, val in value.items()}
    if isinstance(value, str) and "{{" in value:
        return render_template(value, ctx, strict=True)
    return value


def _resolve_inputs(inputs: dict | None, ctx: dict) -> dict:
    if not isinstance(inputs, dict):
        return {}
    return {key: _resolve_value(val, ctx) for key, val in inputs.items()}


def _resolve_step_value(value: object, ctx: dict) -> object:
    return _resolve_value(value, ctx)


def _coerce_json_like_value(value: object) -> object:
    if not isinstance(value, str):
        return value
    raw = value.strip()
    if not raw:
        return value
    if (raw.startswith("{") and raw.endswith("}")) or (raw.startswith("[") and raw.endswith("]")):
        try:
            return json.loads(raw)
        except Exception:
            return value
    return value


def _resolve_integration_mapping_source(inputs: dict, ctx: dict) -> object:
    source_value = inputs.get("source_record")
    source_value = _coerce_json_like_value(source_value)
    if source_value in (None, ""):
        for fallback_path in ("trigger.payload", "last.body_json", "last", "trigger.record"):
            source_value = _lookup_path(ctx, fallback_path)
            if source_value not in (None, ""):
                break
    source_path = inputs.get("source_path")
    if isinstance(source_path, str) and source_path.strip():
        source_value = _lookup_nested_path(source_value, source_path.strip())
    return source_value


def _coerce_iteration_items(value: object) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        records = value.get("records")
        if isinstance(records, list):
            return records
        items = value.get("items")
        if isinstance(items, list):
            return items
    return []


def _coerce_list(value: object) -> list:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _split_recipients(value: object) -> list[str]:
    out: list[str] = []
    for item in _coerce_list(value):
        if item is None:
            continue
        if isinstance(item, list):
            out.extend(_split_recipients(item))
            continue
        if isinstance(item, str):
            parts = [p.strip() for p in item.replace(";", ",").split(",")]
            out.extend([p for p in parts if p])
        else:
            text = str(item).strip()
            if text:
                out.append(text)
    return out


def _dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for val in values:
        key = val.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(val)
    return out


def _candidate_entity_ids(entity_id: str | None) -> list[str]:
    if not isinstance(entity_id, str) or not entity_id:
        return []
    if entity_id.startswith("entity."):
        return [entity_id, entity_id[7:]]
    return [entity_id, f"entity.{entity_id}"]


def _fetch_record_payload(entity_id: str | None, record_id: str | None) -> dict:
    if not (isinstance(entity_id, str) and entity_id and isinstance(record_id, str) and record_id):
        return {}
    store = DbGenericRecordStore()
    for candidate in _candidate_entity_ids(entity_id):
        record = store.get(candidate, record_id)
        if not isinstance(record, dict):
            continue
        data = record.get("record")
        if isinstance(data, dict):
            return data
    return {}


def _find_entity_def(entity_id: str | None) -> dict | None:
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
        if isinstance(found, tuple) and len(found) >= 2 and isinstance(found[1], dict):
            return found[1]
    return None


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


def _find_existing_record(entity_id: str | None, record_id: str | None) -> tuple[str, dict] | None:
    if not (isinstance(entity_id, str) and entity_id and isinstance(record_id, str) and record_id):
        return None
    store = DbGenericRecordStore()
    for candidate in _candidate_entity_ids(entity_id):
        record = store.get(candidate, record_id)
        if isinstance(record, dict) and isinstance(record.get("record"), dict):
            return candidate, record
    return None


def _find_field_def(entity_def: dict | None, field_id: str | None) -> dict | None:
    if not isinstance(entity_def, dict) or not isinstance(field_id, str) or not field_id:
        return None
    fields = entity_def.get("fields")
    if not isinstance(fields, list):
        return None
    for field in fields:
        if isinstance(field, dict) and field.get("id") == field_id:
            return field
    return None


def _system_actor() -> dict:
    return {
        "user_id": "system",
        "id": "system",
        "name": "System",
        "email": None,
        "workspace_role": "admin",
        "platform_role": "superadmin",
    }


def _internal_request() -> object:
    from types import SimpleNamespace

    actor = _system_actor()
    return SimpleNamespace(
        state=SimpleNamespace(cache={}, actor=actor, user=actor),
        headers={},
    )


def _coerce_json_object(value: object, field_name: str) -> dict:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
        except Exception as exc:
            raise RuntimeError(f"{field_name} must be valid JSON object") from exc
        if isinstance(parsed, dict):
            return parsed
    raise RuntimeError(f"{field_name} object required")


def _emit_automation_event(event_type: str, payload: dict) -> None:
    from event_bus import make_event

    app_main = _get_app_main()
    meta = {
        "module_id": "__automation__",
        "manifest_hash": "automation",
        "actor": {"id": "system", "name": "System"},
        "org_id": get_org_id(),
        "trace_id": None,
    }
    emitted = make_event(event_type, {"event": event_type, **(payload or {})}, meta)
    app_main._handle_automation_event(emitted)
    try:
        app_main._emit_external_webhook_subscriptions(event_type, {"event": event_type, **(payload or {})}, meta)
    except Exception:
        pass


def _mapping_matches_resource(mapping: dict, resource_key: str | None) -> bool:
    mapping_json = mapping.get("mapping_json") if isinstance(mapping.get("mapping_json"), dict) else {}
    configured = mapping_json.get("resource_key")
    if not isinstance(configured, str) or not configured.strip():
        return True
    actual = str(resource_key or "").strip()
    return configured.strip() == actual


def _apply_connection_mappings(connection: dict, *, resource_key: str | None, items: list, source: str) -> dict:
    connection_id = str(connection.get("id") or "")
    if not connection_id or not isinstance(items, list) or not items:
        return {"count": 0, "created": 0, "updated": 0, "skipped": 0, "failed": 0, "results": []}
    mapping_store = DbIntegrationMappingStore()
    mappings = [
        mapping
        for mapping in (mapping_store.list(connection_id=connection_id) or [])
        if isinstance(mapping, dict) and _mapping_matches_resource(mapping, resource_key)
    ]
    if not mappings:
        return {"count": 0, "created": 0, "updated": 0, "skipped": 0, "failed": 0, "results": []}
    results: list[dict] = []
    created = 0
    updated = 0
    skipped = 0
    failed = 0
    for item_index, item in enumerate(items):
        if not isinstance(item, dict):
            continue
        for mapping in mappings:
            mapping_id = mapping.get("id")
            try:
                result = execute_integration_mapping(
                    mapping,
                    item,
                    {
                        "connection_id": connection_id,
                        "resource_key": resource_key,
                        "connection": connection,
                        "source": source,
                        "item_index": item_index,
                    },
                )
                op = result.get("operation")
                if op == "created":
                    created += 1
                elif op == "updated":
                    updated += 1
                elif op == "skipped":
                    skipped += 1
                result_payload = {
                    "mapping_id": mapping_id,
                    "mapping_name": mapping.get("name"),
                    "item_index": item_index,
                    **result,
                }
                results.append(result_payload)
                _emit_automation_event(
                    "integration.mapping.applied",
                    {
                        "connection_id": connection_id,
                        "mapping_id": mapping_id,
                        "mapping_name": mapping.get("name"),
                        "resource_key": resource_key,
                        "item_index": item_index,
                        "operation": op,
                        "target_entity": result.get("target_entity"),
                        "record_id": result.get("record_id"),
                        "source": source,
                    },
                )
            except Exception as exc:
                failed += 1
                error_message = str(exc)
                results.append(
                    {
                        "mapping_id": mapping_id,
                        "mapping_name": mapping.get("name"),
                        "item_index": item_index,
                        "operation": "failed",
                        "error": error_message,
                    }
                )
                _emit_automation_event(
                    "integration.mapping.failed",
                    {
                        "connection_id": connection_id,
                        "mapping_id": mapping_id,
                        "mapping_name": mapping.get("name"),
                        "resource_key": resource_key,
                        "item_index": item_index,
                        "error": error_message,
                        "source": source,
                    },
                )
    return {
        "count": len(results),
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "failed": failed,
        "results": results,
    }


def _run_integration_sync(connection: dict, sync_config: dict | None, *, source: str) -> dict:
    connection_id = str(connection.get("id") or "")
    if not connection_id:
        raise RuntimeError("Connection id required")
    resolved_sync = dict(sync_config or {})
    scope_key = str(
        resolved_sync.get("scope_key")
        or resolved_sync.get("resource_key")
        or ((connection.get("config") or {}).get("sync") or {}).get("scope_key")
        or ((connection.get("config") or {}).get("sync") or {}).get("resource_key")
        or "default"
    ).strip() or "default"
    checkpoint_store = DbSyncCheckpointStore()
    request_log_store = DbIntegrationRequestLogStore()
    connection_store = DbConnectionStore()
    checkpoint = checkpoint_store.get(connection_id, scope_key)
    checkpoint_store.upsert(
        {
            "connection_id": connection_id,
            "scope_key": scope_key,
            "cursor_value": checkpoint.get("cursor_value") if isinstance(checkpoint, dict) else None,
            "cursor_json": checkpoint.get("cursor_json") if isinstance(checkpoint, dict) else {},
            "last_synced_at": checkpoint.get("last_synced_at") if isinstance(checkpoint, dict) else None,
            "status": "running",
            "last_error": None,
        }
    )
    try:
        result = execute_connection_sync(connection, resolved_sync, get_org_id(), checkpoint=checkpoint)
        request_log_store.create(
            {
                "connection_id": connection_id,
                "source": source,
                "direction": "outbound",
                "method": result.get("method"),
                "url": result.get("url"),
                "request_headers_json": result.get("request_headers") or {},
                "request_query_json": result.get("request_query") or {},
                "request_body_json": result.get("request_body_json"),
                "request_body_text": result.get("request_body_text"),
                "response_status": result.get("status_code"),
                "response_headers_json": result.get("headers") or {},
                "response_body_json": result.get("body_json"),
                "response_body_text": result.get("body_text"),
                "ok": result.get("ok"),
                "error_message": None if result.get("ok") else f"HTTP {result.get('status_code')}",
            }
        )
        if not result.get("ok"):
            raise RuntimeError(f"Integration sync failed with status {result.get('status_code')}")
        checkpoint_payload = result.get("checkpoint") if isinstance(result.get("checkpoint"), dict) else {}
        synced_at = _now().strftime("%Y-%m-%dT%H:%M:%SZ")
        checkpoint_store.upsert(
            {
                "connection_id": connection_id,
                "scope_key": str(checkpoint_payload.get("scope_key") or scope_key),
                "cursor_value": checkpoint_payload.get("cursor_value"),
                "cursor_json": checkpoint_payload.get("cursor_json") or {},
                "last_synced_at": synced_at,
                "status": "idle",
                "last_error": None,
            }
        )
        connection_store.update(
            connection_id,
            {
                "health_status": "ok",
                "last_success_at": synced_at,
                "last_error": None,
            },
        )
        emit_events = bool(resolved_sync.get("emit_events") or (((connection.get("config") or {}).get("sync") or {}).get("emit_events")))
        resource_key = result.get("resource_key") or scope_key
        items = result.get("items") if isinstance(result.get("items"), list) else []
        mapping_summary = _apply_connection_mappings(connection, resource_key=resource_key, items=items, source=source)
        completed_payload = {
            "connection_id": connection_id,
            "scope_key": scope_key,
            "resource_key": resource_key,
            "item_count": len(items),
            "next_cursor": result.get("next_cursor"),
            "status_code": result.get("status_code"),
            "source": source,
            "mapping_summary": {
                "count": mapping_summary.get("count"),
                "created": mapping_summary.get("created"),
                "updated": mapping_summary.get("updated"),
                "skipped": mapping_summary.get("skipped"),
                "failed": mapping_summary.get("failed"),
            },
        }
        _emit_automation_event("integration.sync.completed", completed_payload)
        if emit_events:
            for item_index, item in enumerate(items):
                item_payload = {
                    "connection_id": connection_id,
                    "scope_key": scope_key,
                    "resource_key": resource_key,
                    "item_index": item_index,
                    "item": item,
                    "source": source,
                }
                _emit_automation_event("integration.sync.item", item_payload)
                if isinstance(resource_key, str) and resource_key.strip():
                    _emit_automation_event(f"integration.sync.{resource_key.strip()}.item", item_payload)
        return {**result, "mapping_summary": mapping_summary}
    except Exception as exc:
        error_message = str(exc)
        checkpoint_store.upsert(
            {
                "connection_id": connection_id,
                "scope_key": scope_key,
                "cursor_value": checkpoint.get("cursor_value") if isinstance(checkpoint, dict) else None,
                "cursor_json": checkpoint.get("cursor_json") if isinstance(checkpoint, dict) else {},
                "last_synced_at": checkpoint.get("last_synced_at") if isinstance(checkpoint, dict) else None,
                "status": "error",
                "last_error": error_message,
            }
        )
        connection_store.update(
            connection_id,
            {
                "health_status": "error",
                "last_tested_at": _now().strftime("%Y-%m-%dT%H:%M:%SZ"),
                "last_error": error_message,
            },
        )
        request_log_store.create(
            {
                "connection_id": connection_id,
                "source": source,
                "direction": "outbound",
                "method": (resolved_sync.get("request") or {}).get("method"),
                "url": (resolved_sync.get("request") or {}).get("url") or (resolved_sync.get("request") or {}).get("path"),
                "request_headers_json": ((resolved_sync.get("request") or {}).get("headers") or {}),
                "request_query_json": ((resolved_sync.get("request") or {}).get("query") or {}),
                "request_body_json": (resolved_sync.get("request") or {}).get("json"),
                "request_body_text": (resolved_sync.get("request") or {}).get("body"),
                "ok": False,
                "error_message": error_message,
            }
        )
        _emit_automation_event(
            "integration.sync.failed",
            {
                "connection_id": connection_id,
                "scope_key": scope_key,
                "source": source,
                "error": error_message,
            },
        )
        raise


def _run_generic_create_record(inputs: dict, ctx: dict) -> dict:
    app_main = _get_app_main()
    request = _internal_request()
    entity_id = inputs.get("entity_id") or _lookup_path(ctx, "trigger.entity_id")
    if not isinstance(entity_id, str) or not entity_id:
        raise RuntimeError("entity_id required")
    entity_ctx = _find_entity_context(entity_id)
    if not entity_ctx:
        raise RuntimeError("Entity not found")
    module_id, entity_def, manifest = entity_ctx
    values = _coerce_json_object(inputs.get("values"), "values")
    workflow = app_main._find_entity_workflow(manifest, entity_def.get("id"))
    errors, clean = app_main._validate_record_payload(entity_def, values, for_create=True, workflow=workflow)
    lookup_errors = app_main._validate_lookup_fields(
        entity_def,
        app_main._registry_for_request(request),
        lambda mod_id, manifest_hash: app_main._get_snapshot(request, mod_id, manifest_hash),
    )
    errors.extend(lookup_errors)
    domain_errors = app_main._enforce_lookup_domains(entity_def, clean if isinstance(clean, dict) else {})
    errors.extend(domain_errors)
    if errors:
        raise RuntimeError(f"Record create validation failed: {errors}")
    record = app_main._create_record_with_computed_fields(request, entity_def.get("id"), entity_def, clean)
    record_id = record.get("record_id")
    record_data = record.get("record") if isinstance(record, dict) else None
    if isinstance(record_id, str):
        app_main._add_chatter_entry(entity_def.get("id"), record_id, "system", "Record created", _system_actor())
        if isinstance(record_data, dict):
            app_main._activity_add_record_created_event(entity_def, record_id, record_data, actor=_system_actor())
            snapshot = app_main._automation_record_snapshot(record_data, entity_def)
            _emit_automation_event(
                "record.created",
                {
                    "entity_id": entity_def.get("id"),
                    "record_id": record_id,
                    "record": snapshot,
                    "changed_fields": sorted(record_data.keys()),
                    "user_id": "system",
                },
            )
    return {"entity_id": entity_def.get("id"), "record_id": record_id, "record": record_data}


def _run_generic_update_record(inputs: dict, ctx: dict) -> dict:
    app_main = _get_app_main()
    request = _internal_request()
    entity_id = inputs.get("entity_id") or _lookup_path(ctx, "trigger.entity_id")
    record_id = inputs.get("record_id") or _lookup_path(ctx, "trigger.record_id")
    if not isinstance(entity_id, str) or not entity_id:
        raise RuntimeError("entity_id required")
    if not isinstance(record_id, str) or not record_id:
        raise RuntimeError("record_id required")
    patch = _coerce_json_object(inputs.get("patch"), "patch")
    entity_ctx = _find_entity_context(entity_id)
    if not entity_ctx:
        raise RuntimeError("Entity not found")
    _, entity_def, manifest = entity_ctx
    existing = _find_existing_record(entity_id, record_id)
    if not existing:
        raise RuntimeError("Record not found")
    target_entity_id, existing_record = existing
    before_record = existing_record.get("record") or {}
    workflow = app_main._find_entity_workflow(manifest, entity_def.get("id"))
    errors, updated = app_main._validate_patch_payload(entity_def, patch, before_record, workflow=workflow)
    if errors:
        raise RuntimeError(f"Record update validation failed: {errors}")
    record = app_main._update_record_with_computed_fields(request, target_entity_id, entity_def, record_id, updated)
    after_record = record.get("record") if isinstance(record, dict) else None
    app_main._add_chatter_entry(target_entity_id, record_id, "system", "Record updated", _system_actor())
    if isinstance(after_record, dict):
        changed_fields = app_main._changed_fields(before_record or {}, after_record or {})
        before_snapshot = app_main._automation_record_snapshot(before_record, entity_def)
        after_snapshot = app_main._automation_record_snapshot(after_record, entity_def)
        _emit_automation_event(
            "record.updated",
            {
                "entity_id": entity_def.get("id"),
                "record_id": record_id,
                "changed_fields": changed_fields,
                "before": before_snapshot,
                "after": after_snapshot,
                "user_id": "system",
            },
        )
    return {"entity_id": target_entity_id, "record_id": record_id, "record": after_record}


def _lookup_email_from_record(target_entity_id: str | None, target_record_id: str | None, email_field: str | None) -> list[str]:
    target_data = _fetch_record_payload(target_entity_id, target_record_id)
    if not target_data:
        return []
    candidates: list[str] = []
    if isinstance(email_field, str) and email_field:
        candidates.append(email_field)
    if isinstance(target_entity_id, str) and "." in target_entity_id:
        slug = target_entity_id.split(".")[-1]
        candidates.extend(
            [
                f"{slug}.email",
                f"{slug}.work_email",
                f"{slug}.primary_email",
            ]
        )
    candidates.extend(["email", "work_email", "primary_email"])
    for field_id in candidates:
        values = _split_recipients(target_data.get(field_id))
        if values:
            return values
    return []


def _resolve_recipients(inputs: dict, context: dict, record_data: dict, entity_id: str | None, entity_def: dict | None) -> list[str]:
    recipients: list[str] = []
    # Explicit manual addresses are always additive.
    recipients.extend(_split_recipients(inputs.get("to")))
    recipients.extend(_split_recipients(inputs.get("to_internal_emails")))

    # Record fields can contribute recipients.
    field_ids: list[str] = []
    configured = inputs.get("to_field_ids")
    if isinstance(configured, list):
        field_ids.extend([f for f in configured if isinstance(f, str) and f])
    elif isinstance(configured, str):
        field_ids.extend([f.strip() for f in configured.split(",") if f.strip()])
    single_field = inputs.get("to_field_id")
    if isinstance(single_field, str) and single_field:
        field_ids.append(single_field)
    for field_id in list(dict.fromkeys(field_ids)):
        recipients.extend(_split_recipients(record_data.get(field_id)))

    # Lookup fields can contribute recipients.
    specs = inputs.get("to_lookup_specs")
    lookup_specs: list[dict] = []
    if isinstance(specs, list):
        lookup_specs.extend([s for s in specs if isinstance(s, dict)])
    else:
        lookup_fields: list[str] = []
        lookup_field = inputs.get("to_lookup_field_id")
        if isinstance(lookup_field, str) and lookup_field:
            lookup_fields.append(lookup_field)
        multi_lookup_fields = inputs.get("to_lookup_field_ids")
        if isinstance(multi_lookup_fields, list):
            lookup_fields.extend([f for f in multi_lookup_fields if isinstance(f, str) and f])
        elif isinstance(multi_lookup_fields, str):
            lookup_fields.extend([f.strip() for f in multi_lookup_fields.split(",") if f.strip()])
        lookup_fields = list(dict.fromkeys(lookup_fields))
        for field_name in lookup_fields:
            lookup_specs.append(
                {
                    "lookup_field": field_name,
                    "entity_id": inputs.get("to_lookup_entity_id"),
                    "email_field": inputs.get("to_lookup_email_field"),
                }
            )
    for spec in lookup_specs:
        lookup_field = spec.get("lookup_field")
        if not isinstance(lookup_field, str) or not lookup_field:
            continue
        target_id = record_data.get(lookup_field)
        if not isinstance(target_id, str) or not target_id:
            continue
        target_entity = spec.get("entity_id")
        if not isinstance(target_entity, str) or not target_entity:
            field_def = _find_field_def(entity_def, lookup_field)
            maybe_target = field_def.get("entity") if isinstance(field_def, dict) else None
            if isinstance(maybe_target, str) and maybe_target:
                target_entity = maybe_target
        target_emails = _lookup_email_from_record(target_entity, target_id, spec.get("email_field"))
        recipients.extend(target_emails)

    # Template expression can contribute recipients.
    to_expr = inputs.get("to_expr")
    if isinstance(to_expr, str) and to_expr.strip():
        try:
            rendered = render_template(to_expr, context, strict=True)
            recipients.extend(_split_recipients(rendered))
        except Exception:
            pass

    recipients = [item for item in recipients if "@" in item]
    return _dedupe(recipients)


def _handle_system_action(action_id: str, inputs: dict, ctx: dict, job_store: DbJobStore) -> dict:
    if action_id == "system.noop":
        return {"ok": True}
    if action_id == "system.fail":
        raise RuntimeError("Forced failure")
    if action_id == "system.create_record":
        return _run_generic_create_record(inputs, ctx)
    if action_id == "system.update_record":
        return _run_generic_update_record(inputs, ctx)
    if action_id == "system.query_records":
        entity_id = inputs.get("entity_id") or _lookup_path(ctx, "trigger.entity_id")
        if not isinstance(entity_id, str) or not entity_id:
            raise RuntimeError("entity_id required")
        store = DbGenericRecordStore()
        limit = max(1, min(200, int(inputs.get("limit") or 25)))
        offset = max(0, int(inputs.get("offset") or 0))
        q = inputs.get("q")
        search_fields = inputs.get("search_fields")
        if isinstance(search_fields, str):
            search_fields = [part.strip() for part in search_fields.split(",") if part.strip()]
        records = store.list(entity_id, limit=limit, offset=offset, q=q if isinstance(q, str) else None, search_fields=search_fields if isinstance(search_fields, list) else None)
        filter_expr = inputs.get("filter_expr")
        if isinstance(filter_expr, str) and filter_expr.strip():
            try:
                filter_expr = json.loads(filter_expr)
            except Exception as exc:
                raise RuntimeError("filter_expr must be valid JSON object") from exc
        if isinstance(filter_expr, dict):
            filtered = []
            for row in records:
                record = row.get("record") if isinstance(row, dict) else None
                if not isinstance(record, dict):
                    continue
                try:
                    if eval_condition(filter_expr, {"record": record, **ctx}):
                        filtered.append(row)
                except Exception:
                    continue
            records = filtered
        return {
            "entity_id": entity_id,
            "count": len(records),
            "records": records,
            "first": records[0] if records else None,
        }
    if action_id == "system.add_chatter":
        entity_id = inputs.get("entity_id") or _lookup_path(ctx, "trigger.entity_id")
        record_id = inputs.get("record_id") or _lookup_path(ctx, "trigger.record_id")
        body = inputs.get("body")
        entry_type = inputs.get("entry_type") or "note"
        if not isinstance(entity_id, str) or not entity_id:
            raise RuntimeError("entity_id required")
        if not isinstance(record_id, str) or not record_id:
            raise RuntimeError("record_id required")
        if not isinstance(body, str) or not body.strip():
            raise RuntimeError("body required")
        store = DbChatterStore()
        entry = store.add(entity_id, record_id, str(entry_type), body.strip(), _system_actor())
        return {"entry": entry, "entity_id": entity_id, "record_id": record_id}
    if action_id == "system.notify":
        store = DbNotificationStore()
        app_main = _get_app_main()
        entity_id = inputs.get("entity_id") or _lookup_path(ctx, "trigger.entity_id")
        record_id = inputs.get("record_id") or _lookup_path(ctx, "trigger.record_id")
        if not isinstance(entity_id, str):
            entity_id = None
        if not isinstance(record_id, str):
            record_id = None
        record_data = _fetch_record_payload(entity_id, record_id) if entity_id and record_id else {}
        entity_def = _find_entity_def(entity_id) if entity_id else None
        enriched_record = app_main._enrich_template_record(record_data, entity_def) if isinstance(record_data, dict) else {}
        render_context = {
            "record": enriched_record if isinstance(enriched_record, dict) else {},
            "entity_id": entity_id,
            "trigger": ctx.get("trigger") or {},
            **app_main._branding_context_for_org(get_org_id()),
        }
        recipients: list[str] = []
        recipient_user_ids = inputs.get("recipient_user_ids")
        if isinstance(recipient_user_ids, list):
            for value in recipient_user_ids:
                recipients.extend(_split_recipients(value))
        elif isinstance(recipient_user_ids, str):
            recipients.extend(_split_recipients(recipient_user_ids))
        # Backward compatibility with legacy single-recipient payloads.
        if isinstance(inputs.get("recipient_user_id"), str) and inputs.get("recipient_user_id").strip():
            recipients.extend(_split_recipients(inputs.get("recipient_user_id")))
        recipients = _dedupe(recipients)
        if not recipients:
            raise RuntimeError("Notification recipients not resolved")

        title = inputs.get("title") or "Notification"
        body = inputs.get("body") or ""
        link_to = inputs.get("link_to")
        if isinstance(title, str) and "{{" in title:
            title = render_template(title, render_context, strict=False)
        if isinstance(body, str) and "{{" in body:
            body = render_template(body, render_context, strict=False)
        if isinstance(link_to, str) and "{{" in link_to:
            link_to = render_template(link_to, render_context, strict=False)
        if (
            (not isinstance(link_to, str) or not link_to.strip())
            and inputs.get("link_mode") == "trigger_record"
            and isinstance(entity_id, str)
            and entity_id
            and isinstance(record_id, str)
            and record_id
        ):
            route_entity_id = entity_id[7:] if entity_id.startswith("entity.") else entity_id
            link_to = f"/data/{route_entity_id}/{record_id}"

        notifications = []
        for recipient_user_id in recipients:
            notifications.append(
                store.create(
                    {
                        "recipient_user_id": recipient_user_id,
                        "title": title,
                        "body": body,
                        "severity": inputs.get("severity") or "info",
                        "link_to": link_to,
                        "source_event": ctx.get("trigger") or {},
                    }
                )
            )
        return {"notifications": notifications, "notification": notifications[0]}

    if action_id == "system.send_email":
        app_main = _get_app_main()
        attach_store = DbAttachmentStore()
        email_store = DbEmailStore()
        conn_store = DbConnectionStore()
        connection = None
        if inputs.get("connection_id"):
            connection = conn_store.get(inputs.get("connection_id"))
        if not connection:
            connection = conn_store.get_default_email()
        if not connection:
            raise RuntimeError("Email connection not configured")
        template = None
        if inputs.get("template_id"):
            template = email_store.get_template(inputs.get("template_id"))
            if not template:
                raise RuntimeError("Email template not found")
        entity_id = inputs.get("entity_id") or _lookup_path(ctx, "trigger.entity_id")
        record_id = inputs.get("record_id") or _lookup_path(ctx, "trigger.record_id")
        if not isinstance(entity_id, str):
            entity_id = None
        if not isinstance(record_id, str):
            record_id = None
        record_data = _fetch_record_payload(entity_id, record_id)
        entity_def = _find_entity_def(entity_id)
        enriched_record = app_main._enrich_template_record(record_data, entity_def)
        context = {
            "record": enriched_record,
            "entity_id": entity_id,
            "trigger": ctx.get("trigger") or {},
            **app_main._branding_context_for_org(get_org_id()),
        }
        subject = inputs.get("subject") or (template.get("subject") if template else None)
        if not subject:
            raise RuntimeError("Email subject required")
        if isinstance(subject, str) and "{{" in subject:
            # Background email jobs should degrade gracefully if a stored template
            # references a field path that no longer exists.
            subject = render_template(subject, context, strict=False)
        body_html = inputs.get("body_html") or (template.get("body_html") if template else None)
        body_text = inputs.get("body_text") or (template.get("body_text") if template else None)
        if body_html:
            body_html = render_template(body_html, context, strict=False)
        if body_text:
            body_text = render_template(body_text, context, strict=False)
        attachment_entity_id = inputs.get("attachment_entity_id") or entity_id
        attachment_record_id = inputs.get("attachment_record_id") or record_id
        attachments = _resolve_linked_attachments(
            attach_store,
            entity_id=attachment_entity_id,
            record_id=attachment_record_id,
            purpose=inputs.get("attachment_purpose"),
            attachment_ids=inputs.get("attachment_ids"),
            record_data=record_data,
            attachment_field=inputs.get("attachment_field_id"),
        )
        recipients = _resolve_recipients(inputs, context, enriched_record, entity_id, entity_def)
        if not recipients:
            raise RuntimeError("Email recipients not resolved")
        outbox = email_store.create_outbox(
            {
                "to": recipients,
                "cc": inputs.get("cc") or [],
                "bcc": inputs.get("bcc") or [],
                "from_email": connection.get("config", {}).get("from_email"),
                "reply_to": inputs.get("reply_to"),
                "subject": subject,
                "body_html": body_html,
                "body_text": body_text,
                "status": "queued",
                "template_id": inputs.get("template_id"),
                "attachments_json": [
                    {
                        "attachment_id": attachment.get("id"),
                        "filename": attachment.get("filename"),
                        "mime_type": attachment.get("mime_type"),
                        "storage_key": attachment.get("storage_key"),
                    }
                    for attachment in attachments
                    if isinstance(attachment, dict)
                ],
            }
        )
        job = job_store.enqueue(
            {
                "type": "email.send",
                "payload": {"outbox_id": outbox.get("id"), "connection_id": connection.get("id")},
                "idempotency_key": inputs.get("idempotency_key"),
                "workspace_id": get_org_id(),
            }
        )
        return {"outbox": outbox, "job": job}

    if action_id == "system.generate_document":
        template_id = inputs.get("template_id")
        entity_id = inputs.get("entity_id") or _lookup_path(ctx, "trigger.entity_id")
        record_id = inputs.get("record_id") or _lookup_path(ctx, "trigger.record_id")
        if not template_id or not entity_id or not record_id:
            raise RuntimeError("template_id, entity_id, record_id required")
        job = job_store.enqueue(
            {
                "type": "doc.generate",
                "payload": {
                    "template_id": template_id,
                    "entity_id": entity_id,
                    "record_id": record_id,
                    "purpose": inputs.get("purpose") or "generated",
                },
                "idempotency_key": inputs.get("idempotency_key"),
                "workspace_id": get_org_id(),
            }
        )
        return {"job": job}

    if action_id == "system.apply_integration_mapping":
        mapping_id = inputs.get("mapping_id")
        if not isinstance(mapping_id, str) or not mapping_id.strip():
            raise RuntimeError("mapping_id required")
        mapping = DbIntegrationMappingStore().get(mapping_id.strip())
        if not mapping:
            raise RuntimeError("Integration mapping not found")
        connection_id = inputs.get("connection_id")
        mapping_connection_id = mapping.get("connection_id")
        if isinstance(connection_id, str) and connection_id.strip():
            if isinstance(mapping_connection_id, str) and mapping_connection_id and mapping_connection_id != connection_id.strip():
                raise RuntimeError("Selected mapping does not belong to the chosen connection")
            mapping_connection_id = connection_id.strip()
        connection = None
        if isinstance(mapping_connection_id, str) and mapping_connection_id:
            connection = DbConnectionStore().get(mapping_connection_id)
            if not connection:
                raise RuntimeError("Connection not found")
        source_record = _resolve_integration_mapping_source(inputs, ctx)
        if not isinstance(source_record, dict):
            raise RuntimeError("source_record must resolve to an object")
        result = execute_integration_mapping(
            mapping,
            source_record,
            {
                "connection_id": mapping_connection_id,
                "resource_key": inputs.get("resource_key") or ((mapping.get("mapping_json") or {}).get("resource_key") if isinstance(mapping.get("mapping_json"), dict) else None),
                "connection": connection,
                "source": "automation",
                "trigger": ctx.get("trigger") if isinstance(ctx.get("trigger"), dict) else {},
            },
        )
        return {
            "mapping_id": mapping_id.strip(),
            "mapping_name": mapping.get("name"),
            **result,
        }

    if action_id == "system.integration_request":
        connection_id = inputs.get("connection_id")
        if not isinstance(connection_id, str) or not connection_id:
            raise RuntimeError("connection_id required")
        connection = DbConnectionStore().get(connection_id)
        if not connection:
            raise RuntimeError("Connection not found")
        request_config = {
            "method": inputs.get("method") or "GET",
            "path": inputs.get("path"),
            "url": inputs.get("url"),
            "headers": inputs.get("headers") or {},
            "query": inputs.get("query") or {},
            "json": inputs.get("json"),
            "body": inputs.get("body"),
            "timeout_seconds": inputs.get("timeout_seconds"),
        }
        try:
            result = execute_connection_request(connection, request_config, get_org_id())
        except Exception as exc:
            DbIntegrationRequestLogStore().create(
                {
                    "connection_id": connection_id,
                    "source": "automation",
                    "direction": "outbound",
                    "method": request_config.get("method"),
                    "url": request_config.get("url") or request_config.get("path"),
                    "request_headers_json": request_config.get("headers") or {},
                    "request_query_json": request_config.get("query") or {},
                    "request_body_json": request_config.get("json"),
                    "request_body_text": request_config.get("body"),
                    "ok": False,
                    "error_message": str(exc),
                }
            )
            raise
        DbIntegrationRequestLogStore().create(
            {
                "connection_id": connection_id,
                "source": "automation",
                "direction": "outbound",
                "method": result.get("method"),
                "url": result.get("url"),
                "request_headers_json": result.get("request_headers") or {},
                "request_query_json": result.get("request_query") or {},
                "request_body_json": result.get("request_body_json"),
                "request_body_text": result.get("request_body_text"),
                "response_status": result.get("status_code"),
                "response_headers_json": result.get("headers") or {},
                "response_body_json": result.get("body_json"),
                "response_body_text": result.get("body_text"),
                "ok": result.get("ok"),
                "error_message": None if result.get("ok") else f"HTTP {result.get('status_code')}",
            }
        )
        if not result.get("ok"):
            raise RuntimeError(f"Integration request failed with status {result.get('status_code')}")
        return result

    if action_id == "system.integration_sync":
        connection_id = inputs.get("connection_id")
        if not isinstance(connection_id, str) or not connection_id:
            raise RuntimeError("connection_id required")
        connection = DbConnectionStore().get(connection_id)
        if not connection:
            raise RuntimeError("Connection not found")
        sync_config = inputs.get("sync") if isinstance(inputs.get("sync"), dict) else {}
        for key in (
            "scope_key",
            "resource_key",
            "cursor_param",
            "cursor_value_path",
            "last_item_cursor_path",
            "items_path",
            "limit_param",
            "max_items",
            "emit_events",
        ):
            if key in inputs:
                sync_config[key] = inputs.get(key)
        request_config = {}
        for key in ("method", "path", "url", "headers", "query", "json", "body", "timeout_seconds"):
            if key in inputs:
                request_config[key] = inputs.get(key)
        if request_config:
            sync_config["request"] = request_config
        if inputs.get("async"):
            job = job_store.enqueue(
                {
                    "type": "integration.sync.run",
                    "payload": {
                        "connection_id": connection_id,
                        "sync": sync_config,
                        "source": "automation",
                    },
                    "idempotency_key": inputs.get("idempotency_key"),
                    "workspace_id": get_org_id(),
                }
            )
            return {"job": job}
        return _run_integration_sync(connection, sync_config, source="automation")

    raise RuntimeError(f"Unsupported action_id: {action_id}")


def _handle_action(step: dict, inputs: dict, ctx: dict, job_store: DbJobStore) -> dict:
    action_id = step.get("action_id")
    if not isinstance(action_id, str):
        raise RuntimeError("action_id required")
    if action_id.startswith("system."):
        return _handle_system_action(action_id, inputs, ctx, job_store)
    app_main = _get_app_main()
    module_id = step.get("module_id") or inputs.get("module_id")
    if not isinstance(module_id, str) or not module_id:
        raise RuntimeError("module_id required for module action")
    result = app_main.run_action_internal(
        module_id,
        action_id,
        inputs,
        actor={"user_id": "system", "role": "system", "workspace_role": "admin", "platform_role": "superadmin"},
    )
    if hasattr(result, "body") and hasattr(result, "status_code"):
        try:
            result = json.loads(result.body.decode("utf-8"))
        except Exception:
            result = None
    if not isinstance(result, dict) or not result.get("ok"):
        errors = result.get("errors") if isinstance(result, dict) else None
        raise RuntimeError(f"Module action failed: {errors}")
    return result.get("data") or result.get("result") or {}


def _record_step_output(ctx: dict, step_id: str, output: dict, step: dict | None = None) -> None:
    ctx["steps"][step_id] = output
    ctx["last"] = output
    store_as = step.get("store_as") if isinstance(step, dict) else None
    if isinstance(store_as, str) and store_as:
        ctx["vars"][store_as] = output


def _execute_nested_steps(
    run_id: str,
    steps: list,
    ctx: dict,
    automation_store,
    job_store,
    *,
    step_prefix: str,
    sequence_state: dict,
) -> None:
    if not isinstance(steps, list):
        return
    for child_idx, child_step in enumerate(steps):
        if not isinstance(child_step, dict):
            raise RuntimeError(f"Invalid nested step at {step_prefix}[{child_idx}]")
        child_id = child_step.get("id") or f"{step_prefix}_{child_idx}"
        qualified_step_id = f"{step_prefix}.{child_id}"
        sequence_state["value"] += 1
        step_run = automation_store.create_step_run(
            {
                "run_id": run_id,
                "step_index": sequence_state["value"],
                "step_id": qualified_step_id,
                "status": "running",
                "attempt": 0,
                "started_at": _now(),
                "input": child_step,
                "idempotency_key": f"{run_id}:{qualified_step_id}:0",
            }
        )
        output = _execute_step_runtime(
            child_step,
            ctx,
            job_store,
            run_id=run_id,
            automation_store=automation_store,
            step_prefix=qualified_step_id,
            sequence_state=sequence_state,
            allow_delay=False,
        )
        automation_store.update_step_run(
            step_run.get("id"),
            {
                "status": "succeeded",
                "ended_at": _now(),
                "output": output,
            },
        )


def _execute_step_runtime(
    step: dict,
    ctx: dict,
    job_store: DbJobStore,
    *,
    run_id: str,
    automation_store,
    step_prefix: str,
    sequence_state: dict,
    allow_delay: bool,
) -> dict:
    kind = step.get("kind")
    step_id = step.get("id") or step_prefix
    if kind == "condition":
        expr = step.get("expr") or {}
        result = bool(eval_condition(expr, ctx))
        output = {"result": result, "stop_on_false": bool(step.get("stop_on_false"))}
        _record_step_output(ctx, step_id, output, step)
        branch_steps = step.get("then_steps") if result else step.get("else_steps")
        if isinstance(branch_steps, list) and branch_steps:
            _execute_nested_steps(
                run_id,
                branch_steps,
                ctx,
                automation_store,
                job_store,
                step_prefix=f"{step_prefix}.{'then' if result else 'else'}",
                sequence_state=sequence_state,
            )
        return output
    if kind == "delay":
        if not allow_delay:
            raise RuntimeError("Delay steps are not supported inside nested branches yet")
        seconds = step.get("seconds")
        until = step.get("until") or step.get("target_time")
        delay_seconds = None
        if isinstance(seconds, (int, float)):
            delay_seconds = max(0, int(seconds))
        elif isinstance(until, str):
            target = datetime.fromisoformat(until.replace("Z", "+00:00"))
            delay_seconds = max(0, int((target - _now_dt()).total_seconds()))
        if delay_seconds is None:
            raise RuntimeError("Invalid delay step")
        output = {"delay_seconds": delay_seconds}
        _record_step_output(ctx, step_id, output, step)
        return output
    if kind == "action":
        inputs = _resolve_inputs(step.get("inputs"), ctx)
        inputs["idempotency_key"] = f"{run_id}:{step_prefix}:0"
        output = _handle_action(step, inputs, ctx, job_store)
        _record_step_output(ctx, step_id, output, step)
        return output
    if kind == "foreach":
        over_value = _resolve_step_value(step.get("over"), ctx)
        items = _coerce_iteration_items(over_value)
        if not isinstance(items, list):
            raise RuntimeError("Loop source must resolve to a list")
        item_name = step.get("item_name") if isinstance(step.get("item_name"), str) and step.get("item_name") else "item"
        child_steps = step.get("steps") if isinstance(step.get("steps"), list) else None
        results = []
        total = len(items)
        for item_index, item in enumerate(items):
            loop_ctx = dict(ctx)
            loop_ctx[item_name] = item
            if item_name != "item":
                loop_ctx["item"] = item
            loop_ctx["loop"] = {"index": item_index, "number": item_index + 1, "count": total, "item": item}
            if child_steps:
                _execute_nested_steps(
                    run_id,
                    child_steps,
                    loop_ctx,
                    automation_store,
                    job_store,
                    step_prefix=f"{step_prefix}.loop_{item_index + 1}",
                    sequence_state=sequence_state,
                )
                results.append({"item": item, "last": loop_ctx.get("last")})
            else:
                inputs = _resolve_inputs(step.get("inputs"), loop_ctx)
                inputs["idempotency_key"] = f"{run_id}:{step_prefix}:{item_index}"
                results.append(_handle_action(step, inputs, loop_ctx, job_store))
        output = {"count": len(results), "results": results}
        _record_step_output(ctx, step_id, output, step)
        return output
    raise RuntimeError(f"Unsupported step kind: {kind}")


def _run_automation(job: dict, org_id: str, automation_store: DbAutomationStore | MemoryAutomationStore | None = None, job_store: DbJobStore | MemoryJobStore | None = None) -> None:
    automation_store = automation_store or DbAutomationStore()
    job_store = job_store or DbJobStore()
    run_id = (job.get("payload") or {}).get("run_id")
    if not run_id:
        raise RuntimeError("automation.run missing run_id")
    run = automation_store.get_run(run_id)
    if not run:
        logger.error("automation_run_missing run_id=%s org_id=%s job_id=%s", run_id, org_id, job.get("id"))
        raise RuntimeError("Automation run not found")
    if run.get("status") in {"succeeded", "failed", "cancelled"}:
        return
    automation = automation_store.get(run.get("automation_id"))
    if not automation:
        automation_store.update_run(run_id, {"status": "failed", "last_error": "Automation not found"})
        return
    steps = automation.get("steps") or []
    if not isinstance(steps, list):
        automation_store.update_run(run_id, {"status": "failed", "last_error": "Invalid steps"})
        return

    ctx = {"trigger": run.get("trigger_payload") or {}, "steps": {}, "vars": {}, "last": None}
    sequence_state = {"value": -1}
    current_index = int(run.get("current_step_index") or 0)
    if run.get("status") != "running":
        automation_store.update_run(run_id, {"status": "running", "started_at": _now()})

    for idx in range(current_index, len(steps)):
        step = steps[idx]
        if not isinstance(step, dict):
            automation_store.update_run(run_id, {"status": "failed", "last_error": f"Invalid step at {idx}"})
            return

        step_id = step.get("id") or f"step_{idx}"
        attempt = int(step.get("attempt") or 0)
        idempotency_key = f"{run_id}:{step_id}:{attempt}"
        existing = None
        if hasattr(automation_store, "get_step_run_by_idempotency"):
            existing = automation_store.get_step_run_by_idempotency(idempotency_key)
        if existing and existing.get("status") == "succeeded":
            automation_store.update_run(run_id, {"current_step_index": idx + 1})
            continue
        step_run = automation_store.create_step_run(
            {
                "run_id": run_id,
                "step_index": idx,
                "step_id": step_id,
                "status": "running",
                "attempt": attempt,
                "started_at": _now(),
                "input": step,
                "idempotency_key": idempotency_key,
            }
        )
        try:
            kind = step.get("kind")
            sequence_state["value"] = max(sequence_state["value"], idx)
            output = _execute_step_runtime(
                step,
                ctx,
                job_store,
                run_id=run_id,
                automation_store=automation_store,
                step_prefix=step_id,
                sequence_state=sequence_state,
                allow_delay=True,
            )
            if kind == "condition":
                goto = step.get("if_true_goto") if output.get("result") else step.get("if_false_goto")
                stop_on_false = bool(step.get("stop_on_false"))
                automation_store.update_step_run(
                    step_run.get("id"),
                    {
                        "status": "succeeded",
                        "ended_at": _now(),
                        "output": output,
                    },
                )
                if isinstance(goto, int) and 0 <= goto < len(steps):
                    automation_store.update_run(run_id, {"current_step_index": goto})
                    return
                if not output.get("result") and stop_on_false:
                    automation_store.update_run(run_id, {"status": "succeeded", "ended_at": _now(), "current_step_index": idx + 1})
                    return
            elif kind == "delay":
                delay_seconds = int(output.get("delay_seconds") or 0)
                automation_store.update_step_run(step_run.get("id"), {"status": "succeeded", "ended_at": _now(), "output": output})
                next_index = idx + 1
                automation_store.update_run(run_id, {"status": "queued", "current_step_index": next_index})
                job_store.enqueue(
                    {
                        "type": "automation.run",
                        "payload": {"run_id": run_id},
                        "run_at": (_now_dt() + timedelta(seconds=delay_seconds)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                        "idempotency_key": f"{run_id}:{next_index}:delay",
                        "workspace_id": org_id,
                    }
                )
                return
            else:
                automation_store.update_step_run(step_run.get("id"), {"status": "succeeded", "ended_at": _now(), "output": output})
        except Exception as exc:
            retry_policy = step.get("retry_policy") or {}
            max_attempts = int(retry_policy.get("max_attempts") or 0)
            backoff = int(retry_policy.get("backoff_seconds") or 30)
            automation_store.update_step_run(step_run.get("id"), {"status": "failed", "ended_at": _now(), "last_error": str(exc)})
            if max_attempts and attempt + 1 < max_attempts:
                automation_store.update_run(run_id, {"status": "queued", "current_step_index": idx})
                job_store.enqueue(
                    {
                        "type": "automation.run",
                        "payload": {"run_id": run_id},
                        "run_at": (_now_dt() + timedelta(seconds=backoff)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                        "idempotency_key": f"{run_id}:{step_id}:{attempt + 1}",
                        "workspace_id": org_id,
                    }
                )
                return
            automation_store.update_run(run_id, {"status": "failed", "ended_at": _now(), "last_error": str(exc)})
            return

        automation_store.update_run(run_id, {"current_step_index": idx + 1})

    automation_store.update_run(run_id, {"status": "succeeded", "ended_at": _now()})


def _now_dt() -> datetime:
    return datetime.now(timezone.utc)


def _handle_integration_webhook_process(job: dict, org_id: str) -> None:
    payload = job.get("payload") or {}
    event_id = payload.get("webhook_event_id")
    webhook_id = payload.get("webhook_id")
    if not isinstance(event_id, str) or not event_id:
        raise RuntimeError("Missing webhook_event_id")
    event_store = DbWebhookEventStore()
    webhook_store = DbIntegrationWebhookStore()
    event = event_store.get(event_id)
    if not event:
        raise RuntimeError("Webhook event not found")
    webhook = webhook_store.get(webhook_id) if isinstance(webhook_id, str) and webhook_id else None
    payload_json = event.get("payload_json") or {}
    headers_json = event.get("headers_json") or {}
    event_key = event.get("event_key") or (webhook.get("event_key") if isinstance(webhook, dict) else None) or "received"
    base_payload = {
        "event": "integration.webhook.received",
        "connection_id": event.get("connection_id"),
        "webhook_id": webhook_id,
        "provider_event_id": event.get("provider_event_id"),
        "event_key": event_key,
        "headers": headers_json,
        "payload": payload_json,
        "signature_valid": event.get("signature_valid"),
    }
    _emit_automation_event("integration.webhook.received", base_payload)
    if isinstance(event_key, str) and event_key.strip():
        _emit_automation_event(f"integration.webhook.{event_key.strip()}", base_payload)
    event_store.update_status(
        event_id,
        "processed",
        processed_at=_now_dt().strftime("%Y-%m-%dT%H:%M:%SZ"),
    )


def _handle_integration_sync_run(job: dict, org_id: str) -> None:
    payload = job.get("payload") or {}
    connection_id = payload.get("connection_id")
    if not isinstance(connection_id, str) or not connection_id:
        raise RuntimeError("Missing connection_id")
    connection = DbConnectionStore().get(connection_id)
    if not connection:
        raise RuntimeError("Connection not found")
    sync_config = payload.get("sync") if isinstance(payload.get("sync"), dict) else {}
    source = str(payload.get("source") or "worker_sync")
    _run_integration_sync(connection, sync_config, source=source)


def _handle_external_webhook_deliver(job: dict, org_id: str) -> None:
    payload = job.get("payload") or {}
    subscription_id = payload.get("subscription_id")
    if not isinstance(subscription_id, str) or not subscription_id:
        raise RuntimeError("Missing subscription_id")
    store = DbExternalWebhookSubscriptionStore()
    subscription = store.get(subscription_id)
    if not subscription:
        raise RuntimeError("External webhook subscription not found")
    if subscription.get("status") != "active":
        return
    target_url = str(subscription.get("target_url") or "").strip()
    if not target_url:
        raise RuntimeError("Webhook subscription target_url is required")
    event_name = str(payload.get("event") or "").strip() or "unknown"
    body_json = {
        "event": event_name,
        "payload": payload.get("payload") or {},
        "meta": payload.get("meta") or {},
        "sent_at": _now_dt().strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    body_bytes = json.dumps(body_json, separators=(",", ":")).encode("utf-8")
    headers = {"Content-Type": "application/json", "X-Octo-Event": event_name}
    stored_headers = subscription.get("headers_json")
    if isinstance(stored_headers, str):
        try:
            stored_headers = json.loads(stored_headers)
        except Exception:
            stored_headers = {}
    if isinstance(stored_headers, dict):
        for key, value in stored_headers.items():
            if key and value is not None:
                headers[str(key)] = str(value)
    signing_secret_id = subscription.get("signing_secret_id")
    if isinstance(signing_secret_id, str) and signing_secret_id:
        secret = resolve_secret(signing_secret_id, org_id)
        headers.update(build_webhook_signature_headers(body_bytes, secret))
    try:
        with httpx.Client(timeout=20.0) as client:
            response = client.post(target_url, content=body_bytes, headers=headers)
        store.update(
            subscription_id,
            {
                "last_delivered_at": _now_dt().strftime("%Y-%m-%dT%H:%M:%SZ"),
                "last_status_code": response.status_code,
                "last_error": None if response.status_code < 400 else (response.text[:500] if isinstance(response.text, str) else "Webhook delivery failed"),
            },
        )
        if response.status_code >= 400:
            raise RuntimeError(f"Webhook delivery failed with status {response.status_code}")
    except Exception as exc:
        store.update(
            subscription_id,
            {
                "last_status_code": None,
                "last_error": str(exc),
            },
        )
        raise


def _run_job(job: dict) -> None:
    org_id = job.get("org_id")
    if not org_id:
        raise RuntimeError("Job missing org_id")
    token = set_org_id(org_id)
    try:
        if job.get("type") == "email.send":
            _handle_email_send(job, org_id)
        elif job.get("type") == "doc.generate":
            _handle_doc_generate(job, org_id)
        elif job.get("type") == "automation.run":
            _run_automation(job, org_id)
        elif job.get("type") == "attachments.cleanup":
            _handle_attachments_cleanup(job, org_id)
        elif job.get("type") == "integration.webhook.process":
            _handle_integration_webhook_process(job, org_id)
        elif job.get("type") == "integration.sync.run":
            _handle_integration_sync_run(job, org_id)
        elif job.get("type") == "external.webhook.deliver":
            _handle_external_webhook_deliver(job, org_id)
        else:
            raise RuntimeError(f"Unknown job type: {job.get('type')}")
    finally:
        reset_org_id(token)


def main() -> None:
    worker_id = os.getenv("WORKER_ID", str(uuid.uuid4()))
    scoped_org_id = os.getenv("WORKER_ORG_ID") or os.getenv("OCTO_WORKER_ORG_ID") or ""
    poll_ms = int(os.getenv("WORKER_POLL_MS", "1000"))
    batch_size = int(os.getenv("WORKER_BATCH", "5"))
    job_store = DbJobStore()
    shared_mode = not bool(scoped_org_id.strip())
    logger.info(
        "worker_start worker_id=%s mode=%s scoped_org_id=%s poll_ms=%s batch_size=%s",
        worker_id,
        "shared" if shared_mode else "scoped",
        scoped_org_id or None,
        poll_ms,
        batch_size,
    )

    while True:
        if shared_mode:
            jobs = job_store.claim_batch_any(batch_size, worker_id)
        else:
            token = set_org_id(scoped_org_id)
            try:
                jobs = job_store.claim_batch(batch_size, worker_id)
            finally:
                reset_org_id(token)

        if not jobs:
            time.sleep(poll_ms / 1000)
            continue

        for job in jobs:
            token = set_org_id(job.get("org_id"))
            try:
                try:
                    _run_job(job)
                    job_store.update(job["id"], {"status": "succeeded", "locked_at": None, "locked_by": None})
                except SecretStoreError as exc:
                    job_store.update(job["id"], {"status": "failed", "last_error": str(exc)})
                except Exception as exc:
                    attempt = job.get("attempt", 1)
                    max_attempts = job.get("max_attempts", 10)
                    if attempt >= max_attempts:
                        job_store.update(job["id"], {"status": "dead", "last_error": str(exc)})
                    else:
                        delay = _backoff_seconds(attempt)
                        run_at = (_now() + timedelta(seconds=delay)).strftime("%Y-%m-%dT%H:%M:%SZ")
                        job_store.update(
                            job["id"],
                            {
                                "status": "queued",
                                "run_at": run_at,
                                "last_error": str(exc),
                                "locked_at": None,
                                "locked_by": None,
                            },
                        )
                finally:
                    job_store.add_event(job["id"], "info", "job_finished", {"status": job_store.get(job["id"]).get("status")})
            finally:
                reset_org_id(token)


if __name__ == "__main__":
    main()
