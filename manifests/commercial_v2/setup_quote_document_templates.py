#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import socket
from pathlib import Path
from typing import Any
from urllib import error as urlerror
from urllib import request as urlrequest


SCRIPT_DIR = Path(__file__).resolve().parent
TEMPLATE_DIR = SCRIPT_DIR / "templates"


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
                raise RuntimeError(f"request timeout after {attempts} attempt(s): {method} {url} ({exc})") from exc
            import time

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


def read_text(name: str) -> str:
    return (TEMPLATE_DIR / name).read_text(encoding="utf-8").strip()


def document_template(
    *,
    name: str,
    description: str,
    entity_id: str,
    filename_pattern: str,
    html_file: str,
    margin_top: str = "12mm",
    margin_right: str = "12mm",
    margin_bottom: str = "12mm",
    margin_left: str = "12mm",
) -> dict[str, Any]:
    return {
        "name": name,
        "description": description,
        "filename_pattern": filename_pattern,
        "html": read_text(html_file),
        "header_html": "",
        "footer_html": "",
        "paper_size": "A4",
        "margin_top": margin_top,
        "margin_right": margin_right,
        "margin_bottom": margin_bottom,
        "margin_left": margin_left,
        "variables_schema": {"entity_id": entity_id},
    }


def desired_templates() -> list[dict[str, Any]]:
    return [
        document_template(
            name="Customer Quote Template",
            description="Customer-facing quote template styled after the Simpro reference, with full-bleed branded background, commercial summary, and quote-script sections.",
            filename_pattern="quote_{{ record['biz_quote.quote_number'] if record is defined and record and record['biz_quote.quote_number'] is defined and record['biz_quote.quote_number'] else 'draft' }}",
            html_file="customer_quote_template.html.jinja",
            entity_id="entity.biz_quote",
            margin_top="0mm",
            margin_right="0mm",
            margin_bottom="0mm",
            margin_left="0mm",
        ),
        document_template(
            name="Customer Order Confirmation Template",
            description="Placeholder customer-facing order confirmation for UAT. Replace the HTML once the final NLight design is ready.",
            filename_pattern="order_confirmation_{{ record['biz_order.order_number'] if record is defined and record and record['biz_order.order_number'] is defined and record['biz_order.order_number'] else 'draft' }}",
            html_file="customer_order_confirmation_placeholder.html.jinja",
            entity_id="entity.biz_order",
        ),
        document_template(
            name="Supplier Purchase Order Template",
            description="Placeholder supplier-facing purchase order for UAT. Replace the HTML once the final NLight design is ready.",
            filename_pattern="purchase_order_{{ record['biz_purchase_order.po_number'] if record is defined and record and record['biz_purchase_order.po_number'] is defined and record['biz_purchase_order.po_number'] else 'draft' }}",
            html_file="supplier_purchase_order_placeholder.html.jinja",
            entity_id="entity.biz_purchase_order",
        ),
        document_template(
            name="Customer Invoice Template",
            description="Placeholder customer-facing invoice for UAT. Replace the HTML once the final NLight design is ready.",
            filename_pattern="invoice_{{ record['biz_invoice.invoice_number'] if record is defined and record and record['biz_invoice.invoice_number'] is defined and record['biz_invoice.invoice_number'] else 'draft' }}",
            html_file="customer_invoice_placeholder.html.jinja",
            entity_id="entity.biz_invoice",
        ),
    ]


def list_templates(base_url: str, *, token: str | None, workspace_id: str | None) -> list[dict[str, Any]]:
    status, payload = api_call(
        "GET",
        f"{base_url}/documents/templates",
        token=token,
        workspace_id=workspace_id,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"list document templates failed: {collect_error_text(payload)}")
    rows = payload.get("templates")
    return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []


def create_template(base_url: str, template: dict[str, Any], *, token: str | None, workspace_id: str | None) -> dict[str, Any]:
    status, payload = api_call(
        "POST",
        f"{base_url}/documents/templates",
        token=token,
        workspace_id=workspace_id,
        body=template,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"create document template '{template.get('name')}' failed: {collect_error_text(payload)}")
    created = payload.get("template")
    if not isinstance(created, dict):
        raise RuntimeError("create document template failed: missing template payload")
    return created


def update_template(
    base_url: str,
    template_id: str,
    template: dict[str, Any],
    *,
    token: str | None,
    workspace_id: str | None,
) -> dict[str, Any]:
    status, payload = api_call(
        "POST",
        f"{base_url}/documents/templates/{template_id}",
        token=token,
        workspace_id=workspace_id,
        body=template,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"update document template '{template.get('name')}' failed: {collect_error_text(payload)}")
    updated = payload.get("template")
    if not isinstance(updated, dict):
        raise RuntimeError("update document template failed: missing template payload")
    return updated


def existing_template_key(template: dict[str, Any]) -> tuple[str, str]:
    variables = template.get("variables_schema") if isinstance(template.get("variables_schema"), dict) else {}
    entity_id = str(variables.get("entity_id") or "").strip()
    name = str(template.get("name") or "").strip().lower()
    return name, entity_id


def desired_template_key(template: dict[str, Any]) -> tuple[str, str]:
    variables = template.get("variables_schema") if isinstance(template.get("variables_schema"), dict) else {}
    return str(template.get("name") or "").strip().lower(), str(variables.get("entity_id") or "").strip()


def main() -> None:
    parser = argparse.ArgumentParser(description="Create or update Commercial V2 quote document templates.")
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
        existing_template_key(item): item
        for item in list_templates(base_url, token=token, workspace_id=workspace_id)
        if existing_template_key(item)[0]
    }

    for template in desired_templates():
        key = desired_template_key(template)
        existing = existing_by_key.get(key)
        if args.dry_run:
            action = "update" if existing else "create"
            print(f"[quote-template] {action:6} {template['name']} ({key[1]})")
            continue
        if existing and isinstance(existing.get("id"), str) and existing["id"]:
            saved = update_template(base_url, existing["id"], template, token=token, workspace_id=workspace_id)
            print(f"[quote-template] updated {template['name']} -> {saved.get('id')}")
        else:
            saved = create_template(base_url, template, token=token, workspace_id=workspace_id)
            print(f"[quote-template] created {template['name']} -> {saved.get('id')}")


if __name__ == "__main__":
    main()
