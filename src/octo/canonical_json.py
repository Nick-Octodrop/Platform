"""Deterministic canonical JSON serialization."""

from __future__ import annotations

import json
import math
from typing import Any


class CanonicalJsonTypeError(TypeError):
    """Raised when an object cannot be serialized to canonical JSON."""


def _validate(obj: Any, path: str = "$") -> None:
    if isinstance(obj, dict):
        for key, value in obj.items():
            if not isinstance(key, str):
                raise CanonicalJsonTypeError(
                    f"Unsupported key type at {path}: {type(key).__name__}"
                )
            _validate(value, f"{path}.{key}")
        return
    if isinstance(obj, list):
        for idx, item in enumerate(obj):
            _validate(item, f"{path}[{idx}]")
        return
    if obj is None:
        return
    if isinstance(obj, float):
        if not math.isfinite(obj):
            raise ValueError(f"Non-finite float at {path}: {obj!r}")
        return
    if isinstance(obj, (str, int, bool)):
        return
    raise CanonicalJsonTypeError(
        f"Unsupported type at {path}: {type(obj).__name__}"
    )


def canonical_dumps(obj: Any) -> str:
    """Serialize an object to deterministic canonical JSON.

    Rules:
    - Sort dict keys recursively.
    - Preserve list order.
    - UTF-8 with non-ASCII preserved.
    - No extra whitespace.
    """
    _validate(obj)
    return json.dumps(
        obj,
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
        allow_nan=False,
    )
