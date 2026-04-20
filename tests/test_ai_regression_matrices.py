import copy
import unittest
from unittest.mock import patch

import app.main as main


def _contact_entity() -> dict:
    return {
        "id": "entity.biz_contact",
        "label": "Contact",
        "display_field": "biz_contact.name",
        "fields": [
            {"id": "biz_contact.name", "label": "Name", "type": "string"},
            {"id": "biz_contact.email", "label": "Email", "type": "email"},
            {"id": "biz_contact.phone", "label": "Phone", "type": "string"},
        ],
    }


def _purchase_order_entity() -> dict:
    return {
        "id": "entity.biz_purchase_order",
        "label": "Purchase Order",
        "display_field": "biz_purchase_order.po_number",
        "fields": [
            {"id": "biz_purchase_order.po_number", "label": "PO Number", "type": "string"},
            {"id": "biz_purchase_order.notes", "label": "Notes", "type": "text"},
            {
                "id": "biz_purchase_order.supplier_id",
                "label": "Supplier",
                "type": "lookup",
                "entity": "entity.biz_contact",
                "display_field": "biz_contact.name",
            },
        ],
    }


def _purchase_order_line_entity() -> dict:
    return {
        "id": "entity.biz_purchase_order_line",
        "label": "Purchase Order Line",
        "fields": [
            {
                "id": "biz_purchase_order_line.purchase_order_id",
                "label": "Purchase Order",
                "type": "lookup",
                "entity": "entity.biz_purchase_order",
            },
            {"id": "biz_purchase_order_line.description", "label": "Description", "type": "string"},
            {"id": "biz_purchase_order_line.quantity", "label": "Quantity", "type": "number"},
            {"id": "biz_purchase_order_line.unit_cost", "label": "Unit Cost", "type": "number"},
            {"id": "biz_purchase_order_line.line_total", "label": "Line Total", "type": "number"},
        ],
    }


def _quote_entity(include_lookup: bool = True, include_direct_email: bool = True) -> dict:
    fields = [
        {"id": "biz_quote.quote_number", "label": "Quote Number", "type": "string"},
        {"id": "biz_quote.customer_name", "label": "Customer Name", "type": "string"},
        {"id": "biz_quote.status", "label": "Status", "type": "string"},
    ]
    if include_direct_email:
        fields.append({"id": "biz_quote.customer_email", "label": "Customer Email", "type": "email"})
    if include_lookup:
        fields.append(
            {
                "id": "biz_quote.customer_id",
                "label": "Customer",
                "type": "lookup",
                "entity": "entity.biz_contact",
                "display_field": "biz_contact.name",
            }
        )
    return {
        "id": "entity.biz_quote",
        "label": "Quote",
        "display_field": "biz_quote.quote_number",
        "fields": fields,
    }


def _quote_line_entity() -> dict:
    return {
        "id": "entity.biz_quote_line",
        "label": "Quote Line",
        "fields": [
            {
                "id": "biz_quote_line.quote_id",
                "label": "Quote",
                "type": "lookup",
                "entity": "entity.biz_quote",
            },
            {"id": "biz_quote_line.product_id", "label": "Product", "type": "lookup", "entity": "entity.biz_product"},
            {"id": "biz_quote_line.description", "label": "Description", "type": "string"},
            {"id": "biz_quote_line.quantity", "label": "Quantity", "type": "number"},
            {"id": "biz_quote_line.unit_price", "label": "Unit Price", "type": "number"},
            {"id": "biz_quote_line.line_total", "label": "Line Total", "type": "number"},
        ],
    }


def _product_entity() -> dict:
    return {
        "id": "entity.biz_product",
        "label": "Product",
        "display_field": "biz_product.name",
        "fields": [{"id": "biz_product.name", "label": "Name", "type": "string"}],
    }


def _job_entity() -> dict:
    return {
        "id": "entity.biz_job",
        "label": "Job",
        "display_field": "biz_job.reference",
        "fields": [
            {"id": "biz_job.reference", "label": "Reference", "type": "string"},
            {"id": "biz_job.source_quote_number", "label": "Source Quote Number", "type": "string"},
            {"id": "biz_job.customer_name", "label": "Customer Name", "type": "string"},
            {"id": "biz_job.customer_email", "label": "Customer Email", "type": "email"},
            {"id": "biz_job.status", "label": "Status", "type": "string"},
        ],
    }


def _fake_find_entity(entity_id: str | None):
    entities = {
        "entity.biz_contact": _contact_entity(),
        "biz_contact": _contact_entity(),
        "entity.biz_purchase_order": _purchase_order_entity(),
        "biz_purchase_order": _purchase_order_entity(),
        "entity.biz_purchase_order_line": _purchase_order_line_entity(),
        "biz_purchase_order_line": _purchase_order_line_entity(),
        "entity.biz_quote": _quote_entity(),
        "biz_quote": _quote_entity(),
        "entity.biz_quote_line": _quote_line_entity(),
        "biz_quote_line": _quote_line_entity(),
        "entity.biz_product": _product_entity(),
        "biz_product": _product_entity(),
        "entity.biz_job": _job_entity(),
        "biz_job": _job_entity(),
    }
    return copy.deepcopy(entities.get(entity_id))


def _automation_meta(*, include_direct_quote_email: bool = True, include_quote_lookup: bool = True) -> dict:
    return {
        "event_types": [
            "biz_quotes.action.quote_mark_accepted.clicked",
            "biz_contacts.record.biz_contact.created",
        ],
        "event_catalog": [
            {
                "id": "biz_quotes.action.quote_mark_accepted.clicked",
                "label": "Quote accepted",
                "event": "action.clicked",
                "entity_id": "entity.biz_quote",
            },
            {
                "id": "biz_contacts.record.biz_contact.created",
                "label": "Contact created",
                "event": "record.created",
                "entity_id": "entity.biz_contact",
            },
        ],
        "system_actions": [
            {"id": "system.send_email", "label": "Send email"},
            {"id": "system.generate_document", "label": "Generate document"},
            {"id": "system.create_record", "label": "Create record"},
            {"id": "system.update_record", "label": "Update record"},
        ],
        "module_actions": [],
        "entities": [
            _quote_entity(include_lookup=include_quote_lookup, include_direct_email=include_direct_quote_email),
            _contact_entity(),
            _job_entity(),
        ],
        "field_path_catalog": [
            {
                "entity_id": "entity.biz_quote",
                "fields": [
                    {
                        "field_id": "biz_quote.quote_number",
                        "label": "Quote Number",
                        "type": "string",
                        "paths": [
                            "trigger.record.fields.biz_quote.quote_number",
                            "trigger.before.fields.biz_quote.quote_number",
                            "trigger.after.fields.biz_quote.quote_number",
                        ],
                    },
                    {
                        "field_id": "biz_quote.customer_name",
                        "label": "Customer Name",
                        "type": "string",
                        "paths": [
                            "trigger.record.fields.biz_quote.customer_name",
                            "trigger.before.fields.biz_quote.customer_name",
                            "trigger.after.fields.biz_quote.customer_name",
                        ],
                    },
                    {
                        "field_id": "biz_quote.customer_email",
                        "label": "Customer Email",
                        "type": "email",
                        "paths": [
                            "trigger.record.fields.biz_quote.customer_email",
                            "trigger.before.fields.biz_quote.customer_email",
                            "trigger.after.fields.biz_quote.customer_email",
                        ],
                    },
                    {
                        "field_id": "biz_quote.status",
                        "label": "Status",
                        "type": "string",
                        "paths": [
                            "trigger.record.fields.biz_quote.status",
                            "trigger.before.fields.biz_quote.status",
                            "trigger.after.fields.biz_quote.status",
                        ],
                    },
                    {
                        "field_id": "biz_quote.customer_id",
                        "label": "Customer",
                        "type": "lookup",
                        "paths": [
                            "trigger.record.fields.biz_quote.customer_id",
                            "trigger.before.fields.biz_quote.customer_id",
                            "trigger.after.fields.biz_quote.customer_id",
                        ],
                    },
                ],
            },
            {
                "entity_id": "entity.biz_contact",
                "fields": [
                    {
                        "field_id": "biz_contact.email",
                        "label": "Email",
                        "type": "email",
                        "paths": ["trigger.record.fields.biz_contact.email"],
                    },
                ],
            },
            {
                "entity_id": "entity.biz_job",
                "fields": [
                    {
                        "field_id": "biz_job.reference",
                        "label": "Reference",
                        "type": "string",
                        "paths": ["trigger.record.fields.biz_job.reference"],
                    }
                ],
            },
        ],
        "email_templates": [{"id": "email_tpl_default"}],
        "doc_templates": [{"id": "doc_tpl_default"}],
        "current_user_id": "user-current",
        "members": [{"user_id": "user-current", "email": "current@example.com"}],
    }


def _iter_blocks(page: dict) -> list[dict]:
    blocks: list[dict] = []

    def walk(value):
        if isinstance(value, dict):
            blocks.append(value)
            for child in value.values():
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)

    walk(page.get("content") or [])
    return blocks


class TestTemplateValidationMatrices(unittest.TestCase):
    def _validate_email(self, draft: dict) -> dict:
        with patch.object(main, "_find_entity_def_global", _fake_find_entity):
            return main._artifact_ai_validate_email_template_draft(draft)

    def _validate_doc(self, draft: dict) -> dict:
        with patch.object(main, "_find_entity_def_global", _fake_find_entity):
            return main._artifact_ai_validate_doc_template_draft(draft)


class TestTemplateNormalizerMatrices(unittest.TestCase):
    def _normalize_email(self, current: dict | None, candidate: dict | None) -> dict:
        with patch.object(main, "_find_entity_def_global", _fake_find_entity):
            return main._artifact_ai_normalize_email_template_draft(current, candidate)

    def _normalize_doc(self, current: dict | None, candidate: dict | None) -> dict:
        with patch.object(main, "_find_entity_def_global", _fake_find_entity):
            return main._artifact_ai_normalize_doc_template_draft(current, candidate)


class TestAutomationMatrices(unittest.TestCase):
    def _validate_automation(self, draft: dict, meta: dict | None = None) -> dict:
        with patch.object(main, "_find_entity_def_global", _fake_find_entity):
            return main._artifact_ai_validate_automation_draft(draft, copy.deepcopy(meta or _automation_meta()))


class TestStudioMatrix(unittest.TestCase):
    pass


class TestTemplateHintMatrices(unittest.TestCase):
    pass


class TestScopedAutomationHintMatrices(unittest.TestCase):
    pass


EMAIL_VALIDATION_CASES = [
    {
        "name": "email_valid_purchase_order_lookup_alias",
        "draft": {
            "name": "PO Email",
            "subject": "Purchase order {{ record['biz_purchase_order.po_number'] }}",
            "body_html": "<p>Hello {{ record['biz_purchase_order.supplier_name'] }}</p>",
            "body_text": "Hello {{ record['biz_purchase_order.supplier_name'] }}",
            "variables_schema": {"entity_id": "entity.biz_purchase_order"},
        },
        "compiled_ok": True,
    },
    {
        "name": "email_invalid_related_record_key_suggests_lookup_alias",
        "draft": {
            "name": "PO Email",
            "subject": "Purchase order {{ record['biz_purchase_order.po_number'] }}",
            "body_html": "<p>Hello {{ record['biz_contact.name'] }}</p>",
            "body_text": "Hello {{ record['biz_contact.name'] }}",
            "variables_schema": {"entity_id": "entity.biz_purchase_order"},
        },
        "compiled_ok": False,
        "message_substrings": ["invalid record key 'biz_contact.name'", "record['biz_purchase_order.supplier_name']"],
    },
    {
        "name": "email_invalid_dot_notation_short_key_suggests_full_field",
        "draft": {
            "name": "Quote Email",
            "subject": "Quote {{ record.quote_number }}",
            "body_html": "<p>Hello</p>",
            "body_text": "Hello",
            "variables_schema": {"entity_id": "entity.biz_quote"},
        },
        "compiled_ok": False,
        "message_substrings": ["invalid record key 'quote_number'", "record['biz_quote.quote_number']"],
    },
    {
        "name": "email_valid_quote_direct_fields",
        "draft": {
            "name": "Quote Email",
            "subject": "Quote {{ record['biz_quote.quote_number'] }}",
            "body_html": "<p>Hello {{ record['biz_quote.customer_name'] }}</p>",
            "body_text": "Hello {{ record['biz_quote.customer_name'] }}",
            "variables_schema": {"entity_id": "entity.biz_quote"},
        },
        "compiled_ok": True,
    },
    {
        "name": "email_invalid_typo_suggests_quote_number",
        "draft": {
            "name": "Quote Email",
            "subject": "Quote {{ record['biz_quote.quote_numbr'] }}",
            "body_html": "<p>Hello</p>",
            "body_text": "Hello",
            "variables_schema": {"entity_id": "entity.biz_quote"},
        },
        "compiled_ok": False,
        "message_substrings": ["invalid record key 'biz_quote.quote_numbr'", "record['biz_quote.quote_number']"],
    },
    {
        "name": "email_invalid_customer_contact_name_suggests_customer_name",
        "draft": {
            "name": "Quote Email",
            "subject": "Quote {{ record['biz_quote.quote_number'] }}",
            "body_html": "<p>Hello {{ record['biz_quote.customer_contact_name'] }}</p>",
            "body_text": "Hello {{ record['biz_quote.customer_contact_name'] }}",
            "variables_schema": {"entity_id": "entity.biz_quote"},
        },
        "compiled_ok": False,
        "message_substrings": ["invalid record key 'biz_quote.customer_contact_name'", "record['biz_quote.customer_name']"],
    },
    {
        "name": "email_invalid_body_dot_notation_suggests_full_field_id",
        "draft": {
            "name": "Quote Email",
            "subject": "Quote ready",
            "body_html": "<p>Hello {{ record.customer_name }}</p>",
            "body_text": "Hello {{ record.customer_name }}",
            "variables_schema": {"entity_id": "entity.biz_quote"},
        },
        "compiled_ok": False,
        "message_substrings": ["invalid record key 'customer_name'", "record['biz_quote.customer_name']"],
    },
    {
        "name": "email_invalid_wrong_entity_field_suggests_quote_field",
        "draft": {
            "name": "Quote Email",
            "subject": "Quote {{ record['biz_purchase_order.po_number'] }}",
            "body_html": "<p>Hello</p>",
            "body_text": "Hello",
            "variables_schema": {"entity_id": "entity.biz_quote"},
        },
        "compiled_ok": False,
        "message_substrings": ["invalid record key 'biz_purchase_order.po_number'", "record['biz_quote.quote_number']"],
    },
    {
        "name": "email_valid_quote_customer_email_field",
        "draft": {
            "name": "Quote Email",
            "subject": "Quote {{ record['biz_quote.quote_number'] }}",
            "body_html": "<p>We will email {{ record['biz_quote.customer_email'] }}</p>",
            "body_text": "We will email {{ record['biz_quote.customer_email'] }}",
            "variables_schema": {"entity_id": "entity.biz_quote"},
        },
        "compiled_ok": True,
    },
    {
        "name": "email_invalid_bare_short_record_key_suggests_customer_name",
        "draft": {
            "name": "Quote Email",
            "subject": "Hello {{ record['customer_name'] }}",
            "body_html": "<p>Hello</p>",
            "body_text": "Hello",
            "variables_schema": {"entity_id": "entity.biz_quote"},
        },
        "compiled_ok": False,
        "message_substrings": ["invalid record key 'customer_name'", "record['biz_quote.customer_name']"],
    },
]


DOCUMENT_VALIDATION_CASES = [
    {
        "name": "doc_valid_purchase_order_footer_tokens",
        "draft": {
            "name": "PO Document",
            "filename_pattern": "PO-{{ record['biz_purchase_order.po_number'] }}",
            "html": "<p>Hello {{ record['biz_purchase_order.supplier_name'] }}</p>",
            "footer_html": '<div><span class="pageNumber"></span>/<span class="totalPages"></span></div>',
            "variables_schema": {"entity_id": "entity.biz_purchase_order"},
        },
        "compiled_ok": True,
    },
    {
        "name": "doc_invalid_pagination_jinja_token",
        "draft": {
            "name": "PO Document",
            "filename_pattern": "PO-{{ record['biz_purchase_order.po_number'] }}",
            "html": "<p>Hello {{ record['biz_purchase_order.supplier_name'] }}</p>",
            "footer_html": "<div>Page {{ pageNumber }}</div>",
            "variables_schema": {"entity_id": "entity.biz_purchase_order"},
        },
        "compiled_ok": False,
        "message_substrings": ['class="pageNumber"'],
    },
    {
        "name": "doc_invalid_related_record_key_suggests_lookup_alias",
        "draft": {
            "name": "PO Document",
            "filename_pattern": "PO-{{ record['biz_purchase_order.po_number'] }}",
            "html": "<p>Hello {{ record['biz_contact.name'] }}</p>",
            "variables_schema": {"entity_id": "entity.biz_purchase_order"},
        },
        "compiled_ok": False,
        "message_substrings": ["invalid record key 'biz_contact.name'", "record['biz_purchase_order.supplier_name']"],
    },
    {
        "name": "doc_invalid_bare_line_item_key_suggests_full_field",
        "draft": {
            "name": "PO Document",
            "filename_pattern": "PO-{{ record['biz_purchase_order.po_number'] }}",
            "html": "<table>{% for line in lines %}<tr><td>{{ line['quantity'] }}</td></tr>{% endfor %}</table>",
            "variables_schema": {"entity_id": "entity.biz_purchase_order"},
        },
        "compiled_ok": False,
        "message_substrings": ["invalid line item key 'quantity'", "line['biz_purchase_order_line.quantity']"],
    },
    {
        "name": "doc_invalid_dot_line_item_key_suggests_full_field",
        "draft": {
            "name": "Quote Document",
            "filename_pattern": "quote_{{ record['biz_quote.quote_number'] }}",
            "html": "<table>{% for line in lines %}<tr><td>{{ line.quantity }}</td></tr>{% endfor %}</table>",
            "variables_schema": {"entity_id": "entity.biz_quote"},
        },
        "compiled_ok": False,
        "message_substrings": ["line.quantity", "line['biz_quote_line.quantity']"],
    },
    {
        "name": "doc_valid_quote_fields_and_lines",
        "draft": {
            "name": "Quote Document",
            "filename_pattern": "quote_{{ record['biz_quote.quote_number'] }}",
            "html": (
                "<p>{{ record['biz_quote.customer_name'] }}</p>"
                "<table>{% for line in lines %}<tr><td>{{ line['biz_quote_line.description'] }}</td></tr>{% endfor %}</table>"
            ),
            "variables_schema": {"entity_id": "entity.biz_quote"},
        },
        "compiled_ok": True,
    },
    {
        "name": "doc_invalid_dot_record_key_suggests_full_field",
        "draft": {
            "name": "Quote Document",
            "filename_pattern": "quote_{{ record.quote_number }}",
            "html": "<p>Hello</p>",
            "variables_schema": {"entity_id": "entity.biz_quote"},
        },
        "compiled_ok": False,
        "message_substrings": ["invalid record key 'quote_number'", "record['biz_quote.quote_number']"],
    },
    {
        "name": "doc_invalid_wrong_entity_record_key_suggests_quote_field",
        "draft": {
            "name": "Quote Document",
            "filename_pattern": "quote_{{ record['biz_purchase_order.po_number'] }}",
            "html": "<p>Hello</p>",
            "variables_schema": {"entity_id": "entity.biz_quote"},
        },
        "compiled_ok": False,
        "message_substrings": ["invalid record key 'biz_purchase_order.po_number'", "record['biz_quote.quote_number']"],
    },
    {
        "name": "doc_invalid_line_item_typo_suggests_quantity",
        "draft": {
            "name": "Quote Document",
            "filename_pattern": "quote_{{ record['biz_quote.quote_number'] }}",
            "html": "<table>{% for line in lines %}<tr><td>{{ line['biz_quote_line.quantitty'] }}</td></tr>{% endfor %}</table>",
            "variables_schema": {"entity_id": "entity.biz_quote"},
        },
        "compiled_ok": False,
        "message_substrings": ["invalid line item key 'biz_quote_line.quantitty'", "line['biz_quote_line.quantity']"],
    },
    {
        "name": "doc_invalid_line_item_wrong_entity_suggests_quote_line_field",
        "draft": {
            "name": "Quote Document",
            "filename_pattern": "quote_{{ record['biz_quote.quote_number'] }}",
            "html": "<table>{% for line in lines %}<tr><td>{{ line['biz_purchase_order_line.description'] }}</td></tr>{% endfor %}</table>",
            "variables_schema": {"entity_id": "entity.biz_quote"},
        },
        "compiled_ok": False,
        "message_substrings": ["invalid line item key 'biz_purchase_order_line.description'", "line['biz_quote_line.description']"],
    },
]


EMAIL_NORMALIZER_CASES = [
    {
        "name": "email_normalizer_derives_body_text_from_body_html",
        "current": {},
        "candidate": {
            "name": "Quote Update",
            "body_html": "<p>Hello <strong>Customer</strong></p>",
        },
        "expected": {"body_text": "Hello Customer"},
    },
    {
        "name": "email_normalizer_keeps_explicit_body_text",
        "current": {},
        "candidate": {
            "name": "Quote Update",
            "body_html": "<p>Hello Customer</p>",
            "body_text": "Plain customer greeting",
        },
        "expected": {"body_text": "Plain customer greeting"},
    },
    {
        "name": "email_normalizer_rewrites_bare_quote_line_item_reference",
        "current": {"variables_schema": {"entity_id": "entity.biz_quote"}},
        "candidate": {
            "body_html": "<table>{% for line in lines %}<tr><td>{{ line['quantity'] }}</td></tr>{% endfor %}</table>",
        },
        "expected_substrings": {"body_html": "line['biz_quote_line.quantity']"},
    },
    {
        "name": "email_normalizer_clears_blank_default_connection",
        "current": {},
        "candidate": {"default_connection_id": "   "},
        "expected": {"default_connection_id": None},
    },
    {
        "name": "email_normalizer_merges_current_fields_when_candidate_partial",
        "current": {
            "name": "Existing",
            "subject": "Current subject",
            "body_html": "<p>Current</p>",
            "body_text": "Current",
        },
        "candidate": {"subject": "Updated subject"},
        "expected": {
            "name": "Existing",
            "subject": "Updated subject",
            "body_html": "<p>Current</p>",
            "body_text": "Current",
        },
    },
]


DOCUMENT_NORMALIZER_CASES = [
    {
        "name": "doc_normalizer_defaults_paper_size_and_margins",
        "current": {},
        "candidate": {"name": "Quote Pack", "html": "<p>Quote</p>"},
        "expected": {
            "paper_size": "A4",
            "margin_top": "12mm",
            "margin_right": "12mm",
            "margin_bottom": "12mm",
            "margin_left": "12mm",
            "filename_pattern": "Quote Pack",
        },
    },
    {
        "name": "doc_normalizer_rejects_unknown_paper_size",
        "current": {},
        "candidate": {"paper_size": "Legal"},
        "expected": {"paper_size": "A4"},
    },
    {
        "name": "doc_normalizer_preserves_valid_letter_paper_size",
        "current": {},
        "candidate": {"paper_size": "Letter"},
        "expected": {"paper_size": "Letter"},
    },
    {
        "name": "doc_normalizer_rewrites_bare_quote_line_item_reference",
        "current": {"variables_schema": {"entity_id": "entity.biz_quote"}},
        "candidate": {
            "html": "<table>{% for line in lines %}<tr><td>{{ line['quantity'] }}</td></tr>{% endfor %}</table>",
        },
        "expected_substrings": {"html": "line['biz_quote_line.quantity']"},
    },
    {
        "name": "doc_normalizer_uses_existing_name_for_blank_filename_pattern",
        "current": {"name": "Existing Quote"},
        "candidate": {"filename_pattern": "   "},
        "expected": {"filename_pattern": "Existing Quote"},
    },
    {
        "name": "doc_normalizer_merges_current_and_candidate_values",
        "current": {"name": "Quote", "html": "<p>Old</p>", "paper_size": "Letter"},
        "candidate": {"html": "<p>New</p>"},
        "expected": {"name": "Quote", "html": "<p>New</p>", "paper_size": "Letter"},
    },
]


AUTOMATION_RECIPIENT_CASES = [
    {
        "name": "automation_normalize_contact_email_phrase",
        "meta": _automation_meta(),
        "entity_id": "entity.biz_contact",
        "inputs": {"to": "contact email"},
        "expected": {"to_field_ids": ["biz_contact.email"]},
        "absent": ["to", "to_lookup_field_ids"],
    },
    {
        "name": "automation_normalize_customer_email_phrase_to_direct_field",
        "meta": _automation_meta(),
        "entity_id": "entity.biz_quote",
        "inputs": {"to": "customer email"},
        "expected": {"to_field_ids": ["biz_quote.customer_email"]},
        "absent": ["to_lookup_field_ids", "to"],
    },
    {
        "name": "automation_normalize_trigger_record_email_ref_to_field",
        "meta": _automation_meta(),
        "entity_id": "entity.biz_quote",
        "inputs": {"to": "trigger.record.fields.biz_quote.customer_email"},
        "expected": {"to_field_ids": ["biz_quote.customer_email"]},
        "absent": ["to", "to_lookup_field_ids"],
    },
    {
        "name": "automation_preserves_literal_email_address",
        "meta": _automation_meta(),
        "entity_id": "entity.biz_quote",
        "inputs": {"to": "ops@example.com"},
        "expected": {"to": ["ops@example.com"]},
        "absent": ["to_field_ids", "to_lookup_field_ids"],
    },
    {
        "name": "automation_moves_jinja_to_to_expr",
        "meta": _automation_meta(),
        "entity_id": "entity.biz_quote",
        "inputs": {"to": "{{steps.lookup.email}}"},
        "expected": {"to_expr": "{{steps.lookup.email}}"},
        "absent": ["to", "to_field_ids"],
    },
    {
        "name": "automation_prefers_direct_customer_email_over_lookup_customer_id",
        "meta": _automation_meta(),
        "entity_id": "entity.biz_quote",
        "inputs": {"to_lookup_field_ids": ["biz_quote.customer_id"]},
        "expected": {"to_field_ids": ["biz_quote.customer_email"]},
        "absent": ["to_lookup_field_ids"],
    },
    {
        "name": "automation_keeps_lookup_when_no_direct_email_field_exists",
        "meta": _automation_meta(include_direct_quote_email=False, include_quote_lookup=True),
        "entity_id": "entity.biz_quote",
        "inputs": {"to_lookup_field_ids": ["biz_quote.customer_id"]},
        "expected": {"to_lookup_field_ids": ["biz_quote.customer_id"]},
        "absent": ["to_field_ids"],
    },
    {
        "name": "automation_defaults_single_email_field_when_unspecified",
        "meta": _automation_meta(),
        "entity_id": "entity.biz_contact",
        "inputs": {},
        "expected": {"to_field_ids": ["biz_contact.email"]},
        "absent": ["to", "to_lookup_field_ids"],
    },
    {
        "name": "automation_preserves_existing_direct_field_target",
        "meta": _automation_meta(),
        "entity_id": "entity.biz_quote",
        "inputs": {"to_field_id": "biz_quote.customer_email"},
        "expected": {"to_field_ids": ["biz_quote.customer_email"], "to_field_id": "biz_quote.customer_email"},
        "absent": ["to", "to_lookup_field_ids"],
    },
    {
        "name": "automation_dedupes_direct_emails",
        "meta": _automation_meta(),
        "entity_id": "entity.biz_quote",
        "inputs": {"to": "ops@example.com, OPS@example.com, finance@example.com"},
        "expected": {"to": ["ops@example.com", "finance@example.com"]},
        "absent": ["to_field_ids", "to_lookup_field_ids"],
    },
    {
        "name": "automation_dedupes_internal_emails",
        "meta": _automation_meta(),
        "entity_id": "entity.biz_quote",
        "inputs": {"to_internal_emails": "ops@example.com, OPS@example.com"},
        "expected": {"to_internal_emails": ["ops@example.com"]},
        "absent": ["to_field_ids", "to_lookup_field_ids"],
    },
    {
        "name": "automation_moves_multiple_expr_values_to_to_expr",
        "meta": _automation_meta(),
        "entity_id": "entity.biz_quote",
        "inputs": {"to": "{{steps.lookup.primary}}, {{steps.lookup.secondary}}"},
        "expected": {"to_expr": "{{steps.lookup.primary}}, {{steps.lookup.secondary}}"},
        "absent": ["to", "to_field_ids"],
    },
    {
        "name": "automation_keeps_lookup_when_no_email_candidates_exist",
        "meta": _automation_meta(include_direct_quote_email=False, include_quote_lookup=False),
        "entity_id": "entity.biz_quote",
        "inputs": {"to_lookup_field_ids": ["biz_quote.customer_id"]},
        "expected": {"to_lookup_field_ids": ["biz_quote.customer_id"]},
        "absent": ["to_field_ids"],
    },
    {
        "name": "automation_resolves_customer_email_ref_without_literal_to",
        "meta": _automation_meta(),
        "entity_id": "entity.biz_quote",
        "inputs": {"to": ["trigger.record.fields.biz_quote.customer_email"]},
        "expected": {"to_field_ids": ["biz_quote.customer_email"]},
        "absent": ["to"],
    },
]


AUTOMATION_INLINE_VALIDATION_CASES = [
    {
        "name": "automation_inline_email_valid_direct_fields",
        "draft": {
            "name": "Quote Accepted",
            "trigger": {"kind": "event", "event_types": ["biz_quotes.action.quote_mark_accepted.clicked"], "filters": []},
            "steps": [
                {
                    "kind": "action",
                    "action_id": "system.send_email",
                    "inputs": {
                        "entity_id": "entity.biz_quote",
                        "to_field_ids": ["biz_quote.customer_email"],
                        "subject": "Quote {{ record['biz_quote.quote_number'] }} accepted",
                        "body_text": "Dear {{ record['biz_quote.customer_name'] }}, quote {{ record['biz_quote.quote_number'] }} is accepted.",
                    },
                }
            ],
        },
        "compiled_ok": True,
    },
    {
        "name": "automation_inline_email_invalid_missing_customer_contact_name",
        "draft": {
            "name": "Quote Accepted",
            "trigger": {"kind": "event", "event_types": ["biz_quotes.action.quote_mark_accepted.clicked"], "filters": []},
            "steps": [
                {
                    "kind": "action",
                    "action_id": "system.send_email",
                    "inputs": {
                        "entity_id": "entity.biz_quote",
                        "to_field_ids": ["biz_quote.customer_email"],
                        "subject": "Quote {{ record['biz_quote.quote_number'] }} accepted",
                        "body_text": "Dear {{ record['biz_quote.customer_contact_name'] }}, quote accepted.",
                    },
                }
            ],
        },
        "compiled_ok": False,
        "message_substrings": ["invalid record key 'biz_quote.customer_contact_name'", "record['biz_quote.customer_name']"],
    },
    {
        "name": "automation_inline_email_invalid_dot_short_record_key",
        "draft": {
            "name": "Quote Accepted",
            "trigger": {"kind": "event", "event_types": ["biz_quotes.action.quote_mark_accepted.clicked"], "filters": []},
            "steps": [
                {
                    "kind": "action",
                    "action_id": "system.send_email",
                    "inputs": {
                        "entity_id": "entity.biz_quote",
                        "to_field_ids": ["biz_quote.customer_email"],
                        "subject": "Quote {{ record.quote_number }} accepted",
                        "body_text": "Quote accepted.",
                    },
                }
            ],
        },
        "compiled_ok": False,
        "message_substrings": ["invalid record key 'quote_number'", "record['biz_quote.quote_number']"],
    },
    {
        "name": "automation_inline_email_valid_html_and_text_fields",
        "draft": {
            "name": "Quote Accepted",
            "trigger": {"kind": "event", "event_types": ["biz_quotes.action.quote_mark_accepted.clicked"], "filters": []},
            "steps": [
                {
                    "kind": "action",
                    "action_id": "system.send_email",
                    "inputs": {
                        "entity_id": "entity.biz_quote",
                        "to_field_ids": ["biz_quote.customer_email"],
                        "subject": "Quote {{ record['biz_quote.quote_number'] }} accepted",
                        "body_html": "<p>Dear {{ record['biz_quote.customer_name'] }}</p>",
                        "body_text": "Dear {{ record['biz_quote.customer_name'] }}",
                    },
                }
            ],
        },
        "compiled_ok": True,
    },
    {
        "name": "automation_inline_email_invalid_wrong_entity_record_key",
        "draft": {
            "name": "Quote Accepted",
            "trigger": {"kind": "event", "event_types": ["biz_quotes.action.quote_mark_accepted.clicked"], "filters": []},
            "steps": [
                {
                    "kind": "action",
                    "action_id": "system.send_email",
                    "inputs": {
                        "entity_id": "entity.biz_quote",
                        "to_field_ids": ["biz_quote.customer_email"],
                        "subject": "Quote {{ record['biz_purchase_order.po_number'] }} accepted",
                        "body_text": "Quote accepted.",
                    },
                }
            ],
        },
        "compiled_ok": False,
        "message_substrings": ["invalid record key 'biz_purchase_order.po_number'", "record['biz_quote.quote_number']"],
    },
    {
        "name": "automation_inline_email_invalid_customer_email_typo",
        "draft": {
            "name": "Quote Accepted",
            "trigger": {"kind": "event", "event_types": ["biz_quotes.action.quote_mark_accepted.clicked"], "filters": []},
            "steps": [
                {
                    "kind": "action",
                    "action_id": "system.send_email",
                    "inputs": {
                        "entity_id": "entity.biz_quote",
                        "to_field_ids": ["biz_quote.customer_email"],
                        "subject": "Quote accepted",
                        "body_text": "Reply to {{ record['biz_quote.customer_emali'] }}",
                    },
                }
            ],
        },
        "compiled_ok": False,
        "message_substrings": ["invalid record key 'biz_quote.customer_emali'", "record['biz_quote.customer_email']"],
    },
    {
        "name": "automation_create_record_valid_quote_to_job_mapping",
        "draft": {
            "name": "Quote To Job",
            "trigger": {"kind": "event", "event_types": ["biz_quotes.action.quote_mark_accepted.clicked"], "filters": []},
            "steps": [
                {
                    "kind": "action",
                    "action_id": "system.create_record",
                    "inputs": {
                        "entity_id": "entity.biz_job",
                        "values": {
                            "biz_job.source_quote_number": "{{trigger.record.fields.biz_quote.quote_number}}",
                            "biz_job.customer_name": "{{trigger.record.fields.biz_quote.customer_name}}",
                            "biz_job.customer_email": "{{trigger.record.fields.biz_quote.customer_email}}",
                            "biz_job.status": "new",
                        },
                    },
                }
            ],
        },
        "compiled_ok": True,
    },
    {
        "name": "automation_create_record_invalid_unknown_target_field",
        "draft": {
            "name": "Quote To Job",
            "trigger": {"kind": "event", "event_types": ["biz_quotes.action.quote_mark_accepted.clicked"], "filters": []},
            "steps": [
                {
                    "kind": "action",
                    "action_id": "system.create_record",
                    "inputs": {
                        "entity_id": "entity.biz_job",
                        "values": {
                            "biz_job.unknown_field": "{{trigger.record.fields.biz_quote.quote_number}}",
                        },
                    },
                }
            ],
        },
        "compiled_ok": False,
        "message_substrings": ["Unknown field id 'biz_job.unknown_field' for entity 'entity.biz_job'"],
    },
    {
        "name": "automation_create_record_invalid_unknown_trigger_field_reference",
        "draft": {
            "name": "Quote To Job",
            "trigger": {"kind": "event", "event_types": ["biz_quotes.action.quote_mark_accepted.clicked"], "filters": []},
            "steps": [
                {
                    "kind": "action",
                    "action_id": "system.create_record",
                    "inputs": {
                        "entity_id": "entity.biz_job",
                        "values": {
                            "biz_job.customer_name": "{{trigger.record.fields.biz_quote.customer_contact_name}}",
                        },
                    },
                }
            ],
        },
        "compiled_ok": False,
        "message_substrings": [
            "Unknown automation field reference 'trigger.record.fields.biz_quote.customer_contact_name'",
        ],
    },
    {
        "name": "automation_update_record_invalid_unknown_after_field_reference",
        "draft": {
            "name": "Quote Update",
            "trigger": {"kind": "event", "event_types": ["biz_quotes.action.quote_mark_accepted.clicked"], "filters": []},
            "steps": [
                {
                    "kind": "action",
                    "action_id": "system.update_record",
                    "inputs": {
                        "entity_id": "entity.biz_quote",
                        "record_id": "{{trigger.record_id}}",
                        "patch": {
                            "biz_quote.customer_name": "{{trigger.after.fields.biz_quote.customer_contact_name}}",
                        },
                    },
                }
            ],
        },
        "compiled_ok": False,
        "message_substrings": [
            "Unknown automation field reference 'trigger.after.fields.biz_quote.customer_contact_name'",
        ],
    },
    {
        "name": "automation_update_record_valid_mixed_record_and_after_refs",
        "draft": {
            "name": "Quote Update",
            "trigger": {"kind": "event", "event_types": ["biz_quotes.action.quote_mark_accepted.clicked"], "filters": []},
            "steps": [
                {
                    "kind": "action",
                    "action_id": "system.update_record",
                    "inputs": {
                        "entity_id": "entity.biz_quote",
                        "record_id": "{{trigger.record_id}}",
                        "patch": {
                            "biz_quote.customer_name": "{{trigger.after.fields.biz_quote.customer_name}}",
                            "biz_quote.quote_number": "{{trigger.record.fields.biz_quote.quote_number}}",
                            "biz_quote.status": "accepted",
                        },
                    },
                }
            ],
        },
        "compiled_ok": True,
    },
    {
        "name": "automation_update_record_invalid_unknown_target_field",
        "draft": {
            "name": "Quote Update",
            "trigger": {"kind": "event", "event_types": ["biz_quotes.action.quote_mark_accepted.clicked"], "filters": []},
            "steps": [
                {
                    "kind": "action",
                    "action_id": "system.update_record",
                    "inputs": {
                        "entity_id": "entity.biz_quote",
                        "record_id": "{{trigger.record_id}}",
                        "patch": {
                            "biz_quote.unknown_field": "{{trigger.record.fields.biz_quote.quote_number}}",
                        },
                    },
                }
            ],
        },
        "compiled_ok": False,
        "message_substrings": ["Unknown field id 'biz_quote.unknown_field' for entity 'entity.biz_quote'"],
    },
    {
        "name": "automation_create_record_valid_before_and_record_refs",
        "draft": {
            "name": "Quote Snapshot Job",
            "trigger": {"kind": "event", "event_types": ["biz_quotes.action.quote_mark_accepted.clicked"], "filters": []},
            "steps": [
                {
                    "kind": "action",
                    "action_id": "system.create_record",
                    "inputs": {
                        "entity_id": "entity.biz_job",
                        "values": {
                            "biz_job.reference": "{{trigger.record.fields.biz_quote.quote_number}}",
                            "biz_job.customer_name": "{{trigger.before.fields.biz_quote.customer_name}}",
                            "biz_job.status": "new",
                        },
                    },
                }
            ],
        },
        "compiled_ok": True,
    },
    {
        "name": "automation_create_record_invalid_unknown_before_field_reference",
        "draft": {
            "name": "Quote Snapshot Job",
            "trigger": {"kind": "event", "event_types": ["biz_quotes.action.quote_mark_accepted.clicked"], "filters": []},
            "steps": [
                {
                    "kind": "action",
                    "action_id": "system.create_record",
                    "inputs": {
                        "entity_id": "entity.biz_job",
                        "values": {
                            "biz_job.customer_name": "{{trigger.before.fields.biz_quote.customer_contact_name}}",
                        },
                    },
                }
            ],
        },
        "compiled_ok": False,
        "message_substrings": [
            "Unknown automation field reference 'trigger.before.fields.biz_quote.customer_contact_name'",
        ],
    },
    {
        "name": "automation_condition_valid_quote_status_expr",
        "draft": {
            "name": "Quote Accepted Email",
            "trigger": {"kind": "event", "event_types": ["biz_quotes.action.quote_mark_accepted.clicked"], "filters": []},
            "steps": [
                {
                    "kind": "condition",
                    "expr": {
                        "op": "eq",
                        "left": {"var": "trigger.after.fields.biz_quote.status"},
                        "right": {"literal": "accepted"},
                    },
                    "then_steps": [
                        {
                            "kind": "action",
                            "action_id": "system.send_email",
                            "inputs": {
                                "entity_id": "entity.biz_quote",
                                "to_field_ids": ["biz_quote.customer_email"],
                                "subject": "Quote accepted",
                                "body_text": "Quote {{ record['biz_quote.quote_number'] }} accepted.",
                            },
                        }
                    ],
                }
            ],
        },
        "compiled_ok": True,
    },
    {
        "name": "automation_condition_invalid_unknown_expr_field",
        "draft": {
            "name": "Quote Accepted Email",
            "trigger": {"kind": "event", "event_types": ["biz_quotes.action.quote_mark_accepted.clicked"], "filters": []},
            "steps": [
                {
                    "kind": "condition",
                    "expr": {
                        "op": "eq",
                        "left": {"var": "trigger.after.fields.biz_quote.customer_contact_name"},
                        "right": {"literal": "Nick"},
                    },
                    "then_steps": [
                        {
                            "kind": "action",
                            "action_id": "system.send_email",
                            "inputs": {
                                "entity_id": "entity.biz_quote",
                                "to_field_ids": ["biz_quote.customer_email"],
                                "subject": "Quote accepted",
                                "body_text": "Quote accepted.",
                            },
                        }
                    ],
                }
            ],
        },
        "compiled_ok": False,
        "message_substrings": [
            "Unknown automation field reference 'trigger.after.fields.biz_quote.customer_contact_name'",
        ],
    },
    {
        "name": "automation_condition_valid_nested_boolean_expr_fields",
        "draft": {
            "name": "Accepted Quote Email",
            "trigger": {"kind": "event", "event_types": ["biz_quotes.action.quote_mark_accepted.clicked"], "filters": []},
            "steps": [
                {
                    "kind": "condition",
                    "expr": {
                        "op": "and",
                        "args": [
                            {
                                "op": "eq",
                                "left": {"var": "trigger.after.fields.biz_quote.status"},
                                "right": {"literal": "accepted"},
                            },
                            {
                                "op": "eq",
                                "left": {"var": "trigger.record.fields.biz_quote.customer_email"},
                                "right": {"literal": "customer@example.com"},
                            },
                        ],
                    },
                    "then_steps": [
                        {
                            "kind": "action",
                            "action_id": "system.send_email",
                            "inputs": {
                                "entity_id": "entity.biz_quote",
                                "to_field_ids": ["biz_quote.customer_email"],
                                "subject": "Quote accepted",
                                "body_text": "Quote accepted.",
                            },
                        }
                    ],
                }
            ],
        },
        "compiled_ok": True,
    },
    {
        "name": "automation_condition_invalid_nested_boolean_expr_unknown_field",
        "draft": {
            "name": "Accepted Quote Email",
            "trigger": {"kind": "event", "event_types": ["biz_quotes.action.quote_mark_accepted.clicked"], "filters": []},
            "steps": [
                {
                    "kind": "condition",
                    "expr": {
                        "op": "and",
                        "args": [
                            {
                                "op": "eq",
                                "left": {"var": "trigger.after.fields.biz_quote.status"},
                                "right": {"literal": "accepted"},
                            },
                            {
                                "op": "eq",
                                "left": {"var": "trigger.record.fields.biz_quote.customer_contact_name"},
                                "right": {"literal": "Northwind"},
                            },
                        ],
                    },
                    "then_steps": [
                        {
                            "kind": "action",
                            "action_id": "system.send_email",
                            "inputs": {
                                "entity_id": "entity.biz_quote",
                                "to_field_ids": ["biz_quote.customer_email"],
                                "subject": "Quote accepted",
                                "body_text": "Quote accepted.",
                            },
                        }
                    ],
                }
            ],
        },
        "compiled_ok": False,
        "message_substrings": [
            "Unknown automation field reference 'trigger.record.fields.biz_quote.customer_contact_name'",
        ],
    },
]


TEMPLATE_HINT_CASES = [
    {
        "name": "template_hints_question_for_missing_email_template",
        "message": "Use an email template for this automation.",
        "workspace_id": "default",
        "candidate_ops": [
            {
                "op": "create_automation_record",
                "artifact_type": "automation",
                "artifact_id": "auto_email",
                "automation": {
                    "name": "Email Customer",
                    "steps": [{"kind": "action", "action_id": "system.send_email", "inputs": {}}],
                },
            }
        ],
        "options_kind": "email_template",
        "options": [{"id": "email_tpl_one", "label": "Email One", "value": "email_tpl_one"}],
        "expected_slot_kind": "email_template_choice",
    },
    {
        "name": "template_hints_apply_selected_email_template",
        "message": "Use an email template for this automation.",
        "workspace_id": "default",
        "candidate_ops": [
            {
                "op": "create_automation_record",
                "artifact_type": "automation",
                "artifact_id": "auto_email",
                "automation": {
                    "name": "Email Customer",
                    "steps": [{"kind": "action", "action_id": "system.send_email", "inputs": {}}],
                },
            }
        ],
        "answer_hints": {"email_template_id": "email_tpl_selected"},
        "expected_template_id": "email_tpl_selected",
    },
    {
        "name": "template_hints_create_new_email_template",
        "message": "Use an email template for this automation.",
        "workspace_id": "default",
        "candidate_ops": [
            {
                "op": "create_automation_record",
                "artifact_type": "automation",
                "artifact_id": "auto_email",
                "automation": {
                    "name": "Email Customer",
                    "steps": [
                        {
                            "kind": "action",
                            "action_id": "system.send_email",
                            "inputs": {"subject": "Hello", "body_text": "World"},
                        }
                    ],
                },
            }
        ],
        "answer_hints": {"create_new_email_template": True, "email_template_id": "__create_new__"},
        "expected_prepended_op": "create_email_template_record",
        "expected_step_template_prefix": "email_tpl_",
    },
    {
        "name": "template_hints_question_for_missing_document_template",
        "message": "Use a document template for this automation.",
        "workspace_id": "default",
        "candidate_ops": [
            {
                "op": "create_automation_record",
                "artifact_type": "automation",
                "artifact_id": "auto_doc",
                "automation": {
                    "name": "Generate Pack",
                    "steps": [{"kind": "action", "action_id": "system.generate_document", "inputs": {"record_id": "{{trigger.record_id}}"}}],
                },
            }
        ],
        "options_kind": "document_template",
        "options": [{"id": "doc_tpl_one", "label": "Pack", "value": "doc_tpl_one"}],
        "expected_slot_kind": "document_template_choice",
    },
    {
        "name": "template_hints_apply_selected_document_template",
        "message": "Use a document template for this automation.",
        "workspace_id": "default",
        "candidate_ops": [
            {
                "op": "create_automation_record",
                "artifact_type": "automation",
                "artifact_id": "auto_doc",
                "automation": {
                    "name": "Generate Pack",
                    "steps": [{"kind": "action", "action_id": "system.generate_document", "inputs": {"record_id": "{{trigger.record_id}}"}}],
                },
            }
        ],
        "answer_hints": {"document_template_id": "doc_tpl_selected"},
        "expected_template_id": "doc_tpl_selected",
    },
    {
        "name": "template_hints_create_new_document_template",
        "message": "Use a document template for this automation.",
        "workspace_id": "default",
        "candidate_ops": [
            {
                "op": "create_automation_record",
                "artifact_type": "automation",
                "artifact_id": "auto_doc",
                "automation": {
                    "name": "Generate Pack",
                    "steps": [{"kind": "action", "action_id": "system.generate_document", "inputs": {"html": "<p>Pack</p>"}}],
                },
            }
        ],
        "answer_hints": {"create_new_document_template": True, "document_template_id": "__create_new__"},
        "expected_prepended_op": "create_document_template_record",
        "expected_step_template_prefix": "doc_tpl_",
    },
    {
        "name": "template_hints_leaves_inline_email_when_not_requested",
        "message": "Send a direct email to the customer.",
        "workspace_id": "default",
        "candidate_ops": [
            {
                "op": "create_automation_record",
                "artifact_type": "automation",
                "artifact_id": "auto_inline_email",
                "automation": {
                    "name": "Inline Email",
                    "steps": [{"kind": "action", "action_id": "system.send_email", "inputs": {"subject": "Hello", "body_text": "World"}}],
                },
            }
        ],
    },
    {
        "name": "template_hints_prefers_document_slot_before_email_slot",
        "message": "Use an email template and a document template for this automation.",
        "workspace_id": "default",
        "candidate_ops": [
            {
                "op": "create_automation_record",
                "artifact_type": "automation",
                "artifact_id": "auto_combo",
                "automation": {
                    "name": "Send Pack",
                    "steps": [
                        {"kind": "action", "action_id": "system.send_email", "inputs": {}},
                        {"kind": "action", "action_id": "system.generate_document", "inputs": {"record_id": "{{trigger.record_id}}"}},
                    ],
                },
            }
        ],
        "options_kind": "document_template",
        "options": [{"id": "doc_tpl_one", "label": "Pack", "value": "doc_tpl_one"}],
        "expected_slot_kind": "document_template_choice",
    },
    {
        "name": "template_hints_auto_creates_only_option_email_template",
        "message": "Use an email template for this automation.",
        "workspace_id": "default",
        "candidate_ops": [
            {
                "op": "create_automation_record",
                "artifact_type": "automation",
                "artifact_id": "auto_email_single",
                "automation": {
                    "name": "Email Customer",
                    "steps": [{"kind": "action", "action_id": "system.send_email", "inputs": {}}],
                },
            }
        ],
        "options_kind": "none",
        "options": [],
        "expected_prepended_op": "create_email_template_record",
        "expected_step_template_prefix": "email_tpl_",
    },
    {
        "name": "template_hints_auto_creates_only_option_document_template",
        "message": "Use a document template for this automation.",
        "workspace_id": "default",
        "candidate_ops": [
            {
                "op": "create_automation_record",
                "artifact_type": "automation",
                "artifact_id": "auto_doc_single",
                "automation": {
                    "name": "Generate Pack",
                    "steps": [{"kind": "action", "action_id": "system.generate_document", "inputs": {"record_id": "{{trigger.record_id}}"}}],
                },
            }
        ],
        "options_kind": "none",
        "options": [],
        "expected_prepended_op": "create_document_template_record",
        "expected_step_template_prefix": "doc_tpl_",
    },
]


STUDIO_CASES = [
    {"name": "studio_normalize_empty_item_list_page", "entity_slug": "item", "title": "Items"},
    {"name": "studio_normalize_empty_quote_list_page", "entity_slug": "quote", "title": "Quotes"},
    {"name": "studio_normalize_empty_task_list_page", "entity_slug": "task", "title": "Tasks"},
    {"name": "studio_sanitize_legacy_item_list_page", "entity_slug": "item", "title": "Items", "legacy": True},
    {"name": "studio_sanitize_legacy_quote_list_page", "entity_slug": "quote", "title": "Quotes", "legacy": True},
    {"name": "studio_idempotent_modern_task_list_page", "entity_slug": "task", "title": "Tasks", "modern": True},
    {"name": "studio_normalize_empty_recipe_list_page", "entity_slug": "recipe", "title": "Recipes"},
    {"name": "studio_normalize_empty_order_list_page", "entity_slug": "order", "title": "Orders"},
    {"name": "studio_normalize_empty_contact_list_page", "entity_slug": "contact", "title": "Contacts"},
    {"name": "studio_sanitize_legacy_recipe_list_page", "entity_slug": "recipe", "title": "Recipes", "legacy": True},
    {"name": "studio_sanitize_legacy_order_list_page", "entity_slug": "order", "title": "Orders", "legacy": True},
    {"name": "studio_sanitize_legacy_contact_list_page", "entity_slug": "contact", "title": "Contacts", "legacy": True},
    {"name": "studio_idempotent_modern_quote_list_page", "entity_slug": "quote", "title": "Quotes", "modern": True},
    {"name": "studio_idempotent_modern_recipe_list_page", "entity_slug": "recipe", "title": "Recipes", "modern": True},
    {"name": "studio_idempotent_modern_order_list_page", "entity_slug": "order", "title": "Orders", "modern": True},
]


SCOPED_AUTOMATION_HINT_CASES = [
    {
        "name": "scoped_notify_prompt_defaults_current_user_when_requested",
        "prompt": "Notify me when the quote is accepted.",
        "draft": {"steps": [{"kind": "action", "action_id": "system.notify", "inputs": {}}]},
        "expected_inputs": {"recipient_user_ids": ["user-current"]},
    },
    {
        "name": "scoped_notify_prompt_returns_decision_slot_when_missing_recipient",
        "prompt": "Notify the team when the quote is accepted.",
        "draft": {"steps": [{"kind": "action", "action_id": "system.notify", "inputs": {}}]},
        "expected_slot_kind": "notify_recipient",
    },
    {
        "name": "scoped_notify_prompt_applies_selected_recipient_hint",
        "prompt": "Notify the team when the quote is accepted.",
        "draft": {"steps": [{"kind": "action", "action_id": "system.notify", "inputs": {}}]},
        "answer_hints": {"recipient_user_id": "user-sales"},
        "expected_inputs": {"recipient_user_ids": ["user-sales"]},
    },
    {
        "name": "scoped_send_email_prompt_returns_template_slot",
        "prompt": "Email the customer when the quote is accepted.",
        "draft": {"steps": [{"kind": "action", "action_id": "system.send_email", "inputs": {}}]},
        "options_kind": "email_template",
        "options": [{"id": "email_tpl_one", "label": "Customer Update", "value": "email_tpl_one"}],
        "expected_slot_kind": "email_template_choice",
    },
    {
        "name": "scoped_send_email_prompt_applies_selected_template",
        "prompt": "Email the customer when the quote is accepted.",
        "draft": {"steps": [{"kind": "action", "action_id": "system.send_email", "inputs": {}}]},
        "answer_hints": {"email_template_id": "email_tpl_one"},
        "expected_inputs": {"template_id": "email_tpl_one"},
    },
    {
        "name": "scoped_generate_document_prompt_returns_template_slot",
        "prompt": "Generate a quote PDF when the quote is accepted.",
        "draft": {"steps": [{"kind": "action", "action_id": "system.generate_document", "inputs": {}}]},
        "options_kind": "document_template",
        "options": [{"id": "doc_tpl_one", "label": "Quote PDF", "value": "doc_tpl_one"}],
        "expected_slot_kind": "document_template_choice",
    },
    {
        "name": "scoped_generate_document_prompt_applies_selected_template",
        "prompt": "Generate a quote PDF when the quote is accepted.",
        "draft": {"steps": [{"kind": "action", "action_id": "system.generate_document", "inputs": {}}]},
        "answer_hints": {"document_template_id": "doc_tpl_one"},
        "expected_inputs": {"template_id": "doc_tpl_one"},
    },
]


def _build_email_validation_test(case):
    def test(self):
        validation = self._validate_email(case["draft"])
        self.assertEqual(bool(validation.get("compiled_ok")), case["compiled_ok"], validation)
        for snippet in case.get("message_substrings") or []:
            self.assertTrue(
                any(snippet in str(item.get("message")) for item in (validation.get("errors") or []) if isinstance(item, dict)),
                validation,
            )

    return test


def _build_document_validation_test(case):
    def test(self):
        validation = self._validate_doc(case["draft"])
        self.assertEqual(bool(validation.get("compiled_ok")), case["compiled_ok"], validation)
        for snippet in case.get("message_substrings") or []:
            self.assertTrue(
                any(snippet in str(item.get("message")) for item in (validation.get("errors") or []) if isinstance(item, dict)),
                validation,
            )

    return test


def _build_email_normalizer_test(case):
    def test(self):
        normalized = self._normalize_email(case.get("current"), case.get("candidate"))
        for key, expected in (case.get("expected") or {}).items():
            self.assertEqual(normalized.get(key), expected, normalized)
        for key, snippet in (case.get("expected_substrings") or {}).items():
            self.assertIn(snippet, str(normalized.get(key) or ""), normalized)

    return test


def _build_document_normalizer_test(case):
    def test(self):
        normalized = self._normalize_doc(case.get("current"), case.get("candidate"))
        for key, expected in (case.get("expected") or {}).items():
            self.assertEqual(normalized.get(key), expected, normalized)
        for key, snippet in (case.get("expected_substrings") or {}).items():
            self.assertIn(snippet, str(normalized.get(key) or ""), normalized)

    return test


def _build_automation_recipient_test(case):
    def test(self):
        inputs = copy.deepcopy(case["inputs"])
        main._artifact_ai_normalize_send_email_inputs(inputs, copy.deepcopy(case["meta"]), case["entity_id"])
        for key, expected in (case.get("expected") or {}).items():
            self.assertEqual(inputs.get(key), expected, inputs)
        for key in case.get("absent") or []:
            self.assertNotIn(key, inputs, inputs)

    return test


def _build_automation_inline_validation_test(case):
    def test(self):
        validation = self._validate_automation(case["draft"], case.get("meta"))
        self.assertEqual(bool(validation.get("compiled_ok")), case["compiled_ok"], validation)
        for snippet in case.get("message_substrings") or []:
            self.assertTrue(
                any(snippet in str(item.get("message")) for item in (validation.get("errors") or []) if isinstance(item, dict)),
                validation,
            )

    return test


def _build_template_hint_test(case):
    def test(self):
        def fake_options(kind, workspace_id, limit=8):
            if case.get("options_kind") == "none":
                return []
            if kind == case.get("options_kind"):
                return copy.deepcopy(case.get("options") or [])
            return []

        with patch.object(main, "_ai_workspace_template_decision_options", fake_options):
            ops, assumptions, advisories, questions, question_meta = main._ai_apply_template_hints_to_candidate_ops(
                copy.deepcopy(case["candidate_ops"]),
                case["message"],
                case["workspace_id"],
                answer_hints=copy.deepcopy(case.get("answer_hints") or {}),
            )
        if case.get("expected_slot_kind"):
            self.assertEqual((question_meta or {}).get("slot_kind"), case["expected_slot_kind"], question_meta)
            self.assertTrue(questions)
        if case.get("expected_template_id"):
            step_inputs = ((((ops[0].get("automation") or {}).get("steps") or [{}])[0]).get("inputs") or {})
            self.assertEqual(step_inputs.get("template_id"), case["expected_template_id"], ops)
        if case.get("expected_prepended_op"):
            self.assertEqual((ops[0] or {}).get("op"), case["expected_prepended_op"], ops)
            step_inputs = ((((ops[1].get("automation") or {}).get("steps") or [{}])[0]).get("inputs") or {})
            self.assertTrue(str(step_inputs.get("template_id") or "").startswith(case["expected_step_template_prefix"]), ops)
            if case["expected_prepended_op"] == "create_email_template_record":
                self.assertNotIn("subject", step_inputs)
                self.assertNotIn("body_text", step_inputs)
        if not case.get("expected_slot_kind") and not case.get("expected_template_id") and not case.get("expected_prepended_op"):
            self.assertFalse(questions, questions)
        self.assertIsInstance(assumptions, list)
        self.assertIsInstance(advisories, list)

    return test


def _build_scoped_automation_hint_test(case):
    def test(self):
        def fake_template_options(kind, workspace_id, limit=8):
            if kind == case.get("options_kind"):
                return copy.deepcopy(case.get("options") or [])
            return []

        def fake_member_options(workspace_id, limit=8):
            return [
                {"id": "member_current", "label": "Current User", "value": "user-current"},
                {"id": "member_sales", "label": "Sales", "value": "user-sales"},
            ]

        with patch.object(main, "_ai_workspace_template_decision_options", fake_template_options), patch.object(
            main,
            "_ai_workspace_member_decision_options",
            fake_member_options,
        ):
            draft, assumptions, advisories, questions, question_meta = main._artifact_ai_apply_scoped_automation_hints(
                copy.deepcopy(case["draft"]),
                case["prompt"],
                copy.deepcopy(_automation_meta()),
                "default",
                answer_hints=copy.deepcopy(case.get("answer_hints") or {}),
            )
        if case.get("expected_slot_kind"):
            self.assertEqual((question_meta or {}).get("slot_kind"), case["expected_slot_kind"], question_meta)
            self.assertTrue(questions, questions)
        else:
            self.assertFalse(questions, questions)
        if case.get("expected_inputs"):
            step_inputs = ((((draft.get("steps") or [{}])[0]).get("inputs")) or {})
            for key, expected in case["expected_inputs"].items():
                self.assertEqual(step_inputs.get(key), expected, draft)
        self.assertIsInstance(assumptions, list)
        self.assertIsInstance(advisories, list)

    return test


def _build_studio_matrix_test(case):
    def test(self):
        entity_slug = case["entity_slug"]
        entity_id = f"entity.{entity_slug}"
        list_view_id = f"{entity_slug}.list"
        form_view_id = f"{entity_slug}.form"
        page_id = f"{entity_slug}.list_page"
        manifest = {
            "manifest_version": "1.3",
            "module": {"id": f"{entity_slug}_module", "name": case["title"]},
            "entities": [
                {
                    "id": entity_id,
                    "label": case["title"][:-1] if case["title"].endswith("s") else case["title"],
                    "display_field": f"{entity_slug}.name",
                    "fields": [
                        {"id": f"{entity_slug}.name", "type": "string", "label": "Name", "required": True},
                    ],
                }
            ],
            "views": [
                {"id": list_view_id, "kind": "list", "entity": entity_id, "columns": [{"field_id": f"{entity_slug}.name"}]},
                {"id": form_view_id, "kind": "form", "entity": entity_id, "sections": [{"id": "main", "fields": [f"{entity_slug}.name"]}]},
            ],
            "pages": [],
            "actions": [],
            "workflows": [],
            "app": {"home": f"page:{page_id}", "nav": []},
        }
        if case.get("legacy"):
            manifest["pages"] = [
                {
                    "id": page_id,
                    "title": case["title"],
                    "layout": "single",
                    "content": [{"id": f"{entity_slug}_legacy_list", "kind": "view", "source": f"view:{list_view_id}"}],
                }
            ]
            normalized = main._sanitize_manifest(manifest)
        elif case.get("modern"):
            manifest["pages"] = [
                {
                    "id": page_id,
                    "title": case["title"],
                    "layout": "single",
                    "content": [
                        {
                            "id": f"{entity_slug}_list_shell",
                            "kind": "container",
                            "content": [
                                {
                                    "id": f"{entity_slug}_view_modes",
                                    "kind": "view_modes",
                                    "default_mode": "list",
                                    "modes": [{"id": "list", "label": "List", "source": f"view:{list_view_id}"}],
                                }
                            ],
                        }
                    ],
                }
            ]
            normalized, _ = main.normalize_manifest_v13(copy.deepcopy(manifest), module_id=f"{entity_slug}_module", cache={})
            normalized_again, _ = main.normalize_manifest_v13(copy.deepcopy(normalized), module_id=f"{entity_slug}_module", cache={})
            self.assertEqual(normalized_again["pages"], normalized["pages"])
            normalized = normalized_again
        else:
            manifest["pages"] = [{"id": page_id, "title": case["title"], "layout": "single", "content": []}]
            normalized, _ = main.normalize_manifest_v13(manifest, module_id=f"{entity_slug}_module", cache={})

        page = next(item for item in normalized["pages"] if item.get("id") == page_id)
        blocks = _iter_blocks(page)
        view_modes = [block for block in blocks if block.get("kind") == "view_modes"]
        legacy_views = [block for block in blocks if block.get("kind") == "view" and block.get("source") == f"view:{list_view_id}"]
        self.assertEqual(len(view_modes), 1, normalized)
        self.assertEqual(len(legacy_views), 0, normalized)
        modes = view_modes[0].get("modes") or []
        self.assertTrue(
            any(
                ((mode or {}).get("source") == f"view:{list_view_id}")
                or ((mode or {}).get("target") == f"view:{list_view_id}")
                for mode in modes
            ),
            normalized,
        )

    return test


for _case in EMAIL_VALIDATION_CASES:
    setattr(
        TestTemplateValidationMatrices,
        f"test_{_case['name']}",
        _build_email_validation_test(_case),
    )

for _case in DOCUMENT_VALIDATION_CASES:
    setattr(
        TestTemplateValidationMatrices,
        f"test_{_case['name']}",
        _build_document_validation_test(_case),
    )

for _case in EMAIL_NORMALIZER_CASES:
    setattr(
        TestTemplateNormalizerMatrices,
        f"test_{_case['name']}",
        _build_email_normalizer_test(_case),
    )

for _case in DOCUMENT_NORMALIZER_CASES:
    setattr(
        TestTemplateNormalizerMatrices,
        f"test_{_case['name']}",
        _build_document_normalizer_test(_case),
    )

for _case in AUTOMATION_RECIPIENT_CASES:
    setattr(
        TestAutomationMatrices,
        f"test_{_case['name']}",
        _build_automation_recipient_test(_case),
    )

for _case in AUTOMATION_INLINE_VALIDATION_CASES:
    setattr(
        TestAutomationMatrices,
        f"test_{_case['name']}",
        _build_automation_inline_validation_test(_case),
    )

for _case in TEMPLATE_HINT_CASES:
    setattr(
        TestTemplateHintMatrices,
        f"test_{_case['name']}",
        _build_template_hint_test(_case),
    )

for _case in SCOPED_AUTOMATION_HINT_CASES:
    setattr(
        TestScopedAutomationHintMatrices,
        f"test_{_case['name']}",
        _build_scoped_automation_hint_test(_case),
    )

for _case in STUDIO_CASES:
    setattr(
        TestStudioMatrix,
        f"test_{_case['name']}",
        _build_studio_matrix_test(_case),
    )


if __name__ == "__main__":
    unittest.main()
