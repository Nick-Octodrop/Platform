import json
import tempfile
import unittest
from pathlib import Path

from scripts.octo_ai_self_heal_loop import (
    ARCHITECTURE_CONTRACT,
    _build_failure_digest,
    _build_fix_prompt,
    _build_replay_suite,
    _representative_failure_names,
)


class TestOctoAiSelfHealLoop(unittest.TestCase):
    def test_failure_digest_clusters_failed_scenarios(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            run_dir = Path(tmpdir)
            iteration_dir = run_dir / "iteration_001"
            iteration_dir.mkdir(parents=True, exist_ok=True)
            (iteration_dir / "contacts_add_birthday.json").write_text(
                json.dumps(
                    {
                        "name": "contacts_add_birthday",
                        "status": "failed",
                        "passed": False,
                        "failure_stage": "generate_patchset",
                        "failure_reason": "expected ok=True, got ok=False status=400",
                        "steps": [
                            {
                                "step": "generate_patchset",
                                "status": "failed",
                                "response": {"status_code": 400, "body": {"errors": [{"message": "No candidate operations"}]}},
                                "error": "expected ok=True, got ok=False status=400",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            (iteration_dir / "create_vehicle_logbook.json").write_text(
                json.dumps({"name": "create_vehicle_logbook", "status": "passed", "passed": True, "steps": []}),
                encoding="utf-8",
            )
            summary = {"scenario_total": 2, "scenario_successes": 1, "scenario_failures": 1}

            digest = _build_failure_digest(run_dir, summary)

            self.assertEqual(digest["scenario_failures"], 1)
            self.assertEqual(len(digest["failed_scenarios"]), 1)
            self.assertEqual(digest["failed_scenarios"][0]["name"], "contacts_add_birthday")
            self.assertEqual(digest["top_failure_clusters"][0]["failure_stage"], "generate_patchset")

    def test_fix_prompt_points_codex_at_digest_first(self) -> None:
        prompt = _build_fix_prompt(
            Path("/tmp/run_001"),
            {"scenario_total": 100, "scenario_successes": 47, "scenario_failures": 53},
            1,
            "Brief body",
            digest={
                "top_failure_clusters": [
                    {"failure_stage": "chat", "count": 3, "failure_reason": "missing Planned changes:"}
                ]
            },
            scoreboard={"scenario_total": 100, "scenario_successes": 47, "scenario_failures": 53, "overall_pass_rate": 47.0},
            curriculum_status={"evaluated_level": 1, "current_level_after_run": 1, "current_level_pass_rate": 47.0, "streak": 0, "required_streak": 2},
            representative_names=["preview_large_system_brief_service_ops"],
        )
        self.assertIn("scoreboard.md", prompt)
        self.assertIn("curriculum_status.md", prompt)
        self.assertIn("Top failure clusters:", prompt)
        self.assertIn("preview_large_system_brief_service_ops", prompt)
        self.assertIn("failure_digest.json", prompt)
        self.assertIn("If `rg` is unavailable", prompt)
        self.assertIn(str(ARCHITECTURE_CONTRACT), prompt)
        self.assertIn("architecture contract wins", prompt)

    def test_representative_failure_names_prefers_one_per_cluster(self) -> None:
        digest = {
            "top_failure_clusters": [
                {
                    "failure_stage": "chat",
                    "failure_reason": "missing Planned changes:",
                    "count": 2,
                    "example_scenarios": [
                        {"name": "scenario_a"},
                        {"name": "scenario_b"},
                    ],
                },
                {
                    "failure_stage": "chat",
                    "failure_reason": "expected confirm_plan",
                    "count": 1,
                    "example_scenarios": [
                        {"name": "scenario_c"},
                    ],
                },
            ]
        }
        self.assertEqual(_representative_failure_names(digest), ["scenario_a", "scenario_c"])

    def test_build_replay_suite_filters_to_named_scenarios(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            source_suite = root / "active_suite.json"
            output_suite = root / "replay_suite.json"
            source_suite.write_text(
                json.dumps(
                    [
                        {"name": "scenario_a", "steps": []},
                        {"name": "scenario_b", "steps": []},
                    ]
                ),
                encoding="utf-8",
            )

            replay_suite = _build_replay_suite(source_suite, ["scenario_b"], output_suite)

            self.assertEqual(len(replay_suite), 1)
            self.assertEqual(replay_suite[0]["name"], "scenario_b")
            self.assertTrue(output_suite.exists())


if __name__ == "__main__":
    unittest.main()
