import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api.js";
import SystemListToolbar from "../ui/SystemListToolbar.jsx";
import ListViewRenderer from "../ui/ListViewRenderer.jsx";

export default function SettingsDocumentNumberingPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState([]);
  const [page, setPage] = useState(0);
  const [totalItems, setTotalItems] = useState(0);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch("/settings/document-numbering");
      setItems(Array.isArray(response?.sequences) ? response.sequences : []);
    } catch (err) {
      setItems([]);
      setError(err?.message || "Failed to load document numbering settings");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const rows = useMemo(
    () => (items || []).map((item) => ({
      id: item.id,
      name: item.name || item.code,
      code: item.code || "—",
      target_entity_id: item.target_entity_id || "—",
      assign_on: item.assign_on || "—",
      reset_policy: item.reset_policy || "—",
      assignment_count: Number(item.assignment_count || 0),
      next_value_preview: item.next_value_preview || item.preview_error || "Preview unavailable",
      status: item.is_active ? "active" : "inactive",
    })),
    [items],
  );

  const listFieldIndex = useMemo(
    () => ({
      "seq.name": { id: "seq.name", label: "Name" },
      "seq.code": { id: "seq.code", label: "Code" },
      "seq.target_entity_id": { id: "seq.target_entity_id", label: "Entity" },
      "seq.assign_on": { id: "seq.assign_on", label: "Assign On" },
      "seq.reset_policy": { id: "seq.reset_policy", label: "Reset" },
      "seq.assignment_count": { id: "seq.assignment_count", label: "Assigned", type: "number" },
      "seq.next_value_preview": { id: "seq.next_value_preview", label: "Preview" },
      "seq.status": { id: "seq.status", label: "Status" },
    }),
    [],
  );

  const listView = useMemo(
    () => ({
      id: "system.settings.document_numbering.list",
      kind: "list",
      columns: [
        { field_id: "seq.name" },
        { field_id: "seq.code" },
        { field_id: "seq.target_entity_id" },
        { field_id: "seq.assign_on" },
        { field_id: "seq.reset_policy" },
        { field_id: "seq.assignment_count" },
        { field_id: "seq.next_value_preview" },
      ],
    }),
    [],
  );

  const listRecords = useMemo(
    () => rows.map((row) => ({
      record_id: row.id,
      record: {
        "seq.name": row.name,
        "seq.code": row.code,
        "seq.target_entity_id": row.target_entity_id,
        "seq.assign_on": row.assign_on,
        "seq.reset_policy": row.reset_policy,
        "seq.assignment_count": row.assignment_count,
        "seq.next_value_preview": row.next_value_preview,
        "seq.status": row.status,
      },
    })),
    [rows],
  );

  const filters = useMemo(
    () => [
      { id: "all", label: "All", domain: null },
      { id: "active", label: "Active", domain: { op: "eq", field: "seq.status", value: "active" } },
      { id: "inactive", label: "Inactive", domain: { op: "eq", field: "seq.status", value: "inactive" } },
    ],
    [],
  );

  const activeFilter = useMemo(() => filters.find((filter) => filter.id === statusFilter) || null, [filters, statusFilter]);

  return (
    <div className="min-h-full md:h-full md:min-h-0 md:flex md:flex-col md:overflow-hidden">
      <div className="bg-base-100 md:card md:rounded-[1.75rem] md:border md:border-base-300 md:shadow-sm md:h-full md:min-h-0 md:flex md:flex-col md:overflow-hidden">
        <div className="p-4 md:card-body md:flex md:flex-col md:min-h-0 md:overflow-hidden">
          <div className="space-y-4 md:mt-4 md:flex-1 md:min-h-0 md:overflow-auto md:overflow-x-hidden">
            {error ? <div className="alert alert-error text-sm mb-4">{error}</div> : null}
            <SystemListToolbar
              title="Document Numbering"
              createTooltip="New sequence"
              onCreate={() => navigate("/settings/document-numbering/new")}
              searchValue={search}
              onSearchChange={(value) => {
                setSearch(value);
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
              onRefresh={load}
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
                <div className="text-sm opacity-70">Loading…</div>
              ) : rows.length === 0 ? (
                <div className="text-sm opacity-60">No numbering definitions yet.</div>
              ) : (
                <ListViewRenderer
                  view={listView}
                  fieldIndex={listFieldIndex}
                  records={listRecords}
                  hideHeader
                  disableHorizontalScroll
                  tableClassName="w-full table-fixed min-w-0"
                  searchQuery={search}
                  searchFields={["seq.name", "seq.code", "seq.target_entity_id", "seq.next_value_preview"]}
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
                    if (id) navigate(`/settings/document-numbering/${id}`);
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
