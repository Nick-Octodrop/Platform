"""In-memory stores and transaction stubs for MVP."""

from __future__ import annotations

import copy
import uuid
from typing import Any, Dict, List
from datetime import datetime, timezone


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class InMemoryTx:
    def __init__(self) -> None:
        self.committed = False
        self.rolled_back = False

    def commit(self) -> None:
        self.committed = True

    def rollback(self) -> None:
        self.rolled_back = True


class InMemoryTxManager:
    def begin(self) -> InMemoryTx:
        return InMemoryTx()


class InMemoryRecordStore:
    def __init__(self) -> None:
        self._records: Dict[str, Dict[str, dict]] = {}

    def create_record(self, tx: InMemoryTx, entity: str, values: dict) -> dict:
        record_id = str(uuid.uuid4())
        record = copy.deepcopy(values)
        record["id"] = record_id
        self._records.setdefault(entity, {})[record_id] = record
        return copy.deepcopy(record)

    def update_record(self, tx: InMemoryTx, entity: str, record_id: Any, changes: dict) -> None:
        entity_records = self._records.get(entity, {})
        if record_id not in entity_records:
            raise KeyError("record not found")
        entity_records[record_id].update(copy.deepcopy(changes))

    def get_record(self, entity: str, record_id: str) -> dict | None:
        rec = self._records.get(entity, {}).get(record_id)
        return copy.deepcopy(rec) if rec else None

    def list_records(self, entity: str) -> list[dict]:
        return [copy.deepcopy(v) for v in self._records.get(entity, {}).values()]


class InMemoryActionCaller:
    def call(self, tx: InMemoryTx, action_ref: str, params: dict, ctx: dict) -> dict:
        return {"ok": True}


class InMemoryQueryRunner:
    def run(self, tx: InMemoryTx, query_ref: str, params: dict, ctx: dict) -> dict | list:
        return []


class MemoryDraftStore:
    def __init__(self) -> None:
        self._drafts: Dict[str, dict] = {}
        self._draft_versions: Dict[str, List[dict]] = {}

    def list_drafts(self) -> list[dict]:
        items = []
        for module_id, data in self._drafts.items():
            items.append(
                {
                    "module_id": module_id,
                    "updated_at": data["updated_at"],
                    "updated_by": data.get("updated_by"),
                    "base_snapshot_id": data.get("base_snapshot_id"),
                }
            )
        return sorted(items, key=lambda d: d.get("updated_at") or "", reverse=True)

    def get_draft(self, module_id: str) -> dict | None:
        data = self._drafts.get(module_id)
        if not data:
            return None
        return copy.deepcopy(data)

    def upsert_draft(self, module_id: str, manifest: dict, updated_by: str | None = None, base_snapshot_id: str | None = None) -> dict:
        now = _now()
        existing = self._drafts.get(module_id)
        created_at = existing.get("created_at") if existing else now
        base_snapshot = base_snapshot_id if base_snapshot_id is not None else existing.get("base_snapshot_id") if existing else None
        record = {
            "module_id": module_id,
            "manifest": copy.deepcopy(manifest),
            "created_at": created_at,
            "updated_at": now,
            "updated_by": updated_by,
            "base_snapshot_id": base_snapshot,
        }
        self._drafts[module_id] = record
        return copy.deepcopy(record)

    def create_draft_version(
        self,
        module_id: str,
        manifest: dict,
        note: str | None = None,
        created_by: str | None = None,
        parent_version_id: str | None = None,
        ops_applied: list | None = None,
        validation_errors: list | None = None,
    ) -> dict:
        now = _now()
        version_id = str(uuid.uuid4())
        entry = {
            "id": version_id,
            "module_id": module_id,
            "manifest": copy.deepcopy(manifest),
            "note": note,
            "created_at": now,
            "created_by": created_by,
            "parent_version_id": parent_version_id,
            "ops_applied": copy.deepcopy(ops_applied) if ops_applied is not None else None,
            "validation_errors": copy.deepcopy(validation_errors) if validation_errors is not None else None,
        }
        self._draft_versions.setdefault(module_id, []).insert(0, entry)
        self.upsert_draft(module_id, manifest, updated_by=created_by)
        return copy.deepcopy(entry)

    def list_draft_versions(self, module_id: str) -> list[dict]:
        return [copy.deepcopy(v) for v in self._draft_versions.get(module_id, [])]

    def get_draft_version(self, module_id: str, version_id: str) -> dict | None:
        for entry in self._draft_versions.get(module_id, []):
            if entry.get("id") == version_id:
                return copy.deepcopy(entry)
        return None

    def delete_draft(self, module_id: str) -> bool:
        if module_id in self._drafts:
            del self._drafts[module_id]
        if module_id in self._draft_versions:
            del self._draft_versions[module_id]
        return True
        return False


class MemoryGenericRecordStore:
    def __init__(self) -> None:
        self._records: Dict[str, Dict[str, Dict[str, dict]]] = {}

    def _bucket(self, tenant_id: str, entity_id: str) -> Dict[str, dict]:
        return self._records.setdefault(tenant_id, {}).setdefault(entity_id, {})

    def list(self, entity_id: str, tenant_id: str = "default") -> list[dict]:
        items = list(self._bucket(tenant_id, entity_id).values())
        return [copy.deepcopy(r) for r in items]

    def list_page(
        self,
        entity_id: str,
        tenant_id: str = "default",
        limit: int = 50,
        cursor: str | None = None,
        q: str | None = None,
        search_fields: list[str] | None = None,
        fields: list[str] | None = None,
    ) -> tuple[list[dict], str | None]:
        items = list(self._bucket(tenant_id, entity_id).values())
        trimmed = []
        for record in items[:limit]:
            rec = copy.deepcopy(record)
            record_id = rec.get("id")
            if isinstance(fields, list) and fields:
                rec = {fid: rec.get(fid) for fid in fields if fid in rec}
                if record_id:
                    rec["id"] = record_id
            trimmed.append({"record_id": record_id, "record": rec})
        return trimmed, None

    def get(self, entity_id: str, record_id: str, tenant_id: str = "default") -> dict | None:
        record = self._bucket(tenant_id, entity_id).get(record_id)
        return copy.deepcopy(record) if record else None

    def create(self, entity_id: str, data: dict, tenant_id: str = "default") -> dict:
        record_id = str(uuid.uuid4())
        record = copy.deepcopy(data)
        record["id"] = record_id
        self._bucket(tenant_id, entity_id)[record_id] = record
        return copy.deepcopy(record)

    def update(self, entity_id: str, record_id: str, data: dict, tenant_id: str = "default") -> dict:
        record = self._bucket(tenant_id, entity_id).get(record_id) or {"id": record_id}
        record = copy.deepcopy(record)
        record.update(copy.deepcopy(data))
        record["id"] = record_id
        self._bucket(tenant_id, entity_id)[record_id] = record
        return copy.deepcopy(record)

    def delete(self, entity_id: str, record_id: str, tenant_id: str = "default") -> None:
        bucket = self._bucket(tenant_id, entity_id)
        if record_id in bucket:
            del bucket[record_id]


class MemoryChatterStore:
    def __init__(self) -> None:
        self._entries: Dict[str, List[dict]] = {}

    def _key(self, entity_id: str, record_id: str) -> str:
        return f"{entity_id}:{record_id}"

    def list(self, entity_id: str, record_id: str, limit: int = 200) -> list[dict]:
        items = self._entries.get(self._key(entity_id, record_id), [])
        return list(items)[:limit]

    def add(self, entity_id: str, record_id: str, entry_type: str, body: str, actor: dict | None) -> dict:
        entry = {
            "id": str(uuid.uuid4()),
            "type": entry_type,
            "body": body,
            "actor": actor,
            "created_at": _now(),
        }
        key = self._key(entity_id, record_id)
        self._entries.setdefault(key, []).insert(0, entry)
        return entry


class MemoryActivityStore:
    def __init__(self) -> None:
        self._entries: Dict[str, List[dict]] = {}

    def _key(self, entity_id: str, record_id: str) -> str:
        return f"{entity_id}:{record_id}"

    def add_event(self, entity_id: str, record_id: str, event_type: str, payload: dict | None, actor: dict | None = None) -> dict:
        author = None
        if isinstance(actor, dict):
            user_id = actor.get("user_id") or actor.get("id") or actor.get("sub")
            name = actor.get("name") or actor.get("full_name") or actor.get("display_name") or actor.get("email")
            author = {"id": str(user_id) if user_id else None, "name": str(name) if name else "System", "email": actor.get("email")}
        entry = {
            "id": str(uuid.uuid4()),
            "event_type": event_type,
            "author": author,
            "payload": copy.deepcopy(payload or {}),
            "created_at": _now(),
        }
        key = self._key(entity_id, str(record_id))
        self._entries.setdefault(key, []).insert(0, entry)
        return copy.deepcopy(entry)

    def add_comment(self, entity_id: str, record_id: str, body: str, actor: dict | None = None) -> dict:
        return self.add_event(entity_id, record_id, "comment", {"body": body}, actor=actor)

    def add_change(self, entity_id: str, record_id: str, changes: list[dict], actor: dict | None = None) -> dict:
        return self.add_event(entity_id, record_id, "change", {"changes": copy.deepcopy(changes)}, actor=actor)

    def add_attachment(self, entity_id: str, record_id: str, attachment: dict, actor: dict | None = None) -> dict:
        payload = {
            "attachment_id": attachment.get("id"),
            "filename": attachment.get("filename"),
            "mime_type": attachment.get("mime_type"),
            "size": attachment.get("size"),
        }
        return self.add_event(entity_id, record_id, "attachment", payload, actor=actor)

    def list(self, entity_id: str, record_id: str, limit: int = 50) -> list[dict]:
        items = self._entries.get(self._key(entity_id, str(record_id)), [])
        return [copy.deepcopy(item) for item in items[: max(1, min(limit, 200))]]

    def list_since(self, entity_id: str, record_id: str, since: str, limit: int = 50) -> list[dict]:
        def _parse(val: str) -> datetime | None:
            try:
                return datetime.fromisoformat(str(val).replace("Z", "+00:00"))
            except Exception:
                return None

        since_dt = _parse(since)
        items = self._entries.get(self._key(entity_id, str(record_id)), [])
        if not since_dt:
            return [copy.deepcopy(item) for item in items[: max(1, min(limit, 200))]]
        out: list[dict] = []
        for item in items:
            created_dt = _parse(item.get("created_at", ""))
            if created_dt and created_dt > since_dt:
                out.append(copy.deepcopy(item))
        return out[: max(1, min(limit, 200))]


class MemoryJobStore:
    def __init__(self) -> None:
        self._jobs: Dict[str, dict] = {}
        self._events: Dict[str, List[dict]] = {}

    def enqueue(self, job: dict) -> dict:
        record = copy.deepcopy(job)
        idem = record.get("idempotency_key")
        if idem:
            for existing in self._jobs.values():
                if (
                    existing.get("idempotency_key") == idem
                    and existing.get("workspace_id") == record.get("workspace_id")
                    and existing.get("type") == record.get("type")
                ):
                    return copy.deepcopy(existing)
        record.setdefault("id", str(uuid.uuid4()))
        record.setdefault("status", "queued")
        record.setdefault("attempt", 0)
        record.setdefault("priority", 0)
        record.setdefault("run_at", _now())
        record.setdefault("created_at", _now())
        record.setdefault("updated_at", _now())
        self._jobs[record["id"]] = record
        return copy.deepcopy(record)

    def get(self, job_id: str) -> dict | None:
        job = self._jobs.get(job_id)
        return copy.deepcopy(job) if job else None

    def list(self, workspace_id: str, status: str | None = None, job_type: str | None = None, limit: int = 200) -> list[dict]:
        items = [
            j for j in self._jobs.values()
            if j.get("workspace_id") == workspace_id
        ]
        if status:
            items = [j for j in items if j.get("status") == status]
        if job_type:
            items = [j for j in items if j.get("type") == job_type]
        items.sort(key=lambda j: j.get("created_at", ""), reverse=True)
        return [copy.deepcopy(j) for j in items[:limit]]

    def list_by_payload(self, workspace_id: str, job_type: str, payload_key: str, payload_value: str, limit: int = 200) -> list[dict]:
        items = [
            j for j in self._jobs.values()
            if j.get("workspace_id") == workspace_id
            and j.get("type") == job_type
            and isinstance(j.get("payload"), dict)
            and j.get("payload").get(payload_key) == payload_value
        ]
        items.sort(key=lambda j: j.get("created_at", ""), reverse=True)
        return [copy.deepcopy(j) for j in items[:limit]]

    def update(self, job_id: str, **changes: object) -> dict | None:
        job = self._jobs.get(job_id)
        if not job:
            return None
        job.update(changes)
        job["updated_at"] = _now()
        return copy.deepcopy(job)

    def claim_batch(self, limit: int, worker_id: str) -> list[dict]:
        now = _now()
        ready = []
        for job in self._jobs.values():
            if job.get("status") != "queued":
                continue
            run_at = job.get("run_at")
            if run_at and isinstance(run_at, str) and run_at > now:
                continue
            ready.append(job)
        ready.sort(key=lambda j: (-int(j.get("priority", 0)), j.get("run_at", "")))
        claimed = []
        for job in ready[:limit]:
            job["status"] = "running"
            job["locked_by"] = worker_id
            job["locked_at"] = _now()
            job["attempt"] = int(job.get("attempt", 0)) + 1
            job["updated_at"] = _now()
            claimed.append(copy.deepcopy(job))
        return claimed

    def add_event(self, job_id: str, level: str, message: str, data: dict | None = None) -> dict:
        entry = {
            "id": str(uuid.uuid4()),
            "job_id": job_id,
            "ts": _now(),
            "level": level,
            "message": message,
            "data": copy.deepcopy(data) if data else None,
        }
        self._events.setdefault(job_id, []).append(entry)
        return copy.deepcopy(entry)

    def list_events(self, job_id: str, limit: int = 200) -> list[dict]:
        items = self._events.get(job_id, [])
        return [copy.deepcopy(e) for e in items[:limit]]


class MemoryNotificationStore:
    def __init__(self) -> None:
        self._items: Dict[str, dict] = {}

    def create(self, record: dict) -> dict:
        item = copy.deepcopy(record)
        item.setdefault("id", str(uuid.uuid4()))
        item.setdefault("created_at", _now())
        self._items[item["id"]] = item
        return copy.deepcopy(item)

    def list(self, user_id: str, unread_only: bool = False, limit: int = 200) -> list[dict]:
        items = [n for n in self._items.values() if n.get("recipient_user_id") == user_id]
        if unread_only:
            items = [n for n in items if not n.get("read_at")]
        items.sort(key=lambda n: n.get("created_at", ""), reverse=True)
        return [copy.deepcopy(n) for n in items[:limit]]

    def mark_read(self, notification_id: str) -> dict | None:
        item = self._items.get(notification_id)
        if not item:
            return None
        item["read_at"] = _now()
        return copy.deepcopy(item)

    def mark_all_read(self, user_id: str) -> int:
        count = 0
        for item in self._items.values():
            if item.get("recipient_user_id") == user_id:
                if not item.get("read_at"):
                    item["read_at"] = _now()
                    count += 1
        return count

    def unread_count(self, user_id: str) -> int:
        return sum(
            1
            for n in self._items.values()
            if n.get("recipient_user_id") == user_id
            and not n.get("read_at")
        )


class MemoryEmailStore:
    def __init__(self) -> None:
        self._templates: Dict[str, dict] = {}
        self._outbox: Dict[str, dict] = {}

    def create_template(self, record: dict) -> dict:
        item = copy.deepcopy(record)
        item.setdefault("id", str(uuid.uuid4()))
        item.setdefault("created_at", _now())
        item.setdefault("updated_at", _now())
        item.setdefault("is_active", True)
        self._templates[item["id"]] = item
        return copy.deepcopy(item)

    def update_template(self, template_id: str, updates: dict) -> dict | None:
        item = self._templates.get(template_id)
        if not item:
            return None
        item.update(copy.deepcopy(updates))
        item["updated_at"] = _now()
        return copy.deepcopy(item)

    def list_templates(self, workspace_id: str) -> list[dict]:
        items = [t for t in self._templates.values() if t.get("workspace_id") == workspace_id]
        items.sort(key=lambda t: t.get("created_at", ""), reverse=True)
        return [copy.deepcopy(t) for t in items]

    def get_template(self, template_id: str) -> dict | None:
        item = self._templates.get(template_id)
        return copy.deepcopy(item) if item else None

    def create_outbox(self, record: dict) -> dict:
        item = copy.deepcopy(record)
        item.setdefault("id", str(uuid.uuid4()))
        item.setdefault("status", "queued")
        item.setdefault("created_at", _now())
        self._outbox[item["id"]] = item
        return copy.deepcopy(item)

    def update_outbox(self, outbox_id: str, updates: dict) -> dict | None:
        item = self._outbox.get(outbox_id)
        if not item:
            return None
        item.update(copy.deepcopy(updates))
        return copy.deepcopy(item)

    def list_outbox(self, workspace_id: str, limit: int = 200, template_id: str | None = None) -> list[dict]:
        items = [o for o in self._outbox.values() if o.get("workspace_id") == workspace_id]
        if template_id:
            items = [o for o in items if o.get("template_id") == template_id]
        items.sort(key=lambda o: o.get("created_at", ""), reverse=True)
        return [copy.deepcopy(o) for o in items[:limit]]

    def get_outbox(self, outbox_id: str) -> dict | None:
        item = self._outbox.get(outbox_id)
        return copy.deepcopy(item) if item else None


class MemoryAttachmentStore:
    def __init__(self) -> None:
        self._attachments: Dict[str, dict] = {}
        self._links: Dict[str, dict] = {}

    def create_attachment(self, record: dict) -> dict:
        item = copy.deepcopy(record)
        item.setdefault("id", str(uuid.uuid4()))
        item.setdefault("created_at", _now())
        item.setdefault("workspace_id", record.get("workspace_id") or "default")
        self._attachments[item["id"]] = item
        return copy.deepcopy(item)

    def get_attachment(self, attachment_id: str) -> dict | None:
        item = self._attachments.get(attachment_id)
        return copy.deepcopy(item) if item else None

    def delete_by_source_before(self, source: str, before_ts: str, limit: int = 200, workspace_id: str | None = None) -> list[dict]:
        workspace_id = workspace_id or "default"
        items = [
            a for a in self._attachments.values()
            if a.get("workspace_id") == workspace_id and a.get("source") == source and a.get("created_at") < before_ts
        ]
        items.sort(key=lambda a: a.get("created_at", ""))
        items = items[:limit]
        for item in items:
            self._attachments.pop(item["id"], None)
        return [copy.deepcopy(i) for i in items]

    def link(self, record: dict) -> dict:
        item = copy.deepcopy(record)
        item.setdefault("id", str(uuid.uuid4()))
        self._links[item["id"]] = item
        return copy.deepcopy(item)

    def list_links(self, workspace_id: str, entity_id: str, record_id: str) -> list[dict]:
        items = [
            l for l in self._links.values()
            if l.get("workspace_id") == workspace_id
            and l.get("entity_id") == entity_id
            and l.get("record_id") == record_id
        ]
        return [copy.deepcopy(l) for l in items]

    def list_links_by_purpose(self, purpose: str, limit: int = 200, workspace_id: str | None = None) -> list[dict]:
        workspace_id = workspace_id or "default"
        items = [
            l for l in self._links.values()
            if l.get("workspace_id") == workspace_id and l.get("purpose") == purpose
        ]
        items.sort(key=lambda l: l.get("created_at", ""), reverse=True)
        return [copy.deepcopy(l) for l in items[:limit]]


class MemoryDocTemplateStore:
    def __init__(self) -> None:
        self._items: Dict[str, dict] = {}

    def create(self, record: dict) -> dict:
        item = copy.deepcopy(record)
        item.setdefault("id", str(uuid.uuid4()))
        item.setdefault("created_at", _now())
        item.setdefault("updated_at", _now())
        item.setdefault("paper_size", "A4")
        item.setdefault("margin_top", "12mm")
        item.setdefault("margin_right", "12mm")
        item.setdefault("margin_bottom", "12mm")
        item.setdefault("margin_left", "12mm")
        self._items[item["id"]] = item
        return copy.deepcopy(item)

    def update(self, template_id: str, updates: dict) -> dict | None:
        item = self._items.get(template_id)
        if not item:
            return None
        item.update(copy.deepcopy(updates))
        item["updated_at"] = _now()
        return copy.deepcopy(item)

    def get(self, template_id: str) -> dict | None:
        item = self._items.get(template_id)
        return copy.deepcopy(item) if item else None

    def list(self, workspace_id: str) -> list[dict]:
        items = [t for t in self._items.values() if t.get("workspace_id") == workspace_id]
        items.sort(key=lambda t: t.get("created_at", ""), reverse=True)
        return [copy.deepcopy(t) for t in items]


class MemoryConnectionStore:
    def __init__(self) -> None:
        self._items: Dict[str, dict] = {}

    def create(self, record: dict) -> dict:
        item = copy.deepcopy(record)
        item.setdefault("id", str(uuid.uuid4()))
        item.setdefault("status", "active")
        item.setdefault("created_at", _now())
        item.setdefault("updated_at", _now())
        self._items[item["id"]] = item
        return copy.deepcopy(item)

    def update(self, connection_id: str, updates: dict) -> dict | None:
        item = self._items.get(connection_id)
        if not item:
            return None
        next_updates = copy.deepcopy(updates or {})
        next_updates.pop("id", None)
        next_updates.pop("created_at", None)
        item.update(next_updates)
        item["updated_at"] = _now()
        self._items[connection_id] = item
        return copy.deepcopy(item)

    def get(self, connection_id: str) -> dict | None:
        item = self._items.get(connection_id)
        return copy.deepcopy(item) if item else None

    def list(self, connection_type: str | None = None, status: str | None = None) -> list[dict]:
        items = list(self._items.values())
        if connection_type:
            items = [i for i in items if i.get("type") == connection_type]
        if status:
            items = [i for i in items if i.get("status") == status]
        items.sort(key=lambda i: i.get("created_at", ""), reverse=True)
        return [copy.deepcopy(i) for i in items]

    def get_default_email(self) -> dict | None:
        for item in self._items.values():
            if item.get("type") == "postmark" and item.get("status") == "active":
                return copy.deepcopy(item)
        return None


class MemoryAutomationStore:
    def __init__(self) -> None:
        self._automations: Dict[str, dict] = {}
        self._runs: Dict[str, dict] = {}
        self._step_runs: Dict[str, dict] = {}

    def create(self, record: dict) -> dict:
        item = copy.deepcopy(record)
        item.setdefault("id", str(uuid.uuid4()))
        item.setdefault("status", "draft")
        item.setdefault("created_at", _now())
        item.setdefault("updated_at", _now())
        self._automations[item["id"]] = item
        return copy.deepcopy(item)

    def update(self, automation_id: str, updates: dict) -> dict | None:
        item = self._automations.get(automation_id)
        if not item:
            return None
        item.update(copy.deepcopy(updates))
        item["updated_at"] = _now()
        self._automations[automation_id] = item
        return copy.deepcopy(item)

    def get(self, automation_id: str) -> dict | None:
        item = self._automations.get(automation_id)
        return copy.deepcopy(item) if item else None

    def list(self, status: str | None = None) -> list[dict]:
        items = list(self._automations.values())
        if status:
            items = [i for i in items if i.get("status") == status]
        items.sort(key=lambda i: i.get("updated_at", ""), reverse=True)
        return [copy.deepcopy(i) for i in items]

    def delete(self, automation_id: str) -> bool:
        return self._automations.pop(automation_id, None) is not None

    def create_run(self, record: dict) -> dict:
        item = copy.deepcopy(record)
        item.setdefault("id", str(uuid.uuid4()))
        item.setdefault("status", "queued")
        item.setdefault("current_step_index", 0)
        item.setdefault("created_at", _now())
        item.setdefault("updated_at", _now())
        self._runs[item["id"]] = item
        return copy.deepcopy(item)

    def update_run(self, run_id: str, updates: dict) -> dict | None:
        item = self._runs.get(run_id)
        if not item:
            return None
        item.update(copy.deepcopy(updates))
        item["updated_at"] = _now()
        self._runs[run_id] = item
        return copy.deepcopy(item)

    def get_run(self, run_id: str) -> dict | None:
        item = self._runs.get(run_id)
        return copy.deepcopy(item) if item else None

    def list_runs(self, automation_id: str | None = None) -> list[dict]:
        items = list(self._runs.values())
        if automation_id:
            items = [r for r in items if r.get("automation_id") == automation_id]
        items.sort(key=lambda r: r.get("created_at", ""), reverse=True)
        return [copy.deepcopy(r) for r in items]

    def create_step_run(self, record: dict) -> dict:
        item = copy.deepcopy(record)
        item.setdefault("id", str(uuid.uuid4()))
        item.setdefault("status", "queued")
        item.setdefault("attempt", 0)
        self._step_runs[item["id"]] = item
        return copy.deepcopy(item)

    def update_step_run(self, step_run_id: str, updates: dict) -> dict | None:
        item = self._step_runs.get(step_run_id)
        if not item:
            return None
        item.update(copy.deepcopy(updates))
        self._step_runs[step_run_id] = item
        return copy.deepcopy(item)

    def list_step_runs(self, run_id: str) -> list[dict]:
        items = [r for r in self._step_runs.values() if r.get("run_id") == run_id]
        items.sort(key=lambda r: r.get("step_index", 0))
        return [copy.deepcopy(r) for r in items]

    def get_step_run_by_idempotency(self, idempotency_key: str) -> dict | None:
        for item in self._step_runs.values():
            if item.get("idempotency_key") == idempotency_key:
                return copy.deepcopy(item)
        return None
