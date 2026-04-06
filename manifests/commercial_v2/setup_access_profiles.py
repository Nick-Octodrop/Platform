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


@dataclass(frozen=True)
class RuleSpec:
    resource_type: str
    resource_id: str
    access_level: str
    condition_json: dict[str, Any] | None = None
    priority: int = 100


BUSINESS_MODULES = [
    "biz_dashboard",
    "biz_contacts",
    "biz_products",
    "biz_quotes",
    "biz_orders",
    "biz_purchase_orders",
    "biz_invoices",
]
SETTINGS_MODULE = "biz_settings"

CONTACT_ENTITIES = ["entity.biz_contact"]
PRODUCT_ENTITIES = ["entity.biz_product"]
QUOTE_ENTITIES = ["entity.biz_quote", "entity.biz_quote_line"]
ORDER_ENTITIES = ["entity.biz_order", "entity.biz_order_line"]
PO_ENTITIES = ["entity.biz_purchase_order", "entity.biz_purchase_order_line"]
INVOICE_ENTITIES = ["entity.biz_invoice", "entity.biz_invoice_line"]
SETTINGS_ENTITIES = [
    "entity.biz_operating_entity",
    "entity.biz_payment_term",
    "entity.biz_tax_code",
    "entity.biz_document_template",
    "entity.biz_integration_setting",
]


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


def modules_visible(include_settings: bool) -> list[RuleSpec]:
    rules = [module_rule(module_id, "visible") for module_id in BUSINESS_MODULES]
    rules.append(module_rule(SETTINGS_MODULE, "visible" if include_settings else "hidden"))
    return rules


def entities_access(entity_ids: list[str], access_level: str) -> list[RuleSpec]:
    return [entity_rule(entity_id, access_level) for entity_id in entity_ids]


def sales_hidden_fields() -> list[RuleSpec]:
    hidden = [
        "biz_product.default_purchase_currency",
        "biz_product.default_buy_price",
        "biz_product.preferred_supplier_id",
        "biz_product.supplier_factory_reference",
        "biz_product.internal_notes",
        "biz_quote.estimated_buy_total",
        "biz_quote.estimated_margin_amount",
        "biz_quote.estimated_margin_percent",
        "biz_quote_line.default_buy_price_snapshot",
        "biz_quote_line.buy_currency_snapshot",
        "biz_quote_line.buy_total",
        "biz_quote_line.estimated_margin_amount",
        "biz_quote_line.estimated_margin_percent",
        "biz_order.preferred_supplier_id",
        "biz_order.estimated_buy_total",
        "biz_order.estimated_margin_amount",
        "biz_order.estimated_margin_percent",
        "biz_order_line.unit_cost_snapshot",
        "biz_order_line.buy_total",
    ]
    return [field_rule(field_id, "hidden") for field_id in hidden]


def procurement_hidden_actions() -> list[RuleSpec]:
    return [
        action_rule("action.invoice_new", "hidden"),
        action_rule("action.dashboard_new_invoice", "hidden"),
        action_rule("action.customer_order_create_deposit_invoice", "hidden"),
        action_rule("action.customer_order_create_final_invoice", "hidden"),
    ]


def operations_hidden_actions() -> list[RuleSpec]:
    return [
        action_rule("action.contact_new", "hidden"),
        action_rule("action.product_new", "hidden"),
        action_rule("action.quote_new", "hidden"),
        action_rule("action.invoice_new", "hidden"),
        action_rule("action.dashboard_new_quote", "hidden"),
        action_rule("action.dashboard_new_invoice", "hidden"),
        action_rule("action.quote_accept_and_create_order", "hidden"),
        action_rule("action.customer_order_create_deposit_invoice", "hidden"),
        action_rule("action.customer_order_create_final_invoice", "hidden"),
    ]


def finance_hidden_actions() -> list[RuleSpec]:
    return [
        action_rule("action.contact_new", "hidden"),
        action_rule("action.product_new", "hidden"),
        action_rule("action.quote_new", "hidden"),
        action_rule("action.purchase_order_new", "hidden"),
        action_rule("action.dashboard_new_quote", "hidden"),
        action_rule("action.dashboard_new_po", "hidden"),
        action_rule("action.customer_order_create_purchase_order", "hidden"),
        action_rule("action.customer_order_mark_in_production", "hidden"),
        action_rule("action.customer_order_mark_shipped", "hidden"),
        action_rule("action.customer_order_mark_completed", "hidden"),
    ]


def sales_hidden_actions() -> list[RuleSpec]:
    return [
        action_rule("action.product_new", "hidden"),
        action_rule("action.purchase_order_new", "hidden"),
        action_rule("action.invoice_new", "hidden"),
        action_rule("action.dashboard_new_po", "hidden"),
        action_rule("action.dashboard_new_invoice", "hidden"),
        action_rule("action.customer_order_create_purchase_order", "hidden"),
        action_rule("action.customer_order_mark_in_production", "hidden"),
        action_rule("action.customer_order_mark_shipped", "hidden"),
        action_rule("action.customer_order_mark_completed", "hidden"),
        action_rule("action.customer_order_create_deposit_invoice", "hidden"),
        action_rule("action.customer_order_create_final_invoice", "hidden"),
    ]


def desired_profiles() -> dict[str, dict[str, Any]]:
    directors_rules = (
        modules_visible(include_settings=True)
        + entities_access(CONTACT_ENTITIES + PRODUCT_ENTITIES + QUOTE_ENTITIES + ORDER_ENTITIES + PO_ENTITIES + INVOICE_ENTITIES + SETTINGS_ENTITIES, "write")
    )
    procurement_rules = (
        modules_visible(include_settings=False)
        + entities_access(CONTACT_ENTITIES + PRODUCT_ENTITIES + QUOTE_ENTITIES + ORDER_ENTITIES + PO_ENTITIES, "write")
        + entities_access(INVOICE_ENTITIES, "read")
        + entities_access(SETTINGS_ENTITIES, "none")
        + procurement_hidden_actions()
    )
    operations_rules = (
        modules_visible(include_settings=False)
        + entities_access(CONTACT_ENTITIES + PRODUCT_ENTITIES + QUOTE_ENTITIES + INVOICE_ENTITIES, "read")
        + entities_access(ORDER_ENTITIES + PO_ENTITIES, "write")
        + entities_access(SETTINGS_ENTITIES, "none")
        + operations_hidden_actions()
    )
    finance_rules = (
        modules_visible(include_settings=False)
        + entities_access(CONTACT_ENTITIES + PRODUCT_ENTITIES + QUOTE_ENTITIES + PO_ENTITIES, "read")
        + entities_access(ORDER_ENTITIES, "write")
        + entities_access(INVOICE_ENTITIES, "write")
        + entities_access(SETTINGS_ENTITIES, "none")
        + finance_hidden_actions()
    )
    sales_rules = (
        [module_rule(module_id, "visible") for module_id in ["biz_dashboard", "biz_contacts", "biz_products", "biz_quotes", "biz_orders", "biz_invoices"]]
        + [module_rule("biz_purchase_orders", "hidden"), module_rule("biz_settings", "hidden")]
        + [entity_rule("entity.biz_contact", "write"), entity_rule("entity.biz_contact", "write", eq_condition("biz_contact.contact_type", "customer"))]
        + entities_access(PRODUCT_ENTITIES, "read")
        + [entity_rule("entity.biz_quote", "write"), entity_rule("entity.biz_quote", "write", eq_condition("biz_quote.sales_entity", "NLight BV"))]
        + [entity_rule("entity.biz_quote_line", "write"), entity_rule("entity.biz_quote_line", "write", eq_condition("biz_quote_line.sales_entity_snapshot", "NLight BV"))]
        + [entity_rule("entity.biz_order", "write"), entity_rule("entity.biz_order", "write", eq_condition("biz_order.sales_entity", "NLight BV"))]
        + [entity_rule("entity.biz_order_line", "write"), entity_rule("entity.biz_order_line", "write", eq_condition("biz_order_line.sales_entity_snapshot", "NLight BV"))]
        + [entity_rule("entity.biz_invoice", "read"), entity_rule("entity.biz_invoice", "read", eq_condition("biz_invoice.sales_entity", "NLight BV"))]
        + [entity_rule("entity.biz_invoice_line", "read"), entity_rule("entity.biz_invoice_line", "read", eq_condition("biz_invoice_line.sales_entity_snapshot", "NLight BV"))]
        + entities_access(PO_ENTITIES + SETTINGS_ENTITIES, "none")
        + sales_hidden_fields()
        + sales_hidden_actions()
    )
    return {
        "directors": {
            "name": "Directors",
            "description": "Full commercial, financial, supplier, and settings access.",
            "rules": directors_rules,
            "members": ["luke", "matthew"],
        },
        "procurement": {
            "name": "Procurement",
            "description": "Commercial handoff, supplier, and purchasing ownership.",
            "rules": procurement_rules,
            "members": ["walter"],
        },
        "operations": {
            "name": "Operations",
            "description": "Order and purchase-order execution access.",
            "rules": operations_rules,
            "members": ["shelly"],
        },
        "finance": {
            "name": "Finance",
            "description": "Invoice, payment-status, and finance-oriented order visibility.",
            "rules": finance_rules,
            "members": ["tamzin"],
        },
        "sales_nl": {
            "name": "Sales NL",
            "description": "NLight BV customer-side sales access without supplier and cost visibility.",
            "rules": sales_rules,
            "members": ["joost", "joram"],
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
