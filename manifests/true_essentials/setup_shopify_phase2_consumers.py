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
    status, payload = api_call("POST", f"{base_url}/automations", token=token, workspace_id=workspace_id, body=definition)
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"create automation failed: {collect_error_text(payload)}")
    item = payload.get("automation")
    if not isinstance(item, dict):
        raise RuntimeError("create automation failed: missing automation payload")
    return item


def update_automation(base_url: str, automation_id: str, definition: dict[str, Any], *, token: str, workspace_id: str) -> dict[str, Any]:
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


def build_orders_consumer_automation(*, status: str) -> dict[str, Any]:
    return {
        "name": "Shopify Phase 2 - Orders Inbound",
        "description": "Upsert TE sales orders and lines from inbound Shopify order webhooks.",
        "status": status,
        "trigger": {
            "kind": "event",
            "event_types": [
                "integration.webhook.shopify.orders.create",
                "integration.webhook.shopify.orders.updated",
                "integration.webhook.shopify.orders.cancelled",
            ],
            "filters": [],
        },
        "steps": [
            {
                "id": "upsert_shopify_order",
                "kind": "action",
                "action_id": "system.shopify_upsert_order_webhook",
                "inputs": {
                    "connection_id": {"var": "trigger.connection_id"},
                    "payload": {"var": "trigger.payload"},
                },
            }
        ],
    }


def build_refunds_consumer_automation(*, status: str) -> dict[str, Any]:
    return {
        "name": "Shopify Phase 2 - Refunds Inbound",
        "description": "Refresh the linked TE sales order when Shopify emits a refund webhook.",
        "status": status,
        "trigger": {
            "kind": "event",
            "event_types": ["integration.webhook.shopify.refunds.create"],
            "filters": [],
        },
        "steps": [
            {
                "id": "refresh_refunded_order",
                "kind": "action",
                "action_id": "system.shopify_refresh_order_from_refund_webhook",
                "inputs": {
                    "connection_id": {"var": "trigger.connection_id"},
                    "payload": {"var": "trigger.payload"},
                },
            }
        ],
    }


def build_customers_consumer_automation(*, status: str) -> dict[str, Any]:
    return {
        "name": "Shopify Phase 2 - Customers Inbound",
        "description": "Upsert TE customer records from inbound Shopify customer webhooks.",
        "status": status,
        "trigger": {
            "kind": "event",
            "event_types": [
                "integration.webhook.shopify.customers.create",
                "integration.webhook.shopify.customers.update",
            ],
            "filters": [],
        },
        "steps": [
            {
                "id": "upsert_shopify_customer",
                "kind": "action",
                "action_id": "system.shopify_upsert_customer_webhook",
                "inputs": {
                    "connection_id": {"var": "trigger.connection_id"},
                    "payload": {"var": "trigger.payload"},
                },
            }
        ],
    }


def build_products_consumer_automation(*, status: str) -> dict[str, Any]:
    return {
        "name": "Shopify Phase 2 - Products Inbound",
        "description": "Upsert TE products from inbound Shopify product webhooks.",
        "status": status,
        "trigger": {
            "kind": "event",
            "event_types": [
                "integration.webhook.shopify.products.create",
                "integration.webhook.shopify.products.update",
            ],
            "filters": [],
        },
        "steps": [
            {
                "id": "upsert_shopify_product",
                "kind": "action",
                "action_id": "system.shopify_upsert_product_webhook",
                "inputs": {
                    "connection_id": {"var": "trigger.connection_id"},
                    "payload": {"var": "trigger.payload"},
                },
            }
        ],
    }


def all_automation_definitions(*, publish: bool) -> list[dict[str, Any]]:
    status = "published" if publish else "draft"
    return [
        build_orders_consumer_automation(status=status),
        build_refunds_consumer_automation(status=status),
        build_customers_consumer_automation(status=status),
        build_products_consumer_automation(status=status),
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description="Register the TE Shopify phase-2 webhook consumer automations.")
    parser.add_argument("--base-url", default=os.getenv("OCTO_BASE_URL", "http://localhost:8000"))
    parser.add_argument("--token", default=os.getenv("OCTO_API_TOKEN"))
    parser.add_argument("--workspace-id", default=os.getenv("OCTO_WORKSPACE_ID"))
    parser.add_argument("--publish", action="store_true", help="Publish the automations after create/update")
    args = parser.parse_args()

    if not args.token:
        raise SystemExit("Missing --token or OCTO_API_TOKEN")
    if not args.workspace_id:
        raise SystemExit("Missing --workspace-id or OCTO_WORKSPACE_ID")

    base_url = args.base_url.rstrip("/")
    for definition in all_automation_definitions(publish=args.publish):
        action, automation = upsert_automation_by_name(base_url, definition, token=args.token, workspace_id=args.workspace_id)
        print(f"[automation] {action} {definition['name']} -> {automation.get('id')}")
        if args.publish:
            published = publish_automation(base_url, str(automation.get("id") or ""), token=args.token, workspace_id=args.workspace_id)
            print(f"[automation] published {definition['name']} -> {published.get('id')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
