"""Manifest normalization for legacy and v0 contract shapes."""

from __future__ import annotations

from typing import Any, Dict, List


def _title_case(value: str) -> str:
    parts = [p for p in value.replace("-", "_").split("_") if p]
    return " ".join(p[:1].upper() + p[1:] for p in parts) if parts else value


def _normalize_fields(fields: Any) -> list[dict]:
    if isinstance(fields, list):
        normalized = []
        for f in fields:
            if not isinstance(f, dict):
                continue
            item = dict(f)
            if item.get("type") == "enum":
                options = item.get("options") or item.get("values")
                if isinstance(options, list) and options and all(isinstance(opt, str) for opt in options):
                    item["options"] = [{"value": opt, "label": _title_case(opt)} for opt in options]
            normalized.append(item)
        return normalized
    if isinstance(fields, dict):
        items = []
        for fid, fdef in fields.items():
            if isinstance(fdef, dict):
                item = dict(fdef)
                item.setdefault("id", fid)
                if item.get("type") == "enum":
                    options = item.get("options") or item.get("values")
                    if isinstance(options, list) and options and all(isinstance(opt, str) for opt in options):
                        item["options"] = [{"value": opt, "label": _title_case(opt)} for opt in options]
                items.append(item)
        return items
    return []


def _normalize_entities(entities: Any) -> list[dict]:
    if isinstance(entities, list):
        normalized = []
        for ent in entities:
            if not isinstance(ent, dict):
                continue
            item = dict(ent)
            item["fields"] = _normalize_fields(item.get("fields"))
            normalized.append(item)
        return normalized
    if isinstance(entities, dict):
        normalized = []
        for eid, ent in entities.items():
            if not isinstance(ent, dict):
                continue
            item = dict(ent)
            item.setdefault("id", eid)
            item["fields"] = _normalize_fields(item.get("fields"))
            normalized.append(item)
        return normalized
    return []


def _canonical_entity_id(entity: str, entity_ids: set[str]) -> str:
    if entity in entity_ids:
        return entity
    if not entity.startswith("entity."):
        prefixed = f"entity.{entity}"
        if prefixed in entity_ids:
            return prefixed
    return entity


def _normalize_view(view: dict, entity_ids: set[str]) -> dict:
    item = dict(view)
    vtype = item.get("kind") or item.get("type")
    if vtype:
        item["kind"] = vtype
    entity = item.get("entity") or item.get("entity_id") or item.get("entityId")
    if entity:
        item["entity"] = _canonical_entity_id(entity, entity_ids)

    if vtype == "list":
        if "columns" not in item and isinstance(item.get("fields"), list):
            item["columns"] = [{"field_id": fid} for fid in item.get("fields") if isinstance(fid, str)]
        if "columns" in item and isinstance(item.get("columns"), list):
            cols = []
            for col in item.get("columns"):
                if isinstance(col, dict) and col.get("field_id"):
                    cols.append(col)
                elif isinstance(col, str):
                    cols.append({"field_id": col})
            item["columns"] = cols
    if vtype == "form":
        if "sections" not in item and isinstance(item.get("fields"), list):
            item["sections"] = [{"id": "main", "title": "Main", "fields": list(item.get("fields"))}]
        if "sections" in item and isinstance(item.get("sections"), list):
            sections = []
            for sec in item.get("sections"):
                if isinstance(sec, dict):
                    sections.append(sec)
            item["sections"] = sections
    return item


def _normalize_blocks(blocks: Any) -> list[dict]:
    if not isinstance(blocks, list):
        return []
    normalized = []
    for block in blocks:
        if not isinstance(block, dict):
            continue
        item = dict(block)
        kind = item.get("kind")
        if kind == "view":
            target = item.get("target")
            if isinstance(target, str):
                if target.startswith("view:"):
                    item["target"] = target
                else:
                    item["target"] = f"view:{target}"
        if kind == "stack":
            item["content"] = _normalize_blocks(item.get("content"))
        if kind == "grid":
            items = []
            for grid_item in item.get("items") or []:
                if not isinstance(grid_item, dict):
                    continue
                grid_norm = dict(grid_item)
                grid_norm["content"] = _normalize_blocks(grid_item.get("content"))
                items.append(grid_norm)
            item["items"] = items
        if kind == "tabs":
            tabs = []
            for tab in item.get("tabs") or []:
                if not isinstance(tab, dict):
                    continue
                tab_norm = dict(tab)
                tab_norm["content"] = _normalize_blocks(tab.get("content"))
                tabs.append(tab_norm)
            item["tabs"] = tabs
        if kind == "container" or kind == "record":
            item["content"] = _normalize_blocks(item.get("content"))
        normalized.append(item)
    return normalized


def normalize_manifest(raw: dict) -> dict:
    if not isinstance(raw, dict):
        return {}

    normalized: dict = {}
    normalized["manifest_version"] = raw.get("manifest_version") or "0.x"

    if "module" in raw and isinstance(raw.get("module"), dict):
        module = dict(raw.get("module"))
    else:
        module_id = raw.get("module_id") or raw.get("id")
        module = {
            "id": module_id,
            "name": raw.get("name") or _title_case(str(module_id)) if module_id else None,
            "version": raw.get("version"),
            "description": raw.get("description"),
        }
    normalized["module"] = module

    normalized["entities"] = _normalize_entities(raw.get("entities"))
    entity_ids = {e.get("id") for e in normalized["entities"] if isinstance(e, dict) and isinstance(e.get("id"), str)}
    views = raw.get("views") or []
    if isinstance(views, list):
        normalized["views"] = [_normalize_view(v, entity_ids) for v in views if isinstance(v, dict)]
    else:
        normalized["views"] = []

    pages = raw.get("pages")
    if isinstance(pages, list):
        normalized_pages = []
        for page in pages:
            if not isinstance(page, dict):
                continue
            page_item = dict(page)
            page_item["content"] = _normalize_blocks(page.get("content"))
            normalized_pages.append(page_item)
        normalized["pages"] = normalized_pages

    workflows = raw.get("workflows")
    if isinstance(workflows, list):
        normalized["workflows"] = workflows
    elif isinstance(workflows, dict):
        normalized["workflows"] = list(workflows.values())
    else:
        normalized["workflows"] = []

    relations = raw.get("relations")
    if isinstance(relations, list):
        normalized["relations"] = relations

    # Preserve extra keys for debugging if needed.
    for key, value in raw.items():
        if key in {
            "manifest_version",
            "module",
            "module_id",
            "id",
            "name",
            "version",
            "description",
            "entities",
            "views",
            "workflows",
            "relations",
            "pages",
        }:
            continue
        normalized[key] = value

    return normalized
