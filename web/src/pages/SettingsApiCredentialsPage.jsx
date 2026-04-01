import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api.js";
import { formatDateTime } from "../utils/dateTime.js";

const AVAILABLE_SCOPES = [
  { id: "meta.read", label: "Metadata Read", help: "List entities and field metadata." },
  { id: "records.read", label: "Records Read", help: "Read records through the external API." },
  { id: "records.write", label: "Records Write", help: "Create and update records through the external API." },
  { id: "automations.read", label: "Automations Read", help: "List published automations." },
  { id: "automations.write", label: "Automations Write", help: "Trigger published automations." },
];

function CredentialModal({
  name,
  setName,
  scopes,
  setScopes,
  expiresInDays,
  setExpiresInDays,
  saving,
  onCancel,
  onConfirm,
}) {
  function toggleScope(scopeId) {
    setScopes((current) => (current.includes(scopeId) ? current.filter((item) => item !== scopeId) : [...current, scopeId]));
  }

  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-2xl">
        <h3 className="text-lg font-semibold">Create API Credential</h3>
        <p className="mt-1 text-sm opacity-70">
          Create a scoped API key for a third-party system. The raw token is shown once after creation.
        </p>

        <div className="mt-5 space-y-4">
          <label className="form-control">
            <span className="label-text text-sm">Name</span>
            <input
              className="input input-bordered"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Shopify sync worker"
              disabled={saving}
            />
          </label>

          <label className="form-control">
            <span className="label-text text-sm">Expires In Days</span>
            <input
              className="input input-bordered"
              value={expiresInDays}
              onChange={(event) => setExpiresInDays(event.target.value)}
              placeholder="Leave blank for no expiry"
              disabled={saving}
            />
            <span className="label-text-alt opacity-70 mt-1">Optional. Use this for vendor keys or short-lived rollout credentials.</span>
          </label>

          <div className="space-y-2">
            <div className="text-sm font-medium">Scopes</div>
            <div className="space-y-2">
              {AVAILABLE_SCOPES.map((scope) => (
                <label key={scope.id} className="flex items-start gap-3 rounded-box border border-base-300 p-3">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm mt-0.5"
                    checked={scopes.includes(scope.id)}
                    onChange={() => toggleScope(scope.id)}
                    disabled={saving}
                  />
                  <div>
                    <div className="text-sm font-medium">{scope.label}</div>
                    <div className="text-xs opacity-70">{scope.help}</div>
                  </div>
                </label>
              ))}
            </div>
            <div className="text-xs opacity-70">Use the smallest scope set that still lets the integration do its job.</div>
          </div>
        </div>

        <div className="modal-action">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={saving || !name.trim()}>
            {saving ? "Creating..." : "Create Key"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TokenModal({ token, onClose }) {
  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-2xl">
        <h3 className="text-lg font-semibold">Copy API Key Now</h3>
        <p className="mt-1 text-sm opacity-70">
          This is the only time the full token is shown. Store it in the destination system now.
        </p>
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

export default function SettingsApiCredentialsPage() {
  const [items, setItems] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState(["meta.read", "records.read"]);
  const [expiresInDays, setExpiresInDays] = useState("");
  const [createdToken, setCreatedToken] = useState("");
  const [revokingId, setRevokingId] = useState("");
  const [rotatingId, setRotatingId] = useState("");

  async function loadItems() {
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
    } catch {
      setLogs([]);
    } finally {
      setLoadingLogs(false);
    }
  }

  useEffect(() => {
    loadItems();
    loadLogs();
  }, []);

  const activeCount = useMemo(() => items.filter((item) => item?.status === "active").length, [items]);

  async function createCredential() {
    if (creating || !name.trim()) return;
    setCreating(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch("/settings/api-credentials", {
        method: "POST",
        body: {
          name: name.trim(),
          scopes,
          expires_in_days: expiresInDays.trim() || null,
        },
      });
      setShowCreateModal(false);
      setCreatedToken(response?.token || "");
      setName("");
      setScopes(["meta.read", "records.read"]);
      setExpiresInDays("");
      setNotice("API credential created.");
      await loadItems();
      await loadLogs();
    } catch (err) {
      setError(err?.message || "Failed to create API credential");
    } finally {
      setCreating(false);
    }
  }

  async function revokeCredential(id) {
    if (!id || revokingId) return;
    setRevokingId(id);
    setError("");
    setNotice("");
    try {
      await apiFetch(`/settings/api-credentials/${encodeURIComponent(id)}/revoke`, { method: "POST" });
      setNotice("API credential revoked.");
      await loadItems();
      await loadLogs();
    } catch (err) {
      setError(err?.message || "Failed to revoke API credential");
    } finally {
      setRevokingId("");
    }
  }

  async function rotateCredential(id) {
    if (!id || rotatingId) return;
    setRotatingId(id);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`/settings/api-credentials/${encodeURIComponent(id)}/rotate`, {
        method: "POST",
        body: {},
      });
      setCreatedToken(response?.token || "");
      setNotice("API credential rotated. Copy the new token now.");
      await loadItems();
      await loadLogs();
    } catch (err) {
      setError(err?.message || "Failed to rotate API credential");
    } finally {
      setRotatingId("");
    }
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
      <div className="rounded-box border border-base-300 bg-base-100 p-4 md:p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-xl font-semibold">API Credentials</h1>
            <p className="mt-1 text-sm opacity-70">
              Create scoped API keys for external systems using Octodrop’s `/ext/v1` endpoints.
            </p>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
            Create API Key
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-box bg-base-200 p-3">
            <div className="text-xs uppercase tracking-wide opacity-60">Total Keys</div>
            <div className="mt-1 text-lg font-semibold">{items.length}</div>
          </div>
          <div className="rounded-box bg-base-200 p-3">
            <div className="text-xs uppercase tracking-wide opacity-60">Active</div>
            <div className="mt-1 text-lg font-semibold">{activeCount}</div>
          </div>
          <div className="rounded-box bg-base-200 p-3">
            <div className="text-xs uppercase tracking-wide opacity-60">Available Scopes</div>
            <div className="mt-1 text-sm">{AVAILABLE_SCOPES.length}</div>
          </div>
        </div>

        {notice ? <div className="alert alert-success mt-4 text-sm">{notice}</div> : null}
        {error ? <div className="alert alert-error mt-4 text-sm">{error}</div> : null}
      </div>

      <div className="rounded-box border border-base-300 bg-base-100">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Prefix</th>
                <th>Scopes</th>
                <th>Status</th>
                <th>Expires</th>
                <th>Rotated</th>
                <th>Last Used</th>
                <th>Created</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-sm opacity-60">
                    Loading API credentials...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-sm opacity-60">
                    No API credentials yet.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="font-medium">{item.name || "Untitled"}</div>
                    </td>
                    <td className="font-mono text-xs">{item.key_prefix || "—"}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {(item.scopes || []).length ? (
                          item.scopes.map((scope) => (
                            <span key={scope} className="badge badge-outline badge-sm">
                              {scope}
                            </span>
                          ))
                        ) : (
                          <span className="text-sm opacity-60">No scopes</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className={`badge badge-sm ${item.status === "active" ? "badge-success" : "badge-ghost"}`}>
                        {item.status || "active"}
                      </span>
                    </td>
                    <td className="text-sm">{formatDateTime(item.expires_at) || "No expiry"}</td>
                    <td className="text-sm">{formatDateTime(item.last_rotated_at) || "—"}</td>
                    <td className="text-sm">{formatDateTime(item.last_used_at) || "Never"}</td>
                    <td className="text-sm">{formatDateTime(item.created_at) || "—"}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => rotateCredential(item.id)}
                        disabled={item.status !== "active" || rotatingId === item.id}
                      >
                        {rotatingId === item.id ? "Rotating..." : "Rotate"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm text-error"
                        onClick={() => revokeCredential(item.id)}
                        disabled={item.status !== "active" || revokingId === item.id}
                      >
                        {revokingId === item.id ? "Revoking..." : "Revoke"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-box border border-base-300 bg-base-100">
        <div className="flex items-center justify-between border-b border-base-300 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">Recent External API Requests</h2>
            <p className="text-sm opacity-70">Audit trail for `/ext/v1` requests made with API credentials.</p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={loadLogs} disabled={loadingLogs}>
            {loadingLogs ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Credential</th>
                <th>Request</th>
                <th>Status</th>
                <th>Duration</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {loadingLogs ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-sm opacity-60">
                    Loading request logs...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-sm opacity-60">
                    No external API requests logged yet.
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const credential = items.find((item) => item.id === log.api_credential_id);
                  return (
                    <tr key={log.id}>
                      <td className="text-sm">{formatDateTime(log.created_at) || "—"}</td>
                      <td className="text-sm">{credential?.name || log.api_credential_id || "Unknown"}</td>
                      <td>
                        <div className="font-mono text-xs">{log.method} {log.path}</div>
                      </td>
                      <td>
                        <span className={`badge badge-sm ${Number(log.status_code) >= 400 ? "badge-error" : "badge-success"}`}>
                          {log.status_code}
                        </span>
                      </td>
                      <td className="text-sm">{log.duration_ms != null ? `${log.duration_ms} ms` : "—"}</td>
                      <td className="text-sm">{log.ip_address || "—"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showCreateModal ? (
        <CredentialModal
          name={name}
          setName={setName}
          scopes={scopes}
          setScopes={setScopes}
          expiresInDays={expiresInDays}
          setExpiresInDays={setExpiresInDays}
          saving={creating}
          onCancel={() => setShowCreateModal(false)}
          onConfirm={createCredential}
        />
      ) : null}

      {createdToken ? <TokenModal token={createdToken} onClose={() => setCreatedToken("")} /> : null}
    </div>
  );
}
