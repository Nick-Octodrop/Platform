import React from "react";

export default function ProviderUnavailableState({
  title,
  description,
  actionLabel = "Connect",
  onAction,
  canManageSettings = false,
  loading = false,
}) {
  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <div className="alert alert-info text-sm flex items-start justify-between gap-3">
        <div>
          <div className="font-medium">{title}</div>
          <div className="mt-1 opacity-80">{description}</div>
        </div>
        {canManageSettings && onAction ? (
          <button type="button" className="btn btn-sm btn-primary shrink-0" disabled={loading} onClick={onAction}>
            {actionLabel}
          </button>
        ) : null}
      </div>
      {!canManageSettings ? (
        <div className="mt-3 text-xs opacity-60">Ask a workspace admin to connect this provider in Settings.</div>
      ) : null}
    </div>
  );
}
