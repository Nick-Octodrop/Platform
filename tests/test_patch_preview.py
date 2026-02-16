import os
import sys
import unittest


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "src")
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
if SRC not in sys.path:
    sys.path.insert(0, SRC)

from octo.manifest_hash import manifest_hash
from patch_preview import preview_patch


class TestPatchPreview(unittest.TestCase):
    def setUp(self) -> None:
        self.manifest = {
            "module": {"id": "job_management", "requires": []},
            "entities": [
                {
                    "id": "entity.job",
                    "fields": [
                        {"id": "job.title"},
                        {"id": "job.status"},
                        {"id": "job.priority"},
                    ],
                }
            ],
        }
        self.patch_base = {
            "patch_id": "p1",
            "target_module_id": "job_management",
            "target_manifest_hash": manifest_hash(self.manifest),
            "mode": "preview",
            "reason": "test",
            "operations": [],
        }

    def test_hash_mismatch_fails_early(self) -> None:
        patch = dict(self.patch_base)
        patch["target_manifest_hash"] = "sha256:deadbeef"
        result = preview_patch(self.manifest, patch)
        self.assertFalse(result["ok"])
        self.assertEqual(result["resolved_ops"], [])

    def test_selector_resolve_and_simulation(self) -> None:
        patch = dict(self.patch_base)
        patch["operations"] = [
            {
                "op": "replace",
                "path": "/entities/@[id=entity.job]/fields/@[id=job.status]/id",
                "value": "job.state",
            }
        ]
        result = preview_patch(self.manifest, patch)
        self.assertTrue(result["ok"])
        self.assertEqual(result["resolved_ops"][0]["path"], "/entities/0/fields/1/id")

    def test_reject_numeric_index_paths(self) -> None:
        patch = dict(self.patch_base)
        patch["operations"] = [
            {"op": "remove", "path": "/entities/0"}
        ]
        result = preview_patch(self.manifest, patch)
        self.assertFalse(result["ok"])

    def test_add_field_macro_expands(self) -> None:
        patch = dict(self.patch_base)
        patch["operations"] = [
            {
                "op": "add_field",
                "entity_id": "entity.job",
                "after_field_id": "job.status",
                "field": {"id": "job.owner"},
            }
        ]
        result = preview_patch(self.manifest, patch)
        self.assertTrue(result["ok"])
        self.assertEqual(result["resolved_ops"][0]["op"], "add")
        self.assertEqual(result["resolved_ops"][0]["path"], "/entities/0/fields/2")

    def test_protected_path_denied(self) -> None:
        patch = dict(self.patch_base)
        patch["operations"] = [
            {"op": "replace", "path": "/module/id", "value": "x"}
        ]
        result = preview_patch(self.manifest, patch)
        self.assertFalse(result["ok"])

    def test_test_op_failing(self) -> None:
        patch = dict(self.patch_base)
        patch["operations"] = [
            {
                "op": "test",
                "path": "/entities/@[id=entity.job]/fields/@[id=job.status]/id",
                "value": "wrong",
            }
        ]
        result = preview_patch(self.manifest, patch)
        self.assertFalse(result["ok"])

    def test_diff_summary(self) -> None:
        patch = dict(self.patch_base)
        patch["operations"] = [
            {
                "op": "replace",
                "path": "/entities/@[id=entity.job]/fields/@[id=job.status]/id",
                "value": "job.state",
            },
            {
                "op": "copy",
                "from": "/entities/@[id=entity.job]/fields/@[id=job.title]",
                "path": "/entities/@[id=entity.job]/fields/@[id=job.priority]",
            },
        ]
        result = preview_patch(self.manifest, patch)
        self.assertTrue(result["ok"])
        summary = result["diff_summary"]
        self.assertEqual(summary["counts"]["replace"], 1)
        self.assertEqual(summary["counts"]["copy"], 1)
        self.assertEqual(
            summary["touched"],
            [
                "/entities/0/fields/0",
                "/entities/0/fields/1/id",
                "/entities/0/fields/2",
            ],
        )


if __name__ == "__main__":
    unittest.main()
