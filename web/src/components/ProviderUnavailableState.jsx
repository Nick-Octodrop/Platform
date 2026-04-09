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
      <div className="rounded-2xl border border-base-300 bg-base-200/70 px-4 py-3 text-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium text-base-content">{title}</div>
            <div className="mt-1 text-base-content/70">{description}</div>
          </div>
          {canManageSettings && onAction ? (
            <button type="button" className="btn btn-sm btn-primary shrink-0" onClick={onAction}>
              {actionLabel}
            </button>
          ) : null}
        </div>
        {loading ? (
          <div className="mt-2 text-xs text-base-content/60">Checking workspace provider status…</div>
        ) : null}
        {!canManageSettings ? (
          <div className="mt-3 text-xs text-base-content/60">Ask a workspace admin to connect this provider in Settings.</div>
        ) : null}
      </div>
    </div>
  );
}
