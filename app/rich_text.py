from __future__ import annotations

import html
import re
from typing import List

from markupsafe import Markup


_HEADING_RE = re.compile(r"^\s{0,3}(#{1,3})\s+(.*)$")
_UNORDERED_LIST_RE = re.compile(r"^\s*[-*+]\s+(.*)$")
_ORDERED_LIST_RE = re.compile(r"^\s*\d+\.\s+(.*)$")
_LINK_RE = re.compile(r"\[([^\]]+)\]\((https?://[^\s)]+)\)")
_BOLD_RE = re.compile(r"(\*\*|__)(.+?)\1")


def _escape_text(value: str) -> str:
    return html.escape(value or "", quote=False)


def _format_inline(value: str) -> str:
    escaped = _escape_text(value)

    def _replace_link(match: re.Match[str]) -> str:
        label = match.group(1)
        url = match.group(2)
        return f'<a href="{html.escape(url, quote=True)}">{_escape_text(label)}</a>'

    escaped = _LINK_RE.sub(_replace_link, escaped)
    escaped = _BOLD_RE.sub(r"<strong>\2</strong>", escaped)
    return escaped


def render_rich_text(value: str | None) -> Markup:
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not text:
        return Markup("")

    blocks: List[str] = []
    paragraph_lines: List[str] = []
    list_kind: str | None = None
    list_items: List[str] = []

    def _flush_paragraph() -> None:
        nonlocal paragraph_lines
        if not paragraph_lines:
            return
        content = "<br>".join(_format_inline(line) for line in paragraph_lines)
        blocks.append(f"<p>{content}</p>")
        paragraph_lines = []

    def _flush_list() -> None:
        nonlocal list_kind, list_items
        if not list_kind or not list_items:
            list_kind = None
            list_items = []
            return
        items_html = "".join(f"<li>{item}</li>" for item in list_items)
        blocks.append(f"<{list_kind}>{items_html}</{list_kind}>")
        list_kind = None
        list_items = []

    for raw_line in text.split("\n"):
        line = raw_line.rstrip()
        stripped = line.strip()
        if not stripped:
            _flush_paragraph()
            _flush_list()
            continue

        heading_match = _HEADING_RE.match(line)
        if heading_match:
            _flush_paragraph()
            _flush_list()
            level = min(len(heading_match.group(1)), 3)
            content = _format_inline(heading_match.group(2).strip())
            blocks.append(f"<h{level}>{content}</h{level}>")
            continue

        unordered_match = _UNORDERED_LIST_RE.match(line)
        if unordered_match:
            _flush_paragraph()
            if list_kind not in (None, "ul"):
                _flush_list()
            list_kind = "ul"
            list_items.append(_format_inline(unordered_match.group(1).strip()))
            continue

        ordered_match = _ORDERED_LIST_RE.match(line)
        if ordered_match:
            _flush_paragraph()
            if list_kind not in (None, "ol"):
                _flush_list()
            list_kind = "ol"
            list_items.append(_format_inline(ordered_match.group(1).strip()))
            continue

        if list_kind and list_items and (line.startswith("  ") or line.startswith("\t")):
            list_items[-1] = f"{list_items[-1]}<br>{_format_inline(stripped)}"
            continue

        if list_kind:
            _flush_list()
        paragraph_lines.append(stripped)

    _flush_paragraph()
    _flush_list()
    return Markup("".join(blocks))
