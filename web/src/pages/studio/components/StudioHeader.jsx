import React from "react";
import { useI18n } from "../../../i18n/LocalizationProvider.jsx";

export default function StudioHeader({
  title,
  chips,
  primaryLabel,
  onPrimary,
  primaryDisabled,
  onSaveDraft,
  saveDisabled,
  onValidate,
  onPreview,
  onDiscardDraft,
  onRollback,
  onDelete,
  onExport,
  onCopyId,
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="text-2xl font-semibold">{title}</div>
        <div className="mt-1 flex flex-wrap gap-2">
          {(chips || []).map((chip) => (
            <span key={chip.label} className={`badge ${chip.tone || "badge-outline"}`}>
              {chip.label}
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary" onClick={onPrimary} disabled={primaryDisabled}>
          {primaryLabel}
        </button>
        <div className="dropdown dropdown-end">
          <button className="btn btn-ghost">{t("common.more")}</button>
          <ul className="menu dropdown-content z-[1000] p-2 shadow bg-base-100 rounded-box w-56 text-sm">
            <li><button onClick={onSaveDraft} disabled={saveDisabled}>{t("settings.studio.actions.save_draft")}</button></li>
            <li><button onClick={onValidate}>{t("settings.studio.actions.validate")}</button></li>
            <li><button onClick={onPreview}>{t("settings.studio.actions.preview")}</button></li>
            {onDiscardDraft && <li><button onClick={onDiscardDraft}>{t("settings.studio.actions.discard_draft")}</button></li>}
            {onRollback && <li><button onClick={onRollback}>{t("settings.studio.actions.rollback")}</button></li>}
            <li><button onClick={onExport}>{t("settings.studio.actions.export_manifest")}</button></li>
            <li><button onClick={onCopyId}>{t("settings.studio.actions.copy_module_id")}</button></li>
            {onDelete && <li><button className="text-error" onClick={onDelete}>{t("settings.studio.actions.delete_module")}</button></li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
