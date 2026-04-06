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
            "biz_contact.billing_address": "Keizersgracht 100, Amsterdam, Netherlands",
            "biz_contact.shipping_address": "Aalsmeer Trade Park 4, Aalsmeer, Netherlands",
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
            "biz_contact.billing_address": "Dubai Investment Park, Dubai, UAE",
            "biz_contact.shipping_address": "Jebel Ali South, Dubai, UAE",
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
            "biz_contact.billing_address": "Astana Business Centre, Astana, Kazakhstan",
            "biz_contact.shipping_address": "Karaganda Logistics Hub, Karaganda, Kazakhstan",
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
            "biz_contact.billing_address": "Bao'an District, Shenzhen, China",
            "biz_contact.shipping_address": "Yantian Port, Shenzhen, China",
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
            "biz_contact.billing_address": "Panyu District, Guangzhou, China",
            "biz_contact.shipping_address": "Nansha Port, Guangzhou, China",
            "biz_contact.notes": "Factory partner for scenario C.",
            "biz_contact.is_active": True
        }
    }
]


SETTINGS_SPECS = [
    {
        "alias": "entity.nlight_bv",
        "entity_id": "entity.biz_operating_entity",
        "match": {"biz_operating_entity.name": "NLight BV"},
        "record": {
            "biz_operating_entity.name": "NLight BV",
            "biz_operating_entity.legal_name": "NLight BV",
            "biz_operating_entity.base_currency": "EUR",
            "biz_operating_entity.tax_number": "NL999999999B01",
            "biz_operating_entity.quote_prefix": "Q-NL-",
            "biz_operating_entity.order_prefix": "SO-NL-",
            "biz_operating_entity.invoice_prefix": "INV-NL-",
            "biz_operating_entity.address": "Amsterdam, Netherlands",
            "biz_operating_entity.active": True,
        },
    },
    {
        "alias": "entity.ecotech_fzco",
        "entity_id": "entity.biz_operating_entity",
        "match": {"biz_operating_entity.name": "EcoTech FZCO"},
        "record": {
            "biz_operating_entity.name": "EcoTech FZCO",
            "biz_operating_entity.legal_name": "EcoTech FZCO",
            "biz_operating_entity.base_currency": "USD",
            "biz_operating_entity.tax_number": "AE999999999999999",
            "biz_operating_entity.quote_prefix": "Q-ET-",
            "biz_operating_entity.order_prefix": "SO-ET-",
            "biz_operating_entity.invoice_prefix": "INV-ET-",
            "biz_operating_entity.address": "Dubai, United Arab Emirates",
            "biz_operating_entity.active": True,
        },
    },
    {
        "alias": "payment.net14",
        "entity_id": "entity.biz_payment_term",
        "match": {"biz_payment_term.name": "Net 14"},
        "record": {
            "biz_payment_term.name": "Net 14",
            "biz_payment_term.description": "Payment due 14 days after invoice date.",
            "biz_payment_term.days_until_due": 14,
            "biz_payment_term.deposit_percent_default": 0,
            "biz_payment_term.active": True,
        },
    },
    {
        "alias": "payment.net30",
        "entity_id": "entity.biz_payment_term",
        "match": {"biz_payment_term.name": "Net 30"},
        "record": {
            "biz_payment_term.name": "Net 30",
            "biz_payment_term.description": "Payment due 30 days after invoice date.",
            "biz_payment_term.days_until_due": 30,
            "biz_payment_term.deposit_percent_default": 0,
            "biz_payment_term.active": True,
        },
    },
    {
        "alias": "payment.deposit_30",
        "entity_id": "entity.biz_payment_term",
        "match": {"biz_payment_term.name": "30% Deposit + Balance"},
        "record": {
            "biz_payment_term.name": "30% Deposit + Balance",
            "biz_payment_term.description": "30% deposit up front, balance before shipment or on final invoice.",
            "biz_payment_term.days_until_due": 30,
            "biz_payment_term.deposit_percent_default": 30,
            "biz_payment_term.active": True,
        },
    },
    {
        "alias": "tax.zero",
        "entity_id": "entity.biz_tax_code",
        "match": {"biz_tax_code.code": "ZERO"},
        "record": {
            "biz_tax_code.code": "ZERO",
            "biz_tax_code.name": "Zero Rated",
            "biz_tax_code.rate": 0,
            "biz_tax_code.scope": "both",
            "biz_tax_code.active": True,
        },
    },
    {
        "alias": "tax.sales_21",
        "entity_id": "entity.biz_tax_code",
        "match": {"biz_tax_code.code": "VAT21"},
        "record": {
            "biz_tax_code.code": "VAT21",
            "biz_tax_code.name": "VAT 21%",
            "biz_tax_code.rate": 21,
            "biz_tax_code.scope": "sales",
            "biz_tax_code.active": True,
        },
    },
    {
        "alias": "tax.purchase_0",
        "entity_id": "entity.biz_tax_code",
        "match": {"biz_tax_code.code": "PUR0"},
        "record": {
            "biz_tax_code.code": "PUR0",
            "biz_tax_code.name": "Import / Purchase 0%",
            "biz_tax_code.rate": 0,
            "biz_tax_code.scope": "purchase",
            "biz_tax_code.active": True,
        },
    },
    {
        "alias": "template.quote_standard",
        "entity_id": "entity.biz_document_template",
        "match": {"biz_document_template.name": "Standard Quote"},
        "record": {
            "biz_document_template.name": "Standard Quote",
            "biz_document_template.template_type": "quote",
            "biz_document_template.default_notes": "Pricing excludes local duties unless stated otherwise.",
            "biz_document_template.footer_text": "Thank you for the opportunity to quote.",
            "biz_document_template.active": True,
        },
    },
    {
        "alias": "template.invoice_standard",
        "entity_id": "entity.biz_document_template",
        "match": {"biz_document_template.name": "Standard Invoice"},
        "record": {
            "biz_document_template.name": "Standard Invoice",
            "biz_document_template.template_type": "invoice",
            "biz_document_template.default_notes": "Please remit payment according to the agreed terms.",
            "biz_document_template.footer_text": "Payment details available on request.",
            "biz_document_template.active": True,
        },
    },
    {
        "alias": "integration.pipedrive",
        "entity_id": "entity.biz_integration_setting",
        "match": {"biz_integration_setting.provider": "pipedrive"},
        "record": {
            "biz_integration_setting.provider": "pipedrive",
            "biz_integration_setting.status": "connected",
            "biz_integration_setting.external_org_name": "Commercial CRM",
            "biz_integration_setting.sync_notes": "Deals and organizations linked for quote creation.",
        },
    },
    {
        "alias": "integration.xero",
        "entity_id": "entity.biz_integration_setting",
        "match": {"biz_integration_setting.provider": "xero"},
        "record": {
            "biz_integration_setting.provider": "xero",
            "biz_integration_setting.status": "connected",
            "biz_integration_setting.external_org_name": "Finance Ledger",
            "biz_integration_setting.sync_notes": "Invoice and payment sync active for demo state visibility.",
        },
    },
    {
        "alias": "integration.clickup",
        "entity_id": "entity.biz_integration_setting",
        "match": {"biz_integration_setting.provider": "clickup"},
        "record": {
            "biz_integration_setting.provider": "clickup",
            "biz_integration_setting.status": "disconnected",
            "biz_integration_setting.external_org_name": "Operations Workspace",
            "biz_integration_setting.sync_notes": "Prepared for later post-deposit task creation.",
        },
    },
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
        "match": {"biz_quote.quote_number": "NQ-1001"},
        "record": {
            "biz_quote.quote_number": "NQ-1001",
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
        "match": {"biz_quote.quote_number": "NQ-1002"},
        "record": {
            "biz_quote.quote_number": "NQ-1002",
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
        "match": {"biz_quote.quote_number": "NQ-1003"},
        "record": {
            "biz_quote.quote_number": "NQ-1003",
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
        "match": {"biz_order.order_number": "CO-1001"},
        "record": {
            "biz_order.order_number": "CO-1001",
            "biz_order.status": "confirmed",
            "biz_order.customer_id": {"$ref": "contact.greengrow"},
            "biz_order.source_quote_id": {"$ref": "quote.a"},
            "biz_order.source_quote_number": "NQ-1001",
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
        "match": {"biz_order.order_number": "CO-1003"},
        "record": {
            "biz_order.order_number": "CO-1003",
            "biz_order.status": "shipped",
            "biz_order.customer_id": {"$ref": "contact.volga"},
            "biz_order.source_quote_id": {"$ref": "quote.c"},
            "biz_order.source_quote_number": "NQ-1003",
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
        "match": {"biz_purchase_order.po_number": "PO-1001"},
        "record": {
            "biz_purchase_order.po_number": "PO-1001",
            "biz_purchase_order.status": "sent_to_supplier",
            "biz_purchase_order.supplier_id": {"$ref": "contact.shenzhen"},
            "biz_purchase_order.purchasing_entity": "EcoTech FZCO",
            "biz_purchase_order.source_customer_order_id": {"$ref": "order.a"},
            "biz_purchase_order.source_customer_order_number": "CO-1001",
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
        "match": {"biz_purchase_order.po_number": "PO-1003"},
        "record": {
            "biz_purchase_order.po_number": "PO-1003",
            "biz_purchase_order.status": "confirmed",
            "biz_purchase_order.supplier_id": {"$ref": "contact.guangzhou"},
            "biz_purchase_order.purchasing_entity": "EcoTech FZCO",
            "biz_purchase_order.source_customer_order_id": {"$ref": "order.c"},
            "biz_purchase_order.source_customer_order_number": "CO-1003",
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
        "match": {"biz_invoice.invoice_number": "INV-1001-D"},
        "record": {
            "biz_invoice.invoice_number": "INV-1001-D",
            "biz_invoice.status": "issued",
            "biz_invoice.invoice_type": "deposit",
            "biz_invoice.customer_id": {"$ref": "contact.greengrow"},
            "biz_invoice.source_order_id": {"$ref": "order.a"},
            "biz_invoice.source_order_number": "CO-1001",
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
        "match": {"biz_invoice.invoice_number": "INV-1003-F"},
        "record": {
            "biz_invoice.invoice_number": "INV-1003-F",
            "biz_invoice.status": "part_paid",
            "biz_invoice.invoice_type": "final",
            "biz_invoice.customer_id": {"$ref": "contact.volga"},
            "biz_invoice.source_order_id": {"$ref": "order.c"},
            "biz_invoice.source_order_number": "CO-1003",
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
        payload["biz_quote.status"] = "accepted"
        payload["biz_quote.linked_customer_order_id"] = order.record_id
        payload["biz_quote.linked_customer_order_number"] = order_number
        updated = update_record(
            base_url,
            "entity.biz_quote",
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
        ("order.a", {"biz_order.primary_purchase_order_id": "po.a", "biz_order.deposit_invoice_id": "invoice.a.deposit"}),
        ("order.c", {"biz_order.primary_purchase_order_id": "po.c", "biz_order.final_invoice_id": "invoice.c.final"}),
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
            "entity.biz_order",
            order.record_id,
            payload,
            token=token,
            workspace_id=workspace_id,
        )
        aliases[order_alias] = updated
        print(f"[seed] linked   {order_alias} workflow ids")


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

    for spec in SETTINGS_SPECS:
        create_or_get(base_url, spec, aliases, token=token, workspace_id=workspace_id, dry_run=args.dry_run)
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
