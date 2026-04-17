import os
import sys
import unittest
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse
from unittest.mock import patch

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

os.environ["USE_DB"] = "0"
os.environ["OCTO_DISABLE_AUTH"] = "1"
os.environ["SUPABASE_URL"] = "http://localhost"

from fastapi.testclient import TestClient

import app.main as main
from app import integrations_runtime


def _superadmin_actor() -> dict:
    return {
        "user_id": "user-1",
        "email": "admin@example.com",
        "role": "owner",
        "workspace_role": "owner",
        "platform_role": "superadmin",
        "workspace_id": "default",
        "workspaces": [{"workspace_id": "default", "role": "owner", "workspace_name": "Default"}],
        "claims": {},
    }


class _FakeHttpxResponse:
    def __init__(self, status_code: int, payload, url: str, method: str = "GET", headers: dict | None = None):
        self.status_code = status_code
        self._payload = payload
        self.text = payload if isinstance(payload, str) else str(payload)
        self.headers = headers or {}
        self.request = SimpleNamespace(url=url, method=method)

    def json(self):
        return self._payload


class _FakeShopifyHttpxClient:
    def __init__(self, recorder: list[dict], *args, **kwargs):
        self._recorder = recorder

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def post(self, url, json=None, data=None, headers=None):
        self._recorder.append(
            {
                "method": "POST",
                "url": url,
                "json": json,
                "data": dict(data or {}),
                "headers": dict(headers or {}),
            }
        )
        return _FakeHttpxResponse(
            200,
            {
                "access_token": "shpat_test_token",
                "scope": "read_products,write_products,read_inventory,write_inventory,read_orders,read_locations",
            },
            url,
            method="POST",
        )

    def get(self, url, headers=None):
        self._recorder.append(
            {
                "method": "GET",
                "url": url,
                "headers": dict(headers or {}),
            }
        )
        return _FakeHttpxResponse(
            200,
            {
                "shop": {
                    "id": 12345,
                    "name": "True Essentials",
                    "email": "hello@trueessentials.test",
                    "domain": "trueessentials.example.com",
                    "myshopify_domain": "true-essentials.myshopify.com",
                    "currency": "NZD",
                }
            },
            url,
            method="GET",
        )

    def request(self, method, url, params=None, headers=None, json=None, content=None):
        self._recorder.append(
            {
                "method": method,
                "url": url,
                "params": dict(params or {}),
                "headers": dict(headers or {}),
                "json": json,
                "content": content,
            }
        )
        return _FakeHttpxResponse(
            200,
            {"shop": {"name": "True Essentials"}},
            url,
            method=method,
            headers={"content-type": "application/json"},
        )


class TestShopifyIntegration(unittest.TestCase):
    def test_shopify_provider_is_listed_and_connections_get_defaults(self) -> None:
        client = TestClient(main.app)
        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.dict(os.environ, {"OCTO_SHOPIFY_CLIENT_ID": "shopify-client-id"}, clear=False),
        ):
            providers_res = client.get("/integrations/providers")
            providers_body = providers_res.json()
            self.assertEqual(providers_res.status_code, 200, providers_body)
            providers = providers_body.get("providers") or []
            shopify_provider = next((item for item in providers if item.get("key") == "shopify"), None)
            self.assertIsNotNone(shopify_provider, providers)

            create_res = client.post(
                "/integrations/connections",
                json={
                    "provider": "shopify",
                    "name": "True Essentials Shopify",
                    "status": "active",
                    "config": {
                        "shop_domain": "true-essentials",
                    },
                },
            )
            create_body = create_res.json()
            self.assertEqual(create_res.status_code, 200, create_body)
            connection = create_body.get("connection") or {}
            config = connection.get("config") or {}
            self.assertEqual(connection.get("type"), "integration.shopify")
            self.assertEqual(config.get("provider_key"), "shopify")
            self.assertEqual(config.get("provider_auth_type"), "oauth2")
            self.assertEqual(config.get("auth_mode"), "oauth2")
            self.assertEqual(config.get("client_id"), "shopify-client-id")
            self.assertEqual(config.get("api_version"), "2026-01")
            self.assertEqual(config.get("shop_domain"), "true-essentials")
            self.assertEqual((config.get("test_request") or {}).get("path"), "/shop.json")

    def test_shopify_authorize_url_uses_managed_callback(self) -> None:
        client = TestClient(main.app)
        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.dict(os.environ, {"OCTO_SHOPIFY_CLIENT_ID": "shopify-client-id"}, clear=False),
        ):
            create_res = client.post(
                "/integrations/connections",
                json={
                    "provider": "shopify",
                    "name": "True Essentials Shopify",
                    "status": "active",
                    "config": {
                        "shop_domain": "true-essentials.myshopify.com",
                    },
                },
            )
            connection_id = create_res.json()["connection"]["id"]

            authorize_res = client.post(
                f"/integrations/connections/{connection_id}/oauth/authorize-url",
                json={
                    "redirect_uri": "https://ignored.example/callback",
                    "return_origin": "https://app.octodrop.com",
                },
            )
            authorize_body = authorize_res.json()
            self.assertEqual(authorize_res.status_code, 200, authorize_body)
            result = authorize_body.get("result") or {}
            authorize_url = str(result.get("authorize_url") or "")
            parsed = urlparse(authorize_url)
            query = parse_qs(parsed.query)
            self.assertEqual(parsed.netloc, "true-essentials.myshopify.com")
            self.assertEqual(parsed.path, "/admin/oauth/authorize")
            self.assertEqual(query.get("client_id"), ["shopify-client-id"])
            self.assertEqual(query.get("redirect_uri"), ["http://testserver/integrations/oauth/shopify/callback"])
            self.assertTrue(query.get("state"))

    def test_shopify_oauth_exchange_stores_shop_metadata_and_runtime_uses_shopify_header(self) -> None:
        client = TestClient(main.app)
        recorded_requests: list[dict] = []

        def fake_client(*args, **kwargs):
            return _FakeShopifyHttpxClient(recorded_requests, *args, **kwargs)

        def fake_upsert_connection_secret(connection, org_id, *, secret_key, value):
            next_refs = dict(connection.get("secret_refs") or {})
            next_refs[secret_key] = f"secret-{secret_key}"
            return {**connection, "secret_refs": next_refs}

        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.object(integrations_runtime.httpx, "Client", fake_client),
            patch.object(integrations_runtime, "_upsert_connection_secret", fake_upsert_connection_secret),
            patch.dict(
                os.environ,
                {
                    "OCTO_SHOPIFY_CLIENT_ID": "shopify-client-id",
                    "OCTO_SHOPIFY_CLIENT_SECRET": "shopify-client-secret",
                },
                clear=False,
            ),
        ):
            create_res = client.post(
                "/integrations/connections",
                json={
                    "provider": "shopify",
                    "name": "True Essentials Shopify",
                    "status": "active",
                    "config": {
                        "shop_domain": "true-essentials.myshopify.com",
                    },
                },
            )
            create_body = create_res.json()
            self.assertEqual(create_res.status_code, 200, create_body)
            connection_id = create_body["connection"]["id"]

            authorize_res = client.post(
                f"/integrations/connections/{connection_id}/oauth/authorize-url",
                json={
                    "redirect_uri": "https://ignored.example/callback",
                    "return_origin": "https://app.octodrop.com",
                },
            )
            managed_redirect_uri = parse_qs(urlparse(authorize_res.json()["result"]["authorize_url"]).query)["redirect_uri"][0]

            exchange_res = client.post(
                f"/integrations/connections/{connection_id}/oauth/exchange",
                json={
                    "redirect_uri": managed_redirect_uri,
                    "code": "shopify-auth-code",
                },
            )
            exchange_body = exchange_res.json()
            self.assertEqual(exchange_res.status_code, 200, exchange_body)

            connection = exchange_body.get("result", {}).get("connection") or {}
            config = connection.get("config") or {}
            self.assertEqual(config.get("shopify_shop_name"), "True Essentials")
            self.assertEqual(config.get("shopify_myshopify_domain"), "true-essentials.myshopify.com")
            self.assertEqual(config.get("shopify_shop_currency"), "NZD")

            with patch.object(integrations_runtime, "resolve_connection_secret", lambda *_args, **_kwargs: "shpat_test_token"):
                result = integrations_runtime.execute_connection_request(
                    connection,
                    {"method": "GET", "path": "/shop.json"},
                    "default",
                )
            self.assertTrue(result.get("ok"), result)
            runtime_request = next(
                entry for entry in reversed(recorded_requests) if entry.get("method") == "GET" and "/shop.json" in str(entry.get("url"))
            )
            self.assertEqual(runtime_request["headers"].get("X-Shopify-Access-Token"), "shpat_test_token")
            self.assertIn("/admin/api/2026-01/shop.json", str(runtime_request.get("url")))


if __name__ == "__main__":
    unittest.main()
