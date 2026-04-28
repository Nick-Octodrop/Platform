#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import socket
import sys
from dataclasses import dataclass
from typing import Any
from urllib import error as urlerror
from urllib import parse as urlparse
from urllib import request as urlrequest


ENTITY_ID = "entity.biz_document"


@dataclass(frozen=True)
class SourceConfig:
    entity_id: str
    entity_label: str
    attachment_field: str
    display_field: str


LEGACY_SOURCE_FIELDS: tuple[tuple[str, SourceConfig], ...] = (
    ("biz_document.related_quote_id", SourceConfig("entity.biz_quote", "Quote", "biz_quote.generated_files", "biz_quote.quote_number")),
    ("biz_document.related_order_id", SourceConfig("entity.biz_order", "Order", "biz_order.generated_files", "biz_order.order_number")),
    (
        "biz_document.related_purchase_order_id",
        SourceConfig("entity.biz_purchase_order", "Purchase Order", "biz_purchase_order.generated_files", "biz_purchase_order.po_number"),
    ),
    ("biz_document.related_invoice_id", SourceConfig("entity.biz_invoice", "Invoice", "biz_invoice.generated_files", "biz_invoice.invoice_number")),
)


SOURCE_BY_ENTITY_ID = {item.entity_id: item for _, item in LEGACY_SOURCE_FIELDS}


def preferred_legacy_fields_for_document_type(document_type: str | None) -> list[str]:
    ordered = {
        "quote_pdf": ["biz_document.related_quote_id"],
        "order_confirmation": ["biz_document.related_order_id"],
        "purchase_order_pdf": ["biz_document.related_purchase_order_id", "biz_document.related_order_id"],
        "invoice_pdf": ["biz_document.related_invoice_id", "biz_document.related_order_id"],
        "supplier_document": ["biz_document.related_purchase_order_id", "biz_document.related_order_id"],
        "shipping_document": ["biz_document.related_order_id", "biz_document.related_purchase_order_id"],
    }.get(document_type or "", [])
    return [*ordered, *[field_id for field_id, _ in LEGACY_SOURCE_FIELDS if field_id not in ordered]]


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


def list_records(base_url: str, *, token: str | None, workspace_id: str | None, limit: int = 200) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    cursor: str | None = None
    while True:
        params = {"limit": limit}
        if cursor:
            params["cursor"] = cursor
        status, payload = api_call(
            "GET",
            f"{base_url}/records/{urlparse.quote(ENTITY_ID, safe='')}?{urlparse.urlencode(params)}",
            token=token,
            workspace_id=workspace_id,
        )
        if status >= 400 or not is_ok(payload):
            raise RuntimeError(f"list documents failed: {collect_error_text(payload)}")
        batch = payload.get("records")
        if isinstance(batch, list):
            rows.extend(item for item in batch if isinstance(item, dict))
        cursor = payload.get("next_cursor") if isinstance(payload.get("next_cursor"), str) and payload.get("next_cursor") else None
        if not cursor:
            break
    return rows


def fetch_record(
    base_url: str,
    entity_id: str,
    record_id: str,
    *,
    token: str | None,
    workspace_id: str | None,
    cache: dict[tuple[str, str], dict[str, Any] | None],
) -> dict[str, Any] | None:
    cache_key = (entity_id, record_id)
    if cache_key in cache:
        return cache[cache_key]
    status, payload = api_call(
        "GET",
        f"{base_url}/records/{urlparse.quote(entity_id, safe='')}/{urlparse.quote(record_id, safe='')}",
        token=token,
        workspace_id=workspace_id,
    )
    if status >= 400 or not is_ok(payload):
        cache[cache_key] = None
        return None
    record = payload.get("record")
    cache[cache_key] = record if isinstance(record, dict) else None
    return cache[cache_key]


def update_record(
    base_url: str,
    record_id: str,
    record: dict[str, Any],
    *,
    token: str | None,
    workspace_id: str | None,
) -> None:
    status, payload = api_call(
        "PUT",
        f"{base_url}/records/{urlparse.quote(ENTITY_ID, safe='')}/{urlparse.quote(record_id, safe='')}",
        token=token,
        workspace_id=workspace_id,
        body={"record": record},
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"update document {record_id} failed: {collect_error_text(payload)}")


def first_attachment(value: Any) -> dict[str, Any] | None:
    if isinstance(value, list):
        for item in value:
            found = first_attachment(item)
            if isinstance(found, dict):
                return found
        return None
    if isinstance(value, dict):
        return value
    return None


def file_extension(filename: Any) -> str:
    if not isinstance(filename, str):
        return ""
    trimmed = filename.strip()
    if not trimmed or "." not in trimmed:
        return ""
    return trimmed.rsplit(".", 1)[-1].strip().lower()


def nonempty_str(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def derive_source_patch(
    base_url: str,
    record: dict[str, Any],
    *,
    token: str | None,
    workspace_id: str | None,
    source_cache: dict[tuple[str, str], dict[str, Any] | None],
) -> dict[str, Any]:
    patch: dict[str, Any] = {}
    current_contact_id = nonempty_str(record.get("biz_document.contact_id"))
    if not current_contact_id:
        legacy_contact_id = nonempty_str(record.get("biz_document.related_contact_id"))
        if legacy_contact_id:
            patch["biz_document.contact_id"] = legacy_contact_id

    source_entity_id = nonempty_str(record.get("biz_document.source_entity_id"))
    source_entity_label = nonempty_str(record.get("biz_document.source_entity_label"))
    source_record_id = nonempty_str(record.get("biz_document.source_record_id"))
    source_record_label = nonempty_str(record.get("biz_document.source_record_label"))
    source_field_id = nonempty_str(record.get("biz_document.source_field_id"))
    ordered_legacy_fields = preferred_legacy_fields_for_document_type(nonempty_str(record.get("biz_document.document_type")))

    source_config: SourceConfig | None = None
    if not source_entity_id or not source_record_id:
        legacy_config_by_field = {field_id: config for field_id, config in LEGACY_SOURCE_FIELDS}
        for legacy_field_id in ordered_legacy_fields:
            legacy_config = legacy_config_by_field[legacy_field_id]
            legacy_record_id = nonempty_str(record.get(legacy_field_id))
            if not legacy_record_id:
                continue
            source_entity_id = source_entity_id or legacy_config.entity_id
            source_entity_label = source_entity_label or legacy_config.entity_label
            source_record_id = source_record_id or legacy_record_id
            source_field_id = source_field_id or legacy_config.attachment_field
            source_config = legacy_config
            break
    if not source_config and source_entity_id:
        source_config = SOURCE_BY_ENTITY_ID.get(source_entity_id)
    if source_entity_id and nonempty_str(record.get("biz_document.source_entity_id")) != source_entity_id:
        patch["biz_document.source_entity_id"] = source_entity_id
    if source_entity_label and nonempty_str(record.get("biz_document.source_entity_label")) != source_entity_label:
        patch["biz_document.source_entity_label"] = source_entity_label
    if source_record_id and nonempty_str(record.get("biz_document.source_record_id")) != source_record_id:
        patch["biz_document.source_record_id"] = source_record_id
    if source_field_id and nonempty_str(record.get("biz_document.source_field_id")) != source_field_id:
        patch["biz_document.source_field_id"] = source_field_id
    if source_config and source_record_id and not source_record_label:
        source_record = fetch_record(
            base_url,
            source_config.entity_id,
            source_record_id,
            token=token,
            workspace_id=workspace_id,
            cache=source_cache,
        )
        if isinstance(source_record, dict):
            source_record_label = nonempty_str(source_record.get(source_config.display_field))
    if source_record_label and nonempty_str(record.get("biz_document.source_record_label")) != source_record_label:
        patch["biz_document.source_record_label"] = source_record_label
    return patch


def derive_file_patch(record: dict[str, Any]) -> dict[str, Any]:
    patch: dict[str, Any] = {}
    attachment = first_attachment(record.get("biz_document.attachments"))
    filename = attachment.get("filename") if isinstance(attachment, dict) and isinstance(attachment.get("filename"), str) else ""
    mime_type = attachment.get("mime_type") if isinstance(attachment, dict) and isinstance(attachment.get("mime_type"), str) else ""
    extension = file_extension(filename)
    for field_id, expected_value in (
        ("biz_document.file_name", filename),
        ("biz_document.file_extension", extension),
        ("biz_document.mime_type", mime_type),
    ):
        current_value = record.get(field_id)
        current_text = current_value if isinstance(current_value, str) else ""
        if current_text != expected_value:
            patch[field_id] = expected_value
    return patch


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill generic document registry metadata for biz_document records.")
    parser.add_argument("--base-url", default=os.getenv("OCTO_BASE_URL", "http://localhost:8000"))
    parser.add_argument("--token", default=os.getenv("OCTO_API_TOKEN"))
    parser.add_argument("--workspace-id", default=os.getenv("OCTO_WORKSPACE_ID"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not args.base_url:
        raise SystemExit("Missing base URL. Set OCTO_BASE_URL or pass --base-url.")
    if not args.token:
        raise SystemExit("Missing API token. Set OCTO_API_TOKEN or pass --token.")

    base_url = args.base_url.rstrip("/")
    source_cache: dict[tuple[str, str], dict[str, Any] | None] = {}
    rows = list_records(base_url, token=args.token, workspace_id=args.workspace_id)

    updated = 0
    inspected = 0
    for row in rows:
        record_id = nonempty_str(row.get("record_id") or row.get("id"))
        record = row.get("record") if isinstance(row.get("record"), dict) else row
        if not record_id or not isinstance(record, dict):
            continue
        inspected += 1
        patch = {}
        patch.update(
            derive_source_patch(
                base_url,
                record,
                token=args.token,
                workspace_id=args.workspace_id,
                source_cache=source_cache,
            )
        )
        patch.update(derive_file_patch(record))
        if not patch:
            continue
        next_record = dict(record)
        next_record.update(patch)
        if args.dry_run:
            print(f"[dry-run] would update {record_id}: {sorted(patch.keys())}")
        else:
            update_record(base_url, record_id, next_record, token=args.token, workspace_id=args.workspace_id)
            print(f"[documents] updated {record_id}: {sorted(patch.keys())}")
        updated += 1

    action = "would update" if args.dry_run else "updated"
    print(f"[documents] inspected {inspected} records, {action} {updated}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
