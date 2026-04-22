function planActivityTimestamp(plan) {
  if (!plan || typeof plan !== "object") return 0;
  const candidates = [
    plan.updated_at,
    plan.created_at,
  ];
  for (const value of candidates) {
    if (typeof value !== "string" || !value) continue;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function comparePlansNewestFirst(left, right) {
  const timestampDelta = planActivityTimestamp(right) - planActivityTimestamp(left);
  if (timestampDelta !== 0) return timestampDelta;
  const leftId = typeof left?.id === "string" ? left.id : "";
  const rightId = typeof right?.id === "string" ? right.id : "";
  return rightId.localeCompare(leftId);
}

export function latestPlanFromList(plans) {
  if (!Array.isArray(plans) || plans.length === 0) return null;
  return [...plans].sort(comparePlansNewestFirst)[0] || null;
}

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
