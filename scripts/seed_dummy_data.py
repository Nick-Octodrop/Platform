#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import datetime as dt
import json
import os
import random
import sys
import uuid
from dataclasses import dataclass
from graphlib import TopologicalSorter
from pathlib import Path
from typing import Any
from urllib import error as urlerror
from urllib import parse as urlparse
from urllib import request as urlrequest


@dataclass
class FieldSpec:
    field_id: str
    field_type: str
    required: bool
    readonly: bool
    enum_values: list[Any]
    lookup_entity: str | None


@dataclass
class EntitySpec:
    entity_id: str
    module_id: str
    module_key: str
    fields: list[FieldSpec]


FIRST_NAMES = [
    "Ava",
    "Noah",
    "Olivia",
    "Liam",
    "Mia",
    "Ethan",
    "Charlotte",
    "Lucas",
    "Amelia",
    "Oliver",
    "Harper",
    "Elijah",
    "Isla",
    "Henry",
    "Zoe",
]

LAST_NAMES = [
    "Smith",
    "Johnson",
    "Williams",
    "Brown",
    "Jones",
    "Taylor",
    "Miller",
    "Wilson",
    "Anderson",
    "Thomas",
    "Martin",
    "Lee",
]

COMPANY_PREFIX = [
    "Summit",
    "Harbor",
    "Northstar",
    "Evergreen",
    "Bluewave",
    "Pioneer",
    "Atlas",
    "Velocity",
    "Urban",
    "Pacific",
]

COMPANY_SUFFIX = ["Electrical", "Construction", "Services", "Interiors", "Logistics", "Manufacturing", "Group", "Solutions"]

STREET_NAMES = ["King", "Queen", "Victoria", "Kawakawa", "Wellesley", "Broadway", "Station", "Park", "High", "Marine"]
STREET_TYPES = ["St", "Ave", "Rd", "Lane", "Drive"]
CITY_NAMES = ["Auckland", "Wellington", "Christchurch", "Hamilton", "Tauranga", "Sydney", "Melbourne", "Brisbane"]
STATE_NAMES = ["Auckland", "Wellington", "Canterbury", "NSW", "VIC", "QLD"]
COUNTRY_NAMES = ["New Zealand", "Australia"]
ITEM_BASE_NAMES = ["Installation", "Inspection", "Maintenance", "Service Call", "Replacement", "Consultation", "Site Visit"]
TAG_POOL = ["urgent", "priority", "vip", "follow-up", "internal", "scheduled", "commercial", "residential"]
NOTE_FRAGMENTS = [
    "Customer requested an early morning appointment.",
    "Site access requires prior notice.",
    "Materials confirmed and ready for dispatch.",
    "Awaiting customer sign-off before next stage.",
    "Include safety checklist and photos in final report.",
    "Budget reviewed and approved by account owner.",
]
CAMPAIGN_NAMES = ["Google Search", "Referral Program", "Email Nurture", "Trade Show", "LinkedIn Outreach"]
SOURCE_NAMES = ["Website", "Referral", "Phone", "Email", "Partner", "Walk-in"]
MEDIUM_NAMES = ["Organic", "Paid", "Direct", "Social", "Outbound"]
TEAM_NAMES = ["North Team", "South Team", "Commercial Team", "SMB Team"]


def _api_call(
    method: str,
    url: str,
    *,
    token: str | None = None,
    workspace_id: str | None = None,
    body: dict[str, Any] | None = None,
    timeout: int = 60,
) -> tuple[int, dict[str, Any]]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if workspace_id:
        headers["X-Workspace-Id"] = workspace_id
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urlrequest.Request(url, method=method, headers=headers, data=data)
    try:
        with urlrequest.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            payload = json.loads(raw.decode("utf-8")) if raw else {}
            return int(resp.status), payload if isinstance(payload, dict) else {}
    except urlerror.HTTPError as exc:
        raw = exc.read()
        try:
            payload = json.loads(raw.decode("utf-8")) if raw else {}
        except Exception:
            payload = {"ok": False, "errors": [{"message": raw.decode("utf-8", errors="replace")}]}
        return int(exc.code), payload if isinstance(payload, dict) else {}


def _is_ok(payload: dict[str, Any]) -> bool:
    return bool(payload.get("ok") is True)


def _collect_error_text(payload: dict[str, Any]) -> str:
    errors = payload.get("errors")
    if not isinstance(errors, list) or not errors:
        return "Unknown error"
    lines: list[str] = []
    for entry in errors[:8]:
        if isinstance(entry, dict):
            code = entry.get("code")
            message = entry.get("message")
            path = entry.get("path")
            prefix = f"[{code}] " if isinstance(code, str) and code else ""
            suffix = f" ({path})" if isinstance(path, str) and path else ""
            lines.append(f"{prefix}{message or 'Error'}{suffix}")
        else:
            lines.append(str(entry))
    return "; ".join(lines)


def _parse_module_id(manifest: dict[str, Any], fallback: str) -> str:
    module = manifest.get("module")
    module_id = module.get("id") if isinstance(module, dict) else None
    if isinstance(module_id, str) and module_id.strip():
        return module_id.strip()
    return fallback


def _parse_module_key(manifest: dict[str, Any], fallback: str) -> str:
    module = manifest.get("module")
    module_key = module.get("key") if isinstance(module, dict) else None
    if isinstance(module_key, str) and module_key.strip():
        return module_key.strip()
    return fallback


def _enum_values(field: dict[str, Any]) -> list[Any]:
    options = field.get("options") or field.get("values") or []
    out: list[Any] = []
    if not isinstance(options, list):
        return out
    for opt in options:
        if isinstance(opt, dict) and "value" in opt:
            out.append(opt.get("value"))
        else:
            out.append(opt)
    return out


def _extract_entity_specs(manifest: dict[str, Any], module_id: str, module_key: str) -> dict[str, EntitySpec]:
    entities_raw = manifest.get("entities")
    entities: list[dict[str, Any]] = []
    if isinstance(entities_raw, list):
        entities = [e for e in entities_raw if isinstance(e, dict)]
    elif isinstance(entities_raw, dict):
        for ent_id, ent in entities_raw.items():
            if isinstance(ent, dict):
                entities.append({"id": ent_id, **ent})
    out: dict[str, EntitySpec] = {}
    for entity in entities:
        entity_id = entity.get("id")
        if not isinstance(entity_id, str) or not entity_id.strip():
            continue
        fields_raw = entity.get("fields")
        fields_list: list[dict[str, Any]] = []
        if isinstance(fields_raw, list):
            fields_list = [f for f in fields_raw if isinstance(f, dict)]
        elif isinstance(fields_raw, dict):
            for field_id, field in fields_raw.items():
                if isinstance(field, dict):
                    fields_list.append({"id": field_id, **field})
        fields: list[FieldSpec] = []
        for field in fields_list:
            field_id = field.get("id")
            if not isinstance(field_id, str) or not field_id:
                continue
            field_type = field.get("type")
            if not isinstance(field_type, str) or not field_type:
                field_type = "string"
            lookup_entity = None
            if field_type == "lookup":
                target = field.get("entity")
                if isinstance(target, str) and target.strip():
                    lookup_entity = target.strip()
            fields.append(
                FieldSpec(
                    field_id=field_id,
                    field_type=field_type,
                    required=bool(field.get("required")),
                    readonly=bool(field.get("readonly")),
                    enum_values=_enum_values(field),
                    lookup_entity=lookup_entity,
                )
            )
        out[entity_id] = EntitySpec(
            entity_id=entity_id,
            module_id=module_id,
            module_key=module_key,
            fields=fields,
        )
    return out


def _decode_jwt_sub(token: str) -> str | None:
    parts = token.split(".")
    if len(parts) < 2:
        return None
    body = parts[1]
    pad = "=" * (-len(body) % 4)
    try:
        raw = base64.urlsafe_b64decode(body + pad)
        payload = json.loads(raw.decode("utf-8"))
    except Exception:
        return None
    sub = payload.get("sub")
    return sub if isinstance(sub, str) and sub else None


def _load_user_ids(base_url: str, token: str | None, workspace_id: str | None, override: str) -> list[str]:
    if override.strip():
        return [part.strip() for part in override.split(",") if part.strip()]
    status, payload = _api_call("GET", f"{base_url}/access/members", token=token, workspace_id=workspace_id)
    if status < 400 and _is_ok(payload):
        members = payload.get("members")
        if isinstance(members, list):
            ids: list[str] = []
            for member in members:
                if not isinstance(member, dict):
                    continue
                user_id = member.get("user_id")
                if isinstance(user_id, str) and user_id:
                    ids.append(user_id)
            if ids:
                return sorted(set(ids))
    if token:
        sub = _decode_jwt_sub(token)
        if sub:
            return [sub]
    return ["seed-user-1"]


def _entity_dependency_order(entities: dict[str, EntitySpec]) -> list[str]:
    graph: dict[str, set[str]] = {}
    all_entity_ids = set(entities.keys())
    for entity_id, spec in entities.items():
        deps: set[str] = set()
        for field in spec.fields:
            if field.field_type == "lookup" and isinstance(field.lookup_entity, str) and field.lookup_entity in all_entity_ids:
                deps.add(field.lookup_entity)
        graph[entity_id] = deps
    try:
        sorter = TopologicalSorter(graph)
        return list(sorter.static_order())
    except Exception:
        # Fallback when cycles exist: seed in stable order and skip records whose required lookups are unavailable.
        return sorted(entities.keys())


def _list_existing_record_ids(
    base_url: str,
    token: str | None,
    workspace_id: str | None,
    entity_id: str,
    cap: int,
) -> list[str]:
    out: list[str] = []
    cursor: str | None = None
    while len(out) < cap:
        params = {"limit": min(200, cap - len(out))}
        if cursor:
            params["cursor"] = cursor
        url = f"{base_url}/records/{urlparse.quote(entity_id, safe='')}"
        query = urlparse.urlencode(params)
        status, payload = _api_call("GET", f"{url}?{query}", token=token, workspace_id=workspace_id)
        if status >= 400 or not _is_ok(payload):
            break
        rows = payload.get("records")
        if not isinstance(rows, list) or not rows:
            break
        for row in rows:
            if not isinstance(row, dict):
                continue
            rid = row.get("record_id")
            if isinstance(rid, str) and rid:
                out.append(rid)
        cursor = payload.get("next_cursor") if isinstance(payload.get("next_cursor"), str) else None
        if not cursor:
            break
    return out


def _random_date(rng: random.Random, base_date: dt.date) -> str:
    return (base_date + dt.timedelta(days=rng.randint(-60, 120))).isoformat()


def _random_datetime(rng: random.Random, base_dt: dt.datetime) -> str:
    value = base_dt + dt.timedelta(days=rng.randint(-40, 120), hours=rng.randint(0, 23), minutes=rng.randint(0, 59))
    return value.replace(microsecond=0).isoformat()


def _record_context(entity_id: str, index: int, rng: random.Random) -> dict[str, str]:
    first = rng.choice(FIRST_NAMES)
    last = rng.choice(LAST_NAMES)
    company = f"{rng.choice(COMPANY_PREFIX)} {rng.choice(COMPANY_SUFFIX)}"
    street = f"{rng.randint(10, 999)} {rng.choice(STREET_NAMES)} {rng.choice(STREET_TYPES)}"
    city = rng.choice(CITY_NAMES)
    state = rng.choice(STATE_NAMES)
    country = rng.choice(COUNTRY_NAMES)
    email = f"{first.lower()}.{last.lower()}{rng.randint(1, 999)}@example.com"
    item = f"{rng.choice(ITEM_BASE_NAMES)} - {rng.choice(['Standard', 'Premium', 'Emergency'])}"
    return {
        "first_name": first,
        "last_name": last,
        "full_name": f"{first} {last}",
        "company": company,
        "street": street,
        "city": city,
        "state": state,
        "country": country,
        "postcode": str(rng.randint(1000, 9999)),
        "phone": f"+64 2{rng.randint(0,9)} {rng.randint(100,999)} {rng.randint(1000,9999)}",
        "email": email,
        "item_name": item,
        "entity_label": entity_id.split(".")[-1].replace("_", " ").title(),
        "index": str(index),
    }


def _sentence(rng: random.Random, context: dict[str, str]) -> str:
    return f"{rng.choice(NOTE_FRAGMENTS)} Contact: {context['full_name']} at {context['company']}."


def _string_value(field_id: str, entity_id: str, index: int, rng: random.Random, context: dict[str, str]) -> str:
    key = field_id.lower()
    if key.endswith(".first_name") or "first_name" in key:
        return context["first_name"]
    if key.endswith(".last_name") or "last_name" in key:
        return context["last_name"]
    if key.endswith(".full_name"):
        return context["full_name"]
    if "company" in key:
        return context["company"]
    if "email" in key:
        return context["email"]
    if "phone" in key or "mobile" in key:
        return context["phone"]
    if "address" in key:
        return context["street"]
    if key.endswith(".number") or "number" in key:
        prefix = entity_id.split(".")[-1].replace("_", "").upper()[:5] or "REC"
        return f"{prefix}-{dt.date.today().year}-{index:05d}"
    if "reference" in key:
        return f"REF-{rng.randint(10000, 99999)}"
    if "title" in key:
        return f"{context['entity_label']} - {context['company']}"
    if "summary" in key:
        return f"{context['entity_label']} for {context['company']}"
    if "description" in key:
        return _sentence(rng, context)
    if "source" in key:
        return rng.choice(SOURCE_NAMES)
    if "medium" in key:
        return rng.choice(MEDIUM_NAMES)
    if "campaign" in key:
        return rng.choice(CAMPAIGN_NAMES)
    if "team" in key:
        return rng.choice(TEAM_NAMES)
    if "currency" in key:
        return rng.choice(["NZD", "AUD", "USD"])
    if "reason" in key:
        return rng.choice(
            [
                "Scope adjustment requested by client",
                "On-site condition differs from initial assessment",
                "Material pricing updated",
                "Compliance requirement change",
            ]
        )
    if "location" in key:
        return f"{context['street']}, {context['city']}"
    if "city" in key:
        return context["city"]
    if "country" in key:
        return context["country"]
    if "state" in key:
        return context["state"]
    if "zip" in key or "postcode" in key:
        return context["postcode"]
    if "name" in key:
        return context["full_name"] if "contact" in entity_id else f"{context['company']} {context['entity_label']}"
    if "item" in key:
        return context["item_name"]
    return f"{context['entity_label']} record {index}"


def _number_value(field_id: str, rng: random.Random) -> float | int:
    key = field_id.lower()
    if any(token in key for token in ["qty", "quantity"]):
        return rng.randint(1, 25)
    if any(token in key for token in ["tax_rate", "rate", "probability"]):
        return round(rng.uniform(0, 100), 2)
    if any(token in key for token in ["amount", "total", "subtotal", "price", "cost", "value", "estimate"]):
        return round(rng.uniform(50, 10000), 2)
    return round(rng.uniform(1, 500), 2)


def _pick_enum(field: FieldSpec, rng: random.Random) -> Any:
    if not field.enum_values:
        return None
    weighted = list(field.enum_values)
    key = field.field_id.lower()
    if "status" in key or "stage" in key:
        preferred = [v for v in weighted if isinstance(v, str) and v in {"draft", "new", "open", "planned", "qualified", "todo"}]
        if preferred:
            return rng.choice(preferred)
    return rng.choice(weighted)


def _field_value(
    field: FieldSpec,
    entity_id: str,
    index: int,
    rng: random.Random,
    context: dict[str, str],
    user_ids: list[str],
    record_ids_by_entity: dict[str, list[str]],
    base_date: dt.date,
    base_dt: dt.datetime,
) -> tuple[bool, Any]:
    ftype = field.field_type
    if ftype in {"string", "text"}:
        value = _string_value(field.field_id, entity_id, index, rng, context)
        if ftype == "text":
            value = f"{value} {_sentence(rng, context)}"
        return True, value
    if ftype == "number":
        return True, _number_value(field.field_id, rng)
    if ftype in {"bool", "boolean"}:
        return True, bool(rng.randint(0, 1))
    if ftype == "date":
        return True, _random_date(rng, base_date)
    if ftype == "datetime":
        return True, _random_datetime(rng, base_dt)
    if ftype == "enum":
        value = _pick_enum(field, rng)
        return (value is not None), value
    if ftype == "lookup":
        target = field.lookup_entity
        if not isinstance(target, str) or not target:
            return False, None
        candidates = record_ids_by_entity.get(target) or []
        if not candidates:
            return False, None
        return True, rng.choice(candidates)
    if ftype == "user":
        return True, rng.choice(user_ids)
    if ftype == "users":
        count = min(len(user_ids), max(1, rng.randint(1, 3)))
        return True, rng.sample(user_ids, k=count)
    if ftype == "tags":
        pick = max(1, rng.randint(1, 3))
        return True, rng.sample(TAG_POOL, k=pick)
    if ftype == "uuid":
        return True, str(uuid.uuid4())
    return True, _string_value(field.field_id, entity_id, index, rng, context)


def _should_populate_optional(field: FieldSpec, rng: random.Random) -> bool:
    if field.required:
        return True
    key = field.field_id.lower()
    if any(token in key for token in ["status", "stage", "amount", "total", "date", "start", "end"]):
        return True
    return rng.random() < 0.7


def _build_record(
    spec: EntitySpec,
    index: int,
    rng: random.Random,
    user_ids: list[str],
    record_ids_by_entity: dict[str, list[str]],
    base_date: dt.date,
    base_dt: dt.datetime,
) -> tuple[dict[str, Any] | None, str | None]:
    record: dict[str, Any] = {}
    context = _record_context(spec.entity_id, index, rng)
    for field in spec.fields:
        if field.readonly:
            continue
        if field.field_id.endswith(".id") and field.field_type == "uuid":
            continue
        if not _should_populate_optional(field, rng):
            continue
        ok, value = _field_value(
            field,
            spec.entity_id,
            index,
            rng,
            context,
            user_ids,
            record_ids_by_entity,
            base_date,
            base_dt,
        )
        if not ok:
            if field.required:
                return None, f"required lookup/source unavailable for {field.field_id}"
            continue
        record[field.field_id] = value
    if not record:
        return None, "no writable fields"
    return record, None


def _parse_modules_filter(raw: str) -> set[str]:
    return {part.strip() for part in raw.split(",") if part.strip()}


def _manifest_module_tokens(manifest_dir: str, pattern: str) -> set[str]:
    root = os.path.abspath(manifest_dir)
    if not os.path.isdir(root):
        return set()
    out: set[str] = set()
    for path in sorted(Path(root).glob(pattern)):
        try:
            manifest = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(manifest, dict):
            continue
        module = manifest.get("module")
        if not isinstance(module, dict):
            continue
        module_id = module.get("id")
        module_key = module.get("key")
        if isinstance(module_id, str) and module_id:
            out.add(module_id)
        if isinstance(module_key, str) and module_key:
            out.add(module_key)
    return out


def _normalize_entities_map(entities: dict[str, EntitySpec], selected_module_tokens: set[str]) -> dict[str, EntitySpec]:
    if not selected_module_tokens:
        return entities
    out: dict[str, EntitySpec] = {}
    for entity_id, spec in entities.items():
        if spec.module_id in selected_module_tokens or spec.module_key in selected_module_tokens:
            out[entity_id] = spec
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed dummy records across installed Studio modules.")
    parser.add_argument("--base-url", default="http://localhost:8000", help="API base URL")
    parser.add_argument("--token", default="", help="Bearer token (or env OCTO_API_TOKEN)")
    parser.add_argument("--workspace-id", default="", help="Workspace id (or env OCTO_WORKSPACE_ID)")
    parser.add_argument("--modules", default="", help="Comma-separated module ids/keys to include")
    parser.add_argument("--v1-only", action="store_true", help="Only include modules listed in the selected marketplace manifest directory")
    parser.add_argument("--manifest-dir", default="manifests/marketplace", help="Manifest directory used by --v1-only")
    parser.add_argument("--manifest-pattern", default="*.json", help="Manifest glob pattern used by --v1-only")
    parser.add_argument("--count", type=int, default=25, help="Records per entity (append mode) or target total (fill mode)")
    parser.add_argument("--mode", choices=["append", "fill"], default="append", help="append creates count new records; fill tops up to count")
    parser.add_argument("--lookup-pool-limit", type=int, default=500, help="Max existing records fetched per entity for lookups")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    parser.add_argument("--user-ids", default="", help="Comma-separated user ids for user/users fields")
    parser.add_argument("--dry-run", action="store_true", help="Print plan only, do not write records")
    parser.add_argument("--include-disabled", action="store_true", help="Include disabled modules")
    parser.add_argument("--continue-on-error", action="store_true", help="Continue seeding after entity-level errors")
    args = parser.parse_args()

    if args.count <= 0:
        print("--count must be > 0", file=sys.stderr)
        return 2
    if args.lookup_pool_limit <= 0:
        print("--lookup-pool-limit must be > 0", file=sys.stderr)
        return 2

    base_url = args.base_url.rstrip("/")
    token = (args.token or "").strip() or os.environ.get("OCTO_API_TOKEN", "").strip()
    workspace_id = (args.workspace_id or "").strip() or os.environ.get("OCTO_WORKSPACE_ID", "").strip()
    include_modules = _parse_modules_filter(args.modules)
    if args.v1_only:
        v1_tokens = _manifest_module_tokens(args.manifest_dir, args.manifest_pattern)
        if not v1_tokens:
            print(
                f"--v1-only requested but no manifest module ids/keys found in {args.manifest_dir}/{args.manifest_pattern}",
                file=sys.stderr,
            )
            return 2
        include_modules.update(v1_tokens)

    status, payload = _api_call("GET", f"{base_url}/modules", token=token or None, workspace_id=workspace_id or None)
    if status >= 400:
        print(f"Failed to list modules: {_collect_error_text(payload)}", file=sys.stderr)
        return 2
    modules = payload.get("modules")
    if not isinstance(modules, list):
        print("Failed to list modules: malformed response from /modules", file=sys.stderr)
        return 2

    entities: dict[str, EntitySpec] = {}
    module_count = 0
    skipped_modules = 0
    for item in modules:
        if not isinstance(item, dict):
            continue
        module_id = item.get("module_id")
        if not isinstance(module_id, str) or not module_id:
            continue
        enabled = bool(item.get("enabled"))
        if not args.include_disabled and not enabled:
            skipped_modules += 1
            continue
        module_key = item.get("module_key") if isinstance(item.get("module_key"), str) and item.get("module_key") else module_id
        if include_modules and module_id not in include_modules and module_key not in include_modules:
            continue
        manifest_status, manifest_payload = _api_call(
            "GET",
            f"{base_url}/studio2/modules/{module_id}/manifest",
            token=token or None,
            workspace_id=workspace_id or None,
        )
        if manifest_status >= 400 or not _is_ok(manifest_payload):
            print(f"Skip module {module_id}: {_collect_error_text(manifest_payload)}")
            continue
        manifest = (manifest_payload.get("data") or {}).get("manifest")
        if not isinstance(manifest, dict):
            print(f"Skip module {module_id}: missing manifest payload")
            continue
        module_id_from_manifest = _parse_module_id(manifest, module_id)
        module_key_from_manifest = _parse_module_key(manifest, module_key)
        for entity_id, spec in _extract_entity_specs(manifest, module_id_from_manifest, module_key_from_manifest).items():
            if entity_id in entities:
                # Keep first to avoid seeding duplicate entities from duplicate modules.
                continue
            entities[entity_id] = spec
        module_count += 1

    entities = _normalize_entities_map(entities, include_modules)
    if not entities:
        print("No entities found to seed. Check module filters and auth/workspace values.", file=sys.stderr)
        return 2

    order = _entity_dependency_order(entities)
    user_ids = _load_user_ids(base_url, token or None, workspace_id or None, args.user_ids)
    rng = random.Random(args.seed)
    base_date = dt.date.today()
    base_dt = dt.datetime.now(dt.timezone.utc)

    print(f"Loaded modules: {module_count} (skipped disabled: {skipped_modules})")
    print(f"Entities to seed: {len(order)}")
    print(f"Users for assignment fields: {', '.join(user_ids)}")

    record_ids_by_entity: dict[str, list[str]] = {}
    existing_counts: dict[str, int] = {}
    for entity_id in order:
        existing_ids = _list_existing_record_ids(base_url, token or None, workspace_id or None, entity_id, cap=args.lookup_pool_limit)
        record_ids_by_entity[entity_id] = list(existing_ids)
        existing_counts[entity_id] = len(existing_ids)

    print("\nPlan:")
    plan: dict[str, int] = {}
    for entity_id in order:
        existing = existing_counts.get(entity_id, 0)
        if args.mode == "fill":
            to_create = max(0, args.count - existing)
        else:
            to_create = args.count
        plan[entity_id] = to_create
        print(f"  - {entity_id}: existing={existing}, create={to_create}")

    if args.dry_run:
        return 0

    created_total = 0
    failed_total = 0
    skipped_total = 0
    per_entity_created: dict[str, int] = {}
    per_entity_failed: dict[str, int] = {}
    per_entity_skipped: dict[str, int] = {}

    for entity_id in order:
        spec = entities[entity_id]
        to_create = plan.get(entity_id, 0)
        per_entity_created[entity_id] = 0
        per_entity_failed[entity_id] = 0
        per_entity_skipped[entity_id] = 0
        if to_create <= 0:
            continue
        for idx in range(1, to_create + 1):
            record, reason = _build_record(
                spec=spec,
                index=existing_counts.get(entity_id, 0) + idx,
                rng=rng,
                user_ids=user_ids,
                record_ids_by_entity=record_ids_by_entity,
                base_date=base_date,
                base_dt=base_dt,
            )
            if record is None:
                skipped_total += 1
                per_entity_skipped[entity_id] += 1
                if per_entity_skipped[entity_id] <= 3:
                    print(f"  skip {entity_id}: {reason}")
                continue
            status, payload = _api_call(
                "POST",
                f"{base_url}/records/{urlparse.quote(entity_id, safe='')}",
                token=token or None,
                workspace_id=workspace_id or None,
                body={"record": record},
                timeout=120,
            )
            if status >= 400 or not _is_ok(payload):
                failed_total += 1
                per_entity_failed[entity_id] += 1
                print(f"  create failed {entity_id}: {_collect_error_text(payload)}")
                if not args.continue_on_error and per_entity_failed[entity_id] >= 5:
                    print(f"Stopping after repeated errors in {entity_id}. Use --continue-on-error to keep going.", file=sys.stderr)
                    return 1
                continue
            record_id = payload.get("record_id")
            if isinstance(record_id, str) and record_id:
                record_ids_by_entity.setdefault(entity_id, []).append(record_id)
            created_total += 1
            per_entity_created[entity_id] += 1

    print("\nSeed summary:")
    print(f"  created: {created_total}")
    print(f"  failed:  {failed_total}")
    print(f"  skipped: {skipped_total}")
    print("\nPer entity:")
    for entity_id in order:
        print(
            f"  - {entity_id}: "
            f"created={per_entity_created.get(entity_id, 0)}, "
            f"failed={per_entity_failed.get(entity_id, 0)}, "
            f"skipped={per_entity_skipped.get(entity_id, 0)}"
        )
    return 1 if failed_total > 0 else 0


if __name__ == "__main__":
    raise SystemExit(main())
