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
    status, payload = api_call(
        "GET",
        f"{base_url}/automations",
        token=token,
        workspace_id=workspace_id,
    )
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


def build_finance_values_patch(record_id_expr: str, order_expr: str) -> dict[str, Any]:
    return {
        "te_finance_entry.status": "posted",
        "te_finance_entry.entry_date": "{{ (" + order_expr + ".te_sales_order.order_date | default('', true))[:10] or trigger.timestamp[:10] }}",
        "te_finance_entry.entry_type": "company_income",
        "te_finance_entry.paid_from": "company_funds",
        "te_finance_entry.category": "sales",
        "te_finance_entry.description": (
            "{% set order_number = " + order_expr + ".te_sales_order.order_number | default('', true) %}"
            "{% set customer_name = " + order_expr + ".te_sales_order.customer_name | default('', true) %}"
            "{% if order_number and customer_name %}Sales income {{ order_number }} - {{ customer_name }}"
            "{% elif order_number %}Sales income {{ order_number }}"
            "{% else %}Sales income{% endif %}"
        ),
        "te_finance_entry.source_currency": "{{ " + order_expr + ".te_sales_order.currency | default('NZD', true) }}",
        "te_finance_entry.reporting_currency": "NZD",
        "te_finance_entry.source_amount": (
            "{% if (" + order_expr + ".te_sales_order.total_paid | default(0, true) | float) > 0 %}"
            "{{ " + order_expr + ".te_sales_order.total_paid | default(0, true) }}"
            "{% else %}{{ " + order_expr + ".te_sales_order.order_total | default(0, true) }}{% endif %}"
        ),
        "te_finance_entry.fx_rate_to_nzd": 1,
        "te_finance_entry.amount_nzd": (
            "{% if (" + order_expr + ".te_sales_order.total_paid | default(0, true) | float) > 0 %}"
            "{{ " + order_expr + ".te_sales_order.total_paid | default(0, true) }}"
            "{% else %}{{ " + order_expr + ".te_sales_order.order_total | default(0, true) }}{% endif %}"
        ),
        "te_finance_entry.company_cash_effect_nzd": (
            "{% if (" + order_expr + ".te_sales_order.total_paid | default(0, true) | float) > 0 %}"
            "{{ " + order_expr + ".te_sales_order.total_paid | default(0, true) }}"
            "{% else %}{{ " + order_expr + ".te_sales_order.order_total | default(0, true) }}{% endif %}"
        ),
        "te_finance_entry.member_owed_effect_nzd": 0,
        "te_finance_entry.source_order_number": "{{ " + order_expr + ".te_sales_order.order_number | default('', true) }}",
        "te_finance_entry.source_entity_id": "entity.te_sales_order",
        "te_finance_entry.source_record_id": record_id_expr,
        "te_finance_entry.shopify_order_id": "{{ " + order_expr + ".te_sales_order.shopify_order_id | default('', true) }}",
        "te_finance_entry.void_reason": "",
    }


def build_sales_finance_sync_automation(*, status: str) -> dict[str, Any]:
    finance_values = build_finance_values_patch("{{ trigger.record_id }}", "steps.load_sales_order.first.record")
    return {
        "name": "TE Sales -> Finance Income",
        "description": "Auto-post eligible paid sales orders into Finance as posted company income entries.",
        "status": status,
        "trigger": {
            "kind": "event",
            "event_types": ["record.created", "record.updated"],
            "filters": [
                {"path": "entity_id", "op": "eq", "value": "entity.te_sales_order"},
            ],
        },
        "steps": [
            {
                "id": "load_sales_order",
                "kind": "action",
                "action_id": "system.query_records",
                "store_as": "load_sales_order",
                "inputs": {
                    "entity_id": "entity.te_sales_order",
                    "limit": 1,
                    "filter_expr": {
                        "op": "eq",
                        "field": "te_sales_order.id",
                        "value": "{{ trigger.record_id }}",
                    },
                },
            },
            {
                "id": "load_existing_finance",
                "kind": "action",
                "action_id": "system.query_records",
                "store_as": "load_existing_finance",
                "inputs": {
                    "entity_id": "entity.te_finance_entry",
                    "limit": 1,
                    "filter_expr": {
                        "op": "eq",
                        "field": "te_finance_entry.source_record_id",
                        "value": "{{ trigger.record_id }}",
                    },
                },
            },
            {
                "id": "sales_order_is_eligible",
                "kind": "condition",
                "expr": {
                    "op": "and",
                    "children": [
                        {
                            "op": "eq",
                            "left": {"var": "steps.load_sales_order.first.record.te_sales_order.financial_status"},
                            "right": {"literal": "paid"},
                        },
                        {
                            "op": "or",
                            "children": [
                                {
                                    "op": "gt",
                                    "left": {"var": "steps.load_sales_order.first.record.te_sales_order.total_paid"},
                                    "right": {"literal": 0},
                                },
                                {
                                    "op": "gt",
                                    "left": {"var": "steps.load_sales_order.first.record.te_sales_order.order_total"},
                                    "right": {"literal": 0},
                                },
                            ],
                        },
                    ],
                },
                "then_steps": [
                    {
                        "id": "finance_entry_exists",
                        "kind": "condition",
                        "expr": {"op": "exists", "left": {"var": "steps.load_existing_finance.first.record_id"}},
                        "then_steps": [
                            {
                                "id": "update_finance_income",
                                "kind": "action",
                                "action_id": "system.update_record",
                                "inputs": {
                                    "entity_id": "entity.te_finance_entry",
                                    "record_id": "{{ steps.load_existing_finance.first.record_id }}",
                                    "patch": finance_values,
                                },
                            }
                        ],
                        "else_steps": [
                            {
                                "id": "create_finance_income",
                                "kind": "action",
                                "action_id": "system.create_record",
                                "inputs": {
                                    "entity_id": "entity.te_finance_entry",
                                    "values": finance_values,
                                },
                            }
                        ],
                    }
                ],
                "else_steps": [
                    {
                        "id": "void_existing_finance_if_present",
                        "kind": "condition",
                        "expr": {"op": "exists", "left": {"var": "steps.load_existing_finance.first.record_id"}},
                        "then_steps": [
                            {
                                "id": "void_finance_income",
                                "kind": "action",
                                "action_id": "system.update_record",
                                "inputs": {
                                    "entity_id": "entity.te_finance_entry",
                                    "record_id": "{{ steps.load_existing_finance.first.record_id }}",
                                    "patch": {
                                        "te_finance_entry.status": "void",
                                        "te_finance_entry.void_reason": "Auto-voided because the linked sales order is no longer eligible for posted company income.",
                                    },
                                },
                            }
                        ],
                    }
                ],
            },
        ],
    }


def upsert_automation_by_name(base_url: str, definition: dict[str, Any], *, token: str, workspace_id: str) -> tuple[str, dict[str, Any]]:
    existing = next((row for row in list_automations(base_url, token=token, workspace_id=workspace_id) if str(row.get("name") or "").strip() == definition["name"]), None)
    if existing:
        updated = update_automation(base_url, str(existing.get("id") or ""), definition, token=token, workspace_id=workspace_id)
        return "updated", updated
    created = create_automation(base_url, definition, token=token, workspace_id=workspace_id)
    return "created", created


def main() -> int:
    parser = argparse.ArgumentParser(description="Register the TE Sales -> Finance company-income automation.")
    parser.add_argument("--base-url", default=os.getenv("OCTO_BASE_URL", "http://localhost:8000"))
    parser.add_argument("--token", default=os.getenv("OCTO_API_TOKEN"))
    parser.add_argument("--workspace-id", default=os.getenv("OCTO_WORKSPACE_ID"))
    parser.add_argument("--publish", action="store_true", help="Publish the automation after create/update")
    args = parser.parse_args()

    if not args.token:
        raise SystemExit("Missing --token or OCTO_API_TOKEN")
    if not args.workspace_id:
        raise SystemExit("Missing --workspace-id or OCTO_WORKSPACE_ID")

    base_url = args.base_url.rstrip("/")
    definition = build_sales_finance_sync_automation(status="published" if args.publish else "draft")
    action, automation = upsert_automation_by_name(base_url, definition, token=args.token, workspace_id=args.workspace_id)
    print(f"[automation] {action} {definition['name']} -> {automation.get('id')}")
    if args.publish:
        published = publish_automation(base_url, str(automation.get("id") or ""), token=args.token, workspace_id=args.workspace_id)
        print(f"[automation] published {definition['name']} -> {published.get('id')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
