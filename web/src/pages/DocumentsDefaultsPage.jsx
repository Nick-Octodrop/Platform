import React from "react";
import SettingsPlaceholder from "../ui/SettingsPlaceholder.jsx";
import { useI18n } from "../i18n/LocalizationProvider.jsx";

export default function DocumentsDefaultsPage() {
  const { t } = useI18n();
  return (
    <SettingsPlaceholder
      title={t("settings.documents_defaults.title", {}, { defaultValue: "Document Defaults" })}
      description={t("settings.documents_defaults.description", {}, { defaultValue: "Naming rules and attachment behavior." })}
    />
  );
}
