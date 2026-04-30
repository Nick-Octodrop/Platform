import os
import sys
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "src")
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
if SRC not in sys.path:
    sys.path.insert(0, SRC)

os.environ["USE_DB"] = "0"
os.environ["OCTO_DISABLE_AUTH"] = "1"
os.environ["SUPABASE_URL"] = "http://localhost"

from app.stores import MemoryJobStore
from app.email import render_template
from app.template_render import describe_template_render_error
from app.secrets import resolve_secret
from app import main
from app import worker
from fastapi.testclient import TestClient


class TestPhase1Jobs(unittest.TestCase):
    def test_job_claim_order_and_idempotency(self) -> None:
        store = MemoryJobStore()
        a = store.enqueue({"type": "email.send", "workspace_id": "w1", "priority": 0, "idempotency_key": "k1"})
        b = store.enqueue({"type": "email.send", "workspace_id": "w1", "priority": 5})
        c = store.enqueue({"type": "doc.generate", "workspace_id": "w1", "priority": 1})
        a2 = store.enqueue({"type": "email.send", "workspace_id": "w1", "priority": 0, "idempotency_key": "k1"})
        self.assertEqual(a["id"], a2["id"])
        claimed = store.claim_batch(2, "worker")
        self.assertEqual(claimed[0]["id"], b["id"])
        self.assertEqual(claimed[1]["id"], c["id"])

    def test_template_render(self) -> None:
        out = render_template("Hello {{record.name}}", {"record": {"name": "Ada"}}, strict=True)
        self.assertEqual(out, "Hello Ada")

    def test_template_render_allows_safe_loop_metadata(self) -> None:
        out = render_template(
            "{% for value in items %}{{ value }}{% if not loop.last %},{% endif %}{% endfor %}",
            {"items": ["A", "B", "C"]},
            strict=True,
        )
        self.assertEqual(out, "A,B,C")

    def test_template_render_supports_slugify_and_tojson_filters(self) -> None:
        out = render_template(
            '{{ sku | slugify | tojson }}',
            {"sku": "TE Sleep+ Support / 60 Caps"},
            strict=True,
        )
        self.assertEqual(out, '"te-sleep-support-60-caps"')

    def test_template_render_allows_safe_dict_read_helpers(self) -> None:
        out = render_template(
            "{% for key, value in record.items() %}{{ key }}={{ value }};{% endfor %}{{ record.get('missing', 'fallback') }}",
            {"record": {"quote": "QUO-1001"}},
            strict=True,
        )
        self.assertEqual(out, "quote=QUO-1001;fallback")

    def test_template_render_allows_saved_template_list_append_and_join(self) -> None:
        out = render_template(
            "{% set spec_parts = [] %}{% set _ = spec_parts.append('400W') %}{% set _ = spec_parts.append('Full Spectrum') %}{{ spec_parts|join(' | ') }}",
            {},
            strict=True,
        )
        self.assertEqual(out, "400W | Full Spectrum")

    def test_customer_quote_template_renders_line_specs(self) -> None:
        template_path = os.path.join(
            ROOT,
            "manifests",
            "commercial_v2",
            "templates",
            "customer_quote_template.html.jinja",
        )
        with open(template_path, encoding="utf-8") as handle:
            template_html = handle.read()
        out = render_template(
            template_html,
            {
                "record": {
                    "biz_quote.quote_number": "QUO-1001",
                    "biz_quote.customer_id_label": "Test Customer",
                    "biz_quote.currency": "EUR",
                    "biz_quote.subtotal": 850,
                    "biz_quote.tax_total": 136,
                    "biz_quote.grand_total": 986,
                },
                "line_items": [
                    {
                        "biz_quote_line.description": "Test fixture",
                        "biz_quote_line.quantity": 1,
                        "biz_quote_line.uom": "ea",
                        "biz_quote_line.unit_price": 850,
                        "biz_quote_line.line_total": 850,
                        "biz_quote_line.wattage_snapshot": 400,
                        "biz_quote_line.spectrum_snapshot": "Full Spectrum",
                        "biz_quote_line.ip_rating_snapshot": "IP66",
                    }
                ],
                "template_branding": {},
                "company": {},
                "workspace": {},
            },
            strict=True,
        )
        self.assertIn("400W | Full Spectrum | IP66", out)

    def test_worker_alarm_timeout_bounds_document_generation(self) -> None:
        with self.assertRaises(TimeoutError):
            worker._run_with_alarm_timeout("Document generation", 0.01, lambda: time.sleep(1))

    def test_template_render_keeps_custom_function_calls_blocked_with_clear_message(self) -> None:
        with self.assertRaises(Exception) as raised:
            render_template("{{ format_currency(100) }}", {"record": {}}, strict=True)
        self.assertIn("unsupported value", describe_template_render_error(raised.exception))

    def test_secret_env_fallback(self) -> None:
        os.environ["APP_ENV"] = "dev"
        os.environ["POSTMARK_API_TOKEN"] = "tok_test"
        value = resolve_secret(None, "default", env_key="POSTMARK_API_TOKEN")
        self.assertEqual(value, "tok_test")

    def test_document_job_enqueue(self) -> None:
        client = TestClient(main.app)
        res = client.post(
            "/documents/generate",
            json={"template_id": "t1", "entity_id": "entity.contact", "record_id": "r1"},
        )
        self.assertEqual(res.status_code, 200)
        payload = res.json()
        self.assertTrue(payload.get("ok"))
        self.assertEqual(payload["job"]["type"], "doc.generate")
        self.assertIsInstance(payload["job"]["payload"]["actor_user_id"], str)
        self.assertTrue(payload["job"]["payload"]["actor_user_id"])

    def test_resolve_document_template_record_source_uses_related_quote_from_document(self) -> None:
        original_store = main.generic_records
        main.generic_records = main.MemoryGenericRecordStore()
        try:
            created_quote = main.generic_records.create(
                "entity.biz_quote",
                {
                    "biz_quote.quote_number": "QUO-1001",
                    "biz_quote.quote_script_body": "## Scope\n**Quoted work**",
                },
            )
            related_quote_id = created_quote.get("id")
            entity_id, entity_def, record = main._resolve_document_template_record_source(
                {"variables_schema": {"entity_id": "entity.biz_quote"}},
                "entity.biz_document",
                {"biz_document.related_quote_id": related_quote_id},
            )
            self.assertEqual(entity_id, "entity.biz_quote")
            self.assertIsNone(entity_def)
            self.assertEqual(record.get("biz_quote.quote_number"), "QUO-1001")
            self.assertEqual(record.get("biz_quote.quote_script_body"), "## Scope\n**Quoted work**")
        finally:
            main.generic_records = original_store

    def test_doc_generate_worker_uses_preview_normalization_and_actor_locale(self) -> None:
        template = {
            "id": "tpl_1",
            "name": "Quote",
            "html": "RAW HTML",
            "header_html": "RAW HEADER",
            "footer_html": "RAW FOOTER",
            "filename_pattern": "raw-file",
            "paper_size": "A4",
            "margin_top": "12mm",
            "margin_right": "12mm",
            "margin_bottom": "12mm",
            "margin_left": "12mm",
        }
        record = {"record": {"id": "rec_1", "contact.name": "Ada"}}
        captured: dict[str, object] = {}

        class _FakeDocStore:
            def get(self, template_id):
                self.last_template_id = template_id
                return dict(template)

        class _FakeAttachmentStore:
            def create_attachment(self, payload):
                captured["attachment_payload"] = dict(payload)
                return {"id": "att_1"}

            def link(self, payload):
                captured.setdefault("links", []).append(dict(payload))

        class _FakeRecordStore:
            def get(self, entity_id, record_id):
                captured["record_lookup"] = (entity_id, record_id)
                return dict(record)

        class _FakeAppMain:
            def __init__(self) -> None:
                self.registry = SimpleNamespace(list=lambda: [])
                self.store = SimpleNamespace(get_snapshot=lambda *_args, **_kwargs: {})

            def _artifact_ai_normalize_doc_template_draft(self, current, candidate):
                captured["normalized_from"] = dict(current or {})
                captured["normalized_candidate"] = candidate
                normalized = dict(current or {})
                normalized.update(
                    {
                        "html": "NORMALIZED HTML",
                        "header_html": "NORMALIZED HEADER",
                        "footer_html": "NORMALIZED FOOTER",
                        "filename_pattern": "normalized-file",
                        "paper_size": "Letter",
                        "margin_top": "0mm",
                    }
                )
                return normalized

            def _build_template_render_context(self, record_data, entity_def, entity_id, branding, localization=None):
                captured["context_record"] = dict(record_data)
                captured["context_entity_id"] = entity_id
                captured["context_localization"] = dict(localization or {})
                return {"record": dict(record_data)}

            def _resolve_document_template_record_source(self, template, entity_id, record_data):
                captured["resolved_source_template"] = dict(template or {})
                captured["resolved_source_entity_id"] = entity_id
                return entity_id, {"id": entity_id, "fields": []}, dict(record_data)

            def _branding_context_for_org(self, _org_id):
                return {}

            def _localization_context_for_actor(self, actor=None):
                captured["localization_actor"] = dict(actor or {})
                return {"locale": actor.get("user_id") if isinstance(actor, dict) else ""}

        def _fake_render_pdf(html, paper_size, margins, header_html, footer_html):
            captured["pdf_html"] = html
            captured["pdf_paper_size"] = paper_size
            captured["pdf_margins"] = dict(margins or {})
            captured["pdf_header_html"] = header_html
            captured["pdf_footer_html"] = footer_html
            return b"%PDF-1.4\nworker\n%%EOF"

        def _fake_store_bytes(org_id, filename, data, mime_type="application/octet-stream"):
            captured["stored"] = {
                "org_id": org_id,
                "filename": filename,
                "size": len(data or b""),
                "mime_type": mime_type,
            }
            return {"size": len(data or b""), "storage_key": f"{org_id}/{filename}", "sha256": "hash"}

        with (
            patch("app.worker.DbDocTemplateStore", return_value=_FakeDocStore()),
            patch("app.worker.DbAttachmentStore", return_value=_FakeAttachmentStore()),
            patch("app.worker.DbGenericRecordStore", return_value=_FakeRecordStore()),
            patch("app.worker._get_app_main", return_value=_FakeAppMain()),
            patch(
                "app.worker._get_entity_def_resolver",
                return_value=lambda _registry, _snapshot_getter, entity_id: ("mod", {"id": entity_id, "fields": []}, {}),
            ),
            patch("app.worker._get_doc_render_helpers", return_value=(lambda html, context: html, _fake_render_pdf, lambda margins: margins)),
            patch("app.worker._get_attachment_helpers", return_value=(_fake_store_bytes, lambda *_args, **_kwargs: b"", lambda *_args, **_kwargs: None)),
        ):
            worker._handle_doc_generate(
                {
                    "payload": {
                        "template_id": "tpl_1",
                        "entity_id": "entity.contact",
                        "record_id": "rec_1",
                        "actor_user_id": "user_123",
                    }
                },
                "default",
            )

        self.assertEqual(captured.get("pdf_html"), "NORMALIZED HTML")
        self.assertEqual(captured.get("pdf_header_html"), "NORMALIZED HEADER")
        self.assertEqual(captured.get("pdf_footer_html"), "NORMALIZED FOOTER")
        self.assertEqual(captured.get("pdf_paper_size"), "Letter")
        self.assertEqual(captured.get("pdf_margins", {}).get("top"), "0mm")
        self.assertEqual(captured.get("localization_actor"), {"user_id": "user_123"})
        self.assertEqual(captured.get("context_localization"), {"locale": "user_123"})
        self.assertEqual(captured.get("stored", {}).get("filename"), "normalized-file.pdf")

    def test_doc_generate_worker_mirrors_document_attachment_back_to_quote(self) -> None:
        template = {
            "id": "tpl_quote",
            "name": "Quote",
            "html": "QUOTE HTML",
            "header_html": "",
            "footer_html": "",
            "filename_pattern": "quote-file",
            "paper_size": "A4",
            "margin_top": "12mm",
            "margin_right": "12mm",
            "margin_bottom": "12mm",
            "margin_left": "12mm",
            "variables_schema": {"entity_id": "entity.biz_quote"},
        }
        document_record = {
            "id": "doc_1",
            "biz_document.document_type": "quote_pdf",
            "biz_document.related_quote_id": "quote_1",
        }
        quote_record = {
            "id": "quote_1",
            "biz_quote.quote_number": "QUO-1001",
            "biz_quote.quote_script_body": "## Scope\nQuoted work",
        }
        captured: dict[str, object] = {}

        class _FakeDocStore:
            def get(self, template_id):
                self.last_template_id = template_id
                return dict(template)

        class _FakeAttachmentStore:
            def create_attachment(self, payload):
                captured["attachment_payload"] = dict(payload)
                return {"id": "att_1"}

            def link(self, payload):
                captured.setdefault("links", []).append(dict(payload))

        class _FakeRecordStore:
            def __init__(self) -> None:
                self.rows = {
                    ("entity.biz_document", "doc_1"): dict(document_record),
                    ("entity.biz_quote", "quote_1"): dict(quote_record),
                }

            def get(self, entity_id, record_id):
                row = self.rows.get((entity_id, record_id))
                if row is None and isinstance(entity_id, str) and entity_id.startswith("entity."):
                    row = self.rows.get((entity_id[7:], record_id))
                if row is None:
                    return None
                return {"record": dict(row)}

            def update(self, entity_id, record_id, values):
                self.rows[(entity_id, record_id)] = dict(values)
                captured.setdefault("updates", []).append((entity_id, record_id, dict(values)))
                return {"record": dict(values)}

        record_store = _FakeRecordStore()

        class _FakeAppMain:
            def __init__(self) -> None:
                self.registry = SimpleNamespace(list=lambda: [])
                self.store = SimpleNamespace(get_snapshot=lambda *_args, **_kwargs: {})

            def _artifact_ai_normalize_doc_template_draft(self, current, candidate):
                return dict(current or {})

            def _build_template_render_context(self, record_data, entity_def, entity_id, branding, localization=None):
                captured["context_record"] = dict(record_data)
                captured["context_entity_id"] = entity_id
                return {"record": dict(record_data)}

            def _resolve_document_template_record_source(self, source_template, entity_id, record_data):
                captured["resolved_source_entity_id"] = entity_id
                captured["resolved_source_record"] = dict(record_data)
                return "entity.biz_quote", {"id": "entity.biz_quote", "fields": []}, dict(quote_record)

            def _branding_context_for_org(self, _org_id):
                return {}

            def _localization_context_for_actor(self, actor=None):
                return {}

        def _fake_store_bytes(org_id, filename, data, mime_type="application/octet-stream"):
            captured["stored"] = {
                "org_id": org_id,
                "filename": filename,
                "size": len(data or b""),
                "mime_type": mime_type,
            }
            return {"size": len(data or b""), "storage_key": f"{org_id}/{filename}", "sha256": "hash"}

        manifest = {
            "interfaces": {
                "documentable": [
                    {
                        "entity_id": "entity.biz_document",
                        "attachment_field": "biz_document.attachments",
                    }
                ]
            }
        }

        with (
            patch("app.worker.DbDocTemplateStore", return_value=_FakeDocStore()),
            patch("app.worker.DbAttachmentStore", return_value=_FakeAttachmentStore()),
            patch("app.worker.DbGenericRecordStore", return_value=record_store),
            patch("app.worker._get_app_main", return_value=_FakeAppMain()),
            patch(
                "app.worker._get_entity_def_resolver",
                return_value=lambda _registry, _snapshot_getter, entity_id: ("mod", {"id": entity_id, "fields": []}, manifest),
            ),
            patch("app.worker._get_doc_render_helpers", return_value=(lambda html, context: html, lambda *_args, **_kwargs: b"%PDF-1.4\nworker\n%%EOF", lambda margins: margins)),
            patch("app.worker._get_attachment_helpers", return_value=(_fake_store_bytes, lambda *_args, **_kwargs: b"", lambda *_args, **_kwargs: None)),
        ):
            worker._handle_doc_generate(
                {
                    "payload": {
                        "template_id": "tpl_quote",
                        "entity_id": "entity.biz_document",
                        "record_id": "doc_1",
                    }
                },
                "default",
            )

        self.assertEqual(captured.get("context_entity_id"), "entity.biz_quote")
        self.assertEqual(captured.get("context_record", {}).get("biz_quote.quote_number"), "QUO-1001")
        self.assertEqual(record_store.rows[("entity.biz_document", "doc_1")].get("biz_document.attachments"), [{"id": "att_1", "filename": None, "mime_type": None, "size": None, "storage_key": None}])
        self.assertEqual(record_store.rows[("entity.biz_quote", "quote_1")].get("biz_quote.generated_files"), [{"id": "att_1", "filename": None, "mime_type": None, "size": None, "storage_key": None}])
        self.assertIn(
            {"attachment_id": "att_1", "entity_id": "entity.biz_quote", "record_id": "quote_1", "purpose": "quote_pdf"},
            captured.get("links", []),
        )
