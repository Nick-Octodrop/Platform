import React from "react";
import { useI18n } from "../i18n/LocalizationProvider.jsx";

export default function ProviderUnavailableState({
  title,
  description,
  actionLabel = null,
  onAction,
  canManageSettings = false,
  loading = false,
}) {
  const { t } = useI18n();
  const resolvedActionLabel = actionLabel || t("common.connect");

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
              {resolvedActionLabel}
            </button>
          ) : null}
        </div>
        {loading ? (
          <div className="mt-2 text-xs text-base-content/60">{t("common.checking_workspace_provider_status")}</div>
        ) : null}
        {!canManageSettings ? (
          <div className="mt-3 text-xs text-base-content/60">{t("common.ask_workspace_admin_connect_provider")}</div>
        ) : null}
      </div>
    </div>
  );
}
