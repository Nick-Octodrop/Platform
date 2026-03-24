#!/usr/bin/env python3
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "specs" / "octo_ai_eval_business_suite.json"
PROMPT_BANK = ROOT / "specs" / "octo_ai_real_world_prompt_bank.json"


def _session(title: str) -> dict:
    return {
        "title": title,
        "scope_mode": "auto",
        "selected_artifact_type": "none",
        "selected_artifact_key": "",
    }


def _answer_if(question_id: str, text: str | None = None, hints: dict | None = None) -> dict:
    step = {"answer_if_question": {"question_id": question_id}}
    if isinstance(text, str):
        step["answer_if_question"]["text"] = text
    if isinstance(hints, dict) and hints:
        step["answer_if_question"]["hints"] = hints
    return step


def _validate_tail() -> list[dict]:
    return [
        {"answer_if_question": {"question_id": "confirm_plan", "text": "Approved."}},
        {"generate_patchset": True, "expect": {"ok": True, "patchset_status": "draft"}},
        {"validate_patchset": True, "expect": {"ok": True, "patchset_status": "validated", "validation_ok": True}},
    ]


def _with_expect(step: dict, extra_expect: dict | None = None) -> dict:
    updated = dict(step)
    if isinstance(extra_expect, dict) and extra_expect:
        expect = updated.get("expect") if isinstance(updated.get("expect"), dict) else {}
        updated["expect"] = {**expect, **extra_expect}
    return updated


def _validate_tail_with(extra_expect: dict | None = None) -> list[dict]:
    return [_with_expect(step, extra_expect) for step in _validate_tail()]


def _merge_expect_maps(base: dict | None, extra: dict | None) -> dict:
    merged: dict = dict(base or {})
    for key, value in (extra or {}).items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _merge_expect_maps(merged.get(key), value)
        elif isinstance(value, list) and isinstance(merged.get(key), list):
            combined = list(merged.get(key) or [])
            for item in value:
                if item not in combined:
                    combined.append(item)
            merged[key] = combined
        elif key.startswith("min_") and isinstance(value, int) and isinstance(merged.get(key), int):
            merged[key] = max(int(merged.get(key) or 0), value)
        elif isinstance(value, bool) and isinstance(merged.get(key), bool):
            merged[key] = bool(merged.get(key)) or value
        else:
            merged[key] = value
    return merged


def _default_manifest_expect(tags: list[str], prompt: str, *, create_module: bool) -> dict:
    tag_set = {tag for tag in tags if isinstance(tag, str)}
    lower = (prompt or "").lower()
    expect: dict = {}
    if create_module:
        expect = _merge_expect_maps(expect, {"min_useful_field_count": 6, "view_kinds_include": ["list", "form"]})
    if "complete_module" in tag_set:
        expect = _merge_expect_maps(expect, {"min_useful_field_count": 8, "view_kinds_include": ["kanban"]})
    if "multi_entity" in tag_set:
        expect = _merge_expect_maps(expect, {"min_entity_count": 2})
    if {"workflow", "complete_module"} & tag_set:
        expect = _merge_expect_maps(
            expect,
            {
                "min_action_count": 2,
                "min_workflow_state_count": 3,
                "statusbar_required": True,
            },
        )
    if "conditions" in tag_set:
        expect = _merge_expect_maps(expect, {"min_condition_count": 1})
    if "cross_module" in tag_set:
        expect = _merge_expect_maps(expect, {"min_dependency_count": 1})
    if "transformation" in tag_set:
        expect = _merge_expect_maps(expect, {"min_transformation_count": 1})
    if "automation" in tag_set:
        expect = _merge_expect_maps(expect, {"min_trigger_count": 1})
    if "documents" in tag_set:
        expect = _merge_expect_maps(expect, {"interfaces_include": ["documentable"]})
    if "real_world" in tag_set and create_module:
        expect = _merge_expect_maps(expect, {"interfaces_include": ["dashboardable"]})
    if create_module and ("date" in lower or "calendar" in lower or "schedule" in lower):
        expect = _merge_expect_maps(expect, {"view_kinds_include": ["calendar"], "interfaces_include": ["schedulable"]})
    if create_module and ("dashboard" in lower or "report" in lower or "odoo-style" in lower or "odoo style" in lower):
        expect = _merge_expect_maps(expect, {"interfaces_include": ["dashboardable"]})
    if create_module and any(token in lower for token in ("action button", "actions to move", "approval actions", "workflow", "status flow")):
        expect = _merge_expect_maps(expect, {"min_action_count": 2})
    return expect


def _default_preview_expect(tags: list[str], prompt: str, *, create_module: bool) -> dict:
    tag_set = {tag for tag in tags if isinstance(tag, str)}
    lower = (prompt or "").lower()
    expect: dict = {}
    if create_module and "complete_module" in tag_set:
        expect = _merge_expect_maps(expect, {"text_contains": ["views", "workflow"]})
    if "workflow" in tag_set:
        expect = _merge_expect_maps(expect, {"text_contains": ["status"]})
    if "conditions" in tag_set:
        expect = _merge_expect_maps(expect, {"text_contains": ["when"]})
    if "cross_module" in tag_set:
        mentions = []
        for module_name in ("CRM", "Sales", "Jobs", "Contacts", "Documents", "Invoices"):
            if module_name.lower() in lower:
                mentions.append(module_name)
        if mentions:
            expect = _merge_expect_maps(expect, {"text_contains": mentions})
    if "documents" in tag_set and any(token in lower for token in ("document", "pdf", "report")):
        expect = _merge_expect_maps(expect, {"text_contains": ["document"]})
    return expect


def _scenario_priority(scenario: dict) -> tuple[int, int]:
    tags = {tag for tag in (scenario.get("tags") or []) if isinstance(tag, str)}
    priority = 0
    weights = {
        "complete_module": 80,
        "cross_module": 70,
        "automation": 50,
        "conditions": 45,
        "multi_entity": 40,
        "workflow": 35,
        "business_flow": 30,
        "real_world": 25,
        "documents": 15,
        "create_module": 10,
        "scope_switch": -5,
        "contacts_change": -15,
    }
    for tag, weight in weights.items():
        if tag in tags:
            priority += weight
    level = scenario.get("level")
    if isinstance(level, int):
        priority += level * 5
    return (-priority, len(scenario.get("steps") or []))


def _load_prompt_bank() -> list[dict]:
    try:
        raw = json.loads(PROMPT_BANK.read_text(encoding="utf-8"))
    except Exception:
        return []
    if isinstance(raw, dict):
        prompts = raw.get("prompts")
        if isinstance(prompts, list):
            return [item for item in prompts if isinstance(item, dict)]
    return []


def create_module_scenario(
    name: str,
    module_name: str,
    prompt: str,
    *,
    tags: list[str] | None = None,
    level: int | None = None,
    manifest_expect: dict | None = None,
    preview_expect: dict | None = None,
) -> dict:
    merged_manifest_expect = _merge_expect_maps(_default_manifest_expect(["create_module", *(tags or [])], prompt, create_module=True), manifest_expect)
    merged_preview_expect = _merge_expect_maps(_default_preview_expect(["create_module", *(tags or [])], prompt, create_module=True), preview_expect)
    steps = [
        {"chat": prompt},
        _answer_if("module_target", module_name),
        _answer_if("confirm_plan", "Approved."),
        {"generate_patchset": True, "expect": {"ok": True, "patchset_status": "draft"}},
        {
            "validate_patchset": True,
            "expect": {
                "ok": True,
                "patchset_status": "validated",
                "validation_ok": True,
                **({"manifest_expect": merged_manifest_expect} if isinstance(merged_manifest_expect, dict) and merged_manifest_expect else {}),
                **({"preview_expect": merged_preview_expect} if isinstance(merged_preview_expect, dict) and merged_preview_expect else {}),
            },
        },
    ]
    scenario = {"name": name, "tags": ["create_module", *(tags or [])], "session": _session(name), "steps": steps}
    if isinstance(level, int):
        scenario["level"] = level
    return scenario


def contacts_change_scenario(
    name: str,
    prompt: str,
    *,
    field_label: str | None = None,
    field_type: str = "string",
    field_target: str | None = None,
    tab_target: str | None = None,
    placement_text: str | None = None,
) -> dict:
    steps = [{"chat": prompt}]
    steps.append(_answer_if("module_target", "contacts"))
    if isinstance(field_label, str) and field_label:
        steps.append(
            _answer_if(
                "field_spec",
                field_label,
                hints={"field_label": field_label, "field_type": field_type},
            )
        )
    if isinstance(field_target, str) and field_target:
        steps.append(_answer_if("field_target", field_target))
    if isinstance(tab_target, str) and tab_target:
        steps.append(_answer_if("tab_target", tab_target))
    if isinstance(placement_text, str) and placement_text:
        steps.append(_answer_if("placement", placement_text))
    steps.extend(_validate_tail())
    return {"name": name, "tags": ["contacts_change"], "session": _session(name), "steps": steps}


def upgrade_scenario(name: str, prompt: str, module_target: str) -> dict:
    steps = [
        {"chat": prompt},
        _answer_if("module_target", module_target),
        _answer_if("confirm_plan", "Approved."),
        {"generate_patchset": True, "expect": {"ok": True, "patchset_status": "draft"}},
        {"validate_patchset": True, "expect": {"ok": True, "patchset_status": "validated", "validation_ok": True}},
    ]
    return {"name": name, "tags": ["upgrade"], "session": _session(name), "steps": steps}


def scope_switch_scenario(name: str, warmup_prompt: str, target_prompt: str, *, field_target: str | None = None, field_label: str | None = None, field_type: str = "string", tab_target: str | None = None, placement_text: str | None = None) -> dict:
    steps = [
        {"chat": warmup_prompt},
        {"chat": target_prompt},
        _answer_if("module_target", "contacts"),
    ]
    if isinstance(field_label, str) and field_label:
        steps.append(_answer_if("field_spec", field_label, hints={"field_label": field_label, "field_type": field_type}))
    if isinstance(field_target, str) and field_target:
        steps.append(_answer_if("field_target", field_target))
    if isinstance(tab_target, str) and tab_target:
        steps.append(_answer_if("tab_target", tab_target))
    if isinstance(placement_text, str) and placement_text:
        steps.append(_answer_if("placement", placement_text))
    steps.extend(_validate_tail())
    return {"name": name, "tags": ["scope_switch"], "session": _session(name), "steps": steps}


def business_change_scenario(
    name: str,
    prompt: str,
    *,
    module_target: str | None = None,
    tags: list[str] | None = None,
    level: int | None = None,
    extra_expect: dict | None = None,
    manifest_expect: dict | None = None,
    preview_expect: dict | None = None,
) -> dict:
    steps = [{"chat": prompt}]
    if isinstance(module_target, str) and module_target:
        steps.append(_answer_if("module_target", module_target))
    merged_expect: dict = {}
    if isinstance(extra_expect, dict) and extra_expect:
        merged_expect.update(extra_expect)
    merged_manifest_expect = _merge_expect_maps(_default_manifest_expect(list(tags or []), prompt, create_module=False), manifest_expect)
    merged_preview_expect = _merge_expect_maps(_default_preview_expect(list(tags or []), prompt, create_module=False), preview_expect)
    if isinstance(merged_manifest_expect, dict) and merged_manifest_expect:
        merged_expect["manifest_expect"] = merged_manifest_expect
    if isinstance(merged_preview_expect, dict) and merged_preview_expect:
        merged_expect["preview_expect"] = merged_preview_expect
    steps.extend(_validate_tail_with(merged_expect or None))
    scenario = {"name": name, "tags": list(tags or []), "session": _session(name), "steps": steps}
    if isinstance(level, int):
        scenario["level"] = level
    return scenario


def build_suite() -> list[dict]:
    scenarios: list[dict] = []

    basic_modules = [
        ("create_neetones", "Neetones", "Create a simple module for managing gym training sessions. Call it Neetones. Make it clean and modern."),
        ("create_vehicle_logbook", "Vehicle Logbook", "Create a simple module to track vehicle usage, odometer readings, drivers, and notes. Call it Vehicle Logbook."),
        ("create_tool_register", "Tool Register", "Create a simple module to manage tools, serial numbers, assigned staff, service dates, and condition. Call it Tool Register."),
        ("create_site_visits", "Site Visits", "Create a simple module to manage site visits, visit dates, customer, outcome, and notes. Call it Site Visits."),
        ("create_purchase_requests", "Purchase Requests", "Create a simple module to manage purchase requests, requester, amount, supplier, and notes. Call it Purchase Requests."),
        ("create_expense_claims", "Expense Claims", "Create a simple module for employee expense claims with date, amount, category, receipt, and status. Call it Expense Claims."),
        ("create_visitor_sign_in", "Visitor Sign In", "Create a simple module to track visitors, visit time, host, company, and sign out. Call it Visitor Sign In."),
        ("create_contractor_inductions", "Contractor Inductions", "Create a simple module to manage contractor inductions, expiry dates, company, contact, and notes. Call it Contractor Inductions."),
        ("create_stocktake_hub", "Stocktake Hub", "Create a simple module for stocktakes with location, count date, counted by, variance, and notes. Call it Stocktake Hub."),
        ("create_leave_requests", "Leave Requests", "Create a simple module for leave requests with employee, dates, leave type, status, and manager notes. Call it Leave Requests."),
        ("create_staff_training", "Staff Training", "Create a simple module to track staff training, provider, due date, completion date, and certificate notes. Call it Staff Training."),
        ("create_safety_incidents", "Safety Incidents", "Create a simple module to log safety incidents with date, severity, location, people involved, and follow up. Call it Safety Incidents."),
        ("create_meeting_notes", "Meeting Notes", "Create a simple module for meeting notes with meeting title, date, attendees, decisions, and action notes. Call it Meeting Notes."),
        ("create_shift_handover", "Shift Handover", "Create a simple module to manage shift handovers with date, outgoing staff, incoming staff, summary, and issues. Call it Shift Handover."),
        ("create_kitchen_prep", "Kitchen Prep", "Create a simple module to manage kitchen prep lists with item, prep date, station, status, and notes. Call it Kitchen Prep."),
        ("create_meal_planner", "Meal Planner", "Create a simple module to manage meals, planned date, meal type, ingredients summary, and notes. Call it Meal Planner."),
        ("create_delivery_runs", "Delivery Runs", "Create a simple module to manage delivery runs with driver, date, route, vehicle, and notes. Call it Delivery Runs."),
        ("create_equipment_hire", "Equipment Hire", "Create a simple module to manage equipment hire with customer, item, out date, due date, and notes. Call it Equipment Hire."),
        ("create_room_bookings", "Room Bookings", "Create a simple module to manage room bookings with room, booking date, organiser, purpose, and notes. Call it Room Bookings."),
        ("create_vendor_reviews", "Vendor Reviews", "Create a simple module to manage vendor reviews with supplier, review date, score, owner, and notes. Call it Vendor Reviews."),
        ("create_client_onboarding", "Client Onboarding", "Create a simple module to manage client onboarding checklists with client, owner, target date, status, and notes. Call it Client Onboarding."),
        ("create_warranty_claims", "Warranty Claims", "Create a simple module to manage warranty claims with customer, product, claim date, status, and notes. Call it Warranty Claims."),
        ("create_service_recalls", "Service Recalls", "Create a simple module to manage service recalls with asset, recall date, owner, priority, and notes. Call it Service Recalls."),
        ("create_quality_audits", "Quality Audits", "Create a simple module to manage quality audits with audit date, auditor, score, finding summary, and notes. Call it Quality Audits."),
        ("create_supplier_scorecards", "Supplier Scorecards", "Create a simple module to manage supplier scorecards with supplier, review date, rating, owner, and notes. Call it Supplier Scorecards."),
        ("create_fuel_logs", "Fuel Logs", "Create a simple module to manage fuel logs with vehicle, date, litres, cost, and notes. Call it Fuel Logs."),
        ("create_travel_requests", "Travel Requests", "Create a simple module to manage travel requests with employee, destination, dates, purpose, and notes. Call it Travel Requests."),
        ("create_audit_actions", "Audit Actions", "Create a simple module to manage audit actions with title, owner, due date, status, and notes. Call it Audit Actions."),
        ("create_branch_targets", "Branch Targets", "Create a simple module to manage branch targets with branch, period, target, owner, and notes. Call it Branch Targets."),
        ("create_fleet_checks", "Fleet Checks", "Create a simple module to manage fleet checks with vehicle, check date, driver, result, and notes. Call it Fleet Checks."),
        ("create_volunteer_hours", "Volunteer Hours", "Create a simple module to track volunteer hours with volunteer, date, hours, activity, and notes. Call it Volunteer Hours."),
        ("create_membership_renewals", "Membership Renewals", "Create a simple module to manage membership renewals with member, renewal date, plan, status, and notes. Call it Membership Renewals."),
        ("create_workshop_bookings", "Workshop Bookings", "Create a simple module to manage workshop bookings with customer, asset, booking date, technician, and notes. Call it Workshop Bookings."),
        ("create_returns_processing", "Returns Processing", "Create a simple module to manage product returns with customer, product, return date, reason, and notes. Call it Returns Processing."),
        ("create_event_run_sheets", "Event Run Sheets", "Create a simple module to manage event run sheets with event, date, owner, venue, and notes. Call it Event Run Sheets."),
    ]
    for name, module_name, prompt in basic_modules:
        scenarios.append(create_module_scenario(name, module_name, prompt))

    workflow_modules = [
        ("create_maintenance_requests", "Maintenance Requests", "Create a maintenance requests module called Maintenance Requests with statuses New, In Progress, Waiting Parts, Done, and actions to move between those stages."),
        ("create_time_off_approvals", "Time Off Approvals", "Create a module called Time Off Approvals with request status Draft, Submitted, Approved, Declined, and actions for submit, approve, and decline."),
        ("create_purchase_approval_desk", "Purchase Approval Desk", "Create a module called Purchase Approval Desk with draft, submitted, approved, rejected statuses and approval actions based on status."),
        ("create_incident_response", "Incident Response", "Create a module called Incident Response with severity, status flow Open, Investigating, Contained, Closed, and actions to move the status."),
        ("create_vehicle_service_schedule", "Vehicle Service Schedule", "Create a module called Vehicle Service Schedule with planned, booked, completed statuses and date-driven scheduling views."),
        ("create_audit_findings", "Audit Findings", "Create a module called Audit Findings with statuses Open, Actioned, Verified, Closed and owner-based follow-up actions."),
        ("create_stock_replenishment", "Stock Replenishment", "Create a module called Stock Replenishment with statuses Draft, Pending Approval, Ordered, Received and actions for approve and receive."),
        ("create_candidate_pipeline", "Candidate Pipeline", "Create a recruitment module called Candidate Pipeline with stage flow Applied, Screen, Interview, Offer, Hired and kanban-first pipeline support."),
        ("create_training_compliance", "Training Compliance", "Create a module called Training Compliance with due, booked, completed, overdue statuses and reminder-friendly date views."),
        ("create_site_defects", "Site Defects", "Create a module called Site Defects with status flow Reported, Assigned, In Repair, Resolved and actions for assign and resolve."),
        ("create_tool_checkout", "Tool Checkout", "Create a module called Tool Checkout with statuses Available, Checked Out, Overdue, Returned and actions to check out and return."),
        ("create_capital_requests", "Capital Requests", "Create a module called Capital Requests with draft, review, approved, rejected statuses and approval actions."),
        ("create_change_requests", "Change Requests", "Create a module called Change Requests with draft, submitted, approved, implemented statuses and action buttons for each stage."),
        ("create_repair_queue", "Repair Queue", "Create a module called Repair Queue with queue status New, Diagnosed, Waiting Approval, Repairing, Complete and list plus kanban views."),
        ("create_onboarding_tasks", "Onboarding Tasks", "Create a module called Onboarding Tasks with statuses To Do, In Progress, Done, owner assignment, due dates, and approval-style closeout actions."),
    ]
    for name, module_name, prompt in workflow_modules:
        scenarios.append(create_module_scenario(name, module_name, prompt))

    contact_changes = [
        ("contacts_add_master_list_name_notes", "In the Contacts module, add a field called Master List Name and place it in the Internal Notes tab on the form only.", {"field_label": "Master List Name", "field_type": "string", "tab_target": "Internal Notes", "placement_text": "Include it in form only."}),
        ("contacts_add_preferred_contact_method", "Add a field called Preferred Contact Method to the Contacts module and include it in form and list.", {"field_label": "Preferred Contact Method", "field_type": "string", "placement_text": "Include it in form and list."}),
        ("contacts_add_customer_tier", "In Contacts, add a field called Customer Tier and include it in the form and list.", {"field_label": "Customer Tier", "field_type": "string", "placement_text": "Include it in form and list."}),
        ("contacts_add_is_strategic_account", "Add a checkbox field called Strategic Account to the Contacts module form only.", {"field_label": "Strategic Account", "field_type": "bool", "placement_text": "Include it in form only."}),
        ("contacts_add_nickname", "In the Contacts module, add a field called Nickname and place it in the main form.", {"field_label": "Nickname", "field_type": "string", "placement_text": "Include it in form only."}),
        ("contacts_add_reference_number", "Add a field called Reference Number to Contacts and show it in form and list.", {"field_label": "Reference Number", "field_type": "string", "placement_text": "Include it in form and list."}),
        ("contacts_add_linkedin_url", "Add a field called LinkedIn URL to Contacts and include it on the form only.", {"field_label": "LinkedIn URL", "field_type": "string", "placement_text": "Include it in form only."}),
        ("contacts_add_birthday", "Add a Birthday field to the Contacts module form only.", {"field_label": "Birthday", "field_type": "date", "placement_text": "Include it in form only."}),
        ("contacts_add_on_hold_reason", "Add a field called On Hold Reason to the Contacts module and put it in the Internal Notes tab.", {"field_label": "On Hold Reason", "field_type": "text", "tab_target": "Internal Notes", "placement_text": "Include it in form only."}),
        ("contacts_add_credit_review_date", "In Contacts, add Credit Review Date and place it in the Accounting tab on the form only.", {"field_label": "Credit Review Date", "field_type": "date", "tab_target": "Accounting", "placement_text": "Include it in form only."}),
        ("contacts_remove_roblux", "Remove the roblux field from the Contacts module.", {"field_target": "roblux"}),
        ("contacts_remove_bear", "Remove the Bear field from the Contacts module.", {"field_target": "Bear"}),
        ("contacts_remove_a_new", "Remove the A New field from the Contacts module.", {"field_target": "A New"}),
        ("contacts_remove_headshots_field", "Remove the field \"A New Attachment Field Upload Called Headshots For Them\" from the Contacts module.", {"field_target": "A New Attachment Field Upload Called Headshots For Them"}),
        ("contacts_move_roblux_to_notes", "Move the roblux field into the Internal Notes tab in Contacts.", {"field_target": "roblux", "tab_target": "Internal Notes"}),
        ("contacts_move_supplier_rating_lower", "Move the supplier rating field to the bottom of the main Contacts form section.", {"field_target": "supplier rating"}),
        ("contacts_add_service_notes", "Add a field called Service Notes to Contacts and put it in the Internal Notes tab.", {"field_label": "Service Notes", "field_type": "text", "tab_target": "Internal Notes", "placement_text": "Include it in form only."}),
        ("contacts_add_emergency_contact_name", "Add a field called Emergency Contact Name to the Contacts module form only.", {"field_label": "Emergency Contact Name", "field_type": "string", "placement_text": "Include it in form only."}),
        ("contacts_add_last_contacted_on", "Add a Last Contacted On field to Contacts and show it in the form and list.", {"field_label": "Last Contacted On", "field_type": "date", "placement_text": "Include it in form and list."}),
        ("contacts_add_customer_since", "Add a Customer Since field to Contacts and place it in the Sales & Purchase tab.", {"field_label": "Customer Since", "field_type": "date", "tab_target": "Sales & Purchase", "placement_text": "Include it in form only."}),
        ("contacts_add_portal_access", "Add a checkbox called Portal Access to the Contacts module form only.", {"field_label": "Portal Access", "field_type": "bool", "placement_text": "Include it in form only."}),
        ("contacts_add_account_manager_notes", "Add Account Manager Notes to Contacts and put it in the Internal Notes tab.", {"field_label": "Account Manager Notes", "field_type": "text", "tab_target": "Internal Notes", "placement_text": "Include it in form only."}),
        ("contacts_cleanup_duplicate_supplier_rating", "Clean up the duplicate supplier rating fields in the Contacts module and keep only one valid field.", {"field_target": "supplier rating"}),
        ("contacts_add_payment_hold", "Add a Payment Hold checkbox to Contacts in the Accounting tab.", {"field_label": "Payment Hold", "field_type": "bool", "tab_target": "Accounting", "placement_text": "Include it in form only."}),
        ("contacts_add_delivery_instructions", "Add Delivery Instructions to Contacts and place it under Contacts & Addresses on the form.", {"field_label": "Delivery Instructions", "field_type": "text", "tab_target": "Contacts & Addresses", "placement_text": "Include it in form only."}),
        ("contacts_add_vat_verified", "Add a VAT Verified checkbox to Contacts and put it in Accounting.", {"field_label": "VAT Verified", "field_type": "bool", "tab_target": "Accounting", "placement_text": "Include it in form only."}),
        ("contacts_add_contact_source", "Add Contact Source to Contacts and show it in the form and list.", {"field_label": "Contact Source", "field_type": "string", "placement_text": "Include it in form and list."}),
        ("contacts_add_do_not_disturb", "Add a Do Not Disturb checkbox to the Contacts module form only.", {"field_label": "Do Not Disturb", "field_type": "bool", "placement_text": "Include it in form only."}),
        ("contacts_add_internal_reference", "Add an Internal Reference field to Contacts and show it in form and list.", {"field_label": "Internal Reference", "field_type": "string", "placement_text": "Include it in form and list."}),
        ("contacts_add_service_region", "Add a Service Region field to Contacts and include it on the form only.", {"field_label": "Service Region", "field_type": "string", "placement_text": "Include it in form only."}),
    ]
    for name, prompt, meta in contact_changes:
        scenarios.append(contacts_change_scenario(name, prompt, **meta))

    upgrades = [
        ("upgrade_contacts_latest_style", "Upgrade the Contacts module to use the latest recommended module design style.", "contacts"),
        ("contacts_list_first_views", "For Contacts, make it list-first but include kanban, graph, and pivot views if they make sense.", "contacts"),
        ("contacts_modernize_form_layout", "Modernize the Contacts form layout using the latest design docs without changing its business meaning.", "contacts"),
        ("contacts_review_calendar_view", "For Contacts, add a calendar view only if there is a meaningful date field worth showing there.", "contacts"),
        ("contacts_primary_create_action", "Review Contacts actions and make sure the primary create action uses + New and the latest recommended style.", "contacts"),
        ("contacts_refresh_filters_bulk_actions", "Improve Contacts list filters and bulk actions using the latest module building style.", "contacts"),
        ("contacts_latest_page_structure", "Align the Contacts list page and form page to the current marketplace page structure.", "contacts"),
        ("contacts_tabs_and_chatter_layout", "Make sure Contacts uses tabs consistently and keeps chatter in the recommended right-side card layout.", "contacts"),
        ("contacts_nav_home_alignment", "Update Contacts nav and home pages to follow the latest recommended module design approach.", "contacts"),
        ("contacts_outdated_structure_review", "Review Contacts for outdated page or view structure and modernize it to current design docs.", "contacts"),
    ]
    for name, prompt, module_target in upgrades:
        scenarios.append(upgrade_scenario(name, prompt, module_target))

    switches = [
        ("scope_switch_neetones_to_contacts_remove_roblux", "For Neetones, make it list-first with useful views.", "Now remove the roblux field from the Contacts module.", {"field_target": "roblux"}),
        ("scope_switch_calendar_to_contacts_master_list", "Upgrade the Calendar module to latest style.", "In Contacts, add Master List Name in the Internal Notes tab on the form only.", {"field_label": "Master List Name", "field_type": "string", "tab_target": "Internal Notes", "placement_text": "Include it in form only."}),
        ("scope_switch_jobs_to_contacts_remove_bear", "For Jobs, modernize the list and form page layout.", "Remove the Bear field from the Contacts module.", {"field_target": "Bear"}),
        ("scope_switch_documents_to_contacts_portal_access", "Review the Documents module for modern layout improvements.", "Add a Portal Access checkbox to Contacts form only.", {"field_label": "Portal Access", "field_type": "bool", "placement_text": "Include it in form only."}),
        ("scope_switch_tasks_to_contacts_move_roblux", "For Tasks, improve the workflow layout and views.", "Move the roblux field into the Internal Notes tab in Contacts.", {"field_target": "roblux", "tab_target": "Internal Notes"}),
        ("scope_switch_maintenance_to_contacts_remove_a_new", "For Maintenance, update the module to the latest style.", "Remove the A New field from the Contacts module.", {"field_target": "A New"}),
        ("scope_switch_sales_to_contacts_contact_source", "For Sales, make the module list-first with modern views.", "Add Contact Source to Contacts and show it in the form and list.", {"field_label": "Contact Source", "field_type": "string", "placement_text": "Include it in form and list."}),
        ("scope_switch_crm_to_contacts_reference_number", "For CRM, review the latest design style for the module.", "Add Reference Number to Contacts and include it in the form and list.", {"field_label": "Reference Number", "field_type": "string", "placement_text": "Include it in form and list."}),
        ("scope_switch_field_service_to_contacts_remove_headshots", "For Field Service, improve the latest layout structure.", "Remove the field \"A New Attachment Field Upload Called Headshots For Them\" from the Contacts module.", {"field_target": "A New Attachment Field Upload Called Headshots For Them"}),
        ("scope_switch_variations_to_contacts_account_manager_notes", "For Variations, make sure the module matches current layout guidance.", "Add Account Manager Notes to Contacts and put it in Internal Notes.", {"field_label": "Account Manager Notes", "field_type": "text", "tab_target": "Internal Notes", "placement_text": "Include it in form only."}),
    ]
    for name, warmup, target, meta in switches:
        scenarios.append(scope_switch_scenario(name, warmup, target, **meta))

    business_flows = [
        business_change_scenario(
            "cross_module_quote_approval_creates_job",
            "In Sales, when a quote is approved, create a Job in Jobs, copy the customer and site details from Contacts, and notify the coordinator.",
            tags=["cross_module", "automation", "workflow", "business_flow"],
            level=4,
            extra_expect={"candidate_ops_include": ["update_action"]},
            manifest_expect={
                "min_trigger_count": 1,
                "min_dependency_count": 1,
            },
            preview_expect={
                "text_contains": ["Sales", "Jobs", "Contacts", "notify"],
            },
        ),
        business_change_scenario(
            "cross_module_crm_lead_to_sales_quote",
            "When a CRM lead becomes qualified, add the flow to create a draft quote in Sales and carry over contact details from Contacts.",
            tags=["cross_module", "automation", "transformation", "business_flow"],
            level=4,
            manifest_expect={
                "min_transformation_count": 1,
                "min_dependency_count": 1,
            },
            preview_expect={
                "text_contains": ["CRM", "Sales", "Contacts", "draft quote"],
            },
        ),
        business_change_scenario(
            "cross_module_job_completion_generates_documents",
            "In Jobs, when a job is completed, generate a completion pack in Documents, attach the service report PDF, and mark the customer follow-up in Contacts.",
            tags=["cross_module", "automation", "pdf_template", "documents", "business_flow"],
            level=5,
            manifest_expect={
                "min_trigger_count": 1,
                "min_dependency_count": 1,
            },
            preview_expect={
                "text_contains": ["Jobs", "Documents", "Contacts", "service report"],
            },
        ),
        business_change_scenario(
            "sales_quote_approval_email_template",
            "In Sales, create an approval email template that thanks the customer, shows the approved quote number, lists the next steps, and is ready to send when the quote is approved.",
            module_target="sales",
            tags=["template", "email_template", "automation", "business_flow"],
            level=5,
        ),
        business_change_scenario(
            "jobs_service_report_pdf_template",
            "In Jobs, create a service report PDF template using Jinja placeholders for customer, site, technician, work completed, materials used, and sign-off.",
            module_target="jobs",
            tags=["template", "pdf_template", "jinja_template", "documents", "business_flow"],
            level=5,
        ),
        business_change_scenario(
            "contacts_remove_outdated_internal_field",
            "In Contacts, remove the outdated internal reference field if it exists and keep the rest of the form intact.",
            module_target="contacts",
            tags=["edit_existing", "remove", "business_flow"],
            level=2,
        ),
        business_change_scenario(
            "jobs_add_conditional_completion_requirements",
            "In Jobs, when the status is Completed require Completion Notes and Customer Sign Off, and only show Follow-up Date when Follow-up Required is checked.",
            module_target="jobs",
            tags=["edit_existing", "conditions", "workflow", "business_flow"],
            level=4,
            manifest_expect={
                "min_condition_count": 2,
                "statusbar_required": True,
            },
            preview_expect={
                "text_contains": ["Completed", "Completion Notes", "Customer Sign Off", "Follow-up Date", "Follow-up Required"],
            },
        ),
        create_module_scenario(
            "create_cookbook_studio",
            "Cookbook Studio",
            "Create a cookbook app called Cookbook Studio to manage recipes, pantry ingredients, cookbook drafts, and action buttons for testing, approving, and publishing recipes.",
            tags=["complete_module", "real_world", "multi_entity", "workflow"],
            level=5,
            manifest_expect={
                "min_entity_count": 2,
                "min_useful_field_count": 10,
                "min_action_count": 3,
                "min_workflow_state_count": 4,
                "field_labels_include": ["Recipe Name", "Ingredients", "Method"],
                "action_labels_include": ["Plan", "Cook"],
                "workflow_state_labels_include": ["Draft"],
                "view_kinds_include": ["list", "form", "kanban", "calendar", "graph"],
                "interfaces_include": ["dashboardable", "schedulable", "documentable"],
            },
            preview_expect={
                "text_contains": ["cookbook", "pantry"],
                "field_labels_include": ["Recipe Name", "Ingredients", "Method"],
                "action_labels_include": ["Plan", "Cook"],
                "view_kinds_include": ["list", "form", "kanban", "calendar", "graph"],
                "interfaces_include": ["dashboardable", "schedulable", "documentable"],
            },
        ),
        create_module_scenario(
            "create_field_service_odoo_style",
            "Field Service Control",
            "Create a field service app called Field Service Control with jobs, technicians, parts used, service reports, customer signatures, scheduling, statuses, action buttons, and documents like an Odoo-style operational module.",
            tags=["complete_module", "real_world", "workflow", "documents"],
            level=5,
            manifest_expect={
                "min_useful_field_count": 10,
                "min_action_count": 3,
                "min_workflow_state_count": 4,
                "view_kinds_include": ["list", "form", "kanban", "calendar", "graph"],
                "interfaces_include": ["dashboardable", "schedulable", "documentable"],
            },
            preview_expect={
                "text_contains": ["technicians", "service reports", "documents"],
                "view_kinds_include": ["list", "form", "kanban", "calendar", "graph"],
                "interfaces_include": ["dashboardable", "schedulable", "documentable"],
            },
        ),
        create_module_scenario(
            "create_training_ops_with_automations",
            "Training Operations",
            "Create a training operations app called Training Operations with courses, attendees, due dates, reminders, completion certificates, automated overdue follow-ups, and rich action buttons.",
            tags=["complete_module", "real_world", "automation", "workflow"],
            level=5,
            manifest_expect={
                "min_useful_field_count": 8,
                "min_action_count": 2,
                "min_workflow_state_count": 3,
                "field_labels_include": ["Session Name", "Training Date"],
                "view_kinds_include": ["list", "form", "calendar"],
                "interfaces_include": ["dashboardable", "schedulable", "documentable"],
            },
            preview_expect={
                "text_contains": ["reminders", "completion certificates", "overdue"],
                "field_labels_include": ["Session Name", "Training Date"],
                "view_kinds_include": ["list", "form", "calendar"],
                "interfaces_include": ["dashboardable", "schedulable", "documentable"],
            },
        ),
    ]
    scenarios.extend(business_flows)

    prompt_bank = _load_prompt_bank()
    seeded_count = 0
    for item in prompt_bank:
        seed = item.get("suite_seed") if isinstance(item.get("suite_seed"), dict) else {}
        if seed.get("kind") != "create_module":
            continue
        module_name = seed.get("module_name")
        prompt = item.get("prompt")
        item_id = item.get("id")
        if not isinstance(module_name, str) or not module_name.strip():
            continue
        if not isinstance(prompt, str) or not prompt.strip():
            continue
        if not isinstance(item_id, str) or not item_id.strip():
            continue
        scenarios.append(
            create_module_scenario(
                f"real_world_{item_id}",
                module_name.strip(),
                prompt.strip(),
            )
        )
        seeded_count += 1

    assert len(scenarios) >= 100 + seeded_count, f"expected at least {100 + seeded_count} scenarios, got {len(scenarios)}"
    return sorted(scenarios, key=_scenario_priority)


def main() -> None:
    suite = build_suite()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(suite, indent=2), encoding="utf-8")
    print(f"Wrote {len(suite)} scenarios to {OUT}")


if __name__ == "__main__":
    main()
