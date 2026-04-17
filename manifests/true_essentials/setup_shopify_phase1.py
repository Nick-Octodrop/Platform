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


def merge_request_templates(existing: list[dict[str, Any]], desired: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id: dict[str, dict[str, Any]] = {}
    ordered_ids: list[str] = []
    for item in existing:
        if not isinstance(item, dict):
            continue
        template_id = str(item.get("id") or "").strip()
        if not template_id:
            continue
        by_id[template_id] = item
        ordered_ids.append(template_id)
    for item in desired:
        template_id = str(item.get("id") or "").strip()
        if not template_id:
            continue
        if template_id not in by_id:
            ordered_ids.append(template_id)
        by_id[template_id] = item
    return [by_id[template_id] for template_id in ordered_ids if template_id in by_id]


def update_record_step(
    step_id: str,
    *,
    record_id: str,
    patch: dict[str, Any],
) -> dict[str, Any]:
    return {
        "id": step_id,
        "kind": "action",
        "action_id": "system.update_record",
        "inputs": {
            "entity_id": "entity.te_product",
            "record_id": record_id,
            "patch": patch,
        },
    }


def build_request_templates() -> list[dict[str, Any]]:
    return [
        {
            "id": "shopify_graphql_product_set",
            "name": "Shopify: Upsert product with productSet",
            "method": "POST",
            "path": "/graphql.json",
            "headers": {
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            "query": {},
        },
        {
            "id": "shopify_graphql_inventory_set_quantities",
            "name": "Shopify: Set inventory quantities",
            "method": "POST",
            "path": "/graphql.json",
            "headers": {
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            "query": {},
        },
    ]


def build_product_push_body_template(default_vendor: str | None) -> str:
    vendor_block = ""
    if default_vendor:
        vendor_block = f'      "vendor": {json.dumps(default_vendor)},\n'
    template = """{
  "query": "mutation UpsertProduct($input: ProductSetInput!, $identifier: ProductSetIdentifiers, $synchronous: Boolean!) { productSet(synchronous: $synchronous, input: $input, identifier: $identifier) { product { id handle status onlineStoreUrl onlineStorePreviewUrl variants(first: 5) { nodes { id title sku price compareAtPrice inventoryItem { id tracked } } } } userErrors { field message } } }",
  "variables": {
    "synchronous": true,
    "identifier": {
{% if trigger.record.fields.shopify_product_id %}
      "id": {{ trigger.record.fields.shopify_product_id | tojson }}
{% else %}
      "handle": {% if trigger.record.fields.shopify_handle %}{{ trigger.record.fields.shopify_handle | slugify | tojson }}{% elif trigger.record.fields.sku %}{{ trigger.record.fields.sku | slugify | tojson }}{% else %}{{ trigger.record.fields.title | slugify | tojson }}{% endif %}
{% endif %}
    },
    "input": {
      "title": {{ trigger.record.fields.title | tojson }},
      "handle": {% if trigger.record.fields.shopify_handle %}{{ trigger.record.fields.shopify_handle | slugify | tojson }}{% elif trigger.record.fields.sku %}{{ trigger.record.fields.sku | slugify | tojson }}{% else %}{{ trigger.record.fields.title | slugify | tojson }}{% endif %},
      "descriptionHtml": {{ trigger.record.fields.shopify_description_html | default('', true) | tojson }},
__DEFAULT_VENDOR_BLOCK__{% if trigger.record.fields.shopify_status %}
      "status": {{ trigger.record.fields.shopify_status | upper | tojson }},
{% elif trigger.record.fields.status == 'active' %}
      "status": "ACTIVE",
{% elif trigger.record.fields.status == 'archived' %}
      "status": "ARCHIVED",
{% else %}
      "status": "DRAFT",
{% endif %}
      "productOptions": [
        {
          "name": {% if trigger.record.fields.variant_name %}"Variant"{% else %}"Title"{% endif %},
          "position": 1,
          "values": [
            {
              "name": {% if trigger.record.fields.variant_name %}{{ trigger.record.fields.variant_name | tojson }}{% else %}"Default Title"{% endif %}
            }
          ]
        }
      ],
      "variants": [
        {
          "optionValues": [
            {
              "optionName": {% if trigger.record.fields.variant_name %}"Variant"{% else %}"Title"{% endif %},
              "name": {% if trigger.record.fields.variant_name %}{{ trigger.record.fields.variant_name | tojson }}{% else %}"Default Title"{% endif %}
            }
          ],
          "sku": {{ trigger.record.fields.sku | tojson }},
          "price": {{ trigger.record.fields.retail_price | default(0) | float }},
          "compareAtPrice": {% if trigger.record.fields.compare_at_price and trigger.record.fields.compare_at_price > trigger.record.fields.retail_price %}{{ trigger.record.fields.compare_at_price | float }}{% else %}null{% endif %},
          "inventoryItem": {
            "tracked": {% if trigger.record.fields.track_stock %}true{% else %}false{% endif %}
          }
        }
      ]
    }
  }
}"""
    return template.replace("__DEFAULT_VENDOR_BLOCK__", vendor_block)


def build_inventory_push_body_template(location_id: str) -> str:
    return """{
  "query": "mutation SetInventory($input: InventorySetQuantitiesInput!) { inventorySetQuantities(input: $input) { inventoryAdjustmentGroup { id } userErrors { code field message } } }",
  "variables": {
    "input": {
      "name": "available",
      "reason": "correction",
      "referenceDocumentUri": {{ ("gid://octodrop/te_product/" ~ trigger.record_id) | tojson }},
      "quantities": [
        {
          "inventoryItemId": {{ trigger.record.fields.shopify_inventory_item_id | tojson }},
          "locationId": __LOCATION_ID_JSON__,
          "quantity": {% if trigger.record.fields.stock_available and trigger.record.fields.stock_available > 0 %}{{ trigger.record.fields.stock_available | int }}{% else %}0{% endif %},
          "changeFromQuantity": null
        }
      ]
    }
  }
}""".replace("__LOCATION_ID_JSON__", json.dumps(location_id))


def build_push_automation(*, connection_id: str, status: str, default_vendor: str | None) -> dict[str, Any]:
    timestamp_ref = "{{ trigger.timestamp }}"
    body_template = build_product_push_body_template(default_vendor)
    return {
        "name": "Shopify Phase 1 - Push Products",
        "description": "Manual push from the True Essentials catalog into Shopify using the productSet GraphQL mutation.",
        "status": status,
        "trigger": {
            "kind": "event",
            "event_types": ["action.clicked"],
            "filters": [
                {"path": "entity_id", "op": "eq", "value": "entity.te_product"},
                {"path": "action_id", "op": "eq", "value": "action.te_product_push_shopify"},
            ],
        },
        "steps": [
            {
                "id": "title_present",
                "kind": "condition",
                "expr": {"op": "exists", "left": {"var": "trigger.record.fields.title"}},
                "stop_on_false": True,
                "else_steps": [
                    update_record_step(
                        "mark_missing_title",
                        record_id="{{ trigger.record_id }}",
                        patch={
                            "te_product.shopify_last_sync_status": "error",
                            "te_product.shopify_last_sync_at": timestamp_ref,
                            "te_product.shopify_last_sync_error": "Product title is required before pushing to Shopify.",
                        },
                    )
                ],
            },
            {
                "id": "sku_present",
                "kind": "condition",
                "expr": {"op": "exists", "left": {"var": "trigger.record.fields.sku"}},
                "stop_on_false": True,
                "else_steps": [
                    update_record_step(
                        "mark_missing_sku",
                        record_id="{{ trigger.record_id }}",
                        patch={
                            "te_product.shopify_last_sync_status": "error",
                            "te_product.shopify_last_sync_at": timestamp_ref,
                            "te_product.shopify_last_sync_error": "SKU is required before pushing to Shopify.",
                        },
                    )
                ],
            },
            {
                "id": "push_shopify_product",
                "kind": "action",
                "action_id": "system.integration_request",
                "store_as": "push_shopify_product",
                "inputs": {
                    "connection_id": connection_id,
                    "template_id": "shopify_graphql_product_set",
                    "body": body_template,
                },
            },
            {
                "id": "graphql_errors_found",
                "kind": "condition",
                "expr": {
                    "op": "any",
                    "over": {"var": "steps.push_shopify_product.body_json.errors"},
                    "where": {"op": "exists", "left": {"var": "item.message"}},
                },
                "then_steps": [
                    update_record_step(
                        "mark_graphql_error",
                        record_id="{{ trigger.record_id }}",
                        patch={
                            "te_product.shopify_last_sync_status": "error",
                            "te_product.shopify_last_sync_at": timestamp_ref,
                            "te_product.shopify_last_sync_error": "{{ steps.push_shopify_product.body_json.errors[0].message | default('Shopify GraphQL request failed.') }}",
                        },
                    )
                ],
                "else_steps": [
                    {
                        "id": "user_errors_found",
                        "kind": "condition",
                        "expr": {
                            "op": "any",
                            "over": {"var": "steps.push_shopify_product.body_json.data.productSet.userErrors"},
                            "where": {"op": "exists", "left": {"var": "item.message"}},
                        },
                        "then_steps": [
                            update_record_step(
                                "mark_user_error",
                                record_id="{{ trigger.record_id }}",
                                patch={
                                    "te_product.shopify_last_sync_status": "error",
                                    "te_product.shopify_last_sync_at": timestamp_ref,
                                    "te_product.shopify_last_sync_error": "{{ steps.push_shopify_product.body_json.data.productSet.userErrors[0].message | default('Shopify productSet returned a validation error.') }}",
                                },
                            )
                        ],
                        "else_steps": [
                            {
                                "id": "product_saved",
                                "kind": "condition",
                                "expr": {"op": "exists", "left": {"var": "steps.push_shopify_product.body_json.data.productSet.product.id"}},
                                "then_steps": [
                                    update_record_step(
                                        "save_shopify_ids",
                                        record_id="{{ trigger.record_id }}",
                                        patch={
                                            "te_product.shopify_product_id": "{{ steps.push_shopify_product.body_json.data.productSet.product.id }}",
                                            "te_product.shopify_variant_id": "{{ steps.push_shopify_product.body_json.data.productSet.product.variants.nodes[0].id | default('') }}",
                                            "te_product.shopify_inventory_item_id": "{{ steps.push_shopify_product.body_json.data.productSet.product.variants.nodes[0].inventoryItem.id | default('') }}",
                                            "te_product.shopify_handle": "{{ steps.push_shopify_product.body_json.data.productSet.product.handle }}",
                                            "te_product.shopify_status": "{{ steps.push_shopify_product.body_json.data.productSet.product.status | default('') }}",
                                            "te_product.shopify_product_url": "{% if steps.push_shopify_product.body_json.data.productSet.product.onlineStoreUrl %}{{ steps.push_shopify_product.body_json.data.productSet.product.onlineStoreUrl }}{% elif steps.push_shopify_product.body_json.data.productSet.product.onlineStorePreviewUrl %}{{ steps.push_shopify_product.body_json.data.productSet.product.onlineStorePreviewUrl }}{% else %}{% endif %}",
                                            "te_product.shopify_last_sync_status": "pushed",
                                            "te_product.shopify_last_sync_at": timestamp_ref,
                                            "te_product.shopify_last_sync_error": "",
                                        },
                                    )
                                ],
                                "else_steps": [
                                    update_record_step(
                                        "mark_missing_product_id",
                                        record_id="{{ trigger.record_id }}",
                                        patch={
                                            "te_product.shopify_last_sync_status": "error",
                                            "te_product.shopify_last_sync_at": timestamp_ref,
                                            "te_product.shopify_last_sync_error": "Shopify productSet returned no product ID.",
                                        },
                                    )
                                ],
                            }
                        ],
                    }
                ],
            },
        ],
    }


def build_inventory_push_automation(*, connection_id: str, status: str, location_id: str) -> dict[str, Any]:
    timestamp_ref = "{{ trigger.timestamp }}"
    body_template = build_inventory_push_body_template(location_id)
    return {
        "name": "Shopify Phase 1 - Push Inventory",
        "description": "Manual push of Octodrop available stock into one configured Shopify inventory location.",
        "status": status,
        "trigger": {
            "kind": "event",
            "event_types": ["action.clicked"],
            "filters": [
                {"path": "entity_id", "op": "eq", "value": "entity.te_product"},
                {"path": "action_id", "op": "eq", "value": "action.te_product_push_shopify_inventory"},
            ],
        },
        "steps": [
            {
                "id": "stock_tracking_enabled",
                "kind": "condition",
                "expr": {"op": "eq", "left": {"var": "trigger.record.fields.track_stock"}, "right": {"literal": True}},
                "stop_on_false": True,
                "else_steps": [
                    update_record_step(
                        "mark_tracking_disabled",
                        record_id="{{ trigger.record_id }}",
                        patch={
                            "te_product.shopify_inventory_last_sync_status": "error",
                            "te_product.shopify_inventory_last_sync_at": timestamp_ref,
                            "te_product.shopify_inventory_last_sync_error": "Track Stock must be enabled before pushing inventory to Shopify.",
                        },
                    )
                ],
            },
            {
                "id": "inventory_item_present",
                "kind": "condition",
                "expr": {"op": "exists", "left": {"var": "trigger.record.fields.shopify_inventory_item_id"}},
                "stop_on_false": True,
                "else_steps": [
                    update_record_step(
                        "mark_missing_inventory_item",
                        record_id="{{ trigger.record_id }}",
                        patch={
                            "te_product.shopify_inventory_last_sync_status": "error",
                            "te_product.shopify_inventory_last_sync_at": timestamp_ref,
                            "te_product.shopify_inventory_last_sync_error": "Shopify inventory item ID is missing. Push the product to Shopify first.",
                        },
                    )
                ],
            },
            {
                "id": "push_shopify_inventory",
                "kind": "action",
                "action_id": "system.integration_request",
                "store_as": "push_shopify_inventory",
                "inputs": {
                    "connection_id": connection_id,
                    "template_id": "shopify_graphql_inventory_set_quantities",
                    "body": body_template,
                },
            },
            {
                "id": "inventory_graphql_errors_found",
                "kind": "condition",
                "expr": {
                    "op": "any",
                    "over": {"var": "steps.push_shopify_inventory.body_json.errors"},
                    "where": {"op": "exists", "left": {"var": "item.message"}},
                },
                "then_steps": [
                    update_record_step(
                        "mark_inventory_graphql_error",
                        record_id="{{ trigger.record_id }}",
                        patch={
                            "te_product.shopify_inventory_last_sync_status": "error",
                            "te_product.shopify_inventory_last_sync_at": timestamp_ref,
                            "te_product.shopify_inventory_last_sync_error": "{{ steps.push_shopify_inventory.body_json.errors[0].message | default('Shopify inventory mutation failed.') }}",
                        },
                    )
                ],
                "else_steps": [
                    {
                        "id": "inventory_user_errors_found",
                        "kind": "condition",
                        "expr": {
                            "op": "any",
                            "over": {"var": "steps.push_shopify_inventory.body_json.data.inventorySetQuantities.userErrors"},
                            "where": {"op": "exists", "left": {"var": "item.message"}},
                        },
                        "then_steps": [
                            update_record_step(
                                "mark_inventory_user_error",
                                record_id="{{ trigger.record_id }}",
                                patch={
                                    "te_product.shopify_inventory_last_sync_status": "error",
                                    "te_product.shopify_inventory_last_sync_at": timestamp_ref,
                                    "te_product.shopify_inventory_last_sync_error": "{{ steps.push_shopify_inventory.body_json.data.inventorySetQuantities.userErrors[0].message | default('Shopify inventorySetQuantities returned a validation error.') }}",
                                },
                            )
                        ],
                        "else_steps": [
                            update_record_step(
                                "mark_inventory_pushed",
                                record_id="{{ trigger.record_id }}",
                                patch={
                                    "te_product.shopify_inventory_last_sync_status": "pushed",
                                    "te_product.shopify_inventory_last_sync_at": timestamp_ref,
                                    "te_product.shopify_inventory_last_sync_error": "",
                                },
                            )
                        ],
                    }
                ],
            },
        ],
    }


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


def main() -> None:
    parser = argparse.ArgumentParser(description="Create or update workspace-scoped Shopify phase-1 setup for True Essentials.")
    parser.add_argument("--base-url", default=os.getenv("OCTO_BASE_URL", "").strip(), help="Octodrop API base URL")
    parser.add_argument("--token", default=os.getenv("OCTO_API_TOKEN", "").strip(), help="Bearer token")
    parser.add_argument("--workspace-id", default=os.getenv("OCTO_WORKSPACE_ID", "").strip(), help="Workspace ID")
    parser.add_argument("--connection-id", default=os.getenv("OCTO_SHOPIFY_CONNECTION_ID", "").strip(), help="Shopify connection ID")
    parser.add_argument("--connection-name", default=os.getenv("OCTO_SHOPIFY_CONNECTION_NAME", "").strip(), help="Shopify connection name")
    parser.add_argument("--default-vendor", default=os.getenv("OCTO_SHOPIFY_DEFAULT_VENDOR", "True Essentials").strip(), help="Default Shopify vendor applied when pushing TE products")
    parser.add_argument("--inventory-location-id", default=os.getenv("OCTO_SHOPIFY_INVENTORY_LOCATION_ID", "").strip(), help="Shopify location GID used for stock pushes")
    parser.add_argument("--publish", action="store_true", help="Publish the created/updated automations")
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
    if provider_key != "shopify" and connection_type != "integration.shopify":
        raise SystemExit(f"Connection '{connection.get('name')}' is not a Shopify integration")

    existing_config = connection.get("config") if isinstance(connection.get("config"), dict) else {}
    inventory_location_id = (args.inventory_location_id or "").strip() or str(existing_config.get("default_inventory_location_id") or "").strip()
    if not inventory_location_id:
        raise SystemExit("Missing --inventory-location-id or connection config default_inventory_location_id")
    desired_templates = build_request_templates()
    merged_templates = merge_request_templates(
        existing_config.get("request_templates") if isinstance(existing_config.get("request_templates"), list) else [],
        desired_templates,
    )
    next_config = {
        **existing_config,
        "request_templates": merged_templates,
        "shopify_phase1": {
            "default_vendor": (args.default_vendor or "").strip(),
            "inventory_location_id": inventory_location_id,
            "catalog_entity_id": "entity.te_product",
            "push_action_id": "action.te_product_push_shopify",
            "push_inventory_action_id": "action.te_product_push_shopify_inventory",
            "managed_fields": [
                "title",
                "handle",
                "descriptionHtml",
                "status",
                "variants[0].sku",
                "variants[0].price",
                "variants[0].compareAtPrice",
                "variants[0].inventoryItem.tracked",
            ],
        },
    }
    if inventory_location_id:
        next_config["default_inventory_location_id"] = inventory_location_id
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

    automation_status = "published" if args.publish else "draft"
    push_automation = build_push_automation(
        connection_id=connection_id,
        status=automation_status,
        default_vendor=(args.default_vendor or "").strip() or None,
    )
    inventory_push_automation = build_inventory_push_automation(
        connection_id=connection_id,
        status=automation_status,
        location_id=inventory_location_id,
    )
    upsert_automation_by_name(
        base_url,
        push_automation,
        token=token,
        workspace_id=workspace_id,
        publish=args.publish,
        dry_run=args.dry_run,
    )
    upsert_automation_by_name(
        base_url,
        inventory_push_automation,
        token=token,
        workspace_id=workspace_id,
        publish=args.publish,
        dry_run=args.dry_run,
    )


if __name__ == "__main__":
    main()
