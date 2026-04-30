import test from "node:test";
import assert from "node:assert/strict";

import {
  hasPendingPlanQuestion,
  latestPatchsetFromList,
  latestPlanFromList,
  latestPlanQuestionPrompt,
  questionSupersededByAppliedRevision,
} from "./octoAiSessionState.js";

test("hasPendingPlanQuestion blocks apply when the latest plan still needs clarification", () => {
  const latestPlan = {
    created_at: "2026-04-21T10:00:00.000Z",
    questions_json: ["What should the new field be called?"],
  };
  assert.equal(hasPendingPlanQuestion(latestPlan, null), true);
  assert.equal(latestPlanQuestionPrompt(latestPlan), "What should the new field be called?");
});

test("hasPendingPlanQuestion uses required question prompt even when question text is nested only in meta", () => {
  const latestPlan = {
    created_at: "2026-04-21T10:00:00.000Z",
    plan_json: {
      plan: {
        required_question_meta: {
          prompt: "Which catalog record should line items link to?",
        },
      },
    },
  };
  assert.equal(hasPendingPlanQuestion(latestPlan, null), true);
  assert.equal(latestPlanQuestionPrompt(latestPlan), "Which catalog record should line items link to?");
});

test("questionSupersededByAppliedRevision only clears older questions after a newer applied revision", () => {
  const olderPlan = {
    created_at: "2026-04-21T10:00:00.000Z",
    questions_json: ["Confirm this plan?"],
  };
  const newerAppliedPatchset = {
    status: "applied",
    applied_at: "2026-04-21T10:05:00.000Z",
  };
  assert.equal(questionSupersededByAppliedRevision(olderPlan, newerAppliedPatchset), true);
  assert.equal(hasPendingPlanQuestion(olderPlan, newerAppliedPatchset), false);
});

test("questionSupersededByAppliedRevision compares parsed timestamps and update markers", () => {
  const olderPlan = {
    created_at: "2026-04-21T10:00:00Z",
    questions_json: ["Confirm this plan?"],
  };
  const newerAppliedPatchset = {
    status: "applied",
    applied_at: "",
    updated_at: "2026-04-21T10:05:00.000Z",
    created_at: "2026-04-21T09:59:00Z",
  };
  assert.equal(questionSupersededByAppliedRevision(olderPlan, newerAppliedPatchset), true);
  assert.equal(hasPendingPlanQuestion(olderPlan, newerAppliedPatchset), false);
});

test("questionSupersededByAppliedRevision clears older questions once a newer revision is validated", () => {
  const olderPlan = {
    id: "plan_new",
    created_at: "2026-04-21T10:00:00.000Z",
    questions_json: ["Confirm this plan?"],
  };
  const newerValidatedPatchset = {
    plan_id: "plan_new",
    status: "validated",
    validated_at: "2026-04-21T10:05:00.000Z",
  };
  assert.equal(questionSupersededByAppliedRevision(olderPlan, newerValidatedPatchset), true);
  assert.equal(hasPendingPlanQuestion(olderPlan, newerValidatedPatchset), false);
});

test("hasPendingPlanQuestion does not let an older applied patchset suppress a newer plan question", () => {
  const newerPlan = {
    created_at: "2026-04-21T10:05:00.000Z",
    questions_json: ["Which field should this use?"],
  };
  const olderAppliedPatchset = {
    status: "applied",
    applied_at: "2026-04-21T10:00:00.000Z",
  };
  assert.equal(questionSupersededByAppliedRevision(newerPlan, olderAppliedPatchset), false);
  assert.equal(hasPendingPlanQuestion(newerPlan, olderAppliedPatchset), true);
});

test("latestPlanFromList prefers the newest plan instead of raw API order", () => {
  const olderPlan = {
    id: "plan_old",
    created_at: "2026-04-21T10:00:00.000Z",
    questions_json: ["Confirm this plan?"],
  };
  const newerPlan = {
    id: "plan_new",
    created_at: "2026-04-21T10:05:00.000Z",
    questions_json: ["Add more concrete detail."],
  };
  assert.deepEqual(latestPlanFromList([olderPlan, newerPlan]), newerPlan);
  assert.deepEqual(latestPlanFromList([newerPlan, olderPlan]), newerPlan);
});

test("latestPatchsetFromList falls back to a newer applied patchset when plan ids do not line up", () => {
  const activePlan = {
    id: "plan_new",
    created_at: "2026-04-21T10:00:00.000Z",
    questions_json: ["Confirm this plan?"],
  };
  const olderDraft = {
    id: "patch_old",
    plan_id: "plan_new",
    status: "draft",
    created_at: "2026-04-21T09:50:00.000Z",
  };
  const appliedFallback = {
    id: "patch_applied",
    plan_id: "plan_previous",
    status: "applied",
    applied_at: "2026-04-21T10:05:00.000Z",
    created_at: "2026-04-21T09:55:00.000Z",
  };

  assert.deepEqual(latestPatchsetFromList([olderDraft, appliedFallback], activePlan.id), olderDraft);
  assert.deepEqual(latestPatchsetFromList([appliedFallback], activePlan.id), appliedFallback);
  assert.equal(hasPendingPlanQuestion(activePlan, latestPatchsetFromList([appliedFallback], activePlan.id)), false);
});

test("latestPatchsetFromList falls back to a newer validated patchset when plan ids do not line up", () => {
  const activePlan = {
    id: "plan_new",
    created_at: "2026-04-21T10:00:00.000Z",
    questions_json: ["Confirm this plan?"],
  };
  const validatedFallback = {
    id: "patch_validated",
    plan_id: "plan_previous",
    status: "validated",
    validated_at: "2026-04-21T10:05:00.000Z",
    created_at: "2026-04-21T09:55:00.000Z",
  };

  assert.deepEqual(latestPatchsetFromList([validatedFallback], activePlan.id), validatedFallback);
  assert.equal(hasPendingPlanQuestion(activePlan, latestPatchsetFromList([validatedFallback], activePlan.id)), false);
});
