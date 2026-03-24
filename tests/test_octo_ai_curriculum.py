import json
import tempfile
import unittest
from pathlib import Path

from scripts.build_octo_ai_planner_preview_suite import build_suite
from scripts.octo_ai_curriculum import LEVELS, build_active_suite, load_state, update_curriculum_state


class TestOctoAiCurriculum(unittest.TestCase):
    def test_curriculum_includes_advanced_levels(self) -> None:
        self.assertEqual(max(level["level"] for level in LEVELS), 8)
        self.assertEqual(LEVELS[-1]["name"], "long_guides")

    def test_build_active_suite_starts_at_level_one_and_adds_provisionals(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            base_suite_path = root / "suite.json"
            state_path = root / "curriculum_state.json"
            output_path = root / "active_suite.json"
            base_suite_path.write_text(json.dumps(build_suite()), encoding="utf-8")

            status = build_active_suite(base_suite_path, state_path, output_path, max_provisional=2)
            active_suite = json.loads(output_path.read_text(encoding="utf-8"))

            self.assertEqual(status["current_level"], 1)
            self.assertEqual(status["provisional_count"], 2)
            self.assertTrue(all(int(item.get("level") or 1) == 1 for item in active_suite))
            self.assertTrue(any(item.get("curriculum", {}).get("kind") == "provisional" for item in active_suite))

    def test_update_curriculum_unlocks_next_level_after_strong_run(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            base_suite_path = root / "suite.json"
            state_path = root / "curriculum_state.json"
            output_path = root / "active_suite.json"
            run_dir = root / "run_001"
            iteration_dir = run_dir / "iteration_001"
            iteration_dir.mkdir(parents=True, exist_ok=True)
            base_suite_path.write_text(json.dumps(build_suite()), encoding="utf-8")

            build_active_suite(base_suite_path, state_path, output_path, max_provisional=0)
            state = load_state(state_path)
            state["level_streaks"] = {"1": 1}
            state_path.write_text(json.dumps(state), encoding="utf-8")

            active_suite = json.loads(output_path.read_text(encoding="utf-8"))
            for item in active_suite:
                (iteration_dir / f"{item['name']}.json").write_text(
                    json.dumps({"name": item["name"], "status": "passed", "passed": True}),
                    encoding="utf-8",
                )

            status = update_curriculum_state(run_dir, output_path, state_path)
            updated = load_state(state_path)

            self.assertEqual(status["unlocked_level"], 2)
            self.assertEqual(updated["current_level"], 2)
            self.assertEqual(updated["run_history"][-1]["evaluated_level"], 1)

    def test_update_curriculum_promotes_provisional_after_two_passes(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            base_suite_path = root / "suite.json"
            state_path = root / "curriculum_state.json"
            output_path = root / "active_suite.json"
            base_suite_path.write_text(json.dumps(build_suite()), encoding="utf-8")

            build_active_suite(base_suite_path, state_path, output_path, max_provisional=1)
            active_suite = json.loads(output_path.read_text(encoding="utf-8"))
            provisional = next(item for item in active_suite if item.get("curriculum", {}).get("kind") == "provisional")

            for idx in range(2):
                run_dir = root / f"run_{idx:03d}"
                iteration_dir = run_dir / "iteration_001"
                iteration_dir.mkdir(parents=True, exist_ok=True)
                for item in active_suite:
                    status = {"name": item["name"], "status": "passed", "passed": True}
                    (iteration_dir / f"{item['name']}.json").write_text(json.dumps(status), encoding="utf-8")
                update_curriculum_state(run_dir, output_path, state_path)

            updated = load_state(state_path)
            promoted = updated.get("promoted_scenarios", [])
            self.assertTrue(
                any(item.get("curriculum", {}).get("provisional_key") == provisional["curriculum"]["provisional_key"] for item in promoted)
            )


if __name__ == "__main__":
    unittest.main()
