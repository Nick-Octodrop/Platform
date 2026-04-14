import React, { useMemo, useState } from "react";
import { createWorkspaceSecret } from "../api.js";
import { useI18n } from "../i18n/LocalizationProvider.jsx";

export default function ProviderSecretModal({
  open,
  providerKey,
  canManageSettings = false,
  busy = false,
  onClose,
  onSaved,
}) {
  const { t } = useI18n();
  const copy = useMemo(() => {
    if (providerKey === "openai") {
      return {
        title: t("settings.provider_secret_modal.openai_title"),
        description: t("settings.provider_secret_modal.openai_description"),
        providerKey: "openai",
        secretKey: "api_key",
        placeholder: "sk-...",
      };
    }
    if (providerKey === "google_maps") {
      return {
        title: t("settings.provider_secret_modal.google_maps_title"),
        description: t("settings.provider_secret_modal.google_maps_description"),
        providerKey: "google_maps",
        secretKey: "api_key",
        placeholder: "AIza...",
      };
    }
    return {
      title: t("settings.provider_secret_modal.default_title"),
      description: t("settings.provider_secret_modal.default_description"),
      providerKey,
      secretKey: "api_key",
      placeholder: t("settings.provider_secret_modal.default_placeholder"),
    };
  }, [providerKey, t]);
  const [name, setName] = useState(copy.title);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  React.useEffect(() => {
    if (!open) {
      setName(copy.title);
      setValue("");
      setError("");
      setSaving(false);
    }
  }, [open, copy.title]);

  if (!open) return null;

  async function handleSave() {
    if (!canManageSettings || saving || !value.trim()) return;
    setSaving(true);
    setError("");
    try {
      await createWorkspaceSecret({
        name: name.trim() || copy.title,
        provider_key: copy.providerKey,
        secret_key: copy.secretKey,
        value: value.trim(),
      });
      onSaved?.();
    } catch (err) {
      setError(err?.message || t("settings.provider_secret_modal.save_failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-lg">
        <h3 className="text-lg font-semibold">{copy.title}</h3>
        <div className="mt-2 text-sm opacity-70">{copy.description}</div>
        {!canManageSettings ? (
          <div className="alert alert-info mt-4 text-sm">
            {t("settings.provider_secret_modal.permission_required")}
          </div>
        ) : null}
        <div className="mt-4 space-y-4">
          <label className="form-control">
            <span className="label-text text-sm">{t("settings.provider_secret_modal.secret_name")}</span>
            <input
              className="input input-bordered"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving || busy || !canManageSettings}
            />
          </label>
          <label className="form-control">
            <span className="label-text text-sm">{t("settings.provider_secret_modal.api_key")}</span>
            <textarea
              className="textarea textarea-bordered min-h-[8rem]"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={copy.placeholder}
              disabled={saving || busy || !canManageSettings}
            />
          </label>
          {error ? <div className="text-sm text-error">{error}</div> : null}
        </div>
        <div className="modal-action">
          <button className="btn btn-ghost" type="button" onClick={onClose} disabled={saving || busy}>
            {t("common.close")}
          </button>
          {canManageSettings ? (
            <button className="btn btn-primary" type="button" onClick={handleSave} disabled={saving || busy || !value.trim()}>
              {saving ? t("common.saving") : t("settings.provider_secret_modal.save_key")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
