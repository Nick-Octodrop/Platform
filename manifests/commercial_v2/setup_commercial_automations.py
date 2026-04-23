#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from typing import Any
from urllib import error as urlerror
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


def list_automations(base_url: str, *, token: str, workspace_id: str) -> list[dict[str, Any]]:
    status, payload = api_call(
        "GET",
        f"{base_url}/automations",
        token=token,
        workspace_id=workspace_id,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"list automations failed: {collect_error_text(payload)}")
    rows = payload.get("automations")
    return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []


def create_automation(
    base_url: str,
    definition: dict[str, Any],
    *,
    token: str,
    workspace_id: str,
) -> dict[str, Any]:
    status, payload = api_call(
        "POST",
        f"{base_url}/automations",
        token=token,
        workspace_id=workspace_id,
        body=definition,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"create automation '{definition.get('name')}' failed: {collect_error_text(payload)}")
    item = payload.get("automation")
    if not isinstance(item, dict):
        raise RuntimeError(f"create automation '{definition.get('name')}' failed: missing automation payload")
    return item


def update_automation(
    base_url: str,
    automation_id: str,
    definition: dict[str, Any],
    *,
    token: str,
    workspace_id: str,
) -> dict[str, Any]:
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
        raise RuntimeError(f"update automation '{definition.get('name')}' failed: missing automation payload")
    return item


def publish_automation(
    base_url: str,
    automation_id: str,
    *,
    token: str,
    workspace_id: str,
) -> dict[str, Any]:
    status, payload = api_call(
        "POST",
        f"{base_url}/automations/{automation_id}/publish",
        token=token,
        workspace_id=workspace_id,
        body={},
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"publish automation '{automation_id}' failed: {collect_error_text(payload)}")
    item = payload.get("automation")
    if not isinstance(item, dict):
        raise RuntimeError(f"publish automation '{automation_id}' failed: missing automation payload")
    return item


def eq_var(var_name: str, value: Any) -> dict[str, Any]:
    return {"op": "eq", "left": {"var": var_name}, "right": {"literal": value}}


def exists(var_name: str) -> dict[str, Any]:
    return {"op": "exists", "left": {"var": var_name}}


def and_(*conditions: dict[str, Any]) -> dict[str, Any]:
    return {"op": "and", "children": list(conditions)}


def upsert_automation_by_name(
    base_url: str,
    definition: dict[str, Any],
    *,
    token: str,
    workspace_id: str,
    publish: bool,
    dry_run: bool,
) -> dict[str, Any]:
    existing = next(
        (
            row
            for row in list_automations(base_url, token=token, workspace_id=workspace_id)
            if str(row.get("name") or "").strip() == definition["name"]
        ),
        None,
    )
    if dry_run:
        action = "update" if existing else "create"
        publish_suffix = " + publish" if publish else ""
        print(f"[automation] {action:6} {definition['name']}{publish_suffix}")
        return existing or {"id": "dry-run-automation", **definition}
    if existing and isinstance(existing.get("id"), str) and existing["id"]:
        next_status = definition["status"]
        if not publish and str(existing.get("status") or "").strip() in {"draft", "published", "disabled"}:
            next_status = str(existing.get("status")).strip()
        saved = update_automation(
            base_url,
            existing["id"],
            {**definition, "status": next_status},
            token=token,
            workspace_id=workspace_id,
        )
        print(f"[automation] updated {definition['name']} -> {saved.get('id')}")
    else:
        saved = create_automation(base_url, definition, token=token, workspace_id=workspace_id)
        print(f"[automation] created {definition['name']} -> {saved.get('id')}")
    if publish and isinstance(saved.get("id"), str) and saved["id"]:
        saved = publish_automation(base_url, saved["id"], token=token, workspace_id=workspace_id)
        print(f"[automation] published {definition['name']} -> {saved.get('id')}")
    return saved


def build_generate_document_automation(
    *,
    name: str,
    description: str,
    entity_id: str,
    action_id: str,
    template_id: str,
    purpose: str,
    status: str,
) -> dict[str, Any]:
    return {
        "name": name,
        "description": description,
        "status": status,
        "trigger": {
            "kind": "event",
            "event_types": ["action.clicked"],
            "filters": [
                {"path": "entity_id", "op": "eq", "value": entity_id},
                {"path": "action_id", "op": "eq", "value": action_id},
            ],
        },
        "steps": [
            {
                "id": "generate_document",
                "kind": "action",
                "action_id": "system.generate_document",
                "inputs": {
                    "template_id": template_id,
                    "entity_id": entity_id,
                    "record_id": "{{ trigger.record_id }}",
                    "purpose": purpose,
                },
            }
        ],
    }


def build_send_record_email_automation(
    *,
    name: str,
    description: str,
    source_entity_id: str,
    trigger_action_id: str,
    recipient_lookup_field_id: str,
    attachment_purpose: str,
    subject: str,
    body_html: str,
    status: str,
    email_template_id: str | None = None,
) -> dict[str, Any]:
    inputs: dict[str, Any] = {
        "entity_id": source_entity_id,
        "record_id": "{{ trigger.record_id }}",
        "to_lookup_field_ids": [recipient_lookup_field_id],
        "attachment_entity_id": source_entity_id,
        "attachment_record_id": "{{ trigger.record_id }}",
        "attachment_purpose": attachment_purpose,
    }
    if isinstance(email_template_id, str) and email_template_id.strip():
        inputs["template_id"] = email_template_id.strip()
    else:
        inputs["subject"] = subject
        inputs["body_html"] = body_html
        inputs["body_text"] = "Please find the attached document."
    return {
        "name": name,
        "description": description,
        "status": status,
        "trigger": {
            "kind": "event",
            "event_types": ["action.clicked"],
            "filters": [
                {"path": "entity_id", "op": "eq", "value": source_entity_id},
                {"path": "action_id", "op": "eq", "value": trigger_action_id},
            ],
            "expr": and_(
                exists("trigger.record.fields.primary_document_id"),
                exists("trigger.record.fields.generated_files"),
            ),
        },
        "steps": [
            {
                "id": "send_document_email",
                "kind": "action",
                "action_id": "system.send_email",
                "inputs": inputs,
            },
            {
                "id": "mark_primary_document_sent",
                "kind": "action",
                "action_id": "system.update_record",
                "inputs": {
                    "entity_id": "entity.biz_document",
                    "record_id": "{{ trigger.record.fields.primary_document_id }}",
                    "patch": {
                        "biz_document.status": "sent"
                    }
                },
            },
        ],
    }


def desired_automations(
    *,
    status: str,
    quote_document_template_id: str | None,
    order_document_template_id: str | None,
    purchase_order_document_template_id: str | None,
    invoice_document_template_id: str | None,
    quote_email_template_id: str | None,
    order_email_template_id: str | None,
    purchase_order_email_template_id: str | None,
    invoice_email_template_id: str | None,
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    if isinstance(quote_document_template_id, str) and quote_document_template_id.strip():
        items.append(
            build_generate_document_automation(
                name="Commercial - Generate Quote PDF",
                description="Generate the quote PDF when a user clicks Create Document on a quote.",
                entity_id="entity.biz_quote",
                action_id="action.quote_create_document",
                template_id=quote_document_template_id.strip(),
                purpose="quote_pdf",
                status=status,
            )
        )
    if isinstance(order_document_template_id, str) and order_document_template_id.strip():
        items.append(
            build_generate_document_automation(
                name="Commercial - Generate Order Confirmation",
                description="Generate the order confirmation PDF when a user clicks Create Document on a customer order.",
                entity_id="entity.biz_order",
                action_id="action.customer_order_create_document",
                template_id=order_document_template_id.strip(),
                purpose="order_confirmation",
                status=status,
            )
        )
    if isinstance(purchase_order_document_template_id, str) and purchase_order_document_template_id.strip():
        items.append(
            build_generate_document_automation(
                name="Commercial - Generate Purchase Order PDF",
                description="Generate the purchase order PDF when a user clicks Create Document on a purchase order.",
                entity_id="entity.biz_purchase_order",
                action_id="action.purchase_order_create_document",
                template_id=purchase_order_document_template_id.strip(),
                purpose="purchase_order_pdf",
                status=status,
            )
        )
    if isinstance(invoice_document_template_id, str) and invoice_document_template_id.strip():
        items.append(
            build_generate_document_automation(
                name="Commercial - Generate Invoice PDF",
                description="Generate the invoice PDF when a user clicks Create Document on an invoice.",
                entity_id="entity.biz_invoice",
                action_id="action.invoice_create_document",
                template_id=invoice_document_template_id.strip(),
                purpose="invoice_pdf",
                status=status,
            )
        )

    if isinstance(quote_document_template_id, str) and quote_document_template_id.strip():
        items.append(
            build_send_record_email_automation(
                name="Commercial - Send Quote Email",
                description="Send the customer quote email from the quote record once a generated quote PDF exists.",
                source_entity_id="entity.biz_quote",
                trigger_action_id="action.quote_mark_sent",
                recipient_lookup_field_id="biz_quote.customer_id",
                attachment_purpose="quote_pdf",
                subject="Quote {{ formatted_nested.biz_quote.quote_number }}",
                body_html="<p>Please find the attached quote.</p>",
                status=status,
                email_template_id=quote_email_template_id,
            )
        )
    if isinstance(order_document_template_id, str) and order_document_template_id.strip():
        items.append(
            build_send_record_email_automation(
                name="Commercial - Send Order Confirmation Email",
                description="Send the customer order confirmation email from the order record once a generated confirmation exists.",
                source_entity_id="entity.biz_order",
                trigger_action_id="action.customer_order_send_confirmation",
                recipient_lookup_field_id="biz_order.customer_id",
                attachment_purpose="order_confirmation",
                subject="Order confirmation {{ formatted_nested.biz_order.order_number }}",
                body_html="<p>Please find the attached order confirmation.</p>",
                status=status,
                email_template_id=order_email_template_id,
            )
        )
    if isinstance(purchase_order_document_template_id, str) and purchase_order_document_template_id.strip():
        items.append(
            build_send_record_email_automation(
                name="Commercial - Send Purchase Order Email",
                description="Send the supplier purchase-order email from the purchase order record once a generated PO PDF exists.",
                source_entity_id="entity.biz_purchase_order",
                trigger_action_id="action.purchase_order_mark_sent",
                recipient_lookup_field_id="biz_purchase_order.supplier_id",
                attachment_purpose="purchase_order_pdf",
                subject="Purchase order {{ formatted_nested.biz_purchase_order.po_number }}",
                body_html="<p>Please find the attached purchase order.</p>",
                status=status,
                email_template_id=purchase_order_email_template_id,
            )
        )
    if isinstance(invoice_document_template_id, str) and invoice_document_template_id.strip():
        items.append(
            build_send_record_email_automation(
                name="Commercial - Send Invoice Email",
                description="Send the customer invoice email from the invoice record once a generated invoice PDF exists.",
                source_entity_id="entity.biz_invoice",
                trigger_action_id="action.invoice_send_email",
                recipient_lookup_field_id="biz_invoice.customer_id",
                attachment_purpose="invoice_pdf",
                subject="Invoice {{ formatted_nested.biz_invoice.invoice_number }}",
                body_html="<p>Please find the attached invoice.</p>",
                status=status,
                email_template_id=invoice_email_template_id,
            )
        )
    return items


def main() -> None:
    parser = argparse.ArgumentParser(description="Create or update Commercial V2 document-generation and send-email automations.")
    parser.add_argument("--base-url", default=os.getenv("OCTO_BASE_URL", "").strip(), help="Octodrop API base URL")
    parser.add_argument("--token", default=os.getenv("OCTO_API_TOKEN", "").strip(), help="Bearer token")
    parser.add_argument("--workspace-id", default=os.getenv("OCTO_WORKSPACE_ID", "").strip(), help="Workspace ID")
    parser.add_argument("--quote-document-template-id", default=os.getenv("OCTO_QUOTE_DOCUMENT_TEMPLATE_ID", "").strip(), help="Document template id for quote PDFs")
    parser.add_argument("--order-document-template-id", default=os.getenv("OCTO_ORDER_DOCUMENT_TEMPLATE_ID", "").strip(), help="Document template id for order confirmations")
    parser.add_argument("--purchase-order-document-template-id", default=os.getenv("OCTO_PURCHASE_ORDER_DOCUMENT_TEMPLATE_ID", "").strip(), help="Document template id for purchase order PDFs")
    parser.add_argument("--invoice-document-template-id", default=os.getenv("OCTO_INVOICE_DOCUMENT_TEMPLATE_ID", "").strip(), help="Document template id for invoice PDFs")
    parser.add_argument("--quote-email-template-id", default=os.getenv("OCTO_QUOTE_EMAIL_TEMPLATE_ID", "").strip(), help="Optional email template id for quote emails")
    parser.add_argument("--order-email-template-id", default=os.getenv("OCTO_ORDER_EMAIL_TEMPLATE_ID", "").strip(), help="Optional email template id for order confirmation emails")
    parser.add_argument("--purchase-order-email-template-id", default=os.getenv("OCTO_PURCHASE_ORDER_EMAIL_TEMPLATE_ID", "").strip(), help="Optional email template id for purchase order emails")
    parser.add_argument("--invoice-email-template-id", default=os.getenv("OCTO_INVOICE_EMAIL_TEMPLATE_ID", "").strip(), help="Optional email template id for invoice emails")
    parser.add_argument("--publish", action="store_true", help="Publish the created or updated automations")
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

    automation_status = "published" if args.publish else "draft"
    definitions = desired_automations(
        status=automation_status,
        quote_document_template_id=args.quote_document_template_id or None,
        order_document_template_id=args.order_document_template_id or None,
        purchase_order_document_template_id=args.purchase_order_document_template_id or None,
        invoice_document_template_id=args.invoice_document_template_id or None,
        quote_email_template_id=args.quote_email_template_id or None,
        order_email_template_id=args.order_email_template_id or None,
        purchase_order_email_template_id=args.purchase_order_email_template_id or None,
        invoice_email_template_id=args.invoice_email_template_id or None,
    )
    for definition in definitions:
        upsert_automation_by_name(
            base_url,
            definition,
            token=token,
            workspace_id=workspace_id,
            publish=args.publish,
            dry_run=args.dry_run,
        )


if __name__ == "__main__":
    main()
