import React from "react";
import { useI18n } from "../../../i18n/LocalizationProvider.jsx";

export default function ResultsPane({ validate, logEntries }) {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <div>
        <div className="text-sm font-semibold">{t("settings.studio.results.validate")}</div>
        {validate?.ts && <div className="text-xs opacity-70">{validate.ts}</div>}
        {(validate?.errors || []).length === 0 && (validate?.warnings || []).length === 0 && (
          <div className="text-sm opacity-60">{t("settings.studio.results.no_validation_issues")}</div>
        )}
        {(validate?.errors || []).map((e, idx) => (
          <div key={`err-${idx}`} className="text-xs text-error">
            {e.code} — {e.message}{e.path ? ` (${e.path})` : ""}
          </div>
        ))}
        {(validate?.warnings || []).map((e, idx) => (
          <div key={`warn-${idx}`} className="text-xs text-warning">
            {e.code} — {e.message}{e.path ? ` (${e.path})` : ""}
          </div>
        ))}
      </div>
      <div>
        <div className="text-sm font-semibold">{t("settings.studio.results.logs")}</div>
        <div className="mt-2 space-y-2">
          {logEntries.length === 0 && <div className="text-sm opacity-60">{t("settings.studio.results.no_actions_yet")}</div>}
          {logEntries.map((entry, idx) => (
            <div key={idx} className="text-xs">
              <span className="font-mono">{entry.ts}</span> — {entry.action} [{entry.status}]
              {entry.detail ? <span className="opacity-70"> — {entry.detail}</span> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
