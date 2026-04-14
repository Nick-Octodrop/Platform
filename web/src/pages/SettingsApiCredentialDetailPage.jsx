import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../api.js";
import { useToast } from "../components/Toast.jsx";
import TabbedPaneShell from "../ui/TabbedPaneShell.jsx";
import { formatDateTime } from "../utils/dateTime.js";
import { useI18n } from "../i18n/LocalizationProvider.jsx";

function TokenModal({ t, token, onClose }) {
  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-2xl">
        <h3 className="text-lg font-semibold">{t("settings.api_credentials.copy_title")}</h3>
        <p className="mt-1 text-sm opacity-70">{t("settings.api_credentials.copy_description")}</p>
        <textarea className="textarea textarea-bordered mt-4 min-h-[8rem] w-full font-mono text-sm" readOnly value={token} />
        <div className="modal-action">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(token);
              } catch {
                // ignore clipboard failures
              }
            }}
          >
            {t("common.copy")}
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {t("common.done")}
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailPanel({ title, description, children, tone = "bg-base-100" }) {
  return (
    <section className={`rounded-box border border-base-300 ${tone} p-4`}>
      <div className="font-medium">{title}</div>
      {description ? <div className="mt-1 text-sm opacity-70">{description}</div> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function SettingsApiCredentialDetailPage() {
  const { t } = useI18n();
  const { credentialId } = useParams();
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const [items, setItems] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [error, setError] = useState("");
  const [activeTabId, setActiveTabId] = useState("details");
  const [revokingId, setRevokingId] = useState("");
  const [rotatingId, setRotatingId] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [revealedToken, setRevealedToken] = useState("");

  const availableScopes = useMemo(
    () => [
      { id: "meta.read", label: t("settings.api_credentials.scopes.meta_read.label"), help: t("settings.api_credentials.scopes.meta_read.help") },
      { id: "records.read", label: t("settings.api_credentials.scopes.records_read.label"), help: t("settings.api_credentials.scopes.records_read.help") },
      { id: "records.write", label: t("settings.api_credentials.scopes.records_write.label"), help: t("settings.api_credentials.scopes.records_write.help") },
      { id: "automations.read", label: t("settings.api_credentials.scopes.automations_read.label"), help: t("settings.api_credentials.scopes.automations_read.help") },
      { id: "automations.write", label: t("settings.api_credentials.scopes.automations_write.label"), help: t("settings.api_credentials.scopes.automations_write.help") },
    ],
    [t],
  );

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch("/settings/api-credentials");
      setItems(Array.isArray(response?.api_credentials) ? response.api_credentials : []);
    } catch (err) {
      setItems([]);
      setError(err?.message || t("settings.api_credentials.load_failed"));
    } finally {
      setLoading(false);
    }
  }

  async function loadLogs() {
    setLoadingLogs(true);
    try {
      const response = await apiFetch("/settings/api-request-logs?limit=100");
      setLogs(Array.isArray(response?.logs) ? response.logs : []);
    } catch (err) {
      setLogs([]);
      setError((current) => current || err?.message || t("settings.api_credentials.request_logs_load_failed"));
    } finally {
      setLoadingLogs(false);
    }
  }

  useEffect(() => {
    load();
    loadLogs();
  }, [credentialId]);

  const item = useMemo(() => items.find((entry) => entry.id === credentialId) || null, [items, credentialId]);
  const selectedLogs = useMemo(() => logs.filter((log) => log.api_credential_id === credentialId), [logs, credentialId]);

  async function revokeCredential() {
    if (!item?.id || revokingId) return;
    setRevokingId(item.id);
    setError("");
    try {
      await apiFetch(`/settings/api-credentials/${encodeURIComponent(item.id)}/revoke`, { method: "POST" });
      pushToast("success", t("settings.api_credentials.revoked_one"));
      await load();
      await loadLogs();
    } catch (err) {
      setError(err?.message || t("settings.api_credentials.revoke_failed"));
    } finally {
      setRevokingId("");
    }
  }

  async function rotateCredential() {
    if (!item?.id || rotatingId) return;
    setRotatingId(item.id);
    setError("");
    try {
      const response = await apiFetch(`/settings/api-credentials/${encodeURIComponent(item.id)}/rotate`, {
        method: "POST",
        body: {},
      });
      setRevealedToken(response?.token || "");
      pushToast("success", t("settings.api_credentials.rotated"));
      await load();
      await loadLogs();
    } catch (err) {
      setError(err?.message || t("settings.api_credentials.rotate_failed"));
    } finally {
      setRotatingId("");
    }
  }

  async function deleteCredential() {
    if (!item?.id || deleting || item.status !== "revoked") return;
    setDeleting(true);
    setError("");
    try {
      await apiFetch(`/settings/api-credentials/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      pushToast("success", t("settings.api_credentials.deleted_one"));
      navigate("/settings/api-credentials");
    } catch (err) {
      setError(err?.message || t("settings.api_credentials.delete_failed"));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <TabbedPaneShell
      title=""
      subtitle=""
      tabs={[
        { id: "details", label: t("settings.api_credentials.details_tab") },
        { id: "requests", label: t("settings.api_credentials.request_logs_tab") },
      ]}
      activeTabId={activeTabId}
      onTabChange={setActiveTabId}
      contentContainer={false}
      rightActions={null}
    >
      {error ? <div className="alert alert-error text-sm mb-4">{error}</div> : null}

      {loading ? (
        <div className="rounded-box border border-base-300 bg-base-100 p-4 text-sm opacity-70">{t("common.loading")}</div>
      ) : !item ? (
        <div className="rounded-box border border-base-300 bg-base-100 p-4 text-sm opacity-60">{t("settings.api_credentials.not_found")}</div>
      ) : activeTabId === "details" ? (
        <div className="space-y-4">
          <DetailPanel title={t("settings.api_credentials.details_title")} description={t("settings.api_credentials.details_description")}>
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-lg font-semibold">{item.name || t("settings.untitled")}</div>
                <span className={`badge ${item.status === "active" ? "badge-success" : "badge-ghost"}`}>
                  {item.status === "revoked" ? t("common.revoked") : t("common.active")}
                </span>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-box bg-base-200/40 p-3">
                  <div className="text-xs uppercase tracking-wide opacity-60">{t("settings.api_credentials.key_prefix")}</div>
                  <div className="mt-1 font-mono text-sm">{item.key_prefix || "—"}</div>
                </div>
                <div className="rounded-box bg-base-200/40 p-3">
                  <div className="text-xs uppercase tracking-wide opacity-60">{t("settings.api_credentials.expiry")}</div>
                  <div className="mt-1 text-sm">{formatDateTime(item.expires_at) || t("settings.api_credentials.no_expiry")}</div>
                </div>
                <div className="rounded-box bg-base-200/40 p-3">
                  <div className="text-xs uppercase tracking-wide opacity-60">{t("settings.api_credentials.last_rotated")}</div>
                  <div className="mt-1 text-sm">{formatDateTime(item.last_rotated_at) || "—"}</div>
                </div>
                <div className="rounded-box bg-base-200/40 p-3">
                  <div className="text-xs uppercase tracking-wide opacity-60">{t("settings.api_credentials.last_used")}</div>
                  <div className="mt-1 text-sm">{formatDateTime(item.last_used_at) || t("settings.api_credentials.never")}</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={rotateCredential}
                  disabled={item.status !== "active" || rotatingId === item.id}
                >
                  {rotatingId === item.id ? t("settings.api_credentials.rotating") : t("settings.api_credentials.rotate_key")}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-outline text-error"
                  onClick={revokeCredential}
                  disabled={item.status !== "active" || revokingId === item.id}
                >
                  {revokingId === item.id ? t("settings.api_credentials.revoking") : t("settings.api_credentials.revoke_key")}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-error"
                  onClick={() => setShowDeleteModal(true)}
                  disabled={item.status !== "revoked" || deleting}
                  title={item.status === "revoked" ? t("settings.api_credentials.delete_credential") : t("settings.api_credentials.revoke_before_delete_single")}
                >
                  {deleting ? t("common.deleting") : t("settings.api_credentials.delete_key")}
                </button>
              </div>
            </div>
          </DetailPanel>

          <DetailPanel title={t("settings.api_credentials.allowed_scopes")} description={t("settings.api_credentials.allowed_scopes_description")}>
            <div className="space-y-2">
              {availableScopes.map((scope) => {
                const enabled = (item.scopes || []).includes(scope.id);
                return (
                  <div key={scope.id} className={`rounded-box border px-3 py-3 ${enabled ? "border-base-300 bg-base-100" : "border-base-300 bg-base-200/30 opacity-60"}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium">{scope.label}</div>
                      <span className={`badge badge-sm ${enabled ? "badge-success" : "badge-ghost"}`}>{enabled ? t("settings.enabled") : t("settings.off")}</span>
                    </div>
                    <div className="mt-1 text-xs opacity-70">{scope.help}</div>
                  </div>
                );
              })}
            </div>
          </DetailPanel>
        </div>
      ) : (
        <DetailPanel
          title={t("settings.api_credentials.request_logs_for", { name: item.name || item.key_prefix })}
          description={t("settings.api_credentials.request_logs_description")}
        >
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("settings.api_credentials.when")}</th>
                  <th>{t("settings.api_credentials.request")}</th>
                  <th>{t("settings.api_credentials.status")}</th>
                  <th>{t("settings.api_credentials.duration")}</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {loadingLogs ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-sm opacity-60">{t("settings.api_credentials.loading_request_logs")}</td>
                  </tr>
                ) : selectedLogs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-sm opacity-60">{t("settings.api_credentials.no_requests")}</td>
                  </tr>
                ) : (
                  selectedLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="text-sm">{formatDateTime(log.created_at) || "—"}</td>
                      <td><div className="font-mono text-xs">{log.method} {log.path}</div></td>
                      <td>
                        <span className={`badge badge-sm ${Number(log.status_code) >= 400 ? "badge-error" : "badge-success"}`}>
                          {log.status_code}
                        </span>
                      </td>
                      <td className="text-sm">{log.duration_ms != null ? t("settings.api_credentials.duration_ms", { value: log.duration_ms }) : "—"}</td>
                      <td className="text-sm">{log.ip_address || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </DetailPanel>
      )}

      {revealedToken ? <TokenModal t={t} token={revealedToken} onClose={() => setRevealedToken("")} /> : null}

      {showDeleteModal ? (
        <div className="modal modal-open">
          <div className="modal-box max-w-md">
            <h3 className="text-lg font-semibold">{t("settings.api_credentials.delete_title_one")}</h3>
            <p className="mt-2 text-sm opacity-70">{t("settings.api_credentials.delete_single_body")}</p>
            {item?.status !== "revoked" ? (
              <div className="alert alert-warning mt-4 text-sm">{t("settings.api_credentials.revoke_before_delete_single")}</div>
            ) : null}
            <div className="modal-action">
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => !deleting && setShowDeleteModal(false)} disabled={deleting}>
                {t("common.cancel")}
              </button>
              <button className="btn btn-error btn-sm" type="button" onClick={deleteCredential} disabled={deleting || item?.status !== "revoked"}>
                {deleting ? t("common.deleting") : t("common.delete")}
              </button>
            </div>
          </div>
          <button className="modal-backdrop" type="button" onClick={() => !deleting && setShowDeleteModal(false)}>
            {t("common.close")}
          </button>
        </div>
      ) : null}
    </TabbedPaneShell>
  );
}
