import React from "react";
import SettingsPlaceholder from "../ui/SettingsPlaceholder.jsx";
import { useI18n } from "../i18n/LocalizationProvider.jsx";

export default function EmailDiagnosticsPage() {
  const { t } = useI18n();
  return (
    <SettingsPlaceholder
      title={t("settings.email_diagnostics.title", {}, { defaultValue: "Email Diagnostics" })}
      description={t("settings.email_diagnostics.description", {}, { defaultValue: "Connection status, recent failures, and worker health." })}
    />
  );
}
