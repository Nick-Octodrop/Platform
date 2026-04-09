import React, { useMemo, useState } from "react";
import { createWorkspaceSecret } from "../api.js";

const PROVIDER_COPY = {
  openai: {
    title: "Connect OpenAI",
    description: "Add the workspace OpenAI API key to enable AI in Studio, Automations, Templates, and Octo AI.",
    providerKey: "openai",
    secretKey: "api_key",
    placeholder: "sk-...",
  },
  google_maps: {
    title: "Connect Google Maps",
    description: "Add a workspace server-side Google Maps / Places API key with billing and Places API enabled to use address autocomplete in forms.",
    providerKey: "google_maps",
    secretKey: "api_key",
    placeholder: "AIza...",
  },
};

export default function ProviderSecretModal({
  open,
  providerKey,
  canManageSettings = false,
  busy = false,
  onClose,
  onSaved,
}) {
  const copy = useMemo(() => PROVIDER_COPY[providerKey] || {
    title: "Connect Provider",
    description: "Add a workspace secret for this provider.",
    providerKey,
    secretKey: "api_key",
    placeholder: "Enter API key",
  }, [providerKey]);
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
      setError(err?.message || "Failed to save secret");
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
            You do not have permission to manage workspace secrets. Ask a workspace admin to connect this provider in Settings.
          </div>
        ) : null}
        <div className="mt-4 space-y-4">
          <label className="form-control">
            <span className="label-text text-sm">Secret name</span>
            <input
              className="input input-bordered"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving || busy || !canManageSettings}
            />
          </label>
          <label className="form-control">
            <span className="label-text text-sm">API key</span>
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
            Close
          </button>
          {canManageSettings ? (
            <button className="btn btn-primary" type="button" onClick={handleSave} disabled={saving || busy || !value.trim()}>
              {saving ? "Saving..." : "Save key"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
