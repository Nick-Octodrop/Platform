import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch, getManifest } from "../api.js";
import TabbedPaneShell from "../ui/TabbedPaneShell.jsx";
import { getAppDisplayName, getAppTranslationNamespaces } from "../state/appCatalog.js";
import { useI18n } from "../i18n/LocalizationProvider.jsx";
import { ensureRuntimeNamespaces } from "../i18n/runtime.js";

function IssueList({ items, t }) {
  if (!Array.isArray(items) || items.length === 0) {
    return <div className="text-sm opacity-60">{t("settings.diagnostics.no_warnings")}</div>;
  }
  return (
    <div className="space-y-2">
      {items.map((item, idx) => (
        <div key={`${item?.code || "warn"}-${idx}`} className="text-xs border border-base-300 rounded-box p-2">
          <div>
            <span className="font-mono">{item?.code || t("settings.diagnostics.warning_code")}</span>
          </div>
          <div className="mt-1">{item?.message || t("settings.diagnostics.unknown_warning")}</div>
          {item?.path ? <div className="opacity-60 mt-1">{item.path}</div> : null}
        </div>
      ))}
    </div>
  );
}

export default function DiagnosticsModulePage() {
  const { t, locale, version } = useI18n();
  const { moduleId } = useParams();
  const navigate = useNavigate();
  const [modules, setModules] = useState([]);
  const [installedModules, setInstalledModules] = useState([]);
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
      setInstalledModules(installed);
      const nextNames = {};
      for (const mod of installed) {
        if (!mod?.module_id) continue;
        nextNames[mod.module_id] = getAppDisplayName(mod.module_id, mod);
      }
      setModuleNamesById(nextNames);
      setModules(Array.isArray(data.modules) ? data.modules : []);
    } catch (err) {
      setModules([]);
      setError(err?.message || t("settings.diagnostics.load_failed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDiagnostics();
  }, [locale]);

  useEffect(() => {
    const namespaces = getAppTranslationNamespaces(installedModules);
    if (namespaces.length === 0) return;
    ensureRuntimeNamespaces(namespaces).catch(() => {});
  }, [installedModules, locale]);

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
  }, [moduleId, version]);

  const selected = useMemo(
    () => (modules || []).find((m) => m.module_id === moduleId) || null,
    [modules, moduleId],
  );
  const moduleName = moduleNamesById[moduleId] || (selected ? getAppDisplayName(selected.module_id, { name: selected.module_id }) : moduleId);

  const tabs = useMemo(
    () => [
      { id: "overview", label: t("settings.diagnostics.overview") },
      { id: "warnings", label: t("settings.diagnostics.warnings") },
      { id: "manifest", label: t("settings.diagnostics.manifest") },
      { id: "entities", label: t("settings.diagnostics.entities") },
      { id: "views", label: t("settings.diagnostics.views") },
      { id: "workflows", label: t("settings.diagnostics.workflows") },
      { id: "raw", label: t("settings.diagnostics.raw") },
    ],
    [t],
  );

  const entities = Array.isArray(manifest?.entities) ? manifest.entities : [];
  const views = Array.isArray(manifest?.views) ? manifest.views : [];
  const workflows = Array.isArray(manifest?.workflows) ? manifest.workflows : [];

  return (
    <TabbedPaneShell
      title={moduleName || t("settings.diagnostics.title")}
      subtitle={moduleId ? `${t("settings.diagnostics.module")}: ${moduleId}` : t("settings.diagnostics.module_detail")}
      tabs={tabs}
      activeTabId={activeTab}
      onTabChange={setActiveTab}
      mobileOverflowActions={[
        {
          label: t("common.refresh"),
          onClick: loadDiagnostics,
          disabled: loading,
        },
        {
          label: t("common.back"),
          onClick: () => navigate("/settings/diagnostics"),
        },
      ]}
      rightActions={(
        <div className="flex items-center gap-2">
          <button className="btn btn-sm btn-ghost" type="button" onClick={loadDiagnostics} disabled={loading}>
            {t("common.refresh")}
          </button>
          <button className="btn btn-sm" type="button" onClick={() => navigate("/settings/diagnostics")}>
            {t("common.back")}
          </button>
        </div>
      )}
    >
      {error ? <div className="alert alert-error text-sm mb-4">{error}</div> : null}
      <div className="rounded-box border border-base-300 bg-base-100 overflow-hidden min-h-[22rem]">
        {loading ? (
          <div className="p-4 text-sm opacity-70">{t("common.loading")}</div>
        ) : !selected ? (
          <div className="p-4 text-sm opacity-60">{t("settings.diagnostics.module_not_found")}</div>
        ) : activeTab === "warnings" ? (
          <div className="p-4">
            <IssueList items={selected.warnings} t={t} />
          </div>
        ) : activeTab === "manifest" ? (
          <pre className="p-4 text-xs whitespace-pre-wrap">{manifestLoading ? t("common.loading") : JSON.stringify(manifest || {}, null, 2)}</pre>
        ) : activeTab === "entities" ? (
          <div className="p-4">
            {manifestLoading ? (
              <div className="text-sm opacity-70">{t("common.loading")}</div>
            ) : entities.length === 0 ? (
              <div className="text-sm opacity-60">{t("settings.diagnostics.no_entities")}</div>
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
              <div className="text-sm opacity-70">{t("common.loading")}</div>
            ) : views.length === 0 ? (
              <div className="text-sm opacity-60">{t("settings.diagnostics.no_views")}</div>
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
              <div className="text-sm opacity-70">{t("common.loading")}</div>
            ) : workflows.length === 0 ? (
              <div className="text-sm opacity-60">{t("settings.diagnostics.no_workflows")}</div>
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
              <div><span className="opacity-70">{t("settings.diagnostics.name")}:</span> {moduleName || "—"}</div>
              <div><span className="opacity-70">{t("settings.diagnostics.module")}:</span> {selected.module_id}</div>
              <div><span className="opacity-70">{t("settings.diagnostics.version")}:</span> {selected.module_version || "—"}</div>
              <div><span className="opacity-70">{t("settings.diagnostics.manifest_hash")}:</span> {selected.manifest_hash || "—"}</div>
              <div><span className="opacity-70">{t("settings.diagnostics.manifest_version")}:</span> {selected.manifest_version || "—"}</div>
              <div><span className="opacity-70">{t("settings.diagnostics.has_app_home")}:</span> {selected.has_app_home ? t("common.yes", {}, { defaultValue: "Yes" }) : t("common.no", {}, { defaultValue: "No" })}</div>
              <div><span className="opacity-70">{t("settings.diagnostics.home_target")}:</span> {selected.home_target || "—"}</div>
              <div><span className="opacity-70">{t("settings.diagnostics.pages")}:</span> {selected.counts?.pages ?? 0}</div>
              <div><span className="opacity-70">{t("settings.diagnostics.views")}:</span> {selected.counts?.views ?? 0}</div>
              <div><span className="opacity-70">{t("settings.diagnostics.entities")}:</span> {selected.counts?.entities ?? 0}</div>
              <div><span className="opacity-70">{t("settings.diagnostics.warnings")}:</span> {Array.isArray(selected.warnings) ? selected.warnings.length : 0}</div>
            </div>
            <div className="mt-4">
              <button
                className="btn btn-sm btn-primary"
                onClick={() => navigate(`/apps/${selected.module_id}`)}
              >
                {t("navigation.open_app", {}, { defaultValue: "Open App" })}
              </button>
            </div>
          </div>
        )}
      </div>
    </TabbedPaneShell>
  );
}
