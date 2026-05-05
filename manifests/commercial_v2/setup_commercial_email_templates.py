#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "_shared"))

from manifest_tooling import api_call, collect_error_text, is_ok


def email_template(
    *,
    name: str,
    description: str,
    entity_id: str,
    subject: str,
    body_html: str,
    body_text: str,
) -> dict[str, Any]:
    return {
        "name": name,
        "description": description,
        "subject": subject,
        "body_html": body_html,
        "body_text": body_text,
        "variables_schema": {"entity_id": entity_id},
        "is_active": True,
    }


def desired_templates() -> list[dict[str, Any]]:
    return [
        email_template(
            name="Customer Quote Email",
            description="Placeholder quote send email for UAT.",
            entity_id="entity.biz_quote",
            subject="Quote {{ record['biz_quote.quote_number'] if record is defined and record and record['biz_quote.quote_number'] is defined and record['biz_quote.quote_number'] else '' }}",
            body_html="<p>Please find the attached quote.</p>",
            body_text="Please find the attached quote.",
        ),
        email_template(
            name="Customer Order Confirmation Email",
            description="Placeholder order confirmation email for UAT.",
            entity_id="entity.biz_order",
            subject="Order confirmation {{ record['biz_order.order_number'] if record is defined and record and record['biz_order.order_number'] is defined and record['biz_order.order_number'] else '' }}",
            body_html="<p>Please find the attached order confirmation.</p>",
            body_text="Please find the attached order confirmation.",
        ),
        email_template(
            name="Supplier Purchase Order Email",
            description="Placeholder supplier purchase order email for UAT.",
            entity_id="entity.biz_purchase_order",
            subject="Purchase order {{ record['biz_purchase_order.po_number'] if record is defined and record and record['biz_purchase_order.po_number'] is defined and record['biz_purchase_order.po_number'] else '' }}",
            body_html="<p>Please find the attached purchase order.</p>",
            body_text="Please find the attached purchase order.",
        ),
        email_template(
            name="Customer Invoice Email",
            description="Placeholder invoice send email for UAT.",
            entity_id="entity.biz_invoice",
            subject="Invoice {{ record['biz_invoice.invoice_number'] if record is defined and record and record['biz_invoice.invoice_number'] is defined and record['biz_invoice.invoice_number'] else '' }}",
            body_html="<p>Please find the attached invoice.</p>",
            body_text="Please find the attached invoice.",
        ),
    ]


def list_templates(base_url: str, *, token: str, workspace_id: str) -> list[dict[str, Any]]:
    status, payload = api_call(
        "GET",
        f"{base_url}/email/templates",
        token=token,
        workspace_id=workspace_id,
        timeout=120,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"list email templates failed: {collect_error_text(payload)}")
    rows = payload.get("templates")
    return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []


def create_template(base_url: str, template: dict[str, Any], *, token: str, workspace_id: str) -> dict[str, Any]:
    status, payload = api_call(
        "POST",
        f"{base_url}/email/templates",
        token=token,
        workspace_id=workspace_id,
        body=template,
        timeout=120,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"create email template '{template.get('name')}' failed: {collect_error_text(payload)}")
    saved = payload.get("template")
    if not isinstance(saved, dict):
        raise RuntimeError(f"create email template '{template.get('name')}' failed: missing template payload")
    return saved


def update_template(
    base_url: str,
    template_id: str,
    template: dict[str, Any],
    *,
    token: str,
    workspace_id: str,
) -> dict[str, Any]:
    status, payload = api_call(
        "POST",
        f"{base_url}/email/templates/{template_id}",
        token=token,
        workspace_id=workspace_id,
        body=template,
        timeout=120,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"update email template '{template.get('name')}' failed: {collect_error_text(payload)}")
    saved = payload.get("template")
    if not isinstance(saved, dict):
        raise RuntimeError(f"update email template '{template.get('name')}' failed: missing template payload")
    return saved


def template_key(template: dict[str, Any]) -> tuple[str, str]:
    variables = template.get("variables_schema") if isinstance(template.get("variables_schema"), dict) else {}
    return str(template.get("name") or "").strip().lower(), str(variables.get("entity_id") or "").strip()


def main() -> None:
    parser = argparse.ArgumentParser(description="Create or update Commercial V2 placeholder email templates.")
    parser.add_argument("--base-url", default=os.getenv("OCTO_BASE_URL", "").strip(), help="Octodrop API base URL")
    parser.add_argument("--token", default=os.getenv("OCTO_API_TOKEN", "").strip(), help="Bearer token")
    parser.add_argument("--workspace-id", default=os.getenv("OCTO_WORKSPACE_ID", "").strip(), help="Workspace ID")
    parser.add_argument("--dry-run", action="store_true", help="Print planned changes without writing")
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

    existing_by_key = {
        template_key(item): item
        for item in list_templates(base_url, token=token, workspace_id=workspace_id)
        if template_key(item)[0]
    }
    for template in desired_templates():
        key = template_key(template)
        existing = existing_by_key.get(key)
        if args.dry_run:
            action = "update" if existing else "create"
            print(f"[email-template] {action:6} {template['name']} ({key[1]})")
            continue
        if existing and isinstance(existing.get("id"), str) and existing["id"]:
            saved = update_template(base_url, existing["id"], template, token=token, workspace_id=workspace_id)
            print(f"[email-template] updated {template['name']} -> {saved.get('id')}")
        else:
            saved = create_template(base_url, template, token=token, workspace_id=workspace_id)
            print(f"[email-template] created {template['name']} -> {saved.get('id')}")


if __name__ == "__main__":
    main()
