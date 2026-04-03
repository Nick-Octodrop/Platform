import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "../api.js";
import { useToast } from "../components/Toast.jsx";
import TabbedPaneShell from "../ui/TabbedPaneShell.jsx";

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
      setError(err?.message || "Failed to load connection");
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
      pushToast("success", "Saved");
    } catch (err) {
      setError(err?.message || "Save failed");
      pushToast("error", err?.message || "Save failed");
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
        <div className="rounded-box border border-base-300 bg-base-100 p-4 text-sm opacity-70">Loading…</div>
      ) : !item ? (
        <div className="rounded-box border border-base-300 bg-base-100 p-4 text-sm opacity-60">Connection not found.</div>
      ) : (
        <div className="space-y-4">
          <Section title="Connection" description="SMTP connection setup.">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-6 md:col-start-1">
                <div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="form-control md:col-span-2">
                      <span className="label-text text-sm">Connection Name</span>
                      <input
                        className="input input-bordered input-sm"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        disabled={saving}
                      />
                      <span className="label label-text-alt opacity-50">Required. Use a clear name like Support SMTP or Marketing Outbound.</span>
                    </label>
                    <label className="form-control">
                      <span className="label-text text-sm">Status</span>
                      <select
                        className="select select-bordered select-sm"
                        value={status}
                        onChange={(e) => setStatus(e.target.value)}
                        disabled={saving}
                      >
                        <option value="active">Active</option>
                        <option value="disabled">Disabled</option>
                      </select>
                      <span className="label label-text-alt opacity-50">Optional. Disable the connection without deleting it.</span>
                    </label>
                  </div>
                </div>

                <div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="form-control md:col-span-2">
                      <span className="label-text text-sm">SMTP Host</span>
                      <input
                        className="input input-bordered input-sm"
                        value={config.host}
                        onChange={(e) => setConfig((prev) => ({ ...prev, host: e.target.value }))}
                        placeholder="smtp.gmail.com"
                        disabled={saving}
                      />
                      <span className="label label-text-alt opacity-50">Required. Enter the outgoing mail server host provided by your email provider.</span>
                    </label>
                    <label className="form-control">
                      <span className="label-text text-sm">Port</span>
                      <input
                        className="input input-bordered input-sm"
                        type="number"
                        value={config.port}
                        onChange={(e) => setConfig((prev) => ({ ...prev, port: Number(e.target.value || 0) }))}
                        disabled={saving}
                      />
                      <span className="label label-text-alt opacity-50">Usually `587` for STARTTLS or `465` for SSL/TLS.</span>
                    </label>
                    <label className="form-control">
                      <span className="label-text text-sm">Security</span>
                      <select
                        className="select select-bordered select-sm"
                        value={config.security}
                        onChange={(e) => setConfig((prev) => ({ ...prev, security: e.target.value }))}
                        disabled={saving}
                      >
                        <option value="starttls">STARTTLS</option>
                        <option value="ssl">SSL/TLS</option>
                        <option value="none">None</option>
                      </select>
                      <span className="label label-text-alt opacity-50">Choose the transport security required by the server.</span>
                    </label>
                  </div>
                </div>

                <div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="form-control md:col-span-2">
                      <span className="label-text text-sm">Password Source</span>
                      <select
                        className="select select-bordered select-sm"
                        value={authMode}
                        onChange={(e) => setAuthMode(e.target.value)}
                        disabled={saving}
                      >
                        <option value="password">Direct Password</option>
                        <option value="secret">Saved Secret</option>
                      </select>
                      <span className="label label-text-alt opacity-50">Choose whether the SMTP password is stored directly here or pulled from Secrets.</span>
                    </label>
                    <label className="form-control">
                      <span className="label-text text-sm">Username</span>
                      <input
                        className="input input-bordered input-sm"
                        value={config.username}
                        onChange={(e) => setConfig((prev) => ({ ...prev, username: e.target.value }))}
                        disabled={saving}
                      />
                      <span className="label label-text-alt opacity-50">Usually the mailbox email address or SMTP username.</span>
                    </label>
                    {authMode === "secret" ? (
                      <>
                        <label className="form-control md:col-span-2">
                          <span className="label-text text-sm">Saved Secret</span>
                          <select
                            className="select select-bordered select-sm"
                            value={secretRef}
                            onChange={(e) => setSecretRef(e.target.value)}
                            disabled={saving}
                          >
                            <option value="">Select a secret…</option>
                            {secrets.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name || s.id}
                              </option>
                            ))}
                          </select>
                          <span className="label label-text-alt opacity-50">Optional. Pick a stored secret instead of entering the password directly.</span>
                        </label>
                        <label className="form-control md:col-span-2">
                          <span className="label-text text-sm">Secret ID Override</span>
                          <input
                            className="input input-bordered input-sm font-mono"
                            value={secretRef}
                            onChange={(e) => setSecretRef(e.target.value)}
                            placeholder="UUID"
                            disabled={saving}
                          />
                          <span className="label label-text-alt opacity-50">Optional. Use this only if you need to point at a secret id directly.</span>
                        </label>
                      </>
                    ) : (
                      <label className="form-control">
                        <span className="label-text text-sm">Password</span>
                        <input
                          className="input input-bordered input-sm"
                          type="password"
                          value={config.password}
                          onChange={(e) => setConfig((prev) => ({ ...prev, password: e.target.value }))}
                          placeholder="SMTP app password"
                          disabled={saving}
                        />
                        <span className="label label-text-alt opacity-50">Optional if your server does not require authentication. Otherwise use the SMTP password or app password.</span>
                      </label>
                    )}
                  </div>
                </div>

                <div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="form-control">
                      <span className="label-text text-sm">From Email</span>
                      <input
                        className="input input-bordered input-sm"
                        value={config.from_email}
                        onChange={(e) => setConfig((prev) => ({ ...prev, from_email: e.target.value }))}
                        disabled={saving}
                      />
                      <span className="label label-text-alt opacity-50">Optional. Leave blank to let the provider default the sender address.</span>
                    </label>
                    <label className="form-control">
                      <span className="label-text text-sm">From Name</span>
                      <input
                        className="input input-bordered input-sm"
                        value={config.from_name}
                        onChange={(e) => setConfig((prev) => ({ ...prev, from_name: e.target.value }))}
                        disabled={saving}
                      />
                      <span className="label label-text-alt opacity-50">Optional display name that appears in the recipient inbox.</span>
                    </label>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-sm btn-primary" type="button" onClick={save} disabled={loading || saving || !name.trim()}>
                    {saving ? "Saving..." : "Save"}
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
