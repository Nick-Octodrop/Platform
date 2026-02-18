import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../api.js";
import TabbedPaneShell from "../ui/TabbedPaneShell.jsx";
import { formatDateTime } from "../utils/dateTime.js";

function providerFromType(type) {
  const raw = String(type || "");
  if (!raw.startsWith("integration.")) return raw || "—";
  return raw.split(".", 2)[1] || "—";
}

export default function IntegrationConnectionPage() {
  const { connectionId } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeTab, setActiveTab] = useState("overview");

  const [name, setName] = useState("");
  const [status, setStatus] = useState("active");
  const [secretRef, setSecretRef] = useState("");
  const [configText, setConfigText] = useState("{}");

  async function load() {
    if (!connectionId) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const res = await apiFetch(`/integrations/connections/${encodeURIComponent(connectionId)}`);
      const conn = res?.connection || null;
      setItem(conn);
      setName(conn?.name || "");
      setStatus(conn?.status || "active");
      setSecretRef(conn?.secret_ref || "");
      setConfigText(JSON.stringify(conn?.config || {}, null, 2));
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

  const tabs = useMemo(
    () => [
      { id: "overview", label: "Overview" },
      { id: "authentication", label: "Authentication" },
      { id: "config", label: "Config" },
      { id: "activity", label: "Activity" },
    ],
    [],
  );

  async function save() {
    if (!item?.id || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      let nextConfig = {};
      try {
        nextConfig = JSON.parse(configText || "{}");
      } catch {
        throw new Error("Config must be valid JSON");
      }
      const res = await apiFetch(`/integrations/connections/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        body: { name: name.trim(), status, secret_ref: secretRef || null, config: nextConfig },
      });
      const updated = res?.connection || null;
      setItem(updated);
      setNotice("Saved");
    } catch (err) {
      setError(err?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const provider = providerFromType(item?.type);

  return (
    <TabbedPaneShell
      title={item?.name || "Connection"}
      subtitle={item?.type ? `Provider: ${provider}` : "Integration connection"}
      tabs={tabs}
      activeTabId={activeTab}
      onTabChange={setActiveTab}
      rightActions={(
        <div className="flex items-center gap-2">
          <button className="btn btn-sm btn-ghost" type="button" onClick={load} disabled={loading || saving}>
            Refresh
          </button>
          <button className="btn btn-sm btn-primary" type="button" onClick={save} disabled={loading || saving || !name.trim()}>
            Save
          </button>
          <button className="btn btn-sm" type="button" onClick={() => navigate(-1)} disabled={saving}>
            Back
          </button>
        </div>
      )}
    >
      {error ? <div className="alert alert-error text-sm mb-4">{error}</div> : null}
      {notice ? <div className="alert alert-success text-sm mb-4">{notice}</div> : null}

      <div className="rounded-box border border-base-300 bg-base-100 overflow-hidden min-h-[22rem]">
        {loading ? (
          <div className="p-4 text-sm opacity-70">Loading…</div>
        ) : !item ? (
          <div className="p-4 text-sm opacity-60">Connection not found.</div>
        ) : activeTab === "authentication" ? (
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              <label className="form-control md:col-span-6">
                <span className="label-text text-sm">Provider</span>
                <input className="input input-bordered input-sm" value={provider} disabled />
              </label>
              <label className="form-control md:col-span-6">
                <span className="label-text text-sm">Secret Ref</span>
                <input
                  className="input input-bordered input-sm font-mono"
                  value={secretRef}
                  placeholder="Secret ID (UUID)"
                  onChange={(e) => setSecretRef(e.target.value)}
                  disabled={saving}
                />
              </label>
            </div>
            <div className="text-xs opacity-70">
              Store credentials in Secrets and reference them here.
            </div>
          </div>
        ) : activeTab === "config" ? (
          <div className="p-4 space-y-2">
            <div className="text-xs opacity-70">Config (JSON)</div>
            <textarea
              className="textarea textarea-bordered w-full font-mono text-xs min-h-[18rem]"
              value={configText}
              onChange={(e) => setConfigText(e.target.value)}
              disabled={saving}
            />
          </div>
        ) : activeTab === "activity" ? (
          <div className="p-4 text-sm opacity-70">
            Connection activity and test runs will appear here.
          </div>
        ) : (
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              <label className="form-control md:col-span-6">
                <span className="label-text text-sm">Name</span>
                <input
                  className="input input-bordered input-sm"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={saving}
                />
              </label>
              <label className="form-control md:col-span-3">
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
              </label>
              <div className="md:col-span-3" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs opacity-70">Connection ID</div>
                <div className="font-mono break-all">{item.id}</div>
              </div>
              <div>
                <div className="text-xs opacity-70">Type</div>
                <div className="font-mono break-all">{item.type || "—"}</div>
              </div>
              <div>
                <div className="text-xs opacity-70">Created</div>
                <div>{formatDateTime(item.created_at, "—")}</div>
              </div>
              <div>
                <div className="text-xs opacity-70">Updated</div>
                <div>{formatDateTime(item.updated_at, "—")}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </TabbedPaneShell>
  );
}
