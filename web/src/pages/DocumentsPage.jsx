import React, { useEffect, useMemo, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api.js";
import { useToast } from "../components/Toast.jsx";
import ListViewRenderer from "../ui/ListViewRenderer.jsx";
import SystemListToolbar from "../ui/SystemListToolbar.jsx";
import { SOFT_BUTTON_SM } from "../components/buttonStyles.js";
import { buildSavedViewDomain } from "../utils/savedViews.js";
import { DESKTOP_PAGE_SHELL, DESKTOP_PAGE_SHELL_BODY } from "../ui/pageShell.js";

export default function DocumentsPage() {
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [clientFilters, setClientFilters] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [page, setPage] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const [selectionActionBusy, setSelectionActionBusy] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);

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

  async function deleteSelectedTemplates() {
    if (!selectedIds.length || selectionActionBusy) return;
    try {
      setSelectionActionBusy("delete");
      await Promise.all(selectedIds.map((id) => apiFetch(`/documents/templates/${id}`, { method: "DELETE" })));
      setSelectedIds([]);
      setShowDeleteModal(false);
      pushToast("success", selectedIds.length === 1 ? "Template deleted." : "Templates deleted.");
      await load();
    } catch (err) {
      const detail = err?.message || "Failed to delete templates";
      if (err?.status === 404 || err?.status === 405) {
        pushToast("error", `${detail}. If this endpoint was just added, restart the API server.`);
      } else {
        pushToast("error", detail);
      }
    } finally {
      setSelectionActionBusy("");
    }
  }

  const templateRows = useMemo(() => {
    return items.map((t) => ({
      id: t.id,
      name: t.name || t.id,
      description: t.description || "",
      status: t.is_active === false ? "Inactive" : "Active",
      updated_at: t.updated_at || t.created_at || "—",
    }));
  }, [items]);

  const listFieldIndex = useMemo(
    () => ({
      "doc.name": { id: "doc.name", label: "Name" },
      "doc.description": { id: "doc.description", label: "Description" },
      "doc.status": { id: "doc.status", label: "Status" },
      "doc.updated_at": { id: "doc.updated_at", label: "Updated" },
    }),
    []
  );

  const listView = useMemo(
    () => ({
      id: "documents.templates.list",
      kind: "list",
      columns: [
        { field_id: "doc.name" },
        { field_id: "doc.description" },
        { field_id: "doc.status" },
        { field_id: "doc.updated_at" },
      ],
    }),
    []
  );

  const listRecords = useMemo(() => {
    return templateRows.map((row) => ({
      record_id: row.id,
      record: {
        "doc.name": row.name,
        "doc.description": row.description,
        "doc.status": row.status,
        "doc.updated_at": row.updated_at,
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
  const savedViewDomain = useMemo(
    () => buildSavedViewDomain(activeListFilter, clientFilters),
    [activeListFilter, clientFilters]
  );

  const filterableFields = useMemo(
    () => [
      { id: "doc.name", label: "Name" },
      { id: "doc.description", label: "Description" },
      { id: "doc.status", label: "Status" },
      { id: "doc.updated_at", label: "Updated" },
    ],
    []
  );

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="min-h-full md:h-full md:min-h-0 md:flex md:flex-col md:overflow-hidden">
      <div className={DESKTOP_PAGE_SHELL}>
        <div className={DESKTOP_PAGE_SHELL_BODY}>
          <div className="space-y-4 md:mt-4 md:flex-1 md:min-h-0 md:overflow-auto md:overflow-x-hidden">
            {loading ? (
              <div className="text-sm opacity-70">Loading…</div>
            ) : (
              <div className="flex flex-col gap-4 min-w-0">
                <SystemListToolbar
                  title="Document Templates"
                  createTooltip="New Template"
                  onCreate={createTemplate}
                  searchValue={search}
                  onSearchChange={(v) => {
                    setSearch(v);
                    setPage(0);
                  }}
                  filters={listFilters}
                  onFilterChange={(id) => {
                    setStatusFilter(id);
                    setPage(0);
                  }}
                  filterableFields={filterableFields}
                  onAddCustomFilter={(field, value) => {
                    if (!field?.id) return;
                    setClientFilters((prev) => [
                      ...prev,
                      { field_id: field.id, label: field.label || field.id, op: "contains", value },
                    ]);
                    setPage(0);
                  }}
                  onClearFilters={() => {
                    setStatusFilter("all");
                    setClientFilters([]);
                    setPage(0);
                  }}
                  onRefresh={load}
                  pagination={{
                    page,
                    pageSize: 25,
                    totalItems,
                    onPageChange: setPage,
                  }}
                  savedViewsEntityId="system.documents.templates"
                  savedViewDomain={savedViewDomain}
                  savedViewState={{ search, filter: statusFilter, clientFilters }}
                  onApplySavedViewState={(state) => {
                    setSearch(state?.search || "");
                    setStatusFilter(state?.filter || "all");
                    setClientFilters(Array.isArray(state?.clientFilters) ? state.clientFilters : []);
                    setPage(0);
                  }}
                  rightActions={
                    selectedIds.length > 0 ? (
                      <div className="dropdown dropdown-end">
                        <button className={SOFT_BUTTON_SM} type="button" tabIndex={0} aria-label="Selection actions">
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                        <ul className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-56 z-[200]">
                          <li className="menu-title">
                            <span>Selection</span>
                          </li>
                          {selectedIds.length === 1 ? (
                            <li>
                              <button
                                type="button"
                                onClick={() => navigate(`/documents/templates/${selectedIds[0]}`)}
                              >
                                Open template
                              </button>
                            </li>
                          ) : null}
                          <li>
                            <button
                              type="button"
                              className="text-error"
                              onClick={() => setShowDeleteModal(true)}
                              disabled={selectionActionBusy === "delete"}
                            >
                              {selectedIds.length === 1 ? "Delete" : "Delete selected"}
                            </button>
                          </li>
                        </ul>
                      </div>
                    ) : null
                  }
                />

                <ListViewRenderer
                  view={listView}
                  fieldIndex={listFieldIndex}
                  records={listRecords}
                  hideHeader
                  searchQuery={search}
                  searchFields={["doc.name", "doc.description"]}
                  filters={listFilters}
                  activeFilter={activeListFilter}
                  clientFilters={clientFilters}
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
                    if (id) navigate(`/documents/templates/${id}`);
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
      {showDeleteModal && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-semibold text-lg">
              {selectedIds.length === 1 ? "Delete template?" : `Delete ${selectedIds.length} templates?`}
            </h3>
            <p className="py-3 text-sm opacity-70">
              This will permanently remove the selected document {selectedIds.length === 1 ? "template" : "templates"}.
            </p>
            <div className="modal-action">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowDeleteModal(false)}
                disabled={selectionActionBusy === "delete"}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-error btn-sm"
                onClick={deleteSelectedTemplates}
                disabled={selectionActionBusy === "delete"}
              >
                {selectionActionBusy === "delete" ? "Deleting..." : (selectedIds.length === 1 ? "Delete" : "Delete selected")}
              </button>
            </div>
          </div>
          <button
            type="button"
            className="modal-backdrop"
            aria-label="Close"
            onClick={() => {
              if (selectionActionBusy !== "delete") setShowDeleteModal(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
