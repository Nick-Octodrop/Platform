import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api.js";
import SystemListToolbar from "../ui/SystemListToolbar.jsx";
import ListViewRenderer from "../ui/ListViewRenderer.jsx";
import { getAppDisplayName } from "../state/appCatalog.js";

export default function DiagnosticsPage() {
  const navigate = useNavigate();
  const [modules, setModules] = useState([]);
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
      "diag.module_name": { id: "diag.module_name", label: "Name" },
      "diag.module_id": { id: "diag.module_id", label: "Module" },
      "diag.health": { id: "diag.health", label: "Health" },
      "diag.warnings_count": { id: "diag.warnings_count", label: "Warnings", type: "number" },
      "diag.pages": { id: "diag.pages", label: "Pages", type: "number" },
      "diag.views": { id: "diag.views", label: "Views", type: "number" },
      "diag.entities": { id: "diag.entities", label: "Entities", type: "number" },
      "diag.module_version": { id: "diag.module_version", label: "Version" },
      "diag.manifest_hash": { id: "diag.manifest_hash", label: "Manifest Hash" },
    }),
    [],
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
        "diag.health": row.health,
        "diag.warnings_count": row.warnings_count,
        "diag.pages": row.pages,
        "diag.views": row.views,
        "diag.entities": row.entities,
        "diag.module_version": row.module_version,
        "diag.manifest_hash": row.manifest_hash,
      },
    })),
    [rows],
  );

  const filters = useMemo(
    () => [
      { id: "all", label: "All", domain: null },
      { id: "ok", label: "Healthy", domain: { op: "eq", field: "diag.health", value: "ok" } },
      { id: "warning", label: "Warnings", domain: { op: "eq", field: "diag.health", value: "warning" } },
    ],
    [],
  );

  const activeFilter = useMemo(() => filters.find((f) => f.id === statusFilter) || null, [filters, statusFilter]);

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <div className="card bg-base-100 shadow h-full min-h-0 flex flex-col overflow-hidden">
        <div className="card-body flex flex-col min-h-0">
          <div className="mt-4 flex-1 min-h-0 overflow-auto overflow-x-hidden">
            {error ? <div className="alert alert-error text-sm mb-4">{error}</div> : null}
            <SystemListToolbar
              title="Diagnostics"
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

            <div className="mt-4">
              {loading ? (
                <div className="text-sm opacity-70">Loading…</div>
              ) : rows.length === 0 ? (
                <div className="text-sm opacity-60">No modules found.</div>
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
