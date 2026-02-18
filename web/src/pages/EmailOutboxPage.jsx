import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api.js";
import ListViewRenderer from "../ui/ListViewRenderer.jsx";
import SystemListToolbar from "../ui/SystemListToolbar.jsx";

export default function EmailOutboxPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState([]);
  const [page, setPage] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const navigate = useNavigate();

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/email/outbox");
      setItems(res?.outbox || []);
    } catch (err) {
      setError(err?.message || "Failed to load outbox");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const rows = useMemo(
    () => (items || []).map((o) => ({
      id: o.id,
      subject: o.subject || "",
      status: o.status || "queued",
      to: Array.isArray(o.to) ? o.to.join(", ") : "",
      created_at: o.created_at || "",
      sent_at: o.sent_at || "",
      last_error: o.last_error || "",
    })),
    [items],
  );

  const listFieldIndex = useMemo(
    () => ({
      "outbox.subject": { id: "outbox.subject", label: "Subject" },
      "outbox.status": { id: "outbox.status", label: "Status" },
      "outbox.to": { id: "outbox.to", label: "To" },
      "outbox.created_at": { id: "outbox.created_at", label: "Created" },
    }),
    [],
  );

  const listView = useMemo(
    () => ({
      id: "system.email.outbox.list",
      kind: "list",
      columns: [
        { field_id: "outbox.subject" },
        { field_id: "outbox.status" },
        { field_id: "outbox.to" },
        { field_id: "outbox.created_at" },
      ],
    }),
    [],
  );

  const listRecords = useMemo(
    () => rows.map((row) => ({
      record_id: row.id,
      record: {
        "outbox.subject": row.subject,
        "outbox.status": row.status,
        "outbox.to": row.to,
        "outbox.created_at": row.sent_at || row.created_at || "",
      },
    })),
    [rows],
  );

  const filters = useMemo(
    () => [
      { id: "all", label: "All", domain: null },
      { id: "queued", label: "Queued", domain: { op: "eq", field: "outbox.status", value: "queued" } },
      { id: "sent", label: "Sent", domain: { op: "eq", field: "outbox.status", value: "sent" } },
      { id: "failed", label: "Failed", domain: { op: "eq", field: "outbox.status", value: "failed" } },
    ],
    [],
  );

  const activeFilter = useMemo(
    () => filters.find((f) => f.id === statusFilter) || null,
    [filters, statusFilter],
  );

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <div className="card bg-base-100 shadow h-full min-h-0 flex flex-col overflow-hidden">
        <div className="card-body flex flex-col min-h-0">
          <div className="mt-4 flex-1 min-h-0 overflow-auto overflow-x-hidden">
            {error && <div className="alert alert-error text-sm mb-4">{error}</div>}
            {loading ? (
              <div className="text-sm opacity-70">Loading…</div>
            ) : (
              <div className="flex flex-col gap-4 min-w-0">
                <SystemListToolbar
                  title="Email Outbox"
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
                  filterableFields={[]}
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

                {rows.length === 0 ? (
                  <div className="text-sm opacity-60">No emails yet.</div>
                ) : (
                  <ListViewRenderer
                    view={listView}
                    fieldIndex={listFieldIndex}
                    records={listRecords}
                    hideHeader
                    disableHorizontalScroll
                    tableClassName="w-full table-fixed min-w-0"
                    searchQuery={search}
                    searchFields={["outbox.subject", "outbox.to"]}
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
                      if (id) navigate(`/settings/email-outbox/${id}`);
                    }}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
