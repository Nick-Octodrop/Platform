import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api.js";
import { useToast } from "../components/Toast.jsx";

function ModuleRow({ mod, active, onClick }) {
  return (
    <button className={`btn btn-ghost justify-start w-full ${active ? "bg-base-200" : ""}`} onClick={onClick}>
      <div className="flex flex-col items-start">
        <span className="font-medium">{mod.module_id}</span>
        <span className="text-xs opacity-60">{mod.manifest_hash?.slice(0, 12) || "—"}</span>
      </div>
    </button>
  );
}

function IssueList({ items }) {
  if (!items || items.length === 0) return <div className="text-sm opacity-60">No warnings</div>;
  return (
    <div className="space-y-1">
      {items.map((item, idx) => (
        <div key={idx} className="text-xs">
          <span className="font-mono">{item.code}</span> — {item.message}
          {item.path ? <span className="opacity-70"> ({item.path})</span> : null}
        </div>
      ))}
    </div>
  );
}

export default function DiagnosticsPage() {
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const [modules, setModules] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadDiagnostics() {
    setLoading(true);
    try {
      const res = await apiFetch("/debug/diagnostics");
      const data = res.data || {};
      const mods = data.modules || [];
      setModules(mods);
      if (!selectedId && mods.length > 0) {
        setSelectedId(mods[0].module_id);
      }
    } catch (err) {
      pushToast("error", err.message || "Failed to load diagnostics");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDiagnostics();
  }, []);

  const selected = useMemo(() => modules.find((m) => m.module_id === selectedId) || null, [modules, selectedId]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <div className="flex items-center justify-between">
            <h3 className="card-title">Enabled Modules</h3>
            <button className="btn btn-xs btn-outline" onClick={loadDiagnostics} disabled={loading}>Refresh</button>
          </div>
          <div className="mt-3 space-y-2">
            {modules.length === 0 && <div className="text-sm opacity-60">No enabled modules</div>}
            {modules.map((mod) => (
              <ModuleRow key={mod.module_id} mod={mod} active={mod.module_id === selectedId} onClick={() => setSelectedId(mod.module_id)} />
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h3 className="card-title">Module Diagnostics</h3>
            {!selected && <div className="text-sm opacity-60">Select a module to view diagnostics.</div>}
            {selected && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div><span className="opacity-70">Module:</span> {selected.module_id}</div>
                  <div><span className="opacity-70">Version:</span> {selected.module_version || "—"}</div>
                  <div><span className="opacity-70">Manifest hash:</span> {selected.manifest_hash || "—"}</div>
                  <div><span className="opacity-70">Manifest version:</span> {selected.manifest_version || "—"}</div>
                  <div><span className="opacity-70">Has app home:</span> {selected.has_app_home ? "true" : "false"}</div>
                  <div><span className="opacity-70">Home target:</span> {selected.home_target || "—"}</div>
                  <div><span className="opacity-70">Pages:</span> {selected.counts?.pages ?? 0}</div>
                  <div><span className="opacity-70">Views:</span> {selected.counts?.views ?? 0}</div>
                  <div><span className="opacity-70">Entities:</span> {selected.counts?.entities ?? 0}</div>
                </div>
                <div>
                  <div className="text-sm font-semibold">Validation warnings</div>
                  <IssueList items={selected.warnings} />
                </div>
                <div>
                  <button className="btn btn-primary" onClick={() => navigate(`/apps/${selected.module_id}`)}>Open Home</button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h3 className="card-title">System</h3>
            <div className="text-sm opacity-70">No seed modules. All modules are created via Studio.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
