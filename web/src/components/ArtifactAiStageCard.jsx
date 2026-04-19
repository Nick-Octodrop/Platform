import React, { useEffect, useMemo, useState } from "react";
import AiActionStrip from "./AiActionStrip.jsx";

function toneClass(tone) {
  if (tone === "primary") return "badge badge-primary";
  if (tone === "success") return "badge badge-success";
  if (tone === "warning") return "badge badge-warning";
  if (tone === "error") return "badge badge-error";
  return "badge badge-ghost";
}

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
  stageLabel = "Ready",
  stageTone = "ghost",
  statusTitle = "Current Work",
  statusItems = [],
  detailsTitle = "",
  details = [],
  assumptions = [],
  warnings = [],
  validation = null,
  actions = [],
  busy = false,
  embedded = false,
}) {
  const liveStatusItems = useMemo(() => normalizeInfoItems(statusItems), [statusItems]);
  const liveStatusSignature = liveStatusItems.join("|");
  const [statusIndex, setStatusIndex] = useState(0);
  const validationItems = validationSummary(validation);
  const validationDetails = validationDetailItems(validation);
  const combinedValidationItems = [...validationItems, ...validationDetails];
  const activeStatus = liveStatusItems[statusIndex] || "";
  const hasBody =
    summary ||
    activeStatus ||
    details.length > 0 ||
    combinedValidationItems.length > 0 ||
    assumptions.length > 0 ||
    warnings.length > 0 ||
    actions.length > 0;
  useEffect(() => {
    setStatusIndex(0);
  }, [liveStatusSignature]);
  useEffect(() => {
    if (!busy || liveStatusItems.length < 2) return undefined;
    const timer = window.setInterval(() => {
      setStatusIndex((current) => (current + 1) % liveStatusItems.length);
    }, 1600);
    return () => window.clearInterval(timer);
  }, [busy, liveStatusItems.length, liveStatusSignature]);
  if (!hasBody) return null;
  return (
    <div className={embedded ? "space-y-3 p-3" : "rounded-box border border-base-200 bg-base-100 p-3 space-y-3"}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide opacity-60">Plan Stage</div>
          <div className="text-sm font-semibold">{title}</div>
          {summary ? <div className="mt-1 whitespace-pre-wrap text-sm leading-6">{summary}</div> : null}
        </div>
        <span className={`${toneClass(stageTone)} inline-flex min-w-[7.5rem] items-center justify-center whitespace-nowrap px-3 text-center`}>
          {stageLabel}
        </span>
      </div>
      {activeStatus ? (
        <div className="rounded-box border border-base-200 bg-base-100 p-3">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide opacity-60">
            <span className={`inline-block h-2 w-2 rounded-full ${busy ? "animate-pulse bg-warning" : "bg-primary"}`} />
            <span>{statusTitle}</span>
          </div>
          <div className="mt-2 text-sm leading-6">{activeStatus}</div>
        </div>
      ) : null}
      {details.length > 0 ? <InfoBlock title={detailsTitle || "Details"} items={details} /> : null}
      {combinedValidationItems.length > 0 ? <InfoBlock title="Validation" items={combinedValidationItems} /> : null}
      {assumptions.length > 0 ? <InfoBlock title="Assumptions" items={assumptions} /> : null}
      {warnings.length > 0 ? <InfoBlock title="Warnings" items={warnings} /> : null}
      <AiActionStrip actions={actions} busy={busy} compact />
    </div>
  );
}
