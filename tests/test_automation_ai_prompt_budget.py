import os
from types import SimpleNamespace
from unittest.mock import patch

os.environ["OCTO_DISABLE_AUTH"] = "1"

import app.main as main


def _fake_response(payload: dict) -> dict:
    return {"choices": [{"message": {"content": main._json_prompt_payload(payload)}}]}


def test_automation_ai_plan_trims_large_workspace_context_before_openai_call():
    entities = []
    for idx in range(220):
        entities.append(
            {
                "id": f"entity.noisy_{idx}",
                "label": f"Noisy Entity {idx}",
                "module_id": f"noisy_{idx}",
                "fields": [
                    {"id": f"noisy_{idx}.field_{field_idx}", "label": f"Very noisy field {field_idx}", "type": "text"}
                    for field_idx in range(90)
                ],
            }
        )
    contact_entity = {
        "id": "entity.biz_contact",
        "label": "Contact",
        "module_id": "contacts",
        "fields": [
            {"id": "biz_contact.name", "label": "Name", "type": "text"},
            {"id": "biz_contact.email", "label": "Email", "type": "email"},
            {"id": "biz_contact.owner_user_id", "label": "Owner", "type": "user"},
        ],
    }
    entities.append(contact_entity)
    full_meta = {
        "current_user_id": "user_1",
        "entities": entities,
        "field_path_catalog": main._artifact_ai_automation_field_path_catalog(entities),
        "event_types": ["record.created", "record.updated"],
        "event_catalog": [
            {
                "id": "contact.created",
                "label": "Contact created",
                "event": "record.created",
                "entity_id": "entity.biz_contact",
                "kind": "record_event",
                "source_module_id": "contacts",
            }
        ],
        "system_actions": [{"id": "system.notify", "label": "Notify workspace users"}],
        "action_contracts": [],
        "trigger_contracts": [],
        "step_kind_contracts": [],
        "condition_contract": {},
        "runtime_context": {},
        "editor_settings": {},
        "module_actions": [],
        "members": [{"user_id": "user_1", "name": "Nick", "email": "nick@example.com"}],
        "connections": [],
        "email_templates": [],
        "doc_templates": [],
        "integration_mappings": [],
    }
    current = {
        "name": "Contact automation",
        "description": "",
        "trigger": {"kind": "event", "event_types": ["record.created"], "filters": []},
        "steps": [],
        "status": "draft",
    }
    context_payload = {
        "kind": "automation",
        "current_draft": current,
        "current_validation": {"compiled_ok": True, "errors": []},
        "requested_focus": "logic",
        "shared_capability_catalog": {"artifacts": {"automation": {"focus_modes": ["logic"]}}},
        "meta": full_meta,
        "reference_contract": main._artifact_ai_automation_reference_contract(full_meta),
        "selected_entity_id": "entity.biz_contact",
        "selected_entity": contact_entity,
        "selected_entity_summary": main._artifact_ai_template_entity_summary(contact_entity),
        "template_helpers": {},
        "safe_jinja_examples": {},
        "references": {},
        "output_checklist": [],
    }

    captured = {}

    def fake_openai(messages, model=None, temperature=0.2, response_format=None):
        captured["messages"] = messages
        return _fake_response(
            {
                "summary": "Notify when a contact is created.",
                "draft": {
                    **current,
                    "steps": [
                        {
                            "kind": "action",
                            "action_id": "system.notify",
                            "inputs": {"recipient_user_id": "user_1", "title": "New contact", "body": "A contact was created."},
                        }
                    ],
                },
                "assumptions": [],
                "warnings": [],
            }
        )

    request = SimpleNamespace(state=SimpleNamespace())
    with (
        patch.object(main, "_ai_build_shared_context", return_value={"workspace_id": "default"}),
        patch.object(main, "_artifact_ai_prompt_context", return_value=context_payload),
        patch.object(main, "_artifact_ai_normalize_automation_draft", side_effect=lambda _current, candidate, _meta: candidate),
        patch.object(main, "_artifact_ai_validate_automation_draft", return_value={"compiled_ok": True, "errors": []}),
        patch.object(main, "_artifact_ai_template_safe_jinja_examples", return_value={}),
        patch.object(main, "_ai_artifact_capability_details", return_value={"focus_modes": ["logic"], "focus_guidance": {}, "shared_prompt_heuristics": []}),
        patch.object(main, "_openai_chat_completion", fake_openai),
    ):
        result = main._artifact_ai_generate_plan(
            "automation",
            request,
            {"user_id": "user_1", "workspace_id": "default"},
            "make this automation send a notification when a new contact is created",
            current,
            requested_focus="logic",
        )

    assert result["summary"] == "Notify when a contact is created."
    context_message = next(message["content"] for message in captured["messages"] if message["content"].startswith("context.json"))
    assert len(context_message) < 65000
    assert "entity.biz_contact" in context_message
    assert "noisy_219.field_89" not in context_message
    assert "relevance_trimmed" in context_message
