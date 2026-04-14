import React from "react";
import SettingsPlaceholder from "../ui/SettingsPlaceholder.jsx";
import { useI18n } from "../i18n/LocalizationProvider.jsx";

export default function DocumentsJobsPage() {
  const { t } = useI18n();
  return (
    <SettingsPlaceholder
      title={t("settings.documents_jobs.title", {}, { defaultValue: "Render Jobs" })}
      description={t("settings.documents_jobs.description", {}, { defaultValue: "Queued, running, and failed renders." })}
    />
  );
}
