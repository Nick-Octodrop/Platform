import React, { useEffect, useMemo, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api.js";
import { useToast } from "../components/Toast.jsx";
import SystemListToolbar from "../ui/SystemListToolbar.jsx";
import ListViewRenderer from "../ui/ListViewRenderer.jsx";
import { DESKTOP_PAGE_SHELL, DESKTOP_PAGE_SHELL_BODY } from "../ui/pageShell.js";
import { SOFT_BUTTON_SM } from "../components/buttonStyles.js";

export default function EmailConnectionsPage() {
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState([]);
  const [page, setPage] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
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

  async function deleteSelectedConnections() {
    if (!selectedIds.length || saving) return;
    setSaving(true);
    setError("");
    try {
      await Promise.all(selectedIds.map((id) => apiFetch(`/email/connections/${encodeURIComponent(id)}`, { method: "DELETE" })));
      setSelectedIds([]);
      setShowDeleteModal(false);
      pushToast("success", selectedIds.length === 1 ? "Email connection deleted." : "Email connections deleted.");
      await load();
    } catch (err) {
      setError(err?.message || "Failed to delete email connections");
    } finally {
      setSaving(false);
    }
  }

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
    <div className="min-h-full md:h-full md:min-h-0 md:flex md:flex-col md:overflow-hidden">
      <div className={DESKTOP_PAGE_SHELL}>
        <div className={DESKTOP_PAGE_SHELL_BODY}>
          <div className="space-y-4 md:mt-4 md:flex-1 md:min-h-0 md:overflow-auto md:overflow-x-hidden">
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
                          <button onClick={() => navigate(`/settings/email/connections/${selectedIds[0]}`)}>
                            Open connection
                          </button>
                        </li>
                      ) : null}
                      <li>
                        <button className="text-error" onClick={() => setShowDeleteModal(true)} disabled={saving}>
                          {selectedIds.length === 1 ? "Delete" : `Delete selected (${selectedIds.length})`}
                        </button>
                      </li>
                    </ul>
                  </div>
                ) : null
              }
            />

            <div className="md:mt-4">
              {loading ? (
                <div className="text-sm opacity-70">Loading…</div>
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
      {showDeleteModal ? (
        <div className="modal modal-open">
          <div className="modal-box max-w-md">
            <h3 className="font-semibold text-lg">Delete Email Connection{selectedIds.length > 1 ? "s" : ""}</h3>
            <div className="mt-3 text-sm">
              This will permanently remove {selectedIds.length} email connection{selectedIds.length > 1 ? "s" : ""}. This cannot be undone.
            </div>
            <div className="modal-action">
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={() => !saving && setShowDeleteModal(false)}
                disabled={saving}
              >
                Cancel
              </button>
              <button className="btn btn-error btn-sm" type="button" onClick={deleteSelectedConnections} disabled={saving}>
                {saving ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
          <button className="modal-backdrop" type="button" onClick={() => !saving && setShowDeleteModal(false)}>
            close
          </button>
        </div>
      ) : null}
    </div>
  );
}
