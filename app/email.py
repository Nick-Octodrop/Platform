from __future__ import annotations

import os
from typing import Any

import httpx

from app.secrets import resolve_secret
from app.template_render import render_template as render_jinja


class EmailProviderError(RuntimeError):
    pass


def render_template(text: str, context: dict, strict: bool = True) -> str:
    return render_jinja(text, context or {}, strict=strict)


class EmailProvider:
    def send(self, message: dict, connection: dict, secret_ref: str | None, org_id: str) -> dict:
        raise NotImplementedError


class PostmarkProvider(EmailProvider):
    def send(self, message: dict, connection: dict, secret_ref: str | None, org_id: str) -> dict:
        env_key = "POSTMARK_API_TOKEN"
        api_token = resolve_secret(secret_ref, org_id, env_key=env_key)
        from_email = message.get("from_email") or connection.get("config", {}).get("from_email")
        from_name = connection.get("config", {}).get("from_name")
        if not from_email:
            raise EmailProviderError("Missing from_email")
        sender = f"{from_name} <{from_email}>" if from_name else from_email
        payload = {
            "From": sender,
            "To": ",".join(message.get("to") or []),
            "Cc": ",".join(message.get("cc") or []),
            "Bcc": ",".join(message.get("bcc") or []),
            "Subject": message.get("subject"),
            "HtmlBody": message.get("body_html"),
            "TextBody": message.get("body_text"),
            "ReplyTo": message.get("reply_to"),
        }
        headers = {"X-Postmark-Server-Token": api_token}
        resp = httpx.post("https://api.postmarkapp.com/email", json=payload, headers=headers, timeout=30)
        if resp.status_code >= 400:
            raise EmailProviderError(f"Postmark error: {resp.status_code} {resp.text}")
        return resp.json()


def get_provider(connection_type: str) -> EmailProvider:
    if connection_type == "postmark":
        return PostmarkProvider()
    raise EmailProviderError(f"Unknown provider: {connection_type}")
