import test from "node:test";
import assert from "node:assert/strict";

import {
  getAutomationPlanAdvisories,
  getAutomationPlanSummary,
  isAutomationPlanEffectivelyNoop,
} from "./automationAiPlanState.js";

test("getAutomationPlanSummary prefers advisories for noop results when summary is missing", () => {
  const result = {
    noop: true,
    advisories: ["No active email connection is configured in this workspace."],
  };
  assert.equal(
    getAutomationPlanSummary(result),
    "No active email connection is configured in this workspace.",
  );
});

test("getAutomationPlanSummary rejects the ready-to-apply fallback for noop results", () => {
  const result = {
    noop: true,
    summary: "Automation draft ready to apply.",
    advisories: ["No automation changes were proposed yet."],
  };
  assert.equal(getAutomationPlanSummary(result), "No automation changes were proposed yet.");
});

test("getAutomationPlanSummary rejects the ready-to-apply fallback for invalid drafts", () => {
  const result = {
    summary: "Automation draft ready to apply.",
    validation: {
      compiled_ok: false,
      errors: [{ path: "steps[0].inputs", message: "at least one recipient source is required for send_email" }],
    },
  };
  assert.equal(
    getAutomationPlanSummary(result),
    "steps[0].inputs: at least one recipient source is required for send_email",
  );
});

test("getAutomationPlanSummary rejects the ready-to-apply fallback when no draft is returned", () => {
  const result = {
    summary: "Automation draft ready to apply.",
  };
  assert.equal(
    getAutomationPlanSummary(result),
    "Automation AI did not produce an applyable draft. Try again or describe the exact change you want.",
  );
});

test("getAutomationPlanSummary surfaces failed stream payload errors", () => {
  const result = {
    ok: false,
    errors: [{ code: "AI_PLAN_FAILED", message: "Planner request failed" }],
  };
  assert.equal(getAutomationPlanSummary(result), "Planner request failed");
});

test("getAutomationPlanAdvisories reads advisories before legacy warnings", () => {
  const result = {
    advisories: ["Likely issue: Missing email connection."],
    warnings: ["legacy warning"],
  };
  assert.deepEqual(getAutomationPlanAdvisories(result), ["Likely issue: Missing email connection."]);
});

test("isAutomationPlanEffectivelyNoop detects unchanged drafts even when noop flag is missing", () => {
  const baseline = {
    name: "Orders Inbound",
    trigger: { kind: "event", event_types: ["shopify.order.created"], filters: [] },
    steps: [
      { id: "notify_team", kind: "action", action_id: "system.notify", inputs: { recipient_user_ids: ["u1"] } },
    ],
  };
  const result = {
    summary: "Automation draft ready to apply.",
    draft: {
      steps: [
        { action_id: "system.notify", id: "notify_team", inputs: { recipient_user_ids: ["u1"] }, kind: "action" },
      ],
      trigger: { event_types: ["shopify.order.created"], filters: [], kind: "event" },
      name: "Orders Inbound",
    },
  };
  assert.equal(isAutomationPlanEffectivelyNoop(result, baseline), true);
});

test("isAutomationPlanEffectivelyNoop ignores automation metadata and volatile step ids", () => {
  const baseline = {
    name: "New Automation",
    description: "",
    trigger: { kind: "event", event_types: [], filters: [] },
    steps: [],
  };
  const result = {
    summary: "Automation draft ready to apply.",
    draft: {
      id: "automation-123",
      created_at: "2026-04-21T00:00:00Z",
      updated_at: "2026-04-21T00:00:01Z",
      status: "draft",
      name: "New Automation",
      description: "",
      trigger: { kind: "event", event_types: [], filters: [] },
      steps: [],
    },
  };
  assert.equal(isAutomationPlanEffectivelyNoop(result, baseline), true);
});
