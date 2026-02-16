"""Manifest hashing utilities."""

from __future__ import annotations

import hashlib
from typing import Any

from .canonical_json import canonical_dumps


def manifest_hash(manifest_obj: Any) -> str:
    """Return the canonical SHA-256 hash for a manifest object."""
    data = canonical_dumps(manifest_obj).encode("utf-8")
    digest = hashlib.sha256(data).hexdigest()
    return f"sha256:{digest}"
