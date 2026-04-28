#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any
from urllib import error as urlerror
from urllib import request as urlrequest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "_shared"))

from automation_tooling import upsert_automation_by_name


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


def get_connections(base_url: str, *, token: str, workspace_id: str) -> list[dict[str, Any]]:
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
    connections = get_connections(base_url, token=token, workspace_id=workspace_id)
    if connection_id:
        for connection in connections:
            if str(connection.get("id") or "") == connection_id:
                return connection
        raise RuntimeError(f"Connection not found: {connection_id}")
    if connection_name:
        matches = [row for row in connections if str(row.get("name") or "").strip() == connection_name.strip()]
        if not matches:
            raise RuntimeError(f"Connection not found by name: {connection_name}")
        if len(matches) > 1:
            raise RuntimeError(f"Multiple connections matched name: {connection_name}")
        return matches[0]
    raise RuntimeError("Either --connection-id or --connection-name is required")


def update_connection_config(
    base_url: str,
    connection: dict[str, Any],
    config: dict[str, Any],
    *,
    token: str,
    workspace_id: str,
) -> dict[str, Any]:
    connection_id = str(connection.get("id") or "").strip()
    if not connection_id:
        raise RuntimeError("Connection missing id")
    status, payload = api_call(
        "PATCH",
        f"{base_url}/integrations/connections/{connection_id}",
        token=token,
        workspace_id=workspace_id,
        body={"config": config},
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"update connection config failed: {collect_error_text(payload)}")
    item = payload.get("connection")
    if not isinstance(item, dict):
        raise RuntimeError("update connection config failed: missing connection payload")
    return item


def list_mappings(base_url: str, *, token: str, workspace_id: str, connection_id: str) -> list[dict[str, Any]]:
    status, payload = api_call(
        "GET",
        f"{base_url}/integrations/mappings?connection_id={connection_id}",
        token=token,
        workspace_id=workspace_id,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"list mappings failed: {collect_error_text(payload)}")
    rows = payload.get("mappings")
    return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []


def create_mapping(
    base_url: str,
    definition: dict[str, Any],
    *,
    token: str,
    workspace_id: str,
) -> dict[str, Any]:
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


def merge_request_templates(existing: list[dict[str, Any]], desired: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for template in existing:
        template_id = str(template.get("id") or "").strip()
        if not template_id:
            continue
        by_id[template_id] = dict(template)
        order.append(template_id)
    for template in desired:
        template_id = str(template.get("id") or "").strip()
        if not template_id:
            continue
        if template_id not in by_id:
            order.append(template_id)
        by_id[template_id] = dict(template)
    return [by_id[template_id] for template_id in order]


def exists(var_name: str) -> dict[str, Any]:
    return {"op": "exists", "left": {"var": var_name}}


def not_exists(var_name: str) -> dict[str, Any]:
    return {"op": "not_exists", "left": {"var": var_name}}


def eq_var(var_name: str, value: Any) -> dict[str, Any]:
    return {"op": "eq", "left": {"var": var_name}, "right": {"literal": value}}


def gt_var(var_name: str, value: Any) -> dict[str, Any]:
    return {"op": "gt", "left": {"var": var_name}, "right": {"literal": value}}


def in_var(var_name: str, values: list[Any]) -> dict[str, Any]:
    return {
        "op": "in",
        "left": {"var": var_name},
        "right": {"array": [{"literal": value} for value in values]},
    }


def and_(*conditions: dict[str, Any]) -> dict[str, Any]:
    return {"op": "and", "children": list(conditions)}


def not_(condition: dict[str, Any]) -> dict[str, Any]:
    return {"op": "not", "children": [condition]}


def any_exists(over_var: str, item_var: str) -> dict[str, Any]:
    return {
        "op": "any",
        "over": {"var": over_var},
        "where": {"op": "exists", "left": {"var": f"item.{item_var}"}},
    }


def any_eq(over_var: str, item_var: str, value: Any) -> dict[str, Any]:
    return {
        "op": "any",
        "over": {"var": over_var},
        "where": {"op": "eq", "left": {"var": f"item.{item_var}"}, "right": {"literal": value}},
    }


def any_gt(over_var: str, item_var: str, value: Any) -> dict[str, Any]:
    return {
        "op": "any",
        "over": {"var": over_var},
        "where": {"op": "gt", "left": {"var": f"item.{item_var}"}, "right": {"literal": value}},
    }


def update_record_step(
    step_id: str,
    *,
    entity_id: str,
    record_id: str,
    patch: dict[str, Any],
    store_as: str | None = None,
) -> dict[str, Any]:
    step = {
        "id": step_id,
        "kind": "action",
        "action_id": "system.update_record",
        "inputs": {
            "entity_id": entity_id,
            "record_id": record_id,
            "patch": patch,
        },
    }
    if store_as:
        step["store_as"] = store_as
    return step


def build_request_templates() -> list[dict[str, Any]]:
    return [
        {
            "id": "xero_list_connections",
            "name": "Xero: List connections",
            "method": "GET",
            "url": "https://api.xero.com/connections",
            "headers": {"Accept": "application/json"},
            "query": {},
        },
        {
            "id": "xero_get_organisation",
            "name": "Xero: Get organisation",
            "method": "GET",
            "path": "/Organisation",
            "headers": {"Accept": "application/json"},
            "query": {},
        },
        {
            "id": "xero_contacts_list",
            "name": "Xero: List contacts",
            "method": "GET",
            "path": "/Contacts",
            "headers": {"Accept": "application/json"},
            "query": {},
        },
        {
            "id": "xero_contacts_search",
            "name": "Xero: Search contacts",
            "method": "GET",
            "path": "/Contacts",
            "headers": {"Accept": "application/json"},
            "query": {},
        },
        {
            "id": "xero_contacts_create",
            "name": "Xero: Create contacts",
            "method": "PUT",
            "path": "/Contacts",
            "headers": {
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            "query": {},
        },
        {
            "id": "xero_invoices_get",
            "name": "Xero: Get invoices",
            "method": "GET",
            "path": "/Invoices",
            "headers": {"Accept": "application/json"},
            "query": {},
        },
        {
            "id": "xero_invoices_create",
            "name": "Xero: Create invoices",
            "method": "PUT",
            "path": "/Invoices",
            "headers": {
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            "query": {},
        },
    ]


def build_invoice_refresh_mapping(connection_id: str) -> dict[str, Any]:
    return {
        "connection_id": connection_id,
        "name": "Xero Phase 1 - Invoice Refresh Mapping",
        "source_entity": "xero.invoices",
        "target_entity": "entity.biz_invoice",
        "mapping_json": {
            "resource_key": "Invoices",
            "usage_scope": "automation",
            "record_mode": "upsert",
            "match_on": ["biz_invoice.xero_invoice_id"],
            "skip_if_no_match": True,
            "field_mappings": [
                {"to": "biz_invoice.xero_invoice_id", "path": "InvoiceID", "skip_if_missing": True},
                {"to": "biz_invoice.amount_paid", "path": "AmountPaid", "default": 0},
                {"to": "biz_invoice.balance_due", "path": "AmountDue", "default": 0},
            ],
        },
    }


def build_contact_create_body_template() -> str:
    return """{
  "Contacts": [
    {
      "Name": "{{ steps.load_contact_after_email.first.record['biz_contact.name'] | default('') | replace('\"', \"'\") }}",
      "EmailAddress": "{{ steps.load_contact_after_email.first.record['biz_contact.email'] | default('') | replace('\"', \"'\") }}",
      "TaxNumber": "{{ steps.load_contact_after_email.first.record['biz_contact.tax_number'] | default('') | replace('\"', \"'\") }}",
      "CompanyNumber": "{{ steps.load_contact_after_email.first.record['biz_contact.company_number'] | default('') | replace('\"', \"'\") }}"
    }
  ]
}"""


def build_invoice_create_body_template(sales_account_code: str, default_tax_type: str) -> str:
    template = """{
  "Invoices": [
    {
      "Type": "ACCREC",
      "Status": "DRAFT",
      "LineAmountTypes": "Exclusive",
      "Contact": {
        "ContactID": "{{ steps.load_contact_final.first.record['biz_contact.xero_contact_id'] }}"
      },
      "InvoiceNumber": "{{ trigger.record.fields.invoice_number | default('') | replace('\"', \"'\") }}",
      "Reference": "{{ trigger.record.fields.customer_reference | default('') | replace('\"', \"'\") }}",
      "Date": "{{ trigger.record.fields.invoice_date }}",
      "DueDate": "{{ trigger.record.fields.due_date }}",
      "CurrencyCode": "{{ trigger.record.fields.currency | default('EUR') }}",
      "LineItems": [
{% for row in steps.load_lines.records %}
        {
          "Description": "{{ row.record['biz_invoice_line.description'] | default('') | replace('\"', \"'\") }}",
          "Quantity": {{ row.record['biz_invoice_line.quantity'] | default(0) | float }},
          "UnitAmount": {{ row.record['biz_invoice_line.unit_price'] | default(0) | float }},
          "AccountCode": "__SALES_ACCOUNT_CODE__",
          "TaxType": "__DEFAULT_TAX_TYPE__"
        }{% if not loop.last %},{% endif %}
{% else %}
        {
          "Description": "Invoice {{ trigger.record.fields.invoice_number | default('') | replace('\"', \"'\") }}",
          "Quantity": 1,
          "UnitAmount": {{ trigger.record.fields.invoice_total | default(trigger.record.fields.invoice_manual_total) | default(0) | float }},
          "AccountCode": "__SALES_ACCOUNT_CODE__",
          "TaxType": "__DEFAULT_TAX_TYPE__"
        }
{% endfor %}
      ]
    }
  ]
}"""
    return template.replace("__SALES_ACCOUNT_CODE__", sales_account_code).replace("__DEFAULT_TAX_TYPE__", default_tax_type)


def parse_invoice_types(raw: str | None) -> list[str]:
    values = [part.strip() for part in str(raw or "").split(",") if part.strip()]
    seen: set[str] = set()
    ordered: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        ordered.append(value)
    return ordered or ["deposit", "progress", "final"]


def build_export_automation(
    *,
    sales_entity: str,
    invoice_types: list[str],
    sales_account_code: str,
    default_tax_type: str,
    connection_id: str,
    status: str,
) -> dict[str, Any]:
    timestamp_ref = "{{ trigger.timestamp }}"
    contact_create_body = build_contact_create_body_template()
    invoice_create_body = build_invoice_create_body_template(sales_account_code, default_tax_type)
    return {
        "name": "Xero Phase 1 - Export Issued Invoices",
        "description": "On invoice issue, resolve or create the Xero contact, then create a draft ACCREC invoice in Xero for the configured commercial invoice types.",
        "status": status,
        "trigger": {
            "kind": "event",
            "event_types": ["action.clicked"],
            "filters": [
                {"path": "entity_id", "op": "eq", "value": "entity.biz_invoice"},
                {"path": "action_id", "op": "eq", "value": "action.invoice_issue"},
            ],
            "expr": and_(
                in_var("trigger.record.fields.invoice_type", invoice_types),
                eq_var("trigger.record.fields.sales_entity", sales_entity),
                not_exists("trigger.record.fields.xero_invoice_id"),
            ),
        },
        "steps": [
            {
                "id": "load_contact",
                "kind": "action",
                "action_id": "system.query_records",
                "store_as": "load_contact",
                "inputs": {
                    "entity_id": "entity.biz_contact",
                    "limit": 1,
                    "filter_expr": {
                        "op": "eq",
                        "field": "biz_contact.id",
                        "value": "{{ trigger.record.fields.customer_id }}",
                    },
                },
            },
            {
                "id": "contact_found",
                "kind": "condition",
                "expr": exists("steps.load_contact.first.record.biz_contact.id"),
                "stop_on_false": True,
                "else_steps": [
                    update_record_step(
                        "mark_invoice_missing_contact",
                        entity_id="entity.biz_invoice",
                        record_id="{{ trigger.record_id }}",
                        patch={
                            "biz_invoice.xero_last_sync_status": "needs_review",
                            "biz_invoice.xero_last_sync_at": timestamp_ref,
                            "biz_invoice.xero_last_sync_error": "Invoice customer record could not be loaded for Xero export.",
                        },
                    )
                ],
            },
            {
                "id": "link_by_tax",
                "kind": "condition",
                "expr": and_(
                    not_exists("steps.load_contact.first.record.biz_contact.xero_contact_id"),
                    exists("steps.load_contact.first.record.biz_contact.tax_number"),
                ),
                "then_steps": [
                    {
                        "id": "search_contact_by_tax",
                        "kind": "action",
                        "action_id": "system.integration_request",
                        "store_as": "search_contact_by_tax",
                        "inputs": {
                            "connection_id": connection_id,
                            "template_id": "xero_contacts_search",
                            "query": {
                                "where": "TaxNumber==\"{{ steps.load_contact.first.record['biz_contact.tax_number'] | replace('\"', \"'\") }}\""
                            },
                        },
                    },
                    {
                        "id": "tax_match_found",
                        "kind": "condition",
                        "expr": any_exists("steps.search_contact_by_tax.body_json.Contacts", "ContactID"),
                        "then_steps": [
                            update_record_step(
                                "save_tax_match",
                                entity_id="entity.biz_contact",
                                record_id="{{ steps.load_contact.first.record_id }}",
                                patch={
                                    "biz_contact.xero_contact_id": "{{ steps.search_contact_by_tax.body_json.Contacts[0].ContactID }}",
                                    "biz_contact.xero_last_sync_status": "matched_tax",
                                    "biz_contact.xero_last_sync_at": timestamp_ref,
                                    "biz_contact.xero_last_sync_error": "",
                                },
                            )
                        ],
                    },
                ],
            },
            {
                "id": "load_contact_after_tax",
                "kind": "action",
                "action_id": "system.query_records",
                "store_as": "load_contact_after_tax",
                "inputs": {
                    "entity_id": "entity.biz_contact",
                    "limit": 1,
                    "filter_expr": {
                        "op": "eq",
                        "field": "biz_contact.id",
                        "value": "{{ trigger.record.fields.customer_id }}",
                    },
                },
            },
            {
                "id": "link_by_company",
                "kind": "condition",
                "expr": and_(
                    not_exists("steps.load_contact_after_tax.first.record.biz_contact.xero_contact_id"),
                    exists("steps.load_contact_after_tax.first.record.biz_contact.company_number"),
                ),
                "then_steps": [
                    {
                        "id": "search_contact_by_company",
                        "kind": "action",
                        "action_id": "system.integration_request",
                        "store_as": "search_contact_by_company",
                        "inputs": {
                            "connection_id": connection_id,
                            "template_id": "xero_contacts_search",
                            "query": {
                                "where": "CompanyNumber==\"{{ steps.load_contact_after_tax.first.record['biz_contact.company_number'] | replace('\"', \"'\") }}\""
                            },
                        },
                    },
                    {
                        "id": "company_match_found",
                        "kind": "condition",
                        "expr": any_exists("steps.search_contact_by_company.body_json.Contacts", "ContactID"),
                        "then_steps": [
                            update_record_step(
                                "save_company_match",
                                entity_id="entity.biz_contact",
                                record_id="{{ steps.load_contact_after_tax.first.record_id }}",
                                patch={
                                    "biz_contact.xero_contact_id": "{{ steps.search_contact_by_company.body_json.Contacts[0].ContactID }}",
                                    "biz_contact.xero_last_sync_status": "matched_company",
                                    "biz_contact.xero_last_sync_at": timestamp_ref,
                                    "biz_contact.xero_last_sync_error": "",
                                },
                            )
                        ],
                    },
                ],
            },
            {
                "id": "load_contact_after_company",
                "kind": "action",
                "action_id": "system.query_records",
                "store_as": "load_contact_after_company",
                "inputs": {
                    "entity_id": "entity.biz_contact",
                    "limit": 1,
                    "filter_expr": {
                        "op": "eq",
                        "field": "biz_contact.id",
                        "value": "{{ trigger.record.fields.customer_id }}",
                    },
                },
            },
            {
                "id": "link_by_email_name",
                "kind": "condition",
                "expr": and_(
                    not_exists("steps.load_contact_after_company.first.record.biz_contact.xero_contact_id"),
                    exists("steps.load_contact_after_company.first.record.biz_contact.email"),
                    exists("steps.load_contact_after_company.first.record.biz_contact.name"),
                ),
                "then_steps": [
                    {
                        "id": "search_contact_by_email_name",
                        "kind": "action",
                        "action_id": "system.integration_request",
                        "store_as": "search_contact_by_email_name",
                        "inputs": {
                            "connection_id": connection_id,
                            "template_id": "xero_contacts_search",
                            "query": {
                                "where": "Name==\"{{ steps.load_contact_after_company.first.record['biz_contact.name'] | replace('\"', \"'\") }}\" AND EmailAddress==\"{{ steps.load_contact_after_company.first.record['biz_contact.email'] | replace('\"', \"'\") }}\""
                            },
                        },
                    },
                    {
                        "id": "email_name_match_found",
                        "kind": "condition",
                        "expr": any_exists("steps.search_contact_by_email_name.body_json.Contacts", "ContactID"),
                        "then_steps": [
                            update_record_step(
                                "save_email_name_match",
                                entity_id="entity.biz_contact",
                                record_id="{{ steps.load_contact_after_company.first.record_id }}",
                                patch={
                                    "biz_contact.xero_contact_id": "{{ steps.search_contact_by_email_name.body_json.Contacts[0].ContactID }}",
                                    "biz_contact.xero_last_sync_status": "matched_email_name",
                                    "biz_contact.xero_last_sync_at": timestamp_ref,
                                    "biz_contact.xero_last_sync_error": "",
                                },
                            )
                        ],
                    },
                ],
            },
            {
                "id": "load_contact_after_email",
                "kind": "action",
                "action_id": "system.query_records",
                "store_as": "load_contact_after_email",
                "inputs": {
                    "entity_id": "entity.biz_contact",
                    "limit": 1,
                    "filter_expr": {
                        "op": "eq",
                        "field": "biz_contact.id",
                        "value": "{{ trigger.record.fields.customer_id }}",
                    },
                },
            },
            {
                "id": "create_xero_contact_if_needed",
                "kind": "condition",
                "expr": and_(
                    not_exists("steps.load_contact_after_email.first.record.biz_contact.xero_contact_id"),
                    exists("steps.load_contact_after_email.first.record.biz_contact.name"),
                ),
                "then_steps": [
                    {
                        "id": "create_xero_contact",
                        "kind": "action",
                        "action_id": "system.integration_request",
                        "store_as": "create_xero_contact",
                        "inputs": {
                            "connection_id": connection_id,
                            "template_id": "xero_contacts_create",
                            "body": contact_create_body,
                        },
                    },
                    {
                        "id": "created_contact_found",
                        "kind": "condition",
                        "expr": any_exists("steps.create_xero_contact.body_json.Contacts", "ContactID"),
                        "then_steps": [
                            update_record_step(
                                "save_created_contact",
                                entity_id="entity.biz_contact",
                                record_id="{{ steps.load_contact_after_email.first.record_id }}",
                                patch={
                                    "biz_contact.xero_contact_id": "{{ steps.create_xero_contact.body_json.Contacts[0].ContactID }}",
                                    "biz_contact.xero_last_sync_status": "created",
                                    "biz_contact.xero_last_sync_at": timestamp_ref,
                                    "biz_contact.xero_last_sync_error": "",
                                },
                            )
                        ],
                        "else_steps": [
                            update_record_step(
                                "mark_contact_create_failed",
                                entity_id="entity.biz_contact",
                                record_id="{{ steps.load_contact_after_email.first.record_id }}",
                                patch={
                                    "biz_contact.xero_last_sync_status": "error",
                                    "biz_contact.xero_last_sync_at": timestamp_ref,
                                    "biz_contact.xero_last_sync_error": "Xero contact create returned no ContactID.",
                                },
                            )
                        ],
                    },
                ],
            },
            {
                "id": "load_contact_final",
                "kind": "action",
                "action_id": "system.query_records",
                "store_as": "load_contact_final",
                "inputs": {
                    "entity_id": "entity.biz_contact",
                    "limit": 1,
                    "filter_expr": {
                        "op": "eq",
                        "field": "biz_contact.id",
                        "value": "{{ trigger.record.fields.customer_id }}",
                    },
                },
            },
            {
                "id": "contact_linked",
                "kind": "condition",
                "expr": exists("steps.load_contact_final.first.record.biz_contact.xero_contact_id"),
                "stop_on_false": True,
                "else_steps": [
                    update_record_step(
                        "mark_invoice_contact_review",
                        entity_id="entity.biz_invoice",
                        record_id="{{ trigger.record_id }}",
                        patch={
                            "biz_invoice.xero_last_sync_status": "needs_review",
                            "biz_invoice.xero_last_sync_at": timestamp_ref,
                            "biz_invoice.xero_last_sync_error": "No Xero contact could be linked or created for this customer.",
                        },
                    )
                ],
            },
            {
                "id": "search_existing_invoice",
                "kind": "action",
                "action_id": "system.integration_request",
                "store_as": "search_existing_invoice",
                "inputs": {
                    "connection_id": connection_id,
                    "template_id": "xero_invoices_get",
                    "query": {
                        "InvoiceNumbers": "{{ trigger.record.fields.invoice_number }}"
                    },
                },
            },
            {
                "id": "existing_invoice_found",
                "kind": "condition",
                "expr": any_exists("steps.search_existing_invoice.body_json.Invoices", "InvoiceID"),
                "then_steps": [
                    update_record_step(
                        "save_existing_invoice",
                        entity_id="entity.biz_invoice",
                        record_id="{{ trigger.record_id }}",
                        patch={
                            "biz_invoice.xero_invoice_id": "{{ steps.search_existing_invoice.body_json.Invoices[0].InvoiceID }}",
                            "biz_invoice.xero_last_sync_status": "linked_existing",
                            "biz_invoice.xero_last_sync_at": timestamp_ref,
                            "biz_invoice.xero_last_sync_error": "",
                        },
                    )
                ],
                "else_steps": [
                    {
                        "id": "load_lines",
                        "kind": "action",
                        "action_id": "system.query_records",
                        "store_as": "load_lines",
                        "inputs": {
                            "entity_id": "entity.biz_invoice_line",
                            "limit": 200,
                            "filter_expr": {
                                "op": "eq",
                                "field": "biz_invoice_line.invoice_id",
                                "value": "{{ trigger.record_id }}",
                            },
                        },
                    },
                    {
                        "id": "create_xero_invoice",
                        "kind": "action",
                        "action_id": "system.integration_request",
                        "store_as": "create_xero_invoice",
                        "inputs": {
                            "connection_id": connection_id,
                            "template_id": "xero_invoices_create",
                            "body": invoice_create_body,
                        },
                    },
                    {
                        "id": "created_invoice_found",
                        "kind": "condition",
                        "expr": any_exists("steps.create_xero_invoice.body_json.Invoices", "InvoiceID"),
                        "then_steps": [
                            update_record_step(
                                "save_created_invoice",
                                entity_id="entity.biz_invoice",
                                record_id="{{ trigger.record_id }}",
                                patch={
                                    "biz_invoice.xero_invoice_id": "{{ steps.create_xero_invoice.body_json.Invoices[0].InvoiceID }}",
                                    "biz_invoice.xero_last_sync_status": "draft_exported",
                                    "biz_invoice.xero_last_sync_at": timestamp_ref,
                                    "biz_invoice.xero_last_sync_error": "",
                                },
                            )
                        ],
                        "else_steps": [
                            update_record_step(
                                "mark_invoice_create_failed",
                                entity_id="entity.biz_invoice",
                                record_id="{{ trigger.record_id }}",
                                patch={
                                    "biz_invoice.xero_last_sync_status": "error",
                                    "biz_invoice.xero_last_sync_at": timestamp_ref,
                                    "biz_invoice.xero_last_sync_error": "Xero invoice create returned no InvoiceID.",
                                },
                            )
                        ],
                    },
                ],
            },
        ],
    }


def build_refresh_automation(
    *,
    sales_entity: str,
    invoice_types: list[str],
    connection_id: str,
    refresh_interval_minutes: int,
    mapping_id: str,
    status: str,
) -> dict[str, Any]:
    timestamp_ref = "{{ trigger.scheduled_at }}"
    return {
        "name": "Xero Phase 1 - Refresh Invoice Payments",
        "description": "Scheduled pull from Xero to refresh invoice amounts and payment status for linked commercial invoices in the configured scope.",
        "status": status,
        "trigger": {
            "kind": "schedule",
            "every_minutes": refresh_interval_minutes,
        },
        "steps": [
            {
                "id": "load_linked_invoices",
                "kind": "action",
                "action_id": "system.query_records",
                "store_as": "load_linked_invoices",
                "inputs": {
                    "entity_id": "entity.biz_invoice",
                    "limit": 200,
                    "filter_expr": {
                        "op": "and",
                        "children": [
                            {"op": "eq", "field": "biz_invoice.sales_entity", "value": sales_entity},
                            {"op": "exists", "field": "biz_invoice.xero_invoice_id"},
                            {"op": "in", "field": "biz_invoice.invoice_type", "value": invoice_types},
                        ],
                    },
                },
            },
            {
                "id": "refresh_each_invoice",
                "kind": "foreach",
                "over": "{{ steps.load_linked_invoices.records }}",
                "item_name": "invoice_row",
                "steps": [
                    {
                        "id": "fetch_xero_invoice",
                        "kind": "action",
                        "action_id": "system.integration_request",
                        "store_as": "fetch_xero_invoice",
                        "inputs": {
                            "connection_id": connection_id,
                            "template_id": "xero_invoices_get",
                            "query": {
                                "IDs": "{{ invoice_row.record['biz_invoice.xero_invoice_id'] }}"
                            },
                        },
                    },
                    {
                        "id": "xero_invoice_found",
                        "kind": "condition",
                        "expr": any_exists("steps.fetch_xero_invoice.body_json.Invoices", "InvoiceID"),
                        "then_steps": [
                            {
                                "id": "apply_invoice_mapping",
                                "kind": "action",
                                "action_id": "system.apply_integration_mapping",
                                "store_as": "apply_invoice_mapping",
                                "inputs": {
                                    "mapping_id": mapping_id,
                                    "connection_id": connection_id,
                                    "source_record": "{{ steps.fetch_xero_invoice.body_json }}",
                                    "source_path": "Invoices.0",
                                },
                            },
                            update_record_step(
                                "mark_invoice_refreshed",
                                entity_id="entity.biz_invoice",
                                record_id="{{ invoice_row.record_id }}",
                                patch={
                                    "biz_invoice.xero_last_sync_status": "synced",
                                    "biz_invoice.xero_last_sync_at": timestamp_ref,
                                    "biz_invoice.xero_last_sync_error": "",
                                },
                            ),
                            {
                                "id": "mark_cancelled_if_voided",
                                "kind": "condition",
                                "expr": {
                                    "op": "any",
                                    "over": {"var": "steps.fetch_xero_invoice.body_json.Invoices"},
                                    "where": {
                                        "op": "in",
                                        "left": {"var": "item.Status"},
                                        "right": {"array": [{"literal": "VOIDED"}, {"literal": "DELETED"}]},
                                    },
                                },
                                "then_steps": [
                                    update_record_step(
                                        "save_status_cancelled",
                                        entity_id="entity.biz_invoice",
                                        record_id="{{ invoice_row.record_id }}",
                                        patch={"biz_invoice.status": "cancelled"},
                                    )
                                ],
                                "else_steps": [
                                    {
                                        "id": "mark_paid_if_paid",
                                        "kind": "condition",
                                        "expr": any_eq("steps.fetch_xero_invoice.body_json.Invoices", "Status", "PAID"),
                                        "then_steps": [
                                            update_record_step(
                                                "save_status_paid",
                                                entity_id="entity.biz_invoice",
                                                record_id="{{ invoice_row.record_id }}",
                                                patch={"biz_invoice.status": "paid"},
                                            )
                                        ],
                                        "else_steps": [
                                            {
                                                "id": "mark_part_paid_if_partial",
                                                "kind": "condition",
                                                "expr": and_(
                                                    any_gt("steps.fetch_xero_invoice.body_json.Invoices", "AmountPaid", 0),
                                                    any_gt("steps.fetch_xero_invoice.body_json.Invoices", "AmountDue", 0),
                                                ),
                                                "then_steps": [
                                                    update_record_step(
                                                        "save_status_part_paid",
                                                        entity_id="entity.biz_invoice",
                                                        record_id="{{ invoice_row.record_id }}",
                                                        patch={"biz_invoice.status": "part_paid"},
                                                    )
                                                ],
                                                "else_steps": [
                                                    {
                                                        "id": "mark_issued_if_outstanding",
                                                        "kind": "condition",
                                                        "expr": and_(
                                                            any_gt("steps.fetch_xero_invoice.body_json.Invoices", "AmountDue", 0),
                                                            not_(any_gt("steps.fetch_xero_invoice.body_json.Invoices", "AmountPaid", 0)),
                                                        ),
                                                        "then_steps": [
                                                            update_record_step(
                                                                "save_status_issued",
                                                                entity_id="entity.biz_invoice",
                                                                record_id="{{ invoice_row.record_id }}",
                                                                patch={"biz_invoice.status": "issued"},
                                                            )
                                                        ],
                                                    }
                                                ],
                                            }
                                        ],
                                    }
                                ],
                            },
                        ],
                        "else_steps": [
                            update_record_step(
                                "mark_invoice_not_found",
                                entity_id="entity.biz_invoice",
                                record_id="{{ invoice_row.record_id }}",
                                patch={
                                    "biz_invoice.xero_last_sync_status": "error",
                                    "biz_invoice.xero_last_sync_at": timestamp_ref,
                                    "biz_invoice.xero_last_sync_error": "Linked Xero invoice was not returned by the refresh request.",
                                },
                            )
                        ],
                    },
                ],
            },
        ],
    }


def upsert_mapping_by_name(
    base_url: str,
    definition: dict[str, Any],
    *,
    token: str,
    workspace_id: str,
    connection_id: str,
    dry_run: bool,
) -> dict[str, Any]:
    existing = next(
        (
            row
            for row in list_mappings(base_url, token=token, workspace_id=workspace_id, connection_id=connection_id)
            if str(row.get("name") or "").strip() == definition["name"]
        ),
        None,
    )
    if dry_run:
        action = "update" if existing else "create"
        print(f"[mapping] {action:6} {definition['name']}")
        return existing or {"id": "dry-run-mapping", **definition}
    if existing and isinstance(existing.get("id"), str) and existing["id"]:
        saved = update_mapping(base_url, existing["id"], definition, token=token, workspace_id=workspace_id)
        print(f"[mapping] updated {definition['name']} -> {saved.get('id')}")
        return saved
    saved = create_mapping(base_url, definition, token=token, workspace_id=workspace_id)
    print(f"[mapping] created {definition['name']} -> {saved.get('id')}")
    return saved


def main() -> None:
    parser = argparse.ArgumentParser(description="Create or update workspace-scoped Xero phase-1 setup for Commercial V2.")
    parser.add_argument("--base-url", default=os.getenv("OCTO_BASE_URL", "").strip(), help="Octodrop API base URL")
    parser.add_argument("--token", default=os.getenv("OCTO_API_TOKEN", "").strip(), help="Bearer token")
    parser.add_argument("--workspace-id", default=os.getenv("OCTO_WORKSPACE_ID", "").strip(), help="Workspace ID")
    parser.add_argument("--connection-id", default=os.getenv("OCTO_XERO_CONNECTION_ID", "").strip(), help="Xero connection ID")
    parser.add_argument("--connection-name", default=os.getenv("OCTO_XERO_CONNECTION_NAME", "").strip(), help="Xero connection name")
    parser.add_argument("--sales-entity", default=os.getenv("OCTO_XERO_SALES_ENTITY", "").strip(), help="Sales entity value to scope phase-1 automations")
    parser.add_argument("--invoice-types", default=os.getenv("OCTO_XERO_INVOICE_TYPES", "deposit,progress,final").strip(), help="Comma-separated invoice types to export and refresh")
    parser.add_argument("--sales-account-code", default=os.getenv("OCTO_XERO_SALES_ACCOUNT_CODE", "200").strip(), help="Xero revenue account code for invoice line exports")
    parser.add_argument("--default-tax-type", default=os.getenv("OCTO_XERO_DEFAULT_TAX_TYPE", "OUTPUT").strip(), help="Xero tax type for exported invoice lines")
    parser.add_argument("--refresh-interval-minutes", type=int, default=int(os.getenv("OCTO_XERO_REFRESH_INTERVAL_MINUTES", "60")), help="Schedule interval for payment refresh automation")
    parser.add_argument("--publish", action="store_true", help="Publish the created/updated automations")
    parser.add_argument("--dry-run", action="store_true", help="Print planned changes without writing")
    args = parser.parse_args()

    base_url = (args.base_url or "").rstrip("/")
    token = (args.token or "").strip()
    workspace_id = (args.workspace_id or "").strip()
    sales_entity = (args.sales_entity or "").strip()
    invoice_types = parse_invoice_types(args.invoice_types)
    sales_account_code = (args.sales_account_code or "").strip()
    default_tax_type = (args.default_tax_type or "").strip()

    if not base_url:
        raise SystemExit("Missing --base-url or OCTO_BASE_URL")
    if not token:
        raise SystemExit("Missing --token or OCTO_API_TOKEN")
    if not workspace_id:
        raise SystemExit("Missing --workspace-id or OCTO_WORKSPACE_ID")
    if not sales_entity:
        raise SystemExit("Missing --sales-entity or OCTO_XERO_SALES_ENTITY")
    if not invoice_types:
        raise SystemExit("Missing --invoice-types or OCTO_XERO_INVOICE_TYPES")
    if not sales_account_code:
        raise SystemExit("Missing --sales-account-code or OCTO_XERO_SALES_ACCOUNT_CODE")
    if not default_tax_type:
        raise SystemExit("Missing --default-tax-type or OCTO_XERO_DEFAULT_TAX_TYPE")
    if args.refresh_interval_minutes <= 0:
        raise SystemExit("--refresh-interval-minutes must be > 0")

    connection = resolve_connection(
        base_url,
        token=token,
        workspace_id=workspace_id,
        connection_id=(args.connection_id or "").strip() or None,
        connection_name=(args.connection_name or "").strip() or None,
    )
    connection_id = str(connection.get("id") or "").strip()
    if not connection_id:
        raise SystemExit("Resolved connection missing id")
    provider_key = str(((connection.get("config") or {}).get("provider_key")) or "").strip().lower()
    connection_type = str(connection.get("type") or "").strip().lower()
    if provider_key != "xero" and connection_type != "integration.xero":
        raise SystemExit(f"Connection '{connection.get('name')}' is not a Xero integration")

    existing_config = connection.get("config") if isinstance(connection.get("config"), dict) else {}
    desired_templates = build_request_templates()
    merged_templates = merge_request_templates(
        existing_config.get("request_templates") if isinstance(existing_config.get("request_templates"), list) else [],
        desired_templates,
    )
    next_config = {
        **existing_config,
        "request_templates": merged_templates,
        "xero_phase1": {
            "sales_entity": sales_entity,
            "sales_account_code": sales_account_code,
            "default_tax_type": default_tax_type,
            "invoice_status": "DRAFT",
            "refresh_interval_minutes": args.refresh_interval_minutes,
            "matching_rules": [
                "Use stored biz_contact.xero_contact_id when present.",
                "Else exact TaxNumber match in Xero.",
                "Else exact CompanyNumber match in Xero.",
                "Else exact Name + EmailAddress match in Xero.",
                "Else create the contact in Xero at first invoice export.",
            ],
            "scope": {
                "invoice_types": invoice_types,
                "sales_entity": sales_entity,
            },
        },
    }
    if args.dry_run:
        print(f"[connection] update request templates/config on {connection.get('name')} -> {connection_id}")
    else:
        connection = update_connection_config(
            base_url,
            connection,
            next_config,
            token=token,
            workspace_id=workspace_id,
        )
        print(f"[connection] updated {connection.get('name')} -> {connection_id}")

    mapping = upsert_mapping_by_name(
        base_url,
        build_invoice_refresh_mapping(connection_id),
        token=token,
        workspace_id=workspace_id,
        connection_id=connection_id,
        dry_run=args.dry_run,
    )
    mapping_id = str(mapping.get("id") or "dry-run-mapping").strip()

    automation_status = "published" if args.publish else "draft"
    export_automation = build_export_automation(
        sales_entity=sales_entity,
        invoice_types=invoice_types,
        sales_account_code=sales_account_code,
        default_tax_type=default_tax_type,
        connection_id=connection_id,
        status=automation_status,
    )
    refresh_automation = build_refresh_automation(
        sales_entity=sales_entity,
        invoice_types=invoice_types,
        connection_id=connection_id,
        refresh_interval_minutes=args.refresh_interval_minutes,
        mapping_id=mapping_id,
        status=automation_status,
    )
    upsert_automation_by_name(
        base_url,
        export_automation,
        token=token,
        workspace_id=workspace_id,
        publish=args.publish,
        dry_run=args.dry_run,
    )
    upsert_automation_by_name(
        base_url,
        refresh_automation,
        token=token,
        workspace_id=workspace_id,
        publish=args.publish,
        dry_run=args.dry_run,
    )


if __name__ == "__main__":
    main()
