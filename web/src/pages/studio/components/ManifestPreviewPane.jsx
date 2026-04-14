import React, { useEffect, useState } from "react";
import AppShell from "../../../apps/AppShell.jsx";
import { useI18n } from "../../../i18n/LocalizationProvider.jsx";

export default function ManifestPreviewPane({ moduleId, manifestText, refreshKey, onRefresh }) {
  const { t } = useI18n();
  const [manifest, setManifest] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!refreshKey) return;
    if (!manifestText?.trim()) {
      setError(t("settings.studio.preview.no_valid_draft"));
      setManifest(null);
      return;
    }
    try {
      const parsed = JSON.parse(manifestText);
      setManifest(parsed);
      setError(null);
    } catch (err) {
      setManifest(null);
      setError(err?.message || t("settings.studio.preview.invalid_json"));
    }
  }, [refreshKey, manifestText, t]);

  if (error) {
    return <div className="alert alert-warning text-sm">{error}</div>;
  }

  if (!manifest) {
    return <div className="text-sm opacity-60">{t("settings.studio.preview.no_valid_draft")}</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2 text-sm">
        <div className="font-semibold">{t("settings.studio.preview.preview_draft")}</div>
        <button className="btn btn-ghost btn-xs" onClick={onRefresh}>{t("common.refresh")}</button>
      </div>
      <div className="border rounded-lg overflow-hidden">
        <AppShell manifestOverride={manifest} moduleIdOverride={moduleId} previewMode />
      </div>
    </div>
  );
}
