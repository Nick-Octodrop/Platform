#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from typing import Any
from urllib import error as urlerror
from urllib import parse as urlparse
from urllib import request as urlrequest


WEBHOOK_SUBSCRIPTIONS_QUERY = """
query ListWebhookSubscriptions($first: Int!, $after: String) {
  webhookSubscriptions(first: $first, after: $after) {
    pageInfo {
      hasNextPage
      endCursor
    }
    edges {
      node {
        id
        topic
        endpoint {
          __typename
          ... on WebhookHttpEndpoint {
            callbackUrl
          }
        }
      }
    }
  }
}
""".strip()


WEBHOOK_SUBSCRIPTION_CREATE_MUTATION = """
mutation CreateWebhookSubscription($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
    webhookSubscription {
      id
      topic
      uri
    }
    userErrors {
      field
      message
    }
  }
}
""".strip()


TOPIC_SPECS: list[dict[str, Any]] = [
    {"topic": "ORDERS_CREATE", "event_key": "shopify.orders.create", "required_scopes": ["read_orders"]},
    {"topic": "ORDERS_UPDATED", "event_key": "shopify.orders.updated", "required_scopes": ["read_orders"]},
    {"topic": "ORDERS_CANCELLED", "event_key": "shopify.orders.cancelled", "required_scopes": ["read_orders"]},
    {"topic": "REFUNDS_CREATE", "event_key": "shopify.refunds.create", "required_scopes": ["read_orders"]},
    {"topic": "CUSTOMERS_CREATE", "event_key": "shopify.customers.create", "required_scopes": ["read_customers"]},
    {"topic": "CUSTOMERS_UPDATE", "event_key": "shopify.customers.update", "required_scopes": ["read_customers"]},
    {"topic": "PRODUCTS_CREATE", "event_key": "shopify.products.create", "required_scopes": ["read_products"]},
    {"topic": "PRODUCTS_UPDATE", "event_key": "shopify.products.update", "required_scopes": ["read_products"]},
]


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


def list_webhooks(base_url: str, *, token: str, workspace_id: str, connection_id: str) -> list[dict[str, Any]]:
    status, payload = api_call(
        "GET",
        f"{base_url}/integrations/webhooks?{urlparse.urlencode({'connection_id': connection_id})}",
        token=token,
        workspace_id=workspace_id,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"list webhooks failed: {collect_error_text(payload)}")
    rows = payload.get("webhooks")
    return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []


def create_webhook(
    base_url: str,
    *,
    token: str,
    workspace_id: str,
    body: dict[str, Any],
) -> dict[str, Any]:
    status, payload = api_call(
        "POST",
        f"{base_url}/integrations/webhooks",
        token=token,
        workspace_id=workspace_id,
        body=body,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"create webhook failed: {collect_error_text(payload)}")
    item = payload.get("webhook")
    if not isinstance(item, dict):
        raise RuntimeError("create webhook failed: missing webhook payload")
    return item


def update_webhook(
    base_url: str,
    webhook_id: str,
    *,
    token: str,
    workspace_id: str,
    body: dict[str, Any],
) -> dict[str, Any]:
    status, payload = api_call(
        "PATCH",
        f"{base_url}/integrations/webhooks/{urlparse.quote(webhook_id, safe='')}",
        token=token,
        workspace_id=workspace_id,
        body=body,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"update webhook failed: {collect_error_text(payload)}")
    item = payload.get("webhook")
    if not isinstance(item, dict):
        raise RuntimeError("update webhook failed: missing webhook payload")
    return item


def shopify_graphql_request(
    base_url: str,
    connection_id: str,
    *,
    token: str,
    workspace_id: str,
    query: str,
    variables: dict[str, Any],
) -> dict[str, Any]:
    status, payload = api_call(
        "POST",
        f"{base_url}/integrations/connections/{urlparse.quote(connection_id, safe='')}/request",
        token=token,
        workspace_id=workspace_id,
        body={
            "method": "POST",
            "path": "/graphql.json",
            "headers": {
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            "body": json.dumps({"query": query, "variables": variables}),
        },
        timeout=180,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"Shopify request failed: {collect_error_text(payload)}")
    result = payload.get("result")
    if not isinstance(result, dict):
        raise RuntimeError("Shopify request failed: missing result payload")
    body_json = result.get("body_json")
    if not isinstance(body_json, dict):
        raise RuntimeError("Shopify request failed: missing GraphQL response body")
    if isinstance(body_json.get("errors"), list) and body_json.get("errors"):
        messages = [str(item.get("message") or "GraphQL error") for item in body_json.get("errors") if isinstance(item, dict)]
        raise RuntimeError("; ".join(messages) or "Shopify GraphQL request failed")
    return body_json


def list_shopify_webhook_subscriptions(
    base_url: str,
    connection_id: str,
    *,
    token: str,
    workspace_id: str,
) -> list[dict[str, Any]]:
    after: str | None = None
    out: list[dict[str, Any]] = []
    while True:
        body_json = shopify_graphql_request(
            base_url,
            connection_id,
            token=token,
            workspace_id=workspace_id,
            query=WEBHOOK_SUBSCRIPTIONS_QUERY,
            variables={"first": 100, "after": after},
        )
        conn = ((body_json.get("data") or {}).get("webhookSubscriptions") or {}) if isinstance(body_json.get("data"), dict) else {}
        edges = conn.get("edges")
        if isinstance(edges, list):
            for edge in edges:
                node = edge.get("node") if isinstance(edge, dict) else None
                if isinstance(node, dict):
                    out.append(node)
        page_info = conn.get("pageInfo") if isinstance(conn, dict) else {}
        has_next = bool(page_info.get("hasNextPage")) if isinstance(page_info, dict) else False
        after = str(page_info.get("endCursor") or "").strip() if isinstance(page_info, dict) else ""
        if not has_next or not after:
            break
    return out


def create_shopify_webhook_subscription(
    base_url: str,
    connection_id: str,
    *,
    token: str,
    workspace_id: str,
    topic: str,
    callback_url: str,
) -> dict[str, Any]:
    body_json = shopify_graphql_request(
        base_url,
        connection_id,
        token=token,
        workspace_id=workspace_id,
        query=WEBHOOK_SUBSCRIPTION_CREATE_MUTATION,
        variables={
            "topic": topic,
            "webhookSubscription": {
                "uri": callback_url,
            },
        },
    )
    payload = ((body_json.get("data") or {}).get("webhookSubscriptionCreate") or {}) if isinstance(body_json.get("data"), dict) else {}
    user_errors = payload.get("userErrors")
    if isinstance(user_errors, list) and user_errors:
        messages = [str(item.get("message") or "Webhook subscription error") for item in user_errors if isinstance(item, dict)]
        raise RuntimeError("; ".join(messages) or f"Failed to create Shopify webhook subscription for {topic}")
    item = payload.get("webhookSubscription")
    if not isinstance(item, dict):
        raise RuntimeError(f"Failed to create Shopify webhook subscription for {topic}: missing subscription payload")
    return item


def endpoint_callback_url(base_url: str, webhook_id: str) -> str:
    return f"{base_url.rstrip('/')}/integrations/webhooks/{urlparse.quote(webhook_id, safe='')}/ingest"


def choose_signing_secret_id(connection: dict[str, Any]) -> str | None:
    refs = connection.get("secret_refs") if isinstance(connection.get("secret_refs"), dict) else {}
    if not isinstance(refs, dict):
        return None
    for key in ("signing_secret", "client_secret"):
        value = str(refs.get(key) or "").strip()
        if value:
            return value
    return None


def ensure_octo_webhook(
    base_url: str,
    *,
    token: str,
    workspace_id: str,
    connection_id: str,
    existing_by_event: dict[str, dict[str, Any]],
    event_key: str,
    topic: str,
    signing_secret_id: str | None,
    dry_run: bool,
) -> tuple[str, dict[str, Any]]:
    payload = {
        "connection_id": connection_id,
        "direction": "inbound",
        "event_key": event_key,
        "status": "active",
        "signing_secret_id": signing_secret_id,
        "config_json": {
            "provider": "shopify",
            "shopify_topic": topic,
        },
    }
    existing = existing_by_event.get(event_key)
    if existing:
        next_config = dict(existing.get("config_json") or {})
        next_config.update(payload["config_json"])
        update_body = {
            "direction": "inbound",
            "event_key": event_key,
            "status": "active",
            "signing_secret_id": signing_secret_id,
            "config_json": next_config,
        }
        if dry_run:
            fake = dict(existing)
            fake.update(update_body)
            return "update", fake
        updated = update_webhook(
            base_url,
            str(existing.get("id") or ""),
            token=token,
            workspace_id=workspace_id,
            body=update_body,
        )
        return "update", updated
    if dry_run:
        return "create", payload
    created = create_webhook(
        base_url,
        token=token,
        workspace_id=workspace_id,
        body=payload,
    )
    return "create", created


def main() -> int:
    parser = argparse.ArgumentParser(description="Register Shopify inbound webhooks for True Essentials phase 2.")
    parser.add_argument("--base-url", default=os.getenv("OCTO_BASE_URL", "http://localhost:8000"))
    parser.add_argument("--token", default=os.getenv("OCTO_API_TOKEN"))
    parser.add_argument("--workspace-id", default=os.getenv("OCTO_WORKSPACE_ID"))
    parser.add_argument("--connection-id")
    parser.add_argument("--connection-name")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not args.token:
        raise SystemExit("Missing --token or OCTO_API_TOKEN")
    if not args.workspace_id:
        raise SystemExit("Missing --workspace-id or OCTO_WORKSPACE_ID")

    connection = resolve_connection(
        args.base_url.rstrip("/"),
        token=args.token,
        workspace_id=args.workspace_id,
        connection_id=args.connection_id,
        connection_name=args.connection_name,
    )
    connection_id = str(connection.get("id") or "").strip()
    if not connection_id:
        raise SystemExit("Resolved connection is missing id")
    if str(connection.get("type") or "").strip() != "integration.shopify":
        raise SystemExit(f"Connection {connection_id} is not a Shopify integration")

    signing_secret_id = choose_signing_secret_id(connection)
    if not signing_secret_id:
        raise SystemExit("Connection is missing client_secret/signing_secret linkage; Shopify webhook HMAC verification needs one of those secret refs.")

    existing_webhooks = list_webhooks(
        args.base_url.rstrip("/"),
        token=args.token,
        workspace_id=args.workspace_id,
        connection_id=connection_id,
    )
    existing_by_event = {
        str(item.get("event_key") or "").strip(): item
        for item in existing_webhooks
        if isinstance(item, dict) and str(item.get("event_key") or "").strip()
    }

    existing_shopify = list_shopify_webhook_subscriptions(
        args.base_url.rstrip("/"),
        connection_id,
        token=args.token,
        workspace_id=args.workspace_id,
    )
    existing_shopify_by_topic_and_url: dict[tuple[str, str], dict[str, Any]] = {}
    for item in existing_shopify:
        topic = str(item.get("topic") or "").strip()
        endpoint = item.get("endpoint") if isinstance(item.get("endpoint"), dict) else {}
        callback_url = str(endpoint.get("callbackUrl") or "").strip()
        if topic and callback_url:
            existing_shopify_by_topic_and_url[(topic, callback_url)] = item

    results: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    for spec in TOPIC_SPECS:
        octo_action, octo_webhook = ensure_octo_webhook(
            args.base_url.rstrip("/"),
            token=args.token,
            workspace_id=args.workspace_id,
            connection_id=connection_id,
            existing_by_event=existing_by_event,
            event_key=spec["event_key"],
            topic=spec["topic"],
            signing_secret_id=signing_secret_id,
            dry_run=args.dry_run,
        )
        webhook_id = str(octo_webhook.get("id") or f"dry-run-{spec['event_key']}").strip()
        callback_url = endpoint_callback_url(args.base_url.rstrip("/"), webhook_id)

        shopify_subscription = existing_shopify_by_topic_and_url.get((spec["topic"], callback_url))
        shopify_action = "reuse"
        shopify_error: str | None = None
        if not shopify_subscription:
            shopify_action = "create"
            if args.dry_run:
                shopify_subscription = {
                    "id": None,
                    "topic": spec["topic"],
                    "uri": callback_url,
                }
            else:
                try:
                    shopify_subscription = create_shopify_webhook_subscription(
                        args.base_url.rstrip("/"),
                        connection_id,
                        token=args.token,
                        workspace_id=args.workspace_id,
                        topic=spec["topic"],
                        callback_url=callback_url,
                    )
                    updated_config = dict(octo_webhook.get("config_json") or {})
                    updated_config.update(
                        {
                            "provider": "shopify",
                            "shopify_topic": spec["topic"],
                            "shopify_subscription_id": shopify_subscription.get("id"),
                            "shopify_callback_url": callback_url,
                        }
                    )
                    octo_webhook = update_webhook(
                        args.base_url.rstrip("/"),
                        str(octo_webhook.get("id") or "").strip(),
                        token=args.token,
                        workspace_id=args.workspace_id,
                        body={"config_json": updated_config},
                    )
                except Exception as exc:
                    shopify_action = "error"
                    scope_list = spec.get("required_scopes") if isinstance(spec.get("required_scopes"), list) else []
                    scope_hint = ""
                    if scope_list:
                        scope_hint = f" Expected scope(s): {', '.join(str(item) for item in scope_list if isinstance(item, str) and item.strip())}."
                    shopify_error = f"{exc}{scope_hint}"
        results.append(
            {
                "event_key": spec["event_key"],
                "topic": spec["topic"],
                "required_scopes": spec.get("required_scopes") or [],
                "octo_webhook_action": octo_action,
                "octo_webhook_id": octo_webhook.get("id"),
                "callback_url": callback_url,
                "shopify_subscription_action": shopify_action,
                "shopify_subscription_id": shopify_subscription.get("id") if isinstance(shopify_subscription, dict) else None,
                "error": shopify_error,
            }
        )
        if shopify_error:
            failures.append({"topic": spec["topic"], "error": shopify_error})

    print(
        json.dumps(
            {
                "connection_id": connection_id,
                "registered": results,
                "failure_count": len(failures),
                "dry_run": args.dry_run,
            },
            indent=2,
        )
    )
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
