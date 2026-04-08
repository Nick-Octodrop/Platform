#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass
from typing import Any
from urllib import error as urlerror
from urllib import parse as urlparse
from urllib import request as urlrequest


@dataclass
class CreatedRecord:
    record_id: str
    record: dict[str, Any]


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


def create_record(base_url: str, entity_id: str, record: dict[str, Any], *, token: str | None, workspace_id: str | None) -> CreatedRecord:
    status, payload = api_call(
        "POST",
        f"{base_url}/records/{urlparse.quote(entity_id, safe='')}",
        token=token,
        workspace_id=workspace_id,
        body={"record": record},
        timeout=120,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"create {entity_id} failed: {collect_error_text(payload)}")
    record_id = payload.get("record_id")
    created_record = payload.get("record")
    if not isinstance(record_id, str) or not record_id:
        raise RuntimeError(f"create {entity_id} failed: missing record_id")
    if not isinstance(created_record, dict):
        created_record = record
    return CreatedRecord(record_id=record_id, record=created_record)


def update_record(base_url: str, entity_id: str, record_id: str, record: dict[str, Any], *, token: str | None, workspace_id: str | None) -> CreatedRecord:
    status, payload = api_call(
        "PUT",
        f"{base_url}/records/{urlparse.quote(entity_id, safe='')}/{urlparse.quote(record_id, safe='')}",
        token=token,
        workspace_id=workspace_id,
        body={"record": record},
        timeout=120,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"update {entity_id}/{record_id} failed: {collect_error_text(payload)}")
    updated_record = payload.get("record")
    if not isinstance(updated_record, dict):
        updated_record = record
    return CreatedRecord(record_id=record_id, record=updated_record)


def list_records(
    base_url: str,
    entity_id: str,
    *,
    token: str | None,
    workspace_id: str | None,
    fields: list[str] | None = None,
    cap: int = 500,
) -> list[CreatedRecord]:
    out: list[CreatedRecord] = []
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
            timeout=120,
        )
        if status >= 400 or not is_ok(payload):
            break
        rows = payload.get("records")
        if not isinstance(rows, list) or not rows:
            break
        for row in rows:
            if not isinstance(row, dict):
                continue
            record_id = row.get("record_id")
            record = row.get("record")
            if isinstance(record_id, str) and record_id and isinstance(record, dict):
                out.append(CreatedRecord(record_id=record_id, record=record))
        cursor = payload.get("next_cursor") if isinstance(payload.get("next_cursor"), str) else None
        if not cursor:
            break
    return out


def find_existing_record(
    base_url: str,
    entity_id: str,
    match_fields: dict[str, Any],
    *,
    token: str | None,
    workspace_id: str | None,
) -> CreatedRecord | None:
    for existing in list_records(
        base_url,
        entity_id,
        token=token,
        workspace_id=workspace_id,
        fields=None,
    ):
        if all(existing.record.get(field_id) == expected for field_id, expected in match_fields.items()):
            return existing
    return None


def resolve_refs(value: Any, aliases: dict[str, CreatedRecord]) -> Any:
    if isinstance(value, dict):
      if set(value.keys()) == {"$ref"}:
          ref = value["$ref"]
          if ref not in aliases:
              raise KeyError(f"Unknown seed ref: {ref}")
          return aliases[ref].record_id
      return {k: resolve_refs(v, aliases) for k, v in value.items()}
    if isinstance(value, list):
        return [resolve_refs(v, aliases) for v in value]
    return value


def create_or_get(
    base_url: str,
    spec: dict[str, Any],
    aliases: dict[str, CreatedRecord],
    *,
    token: str | None,
    workspace_id: str | None,
    dry_run: bool,
) -> CreatedRecord:
    entity_id = spec["entity_id"]
    alias = spec["alias"]
    payload = resolve_refs(spec["record"], aliases)
    match_fields = resolve_refs(spec["match"], aliases)
    if dry_run:
        created = CreatedRecord(record_id=f"dry-run:{alias}", record=payload)
        aliases[alias] = created
        print(f"[seed] plan     {alias} -> {entity_id}")
        return created
    existing = find_existing_record(base_url, entity_id, match_fields, token=token, workspace_id=workspace_id)
    if existing:
        aliases[alias] = existing
        print(f"[seed] existing {alias} -> {existing.record_id}")
        return existing
    created = create_record(base_url, entity_id, payload, token=token, workspace_id=workspace_id)
    aliases[alias] = created
    print(f"[seed] created  {alias} -> {created.record_id}")
    return created


CONTACTS = [
    {
        "alias": "contact.greengrow",
        "entity_id": "entity.biz_contact",
        "match": {"biz_contact.name": "GreenGrow BV"},
        "record": {
            "biz_contact.name": "GreenGrow BV",
            "biz_contact.contact_type": "customer",
            "biz_contact.company_entity_scope": ["NLight BV"],
            "biz_contact.email": "procurement@greengrow.example",
            "biz_contact.phone": "+31 20 555 0101",
            "biz_contact.website": "https://greengrow.example",
            "biz_contact.country": "Netherlands",
            "biz_contact.currency_preference": "EUR",
            "biz_contact.billing_street": "Keizersgracht 100",
            "biz_contact.billing_city": "Amsterdam",
            "biz_contact.billing_country": "Netherlands",
            "biz_contact.shipping_street": "Aalsmeer Trade Park 4",
            "biz_contact.shipping_city": "Aalsmeer",
            "biz_contact.shipping_country": "Netherlands",
            "biz_contact.notes": "Lead customer for demo scenario A.",
            "biz_contact.is_active": True
        }
    },
    {
        "alias": "contact.desert_bloom",
        "entity_id": "entity.biz_contact",
        "match": {"biz_contact.name": "Desert Bloom Trading"},
        "record": {
            "biz_contact.name": "Desert Bloom Trading",
            "biz_contact.contact_type": "customer",
            "biz_contact.company_entity_scope": ["NLight BV"],
            "biz_contact.email": "sales@desertbloom.example",
            "biz_contact.phone": "+971 4 555 0110",
            "biz_contact.website": "https://desertbloom.example",
            "biz_contact.country": "United Arab Emirates",
            "biz_contact.currency_preference": "USD",
            "biz_contact.billing_street": "Dubai Investment Park",
            "biz_contact.billing_city": "Dubai",
            "biz_contact.billing_country": "United Arab Emirates",
            "biz_contact.shipping_street": "Jebel Ali South",
            "biz_contact.shipping_city": "Dubai",
            "biz_contact.shipping_country": "United Arab Emirates",
            "biz_contact.notes": "Quote scenario B.",
            "biz_contact.is_active": True
        }
    },
    {
        "alias": "contact.volga",
        "entity_id": "entity.biz_contact",
        "match": {"biz_contact.name": "Volga Horticulture Group"},
        "record": {
            "biz_contact.name": "Volga Horticulture Group",
            "biz_contact.contact_type": "customer",
            "biz_contact.company_entity_scope": ["NLight BV"],
            "biz_contact.email": "projects@volga.example",
            "biz_contact.phone": "+7 495 555 0199",
            "biz_contact.website": "https://volga.example",
            "biz_contact.country": "Kazakhstan",
            "biz_contact.currency_preference": "EUR",
            "biz_contact.billing_street": "Astana Business Centre",
            "biz_contact.billing_city": "Astana",
            "biz_contact.billing_country": "Kazakhstan",
            "biz_contact.shipping_street": "Karaganda Logistics Hub",
            "biz_contact.shipping_city": "Karaganda",
            "biz_contact.shipping_country": "Kazakhstan",
            "biz_contact.notes": "Order and invoice scenario C.",
            "biz_contact.is_active": True
        }
    },
    {
        "alias": "contact.shenzhen",
        "entity_id": "entity.biz_contact",
        "match": {"biz_contact.name": "Shenzhen Lumatek Manufacturing"},
        "record": {
            "biz_contact.name": "Shenzhen Lumatek Manufacturing",
            "biz_contact.contact_type": "supplier",
            "biz_contact.company_entity_scope": ["EcoTech FZCO"],
            "biz_contact.email": "export@lumatek.example",
            "biz_contact.phone": "+86 755 5550 1880",
            "biz_contact.website": "https://lumatek.example",
            "biz_contact.country": "China",
            "biz_contact.currency_preference": "USD",
            "biz_contact.billing_street": "Bao'an District",
            "biz_contact.billing_city": "Shenzhen",
            "biz_contact.billing_country": "China",
            "biz_contact.shipping_street": "Yantian Port",
            "biz_contact.shipping_city": "Shenzhen",
            "biz_contact.shipping_country": "China",
            "biz_contact.notes": "Main supplier for scenario A.",
            "biz_contact.is_active": True
        }
    },
    {
        "alias": "contact.guangzhou",
        "entity_id": "entity.biz_contact",
        "match": {"biz_contact.name": "Guangzhou LED Systems Co"},
        "record": {
            "biz_contact.name": "Guangzhou LED Systems Co",
            "biz_contact.contact_type": "factory_partner",
            "biz_contact.company_entity_scope": ["EcoTech FZCO"],
            "biz_contact.email": "factory@guangzhouled.example",
            "biz_contact.phone": "+86 20 5550 6600",
            "biz_contact.website": "https://guangzhouled.example",
            "biz_contact.country": "China",
            "biz_contact.currency_preference": "USD",
            "biz_contact.billing_street": "Panyu District",
            "biz_contact.billing_city": "Guangzhou",
            "biz_contact.billing_country": "China",
            "biz_contact.shipping_street": "Nansha Port",
            "biz_contact.shipping_city": "Guangzhou",
            "biz_contact.shipping_country": "China",
            "biz_contact.notes": "Factory partner for scenario C.",
            "biz_contact.is_active": True
        }
    }
]

PRODUCTS = [
    ("product.led600", "NL-LED-600W", "N-Light LED 600W", "EA", 420, 275, "contact.shenzhen"),
    ("product.led720", "NL-LED-720W", "N-Light LED 720W", "EA", 520, 335, "contact.shenzhen"),
    ("product.driver240", "NL-DRIVER-240", "Driver 240", "EA", 78, 42, "contact.guangzhou"),
    ("product.hanger", "NL-HANGER-KIT", "Hanger Kit", "KIT", 24, 8, "contact.shenzhen"),
    ("product.control", "NL-CONTROL-UNIT", "Control Unit", "EA", 165, 96, "contact.guangzhou"),
    ("product.cabling", "NL-CABLING-SET", "Cabling Set", "SET", 18, 6, "contact.shenzhen"),
    ("product.mount", "NL-MOUNT-BAR", "Mount Bar", "EA", 32, 13, "contact.shenzhen"),
    ("product.custom", "NL-CUSTOM-ACCESSORY", "Custom Accessory", "LOT", 95, 44, "contact.guangzhou")
]


def product_specs() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for alias, code, name, uom, sell, buy, supplier_ref in PRODUCTS:
        out.append(
            {
                "alias": alias,
                "entity_id": "entity.biz_product",
                "match": {"biz_product.code": code},
                "record": {
                    "biz_product.code": code,
                    "biz_product.name": name,
                    "biz_product.description": f"{name} for greenhouse lighting projects.",
                    "biz_product.category": "Lighting",
                    "biz_product.uom": uom,
                    "biz_product.default_sales_currency": "EUR",
                    "biz_product.default_sales_price": sell,
                    "biz_product.default_purchase_currency": "USD",
                    "biz_product.default_buy_price": buy,
                    "biz_product.preferred_supplier_id": {"$ref": supplier_ref},
                    "biz_product.supplier_factory_reference": f"{code}-FACTORY",
                    "biz_product.internal_notes": "Demo catalogue item.",
                    "biz_product.is_active": True
                }
            }
        )
    return out


SEED_SPECS = [
    {
        "alias": "quote.a",
        "entity_id": "entity.biz_quote",
        "match": {"biz_quote.customer_reference": "GG-POC-2026-01"},
        "record": {
            "biz_quote.status": "accepted",
            "biz_quote.quote_date": "2026-03-20",
            "biz_quote.expiry_date": "2026-04-10",
            "biz_quote.sales_entity": "NLight BV",
            "biz_quote.customer_id": {"$ref": "contact.greengrow"},
            "biz_quote.customer_contact_name": "Eva van Dijk",
            "biz_quote.customer_reference": "GG-POC-2026-01",
            "biz_quote.currency": "EUR",
            "biz_quote.sales_owner": "Account Team",
            "biz_quote.payment_terms": "30% deposit, balance before shipment",
            "biz_quote.incoterm": "FCA",
            "biz_quote.shipping_terms": "Sea freight coordinated by seller",
            "biz_quote.validity_notes": "Valid for 14 days.",
            "biz_quote.internal_notes": "Accepted and converted for demo scenario A.",
            "biz_quote.customer_notes": "Supply for Amsterdam greenhouse expansion."
        }
    },
    {
        "alias": "quote.b",
        "entity_id": "entity.biz_quote",
        "match": {"biz_quote.customer_reference": "DBT-RFQ-44"},
        "record": {
            "biz_quote.status": "sent",
            "biz_quote.quote_date": "2026-03-25",
            "biz_quote.expiry_date": "2026-04-15",
            "biz_quote.sales_entity": "NLight BV",
            "biz_quote.customer_id": {"$ref": "contact.desert_bloom"},
            "biz_quote.customer_contact_name": "Omar Al Hadi",
            "biz_quote.customer_reference": "DBT-RFQ-44",
            "biz_quote.currency": "USD",
            "biz_quote.sales_owner": "Account Team",
            "biz_quote.payment_terms": "50% deposit, 50% before dispatch",
            "biz_quote.incoterm": "EXW",
            "biz_quote.shipping_terms": "Customer freight forwarder",
            "biz_quote.validity_notes": "Pricing subject to component availability.",
            "biz_quote.customer_notes": "Awaiting internal approval."
        }
    },
    {
        "alias": "quote.c",
        "entity_id": "entity.biz_quote",
        "match": {"biz_quote.customer_reference": "VOLGA-GROW-09"},
        "record": {
            "biz_quote.status": "accepted",
            "biz_quote.quote_date": "2026-03-10",
            "biz_quote.expiry_date": "2026-03-31",
            "biz_quote.sales_entity": "NLight BV",
            "biz_quote.customer_id": {"$ref": "contact.volga"},
            "biz_quote.customer_contact_name": "Irina Sokolova",
            "biz_quote.customer_reference": "VOLGA-GROW-09",
            "biz_quote.currency": "EUR",
            "biz_quote.sales_owner": "Account Team",
            "biz_quote.payment_terms": "30% deposit, 70% final invoice",
            "biz_quote.incoterm": "DAP",
            "biz_quote.shipping_terms": "Project delivery to Karaganda hub",
            "biz_quote.validity_notes": "Includes project coordination.",
            "biz_quote.customer_notes": "Priority customer order."
        }
    },
    {
        "alias": "quote_line.a.1",
        "entity_id": "entity.biz_quote_line",
        "match": {"biz_quote_line.description": "NL-LED-720W", "biz_quote_line.quote_id": {"$ref": "quote.a"}},
        "record": {
            "biz_quote_line.quote_id": {"$ref": "quote.a"},
            "biz_quote_line.line_type": "catalogue",
            "biz_quote_line.product_id": {"$ref": "product.led720"},
            "biz_quote_line.description": "NL-LED-720W",
            "biz_quote_line.sales_entity_snapshot": "NLight BV",
            "biz_quote_line.currency_snapshot": "EUR",
            "biz_quote_line.uom": "EA",
            "biz_quote_line.quantity": 120,
            "biz_quote_line.unit_price": 520,
            "biz_quote_line.line_discount_percent": 0,
            "biz_quote_line.default_buy_price_snapshot": 335,
            "biz_quote_line.buy_currency_snapshot": "USD"
        }
    },
    {
        "alias": "quote_line.a.2",
        "entity_id": "entity.biz_quote_line",
        "match": {"biz_quote_line.description": "NL-HANGER-KIT", "biz_quote_line.quote_id": {"$ref": "quote.a"}},
        "record": {
            "biz_quote_line.quote_id": {"$ref": "quote.a"},
            "biz_quote_line.line_type": "catalogue",
            "biz_quote_line.product_id": {"$ref": "product.hanger"},
            "biz_quote_line.description": "NL-HANGER-KIT",
            "biz_quote_line.sales_entity_snapshot": "NLight BV",
            "biz_quote_line.currency_snapshot": "EUR",
            "biz_quote_line.uom": "KIT",
            "biz_quote_line.quantity": 120,
            "biz_quote_line.unit_price": 24,
            "biz_quote_line.line_discount_percent": 0,
            "biz_quote_line.default_buy_price_snapshot": 8,
            "biz_quote_line.buy_currency_snapshot": "USD"
        }
    },
    {
        "alias": "quote_line.a.3",
        "entity_id": "entity.biz_quote_line",
        "match": {"biz_quote_line.description": "Custom freight coordination", "biz_quote_line.quote_id": {"$ref": "quote.a"}},
        "record": {
            "biz_quote_line.quote_id": {"$ref": "quote.a"},
            "biz_quote_line.line_type": "custom",
            "biz_quote_line.description": "Custom freight coordination",
            "biz_quote_line.sales_entity_snapshot": "NLight BV",
            "biz_quote_line.currency_snapshot": "EUR",
            "biz_quote_line.uom": "LOT",
            "biz_quote_line.quantity": 1,
            "biz_quote_line.unit_price": 1450,
            "biz_quote_line.line_discount_percent": 0,
            "biz_quote_line.default_buy_price_snapshot": 700,
            "biz_quote_line.buy_currency_snapshot": "EUR"
        }
    },
    {
        "alias": "quote_line.b.1",
        "entity_id": "entity.biz_quote_line",
        "match": {"biz_quote_line.description": "NL-LED-600W", "biz_quote_line.quote_id": {"$ref": "quote.b"}},
        "record": {
            "biz_quote_line.quote_id": {"$ref": "quote.b"},
            "biz_quote_line.line_type": "catalogue",
            "biz_quote_line.product_id": {"$ref": "product.led600"},
            "biz_quote_line.description": "NL-LED-600W",
            "biz_quote_line.sales_entity_snapshot": "NLight BV",
            "biz_quote_line.currency_snapshot": "USD",
            "biz_quote_line.uom": "EA",
            "biz_quote_line.quantity": 200,
            "biz_quote_line.unit_price": 420,
            "biz_quote_line.default_buy_price_snapshot": 275,
            "biz_quote_line.buy_currency_snapshot": "USD"
        }
    },
    {
        "alias": "quote_line.b.2",
        "entity_id": "entity.biz_quote_line",
        "match": {"biz_quote_line.description": "NL-CABLING-SET", "biz_quote_line.quote_id": {"$ref": "quote.b"}},
        "record": {
            "biz_quote_line.quote_id": {"$ref": "quote.b"},
            "biz_quote_line.line_type": "catalogue",
            "biz_quote_line.product_id": {"$ref": "product.cabling"},
            "biz_quote_line.description": "NL-CABLING-SET",
            "biz_quote_line.sales_entity_snapshot": "NLight BV",
            "biz_quote_line.currency_snapshot": "USD",
            "biz_quote_line.uom": "SET",
            "biz_quote_line.quantity": 200,
            "biz_quote_line.unit_price": 18,
            "biz_quote_line.default_buy_price_snapshot": 6,
            "biz_quote_line.buy_currency_snapshot": "USD"
        }
    },
    {
        "alias": "quote_line.c.1",
        "entity_id": "entity.biz_quote_line",
        "match": {"biz_quote_line.description": "NL-LED-720W", "biz_quote_line.quote_id": {"$ref": "quote.c"}},
        "record": {
            "biz_quote_line.quote_id": {"$ref": "quote.c"},
            "biz_quote_line.line_type": "catalogue",
            "biz_quote_line.product_id": {"$ref": "product.led720"},
            "biz_quote_line.description": "NL-LED-720W",
            "biz_quote_line.sales_entity_snapshot": "NLight BV",
            "biz_quote_line.currency_snapshot": "EUR",
            "biz_quote_line.uom": "EA",
            "biz_quote_line.quantity": 80,
            "biz_quote_line.unit_price": 515,
            "biz_quote_line.default_buy_price_snapshot": 335,
            "biz_quote_line.buy_currency_snapshot": "USD"
        }
    },
    {
        "alias": "quote_line.c.2",
        "entity_id": "entity.biz_quote_line",
        "match": {"biz_quote_line.description": "NL-CONTROL-UNIT", "biz_quote_line.quote_id": {"$ref": "quote.c"}},
        "record": {
            "biz_quote_line.quote_id": {"$ref": "quote.c"},
            "biz_quote_line.line_type": "catalogue",
            "biz_quote_line.product_id": {"$ref": "product.control"},
            "biz_quote_line.description": "NL-CONTROL-UNIT",
            "biz_quote_line.sales_entity_snapshot": "NLight BV",
            "biz_quote_line.currency_snapshot": "EUR",
            "biz_quote_line.uom": "EA",
            "biz_quote_line.quantity": 8,
            "biz_quote_line.unit_price": 165,
            "biz_quote_line.default_buy_price_snapshot": 96,
            "biz_quote_line.buy_currency_snapshot": "USD"
        }
    },
    {
        "alias": "order.a",
        "entity_id": "entity.biz_order",
        "match": {"biz_order.customer_reference": "GG-POC-2026-01"},
        "record": {
            "biz_order.status": "confirmed",
            "biz_order.customer_id": {"$ref": "contact.greengrow"},
            "biz_order.source_quote_id": {"$ref": "quote.a"},
            "biz_order.sales_entity": "NLight BV",
            "biz_order.order_date": "2026-03-22",
            "biz_order.currency": "EUR",
            "biz_order.customer_reference": "GG-POC-2026-01",
            "biz_order.delivery_terms": "DAP Amsterdam",
            "biz_order.shipping_destination": "Aalsmeer Trade Park 4, Aalsmeer",
            "biz_order.requested_delivery_date": "2026-05-20",
            "biz_order.notes": "Accepted order for scenario A.",
            "biz_order.preferred_supplier_id": {"$ref": "contact.shenzhen"},
            "biz_order.deposit_percent": 30
        }
    },
    {
        "alias": "order.c",
        "entity_id": "entity.biz_order",
        "match": {"biz_order.customer_reference": "VOLGA-GROW-09"},
        "record": {
            "biz_order.status": "confirmed",
            "biz_order.customer_id": {"$ref": "contact.volga"},
            "biz_order.source_quote_id": {"$ref": "quote.c"},
            "biz_order.sales_entity": "NLight BV",
            "biz_order.order_date": "2026-03-12",
            "biz_order.currency": "EUR",
            "biz_order.customer_reference": "VOLGA-GROW-09",
            "biz_order.delivery_terms": "DAP Kazakhstan",
            "biz_order.shipping_destination": "Karaganda Logistics Hub, Kazakhstan",
            "biz_order.requested_delivery_date": "2026-04-30",
            "biz_order.notes": "Scenario C operational order.",
            "biz_order.preferred_supplier_id": {"$ref": "contact.guangzhou"},
            "biz_order.deposit_percent": 30
        }
    },
    {
        "alias": "order_line.a.1",
        "entity_id": "entity.biz_order_line",
        "match": {"biz_order_line.description": "NL-LED-720W", "biz_order_line.customer_order_id": {"$ref": "order.a"}},
        "record": {
            "biz_order_line.customer_order_id": {"$ref": "order.a"},
            "biz_order_line.product_id": {"$ref": "product.led720"},
            "biz_order_line.description": "NL-LED-720W",
            "biz_order_line.sales_entity_snapshot": "NLight BV",
            "biz_order_line.currency_snapshot": "EUR",
            "biz_order_line.uom": "EA",
            "biz_order_line.quantity": 120,
            "biz_order_line.unit_price": 520,
            "biz_order_line.unit_cost_snapshot": 335,
            "biz_order_line.source_quote_line_ref": {"$ref": "quote_line.a.1"}
        }
    },
    {
        "alias": "order_line.a.2",
        "entity_id": "entity.biz_order_line",
        "match": {"biz_order_line.description": "NL-HANGER-KIT", "biz_order_line.customer_order_id": {"$ref": "order.a"}},
        "record": {
            "biz_order_line.customer_order_id": {"$ref": "order.a"},
            "biz_order_line.product_id": {"$ref": "product.hanger"},
            "biz_order_line.description": "NL-HANGER-KIT",
            "biz_order_line.sales_entity_snapshot": "NLight BV",
            "biz_order_line.currency_snapshot": "EUR",
            "biz_order_line.uom": "KIT",
            "biz_order_line.quantity": 120,
            "biz_order_line.unit_price": 24,
            "biz_order_line.unit_cost_snapshot": 8,
            "biz_order_line.source_quote_line_ref": {"$ref": "quote_line.a.2"}
        }
    },
    {
        "alias": "order_line.a.3",
        "entity_id": "entity.biz_order_line",
        "match": {"biz_order_line.description": "Custom freight coordination", "biz_order_line.customer_order_id": {"$ref": "order.a"}},
        "record": {
            "biz_order_line.customer_order_id": {"$ref": "order.a"},
            "biz_order_line.description": "Custom freight coordination",
            "biz_order_line.sales_entity_snapshot": "NLight BV",
            "biz_order_line.currency_snapshot": "EUR",
            "biz_order_line.uom": "LOT",
            "biz_order_line.quantity": 1,
            "biz_order_line.unit_price": 1450,
            "biz_order_line.unit_cost_snapshot": 700,
            "biz_order_line.source_quote_line_ref": {"$ref": "quote_line.a.3"}
        }
    },
    {
        "alias": "order_line.c.1",
        "entity_id": "entity.biz_order_line",
        "match": {"biz_order_line.description": "NL-LED-720W", "biz_order_line.customer_order_id": {"$ref": "order.c"}},
        "record": {
            "biz_order_line.customer_order_id": {"$ref": "order.c"},
            "biz_order_line.product_id": {"$ref": "product.led720"},
            "biz_order_line.description": "NL-LED-720W",
            "biz_order_line.sales_entity_snapshot": "NLight BV",
            "biz_order_line.currency_snapshot": "EUR",
            "biz_order_line.uom": "EA",
            "biz_order_line.quantity": 80,
            "biz_order_line.unit_price": 515,
            "biz_order_line.unit_cost_snapshot": 335,
            "biz_order_line.source_quote_line_ref": {"$ref": "quote_line.c.1"}
        }
    },
    {
        "alias": "order_line.c.2",
        "entity_id": "entity.biz_order_line",
        "match": {"biz_order_line.description": "NL-CONTROL-UNIT", "biz_order_line.customer_order_id": {"$ref": "order.c"}},
        "record": {
            "biz_order_line.customer_order_id": {"$ref": "order.c"},
            "biz_order_line.product_id": {"$ref": "product.control"},
            "biz_order_line.description": "NL-CONTROL-UNIT",
            "biz_order_line.sales_entity_snapshot": "NLight BV",
            "biz_order_line.currency_snapshot": "EUR",
            "biz_order_line.uom": "EA",
            "biz_order_line.quantity": 8,
            "biz_order_line.unit_price": 165,
            "biz_order_line.unit_cost_snapshot": 96,
            "biz_order_line.source_quote_line_ref": {"$ref": "quote_line.c.2"}
        }
    },
    {
        "alias": "po.a",
        "entity_id": "entity.biz_purchase_order",
        "match": {"biz_purchase_order.supplier_reference": "SZ-LUM-1001"},
        "record": {
            "biz_purchase_order.status": "sent_to_supplier",
            "biz_purchase_order.supplier_id": {"$ref": "contact.shenzhen"},
            "biz_purchase_order.purchasing_entity": "EcoTech FZCO",
            "biz_purchase_order.source_customer_order_id": {"$ref": "order.a"},
            "biz_purchase_order.po_date": "2026-03-24",
            "biz_purchase_order.currency": "USD",
            "biz_purchase_order.supplier_reference": "SZ-LUM-1001",
            "biz_purchase_order.incoterm": "FOB",
            "biz_purchase_order.expected_ship_date": "2026-04-20",
            "biz_purchase_order.expected_arrival_date": "2026-05-12",
            "biz_purchase_order.notes": "Scenario A factory order.",
            "biz_purchase_order.freight_estimate": 1850
        }
    },
    {
        "alias": "po.c",
        "entity_id": "entity.biz_purchase_order",
        "match": {"biz_purchase_order.supplier_reference": "GZ-LED-1003"},
        "record": {
            "biz_purchase_order.status": "confirmed",
            "biz_purchase_order.supplier_id": {"$ref": "contact.guangzhou"},
            "biz_purchase_order.purchasing_entity": "EcoTech FZCO",
            "biz_purchase_order.source_customer_order_id": {"$ref": "order.c"},
            "biz_purchase_order.po_date": "2026-03-14",
            "biz_purchase_order.currency": "USD",
            "biz_purchase_order.supplier_reference": "GZ-LED-1003",
            "biz_purchase_order.incoterm": "FCA",
            "biz_purchase_order.expected_ship_date": "2026-04-02",
            "biz_purchase_order.expected_arrival_date": "2026-04-25",
            "biz_purchase_order.notes": "Scenario C supplier order.",
            "biz_purchase_order.freight_estimate": 1250
        }
    },
    {
        "alias": "po_line.a.1",
        "entity_id": "entity.biz_purchase_order_line",
        "match": {"biz_purchase_order_line.description": "NL-LED-720W", "biz_purchase_order_line.purchase_order_id": {"$ref": "po.a"}},
        "record": {
            "biz_purchase_order_line.purchase_order_id": {"$ref": "po.a"},
            "biz_purchase_order_line.product_id": {"$ref": "product.led720"},
            "biz_purchase_order_line.description": "NL-LED-720W",
            "biz_purchase_order_line.purchasing_entity_snapshot": "EcoTech FZCO",
            "biz_purchase_order_line.currency_snapshot": "USD",
            "biz_purchase_order_line.uom": "EA",
            "biz_purchase_order_line.quantity": 120,
            "biz_purchase_order_line.unit_cost": 335,
            "biz_purchase_order_line.source_order_line_ref": {"$ref": "order_line.a.1"}
        }
    },
    {
        "alias": "po_line.a.2",
        "entity_id": "entity.biz_purchase_order_line",
        "match": {"biz_purchase_order_line.description": "NL-HANGER-KIT", "biz_purchase_order_line.purchase_order_id": {"$ref": "po.a"}},
        "record": {
            "biz_purchase_order_line.purchase_order_id": {"$ref": "po.a"},
            "biz_purchase_order_line.product_id": {"$ref": "product.hanger"},
            "biz_purchase_order_line.description": "NL-HANGER-KIT",
            "biz_purchase_order_line.purchasing_entity_snapshot": "EcoTech FZCO",
            "biz_purchase_order_line.currency_snapshot": "USD",
            "biz_purchase_order_line.uom": "KIT",
            "biz_purchase_order_line.quantity": 120,
            "biz_purchase_order_line.unit_cost": 8,
            "biz_purchase_order_line.source_order_line_ref": {"$ref": "order_line.a.2"}
        }
    },
    {
        "alias": "po_line.c.1",
        "entity_id": "entity.biz_purchase_order_line",
        "match": {"biz_purchase_order_line.description": "NL-LED-720W", "biz_purchase_order_line.purchase_order_id": {"$ref": "po.c"}},
        "record": {
            "biz_purchase_order_line.purchase_order_id": {"$ref": "po.c"},
            "biz_purchase_order_line.product_id": {"$ref": "product.led720"},
            "biz_purchase_order_line.description": "NL-LED-720W",
            "biz_purchase_order_line.purchasing_entity_snapshot": "EcoTech FZCO",
            "biz_purchase_order_line.currency_snapshot": "USD",
            "biz_purchase_order_line.uom": "EA",
            "biz_purchase_order_line.quantity": 80,
            "biz_purchase_order_line.unit_cost": 335,
            "biz_purchase_order_line.source_order_line_ref": {"$ref": "order_line.c.1"}
        }
    },
    {
        "alias": "po_line.c.2",
        "entity_id": "entity.biz_purchase_order_line",
        "match": {"biz_purchase_order_line.description": "NL-CONTROL-UNIT", "biz_purchase_order_line.purchase_order_id": {"$ref": "po.c"}},
        "record": {
            "biz_purchase_order_line.purchase_order_id": {"$ref": "po.c"},
            "biz_purchase_order_line.product_id": {"$ref": "product.control"},
            "biz_purchase_order_line.description": "NL-CONTROL-UNIT",
            "biz_purchase_order_line.purchasing_entity_snapshot": "EcoTech FZCO",
            "biz_purchase_order_line.currency_snapshot": "USD",
            "biz_purchase_order_line.uom": "EA",
            "biz_purchase_order_line.quantity": 8,
            "biz_purchase_order_line.unit_cost": 96,
            "biz_purchase_order_line.source_order_line_ref": {"$ref": "order_line.c.2"}
        }
    },
    {
        "alias": "invoice.a.deposit",
        "entity_id": "entity.biz_invoice",
        "match": {"biz_invoice.customer_reference": "GG-POC-2026-01", "biz_invoice.invoice_type": "deposit"},
        "record": {
            "biz_invoice.status": "issued",
            "biz_invoice.invoice_type": "deposit",
            "biz_invoice.customer_id": {"$ref": "contact.greengrow"},
            "biz_invoice.source_order_id": {"$ref": "order.a"},
            "biz_invoice.sales_entity": "NLight BV",
            "biz_invoice.invoice_date": "2026-03-26",
            "biz_invoice.due_date": "2026-04-05",
            "biz_invoice.currency": "EUR",
            "biz_invoice.customer_reference": "GG-POC-2026-01",
            "biz_invoice.notes": "Deposit invoice for scenario A.",
            "biz_invoice.source_order_total_snapshot": 66730,
            "biz_invoice.deposit_percent_snapshot": 30,
            "biz_invoice.amount_paid": 0
        }
    },
    {
        "alias": "invoice.c.final",
        "entity_id": "entity.biz_invoice",
        "match": {"biz_invoice.customer_reference": "VOLGA-GROW-09", "biz_invoice.invoice_type": "final"},
        "record": {
            "biz_invoice.status": "issued",
            "biz_invoice.invoice_type": "final",
            "biz_invoice.customer_id": {"$ref": "contact.volga"},
            "biz_invoice.source_order_id": {"$ref": "order.c"},
            "biz_invoice.sales_entity": "NLight BV",
            "biz_invoice.invoice_date": "2026-03-28",
            "biz_invoice.due_date": "2026-04-12",
            "biz_invoice.currency": "EUR",
            "biz_invoice.customer_reference": "VOLGA-GROW-09",
            "biz_invoice.notes": "Final invoice for scenario C, partly paid.",
            "biz_invoice.source_order_total_snapshot": 42520,
            "biz_invoice.deposit_percent_snapshot": 30,
            "biz_invoice.amount_paid": 16000
        }
    }
]


def record_number(aliases: dict[str, CreatedRecord], alias: str, field_id: str, fallback: str) -> str:
    record = aliases.get(alias)
    if not record:
        return fallback
    value = record.record.get(field_id)
    return value if isinstance(value, str) and value else fallback


def document_specs(aliases: dict[str, CreatedRecord]) -> list[dict[str, Any]]:
    quote_a = record_number(aliases, "quote.a", "biz_quote.quote_number", "Quote A")
    order_a = record_number(aliases, "order.a", "biz_order.order_number", "Order A")
    po_a = record_number(aliases, "po.a", "biz_purchase_order.po_number", "PO A")
    invoice_deposit = record_number(aliases, "invoice.a.deposit", "biz_invoice.invoice_number", "Deposit Invoice")
    order_c = record_number(aliases, "order.c", "biz_order.order_number", "Order C")
    return [
        {
            "alias": "document.quote.a",
            "entity_id": "entity.biz_document",
            "match": {"biz_document.name": f"Quote {quote_a} - GreenGrow BV"},
            "record": {
                "biz_document.name": f"Quote {quote_a} - GreenGrow BV",
                "biz_document.document_type": "quote_pdf",
                "biz_document.status": "sent",
                "biz_document.related_contact_id": {"$ref": "contact.greengrow"},
                "biz_document.related_quote_id": {"$ref": "quote.a"},
                "biz_document.sales_entity": "NLight BV",
                "biz_document.document_date": "2026-03-20",
                "biz_document.external_system": "email",
                "biz_document.external_reference": f"customer-email:{quote_a}",
                "biz_document.notes": "Customer-facing quote pack sent before acceptance.",
            },
        },
        {
            "alias": "document.order.a",
            "entity_id": "entity.biz_document",
            "match": {"biz_document.name": f"Order {order_a} - Confirmation Pack"},
            "record": {
                "biz_document.name": f"Order {order_a} - Confirmation Pack",
                "biz_document.document_type": "order_confirmation",
                "biz_document.status": "approved",
                "biz_document.related_contact_id": {"$ref": "contact.greengrow"},
                "biz_document.related_order_id": {"$ref": "order.a"},
                "biz_document.sales_entity": "NLight BV",
                "biz_document.document_date": "2026-03-22",
                "biz_document.external_system": "none",
                "biz_document.notes": "Internal and customer order confirmation pack.",
            },
        },
        {
            "alias": "document.po.a",
            "entity_id": "entity.biz_document",
            "match": {"biz_document.name": f"{po_a} - Supplier Pack"},
            "record": {
                "biz_document.name": f"{po_a} - Supplier Pack",
                "biz_document.document_type": "purchase_order_pdf",
                "biz_document.status": "sent",
                "biz_document.related_contact_id": {"$ref": "contact.shenzhen"},
                "biz_document.related_order_id": {"$ref": "order.a"},
                "biz_document.related_purchase_order_id": {"$ref": "po.a"},
                "biz_document.sales_entity": "EcoTech FZCO",
                "biz_document.document_date": "2026-03-24",
                "biz_document.external_system": "email",
                "biz_document.external_reference": f"supplier-email:{po_a}",
                "biz_document.notes": "Supplier purchase order and specification pack.",
            },
        },
        {
            "alias": "document.invoice.deposit",
            "entity_id": "entity.biz_document",
            "match": {"biz_document.name": f"{invoice_deposit} - Deposit Invoice"},
            "record": {
                "biz_document.name": f"{invoice_deposit} - Deposit Invoice",
                "biz_document.document_type": "invoice_pdf",
                "biz_document.status": "sent",
                "biz_document.related_contact_id": {"$ref": "contact.greengrow"},
                "biz_document.related_order_id": {"$ref": "order.a"},
                "biz_document.related_invoice_id": {"$ref": "invoice.a.deposit"},
                "biz_document.sales_entity": "NLight BV",
                "biz_document.document_date": "2026-03-26",
                "biz_document.external_system": "xero",
                "biz_document.external_reference": f"xero:{invoice_deposit}",
                "biz_document.notes": "Deposit invoice synced for payment tracking.",
            },
        },
        {
            "alias": "document.shipping.c",
            "entity_id": "entity.biz_document",
            "match": {"biz_document.name": f"{order_c} - Shipping Documents"},
            "record": {
                "biz_document.name": f"{order_c} - Shipping Documents",
                "biz_document.document_type": "shipping_document",
                "biz_document.status": "signed",
                "biz_document.related_contact_id": {"$ref": "contact.volga"},
                "biz_document.related_order_id": {"$ref": "order.c"},
                "biz_document.related_purchase_order_id": {"$ref": "po.c"},
                "biz_document.sales_entity": "EcoTech FZCO",
                "biz_document.document_date": "2026-04-02",
                "biz_document.external_system": "none",
                "biz_document.notes": "Signed shipping documents for the Kazakhstan order.",
            },
        },
    ]


def crm_specs(aliases: dict[str, CreatedRecord]) -> list[dict[str, Any]]:
    quote_a = record_number(aliases, "quote.a", "biz_quote.quote_number", "Quote A")
    quote_b = record_number(aliases, "quote.b", "biz_quote.quote_number", "Quote B")
    quote_c = record_number(aliases, "quote.c", "biz_quote.quote_number", "Quote C")
    order_a = record_number(aliases, "order.a", "biz_order.order_number", "Order A")
    return [
        {
            "alias": "site.greengrow.aalsmeer",
            "entity_id": "entity.crm_site",
            "match": {"crm_site.name": "GreenGrow Aalsmeer Expansion"},
            "record": {
                "crm_site.name": "GreenGrow Aalsmeer Expansion",
                "crm_site.company_id": {"$ref": "contact.greengrow"},
                "crm_site.address_line_1": "Aalsmeer Trade Park 4",
                "crm_site.address_line_2": "Zone B - glasshouse expansion",
                "crm_site.city": "Aalsmeer",
                "crm_site.region": "North Holland",
                "crm_site.postcode": "1431",
                "crm_site.country": "Netherlands",
                "crm_site.site_notes": "Expansion area for the accepted NLight 720W install handoff.",
                "crm_site.is_active": True,
            },
        },
        {
            "alias": "site.desert_bloom.dubai",
            "entity_id": "entity.crm_site",
            "match": {"crm_site.name": "Desert Bloom Dubai Trial House"},
            "record": {
                "crm_site.name": "Desert Bloom Dubai Trial House",
                "crm_site.company_id": {"$ref": "contact.desert_bloom"},
                "crm_site.address_line_1": "Jebel Ali South",
                "crm_site.address_line_2": "Trial greenhouse block 2",
                "crm_site.city": "Dubai",
                "crm_site.region": "Dubai",
                "crm_site.country": "United Arab Emirates",
                "crm_site.site_notes": "Customer is comparing 600W fixture packages before deposit approval.",
                "crm_site.is_active": True,
            },
        },
        {
            "alias": "site.volga.karaganda",
            "entity_id": "entity.crm_site",
            "match": {"crm_site.name": "Volga Karaganda Grow Facility"},
            "record": {
                "crm_site.name": "Volga Karaganda Grow Facility",
                "crm_site.company_id": {"$ref": "contact.volga"},
                "crm_site.address_line_1": "Karaganda Logistics Hub",
                "crm_site.city": "Karaganda",
                "crm_site.country": "Kazakhstan",
                "crm_site.site_notes": "Existing project site with one active order and a separate expansion opportunity.",
                "crm_site.is_active": True,
            },
        },
        {
            "alias": "lead.trade_show.aurora",
            "entity_id": "entity.crm_lead",
            "match": {"crm_lead.title": "Aurora Herbs - Benelux trade show enquiry"},
            "record": {
                "crm_lead.title": "Aurora Herbs - Benelux trade show enquiry",
                "crm_lead.status": "new",
                "crm_lead.source": "trade_show",
                "crm_lead.contact_name": "Sanne Vermeer",
                "crm_lead.contact_email": "sanne@auroraherbs.example",
                "crm_lead.contact_phone": "+31 6 5550 4488",
                "crm_lead.owner_user_id": "Sales Team",
                "crm_lead.currency": "EUR",
                "crm_lead.estimated_value": 38500,
                "crm_lead.next_action": "Confirm crop area and target light levels.",
                "crm_lead.next_activity_date": "2026-04-10",
                "crm_lead.notes": "Met at greenhouse technology stand; interested in a small starter package.",
            },
        },
        {
            "alias": "lead.website.desert_extension",
            "entity_id": "entity.crm_lead",
            "match": {"crm_lead.title": "Desert Bloom - second bay expansion enquiry"},
            "record": {
                "crm_lead.title": "Desert Bloom - second bay expansion enquiry",
                "crm_lead.status": "contacted",
                "crm_lead.source": "website",
                "crm_lead.company_id": {"$ref": "contact.desert_bloom"},
                "crm_lead.contact_name": "Omar Al Hadi",
                "crm_lead.contact_email": "omar@desertbloom.example",
                "crm_lead.contact_phone": "+971 50 555 0121",
                "crm_lead.owner_user_id": "Sales Team",
                "crm_lead.currency": "USD",
                "crm_lead.estimated_value": 87500,
                "crm_lead.next_action": "Confirm whether quote DBT-RFQ-44 covers bay two.",
                "crm_lead.next_activity_date": "2026-04-09",
                "crm_lead.notes": "Inbound website form after commercial team sent the first bay quote.",
            },
        },
        {
            "alias": "lead.parts_only.disqualified",
            "entity_id": "entity.crm_lead",
            "match": {"crm_lead.title": "Spare driver parts-only request"},
            "record": {
                "crm_lead.title": "Spare driver parts-only request",
                "crm_lead.status": "disqualified",
                "crm_lead.source": "referral",
                "crm_lead.contact_name": "Milan Petrov",
                "crm_lead.contact_email": "milan@example-grower.example",
                "crm_lead.owner_user_id": "Sales Team",
                "crm_lead.currency": "EUR",
                "crm_lead.estimated_value": 950,
                "crm_lead.next_action": "No sales follow-up required.",
                "crm_lead.next_activity_date": "2026-04-06",
                "crm_lead.disqualification_reason": "Parts-only enquiry below commercial threshold; referred to reseller.",
                "crm_lead.notes": "Kept for audit trail and source reporting.",
            },
        },
        {
            "alias": "opportunity.greengrow.won",
            "entity_id": "entity.crm_opportunity",
            "match": {"crm_opportunity.title": "GreenGrow Aalsmeer LED Expansion"},
            "record": {
                "crm_opportunity.title": "GreenGrow Aalsmeer LED Expansion",
                "crm_opportunity.company_id": {"$ref": "contact.greengrow"},
                "crm_opportunity.primary_contact_name": "Eva van Dijk",
                "crm_opportunity.primary_contact_email": "eva@greengrow.example",
                "crm_opportunity.site_id": {"$ref": "site.greengrow.aalsmeer"},
                "crm_opportunity.owner_user_id": "Sales Team",
                "crm_opportunity.pipeline": "nlight_sales",
                "crm_opportunity.stage": "won",
                "crm_opportunity.status": "won",
                "crm_opportunity.currency": "EUR",
                "crm_opportunity.value": 66730,
                "crm_opportunity.probability": 100,
                "crm_opportunity.expected_close_date": "2026-03-22",
                "crm_opportunity.next_activity_date": "2026-04-11",
                "crm_opportunity.source": "referral",
                "crm_opportunity.quote_state": "accepted",
                "crm_opportunity.linked_quote_id": {"$ref": "quote.a"},
                "crm_opportunity.linked_order_id": {"$ref": "order.a"},
                "crm_opportunity.won_lost_reason": f"Accepted {quote_a}; operations handoff created as {order_a}.",
                "crm_opportunity.description": "Customer accepted the 720W expansion package for the Aalsmeer site.",
                "crm_opportunity.notes": "Demo story: Pipedrive replacement can show the won deal, quote, order, PO, invoice, and documents together.",
            },
        },
        {
            "alias": "opportunity.desert_bloom.quoted",
            "entity_id": "entity.crm_opportunity",
            "match": {"crm_opportunity.title": "Desert Bloom Dubai Trial House"},
            "record": {
                "crm_opportunity.title": "Desert Bloom Dubai Trial House",
                "crm_opportunity.company_id": {"$ref": "contact.desert_bloom"},
                "crm_opportunity.primary_contact_name": "Omar Al Hadi",
                "crm_opportunity.primary_contact_email": "omar@desertbloom.example",
                "crm_opportunity.site_id": {"$ref": "site.desert_bloom.dubai"},
                "crm_opportunity.owner_user_id": "Sales Team",
                "crm_opportunity.pipeline": "nlight_sales",
                "crm_opportunity.stage": "quote",
                "crm_opportunity.status": "open",
                "crm_opportunity.currency": "USD",
                "crm_opportunity.value": 87600,
                "crm_opportunity.probability": 60,
                "crm_opportunity.expected_close_date": "2026-04-24",
                "crm_opportunity.next_activity_date": "2026-04-09",
                "crm_opportunity.source": "website",
                "crm_opportunity.quote_state": "quoted",
                "crm_opportunity.linked_quote_id": {"$ref": "quote.b"},
                "crm_opportunity.description": f"Customer reviewing {quote_b} for a Dubai trial house.",
                "crm_opportunity.notes": "Needs deposit decision before procurement can start.",
            },
        },
        {
            "alias": "opportunity.volga.lost",
            "entity_id": "entity.crm_opportunity",
            "match": {"crm_opportunity.title": "Volga Karaganda Phase Two"},
            "record": {
                "crm_opportunity.title": "Volga Karaganda Phase Two",
                "crm_opportunity.company_id": {"$ref": "contact.volga"},
                "crm_opportunity.primary_contact_name": "Irina Sokolova",
                "crm_opportunity.primary_contact_email": "irina@volga.example",
                "crm_opportunity.site_id": {"$ref": "site.volga.karaganda"},
                "crm_opportunity.owner_user_id": "Sales Team",
                "crm_opportunity.pipeline": "nlight_sales",
                "crm_opportunity.stage": "lost",
                "crm_opportunity.status": "lost",
                "crm_opportunity.currency": "EUR",
                "crm_opportunity.value": 42520,
                "crm_opportunity.probability": 0,
                "crm_opportunity.expected_close_date": "2026-03-31",
                "crm_opportunity.next_activity_date": "2026-04-14",
                "crm_opportunity.source": "existing_customer",
                "crm_opportunity.quote_state": "accepted",
                "crm_opportunity.linked_quote_id": {"$ref": "quote.c"},
                "crm_opportunity.won_lost_reason": f"Phase two paused after {quote_c}; customer kept existing order only.",
                "crm_opportunity.description": "Follow-on expansion enquiry separate from the active Volga order.",
                "crm_opportunity.notes": "Useful demo example for lost-reason reporting without losing customer/order context.",
            },
        },
        {
            "alias": "opportunity.greengrow.service",
            "entity_id": "entity.crm_opportunity",
            "match": {"crm_opportunity.title": "GreenGrow Control Unit Upgrade"},
            "record": {
                "crm_opportunity.title": "GreenGrow Control Unit Upgrade",
                "crm_opportunity.company_id": {"$ref": "contact.greengrow"},
                "crm_opportunity.primary_contact_name": "Eva van Dijk",
                "crm_opportunity.primary_contact_email": "eva@greengrow.example",
                "crm_opportunity.site_id": {"$ref": "site.greengrow.aalsmeer"},
                "crm_opportunity.owner_user_id": "Sales Team",
                "crm_opportunity.pipeline": "after_sales",
                "crm_opportunity.stage": "solution",
                "crm_opportunity.status": "open",
                "crm_opportunity.currency": "EUR",
                "crm_opportunity.value": 18450,
                "crm_opportunity.probability": 40,
                "crm_opportunity.expected_close_date": "2026-05-08",
                "crm_opportunity.next_activity_date": "2026-04-16",
                "crm_opportunity.source": "existing_customer",
                "crm_opportunity.quote_state": "quote_needed",
                "crm_opportunity.description": "Potential add-on control unit package after the main lighting expansion.",
                "crm_opportunity.notes": "Shows second pipeline/use case without duplicating the customer or site.",
            },
        },
        {
            "alias": "activity.desert_bloom.followup",
            "entity_id": "entity.crm_activity",
            "match": {"crm_activity.title": "Follow up on Desert Bloom quote approval"},
            "record": {
                "crm_activity.title": "Follow up on Desert Bloom quote approval",
                "crm_activity.activity_type": "quote_follow_up",
                "crm_activity.status": "planned",
                "crm_activity.due_date": "2026-04-09",
                "crm_activity.owner_user_id": "Sales Team",
                "crm_activity.company_id": {"$ref": "contact.desert_bloom"},
                "crm_activity.opportunity_id": {"$ref": "opportunity.desert_bloom.quoted"},
                "crm_activity.site_id": {"$ref": "site.desert_bloom.dubai"},
                "crm_activity.notes": "Ask whether deposit approval is on this week's finance agenda.",
            },
        },
        {
            "alias": "activity.greengrow.site_handoff",
            "entity_id": "entity.crm_activity",
            "match": {"crm_activity.title": "Operations handoff for GreenGrow Aalsmeer"},
            "record": {
                "crm_activity.title": "Operations handoff for GreenGrow Aalsmeer",
                "crm_activity.activity_type": "site_visit",
                "crm_activity.status": "planned",
                "crm_activity.due_date": "2026-04-11",
                "crm_activity.owner_user_id": "Operations Team",
                "crm_activity.company_id": {"$ref": "contact.greengrow"},
                "crm_activity.opportunity_id": {"$ref": "opportunity.greengrow.won"},
                "crm_activity.site_id": {"$ref": "site.greengrow.aalsmeer"},
                "crm_activity.notes": "Review delivery constraints and install access before the supplier shipment lands.",
            },
        },
        {
            "alias": "activity.volga.loss_review",
            "entity_id": "entity.crm_activity",
            "match": {"crm_activity.title": "Log Volga phase-two loss reason"},
            "record": {
                "crm_activity.title": "Log Volga phase-two loss reason",
                "crm_activity.activity_type": "call",
                "crm_activity.status": "done",
                "crm_activity.due_date": "2026-04-04",
                "crm_activity.owner_user_id": "Sales Team",
                "crm_activity.company_id": {"$ref": "contact.volga"},
                "crm_activity.opportunity_id": {"$ref": "opportunity.volga.lost"},
                "crm_activity.site_id": {"$ref": "site.volga.karaganda"},
                "crm_activity.notes": "Customer confirmed phase two is deferred, not awarded to competitor.",
            },
        },
        {
            "alias": "activity.aurora.qualify",
            "entity_id": "entity.crm_activity",
            "match": {"crm_activity.title": "Qualify Aurora Herbs enquiry"},
            "record": {
                "crm_activity.title": "Qualify Aurora Herbs enquiry",
                "crm_activity.activity_type": "call",
                "crm_activity.status": "planned",
                "crm_activity.due_date": "2026-04-10",
                "crm_activity.owner_user_id": "Sales Team",
                "crm_activity.lead_id": {"$ref": "lead.trade_show.aurora"},
                "crm_activity.notes": "Confirm whether this should become a formal opportunity or stay as a reseller lead.",
            },
        },
        {
            "alias": "activity.desert_bloom.overdue",
            "entity_id": "entity.crm_activity",
            "match": {"crm_activity.title": "Send Desert Bloom spec comparison"},
            "record": {
                "crm_activity.title": "Send Desert Bloom spec comparison",
                "crm_activity.activity_type": "email_follow_up",
                "crm_activity.status": "planned",
                "crm_activity.due_date": "2026-04-05",
                "crm_activity.owner_user_id": "Sales Team",
                "crm_activity.company_id": {"$ref": "contact.desert_bloom"},
                "crm_activity.opportunity_id": {"$ref": "opportunity.desert_bloom.quoted"},
                "crm_activity.site_id": {"$ref": "site.desert_bloom.dubai"},
                "crm_activity.notes": "Intentionally overdue demo task for dashboard visibility.",
            },
        },
    ]


def patch_quote_links(
    base_url: str,
    aliases: dict[str, CreatedRecord],
    *,
    token: str | None,
    workspace_id: str | None,
    dry_run: bool,
) -> None:
    links = [
        ("quote.a", "order.a"),
        ("quote.c", "order.c"),
    ]
    for quote_alias, order_alias in links:
        quote = aliases.get(quote_alias)
        order = aliases.get(order_alias)
        if not quote or not order:
            continue
        order_number = record_number(aliases, order_alias, "biz_order.order_number", order_alias)
        quote_number = record_number(aliases, quote_alias, "biz_quote.quote_number", quote_alias)
        if dry_run:
            print(f"[seed] plan link {quote_alias} -> {order_number}")
            continue
        quote_payload = dict(quote.record)
        quote_payload["biz_quote.status"] = "accepted"
        quote_payload["biz_quote.linked_customer_order_id"] = order.record_id
        quote_payload["biz_quote.linked_customer_order_number"] = order_number
        updated_quote = update_record(
            base_url,
            "entity.biz_quote",
            quote.record_id,
            quote_payload,
            token=token,
            workspace_id=workspace_id,
        )
        aliases[quote_alias] = updated_quote
        order_payload = dict(order.record)
        order_payload["biz_order.source_quote_number"] = quote_number
        updated_order = update_record(
            base_url,
            "entity.biz_order",
            order.record_id,
            order_payload,
            token=token,
            workspace_id=workspace_id,
        )
        aliases[order_alias] = updated_order
        print(f"[seed] linked   {quote_alias} -> {order_number}")


def patch_order_links(
    base_url: str,
    aliases: dict[str, CreatedRecord],
    *,
    token: str | None,
    workspace_id: str | None,
    dry_run: bool,
) -> None:
    links = [
        ("order.a", {"biz_order.primary_purchase_order_id": "po.a", "biz_order.deposit_invoice_id": "invoice.a.deposit"}),
        ("order.c", {"biz_order.primary_purchase_order_id": "po.c", "biz_order.final_invoice_id": "invoice.c.final", "biz_order.status": "shipped"}),
    ]
    for order_alias, field_aliases in links:
        order = aliases.get(order_alias)
        if not order:
            continue
        payload = dict(order.record)
        changed = False
        for field_id, related_alias in field_aliases.items():
            if field_id == "biz_order.status":
                payload[field_id] = related_alias
                changed = True
                continue
            related = aliases.get(related_alias)
            if not related:
                continue
            payload[field_id] = related.record_id
            changed = True
        if not changed:
            continue
        order_number = record_number(aliases, order_alias, "biz_order.order_number", order_alias)
        if dry_run:
            print(f"[seed] plan link {order_alias} workflow ids")
            continue
        updated = update_record(
            base_url,
            "entity.biz_order",
            order.record_id,
            payload,
            token=token,
            workspace_id=workspace_id,
        )
        aliases[order_alias] = updated
        print(f"[seed] linked   {order_alias} workflow ids")
        for related_alias in ("po.a", "po.c"):
            po = aliases.get(related_alias)
            if not po or po.record.get("biz_purchase_order.source_customer_order_id") != order.record_id:
                continue
            po_payload = dict(po.record)
            po_payload["biz_purchase_order.source_customer_order_number"] = order_number
            aliases[related_alias] = update_record(
                base_url,
                "entity.biz_purchase_order",
                po.record_id,
                po_payload,
                token=token,
                workspace_id=workspace_id,
            )
        for related_alias in ("invoice.a.deposit", "invoice.c.final"):
            invoice = aliases.get(related_alias)
            if not invoice or invoice.record.get("biz_invoice.source_order_id") != order.record_id:
                continue
            invoice_payload = dict(invoice.record)
            invoice_payload["biz_invoice.source_order_number"] = order_number
            if related_alias == "invoice.c.final":
                invoice_payload["biz_invoice.status"] = "part_paid"
            aliases[related_alias] = update_record(
                base_url,
                "entity.biz_invoice",
                invoice.record_id,
                invoice_payload,
                token=token,
                workspace_id=workspace_id,
            )


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed commercial v2 demo data.")
    parser.add_argument("--base-url", default=None, help="API base URL, e.g. https://app.octodrop.com")
    parser.add_argument("--token", default=None, help="Bearer token")
    parser.add_argument("--workspace-id", default=None, help="Workspace ID")
    parser.add_argument("--dry-run", action="store_true", help="Print the seed plan without writing records")
    args = parser.parse_args()

    base_url = (args.base_url or os.environ.get("OCTO_BASE_URL", "")).strip().rstrip("/")
    token = (args.token or os.environ.get("OCTO_API_TOKEN", "")).strip() or None
    workspace_id = (args.workspace_id or os.environ.get("OCTO_WORKSPACE_ID", "")).strip() or None
    if not base_url:
        raise SystemExit("--base-url or OCTO_BASE_URL is required")
    aliases: dict[str, CreatedRecord] = {}

    for spec in CONTACTS:
        create_or_get(base_url, spec, aliases, token=token, workspace_id=workspace_id, dry_run=args.dry_run)
    for spec in product_specs():
        create_or_get(base_url, spec, aliases, token=token, workspace_id=workspace_id, dry_run=args.dry_run)
    for spec in SEED_SPECS:
        create_or_get(base_url, spec, aliases, token=token, workspace_id=workspace_id, dry_run=args.dry_run)

    patch_quote_links(base_url, aliases, token=token, workspace_id=workspace_id, dry_run=args.dry_run)
    patch_order_links(base_url, aliases, token=token, workspace_id=workspace_id, dry_run=args.dry_run)
    for spec in document_specs(aliases):
        create_or_get(base_url, spec, aliases, token=token, workspace_id=workspace_id, dry_run=args.dry_run)
    for spec in crm_specs(aliases):
        create_or_get(base_url, spec, aliases, token=token, workspace_id=workspace_id, dry_run=args.dry_run)
    print("[seed] complete")


if __name__ == "__main__":
    main()
