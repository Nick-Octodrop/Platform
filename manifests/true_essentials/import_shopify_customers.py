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


def api_get_connections(base_url: str, *, token: str, workspace_id: str) -> list[dict[str, Any]]:
    status, payload = api_call(
        "GET",
        f"{base_url}/integrations/connections",
        token=token,
        workspace_id=workspace_id,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"list connections failed: {collect_error_text(payload)}")
    rows = payload.get("connections")
    return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []


def resolve_connection(
    base_url: str,
    *,
    token: str,
    workspace_id: str,
    connection_id: str | None,
    connection_name: str | None,
) -> dict[str, Any]:
    connections = api_get_connections(base_url, token=token, workspace_id=workspace_id)
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


def iso_date(value: Any) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    return text[:10]


def shopify_customer_id(customer: dict[str, Any]) -> str:
    return str(customer.get("admin_graphql_api_id") or customer.get("id") or "").strip()


def customer_name(customer: dict[str, Any]) -> str:
    first = str(customer.get("first_name") or "").strip()
    last = str(customer.get("last_name") or "").strip()
    combined = " ".join(part for part in [first, last] if part).strip()
    if combined:
        return combined
    default_address = customer.get("default_address") if isinstance(customer.get("default_address"), dict) else {}
    address_name = str(default_address.get("name") or "").strip()
    if address_name:
        return address_name
    email = str(customer.get("email") or "").strip()
    if email:
        return email
    return f"Shopify Customer {customer.get('id')}"


def map_customer_status(shopify_state: str) -> str:
    normalized = str(shopify_state or "").strip().lower()
    if normalized in {"disabled", "declined"}:
        return "inactive"
    return "active"


def build_customer_payload(customer: dict[str, Any], *, admin_base_url: str | None) -> dict[str, Any]:
    default_address = customer.get("default_address") if isinstance(customer.get("default_address"), dict) else {}
    email_marketing = customer.get("email_marketing_consent") if isinstance(customer.get("email_marketing_consent"), dict) else {}
    sms_marketing = customer.get("sms_marketing_consent") if isinstance(customer.get("sms_marketing_consent"), dict) else {}
    customer_id = str(customer.get("id") or "").strip()
    admin_url = f"{admin_base_url}/customers/{customer_id}" if admin_base_url and customer_id else ""
    state = str(customer.get("state") or "").strip()
    return {
        "name": customer_name(customer),
        "email": str(customer.get("email") or "").strip(),
        "phone": str(customer.get("phone") or default_address.get("phone") or "").strip(),
        "status": map_customer_status(state),
        "accepts_email_marketing": str(email_marketing.get("state") or "").strip().lower() == "subscribed",
        "accepts_sms_marketing": str(sms_marketing.get("state") or "").strip().lower() == "subscribed",
        "currency_preference": str(customer.get("currency") or "NZD").strip() or "NZD",
        "tags": str(customer.get("tags") or "").strip(),
        "shopify_customer_id": shopify_customer_id(customer),
        "shopify_customer_admin_url": admin_url,
        "shopify_state": state,
        "default_address_line_1": str(default_address.get("address1") or "").strip(),
        "default_address_line_2": str(default_address.get("address2") or "").strip(),
        "default_city": str(default_address.get("city") or "").strip(),
        "default_region": str(default_address.get("province") or "").strip(),
        "default_postcode": str(default_address.get("zip") or "").strip(),
        "default_country": str(default_address.get("country") or "").strip(),
        "orders_count": int(customer.get("orders_count") or 0),
        "total_spent_nzd": round(to_number(customer.get("total_spent")), 2),
        "last_order_name": str(customer.get("last_order_name") or "").strip(),
        "last_order_date": iso_date(customer.get("updated_at") or customer.get("created_at")),
    }


def build_order_customer_payload(order: dict[str, Any], *, admin_base_url: str | None) -> dict[str, Any] | None:
    customer = order.get("customer") if isinstance(order.get("customer"), dict) else {}
    shipping = order.get("shipping_address") if isinstance(order.get("shipping_address"), dict) else {}
    email = str(order.get("email") or customer.get("email") or "").strip()
    customer_id = shopify_customer_id(customer) if customer else ""
    if not email and not customer_id:
        return None
    name = ""
    if customer:
        name = customer_name(customer)
    if not name:
        name = str(shipping.get("name") or "").strip()
    if not name:
        name = email or f"Order Customer {order.get('id')}"
    admin_url = ""
    raw_customer_id = str(customer.get("id") or "").strip()
    if admin_base_url and raw_customer_id:
        admin_url = f"{admin_base_url}/customers/{raw_customer_id}"
    currency = str(order.get("currency") or "NZD").strip() or "NZD"
    order_total = round(to_number(order.get("current_total_price") if order.get("current_total_price") is not None else order.get("total_price")), 2)
    return {
        "name": name,
        "email": email,
        "phone": str(order.get("phone") or customer.get("phone") or shipping.get("phone") or "").strip(),
        "status": map_customer_status(str(customer.get("state") or "enabled").strip()),
        "accepts_email_marketing": False,
        "accepts_sms_marketing": False,
        "currency_preference": currency,
        "tags": "",
        "shopify_customer_id": customer_id,
        "shopify_customer_admin_url": admin_url,
        "shopify_state": str(customer.get("state") or "").strip(),
        "default_address_line_1": str(shipping.get("address1") or "").strip(),
        "default_address_line_2": str(shipping.get("address2") or "").strip(),
        "default_city": str(shipping.get("city") or "").strip(),
        "default_region": str(shipping.get("province") or "").strip(),
        "default_postcode": str(shipping.get("zip") or "").strip(),
        "default_country": str(shipping.get("country") or "").strip(),
        "orders_count": 1,
        "total_spent_nzd": order_total if currency == "NZD" else 0.0,
        "last_order_name": str(order.get("name") or "").strip(),
        "last_order_date": iso_date(order.get("created_at")),
    }


def customer_identity(imported: dict[str, Any]) -> str:
    shopify_id = str(imported.get("shopify_customer_id") or "").strip()
    if shopify_id:
        return f"id:{shopify_id}"
    return f"email:{str(imported.get('email') or '').strip().lower()}"


def merge_customer_payload(base: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    for key in [
        "name",
        "email",
        "phone",
        "status",
        "currency_preference",
        "shopify_customer_id",
        "shopify_customer_admin_url",
        "shopify_state",
        "default_address_line_1",
        "default_address_line_2",
        "default_city",
        "default_region",
        "default_postcode",
        "default_country",
    ]:
        if not str(merged.get(key) or "").strip() and str(incoming.get(key) or "").strip():
            merged[key] = incoming[key]
    merged["accepts_email_marketing"] = bool(merged.get("accepts_email_marketing") or incoming.get("accepts_email_marketing"))
    merged["accepts_sms_marketing"] = bool(merged.get("accepts_sms_marketing") or incoming.get("accepts_sms_marketing"))
    merged["tags"] = str(merged.get("tags") or incoming.get("tags") or "").strip()
    merged["orders_count"] = int(merged.get("orders_count") or 0) + int(incoming.get("orders_count") or 0)
    merged["total_spent_nzd"] = round(to_number(merged.get("total_spent_nzd")) + to_number(incoming.get("total_spent_nzd")), 2)
    incoming_last = str(incoming.get("last_order_date") or "").strip()
    merged_last = str(merged.get("last_order_date") or "").strip()
    if incoming_last and (not merged_last or incoming_last > merged_last):
        merged["last_order_date"] = incoming["last_order_date"]
        merged["last_order_name"] = incoming.get("last_order_name") or merged.get("last_order_name") or ""
    return merged


def build_create_values(imported: dict[str, Any]) -> dict[str, Any]:
    return {
        "te_customer.name": imported["name"],
        "te_customer.email": imported["email"],
        "te_customer.phone": imported["phone"],
        "te_customer.status": imported["status"],
        "te_customer.accepts_email_marketing": imported["accepts_email_marketing"],
        "te_customer.accepts_sms_marketing": imported["accepts_sms_marketing"],
        "te_customer.currency_preference": imported["currency_preference"],
        "te_customer.tags": imported["tags"],
        "te_customer.shopify_customer_id": imported["shopify_customer_id"],
        "te_customer.shopify_customer_admin_url": imported["shopify_customer_admin_url"],
        "te_customer.shopify_state": imported["shopify_state"],
        "te_customer.default_address_line_1": imported["default_address_line_1"],
        "te_customer.default_address_line_2": imported["default_address_line_2"],
        "te_customer.default_city": imported["default_city"],
        "te_customer.default_region": imported["default_region"],
        "te_customer.default_postcode": imported["default_postcode"],
        "te_customer.default_country": imported["default_country"],
        "te_customer.orders_count": imported["orders_count"],
        "te_customer.total_spent_nzd": imported["total_spent_nzd"],
        "te_customer.last_order_name": imported["last_order_name"],
        "te_customer.last_order_date": imported["last_order_date"],
        "te_customer.shopify_last_sync_status": "imported",
        "te_customer.shopify_last_sync_at": now_iso(),
        "te_customer.shopify_last_sync_error": "",
    }


def build_update_values(existing: dict[str, Any], imported: dict[str, Any], *, overwrite_local: bool) -> dict[str, Any]:
    values: dict[str, Any] = {
        "te_customer.accepts_email_marketing": imported["accepts_email_marketing"],
        "te_customer.accepts_sms_marketing": imported["accepts_sms_marketing"],
        "te_customer.tags": imported["tags"],
        "te_customer.shopify_customer_id": imported["shopify_customer_id"],
        "te_customer.shopify_customer_admin_url": imported["shopify_customer_admin_url"],
        "te_customer.shopify_state": imported["shopify_state"],
        "te_customer.default_address_line_1": imported["default_address_line_1"],
        "te_customer.default_address_line_2": imported["default_address_line_2"],
        "te_customer.default_city": imported["default_city"],
        "te_customer.default_region": imported["default_region"],
        "te_customer.default_postcode": imported["default_postcode"],
        "te_customer.default_country": imported["default_country"],
        "te_customer.orders_count": imported["orders_count"],
        "te_customer.total_spent_nzd": imported["total_spent_nzd"],
        "te_customer.last_order_name": imported["last_order_name"],
        "te_customer.last_order_date": imported["last_order_date"],
        "te_customer.shopify_last_sync_status": "imported",
        "te_customer.shopify_last_sync_at": now_iso(),
        "te_customer.shopify_last_sync_error": "",
    }
    if overwrite_local or not str(existing.get("te_customer.name") or "").strip():
        values["te_customer.name"] = imported["name"]
    if overwrite_local or not str(existing.get("te_customer.email") or "").strip():
        values["te_customer.email"] = imported["email"]
    if overwrite_local or not str(existing.get("te_customer.phone") or "").strip():
        values["te_customer.phone"] = imported["phone"]
    if overwrite_local or not str(existing.get("te_customer.currency_preference") or "").strip():
        values["te_customer.currency_preference"] = imported["currency_preference"]
    if overwrite_local:
        values["te_customer.status"] = imported["status"]
    return values


def apply_local_patch(existing: LocalRecord, patch: dict[str, Any]) -> LocalRecord:
    merged = dict(existing.record)
    merged.update(patch)
    return LocalRecord(record_id=existing.record_id, record=merged)


def load_existing_customers(base_url: str, *, token: str, workspace_id: str) -> list[LocalRecord]:
    return list_records(
        base_url,
        "entity.te_customer",
        token=token,
        workspace_id=workspace_id,
        fields=[
            "te_customer.name",
            "te_customer.email",
            "te_customer.phone",
            "te_customer.status",
            "te_customer.currency_preference",
            "te_customer.shopify_customer_id",
        ],
    )


def index_customers(records: list[LocalRecord]) -> tuple[dict[str, LocalRecord], dict[str, LocalRecord], set[str]]:
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import Shopify customers into the True Essentials customer module.")
    parser.add_argument("--base-url", default=os.environ.get("OCTO_BASE_URL", "https://octodrop-platform-api.fly.dev"))
    parser.add_argument("--api-token", default=os.environ.get("OCTO_API_TOKEN"))
    parser.add_argument("--workspace-id", default=os.environ.get("OCTO_WORKSPACE_ID"))
    parser.add_argument("--connection-id", default=os.environ.get("OCTO_SHOPIFY_CONNECTION_ID"))
    parser.add_argument("--connection-name", default=os.environ.get("OCTO_SHOPIFY_CONNECTION_NAME"))
    parser.add_argument("--page-size", type=int, default=100)
    parser.add_argument("--max-customers", type=int, default=5000)
    parser.add_argument("--max-orders", type=int, default=5000, help="Maximum Shopify orders to scan when seeding customers from order data.")
    parser.add_argument("--overwrite-local", action="store_true", help="Allow Shopify core customer fields to overwrite populated Octodrop fields.")
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
    admin_base_url = f"https://{shop_domain}/admin" if shop_domain else None

    existing_rows = load_existing_customers(args.base_url, token=args.api_token, workspace_id=args.workspace_id)
    by_shopify_id, by_email, duplicate_emails = index_customers(existing_rows)
    if duplicate_emails:
        print(f"[warn] duplicate local customer emails found; email-only linking will skip {len(duplicate_emails)} ambiguous email(s)")

    created = 0
    updated = 0
    scanned_customers = 0
    scanned_orders = 0
    derived_order_customers = 0
    skipped_conflicts = 0
    since_id: int | None = None

    while scanned_customers < args.max_customers:
        query: dict[str, Any] = {"limit": max(1, min(250, args.page_size))}
        if since_id:
            query["since_id"] = since_id
        result = manual_connection_request(
            args.base_url,
            connection_id,
            token=args.api_token,
            workspace_id=args.workspace_id,
            method="GET",
            path="/customers.json",
            query=query,
        )
        body_json = result.get("body_json") if isinstance(result.get("body_json"), dict) else {}
        customers = body_json.get("customers")
        rows = [row for row in customers if isinstance(row, dict)] if isinstance(customers, list) else []
        if not rows:
            break
        for customer in rows:
            scanned_customers += 1
            imported = build_customer_payload(customer, admin_base_url=admin_base_url)
            local = by_shopify_id.get(imported["shopify_customer_id"])
            email_key = imported["email"].strip().lower()
            if local is None and email_key and email_key not in duplicate_emails:
                local = by_email.get(email_key)
            if local is not None:
                existing_shopify_id = str(local.record.get("te_customer.shopify_customer_id") or "").strip()
                if existing_shopify_id and existing_shopify_id != imported["shopify_customer_id"]:
                    skipped_conflicts += 1
                    print(
                        f"[skip] customer {imported['email'] or imported['name']} already linked to "
                        f"{existing_shopify_id}, not relinking to {imported['shopify_customer_id']}"
                    )
                    continue
                values = build_update_values(local.record, imported, overwrite_local=args.overwrite_local)
                if args.dry_run:
                    print(f"[dry-run] update {local.record_id} customer={imported['name']}")
                    local = apply_local_patch(local, values)
                else:
                    local = patch_record(
                        args.base_url,
                        "entity.te_customer",
                        local.record_id,
                        values,
                        token=args.api_token,
                        workspace_id=args.workspace_id,
                    )
                by_shopify_id[imported["shopify_customer_id"]] = local
                if email_key and email_key not in duplicate_emails:
                    by_email[email_key] = local
                updated += 1
            else:
                values = build_create_values(imported)
                if args.dry_run:
                    print(f"[dry-run] create customer={imported['name']}")
                    created += 1
                else:
                    local = create_record(
                        args.base_url,
                        "entity.te_customer",
                        values,
                        token=args.api_token,
                        workspace_id=args.workspace_id,
                    )
                    by_shopify_id[imported["shopify_customer_id"]] = local
                    if email_key and email_key not in duplicate_emails:
                        by_email[email_key] = local
                    created += 1
            since_id = int(customer.get("id") or 0) or since_id
            if scanned_customers >= args.max_customers:
                break
        if len(rows) < max(1, min(250, args.page_size)) or scanned_customers >= args.max_customers:
            break

    order_customer_payloads: dict[str, dict[str, Any]] = {}
    since_order_id: int | None = None
    while scanned_orders < args.max_orders:
        query: dict[str, Any] = {"status": "any", "limit": max(1, min(250, args.page_size))}
        if since_order_id:
            query["since_id"] = since_order_id
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
            payload = build_order_customer_payload(order, admin_base_url=admin_base_url)
            if payload is not None:
                key = customer_identity(payload)
                if key in order_customer_payloads:
                    order_customer_payloads[key] = merge_customer_payload(order_customer_payloads[key], payload)
                else:
                    order_customer_payloads[key] = payload
            since_order_id = int(order.get("id") or 0) or since_order_id
            if scanned_orders >= args.max_orders:
                break
        if len(rows) < max(1, min(250, args.page_size)) or scanned_orders >= args.max_orders:
            break

    for imported in order_customer_payloads.values():
        email_key = str(imported["email"] or "").strip().lower()
        local = by_shopify_id.get(imported["shopify_customer_id"]) if imported["shopify_customer_id"] else None
        if local is None and email_key and email_key not in duplicate_emails:
            local = by_email.get(email_key)
        if local is not None:
            existing_shopify_id = str(local.record.get("te_customer.shopify_customer_id") or "").strip()
            if existing_shopify_id and imported["shopify_customer_id"] and existing_shopify_id != imported["shopify_customer_id"]:
                skipped_conflicts += 1
                print(
                    f"[skip] order customer {imported['email'] or imported['name']} already linked to "
                    f"{existing_shopify_id}, not relinking to {imported['shopify_customer_id']}"
                )
                continue
            values = build_update_values(local.record, imported, overwrite_local=args.overwrite_local)
            if args.dry_run:
                print(f"[dry-run] update customer from orders {local.record_id} customer={imported['name']}")
                local = apply_local_patch(local, values)
            else:
                local = patch_record(
                    args.base_url,
                    "entity.te_customer",
                    local.record_id,
                    values,
                    token=args.api_token,
                    workspace_id=args.workspace_id,
                )
            if imported["shopify_customer_id"]:
                by_shopify_id[imported["shopify_customer_id"]] = local
            if email_key and email_key not in duplicate_emails:
                by_email[email_key] = local
            updated += 1
            derived_order_customers += 1
            continue

        values = build_create_values(imported)
        if args.dry_run:
            print(f"[dry-run] create customer from orders {imported['name']}")
            created += 1
            derived_order_customers += 1
            continue
        local = create_record(
            args.base_url,
            "entity.te_customer",
            values,
            token=args.api_token,
            workspace_id=args.workspace_id,
        )
        if imported["shopify_customer_id"]:
            by_shopify_id[imported["shopify_customer_id"]] = local
        if email_key and email_key not in duplicate_emails:
            by_email[email_key] = local
        created += 1
        derived_order_customers += 1

    print(
        json.dumps(
            {
                "connection_id": connection_id,
                "scanned_customers": scanned_customers,
                "scanned_orders": scanned_orders,
                "derived_order_customers": derived_order_customers,
                "created": created,
                "updated": updated,
                "skipped_conflicts": skipped_conflicts,
                "dry_run": bool(args.dry_run),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
