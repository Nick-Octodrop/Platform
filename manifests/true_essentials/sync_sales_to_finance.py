#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from typing import Any, NamedTuple
from urllib import error as urlerror
from urllib import parse as urlparse
from urllib import request as urlrequest


class LocalRecord(NamedTuple):
    record_id: str
    record: dict[str, Any]


def api_call(
    method: str,
    url: str,
    *,
    token: str | None = None,
    workspace_id: str | None = None,
    body: dict[str, Any] | None = None,
    timeout: int = 120,
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


def list_records(
    base_url: str,
    entity_id: str,
    *,
    token: str,
    workspace_id: str,
    fields: list[str] | None = None,
    cap: int = 5000,
) -> list[LocalRecord]:
    out: list[LocalRecord] = []
    cursor: str | None = None
    while len(out) < cap:
        params: dict[str, str | int] = {"limit": min(200, cap - len(out))}
        if cursor:
            params["cursor"] = cursor
        if fields:
            params["fields"] = ",".join(fields)
        status, payload = api_call(
            "GET",
            f"{base_url}/records/{urlparse.quote(entity_id, safe='')}?{urlparse.urlencode(params)}",
            token=token,
            workspace_id=workspace_id,
            timeout=180,
        )
        if status >= 400 or not is_ok(payload):
            raise RuntimeError(f"list records failed for {entity_id}: {collect_error_text(payload)}")
        rows = payload.get("records")
        if not isinstance(rows, list) or not rows:
            break
        for row in rows:
            if not isinstance(row, dict):
                continue
            record_id = row.get("record_id")
            record = row.get("record")
            if isinstance(record_id, str) and record_id and isinstance(record, dict):
                out.append(LocalRecord(record_id=record_id, record=record))
        cursor = payload.get("next_cursor") if isinstance(payload.get("next_cursor"), str) else None
        if not cursor:
            break
    return out


def create_record(base_url: str, entity_id: str, values: dict[str, Any], *, token: str, workspace_id: str) -> LocalRecord:
    status, payload = api_call(
        "POST",
        f"{base_url}/records/{urlparse.quote(entity_id, safe='')}",
        token=token,
        workspace_id=workspace_id,
        body={"record": values},
        timeout=180,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"create {entity_id} failed: {collect_error_text(payload)}")
    record_id = payload.get("record_id")
    record = payload.get("record")
    if not isinstance(record_id, str) or not record_id:
        raise RuntimeError(f"create {entity_id} failed: missing record_id")
    return LocalRecord(record_id=record_id, record=record if isinstance(record, dict) else values)


def patch_record(base_url: str, entity_id: str, record_id: str, values: dict[str, Any], *, token: str, workspace_id: str) -> LocalRecord:
    status, payload = api_call(
        "PATCH",
        f"{base_url}/ext/v1/records/{urlparse.quote(entity_id, safe='')}/{urlparse.quote(record_id, safe='')}",
        token=token,
        workspace_id=workspace_id,
        body={"record": values},
        timeout=180,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"patch {entity_id}/{record_id} failed: {collect_error_text(payload)}")
    record = payload.get("record")
    return LocalRecord(record_id=record_id, record=record if isinstance(record, dict) else values)


def to_number(value: Any) -> float:
    if value in (None, ""):
        return 0.0
    try:
        return float(value)
    except Exception:
        return 0.0


def build_finance_values_from_sales_order(record_id: str, order: dict[str, Any]) -> dict[str, Any] | None:
    financial_status = str(order.get("te_sales_order.financial_status") or "").strip().lower()
    source_currency = str(order.get("te_sales_order.currency") or "NZD").strip() or "NZD"
    total_paid = round(to_number(order.get("te_sales_order.total_paid")), 2)
    order_total = round(to_number(order.get("te_sales_order.order_total")), 2)
    amount = total_paid if total_paid > 0 else (order_total if financial_status == "paid" else 0.0)
    if financial_status != "paid" or amount <= 0:
        return None
    order_number = str(order.get("te_sales_order.order_number") or "").strip()
    customer_name = str(order.get("te_sales_order.customer_name") or "").strip()
    description = f"Sales income {order_number}".strip() if order_number else "Sales income"
    if customer_name:
        description = f"{description} - {customer_name}"
    entry_date = str(order.get("te_sales_order.order_date") or "").strip()[:10] or datetime.now(timezone.utc).date().isoformat()
    return {
        "te_finance_entry.status": "posted",
        "te_finance_entry.entry_date": entry_date,
        "te_finance_entry.entry_type": "company_income",
        "te_finance_entry.paid_from": "company_funds",
        "te_finance_entry.category": "sales",
        "te_finance_entry.description": description,
        "te_finance_entry.source_currency": source_currency,
        "te_finance_entry.reporting_currency": "NZD",
        "te_finance_entry.source_amount": amount,
        "te_finance_entry.fx_rate_to_nzd": 1,
        "te_finance_entry.amount_nzd": amount,
        "te_finance_entry.company_cash_effect_nzd": amount,
        "te_finance_entry.member_owed_effect_nzd": 0,
        "te_finance_entry.source_order_number": order_number,
        "te_finance_entry.source_entity_id": "entity.te_sales_order",
        "te_finance_entry.source_record_id": record_id,
        "te_finance_entry.shopify_order_id": str(order.get("te_sales_order.shopify_order_id") or "").strip(),
        "te_finance_entry.void_reason": "",
    }


def index_finance_entries(records: list[LocalRecord]) -> tuple[dict[str, LocalRecord], dict[str, LocalRecord]]:
    by_source_record: dict[str, LocalRecord] = {}
    by_shopify_order_id: dict[str, LocalRecord] = {}
    for row in records:
        source_record_id = str(row.record.get("te_finance_entry.source_record_id") or "").strip()
        if source_record_id and source_record_id not in by_source_record:
            by_source_record[source_record_id] = row
        shopify_order_id = str(row.record.get("te_finance_entry.shopify_order_id") or "").strip()
        if shopify_order_id and shopify_order_id not in by_shopify_order_id:
            by_shopify_order_id[shopify_order_id] = row
    return by_source_record, by_shopify_order_id


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill or resync posted finance income entries from TE sales orders.")
    parser.add_argument("--base-url", default=os.getenv("OCTO_BASE_URL", "http://localhost:8000"))
    parser.add_argument("--api-token", default=os.getenv("OCTO_API_TOKEN"))
    parser.add_argument("--workspace-id", default=os.getenv("OCTO_WORKSPACE_ID"))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--void-ineligible", action="store_true", help="Void linked finance entries when the source sales order is no longer fully paid.")
    parser.add_argument("--limit", type=int, default=5000)
    args = parser.parse_args()

    if not args.api_token:
        raise SystemExit("Missing --api-token or OCTO_API_TOKEN")
    if not args.workspace_id:
        raise SystemExit("Missing --workspace-id or OCTO_WORKSPACE_ID")

    base_url = args.base_url.rstrip("/")
    sales_orders = list_records(
        base_url,
        "entity.te_sales_order",
        token=args.api_token,
        workspace_id=args.workspace_id,
        fields=[
            "te_sales_order.order_number",
            "te_sales_order.order_date",
            "te_sales_order.currency",
            "te_sales_order.status",
            "te_sales_order.financial_status",
            "te_sales_order.order_total",
            "te_sales_order.total_paid",
            "te_sales_order.customer_name",
            "te_sales_order.shopify_order_id",
        ],
        cap=max(1, args.limit),
    )
    finance_entries = list_records(
        base_url,
        "entity.te_finance_entry",
        token=args.api_token,
        workspace_id=args.workspace_id,
        fields=[
            "te_finance_entry.status",
            "te_finance_entry.source_record_id",
            "te_finance_entry.shopify_order_id",
        ],
        cap=max(1, args.limit),
    )
    by_source_record, by_shopify_order_id = index_finance_entries(finance_entries)

    created = 0
    updated = 0
    voided = 0
    skipped = 0
    for order_row in sales_orders:
        values = build_finance_values_from_sales_order(order_row.record_id, order_row.record)
        existing = by_source_record.get(order_row.record_id)
        if existing is None:
            shopify_order_id = str(order_row.record.get("te_sales_order.shopify_order_id") or "").strip()
            if shopify_order_id:
                existing = by_shopify_order_id.get(shopify_order_id)
        if values is None:
            if args.void_ineligible and existing is not None and str(existing.record.get("te_finance_entry.status") or "").strip().lower() != "void":
                patch = {
                    "te_finance_entry.status": "void",
                    "te_finance_entry.void_reason": "Auto-voided because the linked sales order is no longer eligible for posted company income.",
                }
                if args.dry_run:
                    print(f"[dry-run] void finance {existing.record_id} <- sales order {order_row.record_id}")
                else:
                    patch_record(base_url, "entity.te_finance_entry", existing.record_id, patch, token=args.api_token, workspace_id=args.workspace_id)
                voided += 1
            else:
                skipped += 1
            continue
        if existing is not None:
            if args.dry_run:
                print(f"[dry-run] update finance {existing.record_id} <- sales order {order_row.record_id}")
            else:
                patch_record(base_url, "entity.te_finance_entry", existing.record_id, values, token=args.api_token, workspace_id=args.workspace_id)
            updated += 1
            continue
        if args.dry_run:
            print(f"[dry-run] create finance <- sales order {order_row.record_id}")
        else:
            create_record(base_url, "entity.te_finance_entry", values, token=args.api_token, workspace_id=args.workspace_id)
        created += 1

    print(
        json.dumps(
            {
                "scanned_sales_orders": len(sales_orders),
                "scanned_finance_entries": len(finance_entries),
                "created": created,
                "updated": updated,
                "voided": voided,
                "skipped": skipped,
                "dry_run": bool(args.dry_run),
                "void_ineligible": bool(args.void_ineligible),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
