import os
import sys
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "src")
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
if SRC not in sys.path:
    sys.path.insert(0, SRC)

os.environ["USE_DB"] = "0"
os.environ["OCTO_DISABLE_AUTH"] = "1"
os.environ["SUPABASE_URL"] = "http://localhost"

from app import main


def contacts_manifest():
    return {
        "manifest_version": "1.3",
        "module": {"id": "contacts", "name": "Contacts"},
        "entities": [
            {
                "id": "entity.contact",
                "label": "Contact",
                "display_field": "contact.first_name",
                "fields": [
                    {"id": "contact.first_name", "type": "string", "label": "First Name", "required": True},
                    {"id": "contact.last_name", "type": "string", "label": "Last Name", "required": True},
                    {"id": "contact.email", "type": "string", "label": "Email"},
                    {"id": "contact.address", "type": "text", "label": "Address"},
                    {"id": "contact.type", "type": "enum", "label": "Type", "options": ["lead", "customer"]},
                ],
            }
        ],
        "views": [
            {
                "id": "contact.list",
                "kind": "list",
                "entity": "entity.contact",
                "columns": [{"field_id": "contact.first_name"}, {"field_id": "contact.last_name"}],
            },
            {
                "id": "contact.form",
                "kind": "form",
                "entity": "entity.contact",
                "sections": [{"id": "main", "title": "Main", "fields": ["contact.first_name", "contact.last_name", "contact.email", "contact.type"]}],
            },
        ],
        "pages": [
            {"id": "contact.list_page", "title": "Contacts", "layout": "single", "content": [{"kind": "view", "target": "contact.list"}]},
            {"id": "contact.form_page", "title": "Contact", "layout": "single", "content": [{"kind": "view", "target": "contact.form"}]},
        ],
        "actions": [],
        "workflows": [],
        "app": {"home": "page:contact.list_page", "nav": [{"group": "Main", "items": [{"label": "Contacts", "to": "page:contact.list_page"}]}]},
    }


def jobs_manifest():
    return {
        "manifest_version": "1.3",
        "module": {"id": "jobs", "name": "Jobs"},
        "entities": [
            {
                "id": "entity.job",
                "label": "Job",
                "display_field": "job.title",
                "fields": [
                    {"id": "job.title", "type": "string", "label": "Title", "required": True},
                    {"id": "job.status", "type": "enum", "label": "Status", "options": ["draft", "in_progress", "done"]},
                    {"id": "job.notes", "type": "text", "label": "Notes"},
                ],
            }
        ],
        "views": [
            {
                "id": "job.list",
                "kind": "list",
                "entity": "entity.job",
                "columns": [{"field_id": "job.title"}],
            },
            {
                "id": "job.form",
                "kind": "form",
                "entity": "entity.job",
                "sections": [{"id": "main", "title": "Main", "fields": ["job.title", "job.status", "job.notes"]}],
            },
        ],
        "pages": [
            {"id": "job.list_page", "title": "Jobs", "layout": "single", "content": [{"kind": "view", "target": "job.list"}]},
            {"id": "job.form_page", "title": "Job", "layout": "single", "content": [{"kind": "view", "target": "job.form"}]},
        ],
        "actions": [],
        "workflows": [
            {
                "entity": "entity.job",
                "status_field": "job.status",
                "states": ["draft", "in_progress", "done"],
            }
        ],
        "app": {"home": "page:job.list_page", "nav": [{"group": "Main", "items": [{"label": "Jobs", "to": "page:job.list_page"}]}]},
    }


class TestStudio2Baselines(unittest.TestCase):
    def _assert_modern_list_page(self, manifest, page_id, expected_target):
        page = next(page for page in (manifest.get("pages") or []) if isinstance(page, dict) and page.get("id") == page_id)
        self.assertEqual(page.get("header"), {"variant": "none"})
        content = page.get("content") or []
        self.assertEqual(len(content), 1)
        self.assertEqual((content[0] or {}).get("kind"), "container")
        self.assertEqual((content[0] or {}).get("variant"), "card")
        nested = (((content[0] or {}).get("content") or [None])[0]) or {}
        self.assertEqual(nested.get("kind"), "view_modes")
        modes = nested.get("modes") or []
        self.assertTrue(any(isinstance(mode, dict) and mode.get("target") == expected_target for mode in modes))
        self.assertEqual(
            [
                block
                for block in content
                if isinstance(block, dict) and block.get("kind") == "view" and block.get("target") == expected_target
            ],
            [],
        )

    def _assert_modern_form_page(self, manifest, page_id, entity_id, expected_target):
        page = next(page for page in (manifest.get("pages") or []) if isinstance(page, dict) and page.get("id") == page_id)
        self.assertEqual(page.get("header"), {"variant": "none"})
        content = page.get("content") or []
        self.assertEqual(len(content), 1)
        record = content[0] or {}
        self.assertEqual(record.get("kind"), "record")
        self.assertEqual(record.get("entity_id"), entity_id)
        grid = (((record.get("content") or [None])[0]) or {})
        self.assertEqual(grid.get("kind"), "grid")
        items = grid.get("items") or []
        self.assertEqual(len(items), 2)
        left = items[0] or {}
        right = items[1] or {}
        self.assertEqual(left.get("span"), 8)
        self.assertEqual(right.get("span"), 4)
        left_card = (((left.get("content") or [None])[0]) or {})
        self.assertEqual(left_card.get("kind"), "container")
        self.assertEqual(left_card.get("variant"), "card")
        left_view = ((((left_card.get("content") or [None])[0]) or {}))
        self.assertEqual(left_view.get("kind"), "view")
        self.assertEqual(left_view.get("target"), expected_target)
        right_card = (((right.get("content") or [None])[0]) or {})
        self.assertEqual(right_card.get("kind"), "container")
        self.assertEqual(right_card.get("variant"), "card")
        chatter = ((((right_card.get("content") or [None])[0]) or {}))
        self.assertEqual(chatter.get("kind"), "chatter")
        self.assertEqual(chatter.get("entity_id"), entity_id)
        self.assertEqual(chatter.get("record_ref"), "$record.id")

    def test_contacts_no_workflow_statusbar(self):
        manifest = contacts_manifest()
        normalized, _ = main.normalize_manifest_v13(manifest, module_id="contacts", cache={})
        workflows = normalized.get("workflows") or []
        self.assertEqual(workflows, [])
        form_view = next(v for v in normalized["views"] if v.get("id") == "contact.form")
        header = form_view.get("header") or {}
        self.assertTrue("statusbar" not in header)
        enum_field = next(f for f in normalized["entities"][0]["fields"] if f.get("id") == "contact.type")
        self.assertTrue(all(isinstance(opt, dict) for opt in enum_field.get("options", [])))
        self._assert_modern_list_page(normalized, "contact.list_page", "view:contact.list")

    def test_jobs_workflow_statusbar(self):
        manifest = jobs_manifest()
        normalized, _ = main.normalize_manifest_v13(manifest, module_id="jobs", cache={})
        workflows = normalized.get("workflows") or []
        self.assertEqual(len(workflows), 1)
        wf = workflows[0]
        form_view = next(v for v in normalized["views"] if v.get("id") == "job.form")
        header = form_view.get("header") or {}
        self.assertEqual(header.get("statusbar", {}).get("field_id"), wf.get("status_field"))
        enum_field = next(f for f in normalized["entities"][0]["fields"] if f.get("id") == "job.status")
        self.assertTrue(all(isinstance(opt, dict) for opt in enum_field.get("options", [])))
        actions = normalized.get("actions") or []
        self.assertTrue(any(a.get("kind") == "update_record" and a.get("patch", {}).get("job.status") for a in actions))
        self._assert_modern_list_page(normalized, "job.list_page", "view:job.list")

    def test_minimal_baseline_columns_and_form_fields(self):
        manifest = {
            "manifest_version": "1.3",
            "module": {"id": "m1", "name": "Test"},
            "entities": [
                {
                    "id": "entity.item",
                    "label": "Item",
                    "display_field": "item.name",
                    "fields": [
                        {"id": "item.name", "type": "string", "label": "Name", "required": True},
                        {"id": "item.code", "type": "string", "label": "Code", "required": True},
                        {"id": "item.notes", "type": "text", "label": "Notes"},
                    ],
                }
            ],
            "views": [
                {"id": "item.list", "kind": "list", "entity": "entity.item", "columns": []},
                {"id": "item.form", "kind": "form", "entity": "entity.item", "sections": [{"id": "main", "fields": []}]},
            ],
            "pages": [],
            "actions": [],
            "workflows": [],
            "app": {"home": "page:home", "nav": []},
        }
        normalized, _ = main.normalize_manifest_v13(manifest, module_id="m1", cache={})
        list_view = next(v for v in normalized["views"] if v.get("id") == "item.list")
        cols = list_view.get("columns") or []
        self.assertGreaterEqual(len(cols), 2)
        form_view = next(v for v in normalized["views"] if v.get("id") == "item.form")
        fields = form_view.get("sections", [])[0].get("fields") if form_view.get("sections") else []
        self.assertIn("item.name", fields)
        self.assertIn("item.code", fields)

    def test_list_header_does_not_auto_add_legacy_search(self):
        manifest = {
            "manifest_version": "1.3",
            "module": {"id": "m2", "name": "Test"},
            "entities": [
                {
                    "id": "entity.item",
                    "label": "Item",
                    "display_field": "item.name",
                    "fields": [
                        {"id": "item.name", "type": "string", "label": "Name", "required": True},
                        {"id": "item.code", "type": "string", "label": "Code"},
                    ],
                }
            ],
            "views": [
                {"id": "item.list", "kind": "list", "entity": "entity.item", "columns": [{"field_id": "item.name"}], "header": {}},
                {"id": "item.form", "kind": "form", "entity": "entity.item", "sections": [{"id": "main", "fields": ["item.name", "item.code"]}]},
            ],
            "pages": [],
            "actions": [],
            "workflows": [],
            "app": {"home": "page:home", "nav": []},
        }
        normalized, _ = main.normalize_manifest_v13(manifest, module_id="m2", cache={})
        list_view = next(v for v in normalized["views"] if v.get("id") == "item.list")
        header = list_view.get("header") or {}
        self.assertNotIn("search", header)
        self.assertEqual(list_view.get("create_behavior"), "open_form")
        self.assertEqual(header.get("primary_actions"), [{"action_id": "action.item_new"}])

    def test_enforce_architecture_replaces_placeholder_home_and_main_nav(self):
        manifest = {
            "manifest_version": "1.3",
            "module": {"id": "recipes", "name": "Recipes"},
            "entities": [
                {
                    "id": "entity.recipe",
                    "label": "Recipe",
                    "display_field": "recipe.name",
                    "fields": [
                        {"id": "recipe.name", "type": "string", "label": "Recipe Name", "required": True},
                        {"id": "recipe.status", "type": "enum", "label": "Status", "options": ["draft", "ready_to_cook", "cooked"]},
                        {"id": "recipe.last_cooked_on", "type": "date", "label": "Last Cooked On"},
                    ],
                }
            ],
            "views": [],
            "pages": [{"id": "home", "title": "Home", "layout": "single", "content": []}],
            "actions": [],
            "workflows": [],
            "app": {"home": "page:home", "nav": [{"group": "Main", "items": [{"label": "Home", "to": "page:home"}]}]},
        }
        enriched = main._studio2_enforce_architecture(manifest)
        self.assertEqual((enriched.get("app") or {}).get("home"), "page:recipe.list_page")
        nav = ((enriched.get("app") or {}).get("nav") or [None])[0] or {}
        self.assertEqual(nav.get("group"), "Recipes")
        self.assertEqual(nav.get("items"), [{"label": "Recipe", "to": "page:recipe.list_page"}])

    def test_normalize_manifest_removes_unused_placeholder_home_page_when_real_home_exists(self):
        manifest = {
            "manifest_version": "1.3",
            "module": {"id": "fleet", "name": "Fleet"},
            "entities": [
                {
                    "id": "entity.vehicle",
                    "label": "Vehicle",
                    "display_field": "vehicle.name",
                    "fields": [
                        {"id": "vehicle.name", "type": "string", "label": "Name", "required": True},
                        {"id": "vehicle.model", "type": "string", "label": "Model"},
                        {"id": "vehicle.year", "type": "number", "label": "Year"},
                    ],
                }
            ],
            "views": [
                {
                    "id": "vehicle.list",
                    "kind": "list",
                    "entity": "entity.vehicle",
                    "columns": [{"field_id": "vehicle.name"}, {"field_id": "vehicle.model"}],
                    "open_record": {"to": "page:vehicle.form_page", "param": "record"},
                },
                {
                    "id": "vehicle.form",
                    "kind": "form",
                    "entity": "entity.vehicle",
                    "sections": [{"id": "main", "fields": ["vehicle.name", "vehicle.model", "vehicle.year"]}],
                },
            ],
            "pages": [
                {"id": "home", "title": "Home", "layout": "single", "content": []},
                {"id": "vehicle.list_page", "title": "Vehicle", "layout": "single", "content": [{"kind": "view", "target": "vehicle.list"}]},
                {"id": "vehicle.form_page", "title": "Vehicle", "layout": "single", "content": [{"kind": "record", "entity_id": "entity.vehicle", "record_id_query": "record", "content": [{"kind": "view", "target": "vehicle.form"}]}]},
            ],
            "actions": [],
            "workflows": [],
            "app": {
                "home": "page:vehicle.list_page",
                "nav": [{"group": "Fleet", "items": [{"label": "Vehicle", "to": "page:vehicle.list_page"}]}],
            },
        }
        normalized, warnings = main.normalize_manifest_v13(manifest, module_id="fleet", cache={})
        page_ids = {page.get("id") for page in (normalized.get("pages") or []) if isinstance(page, dict)}
        self.assertNotIn("home", page_ids)
        self.assertTrue(any(item.get("code") == "NORMALIZED_PLACEHOLDER_HOME" for item in warnings), warnings)

    def test_normalize_manifest_keeps_calendar_views_inside_module_surface_not_nav(self):
        manifest = {
            "manifest_version": "1.3",
            "module": {"id": "m2b", "name": "Visits"},
            "entities": [
                {
                    "id": "entity.visit",
                    "label": "Visit",
                    "display_field": "visit.name",
                    "fields": [
                        {"id": "visit.name", "type": "string", "label": "Visit Name", "required": True},
                        {"id": "visit.status", "type": "enum", "label": "Status", "options": ["draft", "scheduled", "complete"]},
                        {"id": "visit.visit_date", "type": "date", "label": "Visit Date"},
                    ],
                }
            ],
            "views": [
                {
                    "id": "visit.list",
                    "kind": "list",
                    "entity": "entity.visit",
                    "columns": [{"field_id": "visit.name"}, {"field_id": "visit.status"}],
                },
                {
                    "id": "visit.form",
                    "kind": "form",
                    "entity": "entity.visit",
                    "sections": [{"id": "main", "fields": ["visit.name", "visit.status", "visit.visit_date"]}],
                },
                {
                    "id": "visit.calendar",
                    "kind": "calendar",
                    "entity": "entity.visit",
                    "calendar": {"title_field": "visit.name", "date_start": "visit.visit_date", "date_end": "visit.visit_date"},
                },
            ],
            "pages": [
                {
                    "id": "visit.list_page",
                    "title": "Visits",
                    "layout": "single",
                    "content": [
                        {
                            "kind": "container",
                            "variant": "card",
                            "content": [
                                {
                                    "kind": "view_modes",
                                    "entity_id": "entity.visit",
                                    "default_mode": "list",
                                    "modes": [
                                        {"mode": "list", "target": "view:visit.list"},
                                        {"mode": "calendar", "target": "view:visit.calendar"},
                                    ],
                                }
                            ],
                        }
                    ],
                },
                {"id": "visit.form_page", "title": "Visit", "layout": "single", "content": [{"kind": "record", "entity_id": "entity.visit", "record_id_query": "record", "content": [{"kind": "view", "target": "view:visit.form"}]}]},
            ],
            "actions": [],
            "workflows": [],
            "app": {"home": "page:visit.list_page", "nav": [{"group": "Visits", "items": [{"label": "Visits", "to": "page:visit.list_page"}]}]},
        }
        normalized, _ = main.normalize_manifest_v13(manifest, module_id="m2b", cache={})
        nav = ((normalized.get("app") or {}).get("nav") or [None])[0] or {}
        self.assertEqual(nav.get("items"), [{"label": "Visits", "to": "page:visit.list_page"}])
        list_page = next(page for page in (normalized.get("pages") or []) if isinstance(page, dict) and page.get("id") == "visit.list_page")
        block = main._manifest_find_first_view_modes_block(list_page.get("content"))
        self.assertIsInstance(block, dict)
        modes = [item.get("mode") for item in (block.get("modes") or []) if isinstance(item, dict)]
        self.assertIn("calendar", modes)

    def test_normalize_manifest_fills_empty_list_page_with_view_modes_scaffold(self):
        manifest = {
            "manifest_version": "1.3",
            "module": {"id": "m3", "name": "Test"},
            "entities": [
                {
                    "id": "entity.item",
                    "label": "Item",
                    "display_field": "item.name",
                    "fields": [{"id": "item.name", "type": "string", "label": "Name", "required": True}],
                }
            ],
            "views": [
                {"id": "item.list", "kind": "list", "entity": "entity.item", "columns": [{"field_id": "item.name"}]},
                {"id": "item.form", "kind": "form", "entity": "entity.item", "sections": [{"id": "main", "fields": ["item.name"]}]},
            ],
            "pages": [{"id": "item.list_page", "title": "Items", "layout": "single", "content": []}],
            "actions": [],
            "workflows": [],
            "app": {"home": "page:item.list_page", "nav": []},
        }
        normalized, _ = main.normalize_manifest_v13(manifest, module_id="m3", cache={})
        self._assert_modern_list_page(normalized, "item.list_page", "view:item.list")

    def test_sanitize_manifest_rewrites_legacy_list_page_scaffold(self):
        manifest = contacts_manifest()
        sanitized = main._sanitize_manifest(manifest)
        self._assert_modern_list_page(sanitized, "contact.list_page", "view:contact.list")

    def test_normalize_manifest_rewrites_legacy_form_page_scaffold_and_adds_activity_defaults(self):
        manifest = {
            "manifest_version": "1.3",
            "module": {"id": "m4", "name": "Test"},
            "entities": [
                {
                    "id": "entity.item",
                    "label": "Item",
                    "display_field": "item.name",
                    "fields": [
                        {"id": "item.name", "type": "string", "label": "Name", "required": True},
                        {"id": "item.status", "type": "enum", "label": "Status", "options": ["draft", "active"]},
                        {"id": "item.attachments", "type": "attachments", "label": "Attachments"},
                        {"id": "item.due_date", "type": "date", "label": "Due Date"},
                    ],
                }
            ],
            "views": [
                {"id": "item.list", "kind": "list", "entity": "entity.item", "columns": [{"field_id": "item.name"}]},
                {"id": "item.form", "kind": "form", "entity": "entity.item", "sections": [{"id": "main", "fields": ["item.name", "item.status", "item.attachments", "item.due_date"]}]},
            ],
            "pages": [
                {"id": "item.list_page", "title": "Items", "layout": "single", "content": [{"kind": "view", "target": "item.list"}]},
                {"id": "item.form_page", "title": "Item", "layout": "single", "content": [{"kind": "record", "entity_id": "entity.item", "record_id_query": "record", "content": [{"kind": "view", "target": "item.form"}]}]},
            ],
            "actions": [],
            "workflows": [],
            "app": {"home": "page:item.list_page", "nav": []},
        }
        normalized, _ = main.normalize_manifest_v13(manifest, module_id="m4", cache={})
        self._assert_modern_form_page(normalized, "item.form_page", "entity.item", "view:item.form")
        form_view = next(view for view in (normalized.get("views") or []) if isinstance(view, dict) and view.get("id") == "item.form")
        activity = form_view.get("activity") or {}
        self.assertTrue(activity.get("enabled"))
        self.assertEqual(activity.get("mode"), "tab")
        self.assertTrue(activity.get("allow_comments"))
        self.assertTrue(activity.get("allow_attachments"))
        self.assertIn("item.status", activity.get("tracked_fields") or [])

    def test_enforce_architecture_upgrades_basic_form_page_scaffold(self):
        manifest = {
            "manifest_version": "1.3",
            "module": {"id": "m5", "name": "Products"},
            "entities": [
                {
                    "id": "entity.product",
                    "label": "Product",
                    "display_field": "product.name",
                    "fields": [
                        {"id": "product.name", "type": "string", "label": "Name", "required": True},
                        {"id": "product.attachments", "type": "attachments", "label": "Attachments"},
                    ],
                }
            ],
            "views": [
                {"id": "product.list", "kind": "list", "entity": "entity.product", "columns": [{"field_id": "product.name"}]},
                {"id": "product.form", "kind": "form", "entity": "entity.product", "sections": [{"id": "main", "fields": ["product.name", "product.attachments"]}]},
            ],
            "pages": [
                {"id": "product.list_page", "title": "Products", "header": {"variant": "none"}, "layout": "single", "content": [{"kind": "container", "variant": "card", "content": [{"kind": "view_modes", "entity_id": "entity.product", "default_mode": "list", "modes": [{"mode": "list", "target": "view:product.list"}]}]}]},
                {"id": "product.form_page", "title": "Product", "layout": "single", "content": [{"kind": "record", "entity_id": "entity.product", "record_id_query": "record", "content": [{"kind": "view", "target": "view:product.form"}]}]},
            ],
            "actions": [],
            "workflows": [],
            "app": {"home": "page:product.list_page", "nav": []},
        }
        enforced = main._studio2_enforce_architecture(manifest)
        self._assert_modern_form_page(enforced, "product.form_page", "entity.product", "view:product.form")
        form_view = next(view for view in (enforced.get("views") or []) if isinstance(view, dict) and view.get("id") == "product.form")
        self.assertTrue(((form_view.get("activity") or {}).get("allow_attachments")))

    def test_legacy_seed_template_uses_generic_new_labels(self):
        manifest = main._build_v1_template("legacy_demo")
        list_views = [view for view in manifest.get("views", []) if isinstance(view, dict) and view.get("kind") == "list"]
        self.assertTrue(list_views)
        for view in list_views:
            header = view.get("header") or {}
            self.assertNotIn("search", header)
            actions = header.get("primary_actions") or []
            self.assertTrue(actions)
            self.assertEqual(actions[0].get("label"), "New")
        self._assert_modern_list_page(manifest, "legacy_demo_item.list_page", "view:legacy_demo_item.list")
        self._assert_modern_list_page(manifest, "legacy_demo_contact.list_page", "view:legacy_demo_contact.list")


if __name__ == "__main__":
    unittest.main()
