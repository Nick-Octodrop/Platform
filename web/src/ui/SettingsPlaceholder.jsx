import React from "react";
import { useI18n } from "../i18n/LocalizationProvider.jsx";

export default function SettingsPlaceholder({ title, description }) {
  const { t } = useI18n();
  return (
    <div className="card bg-base-100 shadow">
      <div className="card-body">
        <h2 className="card-title">{title}</h2>
        <div className="text-sm opacity-70">{description}</div>
        <div className="text-sm opacity-60 mt-2">{t("common.section_not_wired_yet")}</div>
      </div>
    </div>
  );
}
