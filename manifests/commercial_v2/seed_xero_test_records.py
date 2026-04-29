#!/usr/bin/env python3
from __future__ import annotations

"""
TEST ONLY seed script for a minimal NLight Xero export trial.

This script is intentionally small and only creates or updates:
- 1 customer contact
- 1 customer order
- 1 order line
- 1 draft invoice
- 1 invoice line

Every created record is clearly marked as TEST ONLY.
Do not use this data for live trading or unattended finance posting.
"""

import argparse
import json
import os
from datetime import date, timedelta
from typing import Any
from urllib import error as urlerror
from urllib import parse as urlparse
from urllib import request as urlrequest


REQUIRED_ENTITIES = {
    "entity.biz_contact": "biz_contacts",
    "entity.biz_order": "biz_orders",
    "entity.biz_order_line": "biz_orders",
    "entity.biz_invoice": "biz_invoices",
    "entity.biz_invoice_line": "biz_invoices",
}


class SeedError(RuntimeError):
    pass


def api_call(
    method: str,
    url: str,
    *,
    token: str,
    workspace_id: str,
    body: dict[str, Any] | None = None,
    timeout: int = 60,
) -> tuple[int, dict[str, Any]]:
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "X-Workspace-Id": workspace_id,
    }
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
            message = str(entry.get("message") or "Error").strip()
            path = str(entry.get("path") or "").strip()
            parts.append(f"{message} ({path})" if path else message)
        else:
            parts.append(str(entry))
    return "; ".join(parts)


def ensure_required_entities(base_url: str, token: str, workspace_id: str) -> None:
    checked_modules: set[str] = set()
    for module_id in sorted(set(REQUIRED_ENTITIES.values())):
        if module_id in checked_modules:
            continue
        checked_modules.add(module_id)
        status, payload = api_call(
            "GET",
            f"{base_url}/studio2/modules/{urlparse.quote(module_id, safe='')}/manifest",
            token=token,
            workspace_id=workspace_id,
            timeout=60,
        )
        data = payload.get("data") if isinstance(payload, dict) else None
        manifest = data.get("manifest") if isinstance(data, dict) else None
        if status >= 400 or not is_ok(payload) or not isinstance(manifest, dict):
            raise SeedError(f"Required module {module_id} is not available in this workspace: {collect_error_text(payload)}")


def list_records(base_url: str, entity_id: str, token: str, workspace_id: str) -> list[dict[str, Any]]:
    status, payload = api_call(
        "GET",
        f"{base_url}/records/{urlparse.quote(entity_id, safe='')}?limit=500",
        token=token,
        workspace_id=workspace_id,
        timeout=120,
    )
    if status >= 400 or not is_ok(payload):
        raise SeedError(f"Failed to list {entity_id}: {collect_error_text(payload)}")
    rows = payload.get("records")
    if not isinstance(rows, list):
        return []
    out: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        record_id = row.get("record_id")
        record = row.get("record")
        if isinstance(record_id, str) and record_id and isinstance(record, dict):
            out.append({"record_id": record_id, "record": record})
    return out


def find_record(base_url: str, entity_id: str, token: str, workspace_id: str, match: dict[str, Any]) -> dict[str, Any] | None:
    for item in list_records(base_url, entity_id, token, workspace_id):
        record = item["record"]
        if all(record.get(field_id) == expected for field_id, expected in match.items()):
            return item
    return None


def create_record(base_url: str, entity_id: str, token: str, workspace_id: str, record: dict[str, Any]) -> dict[str, Any]:
    status, payload = api_call(
        "POST",
        f"{base_url}/records/{urlparse.quote(entity_id, safe='')}",
        token=token,
        workspace_id=workspace_id,
        body={"record": record},
        timeout=120,
    )
    if status >= 400 or not is_ok(payload):
        raise SeedError(f"Failed to create {entity_id}: {collect_error_text(payload)}")
    record_id = payload.get("record_id")
    created = payload.get("record")
    if not isinstance(record_id, str) or not record_id:
        raise SeedError(f"Failed to create {entity_id}: missing record_id")
    return {"record_id": record_id, "record": created if isinstance(created, dict) else record}


def update_record(base_url: str, entity_id: str, record_id: str, token: str, workspace_id: str, record: dict[str, Any]) -> dict[str, Any]:
    status, payload = api_call(
        "PUT",
        f"{base_url}/records/{urlparse.quote(entity_id, safe='')}/{urlparse.quote(record_id, safe='')}",
        token=token,
        workspace_id=workspace_id,
        body={"record": record},
        timeout=120,
    )
    if status >= 400 or not is_ok(payload):
        raise SeedError(f"Failed to update {entity_id}/{record_id}: {collect_error_text(payload)}")
    updated = payload.get("record")
    return {"record_id": record_id, "record": updated if isinstance(updated, dict) else record}


def upsert_record(
    base_url: str,
    entity_id: str,
    token: str,
    workspace_id: str,
    *,
    match: dict[str, Any],
    values: dict[str, Any],
) -> dict[str, Any]:
    existing = find_record(base_url, entity_id, token, workspace_id, match)
    if existing:
        merged = {**existing["record"], **values}
        return update_record(base_url, entity_id, existing["record_id"], token, workspace_id, merged)
    return create_record(base_url, entity_id, token, workspace_id, values)


def build_parser() -> argparse.ArgumentParser:
    env_base_url = os.getenv("OCTO_BASE_URL", "").strip() or "http://localhost:8000"
    env_workspace_id = os.getenv("OCTO_WORKSPACE_ID", "").strip()
    env_api_token = os.getenv("OCTO_API_TOKEN", "").strip()
    parser = argparse.ArgumentParser(description="Seed TEST ONLY NLight Xero trial records into one workspace.")
    parser.add_argument("--base-url", default=env_base_url, help="Octodrop API base URL")
    parser.add_argument("--workspace-id", default=env_workspace_id, required=not bool(env_workspace_id), help="Target workspace id")
    parser.add_argument("--api-token", default=env_api_token, required=not bool(env_api_token), help="Admin API token")
    parser.add_argument("--sales-entity", default="NLight BV", help="Sales entity to stamp on order and invoice")
    parser.add_argument("--currency", default="EUR", help="Currency for order and invoice")
    parser.add_argument("--reference", default="TEST-XERO-001", help="Customer reference used for the test order and invoice")
    parser.add_argument("--contact-name", default="TEST ONLY - NLight Xero Trial Customer", help="Test customer name")
    parser.add_argument("--amount", type=float, default=1210.0, help="Net amount for the order and invoice")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    base_url = args.base_url.rstrip("/")
    today = date.today()
    due_date = today + timedelta(days=14)
    test_note = (
        "TEST ONLY. Seeded for a controlled Xero integration trial. "
        "Do not use for live trading, fulfilment, or finance posting without review."
    )

    ensure_required_entities(base_url, args.api_token, args.workspace_id)

    contact = upsert_record(
        base_url,
        "entity.biz_contact",
        args.api_token,
        args.workspace_id,
        match={"biz_contact.name": args.contact_name},
        values={
            "biz_contact.name": args.contact_name,
            "biz_contact.contact_type": "customer",
            "biz_contact.company_entity_scope": args.sales_entity,
            "biz_contact.email": "test-only-xero-trial@example.invalid",
            "biz_contact.country": "Netherlands",
            "biz_contact.currency_preference": args.currency,
            "biz_contact.billing_city": "Rotterdam",
            "biz_contact.billing_country": "Netherlands",
            "biz_contact.notes": test_note,
            "biz_contact.is_active": True,
        },
    )

    order = upsert_record(
        base_url,
        "entity.biz_order",
        args.api_token,
        args.workspace_id,
        match={"biz_order.customer_reference": args.reference},
        values={
            "biz_order.status": "confirmed",
            "biz_order.customer_id": contact["record_id"],
            "biz_order.sales_entity": args.sales_entity,
            "biz_order.order_date": today.isoformat(),
            "biz_order.currency": args.currency,
            "biz_order.customer_reference": args.reference,
            "biz_order.delivery_terms": "TEST ONLY",
            "biz_order.shipping_destination": "TEST ONLY - no fulfilment",
            "biz_order.notes": test_note,
            "biz_order.deposit_percent": 0,
        },
    )

    order_line = upsert_record(
        base_url,
        "entity.biz_order_line",
        args.api_token,
        args.workspace_id,
        match={
            "biz_order_line.customer_order_id": order["record_id"],
            "biz_order_line.description": "TEST ONLY - Xero trial order line",
        },
        values={
            "biz_order_line.customer_order_id": order["record_id"],
            "biz_order_line.description": "TEST ONLY - Xero trial order line",
            "biz_order_line.sales_entity_snapshot": args.sales_entity,
            "biz_order_line.currency_snapshot": args.currency,
            "biz_order_line.uom": "EA",
            "biz_order_line.quantity": 1,
            "biz_order_line.unit_price": args.amount,
            "biz_order_line.unit_cost_snapshot": 0,
        },
    )

    invoice = upsert_record(
        base_url,
        "entity.biz_invoice",
        args.api_token,
        args.workspace_id,
        match={
            "biz_invoice.customer_reference": args.reference,
            "biz_invoice.invoice_type": "final",
        },
        values={
            "biz_invoice.status": "draft",
            "biz_invoice.invoice_type": "final",
            "biz_invoice.customer_id": contact["record_id"],
            "biz_invoice.source_order_id": order["record_id"],
            "biz_invoice.sales_entity": args.sales_entity,
            "biz_invoice.invoice_date": today.isoformat(),
            "biz_invoice.due_date": due_date.isoformat(),
            "biz_invoice.currency": args.currency,
            "biz_invoice.customer_reference": args.reference,
            "biz_invoice.notes": test_note,
            "biz_invoice.source_order_total_snapshot": args.amount,
            "biz_invoice.deposit_percent_snapshot": 0,
            "biz_invoice.amount_paid": 0,
        },
    )

    invoice_line = upsert_record(
        base_url,
        "entity.biz_invoice_line",
        args.api_token,
        args.workspace_id,
        match={
            "biz_invoice_line.invoice_id": invoice["record_id"],
            "biz_invoice_line.description": "TEST ONLY - Xero trial invoice line",
        },
        values={
            "biz_invoice_line.invoice_id": invoice["record_id"],
            "biz_invoice_line.description": "TEST ONLY - Xero trial invoice line",
            "biz_invoice_line.sales_entity_snapshot": args.sales_entity,
            "biz_invoice_line.currency_snapshot": args.currency,
            "biz_invoice_line.uom": "EA",
            "biz_invoice_line.quantity": 1,
            "biz_invoice_line.unit_price": args.amount,
        },
    )

    print("Created or updated TEST ONLY records:")
    print(f"- Contact:      {contact['record_id']}  {args.contact_name}")
    print(f"- Order:        {order['record_id']}  {args.reference}")
    print(f"- Order line:   {order_line['record_id']}  amount={args.amount:.2f} {args.currency}")
    print(f"- Invoice:      {invoice['record_id']}  draft final invoice")
    print(f"- Invoice line: {invoice_line['record_id']}  amount={args.amount:.2f} {args.currency}")
    print("")
    print("This data is marked TEST ONLY. Review and delete it after the Xero trial is complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
