import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api.js";
import { useToast } from "../components/Toast.jsx";
import ListViewRenderer from "../ui/ListViewRenderer.jsx";
import SystemListToolbar from "../ui/SystemListToolbar.jsx";
import { SOFT_BUTTON_SM } from "../components/buttonStyles.js";

export default function DocumentsPage() {
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [clientFilters, setClientFilters] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);

  async function load() {
    try {
      setLoading(true);
      const res = await apiFetch("/documents/templates");
      setItems(res.templates || []);
    } catch (err) {
      pushToast("error", err.message || "Failed to load templates");
    } finally {
      setLoading(false);
    }
  }

  async function createTemplate() {
    try {
      const payload = {
        name: "Untitled Document",
        html: "<p>Hello</p>",
        format: "html",
      };
      const res = await apiFetch("/documents/templates", { method: "POST", body: payload });
      setItems((prev) => [res.template, ...prev]);
      if (res?.template?.id) {
        navigate(`/documents/templates/${res.template.id}`);
      }
    } catch (err) {
      pushToast("error", err.message || "Failed to create template");
    }
  }

  const templateRows = useMemo(() => {
    return items.map((t) => ({
      id: t.id,
      name: t.name || t.id,
      format: t.format || "html",
      status: t.is_active === false ? "Inactive" : "Active",
      updated_at: t.updated_at || t.created_at || "—",
    }));
  }, [items]);

  const listFieldIndex = useMemo(
    () => ({
      "doc.name": { id: "doc.name", label: "Name" },
      "doc.format": { id: "doc.format", label: "Format" },
      "doc.status": { id: "doc.status", label: "Status" },
      "doc.updated_at": { id: "doc.updated_at", label: "Updated" },
      "doc.id": { id: "doc.id", label: "ID" },
    }),
    []
  );

  const listView = useMemo(
    () => ({
      id: "documents.templates.list",
      kind: "list",
      columns: [
        { field_id: "doc.name" },
        { field_id: "doc.format" },
        { field_id: "doc.status" },
        { field_id: "doc.updated_at" },
        { field_id: "doc.id", label: "ID" },
      ],
    }),
    []
  );

  const listRecords = useMemo(() => {
    return templateRows.map((row) => ({
      record_id: row.id,
      record: {
        "doc.name": row.name,
        "doc.format": row.format,
        "doc.status": row.status,
        "doc.updated_at": row.updated_at,
        "doc.id": row.id,
      },
    }));
  }, [templateRows]);

  const listFilters = useMemo(
    () => [
      { id: "all", label: "All", domain: null },
      { id: "active", label: "Active", domain: { op: "eq", field: "doc.status", value: "Active" } },
      { id: "inactive", label: "Inactive", domain: { op: "eq", field: "doc.status", value: "Inactive" } },
    ],
    []
  );

  const activeListFilter = useMemo(
    () => listFilters.find((flt) => flt.id === statusFilter) || null,
    [listFilters, statusFilter]
  );

  const filterableFields = useMemo(
    () => [
      { id: "doc.name", label: "Name" },
      { id: "doc.format", label: "Format" },
      { id: "doc.status", label: "Status" },
      { id: "doc.updated_at", label: "Updated" },
    ],
    []
  );

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <div className="card bg-base-100 shadow h-full min-h-0 flex flex-col overflow-hidden">
        <div className="card-body flex flex-col min-h-0">
          <div className="mt-4 flex-1 min-h-0 overflow-auto overflow-x-hidden">
            {loading ? (
              <div className="text-sm opacity-70">Loading…</div>
            ) : (
              <div className="flex flex-col gap-4 min-w-0">
                <SystemListToolbar
                  title="Document Templates"
                  createTooltip="New Template"
                  onCreate={createTemplate}
                  searchValue={search}
                  onSearchChange={setSearch}
                  filters={listFilters}
                  onFilterChange={setStatusFilter}
                  filterableFields={filterableFields}
                  onAddCustomFilter={(field, value) => {
                    if (!field?.id) return;
                    setClientFilters((prev) => [
                      ...prev,
                      { field_id: field.id, label: field.label || field.id, op: "contains", value },
                    ]);
                  }}
                  onClearFilters={() => {
                    setStatusFilter("all");
                    setClientFilters([]);
                  }}
                  onRefresh={load}
                  rightActions={
                    selectedIds.length === 1 ? (
                      <button
                        className={SOFT_BUTTON_SM}
                        onClick={() => navigate(`/documents/templates/${selectedIds[0]}`)}
                      >
                        Open
                      </button>
                    ) : null
                  }
                />

                <ListViewRenderer
                  view={listView}
                  fieldIndex={listFieldIndex}
                  records={listRecords}
                  hideHeader
                  disableHorizontalScroll
                  tableClassName="w-full table-fixed min-w-0"
                  searchQuery={search}
                  searchFields={["doc.name", "doc.format", "doc.id"]}
                  filters={listFilters}
                  activeFilter={activeListFilter}
                  clientFilters={clientFilters}
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
                    const id = row?.record_id || row?.record?.["doc.id"];
                    if (id) navigate(`/documents/templates/${id}`);
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
