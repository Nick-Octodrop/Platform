#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "_shared"))

from automation_tooling import upsert_automation_by_name
from manifest_tooling import api_call, collect_error_text, is_ok


ACTIVE_OPPORTUNITY_STAGES = [
    "deal_qualification",
    "meeting",
    "proposal",
    "negotiation_commitment",
    "on_hold",
]
ROTTING_DEAL_DELAY_SECONDS = 14 * 24 * 60 * 60


def eq_var(var_name: str, value: Any) -> dict[str, Any]:
    return {"op": "eq", "left": {"var": var_name}, "right": {"literal": value}}


def eq_vars(left_var: str, right_var: str) -> dict[str, Any]:
    return {"op": "eq", "left": {"var": left_var}, "right": {"var": right_var}}


def neq_var(var_name: str, value: Any) -> dict[str, Any]:
    return {"op": "neq", "left": {"var": var_name}, "right": {"literal": value}}


def in_var(var_name: str, values: list[Any]) -> dict[str, Any]:
    return {"op": "in", "left": {"var": var_name}, "right": {"literal": values}}


def exists(var_name: str) -> dict[str, Any]:
    return {"op": "exists", "left": {"var": var_name}}


def not_exists(var_name: str) -> dict[str, Any]:
    return {"op": "not_exists", "left": {"var": var_name}}


def and_(*conditions: dict[str, Any]) -> dict[str, Any]:
    return {"op": "and", "children": list(conditions)}


def or_(*conditions: dict[str, Any]) -> dict[str, Any]:
    return {"op": "or", "children": list(conditions)}


def not_true(var_name: str) -> dict[str, Any]:
    return or_(not_exists(var_name), neq_var(var_name, True))


def update_record_step(
    step_id: str,
    *,
    entity_id: str,
    record_id: str,
    patch: dict[str, Any],
    store_as: str | None = None,
) -> dict[str, Any]:
    step = {
        "id": step_id,
        "kind": "action",
        "action_id": "system.update_record",
        "inputs": {
            "entity_id": entity_id,
            "record_id": record_id,
            "patch": patch,
        },
    }
    if store_as:
        step["store_as"] = store_as
    return step


def completed_opportunity_activity_expr(prefix: str) -> dict[str, Any]:
    return and_(
        exists(f"{prefix}.fields.opportunity_id"),
        exists(f"{prefix}.fields.completed_date"),
        exists("trigger.timestamp"),
        eq_var(f"{prefix}.fields.status", "done"),
    )


def active_opportunity_without_activity_expr(prefix: str) -> dict[str, Any]:
    return and_(
        exists(f"{prefix}.fields.stage"),
        in_var(f"{prefix}.fields.stage", ACTIVE_OPPORTUNITY_STAGES),
        exists(f"{prefix}.fields.owner_user_id"),
        not_exists(f"{prefix}.fields.last_contact_date"),
        not_exists(f"{prefix}.fields.last_activity_at"),
        not_true(f"{prefix}.fields.is_rotting"),
    )


def build_generate_document_automation(
    *,
    name: str,
    description: str,
    source_entity_id: str,
    trigger_action_id: str,
    attachment_field_id: str,
    template_id: str,
    purpose: str,
    status: str,
    filename_conflict_mode: str = "append_version",
) -> dict[str, Any]:
    return {
        "name": name,
        "description": description,
        "status": status,
        "trigger": {
            "kind": "event",
            "event_types": ["action.clicked"],
            "filters": [
                {"path": "action_id", "op": "eq", "value": trigger_action_id},
                {"path": "source_entity_id", "op": "eq", "value": source_entity_id},
            ],
            "expr": exists("trigger.source_record_id"),
        },
        "steps": [
            {
                "id": "generate_document",
                "kind": "action",
                "action_id": "system.generate_document",
                "inputs": {
                    "template_id": template_id,
                    "entity_id": "entity.biz_document",
                    "record_id": "{{ trigger.record_id }}",
                    "source_entity_id": source_entity_id,
                    "source_record_id": "{{ trigger.source_record_id }}",
                    "source_field_id": attachment_field_id,
                    "filename_conflict_mode": filename_conflict_mode,
                    "purpose": purpose,
                    "wait_for_completion": True,
                    "actor_user_id": "{{ trigger.user_id }}",
                },
            }
        ],
    }


def list_document_templates(base_url: str, *, token: str, workspace_id: str) -> list[dict[str, Any]]:
    status, payload = api_call(
        "GET",
        f"{base_url}/documents/templates",
        token=token,
        workspace_id=workspace_id,
        timeout=120,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"list document templates failed: {collect_error_text(payload)}")
    rows = payload.get("templates")
    return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []


def resolve_template_id_by_name(
    base_url: str,
    *,
    token: str,
    workspace_id: str,
    name: str,
) -> str | None:
    needle = name.strip().lower()
    if not needle:
        return None
    for template in list_document_templates(base_url, token=token, workspace_id=workspace_id):
        if str(template.get("name") or "").strip().lower() != needle:
            continue
        template_id = template.get("id")
        return template_id if isinstance(template_id, str) and template_id.strip() else None
    return None


def build_send_record_email_automation(
    *,
    name: str,
    description: str,
    source_entity_id: str,
    trigger_action_id: str,
    recipient_lookup_field_id: str,
    attachment_field_id: str,
    subject: str,
    body_html: str,
    status: str,
    email_template_id: str | None = None,
) -> dict[str, Any]:
    inputs: dict[str, Any] = {
        "entity_id": source_entity_id,
        "record_id": "{{ trigger.record_id }}",
        "to_lookup_field_ids": [recipient_lookup_field_id],
        "attachment_field_id": attachment_field_id,
    }
    if isinstance(email_template_id, str) and email_template_id.strip():
        inputs["template_id"] = email_template_id.strip()
    else:
        inputs["subject"] = subject
        inputs["body_html"] = body_html
        inputs["body_text"] = "Please find the attached document."
    return {
        "name": name,
        "description": description,
        "status": status,
        "trigger": {
            "kind": "event",
            "event_types": ["action.clicked"],
            "filters": [
                {"path": "entity_id", "op": "eq", "value": source_entity_id},
                {"path": "action_id", "op": "eq", "value": trigger_action_id},
            ],
            "expr": and_(
                exists("trigger.record.fields.primary_document_id"),
                exists("trigger.record.fields.generated_files"),
            ),
        },
        "steps": [
            {
                "id": "send_document_email",
                "kind": "action",
                "action_id": "system.send_email",
                "ui": {
                    "mode": "compose_before_send",
                    "required_attachments": True,
                    "allow_optional_attachments": True,
                    "allow_edit_body": True,
                },
                "inputs": inputs,
            },
            {
                "id": "mark_primary_document_sent",
                "kind": "action",
                "action_id": "system.update_record",
                "inputs": {
                    "entity_id": "entity.biz_document",
                    "record_id": "{{ trigger.record.fields.primary_document_id }}",
                    "patch": {
                        "biz_document.status": "sent"
                    }
                },
            },
        ],
    }


def build_sync_primary_product_supplier_automation(*, status: str) -> dict[str, Any]:
    return {
        "name": "Commercial - Sync Primary Product Supplier Defaults",
        "description": "When an active primary supplier row changes, sync the parent product purchasing defaults used by quotes and purchasing.",
        "status": status,
        "trigger": {
            "kind": "event",
            "event_types": ["record.created", "record.updated"],
            "filters": [
                {"path": "entity_id", "op": "eq", "value": "entity.biz_product_supplier"},
            ],
            "expr": and_(
                exists("trigger.record.fields.product_id"),
                exists("trigger.record.fields.supplier_id"),
                eq_var("trigger.record.fields.is_primary", True),
                eq_var("trigger.record.fields.is_active", True),
            ),
        },
        "steps": [
            update_record_step(
                "sync_product_defaults",
                entity_id="entity.biz_product",
                record_id="{{ trigger.record.fields.product_id }}",
                patch={
                    "biz_product.preferred_supplier_id": "{{ trigger.record.fields.supplier_id }}",
                    "biz_product.default_purchase_currency": "{{ trigger.record.fields.purchase_currency }}",
                    "biz_product.default_buy_price": "{{ trigger.record.fields.unit_cost }}",
                    "biz_product.minimum_order_quantity": "{{ trigger.record.fields.minimum_order_quantity }}",
                    "biz_product.lead_time_weeks": "{{ trigger.record.fields.lead_time_weeks }}",
                    "biz_product.supplier_factory_reference": "{{ trigger.record.fields.supplier_sku | default('') }}",
                },
            )
        ],
    }


def build_opportunity_on_hold_follow_up_task_automation(*, status: str) -> dict[str, Any]:
    return {
        "name": "Commercial - Create Opportunity On Hold Follow-Up Task",
        "description": "When an opportunity is placed on hold, create a follow-up task for the owner and link it back to the opportunity.",
        "status": status,
        "trigger": {
            "kind": "event",
            "event_types": ["workflow.status_changed"],
            "filters": [
                {"path": "entity_id", "op": "eq", "value": "entity.crm_opportunity"},
                {"path": "crm_opportunity.stage", "op": "changed_to", "value": "on_hold"},
            ],
            "expr": and_(
                exists("trigger.after.fields.on_hold_reason_code"),
                exists("trigger.after.fields.on_hold_follow_up_date"),
                exists("trigger.after.fields.owner_user_id"),
                exists("trigger.after.fields.last_contact_date"),
                {"op": "not_exists", "left": {"var": "trigger.after.fields.on_hold_follow_up_task_id"}},
            ),
        },
        "steps": [
            {
                "id": "create_on_hold_follow_up_task",
                "kind": "action",
                "action_id": "system.create_record",
                "inputs": {
                    "entity_id": "entity.biz_task",
                    "values": {
                        "biz_task.title": "Follow up on-hold opportunity: {{ trigger.after.fields.title }}",
                        "biz_task.task_type": "follow_up",
                        "biz_task.status": "open",
                        "biz_task.priority": "high",
                        "biz_task.visibility": "team",
                        "biz_task.sales_entity": "{{ trigger.after.fields.sales_entity }}",
                        "biz_task.owner_user_id": "{{ trigger.after.fields.owner_user_id }}",
                        "biz_task.assignee_user_id": "{{ trigger.after.fields.owner_user_id }}",
                        "biz_task.due_date": "{{ trigger.after.fields.on_hold_follow_up_date }}",
                        "biz_task.company_id": "{{ trigger.after.fields.company_id }}",
                        "biz_task.opportunity_id": "{{ trigger.record_id }}",
                        "biz_task.site_id": "{{ trigger.after.fields.site_id }}",
                        "biz_task.description": "Opportunity was placed on hold. Reason: {{ trigger.after.fields.on_hold_reason_code }}. Note: {{ trigger.after.fields.on_hold_reason }}",
                    },
                },
            },
            update_record_step(
                "link_on_hold_follow_up_task",
                entity_id="entity.crm_opportunity",
                record_id="{{ trigger.record_id }}",
                patch={
                    "crm_opportunity.on_hold_follow_up_task_id": "{{ steps.create_on_hold_follow_up_task.record_id }}"
                },
            ),
        ],
    }


def build_stage_gate_exception_approval_task_automation(*, status: str) -> dict[str, Any]:
    return {
        "name": "Commercial - Create Stage Gate Exception Approval Task",
        "description": "When an opportunity mandatory-field exception is requested, create an approval task for the nominated approver.",
        "status": status,
        "trigger": {
            "kind": "event",
            "event_types": ["record.updated"],
            "filters": [
                {"path": "entity_id", "op": "eq", "value": "entity.crm_opportunity"},
                {"path": "crm_opportunity.stage_gate_exception_status", "op": "changed_to", "value": "requested"},
            ],
            "expr": and_(
                exists("trigger.after.fields.stage_gate_exception_approver_user_id"),
                exists("trigger.after.fields.stage_gate_exception_fields"),
                exists("trigger.after.fields.stage_gate_exception_reason"),
            ),
        },
        "steps": [
            {
                "id": "create_gate_exception_approval_task",
                "kind": "action",
                "action_id": "system.create_record",
                "inputs": {
                    "entity_id": "entity.biz_task",
                    "values": {
                        "biz_task.title": "Approve stage-gate exception: {{ trigger.after.fields.title }}",
                        "biz_task.task_type": "internal",
                        "biz_task.status": "open",
                        "biz_task.priority": "high",
                        "biz_task.visibility": "private",
                        "biz_task.sales_entity": "{{ trigger.after.fields.sales_entity }}",
                        "biz_task.owner_user_id": "{{ trigger.after.fields.stage_gate_exception_approver_user_id }}",
                        "biz_task.assignee_user_id": "{{ trigger.after.fields.stage_gate_exception_approver_user_id }}",
                        "biz_task.due_date": "{{ trigger.after.fields.next_activity_date }}",
                        "biz_task.company_id": "{{ trigger.after.fields.company_id }}",
                        "biz_task.opportunity_id": "{{ trigger.record_id }}",
                        "biz_task.description": "Mandatory fields waived: {{ trigger.after.fields.stage_gate_exception_fields }}. Reason: {{ trigger.after.fields.stage_gate_exception_reason }}",
                    },
                },
            }
        ],
    }


def build_sync_opportunity_last_contact_from_activity_automation(*, status: str) -> dict[str, Any]:
    return {
        "name": "Commercial - Sync Opportunity Last Activity From Completed CRM Activity",
        "description": "When an activity linked to an opportunity is completed, refresh the opportunity last contact date and clear the rotting flag.",
        "status": status,
        "trigger": {
            "kind": "event",
            "ui": {
                "show_toast": False,
                "show_progress": False,
            },
            "event_types": ["record.created", "record.updated"],
            "filters": [
                {"path": "entity_id", "op": "eq", "value": "entity.crm_activity"},
            ],
            "expr": or_(
                completed_opportunity_activity_expr("trigger.record"),
                completed_opportunity_activity_expr("trigger.after"),
            ),
        },
        "steps": [
            {
                "id": "fetch_opportunity",
                "kind": "action",
                "action_id": "system.query_records",
                "store_as": "current_opportunity",
                "inputs": {
                    "entity_id": "entity.crm_opportunity",
                    "limit": 1,
                    "filter_expr": {
                        "op": "eq",
                        "field": "id",
                        "value": "{{ trigger.record.fields.opportunity_id }}",
                    },
                },
            },
            {
                "id": "complete_existing_rotting_task",
                "kind": "condition",
                "expr": exists("vars.current_opportunity.first.record.crm_opportunity.rotting_follow_up_task_id"),
                "then_steps": [
                    update_record_step(
                        "mark_rotting_task_done",
                        entity_id="entity.biz_task",
                        record_id="{{ vars.current_opportunity.first.record.crm_opportunity.rotting_follow_up_task_id }}",
                        patch={"biz_task.status": "done"},
                    )
                ],
            },
            update_record_step(
                "update_opportunity_last_contact",
                entity_id="entity.crm_opportunity",
                record_id="{{ trigger.record.fields.opportunity_id }}",
                patch={
                    "crm_opportunity.last_contact_date": "{{ trigger.record.fields.completed_date }}",
                    "crm_opportunity.last_activity_at": "{{ trigger.timestamp }}",
                    "crm_opportunity.is_rotting": False,
                    "crm_opportunity.rotting_follow_up_task_id": None,
                },
            ),
        ],
    }


def build_opportunity_rotting_check_from_activity_automation(*, status: str) -> dict[str, Any]:
    return {
        "name": "Commercial - Check Opportunity Rotting 14 Days After Activity",
        "description": "Fourteen days after a completed opportunity activity, create a follow-up task only if no newer activity has been logged.",
        "status": status,
        "trigger": {
            "kind": "event",
            "ui": {
                "show_toast": False,
                "show_progress": False,
            },
            "coalesce_key": (
                "opportunity_rotting_after_activity:"
                "{{ trigger.record.fields.opportunity_id"
                "|default(trigger.after.fields.opportunity_id, true)"
                "|default(trigger.record_id, true) }}"
            ),
            "event_types": ["record.created", "record.updated"],
            "filters": [
                {"path": "entity_id", "op": "eq", "value": "entity.crm_activity"},
            ],
            "expr": or_(
                completed_opportunity_activity_expr("trigger.record"),
                completed_opportunity_activity_expr("trigger.after"),
            ),
        },
        "steps": [
            {
                "id": "wait_for_activity_window",
                "kind": "delay",
                "seconds": ROTTING_DEAL_DELAY_SECONDS,
            },
            {
                "id": "fetch_opportunity",
                "kind": "action",
                "action_id": "system.query_records",
                "store_as": "current_opportunity",
                "inputs": {
                    "entity_id": "entity.crm_opportunity",
                    "limit": 1,
                    "filter_expr": {
                        "op": "eq",
                        "field": "id",
                        "value": "{{ trigger.record.fields.opportunity_id }}",
                    },
                },
            },
            {
                "id": "still_rotting",
                "kind": "condition",
                "expr": and_(
                    exists("vars.current_opportunity.first.record.crm_opportunity.stage"),
                    in_var("vars.current_opportunity.first.record.crm_opportunity.stage", ACTIVE_OPPORTUNITY_STAGES),
                    exists("vars.current_opportunity.first.record.crm_opportunity.last_activity_at"),
                    eq_vars(
                        "vars.current_opportunity.first.record.crm_opportunity.last_activity_at",
                        "trigger.timestamp",
                    ),
                    not_true("vars.current_opportunity.first.record.crm_opportunity.is_rotting"),
                    not_exists("vars.current_opportunity.first.record.crm_opportunity.rotting_follow_up_task_id"),
                ),
                "stop_on_false": True,
            },
            {
                "id": "create_rotting_follow_up_task",
                "kind": "action",
                "action_id": "system.create_record",
                "inputs": {
                    "entity_id": "entity.biz_task",
                    "values": {
                        "biz_task.title": "Follow up inactive opportunity: {{ vars.current_opportunity.first.record.crm_opportunity.title }}",
                        "biz_task.task_type": "follow_up",
                        "biz_task.status": "open",
                        "biz_task.priority": "high",
                        "biz_task.visibility": "team",
                        "biz_task.sales_entity": "{{ vars.current_opportunity.first.record.crm_opportunity.sales_entity }}",
                        "biz_task.owner_user_id": "{{ vars.current_opportunity.first.record.crm_opportunity.owner_user_id }}",
                        "biz_task.assignee_user_id": "{{ vars.current_opportunity.first.record.crm_opportunity.owner_user_id }}",
                        "biz_task.company_id": "{{ vars.current_opportunity.first.record.crm_opportunity.company_id }}",
                        "biz_task.opportunity_id": "{{ trigger.record.fields.opportunity_id }}",
                        "biz_task.site_id": "{{ vars.current_opportunity.first.record.crm_opportunity.site_id }}",
                        "biz_task.description": "No logged opportunity activity for 14 days since {{ trigger.record.fields.completed_date }}.",
                    },
                },
            },
            update_record_step(
                "mark_opportunity_rotting",
                entity_id="entity.crm_opportunity",
                record_id="{{ trigger.record.fields.opportunity_id }}",
                patch={
                    "crm_opportunity.is_rotting": True,
                    "crm_opportunity.rotting_follow_up_task_id": "{{ steps.create_rotting_follow_up_task.record_id }}",
                },
            ),
        ],
    }


def build_opportunity_rotting_check_without_activity_automation(*, status: str) -> dict[str, Any]:
    return {
        "name": "Commercial - Check Opportunity Rotting 14 Days Without Activity",
        "description": "Fourteen days after an active opportunity is created or updated without a logged contact date, create a follow-up task if it is still inactive.",
        "status": status,
        "trigger": {
            "kind": "event",
            "ui": {
                "show_toast": False,
                "show_progress": False,
            },
            "coalesce_key": "opportunity_rotting_without_activity:{{ trigger.record_id }}",
            "event_types": ["record.created", "record.updated"],
            "filters": [
                {"path": "entity_id", "op": "eq", "value": "entity.crm_opportunity"},
            ],
            "expr": or_(
                active_opportunity_without_activity_expr("trigger.record"),
                active_opportunity_without_activity_expr("trigger.after"),
            ),
        },
        "steps": [
            {
                "id": "wait_for_initial_activity_window",
                "kind": "delay",
                "seconds": ROTTING_DEAL_DELAY_SECONDS,
            },
            {
                "id": "fetch_opportunity",
                "kind": "action",
                "action_id": "system.query_records",
                "store_as": "current_opportunity",
                "inputs": {
                    "entity_id": "entity.crm_opportunity",
                    "limit": 1,
                    "filter_expr": {
                        "op": "eq",
                        "field": "id",
                        "value": "{{ trigger.record_id }}",
                    },
                },
            },
            {
                "id": "still_has_no_activity",
                "kind": "condition",
                "expr": and_(
                    exists("vars.current_opportunity.first.record.crm_opportunity.stage"),
                    in_var("vars.current_opportunity.first.record.crm_opportunity.stage", ACTIVE_OPPORTUNITY_STAGES),
                    exists("vars.current_opportunity.first.record.crm_opportunity.owner_user_id"),
                    not_exists("vars.current_opportunity.first.record.crm_opportunity.last_contact_date"),
                    not_exists("vars.current_opportunity.first.record.crm_opportunity.last_activity_at"),
                    not_true("vars.current_opportunity.first.record.crm_opportunity.is_rotting"),
                    not_exists("vars.current_opportunity.first.record.crm_opportunity.rotting_follow_up_task_id"),
                ),
                "stop_on_false": True,
            },
            {
                "id": "create_rotting_follow_up_task",
                "kind": "action",
                "action_id": "system.create_record",
                "inputs": {
                    "entity_id": "entity.biz_task",
                    "values": {
                        "biz_task.title": "Follow up inactive opportunity: {{ vars.current_opportunity.first.record.crm_opportunity.title }}",
                        "biz_task.task_type": "follow_up",
                        "biz_task.status": "open",
                        "biz_task.priority": "high",
                        "biz_task.visibility": "team",
                        "biz_task.sales_entity": "{{ vars.current_opportunity.first.record.crm_opportunity.sales_entity }}",
                        "biz_task.owner_user_id": "{{ vars.current_opportunity.first.record.crm_opportunity.owner_user_id }}",
                        "biz_task.assignee_user_id": "{{ vars.current_opportunity.first.record.crm_opportunity.owner_user_id }}",
                        "biz_task.company_id": "{{ vars.current_opportunity.first.record.crm_opportunity.company_id }}",
                        "biz_task.opportunity_id": "{{ trigger.record_id }}",
                        "biz_task.site_id": "{{ vars.current_opportunity.first.record.crm_opportunity.site_id }}",
                        "biz_task.description": "No logged opportunity activity for 14 days.",
                    },
                },
            },
            update_record_step(
                "mark_opportunity_rotting",
                entity_id="entity.crm_opportunity",
                record_id="{{ trigger.record_id }}",
                patch={
                    "crm_opportunity.is_rotting": True,
                    "crm_opportunity.rotting_follow_up_task_id": "{{ steps.create_rotting_follow_up_task.record_id }}",
                },
            ),
        ],
    }


def desired_automations(
    *,
    status: str,
    quote_document_template_id: str | None,
    order_document_template_id: str | None,
    purchase_order_document_template_id: str | None,
    invoice_document_template_id: str | None,
    quote_email_template_id: str | None,
    order_email_template_id: str | None,
    purchase_order_email_template_id: str | None,
    invoice_email_template_id: str | None,
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = [
        build_sync_primary_product_supplier_automation(status=status),
        build_opportunity_on_hold_follow_up_task_automation(status=status),
        build_stage_gate_exception_approval_task_automation(status=status),
        build_sync_opportunity_last_contact_from_activity_automation(status=status),
        build_opportunity_rotting_check_from_activity_automation(status=status),
        build_opportunity_rotting_check_without_activity_automation(status=status),
    ]
    if isinstance(quote_document_template_id, str) and quote_document_template_id.strip():
        items.append(
            build_generate_document_automation(
                name="Commercial - Generate Quote PDF",
                description="Generate the quote PDF when a user clicks Create Document on a quote.",
                source_entity_id="entity.biz_quote",
                trigger_action_id="action.quote_create_document",
                attachment_field_id="biz_quote.generated_files",
                template_id=quote_document_template_id.strip(),
                purpose="quote_pdf",
                status=status,
            )
        )
    if isinstance(order_document_template_id, str) and order_document_template_id.strip():
        items.append(
            build_generate_document_automation(
                name="Commercial - Generate Order Confirmation",
                description="Generate the order confirmation PDF when a user clicks Create Document on a customer order.",
                source_entity_id="entity.biz_order",
                trigger_action_id="action.customer_order_create_document",
                attachment_field_id="biz_order.generated_files",
                template_id=order_document_template_id.strip(),
                purpose="order_confirmation",
                status=status,
            )
        )
    if isinstance(purchase_order_document_template_id, str) and purchase_order_document_template_id.strip():
        items.append(
            build_generate_document_automation(
                name="Commercial - Generate Purchase Order PDF",
                description="Generate the purchase order PDF when a user clicks Create Document on a purchase order.",
                source_entity_id="entity.biz_purchase_order",
                trigger_action_id="action.purchase_order_create_document",
                attachment_field_id="biz_purchase_order.generated_files",
                template_id=purchase_order_document_template_id.strip(),
                purpose="purchase_order_pdf",
                status=status,
            )
        )
    if isinstance(invoice_document_template_id, str) and invoice_document_template_id.strip():
        items.append(
            build_generate_document_automation(
                name="Commercial - Generate Invoice PDF",
                description="Generate the invoice PDF when a user clicks Create Document on an invoice.",
                source_entity_id="entity.biz_invoice",
                trigger_action_id="action.invoice_create_document",
                attachment_field_id="biz_invoice.generated_files",
                template_id=invoice_document_template_id.strip(),
                purpose="invoice_pdf",
                status=status,
            )
        )

    if isinstance(quote_document_template_id, str) and quote_document_template_id.strip():
        items.append(
            build_send_record_email_automation(
                name="Commercial - Send Quote Email",
                description="Send the customer quote email from the quote record once a generated quote PDF exists.",
                source_entity_id="entity.biz_quote",
                trigger_action_id="action.quote_mark_sent",
                recipient_lookup_field_id="biz_quote.customer_id",
                attachment_field_id="biz_quote.generated_files",
                subject="Quote {{ formatted_nested.biz_quote.quote_number }}",
                body_html="<p>Please find the attached quote.</p>",
                status=status,
                email_template_id=quote_email_template_id,
            )
        )
    if isinstance(order_document_template_id, str) and order_document_template_id.strip():
        items.append(
            build_send_record_email_automation(
                name="Commercial - Send Order Confirmation Email",
                description="Send the customer order confirmation email from the order record once a generated confirmation exists.",
                source_entity_id="entity.biz_order",
                trigger_action_id="action.customer_order_send_confirmation",
                recipient_lookup_field_id="biz_order.customer_id",
                attachment_field_id="biz_order.generated_files",
                subject="Order confirmation {{ formatted_nested.biz_order.order_number }}",
                body_html="<p>Please find the attached order confirmation.</p>",
                status=status,
                email_template_id=order_email_template_id,
            )
        )
    if isinstance(purchase_order_document_template_id, str) and purchase_order_document_template_id.strip():
        items.append(
            build_send_record_email_automation(
                name="Commercial - Send Purchase Order Email",
                description="Send the supplier purchase-order email from the purchase order record once a generated PO PDF exists.",
                source_entity_id="entity.biz_purchase_order",
                trigger_action_id="action.purchase_order_mark_sent",
                recipient_lookup_field_id="biz_purchase_order.supplier_id",
                attachment_field_id="biz_purchase_order.generated_files",
                subject="Purchase order {{ formatted_nested.biz_purchase_order.po_number }}",
                body_html="<p>Please find the attached purchase order.</p>",
                status=status,
                email_template_id=purchase_order_email_template_id,
            )
        )
    if isinstance(invoice_document_template_id, str) and invoice_document_template_id.strip():
        items.append(
            build_send_record_email_automation(
                name="Commercial - Send Invoice Email",
                description="Send the customer invoice email from the invoice record once a generated invoice PDF exists.",
                source_entity_id="entity.biz_invoice",
                trigger_action_id="action.invoice_send_email",
                recipient_lookup_field_id="biz_invoice.customer_id",
                attachment_field_id="biz_invoice.generated_files",
                subject="Invoice {{ formatted_nested.biz_invoice.invoice_number }}",
                body_html="<p>Please find the attached invoice.</p>",
                status=status,
                email_template_id=invoice_email_template_id,
            )
        )
    return items


def main() -> None:
    parser = argparse.ArgumentParser(description="Create or update Commercial V2 document-generation and send-email automations.")
    parser.add_argument("--base-url", default=os.getenv("OCTO_BASE_URL", "").strip(), help="Octodrop API base URL")
    parser.add_argument("--token", default=os.getenv("OCTO_API_TOKEN", "").strip(), help="Bearer token")
    parser.add_argument("--workspace-id", default=os.getenv("OCTO_WORKSPACE_ID", "").strip(), help="Workspace ID")
    parser.add_argument("--quote-document-template-id", default=os.getenv("OCTO_QUOTE_DOCUMENT_TEMPLATE_ID", "").strip(), help="Document template id for quote PDFs")
    parser.add_argument("--quote-document-template-name", default=os.getenv("OCTO_QUOTE_DOCUMENT_TEMPLATE_NAME", "Customer Quote Template").strip(), help="Document template name to resolve when --quote-document-template-id is not provided")
    parser.add_argument("--order-document-template-id", default=os.getenv("OCTO_ORDER_DOCUMENT_TEMPLATE_ID", "").strip(), help="Document template id for order confirmations")
    parser.add_argument("--purchase-order-document-template-id", default=os.getenv("OCTO_PURCHASE_ORDER_DOCUMENT_TEMPLATE_ID", "").strip(), help="Document template id for purchase order PDFs")
    parser.add_argument("--invoice-document-template-id", default=os.getenv("OCTO_INVOICE_DOCUMENT_TEMPLATE_ID", "").strip(), help="Document template id for invoice PDFs")
    parser.add_argument("--quote-email-template-id", default=os.getenv("OCTO_QUOTE_EMAIL_TEMPLATE_ID", "").strip(), help="Optional email template id for quote emails")
    parser.add_argument("--order-email-template-id", default=os.getenv("OCTO_ORDER_EMAIL_TEMPLATE_ID", "").strip(), help="Optional email template id for order confirmation emails")
    parser.add_argument("--purchase-order-email-template-id", default=os.getenv("OCTO_PURCHASE_ORDER_EMAIL_TEMPLATE_ID", "").strip(), help="Optional email template id for purchase order emails")
    parser.add_argument("--invoice-email-template-id", default=os.getenv("OCTO_INVOICE_EMAIL_TEMPLATE_ID", "").strip(), help="Optional email template id for invoice emails")
    parser.add_argument("--publish", action="store_true", help="Publish the created or updated automations")
    parser.add_argument("--dry-run", action="store_true", help="Print planned changes without writing")
    args = parser.parse_args()

    base_url = (args.base_url or "").rstrip("/")
    token = (args.token or "").strip()
    workspace_id = (args.workspace_id or "").strip()
    if not base_url:
        raise SystemExit("Missing --base-url or OCTO_BASE_URL")
    if not token:
        raise SystemExit("Missing --token or OCTO_API_TOKEN")
    if not workspace_id:
        raise SystemExit("Missing --workspace-id or OCTO_WORKSPACE_ID")

    quote_document_template_id = args.quote_document_template_id or None
    if not quote_document_template_id and args.quote_document_template_name:
        quote_document_template_id = resolve_template_id_by_name(
            base_url,
            token=token,
            workspace_id=workspace_id,
            name=args.quote_document_template_name,
        )
        if quote_document_template_id:
            print(f"[automation] resolved quote document template '{args.quote_document_template_name}' -> {quote_document_template_id}")
        else:
            print(f"[automation] quote document template '{args.quote_document_template_name}' not found; quote PDF automation skipped")

    automation_status = "published" if args.publish else "draft"
    definitions = desired_automations(
        status=automation_status,
        quote_document_template_id=quote_document_template_id,
        order_document_template_id=args.order_document_template_id or None,
        purchase_order_document_template_id=args.purchase_order_document_template_id or None,
        invoice_document_template_id=args.invoice_document_template_id or None,
        quote_email_template_id=args.quote_email_template_id or None,
        order_email_template_id=args.order_email_template_id or None,
        purchase_order_email_template_id=args.purchase_order_email_template_id or None,
        invoice_email_template_id=args.invoice_email_template_id or None,
    )
    for definition in definitions:
        upsert_automation_by_name(
            base_url,
            definition,
            token=token,
            workspace_id=workspace_id,
            publish=args.publish,
            dry_run=args.dry_run,
        )


if __name__ == "__main__":
    main()
