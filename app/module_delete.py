"""Module deletion helpers."""

from __future__ import annotations

from datetime import datetime, timezone

SYSTEM_MODULE_IDS = {"studio", "settings", "audit", "diagnostics", "auth"}


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def collect_entity_record_ids(manifest: dict) -> set[str]:
    entity_ids: set[str] = set()
    entities = manifest.get("entities") if isinstance(manifest, dict) else None
    if isinstance(entities, dict):
        entities = [
            {"id": ent_id, **ent} if isinstance(ent, dict) else {"id": ent_id}
            for ent_id, ent in entities.items()
        ]
    if not isinstance(entities, list):
        return entity_ids
    for ent in entities:
        if not isinstance(ent, dict):
            continue
        ent_id = ent.get("id")
        if not isinstance(ent_id, str):
            continue
        entity_ids.add(ent_id)
        if ent_id.startswith("entity."):
            entity_ids.add(ent_id[len("entity.") :])
        else:
            entity_ids.add(f"entity.{ent_id}")
    return entity_ids


def delete_module_memory(
    module_id: str,
    registry,
    store,
    generic_records,
    drafts=None,
    actor: dict | None = None,
    reason: str = "delete",
    force: bool = False,
    archive: bool = False,
) -> dict:
    if module_id in SYSTEM_MODULE_IDS:
        return {
            "ok": False,
            "errors": [{"code": "MODULE_DELETE_FORBIDDEN", "message": "System module cannot be deleted", "path": "module_id", "detail": None}],
            "warnings": [],
            "module": None,
            "audit_id": None,
        }

    record = registry.get(module_id)
    if record is None:
        return {
            "ok": False,
            "errors": [{"code": "MODULE_NOT_FOUND", "message": "module not found", "path": "module_id", "detail": None}],
            "warnings": [],
            "module": None,
            "audit_id": None,
        }

    manifest_hash = record.get("current_hash")
    manifest = None
    if manifest_hash:
        try:
            manifest = store.get_snapshot(module_id, manifest_hash)
        except Exception:
            manifest = None

    entity_ids = collect_entity_record_ids(manifest or {})
    record_count = 0
    entity_counts: dict[str, int] = {}
    for entity_id in entity_ids:
        try:
            items = generic_records.list(entity_id)
        except Exception:
            items = []
        count = len(items)
        record_count += count
        if count:
            entity_counts[entity_id] = count
        if force:
            for item in items:
                rec_id = item.get("id") if isinstance(item, dict) else None
                if rec_id:
                    generic_records.delete(entity_id, rec_id)
    if record_count > 0 and not force and not archive:
        return {
            "ok": False,
            "errors": [
                {
                    "code": "MODULE_HAS_RECORDS",
                    "message": "Module has records; delete blocked unless forced",
                    "path": "module_id",
                    "detail": {"record_count": record_count, "entity_counts": entity_counts},
                }
            ],
            "warnings": [],
            "module": None,
            "audit_id": None,
        }

    if hasattr(store, "_snapshots"):
        store._snapshots.pop(module_id, None)
    if hasattr(store, "_head"):
        store._head.pop(module_id, None)
    if hasattr(store, "_audit"):
        store._audit.pop(module_id, None)

    if hasattr(registry, "_modules"):
        record["archived"] = True
        record["enabled"] = False
        registry._modules[module_id] = record
    if hasattr(registry, "_audit"):
        registry._audit[module_id] = [
            {
                "audit_id": f"delete-{module_id}",
                "module_id": module_id,
                "action": "module_archived" if archive else "module_deleted",
                "from_hash": record.get("current_hash"),
                "to_hash": None,
                "patch_id": None,
                "actor": actor,
                "reason": "archive" if archive else reason,
                "at": _now(),
            }
        ]

    if drafts is not None:
        try:
            drafts.delete_draft(module_id)
        except Exception:
            pass

    return {"ok": True, "errors": [], "warnings": [], "module": None, "audit_id": f"delete-{module_id}"}
