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

function patchsetActivityTimestamp(patchset) {
  if (!patchset || typeof patchset !== "object") return 0;
  const candidates = [
    patchset.applied_at,
    patchset.validated_at,
    patchset.updated_at,
    patchset.created_at,
  ];
  for (const value of candidates) {
    if (typeof value !== "string" || !value) continue;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function patchsetStatusRank(patchset) {
  const status = typeof patchset?.status === "string" ? patchset.status : "";
  if (status === "applied") return 5;
  if (status === "approved") return 4;
  if (status === "validated") return 3;
  if (status === "invalid") return 2;
  if (status === "draft") return 1;
  return 0;
}

const QUESTION_SUPERSEDING_PATCHSET_STATUSES = new Set(["validated", "approved", "applied"]);

function comparePatchsetsNewestFirst(left, right) {
  const timestampDelta = patchsetActivityTimestamp(right) - patchsetActivityTimestamp(left);
  if (timestampDelta !== 0) return timestampDelta;
  const rankDelta = patchsetStatusRank(right) - patchsetStatusRank(left);
  if (rankDelta !== 0) return rankDelta;
  const leftId = typeof left?.id === "string" ? left.id : "";
  const rightId = typeof right?.id === "string" ? right.id : "";
  return rightId.localeCompare(leftId);
}

export function latestPlanFromList(plans) {
  if (!Array.isArray(plans) || plans.length === 0) return null;
  return [...plans].sort(comparePlansNewestFirst)[0] || null;
}

export function latestPatchsetFromList(patchsets, planId = "") {
  if (!Array.isArray(patchsets) || patchsets.length === 0) return null;
  const candidates = patchsets.filter((item) => item && typeof item === "object");
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort(comparePatchsetsNewestFirst);
  const normalizedPlanId = typeof planId === "string" ? planId : "";
  if (!normalizedPlanId) return sorted[0] || null;
  const matching = sorted.find((item) => item?.plan_id === normalizedPlanId);
  if (matching) return matching;
  return sorted.find((item) => QUESTION_SUPERSEDING_PATCHSET_STATUSES.has(item?.status)) || null;
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
  if (!latestPatchset || !QUESTION_SUPERSEDING_PATCHSET_STATUSES.has(latestPatchset?.status)) return false;
  const planCreatedAt = planActivityTimestamp(latestPlan);
  const appliedAt = patchsetActivityTimestamp(latestPatchset);
  return Boolean(planCreatedAt && appliedAt && appliedAt >= planCreatedAt);
}

export function hasPendingPlanQuestion(latestPlan, latestPatchset) {
  if (!latestPlanQuestionPrompt(latestPlan)) return false;
  return !questionSupersededByAppliedRevision(latestPlan, latestPatchset);
}
