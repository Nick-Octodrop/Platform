import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useModuleStore } from "../state/moduleStore.jsx";
import { getManifest } from "../api";
import { useToast } from "../components/Toast.jsx";
import LoadingSpinner from "../components/LoadingSpinner.jsx";

export default function ModuleDetailPage({ user }) {
  const { moduleId } = useParams();
  const { modules, actions } = useModuleStore();
  const { pushToast } = useToast();
  const [manifest, setManifest] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");

  const module = modules.find((m) => m.module_id === moduleId);

  useEffect(() => {
    if (!user || !moduleId) return;
    setLoading(true);
    getManifest(moduleId)
      .then((res) => {
        setManifest(res.manifest);
        setError(null);
      })
      .catch((err) => setError(err.message || "Failed to load manifest"))
      .finally(() => setLoading(false));
  }, [user, moduleId]);

  async function toggleModule(enabled) {
    try {
      if (enabled) await actions.enableModule(moduleId);
      else await actions.disableModule(moduleId);
      await actions.refresh({ force: true });
      pushToast("success", enabled ? "Module enabled" : "Module disabled");
    } catch (err) {
      pushToast("error", err.message || "Action failed");
    }
  }

  if (!user) return <div className="alert">Please log in to view module details.</div>;
  if (!module) return <div className="alert">Module not installed.</div>;

  const views = manifest?.views || [];
  const entities = manifest?.entities || [];
  const workflows = manifest?.workflows || [];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-semibold">{module.module_id}</h2>
          <div className="text-sm opacity-70">{module.current_hash}</div>
        </div>
        <div className="flex gap-2">
          <button
            className={`btn ${module.enabled ? "btn-warning" : "btn-success"}`}
            onClick={() => toggleModule(!module.enabled)}
          >
            {module.enabled ? "Disable" : "Enable"}
          </button>
        </div>
      </div>
      <div role="tablist" className="tabs tabs-bordered mb-4">
        {["overview", "manifest", "entities", "views", "workflows", "audit"].map((t) => (
          <a
            key={t}
            role="tab"
            className={`tab ${activeTab === t ? "tab-active" : ""}`}
            onClick={() => setActiveTab(t)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </a>
        ))}
      </div>

      {loading && <LoadingSpinner className="min-h-[20vh]" />}
      {error && <div className="alert alert-error">{error}</div>}

      {!loading && !error && activeTab === "overview" && (
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <div>Status: {module.enabled ? "Enabled" : "Installed (disabled)"}</div>
            <div>Module id: {module.module_id}</div>
          </div>
        </div>
      )}

      {!loading && !error && activeTab === "manifest" && (
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(manifest, null, 2)}</pre>
          </div>
        </div>
      )}

      {!loading && !error && activeTab === "entities" && (
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            {entities.length === 0 && <div>No entities defined.</div>}
            {entities.map((e) => (
              <div key={e.id} className="mb-2">
                <div className="font-semibold">{e.id}</div>
                <div className="text-xs opacity-70">
                  {(e.fields || []).map((f) => f.id).join(", ")}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && !error && activeTab === "views" && (
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            {views.length === 0 && <div>No views defined.</div>}
            <ul className="list-disc ml-5">
              {views.map((v) => (
                <li key={v.id}>{v.id}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {!loading && !error && activeTab === "workflows" && (
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            {workflows.length === 0 && <div>No workflows defined.</div>}
            <ul className="list-disc ml-5">
              {workflows.map((w) => (
                <li key={w.id}>{w.id}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {!loading && !error && activeTab === "audit" && (
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <div>Audit coming soon.</div>
          </div>
        </div>
      )}

    </div>
  );
}
