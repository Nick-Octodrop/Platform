from __future__ import annotations

from typing import Any
import re

from playwright.sync_api import sync_playwright

from app.email import render_template

_MARGIN_RE = re.compile(r"^(\d+(\.\d+)?)(mm|cm|in|px)$")


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
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.set_content(html, wait_until="networkidle")
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
        browser.close()
        return pdf_bytes
