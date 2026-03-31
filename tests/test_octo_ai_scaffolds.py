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
        self.assertTrue(digest["feature_flags"].get("has_calendar"))
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
        self.assertTrue(any(page.get("id") == "software_delivery.calendar_page" for page in (normalized.get("pages") or []) if isinstance(page, dict)))

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
        self.assertIn("calendar", (spec.get("experience") or {}).get("views", []))
        self.assertTrue((spec.get("layout") or {}).get("sections"))
        self.assertTrue((spec.get("quality") or {}).get("ok"))

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
