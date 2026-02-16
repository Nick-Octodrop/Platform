import React from "react";

function formatItem(item) {
  if (!item) return "";
  if (typeof item === "string") return item;
  const message = item.message || item.code || "";
  const line = item.line ? ` (line ${item.line}${item.col ? `, col ${item.col}` : ""})` : "";
  return `${message}${line}`.trim();
}

export default function ValidationPanel({
  title = "Validation",
  errors = [],
  warnings = [],
  idleMessage,
  successMessage = "Draft valid",
  showSuccess = true,
  showFix = false,
  fixLabel = "Fix with AI",
  fixDisabled = false,
  onFix,
}) {
  const hasErrors = errors.length > 0;
  const hasWarnings = warnings.length > 0;
  const hasIssues = hasErrors || hasWarnings;
  const showIdle = !hasIssues && !showSuccess && idleMessage;
  const showOk = !hasIssues && showSuccess && successMessage;

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">{title}</div>
        {showFix && hasIssues && (
          <button
            className="btn btn-sm btn-primary"
            onClick={onFix}
            disabled={fixDisabled}
          >
            {fixLabel}
          </button>
        )}
      </div>
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
      {showOk && <div className="alert alert-success text-xs mt-2">{successMessage}</div>}
    </div>
  );
}
