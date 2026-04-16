from __future__ import annotations

import base64
import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode, urljoin

import httpx

from app.secrets import SecretStoreError, create_secret, resolve_connection_secret, rotate_secret
from app.stores_db import DbConnectionSecretStore, DbConnectionStore
from app.webhook_signing import build_webhook_signature_headers


class IntegrationProviderError(RuntimeError):
    pass


def provider_key_for_connection(connection: dict) -> str:
    if not isinstance(connection, dict):
        return ""
    config = connection.get("config") if isinstance(connection.get("config"), dict) else {}
    provider_key = config.get("provider_key")
    if isinstance(provider_key, str) and provider_key.strip():
        return provider_key.strip().lower()
    connection_type = connection.get("type")
    if isinstance(connection_type, str) and connection_type.startswith("integration."):
        return connection_type.split(".", 1)[1].strip().lower()
    if isinstance(connection_type, str):
        return connection_type.strip().lower()
    return ""


def _coerce_object(value: Any, field_name: str) -> dict:
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
        except Exception as exc:
            raise IntegrationProviderError(f"{field_name} must be valid JSON object") from exc
        if isinstance(parsed, dict):
            return parsed
    raise IntegrationProviderError(f"{field_name} must be an object")


def _redact_headers(headers: dict[str, Any]) -> dict[str, Any]:
    sensitive = {"authorization", "proxy-authorization", "x-api-key", "api-key"}
    redacted: dict[str, Any] = {}
    for key, value in (headers or {}).items():
        header_name = str(key)
        if header_name.lower() in sensitive:
            redacted[header_name] = "***"
        else:
            redacted[header_name] = value
    return redacted


def _coerce_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off"}:
            return False
    return default


def _coerce_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _now_dt() -> datetime:
    return datetime.now(timezone.utc)


def _isoformat(value: datetime) -> str:
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc)
    if isinstance(value, str) and value.strip():
        try:
            return datetime.fromisoformat(value.strip().replace("Z", "+00:00")).astimezone(timezone.utc)
        except Exception:
            return None
    return None


def _get_path_value(payload: Any, path: str) -> Any:
    if not isinstance(path, str) or not path.strip():
        return payload
    current: Any = payload
    for raw_part in path.split("."):
        part = raw_part.strip()
        if not part:
            continue
        while True:
            bracket_index = part.find("[")
            if bracket_index == -1:
                if isinstance(current, dict):
                    current = current.get(part)
                else:
                    return None
                break
            key = part[:bracket_index]
            if key:
                if not isinstance(current, dict):
                    return None
                current = current.get(key)
            end_index = part.find("]", bracket_index)
            if end_index == -1 or not isinstance(current, list):
                return None
            index_text = part[bracket_index + 1 : end_index].strip()
            try:
                list_index = int(index_text)
            except Exception:
                return None
            if list_index < 0:
                list_index = len(current) + list_index
            if list_index < 0 or list_index >= len(current):
                return None
            current = current[list_index]
            part = part[end_index + 1 :]
            if not part:
                break
    return current


def _resolve_sync_config(connection: dict, override: dict | None = None) -> dict:
    config = connection.get("config") if isinstance(connection.get("config"), dict) else {}
    base_sync = config.get("sync") if isinstance(config.get("sync"), dict) else {}
    sync = {**base_sync}
    if isinstance(override, dict):
        sync.update({k: v for k, v in override.items() if v is not None})
    request = {}
    if isinstance(base_sync.get("request"), dict):
        request.update(base_sync.get("request") or {})
    if isinstance(sync.get("request"), dict):
        request.update(sync.get("request") or {})
    if request:
        sync["request"] = request
    return sync


def _validate_sync_governance(connection: dict, resolved_sync: dict) -> None:
    provider_key = provider_key_for_connection(connection)
    if provider_key != "xero":
        return
    sync_mode = str(resolved_sync.get("sync_mode") or "inbound_only").strip().lower()
    if sync_mode and sync_mode != "inbound_only":
        raise IntegrationProviderError("Xero sync currently supports inbound_only only. Outbound and bidirectional modes are reserved but not active yet.")
    source_of_truth = str(resolved_sync.get("source_of_truth") or "provider").strip().lower()
    if source_of_truth and source_of_truth != "provider":
        raise IntegrationProviderError("Xero inbound sync currently requires source_of_truth=provider.")


def _provider_display_name(connection: dict) -> str:
    return str(connection.get("name") or provider_key_for_connection(connection) or "integration").strip() or "integration"


def _provider_default_client_id(provider_key: str) -> str:
    normalized = str(provider_key or "").strip().lower()
    if normalized == "xero":
        return os.getenv("OCTO_XERO_CLIENT_ID", "").strip() or os.getenv("XERO_CLIENT_ID", "").strip()
    return ""


def _provider_default_client_secret(provider_key: str) -> str:
    normalized = str(provider_key or "").strip().lower()
    if normalized == "xero":
        return os.getenv("OCTO_XERO_CLIENT_SECRET", "").strip() or os.getenv("XERO_CLIENT_SECRET", "").strip()
    return ""


def _normalize_xero_oauth_scope(scope_value: str) -> str:
    scope = " ".join(str(scope_value or "").split()).strip()
    if not scope:
        return scope
    parts = scope.split(" ")
    replacements = {
        # Xero granular scopes for new apps replace the old broad transactions scope.
        "accounting.transactions": "accounting.invoices",
    }
    normalized: list[str] = []
    seen: set[str] = set()
    for part in parts:
        next_part = replacements.get(part, part)
        if next_part and next_part not in seen:
            normalized.append(next_part)
            seen.add(next_part)
    return " ".join(normalized)


def _upsert_connection_secret(connection: dict, org_id: str, *, secret_key: str, value: str) -> dict:
    connection_id = str(connection.get("id") or "")
    if not connection_id:
        raise IntegrationProviderError("Connection id is required to store OAuth2 secrets")
    existing_ref = DbConnectionSecretStore().get_secret_ref(connection_id, secret_key=secret_key)
    if existing_ref:
        rotate_secret(existing_ref, value, org_id)
    else:
        created_ref = create_secret(
            org_id,
            f"{_provider_display_name(connection)} {secret_key.replace('_', ' ')}",
            value,
            provider_key=provider_key_for_connection(connection) or None,
            secret_key=secret_key,
            status="active",
        )
        next_refs = dict(connection.get("secret_refs") or {})
        next_refs[secret_key] = created_ref
        updated = DbConnectionStore().update(connection_id, {"secret_refs": next_refs})
        if updated:
            connection = updated
    return DbConnectionStore().get(connection_id) or connection


def _update_connection_config(connection: dict, config_updates: dict[str, Any]) -> dict:
    connection_id = str(connection.get("id") or "")
    config = connection.get("config") if isinstance(connection.get("config"), dict) else {}
    next_config = {**config, **config_updates}
    updated = None
    if connection_id:
        try:
            updated = DbConnectionStore().update(connection_id, {"config": next_config})
        except Exception:
            updated = None
    if updated:
        return updated
    return {**connection, "config": next_config}


class GenericRestProvider:
    key = "generic_rest"

    def _build_url(self, connection: dict, request_config: dict) -> str:
        config = connection.get("config") if isinstance(connection.get("config"), dict) else {}
        base_url = str(config.get("base_url") or "").strip()
        path = str(request_config.get("path") or config.get("test_path") or "/").strip() or "/"
        absolute_url = str(request_config.get("url") or "").strip()
        if absolute_url:
            return absolute_url
        if not base_url:
            raise IntegrationProviderError("Connection base_url is required")
        if not base_url.endswith("/"):
            base_url = f"{base_url}/"
        path = path[1:] if path.startswith("/") else path
        return urljoin(base_url, path)

    def _oauth_redirect_uri(self, connection: dict, redirect_uri: str | None) -> str:
        config = connection.get("config") if isinstance(connection.get("config"), dict) else {}
        resolved = str(redirect_uri or config.get("oauth_redirect_uri") or "").strip()
        if not resolved:
            raise IntegrationProviderError("OAuth2 redirect_uri is required")
        return resolved

    def build_authorize_url(self, connection: dict, redirect_uri: str, state: str | None = None) -> dict:
        config = connection.get("config") if isinstance(connection.get("config"), dict) else {}
        if str(config.get("auth_mode") or "").strip().lower() != "oauth2":
            raise IntegrationProviderError("Connection is not configured for OAuth2")
        authorization_url = str(config.get("authorization_url") or "").strip()
        client_id = str(config.get("client_id") or "").strip() or _provider_default_client_id(provider_key_for_connection(connection))
        if not authorization_url:
            raise IntegrationProviderError("authorization_url is required")
        if not client_id:
            raise IntegrationProviderError("client_id is required")
        redirect = self._oauth_redirect_uri(connection, redirect_uri)
        oauth_state = state or str(uuid.uuid4())
        params: dict[str, Any] = {
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": redirect,
            "state": oauth_state,
        }
        scope = str(config.get("oauth_scope") or "").strip()
        if provider_key_for_connection(connection) == "xero":
            scope = _normalize_xero_oauth_scope(scope)
        if scope:
            params["scope"] = scope
        audience = str(config.get("oauth_audience") or "").strip()
        if audience:
            params["audience"] = audience
        extra = _coerce_object(config.get("oauth_extra_authorize_params"), "oauth_extra_authorize_params")
        params.update({k: v for k, v in extra.items() if v not in (None, "")})
        return {
            "authorize_url": f"{authorization_url}?{urlencode(params, doseq=True)}",
            "state": oauth_state,
            "redirect_uri": redirect,
        }

    def _oauth_token_request(self, connection: dict, org_id: str, data: dict[str, Any]) -> tuple[dict, dict]:
        config = connection.get("config") if isinstance(connection.get("config"), dict) else {}
        token_url = str(config.get("token_url") or "").strip()
        client_id = str(config.get("client_id") or "").strip() or _provider_default_client_id(provider_key_for_connection(connection))
        if not token_url:
            raise IntegrationProviderError("token_url is required")
        if not client_id:
            raise IntegrationProviderError("client_id is required")
        payload = {**data, "client_id": client_id}
        try:
            client_secret = resolve_connection_secret(
                str(connection.get("id") or "") or None,
                org_id,
                secret_key="client_secret",
                legacy_secret_ref=connection.get("secret_ref"),
            )
        except Exception:
            client_secret = None
        if not client_secret:
            client_secret = _provider_default_client_secret(provider_key_for_connection(connection)) or None
        if client_secret:
            payload["client_secret"] = client_secret
        extra = _coerce_object(config.get("oauth_extra_token_params"), "oauth_extra_token_params")
        payload.update({k: v for k, v in extra.items() if v not in (None, "")})
        with httpx.Client(timeout=float(config.get("timeout_seconds") or 30)) as client:
            response = client.post(
                token_url,
                data=payload,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        try:
            body = response.json()
        except Exception as exc:
            raise IntegrationProviderError(f"OAuth2 token endpoint returned non-JSON response: {response.text[:300]}") from exc
        if response.status_code >= 400:
            error_message = body.get("error_description") or body.get("error") or f"HTTP {response.status_code}"
            raise IntegrationProviderError(f"OAuth2 token request failed: {error_message}")
        if not isinstance(body, dict):
            raise IntegrationProviderError("OAuth2 token response must be a JSON object")
        return body, payload

    def _store_oauth_token_response(self, connection: dict, org_id: str, token_body: dict) -> dict:
        next_connection = connection
        access_token = token_body.get("access_token")
        refresh_token = token_body.get("refresh_token")
        if isinstance(access_token, str) and access_token.strip():
            next_connection = _upsert_connection_secret(next_connection, org_id, secret_key="access_token", value=access_token.strip())
        if isinstance(refresh_token, str) and refresh_token.strip():
            next_connection = _upsert_connection_secret(next_connection, org_id, secret_key="refresh_token", value=refresh_token.strip())
        expires_at = None
        if token_body.get("expires_in") not in (None, ""):
            expires_at = _isoformat(_now_dt() + timedelta(seconds=max(0, _coerce_int(token_body.get("expires_in"), 0))))
        elif isinstance(token_body.get("expires_at"), str) and token_body.get("expires_at").strip():
            expires_at = token_body.get("expires_at").strip()
        next_connection = _update_connection_config(
            next_connection,
            {
                "oauth_access_token_expires_at": expires_at,
                "oauth_last_token_refresh_at": _isoformat(_now_dt()),
                "oauth_token_response": {
                    "token_type": token_body.get("token_type"),
                    "scope": token_body.get("scope"),
                    "expires_in": token_body.get("expires_in"),
                },
            },
        )
        return next_connection

    def exchange_authorization_code(self, connection: dict, org_id: str, *, code: str, redirect_uri: str) -> dict:
        exchange_body, _ = self._oauth_token_request(
            connection,
            org_id,
            {
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": self._oauth_redirect_uri(connection, redirect_uri),
            },
        )
        updated_connection = self._store_oauth_token_response(connection, org_id, exchange_body)
        return {
            "ok": True,
            "stored_secret_keys": [
                key
                for key in ("access_token", "refresh_token")
                if isinstance(exchange_body.get(key), str) and exchange_body.get(key).strip()
            ],
            "token_response": {
                "token_type": exchange_body.get("token_type"),
                "scope": exchange_body.get("scope"),
                "expires_in": exchange_body.get("expires_in"),
            },
            "connection": updated_connection,
        }

    def refresh_oauth_tokens(self, connection: dict, org_id: str) -> dict:
        try:
            refresh_token = resolve_connection_secret(
                str(connection.get("id") or "") or None,
                org_id,
                secret_key="refresh_token",
                legacy_secret_ref=connection.get("secret_ref"),
            )
        except SecretStoreError as exc:
            raise IntegrationProviderError(f"OAuth2 refresh token unavailable: {exc}") from exc
        token_body, _ = self._oauth_token_request(
            connection,
            org_id,
            {
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
            },
        )
        updated_connection = self._store_oauth_token_response(connection, org_id, token_body)
        return {
            "ok": True,
            "token_response": {
                "token_type": token_body.get("token_type"),
                "scope": token_body.get("scope"),
                "expires_in": token_body.get("expires_in"),
            },
            "connection": updated_connection,
        }

    def _ensure_oauth_access_token(self, connection: dict, org_id: str) -> dict:
        config = connection.get("config") if isinstance(connection.get("config"), dict) else {}
        leeway_seconds = max(0, _coerce_int(config.get("oauth_token_refresh_leeway_seconds"), 120))
        expires_at = _parse_datetime(config.get("oauth_access_token_expires_at"))
        access_token = None
        try:
            access_token = resolve_connection_secret(
                str(connection.get("id") or "") or None,
                org_id,
                secret_key="access_token",
                legacy_secret_ref=connection.get("secret_ref"),
            )
        except SecretStoreError:
            access_token = None
        should_refresh = not access_token
        if expires_at is not None and expires_at <= (_now_dt() + timedelta(seconds=leeway_seconds)):
            should_refresh = True
        if should_refresh:
            refreshed = self.refresh_oauth_tokens(connection, org_id)
            return refreshed.get("connection") or connection
        return connection

    def _build_auth(self, connection: dict, org_id: str) -> tuple[dict[str, str], dict[str, Any]]:
        config = connection.get("config") if isinstance(connection.get("config"), dict) else {}
        auth_mode = str(config.get("auth_mode") or config.get("provider_auth_type") or "none").strip().lower()
        headers = dict(_coerce_object(config.get("default_headers"), "default_headers"))
        params: dict[str, Any] = {}
        connection_id = str(connection.get("id") or "") or None
        legacy_secret_ref = connection.get("secret_ref")
        if auth_mode in {"none", ""}:
            return headers, params
        if auth_mode == "bearer":
            token = resolve_connection_secret(
                connection_id,
                org_id,
                secret_key="bearer_token",
                legacy_secret_ref=legacy_secret_ref,
            )
            headers.setdefault("Authorization", f"Bearer {token}")
            return headers, params
        if auth_mode == "api_key":
            secret = resolve_connection_secret(
                connection_id,
                org_id,
                secret_key="api_key",
                legacy_secret_ref=legacy_secret_ref,
            )
            api_key_in = str(config.get("api_key_in") or "header").strip().lower()
            api_key_name = str(config.get("api_key_name") or "X-API-Key").strip() or "X-API-Key"
            if api_key_in == "query":
                params[api_key_name] = secret
            else:
                headers[api_key_name] = secret
            return headers, params
        if auth_mode == "basic":
            username = str(config.get("username") or "").strip()
            password = resolve_connection_secret(
                connection_id,
                org_id,
                secret_key="password",
                legacy_secret_ref=legacy_secret_ref,
            )
            token = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("ascii")
            headers.setdefault("Authorization", f"Basic {token}")
            return headers, params
        if auth_mode == "oauth2":
            connection = self._ensure_oauth_access_token(connection, org_id)
            try:
                access_token = resolve_connection_secret(
                    str(connection.get("id") or "") or None,
                    org_id,
                    secret_key="access_token",
                    legacy_secret_ref=connection.get("secret_ref"),
                )
            except SecretStoreError as exc:
                raise IntegrationProviderError(f"OAuth2 access token unavailable: {exc}") from exc
            headers.setdefault("Authorization", f"Bearer {access_token}")
            return headers, params
        raise IntegrationProviderError(f"Unsupported auth_mode: {auth_mode}")

    def execute_request(self, connection: dict, request_config: dict, org_id: str) -> dict:
        method = str(request_config.get("method") or "GET").strip().upper()
        url = self._build_url(connection, request_config)
        request_headers = _coerce_object(request_config.get("headers"), "headers")
        query = _coerce_object(request_config.get("query"), "query")
        timeout = float(request_config.get("timeout_seconds") or connection.get("config", {}).get("timeout_seconds") or 30)
        body_json = request_config.get("json")
        body_raw = request_config.get("body")
        content = None
        json_payload = None
        if body_json is not None:
            if isinstance(body_json, str):
                try:
                    body_json = json.loads(body_json)
                except Exception:
                    pass
            json_payload = body_json
        elif body_raw is not None:
            if isinstance(body_raw, (dict, list)):
                content = json.dumps(body_raw)
            else:
                content = str(body_raw)
        config = connection.get("config") if isinstance(connection.get("config"), dict) else {}
        auth_mode = str(config.get("auth_mode") or config.get("provider_auth_type") or "none").strip().lower()

        def _perform_request(current_connection: dict) -> tuple[httpx.Response, dict[str, Any], dict[str, Any]]:
            auth_headers, auth_params = self._build_auth(current_connection, org_id)
            current_headers = {**auth_headers, **request_headers}
            current_params = {**auth_params, **query}
            if content is not None and "Content-Type" not in current_headers and isinstance(body_raw, (dict, list)):
                current_headers["Content-Type"] = "application/json"
            with httpx.Client(timeout=timeout) as client:
                current_response = client.request(
                    method,
                    url,
                    params=current_params or None,
                    headers=current_headers or None,
                    json=json_payload,
                    content=content,
                )
            return current_response, current_headers, current_params

        response, headers, params = _perform_request(connection)
        if auth_mode == "oauth2" and response.status_code == 401:
            try:
                refreshed = self.refresh_oauth_tokens(connection, org_id)
                refreshed_connection = refreshed.get("connection") or connection
                response, headers, params = _perform_request(refreshed_connection)
                connection = refreshed_connection
            except Exception:
                pass
        try:
            parsed = response.json()
        except Exception:
            parsed = None
        return {
            "ok": response.status_code < 400,
            "status_code": response.status_code,
            "url": str(response.request.url),
            "method": method,
            "request_headers": _redact_headers(headers),
            "request_query": params,
            "request_body_json": json_payload,
            "request_body_text": content,
            "headers": dict(response.headers),
            "body_json": parsed,
            "body_text": response.text if parsed is None else None,
        }

    def test_connection(self, connection: dict, org_id: str) -> dict:
        config = connection.get("config") if isinstance(connection.get("config"), dict) else {}
        request_config = config.get("test_request") if isinstance(config.get("test_request"), dict) else {}
        if not request_config:
            request_config = {
                "method": config.get("test_method") or "GET",
                "path": config.get("test_path") or "/",
                "headers": config.get("test_headers") if isinstance(config.get("test_headers"), dict) else {},
                "query": config.get("test_query") if isinstance(config.get("test_query"), dict) else {},
            }
        return self.execute_request(connection, request_config, org_id)

    def run_sync(self, connection: dict, sync_config: dict, org_id: str, checkpoint: dict | None = None) -> dict:
        resolved = _resolve_sync_config(connection, sync_config)
        _validate_sync_governance(connection, resolved)
        request_config = resolved.get("request") if isinstance(resolved.get("request"), dict) else {}
        if not request_config:
            raise IntegrationProviderError("Sync request configuration is required")
        query = _coerce_object(request_config.get("query"), "sync.request.query")
        headers = _coerce_object(request_config.get("headers"), "sync.request.headers")
        request_payload = {**request_config, "query": query, "headers": headers}
        cursor_param = str(resolved.get("cursor_param") or "").strip()
        checkpoint_cursor = checkpoint.get("cursor_value") if isinstance(checkpoint, dict) else None
        if cursor_param and checkpoint_cursor not in (None, "") and cursor_param not in request_payload["query"]:
            request_payload["query"][cursor_param] = checkpoint_cursor
        if resolved.get("limit_param") and resolved.get("max_items") not in (None, ""):
            limit_param = str(resolved.get("limit_param")).strip()
            if limit_param and limit_param not in request_payload["query"]:
                request_payload["query"][limit_param] = _coerce_int(resolved.get("max_items"), 0) or resolved.get("max_items")

        response = self.execute_request(connection, request_payload, org_id)
        body = response.get("body_json")
        items_path = str(resolved.get("items_path") or "").strip()
        items_value = _get_path_value(body, items_path) if items_path else body
        if items_value is None:
            items: list[Any] = []
        elif isinstance(items_value, list):
            items = items_value
        else:
            items = [items_value]

        next_cursor = None
        next_cursor_source = None
        cursor_value_path = str(resolved.get("cursor_value_path") or "").strip()
        if cursor_value_path:
            next_cursor = _get_path_value(body, cursor_value_path)
            if next_cursor not in (None, ""):
                next_cursor_source = cursor_value_path
        if next_cursor in (None, "") and items:
            last_item_cursor_path = str(resolved.get("last_item_cursor_path") or "").strip()
            if last_item_cursor_path:
                next_cursor = _get_path_value(items[-1], last_item_cursor_path)
                if next_cursor not in (None, ""):
                    next_cursor_source = f"last_item.{last_item_cursor_path}"
        if next_cursor in (None, ""):
            next_cursor = checkpoint_cursor
            if next_cursor not in (None, ""):
                next_cursor_source = "checkpoint.cursor_value"

        scope_key = str(resolved.get("scope_key") or resolved.get("resource_key") or "default").strip() or "default"
        return {
            **response,
            "scope_key": scope_key,
            "resource_key": str(resolved.get("resource_key") or scope_key),
            "item_count": len(items),
            "items": items,
            "next_cursor": next_cursor,
            "next_cursor_source": next_cursor_source,
            "checkpoint": {
                "scope_key": scope_key,
                "cursor_value": next_cursor,
                "cursor_json": {
                    "next_cursor": next_cursor,
                    "next_cursor_source": next_cursor_source,
                    "item_count": len(items),
                },
            },
        }


_GENERIC_REST_PROVIDER = GenericRestProvider()


class XeroProvider(GenericRestProvider):
    key = "xero"

    def _fetch_xero_tenants(self, connection: dict, access_token: str) -> list[dict[str, Any]]:
        config = connection.get("config") if isinstance(connection.get("config"), dict) else {}
        timeout = float(config.get("timeout_seconds") or 30)
        with httpx.Client(timeout=timeout) as client:
            response = client.get(
                "https://api.xero.com/connections",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "application/json",
                },
            )
        try:
            body = response.json()
        except Exception as exc:
            raise IntegrationProviderError(f"Xero tenant lookup returned non-JSON response: {response.text[:300]}") from exc
        if response.status_code >= 400:
            error_message = None
            if isinstance(body, dict):
                error_message = body.get("error_description") or body.get("error") or body.get("message")
            raise IntegrationProviderError(f"Xero tenant lookup failed: {error_message or f'HTTP {response.status_code}'}")
        if not isinstance(body, list):
            raise IntegrationProviderError("Xero tenant lookup must return a JSON array")
        tenants: list[dict[str, Any]] = []
        for item in body:
            if not isinstance(item, dict):
                continue
            tenant_id = str(item.get("tenantId") or item.get("tenant_id") or "").strip()
            tenant_name = str(item.get("tenantName") or item.get("tenant_name") or "").strip()
            connection_id = str(item.get("id") or "").strip()
            if not tenant_id and not connection_id and not tenant_name:
                continue
            tenants.append(
                {
                    "id": connection_id or None,
                    "tenantId": tenant_id or None,
                    "tenantName": tenant_name or None,
                    "tenantType": item.get("tenantType") or item.get("tenant_type"),
                    "createdDateUtc": item.get("createdDateUtc") or item.get("created_date_utc"),
                    "updatedDateUtc": item.get("updatedDateUtc") or item.get("updated_date_utc"),
                }
            )
        return tenants

    def _sync_xero_tenant_metadata(self, connection: dict, org_id: str, access_token: str) -> dict:
        config = connection.get("config") if isinstance(connection.get("config"), dict) else {}
        try:
            tenants = self._fetch_xero_tenants(connection, access_token)
        except Exception as exc:
            return _update_connection_config(
                connection,
                {
                    "xero_tenants": [],
                    "xero_tenant_sync_error": str(exc),
                },
            )
        existing_tenant_id = str(config.get("xero_tenant_id") or "").strip()
        selected_tenant = None
        if existing_tenant_id:
            selected_tenant = next((tenant for tenant in tenants if str(tenant.get("tenantId") or "").strip() == existing_tenant_id), None)
        if selected_tenant is None and tenants:
            selected_tenant = tenants[0]
        return _update_connection_config(
            connection,
            {
                "xero_tenants": tenants,
                "xero_tenant_id": selected_tenant.get("tenantId") if selected_tenant else None,
                "xero_tenant_name": selected_tenant.get("tenantName") if selected_tenant else None,
                "xero_tenant_type": selected_tenant.get("tenantType") if selected_tenant else None,
                "xero_connection_id": selected_tenant.get("id") if selected_tenant else None,
                "xero_tenant_sync_error": None,
            },
        )

    def _store_oauth_token_response(self, connection: dict, org_id: str, token_body: dict) -> dict:
        next_connection = super()._store_oauth_token_response(connection, org_id, token_body)
        access_token = token_body.get("access_token")
        if isinstance(access_token, str) and access_token.strip():
            return self._sync_xero_tenant_metadata(next_connection, org_id, access_token.strip())
        return next_connection

    def _build_auth(self, connection: dict, org_id: str) -> tuple[dict[str, str], dict[str, Any]]:
        headers, params = super()._build_auth(connection, org_id)
        config = connection.get("config") if isinstance(connection.get("config"), dict) else {}
        tenant_id = str(config.get("xero_tenant_id") or "").strip()
        headers.setdefault("Accept", "application/json")
        if tenant_id:
            headers.setdefault("xero-tenant-id", tenant_id)
        return headers, params


_XERO_PROVIDER = XeroProvider()


class GenericWebhookProvider:
    key = "generic_webhook"

    def _build_url(self, connection: dict, request_config: dict) -> str:
        config = connection.get("config") if isinstance(connection.get("config"), dict) else {}
        url = str(request_config.get("url") or config.get("endpoint_url") or "").strip()
        if not url:
            raise IntegrationProviderError("Connection endpoint_url is required")
        return url

    def execute_request(self, connection: dict, request_config: dict, org_id: str) -> dict:
        config = connection.get("config") if isinstance(connection.get("config"), dict) else {}
        url = self._build_url(connection, request_config)
        method = str(request_config.get("method") or "POST").strip().upper()
        headers = {
            **_coerce_object(config.get("default_headers"), "default_headers"),
            **_coerce_object(request_config.get("headers"), "headers"),
        }
        timeout = float(request_config.get("timeout_seconds") or config.get("timeout_seconds") or 30)
        payload = request_config.get("json")
        if payload is None:
            payload = request_config.get("body")
        if isinstance(payload, str):
            try:
                parsed = json.loads(payload)
                payload = parsed
            except Exception:
                pass
        content = None
        json_payload = None
        if isinstance(payload, (dict, list)):
            json_payload = payload
            payload_bytes = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        else:
            content = "" if payload is None else str(payload)
            payload_bytes = content.encode("utf-8")
        connection_id = str(connection.get("id") or "") or None
        signing_secret = None
        try:
            signing_secret = resolve_connection_secret(
                connection_id,
                org_id,
                secret_key="signing_secret",
                legacy_secret_ref=connection.get("secret_ref"),
            )
        except Exception:
            signing_secret = None
        if signing_secret:
            headers.update(build_webhook_signature_headers(payload_bytes, signing_secret))
        with httpx.Client(timeout=timeout) as client:
            response = client.request(method, url, headers=headers or None, json=json_payload, content=content)
        try:
            parsed = response.json()
        except Exception:
            parsed = None
        return {
            "ok": response.status_code < 400,
            "status_code": response.status_code,
            "url": str(response.request.url),
            "method": method,
            "request_headers": _redact_headers(headers),
            "request_query": {},
            "request_body_json": json_payload if isinstance(json_payload, (dict, list)) else None,
            "request_body_text": None if isinstance(json_payload, (dict, list)) else content,
            "headers": dict(response.headers),
            "body_json": parsed,
            "body_text": response.text if parsed is None else None,
        }

    def test_connection(self, connection: dict, org_id: str) -> dict:
        config = connection.get("config") if isinstance(connection.get("config"), dict) else {}
        if isinstance(config.get("test_request"), dict):
            return self.execute_request(connection, config.get("test_request") or {}, org_id)
        endpoint_url = str(config.get("endpoint_url") or "").strip()
        if not endpoint_url:
            raise IntegrationProviderError("Connection endpoint_url is required")
        return {
            "ok": True,
            "status_code": None,
            "url": endpoint_url,
            "headers": {},
            "body_json": {"message": "Webhook connection configuration is valid"},
            "body_text": None,
        }

    def run_sync(self, connection: dict, sync_config: dict, org_id: str, checkpoint: dict | None = None) -> dict:
        raise IntegrationProviderError("Generic Webhook does not support polling sync")


_GENERIC_WEBHOOK_PROVIDER = GenericWebhookProvider()


def get_integration_provider(connection: dict) -> GenericRestProvider:
    provider_key = provider_key_for_connection(connection)
    if provider_key == "generic_rest":
        return _GENERIC_REST_PROVIDER
    if provider_key == "xero":
        return _XERO_PROVIDER
    if provider_key == "generic_webhook":
        return _GENERIC_WEBHOOK_PROVIDER
    raise IntegrationProviderError(f"Unsupported integration provider: {provider_key or 'unknown'}")


def test_connection(connection: dict, org_id: str) -> dict:
    provider = get_integration_provider(connection)
    try:
        return provider.test_connection(connection, org_id)
    except IntegrationProviderError:
        raise
    except SecretStoreError as exc:
        raise IntegrationProviderError(str(exc)) from exc
    except Exception as exc:
        raise IntegrationProviderError(f"Integration test failed: {exc}") from exc


def execute_connection_request(connection: dict, request_config: dict, org_id: str) -> dict:
    provider = get_integration_provider(connection)
    try:
        return provider.execute_request(connection, request_config, org_id)
    except IntegrationProviderError:
        raise
    except SecretStoreError as exc:
        raise IntegrationProviderError(str(exc)) from exc
    except Exception as exc:
        raise IntegrationProviderError(f"Integration request failed: {exc}") from exc


def execute_connection_sync(connection: dict, sync_config: dict | None, org_id: str, checkpoint: dict | None = None) -> dict:
    provider = get_integration_provider(connection)
    if not hasattr(provider, "run_sync"):
        raise IntegrationProviderError(f"Provider does not support sync: {provider_key_for_connection(connection)}")
    try:
        return provider.run_sync(connection, sync_config or {}, org_id, checkpoint)
    except IntegrationProviderError:
        raise
    except SecretStoreError as exc:
        raise IntegrationProviderError(str(exc)) from exc
    except Exception as exc:
        raise IntegrationProviderError(f"Integration sync failed: {exc}") from exc


def build_connection_authorize_url(connection: dict, redirect_uri: str, state: str | None = None) -> dict:
    provider = get_integration_provider(connection)
    if not hasattr(provider, "build_authorize_url"):
        raise IntegrationProviderError(f"Provider does not support OAuth2 authorize flows: {provider_key_for_connection(connection)}")
    return provider.build_authorize_url(connection, redirect_uri, state=state)


def exchange_connection_oauth_code(connection: dict, org_id: str, *, code: str, redirect_uri: str) -> dict:
    provider = get_integration_provider(connection)
    if not hasattr(provider, "exchange_authorization_code"):
        raise IntegrationProviderError(f"Provider does not support OAuth2 code exchange: {provider_key_for_connection(connection)}")
    return provider.exchange_authorization_code(connection, org_id, code=code, redirect_uri=redirect_uri)


def refresh_connection_oauth_tokens(connection: dict, org_id: str) -> dict:
    provider = get_integration_provider(connection)
    if not hasattr(provider, "refresh_oauth_tokens"):
        raise IntegrationProviderError(f"Provider does not support OAuth2 token refresh: {provider_key_for_connection(connection)}")
    return provider.refresh_oauth_tokens(connection, org_id)
