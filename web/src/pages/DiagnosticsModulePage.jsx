import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch, getManifest } from "../api.js";
import TabbedPaneShell from "../ui/TabbedPaneShell.jsx";
import { getAppDisplayName } from "../state/appCatalog.js";

function IssueList({ items }) {
  if (!Array.isArray(items) || items.length === 0) {
    return <div className="text-sm opacity-60">No warnings.</div>;
  }
  return (
    <div className="space-y-2">
      {items.map((item, idx) => (
        <div key={`${item?.code || "warn"}-${idx}`} className="text-xs border border-base-300 rounded-box p-2">
          <div>
            <span className="font-mono">{item?.code || "WARNING"}</span>
          </div>
          <div className="mt-1">{item?.message || "Unknown warning"}</div>
          {item?.path ? <div className="opacity-60 mt-1">{item.path}</div> : null}
        </div>
      ))}
    </div>
  );
}

export default function DiagnosticsModulePage() {
  const { moduleId } = useParams();
  const navigate = useNavigate();
  const [modules, setModules] = useState([]);
  const [manifest, setManifest] = useState(null);
  const [loading, setLoading] = useState(false);
  const [manifestLoading, setManifestLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const [moduleNamesById, setModuleNamesById] = useState({});

  async function loadDiagnostics() {
    setLoading(true);
    setError("");
    try {
      const [diagRes, modulesRes] = await Promise.all([
        apiFetch("/debug/diagnostics"),
        apiFetch("/modules"),
      ]);
      const data = diagRes?.data || {};
      const installed = Array.isArray(modulesRes?.modules) ? modulesRes.modules : [];
      const nextNames = {};
      for (const mod of installed) {
        if (!mod?.module_id) continue;
        nextNames[mod.module_id] = getAppDisplayName(mod.module_id, mod);
      }
      setModuleNamesById(nextNames);
      setModules(Array.isArray(data.modules) ? data.modules : []);
    } catch (err) {
      setModules([]);
      setError(err?.message || "Failed to load diagnostics");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDiagnostics();
  }, []);

  useEffect(() => {
    let mounted = true;
    async function loadManifest() {
      if (!moduleId) return;
      setManifestLoading(true);
      try {
        const res = await getManifest(moduleId);
        if (!mounted) return;
        setManifest(res?.manifest || null);
      } catch {
        if (mounted) setManifest(null);
      } finally {
        if (mounted) setManifestLoading(false);
      }
    }
    loadManifest();
    return () => {
      mounted = false;
    };
  }, [moduleId]);

  const selected = useMemo(
    () => (modules || []).find((m) => m.module_id === moduleId) || null,
    [modules, moduleId],
  );
  const moduleName = moduleNamesById[moduleId] || (selected ? getAppDisplayName(selected.module_id, { name: selected.module_id }) : moduleId);

  const tabs = useMemo(
    () => [
      { id: "overview", label: "Overview" },
      { id: "warnings", label: "Warnings" },
      { id: "manifest", label: "Manifest" },
      { id: "entities", label: "Entities" },
      { id: "views", label: "Views" },
      { id: "workflows", label: "Workflows" },
      { id: "raw", label: "Raw" },
    ],
    [],
  );

  const entities = Array.isArray(manifest?.entities) ? manifest.entities : [];
  const views = Array.isArray(manifest?.views) ? manifest.views : [];
  const workflows = Array.isArray(manifest?.workflows) ? manifest.workflows : [];

  return (
    <TabbedPaneShell
      title={moduleName || "Diagnostics"}
      subtitle={moduleId ? `Module ID: ${moduleId}` : "Module diagnostics detail"}
      tabs={tabs}
      activeTabId={activeTab}
      onTabChange={setActiveTab}
      rightActions={(
        <div className="flex items-center gap-2">
          <button className="btn btn-sm btn-ghost" type="button" onClick={loadDiagnostics} disabled={loading}>
            Refresh
          </button>
          <button className="btn btn-sm" type="button" onClick={() => navigate("/settings/diagnostics")}>
            Back
          </button>
        </div>
      )}
    >
      {error ? <div className="alert alert-error text-sm mb-4">{error}</div> : null}
      <div className="rounded-box border border-base-300 bg-base-100 overflow-hidden min-h-[22rem]">
        {loading ? (
          <div className="p-4 text-sm opacity-70">Loading…</div>
        ) : !selected ? (
          <div className="p-4 text-sm opacity-60">Module not found in diagnostics.</div>
        ) : activeTab === "warnings" ? (
          <div className="p-4">
            <IssueList items={selected.warnings} />
          </div>
        ) : activeTab === "manifest" ? (
          <pre className="p-4 text-xs whitespace-pre-wrap">{manifestLoading ? "Loading…" : JSON.stringify(manifest || {}, null, 2)}</pre>
        ) : activeTab === "entities" ? (
          <div className="p-4">
            {manifestLoading ? (
              <div className="text-sm opacity-70">Loading…</div>
            ) : entities.length === 0 ? (
              <div className="text-sm opacity-60">No entities defined.</div>
            ) : (
              <div className="space-y-2">
                {entities.map((e) => (
                  <div key={e.id} className="text-sm">
                    <div className="font-semibold">{e.id}</div>
                    <div className="text-xs opacity-70">{Array.isArray(e.fields) ? e.fields.map((f) => f.id).join(", ") : ""}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : activeTab === "views" ? (
          <div className="p-4">
            {manifestLoading ? (
              <div className="text-sm opacity-70">Loading…</div>
            ) : views.length === 0 ? (
              <div className="text-sm opacity-60">No views defined.</div>
            ) : (
              <ul className="list-disc ml-5 text-sm">
                {views.map((v) => (
                  <li key={v.id}>{v.id}</li>
                ))}
              </ul>
            )}
          </div>
        ) : activeTab === "workflows" ? (
          <div className="p-4">
            {manifestLoading ? (
              <div className="text-sm opacity-70">Loading…</div>
            ) : workflows.length === 0 ? (
              <div className="text-sm opacity-60">No workflows defined.</div>
            ) : (
              <ul className="list-disc ml-5 text-sm">
                {workflows.map((w) => (
                  <li key={w.id}>{w.id}</li>
                ))}
              </ul>
            )}
          </div>
        ) : activeTab === "raw" ? (
          <pre className="p-4 text-xs whitespace-pre-wrap">{JSON.stringify(selected, null, 2)}</pre>
        ) : (
          <div className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div><span className="opacity-70">Module Name:</span> {moduleName || "—"}</div>
              <div><span className="opacity-70">Module ID:</span> {selected.module_id}</div>
              <div><span className="opacity-70">Version:</span> {selected.module_version || "—"}</div>
              <div><span className="opacity-70">Manifest hash:</span> {selected.manifest_hash || "—"}</div>
              <div><span className="opacity-70">Manifest version:</span> {selected.manifest_version || "—"}</div>
              <div><span className="opacity-70">Has app home:</span> {selected.has_app_home ? "true" : "false"}</div>
              <div><span className="opacity-70">Home target:</span> {selected.home_target || "—"}</div>
              <div><span className="opacity-70">Pages:</span> {selected.counts?.pages ?? 0}</div>
              <div><span className="opacity-70">Views:</span> {selected.counts?.views ?? 0}</div>
              <div><span className="opacity-70">Entities:</span> {selected.counts?.entities ?? 0}</div>
              <div><span className="opacity-70">Warnings:</span> {Array.isArray(selected.warnings) ? selected.warnings.length : 0}</div>
            </div>
            <div className="mt-4">
              <button
                className="btn btn-sm btn-primary"
                onClick={() => navigate(`/apps/${selected.module_id}`)}
              >
                Open App
              </button>
            </div>
          </div>
        )}
      </div>
    </TabbedPaneShell>
  );
}
