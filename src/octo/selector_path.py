"""Selector path resolution for JSON Pointer with @[id=...] segments."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, List


@dataclass
class SelectorPathError(Exception):
    message: str
    segment: str
    pointer_so_far: str

    def __str__(self) -> str:  # pragma: no cover - simple formatting
        return f"{self.message} (segment={self.segment!r}, pointer={self.pointer_so_far!r})"


class PointerResolveError(SelectorPathError):
    pass


class SelectorTypeError(SelectorPathError):
    pass


class SelectorNotFound(SelectorPathError):
    pass


class SelectorNotUnique(SelectorPathError):
    pass


def _decode_segment(segment: str) -> str:
    return segment.replace("~1", "/").replace("~0", "~")


def _encode_segment(segment: str) -> str:
    return segment.replace("~", "~0").replace("/", "~1")


def _is_selector(segment: str) -> bool:
    return segment.startswith("@[id=") and segment.endswith("]") and len(segment) > 6


def _selector_id(segment: str) -> str:
    return segment[len("@[id=") : -1]


def resolve_selector_path(doc: Any, selector_path: str) -> str:
    """Resolve selector segments to numeric indices and return a JSON Pointer."""
    if selector_path == "":
        return ""

    segments = selector_path.split("/")
    if segments and segments[0] == "":
        segments = segments[1:]

    current = doc
    out_segments: List[str] = []

    for raw_segment in segments:
        pointer_so_far = "/" + "/".join(out_segments) if out_segments else ""

        if _is_selector(raw_segment):
            if not isinstance(current, list):
                raise SelectorTypeError(
                    "Selector segment used on non-list",
                    raw_segment,
                    pointer_so_far,
                )
            target_id = _selector_id(raw_segment)
            matches = []
            for idx, item in enumerate(current):
                if isinstance(item, dict):
                    item_id = item.get("id")
                    if isinstance(item_id, str) and item_id == target_id:
                        matches.append(idx)
            if not matches:
                raise SelectorNotFound(
                    "Selector did not match any element",
                    raw_segment,
                    pointer_so_far,
                )
            if len(matches) > 1:
                raise SelectorNotUnique(
                    "Selector matched multiple elements",
                    raw_segment,
                    pointer_so_far,
                )
            match_idx = matches[0]
            current = current[match_idx]
            out_segments.append(str(match_idx))
            continue

        segment = _decode_segment(raw_segment)

        if isinstance(current, dict):
            if segment not in current:
                raise PointerResolveError(
                    "Missing object key",
                    raw_segment,
                    pointer_so_far,
                )
            current = current[segment]
            out_segments.append(_encode_segment(segment))
            continue

        if isinstance(current, list):
            if not segment.isdigit():
                raise PointerResolveError(
                    "Invalid list index",
                    raw_segment,
                    pointer_so_far,
                )
            idx = int(segment)
            if idx < 0 or idx >= len(current):
                raise PointerResolveError(
                    "List index out of range",
                    raw_segment,
                    pointer_so_far,
                )
            current = current[idx]
            out_segments.append(str(idx))
            continue

        raise PointerResolveError(
            "Cannot traverse into non-container",
            raw_segment,
            pointer_so_far,
        )

    return "/" + "/".join(out_segments)
