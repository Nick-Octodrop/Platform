import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api.js";
import { useToast } from "../components/Toast.jsx";
import ListViewRenderer from "../ui/ListViewRenderer.jsx";
import SystemListToolbar from "../ui/SystemListToolbar.jsx";
import { SOFT_BUTTON_SM } from "../components/buttonStyles.js";

export default function EmailTemplatesPage() {
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

  async function load() {
    try {
      setLoading(true);
      const res = await apiFetch("/email/templates");
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
        subject: "New Template",
        name: "Untitled Template",
        body_html: "<p>Hello</p>",
      };
      const res = await apiFetch("/email/templates", { method: "POST", body: payload });
      setItems((prev) => [res.template, ...prev]);
      if (res?.template?.id) {
        navigate(`/email/templates/${res.template.id}`);
      }
    } catch (err) {
      pushToast("error", err.message || "Failed to create template");
    }
  }

  const templateRows = useMemo(() => {
    return items.map((t) => ({
      id: t.id,
      name: t.name || t.id,
      subject: t.subject || "",
      status: t.is_active === false ? "Inactive" : "Active",
      updated_at: t.updated_at || t.created_at || "—",
    }));
  }, [items]);

  const listFieldIndex = useMemo(
    () => ({
      "email.name": { id: "email.name", label: "Name" },
      "email.subject": { id: "email.subject", label: "Subject" },
      "email.status": { id: "email.status", label: "Status" },
      "email.updated_at": { id: "email.updated_at", label: "Updated" },
      "email.id": { id: "email.id", label: "ID" },
    }),
    []
  );

  const listView = useMemo(
    () => ({
      id: "email.templates.list",
      kind: "list",
      columns: [
        { field_id: "email.name" },
        { field_id: "email.subject" },
        { field_id: "email.status" },
        { field_id: "email.updated_at" },
        { field_id: "email.id", label: "ID" },
      ],
    }),
    []
  );

  const listRecords = useMemo(() => {
    return templateRows.map((row) => ({
      record_id: row.id,
      record: {
        "email.name": row.name,
        "email.subject": row.subject,
        "email.status": row.status,
        "email.updated_at": row.updated_at,
        "email.id": row.id,
      },
    }));
  }, [templateRows]);

  const listFilters = useMemo(
    () => [
      { id: "all", label: "All", domain: null },
      { id: "active", label: "Active", domain: { op: "eq", field: "email.status", value: "Active" } },
      { id: "inactive", label: "Inactive", domain: { op: "eq", field: "email.status", value: "Inactive" } },
    ],
    []
  );

  const activeListFilter = useMemo(
    () => listFilters.find((flt) => flt.id === statusFilter) || null,
    [listFilters, statusFilter]
  );

  const filterableFields = useMemo(
    () => [
      { id: "email.name", label: "Name" },
      { id: "email.subject", label: "Subject" },
      { id: "email.status", label: "Status" },
      { id: "email.updated_at", label: "Updated" },
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
                  title="Email Templates"
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
                  rightActions={
                    selectedIds.length === 1 ? (
                      <button
                        className={SOFT_BUTTON_SM}
                        onClick={() => navigate(`/email/templates/${selectedIds[0]}`)}
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
                  searchFields={["email.name", "email.subject", "email.id"]}
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
                    const id = row?.record_id || row?.record?.["email.id"];
                    if (id) navigate(`/email/templates/${id}`);
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
