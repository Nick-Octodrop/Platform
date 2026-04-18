"""Shared webhook signing helpers."""

from __future__ import annotations

import hashlib
import hmac
import time
import base64


def _canonical_signature_input(payload: bytes, timestamp: str | None = None) -> bytes:
    if timestamp:
        return timestamp.encode("utf-8") + b"." + payload
    return payload


def build_webhook_signature_headers(
    payload: bytes,
    secret: str,
    *,
    timestamp: str | None = None,
) -> dict[str, str]:
    ts = (timestamp or str(int(time.time()))).strip()
    digest = hmac.new(secret.encode("utf-8"), _canonical_signature_input(payload, ts), hashlib.sha256).hexdigest()
    return {
        "X-Octo-Timestamp": ts,
        "X-Octo-Signature": f"sha256={digest}",
    }


def verify_webhook_signature(
    payload: bytes,
    secret: str,
    provided_signature: str | None,
    *,
    provided_timestamp: str | None = None,
    tolerance_seconds: int = 300,
    allow_legacy_payload_only: bool = True,
) -> tuple[bool, str | None]:
    if not provided_signature:
        return False, "Missing webhook signature"
    candidate = provided_signature.strip()
    if candidate.startswith("sha256="):
        candidate = candidate.split("=", 1)[1].strip()

    timestamp = (provided_timestamp or "").strip() or None
    if timestamp:
        try:
            age = abs(int(time.time()) - int(timestamp))
        except Exception:
            return False, "Invalid webhook timestamp"
        if age > max(1, int(tolerance_seconds or 300)):
            return False, "Webhook timestamp expired"
        digest = hmac.new(secret.encode("utf-8"), _canonical_signature_input(payload, timestamp), hashlib.sha256).hexdigest()
        return hmac.compare_digest(candidate, digest), None if hmac.compare_digest(candidate, digest) else "Invalid webhook signature"

    if allow_legacy_payload_only:
        raw_digest = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).digest()
        hex_digest = raw_digest.hex()
        b64_digest = base64.b64encode(raw_digest).decode("ascii")
        valid = hmac.compare_digest(candidate, hex_digest) or hmac.compare_digest(candidate, b64_digest)
        return valid, None if valid else "Invalid webhook signature"

    return False, "Missing webhook timestamp"
