#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any
from urllib import parse as urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "_shared"))

from manifest_tooling import api_call, collect_error_text, is_ok


PRODUCT_ENTITY = "entity.biz_product"
SUPPLIER_ENTITY = "entity.biz_contact"
PRODUCT_SUPPLIER_ENTITY = "entity.biz_product_supplier"


CATALOG_ROWS: list[dict[str, Any]] = [
    {"row": 1, "supplier": "SNC or Longhorn", "model": "RV1600-4C", "wattage": 1600, "spectrum": "88R 6G 6B + 10FR", "input_voltage": "360-400V AC", "ppe": "3.8", "ppf": 6240, "dimmable": "0-10V", "ip": "IP66", "ambient": "45C", "modules": "4", "eco_usd": 521.00, "nlight_usd": 573.10, "cost_eur": 487.14},
    {"row": 2, "supplier": "SNC or Longhorn", "model": "RV1600-4C", "wattage": 1600, "spectrum": "80R 10G 10B + 10FR", "input_voltage": "360-400V AC", "ppe": "3.5", "ppf": 5600, "dimmable": "0-10V", "ip": "IP66", "ambient": "45C", "modules": "4", "eco_usd": 505.00, "nlight_usd": 555.50, "cost_eur": 472.18},
    {"row": 3, "supplier": "SNC or Longhorn", "model": "RV1400-4C", "wattage": 1400, "spectrum": "88R 6G 6B + 10FR", "input_voltage": "360-400V AC", "ppe": "3.8", "ppf": 5460, "dimmable": "0-10V", "ip": "IP66", "ambient": "45C", "modules": "4", "eco_usd": 455.00, "nlight_usd": 500.50, "cost_eur": 425.43},
    {"row": 4, "supplier": "SNC", "model": "RV1300MJ-4C", "wattage": 1300, "spectrum": "60R 30G 10B + 10FR", "input_voltage": "360-400V AC", "ppe": "YPE 2.7 / PPE 2.55", "ppf": 3510, "dimmable": "0-10V", "ip": "IP66", "ambient": "45C", "modules": "4", "eco_usd": 487.00, "nlight_usd": 535.70, "cost_eur": 455.35},
    {"row": 5, "supplier": "GoPro", "model": "RV1200-4C", "wattage": 1200, "spectrum": "80R 10G 10B + 10FR", "input_voltage": "360-400V AC", "ppe": "3.5", "ppf": 4200, "dimmable": "0-10V", "ip": "IP66", "ambient": "45C", "modules": "4", "eco_usd": 393.68, "nlight_usd": 433.05, "cost_eur": 368.09},
    {"row": 6, "supplier": "GoPro", "model": "RV1200-4C", "wattage": 1200, "spectrum": "88R 6G 6B + 10FR", "input_voltage": "360-400V AC", "ppe": "3.8", "ppf": 4560, "dimmable": "0-10V", "ip": "IP66", "ambient": "45C", "modules": "4", "eco_usd": 419.58, "nlight_usd": 461.54, "cost_eur": 392.31},
    {"row": 7, "supplier": "GoPro", "model": "RV1200-1C", "wattage": 1160, "spectrum": "88R 6G 6B", "input_voltage": "360-400V AC", "ppe": "3.8", "ppf": 4408, "dimmable": "0-10V", "ip": "IP66", "ambient": "45C", "modules": "4", "eco_usd": 410.98, "nlight_usd": 452.08, "cost_eur": 384.27},
    {"row": 8, "supplier": "GoPro", "model": "RV1000-4C", "wattage": 1000, "spectrum": "88R 6G 6B + 10FR", "input_voltage": "360-400V AC", "ppe": "3.8", "ppf": 3800, "dimmable": "0-10V", "ip": "IP66", "ambient": "45C", "modules": "4", "eco_usd": 391.25, "nlight_usd": 430.38, "cost_eur": 365.82},
    {"row": 9, "supplier": "GoPro", "model": "RV1000-4C", "wattage": 1000, "spectrum": "88R 6G 6B + 10FR", "input_voltage": "360-400V AC", "ppe": "3.9", "ppf": 3900, "dimmable": "0-10V", "ip": "IP66", "ambient": "45C", "modules": "4", "eco_usd": 437.66, "nlight_usd": 481.43, "cost_eur": 409.22},
    {"row": 10, "supplier": "GoPro", "model": "RV1050-4C", "wattage": 1050, "spectrum": "88R 6G 6B + 10FR", "input_voltage": "360-400V AC", "ppe": "3.9", "ppf": 4095, "dimmable": "0-10V", "ip": "IP66", "ambient": "45C", "modules": "4", "eco_usd": 438.66, "nlight_usd": 482.53, "cost_eur": 410.15},
    {"row": 11, "supplier": "SNC or Longhorn", "model": "RV800-4C", "wattage": 800, "spectrum": "88R 6G 6B + 10FR", "input_voltage": "360-400V AC", "ppe": "3.7", "ppf": 2960, "dimmable": "0-10V", "ip": "IP66", "ambient": "45C", "modules": "2", "eco_usd": 371.00, "nlight_usd": 408.10, "cost_eur": 346.89},
    {"row": 12, "supplier": "SNC or Longhorn", "model": "RV800-3C", "wattage": 800, "spectrum": "88R 6G 6B + 10FR", "input_voltage": "360-400V AC", "ppe": "3.7", "ppf": 2960, "dimmable": "0-10V", "ip": "IP66", "ambient": "45C", "modules": "2", "eco_usd": 371.00, "nlight_usd": 408.10, "cost_eur": 346.89},
    {"row": 13, "supplier": "GoPro", "model": "RV600-4C", "wattage": 600, "spectrum": "88R 6G 6B + 10FR", "input_voltage": "360-400V AC", "ppe": "3.8", "ppf": 2280, "dimmable": "0-10V", "ip": "IP66", "ambient": "45C", "modules": "2", "eco_usd": 281.58, "nlight_usd": 309.74, "cost_eur": 263.28},
    {"row": 14, "supplier": "SNC", "model": "RV600-MJ3C", "wattage": 600, "spectrum": "60R 30G 10B + 10FR", "input_voltage": "347-400V AC", "ppe": "YPE 2.7 / PPE 2.55", "ppf": 1620, "dimmable": "0-10V", "ip": "IP66", "ambient": "45C", "modules": "2", "eco_usd": 341.80, "nlight_usd": 375.98, "cost_eur": 319.58},
    {"row": 15, "supplier": "GoPro", "model": "RV600-3C", "wattage": 600, "spectrum": "88R 6G 6B + 10FR", "input_voltage": "360-400V AC", "ppe": "3.8", "ppf": 2280, "dimmable": "0-10V", "ip": "IP66", "ambient": "45C", "modules": "2", "eco_usd": 254.28, "nlight_usd": 279.71, "cost_eur": 237.75},
    {"row": 16, "supplier": "GoPro", "model": "RV600-4C", "wattage": 600, "spectrum": "80R 10G 10B + 10FR", "input_voltage": "360-400V AC", "ppe": "3.5", "ppf": 2100, "dimmable": "0-10V", "ip": "IP66", "ambient": "45C", "modules": "2", "eco_usd": 277.96, "nlight_usd": 305.76, "cost_eur": 259.89},
    {"row": 17, "supplier": "GoPro", "model": "RV600-3C", "wattage": 600, "spectrum": "80R 10G 10B + 10FR", "input_voltage": "360-400V AC", "ppe": "3.5", "ppf": 2100, "dimmable": "0-10V", "ip": "IP66", "ambient": "45C", "modules": "2", "eco_usd": 250.66, "nlight_usd": 275.73, "cost_eur": 234.37},
    {"row": 18, "supplier": "GoPro", "model": "RV400-MJ3C", "wattage": 400, "spectrum": "60R 30G 10B + 10FR", "input_voltage": "347-400V AC", "ppe": "YPE 2.7 / PPE 2.55", "ppf": 1080, "dimmable": "0-10V", "ip": "IP66", "ambient": "45C", "modules": "2", "eco_usd": 221.06, "nlight_usd": 243.17, "cost_eur": 206.69},
    {"row": 19, "supplier": "GoPro", "model": "RV400-1C", "wattage": 400, "spectrum": "65R 25G 0B 10FR", "input_voltage": "220-400V", "ppe": "3", "ppf": 1200, "dimmable": "0-10V", "ip": "IP66", "ambient": "45C", "modules": "2", "eco_usd": 215.33, "nlight_usd": 236.86, "cost_eur": 201.33},
    {"row": 20, "supplier": "GoPro", "model": "RV400-2C", "wattage": 400, "spectrum": "88R 6G 6B + 10FR", "input_voltage": "220-400V", "ppe": "3.7", "ppf": 1480, "dimmable": "0-10V", "ip": "IP66", "ambient": "45C", "modules": "2", "eco_usd": 232.66, "nlight_usd": 255.93, "cost_eur": 217.54},
    {"row": 21, "supplier": "Lumlux", "model": "NH1000-WE", "wattage": 1000, "spectrum": "", "input_voltage": "347-400V", "ppe": "1.9", "ppf": 1900, "dimmable": "", "ip": "", "ambient": "", "modules": "", "eco_usd": 90.85, "nlight_usd": 99.93, "cost_eur": 84.94},
    {"row": 22, "supplier": "Lumlux", "model": "NH1000-SE", "wattage": 1000, "spectrum": "", "input_voltage": "347-400V", "ppe": "1.9", "ppf": 1900, "dimmable": "", "ip": "", "ambient": "", "modules": "", "eco_usd": 93.99, "nlight_usd": 103.39, "cost_eur": 87.88},
    {"row": 23, "supplier": "Lumlux", "model": "NH600-WE", "wattage": 600, "spectrum": "", "input_voltage": "347-400V", "ppe": "1.65", "ppf": 990, "dimmable": "", "ip": "", "ambient": "", "modules": "", "eco_usd": 75.07, "nlight_usd": 82.58, "cost_eur": 70.19},
    {"row": 24, "supplier": "Lumlux", "model": "NH600-SE", "wattage": 600, "spectrum": "", "input_voltage": "347-400V", "ppe": "1.65", "ppf": 990, "dimmable": "", "ip": "", "ambient": "", "modules": "", "eco_usd": 67.29, "nlight_usd": 74.02, "cost_eur": 62.92},
    {"row": 25, "supplier": "Lumlux", "model": "NG600", "wattage": 600, "spectrum": "", "input_voltage": "220V", "ppe": "1.67", "ppf": 1000, "dimmable": "", "ip": "", "ambient": "", "modules": "", "eco_usd": 5.14, "nlight_usd": 5.65, "cost_eur": 4.80},
    {"row": 26, "supplier": "Lumlux", "model": "NG1000", "wattage": 1000, "spectrum": "", "input_voltage": "220V", "ppe": "2.1", "ppf": 2100, "dimmable": "", "ip": "", "ambient": "", "modules": "", "eco_usd": 17.36, "nlight_usd": 19.10, "cost_eur": 16.24},
    {"row": 27, "supplier": "Insona", "model": "Dongle", "eco_usd": 15.13, "nlight_usd": 16.65, "cost_eur": 14.15},
    {"row": 28, "supplier": "Insona", "model": "Bridge", "eco_usd": 58.30, "nlight_usd": 64.13, "cost_eur": 54.51},
    {"row": 29, "supplier": "Insona", "model": "Gateway", "eco_usd": 502.86, "nlight_usd": 553.15, "cost_eur": 470.18},
    {"row": 30, "supplier": "Insona", "model": "2 Button Switch", "eco_usd": 23.88, "nlight_usd": 26.27, "cost_eur": 22.33},
    {"row": 31, "supplier": "Insona", "model": "Par Sensor", "eco_usd": 124.59, "nlight_usd": 137.05, "cost_eur": 116.49},
]


SERVICE_ROWS: list[dict[str, Any]] = [
    {
        "code": "NL-SVC-DISPOSAL-FEE",
        "name": "Disposal Fee (NL customers only)",
        "product_type": "service_charge",
        "category": "Services",
        "uom": "EA",
        "sales_price": 0.23,
        "sales_currency": "EUR",
        "quote_cost_price": 0.23,
        "quote_cost_currency": "EUR",
        "quote_cost_mode": "pass_through",
        "description": "Mandatory Netherlands disposal fee. No markup should be applied.",
    },
    {
        "code": "NL-SVC-ENGINEER-COMMISSIONING",
        "name": "Engineer (Commissioning) per hour",
        "product_type": "service_charge",
        "category": "Services",
        "uom": "HOUR",
        "sales_price": 0,
        "sales_currency": "EUR",
        "quote_cost_price": 50.00,
        "quote_cost_currency": "EUR",
        "quote_cost_mode": "catalogue",
        "description": "Commissioning engineer cost per hour. Sales price should be set on the quote.",
    },
    {
        "code": "NL-SVC-DELIVERY-CHARGE",
        "name": "Delivery Charge",
        "product_type": "delivery_charge",
        "category": "Delivery",
        "uom": "EA",
        "sales_price": 0,
        "sales_currency": "EUR",
        "quote_cost_price": 0,
        "quote_cost_currency": "EUR",
        "quote_cost_mode": "manual_per_quote",
        "description": "Delivery must be quoted by head office for each quote before cost-of-sale is entered.",
    },
]


def slug(value: str) -> str:
    out = "".join(ch if ch.isalnum() else "-" for ch in value.strip().upper())
    while "--" in out:
        out = out.replace("--", "-")
    return out.strip("-")


def round_money(value: Any) -> float:
    return round(float(value or 0), 2)


def list_records(
    base_url: str,
    entity_id: str,
    *,
    token: str,
    workspace_id: str,
    cap: int = 5000,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    cursor: str | None = None
    while len(out) < cap:
        params: dict[str, str | int] = {"limit": min(200, cap - len(out))}
        if cursor:
            params["cursor"] = cursor
        status, payload = api_call(
            "GET",
            f"{base_url}/records/{urlparse.quote(entity_id, safe='')}?{urlparse.urlencode(params)}",
            token=token,
            workspace_id=workspace_id,
            timeout=180,
        )
        if status >= 400 or not is_ok(payload):
            raise RuntimeError(f"list {entity_id} failed: {collect_error_text(payload)}")
        rows = payload.get("records")
        if not isinstance(rows, list) or not rows:
            break
        out.extend(row for row in rows if isinstance(row, dict))
        cursor = payload.get("next_cursor") if isinstance(payload.get("next_cursor"), str) else None
        if not cursor:
            break
    return out


def create_record(base_url: str, entity_id: str, record: dict[str, Any], *, token: str, workspace_id: str) -> dict[str, Any]:
    status, payload = api_call(
        "POST",
        f"{base_url}/records/{urlparse.quote(entity_id, safe='')}",
        token=token,
        workspace_id=workspace_id,
        body={"record": record},
        timeout=180,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"create {entity_id} failed: {collect_error_text(payload)}")
    return payload


def update_record(
    base_url: str,
    entity_id: str,
    record_id: str,
    record: dict[str, Any],
    *,
    token: str,
    workspace_id: str,
) -> dict[str, Any]:
    status, payload = api_call(
        "PUT",
        f"{base_url}/records/{urlparse.quote(entity_id, safe='')}/{urlparse.quote(record_id, safe='')}",
        token=token,
        workspace_id=workspace_id,
        body={"record": record},
        timeout=180,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"update {entity_id}/{record_id} failed: {collect_error_text(payload)}")
    return payload


def record_payload(row: dict[str, Any]) -> dict[str, Any]:
    return row.get("record") if isinstance(row.get("record"), dict) else {}


def record_id(row: dict[str, Any]) -> str | None:
    value = row.get("record_id") or record_payload(row).get("id")
    return value if isinstance(value, str) and value else None


def upsert(
    base_url: str,
    entity_id: str,
    existing_row: dict[str, Any] | None,
    payload: dict[str, Any],
    *,
    token: str,
    workspace_id: str,
    dry_run: bool,
    label: str,
) -> tuple[str, dict[str, Any]]:
    if existing_row:
        existing_id = record_id(existing_row)
        if not existing_id:
            raise RuntimeError(f"existing {entity_id} row missing record_id for {label}")
        merged = {**record_payload(existing_row), **payload}
        if dry_run:
            print(f"[catalog] update {label}")
            return existing_id, merged
        update_record(base_url, entity_id, existing_id, merged, token=token, workspace_id=workspace_id)
        print(f"[catalog] updated {label}")
        return existing_id, merged
    if dry_run:
        print(f"[catalog] create {label}")
        return f"dry-run:{label}", payload
    created = create_record(base_url, entity_id, payload, token=token, workspace_id=workspace_id)
    created_id = created.get("record_id")
    if not isinstance(created_id, str) or not created_id:
        raise RuntimeError(f"create {entity_id} failed: missing record_id for {label}")
    print(f"[catalog] created {label}")
    return created_id, created.get("record") if isinstance(created.get("record"), dict) else payload


def build_catalog_product(row: dict[str, Any], supplier_id: str | None) -> dict[str, Any]:
    code = f"NL-CAT-{int(row['row']):03d}-{slug(str(row['model']))}"
    is_fixture = int(row["row"]) <= 26
    product_type = "led_fixture" if is_fixture else "accessory"
    wattage = row.get("wattage")
    spec_bits = [
        f"{int(wattage)}W" if isinstance(wattage, (int, float)) else "",
        str(row.get("spectrum") or "").strip(),
        str(row.get("input_voltage") or "").strip(),
        f"PPF {row.get('ppf')}" if row.get("ppf") else "",
        f"PPE {row.get('ppe')}" if row.get("ppe") else "",
        str(row.get("ip") or "").strip(),
    ]
    specs = ", ".join(bit for bit in spec_bits if bit)
    name_parts = ["NLight", str(row["model"])]
    if isinstance(wattage, (int, float)):
        name_parts.append(f"{int(wattage)}W")
    name = " ".join(name_parts)
    if row.get("spectrum"):
        name = f"{name} - {row['spectrum']}"
    description = name if not specs else f"{name}. Specs: {specs}."
    payload = {
        "biz_product.code": code,
        "biz_product.name": name,
        "biz_product.description": description,
        "biz_product.category": "LED Fixtures" if is_fixture else "Controls & Accessories",
        "biz_product.product_type": product_type,
        "biz_product.uom": "EA",
        "biz_product.default_sales_currency": "EUR",
        "biz_product.default_sales_price": 0,
        "biz_product.default_quote_cost_currency": "EUR",
        "biz_product.default_quote_cost_price": round_money(row.get("cost_eur")),
        "biz_product.quote_cost_mode": "catalogue",
        "biz_product.default_purchase_currency": "USD",
        "biz_product.default_buy_price": round_money(row.get("eco_usd")),
        "biz_product.intercompany_cost_currency": "USD",
        "biz_product.intercompany_cost_price": round_money(row.get("nlight_usd")),
        "biz_product.fulfilment_mode": "made_to_order",
        "biz_product.lead_time_weeks": 14 if is_fixture else 0,
        "biz_product.minimum_order_quantity": 1,
        "biz_product.supplier_factory_reference": row["model"],
        "biz_product.catalog_source": "NLight Catalogue.xlsx",
        "biz_product.catalog_row_number": row["row"],
        "biz_product.manufacturer_model": row["model"],
        "biz_product.wattage": wattage,
        "biz_product.spectrum": row.get("spectrum") or "",
        "biz_product.input_voltage": row.get("input_voltage") or "",
        "biz_product.ppe_umol_per_w": row.get("ppe") or "",
        "biz_product.ppf_umol_s": row.get("ppf") or None,
        "biz_product.dimmable": row.get("dimmable") or "",
        "biz_product.ip_rating": row.get("ip") or "",
        "biz_product.max_ambient_temp": row.get("ambient") or "",
        "biz_product.modules": row.get("modules") or "",
        "biz_product.internal_notes": (
            "Supplier and cost chain from Shelly catalogue: EcoTech supplier purchase cost is USD column M; "
            "NLight BV intercompany cost is USD column N; quote cost-of-sale is EUR column O."
        ),
        "biz_product.is_active": True,
    }
    if supplier_id:
        payload["biz_product.preferred_supplier_id"] = supplier_id
    return payload


def build_service_product(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "biz_product.code": row["code"],
        "biz_product.name": row["name"],
        "biz_product.description": row["description"],
        "biz_product.category": row["category"],
        "biz_product.product_type": row["product_type"],
        "biz_product.uom": row["uom"],
        "biz_product.default_sales_currency": row["sales_currency"],
        "biz_product.default_sales_price": round_money(row["sales_price"]),
        "biz_product.default_quote_cost_currency": row["quote_cost_currency"],
        "biz_product.default_quote_cost_price": round_money(row["quote_cost_price"]),
        "biz_product.quote_cost_mode": row["quote_cost_mode"],
        "biz_product.default_purchase_currency": row["quote_cost_currency"],
        "biz_product.default_buy_price": 0,
        "biz_product.intercompany_cost_currency": row["quote_cost_currency"],
        "biz_product.intercompany_cost_price": 0,
        "biz_product.fulfilment_mode": "made_to_order",
        "biz_product.minimum_order_quantity": 1,
        "biz_product.lead_time_weeks": 0,
        "biz_product.catalog_source": "NLight Catalogue.xlsx - quote build items",
        "biz_product.internal_notes": "Service/catalogue quote-build item seeded from the catalogue workbook.",
        "biz_product.is_active": True,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed NLight catalogue products, hidden suppliers, and supplier source rows.")
    parser.add_argument("--base-url", default=os.getenv("OCTO_BASE_URL", "").strip(), help="Octodrop API base URL")
    parser.add_argument("--token", default=os.getenv("OCTO_API_TOKEN", "").strip(), help="Bearer token")
    parser.add_argument("--workspace-id", default=os.getenv("OCTO_WORKSPACE_ID", "").strip(), help="Workspace ID")
    parser.add_argument("--dry-run", action="store_true", help="Print planned changes without writing")
    parser.add_argument("--skip-supplier-contacts", action="store_true", help="Do not create/update supplier contacts")
    parser.add_argument("--skip-supplier-sources", action="store_true", help="Do not create/update product supplier source rows")
    args = parser.parse_args()

    base_url = (args.base_url or "").rstrip("/")
    token = (args.token or "").strip()
    workspace_id = (args.workspace_id or "").strip()
    if not base_url:
        raise SystemExit("Missing --base-url or OCTO_BASE_URL")
    if not token:
        raise SystemExit("Missing --token or OCTO_API_TOKEN")
    if not workspace_id:
        raise SystemExit("Missing --workspace-id or OCTO_WORKSPACE_ID")

    existing_contacts = list_records(base_url, SUPPLIER_ENTITY, token=token, workspace_id=workspace_id)
    contacts_by_name = {
        str(record_payload(row).get("biz_contact.name") or "").strip().lower(): row
        for row in existing_contacts
        if str(record_payload(row).get("biz_contact.name") or "").strip()
    }
    supplier_ids: dict[str, str] = {}
    if not args.skip_supplier_contacts:
        for supplier_name in sorted({str(row["supplier"]) for row in CATALOG_ROWS}):
            payload = {
                "biz_contact.name": supplier_name,
                "biz_contact.legal_name": supplier_name,
                "biz_contact.contact_type": "supplier",
                "biz_contact.currency_preference": "USD",
                "biz_contact.company_entity_scope": ["EcoTech FZCO"],
                "biz_contact.notes": "Seeded supplier from NLight catalogue. Hidden from Sales by access profile scope.",
                "biz_contact.is_active": True,
            }
            supplier_id, _ = upsert(
                base_url,
                SUPPLIER_ENTITY,
                contacts_by_name.get(supplier_name.lower()),
                payload,
                token=token,
                workspace_id=workspace_id,
                dry_run=args.dry_run,
                label=f"supplier {supplier_name}",
            )
            supplier_ids[supplier_name] = supplier_id

    existing_products = list_records(base_url, PRODUCT_ENTITY, token=token, workspace_id=workspace_id)
    products_by_code = {
        str(record_payload(row).get("biz_product.code") or "").strip(): row
        for row in existing_products
        if str(record_payload(row).get("biz_product.code") or "").strip()
    }
    product_ids: dict[str, str] = {}
    for row in CATALOG_ROWS:
        supplier_id = supplier_ids.get(str(row["supplier"]))
        product_payload = build_catalog_product(row, supplier_id)
        code = str(product_payload["biz_product.code"])
        product_id, _ = upsert(
            base_url,
            PRODUCT_ENTITY,
            products_by_code.get(code),
            product_payload,
            token=token,
            workspace_id=workspace_id,
            dry_run=args.dry_run,
            label=f"product {code}",
        )
        product_ids[code] = product_id

    for row in SERVICE_ROWS:
        product_payload = build_service_product(row)
        code = str(product_payload["biz_product.code"])
        product_id, _ = upsert(
            base_url,
            PRODUCT_ENTITY,
            products_by_code.get(code),
            product_payload,
            token=token,
            workspace_id=workspace_id,
            dry_run=args.dry_run,
            label=f"product {code}",
        )
        product_ids[code] = product_id

    if args.skip_supplier_sources:
        return

    existing_sources = list_records(base_url, PRODUCT_SUPPLIER_ENTITY, token=token, workspace_id=workspace_id, cap=10000)
    sources_by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for row in existing_sources:
        record = record_payload(row)
        product_id = str(record.get("biz_product_supplier.product_id") or "")
        supplier_id = str(record.get("biz_product_supplier.supplier_id") or "")
        if product_id and supplier_id:
            sources_by_key[(product_id, supplier_id)] = row

    for row in CATALOG_ROWS:
        supplier_id = supplier_ids.get(str(row["supplier"]))
        code = f"NL-CAT-{int(row['row']):03d}-{slug(str(row['model']))}"
        product_id = product_ids.get(code)
        if not supplier_id or not product_id:
            continue
        source_payload = {
            "biz_product_supplier.product_id": product_id,
            "biz_product_supplier.product_name_snapshot": build_catalog_product(row, supplier_id).get("biz_product.name"),
            "biz_product_supplier.product_code_snapshot": code,
            "biz_product_supplier.supplier_id": supplier_id,
            "biz_product_supplier.supplier_name_snapshot": row["supplier"],
            "biz_product_supplier.supplier_sku": row["model"],
            "biz_product_supplier.purchase_description": build_catalog_product(row, supplier_id).get("biz_product.description"),
            "biz_product_supplier.uom_snapshot": "EA",
            "biz_product_supplier.purchase_currency": "USD",
            "biz_product_supplier.unit_cost": round_money(row.get("eco_usd")),
            "biz_product_supplier.minimum_order_quantity": 1,
            "biz_product_supplier.lead_time_weeks": 14 if int(row["row"]) <= 26 else 0,
            "biz_product_supplier.is_primary": True,
            "biz_product_supplier.is_active": True,
            "biz_product_supplier.notes": "Seeded from NLight catalogue column M supplier purchase cost.",
        }
        upsert(
            base_url,
            PRODUCT_SUPPLIER_ENTITY,
            sources_by_key.get((product_id, supplier_id)),
            source_payload,
            token=token,
            workspace_id=workspace_id,
            dry_run=args.dry_run,
            label=f"supplier source {code}",
        )


if __name__ == "__main__":
    main()
