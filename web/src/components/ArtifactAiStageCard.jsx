import React, { useMemo } from "react";
import AiActionStrip from "./AiActionStrip.jsx";

function normalizeInfoItems(items) {
  const normalized = typeof items === "string"
    ? [items.trim()]
    : Array.isArray(items)
      ? items
          .map((item) => {
            if (typeof item === "string") return item.trim();
            if (item && typeof item === "object") {
              if (typeof item.message === "string") return item.message.trim();
              if (typeof item.text === "string") return item.text.trim();
              if (typeof item.label === "string") return item.label.trim();
            }
            return "";
          })
          .filter(Boolean)
      : [];
  if (
    normalized.length >= 12
    && normalized.every((item) => item.length === 1 || /^[.,;:!?-]$/.test(item))
  ) {
    const joined = normalized.join("").replace(/\s+/g, " ").trim();
    return joined ? [joined] : [];
  }
  return normalized;
}

function InfoBlock({ title, items }) {
  const visible = normalizeInfoItems(items);
  if (!visible.length) return null;
  return (
    <div className="rounded-box border border-base-200 bg-base-100 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide opacity-60">{title}</div>
      <ul className="mt-2 space-y-1 text-sm leading-6">
        {visible.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="opacity-50">-</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function validationSummary(validation) {
  if (!validation || typeof validation !== "object") return [];
  const errors = Array.isArray(validation.errors) ? validation.errors.length : 0;
  const warnings = Array.isArray(validation.warnings) ? validation.warnings.length : 0;
  const strictErrors = Array.isArray(validation.strict_errors) ? validation.strict_errors.length : 0;
  const completenessErrors = Array.isArray(validation.completeness_errors) ? validation.completeness_errors.length : 0;
  const totalErrors = errors + strictErrors + completenessErrors;
  const summary = [];
  if (totalErrors > 0) {
    summary.push(`${totalErrors} validation error${totalErrors === 1 ? "" : "s"}`);
  }
  if (warnings > 0) {
    summary.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
  }
  if (!summary.length && validation.compiled_ok) {
    summary.push("Validation passed");
  }
  return summary;
}

function formatValidationItem(item, prefix = "") {
  if (typeof item === "string") {
    const text = item.trim();
    return text ? `${prefix}${text}` : "";
  }
  if (!item || typeof item !== "object") return "";
  const location = [
    item.path,
    item.field_path,
    item.field,
    item.step_path,
    item.step_id,
  ]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .find(Boolean);
  const message = [
    item.message,
    item.detail,
    item.error,
    item.reason,
  ]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .find(Boolean);
  if (location && message) return `${prefix}${location}: ${message}`;
  if (message) return `${prefix}${message}`;
  if (location) return `${prefix}${location}`;
  return "";
}

function validationDetailItems(validation) {
  if (!validation || typeof validation !== "object") return [];
  const details = [];
  const pushItems = (items, prefix = "") => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      const text = formatValidationItem(item, prefix);
      if (text) details.push(text);
    }
  };
  pushItems(validation.errors);
  pushItems(validation.strict_errors);
  pushItems(validation.completeness_errors);
  pushItems(validation.warnings, "Warning: ");
  if (!details.length && validation.compiled_ok === false) {
    details.push("This draft did not pass validation. Review the validator output or discard this plan.");
  } else if (details.length && validation.compiled_ok === false) {
    details.push("Next step: fix the validation issues above or discard this plan.");
  }
  return details;
}

export default function ArtifactAiStageCard({
  title = "AI Plan",
  summary = "",
  detailsTitle = "",
  details = [],
  advisories = [],
  risks = [],
  requiredQuestions = [],
  assumptions = [],
  warnings = [],
  validation = null,
  actions = [],
  busy = false,
  embedded = false,
}) {
  const validationItems = validationSummary(validation);
  const validationDetails = validationDetailItems(validation);
  const combinedValidationItems = [...validationItems, ...validationDetails];
  const hasBody =
    summary ||
    details.length > 0 ||
    advisories.length > 0 ||
    risks.length > 0 ||
    requiredQuestions.length > 0 ||
    combinedValidationItems.length > 0 ||
    assumptions.length > 0 ||
    warnings.length > 0 ||
    actions.length > 0;
  if (!hasBody) return null;
  return (
    <div className={embedded ? "space-y-3 p-3" : "rounded-box border border-base-200 bg-base-200 p-3 space-y-3"}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide opacity-60">Plan Stage</div>
          <div className="text-sm font-semibold">{title}</div>
          {summary ? <div className="mt-1 whitespace-pre-wrap text-sm leading-6">{summary}</div> : null}
        </div>
      </div>
      {details.length > 0 ? <InfoBlock title={detailsTitle || "Details"} items={details} /> : null}
      {requiredQuestions.length > 0 ? <InfoBlock title="Required Input" items={requiredQuestions} /> : null}
      {risks.length > 0 ? <InfoBlock title="Risks" items={risks} /> : null}
      {advisories.length > 0 ? <InfoBlock title="Advisories" items={advisories} /> : null}
      {combinedValidationItems.length > 0 ? <InfoBlock title="Validation" items={combinedValidationItems} /> : null}
      {assumptions.length > 0 ? <InfoBlock title="Assumptions" items={assumptions} /> : null}
      {warnings.length > 0 ? <InfoBlock title="Warnings" items={warnings} /> : null}
      {!busy && actions.length > 0 ? <AiActionStrip actions={actions} busy={busy} compact /> : null}
    </div>
  );
}
