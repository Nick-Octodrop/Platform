import unittest

from app.manifest_validate import validate_manifest_raw


class TestManifestBlocks(unittest.TestCase):
    def _base_manifest(self) -> dict:
        return {
            "manifest_version": "1.1",
            "module": {"id": "m1", "name": "M1"},
            "entities": [
                {"id": "entity.item", "fields": [{"id": "item.name", "type": "string"}]},
            ],
            "views": [
                {"id": "item.list", "entity": "item", "kind": "list", "columns": [{"field_id": "item.name"}]},
                {"id": "item.form", "entity": "item", "kind": "form", "sections": [{"id": "main", "fields": ["item.name"]}]},
            ],
        }

    def test_valid_grid_tabs(self) -> None:
        manifest = self._base_manifest()
        manifest["pages"] = [
            {
                "id": "home",
                "content": [
                    {
                        "kind": "grid",
                        "columns": 12,
                        "items": [
                            {"span": 4, "content": [{"kind": "view", "target": "item.list"}]},
                            {
                                "span": 8,
                                "content": [
                                    {
                                        "kind": "tabs",
                                        "tabs": [
                                            {"id": "details", "label": "Details", "content": [{"kind": "view", "target": "item.form"}]},
                                            {"id": "history", "label": "History", "content": [{"kind": "text", "text": "Hi"}]},
                                        ],
                                        "default_tab": "details",
                                    }
                                ],
                            },
                        ],
                    }
                ],
            }
        ]
        _, errors, _ = validate_manifest_raw(manifest, expected_module_id="m1")
        self.assertEqual(errors, [])

    def test_invalid_grid_span(self) -> None:
        manifest = self._base_manifest()
        manifest["pages"] = [
            {
                "id": "home",
                "content": [{"kind": "grid", "columns": 12, "items": [{"span": 20, "content": []}]}],
            }
        ]
        _, errors, _ = validate_manifest_raw(manifest, expected_module_id="m1")
        self.assertTrue(any(err["code"] == "MANIFEST_GRID_SPAN_INVALID" for err in errors))

    def test_duplicate_tab_ids(self) -> None:
        manifest = self._base_manifest()
        manifest["pages"] = [
            {
                "id": "home",
                "content": [
                    {
                        "kind": "tabs",
                        "tabs": [
                            {"id": "dup", "label": "A", "content": []},
                            {"id": "dup", "label": "B", "content": []},
                        ],
                    }
                ],
            }
        ]
        _, errors, _ = validate_manifest_raw(manifest, expected_module_id="m1")
        self.assertTrue(any(err["code"] == "MANIFEST_TAB_ID_DUPLICATE" for err in errors))

    def test_block_depth_limit(self) -> None:
        manifest = self._base_manifest()
        block = {"kind": "stack", "content": []}
        current = block
        for _ in range(8):
            next_block = {"kind": "stack", "content": []}
            current["content"] = [next_block]
            current = next_block
        manifest["pages"] = [{"id": "home", "content": [block]}]
        _, errors, _ = validate_manifest_raw(manifest, expected_module_id="m1")
        self.assertTrue(any(err["code"] == "MANIFEST_BLOCK_DEPTH" for err in errors))

    def test_view_modes_block_valid(self) -> None:
        manifest = self._base_manifest()
        manifest["manifest_version"] = "1.3"
        manifest["entities"] = [
            {
                "id": "entity.item",
                "fields": [
                    {"id": "item.name", "type": "string"},
                    {"id": "item.status", "type": "enum", "options": [{"value": "new", "label": "New"}]},
                ],
            }
        ]
        manifest["views"] = [
            {"id": "item.list", "entity": "item", "kind": "list", "columns": [{"field_id": "item.name"}]},
            {
                "id": "item.kanban",
                "entity": "item",
                "kind": "kanban",
                "card": {"title_field": "item.name", "subtitle_fields": ["item.status"]},
            },
            {
                "id": "item.graph",
                "entity": "item",
                "kind": "graph",
                "default": {"type": "bar", "group_by": "item.status", "measure": "count"},
            },
        ]
        manifest["pages"] = [
            {
                "id": "home",
                "content": [
                    {
                        "kind": "view_modes",
                        "entity_id": "entity.item",
                        "default_mode": "list",
                        "modes": [
                            {"mode": "list", "target": "view:item.list"},
                            {"mode": "kanban", "target": "view:item.kanban"},
                            {"mode": "graph", "target": "view:item.graph"},
                        ],
                    }
                ],
            }
        ]
        _, errors, _ = validate_manifest_raw(manifest, expected_module_id="m1")
        self.assertEqual(errors, [])


if __name__ == "__main__":
    unittest.main()
