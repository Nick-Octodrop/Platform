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


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


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


def resolve_connection(
    base_url: str,
    *,
    token: str,
    workspace_id: str,
    connection_id: str | None,
    connection_name: str | None,
) -> dict[str, Any]:
    status, payload = api_call(
        "GET",
        f"{base_url}/integrations/connections",
        token=token,
        workspace_id=workspace_id,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"list connections failed: {collect_error_text(payload)}")
    rows = payload.get("connections")
    connections = [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []
    if connection_id:
        for row in connections:
            if str(row.get("id") or "") == connection_id:
                return row
        raise RuntimeError(f"Connection not found: {connection_id}")
    if connection_name:
        matches = [row for row in connections if str(row.get("name") or "").strip() == connection_name.strip()]
        if not matches:
            raise RuntimeError(f"Connection not found by name: {connection_name}")
        if len(matches) > 1:
            raise RuntimeError(f"Multiple connections matched name: {connection_name}")
        return matches[0]
    raise RuntimeError("Either --connection-id or --connection-name is required")


def manual_connection_request(
    base_url: str,
    connection_id: str,
    *,
    token: str,
    workspace_id: str,
    method: str,
    path: str,
    query: dict[str, Any] | None = None,
) -> dict[str, Any]:
    status, payload = api_call(
        "POST",
        f"{base_url}/integrations/connections/{urlparse.quote(connection_id, safe='')}/request",
        token=token,
        workspace_id=workspace_id,
        body={
            "method": method,
            "path": path,
            "query": query or {},
        },
        timeout=180,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"connection request failed: {collect_error_text(payload)}")
    result = payload.get("result")
    if not isinstance(result, dict):
        raise RuntimeError("connection request failed: missing result payload")
    return result


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
    if not isinstance(record, dict):
        record = values
    return LocalRecord(record_id=record_id, record=record)


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
    if not isinstance(record, dict):
        record = values
    return LocalRecord(record_id=record_id, record=record)


def to_number(value: Any) -> float:
    if value in (None, ""):
        return 0.0
    try:
        return float(value)
    except Exception:
        return 0.0


def order_status(financial_status: str, fulfillment_status: str, cancelled_at: Any) -> str:
    if cancelled_at:
        return "cancelled"
    f_status = (financial_status or "").strip().lower()
    ship_status = (fulfillment_status or "").strip().lower()
    if f_status in {"refunded", "partially_refunded"}:
        return "refunded"
    if ship_status in {"fulfilled", "restocked"}:
        return "fulfilled"
    if f_status in {"paid", "partially_paid"}:
        return "paid"
    return "open"


def map_financial_status(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"paid", "refunded", "partially_refunded", "voided", "pending"}:
        return normalized
    return "pending"


def map_fulfillment_status(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"unfulfilled", "partial", "fulfilled", "restocked"}:
        return normalized
    return "unfulfilled"


def iso_date(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return datetime.now(timezone.utc).date().isoformat()
    return text[:10]


def shipping_amount(order: dict[str, Any]) -> float:
    total = 0.0
    lines = order.get("shipping_lines")
    for line in lines if isinstance(lines, list) else []:
        if not isinstance(line, dict):
            continue
        total += to_number(line.get("discounted_price") if line.get("discounted_price") is not None else line.get("price"))
    return round(total, 2)


def line_tax_total(line_item: dict[str, Any]) -> float:
    total = 0.0
    for tax in line_item.get("tax_lines") if isinstance(line_item.get("tax_lines"), list) else []:
        if isinstance(tax, dict):
            total += to_number(tax.get("price"))
    return round(total, 2)


def line_description(line_item: dict[str, Any]) -> str:
    title = str(line_item.get("title") or "").strip()
    variant_title = str(line_item.get("variant_title") or "").strip()
    if variant_title and variant_title.lower() != "default title":
        return f"{title} - {variant_title}" if title else variant_title
    return title or str(line_item.get("name") or "").strip() or "Shopify line item"


def normalize_shopify_id(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if text.startswith("gid://"):
        return text.rsplit("/", 1)[-1].strip()
    return text


def index_te_products(records: list[LocalRecord]) -> tuple[dict[str, LocalRecord], dict[str, LocalRecord], set[str]]:
    by_variant_id: dict[str, LocalRecord] = {}
    by_sku: dict[str, LocalRecord] = {}
    duplicate_skus: set[str] = set()
    for row in records:
        variant_id = str(row.record.get("te_product.shopify_variant_id") or "").strip()
        if variant_id:
            by_variant_id[variant_id] = row
            normalized_variant_id = normalize_shopify_id(variant_id)
            if normalized_variant_id:
                by_variant_id.setdefault(normalized_variant_id, row)
        sku = str(row.record.get("te_product.sku") or "").strip()
        if not sku:
            continue
        if sku in by_sku:
            duplicate_skus.add(sku)
        else:
            by_sku[sku] = row
    return by_variant_id, by_sku, duplicate_skus


def index_te_customers(records: list[LocalRecord]) -> tuple[dict[str, LocalRecord], dict[str, LocalRecord], set[str]]:
    by_shopify_id: dict[str, LocalRecord] = {}
    by_email: dict[str, LocalRecord] = {}
    duplicate_emails: set[str] = set()
    for row in records:
        shopify_id = str(row.record.get("te_customer.shopify_customer_id") or "").strip()
        if shopify_id:
            by_shopify_id[shopify_id] = row
        email = str(row.record.get("te_customer.email") or "").strip().lower()
        if not email:
            continue
        if email in by_email:
            duplicate_emails.add(email)
        else:
            by_email[email] = row
    return by_shopify_id, by_email, duplicate_emails


def build_order_values(
    existing: dict[str, Any] | None,
    order: dict[str, Any],
    *,
    admin_url: str,
    customer_row: LocalRecord | None = None,
) -> dict[str, Any]:
    financial_status = map_financial_status(order.get("financial_status"))
    fulfillment_status = map_fulfillment_status(order.get("fulfillment_status"))
    values = dict(existing or {})
    shipping = order.get("shipping_address") if isinstance(order.get("shipping_address"), dict) else {}
    customer = order.get("customer") if isinstance(order.get("customer"), dict) else {}
    values.update(
        {
            "te_sales_order.order_number": str(order.get("name") or order.get("order_number") or "").strip(),
            "te_sales_order.channel": "shopify",
            "te_sales_order.status": order_status(financial_status, fulfillment_status, order.get("cancelled_at")),
            "te_sales_order.financial_status": financial_status,
            "te_sales_order.fulfillment_status": fulfillment_status,
            "te_sales_order.order_date": iso_date(order.get("created_at")),
            "te_sales_order.currency": str(order.get("currency") or "NZD").strip() or "NZD",
            "te_sales_order.shopify_order_id": str(order.get("admin_graphql_api_id") or order.get("id") or "").strip(),
            "te_sales_order.shopify_order_name": str(order.get("name") or "").strip(),
            "te_sales_order.shopify_order_admin_url": admin_url,
            "te_sales_order.customer_name": str(customer.get("first_name") or "").strip() + ((" " + str(customer.get("last_name") or "").strip()).rstrip() if str(customer.get("last_name") or "").strip() else "") if customer else "",
            "te_sales_order.customer_email": str(order.get("email") or customer.get("email") or "").strip(),
            "te_sales_order.customer_phone": str(order.get("phone") or customer.get("phone") or "").strip(),
            "te_sales_order.shipping_name": str(shipping.get("name") or "").strip(),
            "te_sales_order.shipping_address_1": str(shipping.get("address1") or "").strip(),
            "te_sales_order.shipping_address_2": str(shipping.get("address2") or "").strip(),
            "te_sales_order.shipping_city": str(shipping.get("city") or "").strip(),
            "te_sales_order.shipping_region": str(shipping.get("province") or "").strip(),
            "te_sales_order.shipping_postcode": str(shipping.get("zip") or "").strip(),
            "te_sales_order.shipping_country": str(shipping.get("country") or "").strip(),
            "te_sales_order.shipping_amount": shipping_amount(order),
            "te_sales_order.total_paid": to_number(order.get("total_received")),
            "te_sales_order.shopify_last_sync_at": now_iso(),
            "te_sales_order.shopify_last_sync_status": "imported",
            "te_sales_order.shopify_last_sync_error": "",
            "te_sales_order.customer_note": str(order.get("note") or "").strip(),
        }
    )
    if customer_row:
        values["te_sales_order.customer_id"] = customer_row.record_id
    return values


def build_line_values(
    existing: dict[str, Any] | None,
    line_item: dict[str, Any],
    *,
    sales_order_id: str,
    product_row: LocalRecord | None,
    currency: str,
) -> dict[str, Any]:
    values = dict(existing or {})
    sku = str(line_item.get("sku") or "").strip()
    values.update(
        {
            "te_sales_order_line.sales_order_id": sales_order_id,
            "te_sales_order_line.shopify_line_item_id": str(line_item.get("admin_graphql_api_id") or line_item.get("id") or "").strip(),
            "te_sales_order_line.shopify_product_id": str(line_item.get("product_id") or "").strip(),
            "te_sales_order_line.shopify_variant_id": str(line_item.get("variant_id") or "").strip(),
            "te_sales_order_line.sku_snapshot": sku,
            "te_sales_order_line.description": line_description(line_item),
            "te_sales_order_line.uom_snapshot": str((product_row.record.get("te_product.uom") if product_row else "") or "EA"),
            "te_sales_order_line.currency_snapshot": currency,
            "te_sales_order_line.quantity": to_number(line_item.get("quantity")) or 0,
            "te_sales_order_line.fulfillable_quantity": to_number(line_item.get("fulfillable_quantity")) or 0,
            "te_sales_order_line.unit_price": to_number(line_item.get("price")),
            "te_sales_order_line.line_discount_total": to_number(line_item.get("total_discount")),
            "te_sales_order_line.line_tax_total": line_tax_total(line_item),
            "te_sales_order_line.unit_cost_snapshot": to_number(product_row.record.get("te_product.effective_cost_nzd")) if product_row else 0,
        }
    )
    if product_row:
        values["te_sales_order_line.product_id"] = product_row.record_id
    elif "te_sales_order_line.product_id" in values and not values["te_sales_order_line.product_id"]:
        values.pop("te_sales_order_line.product_id", None)
    return values


def apply_local_patch(existing: LocalRecord, patch: dict[str, Any]) -> LocalRecord:
    merged = dict(existing.record)
    merged.update(patch)
    return LocalRecord(record_id=existing.record_id, record=merged)


def find_product_link(
    line_item: dict[str, Any],
    *,
    by_variant_id: dict[str, LocalRecord],
    by_sku: dict[str, LocalRecord],
    duplicate_skus: set[str],
) -> LocalRecord | None:
    variant_id = str(line_item.get("variant_id") or "").strip()
    if variant_id and variant_id in by_variant_id:
        return by_variant_id[variant_id]
    normalized_variant_id = normalize_shopify_id(variant_id)
    if normalized_variant_id and normalized_variant_id in by_variant_id:
        return by_variant_id[normalized_variant_id]
    sku = str(line_item.get("sku") or "").strip()
    if sku and sku not in duplicate_skus:
        return by_sku.get(sku)
    return None


def find_customer_link(
    order: dict[str, Any],
    *,
    by_shopify_id: dict[str, LocalRecord],
    by_email: dict[str, LocalRecord],
    duplicate_emails: set[str],
) -> LocalRecord | None:
    customer = order.get("customer") if isinstance(order.get("customer"), dict) else {}
    customer_id = str(customer.get("admin_graphql_api_id") or customer.get("id") or "").strip()
    if customer_id and customer_id in by_shopify_id:
        return by_shopify_id[customer_id]
    email = str(order.get("email") or customer.get("email") or "").strip().lower()
    if email and email not in duplicate_emails:
        return by_email.get(email)
    return None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import Shopify orders into True Essentials sales orders.")
    parser.add_argument("--base-url", default=os.environ.get("OCTO_BASE_URL", "https://octodrop-platform-api.fly.dev"))
    parser.add_argument("--api-token", default=os.environ.get("OCTO_API_TOKEN"))
    parser.add_argument("--workspace-id", default=os.environ.get("OCTO_WORKSPACE_ID"))
    parser.add_argument("--connection-id", default=os.environ.get("OCTO_SHOPIFY_CONNECTION_ID"))
    parser.add_argument("--connection-name", default=os.environ.get("OCTO_SHOPIFY_CONNECTION_NAME"))
    parser.add_argument("--page-size", type=int, default=100)
    parser.add_argument("--max-orders", type=int, default=1000)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.api_token:
        raise RuntimeError("Missing OCTO_API_TOKEN or --api-token")
    if not args.workspace_id:
        raise RuntimeError("Missing OCTO_WORKSPACE_ID or --workspace-id")
    connection = resolve_connection(
        args.base_url,
        token=args.api_token,
        workspace_id=args.workspace_id,
        connection_id=args.connection_id,
        connection_name=args.connection_name,
    )
    connection_id = str(connection.get("id") or "").strip()
    if not connection_id:
        raise RuntimeError("Resolved connection is missing id")
    config = connection.get("config") if isinstance(connection.get("config"), dict) else {}
    shop_domain = str(config.get("shopify_myshopify_domain") or config.get("shop_domain") or "").strip()

    product_rows = list_records(
        args.base_url,
        "entity.te_product",
        token=args.api_token,
        workspace_id=args.workspace_id,
        fields=["te_product.sku", "te_product.uom", "te_product.effective_cost_nzd", "te_product.shopify_variant_id"],
    )
    product_by_variant_id, product_by_sku, duplicate_skus = index_te_products(product_rows)

    customer_by_shopify_id: dict[str, LocalRecord] = {}
    customer_by_email: dict[str, LocalRecord] = {}
    duplicate_customer_emails: set[str] = set()
    try:
        customer_rows = list_records(
            args.base_url,
            "entity.te_customer",
            token=args.api_token,
            workspace_id=args.workspace_id,
            fields=["te_customer.shopify_customer_id", "te_customer.email"],
        )
        customer_by_shopify_id, customer_by_email, duplicate_customer_emails = index_te_customers(customer_rows)
    except RuntimeError as exc:
        print(f"[warn] customer linking disabled: {exc}")

    existing_orders = list_records(
        args.base_url,
        "entity.te_sales_order",
        token=args.api_token,
        workspace_id=args.workspace_id,
        fields=["te_sales_order.shopify_order_id", "te_sales_order.order_number"],
    )
    orders_by_shopify_id = {
        str(row.record.get("te_sales_order.shopify_order_id") or "").strip(): row
        for row in existing_orders
        if str(row.record.get("te_sales_order.shopify_order_id") or "").strip()
    }

    existing_lines = list_records(
        args.base_url,
        "entity.te_sales_order_line",
        token=args.api_token,
        workspace_id=args.workspace_id,
        fields=["te_sales_order_line.sales_order_id", "te_sales_order_line.shopify_line_item_id"],
    )
    lines_by_order_and_shopify_id: dict[tuple[str, str], LocalRecord] = {}
    for row in existing_lines:
        sales_order_id = str(row.record.get("te_sales_order_line.sales_order_id") or "").strip()
        shopify_line_id = str(row.record.get("te_sales_order_line.shopify_line_item_id") or "").strip()
        if sales_order_id and shopify_line_id:
            lines_by_order_and_shopify_id[(sales_order_id, shopify_line_id)] = row

    created_orders = 0
    updated_orders = 0
    created_lines = 0
    updated_lines = 0
    linked_lines = 0
    unlinked_lines = 0
    scanned_orders = 0
    scanned_lines = 0
    since_id: int | None = None

    while scanned_orders < args.max_orders:
        query = {"status": "any", "limit": max(1, min(250, args.page_size))}
        if since_id:
            query["since_id"] = since_id
        result = manual_connection_request(
            args.base_url,
            connection_id,
            token=args.api_token,
            workspace_id=args.workspace_id,
            method="GET",
            path="/orders.json",
            query=query,
        )
        body_json = result.get("body_json") if isinstance(result.get("body_json"), dict) else {}
        orders = body_json.get("orders")
        rows = [row for row in orders if isinstance(row, dict)] if isinstance(orders, list) else []
        if not rows:
            break
        for order in rows:
            scanned_orders += 1
            shopify_order_id = str(order.get("admin_graphql_api_id") or order.get("id") or "").strip()
            admin_url = ""
            if shop_domain and order.get("order_status_url"):
                admin_url = str(order.get("order_status_url") or "").strip()
            existing_order = orders_by_shopify_id.get(shopify_order_id)
            customer_row = find_customer_link(
                order,
                by_shopify_id=customer_by_shopify_id,
                by_email=customer_by_email,
                duplicate_emails=duplicate_customer_emails,
            )
            order_values = build_order_values(
                existing_order.record if existing_order else None,
                order,
                admin_url=admin_url,
                customer_row=customer_row,
            )
            if existing_order is None:
                if args.dry_run:
                    order_row = LocalRecord(f"dry-run-order-{scanned_orders}", order_values)
                    created_orders += 1
                else:
                    order_row = create_record(
                        args.base_url,
                        "entity.te_sales_order",
                        order_values,
                        token=args.api_token,
                        workspace_id=args.workspace_id,
                    )
                    created_orders += 1
                orders_by_shopify_id[shopify_order_id] = order_row
            else:
                if args.dry_run:
                    order_row = LocalRecord(existing_order.record_id, order_values)
                    updated_orders += 1
                else:
                    order_row = patch_record(
                        args.base_url,
                        "entity.te_sales_order",
                        existing_order.record_id,
                        order_values,
                        token=args.api_token,
                        workspace_id=args.workspace_id,
                    )
                    updated_orders += 1
                if args.dry_run:
                    order_row = apply_local_patch(existing_order, order_values)
                orders_by_shopify_id[shopify_order_id] = order_row

            currency = str(order_values.get("te_sales_order.currency") or "NZD")
            for line_item in order.get("line_items") if isinstance(order.get("line_items"), list) else []:
                if not isinstance(line_item, dict):
                    continue
                scanned_lines += 1
                product_row = find_product_link(
                    line_item,
                    by_variant_id=product_by_variant_id,
                    by_sku=product_by_sku,
                    duplicate_skus=duplicate_skus,
                )
                if product_row:
                    linked_lines += 1
                else:
                    unlinked_lines += 1
                shopify_line_id = str(line_item.get("admin_graphql_api_id") or line_item.get("id") or "").strip()
                existing_line = lines_by_order_and_shopify_id.get((order_row.record_id, shopify_line_id))
                line_values = build_line_values(
                    existing_line.record if existing_line else None,
                    line_item,
                    sales_order_id=order_row.record_id,
                    product_row=product_row,
                    currency=currency,
                )
                if existing_line is None:
                    if args.dry_run:
                        line_row = LocalRecord(f"dry-run-line-{scanned_lines}", line_values)
                        created_lines += 1
                    else:
                        line_row = create_record(
                            args.base_url,
                            "entity.te_sales_order_line",
                            line_values,
                            token=args.api_token,
                            workspace_id=args.workspace_id,
                        )
                        created_lines += 1
                else:
                    if args.dry_run:
                        line_row = LocalRecord(existing_line.record_id, line_values)
                        updated_lines += 1
                    else:
                        line_row = patch_record(
                            args.base_url,
                            "entity.te_sales_order_line",
                            existing_line.record_id,
                            line_values,
                            token=args.api_token,
                            workspace_id=args.workspace_id,
                        )
                        updated_lines += 1
                    if args.dry_run:
                        line_row = apply_local_patch(existing_line, line_values)
                lines_by_order_and_shopify_id[(order_row.record_id, shopify_line_id)] = line_row

            since_id = int(order.get("id") or 0) or since_id
            if scanned_orders >= args.max_orders:
                break
        if len(rows) < max(1, min(250, args.page_size)) or scanned_orders >= args.max_orders:
            break

    print(
        json.dumps(
            {
                "connection_id": connection_id,
                "scanned_orders": scanned_orders,
                "scanned_lines": scanned_lines,
                "created_orders": created_orders,
                "updated_orders": updated_orders,
                "created_lines": created_lines,
                "updated_lines": updated_lines,
                "linked_lines": linked_lines,
                "unlinked_lines": unlinked_lines,
                "dry_run": bool(args.dry_run),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
