import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api.js";
import SystemListToolbar from "../ui/SystemListToolbar.jsx";
import ListViewRenderer from "../ui/ListViewRenderer.jsx";

export default function SettingsSecretsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [page, setPage] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");

  async function loadSecrets() {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/settings/secrets");
      setItems(Array.isArray(res?.secrets) ? res.secrets : []);
    } catch (err) {
      setItems([]);
      setError(err?.message || "Failed to load secrets");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSecrets();
  }, []);

  async function createSecret() {
    if (creating || !value.trim()) return;
    setCreating(true);
    setError("");
    try {
      await apiFetch("/settings/secrets", {
        method: "POST",
        body: {
          name: name.trim() || null,
          value: value,
        },
      });
      setShowCreateModal(false);
      setName("");
      setValue("");
      await loadSecrets();
    } catch (err) {
      setError(err?.message || "Failed to create secret");
    } finally {
      setCreating(false);
    }
  }

  async function deleteSelectedSecrets() {
    if (deleting || selectedIds.length === 0) return;
    setDeleting(true);
    setError("");
    try {
      await Promise.all(
        selectedIds.map((id) => apiFetch(`/settings/secrets/${encodeURIComponent(id)}`, { method: "DELETE" })),
      );
      setShowDeleteModal(false);
      setSelectedIds([]);
      await loadSecrets();
    } catch (err) {
      setError(err?.message || "Failed to delete secret(s)");
    } finally {
      setDeleting(false);
    }
  }

  const rows = useMemo(
    () => (items || []).map((s) => ({
      id: s.id,
      name: s.name || "—",
      secret_id: s.id || "",
      created_at: s.created_at || "",
      updated_at: s.updated_at || "",
    })),
    [items],
  );

  const listFieldIndex = useMemo(
    () => ({
      "secret.name": { id: "secret.name", label: "Name" },
      "secret.secret_id": { id: "secret.secret_id", label: "Secret ID" },
      "secret.created_at": { id: "secret.created_at", label: "Created" },
      "secret.updated_at": { id: "secret.updated_at", label: "Updated" },
    }),
    [],
  );

  const listView = useMemo(
    () => ({
      id: "system.settings.secrets.list",
      kind: "list",
      columns: [
        { field_id: "secret.name" },
        { field_id: "secret.secret_id" },
        { field_id: "secret.created_at" },
        { field_id: "secret.updated_at" },
      ],
    }),
    [],
  );

  const listRecords = useMemo(
    () => rows.map((row) => ({
      record_id: row.id,
      record: {
        "secret.name": row.name,
        "secret.secret_id": row.secret_id,
        "secret.created_at": row.created_at,
        "secret.updated_at": row.updated_at,
      },
    })),
    [rows],
  );

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <div className="card bg-base-100 shadow h-full min-h-0 flex flex-col overflow-hidden">
        <div className="card-body flex flex-col min-h-0">
          <div className="mt-4 flex-1 min-h-0 overflow-auto overflow-x-hidden">
            {error ? <div className="alert alert-error text-sm mb-4">{error}</div> : null}
            <SystemListToolbar
              title="Secrets"
              createTooltip="New secret"
              onCreate={() => setShowCreateModal(true)}
              searchValue={search}
              onSearchChange={(v) => {
                setSearch(v);
                setPage(0);
              }}
              filters={[]}
              onRefresh={loadSecrets}
              showSavedViews={false}
              rightActions={(
                selectedIds.length > 0 ? (
                  <button
                    className="btn btn-sm btn-outline btn-error"
                    type="button"
                    onClick={() => setShowDeleteModal(true)}
                  >
                    Delete
                  </button>
                ) : null
              )}
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
                <div className="text-sm opacity-60">No secrets yet.</div>
              ) : (
                <ListViewRenderer
                  view={listView}
                  fieldIndex={listFieldIndex}
                  records={listRecords}
                  hideHeader
                  disableHorizontalScroll
                  tableClassName="w-full table-fixed min-w-0"
                  searchQuery={search}
                  searchFields={["secret.name", "secret.id"]}
                  filters={[]}
                  activeFilter={null}
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
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {showCreateModal ? (
        <div className="modal modal-open">
          <div className="modal-box max-w-lg">
            <h3 className="font-semibold text-lg">New Secret</h3>
            <div className="mt-4 grid grid-cols-1 gap-3">
              <label className="form-control">
                <span className="label-text text-sm">Name</span>
                <input
                  className="input input-bordered input-sm"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="SMTP Password"
                  disabled={creating}
                />
              </label>
              <label className="form-control">
                <span className="label-text text-sm">Secret Value</span>
                <textarea
                  className="textarea textarea-bordered textarea-sm min-h-[8rem]"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="Enter secret value"
                  disabled={creating}
                />
              </label>
              <div className="text-xs opacity-70">
                Secret values are encrypted and not shown after creation.
              </div>
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
                onClick={createSecret}
                disabled={creating || !value.trim()}
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
            <h3 className="font-semibold text-lg">Delete Secret{selectedIds.length > 1 ? "s" : ""}</h3>
            <div className="mt-3 text-sm">
              This will remove {selectedIds.length} secret{selectedIds.length > 1 ? "s" : ""}. This cannot be undone.
            </div>
            <div className="modal-action">
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={() => !deleting && setShowDeleteModal(false)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                className="btn btn-error btn-sm"
                type="button"
                onClick={deleteSelectedSecrets}
                disabled={deleting}
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
