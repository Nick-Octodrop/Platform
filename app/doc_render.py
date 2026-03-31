from __future__ import annotations

from typing import Any
import logging
import re
import time

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

from app.email import render_template

_MARGIN_RE = re.compile(r"^(\d+(\.\d+)?)(mm|cm|in|px)$")
logger = logging.getLogger("octo.doc_render")


def render_html(template_html: str, context: dict[str, Any]) -> str:
    return render_template(template_html or "", context, strict=True)


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
    wrapped_header = header_html
    wrapped_footer = footer_html
    if header_html:
        wrapped_header = (
            f'<div style="width:100%;box-sizing:border-box;padding-left:{margin_left};padding-right:{margin_right};">'
            f"{header_html}"
            "</div>"
        )
    if footer_html:
        wrapped_footer = (
            f'<div style="width:100%;box-sizing:border-box;padding-left:{margin_left};padding-right:{margin_right};">'
            f"{footer_html}"
            "</div>"
        )
    logger.info("doc_render:start html_chars=%s paper_size=%s", len(html or ""), paper_size or "")
    with sync_playwright() as p:
        browser = None
        context = None
        try:
            logger.info("doc_render:launch_browser")
            browser = p.chromium.launch(
                headless=True,
                args=[
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                ],
            )
            logger.info("doc_render:browser_launched")
            context = browser.new_context()
            logger.info("doc_render:context_created")
            page = context.new_page()
            logger.info("doc_render:page_created")
            page.set_default_timeout(15000)
            # Let the DOM settle immediately, then give assets a short window to
            # load so a slow remote image cannot hold PDF generation open.
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
            if browser is not None:
                browser.close()
