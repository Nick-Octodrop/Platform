"""Diagnostics helpers for module runtime."""

from __future__ import annotations

from typing import Any, Dict, List

from app.manifest_validate import validate_manifest_raw


Issue = Dict[str, Any]


def _parse_target(target: str) -> tuple[str, str] | None:
    if not isinstance(target, str):
        return None
    if target.startswith("page:"):
        return ("page", target[5:])
    if target.startswith("view:"):
        return ("view", target[5:])
    return None


def build_diagnostics(registry, get_snapshot) -> dict:
    modules = []
    for mod in registry.list():
        if not mod.get("enabled"):
            continue
        module_id = mod.get("module_id")
        manifest_hash = mod.get("current_hash")
        manifest = None
        warnings: list[Issue] = []
        if module_id and manifest_hash:
            try:
                manifest = get_snapshot(module_id, manifest_hash)
                _, _, warnings = validate_manifest_raw(manifest, expected_module_id=module_id)
            except Exception:
                manifest = None
        app = manifest.get("app") if isinstance(manifest, dict) else None
        home = app.get("home") if isinstance(app, dict) else None
        parsed = _parse_target(home) if isinstance(home, str) else None
        home_type = parsed[0] if parsed else None
        home_id = parsed[1] if parsed else None
        pages = manifest.get("pages") if isinstance(manifest, dict) else []
        views = manifest.get("views") if isinstance(manifest, dict) else []
        entities = manifest.get("entities") if isinstance(manifest, dict) else []
        modules.append(
            {
                "module_id": module_id,
                "enabled": bool(mod.get("enabled")),
                "manifest_hash": manifest_hash,
                "module_version": manifest.get("module", {}).get("version") if isinstance(manifest, dict) else None,
                "manifest_version": manifest.get("manifest_version") if isinstance(manifest, dict) else None,
                "has_app_home": bool(parsed),
                "home_target": home,
                "home_type": home_type,
                "home_id": home_id,
                "counts": {
                    "pages": len(pages) if isinstance(pages, list) else 0,
                    "views": len(views) if isinstance(views, list) else 0,
                    "entities": len(entities) if isinstance(entities, list) else 0,
                },
                "warnings": warnings,
            }
        )
    return {
        "modules": modules,
    }
