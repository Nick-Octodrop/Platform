import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api.js";
import { useI18n } from "../i18n/LocalizationProvider.jsx";
import SystemListToolbar from "../ui/SystemListToolbar.jsx";
import ListViewRenderer from "../ui/ListViewRenderer.jsx";
import { getAppDisplayName, getAppTranslationNamespaces } from "../state/appCatalog.js";
import { DESKTOP_PAGE_SHELL, DESKTOP_PAGE_SHELL_BODY } from "../ui/pageShell.js";
import { ensureRuntimeNamespaces } from "../i18n/runtime.js";

export default function DiagnosticsPage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [modules, setModules] = useState([]);
  const [installedModules, setInstalledModules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [moduleNamesById, setModuleNamesById] = useState({});
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState([]);
  const [page, setPage] = useState(0);
  const [totalItems, setTotalItems] = useState(0);

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
    if (!Array.isArray(installedModules) || installedModules.length === 0) return;
    const nextNames = {};
    for (const mod of installedModules) {
      if (!mod?.module_id) continue;
      nextNames[mod.module_id] = getAppDisplayName(mod.module_id, mod);
    }
    setModuleNamesById(nextNames);
  }, [installedModules, locale, t]);

  const rows = useMemo(
    () => (modules || []).map((m) => ({
      id: m.module_id,
      module_name: moduleNamesById[m.module_id] || getAppDisplayName(m.module_id, { name: m?.module_id }),
      module_id: m.module_id || "",
      module_version: m.module_version || "—",
      manifest_hash: m.manifest_hash || "",
      warnings_count: Array.isArray(m.warnings) ? m.warnings.length : 0,
      pages: m.counts?.pages ?? 0,
      views: m.counts?.views ?? 0,
      entities: m.counts?.entities ?? 0,
      health: Array.isArray(m.warnings) && m.warnings.length > 0 ? "warning" : "ok",
    })),
    [modules, moduleNamesById],
  );

  const listFieldIndex = useMemo(
    () => ({
      "diag.module_name": { id: "diag.module_name", label: t("settings.diagnostics.name") },
      "diag.module_id": { id: "diag.module_id", label: t("settings.diagnostics.module") },
      "diag.health": { id: "diag.health", label: t("settings.diagnostics.health") },
      "diag.warnings_count": { id: "diag.warnings_count", label: t("settings.diagnostics.warnings"), type: "number" },
      "diag.pages": { id: "diag.pages", label: t("settings.diagnostics.pages"), type: "number" },
      "diag.views": { id: "diag.views", label: t("settings.diagnostics.views"), type: "number" },
      "diag.entities": { id: "diag.entities", label: t("settings.diagnostics.entities"), type: "number" },
      "diag.module_version": { id: "diag.module_version", label: t("settings.diagnostics.version") },
      "diag.manifest_hash": { id: "diag.manifest_hash", label: t("settings.diagnostics.manifest_hash") },
    }),
    [t],
  );

  const listView = useMemo(
    () => ({
      id: "system.diagnostics.list",
      kind: "list",
      columns: [
        { field_id: "diag.module_name" },
        { field_id: "diag.module_id" },
        { field_id: "diag.health" },
        { field_id: "diag.warnings_count" },
        { field_id: "diag.pages" },
        { field_id: "diag.views" },
        { field_id: "diag.entities" },
      ],
    }),
    [],
  );

  const listRecords = useMemo(
    () => rows.map((row) => ({
      record_id: row.id,
      record: {
        "diag.module_name": row.module_name,
        "diag.module_id": row.module_id,
        "diag.health": row.health === "warning" ? t("settings.diagnostics.warning") : t("settings.diagnostics.ok"),
        "diag.warnings_count": row.warnings_count,
        "diag.pages": row.pages,
        "diag.views": row.views,
        "diag.entities": row.entities,
        "diag.module_version": row.module_version,
        "diag.manifest_hash": row.manifest_hash,
      },
    })),
    [rows, t],
  );

  const filters = useMemo(
    () => [
      { id: "all", label: t("common.all"), domain: null },
      { id: "ok", label: t("settings.diagnostics.healthy"), domain: { op: "eq", field: "diag.health", value: t("settings.diagnostics.ok") } },
      { id: "warning", label: t("settings.diagnostics.warnings"), domain: { op: "eq", field: "diag.health", value: t("settings.diagnostics.warning") } },
    ],
    [t],
  );

  const activeFilter = useMemo(() => filters.find((f) => f.id === statusFilter) || null, [filters, statusFilter]);

  return (
    <div className="min-h-full md:h-full md:min-h-0 md:flex md:flex-col md:overflow-hidden">
      <div className={DESKTOP_PAGE_SHELL}>
        <div className={DESKTOP_PAGE_SHELL_BODY}>
          <div className="space-y-4 md:mt-4 md:flex-1 md:min-h-0 md:overflow-auto md:overflow-x-hidden">
            {error ? <div className="alert alert-error text-sm mb-4">{error}</div> : null}
            <SystemListToolbar
              title={t("settings.diagnostics.title")}
              searchValue={search}
              onSearchChange={(v) => {
                setSearch(v);
                setPage(0);
              }}
              filters={filters}
              onFilterChange={(id) => {
                setStatusFilter(id);
                setPage(0);
              }}
              onClearFilters={() => {
                setStatusFilter("all");
                setPage(0);
              }}
              onRefresh={loadDiagnostics}
              showSavedViews={false}
              pagination={{
                page,
                pageSize: 25,
                totalItems,
                onPageChange: setPage,
              }}
            />

            <div className="md:mt-4">
              {loading ? (
                <div className="text-sm opacity-70">{t("common.loading")}</div>
              ) : (
                <ListViewRenderer
                  view={listView}
                  fieldIndex={listFieldIndex}
                  records={listRecords}
                  hideHeader
                  disableHorizontalScroll
                  tableClassName="w-full table-fixed min-w-0"
                  searchQuery={search}
                  searchFields={["diag.module_name", "diag.module_id", "diag.module_version", "diag.manifest_hash", "diag.health"]}
                  filters={filters}
                  activeFilter={activeFilter}
                  clientFilters={[]}
                  page={page}
                  pageSize={25}
                  onPageChange={setPage}
                  onTotalItemsChange={setTotalItems}
                  showPaginationControls={false}
                  emptyLabel={null}
                  selectedIds={selectedIds}
                  onToggleSelect={(id, checked) => {
                    if (!id) return;
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      if (checked) next.add(id);
                      else next.delete(id);
                      return Array.from(next);
                    });
                  }}
                  onToggleAll={(checked, allIds) => {
                    setSelectedIds(checked ? allIds || [] : []);
                  }}
                  onSelectRow={(row) => {
                    const id = row?.record_id;
                    if (id) navigate(`/settings/diagnostics/${encodeURIComponent(id)}`);
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
