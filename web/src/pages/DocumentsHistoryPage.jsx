import React from "react";
import SettingsPlaceholder from "../ui/SettingsPlaceholder.jsx";
import { useI18n } from "../i18n/LocalizationProvider.jsx";

export default function DocumentsHistoryPage() {
  const { t } = useI18n();
  return (
    <SettingsPlaceholder
      title={t("settings.documents_history.title", {}, { defaultValue: "Generated Documents" })}
      description={t("settings.documents_history.description", {}, { defaultValue: "History of generated PDFs linked to records." })}
    />
  );
}
