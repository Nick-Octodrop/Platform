from __future__ import annotations

from typing import Any

import logging

from app.automations import match_event
from app.stores_db import set_org_id, reset_org_id

logger = logging.getLogger("octo.automations_runtime")


def handle_event(automation_store: Any, job_store: Any, event: dict) -> list[dict]:
    payload = event.get("payload") or {}
    event_type = payload.get("event")
    if not isinstance(event_type, str):
        return []
    org_id = event.get("meta", {}).get("org_id")
    logger.info("automation_event_received event=%s org_id=%s", event_type, org_id)
    automations = automation_store.list(status="published")
    if not automations:
        logger.info("automation_no_published event=%s org_id=%s", event_type, org_id)
        return []
    runs = []
    token = None
    if isinstance(org_id, str) and org_id:
        token = set_org_id(org_id)
    try:
        for automation in automations:
            trigger = automation.get("trigger") or {}
            if not match_event(trigger, event_type, payload):
                continue
            run = automation_store.create_run(
                {
                    "automation_id": automation.get("id"),
                    "status": "queued",
                    "trigger_event_id": event.get("meta", {}).get("event_id"),
                    "trigger_type": event_type,
                    "trigger_payload": payload,
                    "current_step_index": 0,
                }
            )
            job_store.enqueue(
                {
                    "type": "automation.run",
                    "payload": {"run_id": run.get("id")},
                    "idempotency_key": run.get("id"),
                }
            )
            logger.info(
                "automation_enqueued run_id=%s automation_id=%s org_id=%s",
                run.get("id"),
                automation.get("id"),
                org_id,
            )
            runs.append(run)
    finally:
        if token is not None:
            reset_org_id(token)
    return runs
