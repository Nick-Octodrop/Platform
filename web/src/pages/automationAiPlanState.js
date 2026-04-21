export function getAutomationPlanAdvisories(result) {
  if (Array.isArray(result?.advisories)) {
    return result.advisories.filter((item) => typeof item === "string" && item.trim());
  }
  if (Array.isArray(result?.warnings)) {
    return result.warnings.filter((item) => typeof item === "string" && item.trim());
  }
  return [];
}

function automationValidationErrors(result) {
  const errors = result?.validation?.errors;
  return Array.isArray(errors) ? errors : [];
}

function hasAutomationPlanValidationIssues(result) {
  if (!result || typeof result !== "object") return false;
  if (result?.validation?.compiled_ok === false) return true;
  return automationValidationErrors(result).length > 0;
}

function firstAutomationValidationMessage(result) {
  for (const item of automationValidationErrors(result)) {
    if (typeof item === "string" && item.trim()) return item.trim();
    if (item && typeof item === "object") {
      const path = typeof item.path === "string" && item.path.trim() ? `${item.path.trim()}: ` : "";
      const message = typeof item.message === "string" && item.message.trim()
        ? item.message.trim()
        : typeof item.code === "string" && item.code.trim()
          ? item.code.trim()
          : "";
      const combined = `${path}${message}`.trim();
      if (combined) return combined;
    }
  }
  return "";
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = stableValue(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function normalizeAutomationTrigger(trigger) {
  const source = trigger && typeof trigger === "object" && !Array.isArray(trigger) ? trigger : {};
  const kind = typeof source.kind === "string" && source.kind.trim().toLowerCase() === "schedule" ? "schedule" : "event";
  if (kind === "schedule") {
    const everyMinutes = Number(source.every_minutes);
    return {
      kind: "schedule",
      every_minutes: Number.isFinite(everyMinutes) && everyMinutes > 0 ? everyMinutes : 60,
    };
  }
  const normalized = {
    kind: "event",
    event_types: Array.isArray(source.event_types)
      ? source.event_types.filter((item) => typeof item === "string" && item.trim())
      : [],
    filters: Array.isArray(source.filters) ? source.filters : [],
  };
  if (source.expr && typeof source.expr === "object" && !Array.isArray(source.expr)) {
    normalized.expr = source.expr;
  }
  return normalized;
}

function normalizeAutomationStep(step) {
  if (!step || typeof step !== "object" || Array.isArray(step)) return null;
  const normalized = {};
  for (const [key, value] of Object.entries(step)) {
    if (key === "id" || value === undefined) continue;
    if (key === "then_steps" || key === "else_steps" || key === "steps") {
      normalized[key] = Array.isArray(value)
        ? value.map(normalizeAutomationStep).filter(Boolean)
        : [];
      continue;
    }
    normalized[key] = value;
  }
  return normalized;
}

function normalizeAutomationDraftForComparison(draft) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return null;
  return stableValue({
    name: typeof draft.name === "string" ? draft.name : "",
    description: typeof draft.description === "string" ? draft.description : "",
    trigger: normalizeAutomationTrigger(draft.trigger),
    steps: Array.isArray(draft.steps) ? draft.steps.map(normalizeAutomationStep).filter(Boolean) : [],
  });
}

export function isAutomationPlanEffectivelyNoop(result, baselineDraft) {
  if (result?.noop === true) return true;
  if (!result || typeof result !== "object") return false;
  if (!baselineDraft || typeof baselineDraft !== "object") return false;
  const nextDraft = result?.draft;
  if (!nextDraft || typeof nextDraft !== "object") return false;
  try {
    return JSON.stringify(normalizeAutomationDraftForComparison(nextDraft))
      === JSON.stringify(normalizeAutomationDraftForComparison(baselineDraft));
  } catch {
    return false;
  }
}

export function getAutomationPlanSummary(result) {
  const rawSummary = typeof result?.summary === "string" ? result.summary.trim() : "";
  const advisories = getAutomationPlanAdvisories(result);
  const defaultReadySummary = "Automation draft ready to apply.";
  if (result?.noop === true) {
    if (rawSummary && rawSummary !== defaultReadySummary) return rawSummary;
    if (advisories.length) return advisories[0];
    return "No automation changes were proposed from this request yet. Describe the exact change you want.";
  }
  if (hasAutomationPlanValidationIssues(result) && (!rawSummary || rawSummary === defaultReadySummary)) {
    return firstAutomationValidationMessage(result)
      || advisories[0]
      || "Automation draft needs fixes before apply.";
  }
  return rawSummary || defaultReadySummary;
}
