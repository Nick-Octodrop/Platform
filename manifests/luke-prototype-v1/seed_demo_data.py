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
        fields=list(match_fields.keys()),
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
        "entity_id": "entity.nl_contact",
        "match": {"nl_contact.name": "GreenGrow BV"},
        "record": {
            "nl_contact.name": "GreenGrow BV",
            "nl_contact.contact_type": "customer",
            "nl_contact.company_entity_scope": ["NLight BV"],
            "nl_contact.email": "procurement@greengrow.example",
            "nl_contact.phone": "+31 20 555 0101",
            "nl_contact.website": "https://greengrow.example",
            "nl_contact.country": "Netherlands",
            "nl_contact.currency_preference": "EUR",
            "nl_contact.billing_address": "Keizersgracht 100, Amsterdam, Netherlands",
            "nl_contact.shipping_address": "Aalsmeer Trade Park 4, Aalsmeer, Netherlands",
            "nl_contact.notes": "Lead customer for demo scenario A.",
            "nl_contact.is_active": True
        }
    },
    {
        "alias": "contact.desert_bloom",
        "entity_id": "entity.nl_contact",
        "match": {"nl_contact.name": "Desert Bloom Trading"},
        "record": {
            "nl_contact.name": "Desert Bloom Trading",
            "nl_contact.contact_type": "customer",
            "nl_contact.company_entity_scope": ["NLight BV"],
            "nl_contact.email": "sales@desertbloom.example",
            "nl_contact.phone": "+971 4 555 0110",
            "nl_contact.website": "https://desertbloom.example",
            "nl_contact.country": "United Arab Emirates",
            "nl_contact.currency_preference": "USD",
            "nl_contact.billing_address": "Dubai Investment Park, Dubai, UAE",
            "nl_contact.shipping_address": "Jebel Ali South, Dubai, UAE",
            "nl_contact.notes": "Quote scenario B.",
            "nl_contact.is_active": True
        }
    },
    {
        "alias": "contact.volga",
        "entity_id": "entity.nl_contact",
        "match": {"nl_contact.name": "Volga Horticulture Group"},
        "record": {
            "nl_contact.name": "Volga Horticulture Group",
            "nl_contact.contact_type": "customer",
            "nl_contact.company_entity_scope": ["NLight BV"],
            "nl_contact.email": "projects@volga.example",
            "nl_contact.phone": "+7 495 555 0199",
            "nl_contact.website": "https://volga.example",
            "nl_contact.country": "Kazakhstan",
            "nl_contact.currency_preference": "EUR",
            "nl_contact.billing_address": "Astana Business Centre, Astana, Kazakhstan",
            "nl_contact.shipping_address": "Karaganda Logistics Hub, Karaganda, Kazakhstan",
            "nl_contact.notes": "Order and invoice scenario C.",
            "nl_contact.is_active": True
        }
    },
    {
        "alias": "contact.shenzhen",
        "entity_id": "entity.nl_contact",
        "match": {"nl_contact.name": "Shenzhen Lumatek Manufacturing"},
        "record": {
            "nl_contact.name": "Shenzhen Lumatek Manufacturing",
            "nl_contact.contact_type": "supplier",
            "nl_contact.company_entity_scope": ["EcoTech FZCO"],
            "nl_contact.email": "export@lumatek.example",
            "nl_contact.phone": "+86 755 5550 1880",
            "nl_contact.website": "https://lumatek.example",
            "nl_contact.country": "China",
            "nl_contact.currency_preference": "USD",
            "nl_contact.billing_address": "Bao'an District, Shenzhen, China",
            "nl_contact.shipping_address": "Yantian Port, Shenzhen, China",
            "nl_contact.notes": "Main supplier for scenario A.",
            "nl_contact.is_active": True
        }
    },
    {
        "alias": "contact.guangzhou",
        "entity_id": "entity.nl_contact",
        "match": {"nl_contact.name": "Guangzhou LED Systems Co"},
        "record": {
            "nl_contact.name": "Guangzhou LED Systems Co",
            "nl_contact.contact_type": "factory_partner",
            "nl_contact.company_entity_scope": ["EcoTech FZCO"],
            "nl_contact.email": "factory@guangzhouled.example",
            "nl_contact.phone": "+86 20 5550 6600",
            "nl_contact.website": "https://guangzhouled.example",
            "nl_contact.country": "China",
            "nl_contact.currency_preference": "USD",
            "nl_contact.billing_address": "Panyu District, Guangzhou, China",
            "nl_contact.shipping_address": "Nansha Port, Guangzhou, China",
            "nl_contact.notes": "Factory partner for scenario C.",
            "nl_contact.is_active": True
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
                "entity_id": "entity.nl_product",
                "match": {"nl_product.code": code},
                "record": {
                    "nl_product.code": code,
                    "nl_product.name": name,
                    "nl_product.description": f"{name} for greenhouse lighting projects.",
                    "nl_product.category": "Lighting",
                    "nl_product.uom": uom,
                    "nl_product.default_sales_currency": "EUR",
                    "nl_product.default_sales_price": sell,
                    "nl_product.default_purchase_currency": "USD",
                    "nl_product.default_buy_price": buy,
                    "nl_product.preferred_supplier_id": {"$ref": supplier_ref},
                    "nl_product.supplier_factory_reference": f"{code}-FACTORY",
                    "nl_product.internal_notes": "Prototype catalogue item.",
                    "nl_product.is_active": True
                }
            }
        )
    return out


SEED_SPECS = [
    {
        "alias": "quote.a",
        "entity_id": "entity.nl_quote",
        "match": {"nl_quote.quote_number": "NQ-1001"},
        "record": {
            "nl_quote.quote_number": "NQ-1001",
            "nl_quote.status": "accepted",
            "nl_quote.quote_date": "2026-03-20",
            "nl_quote.expiry_date": "2026-04-10",
            "nl_quote.sales_entity": "NLight BV",
            "nl_quote.customer_id": {"$ref": "contact.greengrow"},
            "nl_quote.customer_contact_name": "Eva van Dijk",
            "nl_quote.customer_reference": "GG-POC-2026-01",
            "nl_quote.customer_order_number": "CO-1001",
            "nl_quote.currency": "EUR",
            "nl_quote.sales_owner": "Luke",
            "nl_quote.payment_terms": "30% deposit, balance before shipment",
            "nl_quote.incoterm": "FCA",
            "nl_quote.shipping_terms": "Sea freight coordinated by N-Light",
            "nl_quote.validity_notes": "Valid for 14 days.",
            "nl_quote.internal_notes": "Accepted and converted for prototype scenario A.",
            "nl_quote.customer_notes": "Supply for Amsterdam greenhouse expansion."
        }
    },
    {
        "alias": "quote.b",
        "entity_id": "entity.nl_quote",
        "match": {"nl_quote.quote_number": "NQ-1002"},
        "record": {
            "nl_quote.quote_number": "NQ-1002",
            "nl_quote.status": "sent",
            "nl_quote.quote_date": "2026-03-25",
            "nl_quote.expiry_date": "2026-04-15",
            "nl_quote.sales_entity": "NLight BV",
            "nl_quote.customer_id": {"$ref": "contact.desert_bloom"},
            "nl_quote.customer_contact_name": "Omar Al Hadi",
            "nl_quote.customer_reference": "DBT-RFQ-44",
            "nl_quote.customer_order_number": "CO-1002",
            "nl_quote.currency": "USD",
            "nl_quote.sales_owner": "Luke",
            "nl_quote.payment_terms": "50% deposit, 50% before dispatch",
            "nl_quote.incoterm": "EXW",
            "nl_quote.shipping_terms": "Customer freight forwarder",
            "nl_quote.validity_notes": "Pricing subject to component availability.",
            "nl_quote.customer_notes": "Awaiting internal approval."
        }
    },
    {
        "alias": "quote.c",
        "entity_id": "entity.nl_quote",
        "match": {"nl_quote.quote_number": "NQ-1003"},
        "record": {
            "nl_quote.quote_number": "NQ-1003",
            "nl_quote.status": "accepted",
            "nl_quote.quote_date": "2026-03-10",
            "nl_quote.expiry_date": "2026-03-31",
            "nl_quote.sales_entity": "NLight BV",
            "nl_quote.customer_id": {"$ref": "contact.volga"},
            "nl_quote.customer_contact_name": "Irina Sokolova",
            "nl_quote.customer_reference": "VOLGA-GROW-09",
            "nl_quote.customer_order_number": "CO-1003",
            "nl_quote.currency": "EUR",
            "nl_quote.sales_owner": "Luke",
            "nl_quote.payment_terms": "30% deposit, 70% final invoice",
            "nl_quote.incoterm": "DAP",
            "nl_quote.shipping_terms": "Project delivery to Karaganda hub",
            "nl_quote.validity_notes": "Includes project coordination.",
            "nl_quote.customer_notes": "Priority customer order."
        }
    },
    {
        "alias": "quote_line.a.1",
        "entity_id": "entity.nl_quote_line",
        "match": {"nl_quote_line.description": "NL-LED-720W", "nl_quote_line.quote_id": {"$ref": "quote.a"}},
        "record": {
            "nl_quote_line.quote_id": {"$ref": "quote.a"},
            "nl_quote_line.line_type": "catalogue",
            "nl_quote_line.product_id": {"$ref": "product.led720"},
            "nl_quote_line.description": "NL-LED-720W",
            "nl_quote_line.uom": "EA",
            "nl_quote_line.quantity": 120,
            "nl_quote_line.unit_price": 520,
            "nl_quote_line.line_discount_percent": 0,
            "nl_quote_line.default_buy_price_snapshot": 335,
            "nl_quote_line.buy_currency_snapshot": "USD"
        }
    },
    {
        "alias": "quote_line.a.2",
        "entity_id": "entity.nl_quote_line",
        "match": {"nl_quote_line.description": "NL-HANGER-KIT", "nl_quote_line.quote_id": {"$ref": "quote.a"}},
        "record": {
            "nl_quote_line.quote_id": {"$ref": "quote.a"},
            "nl_quote_line.line_type": "catalogue",
            "nl_quote_line.product_id": {"$ref": "product.hanger"},
            "nl_quote_line.description": "NL-HANGER-KIT",
            "nl_quote_line.uom": "KIT",
            "nl_quote_line.quantity": 120,
            "nl_quote_line.unit_price": 24,
            "nl_quote_line.line_discount_percent": 0,
            "nl_quote_line.default_buy_price_snapshot": 8,
            "nl_quote_line.buy_currency_snapshot": "USD"
        }
    },
    {
        "alias": "quote_line.a.3",
        "entity_id": "entity.nl_quote_line",
        "match": {"nl_quote_line.description": "Custom freight coordination", "nl_quote_line.quote_id": {"$ref": "quote.a"}},
        "record": {
            "nl_quote_line.quote_id": {"$ref": "quote.a"},
            "nl_quote_line.line_type": "custom",
            "nl_quote_line.description": "Custom freight coordination",
            "nl_quote_line.uom": "LOT",
            "nl_quote_line.quantity": 1,
            "nl_quote_line.unit_price": 1450,
            "nl_quote_line.line_discount_percent": 0,
            "nl_quote_line.default_buy_price_snapshot": 700,
            "nl_quote_line.buy_currency_snapshot": "EUR"
        }
    },
    {
        "alias": "quote_line.b.1",
        "entity_id": "entity.nl_quote_line",
        "match": {"nl_quote_line.description": "NL-LED-600W", "nl_quote_line.quote_id": {"$ref": "quote.b"}},
        "record": {
            "nl_quote_line.quote_id": {"$ref": "quote.b"},
            "nl_quote_line.line_type": "catalogue",
            "nl_quote_line.product_id": {"$ref": "product.led600"},
            "nl_quote_line.description": "NL-LED-600W",
            "nl_quote_line.uom": "EA",
            "nl_quote_line.quantity": 200,
            "nl_quote_line.unit_price": 420,
            "nl_quote_line.default_buy_price_snapshot": 275,
            "nl_quote_line.buy_currency_snapshot": "USD"
        }
    },
    {
        "alias": "quote_line.b.2",
        "entity_id": "entity.nl_quote_line",
        "match": {"nl_quote_line.description": "NL-CABLING-SET", "nl_quote_line.quote_id": {"$ref": "quote.b"}},
        "record": {
            "nl_quote_line.quote_id": {"$ref": "quote.b"},
            "nl_quote_line.line_type": "catalogue",
            "nl_quote_line.product_id": {"$ref": "product.cabling"},
            "nl_quote_line.description": "NL-CABLING-SET",
            "nl_quote_line.uom": "SET",
            "nl_quote_line.quantity": 200,
            "nl_quote_line.unit_price": 18,
            "nl_quote_line.default_buy_price_snapshot": 6,
            "nl_quote_line.buy_currency_snapshot": "USD"
        }
    },
    {
        "alias": "quote_line.c.1",
        "entity_id": "entity.nl_quote_line",
        "match": {"nl_quote_line.description": "NL-LED-720W", "nl_quote_line.quote_id": {"$ref": "quote.c"}},
        "record": {
            "nl_quote_line.quote_id": {"$ref": "quote.c"},
            "nl_quote_line.line_type": "catalogue",
            "nl_quote_line.product_id": {"$ref": "product.led720"},
            "nl_quote_line.description": "NL-LED-720W",
            "nl_quote_line.uom": "EA",
            "nl_quote_line.quantity": 80,
            "nl_quote_line.unit_price": 515,
            "nl_quote_line.default_buy_price_snapshot": 335,
            "nl_quote_line.buy_currency_snapshot": "USD"
        }
    },
    {
        "alias": "quote_line.c.2",
        "entity_id": "entity.nl_quote_line",
        "match": {"nl_quote_line.description": "NL-CONTROL-UNIT", "nl_quote_line.quote_id": {"$ref": "quote.c"}},
        "record": {
            "nl_quote_line.quote_id": {"$ref": "quote.c"},
            "nl_quote_line.line_type": "catalogue",
            "nl_quote_line.product_id": {"$ref": "product.control"},
            "nl_quote_line.description": "NL-CONTROL-UNIT",
            "nl_quote_line.uom": "EA",
            "nl_quote_line.quantity": 8,
            "nl_quote_line.unit_price": 165,
            "nl_quote_line.default_buy_price_snapshot": 96,
            "nl_quote_line.buy_currency_snapshot": "USD"
        }
    },
    {
        "alias": "order.a",
        "entity_id": "entity.nl_customer_order",
        "match": {"nl_customer_order.order_number": "CO-1001"},
        "record": {
            "nl_customer_order.order_number": "CO-1001",
            "nl_customer_order.status": "confirmed",
            "nl_customer_order.customer_id": {"$ref": "contact.greengrow"},
            "nl_customer_order.source_quote_id": {"$ref": "quote.a"},
            "nl_customer_order.source_quote_number": "NQ-1001",
            "nl_customer_order.sales_entity": "NLight BV",
            "nl_customer_order.order_date": "2026-03-22",
            "nl_customer_order.currency": "EUR",
            "nl_customer_order.customer_reference": "GG-POC-2026-01",
            "nl_customer_order.delivery_terms": "DAP Amsterdam",
            "nl_customer_order.shipping_destination": "Aalsmeer Trade Park 4, Aalsmeer",
            "nl_customer_order.requested_delivery_date": "2026-05-20",
            "nl_customer_order.notes": "Accepted order for scenario A.",
            "nl_customer_order.purchase_order_number": "PO-1001",
            "nl_customer_order.preferred_supplier_id": {"$ref": "contact.shenzhen"},
            "nl_customer_order.deposit_percent": 30,
            "nl_customer_order.deposit_invoice_number": "INV-1001-D"
        }
    },
    {
        "alias": "order.c",
        "entity_id": "entity.nl_customer_order",
        "match": {"nl_customer_order.order_number": "CO-1003"},
        "record": {
            "nl_customer_order.order_number": "CO-1003",
            "nl_customer_order.status": "shipped",
            "nl_customer_order.customer_id": {"$ref": "contact.volga"},
            "nl_customer_order.source_quote_id": {"$ref": "quote.c"},
            "nl_customer_order.source_quote_number": "NQ-1003",
            "nl_customer_order.sales_entity": "NLight BV",
            "nl_customer_order.order_date": "2026-03-12",
            "nl_customer_order.currency": "EUR",
            "nl_customer_order.customer_reference": "VOLGA-GROW-09",
            "nl_customer_order.delivery_terms": "DAP Kazakhstan",
            "nl_customer_order.shipping_destination": "Karaganda Logistics Hub, Kazakhstan",
            "nl_customer_order.requested_delivery_date": "2026-04-30",
            "nl_customer_order.notes": "Scenario C operational order.",
            "nl_customer_order.purchase_order_number": "PO-1003",
            "nl_customer_order.preferred_supplier_id": {"$ref": "contact.guangzhou"},
            "nl_customer_order.deposit_percent": 30,
            "nl_customer_order.final_invoice_number": "INV-1003-F"
        }
    },
    {
        "alias": "order_line.a.1",
        "entity_id": "entity.nl_customer_order_line",
        "match": {"nl_customer_order_line.description": "NL-LED-720W", "nl_customer_order_line.customer_order_id": {"$ref": "order.a"}},
        "record": {
            "nl_customer_order_line.customer_order_id": {"$ref": "order.a"},
            "nl_customer_order_line.product_id": {"$ref": "product.led720"},
            "nl_customer_order_line.description": "NL-LED-720W",
            "nl_customer_order_line.uom": "EA",
            "nl_customer_order_line.quantity": 120,
            "nl_customer_order_line.unit_price": 520,
            "nl_customer_order_line.unit_cost_snapshot": 335,
            "nl_customer_order_line.source_quote_line_ref": {"$ref": "quote_line.a.1"}
        }
    },
    {
        "alias": "order_line.a.2",
        "entity_id": "entity.nl_customer_order_line",
        "match": {"nl_customer_order_line.description": "NL-HANGER-KIT", "nl_customer_order_line.customer_order_id": {"$ref": "order.a"}},
        "record": {
            "nl_customer_order_line.customer_order_id": {"$ref": "order.a"},
            "nl_customer_order_line.product_id": {"$ref": "product.hanger"},
            "nl_customer_order_line.description": "NL-HANGER-KIT",
            "nl_customer_order_line.uom": "KIT",
            "nl_customer_order_line.quantity": 120,
            "nl_customer_order_line.unit_price": 24,
            "nl_customer_order_line.unit_cost_snapshot": 8,
            "nl_customer_order_line.source_quote_line_ref": {"$ref": "quote_line.a.2"}
        }
    },
    {
        "alias": "order_line.a.3",
        "entity_id": "entity.nl_customer_order_line",
        "match": {"nl_customer_order_line.description": "Custom freight coordination", "nl_customer_order_line.customer_order_id": {"$ref": "order.a"}},
        "record": {
            "nl_customer_order_line.customer_order_id": {"$ref": "order.a"},
            "nl_customer_order_line.description": "Custom freight coordination",
            "nl_customer_order_line.uom": "LOT",
            "nl_customer_order_line.quantity": 1,
            "nl_customer_order_line.unit_price": 1450,
            "nl_customer_order_line.unit_cost_snapshot": 700,
            "nl_customer_order_line.source_quote_line_ref": {"$ref": "quote_line.a.3"}
        }
    },
    {
        "alias": "order_line.c.1",
        "entity_id": "entity.nl_customer_order_line",
        "match": {"nl_customer_order_line.description": "NL-LED-720W", "nl_customer_order_line.customer_order_id": {"$ref": "order.c"}},
        "record": {
            "nl_customer_order_line.customer_order_id": {"$ref": "order.c"},
            "nl_customer_order_line.product_id": {"$ref": "product.led720"},
            "nl_customer_order_line.description": "NL-LED-720W",
            "nl_customer_order_line.uom": "EA",
            "nl_customer_order_line.quantity": 80,
            "nl_customer_order_line.unit_price": 515,
            "nl_customer_order_line.unit_cost_snapshot": 335,
            "nl_customer_order_line.source_quote_line_ref": {"$ref": "quote_line.c.1"}
        }
    },
    {
        "alias": "order_line.c.2",
        "entity_id": "entity.nl_customer_order_line",
        "match": {"nl_customer_order_line.description": "NL-CONTROL-UNIT", "nl_customer_order_line.customer_order_id": {"$ref": "order.c"}},
        "record": {
            "nl_customer_order_line.customer_order_id": {"$ref": "order.c"},
            "nl_customer_order_line.product_id": {"$ref": "product.control"},
            "nl_customer_order_line.description": "NL-CONTROL-UNIT",
            "nl_customer_order_line.uom": "EA",
            "nl_customer_order_line.quantity": 8,
            "nl_customer_order_line.unit_price": 165,
            "nl_customer_order_line.unit_cost_snapshot": 96,
            "nl_customer_order_line.source_quote_line_ref": {"$ref": "quote_line.c.2"}
        }
    },
    {
        "alias": "po.a",
        "entity_id": "entity.nl_purchase_order",
        "match": {"nl_purchase_order.po_number": "PO-1001"},
        "record": {
            "nl_purchase_order.po_number": "PO-1001",
            "nl_purchase_order.status": "sent_to_supplier",
            "nl_purchase_order.supplier_id": {"$ref": "contact.shenzhen"},
            "nl_purchase_order.purchasing_entity": "EcoTech FZCO",
            "nl_purchase_order.source_customer_order_id": {"$ref": "order.a"},
            "nl_purchase_order.source_customer_order_number": "CO-1001",
            "nl_purchase_order.po_date": "2026-03-24",
            "nl_purchase_order.currency": "USD",
            "nl_purchase_order.supplier_reference": "SZ-LUM-1001",
            "nl_purchase_order.incoterm": "FOB",
            "nl_purchase_order.expected_ship_date": "2026-04-20",
            "nl_purchase_order.expected_arrival_date": "2026-05-12",
            "nl_purchase_order.notes": "Scenario A factory order.",
            "nl_purchase_order.freight_estimate": 1850
        }
    },
    {
        "alias": "po.c",
        "entity_id": "entity.nl_purchase_order",
        "match": {"nl_purchase_order.po_number": "PO-1003"},
        "record": {
            "nl_purchase_order.po_number": "PO-1003",
            "nl_purchase_order.status": "confirmed",
            "nl_purchase_order.supplier_id": {"$ref": "contact.guangzhou"},
            "nl_purchase_order.purchasing_entity": "EcoTech FZCO",
            "nl_purchase_order.source_customer_order_id": {"$ref": "order.c"},
            "nl_purchase_order.source_customer_order_number": "CO-1003",
            "nl_purchase_order.po_date": "2026-03-14",
            "nl_purchase_order.currency": "USD",
            "nl_purchase_order.supplier_reference": "GZ-LED-1003",
            "nl_purchase_order.incoterm": "FCA",
            "nl_purchase_order.expected_ship_date": "2026-04-02",
            "nl_purchase_order.expected_arrival_date": "2026-04-25",
            "nl_purchase_order.notes": "Scenario C supplier order.",
            "nl_purchase_order.freight_estimate": 1250
        }
    },
    {
        "alias": "po_line.a.1",
        "entity_id": "entity.nl_purchase_order_line",
        "match": {"nl_purchase_order_line.description": "NL-LED-720W", "nl_purchase_order_line.purchase_order_id": {"$ref": "po.a"}},
        "record": {
            "nl_purchase_order_line.purchase_order_id": {"$ref": "po.a"},
            "nl_purchase_order_line.product_id": {"$ref": "product.led720"},
            "nl_purchase_order_line.description": "NL-LED-720W",
            "nl_purchase_order_line.uom": "EA",
            "nl_purchase_order_line.quantity": 120,
            "nl_purchase_order_line.unit_cost": 335,
            "nl_purchase_order_line.source_order_line_ref": {"$ref": "order_line.a.1"}
        }
    },
    {
        "alias": "po_line.a.2",
        "entity_id": "entity.nl_purchase_order_line",
        "match": {"nl_purchase_order_line.description": "NL-HANGER-KIT", "nl_purchase_order_line.purchase_order_id": {"$ref": "po.a"}},
        "record": {
            "nl_purchase_order_line.purchase_order_id": {"$ref": "po.a"},
            "nl_purchase_order_line.product_id": {"$ref": "product.hanger"},
            "nl_purchase_order_line.description": "NL-HANGER-KIT",
            "nl_purchase_order_line.uom": "KIT",
            "nl_purchase_order_line.quantity": 120,
            "nl_purchase_order_line.unit_cost": 8,
            "nl_purchase_order_line.source_order_line_ref": {"$ref": "order_line.a.2"}
        }
    },
    {
        "alias": "po_line.c.1",
        "entity_id": "entity.nl_purchase_order_line",
        "match": {"nl_purchase_order_line.description": "NL-LED-720W", "nl_purchase_order_line.purchase_order_id": {"$ref": "po.c"}},
        "record": {
            "nl_purchase_order_line.purchase_order_id": {"$ref": "po.c"},
            "nl_purchase_order_line.product_id": {"$ref": "product.led720"},
            "nl_purchase_order_line.description": "NL-LED-720W",
            "nl_purchase_order_line.uom": "EA",
            "nl_purchase_order_line.quantity": 80,
            "nl_purchase_order_line.unit_cost": 335,
            "nl_purchase_order_line.source_order_line_ref": {"$ref": "order_line.c.1"}
        }
    },
    {
        "alias": "po_line.c.2",
        "entity_id": "entity.nl_purchase_order_line",
        "match": {"nl_purchase_order_line.description": "NL-CONTROL-UNIT", "nl_purchase_order_line.purchase_order_id": {"$ref": "po.c"}},
        "record": {
            "nl_purchase_order_line.purchase_order_id": {"$ref": "po.c"},
            "nl_purchase_order_line.product_id": {"$ref": "product.control"},
            "nl_purchase_order_line.description": "NL-CONTROL-UNIT",
            "nl_purchase_order_line.uom": "EA",
            "nl_purchase_order_line.quantity": 8,
            "nl_purchase_order_line.unit_cost": 96,
            "nl_purchase_order_line.source_order_line_ref": {"$ref": "order_line.c.2"}
        }
    },
    {
        "alias": "invoice.a.deposit",
        "entity_id": "entity.nl_invoice",
        "match": {"nl_invoice.invoice_number": "INV-1001-D"},
        "record": {
            "nl_invoice.invoice_number": "INV-1001-D",
            "nl_invoice.status": "issued",
            "nl_invoice.invoice_type": "deposit",
            "nl_invoice.customer_id": {"$ref": "contact.greengrow"},
            "nl_invoice.source_order_id": {"$ref": "order.a"},
            "nl_invoice.source_order_number": "CO-1001",
            "nl_invoice.sales_entity": "NLight BV",
            "nl_invoice.invoice_date": "2026-03-26",
            "nl_invoice.due_date": "2026-04-05",
            "nl_invoice.currency": "EUR",
            "nl_invoice.customer_reference": "GG-POC-2026-01",
            "nl_invoice.notes": "Deposit invoice for scenario A.",
            "nl_invoice.source_order_total_snapshot": 66730,
            "nl_invoice.deposit_percent_snapshot": 30,
            "nl_invoice.amount_paid": 0
        }
    },
    {
        "alias": "invoice.c.final",
        "entity_id": "entity.nl_invoice",
        "match": {"nl_invoice.invoice_number": "INV-1003-F"},
        "record": {
            "nl_invoice.invoice_number": "INV-1003-F",
            "nl_invoice.status": "part_paid",
            "nl_invoice.invoice_type": "final",
            "nl_invoice.customer_id": {"$ref": "contact.volga"},
            "nl_invoice.source_order_id": {"$ref": "order.c"},
            "nl_invoice.source_order_number": "CO-1003",
            "nl_invoice.sales_entity": "NLight BV",
            "nl_invoice.invoice_date": "2026-03-28",
            "nl_invoice.due_date": "2026-04-12",
            "nl_invoice.currency": "EUR",
            "nl_invoice.customer_reference": "VOLGA-GROW-09",
            "nl_invoice.notes": "Final invoice for scenario C, partly paid.",
            "nl_invoice.source_order_total_snapshot": 42520,
            "nl_invoice.deposit_percent_snapshot": 30,
            "nl_invoice.amount_paid": 16000
        }
    }
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
        ("quote.a", "order.a", "CO-1001"),
        ("quote.c", "order.c", "CO-1003"),
    ]
    for quote_alias, order_alias, order_number in links:
        quote = aliases.get(quote_alias)
        order = aliases.get(order_alias)
        if not quote or not order:
            continue
        if dry_run:
            print(f"[seed] plan link {quote_alias} -> {order_number}")
            continue
        payload = dict(quote.record)
        payload["nl_quote.status"] = "accepted"
        payload["nl_quote.linked_customer_order_id"] = order.record_id
        payload["nl_quote.linked_customer_order_number"] = order_number
        updated = update_record(
            base_url,
            "entity.nl_quote",
            quote.record_id,
            payload,
            token=token,
            workspace_id=workspace_id,
        )
        aliases[quote_alias] = updated
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
        ("order.a", {"nl_customer_order.primary_purchase_order_id": "po.a", "nl_customer_order.deposit_invoice_id": "invoice.a.deposit"}),
        ("order.c", {"nl_customer_order.primary_purchase_order_id": "po.c", "nl_customer_order.final_invoice_id": "invoice.c.final"}),
    ]
    for order_alias, field_aliases in links:
        order = aliases.get(order_alias)
        if not order:
            continue
        payload = dict(order.record)
        changed = False
        for field_id, related_alias in field_aliases.items():
            related = aliases.get(related_alias)
            if not related:
                continue
            payload[field_id] = related.record_id
            changed = True
        if not changed:
            continue
        if dry_run:
            print(f"[seed] plan link {order_alias} workflow ids")
            continue
        updated = update_record(
            base_url,
            "entity.nl_customer_order",
            order.record_id,
            payload,
            token=token,
            workspace_id=workspace_id,
        )
        aliases[order_alias] = updated
        print(f"[seed] linked   {order_alias} workflow ids")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed Luke Prototype v1 demo data.")
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
    print("[seed] complete")


if __name__ == "__main__":
    main()
