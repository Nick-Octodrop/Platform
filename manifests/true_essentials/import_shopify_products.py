#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, NamedTuple
from urllib import error as urlerror
from urllib import parse as urlparse
from urllib import request as urlrequest


GRAPHQL_PRODUCTS_QUERY = """
query ListProducts($first: Int!, $after: String) {
  products(first: $first, after: $after, sortKey: TITLE) {
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      id
      title
      handle
      descriptionHtml
      status
      onlineStoreUrl
      images(first: 20) {
        nodes {
          url
          altText
        }
      }
      variants(first: 50) {
        nodes {
          id
          title
          sku
          price
          compareAtPrice
          inventoryItem {
            id
            tracked
          }
        }
      }
    }
  }
}
""".strip()


class LocalRecord(NamedTuple):
    record_id: str
    record: dict[str, Any]


SHOPIFY_IMAGE_PURPOSE = "field:te_product.shopify_image_attachments"


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def api_call(
    method: str,
    url: str,
    *,
    token: str | None = None,
    workspace_id: str | None = None,
    body: dict[str, Any] | None = None,
    timeout: int = 120,
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
    return payload.get("ok") is True


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


def api_get_connections(base_url: str, *, token: str, workspace_id: str) -> list[dict[str, Any]]:
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
    connections = api_get_connections(base_url, token=token, workspace_id=workspace_id)
    if connection_id:
        for row in connections:
            if str(row.get("id") or "") == connection_id:
                return row
        raise RuntimeError(f"Connection not found: {connection_id}")
    if connection_name:
        matches = [row for row in connections if str(row.get("name") or "").strip() == connection_name.strip()]
        if not matches:
            raise RuntimeError(f"Connection not found by name: {connection_name}")
        if len(matches) > 1:
            raise RuntimeError(f"Multiple connections matched name: {connection_name}")
        return matches[0]
    raise RuntimeError("Either --connection-id or --connection-name is required")


def manual_connection_request(
    base_url: str,
    connection_id: str,
    *,
    token: str,
    workspace_id: str,
    body: dict[str, Any],
) -> dict[str, Any]:
    status, payload = api_call(
        "POST",
        f"{base_url}/integrations/connections/{urlparse.quote(connection_id, safe='')}/request",
        token=token,
        workspace_id=workspace_id,
        body=body,
        timeout=180,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"connection request failed: {collect_error_text(payload)}")
    result = payload.get("result")
    if not isinstance(result, dict):
        raise RuntimeError("connection request failed: missing result payload")
    return result


def list_records(
    base_url: str,
    entity_id: str,
    *,
    token: str,
    workspace_id: str,
    fields: list[str] | None = None,
    cap: int = 5000,
) -> list[LocalRecord]:
    out: list[LocalRecord] = []
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
            timeout=180,
        )
        if status >= 400 or not is_ok(payload):
            raise RuntimeError(f"list records failed for {entity_id}: {collect_error_text(payload)}")
        rows = payload.get("records")
        if not isinstance(rows, list) or not rows:
            break
        for row in rows:
            if not isinstance(row, dict):
                continue
            record_id = row.get("record_id")
            record = row.get("record")
            if isinstance(record_id, str) and record_id and isinstance(record, dict):
                out.append(LocalRecord(record_id=record_id, record=record))
        cursor = payload.get("next_cursor") if isinstance(payload.get("next_cursor"), str) else None
        if not cursor:
            break
    return out


def create_record(
    base_url: str,
    entity_id: str,
    values: dict[str, Any],
    *,
    token: str,
    workspace_id: str,
) -> LocalRecord:
    status, payload = api_call(
        "POST",
        f"{base_url}/records/{urlparse.quote(entity_id, safe='')}",
        token=token,
        workspace_id=workspace_id,
        body={"record": values},
        timeout=180,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"create {entity_id} failed: {collect_error_text(payload)}")
    record_id = payload.get("record_id")
    record = payload.get("record")
    if not isinstance(record_id, str) or not record_id:
        raise RuntimeError(f"create {entity_id} failed: missing record_id")
    if not isinstance(record, dict):
        record = values
    return LocalRecord(record_id=record_id, record=record)


def patch_record(
    base_url: str,
    entity_id: str,
    record_id: str,
    values: dict[str, Any],
    *,
    token: str,
    workspace_id: str,
) -> LocalRecord:
    status, payload = api_call(
        "PATCH",
        f"{base_url}/ext/v1/records/{urlparse.quote(entity_id, safe='')}/{urlparse.quote(record_id, safe='')}",
        token=token,
        workspace_id=workspace_id,
        body={"record": values},
        timeout=180,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"patch {entity_id}/{record_id} failed: {collect_error_text(payload)}")
    record = payload.get("record")
    if not isinstance(record, dict):
        record = values
    return LocalRecord(record_id=record_id, record=record)


def to_number(value: Any) -> float:
    if value in (None, ""):
        return 0.0
    try:
        return float(value)
    except Exception:
        return 0.0


def normalize_variant_name(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    label = value.strip()
    if not label or label.lower() == "default title":
        return ""
    return label


def slugify(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    text = value.strip().lower()
    if not text:
        return ""
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def map_local_status(shopify_status: Any) -> str:
    if not isinstance(shopify_status, str):
        return "draft"
    normalized = shopify_status.strip().upper()
    if normalized == "ACTIVE":
        return "active"
    if normalized == "ARCHIVED":
        return "archived"
    return "draft"


def guess_extension(url: str, content_type: str | None = None) -> str:
    path = urlparse.urlparse(url).path
    ext = os.path.splitext(path)[1].lower()
    if ext and len(ext) <= 6:
        return ext
    guessed = mimetypes.guess_extension((content_type or "").split(";")[0].strip()) if content_type else None
    if guessed:
        return guessed
    return ".jpg"


def build_shopify_image_filename(product: dict[str, Any], *, index: int, url: str, content_type: str | None = None) -> str:
    handle = slugify(str(product.get("handle") or ""))
    title = slugify(str(product.get("title") or ""))
    base = handle or title or "shopify-product"
    ext = guess_extension(url, content_type)
    return f"{base}-{index}{ext}"


def product_image_payloads(product: dict[str, Any]) -> list[dict[str, Any]]:
    images = ((product.get("images") or {}).get("nodes") if isinstance(product.get("images"), dict) else None) or []
    out: list[dict[str, Any]] = []
    for idx, image in enumerate(images if isinstance(images, list) else [], start=1):
        if not isinstance(image, dict):
            continue
        url = str(image.get("url") or "").strip()
        if not url:
            continue
        out.append(
            {
                "url": url,
                "alt_text": str(image.get("altText") or "").strip(),
                "filename": build_shopify_image_filename(product, index=idx, url=url),
            }
        )
    return out


def shopify_variant_payloads(product: dict[str, Any], *, shop_currency: str) -> list[dict[str, Any]]:
    title = str(product.get("title") or "").strip()
    handle = str(product.get("handle") or "").strip()
    description_html = str(product.get("descriptionHtml") or "")
    product_id = str(product.get("id") or "").strip()
    product_status = str(product.get("status") or "").strip()
    online_store_url = str(product.get("onlineStoreUrl") or "").strip()
    variants = ((product.get("variants") or {}).get("nodes") if isinstance(product.get("variants"), dict) else None) or []
    out: list[dict[str, Any]] = []
    for variant in variants if isinstance(variants, list) else []:
        if not isinstance(variant, dict):
            continue
        sku = str(variant.get("sku") or "").strip()
        if not sku:
            continue
        inventory_item = variant.get("inventoryItem") if isinstance(variant.get("inventoryItem"), dict) else {}
        out.append(
            {
                "sku": sku,
                "title": title or sku,
                "variant_name": normalize_variant_name(variant.get("title")),
                "status": map_local_status(product_status),
                "sales_currency": shop_currency,
                "retail_price": to_number(variant.get("price")),
                "compare_at_price": to_number(variant.get("compareAtPrice")),
                "track_stock": bool(inventory_item.get("tracked")),
                "shopify_product_id": product_id,
                "shopify_variant_id": str(variant.get("id") or "").strip(),
                "shopify_inventory_item_id": str(inventory_item.get("id") or "").strip(),
                "shopify_handle": handle,
                "shopify_description_html": description_html,
                "shopify_product_url": online_store_url,
                "shopify_status": product_status,
            }
        )
    return out


def product_variants(product: dict[str, Any]) -> list[dict[str, Any]]:
    variants = ((product.get("variants") or {}).get("nodes") if isinstance(product.get("variants"), dict) else None) or []
    return [item for item in variants if isinstance(item, dict)]


def build_create_values(imported: dict[str, Any]) -> dict[str, Any]:
    values: dict[str, Any] = {
        "te_product.sku": imported["sku"],
        "te_product.title": imported["title"],
        "te_product.status": imported["status"],
        "te_product.sales_currency": imported["sales_currency"],
        "te_product.retail_price": imported["retail_price"],
        "te_product.compare_at_price": imported["compare_at_price"],
        "te_product.track_stock": imported["track_stock"],
        "te_product.shopify_handle": imported["shopify_handle"],
        "te_product.shopify_description_html": imported["shopify_description_html"],
        "te_product.shopify_product_url": imported["shopify_product_url"],
        "te_product.shopify_product_id": imported["shopify_product_id"],
        "te_product.shopify_variant_id": imported["shopify_variant_id"],
        "te_product.shopify_inventory_item_id": imported["shopify_inventory_item_id"],
        "te_product.shopify_status": imported["shopify_status"],
        "te_product.shopify_last_sync_status": "imported",
        "te_product.shopify_last_sync_at": now_iso(),
        "te_product.shopify_last_sync_error": "",
    }
    if imported["variant_name"]:
        values["te_product.variant_name"] = imported["variant_name"]
    return values


def build_update_values(existing: dict[str, Any], imported: dict[str, Any], *, overwrite_local: bool) -> dict[str, Any]:
    merged: dict[str, Any] = {
        "te_product.sales_currency": imported["sales_currency"],
        "te_product.retail_price": imported["retail_price"],
        "te_product.compare_at_price": imported["compare_at_price"],
        "te_product.shopify_handle": imported["shopify_handle"],
        "te_product.shopify_description_html": imported["shopify_description_html"],
        "te_product.shopify_product_url": imported["shopify_product_url"],
        "te_product.shopify_product_id": imported["shopify_product_id"],
        "te_product.shopify_variant_id": imported["shopify_variant_id"],
        "te_product.shopify_inventory_item_id": imported["shopify_inventory_item_id"],
        "te_product.shopify_status": imported["shopify_status"],
        "te_product.shopify_last_sync_status": "imported",
        "te_product.shopify_last_sync_at": now_iso(),
        "te_product.shopify_last_sync_error": "",
    }
    if overwrite_local or not str(existing.get("te_product.title") or "").strip():
        merged["te_product.title"] = imported["title"]
    if imported["variant_name"] and (overwrite_local or not str(existing.get("te_product.variant_name") or "").strip()):
        merged["te_product.variant_name"] = imported["variant_name"]
    if overwrite_local:
        merged["te_product.track_stock"] = imported["track_stock"]
        merged["te_product.status"] = imported["status"]
    return merged


def apply_local_patch(existing: LocalRecord, patch: dict[str, Any]) -> LocalRecord:
    merged = dict(existing.record)
    merged.update(patch)
    return LocalRecord(record_id=existing.record_id, record=merged)


def load_existing_products(base_url: str, *, token: str, workspace_id: str) -> list[LocalRecord]:
    return list_records(
        base_url,
        "entity.te_product",
        token=token,
        workspace_id=workspace_id,
        fields=[
            "te_product.sku",
            "te_product.title",
            "te_product.variant_name",
            "te_product.status",
            "te_product.retail_price",
            "te_product.compare_at_price",
            "te_product.track_stock",
            "te_product.shopify_handle",
            "te_product.shopify_description_html",
            "te_product.shopify_product_url",
            "te_product.shopify_product_id",
            "te_product.shopify_variant_id",
            "te_product.shopify_inventory_item_id",
            "te_product.shopify_status",
            "te_product.shopify_last_sync_status",
            "te_product.shopify_last_sync_at",
            "te_product.shopify_last_sync_error",
        ],
    )


def index_records(records: list[LocalRecord]) -> tuple[dict[str, LocalRecord], dict[str, LocalRecord], set[str]]:
    by_variant_id: dict[str, LocalRecord] = {}
    by_sku: dict[str, LocalRecord] = {}
    duplicate_skus: set[str] = set()
    for row in records:
        variant_id = str(row.record.get("te_product.shopify_variant_id") or "").strip()
        if variant_id:
            by_variant_id[variant_id] = row
        sku = str(row.record.get("te_product.sku") or "").strip()
        if not sku:
            continue
        if sku in by_sku:
            duplicate_skus.add(sku)
        else:
            by_sku[sku] = row
    return by_variant_id, by_sku, duplicate_skus


def fetch_shopify_products_page(
    base_url: str,
    connection_id: str,
    *,
    token: str,
    workspace_id: str,
    cursor: str | None,
    page_size: int,
) -> tuple[list[dict[str, Any]], str | None, bool]:
    result = manual_connection_request(
        base_url,
        connection_id,
        token=token,
        workspace_id=workspace_id,
        body={
            "method": "POST",
            "path": "/graphql.json",
            "headers": {
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            "json": {
                "query": GRAPHQL_PRODUCTS_QUERY,
                "variables": {
                    "first": page_size,
                    "after": cursor,
                },
            },
        },
    )
    body_json = result.get("body_json") if isinstance(result.get("body_json"), dict) else {}
    if isinstance(body_json.get("errors"), list) and body_json.get("errors"):
        first_error = body_json["errors"][0]
        raise RuntimeError(f"Shopify GraphQL error: {first_error.get('message') if isinstance(first_error, dict) else first_error}")
    data = body_json.get("data") if isinstance(body_json.get("data"), dict) else {}
    products = data.get("products") if isinstance(data, dict) and isinstance(data.get("products"), dict) else {}
    nodes = products.get("nodes") if isinstance(products, dict) and isinstance(products.get("nodes"), list) else []
    page_info = products.get("pageInfo") if isinstance(products, dict) and isinstance(products.get("pageInfo"), dict) else {}
    next_cursor = page_info.get("endCursor") if isinstance(page_info.get("endCursor"), str) else None
    has_next = bool(page_info.get("hasNextPage"))
    return [item for item in nodes if isinstance(item, dict)], next_cursor, has_next


def list_record_attachments(
    base_url: str,
    entity_id: str,
    record_id: str,
    *,
    token: str,
    workspace_id: str,
    purpose: str,
) -> list[dict[str, Any]]:
    status, payload = api_call(
        "GET",
        f"{base_url}/ext/v1/records/{urlparse.quote(entity_id, safe='')}/{urlparse.quote(record_id, safe='')}/attachments?purpose={urlparse.quote(purpose, safe='')}",
        token=token,
        workspace_id=workspace_id,
        timeout=180,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"list attachments failed for {entity_id}/{record_id}: {collect_error_text(payload)}")
    rows = payload.get("attachments")
    return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []


def upload_attachment_bytes(
    base_url: str,
    *,
    token: str,
    workspace_id: str,
    filename: str,
    data: bytes,
    mime_type: str,
) -> dict[str, Any]:
    boundary = f"----octodrop-{uuid.uuid4().hex}"
    crlf = b"\r\n"
    body = b"".join(
        [
            f"--{boundary}".encode("utf-8"),
            crlf,
            f'Content-Disposition: form-data; name="file"; filename="{filename}"'.encode("utf-8"),
            crlf,
            f"Content-Type: {mime_type}".encode("utf-8"),
            crlf,
            crlf,
            data,
            crlf,
            f"--{boundary}--".encode("utf-8"),
            crlf,
        ]
    )
    headers = {
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "Authorization": f"Bearer {token}",
        "X-Workspace-Id": workspace_id,
    }
    req = urlrequest.Request(
        f"{base_url}/ext/v1/attachments/upload",
        method="POST",
        headers=headers,
        data=body,
    )
    try:
        with urlrequest.urlopen(req, timeout=180) as resp:
            raw = resp.read()
            payload = json.loads(raw.decode("utf-8")) if raw else {}
    except urlerror.HTTPError as exc:
        raw = exc.read()
        try:
            payload = json.loads(raw.decode("utf-8")) if raw else {}
        except Exception:
            payload = {"ok": False, "errors": [{"message": raw.decode("utf-8", errors="replace")}]}
    if not isinstance(payload, dict) or not is_ok(payload):
        raise RuntimeError(f"attachment upload failed: {collect_error_text(payload if isinstance(payload, dict) else {})}")
    attachment = payload.get("attachment")
    if not isinstance(attachment, dict):
        raise RuntimeError("attachment upload failed: missing attachment payload")
    return attachment


def link_attachment_to_record(
    base_url: str,
    attachment_id: str,
    *,
    token: str,
    workspace_id: str,
    entity_id: str,
    record_id: str,
    purpose: str,
) -> None:
    status, payload = api_call(
        "POST",
        f"{base_url}/ext/v1/attachments/link",
        token=token,
        workspace_id=workspace_id,
        body={
            "attachment_id": attachment_id,
            "entity_id": entity_id,
            "record_id": record_id,
            "purpose": purpose,
        },
        timeout=180,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"attachment link failed: {collect_error_text(payload)}")


def download_binary(url: str, *, timeout: int = 180) -> tuple[bytes, str | None]:
    req = urlrequest.Request(url, headers={"User-Agent": "Octodrop Shopify Importer"})
    with urlrequest.urlopen(req, timeout=timeout) as resp:
        data = resp.read()
        content_type = resp.headers.get("Content-Type")
        return data, content_type


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import Shopify products into the True Essentials catalog without overwriting the store.")
    parser.add_argument("--base-url", default=os.environ.get("OCTO_BASE_URL", "https://octodrop-platform-api.fly.dev"))
    parser.add_argument("--api-token", default=os.environ.get("OCTO_API_TOKEN"))
    parser.add_argument("--workspace-id", default=os.environ.get("OCTO_WORKSPACE_ID"))
    parser.add_argument("--connection-id", default=os.environ.get("OCTO_SHOPIFY_CONNECTION_ID"))
    parser.add_argument("--connection-name", default=os.environ.get("OCTO_SHOPIFY_CONNECTION_NAME"))
    parser.add_argument("--page-size", type=int, default=25)
    parser.add_argument("--max-products", type=int, default=500)
    parser.add_argument("--overwrite-local", action="store_true", help="Allow Shopify title/price/status values to overwrite populated Octodrop fields.")
    parser.add_argument("--import-images", action="store_true", help="Also import Shopify product images into te_product.shopify_image_attachments.")
    parser.add_argument("--dry-run", action="store_true", help="Show what would change without writing records.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.api_token:
        raise RuntimeError("Missing OCTO_API_TOKEN or --api-token")
    if not args.workspace_id:
        raise RuntimeError("Missing OCTO_WORKSPACE_ID or --workspace-id")
    connection = resolve_connection(
        args.base_url,
        token=args.api_token,
        workspace_id=args.workspace_id,
        connection_id=args.connection_id,
        connection_name=args.connection_name,
    )
    connection_id = str(connection.get("id") or "").strip()
    if not connection_id:
        raise RuntimeError("Resolved connection is missing id")
    config = connection.get("config") if isinstance(connection.get("config"), dict) else {}
    shop_currency = str(config.get("shopify_shop_currency") or "NZD").strip() or "NZD"
    if shop_currency != "NZD":
        print(f"[warn] Shopify shop currency is {shop_currency}; te_catalog currently defaults retail currency to NZD.")
        shop_currency = "NZD"

    existing_rows = load_existing_products(args.base_url, token=args.api_token, workspace_id=args.workspace_id)
    by_variant_id, by_sku, duplicate_skus = index_records(existing_rows)
    if duplicate_skus:
        print(f"[warn] duplicate local SKUs found; SKU-only linking will skip {len(duplicate_skus)} ambiguous SKU(s)")

    created = 0
    updated = 0
    scanned_store_variants = 0
    skipped_missing_sku = 0
    skipped_conflicts = 0
    scanned_products = 0
    scanned_variants = 0
    scanned_product_images = 0
    attached_images = 0
    skipped_existing_images = 0
    image_errors = 0
    cursor: str | None = None
    image_download_cache: dict[str, tuple[bytes, str | None]] = {}

    while scanned_products < args.max_products:
        products, cursor, has_next = fetch_shopify_products_page(
            args.base_url,
            connection_id,
            token=args.api_token,
            workspace_id=args.workspace_id,
            cursor=cursor,
            page_size=max(1, min(100, args.page_size)),
        )
        if not products:
            break
        for product in products:
            scanned_products += 1
            product_images = product_image_payloads(product)
            scanned_product_images += len(product_images)
            all_variants = product_variants(product)
            scanned_store_variants += len(all_variants)
            for variant in all_variants:
                sku = str(variant.get("sku") or "").strip()
                if not sku:
                    skipped_missing_sku += 1
            for imported in shopify_variant_payloads(product, shop_currency=shop_currency):
                scanned_variants += 1
                sku = imported["sku"]
                variant_id = imported["shopify_variant_id"]
                existing = by_variant_id.get(variant_id)
                if existing is None and sku not in duplicate_skus:
                    existing = by_sku.get(sku)

                if existing is not None:
                    existing_variant_id = str(existing.record.get("te_product.shopify_variant_id") or "").strip()
                    if existing_variant_id and existing_variant_id != variant_id:
                        skipped_conflicts += 1
                        print(f"[skip] SKU {sku} already linked to {existing_variant_id}, not relinking to {variant_id}")
                        continue
                    values = build_update_values(existing.record, imported, overwrite_local=args.overwrite_local)
                    if args.dry_run:
                        print(f"[dry-run] update {existing.record_id} sku={sku} product={imported['title']}")
                    else:
                        saved = patch_record(
                            args.base_url,
                            "entity.te_product",
                            existing.record_id,
                            values,
                            token=args.api_token,
                            workspace_id=args.workspace_id,
                        )
                        existing = saved
                    if args.dry_run:
                        existing = apply_local_patch(existing, values)
                    by_variant_id[variant_id] = existing
                    if sku not in duplicate_skus:
                        by_sku[sku] = existing
                    updated += 1
                    if args.import_images:
                        try:
                            existing_attachments: list[dict[str, Any]] = []
                            if not args.dry_run:
                                existing_attachments = list_record_attachments(
                                    args.base_url,
                                    "entity.te_product",
                                    existing.record_id,
                                    token=args.api_token,
                                    workspace_id=args.workspace_id,
                                    purpose=SHOPIFY_IMAGE_PURPOSE,
                                )
                            existing_filenames = {
                                str(item.get("filename") or "").strip().lower()
                                for item in existing_attachments
                                if isinstance(item, dict) and str(item.get("filename") or "").strip()
                            }
                            for image in product_images:
                                filename = str(image.get("filename") or "").strip()
                                if not filename:
                                    continue
                                if filename.lower() in existing_filenames:
                                    skipped_existing_images += 1
                                    continue
                                if args.dry_run:
                                    print(f"[dry-run] attach image {filename} -> {existing.record_id}")
                                    attached_images += 1
                                    existing_filenames.add(filename.lower())
                                    continue
                                url = str(image.get("url") or "").strip()
                                if not url:
                                    continue
                                cached = image_download_cache.get(url)
                                if cached is None:
                                    cached = download_binary(url)
                                    image_download_cache[url] = cached
                                data, content_type = cached
                                attachment = upload_attachment_bytes(
                                    args.base_url,
                                    token=args.api_token,
                                    workspace_id=args.workspace_id,
                                    filename=filename,
                                    data=data,
                                    mime_type=(content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream").split(";")[0].strip(),
                                )
                                link_attachment_to_record(
                                    args.base_url,
                                    str(attachment.get("id") or ""),
                                    token=args.api_token,
                                    workspace_id=args.workspace_id,
                                    entity_id="entity.te_product",
                                    record_id=existing.record_id,
                                    purpose=SHOPIFY_IMAGE_PURPOSE,
                                )
                                attached_images += 1
                                existing_filenames.add(filename.lower())
                        except Exception as exc:
                            image_errors += 1
                            print(f"[warn] image import failed for {sku}: {exc}")
                    continue

                values = build_create_values(imported)
                if args.dry_run:
                    print(f"[dry-run] create sku={sku} product={imported['title']}")
                    created += 1
                    if args.import_images:
                        for image in product_images:
                            filename = str(image.get("filename") or "").strip()
                            if filename:
                                print(f"[dry-run] attach image {filename} -> <new record sku={sku}>")
                                attached_images += 1
                    continue
                saved = create_record(
                    args.base_url,
                    "entity.te_product",
                    values,
                    token=args.api_token,
                    workspace_id=args.workspace_id,
                )
                print(f"[create] {saved.record_id} sku={sku} product={imported['title']}")
                by_variant_id[variant_id] = saved
                if sku not in duplicate_skus:
                    by_sku[sku] = saved
                created += 1
                if args.import_images:
                    try:
                        existing_filenames: set[str] = set()
                        for image in product_images:
                            filename = str(image.get("filename") or "").strip()
                            url = str(image.get("url") or "").strip()
                            if not filename or not url:
                                continue
                            if filename.lower() in existing_filenames:
                                skipped_existing_images += 1
                                continue
                            cached = image_download_cache.get(url)
                            if cached is None:
                                cached = download_binary(url)
                                image_download_cache[url] = cached
                            data, content_type = cached
                            attachment = upload_attachment_bytes(
                                args.base_url,
                                token=args.api_token,
                                workspace_id=args.workspace_id,
                                filename=filename,
                                data=data,
                                mime_type=(content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream").split(";")[0].strip(),
                            )
                            link_attachment_to_record(
                                args.base_url,
                                str(attachment.get("id") or ""),
                                token=args.api_token,
                                workspace_id=args.workspace_id,
                                entity_id="entity.te_product",
                                record_id=saved.record_id,
                                purpose=SHOPIFY_IMAGE_PURPOSE,
                            )
                            attached_images += 1
                            existing_filenames.add(filename.lower())
                    except Exception as exc:
                        image_errors += 1
                        print(f"[warn] image import failed for {sku}: {exc}")
            if scanned_products >= args.max_products:
                break
        if not has_next or scanned_products >= args.max_products:
            break

    print(
        json.dumps(
            {
                "connection_id": connection_id,
                "scanned_products": scanned_products,
                "scanned_store_variants": scanned_store_variants,
                "scanned_importable_variants": scanned_variants,
                "created": created,
                "updated": updated,
                "skipped_missing_sku": skipped_missing_sku,
                "skipped_conflicts": skipped_conflicts,
                "scanned_product_images": scanned_product_images,
                "attached_images": attached_images,
                "skipped_existing_images": skipped_existing_images,
                "image_errors": image_errors,
                "import_images": bool(args.import_images),
                "dry_run": bool(args.dry_run),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
