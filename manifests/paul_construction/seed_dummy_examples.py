#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import json
import os
from dataclasses import dataclass
from typing import Any
from urllib import error as urlerror
from urllib import parse as urlparse
from urllib import request as urlrequest


@dataclass
class CreatedRecord:
    record_id: str
    record: dict[str, Any]


def api_call(
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


def is_ok(payload: dict[str, Any]) -> bool:
    return bool(payload.get("ok") is True)


def collect_error_text(payload: dict[str, Any]) -> str:
    errors = payload.get("errors")
    if not isinstance(errors, list) or not errors:
        return "Unknown error"
    parts: list[str] = []
    for entry in errors[:8]:
        if isinstance(entry, dict):
            code = entry.get("code")
            message = entry.get("message")
            path = entry.get("path")
            prefix = f"[{code}] " if isinstance(code, str) and code else ""
            suffix = f" ({path})" if isinstance(path, str) and path else ""
            parts.append(f"{prefix}{message or 'Error'}{suffix}")
        else:
            parts.append(str(entry))
    return "; ".join(parts)


def derive_user_id_from_token(token: str | None) -> str | None:
    if not token:
        return None
    parts = token.split(".")
    if len(parts) != 3:
        return None
    try:
        payload_part = parts[1]
        padding = "=" * (-len(payload_part) % 4)
        raw = base64.urlsafe_b64decode(payload_part + padding)
        payload = json.loads(raw.decode("utf-8"))
    except Exception:
        return None
    sub = payload.get("sub")
    return sub if isinstance(sub, str) and sub else None


def create_record(
    base_url: str,
    entity_id: str,
    record: dict[str, Any],
    *,
    token: str | None,
    workspace_id: str | None,
    dry_run: bool,
) -> CreatedRecord:
    if dry_run:
        fake_id = f"dry-run-{entity_id.split('.')[-1]}"
        return CreatedRecord(record_id=fake_id, record=record)
    status, payload = api_call(
        "POST",
        f"{base_url}/records/{urlparse.quote(entity_id, safe='')}",
        token=token,
        workspace_id=workspace_id,
        body={"record": record},
        timeout=120,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"create {entity_id} failed: {collect_error_text(payload)}")
    record_id = payload.get("record_id")
    created_record = payload.get("record")
    if not isinstance(record_id, str) or not record_id:
        raise RuntimeError(f"create {entity_id} failed: missing record_id")
    if not isinstance(created_record, dict):
        created_record = record
    return CreatedRecord(record_id=record_id, record=created_record)


def list_records(
    base_url: str,
    entity_id: str,
    *,
    token: str | None,
    workspace_id: str | None,
    fields: list[str] | None = None,
    cap: int = 500,
) -> list[CreatedRecord]:
    out: list[CreatedRecord] = []
    cursor: str | None = None
    while len(out) < cap:
        params: dict[str, str | int] = {"limit": min(200, cap - len(out))}
        if cursor:
            params["cursor"] = cursor
        if fields:
            params["fields"] = ",".join(fields)
        status, payload = api_call(
            "GET",
            f"{base_url}/records/{urlparse.quote(entity_id, safe='')}?{urlparse.urlencode(params)}",
            token=token,
            workspace_id=workspace_id,
            timeout=120,
        )
        if status >= 400 or not is_ok(payload):
            break
        rows = payload.get("records")
        if not isinstance(rows, list) or not rows:
            break
        for row in rows:
            if not isinstance(row, dict):
                continue
            record_id = row.get("record_id")
            record = row.get("record")
            if isinstance(record_id, str) and record_id and isinstance(record, dict):
                out.append(CreatedRecord(record_id=record_id, record=record))
        cursor = payload.get("next_cursor") if isinstance(payload.get("next_cursor"), str) else None
        if not cursor:
            break
    return out


def find_existing_record(
    base_url: str,
    entity_id: str,
    match_fields: dict[str, Any],
    *,
    token: str | None,
    workspace_id: str | None,
    dry_run: bool,
) -> CreatedRecord | None:
    if dry_run:
        return None
    for existing in list_records(
        base_url,
        entity_id,
        token=token,
        workspace_id=workspace_id,
        fields=list(match_fields.keys()),
    ):
        if all(existing.record.get(field_id) == expected for field_id, expected in match_fields.items()):
            return existing
    return None


def ensure_record(
    base_url: str,
    entity_id: str,
    record: dict[str, Any],
    *,
    match_fields: dict[str, Any],
    token: str | None,
    workspace_id: str | None,
    dry_run: bool,
) -> tuple[CreatedRecord, bool]:
    existing = find_existing_record(
        base_url,
        entity_id,
        match_fields,
        token=token,
        workspace_id=workspace_id,
        dry_run=dry_run,
    )
    if existing is not None:
        merged_record = dict(record)
        merged_record.update(existing.record)
        return CreatedRecord(record_id=existing.record_id, record=merged_record), False
    created = create_record(
        base_url,
        entity_id,
        record,
        token=token,
        workspace_id=workspace_id,
        dry_run=dry_run,
    )
    return created, True


def main() -> int:
    parser = argparse.ArgumentParser(description="Import realistic demo data for construction_ops_v3.")
    parser.add_argument("--base-url", default="http://localhost:8000", help="API base URL")
    parser.add_argument("--token", default="", help="Bearer token or env OCTO_API_TOKEN")
    parser.add_argument("--workspace-id", default="", help="Workspace id or env OCTO_WORKSPACE_ID")
    parser.add_argument("--dry-run", action="store_true", help="Print the import plan only")
    args = parser.parse_args()

    base_url = args.base_url.rstrip("/")
    token = (args.token or "").strip() or os.environ.get("OCTO_API_TOKEN", "").strip() or None
    workspace_id = (args.workspace_id or "").strip() or os.environ.get("OCTO_WORKSPACE_ID", "").strip() or None
    current_user_id = derive_user_id_from_token(token)

    contacts: dict[str, str] = {}
    sites: dict[str, str] = {}
    cost_codes: dict[str, str] = {}
    projects: dict[str, str] = {}

    contact_records = [
        {
            "key": "harbour_build",
            "record": {
                "contact.company_type": "company",
                "contact.status": "active",
                "contact.name": "Harbour Build Developments Ltd",
                "contact.email": "projects@harbourbuild.co.nz",
                "contact.phone": "+64 9 302 4412",
                "contact.address_type": "contact",
                "contact.city": "Auckland",
                "contact.country": "New Zealand",
            },
        },
        {
            "key": "vertex_fitout",
            "record": {
                "contact.company_type": "company",
                "contact.status": "active",
                "contact.name": "Vertex Workplace Group",
                "contact.email": "delivery@vertexworkplace.co.nz",
                "contact.phone": "+64 9 551 9080",
                "contact.address_type": "contact",
                "contact.city": "Auckland",
                "contact.country": "New Zealand",
            },
        },
        {
            "key": "pacific_civil",
            "record": {
                "contact.company_type": "company",
                "contact.status": "active",
                "contact.name": "Pacific Civil Estates",
                "contact.email": "capitalworks@pacificcivil.co.nz",
                "contact.phone": "+64 4 801 2270",
                "contact.address_type": "contact",
                "contact.city": "Wellington",
                "contact.country": "New Zealand",
            },
        },
        {
            "key": "steel_vendor",
            "record": {
                "contact.company_type": "company",
                "contact.status": "active",
                "contact.name": "Steel & Rigging Supplies NZ",
                "contact.email": "dispatch@steelandrigging.co.nz",
                "contact.phone": "+64 9 579 1104",
                "contact.address_type": "contact",
                "contact.city": "Auckland",
                "contact.country": "New Zealand",
            },
        },
        {
            "key": "plant_vendor",
            "record": {
                "contact.company_type": "company",
                "contact.status": "active",
                "contact.name": "Metro Plant Hire",
                "contact.email": "accounts@metroplanthire.co.nz",
                "contact.phone": "+64 9 276 4488",
                "contact.address_type": "contact",
                "contact.city": "Auckland",
                "contact.country": "New Zealand",
            },
        },
        {
            "key": "electrical_vendor",
            "record": {
                "contact.company_type": "company",
                "contact.status": "active",
                "contact.name": "Southern Cross Electrical Wholesale",
                "contact.email": "orders@scew.co.nz",
                "contact.phone": "+64 4 566 7311",
                "contact.address_type": "contact",
                "contact.city": "Lower Hutt",
                "contact.country": "New Zealand",
            },
        },
    ]

    site_records = [
        {
            "key": "viaduct",
            "record": {
                "construction_site.name": "Viaduct Commercial Tower Site",
                "construction_site.code": "AKL-VCT-01",
                "construction_site.address": "88 Halsey Street",
                "construction_site.city": "Auckland",
                "construction_site.region": "Auckland",
                "construction_site.country": "New Zealand",
                "construction_site.phone": "+64 9 377 5100",
                "construction_site.status": "active",
                "construction_site.notes": "Active CBD tower fit-out site with restricted delivery windows before 7:30am and after 6:00pm.",
            },
        },
        {
            "key": "hobsonville",
            "record": {
                "construction_site.name": "Hobsonville Warehouse Expansion",
                "construction_site.code": "AKL-HBW-02",
                "construction_site.address": "14 Launch Road",
                "construction_site.city": "Auckland",
                "construction_site.region": "Auckland",
                "construction_site.country": "New Zealand",
                "construction_site.phone": "+64 9 416 2380",
                "construction_site.status": "active",
                "construction_site.notes": "Warehouse slab and shell extension with active logistics operations around the live site.",
            },
        },
        {
            "key": "petone",
            "record": {
                "construction_site.name": "Petone Community Health Hub",
                "construction_site.code": "WLG-PTH-03",
                "construction_site.address": "27 Jackson Street",
                "construction_site.city": "Lower Hutt",
                "construction_site.region": "Wellington",
                "construction_site.country": "New Zealand",
                "construction_site.phone": "+64 4 568 4421",
                "construction_site.status": "active",
                "construction_site.notes": "Interior upgrade and seismic works in a staged, partially occupied health facility.",
            },
        },
    ]

    if current_user_id:
        for item in site_records:
            if item["record"].get("construction_site.status") == "active":
                item["record"]["construction_site.supervisor_id"] = current_user_id

    cost_code_records = [
        {
            "key": "labour_general",
            "record": {
                "construction_cost_code.code": "1000",
                "construction_cost_code.name": "General Site Labour",
                "construction_cost_code.category": "labor",
                "construction_cost_code.active": True,
                "construction_cost_code.notes": "General labour allocation for site setup, coordination, and non-trade-specific works.",
            },
        },
        {
            "key": "steel_materials",
            "record": {
                "construction_cost_code.code": "2105",
                "construction_cost_code.name": "Structural Steel Materials",
                "construction_cost_code.category": "materials",
                "construction_cost_code.active": True,
                "construction_cost_code.notes": "Primary and secondary structural steel supply costs.",
            },
        },
        {
            "key": "electrical_subcontract",
            "record": {
                "construction_cost_code.code": "3308",
                "construction_cost_code.name": "Electrical Subcontract",
                "construction_cost_code.category": "subcontract",
                "construction_cost_code.active": True,
                "construction_cost_code.notes": "Electrical rough-in, board upgrade, and fit-off works.",
            },
        },
        {
            "key": "plant_hire",
            "record": {
                "construction_cost_code.code": "4102",
                "construction_cost_code.name": "Equipment Hire",
                "construction_cost_code.category": "equipment",
                "construction_cost_code.active": True,
                "construction_cost_code.notes": "Scissor lifts, telehandlers, and temporary site plant.",
            },
        },
        {
            "key": "site_overheads",
            "record": {
                "construction_cost_code.code": "5900",
                "construction_cost_code.name": "Site Overheads",
                "construction_cost_code.category": "other",
                "construction_cost_code.active": True,
                "construction_cost_code.notes": "Traffic management, waste removal, and temporary services.",
            },
        },
    ]

    print("Importing realistic construction demo data")
    print("Includes: sites, projects, cost codes, expenses, issues, and supporting contacts")
    print("Excludes: workers, assignments, time entries, material records")

    for item in contact_records:
        created, was_created = ensure_record(
            base_url,
            "entity.contact",
            item["record"],
            match_fields={"contact.name": item["record"]["contact.name"]},
            token=token,
            workspace_id=workspace_id,
            dry_run=args.dry_run,
        )
        contacts[item["key"]] = created.record_id
        action = "contact" if was_created or args.dry_run else "contact (exists)"
        print(f"  {action}: {item['record']['contact.name']}")

    for item in site_records:
        created, was_created = ensure_record(
            base_url,
            "entity.construction_site",
            item["record"],
            match_fields={"construction_site.code": item["record"]["construction_site.code"]},
            token=token,
            workspace_id=workspace_id,
            dry_run=args.dry_run,
        )
        sites[item["key"]] = created.record_id
        action = "site" if was_created or args.dry_run else "site (exists)"
        print(f"  {action}: {item['record']['construction_site.name']}")

    for item in cost_code_records:
        created, was_created = ensure_record(
            base_url,
            "entity.construction_cost_code",
            item["record"],
            match_fields={"construction_cost_code.code": item["record"]["construction_cost_code.code"]},
            token=token,
            workspace_id=workspace_id,
            dry_run=args.dry_run,
        )
        cost_codes[item["key"]] = created.record_id
        action = "cost code" if was_created or args.dry_run else "cost code (exists)"
        print(f"  {action}: {item['record']['construction_cost_code.code']} {item['record']['construction_cost_code.name']}")

    project_records = [
        {
            "name": "Wynyard Quarter Office Fit-Out",
            "record": {
                "construction_project.name": "Wynyard Quarter Office Fit-Out",
                "construction_project.code": "PRJ-AKL-24017",
                "construction_project.client_contact_id": contacts["vertex_fitout"],
                "construction_project.site_id": sites["viaduct"],
                "construction_project.site_location": "Auckland CBD, Wynyard Quarter",
                "construction_project.status": "active",
                "construction_project.project_type": "fitout",
                "construction_project.priority": "high",
                "construction_project.start_date": "2026-02-10",
                "construction_project.target_end_date": "2026-06-30",
                "construction_project.contract_value": 2150000,
                "construction_project.labor_budget": 640000,
                "construction_project.material_budget": 890000,
                "construction_project.other_budget": 220000,
                "construction_project.notes": "Premium office fit-out across levels 8 and 9 with staged handover to incoming tenant.",
            },
        },
        {
            "name": "Hobsonville Logistics Warehouse Expansion",
            "record": {
                "construction_project.name": "Hobsonville Logistics Warehouse Expansion",
                "construction_project.code": "PRJ-AKL-24022",
                "construction_project.client_contact_id": contacts["harbour_build"],
                "construction_project.site_id": sites["hobsonville"],
                "construction_project.site_location": "Hobsonville, Auckland",
                "construction_project.status": "active",
                "construction_project.project_type": "building",
                "construction_project.priority": "medium",
                "construction_project.start_date": "2026-01-20",
                "construction_project.target_end_date": "2026-08-15",
                "construction_project.contract_value": 3840000,
                "construction_project.labor_budget": 1120000,
                "construction_project.material_budget": 1540000,
                "construction_project.other_budget": 360000,
                "construction_project.notes": "Warehouse extension and loading canopy works delivered adjacent to a live distribution operation.",
            },
        },
        {
            "name": "Petone Health Hub Refurbishment",
            "record": {
                "construction_project.name": "Petone Health Hub Refurbishment",
                "construction_project.code": "PRJ-WLG-24011",
                "construction_project.client_contact_id": contacts["pacific_civil"],
                "construction_project.site_id": sites["petone"],
                "construction_project.site_location": "Petone, Lower Hutt",
                "construction_project.status": "on_hold",
                "construction_project.project_type": "renovation",
                "construction_project.priority": "high",
                "construction_project.start_date": "2026-01-06",
                "construction_project.target_end_date": "2026-05-28",
                "construction_project.contract_value": 1680000,
                "construction_project.labor_budget": 520000,
                "construction_project.material_budget": 610000,
                "construction_project.other_budget": 180000,
                "construction_project.notes": "Staged health facility upgrade currently paused pending client sign-off on revised treatment room sequencing.",
            },
        },
    ]

    for item in project_records:
        created, was_created = ensure_record(
            base_url,
            "entity.construction_project",
            item["record"],
            match_fields={"construction_project.code": item["record"]["construction_project.code"]},
            token=token,
            workspace_id=workspace_id,
            dry_run=args.dry_run,
        )
        projects[item["name"]] = created.record_id
        action = "project" if was_created or args.dry_run else "project (exists)"
        print(f"  {action}: {item['name']}")

    expense_records = [
        {
            "construction_expense.title": "Tower crane weekend mobilisation",
            "construction_expense.project_id": projects["Wynyard Quarter Office Fit-Out"],
            "construction_expense.site_id": sites["viaduct"],
            "construction_expense.cost_code_id": cost_codes["plant_hire"],
            "construction_expense.expense_date": "2026-03-01",
            "construction_expense.expense_type": "equipment",
            "construction_expense.supplier_contact_id": contacts["plant_vendor"],
            "construction_expense.reference": "INV-MPH-88214",
            "construction_expense.amount": 18450.00,
            "construction_expense.status": "posted",
            "construction_expense.notes": "Weekend crane mobilisation and operator standby to avoid weekday CBD traffic restrictions.",
        },
        {
            "construction_expense.title": "Partition framing materials",
            "construction_expense.project_id": projects["Wynyard Quarter Office Fit-Out"],
            "construction_expense.site_id": sites["viaduct"],
            "construction_expense.cost_code_id": cost_codes["steel_materials"],
            "construction_expense.expense_date": "2026-03-04",
            "construction_expense.expense_type": "materials",
            "construction_expense.supplier_contact_id": contacts["steel_vendor"],
            "construction_expense.reference": "PO-SRS-10492",
            "construction_expense.amount": 12680.50,
            "construction_expense.status": "posted",
            "construction_expense.notes": "Light gauge framing package for tenant meeting suites and breakout rooms.",
        },
        {
            "construction_expense.title": "Temporary power board upgrade",
            "construction_expense.project_id": projects["Petone Health Hub Refurbishment"],
            "construction_expense.site_id": sites["petone"],
            "construction_expense.cost_code_id": cost_codes["electrical_subcontract"],
            "construction_expense.expense_date": "2026-02-18",
            "construction_expense.expense_type": "subcontract",
            "construction_expense.supplier_contact_id": contacts["electrical_vendor"],
            "construction_expense.reference": "SC-EL-7716",
            "construction_expense.amount": 9420.00,
            "construction_expense.status": "posted",
            "construction_expense.notes": "Temporary board reconfiguration to keep treatment spaces online during demolition staging.",
        },
        {
            "construction_expense.title": "Structural steel connection package",
            "construction_expense.project_id": projects["Hobsonville Logistics Warehouse Expansion"],
            "construction_expense.site_id": sites["hobsonville"],
            "construction_expense.cost_code_id": cost_codes["steel_materials"],
            "construction_expense.expense_date": "2026-03-08",
            "construction_expense.expense_type": "materials",
            "construction_expense.supplier_contact_id": contacts["steel_vendor"],
            "construction_expense.reference": "SRS-DEL-55810",
            "construction_expense.amount": 28760.00,
            "construction_expense.status": "posted",
            "construction_expense.notes": "Connection plates, bolts, and fabricated secondary steel for canopy extension.",
        },
        {
            "construction_expense.title": "Night traffic management setup",
            "construction_expense.project_id": projects["Wynyard Quarter Office Fit-Out"],
            "construction_expense.site_id": sites["viaduct"],
            "construction_expense.cost_code_id": cost_codes["site_overheads"],
            "construction_expense.expense_date": "2026-03-11",
            "construction_expense.expense_type": "other",
            "construction_expense.supplier_contact_id": contacts["harbour_build"],
            "construction_expense.reference": "TMP-0311-AKL",
            "construction_expense.amount": 3650.00,
            "construction_expense.status": "draft",
            "construction_expense.notes": "Draft cost pending final approval for after-hours delivery traffic control.",
        },
        {
            "construction_expense.title": "Scissor lift monthly hire",
            "construction_expense.project_id": projects["Hobsonville Logistics Warehouse Expansion"],
            "construction_expense.site_id": sites["hobsonville"],
            "construction_expense.cost_code_id": cost_codes["plant_hire"],
            "construction_expense.expense_date": "2026-03-14",
            "construction_expense.expense_type": "equipment",
            "construction_expense.supplier_contact_id": contacts["plant_vendor"],
            "construction_expense.reference": "MPH-ML-20914",
            "construction_expense.amount": 7125.00,
            "construction_expense.status": "posted",
            "construction_expense.notes": "Two electric scissor lifts hired for racking and sprinkler coordination works.",
        },
        {
            "construction_expense.title": "Site preliminaries and waste removal",
            "construction_expense.project_id": projects["Petone Health Hub Refurbishment"],
            "construction_expense.site_id": sites["petone"],
            "construction_expense.cost_code_id": cost_codes["site_overheads"],
            "construction_expense.expense_date": "2026-03-06",
            "construction_expense.expense_type": "other",
            "construction_expense.supplier_contact_id": contacts["pacific_civil"],
            "construction_expense.reference": "PC-OVH-031",
            "construction_expense.amount": 4985.00,
            "construction_expense.status": "posted",
            "construction_expense.notes": "Skip bins, temporary hoardings, and infection-control compliant waste separation.",
        },
    ]

    for record in expense_records:
        _, was_created = ensure_record(
            base_url,
            "entity.construction_expense",
            record,
            match_fields={"construction_expense.reference": record["construction_expense.reference"]},
            token=token,
            workspace_id=workspace_id,
            dry_run=args.dry_run,
        )
        action = "expense" if was_created or args.dry_run else "expense (exists)"
        print(f"  {action}: {record['construction_expense.title']}")

    issue_records = [
        {
            "construction_issue.project_id": projects["Wynyard Quarter Office Fit-Out"],
            "construction_issue.site_id": sites["viaduct"],
            "construction_issue.title": "Lift lobby stone delivery delayed",
            "construction_issue.issue_type": "materials",
            "construction_issue.priority": "high",
            "construction_issue.status": "open",
            "construction_issue.due_date": "2026-04-04",
            "construction_issue.description": "Imported stone for the main lift lobby is now landing four working days late, which risks the premium floor handover sequence.",
        },
        {
            "construction_issue.project_id": projects["Hobsonville Logistics Warehouse Expansion"],
            "construction_issue.site_id": sites["hobsonville"],
            "construction_issue.title": "Canopy footing set-out clash",
            "construction_issue.issue_type": "coordination",
            "construction_issue.priority": "medium",
            "construction_issue.status": "in_progress",
            "construction_issue.owner_id": current_user_id,
            "construction_issue.due_date": "2026-04-02",
            "construction_issue.description": "Survey set-out for the canopy footings conflicts with the revised stormwater trench alignment issued late last week.",
        },
        {
            "construction_issue.project_id": projects["Petone Health Hub Refurbishment"],
            "construction_issue.site_id": sites["petone"],
            "construction_issue.title": "Client hold on treatment room sequencing",
            "construction_issue.issue_type": "delay",
            "construction_issue.priority": "critical",
            "construction_issue.status": "open",
            "construction_issue.due_date": "2026-04-01",
            "construction_issue.description": "Client team has paused stage two refurbishment works pending a decision on whether room 3 remains operational through Easter demand.",
        },
        {
            "construction_issue.project_id": projects["Wynyard Quarter Office Fit-Out"],
            "construction_issue.site_id": sites["viaduct"],
            "construction_issue.title": "After-hours noise restriction complaint",
            "construction_issue.issue_type": "other",
            "construction_issue.priority": "medium",
            "construction_issue.status": "resolved",
            "construction_issue.owner_id": current_user_id,
            "construction_issue.due_date": "2026-03-28",
            "construction_issue.description": "Building management flagged two after-hours noisy works events; revised permit conditions and quieter cutting methods are now in place.",
        },
        {
            "construction_issue.project_id": projects["Hobsonville Logistics Warehouse Expansion"],
            "construction_issue.site_id": sites["hobsonville"],
            "construction_issue.title": "Forklift route separation signage incomplete",
            "construction_issue.issue_type": "safety",
            "construction_issue.priority": "high",
            "construction_issue.status": "open",
            "construction_issue.due_date": "2026-04-03",
            "construction_issue.description": "Pedestrian and live-forklift routes on the warehouse side have not been fully re-marked after the last pour, increasing interface risk.",
        },
    ]

    for record in issue_records:
        _, was_created = ensure_record(
            base_url,
            "entity.construction_issue",
            record,
            match_fields={
                "construction_issue.project_id": record["construction_issue.project_id"],
                "construction_issue.title": record["construction_issue.title"],
            },
            token=token,
            workspace_id=workspace_id,
            dry_run=args.dry_run,
        )
        action = "issue" if was_created or args.dry_run else "issue (exists)"
        print(f"  {action}: {record['construction_issue.title']}")

    print("Import complete.")
    if args.dry_run:
        print("Dry run only: no records were written.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
