#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from typing import Any
from urllib import error as urlerror
from urllib import parse as urlparse
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
        message = payload.get("message")
        if isinstance(message, str) and message.strip():
            return message.strip()
        detail = payload.get("detail")
        if isinstance(detail, str) and detail.strip():
            return detail.strip()
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


def list_mappings(base_url: str, *, token: str, workspace_id: str, connection_id: str) -> list[dict[str, Any]]:
    query = urlparse.urlencode({"connection_id": connection_id})
    status, payload = api_call(
        "GET",
        f"{base_url}/integrations/mappings?{query}",
        token=token,
        workspace_id=workspace_id,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"list mappings failed: {collect_error_text(payload)}")
    rows = payload.get("mappings")
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


def _looks_like_placeholder(value: str | None) -> bool:
    text = str(value or "").strip()
    if not text:
        return False
    if text.startswith("<") and text.endswith(">"):
        return True
    return text.upper() in {
        "YOUR_SHOPIFY_CONNECTION_ID",
        "OCTO_SHOPIFY_CONNECTION_ID",
    }


def create_mapping(base_url: str, definition: dict[str, Any], *, token: str, workspace_id: str) -> dict[str, Any]:
    status, payload = api_call(
        "POST",
        f"{base_url}/integrations/mappings",
        token=token,
        workspace_id=workspace_id,
        body=definition,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"create mapping '{definition.get('name')}' failed: {collect_error_text(payload)}")
    item = payload.get("mapping")
    if not isinstance(item, dict):
        raise RuntimeError(f"create mapping '{definition.get('name')}' failed: missing mapping payload")
    return item


def update_mapping(
    base_url: str,
    mapping_id: str,
    definition: dict[str, Any],
    *,
    token: str,
    workspace_id: str,
) -> dict[str, Any]:
    status, payload = api_call(
        "PATCH",
        f"{base_url}/integrations/mappings/{mapping_id}",
        token=token,
        workspace_id=workspace_id,
        body=definition,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"update mapping '{definition.get('name')}' failed: {collect_error_text(payload)}")
    item = payload.get("mapping")
    if not isinstance(item, dict):
        raise RuntimeError(f"update mapping '{definition.get('name')}' failed: missing mapping payload")
    return item


def create_automation(base_url: str, definition: dict[str, Any], *, token: str, workspace_id: str) -> dict[str, Any]:
    status, payload = api_call("POST", f"{base_url}/automations", token=token, workspace_id=workspace_id, body=definition)
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"create automation '{definition.get('name')}' failed: {collect_error_text(payload)}")
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
        raise RuntimeError(f"update automation '{definition.get('name')}' failed: {collect_error_text(payload)}")
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


def upsert_mapping_by_name(
    base_url: str,
    definition: dict[str, Any],
    *,
    token: str,
    workspace_id: str,
    connection_id: str,
) -> tuple[str, dict[str, Any]]:
    existing = next(
        (
            row
            for row in list_mappings(base_url, token=token, workspace_id=workspace_id, connection_id=connection_id)
            if str(row.get("name") or "").strip() == definition["name"]
        ),
        None,
    )
    if existing:
        updated = update_mapping(base_url, str(existing.get("id") or ""), definition, token=token, workspace_id=workspace_id)
        return "updated", updated
    created = create_mapping(base_url, definition, token=token, workspace_id=workspace_id)
    return "created", created


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


def build_customer_mapping(connection_id: str) -> dict[str, Any]:
    return {
        "connection_id": connection_id,
        "name": "TE Shopify - Customer Webhook Mapping",
        "source_entity": "shopify.customer",
        "target_entity": "entity.te_customer",
        "mapping_json": {
            "resource_key": "Customers",
            "usage_scope": "automation",
            "record_mode": "upsert",
            "match_on": ["te_customer.email"],
            "field_mappings": [
                {"to": "te_customer.name", "path": "name", "skip_if_missing": True},
                {"to": "te_customer.email", "path": "email", "skip_if_missing": True},
                {"to": "te_customer.phone", "path": "phone", "skip_if_missing": True},
                {"to": "te_customer.status", "path": "status", "default": "active"},
                {"to": "te_customer.accepts_email_marketing", "path": "accepts_email_marketing", "default": False, "transform": "boolean"},
                {"to": "te_customer.accepts_sms_marketing", "path": "accepts_sms_marketing", "default": False, "transform": "boolean"},
                {"to": "te_customer.currency_preference", "path": "currency_preference", "default": "NZD"},
                {"to": "te_customer.tags", "path": "tags", "default": ""},
                {"to": "te_customer.shopify_customer_id", "path": "shopify_customer_id", "skip_if_missing": True},
                {"to": "te_customer.shopify_state", "path": "shopify_state", "default": ""},
                {"to": "te_customer.default_address_line_1", "path": "default_address_line_1", "default": ""},
                {"to": "te_customer.default_address_line_2", "path": "default_address_line_2", "default": ""},
                {"to": "te_customer.default_city", "path": "default_city", "default": ""},
                {"to": "te_customer.default_region", "path": "default_region", "default": ""},
                {"to": "te_customer.default_postcode", "path": "default_postcode", "default": ""},
                {"to": "te_customer.default_country", "path": "default_country", "default": ""},
                {"to": "te_customer.orders_count", "path": "orders_count", "default": 0, "transform": "integer"},
                {"to": "te_customer.total_spent_nzd", "path": "total_spent_nzd", "default": 0, "transform": "number"},
                {"to": "te_customer.last_order_name", "path": "last_order_name", "default": ""},
                {"to": "te_customer.last_order_date", "path": "last_order_date", "default": ""},
                {"to": "te_customer.shopify_last_sync_status", "value": "imported"},
                {"to": "te_customer.shopify_last_sync_at", "ref": "$now"},
                {"to": "te_customer.shopify_last_sync_error", "value": ""},
            ],
        },
    }


def build_product_mapping(connection_id: str) -> dict[str, Any]:
    return {
        "connection_id": connection_id,
        "name": "TE Shopify - Product Variant Webhook Mapping",
        "source_entity": "shopify.product_variant",
        "target_entity": "entity.te_product",
        "mapping_json": {
            "resource_key": "Products",
            "usage_scope": "automation",
            "record_mode": "upsert",
            "match_on": ["te_product.sku"],
            "field_mappings": [
                {"to": "te_product.sku", "path": "sku", "skip_if_missing": True},
                {"to": "te_product.title", "path": "title", "skip_if_missing": True},
                {"to": "te_product.variant_name", "path": "variant_name", "skip_if_missing": True},
                {"to": "te_product.status", "path": "status", "default": "draft"},
                {"to": "te_product.sales_currency", "path": "sales_currency", "default": "NZD"},
                {"to": "te_product.retail_price", "path": "retail_price", "default": 0, "transform": "number"},
                {"to": "te_product.compare_at_price", "path": "compare_at_price", "default": 0, "transform": "number"},
                {"to": "te_product.track_stock", "path": "track_stock", "default": False, "transform": "boolean"},
                {"to": "te_product.shopify_handle", "path": "shopify_handle", "default": ""},
                {"to": "te_product.shopify_description_html", "path": "shopify_description_html", "default": ""},
                {"to": "te_product.shopify_product_id", "path": "shopify_product_id", "skip_if_missing": True},
                {"to": "te_product.shopify_variant_id", "path": "shopify_variant_id", "skip_if_missing": True},
                {"to": "te_product.shopify_inventory_item_id", "path": "shopify_inventory_item_id", "skip_if_missing": True},
                {"to": "te_product.shopify_status", "path": "shopify_status", "default": ""},
                {"to": "te_product.shopify_last_sync_status", "value": "imported"},
                {"to": "te_product.shopify_last_sync_at", "ref": "$now"},
                {"to": "te_product.shopify_last_sync_error", "value": ""},
            ],
        },
    }


def build_sales_order_mapping(connection_id: str) -> dict[str, Any]:
    return {
        "connection_id": connection_id,
        "name": "TE Shopify - Sales Order Webhook Mapping",
        "source_entity": "shopify.order",
        "target_entity": "entity.te_sales_order",
        "mapping_json": {
            "resource_key": "Orders",
            "usage_scope": "automation",
            "record_mode": "upsert",
            "match_on": ["te_sales_order.shopify_order_id"],
            "field_mappings": [
                {"to": "te_sales_order.order_number", "path": "order_number", "skip_if_missing": True},
                {"to": "te_sales_order.channel", "value": "shopify"},
                {"to": "te_sales_order.status", "path": "status", "default": "open"},
                {"to": "te_sales_order.financial_status", "path": "financial_status", "default": "pending"},
                {"to": "te_sales_order.fulfillment_status", "path": "fulfillment_status", "default": "unfulfilled"},
                {"to": "te_sales_order.order_date", "path": "order_date", "skip_if_missing": True},
                {"to": "te_sales_order.currency", "path": "currency", "default": "NZD"},
                {"to": "te_sales_order.shopify_order_id", "path": "shopify_order_id", "skip_if_missing": True},
                {"to": "te_sales_order.shopify_order_name", "path": "shopify_order_name", "default": ""},
                {"to": "te_sales_order.customer_name", "path": "customer_name", "default": ""},
                {"to": "te_sales_order.customer_email", "path": "customer_email", "default": ""},
                {"to": "te_sales_order.customer_phone", "path": "customer_phone", "default": ""},
                {"to": "te_sales_order.shipping_name", "path": "shipping_name", "default": ""},
                {"to": "te_sales_order.shipping_address_1", "path": "shipping_address_1", "default": ""},
                {"to": "te_sales_order.shipping_address_2", "path": "shipping_address_2", "default": ""},
                {"to": "te_sales_order.shipping_city", "path": "shipping_city", "default": ""},
                {"to": "te_sales_order.shipping_region", "path": "shipping_region", "default": ""},
                {"to": "te_sales_order.shipping_postcode", "path": "shipping_postcode", "default": ""},
                {"to": "te_sales_order.shipping_country", "path": "shipping_country", "default": ""},
                {"to": "te_sales_order.shipping_amount", "path": "shipping_amount", "default": 0, "transform": "number"},
                {"to": "te_sales_order.order_total", "path": "order_total", "default": 0, "transform": "number"},
                {"to": "te_sales_order.total_paid", "path": "total_paid", "default": 0, "transform": "number"},
                {"to": "te_sales_order.customer_note", "path": "customer_note", "default": ""},
                {"to": "te_sales_order.fulfilled_at", "path": "fulfilled_at", "default": ""},
                {"to": "te_sales_order.tracking_company", "path": "tracking_company", "default": ""},
                {"to": "te_sales_order.tracking_number", "path": "tracking_number", "default": ""},
                {"to": "te_sales_order.tracking_url", "path": "tracking_url", "default": ""},
                {"to": "te_sales_order.customer_id", "path": "customer_record_id", "skip_if_missing": True},
                {"to": "te_sales_order.shopify_last_sync_status", "value": "imported"},
                {"to": "te_sales_order.shopify_last_sync_at", "ref": "$now"},
                {"to": "te_sales_order.shopify_last_sync_error", "value": ""},
            ],
        },
    }


def build_sales_order_line_mapping(connection_id: str) -> dict[str, Any]:
    return {
        "connection_id": connection_id,
        "name": "TE Shopify - Sales Order Line Webhook Mapping",
        "source_entity": "shopify.order_line",
        "target_entity": "entity.te_sales_order_line",
        "mapping_json": {
            "resource_key": "Orders",
            "usage_scope": "automation",
            "record_mode": "upsert",
            "match_on": ["te_sales_order_line.shopify_line_item_id"],
            "field_mappings": [
                {"to": "te_sales_order_line.sales_order_id", "path": "sales_order_id", "skip_if_missing": True},
                {"to": "te_sales_order_line.shopify_line_item_id", "path": "shopify_line_item_id", "skip_if_missing": True},
                {"to": "te_sales_order_line.shopify_product_id", "path": "shopify_product_id", "default": ""},
                {"to": "te_sales_order_line.shopify_variant_id", "path": "shopify_variant_id", "default": ""},
                {"to": "te_sales_order_line.sku_snapshot", "path": "sku_snapshot", "default": ""},
                {"to": "te_sales_order_line.description", "path": "description", "default": "Shopify line item"},
                {"to": "te_sales_order_line.uom_snapshot", "path": "uom_snapshot", "default": "EA"},
                {"to": "te_sales_order_line.currency_snapshot", "path": "currency_snapshot", "default": "NZD"},
                {"to": "te_sales_order_line.quantity", "path": "quantity", "default": 0, "transform": "number"},
                {"to": "te_sales_order_line.fulfillable_quantity", "path": "fulfillable_quantity", "default": 0, "transform": "number"},
                {"to": "te_sales_order_line.unit_price", "path": "unit_price", "default": 0, "transform": "number"},
                {"to": "te_sales_order_line.line_discount_total", "path": "line_discount_total", "default": 0, "transform": "number"},
                {"to": "te_sales_order_line.line_tax_total", "path": "line_tax_total", "default": 0, "transform": "number"},
                {"to": "te_sales_order_line.unit_cost_snapshot", "path": "unit_cost_snapshot", "default": 0, "transform": "number"},
                {"to": "te_sales_order_line.product_id", "path": "product_record_id", "skip_if_missing": True},
            ],
        },
    }


def _json_source_record(spec: dict[str, Any]) -> str:
    lines: list[str] = ["{"]
    items = list(spec.items())
    for index, (key, value) in enumerate(items):
        suffix = "," if index < len(items) - 1 else ""
        key_json = json.dumps(str(key))
        if isinstance(value, bool):
            rendered_value = "true" if value else "false"
        elif value is None:
            rendered_value = "null"
        elif isinstance(value, (int, float)):
            rendered_value = json.dumps(value)
        elif isinstance(value, str):
            text = value.strip()
            if "{{" in text or "{%" in text:
                capture_var = f"__octo_source_value_{index}"
                rendered_value = f"{{% set {capture_var} %}}{text}{{% endset %}}{{{{ {capture_var} | trim | tojson }}}}"
            else:
                rendered_value = json.dumps(text)
        else:
            rendered_value = json.dumps(value)
        lines.append(f'  {key_json}: {rendered_value}{suffix}')
    lines.append("}")
    return "\n".join(lines)


def _first_list_value(prefix: str, list_field: str, value_expr: str, fallback_expr: str) -> str:
    list_expr = f"{prefix}.{list_field}"
    first_expr = f"{list_expr}[0].{value_expr}"
    return (
        "{% if " + list_expr + " | default([], true) | length > 0 %}"
        "{{ " + first_expr + " | default(" + fallback_expr + ", true) }}"
        "{% else %}{{ " + fallback_expr + " }}{% endif %}"
    )


def _first_list_date(prefix: str, list_field: str, value_expr: str) -> str:
    list_expr = f"{prefix}.{list_field}"
    first_expr = f"{list_expr}[0].{value_expr}"
    return (
        "{% if " + list_expr + " | default([], true) | length > 0 %}"
        "{{ (" + first_expr + " | default('', true))[:10] }}"
        "{% else %}{% endif %}"
    )


def _shopify_customer_source(prefix: str) -> str:
    return _json_source_record({
        "name": (
            "{% if " + prefix + ".first_name | default('', true) and " + prefix + ".last_name | default('', true) %}"
            "{{ " + prefix + ".first_name | default('', true) }} {{ " + prefix + ".last_name | default('', true) }}"
            "{% elif " + prefix + ".default_address.name | default('', true) %}{{ " + prefix + ".default_address.name | default('', true) }}"
            "{% elif " + prefix + ".email | default('', true) %}{{ " + prefix + ".email | default('', true) }}"
            "{% else %}Shopify Customer{% endif %}"
        ),
        "email": "{{ " + prefix + ".email | default('', true) }}",
        "phone": "{{ " + prefix + ".phone | default(" + prefix + ".default_address.phone | default('', true), true) }}",
        "status": "{% if " + prefix + ".state | default('', true) in ['disabled', 'declined'] %}inactive{% else %}active{% endif %}",
        "accepts_email_marketing": "{% if " + prefix + ".email_marketing_consent.state | default('', true) == 'subscribed' %}true{% else %}false{% endif %}",
        "accepts_sms_marketing": "{% if " + prefix + ".sms_marketing_consent.state | default('', true) == 'subscribed' %}true{% else %}false{% endif %}",
        "currency_preference": "{{ " + prefix + ".currency | default('NZD', true) }}",
        "tags": "{{ " + prefix + ".tags | default('', true) }}",
        "shopify_customer_id": (
            "{% if " + prefix + ".admin_graphql_api_id | default('', true) %}{{ " + prefix + ".admin_graphql_api_id | default('', true) }}"
            "{% elif " + prefix + ".id | default('', true) %}gid://shopify/Customer/{{ " + prefix + ".id | default('', true) }}{% endif %}"
        ),
        "shopify_state": "{{ " + prefix + ".state | default('', true) }}",
        "default_address_line_1": "{{ " + prefix + ".default_address.address1 | default('', true) }}",
        "default_address_line_2": "{{ " + prefix + ".default_address.address2 | default('', true) }}",
        "default_city": "{{ " + prefix + ".default_address.city | default('', true) }}",
        "default_region": "{{ " + prefix + ".default_address.province | default('', true) }}",
        "default_postcode": "{{ " + prefix + ".default_address.zip | default('', true) }}",
        "default_country": "{{ " + prefix + ".default_address.country | default('', true) }}",
        "orders_count": "{{ " + prefix + ".orders_count | default(0, true) }}",
        "total_spent_nzd": "{{ " + prefix + ".total_spent | default(0, true) }}",
        "last_order_name": "{{ " + prefix + ".last_order_name | default('', true) }}",
        "last_order_date": "{{ (" + prefix + ".updated_at | default(" + prefix + ".created_at | default('', true), true))[:10] }}",
    })


def _order_customer_source(prefix: str) -> str:
    return _json_source_record({
        "name": (
            "{% if " + prefix + ".customer.first_name | default('', true) and " + prefix + ".customer.last_name | default('', true) %}"
            "{{ " + prefix + ".customer.first_name | default('', true) }} {{ " + prefix + ".customer.last_name | default('', true) }}"
            "{% elif " + prefix + ".shipping_address.name | default('', true) %}{{ " + prefix + ".shipping_address.name | default('', true) }}"
            "{% elif " + prefix + ".email | default('', true) %}{{ " + prefix + ".email | default('', true) }}"
            "{% else %}Order Customer{% endif %}"
        ),
        "email": "{{ " + prefix + ".email | default(" + prefix + ".customer.email | default('', true), true) }}",
        "phone": "{{ " + prefix + ".phone | default(" + prefix + ".customer.phone | default(" + prefix + ".shipping_address.phone | default('', true), true), true) }}",
        "status": "active",
        "accepts_email_marketing": False,
        "accepts_sms_marketing": False,
        "currency_preference": "{{ " + prefix + ".currency | default('NZD', true) }}",
        "tags": "",
        "shopify_customer_id": (
            "{% if " + prefix + ".customer.admin_graphql_api_id | default('', true) %}{{ " + prefix + ".customer.admin_graphql_api_id | default('', true) }}"
            "{% elif " + prefix + ".customer.id | default('', true) %}gid://shopify/Customer/{{ " + prefix + ".customer.id | default('', true) }}{% endif %}"
        ),
        "shopify_state": "{{ " + prefix + ".customer.state | default('enabled', true) }}",
        "default_address_line_1": "{{ " + prefix + ".shipping_address.address1 | default('', true) }}",
        "default_address_line_2": "{{ " + prefix + ".shipping_address.address2 | default('', true) }}",
        "default_city": "{{ " + prefix + ".shipping_address.city | default('', true) }}",
        "default_region": "{{ " + prefix + ".shipping_address.province | default('', true) }}",
        "default_postcode": "{{ " + prefix + ".shipping_address.zip | default('', true) }}",
        "default_country": "{{ " + prefix + ".shipping_address.country | default('', true) }}",
        "orders_count": 1,
        "total_spent_nzd": "{{ " + prefix + ".current_total_price | default(" + prefix + ".total_price | default(0, true), true) }}",
        "last_order_name": "{{ " + prefix + ".name | default('', true) }}",
        "last_order_date": "{{ (" + prefix + ".updated_at | default(" + prefix + ".created_at | default('', true), true))[:10] }}",
    })


def _product_variant_source(product_var: str, variant_var: str) -> str:
    return _json_source_record({
        "sku": "{{ " + variant_var + ".sku | default('', true) }}",
        "title": "{{ " + product_var + ".title | default(" + variant_var + ".sku | default('', true), true) }}",
        "variant_name": "{% if " + variant_var + ".title | default('', true) and " + variant_var + ".title | default('', true) != 'Default Title' %}{{ " + variant_var + ".title | default('', true) }}{% endif %}",
        "status": (
            "{% if " + product_var + ".status | default('', true) == 'ACTIVE' %}active"
            "{% elif " + product_var + ".status | default('', true) == 'ARCHIVED' %}archived"
            "{% else %}draft{% endif %}"
        ),
        "sales_currency": "{{ " + product_var + ".currency | default('NZD', true) }}",
        "retail_price": "{{ " + variant_var + ".price | default(0, true) }}",
        "compare_at_price": "{{ " + variant_var + ".compare_at_price | default(0, true) }}",
        "track_stock": "{% if " + variant_var + ".inventory_management | default('', true) %}true{% else %}false{% endif %}",
        "shopify_handle": "{{ " + product_var + ".handle | default('', true) }}",
        "shopify_description_html": "{{ " + product_var + ".body_html | default(" + product_var + ".descriptionHtml | default('', true), true) }}",
        "shopify_product_id": (
            "{% if " + product_var + ".admin_graphql_api_id | default('', true) %}{{ " + product_var + ".admin_graphql_api_id | default('', true) }}"
            "{% elif " + product_var + ".id | default('', true) %}gid://shopify/Product/{{ " + product_var + ".id | default('', true) }}{% endif %}"
        ),
        "shopify_variant_id": (
            "{% if " + variant_var + ".admin_graphql_api_id | default('', true) %}{{ " + variant_var + ".admin_graphql_api_id | default('', true) }}"
            "{% elif " + variant_var + ".id | default('', true) %}gid://shopify/ProductVariant/{{ " + variant_var + ".id | default('', true) }}{% endif %}"
        ),
        "shopify_inventory_item_id": (
            "{% if " + variant_var + ".inventory_item_id | default('', true) %}gid://shopify/InventoryItem/{{ " + variant_var + ".inventory_item_id | default('', true) }}{% endif %}"
        ),
        "shopify_status": "{{ " + product_var + ".status | default('', true) }}",
    })


def _order_source(prefix: str) -> str:
    return _json_source_record({
        "order_number": "{{ " + prefix + ".name | default(" + prefix + ".order_number | default('', true), true) }}",
        "status": (
            "{% if " + prefix + ".cancelled_at | default('', true) %}cancelled"
            "{% elif " + prefix + ".financial_status | default('', true) in ['refunded', 'partially_refunded'] %}refunded"
            "{% elif " + prefix + ".fulfillment_status | default('', true) in ['fulfilled', 'restocked'] %}fulfilled"
            "{% elif " + prefix + ".financial_status | default('', true) in ['paid', 'partially_paid'] %}paid"
            "{% else %}open{% endif %}"
        ),
        "financial_status": "{{ " + prefix + ".financial_status | default('pending', true) }}",
        "fulfillment_status": "{{ " + prefix + ".fulfillment_status | default('unfulfilled', true) }}",
        "order_date": "{{ (" + prefix + ".created_at | default('', true))[:10] }}",
        "currency": "{{ " + prefix + ".currency | default('NZD', true) }}",
        "shopify_order_id": (
            "{% if " + prefix + ".admin_graphql_api_id | default('', true) %}{{ " + prefix + ".admin_graphql_api_id | default('', true) }}"
            "{% elif " + prefix + ".id | default('', true) %}gid://shopify/Order/{{ " + prefix + ".id | default('', true) }}{% endif %}"
        ),
        "shopify_order_name": "{{ " + prefix + ".name | default('', true) }}",
        "customer_name": (
            "{% if " + prefix + ".customer.first_name | default('', true) and " + prefix + ".customer.last_name | default('', true) %}"
            "{{ " + prefix + ".customer.first_name | default('', true) }} {{ " + prefix + ".customer.last_name | default('', true) }}"
            "{% elif " + prefix + ".shipping_address.name | default('', true) %}{{ " + prefix + ".shipping_address.name | default('', true) }}"
            "{% elif " + prefix + ".email | default('', true) %}{{ " + prefix + ".email | default('', true) }}"
            "{% else %}Shopify Customer{% endif %}"
        ),
        "customer_email": "{{ " + prefix + ".email | default(" + prefix + ".customer.email | default('', true), true) }}",
        "customer_phone": "{{ " + prefix + ".phone | default(" + prefix + ".customer.phone | default(" + prefix + ".shipping_address.phone | default('', true), true), true) }}",
        "shipping_name": "{{ " + prefix + ".shipping_address.name | default('', true) }}",
        "shipping_address_1": "{{ " + prefix + ".shipping_address.address1 | default('', true) }}",
        "shipping_address_2": "{{ " + prefix + ".shipping_address.address2 | default('', true) }}",
        "shipping_city": "{{ " + prefix + ".shipping_address.city | default('', true) }}",
        "shipping_region": "{{ " + prefix + ".shipping_address.province | default('', true) }}",
        "shipping_postcode": "{{ " + prefix + ".shipping_address.zip | default('', true) }}",
        "shipping_country": "{{ " + prefix + ".shipping_address.country | default('', true) }}",
        "shipping_amount": "{{ " + prefix + ".total_shipping_price_set.shop_money.amount | default(0, true) }}",
        "order_total": "{{ " + prefix + ".current_total_price | default(" + prefix + ".total_price | default(0, true), true) }}",
        "total_paid": "{{ " + prefix + ".total_received | default(" + prefix + ".total_paid | default(0, true), true) }}",
        "customer_note": "{{ " + prefix + ".note | default('', true) }}",
        "fulfilled_at": _first_list_date(prefix, "fulfillments", "created_at"),
        "tracking_company": _first_list_value(prefix, "fulfillments", "tracking_company", "''"),
        "tracking_number": _first_list_value(prefix, "fulfillments", "tracking_number", "''"),
        "tracking_url": _first_list_value(prefix, "fulfillments", "tracking_url", "''"),
        "customer_record_id": "{{ steps.upsert_order_customer.record_id | default('', true) }}",
    })


def _line_item_source(line_var: str, order_var: str) -> str:
    return _json_source_record({
        "sales_order_id": "{{ steps.upsert_sales_order.record_id }}",
        "shopify_line_item_id": (
            "{% if " + line_var + ".admin_graphql_api_id | default('', true) %}{{ " + line_var + ".admin_graphql_api_id | default('', true) }}"
            "{% elif " + line_var + ".id | default('', true) %}gid://shopify/LineItem/{{ " + line_var + ".id | default('', true) }}{% endif %}"
        ),
        "shopify_product_id": (
            "{% if " + line_var + ".product_id | default('', true) %}gid://shopify/Product/{{ " + line_var + ".product_id | default('', true) }}{% endif %}"
        ),
        "shopify_variant_id": (
            "{% if " + line_var + ".variant_id | default('', true) %}gid://shopify/ProductVariant/{{ " + line_var + ".variant_id | default('', true) }}{% endif %}"
        ),
        "sku_snapshot": "{{ " + line_var + ".sku | default('', true) }}",
        "description": (
            "{% if " + line_var + ".variant_title | default('', true) and " + line_var + ".variant_title | default('', true) != 'Default Title' %}"
            "{{ " + line_var + ".title | default('', true) }} - {{ " + line_var + ".variant_title | default('', true) }}"
            "{% elif " + line_var + ".title | default('', true) %}{{ " + line_var + ".title | default('', true) }}"
            "{% elif " + line_var + ".name | default('', true) %}{{ " + line_var + ".name | default('', true) }}"
            "{% else %}Shopify line item{% endif %}"
        ),
        "uom_snapshot": "EA",
        "currency_snapshot": "{{ " + order_var + ".currency | default('NZD', true) }}",
        "quantity": "{{ " + line_var + ".quantity | default(0, true) }}",
        "fulfillable_quantity": "{{ " + line_var + ".fulfillable_quantity | default(0, true) }}",
        "unit_price": "{{ " + line_var + ".price | default(0, true) }}",
        "line_discount_total": "{{ " + line_var + ".total_discount | default(0, true) }}",
        "line_tax_total": _first_list_value(line_var, "tax_lines", "price", "0"),
        "unit_cost_snapshot": 0,
        "product_record_id": "{{ steps.find_product_for_line.first.record_id | default('', true) }}",
    })


def build_orders_consumer_automation(
    *,
    status: str,
    order_mapping_id: str,
    order_line_mapping_id: str,
    customer_mapping_id: str,
    notify_recipient_user_ids: list[str] | None = None,
    email_recipients: list[str] | None = None,
) -> dict[str, Any]:
    steps: list[dict[str, Any]] = [
        {
            "id": "maybe_upsert_customer",
            "kind": "condition",
            "expr": {
                "op": "or",
                "children": [
                    {"op": "exists", "left": {"var": "trigger.payload.email"}},
                    {"op": "exists", "left": {"var": "trigger.payload.customer.email"}},
                ],
            },
            "then_steps": [
                {
                    "id": "upsert_order_customer",
                    "kind": "action",
                    "action_id": "system.apply_integration_mapping",
                    "inputs": {
                        "connection_id": {"var": "trigger.connection_id"},
                        "mapping_id": customer_mapping_id,
                        "source_record": _order_customer_source("trigger.payload"),
                        "resource_key": "Customers",
                    },
                }
            ],
        },
        {
            "id": "upsert_sales_order",
            "kind": "action",
            "action_id": "system.apply_integration_mapping",
            "inputs": {
                "connection_id": {"var": "trigger.connection_id"},
                "mapping_id": order_mapping_id,
                "source_record": _order_source("trigger.payload"),
                "resource_key": "Orders",
            },
        },
        {
            "id": "upsert_sales_order_lines",
            "kind": "foreach",
            "over": "{{ trigger.payload.line_items }}",
            "item_name": "line_item",
            "steps": [
                {
                    "id": "find_product_for_line",
                    "kind": "action",
                    "action_id": "system.query_records",
                    "store_as": "find_product_for_line",
                    "inputs": {
                        "entity_id": "entity.te_product",
                        "limit": 1,
                        "filter_expr": {
                            "op": "eq",
                            "field": "te_product.sku",
                            "value": "{{ line_item.sku | default('', true) }}",
                        },
                    },
                },
                {
                    "id": "upsert_sales_order_line",
                    "kind": "action",
                    "action_id": "system.apply_integration_mapping",
                    "inputs": {
                        "connection_id": {"var": "trigger.connection_id"},
                        "mapping_id": order_line_mapping_id,
                        "source_record": _line_item_source("line_item", "trigger.payload"),
                        "resource_key": "Orders",
                    },
                },
            ],
        },
    ]
    new_order_then_steps: list[dict[str, Any]] = []
    if notify_recipient_user_ids:
        new_order_then_steps.append(
            {
                "id": "send_order_notifications",
                "kind": "action",
                "action_id": "system.notify",
                "inputs": {
                    "recipient_user_ids": notify_recipient_user_ids,
                    "entity_id": "entity.te_sales_order",
                    "record_id": "{{ steps.upsert_sales_order.record_id }}",
                    "title": "New Shopify order {{ trigger.payload.name or trigger.payload.order_number }}",
                    "body": "{{ trigger.payload.email or 'A customer' }} placed Shopify order {{ trigger.payload.name or trigger.payload.order_number }}.",
                    "severity": "info",
                    "link_mode": "trigger_record",
                },
            }
        )
    if email_recipients:
        new_order_then_steps.append(
            {
                "id": "send_order_email_alert",
                "kind": "action",
                "action_id": "system.send_email",
                "inputs": {
                    "to": email_recipients,
                    "entity_id": "entity.te_sales_order",
                    "record_id": "{{ steps.upsert_sales_order.record_id }}",
                    "subject": "New Shopify order {{ trigger.payload.name or trigger.payload.order_number }}",
                    "body_text": (
                        "{{ trigger.payload.email or 'A customer' }} placed Shopify order "
                        "{{ trigger.payload.name or trigger.payload.order_number }}.\n"
                        "Total: {{ trigger.payload.current_total_price or trigger.payload.total_price }} {{ trigger.payload.currency or 'NZD' }}\n"
                        "Open in Octodrop: /data/te_sales_order/{{ steps.upsert_sales_order.record_id }}"
                    ),
                },
            }
        )
    if new_order_then_steps:
        steps.append(
            {
                "id": "notify_new_shopify_order",
                "kind": "condition",
                "expr": {
                    "op": "eq",
                    "left": {"var": "steps.upsert_sales_order.operation"},
                    "right": {"literal": "created"},
                },
                "then_steps": new_order_then_steps,
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


def build_refunds_consumer_automation(
    *,
    status: str,
    connection_id: str,
    order_mapping_id: str,
    order_line_mapping_id: str,
    customer_mapping_id: str,
) -> dict[str, Any]:
    return {
        "name": "Shopify Phase 2 - Refunds Inbound",
        "description": "Refresh the linked TE sales order from Shopify when Shopify emits a refund webhook.",
        "status": status,
        "trigger": {
            "kind": "event",
            "event_types": ["integration.webhook.shopify.refunds.create"],
            "filters": [],
        },
        "steps": [
            {
                "id": "fetch_refunded_order",
                "kind": "action",
                "action_id": "system.integration_request",
                "store_as": "fetch_refunded_order",
                "inputs": {
                    "connection_id": connection_id,
                    "method": "GET",
                    "path": "/orders/{{ trigger.payload.order_id }}.json",
                    "query": {"status": "any"},
                },
            },
            {
                "id": "refund_order_found",
                "kind": "condition",
                "expr": {"op": "exists", "left": {"var": "steps.fetch_refunded_order.body_json.order.id"}},
                "stop_on_false": True,
                "then_steps": [
                    {
                        "id": "maybe_upsert_refund_customer",
                        "kind": "condition",
                        "expr": {
                            "op": "or",
                            "children": [
                                {"op": "exists", "left": {"var": "steps.fetch_refunded_order.body_json.order.email"}},
                                {"op": "exists", "left": {"var": "steps.fetch_refunded_order.body_json.order.customer.email"}},
                            ],
                        },
                        "then_steps": [
                            {
                                "id": "upsert_refund_order_customer",
                                "kind": "action",
                                "action_id": "system.apply_integration_mapping",
                                "inputs": {
                                    "connection_id": {"var": "trigger.connection_id"},
                                    "mapping_id": customer_mapping_id,
                                    "source_record": _order_customer_source("steps.fetch_refunded_order.body_json.order"),
                                    "resource_key": "Customers",
                                },
                            }
                        ],
                    },
                    {
                        "id": "upsert_refunded_sales_order",
                        "kind": "action",
                        "action_id": "system.apply_integration_mapping",
                        "inputs": {
                            "connection_id": {"var": "trigger.connection_id"},
                            "mapping_id": order_mapping_id,
                            "source_record": _order_source("steps.fetch_refunded_order.body_json.order"),
                            "resource_key": "Orders",
                        },
                    },
                ],
            },
        ],
    }


def build_customers_consumer_automation(*, status: str, customer_mapping_id: str) -> dict[str, Any]:
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
                "action_id": "system.apply_integration_mapping",
                "inputs": {
                    "connection_id": {"var": "trigger.connection_id"},
                    "mapping_id": customer_mapping_id,
                    "source_record": _shopify_customer_source("trigger.payload"),
                    "resource_key": "Customers",
                },
            }
        ],
    }


def build_products_consumer_automation(*, status: str, product_mapping_id: str) -> dict[str, Any]:
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
                "id": "upsert_shopify_product_variants",
                "kind": "foreach",
                "over": "{{ trigger.payload.variants }}",
                "item_name": "variant",
                "steps": [
                    {
                        "id": "sku_present",
                        "kind": "condition",
                        "expr": {"op": "exists", "left": {"var": "variant.sku"}},
                        "stop_on_false": True,
                        "then_steps": [
                            {
                                "id": "upsert_shopify_product",
                                "kind": "action",
                                "action_id": "system.apply_integration_mapping",
                                "inputs": {
                                    "connection_id": {"var": "trigger.connection_id"},
                                    "mapping_id": product_mapping_id,
                                    "source_record": _product_variant_source("trigger.payload", "variant"),
                                    "resource_key": "Products",
                                },
                            }
                        ],
                    }
                ],
            }
        ],
    }


def all_mapping_definitions(*, connection_id: str) -> list[dict[str, Any]]:
    return [
        build_customer_mapping(connection_id),
        build_product_mapping(connection_id),
        build_sales_order_mapping(connection_id),
        build_sales_order_line_mapping(connection_id),
    ]


def all_automation_definitions(
    *,
    publish: bool,
    connection_id: str,
    customer_mapping_id: str,
    product_mapping_id: str,
    order_mapping_id: str,
    order_line_mapping_id: str,
    notify_recipient_user_ids: list[str] | None = None,
    order_email_recipients: list[str] | None = None,
) -> list[dict[str, Any]]:
    status = "published" if publish else "draft"
    return [
        build_orders_consumer_automation(
            status=status,
            customer_mapping_id=customer_mapping_id,
            order_mapping_id=order_mapping_id,
            order_line_mapping_id=order_line_mapping_id,
            notify_recipient_user_ids=notify_recipient_user_ids,
            email_recipients=order_email_recipients,
        ),
        build_refunds_consumer_automation(
            status=status,
            connection_id=connection_id,
            customer_mapping_id=customer_mapping_id,
            order_mapping_id=order_mapping_id,
            order_line_mapping_id=order_line_mapping_id,
        ),
        build_customers_consumer_automation(status=status, customer_mapping_id=customer_mapping_id),
        build_products_consumer_automation(status=status, product_mapping_id=product_mapping_id),
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description="Register the TE Shopify phase-2 webhook consumer automations.")
    parser.add_argument("--base-url", default=os.getenv("OCTO_BASE_URL", "http://localhost:8000"))
    parser.add_argument("--token", default=os.getenv("OCTO_API_TOKEN"))
    parser.add_argument("--workspace-id", default=os.getenv("OCTO_WORKSPACE_ID"))
    parser.add_argument("--connection-id", default=os.getenv("OCTO_SHOPIFY_CONNECTION_ID"))
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
    if not args.connection_id:
        raise SystemExit("Missing --connection-id or OCTO_SHOPIFY_CONNECTION_ID")
    if _looks_like_placeholder(args.connection_id):
        raise SystemExit(
            "Replace --connection-id with the real Shopify connection id from Integrations. "
            "Do not pass the placeholder value."
        )

    base_url = args.base_url.rstrip("/")
    for definition in all_mapping_definitions(connection_id=args.connection_id):
        action, mapping = upsert_mapping_by_name(
            base_url,
            definition,
            token=args.token,
            workspace_id=args.workspace_id,
            connection_id=args.connection_id,
        )
        print(f"[mapping] {action} {definition['name']} -> {mapping.get('id')}")
    saved_mappings = {
        row["name"]: row
        for row in list_mappings(base_url, token=args.token, workspace_id=args.workspace_id, connection_id=args.connection_id)
        if isinstance(row, dict) and isinstance(row.get("name"), str)
    }

    notify_recipient_user_ids: list[str] | None = None
    order_email_recipients: list[str] | None = None
    if not args.skip_order_notifications:
        requested_recipients = args.order_notify_recipients or []
        if requested_recipients:
            notify_recipient_user_ids = resolve_member_user_ids(
                base_url,
                requested_recipients,
                token=args.token,
                workspace_id=args.workspace_id,
            )
            print(f"[automation] order notifications -> {', '.join(notify_recipient_user_ids)}")
        else:
            print("[automation] order notifications skipped: no recipients provided")
    if not args.skip_order_emails:
        requested_email_recipients = args.order_email_to or args.order_notify_recipients or []
        if requested_email_recipients:
            order_email_recipients = resolve_member_emails(
                base_url,
                requested_email_recipients,
                token=args.token,
                workspace_id=args.workspace_id,
            )
            print(f"[automation] order emails -> {', '.join(order_email_recipients)}")
        else:
            print("[automation] order emails skipped: no recipients provided")

    for definition in all_automation_definitions(
        publish=args.publish,
        connection_id=args.connection_id,
        customer_mapping_id=str(saved_mappings["TE Shopify - Customer Webhook Mapping"]["id"]),
        product_mapping_id=str(saved_mappings["TE Shopify - Product Variant Webhook Mapping"]["id"]),
        order_mapping_id=str(saved_mappings["TE Shopify - Sales Order Webhook Mapping"]["id"]),
        order_line_mapping_id=str(saved_mappings["TE Shopify - Sales Order Line Webhook Mapping"]["id"]),
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
