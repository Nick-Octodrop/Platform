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


def list_workspace_members(base_url: str, *, token: str, workspace_id: str) -> list[dict[str, Any]]:
    status, payload = api_call("GET", f"{base_url}/access/members", token=token, workspace_id=workspace_id)
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"list workspace members failed: {collect_error_text(payload)}")
    rows = payload.get("members")
    return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []


def _normalize_member_token(value: str) -> str:
    return "".join(str(value or "").strip().lower().split())


def resolve_member_user_ids(
    base_url: str,
    recipients: list[str],
    *,
    token: str,
    workspace_id: str,
) -> list[str]:
    members = list_workspace_members(base_url, token=token, workspace_id=workspace_id)
    by_user_id: dict[str, str] = {}
    by_email: dict[str, str] = {}
    by_email_local: dict[str, str] = {}
    by_name_token: dict[str, str] = {}
    for member in members:
        user_id = str(member.get("user_id") or "").strip()
        if not user_id:
            continue
        email = str(member.get("email") or "").strip().lower()
        name = str(member.get("name") or "").strip()
        by_user_id[user_id] = user_id
        if email:
            by_email[email] = user_id
            local = email.split("@", 1)[0].strip()
            if local:
                by_email_local[local] = user_id
        if name:
            by_name_token[_normalize_member_token(name)] = user_id

    resolved: list[str] = []
    missing: list[str] = []
    seen: set[str] = set()
    for raw in recipients:
        token_value = str(raw or "").strip()
        if not token_value:
            continue
        lowered = token_value.lower()
        normalized = _normalize_member_token(token_value)
        user_id = by_user_id.get(token_value) or by_email.get(lowered) or by_email_local.get(lowered) or by_name_token.get(normalized)
        if not isinstance(user_id, str) or not user_id:
            missing.append(token_value)
            continue
        if user_id in seen:
            continue
        seen.add(user_id)
        resolved.append(user_id)
    if missing:
        raise RuntimeError(f"Could not resolve workspace members: {', '.join(missing)}")
    if not resolved:
        raise RuntimeError("No notification recipients resolved")
    return resolved


def resolve_member_emails(
    base_url: str,
    recipients: list[str],
    *,
    token: str,
    workspace_id: str,
) -> list[str]:
    members = list_workspace_members(base_url, token=token, workspace_id=workspace_id)
    by_user_id: dict[str, str] = {}
    by_email: dict[str, str] = {}
    by_email_local: dict[str, str] = {}
    by_name_token: dict[str, str] = {}
    for member in members:
        user_id = str(member.get("user_id") or "").strip()
        email = str(member.get("email") or "").strip().lower()
        name = str(member.get("name") or "").strip()
        if email:
            if user_id:
                by_user_id[user_id] = email
            by_email[email] = email
            local = email.split("@", 1)[0].strip()
            if local:
                by_email_local[local] = email
        if name and email:
            by_name_token[_normalize_member_token(name)] = email

    resolved: list[str] = []
    missing: list[str] = []
    seen: set[str] = set()
    for raw in recipients:
        token_value = str(raw or "").strip()
        if not token_value:
            continue
        lowered = token_value.lower()
        normalized = _normalize_member_token(token_value)
        email = by_user_id.get(token_value) or by_email.get(lowered) or by_email_local.get(lowered) or by_name_token.get(normalized)
        if not isinstance(email, str) or not email:
            if "@" in lowered:
                email = lowered
            else:
                missing.append(token_value)
                continue
        if email in seen:
            continue
        seen.add(email)
        resolved.append(email)
    if missing:
        raise RuntimeError(f"Could not resolve workspace member emails: {', '.join(missing)}")
    if not resolved:
        raise RuntimeError("No order email recipients resolved")
    return resolved


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


def build_orders_consumer_automation(
    *,
    status: str,
    notify_recipient_user_ids: list[str] | None = None,
    email_recipients: list[str] | None = None,
) -> dict[str, Any]:
    steps: list[dict[str, Any]] = [
        {
            "id": "upsert_shopify_order",
            "kind": "action",
            "action_id": "system.shopify_upsert_order_webhook",
            "inputs": {
                "connection_id": {"var": "trigger.connection_id"},
                "payload": {"var": "trigger.payload"},
            },
        }
    ]
    if notify_recipient_user_ids:
        steps.append(
            {
                "id": "notify_new_shopify_order",
                "kind": "condition",
                "expr": {
                    "op": "and",
                    "conditions": [
                        {
                            "op": "eq",
                            "left": {"var": "steps.upsert_shopify_order.action"},
                            "right": {"literal": "created"},
                        },
                        {
                            "op": "eq",
                            "left": {"var": "trigger.event_key"},
                            "right": {"literal": "shopify.orders.create"},
                        },
                    ],
                },
                "then_steps": [
                    {
                        "id": "send_order_notifications",
                        "kind": "action",
                        "action_id": "system.notify",
                        "inputs": {
                            "recipient_user_ids": notify_recipient_user_ids,
                            "entity_id": "entity.te_sales_order",
                            "record_id": {"var": "steps.upsert_shopify_order.order_record_id"},
                            "title": "New Shopify order {{ record.te_sales_order.order_number or trigger.payload.name or trigger.payload.order_number }}",
                            "body": "{{ record.te_sales_order.customer_name or 'A customer' }} placed Shopify order {{ record.te_sales_order.order_number or trigger.payload.name or trigger.payload.order_number }}.",
                            "severity": "info",
                            "link_mode": "trigger_record",
                        },
                    }
                ]
                + (
                    [
                        {
                            "id": "send_order_email_alert",
                            "kind": "action",
                            "action_id": "system.send_email",
                            "inputs": {
                                "to": email_recipients,
                                "entity_id": "entity.te_sales_order",
                                "record_id": {"var": "steps.upsert_shopify_order.order_record_id"},
                                "subject": "New Shopify order {{ record.te_sales_order.order_number or trigger.payload.name or trigger.payload.order_number }}",
                                "body_text": (
                                    "{{ record.te_sales_order.customer_name or 'A customer' }} placed Shopify order "
                                    "{{ record.te_sales_order.order_number or trigger.payload.name or trigger.payload.order_number }}.\n"
                                    "Total: {{ record.te_sales_order.order_total }} {{ record.te_sales_order.currency }}\n"
                                    "Open in Octodrop: /data/te_sales_order/{{ steps.upsert_shopify_order.order_record_id }}"
                                ),
                            },
                        }
                    ]
                    if email_recipients
                    else []
                ),
            }
        )
    return {
        "name": "Shopify Phase 2 - Orders Inbound",
        "description": "Upsert TE sales orders and lines from inbound Shopify order webhooks and notify the team for new Shopify orders.",
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
        "steps": steps,
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


def all_automation_definitions(
    *,
    publish: bool,
    notify_recipient_user_ids: list[str] | None = None,
    order_email_recipients: list[str] | None = None,
) -> list[dict[str, Any]]:
    status = "published" if publish else "draft"
    return [
        build_orders_consumer_automation(
            status=status,
            notify_recipient_user_ids=notify_recipient_user_ids,
            email_recipients=order_email_recipients,
        ),
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
    parser.add_argument(
        "--order-notify-recipient",
        dest="order_notify_recipients",
        action="append",
        help="Workspace user id, email, email local-part, or display name token to notify for new Shopify orders. Repeatable.",
    )
    parser.add_argument(
        "--skip-order-notifications",
        action="store_true",
        help="Do not install the in-app new-order notification step on the orders inbound automation.",
    )
    parser.add_argument(
        "--order-email-to",
        dest="order_email_to",
        action="append",
        help="Email address, workspace user id, email local-part, or display name token to email for new Shopify orders. Repeatable.",
    )
    parser.add_argument(
        "--skip-order-emails",
        action="store_true",
        help="Do not install the new-order email alert step on the orders inbound automation.",
    )
    args = parser.parse_args()

    if not args.token:
        raise SystemExit("Missing --token or OCTO_API_TOKEN")
    if not args.workspace_id:
        raise SystemExit("Missing --workspace-id or OCTO_WORKSPACE_ID")

    base_url = args.base_url.rstrip("/")
    notify_recipient_user_ids: list[str] | None = None
    order_email_recipients: list[str] | None = None
    if not args.skip_order_notifications:
        requested_recipients = args.order_notify_recipients or ["nick", "kelly"]
        notify_recipient_user_ids = resolve_member_user_ids(
            base_url,
            requested_recipients,
            token=args.token,
            workspace_id=args.workspace_id,
        )
        print(f"[automation] order notifications -> {', '.join(notify_recipient_user_ids)}")
    if not args.skip_order_emails:
        requested_email_recipients = args.order_email_to or args.order_notify_recipients or ["nick", "kelly"]
        order_email_recipients = resolve_member_emails(
            base_url,
            requested_email_recipients,
            token=args.token,
            workspace_id=args.workspace_id,
        )
        print(f"[automation] order emails -> {', '.join(order_email_recipients)}")
    for definition in all_automation_definitions(
        publish=args.publish,
        notify_recipient_user_ids=notify_recipient_user_ids,
        order_email_recipients=order_email_recipients,
    ):
        action, automation = upsert_automation_by_name(base_url, definition, token=args.token, workspace_id=args.workspace_id)
        print(f"[automation] {action} {definition['name']} -> {automation.get('id')}")
        if args.publish:
            published = publish_automation(base_url, str(automation.get("id") or ""), token=args.token, workspace_id=args.workspace_id)
            print(f"[automation] published {definition['name']} -> {published.get('id')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
