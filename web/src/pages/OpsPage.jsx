import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api.js";
import { useToast } from "../components/Toast.jsx";
import ListViewRenderer from "../ui/ListViewRenderer.jsx";
import SystemListToolbar from "../ui/SystemListToolbar.jsx";

export default function OpsPage() {
  const { pushToast } = useToast();
  const [jobs, setJobs] = useState([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [clientFilters, setClientFilters] = useState([]);
  const [page, setPage] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const navigate = useNavigate();

  async function loadJobs() {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (status) params.append("status", status);
      const res = await apiFetch(`/ops/jobs?${params.toString()}`);
      setJobs(res.jobs || []);
    } catch (err) {
      setError(err?.message || "Failed to load jobs");
      pushToast("error", err?.message || "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadJobs();
  }, []);

  const rows = useMemo(
    () => (jobs || []).map((j) => ({
      id: j.id,
      type: j.type || "",
      status: j.status || "",
      attempt: j.attempt ?? 0,
      max_attempts: j.max_attempts ?? 0,
      run_at: j.run_at || "",
      created_at: j.created_at || "",
      updated_at: j.updated_at || "",
      last_error: j.last_error || "",
    })),
    [jobs],
  );

  const listFieldIndex = useMemo(
    () => ({
      "job.type": { id: "job.type", label: "Type" },
      "job.status": { id: "job.status", label: "Status" },
      "job.attempt": { id: "job.attempt", label: "Attempts" },
      "job.run_at": { id: "job.run_at", label: "Run At" },
    }),
    [],
  );

  const listView = useMemo(
    () => ({
      id: "system.ops.jobs.list",
      kind: "list",
      columns: [
        { field_id: "job.type" },
        { field_id: "job.status" },
        { field_id: "job.attempt" },
        { field_id: "job.run_at" },
      ],
    }),
    [],
  );

  const listRecords = useMemo(
    () => rows.map((row) => ({
      record_id: row.id,
      record: {
        "job.type": row.type,
        "job.status": row.status,
        "job.attempt": `${row.attempt}${row.max_attempts ? ` / ${row.max_attempts}` : ""}`,
        "job.run_at": row.run_at || row.created_at || "",
        "job.id": row.id,
        "job.last_error": row.last_error,
      },
    })),
    [rows],
  );

  const filters = useMemo(
    () => [
      { id: "all", label: "All", domain: null },
      { id: "queued", label: "Queued", domain: { op: "eq", field: "job.status", value: "queued" } },
      { id: "running", label: "Running", domain: { op: "eq", field: "job.status", value: "running" } },
      { id: "succeeded", label: "Succeeded", domain: { op: "eq", field: "job.status", value: "succeeded" } },
      { id: "failed", label: "Failed", domain: { op: "eq", field: "job.status", value: "failed" } },
      { id: "dead", label: "Dead", domain: { op: "eq", field: "job.status", value: "dead" } },
    ],
    [],
  );

  const statusFilter = useMemo(() => {
    if (!status) return filters.find((f) => f.id === "all") || null;
    return filters.find((f) => f.id === status) || null;
  }, [filters, status]);

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
                  title="Jobs / Ops"
                  searchValue={search}
                  onSearchChange={(v) => {
                    setSearch(v);
                    setPage(0);
                  }}
                  filters={filters}
                  onFilterChange={(id) => {
                    setStatus(id === "all" ? "" : id);
                    setPage(0);
                  }}
                  filterableFields={[
                    { id: "job.type", label: "Type" },
                    { id: "job.id", label: "Job ID" },
                  ]}
                  onAddCustomFilter={(field, value) => {
                    if (!field?.id) return;
                    setClientFilters((prev) => [
                      ...prev,
                      { field_id: field.id, label: field.label || field.id, op: "contains", value },
                    ]);
                    setPage(0);
                  }}
                  onClearFilters={() => {
                    setStatus("");
                    setClientFilters([]);
                    setPage(0);
                  }}
                  onRefresh={loadJobs}
                  showSavedViews={false}
                  pagination={{
                    page,
                    pageSize: 25,
                    totalItems,
                    onPageChange: setPage,
                  }}
                />

                {rows.length === 0 ? (
                  <div className="text-sm opacity-60">No jobs.</div>
                ) : (
                  <ListViewRenderer
                    view={listView}
                    fieldIndex={listFieldIndex}
                    records={listRecords}
                    hideHeader
                    disableHorizontalScroll
                    tableClassName="w-full table-fixed min-w-0"
                    searchQuery={search}
                    searchFields={["job.type", "job.id", "job.last_error"]}
                    filters={filters}
                    activeFilter={statusFilter}
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
                      if (id) navigate(`/ops/jobs/${id}`);
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
