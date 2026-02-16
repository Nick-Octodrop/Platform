"""In-memory event bus with strict envelope validation."""

from __future__ import annotations

import copy
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List

from octo.canonical_json import canonical_dumps


Event = Dict[str, Any]
Handler = Callable[[Event], None]


@dataclass
class EventError(Exception):
    message: str

    def __str__(self) -> str:  # pragma: no cover - simple formatting
        return self.message


@dataclass
class EventValidationError(EventError):
    code: str
    path: str | None = None

    def __str__(self) -> str:  # pragma: no cover - simple formatting
        base = f"{self.code}: {self.message}"
        return f"{base} (path={self.path})" if self.path else base


def _raise(code: str, message: str, path: str | None = None) -> None:
    raise EventValidationError(code=code, message=message, path=path)


def _validate_payload(payload: Any) -> None:
    if not isinstance(payload, dict):
        _raise("PAYLOAD_INVALID", "payload must be an object", "payload")
    # canonical_dumps enforces JSON-serializable primitives and rejects NaN/Inf
    try:
        canonical_dumps(payload)
    except Exception as exc:
        _raise("PAYLOAD_INVALID", str(exc), "payload")


def _validate_actor(actor: Any) -> None:
    if actor is None:
        return
    if not isinstance(actor, dict):
        _raise("META_ACTOR_INVALID", "actor must be object or null", "meta.actor")
    if not isinstance(actor.get("id"), str):
        _raise("META_ACTOR_INVALID", "actor.id must be string", "meta.actor.id")
    roles = actor.get("roles")
    if not isinstance(roles, list) or not all(isinstance(r, str) for r in roles):
        _raise("META_ACTOR_INVALID", "actor.roles must be list of strings", "meta.actor.roles")


def _validate_occurred_at(value: Any) -> None:
    if not isinstance(value, str):
        _raise("META_OCCURRED_AT_INVALID", "occurred_at must be string", "meta.occurred_at")
    if not value.endswith("Z"):
        _raise("META_OCCURRED_AT_INVALID", "occurred_at must end with 'Z'", "meta.occurred_at")
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        _raise("META_OCCURRED_AT_INVALID", "occurred_at must be ISO8601", "meta.occurred_at")


def validate_event(event: Any) -> None:
    if not isinstance(event, dict):
        _raise("EVENT_INVALID", "event must be object")
    name = event.get("name")
    if not isinstance(name, str) or not name:
        _raise("EVENT_NAME_INVALID", "name must be non-empty string", "name")

    payload = event.get("payload")
    _validate_payload(payload)

    meta = event.get("meta")
    if not isinstance(meta, dict):
        _raise("META_INVALID", "meta must be object", "meta")

    if not isinstance(meta.get("event_id"), str):
        _raise("META_EVENT_ID_INVALID", "event_id must be string", "meta.event_id")
    _validate_occurred_at(meta.get("occurred_at"))
    if not isinstance(meta.get("module_id"), str):
        _raise("META_MODULE_ID_INVALID", "module_id must be string", "meta.module_id")

    manifest_hash = meta.get("manifest_hash")
    if not isinstance(manifest_hash, str) or not manifest_hash.startswith("sha256:"):
        _raise("META_MANIFEST_HASH_INVALID", "manifest_hash must start with 'sha256:'", "meta.manifest_hash")

    _validate_actor(meta.get("actor"))

    trace_id = meta.get("trace_id")
    if trace_id is not None and not isinstance(trace_id, str):
        _raise("META_TRACE_ID_INVALID", "trace_id must be string or null", "meta.trace_id")

    if meta.get("schema_version") != "1":
        _raise("META_SCHEMA_VERSION_INVALID", "schema_version must be '1'", "meta.schema_version")


def make_event(name: str, payload: dict, meta: dict) -> Event:
    if not isinstance(meta, dict):
        _raise("META_INVALID", "meta must be object", "meta")

    meta_out = copy.deepcopy(meta)
    meta_out.setdefault("event_id", str(uuid.uuid4()))
    if "occurred_at" not in meta_out:
        meta_out["occurred_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    meta_out.setdefault("schema_version", "1")

    event = {
        "name": name,
        "payload": copy.deepcopy(payload),
        "meta": meta_out,
    }
    validate_event(event)
    return event


class EventBus:
    def __init__(self, outbox: "Outbox | None" = None) -> None:
        self._outbox = outbox
        self._subs: Dict[str, List[Handler]] = {}

    def subscribe(self, name: str, handler: Handler) -> None:
        self._subs.setdefault(name, []).append(handler)

    def unsubscribe(self, name: str, handler: Handler) -> bool:
        handlers = self._subs.get(name)
        if not handlers:
            return False
        try:
            handlers.remove(handler)
            if not handlers:
                del self._subs[name]
            return True
        except ValueError:
            return False

    def publish(self, event: dict) -> None:
        validate_event(event)
        if self._outbox is not None:
            self._outbox.enqueue(event)
        for handler in self._subs.get(event["name"], []):
            try:
                handler(event)
            except Exception:
                pass
