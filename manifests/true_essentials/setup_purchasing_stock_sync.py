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
    return payload.get("ok") is True


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


def list_automations(base_url: str, *, token: str, workspace_id: str) -> list[dict[str, Any]]:
    status, payload = api_call("GET", f"{base_url}/automations", token=token, workspace_id=workspace_id)
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"list automations failed: {collect_error_text(payload)}")
    rows = payload.get("automations")
    return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []


def create_automation(base_url: str, definition: dict[str, Any], *, token: str, workspace_id: str) -> dict[str, Any]:
    status, payload = api_call(
        "POST",
        f"{base_url}/automations",
        token=token,
        workspace_id=workspace_id,
        body=definition,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"create automation failed: {collect_error_text(payload)}")
    item = payload.get("automation")
    if not isinstance(item, dict):
        raise RuntimeError("create automation failed: missing automation payload")
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
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"update automation failed: {collect_error_text(payload)}")
    item = payload.get("automation")
    if not isinstance(item, dict):
        raise RuntimeError("update automation failed: missing automation payload")
    return item


def publish_automation(base_url: str, automation_id: str, *, token: str, workspace_id: str) -> dict[str, Any]:
    status, payload = api_call(
        "POST",
        f"{base_url}/automations/{automation_id}/publish",
        token=token,
        workspace_id=workspace_id,
        body={},
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"publish automation failed: {collect_error_text(payload)}")
    item = payload.get("automation")
    if not isinstance(item, dict):
        raise RuntimeError("publish automation failed: missing automation payload")
    return item


def query_record_step(step_id: str, entity_id: str, field: str, value: str, *, store_as: str | None = None) -> dict[str, Any]:
    return {
        "id": step_id,
        "kind": "action",
        "action_id": "system.query_records",
        "store_as": store_as or step_id,
        "inputs": {
            "entity_id": entity_id,
            "limit": 1,
            "filter_expr": {"op": "eq", "field": field, "value": value},
        },
    }


def build_po_status_to_lines_automation(*, status: str) -> dict[str, Any]:
    return {
        "name": "TE Purchasing - Sync PO Status To Lines",
        "description": "Keeps supplier-order line status snapshots aligned with the purchase order header; full receipt marks all lines received.",
        "status": status,
        "trigger": {
            "kind": "event",
            "event_types": ["record.updated"],
            "filters": [{"path": "entity_id", "op": "eq", "value": "entity.te_purchase_order"}],
        },
        "steps": [
            {
                "id": "status_changed",
                "kind": "condition",
                "expr": {
                    "op": "neq",
                    "left": {"var": "trigger.before.fields.status"},
                    "right": {"var": "trigger.after.fields.status"},
                },
                "then_steps": [
                    {
                        "id": "load_po_lines",
                        "kind": "action",
                        "action_id": "system.query_records",
                        "store_as": "load_po_lines",
                        "inputs": {
                            "entity_id": "entity.te_purchase_order_line",
                            "limit": 500,
                            "filter_expr": {
                                "op": "eq",
                                "field": "te_purchase_order_line.purchase_order_id",
                                "value": "{{ trigger.record_id }}",
                            },
                        },
                    },
                    {
                        "id": "sync_po_lines",
                        "kind": "foreach",
                        "over": "{{ steps.load_po_lines.records }}",
                        "item_name": "po_line",
                        "steps": [
                            {
                                "id": "po_is_fully_received",
                                "kind": "condition",
                                "expr": {
                                    "op": "eq",
                                    "left": {"var": "trigger.after.fields.status"},
                                    "right": {"literal": "received"},
                                },
                                "then_steps": [
                                    {
                                        "id": "mark_line_received",
                                        "kind": "action",
                                        "action_id": "system.update_record",
                                        "inputs": {
                                            "entity_id": "entity.te_purchase_order_line",
                                            "record_id": "{{ po_line.record_id }}",
                                            "patch": {
                                                "te_purchase_order_line.order_status_snapshot": "received",
                                                "te_purchase_order_line.received_quantity": "{{ po_line.record.te_purchase_order_line.quantity | default(0, true) }}",
                                            },
                                        },
                                    }
                                ],
                                "else_steps": [
                                    {
                                        "id": "sync_line_status",
                                        "kind": "action",
                                        "action_id": "system.update_record",
                                        "inputs": {
                                            "entity_id": "entity.te_purchase_order_line",
                                            "record_id": "{{ po_line.record_id }}",
                                            "patch": {
                                                "te_purchase_order_line.order_status_snapshot": "{{ trigger.after.fields.status | default('draft', true) }}",
                                            },
                                        },
                                    }
                                ],
                            }
                        ],
                    },
                ],
            }
        ],
    }


def build_line_receipt_stock_automation(*, status: str) -> dict[str, Any]:
    stock_on_hand_expr = (
        "{{ "
        "(steps.load_product.first.record.te_product.stock_on_hand | default(0, true) | float) "
        "+ (steps.load_po_line.first.record.te_purchase_order_line.received_quantity | default(0, true) | float) "
        "- (steps.load_po_line.first.record.te_purchase_order_line.stock_posted_quantity | default(0, true) | float) "
        "}}"
    )
    return {
        "name": "TE Purchasing - Post Received Stock",
        "description": "Posts received supplier-order quantities into catalogue stock on hand once, using each PO line's posted quantity as the guard.",
        "status": status,
        "trigger": {
            "kind": "event",
            "event_types": ["record.created", "record.updated"],
            "filters": [{"path": "entity_id", "op": "eq", "value": "entity.te_purchase_order_line"}],
        },
        "steps": [
            query_record_step(
                "load_po_line",
                "entity.te_purchase_order_line",
                "te_purchase_order_line.id",
                "{{ trigger.record_id }}",
                store_as="load_po_line",
            ),
            {
                "id": "line_has_parent",
                "kind": "condition",
                "expr": {"op": "exists", "left": {"var": "steps.load_po_line.first.record.te_purchase_order_line.purchase_order_id"}},
                "then_steps": [
                    query_record_step(
                        "load_purchase_order",
                        "entity.te_purchase_order",
                        "te_purchase_order.id",
                        "{{ steps.load_po_line.first.record.te_purchase_order_line.purchase_order_id }}",
                        store_as="load_purchase_order",
                    ),
                    {
                        "id": "line_status_snapshot_stale",
                        "kind": "condition",
                        "expr": {
                            "op": "neq",
                            "left": {"var": "steps.load_po_line.first.record.te_purchase_order_line.order_status_snapshot"},
                            "right": {"var": "steps.load_purchase_order.first.record.te_purchase_order.status"},
                        },
                        "then_steps": [
                            {
                                "id": "sync_line_status_snapshot",
                                "kind": "action",
                                "action_id": "system.update_record",
                                "inputs": {
                                    "entity_id": "entity.te_purchase_order_line",
                                    "record_id": "{{ trigger.record_id }}",
                                    "patch": {
                                        "te_purchase_order_line.order_status_snapshot": "{{ steps.load_purchase_order.first.record.te_purchase_order.status | default('draft', true) }}",
                                    },
                                },
                            }
                        ],
                    },
                    {
                        "id": "receipt_is_stock_postable",
                        "kind": "condition",
                        "expr": {
                            "op": "and",
                            "children": [
                                {"op": "exists", "left": {"var": "steps.load_po_line.first.record.te_purchase_order_line.product_id"}},
                                {
                                    "op": "in",
                                    "left": {"var": "steps.load_purchase_order.first.record.te_purchase_order.status"},
                                    "right": {"literal": ["partially_received", "received"]},
                                },
                                {
                                    "op": "neq",
                                    "left": {"var": "steps.load_po_line.first.record.te_purchase_order_line.received_quantity"},
                                    "right": {"var": "steps.load_po_line.first.record.te_purchase_order_line.stock_posted_quantity"},
                                },
                            ],
                        },
                        "then_steps": [
                            query_record_step(
                                "load_product",
                                "entity.te_product",
                                "te_product.id",
                                "{{ steps.load_po_line.first.record.te_purchase_order_line.product_id }}",
                                store_as="load_product",
                            ),
                            {
                                "id": "product_found",
                                "kind": "condition",
                                "expr": {"op": "exists", "left": {"var": "steps.load_product.first.record_id"}},
                                "then_steps": [
                                    {
                                        "id": "update_product_stock_on_hand",
                                        "kind": "action",
                                        "action_id": "system.update_record",
                                        "inputs": {
                                            "entity_id": "entity.te_product",
                                            "record_id": "{{ steps.load_product.first.record_id }}",
                                            "patch": {"te_product.stock_on_hand": stock_on_hand_expr},
                                        },
                                    },
                                    {
                                        "id": "mark_line_stock_posted",
                                        "kind": "action",
                                        "action_id": "system.update_record",
                                        "inputs": {
                                            "entity_id": "entity.te_purchase_order_line",
                                            "record_id": "{{ trigger.record_id }}",
                                            "patch": {
                                                "te_purchase_order_line.stock_posted_quantity": "{{ steps.load_po_line.first.record.te_purchase_order_line.received_quantity | default(0, true) }}",
                                            },
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    }


def upsert_automation_by_name(base_url: str, definition: dict[str, Any], *, token: str, workspace_id: str) -> tuple[str, dict[str, Any]]:
    existing = next(
        (row for row in list_automations(base_url, token=token, workspace_id=workspace_id) if str(row.get("name") or "").strip() == definition["name"]),
        None,
    )
    if existing:
        updated = update_automation(base_url, str(existing.get("id") or ""), definition, token=token, workspace_id=workspace_id)
        return "updated", updated
    created = create_automation(base_url, definition, token=token, workspace_id=workspace_id)
    return "created", created


def main() -> int:
    parser = argparse.ArgumentParser(description="Register True Essentials purchasing stock automations.")
    parser.add_argument("--base-url", default=os.getenv("OCTO_BASE_URL", "http://localhost:8000"))
    parser.add_argument("--token", default=os.getenv("OCTO_API_TOKEN"))
    parser.add_argument("--workspace-id", default=os.getenv("OCTO_WORKSPACE_ID"))
    parser.add_argument("--publish", action="store_true", help="Publish automations after create/update")
    args = parser.parse_args()

    if not args.token:
        raise SystemExit("Missing --token or OCTO_API_TOKEN")
    if not args.workspace_id:
        raise SystemExit("Missing --workspace-id or OCTO_WORKSPACE_ID")

    base_url = args.base_url.rstrip("/")
    definitions = [
        build_po_status_to_lines_automation(status="published" if args.publish else "draft"),
        build_line_receipt_stock_automation(status="published" if args.publish else "draft"),
    ]
    for definition in definitions:
        action, automation = upsert_automation_by_name(base_url, definition, token=args.token, workspace_id=args.workspace_id)
        print(f"[automation] {action} {definition['name']} -> {automation.get('id')}")
        if args.publish:
            published = publish_automation(base_url, str(automation.get("id") or ""), token=args.token, workspace_id=args.workspace_id)
            print(f"[automation] published {definition['name']} -> {published.get('id')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
