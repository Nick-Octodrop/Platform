import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "../api.js";
import { useToast } from "../components/Toast.jsx";
import TabbedPaneShell from "../ui/TabbedPaneShell.jsx";
import AppSelect from "../components/AppSelect.jsx";
import { useI18n } from "../i18n/LocalizationProvider.jsx";

const DEFAULT_CONFIG = {
  host: "",
  port: 587,
  security: "starttls",
  username: "",
  password: "",
  from_email: "",
  from_name: "",
};

function normalizeConfig(value) {
  const raw = value && typeof value === "object" ? value : {};
  return {
    host: raw.host || "",
    port: Number.isFinite(Number(raw.port)) ? Number(raw.port) : 587,
    security: raw.security || "starttls",
    username: raw.username || "",
    password: raw.password || "",
    from_email: raw.from_email || "",
    from_name: raw.from_name || "",
  };
}

function Section({ title, description, children, tone = "bg-base-100" }) {
  return (
    <div className={`rounded-box border border-base-300 p-4 ${tone}`}>
      <div className="text-sm font-semibold">{title}</div>
      {description ? <div className="text-sm opacity-70 mt-1">{description}</div> : null}
      <div className="mt-4">{children}</div>
    </div>
  );
}

export default function EmailConnectionDetailPage() {
  const { connectionId } = useParams();
  const { pushToast } = useToast();
  const { t } = useI18n();
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [secrets, setSecrets] = useState([]);

  const [name, setName] = useState("");
  const [status, setStatus] = useState("active");
  const [authMode, setAuthMode] = useState("password");
  const [secretRef, setSecretRef] = useState("");
  const [config, setConfig] = useState(DEFAULT_CONFIG);

  async function load() {
    if (!connectionId) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/email/connections/${encodeURIComponent(connectionId)}`);
      const conn = res?.connection || null;
      setItem(conn);
      setName(conn?.name || "");
      setStatus(conn?.status || "active");
      setSecretRef(conn?.secret_ref || "");
      setAuthMode(conn?.secret_ref ? "secret" : "password");
      setConfig(normalizeConfig(conn?.config));
    } catch (err) {
      setItem(null);
      setError(err?.message || t("settings.email_connections.load_failed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId]);

  useEffect(() => {
    let mounted = true;
    async function loadSecrets() {
      try {
        const res = await apiFetch("/settings/secrets");
        if (!mounted) return;
        setSecrets(Array.isArray(res?.secrets) ? res.secrets : []);
      } catch {
        if (mounted) setSecrets([]);
      }
    }
    loadSecrets();
    return () => {
      mounted = false;
    };
  }, []);

  async function save() {
    if (!item?.id || saving) return;
    setSaving(true);
    setError("");
    try {
      const body = {
        name: name.trim(),
        status,
        secret_ref: authMode === "secret" ? (secretRef.trim() || null) : null,
        config: normalizeConfig(config),
      };
      const res = await apiFetch(`/email/connections/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        body,
      });
      setItem(res?.connection || null);
      pushToast("success", t("common.saved"));
    } catch (err) {
      setError(err?.message || t("common.save_failed"));
      pushToast("error", err?.message || t("common.save_failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <TabbedPaneShell
      contentContainer={true}
    >
      {error ? <div className="alert alert-error text-sm mb-4">{error}</div> : null}

      {loading ? (
        <div className="rounded-box border border-base-300 bg-base-100 p-4 text-sm opacity-70">{t("common.loading")}</div>
      ) : !item ? (
        <div className="rounded-box border border-base-300 bg-base-100 p-4 text-sm opacity-60">{t("settings.email_connections.not_found")}</div>
      ) : (
        <div className="space-y-4">
          <Section title={t("settings.email_connections.section_title")} description={t("settings.email_connections.section_description")}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-6 md:col-start-1">
                <div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="form-control md:col-span-2">
                      <span className="label-text text-sm">{t("settings.email_connections.connection_name")}</span>
                      <input
                        className="input input-bordered input-sm"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        disabled={saving}
                      />
                      <span className="label label-text-alt opacity-50">{t("settings.email_connections.connection_name_help")}</span>
                    </label>
                    <label className="form-control">
                      <span className="label-text text-sm">{t("common.status")}</span>
                      <AppSelect
                        className="select select-bordered select-sm"
                        value={status}
                        onChange={(e) => setStatus(e.target.value)}
                        disabled={saving}
                      >
                        <option value="active">{t("common.active")}</option>
                        <option value="disabled">{t("common.disabled")}</option>
                      </AppSelect>
                      <span className="label label-text-alt opacity-50">{t("settings.email_connections.status_help")}</span>
                    </label>
                  </div>
                </div>

                <div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="form-control md:col-span-2">
                      <span className="label-text text-sm">{t("settings.email_connections.smtp_host")}</span>
                      <input
                        className="input input-bordered input-sm"
                        value={config.host}
                        onChange={(e) => setConfig((prev) => ({ ...prev, host: e.target.value }))}
                        placeholder={t("settings.email_connections.smtp_host_placeholder")}
                        disabled={saving}
                      />
                      <span className="label label-text-alt opacity-50">{t("settings.email_connections.smtp_host_help")}</span>
                    </label>
                    <label className="form-control">
                      <span className="label-text text-sm">{t("common.port")}</span>
                      <input
                        className="input input-bordered input-sm"
                        type="number"
                        value={config.port}
                        onChange={(e) => setConfig((prev) => ({ ...prev, port: Number(e.target.value || 0) }))}
                        disabled={saving}
                      />
                      <span className="label label-text-alt opacity-50">{t("settings.email_connections.port_help")}</span>
                    </label>
                    <label className="form-control">
                      <span className="label-text text-sm">{t("settings.email_connections.security")}</span>
                      <AppSelect
                        className="select select-bordered select-sm"
                        value={config.security}
                        onChange={(e) => setConfig((prev) => ({ ...prev, security: e.target.value }))}
                        disabled={saving}
                      >
                        <option value="starttls">{t("settings.email_connections.security_starttls")}</option>
                        <option value="ssl">{t("settings.email_connections.security_ssl")}</option>
                        <option value="none">{t("settings.email_connections.security_none")}</option>
                      </AppSelect>
                      <span className="label label-text-alt opacity-50">{t("settings.email_connections.security_help")}</span>
                    </label>
                  </div>
                </div>

                <div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="form-control md:col-span-2">
                      <span className="label-text text-sm">{t("settings.email_connections.password_source")}</span>
                      <AppSelect
                        className="select select-bordered select-sm"
                        value={authMode}
                        onChange={(e) => setAuthMode(e.target.value)}
                        disabled={saving}
                      >
                        <option value="password">{t("settings.email_connections.password_source_direct")}</option>
                        <option value="secret">{t("settings.email_connections.password_source_secret")}</option>
                      </AppSelect>
                      <span className="label label-text-alt opacity-50">{t("settings.email_connections.password_source_help")}</span>
                    </label>
                    <label className="form-control">
                      <span className="label-text text-sm">{t("settings.email_connections.username")}</span>
                      <input
                        className="input input-bordered input-sm"
                        value={config.username}
                        onChange={(e) => setConfig((prev) => ({ ...prev, username: e.target.value }))}
                        disabled={saving}
                      />
                      <span className="label label-text-alt opacity-50">{t("settings.email_connections.username_help")}</span>
                    </label>
                    {authMode === "secret" ? (
                      <>
                        <label className="form-control md:col-span-2">
                          <span className="label-text text-sm">{t("settings.email_connections.saved_secret")}</span>
                          <AppSelect
                            className="select select-bordered select-sm"
                            value={secretRef}
                            onChange={(e) => setSecretRef(e.target.value)}
                            disabled={saving}
                          >
                            <option value="">{t("settings.email_connections.saved_secret_placeholder")}</option>
                            {secrets.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name || s.id}
                              </option>
                            ))}
                          </AppSelect>
                          <span className="label label-text-alt opacity-50">{t("settings.email_connections.saved_secret_help")}</span>
                        </label>
                        <label className="form-control md:col-span-2">
                          <span className="label-text text-sm">{t("settings.email_connections.secret_id_override")}</span>
                          <input
                            className="input input-bordered input-sm font-mono"
                            value={secretRef}
                            onChange={(e) => setSecretRef(e.target.value)}
                            placeholder={t("settings.email_connections.secret_id_override_placeholder")}
                            disabled={saving}
                          />
                          <span className="label label-text-alt opacity-50">{t("settings.email_connections.secret_id_override_help")}</span>
                        </label>
                      </>
                    ) : (
                      <label className="form-control">
                        <span className="label-text text-sm">{t("settings.email_connections.password")}</span>
                        <input
                          className="input input-bordered input-sm"
                          type="password"
                          value={config.password}
                          onChange={(e) => setConfig((prev) => ({ ...prev, password: e.target.value }))}
                          placeholder={t("settings.email_connections.password_placeholder")}
                          disabled={saving}
                        />
                        <span className="label label-text-alt opacity-50">{t("settings.email_connections.password_help")}</span>
                      </label>
                    )}
                  </div>
                </div>

                <div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="form-control">
                      <span className="label-text text-sm">{t("settings.email_connections.from_email")}</span>
                      <input
                        className="input input-bordered input-sm"
                        value={config.from_email}
                        onChange={(e) => setConfig((prev) => ({ ...prev, from_email: e.target.value }))}
                        disabled={saving}
                      />
                      <span className="label label-text-alt opacity-50">{t("settings.email_connections.from_email_help")}</span>
                    </label>
                    <label className="form-control">
                      <span className="label-text text-sm">{t("settings.email_connections.from_name")}</span>
                      <input
                        className="input input-bordered input-sm"
                        value={config.from_name}
                        onChange={(e) => setConfig((prev) => ({ ...prev, from_name: e.target.value }))}
                        disabled={saving}
                      />
                      <span className="label label-text-alt opacity-50">{t("settings.email_connections.from_name_help")}</span>
                    </label>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-sm btn-primary" type="button" onClick={save} disabled={loading || saving || !name.trim()}>
                    {saving ? t("common.saving") : t("common.save")}
                  </button>
                </div>
              </div>
              <div className="hidden md:block" />
            </div>
          </Section>
        </div>
      )}
    </TabbedPaneShell>
  );
}
