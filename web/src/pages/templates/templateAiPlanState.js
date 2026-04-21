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

function templateKindLabel(agentKind) {
  return agentKind === "document" ? "document template" : "email template";
}

function defaultReadySummary() {
  return "Draft ready to apply.";
}

function normalizeTemplateDraftForComparison(agentKind, draft) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return null;
  if (agentKind === "document") {
    return stableValue({
      name: typeof draft.name === "string" ? draft.name : "",
      description: typeof draft.description === "string" ? draft.description : "",
      filename_pattern: typeof draft.filename_pattern === "string" ? draft.filename_pattern : "",
      html: typeof draft.html === "string" ? draft.html : "",
      header_html: typeof draft.header_html === "string" ? draft.header_html : "",
      footer_html: typeof draft.footer_html === "string" ? draft.footer_html : "",
      paper_size: typeof draft.paper_size === "string" ? draft.paper_size : "",
      margin_top: typeof draft.margin_top === "string" ? draft.margin_top : "",
      margin_right: typeof draft.margin_right === "string" ? draft.margin_right : "",
      margin_bottom: typeof draft.margin_bottom === "string" ? draft.margin_bottom : "",
      margin_left: typeof draft.margin_left === "string" ? draft.margin_left : "",
      variables_schema: draft.variables_schema && typeof draft.variables_schema === "object" ? draft.variables_schema : null,
    });
  }
  return stableValue({
    name: typeof draft.name === "string" ? draft.name : "",
    description: typeof draft.description === "string" ? draft.description : "",
    subject: typeof draft.subject === "string" ? draft.subject : "",
    body_html: typeof draft.body_html === "string" ? draft.body_html : "",
    body_text: typeof draft.body_text === "string" ? draft.body_text : "",
    default_connection_id: typeof draft.default_connection_id === "string" ? draft.default_connection_id : "",
    variables_schema: draft.variables_schema && typeof draft.variables_schema === "object" ? draft.variables_schema : null,
  });
}

function templateValidationErrors(result) {
  const errors = result?.validation?.errors;
  return Array.isArray(errors) ? errors : [];
}

function hasTemplatePlanValidationIssues(result) {
  if (!result || typeof result !== "object") return false;
  if (result?.validation?.compiled_ok === false) return true;
  return templateValidationErrors(result).length > 0;
}

function firstTemplateValidationMessage(result) {
  for (const item of templateValidationErrors(result)) {
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

export function getTemplatePlanAdvisories(result) {
  if (Array.isArray(result?.advisories)) {
    return result.advisories.filter((item) => typeof item === "string" && item.trim());
  }
  if (Array.isArray(result?.warnings)) {
    return result.warnings.filter((item) => typeof item === "string" && item.trim());
  }
  return [];
}

export function isTemplatePlanEffectivelyNoop(result, baselineDraft, agentKind) {
  if (result?.noop === true) return true;
  if (!result || typeof result !== "object") return false;
  if (!baselineDraft || typeof baselineDraft !== "object") return false;
  const nextDraft = result?.draft;
  if (!nextDraft || typeof nextDraft !== "object") return false;
  try {
    return JSON.stringify(normalizeTemplateDraftForComparison(agentKind, nextDraft))
      === JSON.stringify(normalizeTemplateDraftForComparison(agentKind, baselineDraft));
  } catch {
    return false;
  }
}

export function getTemplatePlanSummary(result, baselineDraft, agentKind) {
  const rawSummary = typeof result?.summary === "string" ? result.summary.trim() : "";
  const advisories = getTemplatePlanAdvisories(result);
  const requiredQuestions = Array.isArray(result?.required_questions)
    ? result.required_questions.filter((item) => typeof item === "string" && item.trim())
    : [];
  const readySummary = defaultReadySummary();
  const label = templateKindLabel(agentKind);
  if (isTemplatePlanEffectivelyNoop(result, baselineDraft, agentKind)) {
    if (rawSummary && rawSummary !== readySummary) return rawSummary;
    if (advisories.length) return advisories[0];
    return `No ${label} changes were proposed from this request yet. Describe the exact change you want.`;
  }
  if (requiredQuestions.length > 0) {
    if (rawSummary && rawSummary !== readySummary) return rawSummary;
    if (advisories.length) return `Needs input before apply. Likely issue: ${advisories[0]}`;
    return `Needs input before apply: ${requiredQuestions[0]}`;
  }
  if (hasTemplatePlanValidationIssues(result) && (!rawSummary || rawSummary === readySummary)) {
    return firstTemplateValidationMessage(result)
      || advisories[0]
      || `${label[0].toUpperCase()}${label.slice(1)} draft needs fixes before apply.`;
  }
  if (!rawSummary || rawSummary === readySummary) {
    return `Prepared an updated ${label} draft.`;
  }
  return rawSummary;
}
