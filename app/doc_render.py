from __future__ import annotations

import base64
import mimetypes
from typing import Any
import logging
import re
import threading
import time
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

from app.email import render_template

_MARGIN_RE = re.compile(r"^(\d+(\.\d+)?)(mm|cm|in|px)$")
_IMG_SRC_RE = re.compile(r"(<img\b[^>]*?\bsrc\s*=\s*)(['\"])([^'\"]+)(\2)", re.IGNORECASE)
_MAX_INLINE_ASSET_BYTES = 5 * 1024 * 1024
logger = logging.getLogger("octo.doc_render")
_PLAYWRIGHT_LOCK = threading.Lock()
_PLAYWRIGHT_MANAGER = None
_PLAYWRIGHT_BROWSER = None


def _get_shared_browser():
    global _PLAYWRIGHT_MANAGER, _PLAYWRIGHT_BROWSER
    with _PLAYWRIGHT_LOCK:
        if _PLAYWRIGHT_MANAGER is None:
            logger.info("doc_render:init_playwright")
            _PLAYWRIGHT_MANAGER = sync_playwright().start()
        if _PLAYWRIGHT_BROWSER is None or not _PLAYWRIGHT_BROWSER.is_connected():
            logger.info("doc_render:launch_shared_browser")
            _PLAYWRIGHT_BROWSER = _PLAYWRIGHT_MANAGER.chromium.launch(
                headless=True,
                args=[
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                ],
            )
        return _PLAYWRIGHT_BROWSER


def render_html(template_html: str, context: dict[str, Any]) -> str:
    return render_template(template_html or "", context, strict=True)


def _fetch_asset_as_data_uri(url: str) -> str:
    request = Request(url, headers={"User-Agent": "Octodrop/1.0"})
    with urlopen(request, timeout=5) as response:
        payload = response.read(_MAX_INLINE_ASSET_BYTES + 1)
        if len(payload) > _MAX_INLINE_ASSET_BYTES:
            raise ValueError("asset too large to inline")
        content_type = ""
        headers = getattr(response, "headers", None)
        if headers is not None:
            try:
                content_type = headers.get_content_type()
            except Exception:
                content_type = str(headers.get("Content-Type") or "").split(";", 1)[0].strip()
        if not content_type:
            content_type = mimetypes.guess_type(url)[0] or "application/octet-stream"
        encoded = base64.b64encode(payload).decode("ascii")
        return f"data:{content_type};base64,{encoded}"


def _inline_header_footer_assets(template_html: str | None) -> str | None:
    if not isinstance(template_html, str) or not template_html.strip():
        return template_html

    def _replace(match: re.Match[str]) -> str:
        prefix = match.group(1)
        quote = match.group(2)
        source = (match.group(3) or "").strip()
        parsed = urlparse(source)
        if not source or source.startswith("data:") or parsed.scheme not in {"http", "https"}:
            return match.group(0)
        try:
            inlined = _fetch_asset_as_data_uri(source)
        except Exception as exc:
            logger.warning("doc_render:inline_asset_failed url=%s error=%s", source, exc)
            return match.group(0)
        return f"{prefix}{quote}{inlined}{quote}"

    return _IMG_SRC_RE.sub(_replace, template_html)


def normalize_margins(margins: dict | None) -> dict:
    if not isinstance(margins, dict):
        return {}
    normalized: dict = {}
    for key in ("top", "right", "bottom", "left"):
        value = str(margins.get(key) or "").strip()
        if not value:
            continue
        match = _MARGIN_RE.match(value)
        if not match:
            raise ValueError(f"Invalid margin value: {value}")
        num = float(match.group(1))
        unit = match.group(3)
        mm_val = num
        if unit == "cm":
            mm_val = num * 10.0
        elif unit == "in":
            mm_val = num * 25.4
        elif unit == "px":
            mm_val = num * 0.264583
        if mm_val < 0 or mm_val > 100:
            raise ValueError(f"Margin out of range: {value}")
        normalized[key] = value
    return normalized


def render_pdf(
    html: str,
    paper_size: str | None = None,
    margins: dict | None = None,
    header_html: str | None = None,
    footer_html: str | None = None,
) -> bytes:
    started_at = time.perf_counter()
    margin_left = (margins or {}).get("left", "0")
    margin_right = (margins or {}).get("right", "0")
    wrapped_header = _inline_header_footer_assets(header_html)
    wrapped_footer = _inline_header_footer_assets(footer_html)
    if header_html:
        wrapped_header = (
            f'<div style="width:100%;box-sizing:border-box;padding-left:{margin_left};padding-right:{margin_right};">'
            f"{wrapped_header or ''}"
            "</div>"
        )
    if footer_html:
        wrapped_footer = (
            f'<div style="width:100%;box-sizing:border-box;padding-left:{margin_left};padding-right:{margin_right};">'
            f"{wrapped_footer or ''}"
            "</div>"
        )
    logger.info("doc_render:start html_chars=%s paper_size=%s", len(html or ""), paper_size or "")
    context = None
    try:
        browser = _get_shared_browser()
        context = browser.new_context()
        logger.info("doc_render:context_created")
        page = context.new_page()
        logger.info("doc_render:page_created")
        page.set_default_timeout(15000)
        page.set_content(html, wait_until="domcontentloaded", timeout=15000)
        logger.info("doc_render:content_set")
        try:
            page.wait_for_load_state("load", timeout=2000)
            logger.info("doc_render:load_state_complete")
        except PlaywrightTimeoutError:
            logger.info("doc_render:load_state_timeout")
        pdf_args: dict = {}
        if paper_size:
            pdf_args["format"] = paper_size
        if margins:
            pdf_args["margin"] = margins
        pdf_args["print_background"] = True
        if header_html or footer_html:
            pdf_args["display_header_footer"] = True
            pdf_args["header_template"] = wrapped_header or "<span></span>"
            pdf_args["footer_template"] = wrapped_footer or "<span></span>"
        pdf_bytes = page.pdf(**pdf_args)
        logger.info(
            "doc_render:pdf_complete bytes=%s total_ms=%.1f",
            len(pdf_bytes or b""),
            (time.perf_counter() - started_at) * 1000.0,
        )
        return pdf_bytes
    finally:
        if context is not None:
            context.close()
