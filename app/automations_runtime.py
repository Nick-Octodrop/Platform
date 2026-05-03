from __future__ import annotations

from typing import Any

import logging

from app.automations import match_event
from app.stores_db import set_org_id, reset_org_id
from app.template_render import render_template

logger = logging.getLogger("octo.automations_runtime")


def _automation_ui_options(automation: dict) -> dict:
    trigger = automation.get("trigger") if isinstance(automation, dict) else None
    ui = trigger.get("ui") if isinstance(trigger, dict) else None
    return dict(ui) if isinstance(ui, dict) else {}


def _trigger_coalesce_key_template(trigger: dict) -> str | None:
    if not isinstance(trigger, dict):
        return None
    coalesce = trigger.get("coalesce")
    if isinstance(coalesce, dict):
        for key in ("key_template", "key"):
            value = coalesce.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    for key in ("coalesce_key", "coalesce_key_template", "idempotency_key_template"):
        value = trigger.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _render_trigger_coalesce_key(automation: dict, trigger: dict, event: dict, payload: dict) -> str | None:
    template = _trigger_coalesce_key_template(trigger)
    if not template:
        return None
    try:
        rendered = render_template(
            template,
            {
                "automation": automation,
                "event": event,
                "trigger": payload,
            },
            strict=False,
        ).strip()
    except Exception as exc:
        logger.warning(
            "automation_coalesce_key_render_failed automation_id=%s error=%s",
            automation.get("id") if isinstance(automation, dict) else None,
            exc,
        )
        return None
    if not rendered:
        return None
    return f"coalesce:{rendered}"


def handle_event(automation_store: Any, job_store: Any, event: dict) -> list[dict]:
    payload = event.get("payload") or {}
    event_type = payload.get("event")
    if not isinstance(event_type, str):
        return []
    org_id = event.get("meta", {}).get("org_id")
    logger.info("automation_event_received event=%s org_id=%s", event_type, org_id)
    runs = []
    token = None
    if isinstance(org_id, str) and org_id:
        token = set_org_id(org_id)
    try:
        automations = automation_store.list(status="published")
        if not automations:
            logger.info("automation_no_published event=%s org_id=%s", event_type, org_id)
            return []
        for automation in automations:
            trigger = automation.get("trigger") or {}
            if not match_event(trigger, event_type, payload):
                continue
            coalesce_key = _render_trigger_coalesce_key(automation, trigger, event, payload)
            idempotency_key = coalesce_key or event.get("meta", {}).get("event_id")
            run = automation_store.create_run(
                {
                    "automation_id": automation.get("id"),
                    "status": "queued",
                    "trigger_event_id": event.get("meta", {}).get("event_id"),
                    "trigger_type": event_type,
                    "trigger_payload": payload,
                    "current_step_index": 0,
                    "idempotency_key": idempotency_key,
                    "coalesce": bool(coalesce_key),
                }
            )
            job_store.enqueue(
                {
                    "type": "automation.run",
                    "payload": {"run_id": run.get("id")},
                    "idempotency_key": f"automation_run:{run.get('id')}",
                    "coalesce": bool(coalesce_key),
                    "workspace_id": org_id,
                }
            )
            logger.info(
                "automation_enqueued run_id=%s automation_id=%s org_id=%s",
                run.get("id"),
                automation.get("id"),
                org_id,
            )
            run_summary = dict(run)
            run_summary["automation_name"] = automation.get("name")
            run_summary["ui"] = _automation_ui_options(automation)
            runs.append(run_summary)
    finally:
        if token is not None:
            reset_org_id(token)
    return runs


def enqueue_scheduled_automation_run(
    automation_store: Any,
    job_store: Any,
    automation: dict,
    *,
    slot_key: str,
    payload: dict | None = None,
) -> dict | None:
    if not isinstance(automation, dict) or not automation.get("id"):
        return None
    run = automation_store.create_run(
        {
            "automation_id": automation.get("id"),
            "status": "queued",
            "trigger_event_id": None,
            "trigger_type": "schedule.tick",
            "trigger_payload": payload or {},
            "current_step_index": 0,
            "idempotency_key": slot_key,
        }
    )
    if not isinstance(run, dict) or not run.get("id"):
        return None
    job_store.enqueue(
        {
            "type": "automation.run",
            "payload": {"run_id": run.get("id")},
            "idempotency_key": f"automation_run:{run.get('id')}",
        }
    )
    run_summary = dict(run)
    run_summary["automation_name"] = automation.get("name")
    run_summary["ui"] = _automation_ui_options(automation)
    return run_summary
