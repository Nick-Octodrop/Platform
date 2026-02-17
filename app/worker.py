from __future__ import annotations

import math
import os
import sys
import time
import traceback
import uuid
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

from app.attachments import store_bytes, delete_storage
from app.doc_render import render_html, render_pdf, normalize_margins
from app.email import get_provider, render_template
from app import main as app_main
from app.records_validation import find_entity_def as _find_entity_def_in_registry
from app.secrets import SecretStoreError
from app.stores import MemoryAutomationStore, MemoryJobStore
from app.stores_db import (
    DbAttachmentStore,
    DbConnectionStore,
    DbDocTemplateStore,
    DbEmailStore,
    DbGenericRecordStore,
    DbJobStore,
    DbNotificationStore,
    DbAutomationStore,
    get_org_id,
    set_org_id,
    reset_org_id,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _backoff_seconds(attempt: int) -> int:
    return min(60 * (2 ** max(0, attempt - 1)), 3600)


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

    found = _find_entity_def_in_registry(
        _RegistryProxy(),
        lambda module_id, manifest_hash: app_main.store.get_snapshot(module_id, manifest_hash),
        entity_id,
    )
    entity_def = found[1] if found else None
    record_data = record.get("record") or {}
    context = {
        "record": app_main._enrich_template_record(record_data, entity_def),
        "entity_id": entity_id,
        **app_main._branding_context_for_org(org_id),
    }
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


def _handle_attachments_cleanup(job: dict, org_id: str) -> None:
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


def _resolve_value(value: object, ctx: dict) -> object:
    if isinstance(value, dict) and set(value.keys()) == {"var"}:
        var_name = value.get("var")
        if isinstance(var_name, str):
            return _lookup_path(ctx, var_name)
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

    class _RegistryProxy:
        def list(self):
            return app_main.registry.list()

    for candidate in _candidate_entity_ids(entity_id):
        found = _find_entity_def_in_registry(
            _RegistryProxy(),
            lambda module_id, manifest_hash: app_main.store.get_snapshot(module_id, manifest_hash),
            candidate,
        )
        if isinstance(found, tuple) and len(found) >= 2 and isinstance(found[1], dict):
            return found[1]
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
    if action_id == "system.notify":
        store = DbNotificationStore()
        recipients: list[str] = []
        recipient_user_ids = inputs.get("recipient_user_ids")
        if isinstance(recipient_user_ids, list):
            recipients.extend([str(v).strip() for v in recipient_user_ids if str(v).strip()])
        elif isinstance(recipient_user_ids, str):
            recipients.extend([part.strip() for part in recipient_user_ids.split(",") if part.strip()])
        # Backward compatibility with legacy single-recipient payloads.
        if isinstance(inputs.get("recipient_user_id"), str) and inputs.get("recipient_user_id").strip():
            recipients.append(inputs.get("recipient_user_id").strip())
        recipients = _dedupe(recipients)
        if not recipients:
            raise RuntimeError("Notification recipients not resolved")

        notifications = []
        for recipient_user_id in recipients:
            notifications.append(
                store.create(
                    {
                        "recipient_user_id": recipient_user_id,
                        "title": inputs.get("title") or "Notification",
                        "body": inputs.get("body") or "",
                        "severity": inputs.get("severity") or "info",
                        "link_to": inputs.get("link_to"),
                        "source_event": ctx.get("trigger") or {},
                    }
                )
            )
        return {"notifications": notifications, "notification": notifications[0]}

    if action_id == "system.send_email":
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
            subject = render_template(subject, context, strict=True)
        body_html = inputs.get("body_html") or (template.get("body_html") if template else None)
        body_text = inputs.get("body_text") or (template.get("body_text") if template else None)
        if body_html:
            body_html = render_template(body_html, context, strict=True)
        if body_text:
            body_text = render_template(body_text, context, strict=True)
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

    raise RuntimeError(f"Unsupported action_id: {action_id}")


def _handle_action(step: dict, inputs: dict, ctx: dict, job_store: DbJobStore) -> dict:
    action_id = step.get("action_id")
    if not isinstance(action_id, str):
        raise RuntimeError("action_id required")
    if action_id.startswith("system."):
        return _handle_system_action(action_id, inputs, ctx, job_store)
    module_id = step.get("module_id") or inputs.get("module_id")
    if not isinstance(module_id, str) or not module_id:
        raise RuntimeError("module_id required for module action")
    result = app_main.run_action_internal(module_id, action_id, inputs, actor={"user_id": "system", "role": "system"})
    if not isinstance(result, dict) or not result.get("ok"):
        errors = result.get("errors") if isinstance(result, dict) else None
        raise RuntimeError(f"Module action failed: {errors}")
    return result.get("data") or result.get("result") or {}


def _run_automation(job: dict, org_id: str, automation_store: DbAutomationStore | MemoryAutomationStore | None = None, job_store: DbJobStore | MemoryJobStore | None = None) -> None:
    automation_store = automation_store or DbAutomationStore()
    job_store = job_store or DbJobStore()
    run_id = (job.get("payload") or {}).get("run_id")
    if not run_id:
        raise RuntimeError("automation.run missing run_id")
    run = automation_store.get_run(run_id)
    if not run:
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

    ctx = {"trigger": run.get("trigger_payload") or {}}
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
            if kind == "condition":
                expr = step.get("expr") or {}
                result = bool(eval_condition(expr, ctx))
                goto = step.get("if_true_goto") if result else step.get("if_false_goto")
                automation_store.update_step_run(step_run.get("id"), {"status": "succeeded", "ended_at": _now(), "output": {"result": result}})
                if isinstance(goto, int) and 0 <= goto < len(steps):
                    automation_store.update_run(run_id, {"current_step_index": goto})
                    return
            elif kind == "delay":
                seconds = step.get("seconds")
                until = step.get("until")
                delay_seconds = None
                if isinstance(seconds, (int, float)):
                    delay_seconds = max(0, int(seconds))
                elif isinstance(until, str):
                    target = datetime.fromisoformat(until.replace("Z", "+00:00"))
                    delay_seconds = max(0, int((target - _now_dt()).total_seconds()))
                if delay_seconds is None:
                    raise RuntimeError("Invalid delay step")
                automation_store.update_step_run(step_run.get("id"), {"status": "succeeded", "ended_at": _now(), "output": {"delay_seconds": delay_seconds}})
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
            elif kind == "action":
                inputs = _resolve_inputs(step.get("inputs"), ctx)
                inputs["idempotency_key"] = idempotency_key
                output = _handle_action(step, inputs, ctx, job_store)
                automation_store.update_step_run(step_run.get("id"), {"status": "succeeded", "ended_at": _now(), "output": output})
            else:
                raise RuntimeError(f"Unsupported step kind: {kind}")
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
        else:
            raise RuntimeError(f"Unknown job type: {job.get('type')}")
    finally:
        reset_org_id(token)


def main() -> None:
    worker_id = os.getenv("WORKER_ID", str(uuid.uuid4()))
    org_id = os.getenv("WORKER_ORG_ID") or os.getenv("OCTO_WORKER_ORG_ID", "default")
    poll_ms = int(os.getenv("WORKER_POLL_MS", "1000"))
    batch_size = int(os.getenv("WORKER_BATCH", "5"))
    job_store = DbJobStore()

    while True:
        token = set_org_id(org_id)
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
