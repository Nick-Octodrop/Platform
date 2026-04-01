from __future__ import annotations

import os
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.automations_runtime import enqueue_scheduled_automation_run
from app.stores_db import DbAutomationStore, DbConnectionStore, DbJobStore, reset_org_id, set_org_id


def _now_dt() -> datetime:
    return datetime.now(timezone.utc)


def _connection_has_poll_sync(connection: dict) -> bool:
    if not isinstance(connection, dict):
        return False
    if not str(connection.get("type") or "").startswith("integration."):
        return False
    if str(connection.get("status") or "") != "active":
        return False
    config = connection.get("config") if isinstance(connection.get("config"), dict) else {}
    sync = config.get("sync") if isinstance(config.get("sync"), dict) else {}
    if not sync:
        return False
    if not bool(sync.get("schedule_enabled")):
        return False
    every_minutes = sync.get("schedule_every_minutes")
    try:
        return int(every_minutes or 0) > 0
    except Exception:
        return False


def _enqueue_due_syncs(*, scoped_org_id: str | None = None) -> int:
    connection_store = DbConnectionStore()
    job_store = DbJobStore()
    now = _now_dt()
    current_minute = int(now.timestamp() // 60)
    connections = connection_store.list(status="active") if scoped_org_id else connection_store.list_any(status="active")
    queued = 0
    for connection in connections:
        org_id = str(connection.get("org_id") or "").strip()
        if not org_id:
            continue
        if not _connection_has_poll_sync(connection):
            continue
        config = connection.get("config") if isinstance(connection.get("config"), dict) else {}
        sync = config.get("sync") if isinstance(config.get("sync"), dict) else {}
        interval_minutes = int(sync.get("schedule_every_minutes") or 0)
        if interval_minutes <= 0:
            continue
        if current_minute % interval_minutes != 0:
            continue
        scope_key = str(sync.get("scope_key") or sync.get("resource_key") or "default").strip() or "default"
        slot = current_minute // interval_minutes
        token = set_org_id(org_id)
        try:
            job_store.enqueue(
                {
                    "type": "integration.sync.run",
                    "payload": {
                        "connection_id": connection.get("id"),
                        "sync": sync,
                        "source": "scheduled_sync",
                    },
                    "priority": 0,
                    "workspace_id": org_id,
                    "idempotency_key": f"scheduled_sync:{connection.get('id')}:{scope_key}:{slot}",
                }
            )
        finally:
            reset_org_id(token)
        queued += 1
    return queued


def _automation_has_interval_schedule(automation: dict) -> bool:
    if not isinstance(automation, dict):
        return False
    if str(automation.get("status") or "") != "published":
        return False
    trigger = automation.get("trigger") if isinstance(automation.get("trigger"), dict) else {}
    if trigger.get("kind") != "schedule":
        return False
    try:
        return int(trigger.get("every_minutes") or 0) > 0
    except Exception:
        return False


def _enqueue_due_automations(*, scoped_org_id: str | None = None) -> int:
    automation_store = DbAutomationStore()
    job_store = DbJobStore()
    now = _now_dt()
    current_minute = int(now.timestamp() // 60)
    automations = automation_store.list(status="published") if scoped_org_id else automation_store.list_any(status="published")
    queued = 0
    for automation in automations:
        org_id = str(automation.get("org_id") or "").strip()
        if not org_id:
            continue
        if not _automation_has_interval_schedule(automation):
            continue
        trigger = automation.get("trigger") if isinstance(automation.get("trigger"), dict) else {}
        interval_minutes = int(trigger.get("every_minutes") or 0)
        if interval_minutes <= 0:
            continue
        if current_minute % interval_minutes != 0:
            continue
        slot = current_minute // interval_minutes
        token = set_org_id(org_id)
        try:
            run = enqueue_scheduled_automation_run(
                automation_store,
                job_store,
                automation,
                slot_key=f"schedule:{automation.get('id')}:{slot}",
                payload={
                    "event": "schedule.tick",
                    "automation_id": automation.get("id"),
                    "scheduled_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "interval_minutes": interval_minutes,
                },
            )
        finally:
            reset_org_id(token)
        if run:
            queued += 1
    return queued


def main() -> None:
    scheduler_id = os.getenv("SCHEDULER_ID", str(uuid.uuid4()))
    poll_seconds = max(5, int(os.getenv("SCHEDULER_POLL_SECONDS", "30")))
    scoped_org_id = (os.getenv("SCHEDULER_ORG_ID") or os.getenv("OCTO_SCHEDULER_ORG_ID") or "").strip()
    print(f"[scheduler] started id={scheduler_id} scope={scoped_org_id or 'shared'} poll={poll_seconds}s", flush=True)
    while True:
        try:
            token = set_org_id(scoped_org_id) if scoped_org_id else None
            try:
                sync_count = _enqueue_due_syncs(scoped_org_id=scoped_org_id or None)
                automation_count = _enqueue_due_automations(scoped_org_id=scoped_org_id or None)
                count = sync_count + automation_count
            finally:
                if token is not None:
                    reset_org_id(token)
            if count:
                print(f"[scheduler] queued_jobs={count} sync={sync_count} automations={automation_count}", flush=True)
        except Exception as exc:
            print(f"[scheduler] error: {exc}", flush=True)
        time.sleep(poll_seconds)


if __name__ == "__main__":
    main()
