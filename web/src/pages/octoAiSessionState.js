export function latestPlanQuestion(latestPlan) {
  const direct = Array.isArray(latestPlan?.questions_json) ? latestPlan.questions_json : [];
  for (const item of direct) {
    if (typeof item === "string" && item.trim()) return item.trim();
  }
  const nested = Array.isArray(latestPlan?.plan_json?.plan?.required_questions) ? latestPlan.plan_json.plan.required_questions : [];
  for (const item of nested) {
    if (typeof item === "string" && item.trim()) return item.trim();
  }
  return "";
}

export function latestPlanQuestionPrompt(latestPlan) {
  const directPrompt = typeof latestPlan?.required_question_meta?.prompt === "string" ? latestPlan.required_question_meta.prompt.trim() : "";
  if (directPrompt) return directPrompt;
  const nestedPrompt =
    typeof latestPlan?.plan_json?.plan?.required_question_meta?.prompt === "string"
      ? latestPlan.plan_json.plan.required_question_meta.prompt.trim()
      : "";
  if (nestedPrompt) return nestedPrompt;
  return latestPlanQuestion(latestPlan);
}

export function questionSupersededByAppliedRevision(latestPlan, latestPatchset) {
  if (!latestPlan) return false;
  if (!latestPatchset || latestPatchset?.status !== "applied") return false;
  const planCreatedAt = typeof latestPlan?.created_at === "string" ? latestPlan.created_at : "";
  const appliedAt =
    typeof latestPatchset?.applied_at === "string" && latestPatchset.applied_at
      ? latestPatchset.applied_at
      : typeof latestPatchset?.created_at === "string"
        ? latestPatchset.created_at
        : "";
  return Boolean(planCreatedAt && appliedAt && appliedAt > planCreatedAt);
}

export function hasPendingPlanQuestion(latestPlan, latestPatchset) {
  if (!latestPlanQuestionPrompt(latestPlan)) return false;
  return !questionSupersededByAppliedRevision(latestPlan, latestPatchset);
}
