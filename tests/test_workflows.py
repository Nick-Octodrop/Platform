import unittest

from app.manifest_validate import validate_manifest_raw
from app.records_validation import validate_record_payload


class TestWorkflows(unittest.TestCase):
    def test_workflow_manifest_valid(self) -> None:
        manifest = {
            "manifest_version": "1.0",
            "module": {"id": "m1"},
            "entities": [
                {
                    "id": "entity.job",
                    "fields": [
                        {"id": "job.status", "type": "enum", "options": ["lead", "install"]},
                        {"id": "job.title", "type": "string"},
                    ],
                }
            ],
            "views": [
                {"id": "job.list", "entity": "job", "kind": "list", "columns": [{"field_id": "job.title"}]},
            ],
            "workflows": [
                {
                    "id": "job_flow",
                    "entity": "entity.job",
                    "status_field": "job.status",
                    "states": [
                        {"id": "lead", "label": "Lead"},
                        {"id": "install", "label": "Install"},
                    ],
                    "transitions": [
                        {"from": "lead", "to": "install", "label": "Approve"},
                    ],
                }
            ],
        }
        _, errors, _ = validate_manifest_raw(manifest, expected_module_id="m1")
        self.assertEqual(errors, [])

    def test_required_fields_by_status(self) -> None:
        entity = {
            "id": "entity.job",
            "fields": [
                {"id": "job.status", "type": "enum", "options": ["lead", "install"]},
                {"id": "job.title", "type": "string"},
                {"id": "job.install_date", "type": "date"},
            ],
        }
        workflow = {
            "id": "job_flow",
            "entity": "entity.job",
            "status_field": "job.status",
            "states": [{"id": "lead"}, {"id": "install", "required_fields": ["job.install_date"]}],
        }
        errors, _ = validate_record_payload(entity, {"job.status": "install", "job.title": "A"}, for_create=False, workflow=workflow)
        self.assertTrue(any(err["code"] == "REQUIRED_FIELD" for err in errors))


if __name__ == "__main__":
    unittest.main()
