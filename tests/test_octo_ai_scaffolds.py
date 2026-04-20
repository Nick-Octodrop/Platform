import os
import json
import unittest
from unittest.mock import patch
from pathlib import Path


os.environ.setdefault("USE_DB", "0")
os.environ.setdefault("OCTO_DISABLE_AUTH", "1")
os.environ.setdefault("SUPABASE_URL", "http://localhost")

import app.main as main  # noqa: E402
from app.main import _ai_build_new_module_scaffold, _ai_build_remove_view_mode_ops, _ai_extract_new_module_name, _ai_generate_module_design_spec, _ai_is_create_module_request, _ai_kernel_module_digest  # noqa: E402
from app.manifest_validate import validate_manifest_raw  # noqa: E402


class TestOctoAiScaffolds(unittest.TestCase):
    def test_shared_module_authoring_contract_exposes_domain_heuristics(self) -> None:
        contract = main._shared_module_authoring_contract()
        domain = contract.get("domain_heuristics") or {}
        self.assertIn("cross_family_rules", domain)
        self.assertIn("modeling_patterns", domain)
        self.assertIn("families", domain)
        self.assertIn("header_line", domain.get("modeling_patterns") or {})
        self.assertIn("request", domain.get("families") or {})
        self.assertIn("commerce", domain.get("families") or {})
        self.assertIn("Approved", domain["families"]["request"]["status_labels"])
        self.assertTrue(domain["families"]["commerce"]["example_field_labels"])

    def test_design_family_catalog_exists_and_is_used_for_recipe_family(self) -> None:
        catalog = json.loads((Path(main.ROOT) / "specs" / "octo_ai_design_families.json").read_text(encoding="utf-8"))
        self.assertIn("recipe", catalog)
        self.assertEqual(catalog["recipe"]["primary_label"], "Recipe Name")
        self.assertEqual(main._ai_detect_new_module_family("Cooking", "track my recipes and pantry ingredients"), "recipe")

    def test_create_module_name_prefers_human_label_over_module_id_hint(self) -> None:
        name = _ai_extract_new_module_name(
            "Create a new module for training compliance. Make it really good.",
            {"module_name": "Training Compliance", "module_target": "training_compliance", "answer_text": "Approved."},
        )
        self.assertEqual(name, "Training Compliance")

    def test_extract_module_name_from_system_brief(self) -> None:
        name = _ai_extract_new_module_name(
            "Build me a small service operations system with work orders, technician scheduling, customer visits, job notes, and completion status."
        )
        self.assertEqual(name, "Service Operations")

    def test_extract_module_name_from_software_contracting_purpose_phrase(self) -> None:
        name = _ai_extract_new_module_name(
            "make me a new module to track software engineering contracting jobs"
        )
        self.assertEqual(name, "Software Delivery")

    def test_detects_named_module_creation_from_plain_prompt(self) -> None:
        prompt = "Hi can you create me a new module, its to track my gym training and exercises! maybe call it GYM"
        self.assertTrue(_ai_is_create_module_request(prompt))
        self.assertEqual(_ai_extract_new_module_name(prompt), "GYM")

    def test_extract_module_name_strips_create_me_a_prefix(self) -> None:
        prompt = "create me a cooking module, so i can keep track of all my recipes!"
        self.assertTrue(_ai_is_create_module_request(prompt))
        self.assertEqual(_ai_extract_new_module_name(prompt), "Cooking")

    def test_extract_module_name_accepts_common_module_typo(self) -> None:
        prompt = (
            "hi, can you create me a really good mobule for managing my cooking recipes, "
            "we need to add ingredients as line items, full recipe details and images of "
            "the recipe for my upcoming cook book. call it Cooking."
        )
        self.assertTrue(_ai_is_create_module_request(prompt))
        self.assertEqual(_ai_extract_new_module_name(prompt), "Cooking")

    def test_extract_module_name_uses_rename_target_in_followup(self) -> None:
        self.assertEqual(_ai_extract_new_module_name("change me a cooking to Cooking"), "Cooking")

    def test_rich_create_module_scaffolds_validate(self) -> None:
        samples = [
            (
                "holiday_planning",
                "Holiday Planning",
                "Create me a new module for holiday planning! make it really good",
            ),
            (
                "purchase_requests",
                "Purchase Requests",
                "Create a simple module to manage purchase requests, requester, amount, supplier, and notes. Call it Purchase Requests.",
            ),
            (
                "candidate_pipeline",
                "Candidate Pipeline",
                "Create a recruitment module called Candidate Pipeline with stage flow Applied, Screen, Interview, Offer, Hired and kanban-first pipeline support.",
            ),
            (
                "site_visits",
                "Site Visits",
                "Create a simple module to manage site visits, visit dates, customer, outcome, and notes. Call it Site Visits.",
            ),
        ]
        for module_id, module_name, prompt in samples:
            with self.subTest(module_id=module_id):
                manifest = _ai_build_new_module_scaffold(module_id, module_name, prompt)
                normalized, errors, warnings = validate_manifest_raw(manifest, expected_module_id=module_id)
                self.assertEqual(errors, [], f"{module_id} errors: {errors} warnings: {warnings}")
                views = [view.get("kind") for view in normalized.get("views", []) if isinstance(view, dict)]
                self.assertIn("list", views)
                self.assertIn("form", views)
                self.assertTrue(normalized.get("workflows"))
                self.assertTrue((normalized.get("interfaces") or {}).get("dashboardable"))

    def test_remove_calendar_view_mode_ops(self) -> None:
        manifest = _ai_build_new_module_scaffold(
            "training_compliance",
            "Training Compliance",
            "Create a new module for training compliance with due dates and workflow stages.",
        )
        ops, advisory = _ai_build_remove_view_mode_ops(manifest, "training_compliance", "entity.task", "calendar")
        op_names = [op.get("op") for op in ops if isinstance(op, dict)]
        self.assertIn("update_page", op_names)
        self.assertIn("remove_view", op_names)
        self.assertTrue(advisory is None or isinstance(advisory, str))

    def test_kernel_digest_captures_platform_features(self) -> None:
        manifest = _ai_build_new_module_scaffold(
            "candidate_pipeline",
            "Candidate Pipeline",
            "Create a recruitment module called Candidate Pipeline with stage flow Applied, Screen, Interview, Offer, Hired and kanban-first pipeline support.",
        )
        digest = _ai_kernel_module_digest("candidate_pipeline", manifest)
        self.assertTrue(digest.get("pages"))
        self.assertTrue(digest.get("views"))
        self.assertIn("interfaces", digest)
        self.assertIn("feature_flags", digest)
        self.assertTrue(digest["feature_flags"].get("has_kanban"))
        self.assertFalse(digest["feature_flags"].get("has_calendar"))
        self.assertTrue(digest["feature_flags"].get("has_workflow"))
        self.assertTrue(any(page.get("view_modes") for page in digest.get("pages", []) if isinstance(page, dict)))

    def test_gym_module_scaffold_is_rich_enough_for_real_use(self) -> None:
        manifest = _ai_build_new_module_scaffold(
            "gym_training",
            "Gym Training",
            "Create me a gym module to track workouts, training goals, coaches, calories burned, duration, and notes.",
        )
        normalized, errors, warnings = validate_manifest_raw(manifest, expected_module_id="gym_training")
        self.assertEqual(errors, [], f"errors: {errors} warnings: {warnings}")
        entity = (normalized.get("entities") or [None])[0]
        self.assertIsInstance(entity, dict)
        field_labels = [field.get("label") for field in (entity.get("fields") or []) if isinstance(field, dict)]
        self.assertIn("Session Name", field_labels)
        self.assertIn("Training Goal", field_labels)
        self.assertIn("Coach", field_labels)
        self.assertIn("Duration (Minutes)", field_labels)
        self.assertIn("Calories Burned", field_labels)
        action_labels = [action.get("label") for action in (normalized.get("actions") or []) if isinstance(action, dict)]
        self.assertIn("Complete", action_labels)
        self.assertIn("Skip", action_labels)
        self.assertEqual(entity.get("display_field"), "gym_training.name")
        self.assertTrue(any(page.get("id") == "gym_training.calendar_page" for page in (normalized.get("pages") or []) if isinstance(page, dict)))
        list_page = next(
            (
                page
                for page in (normalized.get("pages") or [])
                if isinstance(page, dict) and page.get("id") == "gym_training.list_page"
            ),
            None,
        )
        self.assertIsInstance(list_page, dict)
        block = main._manifest_find_first_view_modes_block(list_page.get("content"))
        self.assertIsInstance(block, dict)
        modes = [item.get("mode") for item in (block.get("modes") or []) if isinstance(item, dict)]
        self.assertIn("calendar", modes)
        self.assertNotIn("kanban", modes)

    def test_software_delivery_module_scaffold_adds_real_operational_structure(self) -> None:
        manifest = _ai_build_new_module_scaffold(
            "software_delivery",
            "Software Delivery",
            "Create a new module to track software engineering contracting jobs with clients, projects, sprint work, estimates, billable hours, due dates, and notes.",
        )
        normalized, errors, warnings = validate_manifest_raw(manifest, expected_module_id="software_delivery")
        self.assertEqual(errors, [], f"errors: {errors} warnings: {warnings}")
        entity = (normalized.get("entities") or [None])[0]
        self.assertIsInstance(entity, dict)
        field_labels = [field.get("label") for field in (entity.get("fields") or []) if isinstance(field, dict)]
        for expected in ("Client", "Project", "Work Type", "Estimate Hours", "Billable Hours", "Sprint", "Repository"):
            self.assertIn(expected, field_labels)
        workflow_states = (((normalized.get("workflows") or [None])[0] or {}).get("states") or [])
        state_labels = [state.get("label") for state in workflow_states if isinstance(state, dict)]
        self.assertIn("Scoped", state_labels)
        self.assertIn("In Progress", state_labels)
        action_labels = [action.get("label") for action in (normalized.get("actions") or []) if isinstance(action, dict)]
        self.assertIn("Start", action_labels)
        self.assertFalse(any(page.get("id") == "software_delivery.calendar_page" for page in (normalized.get("pages") or []) if isinstance(page, dict)))
        list_page = next(
            (
                page
                for page in (normalized.get("pages") or [])
                if isinstance(page, dict) and page.get("id") == "software_delivery.list_page"
            ),
            None,
        )
        self.assertIsInstance(list_page, dict)
        block = main._manifest_find_first_view_modes_block(list_page.get("content"))
        self.assertIsInstance(block, dict)
        self.assertEqual(block.get("default_mode"), "kanban")
        modes = [item.get("mode") for item in (block.get("modes") or []) if isinstance(item, dict)]
        self.assertIn("kanban", modes)
        self.assertNotIn("calendar", modes)

    def test_module_scaffold_keeps_human_labels_when_module_id_has_numeric_suffix(self) -> None:
        manifest = _ai_build_new_module_scaffold(
            "neetones_2",
            "Neetones",
            "Create a simple module for managing gym training sessions. Call it Neetones. Make it clean and modern.",
        )
        normalized, errors, warnings = validate_manifest_raw(manifest, expected_module_id="neetones_2")
        self.assertEqual(errors, [], f"errors: {errors} warnings: {warnings}")
        entity = (normalized.get("entities") or [None])[0]
        self.assertIsInstance(entity, dict)
        self.assertEqual(entity.get("label"), "Neetones")
        page_titles = [page.get("title") for page in (normalized.get("pages") or []) if isinstance(page, dict)]
        self.assertIn("Neetones", page_titles)
        self.assertNotIn("Neetones 2", page_titles)

    def test_module_design_spec_v1_captures_workflow_layout_and_experience(self) -> None:
        spec = _ai_generate_module_design_spec(
            "software_delivery",
            "Software Delivery",
            "Create a new module to track software engineering contracting jobs with clients, projects, sprint work, estimates, billable hours, due dates, and notes.",
        )
        self.assertEqual(spec.get("version"), "1")
        self.assertEqual(spec.get("family"), "delivery")
        self.assertTrue((spec.get("workflow") or {}).get("enabled"))
        self.assertIn("Start", (spec.get("workflow") or {}).get("action_labels", []))
        self.assertIn("Complete", (spec.get("workflow") or {}).get("action_labels", []))
        self.assertIn("list", (spec.get("experience") or {}).get("views", []))
        self.assertIn("form", (spec.get("experience") or {}).get("views", []))
        self.assertIn("kanban", (spec.get("experience") or {}).get("views", []))
        self.assertNotIn("calendar", (spec.get("experience") or {}).get("views", []))
        self.assertTrue((spec.get("layout") or {}).get("sections"))
        self.assertTrue((spec.get("quality") or {}).get("ok"))

    def test_module_design_spec_score_rewards_domain_fit_for_request_family(self) -> None:
        strong_spec = main._ai_normalize_module_design_spec(
            "purchase_requests",
            "Purchase Requests",
            "Create a purchase request module.",
            {
                "family": "request",
                "entity_slug": "purchase_request",
                "entity_label": "Purchase Request",
                "nav_label": "Purchase Requests",
                "primary_label": "Request Title",
                "statuses": ["draft", "submitted", "approved", "rejected"],
                "fields": [
                    {"id": "purchase_request.name", "type": "string", "label": "Request Title"},
                    {"id": "purchase_request.status", "type": "enum", "label": "Status", "options": ["draft", "submitted", "approved", "rejected"]},
                    {"id": "purchase_request.owner_id", "type": "user", "label": "Owner"},
                    {"id": "purchase_request.requester", "type": "string", "label": "Requester"},
                    {"id": "purchase_request.approver", "type": "string", "label": "Approver"},
                    {"id": "purchase_request.amount", "type": "number", "label": "Amount"},
                    {"id": "purchase_request.due_date", "type": "date", "label": "Due Date"},
                    {"id": "purchase_request.review_notes", "type": "text", "label": "Review Notes"},
                ],
                "workflow": {
                    "enabled": True,
                    "status_field": "purchase_request.status",
                    "states": [
                        {"id": "draft", "label": "Draft"},
                        {"id": "submitted", "label": "Submitted"},
                        {"id": "approved", "label": "Approved"},
                        {"id": "rejected", "label": "Rejected"},
                    ],
                    "action_labels": ["Submit", "Approve", "Reject"],
                },
                "experience": {"views": ["list", "form", "calendar"]},
            },
        )
        weak_spec = main._ai_normalize_module_design_spec(
            "purchase_requests",
            "Purchase Requests",
            "Create a purchase request module.",
            {
                "family": "request",
                "entity_slug": "purchase_request",
                "entity_label": "Purchase Request",
                "nav_label": "Purchase Requests",
                "primary_label": "Request Title",
                "statuses": ["draft", "approved"],
                "fields": [
                    {"id": "purchase_request.name", "type": "string", "label": "Request Title"},
                    {"id": "purchase_request.status", "type": "enum", "label": "Status", "options": ["draft", "approved"]},
                    {"id": "purchase_request.owner_id", "type": "user", "label": "Owner"},
                    {"id": "purchase_request.notes", "type": "text", "label": "Notes"},
                ],
                "workflow": {
                    "enabled": True,
                    "status_field": "purchase_request.status",
                    "states": [
                        {"id": "draft", "label": "Draft"},
                        {"id": "approved", "label": "Approved"},
                    ],
                    "action_labels": [],
                },
                "experience": {"views": ["list", "form"]},
            },
        )

        strong_quality = strong_spec.get("quality") or {}
        weak_quality = weak_spec.get("quality") or {}
        self.assertGreater(main._ai_module_design_spec_score(strong_spec), main._ai_module_design_spec_score(weak_spec))
        self.assertGreater(strong_quality.get("domain_matched_pattern_count", 0), 0)
        self.assertGreater(strong_quality.get("domain_aligned_column_count", 0), weak_quality.get("domain_aligned_column_count", 0))
        self.assertTrue(any("approval-oriented module" in issue.lower() or "decision-oriented fields" in issue.lower() for issue in weak_quality.get("issues", [])))

    def test_module_quality_plan_feedback_summarizes_strengths_and_risks(self) -> None:
        feedback = main._ai_module_quality_plan_feedback(
            "Purchase Requests",
            {
                "strengths": [
                    "Models a real approval workflow with decision actions.",
                    "Includes requester or decision-oriented fields for approvals.",
                ],
                "issues": [
                    "Approval-oriented module should include requester, approver, amount/impact, due date, or review-note fields.",
                ],
                "domain_matched_pattern_count": 1,
                "domain_aligned_column_count": 3,
            },
        )

        self.assertTrue(any("Purchase Requests:" in item for item in feedback.get("advisories", [])))
        self.assertTrue(any("decision-oriented fields" in item for item in feedback.get("advisories", [])))
        self.assertTrue(any("review-note fields" in item for item in feedback.get("risks", [])))
        self.assertTrue(feedback.get("section_items"))

    def test_deterministic_design_spec_infers_repeatable_child_records_for_line_item_requests(self) -> None:
        with patch.object(main, "_ai_request_module_design_spec_from_model", lambda *_args, **_kwargs: None):
            spec = _ai_generate_module_design_spec(
                "quoting",
                "Quoting",
                "Create a quoting module with customer, expiry date, line items, discounts, taxes, and totals.",
            )

        related_entities = [item for item in (spec.get("related_entities") or []) if isinstance(item, dict)]
        self.assertTrue(related_entities)
        line_items = next((item for item in related_entities if item.get("entity_slug") == "line_item"), None)
        self.assertIsInstance(line_items, dict)
        field_labels = [field.get("label") for field in (line_items.get("fields") or []) if isinstance(field, dict)]
        self.assertIn("Description", field_labels)
        self.assertIn("Quantity", field_labels)
        self.assertIn("Unit Price", field_labels)
        self.assertIn("Line Total", field_labels)

    def test_deterministic_design_spec_adds_child_calculations_and_parent_rollups(self) -> None:
        with patch.object(main, "_ai_request_module_design_spec_from_model", lambda *_args, **_kwargs: None):
            spec = _ai_generate_module_design_spec(
                "quoting",
                "Quoting",
                "Create a quoting module with customer, expiry date, line items, discounts, taxes, and totals.",
            )

        line_items = next(
            (
                item
                for item in (spec.get("related_entities") or [])
                if isinstance(item, dict) and item.get("entity_slug") == "line_item"
            ),
            None,
        )
        self.assertIsInstance(line_items, dict)
        line_fields = {
            field.get("id"): field
            for field in (line_items.get("fields") or [])
            if isinstance(field, dict) and isinstance(field.get("id"), str)
        }
        self.assertIn("line_item.line_total", line_fields)
        self.assertTrue(line_fields["line_item.line_total"].get("readonly"))
        self.assertIn("expression", (line_fields["line_item.line_total"].get("compute") or {}))

        primary_fields = {
            field.get("id"): field
            for field in (spec.get("fields") or [])
            if isinstance(field, dict) and isinstance(field.get("id"), str)
        }
        self.assertIn("quoting.subtotal_amount", primary_fields)
        self.assertIn("aggregate", (primary_fields["quoting.subtotal_amount"].get("compute") or {}))
        self.assertIn("quoting.discount_amount", primary_fields)
        self.assertIn("quoting.tax_amount", primary_fields)
        self.assertIn("quoting.total_amount", primary_fields)
        self.assertIn("expression", (primary_fields["quoting.total_amount"].get("compute") or {}))

    def test_deterministic_design_spec_infers_reminder_and_status_notification_intents(self) -> None:
        with patch.object(main, "_ai_request_module_design_spec_from_model", lambda *_args, **_kwargs: None):
            spec = _ai_generate_module_design_spec(
                "supplier_compliance",
                "Supplier Compliance",
                "Create a supplier compliance module with review dates, document expiry, notify the owner when a record is approved, and remind them when expiry is near.",
            )

        intents = [item for item in (spec.get("automation_intents") or []) if isinstance(item, dict)]
        self.assertTrue(any(item.get("kind") == "follow_up_notification" for item in intents))
        approved_notifications = [
            item for item in intents
            if item.get("kind") == "status_notification" and "approved" in (item.get("status_values") or [])
        ]
        self.assertTrue(approved_notifications)

    def test_deterministic_design_spec_adds_decision_comments_when_workflow_requires_reasons(self) -> None:
        with patch.object(main, "_ai_request_module_design_spec_from_model", lambda *_args, **_kwargs: None):
            spec = _ai_generate_module_design_spec(
                "purchase_requests",
                "Purchase Requests",
                "Create a purchase request module where managers must add comments when rejecting or approving a request.",
            )

        fields = {
            field.get("id"): field
            for field in (spec.get("fields") or [])
            if isinstance(field, dict) and isinstance(field.get("id"), str)
        }
        decision_comments = fields.get("purchase_request.manager_comments") or fields.get("purchase_request.decision_comments")
        self.assertIsInstance(decision_comments, dict)
        required_when = decision_comments.get("required_when") or {}
        self.assertEqual(required_when.get("op"), "in")
        self.assertEqual(required_when.get("field"), "purchase_request.status")
        self.assertCountEqual(required_when.get("value") or [], ["approved", "rejected"])

    def test_workflow_actions_include_state_guards_in_generated_scaffold(self) -> None:
        manifest = _ai_build_new_module_scaffold(
            "purchase_requests",
            "Purchase Requests",
            "Create a simple module to manage purchase requests, requester, amount, supplier, and notes. Call it Purchase Requests.",
        )
        normalized, errors, warnings = validate_manifest_raw(manifest, expected_module_id="purchase_requests")
        self.assertEqual(errors, [], f"errors: {errors} warnings: {warnings}")
        guarded_actions = [
            action
            for action in (normalized.get("actions") or [])
            if isinstance(action, dict) and action.get("kind") == "update_record"
        ]
        self.assertTrue(guarded_actions)
        for action in guarded_actions:
            self.assertIsInstance(action.get("enabled_when"), dict)
            self.assertIsInstance(action.get("visible_when"), dict)
            self.assertEqual((action.get("enabled_when") or {}).get("field"), "purchase_request.status")
            self.assertEqual((action.get("visible_when") or {}).get("field"), "purchase_request.status")

    def test_generated_scaffold_preserves_computed_rollups_and_conditional_validation(self) -> None:
        manifest = _ai_build_new_module_scaffold(
            "purchase_quotes",
            "Purchase Quotes",
            "Create a purchase quote module with supplier, expiry date, line items, taxes, discounts, totals, and comments required when managers reject or approve.",
        )
        normalized, errors, warnings = validate_manifest_raw(manifest, expected_module_id="purchase_quotes")
        self.assertEqual(errors, [], f"errors: {errors} warnings: {warnings}")

        primary_entity = (normalized.get("entities") or [None])[0]
        self.assertIsInstance(primary_entity, dict)
        primary_fields = {
            field.get("id"): field
            for field in (primary_entity.get("fields") or [])
            if isinstance(field, dict) and isinstance(field.get("id"), str)
        }
        self.assertIn("purchase_quote.subtotal_amount", primary_fields)
        self.assertIn("aggregate", (primary_fields["purchase_quote.subtotal_amount"].get("compute") or {}))
        self.assertIn("purchase_quote.total_amount", primary_fields)
        self.assertIn("expression", (primary_fields["purchase_quote.total_amount"].get("compute") or {}))

        comment_field = primary_fields.get("purchase_quote.manager_comments") or primary_fields.get("purchase_quote.decision_comments")
        self.assertIsInstance(comment_field, dict)
        self.assertEqual((comment_field.get("required_when") or {}).get("field"), "purchase_quote.status")

        related_entities = {
            entity.get("id"): entity
            for entity in (normalized.get("entities") or [])
            if isinstance(entity, dict) and isinstance(entity.get("id"), str)
        }
        line_entity = related_entities.get("entity.line_item")
        self.assertIsInstance(line_entity, dict)
        line_fields = {
            field.get("id"): field
            for field in (line_entity.get("fields") or [])
            if isinstance(field, dict) and isinstance(field.get("id"), str)
        }
        self.assertIn("line_item.line_total", line_fields)
        self.assertIn("expression", (line_fields["line_item.line_total"].get("compute") or {}))

    def test_create_module_bundle_adds_generic_cross_module_handoff_automation(self) -> None:
        bundle = main._ai_build_create_module_bundle(
            "Create Quotes and Jobs modules. When a Quote is approved, create a Job and carry the client name and due date across.",
            [],
            {},
        )

        self.assertIsInstance(bundle, dict)
        create_ops = [op for op in (bundle.get("candidate_ops") or []) if isinstance(op, dict) and op.get("op") == "create_module"]
        self.assertEqual(len(create_ops), 2)
        automation_ops = [
            op for op in (bundle.get("candidate_ops") or [])
            if isinstance(op, dict) and op.get("op") == "create_automation_record"
        ]
        self.assertTrue(automation_ops)

        handoff = automation_ops[0].get("automation") or {}
        self.assertEqual(((handoff.get("trigger") or {}).get("event_types") or [None])[0], "workflow.status_changed")
        trigger_filters = (handoff.get("trigger") or {}).get("filters") or []
        self.assertTrue(any(isinstance(item, dict) and item.get("path") == "entity_id" and item.get("value") == "entity.quote" for item in trigger_filters))
        self.assertTrue(any(isinstance(item, dict) and item.get("path") == "to" and item.get("value") == "approved" for item in trigger_filters))

        step = ((handoff.get("steps") or [None])[0]) or {}
        self.assertEqual(step.get("action_id"), "system.create_record")
        inputs = step.get("inputs") or {}
        self.assertEqual(inputs.get("entity_id"), "entity.job")
        values = inputs.get("values") or {}
        self.assertEqual(values.get("job.source_quote_id"), "{{trigger.record_id}}")
        self.assertEqual(values.get("job.client_name"), "{{trigger.record.fields.quote.client_name}}")
        self.assertEqual(values.get("job.due_date"), "{{trigger.record.fields.quote.due_date}}")

    def test_create_module_bundle_enriches_target_manifest_with_source_reference_field_for_handoff(self) -> None:
        bundle = main._ai_build_create_module_bundle(
            "Create Quotes and Jobs modules. When a Quote is approved, create a Job and carry the client name across.",
            [],
            {},
        )
        self.assertIsInstance(bundle, dict)
        create_ops = {
            op.get("artifact_id"): op
            for op in (bundle.get("candidate_ops") or [])
            if isinstance(op, dict) and op.get("op") == "create_module"
        }
        job_op = next((op for module_id, op in create_ops.items() if module_id and "job" in module_id), None)
        self.assertIsInstance(job_op, dict)
        job_manifest = job_op.get("manifest") or {}
        job_entity = next(
            (
                entity
                for entity in (job_manifest.get("entities") or [])
                if isinstance(entity, dict) and entity.get("id") == "entity.job"
            ),
            None,
        )
        self.assertIsInstance(job_entity, dict)
        job_fields = {
            field.get("id"): field
            for field in (job_entity.get("fields") or [])
            if isinstance(field, dict) and isinstance(field.get("id"), str)
        }
        self.assertIn("job.source_quote_id", job_fields)

    def test_create_module_bundle_keeps_semantic_entity_ids_when_module_id_collides(self) -> None:
        with patch.object(main.registry, "get", side_effect=lambda module_id: {"module_id": "jobs"} if module_id == "jobs" else None):
            bundle = main._ai_build_create_module_bundle(
                "Create Quotes and Jobs modules. When a Quote is approved, create a Job and carry the client name and due date across.",
                [],
                {},
            )

        self.assertIsInstance(bundle, dict)
        create_ops = [
            op for op in (bundle.get("candidate_ops") or [])
            if isinstance(op, dict) and op.get("op") == "create_module"
        ]
        colliding_job_op = next(
            (op for op in create_ops if isinstance(op.get("artifact_id"), str) and op.get("artifact_id").startswith("jobs_")),
            None,
        )
        self.assertIsInstance(colliding_job_op, dict)

        job_manifest = colliding_job_op.get("manifest") or {}
        job_entity = next(
            (
                entity
                for entity in (job_manifest.get("entities") or [])
                if isinstance(entity, dict) and entity.get("id") == "entity.job"
            ),
            None,
        )
        self.assertIsInstance(job_entity, dict)

        automation_ops = [
            op for op in (bundle.get("candidate_ops") or [])
            if isinstance(op, dict)
            and op.get("op") == "create_automation_record"
            and isinstance(op.get("artifact_id"), str)
            and op.get("artifact_id", "").endswith("_handoff")
        ]
        self.assertTrue(automation_ops)
        inputs = (((automation_ops[0].get("automation") or {}).get("steps") or [{}])[0].get("inputs")) or {}
        self.assertEqual(inputs.get("entity_id"), "entity.job")

    def test_recipe_design_spec_uses_natural_workflow_button_labels(self) -> None:
        spec = _ai_generate_module_design_spec(
            "kitchen_recipes",
            "Kitchen Recipes",
            "Create a new module to track my cooking recipes and ingredients I have at home. Come up with something cool.",
        )
        self.assertIn("Plan", (spec.get("workflow") or {}).get("action_labels", []))
        self.assertIn("Cook", (spec.get("workflow") or {}).get("action_labels", []))

    def test_recipe_module_scaffold_avoids_double_prefixed_fields_and_adds_cooking_structure(self) -> None:
        manifest = _ai_build_new_module_scaffold(
            "kitchen_recipes",
            "Kitchen Recipes",
            "Create a new module to track my cooking recipes and ingredients I have at home. Come up with something cool.",
        )
        normalized, errors, warnings = validate_manifest_raw(manifest, expected_module_id="kitchen_recipes")
        self.assertEqual(errors, [], f"errors: {errors} warnings: {warnings}")
        entity = (normalized.get("entities") or [None])[0]
        self.assertIsInstance(entity, dict)
        field_ids = [field.get("id") for field in (entity.get("fields") or []) if isinstance(field, dict)]
        self.assertFalse(any(isinstance(field_id, str) and "kitchen_recipes.kitchen_recipes_" in field_id for field_id in field_ids))
        field_labels = [field.get("label") for field in (entity.get("fields") or []) if isinstance(field, dict)]
        for expected in ("Recipe Name", "Cuisine", "Meal Type", "Prep Time (Minutes)", "Ingredients", "Method", "Ingredients On Hand"):
            self.assertIn(expected, field_labels)

    def test_recipe_module_scaffold_sets_default_status_and_form_actions(self) -> None:
        manifest = _ai_build_new_module_scaffold(
            "my_cooking",
            "My Cooking",
            "can you make me a module to manage my cooking, i want to make a cook book but i need to record all my recipes and ingredients etc, and make notes on them all",
        )
        normalized, errors, warnings = validate_manifest_raw(manifest, expected_module_id="my_cooking")
        self.assertEqual(errors, [], f"errors: {errors} warnings: {warnings}")
        entity = (normalized.get("entities") or [None])[0]
        self.assertIsInstance(entity, dict)
        fields = [field for field in (entity.get("fields") or []) if isinstance(field, dict)]
        status_field = next((field for field in fields if field.get("id") == "my_cooking.status"), None)
        self.assertIsInstance(status_field, dict)
        self.assertEqual(status_field.get("default"), "draft")
        created_at_fields = [field for field in fields if field.get("id") == "my_cooking.created_at"]
        self.assertEqual(len(created_at_fields), 1)
        form_view = next((view for view in (normalized.get("views") or []) if isinstance(view, dict) and view.get("id") == "my_cooking.form"), None)
        self.assertIsInstance(form_view, dict)
        secondary_actions = ((form_view.get("header") or {}).get("secondary_actions") or [])
        action_ids = [item.get("action_id") for item in secondary_actions if isinstance(item, dict)]
        self.assertIn("action.my_cooking_plan", action_ids)
        self.assertIn("action.my_cooking_cook", action_ids)
        list_view = next((view for view in (normalized.get("views") or []) if isinstance(view, dict) and view.get("id") == "my_cooking.list"), None)
        self.assertIsInstance(list_view, dict)
        bulk_actions = ((list_view.get("header") or {}).get("bulk_actions") or [])
        bulk_action_ids = [item.get("action_id") for item in bulk_actions if isinstance(item, dict)]
        self.assertIn("action.my_cooking_bulk_plan", bulk_action_ids)
        self.assertIn("action.my_cooking_bulk_cook", bulk_action_ids)

    def test_recipe_module_scaffold_prefers_kanban_without_calendar_for_historical_dates(self) -> None:
        manifest = _ai_build_new_module_scaffold(
            "kitchen_recipes",
            "Kitchen Recipes",
            "Create a new module to track my cooking recipes and ingredients I have at home. Come up with something cool.",
        )
        normalized, errors, warnings = validate_manifest_raw(manifest, expected_module_id="kitchen_recipes")
        self.assertEqual(errors, [], f"errors: {errors} warnings: {warnings}")
        list_page = next(
            (
                page
                for page in (normalized.get("pages") or [])
                if isinstance(page, dict) and page.get("id") == "kitchen_recipe.list_page"
            ),
            None,
        )
        self.assertIsInstance(list_page, dict)
        block = main._manifest_find_first_view_modes_block(list_page.get("content"))
        self.assertIsInstance(block, dict)
        self.assertEqual(block.get("default_mode"), "kanban")
        self.assertNotIn("default_filter_id", block)
        modes = [item.get("mode") for item in (block.get("modes") or []) if isinstance(item, dict)]
        self.assertIn("kanban", modes)
        self.assertNotIn("calendar", modes)
        self.assertFalse(
            any(
                isinstance(page, dict) and page.get("id") == "kitchen_recipe.calendar_page"
                for page in (normalized.get("pages") or [])
            )
        )

    def test_purchase_request_scaffold_prioritizes_decision_columns_and_kanban_subtitles(self) -> None:
        manifest = _ai_build_new_module_scaffold(
            "purchase_requests",
            "Purchase Requests",
            "Create a simple module to manage purchase requests, requester, amount, supplier, and notes. Call it Purchase Requests.",
        )
        normalized, errors, warnings = validate_manifest_raw(manifest, expected_module_id="purchase_requests")
        self.assertEqual(errors, [], f"errors: {errors} warnings: {warnings}")
        view_by_id = {
            view.get("id"): view
            for view in (normalized.get("views") or [])
            if isinstance(view, dict) and isinstance(view.get("id"), str)
        }
        list_columns = [item.get("field_id") for item in ((view_by_id["purchase_request.list"].get("columns") or [])) if isinstance(item, dict)]
        self.assertEqual(list_columns[0], "purchase_request.name")
        self.assertIn("purchase_request.status", list_columns)
        self.assertIn("purchase_request.requester_name", list_columns)
        self.assertIn("purchase_request.amount", list_columns)
        self.assertIn("purchase_request.due_date", list_columns)
        subtitle_fields = (((view_by_id["purchase_request.kanban"].get("card") or {}).get("subtitle_fields")) or [])
        self.assertIn("purchase_request.requester_name", subtitle_fields)
        self.assertNotIn("purchase_request.created_at", subtitle_fields)
        badge_fields = (((view_by_id["purchase_request.kanban"].get("card") or {}).get("badge_fields")) or [])
        self.assertTrue(
            any(field_id in {"purchase_request.amount", "purchase_request.priority", "purchase_request.due_date"} for field_id in badge_fields),
            badge_fields,
        )
        self.assertNotIn("purchase_request.status", badge_fields)
        search_cfg = ((view_by_id["purchase_request.list"].get("header") or {}).get("search")) or {}
        self.assertTrue(search_cfg.get("enabled"))
        search_fields = search_cfg.get("fields") or []
        self.assertIn("purchase_request.name", search_fields)
        self.assertIn("purchase_request.requester_name", search_fields)
        self.assertIn("purchase_request.request_type", search_fields)
        self.assertNotIn("purchase_request.amount", search_fields)

    def test_purchase_request_scaffold_uses_view_modes_for_filters_and_grouping(self) -> None:
        manifest = _ai_build_new_module_scaffold(
            "purchase_requests",
            "Purchase Requests",
            "Create a simple module to manage purchase requests, requester, amount, supplier, and notes. Call it Purchase Requests.",
        )
        normalized, errors, warnings = validate_manifest_raw(manifest, expected_module_id="purchase_requests")
        self.assertEqual(errors, [], f"errors: {errors} warnings: {warnings}")
        list_page = next(
            (
                page
                for page in (normalized.get("pages") or [])
                if isinstance(page, dict) and page.get("id") == "purchase_request.list_page"
            ),
            None,
        )
        self.assertIsInstance(list_page, dict)
        block = main._manifest_find_first_view_modes_block(list_page.get("content"))
        self.assertIsInstance(block, dict)
        self.assertEqual(block.get("default_mode"), "list")
        self.assertNotIn("default_filter_id", block)
        modes = [item.get("mode") for item in (block.get("modes") or []) if isinstance(item, dict)]
        self.assertIn("kanban", modes)
        self.assertNotIn("calendar", modes)
        kanban_mode = next(
            (
                item
                for item in (block.get("modes") or [])
                if isinstance(item, dict) and item.get("mode") == "kanban"
            ),
            None,
        )
        self.assertIsInstance(kanban_mode, dict)
        self.assertEqual(kanban_mode.get("default_group_by"), "purchase_request.status")

        create_action = next(
            (
                action
                for action in (normalized.get("actions") or [])
                if isinstance(action, dict) and action.get("id") == "action.purchase_request_new"
            ),
            None,
        )
        self.assertIsInstance(create_action, dict)
        self.assertEqual(create_action.get("label"), "New")

    def test_candidate_pipeline_scaffold_prioritizes_pipeline_signals(self) -> None:
        manifest = _ai_build_new_module_scaffold(
            "candidate_pipeline",
            "Candidate Pipeline",
            "Create a recruitment module called Candidate Pipeline with stage flow Applied, Screen, Interview, Offer, Hired and kanban-first pipeline support.",
        )
        normalized, errors, warnings = validate_manifest_raw(manifest, expected_module_id="candidate_pipeline")
        self.assertEqual(errors, [], f"errors: {errors} warnings: {warnings}")
        view_by_id = {
            view.get("id"): view
            for view in (normalized.get("views") or [])
            if isinstance(view, dict) and isinstance(view.get("id"), str)
        }
        list_columns = [item.get("field_id") for item in ((view_by_id["candidate_pipeline.list"].get("columns") or [])) if isinstance(item, dict)]
        self.assertEqual(list_columns[0], "candidate_pipeline.name")
        self.assertIn("candidate_pipeline.status", list_columns)
        self.assertIn("candidate_pipeline.value", list_columns)
        self.assertIn("candidate_pipeline.target_date", list_columns)
        subtitle_fields = (((view_by_id["candidate_pipeline.kanban"].get("card") or {}).get("subtitle_fields")) or [])
        self.assertIn("candidate_pipeline.value", subtitle_fields)
        self.assertIn("candidate_pipeline.target_date", subtitle_fields)
        self.assertNotIn("candidate_pipeline.created_at", subtitle_fields)
        badge_fields = (((view_by_id["candidate_pipeline.kanban"].get("card") or {}).get("badge_fields")) or [])
        self.assertIn("candidate_pipeline.value", badge_fields)
        self.assertNotIn("candidate_pipeline.status", badge_fields)
        search_cfg = ((view_by_id["candidate_pipeline.list"].get("header") or {}).get("search")) or {}
        self.assertTrue(search_cfg.get("enabled"))
        search_fields = search_cfg.get("fields") or []
        self.assertIn("candidate_pipeline.name", search_fields)
        self.assertIn("candidate_pipeline.company_name", search_fields)
        self.assertIn("candidate_pipeline.contact_name", search_fields)
        self.assertNotIn("candidate_pipeline.value", search_fields)

    def test_candidate_pipeline_scaffold_keeps_nav_focused_on_primary_module_surface(self) -> None:
        manifest = _ai_build_new_module_scaffold(
            "candidate_pipeline",
            "Candidate Pipeline",
            "Create a recruitment module called Candidate Pipeline with stage flow Applied, Screen, Interview, Offer, Hired and kanban-first pipeline support.",
        )
        normalized, errors, warnings = validate_manifest_raw(manifest, expected_module_id="candidate_pipeline")
        self.assertEqual(errors, [], f"errors: {errors} warnings: {warnings}")
        app_cfg = normalized.get("app") or {}
        self.assertEqual(app_cfg.get("home"), "page:candidate_pipeline.list_page")
        nav = (app_cfg.get("nav") or [None])[0] or {}
        items = nav.get("items") or []
        self.assertEqual(items, [{"label": "Candidate Pipeline", "to": "page:candidate_pipeline.list_page"}])

        list_page = next(
            (
                page
                for page in (normalized.get("pages") or [])
                if isinstance(page, dict) and page.get("id") == "candidate_pipeline.list_page"
            ),
            None,
        )
        self.assertIsInstance(list_page, dict)
        block = main._manifest_find_first_view_modes_block(list_page.get("content"))
        self.assertIsInstance(block, dict)
        self.assertEqual(block.get("default_mode"), "kanban")
        self.assertNotIn("default_filter_id", block)
        modes = [item.get("mode") for item in (block.get("modes") or []) if isinstance(item, dict)]
        self.assertIn("kanban", modes)
        self.assertNotIn("calendar", modes)

        create_action = next(
            (
                action
                for action in (normalized.get("actions") or [])
                if isinstance(action, dict) and action.get("id") == "action.candidate_pipeline_new"
            ),
            None,
        )
        self.assertIsInstance(create_action, dict)
        self.assertEqual(create_action.get("label"), "New")

    def test_compliance_scaffold_avoids_calendar_for_review_and_expiry_dates(self) -> None:
        manifest = _ai_build_new_module_scaffold(
            "supplier_compliance",
            "Supplier Compliance",
            "Create a supplier compliance module with review dates, document expiry, approvals, and owner follow-up.",
        )
        normalized, errors, warnings = validate_manifest_raw(manifest, expected_module_id="supplier_compliance")
        self.assertEqual(errors, [], f"errors: {errors} warnings: {warnings}")
        list_page = next(
            (
                page
                for page in (normalized.get("pages") or [])
                if isinstance(page, dict) and page.get("id") == "supplier_compliance.list_page"
            ),
            None,
        )
        self.assertIsInstance(list_page, dict)
        block = main._manifest_find_first_view_modes_block(list_page.get("content"))
        self.assertIsInstance(block, dict)
        modes = [item.get("mode") for item in (block.get("modes") or []) if isinstance(item, dict)]
        self.assertIn("kanban", modes)
        self.assertNotIn("calendar", modes)
        self.assertFalse(
            any(
                isinstance(page, dict) and page.get("id") == "supplier_compliance.calendar_page"
                for page in (normalized.get("pages") or [])
            )
        )

    def test_register_scaffold_uses_vehicle_primary_surface_with_list_graph_and_no_board_or_calendar(self) -> None:
        manifest = _ai_build_new_module_scaffold(
            "fleet_register",
            "Fleet Register",
            "Create a fleet register to track vehicles, service dates, assigned drivers, condition, and location.",
        )
        normalized, errors, warnings = validate_manifest_raw(manifest, expected_module_id="fleet_register")
        self.assertEqual(errors, [], f"errors: {errors} warnings: {warnings}")
        nav_items = [
            item.get("label")
            for group in ((normalized.get("app") or {}).get("nav") or [])
            if isinstance(group, dict)
            for item in (group.get("items") or [])
            if isinstance(item, dict) and isinstance(item.get("label"), str)
        ]
        self.assertIn("Vehicle", nav_items)
        list_page = next(
            (
                page
                for page in (normalized.get("pages") or [])
                if isinstance(page, dict) and page.get("id") == "vehicle.list_page"
            ),
            None,
        )
        self.assertIsInstance(list_page, dict)
        block = main._manifest_find_first_view_modes_block(list_page.get("content"))
        self.assertIsInstance(block, dict)
        modes = [item.get("mode") for item in (block.get("modes") or []) if isinstance(item, dict)]
        self.assertEqual(block.get("default_mode"), "list")
        self.assertIn("graph", modes)
        self.assertNotIn("kanban", modes)
        self.assertNotIn("calendar", modes)

    def test_fleet_maintenance_design_spec_prefers_vehicle_primary_entity_and_service_history(self) -> None:
        spec = _ai_generate_module_design_spec(
            "fleet_maintenance",
            "Fleet Maintenance",
            "Create a module for tracking vehicle maintenance for our fleet, including service history, odometer readings, assigned drivers, and next service dates.",
        )
        self.assertEqual(spec.get("family"), "fleet")
        self.assertEqual(spec.get("entity_slug"), "vehicle")
        self.assertEqual(spec.get("entity_label"), "Vehicle")
        related = [item for item in (spec.get("related_entities") or []) if isinstance(item, dict)]
        self.assertTrue(any(item.get("entity_slug") == "maintenance_record" for item in related), related)

    def test_fleet_maintenance_scaffold_adds_vehicle_register_and_related_maintenance_records(self) -> None:
        manifest = _ai_build_new_module_scaffold(
            "fleet_maintenance",
            "Fleet Maintenance",
            "Create a module for tracking vehicle maintenance for our fleet, including service history, odometer readings, assigned drivers, and next service dates.",
        )
        normalized, errors, warnings = validate_manifest_raw(manifest, expected_module_id="fleet_maintenance")
        self.assertEqual(errors, [], f"errors: {errors} warnings: {warnings}")
        entities = {
            entity.get("id"): entity
            for entity in (normalized.get("entities") or [])
            if isinstance(entity, dict) and isinstance(entity.get("id"), str)
        }
        self.assertIn("entity.vehicle", entities)
        self.assertIn("entity.maintenance_record", entities)
        vehicle_fields = [field.get("id") for field in (entities["entity.vehicle"].get("fields") or []) if isinstance(field, dict)]
        for expected_field in (
            "vehicle.registration_number",
            "vehicle.odometer",
            "vehicle.service_due_date",
            "vehicle.driver_name",
            "vehicle.condition",
        ):
            self.assertIn(expected_field, vehicle_fields)
        maintenance_fields = [field.get("id") for field in (entities["entity.maintenance_record"].get("fields") or []) if isinstance(field, dict)]
        for expected_field in (
            "maintenance_record.vehicle_id",
            "maintenance_record.service_date",
            "maintenance_record.service_type",
            "maintenance_record.cost",
            "maintenance_record.next_due_date",
        ):
            self.assertIn(expected_field, maintenance_fields)
        nav_items = [
            item.get("label")
            for group in ((normalized.get("app") or {}).get("nav") or [])
            if isinstance(group, dict)
            for item in (group.get("items") or [])
            if isinstance(item, dict) and isinstance(item.get("label"), str)
        ]
        self.assertIn("Vehicle", nav_items)
        self.assertIn("Maintenance Records", nav_items)
        vehicle_list_page = next(
            (
                page
                for page in (normalized.get("pages") or [])
                if isinstance(page, dict) and page.get("id") == "vehicle.list_page"
            ),
            None,
        )
        self.assertIsInstance(vehicle_list_page, dict)
        block = main._manifest_find_first_view_modes_block(vehicle_list_page.get("content"))
        self.assertIsInstance(block, dict)
        modes = [item.get("mode") for item in (block.get("modes") or []) if isinstance(item, dict)]
        self.assertEqual(block.get("default_mode"), "list")
        self.assertIn("graph", modes)
        self.assertNotIn("kanban", modes)
        self.assertNotIn("calendar", modes)
        view_by_id = {
            view.get("id"): view
            for view in (normalized.get("views") or [])
            if isinstance(view, dict) and isinstance(view.get("id"), str)
        }
        list_columns = [item.get("field_id") for item in ((view_by_id["vehicle.list"].get("columns") or [])) if isinstance(item, dict)]
        self.assertEqual(list_columns[0], "vehicle.name")
        self.assertIn("vehicle.registration_number", list_columns)
        self.assertIn("vehicle.condition", list_columns)
        self.assertIn("vehicle.service_due_date", list_columns)
        vehicle_form = view_by_id.get("vehicle.form") or {}
        tabs = ((((vehicle_form.get("header") or {}).get("tabs") or {}).get("tabs")) or [])
        self.assertTrue(any(isinstance(tab, dict) and tab.get("label") == "Maintenance History" for tab in tabs), tabs)

    def test_workflow_transition_fallback_uses_action_verbs_for_terminal_states(self) -> None:
        transitions = main._ai_workflow_transitions_for_states(["planned", "completed", "cancelled"])
        labels = [item.get("label") for item in transitions if isinstance(item, dict)]
        self.assertIn("Complete", labels)
        self.assertIn("Cancel", labels)
        self.assertNotIn("Completed", labels)
        self.assertNotIn("Cancelled", labels)

    def test_recipe_scaffold_prioritizes_cooking_signals_in_list_and_kanban(self) -> None:
        manifest = _ai_build_new_module_scaffold(
            "kitchen_recipes",
            "Kitchen Recipes",
            "Create a new module to track my cooking recipes and ingredients I have at home. Come up with something cool.",
        )
        normalized, errors, warnings = validate_manifest_raw(manifest, expected_module_id="kitchen_recipes")
        self.assertEqual(errors, [], f"errors: {errors} warnings: {warnings}")
        view_by_id = {
            view.get("id"): view
            for view in (normalized.get("views") or [])
            if isinstance(view, dict) and isinstance(view.get("id"), str)
        }
        list_columns = [item.get("field_id") for item in ((view_by_id["kitchen_recipe.list"].get("columns") or [])) if isinstance(item, dict)]
        self.assertEqual(list_columns[0], "kitchen_recipe.name")
        self.assertIn("kitchen_recipe.status", list_columns)
        self.assertIn("kitchen_recipe.meal_type", list_columns)
        self.assertIn("kitchen_recipe.cuisine", list_columns)
        subtitle_fields = (((view_by_id["kitchen_recipe.kanban"].get("card") or {}).get("subtitle_fields")) or [])
        self.assertIn("kitchen_recipe.meal_type", subtitle_fields)
        self.assertIn("kitchen_recipe.cuisine", subtitle_fields)
        self.assertNotIn("kitchen_recipe.created_at", subtitle_fields)
        badge_fields = (((view_by_id["kitchen_recipe.kanban"].get("card") or {}).get("badge_fields")) or [])
        self.assertTrue(
            any(field_id in {"kitchen_recipe.servings", "kitchen_recipe.meal_type", "kitchen_recipe.cuisine"} for field_id in badge_fields),
            badge_fields,
        )
        self.assertNotIn("kitchen_recipe.status", badge_fields)
        search_cfg = ((view_by_id["kitchen_recipe.list"].get("header") or {}).get("search")) or {}
        self.assertTrue(search_cfg.get("enabled"))
        search_fields = search_cfg.get("fields") or []
        self.assertIn("kitchen_recipe.name", search_fields)
        self.assertIn("kitchen_recipe.meal_type", search_fields)
        self.assertIn("kitchen_recipe.cuisine", search_fields)
        self.assertNotIn("kitchen_recipe.servings", search_fields)

        create_action = next(
            (
                action
                for action in (normalized.get("actions") or [])
                if isinstance(action, dict) and action.get("id") == "action.kitchen_recipe_new"
            ),
            None,
        )
        self.assertIsInstance(create_action, dict)
        self.assertEqual(create_action.get("label"), "New")

    def test_site_visit_scaffold_avoids_redundant_completed_style_buttons(self) -> None:
        manifest = _ai_build_new_module_scaffold(
            "site_visits",
            "Site Visits",
            "Create a simple module to manage site visits, visit dates, customer, outcome, and notes. Call it Site Visits.",
        )
        normalized, errors, warnings = validate_manifest_raw(manifest, expected_module_id="site_visits")
        self.assertEqual(errors, [], f"errors: {errors} warnings: {warnings}")
        actions = [action for action in (normalized.get("actions") or []) if isinstance(action, dict)]
        labels = [action.get("label") for action in actions if isinstance(action.get("label"), str)]
        self.assertIn("Confirm", labels)
        self.assertIn("Complete", labels)
        self.assertIn("Cancel", labels)
        self.assertNotIn("Completed", labels)
        self.assertNotIn("Cancelled", labels)
        form_view = next(
            (
                view
                for view in (normalized.get("views") or [])
                if isinstance(view, dict) and view.get("id") == "site_visit.form"
            ),
            None,
        )
        self.assertIsInstance(form_view, dict)
        secondary_actions = ((form_view.get("header") or {}).get("secondary_actions") or [])
        action_ids = [item.get("action_id") for item in secondary_actions if isinstance(item, dict)]
        self.assertIn("action.site_visit_confirm", action_ids)
        self.assertIn("action.site_visit_complete", action_ids)
        self.assertIn("action.site_visit_cancel", action_ids)
        self.assertNotIn("action.site_visit_completed", action_ids)
        self.assertNotIn("action.site_visit_cancelled", action_ids)
        list_view = next(
            (
                view
                for view in (normalized.get("views") or [])
                if isinstance(view, dict) and view.get("id") == "site_visit.list"
            ),
            None,
        )
        self.assertIsInstance(list_view, dict)
        bulk_actions = ((list_view.get("header") or {}).get("bulk_actions") or [])
        bulk_action_ids = [item.get("action_id") for item in bulk_actions if isinstance(item, dict)]
        self.assertIn("action.site_visit_bulk_confirm", bulk_action_ids)
        self.assertIn("action.site_visit_bulk_complete", bulk_action_ids)
        self.assertIn("action.site_visit_bulk_cancel", bulk_action_ids)

    def test_model_primary_design_spec_wins_when_it_is_richer_than_fallback(self) -> None:
        model_spec = {
            "version": "1",
            "family": "recipe",
            "summary": "Kitchen Recipes with pantry visibility and cooking workflow.",
            "entity_slug": "kitchen_recipe",
            "entity_label": "Kitchen Recipe",
            "nav_label": "Kitchen Recipes",
            "primary_label": "Recipe Name",
            "statuses": [
                {"label": "Draft", "value": "draft"},
                {"label": "Ready To Cook", "value": "ready_to_cook"},
                {"label": "Cooked", "value": "cooked"},
            ],
            "fields": [
                {"id": "kitchen_recipe.name", "type": "string", "label": "Recipe Name", "required": True},
                {"id": "kitchen_recipe.status", "type": "enum", "label": "Status", "options": [{"label": "Draft", "value": "draft"}, {"label": "Ready To Cook", "value": "ready_to_cook"}, {"label": "Cooked", "value": "cooked"}]},
                {"id": "kitchen_recipe.owner_id", "type": "user", "label": "Owner"},
                {"id": "kitchen_recipe.cuisine", "type": "string", "label": "Cuisine"},
                {"id": "kitchen_recipe.meal_type", "type": "string", "label": "Meal Type"},
                {"id": "kitchen_recipe.prep_minutes", "type": "number", "label": "Prep Time (Minutes)"},
                {"id": "kitchen_recipe.cook_minutes", "type": "number", "label": "Cook Time (Minutes)"},
                {"id": "kitchen_recipe.servings", "type": "number", "label": "Servings"},
                {"id": "kitchen_recipe.ingredients_on_hand", "type": "bool", "label": "Ingredients On Hand"},
                {"id": "kitchen_recipe.ingredient_list", "type": "text", "label": "Ingredients"},
                {"id": "kitchen_recipe.method", "type": "text", "label": "Method"},
                {"id": "kitchen_recipe.last_cooked_on", "type": "date", "label": "Last Cooked On"},
            ],
            "workflow": {"enabled": True, "status_field": "kitchen_recipe.status", "states": [{"label": "Draft", "value": "draft"}, {"label": "Ready To Cook", "value": "ready_to_cook"}, {"label": "Cooked", "value": "cooked"}], "action_labels": ["Plan", "Cook"]},
            "layout": {
                "sections": [
                    {"id": "overview", "title": "Overview", "fields": ["kitchen_recipe.name", "kitchen_recipe.status", "kitchen_recipe.cuisine", "kitchen_recipe.meal_type"]},
                    {"id": "ingredients", "title": "Ingredients", "fields": ["kitchen_recipe.ingredients_on_hand", "kitchen_recipe.ingredient_list", "kitchen_recipe.method"]},
                ],
                "tabs": [
                    {"id": "overview_tab", "label": "Overview", "sections": ["overview"]},
                    {"id": "ingredients_tab", "label": "Ingredients", "sections": ["ingredients"]},
                ],
                "default_tab": "overview_tab",
            },
            "experience": {
                "views": ["list", "form", "kanban", "calendar", "graph"],
                "pages": [{"id": "kitchen_recipe.list_page", "title": "Kitchen Recipes"}, {"id": "kitchen_recipe.form_page", "title": "Kitchen Recipe"}, {"id": "kitchen_recipe.calendar_page", "title": "Kitchen Recipe Calendar"}],
                "interfaces": ["dashboardable", "schedulable"],
            },
        }
        with patch.object(main, "_ai_request_module_design_spec_from_model", lambda *_args, **_kwargs: model_spec):
            spec = _ai_generate_module_design_spec(
                "kitchen_recipes",
                "Kitchen Recipes",
                "Create a new module to track my cooking recipes and ingredients I have at home. Come up with something cool.",
            )

        self.assertEqual(spec.get("design_source"), "model_primary")
        self.assertEqual(spec.get("family"), "recipe")
        self.assertIn("Ingredients", [field.get("label") for field in (spec.get("fields") or []) if isinstance(field, dict)])


if __name__ == "__main__":
    unittest.main()
