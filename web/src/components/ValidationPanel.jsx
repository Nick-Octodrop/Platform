import React from "react";
import { useI18n } from "../i18n/LocalizationProvider.jsx";

function formatItem(item) {
  if (!item) return "";
  if (typeof item === "string") return item;
  const message = item.message || item.code || "";
  const line = item.line ? ` (line ${item.line}${item.col ? `, col ${item.col}` : ""})` : "";
  return `${message}${line}`.trim();
}

export default function ValidationPanel({
  title,
  status = "idle",
  errors = [],
  warnings = [],
  idleMessage,
  successMessage,
  showSuccess = true,
  showFix = false,
  fixLabel,
  fixDisabled = false,
  onFix,
}) {
  const { t } = useI18n();
  const resolvedTitle = title ?? t("validation.title", {}, { defaultValue: "Validation" });
  const resolvedSuccessMessage = successMessage ?? t("validation.draft_valid", {}, { defaultValue: "Draft valid" });
  const resolvedFixLabel = fixLabel ?? t("validation.fix_with_ai", {}, { defaultValue: "Fix with AI" });
  const hasErrors = errors.length > 0;
  const hasWarnings = warnings.length > 0;
  const hasIssues = hasErrors || hasWarnings;
  const isChecking = status === "checking";
  const showIdle = !isChecking && !hasIssues && !showSuccess && idleMessage;
  const showOk = !isChecking && !hasIssues && showSuccess && resolvedSuccessMessage;

  return (
    <div className="mb-3">
      {(resolvedTitle || (showFix && hasIssues)) && (
        <div className="flex items-center justify-between">
          {resolvedTitle ? <div className="text-sm font-semibold">{resolvedTitle}</div> : <div />}
          {showFix && hasIssues && (
            <button
              className="btn btn-sm btn-primary"
              onClick={onFix}
              disabled={fixDisabled}
            >
              {resolvedFixLabel}
            </button>
          )}
        </div>
      )}
      {isChecking && (
        <div className="alert text-xs mt-2">
          {t("validation.checking", {}, { defaultValue: "Checking..." })}
        </div>
      )}
      {showIdle && <div className="text-xs opacity-60 mt-2">{idleMessage}</div>}
      {hasErrors && (
        <div className="alert alert-error text-xs mt-2">
          <div>
            {errors.map((err, idx) => (
              <div key={`verr-${idx}`}>{formatItem(err)}</div>
            ))}
          </div>
        </div>
      )}
      {hasWarnings && (
        <div className="alert alert-warning text-xs mt-2">
          <div>
            {warnings.map((warn, idx) => (
              <div key={`vwarn-${idx}`}>{formatItem(warn)}</div>
            ))}
          </div>
        </div>
      )}
      {showOk && <div className="alert alert-success text-xs mt-2">{resolvedSuccessMessage}</div>}
    </div>
  );
}
