import json
import os
import time
import urllib.error
import urllib.request

import pytest

from app.webhook_signing import build_webhook_signature_headers


pytestmark = pytest.mark.skipif(
    os.getenv("OCTO_RUN_STAGING_SECURITY_TESTS", "").strip().lower() not in {"1", "true", "yes"},
    reason="Set OCTO_RUN_STAGING_SECURITY_TESTS=1 and staging env vars to run real environment security tests.",
)


def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        pytest.skip(f"{name} is required for staging security tests")
    return value


def _request(method: str, path: str, token: str, workspace_id: str, body: dict | None = None) -> tuple[int, dict | str]:
    base_url = _required_env("OCTO_STAGING_BASE_URL").rstrip("/")
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        f"{base_url}{path}",
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "X-Workspace-Id": workspace_id,
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            raw = response.read().decode("utf-8")
            return response.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        try:
            payload: dict | str = json.loads(raw) if raw else {}
        except Exception:
            payload = raw
        return exc.code, payload


def _blocked(status: int) -> bool:
    return status in {401, 403, 404}


def test_cross_tenant_record_direct_id_is_blocked():
    token_b = _required_env("OCTO_STAGING_TOKEN_B")
    workspace_b = _required_env("OCTO_STAGING_WORKSPACE_B")
    entity_id = _required_env("OCTO_STAGING_ENTITY_ID")
    record_id_a = _required_env("OCTO_STAGING_RECORD_ID_A")

    status, _payload = _request("GET", f"/records/{entity_id}/{record_id_a}", token_b, workspace_b)

    assert _blocked(status)


def test_cross_tenant_record_list_search_does_not_leak():
    token_b = _required_env("OCTO_STAGING_TOKEN_B")
    workspace_b = _required_env("OCTO_STAGING_WORKSPACE_B")
    entity_id = _required_env("OCTO_STAGING_ENTITY_ID")
    record_id_a = _required_env("OCTO_STAGING_RECORD_ID_A")

    status, payload = _request("GET", f"/records/{entity_id}?q={record_id_a}&limit=200", token_b, workspace_b)

    assert status == 200
    raw = json.dumps(payload)
    assert record_id_a not in raw


def test_cross_tenant_record_update_and_delete_are_blocked():
    token_b = _required_env("OCTO_STAGING_TOKEN_B")
    workspace_b = _required_env("OCTO_STAGING_WORKSPACE_B")
    entity_id = _required_env("OCTO_STAGING_ENTITY_ID")
    record_id_a = _required_env("OCTO_STAGING_RECORD_ID_A")

    put_status, _put_payload = _request("PUT", f"/records/{entity_id}/{record_id_a}", token_b, workspace_b, {"record": {}})
    delete_status, _delete_payload = _request("DELETE", f"/records/{entity_id}/{record_id_a}", token_b, workspace_b)

    assert _blocked(put_status)
    assert _blocked(delete_status)


def test_cross_tenant_attachment_download_is_blocked():
    attachment_id_a = os.getenv("OCTO_STAGING_ATTACHMENT_ID_A", "").strip()
    if not attachment_id_a:
        pytest.skip("OCTO_STAGING_ATTACHMENT_ID_A is required for attachment isolation test")
    token_b = _required_env("OCTO_STAGING_TOKEN_B")
    workspace_b = _required_env("OCTO_STAGING_WORKSPACE_B")

    status, _payload = _request("GET", f"/attachments/{attachment_id_a}/download", token_b, workspace_b)

    assert _blocked(status)


def test_forged_webhook_signature_is_rejected():
    webhook_id = os.getenv("OCTO_STAGING_WEBHOOK_ID", "").strip()
    if not webhook_id:
        pytest.skip("OCTO_STAGING_WEBHOOK_ID is required for webhook signature test")
    base_url = _required_env("OCTO_STAGING_BASE_URL").rstrip("/")
    payload = b'{"event":"security.test"}'
    req = urllib.request.Request(
        f"{base_url}/integrations/webhooks/{webhook_id}/ingest",
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Octo-Signature": "bad-signature",
            "X-Octo-Timestamp": str(int(time.time())),
        },
    )

    with pytest.raises(urllib.error.HTTPError) as exc_info:
        urllib.request.urlopen(req, timeout=20)

    assert exc_info.value.code in {400, 401, 403}


def test_replayed_webhook_timestamp_is_rejected_when_secret_is_configured():
    webhook_id = os.getenv("OCTO_STAGING_WEBHOOK_ID", "").strip()
    webhook_secret = os.getenv("OCTO_STAGING_WEBHOOK_SECRET", "").strip()
    if not webhook_id or not webhook_secret:
        pytest.skip("OCTO_STAGING_WEBHOOK_ID and OCTO_STAGING_WEBHOOK_SECRET are required for replay test")
    base_url = _required_env("OCTO_STAGING_BASE_URL").rstrip("/")
    payload = b'{"event":"security.test"}'
    old_timestamp = str(int(time.time()) - 10_000)
    headers = build_webhook_signature_headers(payload, webhook_secret, timestamp=old_timestamp)
    req = urllib.request.Request(
        f"{base_url}/integrations/webhooks/{webhook_id}/ingest",
        data=payload,
        method="POST",
        headers={"Content-Type": "application/json", **headers},
    )

    with pytest.raises(urllib.error.HTTPError) as exc_info:
        urllib.request.urlopen(req, timeout=20)

    assert exc_info.value.code in {400, 401, 403}
