import test from "node:test";
import assert from "node:assert/strict";

import {
  getTemplatePlanAdvisories,
  getTemplatePlanSummary,
  isTemplatePlanEffectivelyNoop,
} from "./templateAiPlanState.js";

test("getTemplatePlanSummary rejects ready fallback for invalid email drafts", () => {
  const result = {
    summary: "Draft ready to apply.",
    validation: {
      compiled_ok: false,
      errors: [{ path: "subject", message: "subject is required" }],
    },
  };
  assert.equal(getTemplatePlanSummary(result, {}, "email"), "subject: subject is required");
});

test("getTemplatePlanSummary rejects ready fallback for required questions", () => {
  const result = {
    summary: "Draft ready to apply.",
    required_questions: ["Which connection should send this email?"],
  };
  assert.equal(
    getTemplatePlanSummary(result, {}, "email"),
    "Needs input before apply: Which connection should send this email?",
  );
});

test("getTemplatePlanSummary replaces generic ready fallback for changed drafts", () => {
  const baseline = {
    name: "Untitled template",
    subject: "New template",
    body_html: "<p>Hello</p>",
    body_text: "Hello",
  };
  const result = {
    summary: "Draft ready to apply.",
    draft: {
      ...baseline,
      name: "Sales Order Email",
      subject: "Sales order {{ record['sales_order.order_number'] }}",
    },
    validation: { compiled_ok: true, errors: [] },
  };
  assert.equal(
    getTemplatePlanSummary(result, baseline, "email"),
    "Prepared an updated email template draft.",
  );
});

test("getTemplatePlanAdvisories reads advisories before warnings", () => {
  const result = {
    advisories: ["Likely issue: No active email connection is configured."],
    warnings: ["legacy warning"],
  };
  assert.deepEqual(getTemplatePlanAdvisories(result), ["Likely issue: No active email connection is configured."]);
});

test("isTemplatePlanEffectivelyNoop detects unchanged document drafts", () => {
  const baseline = {
    name: "Invoice",
    description: "",
    filename_pattern: "invoice",
    html: "<p>Invoice</p>",
    header_html: "",
    footer_html: "",
    paper_size: "A4",
    margin_top: "12mm",
    margin_right: "12mm",
    margin_bottom: "12mm",
    margin_left: "12mm",
  };
  const result = {
    summary: "Draft ready to apply.",
    draft: {
      ...baseline,
      id: "doc-1",
      updated_at: "2026-04-21T00:00:00Z",
    },
  };
  assert.equal(isTemplatePlanEffectivelyNoop(result, baseline, "document"), true);
});
