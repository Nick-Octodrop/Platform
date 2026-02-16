from __future__ import annotations

import base64
import os
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

from app.db import fetch_one, execute, get_conn
from app.stores_db import get_org_id


class SecretStoreError(RuntimeError):
    pass


def _get_env() -> str:
    return os.getenv("APP_ENV", os.getenv("ENV", "dev")).strip().lower() or "dev"


def _get_fernet() -> Fernet:
    key = os.getenv("APP_SECRET_KEY", "").strip()
    if not key:
        raise SecretStoreError("APP_SECRET_KEY is not set")
    try:
        # Accept raw 32-byte base64 or 32-byte urlsafe b64 key
        if len(key) == 32:
            key = base64.urlsafe_b64encode(key.encode("utf-8")).decode("utf-8")
        return Fernet(key.encode("utf-8"))
    except Exception as exc:
        raise SecretStoreError("Invalid APP_SECRET_KEY") from exc


def encrypt_secret(value: str) -> str:
    token = _get_fernet().encrypt(value.encode("utf-8"))
    return token.decode("utf-8")


def decrypt_secret(token: str) -> str:
    try:
        value = _get_fernet().decrypt(token.encode("utf-8"))
        return value.decode("utf-8")
    except InvalidToken as exc:
        raise SecretStoreError("Invalid secret token") from exc


def create_secret(org_id: str, name: str | None, value: str) -> str:
    secret_enc = encrypt_secret(value)
    with get_conn() as conn:
        row = fetch_one(
            conn,
            """
            insert into secrets (org_id, name, secret_enc, created_at, updated_at)
            values (%s, %s, %s, now(), now())
            returning id
            """,
            [org_id, name, secret_enc],
            query_name="secrets.insert",
        )
        if not row:
            raise SecretStoreError("Failed to create secret")
        return str(row["id"])


def get_secret(secret_id: str, org_id: str | None = None) -> Optional[str]:
    org = org_id or get_org_id()
    with get_conn() as conn:
        row = fetch_one(
            conn,
            """
            select secret_enc from secrets where id=%s and org_id=%s
            """,
            [secret_id, org],
            query_name="secrets.get",
        )
        if not row:
            return None
        return decrypt_secret(row["secret_enc"])


def resolve_secret(secret_ref: str | None, org_id: str, env_key: str | None = None) -> str:
    if secret_ref:
        value = get_secret(secret_ref, org_id=org_id)
        if not value:
            raise SecretStoreError("Secret not found")
        return value

    if _get_env() == "dev":
        key = env_key or ""
        if not key:
            raise SecretStoreError("Missing env key for secret fallback")
        value = os.getenv(key, "").strip()
        if not value:
            raise SecretStoreError(f"Missing env secret: {key}")
        return value

    raise SecretStoreError("Secret reference required for non-dev environments")
