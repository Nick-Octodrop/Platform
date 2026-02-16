import hashlib
import json
import time
from dataclasses import dataclass, field
from typing import Any, Callable


MAX_PROGRESS_EVENTS = 200
MAX_SUMMARY_BULLETS = 10
MAX_TOP_ERRORS = 5
MAX_CALLS_PREVIEW = 10


def _hash_json(value: Any) -> str:
    try:
        payload = json.dumps(value, sort_keys=True, separators=(",", ":"))
    except Exception:
        payload = json.dumps(str(value))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _truncate(value: Any, limit: int = 500) -> Any:
    if isinstance(value, str):
        return value[:limit]
    return value


def summarize_build_spec(build_spec: dict) -> list[str]:
    if not isinstance(build_spec, dict):
        return []
    bullets: list[str] = []
    goal = build_spec.get("goal")
    if isinstance(goal, str) and goal.strip():
        bullets.append(f"Goal: {goal.strip()}")
    entities = build_spec.get("entities")
    if isinstance(entities, list):
        ids = [e.get("id") for e in entities if isinstance(e, dict) and isinstance(e.get("id"), str)]
        if ids:
            bullets.append(f"Entities: {', '.join(ids[:6])}")
    relations = build_spec.get("relations")
    if isinstance(relations, list) and relations:
        bullets.append(f"Relations: {len(relations)}")
    patterns = build_spec.get("ui_patterns")
    if isinstance(patterns, list) and patterns:
        names = []
        for pat in patterns:
            if isinstance(pat, dict):
                name = pat.get("pattern")
                ent = pat.get("entity")
                if name and ent:
                    names.append(f"{name}({ent})")
                elif name:
                    names.append(str(name))
        if names:
            bullets.append(f"Patterns: {', '.join(names[:4])}")
    workflows = build_spec.get("workflows")
    if isinstance(workflows, list) and workflows:
        bullets.append(f"Workflows: {len(workflows)}")
    return bullets[:MAX_SUMMARY_BULLETS]


def summarize_plan(plan_payload: dict | None, notes_text: str | None = None) -> list[str]:
    bullets: list[str] = []
    if isinstance(plan_payload, dict):
        steps = plan_payload.get("steps")
        if isinstance(steps, list) and steps:
            for step in steps[:MAX_SUMMARY_BULLETS]:
                if isinstance(step, str):
                    bullets.append(step.strip())
    if not bullets and isinstance(notes_text, str) and notes_text.strip():
        bullets.append(notes_text.strip()[:200])
    return bullets[:MAX_SUMMARY_BULLETS]


def preview_calls(calls: list[dict], debug: bool = False) -> list[dict]:
    if not isinstance(calls, list):
        return []
    if debug:
        return calls[:MAX_CALLS_PREVIEW]
    preview: list[dict] = []
    for call in calls[:MAX_CALLS_PREVIEW]:
        if not isinstance(call, dict):
            continue
        item = {
            "tool": call.get("tool"),
            "module_id": call.get("module_id") or call.get("args", {}).get("module_id"),
            "entity_id": call.get("entity_id") or call.get("args", {}).get("entity_id"),
        }
        preview.append({k: v for k, v in item.items() if v})
    return preview


def diff_manifest(before: dict, after: dict) -> dict:
    def _count(key: str, obj: dict) -> int:
        val = obj.get(key)
        if isinstance(val, list):
            return len(val)
        return 0

    before = before or {}
    after = after or {}
    summary = {
        "entities_added": _count("entities", after) - _count("entities", before),
        "pages_added": _count("pages", after) - _count("pages", before),
        "views_added": _count("views", after) - _count("views", before),
        "actions_added": _count("actions", after) - _count("actions", before),
        "relations_added": _count("relations", after) - _count("relations", before),
        "workflows_added": _count("workflows", after) - _count("workflows", before),
        "nav_changes": 0,
    }
    before_nav = before.get("app", {}).get("nav") if isinstance(before.get("app"), dict) else None
    after_nav = after.get("app", {}).get("nav") if isinstance(after.get("app"), dict) else None
    if isinstance(before_nav, list) and isinstance(after_nav, list):
        summary["nav_changes"] = len(after_nav) - len(before_nav)
    summary["manifest_hash"] = _hash_json(after)
    return summary


def top_errors(errors: list[dict]) -> list[dict]:
    items: list[dict] = []
    if not isinstance(errors, list):
        return items
    for err in errors[:MAX_TOP_ERRORS]:
        if not isinstance(err, dict):
            continue
        items.append(
            {
                "code": err.get("code"),
                "message": _truncate(err.get("message"), 200),
                "path": err.get("path") or err.get("json_pointer"),
                "module_id": err.get("module_id"),
            }
        )
    return items


@dataclass
class AgentProgress:
    request_id: str
    module_id: str
    stream_debug: bool = False
    started_ms: int = field(default_factory=lambda: int(time.time() * 1000))
    events: list[dict] = field(default_factory=list)
    sink: Callable[[str], None] | None = None

    def emit(self, event_type: str, phase: str, iter_index: int | None, data: dict | None = None) -> None:
        if len(self.events) >= MAX_PROGRESS_EVENTS:
            return
        event = {
            "event": event_type,
            "request_id": self.request_id,
            "module_id": self.module_id,
            "ts_ms": int(time.time() * 1000),
            "iter": iter_index,
            "phase": phase,
            "data": data or {},
        }
        self.events.append(event)
        if self.sink:
            payload = json.dumps(event, separators=(",", ":"))
            frame = f"event: {event_type}\n" f"data: {payload}\n\n"
            self.sink(frame)

    def to_progress_list(self) -> list[dict]:
        return list(self.events)
