import json
import os
import sys
import unittest
import uuid
import copy
from pathlib import Path
from unittest.mock import patch

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from fastapi.testclient import TestClient

os.environ["USE_DB"] = "0"
os.environ["OCTO_DISABLE_AUTH"] = "1"
os.environ["SUPABASE_URL"] = "http://localhost"

import app.main as main
from app.manifest_validate import validate_manifest_raw

COMMERCIAL_QUOTES_MANIFEST = json.loads(
    Path(ROOT, "manifests", "commercial_v2", "quotes.json").read_text(encoding="utf-8")
)


def _contacts_manifest(module_id: str) -> dict:
    return {
        "manifest_version": "1.3",
        "module": {"id": module_id, "name": "Contacts"},
        "entities": [
            {
                "id": "entity.contact",
                "label": "Contact",
                "display_field": "contact.name",
                "fields": [
                    {"id": "contact.name", "type": "string", "label": "Name"},
                    {"id": "contact.email", "type": "string", "label": "Email"},
                ],
            }
        ],
        "views": [],
        "pages": [],
        "actions": [],
        "workflows": [],
        "app": {"home": "page:home", "nav": [{"group": "Main", "items": [{"label": "Home", "to": "page:home"}]}]},
    }


def _products_manifest(module_id: str) -> dict:
    return {
        "manifest_version": "1.3",
        "module": {"id": module_id, "name": "Products"},
        "entities": [
            {
                "id": "entity.product",
                "label": "Product",
                "display_field": "product.name",
                "fields": [
                    {"id": "product.name", "type": "string", "label": "Name"},
                    {"id": "product.sku", "type": "string", "label": "SKU"},
                    {"id": "product.uom", "type": "string", "label": "UOM"},
                ],
            }
        ],
        "views": [],
        "pages": [],
        "actions": [],
        "workflows": [],
        "app": {"home": "page:home", "nav": [{"group": "Main", "items": [{"label": "Home", "to": "page:home"}]}]},
    }


def _operations_manifest(module_id: str) -> dict:
    return {
        "manifest_version": "1.3",
        "module": {"id": module_id, "name": "Operations"},
        "entities": [
            {
                "id": "entity.job",
                "label": "Job",
                "display_field": "job.title",
                "fields": [
                    {"id": "job.title", "type": "string", "label": "Title"},
                    {"id": "job.status", "type": "string", "label": "Status"},
                ],
            },
            {
                "id": "entity.job_task",
                "label": "Job Task",
                "display_field": "job_task.title",
                "fields": [
                    {"id": "job_task.title", "type": "string", "label": "Title"},
                    {"id": "job_task.status", "type": "string", "label": "Status"},
                ],
            },
        ],
        "views": [],
        "pages": [],
        "actions": [],
        "workflows": [],
        "app": {"home": "page:home", "nav": [{"group": "Main", "items": [{"label": "Home", "to": "page:home"}]}]},
    }


def _ambiguous_field_manifest(module_id: str) -> dict:
    return {
        "manifest_version": "1.3",
        "module": {"id": module_id, "name": "Projects"},
        "entities": [
            {
                "id": "entity.project",
                "label": "Project",
                "display_field": "project.name",
                "fields": [
                    {"id": "project.name", "type": "string", "label": "Name"},
                    {"id": "project.status", "type": "string", "label": "Status"},
                    {"id": "project.delivery_status", "type": "string", "label": "Status"},
                ],
            }
        ],
        "views": [],
        "pages": [],
        "actions": [],
        "workflows": [],
        "app": {"home": "page:home", "nav": [{"group": "Main", "items": [{"label": "Home", "to": "page:home"}]}]},
    }


def _tabbed_project_manifest(module_id: str) -> dict:
    return {
        "manifest_version": "1.3",
        "module": {"id": module_id, "name": "Projects"},
        "entities": [
            {
                "id": "entity.project",
                "label": "Project",
                "display_field": "project.name",
                "fields": [
                    {"id": "project.name", "type": "string", "label": "Name"},
                    {"id": "project.priority", "type": "string", "label": "Priority"},
                    {"id": "project.notes", "type": "text", "label": "Notes"},
                ],
            }
        ],
        "views": [
            {
                "id": "project.form",
                "entity": "entity.project",
                "kind": "form",
                "header": {
                    "tabs": {
                        "style": "lifted",
                        "default_tab": "overview_tab",
                        "tabs": [
                            {"id": "overview_tab", "label": "Overview", "sections": ["overview"]},
                            {"id": "planning_tab", "label": "Planning", "sections": ["planning"]},
                        ],
                    }
                },
                "sections": [
                    {"id": "overview", "title": "Overview", "fields": ["project.name"]},
                    {"id": "planning", "title": "Planning", "fields": ["project.priority", "project.notes"]},
                ],
            }
        ],
        "pages": [],
        "actions": [],
        "workflows": [],
        "app": {"home": "page:home", "nav": [{"group": "Main", "items": [{"label": "Home", "to": "page:home"}]}]},
    }


def _sectioned_project_manifest(module_id: str) -> dict:
    return {
        "manifest_version": "1.3",
        "module": {"id": module_id, "name": "Projects"},
        "entities": [
            {
                "id": "entity.project",
                "label": "Project",
                "display_field": "project.name",
                "fields": [
                    {"id": "project.name", "type": "string", "label": "Name"},
                    {"id": "project.summary", "type": "text", "label": "Summary"},
                    {"id": "project.owner", "type": "string", "label": "Owner"},
                    {"id": "project.notes", "type": "text", "label": "Notes"},
                ],
            }
        ],
        "views": [
            {
                "id": "project.form",
                "entity": "entity.project",
                "kind": "form",
                "header": {
                    "tabs": {
                        "style": "lifted",
                        "default_tab": "overview_tab",
                        "tabs": [
                            {"id": "overview_tab", "label": "Overview", "sections": ["summary", "people"]},
                            {"id": "planning_tab", "label": "Planning", "sections": ["planning"]},
                        ],
                    }
                },
                "sections": [
                    {"id": "summary", "title": "Summary", "fields": ["project.name", "project.summary"]},
                    {"id": "people", "title": "People", "fields": ["project.owner"]},
                    {"id": "planning", "title": "Planning", "fields": ["project.notes"]},
                ],
            }
        ],
        "pages": [],
        "actions": [],
        "workflows": [],
        "app": {"home": "page:home", "nav": [{"group": "Main", "items": [{"label": "Home", "to": "page:home"}]}]},
    }


def _dispatch_workspace_manifest(module_id: str) -> dict:
    return {
        "manifest_version": "1.3",
        "module": {"id": module_id, "name": "Dispatch"},
        "entities": [
            {
                "id": "entity.dispatch",
                "label": "Dispatch",
                "display_field": "dispatch.title",
                "fields": [
                    {"id": "dispatch.title", "type": "string", "label": "Title"},
                    {"id": "dispatch.status", "type": "string", "label": "Status"},
                    {"id": "dispatch.scheduled_start", "type": "datetime", "label": "Scheduled Start"},
                    {"id": "dispatch.scheduled_end", "type": "datetime", "label": "Scheduled End"},
                ],
            }
        ],
        "views": [
            {
                "id": "dispatch.list",
                "kind": "list",
                "entity": "entity.dispatch",
                "columns": [{"field_id": "dispatch.title"}, {"field_id": "dispatch.status"}],
            },
            {
                "id": "dispatch.kanban",
                "kind": "kanban",
                "entity": "entity.dispatch",
                "card": {"title_field": "dispatch.title", "badge_fields": ["dispatch.status"]},
            },
            {
                "id": "dispatch.calendar",
                "kind": "calendar",
                "entity": "entity.dispatch",
                "calendar": {"title_field": "dispatch.title", "date_start": "dispatch.scheduled_start", "date_end": "dispatch.scheduled_end"},
            },
            {
                "id": "dispatch.form",
                "kind": "form",
                "entity": "entity.dispatch",
                "sections": [{"id": "main", "title": "Dispatch", "fields": ["dispatch.title", "dispatch.status"]}],
            },
        ],
        "pages": [
            {
                "id": "dispatch.control_page",
                "title": "Dispatch Control",
                "layout": "single",
                "content": [
                    {
                        "kind": "container",
                        "variant": "card",
                        "content": [
                            {
                                "kind": "view_modes",
                                "entity_id": "entity.dispatch",
                                "default_mode": "kanban",
                                "modes": [
                                    {"mode": "kanban", "target": "view:dispatch.kanban"},
                                    {"mode": "list", "target": "view:dispatch.list"},
                                    {"mode": "calendar", "target": "view:dispatch.calendar"},
                                ],
                            }
                        ],
                    }
                ],
            },
            {
                "id": "dispatch.calendar_page",
                "title": "Dispatch Calendar",
                "layout": "single",
                "content": [{"kind": "view", "target": "view:dispatch.calendar"}],
            },
            {
                "id": "dispatch.form_page",
                "title": "Dispatch Record",
                "layout": "single",
                "content": [{"kind": "record", "entity_id": "entity.dispatch", "view_id": "dispatch.form"}],
            },
        ],
        "actions": [],
        "workflows": [],
        "app": {"home": "page:dispatch.control_page", "nav": [{"group": "Main", "items": [{"label": "Home", "to": "page:dispatch.control_page"}]}]},
    }


def _sales_quotes_manifest(module_id: str) -> dict:
    return {
        "manifest_version": "1.3",
        "module": {"id": module_id, "key": module_id, "name": "Sales Quotes", "version": "0.1.0"},
        "app": {
            "home": "page:sales_quote.list_page",
            "nav": [
                {
                    "group": "Sales",
                    "items": [
                        {
                            "label": "Quotes",
                            "menu_label_key": "sales_quotes.nav.quotes",
                            "to": "page:sales_quote.list_page",
                        }
                    ],
                }
            ],
        },
        "entities": [
            {
                "id": "entity.sales_quote",
                "label": "Sales Quote",
                "display_field": "sales_quote.number",
                "fields": [
                    {"id": "sales_quote.number", "type": "string", "label": "Quote Number", "label_key": "sales_quotes.entities.sales_quote.fields.number.label", "required": True},
                    {
                        "id": "sales_quote.customer_id",
                        "type": "lookup",
                        "label": "Customer",
                        "label_key": "sales_quotes.entities.sales_quote.fields.customer_id.label",
                        "entity": "entity.contact",
                        "display_field": "contact.name",
                        "required": True,
                    },
                    {
                        "id": "sales_quote.status",
                        "type": "enum",
                        "label": "Status",
                        "label_key": "sales_quotes.entities.sales_quote.fields.status.label",
                        "default": "draft",
                        "options": [
                            {"value": "draft", "label": "Draft", "label_key": "sales_quotes.entities.sales_quote.fields.status.options.draft", "status_label_key": "sales_quotes.entities.sales_quote.fields.status.options.draft"},
                            {"value": "sent", "label": "Sent", "label_key": "sales_quotes.entities.sales_quote.fields.status.options.sent", "status_label_key": "sales_quotes.entities.sales_quote.fields.status.options.sent"},
                            {"value": "accepted", "label": "Accepted", "label_key": "sales_quotes.entities.sales_quote.fields.status.options.accepted", "status_label_key": "sales_quotes.entities.sales_quote.fields.status.options.accepted"},
                        ],
                    },
                    {"id": "sales_quote.quote_date", "type": "date", "label": "Quote Date", "label_key": "sales_quotes.entities.sales_quote.fields.quote_date.label"},
                    {"id": "sales_quote.currency", "type": "string", "label": "Currency", "label_key": "sales_quotes.entities.sales_quote.fields.currency.label", "default": "NZD"},
                    {"id": "sales_quote.notes", "type": "text", "label": "Notes", "label_key": "sales_quotes.entities.sales_quote.fields.notes.label"},
                ],
            },
            {
                "id": "entity.sales_quote_line",
                "label": "Quote Line",
                "display_field": "sales_quote_line.description",
                "fields": [
                    {
                        "id": "sales_quote_line.sales_quote_id",
                        "type": "lookup",
                        "label": "Quote",
                        "label_key": "sales_quotes.entities.sales_quote_line.fields.sales_quote_id.label",
                        "entity": "entity.sales_quote",
                        "display_field": "sales_quote.number",
                        "required": True,
                    },
                    {
                        "id": "sales_quote_line.product_id",
                        "type": "lookup",
                        "label": "Product",
                        "label_key": "sales_quotes.entities.sales_quote_line.fields.product_id.label",
                        "entity": "entity.product",
                        "display_field": "product.name",
                    },
                    {"id": "sales_quote_line.description", "type": "string", "label": "Description", "label_key": "sales_quotes.entities.sales_quote_line.fields.description.label"},
                    {
                        "id": "sales_quote_line.qty",
                        "type": "number",
                        "label": "Qty",
                        "label_key": "sales_quotes.entities.sales_quote_line.fields.qty.label",
                        "default": 1,
                        "format": {"kind": "measurement", "unit_field": "sales_quote_line.uom", "precision": 2},
                    },
                    {"id": "sales_quote_line.uom", "type": "string", "label": "UOM", "label_key": "sales_quotes.entities.sales_quote_line.fields.uom.label", "default": "ea"},
                    {
                        "id": "sales_quote_line.unit_price",
                        "type": "number",
                        "label": "Unit Price",
                        "label_key": "sales_quotes.entities.sales_quote_line.fields.unit_price.label",
                        "default": 0,
                        "format": {"kind": "currency", "currency_code": "NZD", "precision": 2},
                    },
                    {
                        "id": "sales_quote_line.line_total",
                        "type": "number",
                        "label": "Line Total",
                        "label_key": "sales_quotes.entities.sales_quote_line.fields.line_total.label",
                        "readonly": True,
                        "format": {"kind": "currency", "currency_code": "NZD", "precision": 2},
                        "compute": {
                            "expression": {
                                "op": "round",
                                "args": [
                                    {
                                        "op": "mul",
                                        "args": [
                                            {"ref": "$current.sales_quote_line.qty"},
                                            {"ref": "$current.sales_quote_line.unit_price"},
                                        ],
                                    },
                                    2,
                                ],
                            }
                        },
                    },
                ],
            },
        ],
        "views": [
            {
                "id": "sales_quote.list",
                "kind": "list",
                "entity": "entity.sales_quote",
                "columns": [
                    {"field_id": "sales_quote.number"},
                    {"field_id": "sales_quote.customer_id"},
                    {"field_id": "sales_quote.status"},
                    {"field_id": "sales_quote.quote_date"},
                ],
            },
            {
                "id": "sales_quote.form",
                "kind": "form",
                "entity": "entity.sales_quote",
                "sections": [
                    {
                        "id": "summary",
                        "title": "Summary",
                        "fields": [
                            "sales_quote.number",
                            "sales_quote.customer_id",
                            "sales_quote.status",
                            "sales_quote.quote_date",
                            "sales_quote.currency",
                            "sales_quote.notes",
                        ],
                    }
                ],
                "header": {
                    "statusbar": {"field_id": "sales_quote.status"},
                    "secondary_actions": [
                        {
                            "action_id": "action.sales_quote_mark_sent",
                            "label_key": "sales_quotes.actions.mark_sent",
                        }
                    ],
                },
            },
            {
                "id": "sales_quote_line.list",
                "kind": "list",
                "entity": "entity.sales_quote_line",
                "columns": [
                    {"field_id": "sales_quote_line.product_id"},
                    {"field_id": "sales_quote_line.description"},
                    {"field_id": "sales_quote_line.qty"},
                    {"field_id": "sales_quote_line.unit_price"},
                    {"field_id": "sales_quote_line.line_total"},
                ],
            },
        ],
        "pages": [
            {
                "id": "sales_quote.list_page",
                "title": "Quotes",
                "title_key": "sales_quotes.pages.list.title",
                "layout": "single",
                "content": [
                    {
                        "kind": "container",
                        "variant": "card",
                        "title_key": "sales_quotes.pages.list.container.title",
                        "content": [{"kind": "view", "target": "view:sales_quote.list"}],
                    }
                ],
            },
            {
                "id": "sales_quote.form_page",
                "title": "Quote",
                "title_key": "sales_quotes.pages.form.title",
                "layout": "single",
                "content": [
                    {
                        "kind": "record",
                        "entity_id": "entity.sales_quote",
                        "record_id_query": "id",
                        "content": [
                            {
                                "kind": "tabs",
                                "default_tab": "details",
                                "tabs": [
                                    {
                                        "id": "details",
                                        "label": "Details",
                                        "tab_label_key": "sales_quotes.pages.form.tabs.details",
                                        "content": [{"kind": "view", "target": "view:sales_quote.form"}],
                                    },
                                    {
                                        "id": "line_items",
                                        "label": "Line Items",
                                        "tab_label_key": "sales_quotes.pages.form.tabs.line_items",
                                        "content": [
                                            {
                                                "kind": "related_list",
                                                "entity_id": "entity.sales_quote_line",
                                                "view": "sales_quote_line.list",
                                                "record_domain": {
                                                    "op": "eq",
                                                    "field": "sales_quote_line.sales_quote_id",
                                                    "value": {"ref": "$record.id"},
                                                },
                                            }
                                        ],
                                    },
                                ],
                            }
                        ],
                    }
                ],
            },
        ],
        "actions": [
            {
                "id": "action.sales_quote_mark_sent",
                "kind": "update_record",
                "entity_id": "entity.sales_quote",
                "label": "Mark Sent",
                "action_label_key": "sales_quotes.actions.mark_sent",
                "patch": {"sales_quote.status": "sent"},
                "enabled_when": {"op": "eq", "field": "sales_quote.status", "value": "draft"},
            }
        ],
        "workflows": [
            {
                "id": "workflow.sales_quote_status",
                "entity": "entity.sales_quote",
                "status_field": "sales_quote.status",
                "states": [
                    {"id": "draft", "label": "Draft", "label_key": "sales_quotes.workflows.status.states.draft", "status_label_key": "sales_quotes.workflows.status.states.draft"},
                    {"id": "sent", "label": "Sent", "label_key": "sales_quotes.workflows.status.states.sent", "status_label_key": "sales_quotes.workflows.status.states.sent"},
                    {"id": "accepted", "label": "Accepted", "label_key": "sales_quotes.workflows.status.states.accepted", "status_label_key": "sales_quotes.workflows.status.states.accepted"},
                ],
                "transitions": [
                    {"from": "draft", "to": "sent", "label": "Mark Sent", "label_key": "sales_quotes.workflows.status.transitions.sent"},
                    {"from": "sent", "to": "accepted", "label": "Accept Quote", "label_key": "sales_quotes.workflows.status.transitions.accepted"},
                ],
            }
        ],
        "relations": [
            {"from": "entity.sales_quote", "to": "entity.sales_quote_line", "label_field": "sales_quote_line.description"}
        ],
    }


def _service_requests_manifest(module_id: str) -> dict:
    return {
        "manifest_version": "1.3",
        "module": {"id": module_id, "key": module_id, "name": "Service Requests", "version": "0.1.0"},
        "app": {
            "home": "page:service_request.list_page",
            "nav": [
                {
                    "group": "Operations",
                    "items": [
                        {
                            "label": "Service Requests",
                            "menu_label_key": "service_requests.nav.requests",
                            "to": "page:service_request.list_page",
                        }
                    ],
                }
            ],
        },
        "entities": [
            {
                "id": "entity.service_request",
                "label": "Service Request",
                "display_field": "service_request.title",
                "fields": [
                    {"id": "service_request.title", "type": "string", "label": "Title", "label_key": "service_requests.entities.service_request.fields.title.label", "required": True},
                    {
                        "id": "service_request.status",
                        "type": "enum",
                        "label": "Status",
                        "label_key": "service_requests.entities.service_request.fields.status.label",
                        "default": "draft",
                        "options": [
                            {
                                "value": "draft",
                                "label": "Draft",
                                "label_key": "service_requests.entities.service_request.fields.status.options.draft",
                                "status_label_key": "service_requests.entities.service_request.fields.status.options.draft",
                            },
                            {
                                "value": "approved",
                                "label": "Approved",
                                "label_key": "service_requests.entities.service_request.fields.status.options.approved",
                                "status_label_key": "service_requests.entities.service_request.fields.status.options.approved",
                            },
                            {
                                "value": "cancelled",
                                "label": "Cancelled",
                                "label_key": "service_requests.entities.service_request.fields.status.options.cancelled",
                                "status_label_key": "service_requests.entities.service_request.fields.status.options.cancelled",
                            },
                        ],
                    },
                    {"id": "service_request.owner_user_id", "type": "user", "label": "Owner", "label_key": "service_requests.entities.service_request.fields.owner_user_id.label"},
                    {"id": "service_request.priority", "type": "string", "label": "Priority", "label_key": "service_requests.entities.service_request.fields.priority.label"},
                    {"id": "service_request.attachments", "type": "attachments", "label": "Attachments", "label_key": "service_requests.entities.service_request.fields.attachments.label"},
                    {"id": "service_request.scheduled_start", "type": "datetime", "label": "Scheduled Start", "label_key": "service_requests.entities.service_request.fields.scheduled_start.label"},
                    {"id": "service_request.scheduled_end", "type": "datetime", "label": "Scheduled End", "label_key": "service_requests.entities.service_request.fields.scheduled_end.label"},
                    {"id": "service_request.cancel_reason", "type": "text", "label": "Cancel Reason", "label_key": "service_requests.entities.service_request.fields.cancel_reason.label"},
                    {"id": "service_request.job_id", "type": "string", "label": "Job ID", "label_key": "service_requests.entities.service_request.fields.job_id.label"},
                    {"id": "service_request.created_at", "type": "datetime", "label": "Created At", "label_key": "service_requests.entities.service_request.fields.created_at.label"},
                ],
            }
        ],
        "views": [
            {
                "id": "service_request.list",
                "kind": "list",
                "entity": "entity.service_request",
                "columns": [
                    {"field_id": "service_request.title"},
                    {"field_id": "service_request.status"},
                    {"field_id": "service_request.owner_user_id"},
                    {"field_id": "service_request.scheduled_start"},
                ],
                "header": {
                    "filters": [
                        {
                            "id": "approved_only",
                            "label": "Approved",
                            "label_key": "service_requests.views.list.filters.approved.label",
                            "domain": {"op": "eq", "field": "service_request.status", "value": "approved"},
                        }
                    ]
                },
            },
            {
                "id": "service_request.form",
                "kind": "form",
                "entity": "entity.service_request",
                "sections": [
                    {
                        "id": "summary",
                        "title": "Summary",
                        "fields": [
                            "service_request.title",
                            "service_request.status",
                            "service_request.owner_user_id",
                            "service_request.priority",
                        ],
                    },
                    {
                        "id": "schedule",
                        "title": "Schedule",
                        "fields": [
                            "service_request.scheduled_start",
                            "service_request.scheduled_end",
                            "service_request.attachments",
                            "service_request.cancel_reason",
                        ],
                    },
                ],
                "header": {
                    "secondary_actions": [
                        {
                            "action_id": "action.service_request_set_approved",
                            "label_key": "service_requests.actions.approve",
                        },
                        {
                            "action_id": "action.service_request_set_cancelled",
                            "label_key": "service_requests.actions.cancel",
                        },
                        {
                            "action_id": "action.service_request_convert_to_job",
                            "label_key": "service_requests.actions.convert_to_job",
                        }
                    ]
                },
            },
        ],
        "pages": [
            {
                "id": "service_request.list_page",
                "title": "Service Requests",
                "title_key": "service_requests.pages.list_page.title",
                "layout": "single",
                "content": [
                    {
                        "kind": "container",
                        "variant": "card",
                        "title_key": "service_requests.pages.list_page.container.title",
                        "content": [
                            {
                                "kind": "view",
                                "target": "view:service_request.list",
                            }
                        ],
                    }
                ],
            },
            {
                "id": "service_request.form_page",
                "title": "Service Request",
                "title_key": "service_requests.pages.form_page.title",
                "layout": "single",
                "content": [
                    {
                        "kind": "record",
                        "entity_id": "entity.service_request",
                        "record_id_query": "id",
                        "content": [
                            {
                                "kind": "grid",
                                "columns": 12,
                                "items": [
                                    {
                                        "span": 8,
                                        "content": [
                                            {"kind": "view", "target": "view:service_request.form"}
                                        ],
                                    },
                                    {
                                        "span": 4,
                                        "content": [
                                            {
                                                "kind": "chatter",
                                                "entity_id": "entity.service_request",
                                                "record_ref": "$record.id",
                                            }
                                        ],
                                    },
                                ],
                            }
                        ],
                    }
                ],
            },
        ],
        "actions": [
            {
                "id": "action.service_request_set_approved",
                "kind": "update_record",
                "entity_id": "entity.service_request",
                "label": "Approve",
                "action_label_key": "service_requests.actions.approve",
                "patch": {"service_request.status": "approved"},
                "enabled_when": {"op": "eq", "field": "service_request.status", "value": "draft"},
            },
            {
                "id": "action.service_request_set_cancelled",
                "kind": "update_record",
                "entity_id": "entity.service_request",
                "label": "Cancel",
                "action_label_key": "service_requests.actions.cancel",
                "patch": {"service_request.status": "cancelled"},
                "enabled_when": {"op": "neq", "field": "service_request.status", "value": "cancelled"},
            },
            {
                "id": "action.service_request_convert_to_job",
                "kind": "transform_record",
                "entity_id": "entity.service_request",
                "label": "Create Job",
                "action_label_key": "service_requests.actions.convert_to_job",
                "transformation_key": "service_request_to_job",
                "enabled_when": {"op": "eq", "field": "service_request.status", "value": "approved"},
            }
        ],
        "workflows": [
            {
                "id": "workflow.service_request_status",
                "entity": "entity.service_request",
                "status_field": "service_request.status",
                "states": [
                    {
                        "id": "draft",
                        "label": "Draft",
                        "label_key": "service_requests.workflows.status.states.draft",
                        "status_label_key": "service_requests.workflows.status.states.draft",
                    },
                    {
                        "id": "approved",
                        "label": "Approved",
                        "label_key": "service_requests.workflows.status.states.approved",
                        "status_label_key": "service_requests.workflows.status.states.approved",
                    },
                    {
                        "id": "cancelled",
                        "label": "Cancelled",
                        "label_key": "service_requests.workflows.status.states.cancelled",
                        "status_label_key": "service_requests.workflows.status.states.cancelled",
                    },
                ],
                "transitions": [
                    {
                        "from": "draft",
                        "to": "approved",
                        "label": "Approve",
                        "label_key": "service_requests.workflows.status.transitions.approve",
                    },
                    {
                        "from": "approved",
                        "to": "cancelled",
                        "label": "Cancel",
                        "label_key": "service_requests.workflows.status.transitions.cancel",
                    },
                ],
            }
        ],
        "interfaces": {
            "schedulable": [
                {
                    "entity_id": "entity.service_request",
                    "enabled": True,
                    "scope": "module_and_global",
                    "title_field": "service_request.title",
                    "date_start": "service_request.scheduled_start",
                    "date_end": "service_request.scheduled_end",
                    "owner_field": "service_request.owner_user_id",
                    "status_field": "service_request.status",
                    "color_field": "service_request.priority",
                }
            ],
            "documentable": [
                {
                    "entity_id": "entity.service_request",
                    "enabled": True,
                    "scope": "module_and_global",
                    "attachment_field": "service_request.attachments",
                    "title_field": "service_request.title",
                    "owner_field": "service_request.owner_user_id",
                    "category_field": "service_request.status",
                    "date_field": "service_request.created_at",
                    "record_label_field": "service_request.title",
                    "preview_enabled": True,
                    "allow_delete": False,
                    "allow_download": True,
                }
            ],
            "dashboardable": [
                {
                    "entity_id": "entity.service_request",
                    "enabled": True,
                    "scope": "module_and_global",
                    "date_field": "service_request.created_at",
                    "measures": ["count"],
                    "group_bys": ["service_request.status", "service_request.priority"],
                    "default_widgets": [
                        {
                            "id": "requests_by_status",
                            "type": "group",
                            "title_key": "service_requests.dashboard.requests_by_status.title",
                            "group_by": "service_request.status",
                            "measure": "count",
                        }
                    ],
                    "default_filters": [
                        {"op": "neq", "field": "service_request.status", "value": "cancelled"}
                    ],
                }
            ],
        },
        "transformations": [
            {
                "key": "service_request_to_job",
                "source_entity_id": "entity.service_request",
                "target_entity_id": "entity.job",
                "field_mappings": {
                    "job.title": {"from": "service_request.title"},
                    "job.owner_user_id": {"from": "service_request.owner_user_id"},
                    "job.priority": {"from": "service_request.priority"},
                    "job.start_date": {"from": "service_request.scheduled_start"},
                    "job.status": {"value": "new"},
                },
                "link_fields": {"source_to_target": "service_request.job_id"},
                "source_update": {"patch": {"service_request.status": "approved"}},
                "validation": {
                    "require_source_fields": ["service_request.title", "service_request.scheduled_start"],
                    "prevent_if_target_linked": True,
                    "selected_record_domain": {"op": "eq", "field": "service_request.status", "value": "approved"},
                },
            }
        ],
        "modals": [
            {
                "id": "modal.service_request_cancel",
                "title": "Cancel Request",
                "title_key": "service_requests.modals.cancel.title",
                "entity_id": "entity.service_request",
                "fields": ["service_request.cancel_reason"],
                "actions": [
                    {
                        "kind": "update_record",
                        "entity_id": "entity.service_request",
                        "label": "Cancel Request",
                        "action_label_key": "service_requests.modals.cancel.actions.cancel.label",
                        "patch": {
                            "service_request.status": "cancelled",
                            "service_request.cancel_reason": {"ref": "$record.service_request.cancel_reason"},
                        },
                        "close_on_success": True,
                    },
                    {
                        "kind": "close_modal",
                        "label": "Keep Open",
                        "action_label_key": "service_requests.modals.cancel.actions.close.label",
                        "variant": "ghost",
                    },
                ],
            }
        ],
        "relations": [],
        "queries": {},
    }


def _dispatch_board_manifest(module_id: str) -> dict:
    return {
        "manifest_version": "1.3",
        "module": {"id": module_id, "key": module_id, "name": "Dispatch Board", "version": "0.1.0"},
        "app": {
            "home": "page:dispatch.control_page",
            "nav": [
                {
                    "group": "Operations",
                    "items": [
                        {"label": "Dispatch Control", "menu_label_key": "dispatch.nav.control", "to": "page:dispatch.control_page"},
                        {"label": "Dispatch Calendar", "menu_label_key": "dispatch.nav.calendar", "to": "page:dispatch.calendar_page"},
                    ],
                }
            ],
        },
        "entities": [
            {
                "id": "entity.dispatch",
                "label": "Dispatch",
                "display_field": "dispatch.title",
                "fields": [
                    {"id": "dispatch.title", "type": "string", "label": "Title", "label_key": "dispatch.entities.dispatch.fields.title.label", "required": True},
                    {
                        "id": "dispatch.status",
                        "type": "enum",
                        "label": "Status",
                        "label_key": "dispatch.entities.dispatch.fields.status.label",
                        "default": "planned",
                        "options": [
                            {"value": "planned", "label": "Planned", "label_key": "dispatch.entities.dispatch.fields.status.options.planned", "status_label_key": "dispatch.entities.dispatch.fields.status.options.planned"},
                            {"value": "en_route", "label": "En Route", "label_key": "dispatch.entities.dispatch.fields.status.options.en_route", "status_label_key": "dispatch.entities.dispatch.fields.status.options.en_route"},
                            {"value": "completed", "label": "Completed", "label_key": "dispatch.entities.dispatch.fields.status.options.completed", "status_label_key": "dispatch.entities.dispatch.fields.status.options.completed"},
                        ],
                    },
                    {"id": "dispatch.assignee_id", "type": "user", "label": "Dispatcher", "label_key": "dispatch.entities.dispatch.fields.assignee_id.label"},
                    {"id": "dispatch.priority", "type": "string", "label": "Priority", "label_key": "dispatch.entities.dispatch.fields.priority.label"},
                    {"id": "dispatch.route_name", "type": "string", "label": "Route", "label_key": "dispatch.entities.dispatch.fields.route_name.label"},
                    {"id": "dispatch.scheduled_start", "type": "datetime", "label": "Scheduled Start", "label_key": "dispatch.entities.dispatch.fields.scheduled_start.label"},
                    {"id": "dispatch.scheduled_end", "type": "datetime", "label": "Scheduled End", "label_key": "dispatch.entities.dispatch.fields.scheduled_end.label"},
                    {"id": "dispatch.attachments", "type": "attachments", "label": "Attachments", "label_key": "dispatch.entities.dispatch.fields.attachments.label"},
                    {"id": "dispatch.notes", "type": "text", "label": "Notes", "label_key": "dispatch.entities.dispatch.fields.notes.label"},
                    {"id": "dispatch.created_at", "type": "datetime", "label": "Created At", "label_key": "dispatch.entities.dispatch.fields.created_at.label"},
                ],
            },
            {
                "id": "entity.dispatch_stop",
                "label": "Dispatch Stop",
                "display_field": "dispatch_stop.name",
                "fields": [
                    {"id": "dispatch_stop.dispatch_id", "type": "lookup", "label": "Dispatch", "entity": "entity.dispatch", "display_field": "dispatch.title"},
                    {"id": "dispatch_stop.name", "type": "string", "label": "Stop Name", "label_key": "dispatch.entities.dispatch_stop.fields.name.label"},
                    {"id": "dispatch_stop.sequence", "type": "number", "label": "Sequence", "label_key": "dispatch.entities.dispatch_stop.fields.sequence.label"},
                ],
            },
        ],
        "views": [
            {
                "id": "dispatch.list",
                "kind": "list",
                "entity": "entity.dispatch",
                "columns": [
                    {"field_id": "dispatch.title"},
                    {"field_id": "dispatch.status"},
                    {"field_id": "dispatch.assignee_id"},
                    {"field_id": "dispatch.scheduled_start"},
                ],
                "header": {
                    "filters": [
                        {
                            "id": "planned_only",
                            "label": "Planned",
                            "label_key": "dispatch.views.list.filters.planned.label",
                            "domain": {"op": "eq", "field": "dispatch.status", "value": "planned"},
                        }
                    ]
                },
            },
            {
                "id": "dispatch.kanban",
                "kind": "kanban",
                "entity": "entity.dispatch",
                "card": {
                    "title_field": "dispatch.title",
                    "subtitle_fields": ["dispatch.route_name", "dispatch.scheduled_start"],
                    "badge_fields": ["dispatch.status", "dispatch.priority"],
                },
            },
            {
                "id": "dispatch.graph",
                "kind": "graph",
                "entity": "entity.dispatch",
                "default": {"type": "bar", "group_by": "dispatch.status", "measure": "count"},
            },
            {
                "id": "dispatch.calendar",
                "kind": "calendar",
                "entity": "entity.dispatch",
                "calendar": {
                    "title_field": "dispatch.title",
                    "date_start": "dispatch.scheduled_start",
                    "date_end": "dispatch.scheduled_end",
                    "color_field": "dispatch.assignee_id",
                    "default_scale": "week",
                },
            },
            {
                "id": "dispatch.form",
                "kind": "form",
                "entity": "entity.dispatch",
                "sections": [
                    {"id": "summary", "title": "Summary", "fields": ["dispatch.title", "dispatch.status", "dispatch.assignee_id", "dispatch.priority"]},
                    {"id": "schedule", "title": "Schedule", "fields": ["dispatch.route_name", "dispatch.scheduled_start", "dispatch.scheduled_end", "dispatch.attachments", "dispatch.notes"]},
                ],
                "header": {
                    "statusbar": {"field_id": "dispatch.status"},
                    "tabs": {
                        "style": "lifted",
                        "default_tab": "summary_tab",
                        "tabs": [
                            {"id": "summary_tab", "label": "Summary", "tab_label_key": "dispatch.views.form.tabs.summary", "sections": ["summary"]},
                            {"id": "schedule_tab", "label": "Schedule", "tab_label_key": "dispatch.views.form.tabs.schedule", "sections": ["schedule"]},
                        ],
                    },
                },
                "activity": {
                    "enabled": True,
                    "mode": "tab",
                    "tab_label_key": "dispatch.views.form.activity.tab",
                    "allow_comments": True,
                    "allow_attachments": True,
                    "show_changes": True,
                    "tracked_fields": ["dispatch.status", "dispatch.assignee_id", "dispatch.scheduled_start", "dispatch.scheduled_end"],
                },
            },
            {
                "id": "dispatch_stop.list",
                "kind": "list",
                "entity": "entity.dispatch_stop",
                "columns": [
                    {"field_id": "dispatch_stop.sequence"},
                    {"field_id": "dispatch_stop.name"},
                ],
            },
        ],
        "pages": [
            {
                "id": "dispatch.control_page",
                "title": "Dispatch Control",
                "title_key": "dispatch.pages.control.title",
                "layout": "single",
                "content": [
                    {
                        "kind": "container",
                        "variant": "card",
                        "title_key": "dispatch.pages.control.container.title",
                        "content": [
                            {
                                "kind": "view_modes",
                                "entity_id": "entity.dispatch",
                                "default_mode": "kanban",
                                "modes": [
                                    {"mode": "kanban", "target": "view:dispatch.kanban", "default_group_by": "dispatch.status"},
                                    {"mode": "list", "target": "view:dispatch.list"},
                                    {"mode": "graph", "target": "view:dispatch.graph"},
                                    {"mode": "calendar", "target": "view:dispatch.calendar"},
                                ],
                                "default_filter_id": "planned_only",
                            }
                        ],
                    }
                ],
            },
            {
                "id": "dispatch.calendar_page",
                "title": "Dispatch Calendar",
                "title_key": "dispatch.pages.calendar.title",
                "layout": "single",
                "content": [
                    {
                        "kind": "container",
                        "variant": "card",
                        "title_key": "dispatch.pages.calendar.container.title",
                        "content": [{"kind": "view", "target": "view:dispatch.calendar"}],
                    }
                ],
            },
            {
                "id": "dispatch.form_page",
                "title": "Dispatch",
                "title_key": "dispatch.pages.form.title",
                "layout": "single",
                "content": [
                    {
                        "kind": "record",
                        "entity_id": "entity.dispatch",
                        "record_id_query": "id",
                        "content": [
                            {
                                "kind": "tabs",
                                "default_tab": "details",
                                "tabs": [
                                    {
                                        "id": "details",
                                        "label": "Dispatch",
                                        "tab_label_key": "dispatch.pages.form.tabs.details",
                                        "content": [{"kind": "view", "target": "view:dispatch.form"}],
                                    },
                                    {
                                        "id": "stops",
                                        "label": "Stops",
                                        "tab_label_key": "dispatch.pages.form.tabs.stops",
                                        "content": [
                                            {
                                                "kind": "related_list",
                                                "entity_id": "entity.dispatch_stop",
                                                "view": "dispatch_stop.list",
                                                "record_domain": {"op": "eq", "field": "dispatch_stop.dispatch_id", "value": {"ref": "$record.id"}},
                                            }
                                        ],
                                    },
                                ],
                            }
                        ],
                    }
                ],
            },
        ],
        "actions": [
            {"id": "action.dispatch_set_en_route", "kind": "update_record", "entity_id": "entity.dispatch", "label": "Mark En Route", "action_label_key": "dispatch.actions.set_en_route", "patch": {"dispatch.status": "en_route"}},
            {"id": "action.dispatch_set_completed", "kind": "update_record", "entity_id": "entity.dispatch", "label": "Mark Completed", "action_label_key": "dispatch.actions.set_completed", "patch": {"dispatch.status": "completed"}},
        ],
        "triggers": [
            {"id": "trigger.dispatch_status_changed", "label": "Dispatch Status Changed", "event": "workflow.status_changed", "entity_id": "entity.dispatch", "status_field": "dispatch.status"}
        ],
        "workflows": [
            {
                "id": "workflow.dispatch_status",
                "entity": "entity.dispatch",
                "status_field": "dispatch.status",
                "states": [
                    {"id": "planned", "label": "Planned", "label_key": "dispatch.workflows.status.states.planned", "status_label_key": "dispatch.workflows.status.states.planned"},
                    {"id": "en_route", "label": "En Route", "label_key": "dispatch.workflows.status.states.en_route", "status_label_key": "dispatch.workflows.status.states.en_route"},
                    {"id": "completed", "label": "Completed", "label_key": "dispatch.workflows.status.states.completed", "status_label_key": "dispatch.workflows.status.states.completed"},
                ],
                "transitions": [
                    {"from": "planned", "to": "en_route", "label": "Mark En Route", "label_key": "dispatch.workflows.status.transitions.en_route"},
                    {"from": "en_route", "to": "completed", "label": "Mark Completed", "label_key": "dispatch.workflows.status.transitions.completed"},
                ],
            }
        ],
        "relations": [
            {"from": "entity.dispatch", "to": "entity.dispatch_stop", "label_field": "dispatch_stop.name"}
        ],
        "interfaces": {
            "schedulable": [
                {
                    "entity_id": "entity.dispatch",
                    "enabled": True,
                    "scope": "module_and_global",
                    "title_field": "dispatch.title",
                    "date_start": "dispatch.scheduled_start",
                    "date_end": "dispatch.scheduled_end",
                    "owner_field": "dispatch.assignee_id",
                    "status_field": "dispatch.status",
                    "color_field": "dispatch.assignee_id",
                }
            ],
            "dashboardable": [
                {
                    "entity_id": "entity.dispatch",
                    "enabled": True,
                    "scope": "module_and_global",
                    "date_field": "dispatch.created_at",
                    "measures": ["count"],
                    "group_bys": ["dispatch.status", "dispatch.assignee_id"],
                    "default_widgets": [
                        {
                            "id": "dispatch_by_status",
                            "type": "group",
                            "title_key": "dispatch.dashboard.by_status.title",
                            "group_by": "dispatch.status",
                            "measure": "count",
                        }
                    ],
                }
            ],
        },
        "modals": [],
        "transformations": [],
        "queries": {},
    }


def _jobs_dashboard_manifest(module_id: str) -> dict:
    return {
        "manifest_version": "1.3",
        "module": {"id": module_id, "name": "Jobs"},
        "entities": [
            {
                "id": "entity.job",
                "label": "Job",
                "display_field": "job.title",
                "fields": [
                    {"id": "job.title", "type": "string", "label": "Title"},
                    {"id": "job.total_cost", "type": "currency", "label": "Total Cost"},
                    {"id": "job.labour_hours", "type": "number", "label": "Labour Hours"},
                    {"id": "job.technician_id", "type": "lookup", "label": "Technician", "entity": "entity.technician"},
                ],
            },
            {
                "id": "entity.technician",
                "label": "Technician",
                "display_field": "technician.name",
                "fields": [
                    {"id": "technician.name", "type": "string", "label": "Name"},
                ],
            }
        ],
        "views": [
            {
                "id": "job.list",
                "kind": "list",
                "entity": "entity.job",
                "columns": [{"field_id": "job.title"}],
            },
            {
                "id": "job.graph",
                "kind": "graph",
                "entity": "entity.job",
                "default": {"type": "bar", "group_by": "job.title", "measure": "count"},
            },
            {
                "id": "job.form",
                "kind": "form",
                "entity": "entity.job",
                "sections": [{"id": "main", "title": "Job", "fields": ["job.title", "job.total_cost", "job.labour_hours", "job.technician_id"]}],
            },
        ],
        "pages": [
            {
                "id": "job.dashboard_page",
                "title": "Jobs Dashboard",
                "layout": "single",
                "header": {"variant": "none"},
                "content": [
                    {
                        "kind": "container",
                        "variant": "card",
                        "content": [
                            {
                                "kind": "view_modes",
                                "entity_id": "entity.job",
                                "default_mode": "graph",
                                "modes": [
                                    {"mode": "graph", "target": "view:job.graph"},
                                    {"mode": "list", "target": "view:job.list"},
                                    {"mode": "pivot", "target": "view:job.list"},
                                ],
                            }
                        ],
                    }
                ],
            }
        ],
        "actions": [],
        "workflows": [],
        "app": {"home": "page:job.dashboard_page", "nav": [{"group": "Main", "items": [{"label": "Dashboard", "to": "page:job.dashboard_page"}]}]},
    }


def _fake_builder_response(calls: list[dict]) -> dict:
    content = json.dumps(
        {
            "plan": {"goal": "Build contacts", "steps": ["Ensure entity", "Add pages"]},
            "calls": calls,
            "ops_by_module": [],
            "notes": "ok",
        }
    )
    return {"choices": [{"message": {"content": content}}]}


class TestStudio2AgentSmoke(unittest.TestCase):
    def test_studio2_ai_endpoints_require_superadmin(self) -> None:
        client = TestClient(main.app)
        standard_actor = {
            "user_id": "user-1",
            "email": "member@example.com",
            "role": "member",
            "workspace_role": "member",
            "platform_role": "standard",
            "workspace_id": "default",
            "workspaces": [{"workspace_id": "default", "role": "member", "workspace_name": "Default"}],
            "claims": {},
        }
        calls = [
            ("post", "/studio2/agent/chat", {"module_id": "contacts", "message": "help"}),
            ("post", "/studio2/agent/chat/stream", {"module_id": "contacts", "message": "help"}),
            ("post", "/studio2/agent/plan", {"module_id": "contacts", "message": "help"}),
            ("post", "/studio2/ai/plan", {"module_id": "contacts", "prompt": "help"}),
            ("post", "/studio2/ai/fix_json", {"text": "{\"module\": {}}", "error": {"line": 1, "col": 1}}),
            ("get", "/studio2/agent/status", None),
        ]

        with patch.object(main, "_resolve_actor", lambda _request: standard_actor):
            for method, path, payload in calls:
                if method == "get":
                    res = client.get(path)
                else:
                    res = client.post(path, json=payload)
                self.assertEqual(res.status_code, 403, {"path": path, "body": res.json()})
                body = res.json()
                self.assertFalse(body.get("ok"), {"path": path, "body": body})

    def test_ai_reference_documents_use_current_marketplace_paths(self) -> None:
        docs = main._ai_reference_documents([], {}, "plan a workflow with automation and template guidance")
        paths = {
            str(item.get("path") or "").replace("\\", "/")
            for item in docs
            if isinstance(item, dict)
        }
        self.assertIn("docs/module-authoring/README.md", paths)
        self.assertIn("manifests/marketplace/README.md", paths)
        self.assertIn("manifests/marketplace/docs/LAYOUT_STYLE_GUIDE.md", paths)
        self.assertIn("manifests/marketplace/docs/AUTOMATION_TEMPLATES.md", paths)
        self.assertNotIn("manifests/marketplace_v1/README.md", paths)

    def test_agent_no_tool_calls_when_errors(self) -> None:
        client = TestClient(main.app)
        module_id = f"no_tools_{uuid.uuid4().hex[:6]}"
        res = client.post("/studio2/modules", json={"module_id": module_id, "name": "No Tools"})
        payload = res.json()
        self.assertTrue(payload.get("ok"), payload)

        def fake_openai(_messages, model=None):
            return _fake_builder_response([])

        def fake_validate(manifest, expected_module_id=None):
            return manifest, [{"code": "MANIFEST_VIEW_ENTITY_INVALID", "message": "view entity required", "path": "views[0].entity"}], []

        build_spec = {"goal": "Build jobs", "entities": [{"id": "entity.job"}]}
        with (
            patch.object(main, "_openai_chat_completion", fake_openai),
            patch.object(main, "_openai_configured", lambda: True),
            patch.object(main, "validate_manifest_raw", fake_validate),
        ):
            res = client.post(
                "/studio2/agent/chat",
                json={"module_id": module_id, "message": "build jobs app", "build_spec": build_spec},
            )
        body = res.json()
        self.assertTrue(body.get("ok"), body)
        data = body.get("data") or {}
        self.assertEqual(data.get("stop_reason"), "no_effect")
        errors = (data.get("validation") or {}).get("errors") or []
        self.assertTrue(any(err.get("code") == "AGENT_NO_TOOL_CALLS" for err in errors))

    def test_agent_chat_contacts_smoke(self) -> None:
        client = TestClient(main.app)
        module_id = f"contacts_smoke_{uuid.uuid4().hex[:6]}"
        res = client.post("/studio2/modules", json={"module_id": module_id, "name": "Contacts"})
        payload = res.json()
        self.assertTrue(payload.get("ok"), payload)

        calls = [
            {
                "tool": "ensure_entity",
                "module_id": module_id,
                "entity": {
                    "id": "entity.contact",
                    "label": "Contact",
                    "display_field": "contact.first_name",
                    "fields": [
                        {"id": "contact.first_name", "type": "string", "label": "First Name", "required": True},
                        {"id": "contact.last_name", "type": "string", "label": "Last Name", "required": True},
                        {"id": "contact.email", "type": "string", "label": "Email"},
                        {"id": "contact.type", "type": "enum", "label": "Type", "options": ["lead", "customer"]},
                    ],
                },
            },
            {"tool": "ensure_entity_pages", "module_id": module_id, "entity_id": "entity.contact"},
            {"tool": "ensure_nav", "module_id": module_id},
        ]

        def fake_openai(_messages, model=None):
            return _fake_builder_response(calls)

        build_spec = {"goal": "Build contacts", "entities": [{"id": "entity.contact"}]}
        with patch.object(main, "_openai_chat_completion", fake_openai), patch.object(main, "_openai_configured", lambda: True):
            res = client.post(
                "/studio2/agent/chat",
                json={"module_id": module_id, "message": "build contacts app", "build_spec": build_spec},
            )
        body = res.json()
        self.assertTrue(body.get("ok"), body)
        data = body.get("data") or {}
        self.assertEqual(data.get("stop_reason"), "pass", data)
        self.assertEqual(data.get("ops_by_module"), [])
        draft = data.get("drafts", {}).get(module_id)
        self.assertIsNotNone(draft)
        normalized, errors, _ = validate_manifest_raw(draft, expected_module_id=module_id)
        self.assertEqual(errors, [])
        contact = normalized["entities"][0]
        enum_field = next(f for f in contact["fields"] if f.get("id") == "contact.type")
        self.assertTrue(all(isinstance(opt, dict) for opt in enum_field.get("options", [])))
        page_ids = {page.get("id") for page in (normalized.get("pages") or []) if isinstance(page, dict)}
        self.assertNotIn("home", page_ids)
        nav_items = []
        for group in ((normalized.get("app") or {}).get("nav") or []):
            if isinstance(group, dict):
                nav_items.extend(group.get("items") or [])
        self.assertFalse(any(isinstance(item, dict) and item.get("to") == "page:home" for item in nav_items), nav_items)
        form_view = next(v for v in normalized["views"] if v.get("id") == "contact.form")
        self.assertTrue("statusbar" not in (form_view.get("header") or {}))

    def test_agent_builder_context_includes_reference_contract(self) -> None:
        client = TestClient(main.app)
        module_id = f"ctx_{uuid.uuid4().hex[:6]}"
        res = client.post("/studio2/modules", json={"module_id": module_id, "name": "Contacts"})
        payload = res.json()
        self.assertTrue(payload.get("ok"), payload)

        captured: dict[str, object] = {}
        calls = [
            {
                "tool": "ensure_entity",
                "module_id": module_id,
                "entity": {
                    "id": "entity.contact",
                    "label": "Contact",
                    "display_field": "contact.name",
                    "fields": [{"id": "contact.name", "type": "string", "label": "Name"}],
                },
            }
        ]

        def fake_openai(messages, model=None):
            captured["messages"] = messages
            return _fake_builder_response(calls)

        build_spec = {"goal": "Build contacts", "entities": [{"id": "entity.contact"}]}
        with patch.object(main, "_openai_chat_completion", fake_openai), patch.object(main, "_openai_configured", lambda: True):
            res = client.post(
                "/studio2/agent/chat",
                json={"module_id": module_id, "message": "build contacts app", "build_spec": build_spec},
            )
        body = res.json()
        self.assertTrue(body.get("ok"), body)
        messages = captured.get("messages") or []
        context_messages = [
            item.get("content")
            for item in messages
            if isinstance(item, dict) and isinstance(item.get("content"), str) and item.get("content", "").startswith("context.json")
        ]
        self.assertEqual(len(context_messages), 1)
        context_text = context_messages[0]
        self.assertIn("\"reference_contract\"", context_text)
        self.assertIn("\"authoring_contract\"", context_text)
        self.assertIn("\"entity_ids\"", context_text)
        self.assertIn("\"view_ids\"", context_text)
        self.assertIn("\"workflow_ids\"", context_text)
        self.assertIn("\"legacy_inline_search\":false", context_text)
        self.assertIn("\"domain_heuristics\"", context_text)
        self.assertIn("\"header_line\"", context_text)

    def test_agent_chat_uses_live_draft_text_as_working_manifest(self) -> None:
        client = TestClient(main.app)
        module_id = f"live_draft_{uuid.uuid4().hex[:6]}"
        res = client.post("/studio2/modules", json={"module_id": module_id, "name": "Contacts"})
        payload = res.json()
        self.assertTrue(payload.get("ok"), payload)
        main.drafts.upsert_draft(module_id, _contacts_manifest(module_id), updated_by="test", base_snapshot_id=None)

        live_manifest = copy.deepcopy(_contacts_manifest(module_id))
        contact_entity = next(
            item
            for item in (live_manifest.get("entities") or [])
            if isinstance(item, dict) and item.get("id") == "entity.contact"
        )
        contact_entity["fields"].append({"id": "contact.phone", "type": "string", "label": "Phone"})

        def fake_openai(messages, model=None):
            context_text = next(
                (
                    item.get("content")
                    for item in messages
                    if isinstance(item, dict)
                    and isinstance(item.get("content"), str)
                    and item.get("content", "").startswith("context.json")
                ),
                "",
            )
            if "\"contact.phone\"" not in context_text:
                return _fake_builder_response([])
            return _fake_builder_response(
                [
                    {
                        "tool": "ensure_entity",
                        "module_id": module_id,
                        "entity": {
                            "id": "entity.contact",
                            "label": "Contact",
                            "display_field": "contact.name",
                            "fields": [
                                {"id": "contact.name", "type": "string", "label": "Name"},
                                {"id": "contact.email", "type": "string", "label": "Email"},
                                {"id": "contact.phone", "type": "string", "label": "Mobile"},
                            ],
                        },
                    }
                ]
            )

        with patch.object(main, "_openai_chat_completion", fake_openai), patch.object(main, "_openai_configured", lambda: True):
            res = client.post(
                "/studio2/agent/chat",
                json={
                    "module_id": module_id,
                    "message": "Rename the phone field to Mobile",
                    "draft_text": json.dumps(live_manifest),
                    "build_spec": {"goal": "Adjust contacts", "entities": [{"id": "entity.contact"}]},
                },
            )
        body = res.json()
        self.assertTrue(body.get("ok"), body)
        data = body.get("data") or {}
        self.assertEqual(data.get("stop_reason"), "pass", data)
        draft = data.get("drafts", {}).get(module_id)
        self.assertIsNotNone(draft)
        normalized, errors, _warnings = validate_manifest_raw(draft, expected_module_id=module_id)
        self.assertEqual(errors, [])
        entity = next(item for item in (normalized.get("entities") or []) if isinstance(item, dict) and item.get("id") == "entity.contact")
        fields = {field.get("id"): field for field in (entity.get("fields") or []) if isinstance(field, dict)}
        self.assertEqual((fields.get("contact.phone") or {}).get("label"), "Mobile")

    def test_agent_chat_returns_entity_decision_slot_for_ambiguous_module_entity(self) -> None:
        client = TestClient(main.app)
        module_id = f"ops_{uuid.uuid4().hex[:6]}"
        res = client.post("/studio2/modules", json={"module_id": module_id, "name": "Operations"})
        payload = res.json()
        self.assertTrue(payload.get("ok"), payload)
        main.drafts.upsert_draft(module_id, _operations_manifest(module_id), updated_by="test", base_snapshot_id=None)

        with patch.object(main, "_openai_configured", lambda: True):
            res = client.post(
                "/studio2/agent/chat",
                json={"module_id": module_id, "message": "Add a priority field", "build_spec": {"goal": "Extend operations"}},
            )
        body = res.json()
        self.assertTrue(body.get("ok"), body)
        data = body.get("data") or {}
        self.assertEqual(data.get("stop_reason"), "decision_required")
        plan = data.get("plan") or {}
        meta = plan.get("required_question_meta") or {}
        self.assertEqual(meta.get("kind"), "decision_slot")
        self.assertEqual(meta.get("slot_kind"), "studio_entity_choice")
        slots = plan.get("decision_slots") or []
        self.assertTrue(slots, plan)
        values = [item.get("value") for item in (slots[0].get("options") or []) if isinstance(item, dict)]
        self.assertEqual(values, ["entity.job", "entity.job_task"])

    def test_agent_chat_entity_choice_followup_applies_change_to_selected_entity(self) -> None:
        client = TestClient(main.app)
        module_id = f"ops_followup_{uuid.uuid4().hex[:6]}"
        res = client.post("/studio2/modules", json={"module_id": module_id, "name": "Operations"})
        payload = res.json()
        self.assertTrue(payload.get("ok"), payload)
        main.drafts.upsert_draft(module_id, _operations_manifest(module_id), updated_by="test", base_snapshot_id=None)

        def fake_openai(messages, model=None):
            context_text = next(
                (
                    item.get("content")
                    for item in messages
                    if isinstance(item, dict)
                    and isinstance(item.get("content"), str)
                    and item.get("content", "").startswith("context.json")
                ),
                "",
            )
            if "\"selected_entity_id\":\"entity.job_task\"" not in context_text:
                return _fake_builder_response([])
            return _fake_builder_response(
                [
                    {
                        "tool": "ensure_entity",
                        "module_id": module_id,
                        "entity": {
                            "id": "entity.job_task",
                            "label": "Job Task",
                            "display_field": "job_task.title",
                            "fields": [
                                {"id": "job_task.title", "type": "string", "label": "Title"},
                                {"id": "job_task.status", "type": "string", "label": "Status"},
                                {"id": "job_task.priority", "type": "enum", "label": "Priority", "options": ["low", "medium", "high"]},
                            ],
                        },
                    }
                ]
            )

        with patch.object(main, "_openai_chat_completion", fake_openai), patch.object(main, "_openai_configured", lambda: True):
            first = client.post(
                "/studio2/agent/chat",
                json={"module_id": module_id, "message": "Add a priority field", "build_spec": {"goal": "Extend operations"}},
            )
            first_body = first.json()
            self.assertTrue(first_body.get("ok"), first_body)
            first_data = first_body.get("data") or {}
            self.assertEqual(first_data.get("stop_reason"), "decision_required", first_data)

            second = client.post(
                "/studio2/agent/chat",
                json={
                    "module_id": module_id,
                    "message": "Add a priority field",
                    "build_spec": {"goal": "Extend operations"},
                    "hints": {"selected_entity_id": "entity.job_task"},
                },
            )

        second_body = second.json()
        self.assertTrue(second_body.get("ok"), second_body)
        second_data = second_body.get("data") or {}
        self.assertEqual(second_data.get("stop_reason"), "pass", second_data)
        draft = second_data.get("drafts", {}).get(module_id)
        self.assertIsNotNone(draft)
        normalized, errors, _ = validate_manifest_raw(draft, expected_module_id=module_id)
        self.assertEqual(errors, [])
        entities = {entity.get("id"): entity for entity in (normalized.get("entities") or []) if isinstance(entity, dict)}
        job_fields = {field.get("id") for field in (entities["entity.job"].get("fields") or []) if isinstance(field, dict)}
        task_fields = {field.get("id") for field in (entities["entity.job_task"].get("fields") or []) if isinstance(field, dict)}
        self.assertNotIn("job.priority", job_fields)
        self.assertIn("job_task.priority", task_fields)

    def test_agent_chat_returns_field_decision_slot_for_ambiguous_existing_field(self) -> None:
        client = TestClient(main.app)
        module_id = f"proj_{uuid.uuid4().hex[:6]}"
        res = client.post("/studio2/modules", json={"module_id": module_id, "name": "Projects"})
        payload = res.json()
        self.assertTrue(payload.get("ok"), payload)
        main.drafts.upsert_draft(module_id, _ambiguous_field_manifest(module_id), updated_by="test", base_snapshot_id=None)

        with patch.object(main, "_openai_configured", lambda: True):
            res = client.post(
                "/studio2/agent/chat",
                json={
                    "module_id": module_id,
                    "message": "Rename the status field to Lifecycle Stage",
                    "build_spec": {"goal": "Adjust project workflow", "entities": [{"id": "entity.project"}]},
                },
            )
        body = res.json()
        self.assertTrue(body.get("ok"), body)
        data = body.get("data") or {}
        self.assertEqual(data.get("stop_reason"), "decision_required")
        plan = data.get("plan") or {}
        meta = plan.get("required_question_meta") or {}
        self.assertEqual(meta.get("kind"), "decision_slot")
        self.assertEqual(meta.get("slot_kind"), "studio_field_choice")
        slots = plan.get("decision_slots") or []
        self.assertTrue(slots, plan)
        values = [item.get("value") for item in (slots[0].get("options") or []) if isinstance(item, dict)]
        self.assertEqual(values, ["project.status", "project.delivery_status"])

    def test_agent_chat_returns_tab_decision_slot_for_ambiguous_form_tabs(self) -> None:
        client = TestClient(main.app)
        module_id = f"tabbed_{uuid.uuid4().hex[:6]}"
        res = client.post("/studio2/modules", json={"module_id": module_id, "name": "Projects"})
        payload = res.json()
        self.assertTrue(payload.get("ok"), payload)
        main.drafts.upsert_draft(module_id, _tabbed_project_manifest(module_id), updated_by="test", base_snapshot_id=None)

        with patch.object(main, "_openai_configured", lambda: True):
            res = client.post(
                "/studio2/agent/chat",
                json={
                    "module_id": module_id,
                    "message": "Add the budget field to a tab on the project form",
                    "build_spec": {"goal": "Extend projects", "entities": [{"id": "entity.project"}]},
                },
            )
        body = res.json()
        self.assertTrue(body.get("ok"), body)
        data = body.get("data") or {}
        self.assertEqual(data.get("stop_reason"), "decision_required")
        plan = data.get("plan") or {}
        meta = plan.get("required_question_meta") or {}
        self.assertEqual(meta.get("kind"), "decision_slot")
        self.assertEqual(meta.get("slot_kind"), "studio_tab_choice")
        slots = plan.get("decision_slots") or []
        self.assertTrue(slots, plan)
        values = [item.get("value") for item in (slots[0].get("options") or []) if isinstance(item, dict)]
        self.assertEqual(values, ["overview_tab", "planning_tab"])

    def test_agent_chat_returns_section_decision_slot_for_ambiguous_form_sections(self) -> None:
        client = TestClient(main.app)
        module_id = f"sectioned_{uuid.uuid4().hex[:6]}"
        res = client.post("/studio2/modules", json={"module_id": module_id, "name": "Projects"})
        payload = res.json()
        self.assertTrue(payload.get("ok"), payload)
        main.drafts.upsert_draft(module_id, _sectioned_project_manifest(module_id), updated_by="test", base_snapshot_id=None)

        with patch.object(main, "_openai_configured", lambda: True):
            res = client.post(
                "/studio2/agent/chat",
                json={
                    "module_id": module_id,
                    "message": "Add the budget field to a section in the Overview tab on the project form",
                    "build_spec": {"goal": "Extend projects", "entities": [{"id": "entity.project"}]},
                },
            )
        body = res.json()
        self.assertTrue(body.get("ok"), body)
        data = body.get("data") or {}
        self.assertEqual(data.get("stop_reason"), "decision_required")
        plan = data.get("plan") or {}
        meta = plan.get("required_question_meta") or {}
        self.assertEqual(meta.get("kind"), "decision_slot")
        self.assertEqual(meta.get("slot_kind"), "studio_section_choice")
        slots = plan.get("decision_slots") or []
        self.assertTrue(slots, plan)
        values = [item.get("value") for item in (slots[0].get("options") or []) if isinstance(item, dict)]
        self.assertEqual(values, ["summary", "people"])

    def test_agent_chat_section_choice_followup_places_field_in_selected_section(self) -> None:
        client = TestClient(main.app)
        module_id = f"section_followup_{uuid.uuid4().hex[:6]}"
        res = client.post("/studio2/modules", json={"module_id": module_id, "name": "Projects"})
        payload = res.json()
        self.assertTrue(payload.get("ok"), payload)
        main.drafts.upsert_draft(module_id, _sectioned_project_manifest(module_id), updated_by="test", base_snapshot_id=None)

        def fake_openai(messages, model=None):
            context_text = next(
                (
                    item.get("content")
                    for item in messages
                    if isinstance(item, dict)
                    and isinstance(item.get("content"), str)
                    and item.get("content", "").startswith("context.json")
                ),
                "",
            )
            if "\"planned_section_id\":\"people\"" not in context_text:
                return _fake_builder_response([])
            return _fake_builder_response(
                [
                    {
                        "tool": "ensure_entity",
                        "module_id": module_id,
                        "entity": {
                            "id": "entity.project",
                            "label": "Project",
                            "display_field": "project.name",
                            "fields": [
                                {"id": "project.name", "type": "string", "label": "Name"},
                                {"id": "project.summary", "type": "text", "label": "Summary"},
                                {"id": "project.owner", "type": "string", "label": "Owner"},
                                {"id": "project.notes", "type": "text", "label": "Notes"},
                                {"id": "project.budget", "type": "number", "label": "Budget"},
                            ],
                        },
                    }
                ]
            )

        with patch.object(main, "_openai_chat_completion", fake_openai), patch.object(main, "_openai_configured", lambda: True):
            first = client.post(
                "/studio2/agent/chat",
                json={
                    "module_id": module_id,
                    "message": "Add the budget field to a section in the Overview tab on the project form",
                    "build_spec": {"goal": "Extend projects", "entities": [{"id": "entity.project"}]},
                },
            )
            first_body = first.json()
            self.assertTrue(first_body.get("ok"), first_body)
            first_data = first_body.get("data") or {}
            self.assertEqual(first_data.get("stop_reason"), "decision_required", first_data)

            second = client.post(
                "/studio2/agent/chat",
                json={
                    "module_id": module_id,
                    "message": "Add the budget field to a section in the Overview tab on the project form",
                    "build_spec": {"goal": "Extend projects", "entities": [{"id": "entity.project"}]},
                    "hints": {"tab_target": "overview_tab", "planned_section_id": "people"},
                },
            )

        second_body = second.json()
        self.assertTrue(second_body.get("ok"), second_body)
        second_data = second_body.get("data") or {}
        self.assertEqual(second_data.get("stop_reason"), "pass", second_data)
        draft = second_data.get("drafts", {}).get(module_id)
        self.assertIsNotNone(draft)
        normalized, errors, _ = validate_manifest_raw(draft, expected_module_id=module_id)
        self.assertEqual(errors, [])
        form_view = next(view for view in (normalized.get("views") or []) if isinstance(view, dict) and view.get("id") == "project.form")
        sections = {section.get("id"): section for section in (form_view.get("sections") or []) if isinstance(section, dict)}
        people_fields = set(sections["people"].get("fields") or [])
        summary_fields = set(sections["summary"].get("fields") or [])
        self.assertIn("project.budget", people_fields)
        self.assertNotIn("project.budget", summary_fields)

    def test_agent_chat_returns_page_decision_slot_for_ambiguous_pages(self) -> None:
        client = TestClient(main.app)
        module_id = f"pages_{uuid.uuid4().hex[:6]}"
        res = client.post("/studio2/modules", json={"module_id": module_id, "name": "Dispatch"})
        payload = res.json()
        self.assertTrue(payload.get("ok"), payload)
        main.drafts.upsert_draft(module_id, _dispatch_workspace_manifest(module_id), updated_by="test", base_snapshot_id=None)

        with patch.object(main, "_openai_configured", lambda: True):
            res = client.post(
                "/studio2/agent/chat",
                json={
                    "module_id": module_id,
                    "message": "Update a page on the dispatch workspace",
                    "build_spec": {"goal": "Improve dispatch workspace", "entities": [{"id": "entity.dispatch"}]},
                },
            )
        body = res.json()
        self.assertTrue(body.get("ok"), body)
        data = body.get("data") or {}
        self.assertEqual(data.get("stop_reason"), "decision_required")
        plan = data.get("plan") or {}
        meta = plan.get("required_question_meta") or {}
        self.assertEqual(meta.get("kind"), "decision_slot")
        self.assertEqual(meta.get("slot_kind"), "studio_page_choice")
        slots = plan.get("decision_slots") or []
        self.assertTrue(slots, plan)
        values = [item.get("value") for item in (slots[0].get("options") or []) if isinstance(item, dict)]
        self.assertEqual(values, ["dispatch.control_page", "dispatch.calendar_page", "dispatch.form_page"])

    def test_agent_chat_returns_view_decision_slot_for_ambiguous_views(self) -> None:
        client = TestClient(main.app)
        module_id = f"views_{uuid.uuid4().hex[:6]}"
        res = client.post("/studio2/modules", json={"module_id": module_id, "name": "Dispatch"})
        payload = res.json()
        self.assertTrue(payload.get("ok"), payload)
        main.drafts.upsert_draft(module_id, _dispatch_workspace_manifest(module_id), updated_by="test", base_snapshot_id=None)

        with patch.object(main, "_openai_configured", lambda: True):
            res = client.post(
                "/studio2/agent/chat",
                json={
                    "module_id": module_id,
                    "message": "Update a view on dispatch",
                    "build_spec": {"goal": "Improve dispatch views", "entities": [{"id": "entity.dispatch"}]},
                },
            )
        body = res.json()
        self.assertTrue(body.get("ok"), body)
        data = body.get("data") or {}
        self.assertEqual(data.get("stop_reason"), "decision_required")
        plan = data.get("plan") or {}
        meta = plan.get("required_question_meta") or {}
        self.assertEqual(meta.get("kind"), "decision_slot")
        self.assertEqual(meta.get("slot_kind"), "studio_view_choice")
        slots = plan.get("decision_slots") or []
        self.assertTrue(slots, plan)
        values = [item.get("value") for item in (slots[0].get("options") or []) if isinstance(item, dict)]
        self.assertEqual(values, ["dispatch.list", "dispatch.kanban", "dispatch.calendar", "dispatch.form"])

    def test_agent_chat_ensure_ui_pattern_builds_dashboard_stat_cards_from_shared_helper(self) -> None:
        client = TestClient(main.app)
        module_id = f"jobs_dash_{uuid.uuid4().hex[:6]}"
        res = client.post("/studio2/modules", json={"module_id": module_id, "name": "Jobs"})
        payload = res.json()
        self.assertTrue(payload.get("ok"), payload)
        main.drafts.upsert_draft(module_id, _jobs_dashboard_manifest(module_id), updated_by="test", base_snapshot_id=None)

        calls = [
            {
                "tool": "ensure_ui_pattern",
                "module_id": module_id,
                "pattern": {
                    "kind": "dashboard_page",
                    "page_id": "job.dashboard_page",
                    "entity_id": "entity.job",
                    "request_summary": "Update the dashboard page to show total labour hours today, total cost today, and jobs by technician.",
                },
            }
        ]

        def fake_openai(_messages, model=None):
            return _fake_builder_response(calls)

        with patch.object(main, "_openai_chat_completion", fake_openai), patch.object(main, "_openai_configured", lambda: True):
            res = client.post(
                "/studio2/agent/chat",
                json={"module_id": module_id, "message": "Improve the jobs dashboard", "build_spec": {"goal": "Improve jobs dashboard", "entities": [{"id": "entity.job"}]}},
            )
        body = res.json()
        self.assertTrue(body.get("ok"), body)
        data = body.get("data") or {}
        draft = data.get("drafts", {}).get(module_id)
        self.assertIsNotNone(draft)
        normalized, errors, _warnings = validate_manifest_raw(draft, expected_module_id=module_id)
        self.assertEqual(errors, [])
        dashboard_page = next(page for page in normalized.get("pages", []) if page.get("id") == "job.dashboard_page")
        digest = main._ai_page_block_digest(dashboard_page.get("content") or [])
        cards = digest.get("stat_cards") or []
        measures = {card.get("label"): card.get("measure") for card in cards if isinstance(card, dict)}
        self.assertEqual(measures.get("total labour hours today"), "sum:job.labour_hours")
        self.assertEqual(measures.get("total cost today"), "sum:job.total_cost")
        self.assertEqual(measures.get("jobs by technician"), "count_distinct:job.technician_id")
        interfaces = normalized.get("interfaces") if isinstance(normalized.get("interfaces"), dict) else {}
        dashboardable = (interfaces.get("dashboardable") or [])[0]
        widgets = dashboardable.get("default_widgets") or []
        widget_by_id = {widget.get("id"): widget for widget in widgets if isinstance(widget, dict)}
        self.assertEqual((widget_by_id.get("jobs_by_technician") or {}).get("group_by"), "job.technician_id")
        self.assertEqual((widget_by_id.get("jobs_by_technician") or {}).get("measure"), "count_distinct:job.technician_id")
        self.assertIn("count_distinct:job.technician_id", dashboardable.get("measures") or [])
        self.assertIn("job.technician_id", dashboardable.get("group_bys") or [])
        graph_view = next(view for view in normalized.get("views", []) if view.get("id") == "job.graph")
        self.assertEqual((graph_view.get("default") or {}).get("group_by"), "job.technician_id")
        self.assertEqual((graph_view.get("default") or {}).get("measure"), "count_distinct:job.technician_id")
        view_modes_block = (((dashboard_page.get("content") or [])[0]).get("content") or [])[0]
        modes = view_modes_block.get("modes") or []
        grouped_modes = {mode.get("mode"): mode.get("default_group_by") for mode in modes if isinstance(mode, dict)}
        self.assertEqual(grouped_modes.get("graph"), "job.technician_id")
        self.assertEqual(grouped_modes.get("pivot"), "job.technician_id")

    def test_agent_chat_preserves_rich_manifest_contract_features(self) -> None:
        client = TestClient(main.app)
        module_id = f"catalog_rich_{uuid.uuid4().hex[:6]}"
        res = client.post("/studio2/modules", json={"module_id": module_id, "name": "Catalog"})
        payload = res.json()
        self.assertTrue(payload.get("ok"), payload)

        calls = [
            {
                "tool": "ensure_entity",
                "module_id": module_id,
                "entity": {
                    "id": "entity.item",
                    "label": "Item",
                    "display_field": "item.name",
                    "fields": [
                        {"id": "item.name", "type": "string", "label": "Item Name", "label_key": "catalog.entities.item.fields.name.label", "required": True},
                        {
                            "id": "item.status",
                            "type": "enum",
                            "label": "Status",
                            "label_key": "catalog.entities.item.fields.status.label",
                            "default": "draft",
                            "options": [
                                {"value": "draft", "label": "Draft", "label_key": "catalog.entities.item.fields.status.options.draft", "status_label_key": "catalog.entities.item.fields.status.options.draft"},
                                {"value": "active", "label": "Active", "label_key": "catalog.entities.item.fields.status.options.active", "status_label_key": "catalog.entities.item.fields.status.options.active"},
                                {"value": "rejected", "label": "Rejected", "label_key": "catalog.entities.item.fields.status.options.rejected", "status_label_key": "catalog.entities.item.fields.status.options.rejected"},
                            ],
                        },
                        {"id": "item.uom", "type": "string", "label": "Unit of Measure", "label_key": "catalog.entities.item.fields.uom.label", "default": "EA"},
                        {"id": "item.sales_currency", "type": "string", "label": "Sales Currency", "label_key": "catalog.entities.item.fields.sales_currency.label", "default": "USD"},
                        {
                            "id": "item.qty_on_hand",
                            "type": "number",
                            "label": "Qty On Hand",
                            "label_key": "catalog.entities.item.fields.qty_on_hand.label",
                            "default": 0,
                            "format": {"kind": "measurement", "unit_field": "item.uom", "precision": 0},
                        },
                        {
                            "id": "item.sales_price",
                            "type": "number",
                            "label": "Sales Price",
                            "label_key": "catalog.entities.item.fields.sales_price.label",
                            "default": 0,
                            "format": {"kind": "currency", "currency_field": "item.sales_currency", "precision": 2},
                        },
                        {
                            "id": "item.cost_price",
                            "type": "number",
                            "label": "Cost Price",
                            "label_key": "catalog.entities.item.fields.cost_price.label",
                            "default": 0,
                            "format": {"kind": "currency", "currency_field": "item.sales_currency", "precision": 2},
                        },
                        {
                            "id": "item.margin_amount",
                            "type": "number",
                            "label": "Margin",
                            "label_key": "catalog.entities.item.fields.margin_amount.label",
                            "readonly": True,
                            "default": 0,
                            "format": {"kind": "currency", "currency_field": "item.sales_currency", "precision": 2},
                            "compute": {
                                "expression": {
                                    "op": "round",
                                    "args": [
                                        {
                                            "op": "sub",
                                            "args": [
                                                {"ref": "$current.item.sales_price"},
                                                {"ref": "$current.item.cost_price"},
                                            ],
                                        },
                                        2,
                                    ],
                                }
                            },
                        },
                        {
                            "id": "item.review_notes",
                            "type": "text",
                            "label": "Review Notes",
                            "label_key": "catalog.entities.item.fields.review_notes.label",
                            "required_when": {"op": "eq", "field": "item.status", "value": "rejected"},
                        },
                        {
                            "id": "item.discontinue_reason",
                            "type": "text",
                            "label": "Discontinue Reason",
                            "label_key": "catalog.entities.item.fields.discontinue_reason.label",
                            "visible_when": {"op": "eq", "field": "item.status", "value": "rejected"},
                        },
                    ],
                },
            },
            {
                "tool": "ensure_workflow",
                "module_id": module_id,
                "workflow": {
                    "id": "workflow.item_status",
                    "entity": "entity.item",
                    "status_field": "item.status",
                    "states": [
                        {"id": "draft", "label": "Draft", "label_key": "catalog.workflows.item_status.states.draft", "status_label_key": "catalog.workflows.item_status.states.draft"},
                        {"id": "active", "label": "Active", "label_key": "catalog.workflows.item_status.states.active", "status_label_key": "catalog.workflows.item_status.states.active"},
                        {"id": "rejected", "label": "Rejected", "label_key": "catalog.workflows.item_status.states.rejected", "status_label_key": "catalog.workflows.item_status.states.rejected"},
                    ],
                },
            },
            {"tool": "ensure_entity_pages", "module_id": module_id, "entity_id": "entity.item"},
            {"tool": "ensure_actions_for_status", "module_id": module_id, "entity_id": "entity.item"},
            {"tool": "ensure_nav", "module_id": module_id},
        ]

        def fake_openai(_messages, model=None):
            return _fake_builder_response(calls)

        build_spec = {"goal": "Build catalog", "entities": [{"id": "entity.item"}]}
        with patch.object(main, "_openai_chat_completion", fake_openai), patch.object(main, "_openai_configured", lambda: True):
            res = client.post(
                "/studio2/agent/chat",
                json={"module_id": module_id, "message": "build a catalog with uoms pricing conditions and localized workflow labels", "build_spec": build_spec},
            )
        body = res.json()
        self.assertTrue(body.get("ok"), body)
        data = body.get("data") or {}
        draft = data.get("drafts", {}).get(module_id)
        self.assertIsNotNone(draft)
        normalized, errors, warnings = validate_manifest_raw(draft, expected_module_id=module_id)
        self.assertEqual(errors, [], {"warnings": warnings})

        entity = next(item for item in (normalized.get("entities") or []) if isinstance(item, dict) and item.get("id") == "entity.item")
        field_by_id = {field.get("id"): field for field in (entity.get("fields") or []) if isinstance(field, dict)}
        self.assertEqual((field_by_id["item.uom"].get("label_key")), "catalog.entities.item.fields.uom.label")
        self.assertEqual((field_by_id["item.qty_on_hand"].get("format") or {}).get("unit_field"), "item.uom")
        self.assertEqual((field_by_id["item.sales_price"].get("format") or {}).get("currency_field"), "item.sales_currency")
        self.assertIn("expression", (field_by_id["item.margin_amount"].get("compute") or {}))
        self.assertEqual((field_by_id["item.review_notes"].get("required_when") or {}).get("value"), "rejected")
        self.assertEqual((field_by_id["item.discontinue_reason"].get("visible_when") or {}).get("field"), "item.status")

        workflow = next(item for item in (normalized.get("workflows") or []) if isinstance(item, dict) and item.get("id") == "workflow.item_status")
        state_by_id = {state.get("id"): state for state in (workflow.get("states") or []) if isinstance(state, dict)}
        self.assertEqual(state_by_id["active"].get("label_key"), "catalog.workflows.item_status.states.active")
        self.assertEqual(state_by_id["rejected"].get("status_label_key"), "catalog.workflows.item_status.states.rejected")

        action_ids = {action.get("id") for action in (normalized.get("actions") or []) if isinstance(action, dict)}
        self.assertIn("action.item_set_active", action_ids)
        self.assertIn("action.item_set_rejected", action_ids)
        form_view = next(item for item in (normalized.get("views") or []) if isinstance(item, dict) and item.get("id") == "item.form")
        secondary_action_ids = [
            item.get("action_id")
            for item in (((form_view.get("header") or {}).get("secondary_actions")) or [])
            if isinstance(item, dict)
        ]
        self.assertIn("action.item_set_active", secondary_action_ids)

    def test_agent_rejects_entity_pages_for_missing_entity(self) -> None:
        client = TestClient(main.app)
        module_id = f"missing_entity_{uuid.uuid4().hex[:6]}"
        res = client.post("/studio2/modules", json={"module_id": module_id, "name": "No Entity"})
        payload = res.json()
        self.assertTrue(payload.get("ok"), payload)

        calls = [{"tool": "ensure_entity_pages", "module_id": module_id, "entity_id": "entity.missing"}]

        def fake_openai(_messages, model=None):
            return _fake_builder_response(calls)

        build_spec = {"goal": "Build pages", "entities": []}
        with patch.object(main, "_openai_chat_completion", fake_openai), patch.object(main, "_openai_configured", lambda: True):
            res = client.post(
                "/studio2/agent/chat",
                json={"module_id": module_id, "message": "add pages", "build_spec": build_spec},
            )
        body = res.json()
        self.assertTrue(body.get("ok"), body)
        data = body.get("data") or {}
        errors = (data.get("validation") or {}).get("errors") or []
        self.assertTrue(any(err.get("code") == "CALL_INVALID" for err in errors), errors)
        self.assertTrue(any("requires an existing entity_id" in str(err.get("message")) for err in errors), errors)

    def test_agent_chat_preserves_existing_rich_manifest_surfaces(self) -> None:
        client = TestClient(main.app)
        module_id = f"service_requests_{uuid.uuid4().hex[:6]}"
        base_manifest = _service_requests_manifest(module_id)
        main.drafts.upsert_draft(module_id, base_manifest, updated_by="test", base_snapshot_id=None)

        entity = copy.deepcopy(next(item for item in (base_manifest.get("entities") or []) if isinstance(item, dict) and item.get("id") == "entity.service_request"))
        fields = [field for field in (entity.get("fields") or []) if isinstance(field, dict)]
        fields.append(
            {
                "id": "service_request.estimated_hours",
                "type": "number",
                "label": "Estimated Hours",
                "label_key": "service_requests.entities.service_request.fields.estimated_hours.label",
                "default": 0,
            }
        )
        entity["fields"] = fields

        calls = [
            {
                "tool": "ensure_entity",
                "module_id": module_id,
                "entity": entity,
            }
        ]

        def fake_openai(_messages, model=None):
            return _fake_builder_response(calls)

        build_spec = {"goal": "Extend service requests", "entities": [{"id": "entity.service_request"}]}
        with patch.object(main, "_openai_chat_completion", fake_openai), patch.object(main, "_openai_configured", lambda: True):
            res = client.post(
                "/studio2/agent/chat",
                json={"module_id": module_id, "message": "add estimated hours without losing interfaces, modals, or transform actions", "build_spec": build_spec},
            )

        body = res.json()
        self.assertTrue(body.get("ok"), body)
        data = body.get("data") or {}
        draft = data.get("drafts", {}).get(module_id)
        self.assertIsNotNone(draft)
        normalized, errors, warnings = validate_manifest_raw(draft, expected_module_id=module_id)
        self.assertEqual(errors, [], {"warnings": warnings})

        entity = next(item for item in (normalized.get("entities") or []) if isinstance(item, dict) and item.get("id") == "entity.service_request")
        field_by_id = {field.get("id"): field for field in (entity.get("fields") or []) if isinstance(field, dict)}
        self.assertIn("service_request.estimated_hours", field_by_id)
        self.assertEqual(field_by_id["service_request.estimated_hours"].get("label_key"), "service_requests.entities.service_request.fields.estimated_hours.label")

        interfaces = normalized.get("interfaces") if isinstance(normalized.get("interfaces"), dict) else {}
        self.assertEqual((((interfaces.get("schedulable") or [])[0]).get("date_start")), "service_request.scheduled_start")
        self.assertEqual((((interfaces.get("documentable") or [])[0]).get("attachment_field")), "service_request.attachments")
        dashboard = (interfaces.get("dashboardable") or [])[0]
        self.assertEqual((((dashboard.get("default_widgets") or [])[0]).get("title_key")), "service_requests.dashboard.requests_by_status.title")

        transform = next(item for item in (normalized.get("transformations") or []) if isinstance(item, dict) and item.get("key") == "service_request_to_job")
        self.assertEqual((transform.get("validation") or {}).get("selected_record_domain", {}).get("value"), "approved")

        modal = next(item for item in (normalized.get("modals") or []) if isinstance(item, dict) and item.get("id") == "modal.service_request_cancel")
        self.assertEqual(modal.get("title_key"), "service_requests.modals.cancel.title")
        modal_action_labels = [item.get("action_label_key") for item in (modal.get("actions") or []) if isinstance(item, dict)]
        self.assertIn("service_requests.modals.cancel.actions.cancel.label", modal_action_labels)

        page_by_id = {page.get("id"): page for page in (normalized.get("pages") or []) if isinstance(page, dict)}
        self.assertEqual(page_by_id["service_request.list_page"].get("title_key"), "service_requests.pages.list_page.title")
        self.assertEqual((((page_by_id["service_request.list_page"].get("content") or [])[0]).get("kind")), "container")

        action = next(item for item in (normalized.get("actions") or []) if isinstance(item, dict) and item.get("id") == "action.service_request_convert_to_job")
        self.assertEqual(action.get("transformation_key"), "service_request_to_job")
        self.assertEqual(action.get("action_label_key"), "service_requests.actions.convert_to_job")

    def test_agent_chat_preserves_view_variants_relations_and_activity_contract(self) -> None:
        client = TestClient(main.app)
        module_id = f"dispatch_{uuid.uuid4().hex[:6]}"
        base_manifest = _dispatch_board_manifest(module_id)
        main.drafts.upsert_draft(module_id, base_manifest, updated_by="test", base_snapshot_id=None)

        entity = copy.deepcopy(next(item for item in (base_manifest.get("entities") or []) if isinstance(item, dict) and item.get("id") == "entity.dispatch"))
        fields = [field for field in (entity.get("fields") or []) if isinstance(field, dict)]
        fields.append(
            {
                "id": "dispatch.vehicle_name",
                "type": "string",
                "label": "Vehicle",
                "label_key": "dispatch.entities.dispatch.fields.vehicle_name.label",
            }
        )
        entity["fields"] = fields

        calls = [{"tool": "ensure_entity", "module_id": module_id, "entity": entity}]

        def fake_openai(_messages, model=None):
            return _fake_builder_response(calls)

        build_spec = {"goal": "Extend dispatch board", "entities": [{"id": "entity.dispatch"}]}
        with patch.object(main, "_openai_chat_completion", fake_openai), patch.object(main, "_openai_configured", lambda: True):
            res = client.post(
                "/studio2/agent/chat",
                json={"module_id": module_id, "message": "add vehicle tracking without losing board, graph, calendar, tabs, relations, or triggers", "build_spec": build_spec},
            )

        body = res.json()
        self.assertTrue(body.get("ok"), body)
        data = body.get("data") or {}
        draft = data.get("drafts", {}).get(module_id)
        self.assertIsNotNone(draft)
        normalized, errors, warnings = validate_manifest_raw(draft, expected_module_id=module_id)
        self.assertEqual(errors, [], {"warnings": warnings})

        entity = next(item for item in (normalized.get("entities") or []) if isinstance(item, dict) and item.get("id") == "entity.dispatch")
        field_by_id = {field.get("id"): field for field in (entity.get("fields") or []) if isinstance(field, dict)}
        self.assertIn("dispatch.vehicle_name", field_by_id)
        self.assertEqual(field_by_id["dispatch.vehicle_name"].get("label_key"), "dispatch.entities.dispatch.fields.vehicle_name.label")

        view_by_id = {view.get("id"): view for view in (normalized.get("views") or []) if isinstance(view, dict)}
        self.assertEqual(((((view_by_id["dispatch.kanban"].get("card") or {}).get("badge_fields")) or [])[0]), "dispatch.status")
        self.assertEqual(((view_by_id["dispatch.graph"].get("default") or {}).get("group_by")), "dispatch.status")
        self.assertEqual(((view_by_id["dispatch.calendar"].get("calendar") or {}).get("date_start")), "dispatch.scheduled_start")
        self.assertEqual(((view_by_id["dispatch.form"].get("activity") or {}).get("tab_label_key")), "dispatch.views.form.activity.tab")
        form_tabs = ((((view_by_id["dispatch.form"].get("header") or {}).get("tabs") or {}).get("tabs")) or [])
        self.assertTrue(any(isinstance(tab, dict) and tab.get("tab_label_key") == "dispatch.views.form.tabs.schedule" for tab in form_tabs))

        relations = [item for item in (normalized.get("relations") or []) if isinstance(item, dict)]
        self.assertTrue(any(rel.get("label_field") == "dispatch_stop.name" for rel in relations))

        triggers = [item for item in (normalized.get("triggers") or []) if isinstance(item, dict)]
        self.assertTrue(any(trigger.get("id") == "trigger.dispatch_status_changed" for trigger in triggers))

        page_by_id = {page.get("id"): page for page in (normalized.get("pages") or []) if isinstance(page, dict)}
        control_content = (page_by_id["dispatch.control_page"].get("content") or [])[0]
        self.assertEqual(control_content.get("kind"), "container")
        view_modes = (((control_content.get("content") or [])[0]).get("modes")) or []
        self.assertTrue(any(isinstance(mode, dict) and mode.get("mode") == "graph" for mode in view_modes))
        self.assertTrue(any(isinstance(mode, dict) and mode.get("mode") == "calendar" for mode in view_modes))

        nav_items = ((((normalized.get("app") or {}).get("nav") or [])[0]).get("items")) or []
        self.assertTrue(any(isinstance(item, dict) and item.get("menu_label_key") == "dispatch.nav.calendar" for item in nav_items))

    def test_agent_chat_add_field_does_not_append_legacy_list_under_view_modes_home(self) -> None:
        client = TestClient(main.app)
        module_id = f"products_{uuid.uuid4().hex[:6]}"
        base_manifest = {
            "manifest_version": "1.3",
            "module": {"id": module_id, "name": "Products"},
            "app": {
                "home": "page:product.list_page",
                "nav": [{"group": "Main", "items": [{"label": "Products", "to": "page:product.list_page"}]}],
                "defaults": {
                    "entities": {
                        "entity.product": {
                            "entity_home_page": "page:product.list_page",
                            "entity_form_page": "page:product.form_page",
                        }
                    }
                },
            },
            "entities": [
                {
                    "id": "entity.product",
                    "label": "Product",
                    "display_field": "product.name",
                    "fields": [
                        {"id": "product.code", "type": "string", "label": "Code"},
                        {"id": "product.name", "type": "string", "label": "Name"},
                    ],
                }
            ],
            "views": [
                {
                    "id": "product.list",
                    "kind": "list",
                    "entity": "entity.product",
                    "header": {
                        "primary_actions": [{"action_id": "action.product_new"}],
                        "open_record_target": "page:product.form_page",
                    },
                    "columns": [{"field_id": "product.code"}, {"field_id": "product.name"}],
                },
                {
                    "id": "product.form",
                    "kind": "form",
                    "entity": "entity.product",
                    "sections": [{"id": "main", "title": "Details", "fields": ["product.code", "product.name"]}],
                },
            ],
            "pages": [
                {
                    "id": "product.list_page",
                    "title": "Products",
                    "header": {"variant": "none"},
                    "layout": "single",
                    "content": [
                        {
                            "kind": "container",
                            "variant": "card",
                            "content": [
                                {
                                    "kind": "view_modes",
                                    "entity_id": "entity.product",
                                    "default_mode": "list",
                                    "modes": [{"mode": "list", "target": "view:product.list"}],
                                }
                            ],
                        }
                    ],
                },
                {
                    "id": "product.form_page",
                    "title": "Product",
                    "header": {"variant": "none"},
                    "layout": "single",
                    "content": [
                        {
                            "kind": "record",
                            "entity_id": "entity.product",
                            "record_id_query": "record",
                            "content": [{"kind": "view", "target": "view:product.form"}],
                        }
                    ],
                },
            ],
            "actions": [
                {
                    "id": "action.product_new",
                    "kind": "create_record",
                    "entity_id": "entity.product",
                    "target": "page:product.form_page",
                    "label": "New",
                }
            ],
            "workflows": [],
        }
        main.drafts.upsert_draft(module_id, base_manifest, updated_by="test", base_snapshot_id=None)

        entity = copy.deepcopy(next(item for item in (base_manifest.get("entities") or []) if isinstance(item, dict) and item.get("id") == "entity.product"))
        fields = [field for field in (entity.get("fields") or []) if isinstance(field, dict)]
        fields.append({"id": "product.preferred_supplier", "type": "string", "label": "Preferred Supplier"})
        entity["fields"] = fields

        calls = [{"tool": "ensure_entity", "module_id": module_id, "entity": entity}]

        def fake_openai(_messages, model=None):
            return _fake_builder_response(calls)

        with patch.object(main, "_openai_chat_completion", fake_openai), patch.object(main, "_openai_configured", lambda: True):
            res = client.post(
                "/studio2/agent/chat",
                json={"module_id": module_id, "message": "add a preferred supplier field"},
            )

        body = res.json()
        self.assertTrue(body.get("ok"), body)
        draft = ((body.get("data") or {}).get("drafts") or {}).get(module_id)
        self.assertIsInstance(draft, dict)

        normalized, errors, warnings = validate_manifest_raw(draft, expected_module_id=module_id)
        self.assertEqual(errors, [], {"warnings": warnings})

        page_by_id = {page.get("id"): page for page in (normalized.get("pages") or []) if isinstance(page, dict)}
        list_page = page_by_id.get("product.list_page") or {}
        content = list_page.get("content") or []
        self.assertEqual(len(content), 1)
        self.assertEqual((content[0] or {}).get("kind"), "container")
        nested = ((content[0] or {}).get("content") or [None])[0] or {}
        self.assertEqual(nested.get("kind"), "view_modes")
        direct_views = [
            block
            for block in content
            if isinstance(block, dict) and block.get("kind") == "view" and block.get("target") == "view:product.list"
        ]
        self.assertEqual(direct_views, [])

    def test_agent_chat_preserves_line_items_and_cross_module_lookups(self) -> None:
        client = TestClient(main.app)
        contacts_id = f"contacts_{uuid.uuid4().hex[:6]}"
        products_id = f"products_{uuid.uuid4().hex[:6]}"
        quotes_id = f"sales_quotes_{uuid.uuid4().hex[:6]}"

        main.store.init_module(contacts_id, _contacts_manifest(contacts_id), actor={"id": "test"})
        main.registry.register(contacts_id, "Contacts", actor=None)
        main.registry.set_enabled(contacts_id, True, actor=None, reason="test")

        main.store.init_module(products_id, _products_manifest(products_id), actor={"id": "test"})
        main.registry.register(products_id, "Products", actor=None)
        main.registry.set_enabled(products_id, True, actor=None, reason="test")

        base_manifest = _sales_quotes_manifest(quotes_id)
        main.drafts.upsert_draft(quotes_id, base_manifest, updated_by="test", base_snapshot_id=None)

        entity = copy.deepcopy(
            next(
                item
                for item in (base_manifest.get("entities") or [])
                if isinstance(item, dict) and item.get("id") == "entity.sales_quote"
            )
        )
        fields = [field for field in (entity.get("fields") or []) if isinstance(field, dict)]
        fields.append(
            {
                "id": "sales_quote.valid_until",
                "type": "date",
                "label": "Valid Until",
                "label_key": "sales_quotes.entities.sales_quote.fields.valid_until.label",
            }
        )
        entity["fields"] = fields

        calls = [
            {"tool": "read_manifest", "module_id": contacts_id, "level": "summary"},
            {"tool": "read_manifest", "module_id": products_id, "level": "summary"},
            {"tool": "ensure_entity", "module_id": quotes_id, "entity": entity},
        ]

        def fake_openai(_messages, model=None):
            return _fake_builder_response(calls)

        build_spec = {"goal": "Extend quotes", "entities": [{"id": "entity.sales_quote"}]}
        with patch.object(main, "_openai_chat_completion", fake_openai), patch.object(main, "_openai_configured", lambda: True):
            res = client.post(
                "/studio2/agent/chat",
                json={
                    "module_id": quotes_id,
                    "message": "add quote expiry without losing customer/product links or line items",
                    "build_spec": build_spec,
                },
            )

        body = res.json()
        self.assertTrue(body.get("ok"), body)
        data = body.get("data") or {}
        calls_applied = data.get("calls") or []
        self.assertTrue(any(call.get("tool") == "read_manifest" and call.get("module_id") == contacts_id for call in calls_applied))
        self.assertTrue(any(call.get("tool") == "read_manifest" and call.get("module_id") == products_id for call in calls_applied))

        draft = data.get("drafts", {}).get(quotes_id)
        self.assertIsNotNone(draft)
        normalized, errors, warnings = validate_manifest_raw(draft, expected_module_id=quotes_id)
        self.assertEqual(errors, [], {"warnings": warnings})

        quote_entity = next(item for item in (normalized.get("entities") or []) if isinstance(item, dict) and item.get("id") == "entity.sales_quote")
        quote_field_by_id = {field.get("id"): field for field in (quote_entity.get("fields") or []) if isinstance(field, dict)}
        self.assertIn("sales_quote.valid_until", quote_field_by_id)
        self.assertEqual(quote_field_by_id["sales_quote.customer_id"].get("entity"), "entity.contact")

        line_entity = next(item for item in (normalized.get("entities") or []) if isinstance(item, dict) and item.get("id") == "entity.sales_quote_line")
        line_field_by_id = {field.get("id"): field for field in (line_entity.get("fields") or []) if isinstance(field, dict)}
        self.assertEqual(line_field_by_id["sales_quote_line.product_id"].get("entity"), "entity.product")
        self.assertEqual(((line_field_by_id["sales_quote_line.qty"].get("format") or {}).get("unit_field")), "sales_quote_line.uom")
        self.assertIn("expression", (line_field_by_id["sales_quote_line.line_total"].get("compute") or {}))

        page_by_id = {page.get("id"): page for page in (normalized.get("pages") or []) if isinstance(page, dict)}
        tabs = (((((page_by_id["sales_quote.form_page"].get("content") or [])[0]).get("content") or [])[0]).get("tabs")) or []
        line_items_tab = next(tab for tab in tabs if isinstance(tab, dict) and tab.get("id") == "line_items")
        related_list = ((line_items_tab.get("content") or [])[0]) if isinstance(line_items_tab, dict) else None
        self.assertEqual((related_list or {}).get("kind"), "related_list")
        self.assertEqual((related_list or {}).get("entity_id"), "entity.sales_quote_line")
        self.assertEqual((((related_list or {}).get("record_domain")) or {}).get("field"), "sales_quote_line.sales_quote_id")

        relations = [item for item in (normalized.get("relations") or []) if isinstance(item, dict)]
        self.assertTrue(any(rel.get("to") == "entity.sales_quote_line" for rel in relations))

    def test_agent_chat_seeds_rich_recipe_module_scaffold_for_new_module_brief(self) -> None:
        client = TestClient(main.app)
        module_id = f"cooking_{uuid.uuid4().hex[:6]}"

        def fake_openai(_messages, model=None):
            return _fake_builder_response([{"tool": "ensure_nav", "module_id": module_id}])

        build_spec = {
            "goal": "Build cooking",
            "entities": [{"id": "entity.recipe"}, {"id": "entity.ingredient"}],
            "relations": [{"from": "entity.recipe", "to": "entity.ingredient"}],
        }
        with patch.object(main, "_openai_chat_completion", fake_openai), patch.object(main, "_openai_configured", lambda: True):
            res = client.post(
                "/studio2/agent/chat",
                json={
                    "module_id": module_id,
                    "message": "create me a real good cooking module, i need it to track my recipes and ingredients, we should also create a ingredients entity and add via line items in cooking module",
                    "build_spec": build_spec,
                },
            )

        body = res.json()
        self.assertTrue(body.get("ok"), body)
        data = body.get("data") or {}
        draft = data.get("drafts", {}).get(module_id)
        self.assertIsInstance(draft, dict)

        normalized, errors, warnings = validate_manifest_raw(draft, expected_module_id=module_id)
        self.assertEqual(errors, [], {"warnings": warnings})

        entities = [item for item in (normalized.get("entities") or []) if isinstance(item, dict)]
        recipe_entity = entities[0]
        recipe_labels = [
            field.get("label")
            for field in (recipe_entity.get("fields") or [])
            if isinstance(field, dict) and isinstance(field.get("label"), str)
        ]
        self.assertIn("Recipe Name", recipe_labels)
        self.assertIn("Cuisine", recipe_labels)
        self.assertIn("Meal Type", recipe_labels)

        ingredient_entity = next(item for item in entities if item.get("id") != recipe_entity.get("id"))
        ingredient_field_ids = {
            field.get("id")
            for field in (ingredient_entity.get("fields") or [])
            if isinstance(field, dict) and isinstance(field.get("id"), str)
        }
        self.assertIn(f"{ingredient_entity['id'].split('.', 1)[1]}.{recipe_entity['id'].split('.', 1)[1]}_id", ingredient_field_ids)

        recipe_form = next(
            view for view in (normalized.get("views") or [])
            if isinstance(view, dict) and view.get("id") == f"{recipe_entity['id'].split('.', 1)[1]}.form"
        )
        self.assertFalse(((recipe_form.get("activity") or {}).get("enabled")) is True)
        tabs = (((recipe_form.get("header") or {}).get("tabs") or {}).get("tabs") or [])
        ingredient_tab = next(
            tab for tab in tabs
            if isinstance(tab, dict) and str(tab.get("label") or "").lower() == "line items"
        )
        related_list = ((ingredient_tab.get("content") or [])[0]) if isinstance(ingredient_tab, dict) else None
        self.assertEqual((related_list or {}).get("kind"), "related_list")

        pages = [item for item in (normalized.get("pages") or []) if isinstance(item, dict)]
        page_ids = {item.get("id") for item in pages if isinstance(item.get("id"), str)}
        self.assertIn(f"{recipe_entity['id'].split('.', 1)[1]}.list_page", page_ids)
        self.assertIn(f"{recipe_entity['id'].split('.', 1)[1]}.form_page", page_ids)

    def test_agent_chat_uses_installed_manifest_as_base_when_no_draft_exists(self) -> None:
        client = TestClient(main.app)
        module_id = f"biz_quotes_{uuid.uuid4().hex[:6]}"
        manifest = copy.deepcopy(COMMERCIAL_QUOTES_MANIFEST)
        manifest["module"]["id"] = module_id
        manifest["module"]["key"] = module_id

        main.drafts.delete_draft(module_id)
        main.store.init_module(module_id, manifest, actor={"id": "test"})
        main.registry.register(module_id, manifest["module"].get("name") or "Quotes", actor=None)
        main.registry.set_enabled(module_id, True, actor=None, reason="test")

        calls = [
            {
                "tool": "ensure_entity",
                "module_id": module_id,
                "entity": {
                    "id": "entity.biz_quote",
                    "display_field": "biz_quote.quote_number",
                    "fields": [
                        {
                            "id": "biz_quote.kelly",
                            "type": "string",
                            "label": "Kelly",
                        }
                    ],
                },
            },
            {"tool": "ensure_entity_pages", "module_id": module_id, "entity_id": "entity.biz_quote"},
            {"tool": "ensure_nav", "module_id": module_id},
        ]

        def fake_openai(_messages, model=None):
            return _fake_builder_response(calls)

        build_spec = {"goal": "Extend quotes", "entities": [{"id": "entity.biz_quote"}]}
        with patch.object(main, "_openai_chat_completion", fake_openai), patch.object(main, "_openai_configured", lambda: True):
            res = client.post(
                "/studio2/agent/chat",
                json={
                    "module_id": module_id,
                    "message": "create a field called Kelly at the bottom of the form",
                    "build_spec": build_spec,
                },
            )

        body = res.json()
        self.assertTrue(body.get("ok"), body)
        data = body.get("data") or {}
        draft = data.get("drafts", {}).get(module_id)
        self.assertIsNotNone(draft)
        normalized, errors, warnings = validate_manifest_raw(draft, expected_module_id=module_id)
        self.assertEqual(errors, [], {"warnings": warnings})

        self.assertEqual((normalized.get("module") or {}).get("name"), "Quotes")
        self.assertIn("required", normalized.get("depends_on") or {})

        entity_ids = {item.get("id") for item in (normalized.get("entities") or []) if isinstance(item, dict)}
        self.assertIn("entity.biz_quote", entity_ids)
        self.assertIn("entity.biz_quote_line", entity_ids)

        quote_entity = next(item for item in (normalized.get("entities") or []) if isinstance(item, dict) and item.get("id") == "entity.biz_quote")
        field_ids = {field.get("id") for field in (quote_entity.get("fields") or []) if isinstance(field, dict)}
        self.assertIn("biz_quote.kelly", field_ids)
        self.assertIn("biz_quote.quote_number", field_ids)
        self.assertIn("biz_quote.status", field_ids)

        page_ids = {page.get("id") for page in (normalized.get("pages") or []) if isinstance(page, dict)}
        self.assertIn("biz_quote.list_page", page_ids)
        self.assertIn("biz_quote.form_page", page_ids)
        self.assertIn("biz_quote.draft_page", page_ids)
        self.assertNotIn("home", page_ids)
        self.assertNotIn("quote.list_page", page_ids)

        view_ids = {view.get("id") for view in (normalized.get("views") or []) if isinstance(view, dict)}
        self.assertIn("biz_quote.form", view_ids)
        self.assertIn("biz_quote_line.list", view_ids)
        quote_form = next(item for item in (normalized.get("views") or []) if isinstance(item, dict) and item.get("id") == "biz_quote.form")
        notes_section = next(item for item in (quote_form.get("sections") or []) if isinstance(item, dict) and item.get("id") == "notes")
        notes_fields = notes_section.get("fields") or []
        self.assertIn("biz_quote.kelly", notes_fields)
        self.assertEqual(notes_fields[-1], "biz_quote.kelly")

        nav_targets = [
            item.get("to")
            for group in ((normalized.get("app") or {}).get("nav") or [])
            if isinstance(group, dict)
            for item in (group.get("items") or [])
            if isinstance(item, dict)
        ]
        self.assertIn("page:biz_quote.list_page", nav_targets)
        applied_tools = [item.get("tool") for item in (data.get("calls") or []) if isinstance(item, dict)]
        self.assertEqual(applied_tools, ["ensure_entity"])

    def test_agent_read_manifest_cross_module(self) -> None:
        client = TestClient(main.app)
        contacts_id = f"contacts_{uuid.uuid4().hex[:6]}"
        jobs_id = f"jobs_{uuid.uuid4().hex[:6]}"
        main.store.init_module(contacts_id, _contacts_manifest(contacts_id), actor={"id": "test"})
        main.registry.register(contacts_id, "Contacts", actor=None)
        main.registry.set_enabled(contacts_id, True, actor=None, reason="test")

        res = client.post("/studio2/modules", json={"module_id": jobs_id, "name": "Jobs"})
        payload = res.json()
        self.assertTrue(payload.get("ok"), payload)

        calls = [
            {"tool": "read_manifest", "module_id": contacts_id, "level": "summary"},
            {
                "tool": "ensure_entity",
                "module_id": jobs_id,
                "entity": {
                    "id": "entity.job",
                    "label": "Job",
                    "display_field": "job.title",
                    "fields": [
                        {"id": "job.title", "type": "string", "label": "Title", "required": True},
                        {
                            "id": "job.contact_id",
                            "type": "lookup",
                            "label": "Contact",
                            "entity": "entity.contact",
                            "display_field": "contact.name",
                        },
                    ],
                },
            },
            {"tool": "ensure_entity_pages", "module_id": jobs_id, "entity_id": "entity.job"},
            {"tool": "ensure_nav", "module_id": jobs_id},
        ]

        def fake_openai(_messages, model=None):
            return _fake_builder_response(calls)

        build_spec = {"goal": "Build jobs", "entities": [{"id": "entity.job"}]}
        with patch.object(main, "_openai_chat_completion", fake_openai), patch.object(main, "_openai_configured", lambda: True):
            res = client.post(
                "/studio2/agent/chat",
                json={"module_id": jobs_id, "message": "jobs with contacts lookup", "build_spec": build_spec},
            )
        body = res.json()
        self.assertTrue(body.get("ok"), body)
        data = body.get("data") or {}
        calls_applied = data.get("calls") or []
        self.assertTrue(any(call.get("tool") == "read_manifest" for call in calls_applied))
        draft = data.get("drafts", {}).get(jobs_id)
        normalized, errors, _ = validate_manifest_raw(draft, expected_module_id=jobs_id)
        self.assertEqual(errors, [])


if __name__ == "__main__":
    unittest.main()
