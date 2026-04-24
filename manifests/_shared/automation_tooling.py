#!/usr/bin/env python3
from __future__ import annotations

from typing import Any

from manifest_tooling import api_call, collect_error_text, is_ok


def list_automations(base_url: str, *, token: str, workspace_id: str) -> list[dict[str, Any]]:
    status, payload = api_call(
        "GET",
        f"{base_url}/automations",
        token=token,
        workspace_id=workspace_id,
        timeout=120,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"list automations failed: {collect_error_text(payload)}")
    rows = payload.get("automations")
    return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []


def create_automation(
    base_url: str,
    definition: dict[str, Any],
    *,
    token: str,
    workspace_id: str,
) -> dict[str, Any]:
    status, payload = api_call(
        "POST",
        f"{base_url}/automations",
        token=token,
        workspace_id=workspace_id,
        body=definition,
        timeout=120,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"create automation '{definition.get('name')}' failed: {collect_error_text(payload)}")
    item = payload.get("automation")
    if not isinstance(item, dict):
        raise RuntimeError(f"create automation '{definition.get('name')}' failed: missing automation payload")
    return item


def update_automation(
    base_url: str,
    automation_id: str,
    definition: dict[str, Any],
    *,
    token: str,
    workspace_id: str,
) -> dict[str, Any]:
    status, payload = api_call(
        "PUT",
        f"{base_url}/automations/{automation_id}",
        token=token,
        workspace_id=workspace_id,
        body=definition,
        timeout=120,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"update automation '{definition.get('name')}' failed: {collect_error_text(payload)}")
    item = payload.get("automation")
    if not isinstance(item, dict):
        raise RuntimeError(f"update automation '{definition.get('name')}' failed: missing automation payload")
    return item


def publish_automation(
    base_url: str,
    automation_id: str,
    *,
    token: str,
    workspace_id: str,
) -> dict[str, Any]:
    status, payload = api_call(
        "POST",
        f"{base_url}/automations/{automation_id}/publish",
        token=token,
        workspace_id=workspace_id,
        body={},
        timeout=120,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"publish automation '{automation_id}' failed: {collect_error_text(payload)}")
    item = payload.get("automation")
    if not isinstance(item, dict):
        raise RuntimeError(f"publish automation '{automation_id}' failed: missing automation payload")
    return item


def upsert_automation_by_name(
    base_url: str,
    definition: dict[str, Any],
    *,
    token: str,
    workspace_id: str,
    publish: bool,
    dry_run: bool,
) -> dict[str, Any]:
    existing = next(
        (
            row
            for row in list_automations(base_url, token=token, workspace_id=workspace_id)
            if str(row.get("name") or "").strip() == definition["name"]
        ),
        None,
    )
    if dry_run:
        action = "update" if existing else "create"
        publish_suffix = " + publish" if publish else ""
        print(f"[automation] {action:6} {definition['name']}{publish_suffix}")
        return existing or {"id": "dry-run-automation", **definition}
    if existing and isinstance(existing.get("id"), str) and existing["id"]:
        next_status = definition["status"]
        if not publish and str(existing.get("status") or "").strip() in {"draft", "published", "disabled"}:
            next_status = str(existing.get("status")).strip()
        saved = update_automation(
            base_url,
            existing["id"],
            {**definition, "status": next_status},
            token=token,
            workspace_id=workspace_id,
        )
        print(f"[automation] updated {definition['name']} -> {saved.get('id')}")
    else:
        saved = create_automation(base_url, definition, token=token, workspace_id=workspace_id)
        print(f"[automation] created {definition['name']} -> {saved.get('id')}")
    if publish and isinstance(saved.get("id"), str) and saved["id"]:
        saved = publish_automation(base_url, saved["id"], token=token, workspace_id=workspace_id)
        print(f"[automation] published {definition['name']} -> {saved.get('id')}")
    return saved
