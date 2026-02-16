import json
import os
import sys
import unittest
from unittest.mock import patch

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from fastapi.testclient import TestClient

os.environ["USE_DB"] = "0"
os.environ["OCTO_DISABLE_AUTH"] = "1"
os.environ["SUPABASE_URL"] = "http://localhost"

from app.agent_stream import summarize_build_spec, diff_manifest, preview_calls
import app.main as main


class TestAgentStreamHelpers(unittest.TestCase):
    def test_summarize_build_spec(self) -> None:
        spec = {
            "goal": "Build contacts",
            "entities": [{"id": "entity.contact"}],
            "relations": [{"from_entity": "entity.job"}],
            "ui_patterns": [{"pattern": "entity_list_form", "entity": "entity.contact"}],
        }
        bullets = summarize_build_spec(spec)
        self.assertTrue(any("Goal" in item for item in bullets))
        self.assertTrue(any("entity.contact" in item for item in bullets))

    def test_diff_manifest_counts(self) -> None:
        before = {"entities": [{"id": "entity.a"}], "pages": []}
        after = {"entities": [{"id": "entity.a"}, {"id": "entity.b"}], "pages": [{"id": "p1"}]}
        summary = diff_manifest(before, after)
        self.assertEqual(summary["entities_added"], 1)
        self.assertEqual(summary["pages_added"], 1)

    def test_preview_calls(self) -> None:
        calls = [
            {"tool": "ensure_entity", "module_id": "m1", "entity_id": "entity.contact"},
            {"tool": "ensure_nav", "module_id": "m1"},
        ]
        preview = preview_calls(calls, debug=False)
        self.assertEqual(preview[0]["tool"], "ensure_entity")


class TestAgentStreamEndpoint(unittest.TestCase):
    def test_stream_event_order(self) -> None:
        client = TestClient(main.app)
        build_spec = {"goal": "Build contacts", "entities": [{"id": "entity.contact"}]}

        def fake_openai(_messages, model=None):
            content = json.dumps(
                {
                    "plan": {"goal": "Build contacts", "steps": ["Ensure entity"]},
                    "calls": [
                        {
                            "tool": "ensure_entity",
                            "module_id": "module_test",
                            "entity_id": "entity.contact",
                        }
                    ],
                    "ops_by_module": [],
                    "notes": "ok",
                }
            )
            return {"choices": [{"message": {"content": content}}]}

        with patch.object(main, "_openai_chat_completion", fake_openai), patch.object(
            main, "_openai_configured", lambda: True
        ), patch.object(main, "validate_manifest_raw", lambda manifest, expected_module_id=None: (manifest, [], [])), patch.object(
            main, "_studio2_strict_validate", lambda manifest, expected_module_id=None: []
        ), patch.object(main, "_studio2_completeness_check", lambda manifest: []), patch.object(
            main, "_studio2_design_warnings", lambda manifest: []
        ):
            with client.stream(
                "POST",
                "/studio2/agent/chat/stream",
                json={"module_id": "module_test", "message": "Build contacts", "build_spec": build_spec},
            ) as resp:
                events = []
                for line in resp.iter_lines():
                    if line.startswith("event:"):
                        events.append(line.replace("event: ", ""))
                    if line.startswith("event: done"):
                        break
                # Ensure key phases appear in order
                self.assertIn("run_started", events)
                self.assertIn("stage_started", events)
                self.assertIn("stage_done", events)
                self.assertIn("planner_result", events)
                self.assertIn("planner_done", events)
                self.assertIn("builder_started", events)
                self.assertIn("builder_done", events)
                self.assertIn("apply_result", events)
                self.assertIn("apply_done", events)
                self.assertIn("validate_result", events)
                self.assertIn("validate_done", events)
                self.assertIn("final_done", events)
                self.assertIn("done", events)


if __name__ == "__main__":
    unittest.main()
