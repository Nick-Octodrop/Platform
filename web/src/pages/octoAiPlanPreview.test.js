import test from "node:test";
import assert from "node:assert/strict";

import { summarizePlanOperations } from "./octoAiPlanPreview.js";

test("summarizePlanOperations renders exact field and placement changes", () => {
  const lines = summarizePlanOperations([
    {
      op: "add_field",
      module_id: "influencers",
      field: { id: "influencer.instagram_handle", label: "Instagram Handle" },
    },
    {
      op: "insert_section_field",
      module_id: "influencers",
      field_id: "influencer.instagram_handle",
      placement_label: "Overview",
    },
  ]);

  assert.deepEqual(lines, [
    "Add field 'Instagram Handle' to Influencers.",
    "Place field 'Instagram Handle' in 'Overview' in Influencers.",
  ]);
});

test("summarizePlanOperations renders module, entity, page, and fallback changes", () => {
  const lines = summarizePlanOperations([
    { op: "create_module", artifact_id: "influencers" },
    { op: "ensure_entity", module_id: "influencers", entity_id: "entity.sent_product" },
    { op: "add_page", module_id: "influencers", page_title: "Influencers Analysis" },
    { op: "mystery_op", module_id: "influencers" },
  ]);

  assert.deepEqual(lines, [
    "Create module 'Influencers'.",
    "Create entity 'Sent Product' in Influencers.",
    "Add page 'Influencers Analysis' in Influencers.",
    "Mystery Op in Influencers.",
  ]);
});
