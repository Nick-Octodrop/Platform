import json
import tempfile
import unittest
from pathlib import Path

from scripts.build_octo_ai_planner_preview_suite import build_suite
from scripts.octo_ai_eval_scoreboard import build_scoreboard


ROOT = Path(__file__).resolve().parents[1]


class TestOctoAiEvalScoreboard(unittest.TestCase):
    def test_build_suite_contains_preview_tags(self) -> None:
        suite = build_suite()
        self.assertGreaterEqual(len(suite), 18)
        self.assertTrue(any("multi_request" in item.get("tags", []) for item in suite))
        self.assertTrue(any("preview_contract" in item.get("tags", []) for item in suite))
        self.assertTrue(any("workspace_graph" in item.get("tags", []) for item in suite))
        self.assertTrue(any("sandbox_rollout" in item.get("tags", []) for item in suite))
        self.assertTrue(any("long_guide" in item.get("tags", []) for item in suite))

    def test_committed_planner_preview_suite_matches_builder(self) -> None:
        committed = json.loads((ROOT / "specs" / "octo_ai_eval_planner_preview_suite.json").read_text(encoding="utf-8"))
        self.assertEqual(committed, build_suite())

    def test_scoreboard_groups_by_tag_and_detects_jargon(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            run_dir = Path(tmpdir)
            (run_dir / "summary.json").write_text(
                json.dumps({"scenario_total": 2, "scenario_successes": 1, "scenario_failures": 1}),
                encoding="utf-8",
            )
            iteration_dir = run_dir / "iteration_001"
            iteration_dir.mkdir(parents=True, exist_ok=True)
            (iteration_dir / "preview_contacts_add_birthday.json").write_text(
                json.dumps(
                    {
                        "name": "preview_contacts_add_birthday",
                        "status": "passed",
                        "passed": True,
                        "steps": [
                            {
                                "response": {
                                    "body": {
                                        "assistant_text": "I understand this as:\nPlanned changes:\n- Add field 'Birthday' (date) in Contacts."
                                    }
                                }
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            (iteration_dir / "preview_cross_module_contacts_jobs_bundle.json").write_text(
                json.dumps(
                    {
                        "name": "preview_cross_module_contacts_jobs_bundle",
                        "status": "failed",
                        "passed": False,
                        "failure_stage": "generate_patchset",
                        "failure_reason": "Planner requires clarification",
                        "steps": [
                            {
                                "response": {
                                    "body": {
                                        "assistant_text": "candidate_operations leaked into the reply"
                                    }
                                }
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            scenario_file = run_dir / "suite.json"
            scenario_file.write_text(
                json.dumps(
                    [
                        {"name": "preview_contacts_add_birthday", "tags": ["preview_contract", "contacts_change"], "level": 1},
                        {"name": "preview_cross_module_contacts_jobs_bundle", "tags": ["preview_contract", "cross_module"], "level": 4},
                    ]
                ),
                encoding="utf-8",
            )

            scoreboard = build_scoreboard(run_dir, scenario_file)

            self.assertEqual(scoreboard["scenario_total"], 2)
            self.assertEqual(scoreboard["scenario_successes"], 1)
            self.assertIn("preview_contract", scoreboard["by_tag"])
            self.assertIn("cross_module", scoreboard["by_tag"])
            self.assertIn("1", scoreboard["by_level"])
            self.assertIn("4", scoreboard["by_level"])
            self.assertEqual(scoreboard["by_tag"]["cross_module"]["failed"], 1)
            self.assertEqual(scoreboard["failure_stages"]["generate_patchset"], 1)
            self.assertEqual(scoreboard["assistant_jargon_leaks"][0]["name"], "preview_cross_module_contacts_jobs_bundle")


if __name__ == "__main__":
    unittest.main()
