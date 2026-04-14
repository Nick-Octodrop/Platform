import React from "react";
import Tabs from "../../../components/Tabs.jsx";
import { useI18n } from "../../../i18n/LocalizationProvider.jsx";

export default function WorkspaceTabs({ tabs, activeId, onChange, pipeline }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-between gap-3">
      <Tabs tabs={tabs} activeId={activeId} onChange={onChange} />
      <div className="text-xs opacity-70">
        {t("settings.studio.pipeline.summary", pipeline)}
      </div>
    </div>
  );
}
