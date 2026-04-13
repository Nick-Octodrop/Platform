#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from typing import Any
from urllib import error as urlerror
from urllib import request as urlrequest


def api_call(
    method: str,
    url: str,
    *,
    token: str | None = None,
    workspace_id: str | None = None,
    body: dict[str, Any] | None = None,
    timeout: int = 60,
) -> tuple[int, dict[str, Any]]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if workspace_id:
        headers["X-Workspace-Id"] = workspace_id
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urlrequest.Request(url, method=method, headers=headers, data=data)
    try:
        with urlrequest.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            payload = json.loads(raw.decode("utf-8")) if raw else {}
            return int(resp.status), payload if isinstance(payload, dict) else {}
    except urlerror.HTTPError as exc:
        raw = exc.read()
        try:
            payload = json.loads(raw.decode("utf-8")) if raw else {}
        except Exception:
            payload = {"ok": False, "errors": [{"message": raw.decode("utf-8", errors="replace")}]}
        return int(exc.code), payload if isinstance(payload, dict) else {}


def is_ok(payload: dict[str, Any]) -> bool:
    return bool(payload.get("ok") is True)


def collect_error_text(payload: dict[str, Any]) -> str:
    errors = payload.get("errors")
    if not isinstance(errors, list) or not errors:
        return "Unknown error"
    parts: list[str] = []
    for entry in errors[:8]:
        if isinstance(entry, dict):
            code = entry.get("code")
            message = entry.get("message")
            path = entry.get("path")
            prefix = f"[{code}] " if isinstance(code, str) and code else ""
            suffix = f" ({path})" if isinstance(path, str) and path else ""
            parts.append(f"{prefix}{message or 'Error'}{suffix}")
        else:
            parts.append(str(entry))
    return "; ".join(parts)


def list_sequences(base_url: str, *, token: str | None, workspace_id: str | None) -> list[dict[str, Any]]:
    status, payload = api_call(
        "GET",
        f"{base_url}/settings/document-numbering",
        token=token,
        workspace_id=workspace_id,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"list document numbering failed: {collect_error_text(payload)}")
    rows = payload.get("sequences")
    return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []


def create_sequence(base_url: str, definition: dict[str, Any], *, token: str | None, workspace_id: str | None) -> dict[str, Any]:
    status, payload = api_call(
        "POST",
        f"{base_url}/settings/document-numbering",
        token=token,
        workspace_id=workspace_id,
        body=definition,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"create sequence '{definition.get('code')}' failed: {collect_error_text(payload)}")
    sequence = payload.get("sequence")
    if not isinstance(sequence, dict):
        raise RuntimeError(f"create sequence '{definition.get('code')}' failed: missing sequence payload")
    return sequence


def update_sequence(base_url: str, sequence_id: str, definition: dict[str, Any], *, token: str | None, workspace_id: str | None) -> dict[str, Any]:
    status, payload = api_call(
        "PATCH",
        f"{base_url}/settings/document-numbering/{sequence_id}",
        token=token,
        workspace_id=workspace_id,
        body=definition,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"update sequence '{definition.get('code')}' failed: {collect_error_text(payload)}")
    sequence = payload.get("sequence")
    if not isinstance(sequence, dict):
        raise RuntimeError(f"update sequence '{definition.get('code')}' failed: missing sequence payload")
    return sequence


def desired_definitions() -> list[dict[str, Any]]:
    return [
        {
            "code": "commercial_v2_quotes",
            "name": "Quotes",
            "description": "Auto-number commercial quotes.",
            "target_entity_id": "entity.biz_quote",
            "number_field_id": "biz_quote.quote_number",
            "pattern": "QUO-{YYYY}-{SEQ:4}",
            "scope_type": "global",
            "scope_field_id": None,
            "reset_policy": "yearly",
            "assign_on": "create",
            "trigger_status_values": [],
            "is_active": True,
            "lock_after_assignment": True,
            "allow_admin_override": False,
            "notes": "Commercial numbering for quotes.",
            "sort_order": 100,
        },
        {
            "code": "commercial_v2_orders",
            "name": "Orders",
            "description": "Auto-number orders when they are confirmed.",
            "target_entity_id": "entity.biz_order",
            "number_field_id": "biz_order.order_number",
            "pattern": "SO-{YYYY}-{SEQ:4}",
            "scope_type": "global",
            "scope_field_id": None,
            "reset_policy": "yearly",
            "assign_on": "confirm",
            "trigger_status_values": ["confirmed"],
            "is_active": True,
            "lock_after_assignment": True,
            "allow_admin_override": False,
            "notes": "Commercial numbering for confirmed orders.",
            "sort_order": 110,
        },
        {
            "code": "commercial_v2_purchase_orders",
            "name": "Purchase Orders",
            "description": "Auto-number supplier purchase orders.",
            "target_entity_id": "entity.biz_purchase_order",
            "number_field_id": "biz_purchase_order.po_number",
            "pattern": "PO-{YYYY}-{SEQ:4}",
            "scope_type": "global",
            "scope_field_id": None,
            "reset_policy": "yearly",
            "assign_on": "create",
            "trigger_status_values": [],
            "is_active": True,
            "lock_after_assignment": True,
            "allow_admin_override": False,
            "notes": "Commercial numbering for purchase orders.",
            "sort_order": 120,
        },
        {
            "code": "commercial_v2_invoices",
            "name": "Invoices",
            "description": "Auto-number invoices when they are issued.",
            "target_entity_id": "entity.biz_invoice",
            "number_field_id": "biz_invoice.invoice_number",
            "pattern": "INV-{YYYY}-{SEQ:4}",
            "scope_type": "global",
            "scope_field_id": None,
            "reset_policy": "yearly",
            "assign_on": "issue",
            "trigger_status_values": ["issued"],
            "is_active": True,
            "lock_after_assignment": True,
            "allow_admin_override": False,
            "notes": "Commercial numbering for customer invoices.",
            "sort_order": 130,
        },
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description="Create or update document numbering for Commercial V2.")
    parser.add_argument("--base-url", default=os.getenv("OCTO_BASE_URL", "").strip(), help="Octodrop API base URL")
    parser.add_argument("--token", default=os.getenv("OCTO_API_TOKEN", "").strip(), help="Bearer token")
    parser.add_argument("--workspace-id", default=os.getenv("OCTO_WORKSPACE_ID", "").strip(), help="Workspace ID")
    parser.add_argument("--dry-run", action="store_true", help="Print planned changes without writing")
    args = parser.parse_args()

    base_url = (args.base_url or "").rstrip("/")
    token = (args.token or "").strip()
    workspace_id = (args.workspace_id or "").strip()
    if not base_url:
        raise SystemExit("Missing --base-url or OCTO_BASE_URL")
    if not token:
        raise SystemExit("Missing --token or OCTO_API_TOKEN")
    if not workspace_id:
        raise SystemExit("Missing --workspace-id or OCTO_WORKSPACE_ID")

    existing_by_code = {
        row.get("code"): row
        for row in list_sequences(base_url, token=token, workspace_id=workspace_id)
        if isinstance(row.get("code"), str) and row.get("code")
    }

    for definition in desired_definitions():
        code = definition["code"]
        existing = existing_by_code.get(code)
        if args.dry_run:
            action = "update" if existing else "create"
            print(f"[numbering] {action:6} {code} -> {definition['pattern']} ({definition['assign_on']})")
            continue
        if existing and isinstance(existing.get("id"), str) and existing["id"]:
            saved = update_sequence(base_url, existing["id"], definition, token=token, workspace_id=workspace_id)
            print(f"[numbering] updated {code} -> {saved.get('id')}")
        else:
            saved = create_sequence(base_url, definition, token=token, workspace_id=workspace_id)
            print(f"[numbering] created {code} -> {saved.get('id')}")


if __name__ == "__main__":
    main()
