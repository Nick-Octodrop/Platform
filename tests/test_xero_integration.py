import os
import sys
import unittest
from types import SimpleNamespace
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


class _FakeHttpxClient:
    def __init__(self, recorder: list[dict], *args, **kwargs):
        self._recorder = recorder

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def post(self, url, data=None, headers=None):
        self._recorder.append(
            {
                "method": "POST",
                "url": url,
                "data": dict(data or {}),
                "headers": dict(headers or {}),
            }
        )
        return _FakeHttpxResponse(
            200,
            {
                "access_token": "access-123",
                "refresh_token": "refresh-456",
                "token_type": "Bearer",
                "expires_in": 1800,
                "scope": "offline_access accounting.contacts",
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
            [
                {
                    "id": "connection-1",
                    "tenantId": "tenant-123",
                    "tenantName": "Acme Ltd",
                    "tenantType": "ORGANISATION",
                }
            ],
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
            {"ok": True},
            url,
            method=method,
            headers={"content-type": "application/json"},
        )


class TestXeroIntegration(unittest.TestCase):
    def test_xero_provider_is_listed_and_new_connections_get_defaults(self) -> None:
        client = TestClient(main.app)
        with (
            patch.object(main, "_resolve_actor", lambda _request: _superadmin_actor()),
            patch.dict(os.environ, {"OCTO_XERO_CLIENT_ID": "shared-xero-client-id"}, clear=False),
        ):
            providers_res = client.get("/integrations/providers")
            providers_body = providers_res.json()
            self.assertEqual(providers_res.status_code, 200, providers_body)
            providers = providers_body.get("providers") or []
            xero_provider = next((item for item in providers if item.get("key") == "xero"), None)
            self.assertIsNotNone(xero_provider, providers)

            create_res = client.post(
                "/integrations/connections",
                json={
                    "provider": "xero",
                    "name": "Acme Xero",
                    "status": "active",
                    "config": {},
                },
            )
            create_body = create_res.json()
            self.assertEqual(create_res.status_code, 200, create_body)
            connection = create_body.get("connection") or {}
            config = connection.get("config") or {}
            self.assertEqual(connection.get("type"), "integration.xero")
            self.assertEqual(config.get("provider_key"), "xero")
            self.assertEqual(config.get("provider_auth_type"), "oauth2")
            self.assertEqual(config.get("auth_mode"), "oauth2")
            self.assertEqual(config.get("client_id"), "shared-xero-client-id")
            self.assertEqual(config.get("base_url"), "https://api.xero.com/api.xro/2.0")
            self.assertEqual(config.get("authorization_url"), "https://login.xero.com/identity/connect/authorize")
            self.assertEqual(config.get("token_url"), "https://identity.xero.com/connect/token")
            self.assertEqual((config.get("test_request") or {}).get("url"), "https://api.xero.com/connections")

    def test_xero_oauth_exchange_stores_tenant_metadata_and_runtime_adds_tenant_header(self) -> None:
        client = TestClient(main.app)
        recorded_requests: list[dict] = []

        def fake_client(*args, **kwargs):
            return _FakeHttpxClient(recorded_requests, *args, **kwargs)

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
                    "OCTO_XERO_CLIENT_ID": "shared-xero-client-id",
                    "OCTO_XERO_CLIENT_SECRET": "shared-xero-client-secret",
                },
                clear=False,
            ),
        ):
            create_res = client.post(
                "/integrations/connections",
                json={
                    "provider": "xero",
                    "name": "Acme Xero",
                    "status": "active",
                    "config": {},
                },
            )
            create_body = create_res.json()
            self.assertEqual(create_res.status_code, 200, create_body)
            connection_id = create_body["connection"]["id"]

            exchange_res = client.post(
                f"/integrations/connections/{connection_id}/oauth/exchange",
                json={
                    "redirect_uri": "https://octodrop.test/integrations/connections/callback",
                    "code": "auth-code-123",
                },
            )
            exchange_body = exchange_res.json()
            self.assertEqual(exchange_res.status_code, 200, exchange_body)
            connection = exchange_body.get("result", {}).get("connection") or {}
            config = connection.get("config") or {}
            self.assertEqual(config.get("xero_tenant_id"), "tenant-123")
            self.assertEqual(config.get("xero_tenant_name"), "Acme Ltd")
            self.assertEqual((config.get("xero_tenants") or [{}])[0].get("tenantId"), "tenant-123")
            token_request = next(entry for entry in recorded_requests if entry.get("method") == "POST")
            self.assertEqual(token_request["data"].get("client_id"), "shared-xero-client-id")
            self.assertEqual(token_request["data"].get("client_secret"), "shared-xero-client-secret")

            with patch.object(integrations_runtime, "resolve_connection_secret", lambda *_args, **_kwargs: "access-123"):
                result = integrations_runtime.execute_connection_request(
                    connection,
                    {"method": "GET", "path": "/Contacts"},
                    "default",
                )
            self.assertTrue(result.get("ok"), result)
            runtime_request = next(
                entry for entry in reversed(recorded_requests) if entry.get("method") == "GET" and "/Contacts" in str(entry.get("url"))
            )
            self.assertEqual(runtime_request["headers"].get("Authorization"), "Bearer access-123")
            self.assertEqual(runtime_request["headers"].get("xero-tenant-id"), "tenant-123")


if __name__ == "__main__":
    unittest.main()
