import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api.js";
import SystemListToolbar from "../ui/SystemListToolbar.jsx";
import ListViewRenderer from "../ui/ListViewRenderer.jsx";

export default function EmailConnectionsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState([]);
  const [page, setPage] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    type: "smtp",
    name: "",
  });

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/email/connections");
      setItems(res?.connections || []);
    } catch (err) {
      setItems([]);
      setError(err?.message || "Failed to load email connections");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openCreateModal() {
    setCreateForm({
      type: "smtp",
      name: "",
    });
    setShowCreateModal(true);
  }

  async function createConnection() {
    if (creating) return;
    const name = createForm.name.trim();
    if (!name) return;
    try {
      setCreating(true);
      const res = await apiFetch("/email/connections", {
        method: "POST",
        body: {
          name,
          status: "active",
          config: {
            port: 587,
            security: "starttls",
          },
        },
      });
      setShowCreateModal(false);
      const id = res?.connection?.id;
      if (id) navigate(`/settings/email/connections/${id}`);
      else await load();
    } catch (err) {
      setError(err?.message || "Failed to create connection");
    } finally {
      setCreating(false);
    }
  }

  const rows = useMemo(
    () => (items || []).map((c) => ({
      id: c.id,
      name: c.name || c.id,
      status: c.status || "active",
      host: c?.config?.host || "",
      port: c?.config?.port || "",
      updated_at: c.updated_at || c.created_at || "",
      type: c.type || "smtp",
    })),
    [items],
  );

  const listFieldIndex = useMemo(
    () => ({
      "conn.name": { id: "conn.name", label: "Name" },
      "conn.status": { id: "conn.status", label: "Status" },
      "conn.host": { id: "conn.host", label: "SMTP Host" },
      "conn.port": { id: "conn.port", label: "Port" },
      "conn.updated_at": { id: "conn.updated_at", label: "Updated" },
      "conn.type": { id: "conn.type", label: "Type" },
    }),
    [],
  );

  const listView = useMemo(
    () => ({
      id: "system.email.connections.list",
      kind: "list",
      columns: [
        { field_id: "conn.name" },
        { field_id: "conn.status" },
        { field_id: "conn.host" },
        { field_id: "conn.port" },
        { field_id: "conn.updated_at" },
      ],
    }),
    [],
  );

  const listRecords = useMemo(
    () => rows.map((row) => ({
      record_id: row.id,
      record: {
        "conn.name": row.name,
        "conn.status": row.status,
        "conn.host": row.host,
        "conn.port": row.port,
        "conn.updated_at": row.updated_at,
        "conn.type": row.type,
      },
    })),
    [rows],
  );

  const filters = useMemo(
    () => [
      { id: "all", label: "All", domain: null },
      { id: "active", label: "Active", domain: { op: "eq", field: "conn.status", value: "active" } },
      { id: "disabled", label: "Disabled", domain: { op: "eq", field: "conn.status", value: "disabled" } },
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
              title="Email Connections"
              createTooltip="New connection"
              onCreate={openCreateModal}
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
              onRefresh={load}
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
                <div className="text-sm opacity-60">No email connections yet.</div>
              ) : (
                <ListViewRenderer
                  view={listView}
                  fieldIndex={listFieldIndex}
                  records={listRecords}
                  hideHeader
                  disableHorizontalScroll
                  tableClassName="w-full table-fixed min-w-0"
                  searchQuery={search}
                  searchFields={["conn.name", "conn.host", "conn.type"]}
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
                    if (id) navigate(`/settings/email/connections/${id}`);
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </div>
      {showCreateModal ? (
        <div className="modal modal-open">
          <div className="modal-box max-w-2xl">
            <h3 className="font-semibold text-lg">New Connection</h3>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="form-control">
                <span className="label-text text-sm">Connection Type</span>
                <select
                  className="select select-bordered select-sm"
                  value={createForm.type}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, type: e.target.value }))}
                  disabled={creating}
                >
                  <option value="smtp">SMTP</option>
                </select>
              </label>
              <label className="form-control">
                <span className="label-text text-sm">Name</span>
                <input
                  className="input input-bordered input-sm"
                  value={createForm.name}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Primary Email"
                  disabled={creating}
                />
              </label>
            </div>

            <div className="modal-action">
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={() => !creating && setShowCreateModal(false)}
                disabled={creating}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary btn-sm"
                type="button"
                onClick={createConnection}
                disabled={creating || !createForm.name.trim()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
