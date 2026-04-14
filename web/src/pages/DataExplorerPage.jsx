import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiFetch, getManifest } from "../api";
import ListViewRenderer from "../ui/ListViewRenderer.jsx";
import { useModuleStore } from "../state/moduleStore.jsx";
import { loadEntityIndex } from "../data/entityIndex.js";
import { getDevMode, subscribeDevMode } from "../dev/devMode.js";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import { useAccessContext } from "../access.js";
import { useI18n } from "../i18n/LocalizationProvider.jsx";

export default function DataExplorerPage() {
  const { t, version } = useI18n();
  const { entity } = useParams();
  const navigate = useNavigate();
  const { modules } = useModuleStore();
  const [index, setIndex] = useState(null);
  const [entitySearch, setEntitySearch] = useState("");
  const [records, setRecords] = useState([]);
  const [viewList, setViewList] = useState(null);
  const [fieldIndex, setFieldIndex] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [manifestError, setManifestError] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [devMode, setDevMode] = useState(getDevMode());
  const [manifestHash, setManifestHash] = useState(null);
  const { hasCapability } = useAccessContext();
  const canWriteRecords = hasCapability("records.write");

  useEffect(() => {
    async function buildIndex() {
      const idx = await loadEntityIndex(modules);
      setIndex(idx);
    }
    buildIndex();
  }, [modules]);

  useEffect(() => {
    const handler = () => setDevMode(getDevMode());
    const unsubscribe = subscribeDevMode(handler);
    return unsubscribe;
  }, []);

  const selected = index?.byId?.[entity] || null;

  const moduleGroups = useMemo(() => {
    const groups = Object.values(index?.byModule || {});
    return groups.map((g) => {
      const entities = g.entities.filter((e) => {
        if (!entitySearch.trim()) return true;
        const q = entitySearch.toLowerCase();
        return e.displayName.toLowerCase().includes(q) || e.entityId.toLowerCase().includes(q);
      });
      return { ...g, entities };
    });
  }, [index, entitySearch]);

  useEffect(() => {
    async function loadRecords() {
      if (!selected) {
        setRecords([]);
        setViewList(null);
        setFieldIndex({});
        setError(null);
        setManifestError(null);
        return;
      }
      if (!selected.listViewId) {
        setRecords([]);
        setViewList(null);
        setFieldIndex({});
        setManifestError("NO_LIST_VIEW");
        return;
      }
      setLoading(true);
      try {
        const res = await apiFetch(`/records/${selected.entityId}`);
        setRecords(res.records || []);
        const manifestRes = await getManifest(selected.moduleId);
        setManifestHash(manifestRes.manifest_hash || null);
        const compiled = manifestRes.compiled;
        const view = compiled?.viewById?.get(selected.listViewId);
        const resolvedView = view || (manifestRes.manifest?.views || []).find((v) => v.id === selected.listViewId);
        setViewList(resolvedView);
        const fieldMap = compiled?.fieldByEntity?.get(selected.entityFullId);
        const indexMap = fieldMap ? Object.fromEntries(fieldMap) : {};
        if (!fieldMap) {
          const entityDef = (manifestRes.manifest?.entities || []).find((e) => e.id === selected.entityFullId);
          for (const f of entityDef?.fields || []) indexMap[f.id] = f;
        }
        setFieldIndex(indexMap);
        setError(null);
        if (!resolvedView) {
          setManifestError("LIST_VIEW_MISSING");
        } else {
          setManifestError(null);
        }
      } catch (err) {
        setError(err.message || t("settings.data_explorer.load_failed"));
      } finally {
        setLoading(false);
      }
    }
    loadRecords();
  }, [selected?.entityId, selected?.moduleId, selected?.listViewId, refreshTick, t, version]);

  const noEnabled = (index && Object.keys(index.byId || {}).length === 0);

  return (
    <div className="grid grid-cols-12 gap-6">
      <div className="col-span-12 lg:col-span-3">
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h3 className="card-title">{t("settings.data_explorer.entities")}</h3>
            <input
              className="input input-bordered w-full"
              placeholder={t("settings.data_explorer.search_entities")}
              value={entitySearch}
              onChange={(e) => setEntitySearch(e.target.value)}
            />
            <div className="mt-4 space-y-4">
              {moduleGroups.map((g) => (
                <div key={g.moduleId}>
                  <div className="text-xs uppercase opacity-60 mb-2">{g.moduleName}</div>
                  {g.entities.length === 0 && <div className="text-sm opacity-60">{t("settings.data_explorer.no_entities")}</div>}
                  {g.entities.map((e) => (
                    <button
                      key={e.entityId}
                      className={`btn btn-ghost justify-start w-full ${entity === e.entityId ? "bg-base-200" : ""}`}
                      onClick={() => navigate(`/data/${e.entityId}`)}
                    >
                      {e.displayName}
                    </button>
                  ))}
                </div>
              ))}
              {noEnabled && <div className="text-sm opacity-70">{t("settings.data_explorer.install_app_to_see_data")}</div>}
            </div>
          </div>
        </div>
      </div>

      <div className="col-span-12 lg:col-span-9">
        {!entity && (
          <div className="card bg-base-100 shadow">
            <div className="card-body">
              <h3 className="card-title">{t("settings.data_explorer.select_entity")}</h3>
              <div className="text-sm opacity-70">
                {noEnabled ? t("settings.data_explorer.install_app_to_see_data") : t("settings.data_explorer.choose_entity")}
              </div>
            </div>
          </div>
        )}
        {entity && !selected && (
          <div className="card bg-base-100 shadow">
            <div className="card-body">
              <h3 className="card-title">{t("common.entity_unavailable")}</h3>
              <div className="text-sm opacity-70">{t("settings.data_explorer.entity_unavailable_description")}</div>
            </div>
          </div>
        )}
            {selected && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-2xl font-semibold">{selected.displayName}</h2>
                <div className="text-xs opacity-60">{selected.moduleId}</div>
              </div>
              <div className="flex gap-2">
                {canWriteRecords ? <Link className="btn btn-primary" to={`/data/${selected.entityId}/new`}>{t("common.create")}</Link> : null}
                <button className="btn btn-outline" onClick={() => setRefreshTick((tick) => tick + 1)}>{t("common.refresh")}</button>
              </div>
            </div>
            {devMode && (
              <div className="card bg-base-100 shadow mb-4">
                <div className="card-body">
                  <h3 className="card-title">{t("settings.data_explorer.debug")}</h3>
                  <div className="text-sm opacity-70">{t("settings.data_explorer.entity_id")}: {selected.entityId}</div>
                  <div className="text-sm opacity-70">{t("settings.data_explorer.module_id")}: {selected.moduleId}</div>
                  <div className="text-sm opacity-70">{t("settings.data_explorer.list_view_id")}: {selected.listViewId || "—"}</div>
                  <div className="text-sm opacity-70">{t("settings.data_explorer.form_view_id")}: {selected.formViewId || "—"}</div>
                  <div className="text-sm opacity-70">{t("settings.data_explorer.manifest_hash")}: {manifestHash || "—"}</div>
                  <div className="flex gap-2 mt-2">
                    <Link className="btn btn-sm btn-ghost" to={`/apps/${selected.moduleId}`}>{t("settings.data_explorer.open_module")}</Link>
                    <Link className="btn btn-sm btn-ghost" to={`/settings/diagnostics/${encodeURIComponent(selected.moduleId)}`}>{t("common.open_diagnostics")}</Link>
                  </div>
                </div>
              </div>
            )}
            {(manifestError === "NO_LIST_VIEW" || manifestError === "LIST_VIEW_MISSING") && (
              <div className="card bg-base-100 shadow">
                <div className="card-body">
                  <h3 className="card-title">{t("common.missing_list_view")}</h3>
                  <div className="text-sm opacity-70">{t("settings.data_explorer.no_list_view_description")}</div>
                  <Link className="btn btn-ghost" to={`/settings/diagnostics/${encodeURIComponent(selected.moduleId)}`}>{t("common.open_diagnostics")}</Link>
                </div>
              </div>
            )}
            {error && <div className="alert alert-error mb-4">{error}</div>}
            {loading && <LoadingSpinner className="min-h-[20vh]" />}
            {viewList && (
              <ListViewRenderer
                view={viewList}
                fieldIndex={fieldIndex}
                records={records}
                onSelectRow={(row) => navigate(`/data/${selected.entityId}/${row.record_id}`)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
