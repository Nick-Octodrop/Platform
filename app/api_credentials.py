"""Helpers for Octodrop external API credentials."""

from __future__ import annotations

import hashlib
import secrets


API_KEY_PREFIX = "octo_live"


def hash_api_key(raw_token: str) -> str:
    return hashlib.sha256((raw_token or "").encode("utf-8")).hexdigest()


def generate_api_key() -> tuple[str, str, str]:
    secret_part = secrets.token_urlsafe(32)
    token = f"{API_KEY_PREFIX}_{secret_part}"
    prefix = token[:16]
    return token, prefix, hash_api_key(token)
