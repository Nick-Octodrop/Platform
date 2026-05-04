import os
from fastapi.testclient import TestClient
from unittest.mock import patch

os.environ["OCTO_DISABLE_AUTH"] = "1"

import app.main as main


DOC_ENTITY = {
    "id": "entity.biz_document",
    "fields": [
        {"id": "biz_document.name", "type": "text"},
        {"id": "biz_document.attachments", "type": "attachments"},
    ],
    "display": {"title_field": "biz_document.name"},
}

QUOTE_ENTITY = {
    "id": "entity.biz_quote",
    "fields": [
        {"id": "biz_quote.number", "type": "text"},
        {"id": "biz_quote.generated_files", "type": "attachments"},
    ],
    "display": {"title_field": "biz_quote.number"},
}

DOC_MANIFEST = {
    "interfaces": {
        "documentable": [
            {
                "entity_id": "entity.biz_document",
                "enabled": True,
                "attachment_field": "biz_document.attachments",
                "title_field": "biz_document.name",
            }
        ]
    }
}

QUOTE_MANIFEST = {}


class FakeGenericRecords:
    def __init__(self):
        self.records = {
            ("entity.biz_document", "doc_1"): {
                "record_id": "doc_1",
                "record": {
                    "id": "doc_1",
                    "biz_document.name": "Terms Pack",
                    "biz_document.attachments": [{"id": "att_1", "filename": "terms.pdf"}],
                },
            },
            ("entity.biz_quote", "quote_1"): {
                "record_id": "quote_1",
                "record": {"id": "quote_1", "biz_quote.number": "QUO-1"},
            },
        }

    def get(self, entity_id, record_id):
        item = self.records.get((entity_id, record_id))
        return {"record_id": record_id, "record": dict(item["record"])} if item else None

    def list(self, entity_id, limit=50, offset=0, q=None, search_fields=None):
        rows = [item for (ent, _rid), item in self.records.items() if ent == entity_id]
        if q:
            needle = str(q).lower()
            rows = [
                item
                for item in rows
                if needle in str(item.get("record", {}).get("biz_document.name", "")).lower()
            ]
        return rows[offset : offset + limit]

    def update(self, entity_id, record_id, record):
        self.records[(entity_id, record_id)] = {"record_id": record_id, "record": dict(record)}
        return self.records[(entity_id, record_id)]


class FakeAttachmentStore:
    def __init__(self):
        self.attachments = {
            "att_1": {
                "id": "att_1",
                "filename": "terms.pdf",
                "mime_type": "application/pdf",
                "size": 123,
                "storage_key": "default/terms.pdf",
            }
        }
        self.links = []

    def get_attachment(self, attachment_id):
        item = self.attachments.get(attachment_id)
        return dict(item) if item else None

    def list_links(self, entity_id, record_id, purpose=None):
        return [
            dict(link)
            for link in self.links
            if link["entity_id"] == entity_id
            and link["record_id"] == record_id
            and (purpose is None or link["purpose"] == purpose)
        ]

    def link(self, record):
        item = {
            "id": f"link_{len(self.links) + 1}",
            "attachment_id": record["attachment_id"],
            "entity_id": record["entity_id"],
            "record_id": record["record_id"],
            "purpose": record.get("purpose") or "default",
        }
        self.links.append(item)
        return dict(item)


def _entity_index():
    return {
        "entity.biz_document": ("documents", DOC_ENTITY, DOC_MANIFEST),
        "entity.biz_quote": ("quotes", QUOTE_ENTITY, QUOTE_MANIFEST),
    }


def _find_entity(_request, entity_id):
    return _entity_index().get(entity_id)


def test_add_from_documents_links_existing_file_and_updates_target_field():
    generic_records = FakeGenericRecords()
    attachment_store = FakeAttachmentStore()
    actor = {"platform_role": "superadmin", "user_id": "user_1"}

    def update_record(_request, entity_id, _entity_def, record_id, record, before_record=None):
        generic_records.update(entity_id, record_id, record)
        return {"record": record}

    with (
        TestClient(main.app) as client,
        patch.object(main, "_resolve_actor", lambda _request: actor),
        patch.object(main, "_get_entity_registry_index", lambda _request: _entity_index()),
        patch.object(main, "_find_entity_def", _find_entity),
        patch.object(main, "generic_records", generic_records),
        patch.object(main, "attachment_store", attachment_store),
        patch.object(main, "_update_record_with_computed_fields", update_record),
        patch.object(main, "_activity_add_attachment_event", lambda *args, **kwargs: None),
    ):
        sources = client.get("/attachments/document-sources")
        assert sources.status_code == 200
        assert sources.json()["sources"][0]["entity_id"] == "entity.biz_document"

        documents = client.get("/attachments/document-sources/entity.biz_document/documents")
        assert documents.status_code == 200
        assert documents.json()["documents"][0]["attachment_count"] == 1

        response = client.post(
            "/records/entity.biz_quote/quote_1/attachments/from-documents",
            json={
                "document_entity_id": "entity.biz_document",
                "document_ids": ["doc_1"],
                "attachment_field_id": "biz_quote.generated_files",
            },
        )
        assert response.status_code == 200
        assert response.json()["attachments"][0]["id"] == "att_1"

    quote = generic_records.get("entity.biz_quote", "quote_1")["record"]
    assert quote["biz_quote.generated_files"][0]["id"] == "att_1"
    assert any(
        link["entity_id"] == "entity.biz_document"
        and link["record_id"] == "doc_1"
        and link["purpose"] == "field:biz_document.attachments"
        for link in attachment_store.links
    )
    assert any(
        link["entity_id"] == "entity.biz_quote"
        and link["record_id"] == "quote_1"
        and link["purpose"] == "field:biz_quote.generated_files"
        for link in attachment_store.links
    )
