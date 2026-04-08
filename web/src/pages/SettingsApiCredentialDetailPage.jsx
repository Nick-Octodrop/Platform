import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../api.js";
import { useToast } from "../components/Toast.jsx";
import TabbedPaneShell from "../ui/TabbedPaneShell.jsx";
import { formatDateTime } from "../utils/dateTime.js";

const AVAILABLE_SCOPES = [
  { id: "meta.read", label: "Metadata Read", help: "List entities and field metadata." },
  { id: "records.read", label: "Records Read", help: "Read records through the external API." },
  { id: "records.write", label: "Records Write", help: "Create and update records through the external API." },
  { id: "automations.read", label: "Automations Read", help: "List published automations." },
  { id: "automations.write", label: "Automations Write", help: "Trigger published automations." },
];

function TokenModal({ token, onClose }) {
  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-2xl">
        <h3 className="text-lg font-semibold">Copy API Key Now</h3>
        <p className="mt-1 text-sm opacity-70">This is the only time the full token is shown. Store it now.</p>
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
            Copy
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
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

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch("/settings/api-credentials");
      setItems(Array.isArray(response?.api_credentials) ? response.api_credentials : []);
    } catch (err) {
      setItems([]);
      setError(err?.message || "Failed to load API credentials");
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
      setError((current) => current || err?.message || "Failed to load request logs");
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
      pushToast("success", "API credential revoked.");
      await load();
      await loadLogs();
    } catch (err) {
      setError(err?.message || "Failed to revoke API credential");
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
      pushToast("success", "API credential rotated.");
      await load();
      await loadLogs();
    } catch (err) {
      setError(err?.message || "Failed to rotate API credential");
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
      pushToast("success", "API credential deleted.");
      navigate("/settings/api-credentials");
    } catch (err) {
      setError(err?.message || "Failed to delete API credential");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <TabbedPaneShell
      title=""
      subtitle=""
      tabs={[
        { id: "details", label: "Details" },
        { id: "requests", label: "Request Logs" },
      ]}
      activeTabId={activeTabId}
      onTabChange={setActiveTabId}
      contentContainer={false}
      rightActions={null}
    >
      {error ? <div className="alert alert-error text-sm mb-4">{error}</div> : null}

      {loading ? (
        <div className="rounded-box border border-base-300 bg-base-100 p-4 text-sm opacity-70">Loading…</div>
      ) : !item ? (
        <div className="rounded-box border border-base-300 bg-base-100 p-4 text-sm opacity-60">Credential not found.</div>
      ) : activeTabId === "details" ? (
        <div className="space-y-4">
          <DetailPanel title="Credential Details" description="Rotate and revoke from here. Scopes are fixed after creation.">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-lg font-semibold">{item.name || "Untitled"}</div>
                <span className={`badge ${item.status === "active" ? "badge-success" : "badge-ghost"}`}>{item.status || "active"}</span>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-box bg-base-200/40 p-3">
                  <div className="text-xs uppercase tracking-wide opacity-60">Key Prefix</div>
                  <div className="mt-1 font-mono text-sm">{item.key_prefix || "—"}</div>
                </div>
                <div className="rounded-box bg-base-200/40 p-3">
                  <div className="text-xs uppercase tracking-wide opacity-60">Expiry</div>
                  <div className="mt-1 text-sm">{formatDateTime(item.expires_at) || "No expiry"}</div>
                </div>
                <div className="rounded-box bg-base-200/40 p-3">
                  <div className="text-xs uppercase tracking-wide opacity-60">Last Rotated</div>
                  <div className="mt-1 text-sm">{formatDateTime(item.last_rotated_at) || "—"}</div>
                </div>
                <div className="rounded-box bg-base-200/40 p-3">
                  <div className="text-xs uppercase tracking-wide opacity-60">Last Used</div>
                  <div className="mt-1 text-sm">{formatDateTime(item.last_used_at) || "Never"}</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={rotateCredential}
                  disabled={item.status !== "active" || rotatingId === item.id}
                >
                  {rotatingId === item.id ? "Rotating..." : "Rotate Key"}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-outline text-error"
                  onClick={revokeCredential}
                  disabled={item.status !== "active" || revokingId === item.id}
                >
                  {revokingId === item.id ? "Revoking..." : "Revoke Key"}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-error"
                  onClick={() => setShowDeleteModal(true)}
                  disabled={item.status !== "revoked" || deleting}
                  title={item.status === "revoked" ? "Delete API credential" : "Revoke this API credential before deleting it"}
                >
                  {deleting ? "Deleting..." : "Delete Key"}
                </button>
              </div>
            </div>
          </DetailPanel>

          <DetailPanel title="Allowed Scopes" description="Keep credentials narrow. Only grant what the destination system needs.">
            <div className="space-y-2">
              {AVAILABLE_SCOPES.map((scope) => {
                const enabled = (item.scopes || []).includes(scope.id);
                return (
                  <div key={scope.id} className={`rounded-box border px-3 py-3 ${enabled ? "border-base-300 bg-base-100" : "border-base-300 bg-base-200/30 opacity-60"}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium">{scope.label}</div>
                      <span className={`badge badge-sm ${enabled ? "badge-success" : "badge-ghost"}`}>{enabled ? "Enabled" : "Off"}</span>
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
          title={`Request Logs for ${item.name || item.key_prefix}`}
          description="Recent `/ext/v1` activity for this credential."
        >
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Request</th>
                  <th>Status</th>
                  <th>Duration</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {loadingLogs ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-sm opacity-60">Loading request logs...</td>
                  </tr>
                ) : selectedLogs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-sm opacity-60">No external API requests logged yet.</td>
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
                      <td className="text-sm">{log.duration_ms != null ? `${log.duration_ms} ms` : "—"}</td>
                      <td className="text-sm">{log.ip_address || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </DetailPanel>
      )}

      {revealedToken ? <TokenModal token={revealedToken} onClose={() => setRevealedToken("")} /> : null}

      {showDeleteModal ? (
        <div className="modal modal-open">
          <div className="modal-box max-w-md">
            <h3 className="text-lg font-semibold">Delete API credential?</h3>
            <p className="mt-2 text-sm opacity-70">
              This will permanently remove this revoked API credential. Request logs will remain for audit history.
            </p>
            {item?.status !== "revoked" ? (
              <div className="alert alert-warning mt-4 text-sm">Revoke this API credential before deleting it.</div>
            ) : null}
            <div className="modal-action">
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => !deleting && setShowDeleteModal(false)} disabled={deleting}>
                Cancel
              </button>
              <button className="btn btn-error btn-sm" type="button" onClick={deleteCredential} disabled={deleting || item?.status !== "revoked"}>
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
          <button className="modal-backdrop" type="button" onClick={() => !deleting && setShowDeleteModal(false)}>
            close
          </button>
        </div>
      ) : null}
    </TabbedPaneShell>
  );
}
