import test from "node:test";
import assert from "node:assert/strict";

import {
  hasPendingPlanQuestion,
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
