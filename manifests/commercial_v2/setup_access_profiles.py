#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import json
import os
import socket
import time
from dataclasses import dataclass
from typing import Any
from urllib import error as urlerror
from urllib import parse as urlparse
from urllib import request as urlrequest


@dataclass(frozen=True)
class RuleSpec:
    resource_type: str
    resource_id: str
    access_level: str
    condition_json: dict[str, Any] | None = None
    priority: int = 100


BUSINESS_MODULES = [
    "biz_contacts",
    "biz_products",
    "biz_quotes",
    "biz_orders",
    "biz_purchase_orders",
    "biz_invoices",
    "biz_documents",
    "biz_crm",
    "biz_tasks",
    "biz_calendar",
]
LEGACY_REMOVED_MODULES = ["biz_dashboard", "biz_settings"]

CONTACT_ENTITIES = ["entity.biz_contact", "entity.biz_contact_person"]
PRODUCT_ENTITIES = ["entity.biz_product"]
PRODUCT_SOURCE_ENTITIES = ["entity.biz_product_supplier"]
QUOTE_ENTITIES = ["entity.biz_quote", "entity.biz_quote_line"]
QUOTE_SCRIPT_ENTITIES = ["entity.biz_quote_script"]
ORDER_ENTITIES = ["entity.biz_order", "entity.biz_order_line"]
PO_ENTITIES = ["entity.biz_purchase_order", "entity.biz_purchase_order_line"]
INVOICE_ENTITIES = ["entity.biz_invoice", "entity.biz_invoice_line"]
DOCUMENT_ENTITIES = ["entity.biz_document"]
CRM_ENTITIES = ["entity.crm_lead", "entity.crm_opportunity", "entity.crm_opportunity_line", "entity.crm_activity", "entity.crm_site"]
TASK_ENTITIES = ["entity.biz_task"]
CALENDAR_ENTITIES = ["entity.biz_calendar_event"]


def api_call(
    method: str,
    url: str,
    *,
    token: str | None = None,
    workspace_id: str | None = None,
    body: dict[str, Any] | None = None,
    timeout: int = 180,
    retries: int = 2,
) -> tuple[int, dict[str, Any]]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if workspace_id:
        headers["X-Workspace-Id"] = workspace_id
    data = json.dumps(body).encode("utf-8") if body is not None else None
    attempts = max(1, int(retries) + 1)
    for attempt in range(1, attempts + 1):
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
        except (TimeoutError, socket.timeout, urlerror.URLError) as exc:
            if attempt >= attempts:
                raise RuntimeError(
                    f"request timeout after {attempts} attempt(s): {method} {url} ({exc})"
                ) from exc
            time.sleep(min(5, attempt))


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


def jwt_expiry_seconds(token: str | None) -> int | None:
    if not token:
        return None
    parts = token.split(".")
    if len(parts) < 2:
        return None
    try:
        padded = parts[1] + ("=" * (-len(parts[1]) % 4))
        claims = json.loads(base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8"))
    except Exception:
        return None
    exp = claims.get("exp")
    if isinstance(exp, (int, float)):
        return int(exp) - int(time.time())
    return None


def require_token_window(token: str | None, *, min_seconds: int, label: str) -> None:
    remaining = jwt_expiry_seconds(token)
    if remaining is None:
        return
    if remaining <= 0:
        raise SystemExit(f"{label}: OCTO_API_TOKEN is expired. Refresh it before running this script.")
    if remaining < min_seconds:
        minutes = max(1, remaining // 60)
        required = max(1, min_seconds // 60)
        raise SystemExit(
            f"{label}: OCTO_API_TOKEN expires in about {minutes} minute(s). "
            f"Refresh it before running this script; this run needs at least {required} minute(s)."
        )


def fetch_profiles(base_url: str, *, token: str | None, workspace_id: str | None) -> list[dict[str, Any]]:
    status, payload = api_call("GET", f"{base_url}/access/profiles", token=token, workspace_id=workspace_id)
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"list profiles failed: {collect_error_text(payload)}")
    profiles = payload.get("profiles")
    return profiles if isinstance(profiles, list) else []


def fetch_members(base_url: str, *, token: str | None, workspace_id: str | None) -> list[dict[str, Any]]:
    status, payload = api_call("GET", f"{base_url}/access/members", token=token, workspace_id=workspace_id)
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"list members failed: {collect_error_text(payload)}")
    members = payload.get("members")
    return members if isinstance(members, list) else []


def ensure_profile(
    base_url: str,
    *,
    token: str | None,
    workspace_id: str | None,
    profile_key: str,
    name: str,
    description: str,
) -> dict[str, Any]:
    profiles = fetch_profiles(base_url, token=token, workspace_id=workspace_id)
    for profile in profiles:
        if profile.get("profile_key") == profile_key:
            status, payload = api_call(
                "PATCH",
                f"{base_url}/access/profiles/{urlparse.quote(str(profile['id']), safe='')}",
                token=token,
                workspace_id=workspace_id,
                body={"name": name, "description": description, "profile_key": profile_key},
            )
            if status >= 400 or not is_ok(payload):
                raise RuntimeError(f"patch profile {profile_key} failed: {collect_error_text(payload)}")
            return payload.get("profile") if isinstance(payload.get("profile"), dict) else dict(profile)
    status, payload = api_call(
        "POST",
        f"{base_url}/access/profiles",
        token=token,
        workspace_id=workspace_id,
        body={"name": name, "description": description, "profile_key": profile_key},
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"create profile {profile_key} failed: {collect_error_text(payload)}")
    profile = payload.get("profile")
    if not isinstance(profile, dict):
        raise RuntimeError(f"create profile {profile_key} failed: missing profile")
    return profile


def replace_profile_rules(
    base_url: str,
    profile: dict[str, Any],
    desired_rules: list[RuleSpec],
    *,
    token: str | None,
    workspace_id: str | None,
) -> None:
    profile_id = profile.get("id")
    if not isinstance(profile_id, str) or not profile_id:
        raise RuntimeError("profile id missing")
    existing_rules = profile.get("rules")
    if not isinstance(existing_rules, list):
        profiles = fetch_profiles(base_url, token=token, workspace_id=workspace_id)
        refreshed = next((row for row in profiles if row.get("id") == profile_id), None)
        existing_rules = refreshed.get("rules") if isinstance(refreshed, dict) else []
    for rule in existing_rules or []:
        rule_id = rule.get("id")
        if not isinstance(rule_id, str) or not rule_id:
            continue
        status, payload = api_call(
            "DELETE",
            f"{base_url}/access/profiles/{urlparse.quote(profile_id, safe='')}/rules/{urlparse.quote(rule_id, safe='')}",
            token=token,
            workspace_id=workspace_id,
        )
        if status >= 400 or not is_ok(payload):
            raise RuntimeError(f"delete rule {rule_id} failed: {collect_error_text(payload)}")
    for rule in desired_rules:
        status, payload = api_call(
            "POST",
            f"{base_url}/access/profiles/{urlparse.quote(profile_id, safe='')}/rules",
            token=token,
            workspace_id=workspace_id,
            body={
                "resource_type": rule.resource_type,
                "resource_id": rule.resource_id,
                "access_level": rule.access_level,
                "condition_json": rule.condition_json,
                "priority": rule.priority,
            },
        )
        if status >= 400 or not is_ok(payload):
            raise RuntimeError(
                f"create rule {rule.resource_type}/{rule.resource_id}/{rule.access_level} failed: {collect_error_text(payload)}"
            )


def assign_member_profiles(
    base_url: str,
    user_id: str,
    profile_ids: list[str],
    *,
    token: str | None,
    workspace_id: str | None,
) -> None:
    status, payload = api_call(
        "PATCH",
        f"{base_url}/access/members/{urlparse.quote(user_id, safe='')}/profiles",
        token=token,
        workspace_id=workspace_id,
        body={"profile_ids": profile_ids},
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"assign profiles failed: {collect_error_text(payload)}")


def module_rule(module_id: str, access_level: str) -> RuleSpec:
    return RuleSpec("module", module_id, access_level)


def entity_rule(entity_id: str, access_level: str, condition_json: dict[str, Any] | None = None) -> RuleSpec:
    return RuleSpec("entity", entity_id, access_level, condition_json=condition_json)


def field_rule(field_id: str, access_level: str) -> RuleSpec:
    return RuleSpec("field", field_id, access_level)


def action_rule(action_id: str, access_level: str) -> RuleSpec:
    return RuleSpec("action", action_id, access_level)


def eq_condition(field_id: str, value: Any) -> dict[str, Any]:
    return {"op": "eq", "field": field_id, "value": value}


def in_condition(field_id: str, values: list[Any]) -> dict[str, Any]:
    return {"op": "in", "field": field_id, "value": values}


def and_condition(*conditions: dict[str, Any]) -> dict[str, Any]:
    return {"op": "and", "conditions": list(conditions)}


def sales_own_entity_condition(field_id: str, entity_scope: str) -> dict[str, Any]:
    return eq_condition(field_id, entity_scope)


def sales_shared_entity_condition(field_id: str) -> dict[str, Any]:
    return eq_condition(field_id, "Shared")


def modules_visible(include_settings: bool) -> list[RuleSpec]:
    return [module_rule(module_id, "visible") for module_id in BUSINESS_MODULES] + [
        module_rule(module_id, "hidden") for module_id in LEGACY_REMOVED_MODULES
    ]


def visible_modules(module_ids: list[str]) -> list[RuleSpec]:
    visible = set(module_ids)
    rules = [module_rule(module_id, "visible") for module_id in BUSINESS_MODULES if module_id in visible]
    rules.extend(module_rule(module_id, "hidden") for module_id in BUSINESS_MODULES if module_id not in visible)
    rules.extend(module_rule(module_id, "hidden") for module_id in LEGACY_REMOVED_MODULES)
    return rules


def entities_access(entity_ids: list[str], access_level: str) -> list[RuleSpec]:
    return [entity_rule(entity_id, access_level) for entity_id in entity_ids]


def sales_hidden_fields() -> list[RuleSpec]:
    hidden = [
        "biz_contact.supplier_reference",
        "biz_contact.production_country",
        "biz_contact.supplier_payment_terms",
        "biz_contact.supplier_incoterm_default",
        "biz_contact.xero_contact_id",
        "biz_contact.xero_last_sync_status",
        "biz_contact.xero_last_sync_at",
        "biz_contact.xero_last_sync_error",
        "biz_product.default_purchase_currency",
        "biz_product.default_buy_price",
        "biz_product.default_quote_cost_currency",
        "biz_product.default_quote_cost_price",
        "biz_product.intercompany_cost_currency",
        "biz_product.intercompany_cost_price",
        "biz_product.fulfilment_mode",
        "biz_product.active_supplier_source_count",
        "biz_product.supplier_source_count",
        "biz_product.lead_time_weeks",
        "biz_product.minimum_order_quantity",
        "biz_product.on_hand_qty",
        "biz_product.reserved_qty",
        "biz_product.available_qty",
        "biz_product.reorder_point_qty",
        "biz_product.stock_notes",
        "biz_product.preferred_supplier_id",
        "biz_product.supplier_factory_reference",
        "biz_product.internal_notes",
        "biz_quote.estimated_buy_total",
        "biz_quote.estimated_margin_amount",
        "biz_quote.estimated_margin_percent",
        "biz_quote.internal_notes",
        "biz_quote_line.default_buy_price_snapshot",
        "biz_quote_line.buy_currency_snapshot",
        "biz_quote_line.procurement_supplier_id",
        "biz_quote_line.supplier_sku_snapshot",
        "biz_quote_line.buy_fx_to_quote_rate",
        "biz_quote_line.buy_total",
        "biz_quote_line.buy_total_quote_currency",
        "biz_quote_line.estimated_margin_amount",
        "biz_quote_line.estimated_margin_percent",
        "crm_opportunity_line.default_buy_price_snapshot",
        "crm_opportunity_line.buy_currency_snapshot",
        "crm_opportunity_line.procurement_supplier_id",
        "crm_opportunity_line.supplier_sku_snapshot",
        "crm_opportunity_line.buy_fx_to_quote_rate",
        "crm_opportunity_line.buy_total",
        "crm_opportunity_line.buy_total_quote_currency",
        "crm_opportunity_line.estimated_margin_amount",
        "crm_opportunity_line.estimated_margin_percent",
        "biz_order.preferred_supplier_id",
        "biz_order.estimated_buy_total",
        "biz_order.estimated_margin_amount",
        "biz_order.estimated_margin_percent",
        "biz_order_line.unit_cost_snapshot",
        "biz_order_line.buy_total",
    ]
    return [field_rule(field_id, "hidden") for field_id in hidden]


def crm_write_actions() -> list[RuleSpec]:
    return [
        action_rule("action.crm_lead_new", "hidden"),
        action_rule("action.crm_lead_mark_contacted", "hidden"),
        action_rule("action.crm_lead_qualify", "hidden"),
        action_rule("action.crm_lead_open_disqualify_modal", "hidden"),
        action_rule("action.crm_opportunity_new", "hidden"),
        action_rule("action.crm_opportunity_discovery", "hidden"),
        action_rule("action.crm_opportunity_confirm_meeting", "hidden"),
        action_rule("action.crm_opportunity_solution", "hidden"),
        action_rule("action.crm_opportunity_quote_stage", "hidden"),
        action_rule("action.crm_opportunity_create_quote", "hidden"),
        action_rule("action.crm_opportunity_negotiation", "hidden"),
        action_rule("action.crm_opportunity_resume", "hidden"),
        action_rule("action.crm_opportunity_mark_won", "hidden"),
        action_rule("action.crm_opportunity_open_lost_modal", "hidden"),
        action_rule("action.crm_opportunity_create_order", "hidden"),
        action_rule("action.crm_activity_new", "hidden"),
        action_rule("action.crm_activity_done", "hidden"),
        action_rule("action.crm_activity_cancel", "hidden"),
        action_rule("action.crm_site_new", "hidden"),
    ]


def task_write_actions() -> list[RuleSpec]:
    return [
        action_rule("action.biz_task_new", "hidden"),
        action_rule("action.biz_task_start", "hidden"),
        action_rule("action.biz_task_block", "hidden"),
        action_rule("action.biz_task_done", "hidden"),
        action_rule("action.biz_task_cancel", "hidden"),
    ]


def calendar_write_actions() -> list[RuleSpec]:
    return [
        action_rule("action.biz_calendar_event_new", "hidden"),
        action_rule("action.biz_calendar_event_confirm", "hidden"),
        action_rule("action.biz_calendar_event_done", "hidden"),
        action_rule("action.biz_calendar_event_cancel", "hidden"),
    ]


def procurement_hidden_actions() -> list[RuleSpec]:
    return [
        action_rule("action.quote_script_new", "hidden"),
        action_rule("action.invoice_new", "hidden"),
        action_rule("action.invoice_create_document", "hidden"),
        action_rule("action.invoice_send_email", "hidden"),
        action_rule("action.customer_order_create_deposit_invoice", "hidden"),
        action_rule("action.customer_order_create_progress_invoice", "hidden"),
        action_rule("action.customer_order_create_final_invoice", "hidden"),
    ] + crm_write_actions()


def operations_hidden_actions() -> list[RuleSpec]:
    return [
        action_rule("action.quote_script_new", "hidden"),
        action_rule("action.invoice_new", "hidden"),
        action_rule("action.invoice_create_document", "hidden"),
        action_rule("action.invoice_send_email", "hidden"),
        action_rule("action.customer_order_create_deposit_invoice", "hidden"),
        action_rule("action.customer_order_create_progress_invoice", "hidden"),
        action_rule("action.customer_order_create_final_invoice", "hidden"),
    ]


def finance_hidden_actions() -> list[RuleSpec]:
    return []


def sales_hidden_actions() -> list[RuleSpec]:
    return [
        action_rule("action.quote_script_new", "hidden"),
        action_rule("action.crm_opportunity_approve_gate_exception", "hidden"),
        action_rule("action.crm_opportunity_reject_gate_exception", "hidden"),
        action_rule("action.quote_convert_to_order", "hidden"),
        action_rule("action.customer_order_new", "hidden"),
        action_rule("action.customer_order_confirm", "hidden"),
        action_rule("action.customer_order_open_hold_modal", "hidden"),
        action_rule("action.customer_order_mark_in_production", "hidden"),
        action_rule("action.customer_order_mark_shipped", "hidden"),
        action_rule("action.customer_order_mark_completed", "hidden"),
        action_rule("action.customer_order_open_cancel_modal", "hidden"),
        action_rule("action.customer_order_create_purchase_order", "hidden"),
        action_rule("action.customer_order_line_raise_purchase_order", "hidden"),
        action_rule("action.customer_order_create_deposit_invoice", "hidden"),
        action_rule("action.customer_order_create_progress_invoice", "hidden"),
        action_rule("action.customer_order_create_final_invoice", "hidden"),
        action_rule("action.customer_order_create_document", "hidden"),
        action_rule("action.customer_order_send_confirmation", "hidden"),
        action_rule("action.purchase_order_new", "hidden"),
        action_rule("action.purchase_order_mark_sent", "hidden"),
        action_rule("action.purchase_order_confirm", "hidden"),
        action_rule("action.purchase_order_open_hold_modal", "hidden"),
        action_rule("action.purchase_order_mark_in_production", "hidden"),
        action_rule("action.purchase_order_mark_shipped", "hidden"),
        action_rule("action.purchase_order_mark_received", "hidden"),
        action_rule("action.purchase_order_close", "hidden"),
        action_rule("action.purchase_order_open_cancel_modal", "hidden"),
        action_rule("action.purchase_order_create_document", "hidden"),
        action_rule("action.invoice_new", "hidden"),
        action_rule("action.invoice_issue", "hidden"),
        action_rule("action.invoice_mark_part_paid", "hidden"),
        action_rule("action.invoice_mark_paid", "hidden"),
        action_rule("action.invoice_open_cancel_modal", "hidden"),
        action_rule("action.invoice_create_credit_note", "hidden"),
        action_rule("action.invoice_create_document", "hidden"),
        action_rule("action.invoice_send_email", "hidden"),
        action_rule("action.invoice_mark_credited", "hidden"),
        action_rule("action.document_new", "hidden"),
        action_rule("action.biz_task_new", "hidden"),
        action_rule("action.biz_task_start", "hidden"),
        action_rule("action.biz_task_block", "hidden"),
        action_rule("action.biz_task_done", "hidden"),
        action_rule("action.biz_task_cancel", "hidden"),
        action_rule("action.biz_calendar_event_new", "hidden"),
        action_rule("action.biz_calendar_event_confirm", "hidden"),
        action_rule("action.biz_calendar_event_done", "hidden"),
        action_rule("action.biz_calendar_event_cancel", "hidden"),
    ]


def engineer_hidden_fields() -> list[RuleSpec]:
    hidden = [
        "biz_order.preferred_supplier_id",
        "biz_order.deposit_invoice_id",
        "biz_order.final_invoice_id",
        "biz_order.invoiced_total",
        "biz_order.balance_to_invoice",
        "biz_order.estimated_buy_total",
        "biz_order.estimated_margin_amount",
        "biz_order.estimated_margin_percent",
        "biz_order_line.unit_cost_snapshot",
        "biz_order_line.buy_currency_snapshot",
        "biz_order_line.buy_fx_to_order_rate",
        "biz_order_line.buy_total",
        "biz_order_line.buy_total_order_currency",
        "biz_order_line.procurement_supplier_id",
        "biz_order_line.product_supplier_id",
        "biz_order_line.supplier_sku_snapshot",
        "biz_order_line.minimum_order_quantity_snapshot",
        "biz_order_line.lead_time_weeks_snapshot",
        "biz_order_line.linked_purchase_order_id",
        "biz_order_line.procured_quantity_total",
        "biz_order_line.received_purchase_quantity_total",
        "biz_order_line.procurement_shortfall_quantity",
        "biz_order_line.receipt_shortfall_quantity",
    ]
    return [field_rule(field_id, "hidden") for field_id in hidden]


def engineer_hidden_actions() -> list[RuleSpec]:
    return [
        action_rule("action.contact_new", "hidden"),
        action_rule("action.contact_activate", "hidden"),
        action_rule("action.contact_deactivate", "hidden"),
        action_rule("action.contact_person_new", "hidden"),
        action_rule("action.contact_person_activate", "hidden"),
        action_rule("action.contact_person_deactivate", "hidden"),
        action_rule("action.product_new", "hidden"),
        action_rule("action.product_activate", "hidden"),
        action_rule("action.product_deactivate", "hidden"),
        action_rule("action.quote_script_new", "hidden"),
        action_rule("action.quote_new", "hidden"),
        action_rule("action.quote_reset_copy_from_script", "hidden"),
        action_rule("action.quote_mark_sent", "hidden"),
        action_rule("action.quote_mark_accepted", "hidden"),
        action_rule("action.quote_convert_to_order", "hidden"),
        action_rule("action.quote_create_document", "hidden"),
        action_rule("action.quote_open_lost_modal", "hidden"),
        action_rule("action.quote_open_expired_modal", "hidden"),
        action_rule("action.customer_order_new", "hidden"),
        action_rule("action.customer_order_confirm", "hidden"),
        action_rule("action.customer_order_open_hold_modal", "hidden"),
        action_rule("action.customer_order_mark_in_production", "hidden"),
        action_rule("action.customer_order_mark_shipped", "hidden"),
        action_rule("action.customer_order_mark_completed", "hidden"),
        action_rule("action.customer_order_open_cancel_modal", "hidden"),
        action_rule("action.customer_order_create_purchase_order", "hidden"),
        action_rule("action.customer_order_line_raise_purchase_order", "hidden"),
        action_rule("action.customer_order_create_deposit_invoice", "hidden"),
        action_rule("action.customer_order_create_progress_invoice", "hidden"),
        action_rule("action.customer_order_create_final_invoice", "hidden"),
        action_rule("action.purchase_order_new", "hidden"),
        action_rule("action.purchase_order_mark_sent", "hidden"),
        action_rule("action.purchase_order_confirm", "hidden"),
        action_rule("action.purchase_order_open_hold_modal", "hidden"),
        action_rule("action.purchase_order_mark_in_production", "hidden"),
        action_rule("action.purchase_order_mark_shipped", "hidden"),
        action_rule("action.purchase_order_mark_received", "hidden"),
        action_rule("action.purchase_order_close", "hidden"),
        action_rule("action.purchase_order_open_cancel_modal", "hidden"),
        action_rule("action.purchase_order_create_document", "hidden"),
        action_rule("action.invoice_new", "hidden"),
        action_rule("action.invoice_issue", "hidden"),
        action_rule("action.invoice_mark_part_paid", "hidden"),
        action_rule("action.invoice_mark_paid", "hidden"),
        action_rule("action.invoice_open_cancel_modal", "hidden"),
        action_rule("action.invoice_create_credit_note", "hidden"),
        action_rule("action.invoice_create_document", "hidden"),
        action_rule("action.invoice_send_email", "hidden"),
        action_rule("action.invoice_mark_credited", "hidden"),
        action_rule("action.document_new", "hidden"),
    ]


def desired_profiles() -> dict[str, dict[str, Any]]:
    full_access_rules = (
        modules_visible(include_settings=True)
        + entities_access(CONTACT_ENTITIES + PRODUCT_ENTITIES + PRODUCT_SOURCE_ENTITIES + QUOTE_ENTITIES + QUOTE_SCRIPT_ENTITIES + ORDER_ENTITIES + PO_ENTITIES + INVOICE_ENTITIES + DOCUMENT_ENTITIES + CRM_ENTITIES + TASK_ENTITIES + CALENDAR_ENTITIES, "write")
    )
    operational_rules = (
        modules_visible(include_settings=False)
        + entities_access(CONTACT_ENTITIES + PRODUCT_ENTITIES + PRODUCT_SOURCE_ENTITIES + QUOTE_ENTITIES + QUOTE_SCRIPT_ENTITIES + ORDER_ENTITIES + PO_ENTITIES + DOCUMENT_ENTITIES + CRM_ENTITIES + TASK_ENTITIES + CALENDAR_ENTITIES, "write")
        + entities_access(INVOICE_ENTITIES, "read")
        + operations_hidden_actions()
    )
    finance_rules = (
        modules_visible(include_settings=False)
        + entities_access(CONTACT_ENTITIES + PRODUCT_ENTITIES + PRODUCT_SOURCE_ENTITIES + QUOTE_ENTITIES + QUOTE_SCRIPT_ENTITIES + ORDER_ENTITIES + PO_ENTITIES + INVOICE_ENTITIES + DOCUMENT_ENTITIES + CRM_ENTITIES + TASK_ENTITIES + CALENDAR_ENTITIES, "write")
        + finance_hidden_actions()
    )

    def sales_rules_for(entity_scope: str) -> list[RuleSpec]:
        return (
            visible_modules(["biz_contacts", "biz_products", "biz_quotes", "biz_crm"])
            + [
                entity_rule(
                    "entity.biz_contact",
                    "write",
                    and_condition(
                        eq_condition("biz_contact.contact_type", "customer"),
                        sales_own_entity_condition("biz_contact.company_entity_scope", entity_scope),
                    ),
                ),
                entity_rule(
                    "entity.biz_contact",
                    "read",
                    and_condition(
                        eq_condition("biz_contact.contact_type", "customer"),
                        sales_shared_entity_condition("biz_contact.company_entity_scope"),
                    ),
                )
            ]
            + [
                entity_rule(
                    "entity.biz_contact_person",
                    "write",
                    and_condition(
                        eq_condition("biz_contact_person.company_contact_type_snapshot", "customer"),
                        sales_own_entity_condition("biz_contact_person.company_entity_scope_snapshot", entity_scope),
                    ),
                ),
                entity_rule(
                    "entity.biz_contact_person",
                    "read",
                    and_condition(
                        eq_condition("biz_contact_person.company_contact_type_snapshot", "customer"),
                        sales_shared_entity_condition("biz_contact_person.company_entity_scope_snapshot"),
                    ),
                )
            ]
            + [
                entity_rule("entity.crm_lead", "write", eq_condition("crm_lead.sales_entity", entity_scope)),
                entity_rule("entity.crm_opportunity", "write", eq_condition("crm_opportunity.sales_entity", entity_scope)),
                entity_rule("entity.crm_opportunity_line", "write", eq_condition("crm_opportunity_line.sales_entity_snapshot", entity_scope)),
                entity_rule("entity.crm_activity", "write", eq_condition("crm_activity.sales_entity", entity_scope)),
                entity_rule("entity.crm_site", "write", eq_condition("crm_site.sales_entity", entity_scope)),
            ]
            + entities_access(PRODUCT_ENTITIES, "read")
            + [entity_rule("entity.biz_quote_script", "read", eq_condition("biz_quote_script.sales_entity", entity_scope))]
            + [entity_rule("entity.biz_quote", "write", eq_condition("biz_quote.sales_entity", entity_scope))]
            + [entity_rule("entity.biz_quote_line", "write", eq_condition("biz_quote_line.sales_entity_snapshot", entity_scope))]
            + entities_access(ORDER_ENTITIES + PO_ENTITIES + INVOICE_ENTITIES + DOCUMENT_ENTITIES + TASK_ENTITIES + CALENDAR_ENTITIES, "none")
            + sales_hidden_fields()
            + sales_hidden_actions()
        )

    engineer_rules = (
        visible_modules(["biz_orders", "biz_tasks", "biz_calendar", "biz_contacts"])
        + entities_access(ORDER_ENTITIES, "read")
        + [entity_rule("entity.biz_contact", "read", eq_condition("biz_contact.contact_type", "customer"))]
        + [entity_rule("entity.biz_contact_person", "read", eq_condition("biz_contact_person.company_contact_type_snapshot", "customer"))]
        + entities_access(TASK_ENTITIES + CALENDAR_ENTITIES, "write")
        + entities_access(PRODUCT_ENTITIES + PRODUCT_SOURCE_ENTITIES + QUOTE_ENTITIES + QUOTE_SCRIPT_ENTITIES + PO_ENTITIES + INVOICE_ENTITIES + DOCUMENT_ENTITIES + CRM_ENTITIES, "none")
        + engineer_hidden_fields()
        + engineer_hidden_actions()
    )
    return {
        "owner": {
            "name": "Owner",
            "description": "Workspace owner access across all commercial modules.",
            "rules": full_access_rules,
            "members": ["luke"],
        },
        "admin": {
            "name": "Admin",
            "description": "Full commercial administration across all NLight modules.",
            "rules": full_access_rules,
            "members": ["matthew", "natalie", "shelly"],
        },
        "finance": {
            "name": "Finance",
            "description": "Finance-led control across quotes, orders, purchasing, invoicing, and Xero-linked records.",
            "rules": finance_rules,
            "members": ["debra", "mark", "tamzin"],
        },
        "operational": {
            "name": "Operational",
            "description": "Operational ownership of CRM handoff, stock, supplier, and purchasing workflows.",
            "rules": operational_rules,
            "members": ["walter"],
        },
        "sales_nlight_bv": {
            "name": "NLight BV Sales",
            "description": "NLight BV sales access for CRM and quotes without supplier, cost, or job visibility.",
            "rules": sales_rules_for("NLight BV"),
            "members": ["joost", "joram"],
        },
        "sales_cis": {
            "name": "CIS Sales",
            "description": "EcoTech/CIS sales access for CRM and quotes without supplier, cost, or job visibility.",
            "rules": sales_rules_for("EcoTech FZCO"),
            "members": ["alexey", "a.kurbanaev", "andrey", "a.funk"],
        },
        "engineer": {
            "name": "Engineer",
            "description": "Basic order visibility with task and calendar activity logging.",
            "rules": engineer_rules,
            "members": ["tomas"],
        },
    }


def member_matches(member: dict[str, Any], needle: str) -> bool:
    haystacks = [
        str(member.get("name") or "").strip().lower(),
        str(member.get("email") or "").strip().lower(),
        str(member.get("user_id") or "").strip().lower(),
    ]
    token = needle.strip().lower()
    return any(token and token in haystack for haystack in haystacks)


def main() -> None:
    parser = argparse.ArgumentParser(description="Create and assign Commercial V2 access profiles.")
    parser.add_argument("--base-url", default=None, help="API base URL, e.g. https://app.octodrop.com")
    parser.add_argument("--token", default=None, help="Bearer token")
    parser.add_argument("--workspace-id", default=None, help="Workspace ID")
    parser.add_argument("--skip-assignments", action="store_true", help="Create profiles and rules only")
    args = parser.parse_args()

    base_url = (args.base_url or os.environ.get("OCTO_BASE_URL", "")).strip().rstrip("/")
    token = (args.token or os.environ.get("OCTO_API_TOKEN", "")).strip() or None
    workspace_id = (args.workspace_id or os.environ.get("OCTO_WORKSPACE_ID", "")).strip() or None
    if not base_url:
        raise SystemExit("--base-url or OCTO_BASE_URL is required")
    require_token_window(token, min_seconds=5 * 60, label="access profiles")

    profiles_by_key: dict[str, dict[str, Any]] = {}
    for profile_key, spec in desired_profiles().items():
        profile = ensure_profile(
            base_url,
            token=token,
            workspace_id=workspace_id,
            profile_key=profile_key,
            name=spec["name"],
            description=spec["description"],
        )
        replace_profile_rules(base_url, profile, spec["rules"], token=token, workspace_id=workspace_id)
        profiles_by_key[profile_key] = profile
        print(f"[access] synced   {profile_key}")

    if args.skip_assignments:
        print("[access] assignments skipped")
        return

    members = fetch_members(base_url, token=token, workspace_id=workspace_id)
    for profile_key, spec in desired_profiles().items():
        profile_id = profiles_by_key[profile_key].get("id")
        if not isinstance(profile_id, str) or not profile_id:
            continue
        for needle in spec["members"]:
            member = next((row for row in members if member_matches(row, needle)), None)
            if not member:
                print(f"[access] missing  member match for {needle} -> {profile_key}")
                continue
            user_id = member.get("user_id")
            if not isinstance(user_id, str) or not user_id:
                print(f"[access] missing  user_id for {needle}")
                continue
            assign_member_profiles(base_url, user_id, [profile_id], token=token, workspace_id=workspace_id)
            label = member.get("name") or member.get("email") or user_id
            print(f"[access] assigned {label} -> {profile_key}")


if __name__ == "__main__":
    main()
