from __future__ import annotations

import os
import smtplib
import uuid
from typing import Any
from email.message import EmailMessage

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


class SmtpProvider(EmailProvider):
    def send(self, message: dict, connection: dict, secret_ref: str | None, org_id: str) -> dict:
        config = connection.get("config") or {}
        host = (config.get("host") or "").strip()
        port = int(config.get("port") or 587)
        security = (config.get("security") or "starttls").strip().lower()
        username = (config.get("username") or "").strip()
        password = resolve_secret(secret_ref, org_id, env_key="SMTP_PASSWORD") if secret_ref else (config.get("password") or "")
        from_email = message.get("from_email") or config.get("from_email")
        from_name = config.get("from_name")

        if not host:
            raise EmailProviderError("Missing SMTP host")
        if not from_email:
            raise EmailProviderError("Missing from_email")
        if security not in {"none", "starttls", "ssl"}:
            raise EmailProviderError("Invalid SMTP security mode")

        to_list = [addr for addr in (message.get("to") or []) if addr]
        cc_list = [addr for addr in (message.get("cc") or []) if addr]
        bcc_list = [addr for addr in (message.get("bcc") or []) if addr]
        recipients = [*to_list, *cc_list, *bcc_list]
        if not recipients:
            raise EmailProviderError("Missing recipients")

        sender = f"{from_name} <{from_email}>" if from_name else from_email
        msg = EmailMessage()
        msg["From"] = sender
        msg["To"] = ", ".join(to_list)
        if cc_list:
            msg["Cc"] = ", ".join(cc_list)
        if message.get("reply_to"):
            msg["Reply-To"] = message.get("reply_to")
        msg["Subject"] = message.get("subject") or ""
        msg.set_content(message.get("body_text") or "")
        if message.get("body_html"):
            msg.add_alternative(message.get("body_html"), subtype="html")

        if security == "ssl":
            with smtplib.SMTP_SSL(host, port, timeout=30) as server:
                if username:
                    server.login(username, password or "")
                server.send_message(msg, to_addrs=recipients)
        else:
            with smtplib.SMTP(host, port, timeout=30) as server:
                if security == "starttls":
                    server.starttls()
                if username:
                    server.login(username, password or "")
                server.send_message(msg, to_addrs=recipients)
        return {"id": str(uuid.uuid4())}


def get_provider(connection_type: str) -> EmailProvider:
    if connection_type == "smtp":
        return SmtpProvider()
    if connection_type == "postmark":
        return PostmarkProvider()
    raise EmailProviderError(f"Unknown provider: {connection_type}")
