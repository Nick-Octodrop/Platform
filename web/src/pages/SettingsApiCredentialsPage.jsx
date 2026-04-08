import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MoreHorizontal } from "lucide-react";
import { apiFetch } from "../api.js";
import { useToast } from "../components/Toast.jsx";
import SystemListToolbar from "../ui/SystemListToolbar.jsx";
import ListViewRenderer from "../ui/ListViewRenderer.jsx";
import { formatDateTime } from "../utils/dateTime.js";
import { DESKTOP_PAGE_SHELL, DESKTOP_PAGE_SHELL_BODY } from "../ui/pageShell.js";
import { SOFT_BUTTON_SM } from "../components/buttonStyles.js";

const AVAILABLE_SCOPES = [
  { id: "meta.read", label: "Metadata Read", help: "List entities and field metadata." },
  { id: "records.read", label: "Records Read", help: "Read records through the external API." },
  { id: "records.write", label: "Records Write", help: "Create and update records through the external API." },
  { id: "automations.read", label: "Automations Read", help: "List published automations." },
  { id: "automations.write", label: "Automations Write", help: "Trigger published automations." },
];

function CredentialModal({
  name,
  setName,
  scopes,
  setScopes,
  expiresInDays,
  setExpiresInDays,
  saving,
  onCancel,
  onConfirm,
}) {
  function toggleScope(scopeId) {
    setScopes((current) => (current.includes(scopeId) ? current.filter((item) => item !== scopeId) : [...current, scopeId]));
  }

  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-2xl">
        <h3 className="text-lg font-semibold">Create API Credential</h3>
        <p className="mt-1 text-sm opacity-70">
          Create a scoped API key for a third-party system. The raw token is shown once after creation.
        </p>

        <div className="mt-5 space-y-4">
          <label className="form-control">
            <span className="label-text text-sm">Name</span>
            <input
              className="input input-bordered"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Shopify sync worker"
              disabled={saving}
            />
          </label>

          <label className="form-control">
            <span className="label-text text-sm">Expires In Days</span>
            <input
              className="input input-bordered"
              value={expiresInDays}
              onChange={(event) => setExpiresInDays(event.target.value)}
              placeholder="Leave blank for no expiry"
              disabled={saving}
            />
            <span className="label-text-alt mt-1 opacity-70">Optional. Use this for vendor keys or short-lived rollout credentials.</span>
          </label>

          <div className="space-y-2">
            <div className="text-sm font-medium">Scopes</div>
            <div className="space-y-2">
              {AVAILABLE_SCOPES.map((scope) => (
                <label key={scope.id} className="flex items-start gap-3 rounded-box border border-base-300 p-3">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm mt-0.5"
                    checked={scopes.includes(scope.id)}
                    onChange={() => toggleScope(scope.id)}
                    disabled={saving}
                  />
                  <div>
                    <div className="text-sm font-medium">{scope.label}</div>
                    <div className="text-xs opacity-70">{scope.help}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="modal-action">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={saving || !name.trim()}>
            {saving ? "Creating..." : "Create Key"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TokenModal({ token, onClose }) {
  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-2xl">
        <h3 className="text-lg font-semibold">Copy API Key Now</h3>
        <p className="mt-1 text-sm opacity-70">This is the only time the full token is shown. Store it now.</p>
        <textarea className="textarea textarea-bordered mt-4 min-h-[8rem] w-full font-mono text-sm" readOnly value={token} />
        <div className="modal-action">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(token);
              } catch {
                // ignore clipboard failures
              }
            }}
          >
            Copy
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SettingsApiCredentialsPage() {
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState([]);
  const [page, setPage] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState(["meta.read", "records.read"]);
  const [expiresInDays, setExpiresInDays] = useState("");
  const [createdToken, setCreatedToken] = useState("");
  const [createdCredentialId, setCreatedCredentialId] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch("/settings/api-credentials");
      setItems(Array.isArray(response?.api_credentials) ? response.api_credentials : []);
    } catch (err) {
      setItems([]);
      setError(err?.message || "Failed to load API credentials");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createCredential() {
    if (creating || !name.trim()) return;
    setCreating(true);
    setError("");
    try {
      const response = await apiFetch("/settings/api-credentials", {
        method: "POST",
        body: {
          name: name.trim(),
          scopes,
          expires_in_days: expiresInDays.trim() || null,
        },
      });
      setShowCreateModal(false);
      setName("");
      setScopes(["meta.read", "records.read"]);
      setExpiresInDays("");
      setCreatedToken(response?.token || "");
      setCreatedCredentialId(response?.api_credential?.id || "");
      await load();
    } catch (err) {
      setError(err?.message || "Failed to create API credential");
    } finally {
      setCreating(false);
    }
  }

  const rows = useMemo(
    () => (items || []).map((item) => ({
      id: item.id,
      name: item.name || "Untitled",
      status: item.status || "active",
      key_prefix: item.key_prefix || "—",
      scopes: Array.isArray(item.scopes) ? item.scopes.join(", ") : "",
      last_used_at: formatDateTime(item.last_used_at) || "Never",
      expires_at: formatDateTime(item.expires_at) || "No expiry",
    })),
    [items],
  );

  const selectedRows = useMemo(() => {
    const byId = new Map(rows.map((row) => [row.id, row]));
    return selectedIds.map((id) => byId.get(id)).filter(Boolean);
  }, [rows, selectedIds]);
  const singleSelected = selectedRows.length === 1 ? selectedRows[0] : null;
  const selectedActiveRows = selectedRows.filter((row) => row.status === "active");
  const allSelectedRevoked = selectedRows.length > 0 && selectedRows.every((row) => row.status === "revoked");

  async function revokeSelectedCredentials() {
    if (saving || selectedActiveRows.length === 0) return;
    setSaving(true);
    setError("");
    try {
      await Promise.all(selectedActiveRows.map((row) => apiFetch(`/settings/api-credentials/${encodeURIComponent(row.id)}/revoke`, { method: "POST" })));
      pushToast("success", selectedActiveRows.length === 1 ? "API credential revoked." : "API credentials revoked.");
      await load();
    } catch (err) {
      setError(err?.message || "Failed to revoke API credential(s)");
    } finally {
      setSaving(false);
    }
  }

  async function deleteSelectedCredentials() {
    if (saving || selectedIds.length === 0 || !allSelectedRevoked) return;
    setSaving(true);
    setError("");
    try {
      await Promise.all(selectedIds.map((id) => apiFetch(`/settings/api-credentials/${encodeURIComponent(id)}`, { method: "DELETE" })));
      setShowDeleteModal(false);
      setSelectedIds([]);
      pushToast("success", selectedIds.length === 1 ? "API credential deleted." : "API credentials deleted.");
      await load();
    } catch (err) {
      setError(err?.message || "Failed to delete API credential(s)");
    } finally {
      setSaving(false);
    }
  }

  const listFieldIndex = useMemo(
    () => ({
      "cred.name": { id: "cred.name", label: "Name" },
      "cred.status": { id: "cred.status", label: "Status" },
      "cred.key_prefix": { id: "cred.key_prefix", label: "Key Prefix" },
      "cred.scopes": { id: "cred.scopes", label: "Scopes" },
      "cred.last_used_at": { id: "cred.last_used_at", label: "Last Used" },
      "cred.expires_at": { id: "cred.expires_at", label: "Expiry" },
    }),
    [],
  );

  const listView = useMemo(
    () => ({
      id: "system.settings.api_credentials.list",
      kind: "list",
      columns: [
        { field_id: "cred.name" },
        { field_id: "cred.status" },
        { field_id: "cred.key_prefix" },
        { field_id: "cred.scopes" },
        { field_id: "cred.last_used_at" },
        { field_id: "cred.expires_at" },
      ],
    }),
    [],
  );

  const listRecords = useMemo(
    () => rows.map((row) => ({
      record_id: row.id,
      record: {
        "cred.name": row.name,
        "cred.status": row.status,
        "cred.key_prefix": row.key_prefix,
        "cred.scopes": row.scopes,
        "cred.last_used_at": row.last_used_at,
        "cred.expires_at": row.expires_at,
      },
    })),
    [rows],
  );

  const filters = useMemo(
    () => [
      { id: "all", label: "All", domain: null },
      { id: "active", label: "Active", domain: { op: "eq", field: "cred.status", value: "active" } },
      { id: "revoked", label: "Revoked", domain: { op: "eq", field: "cred.status", value: "revoked" } },
    ],
    [],
  );

  const activeFilter = useMemo(() => filters.find((filter) => filter.id === statusFilter) || null, [filters, statusFilter]);

  return (
    <div className="min-h-full md:h-full md:min-h-0 md:flex md:flex-col md:overflow-hidden">
      <div className={DESKTOP_PAGE_SHELL}>
        <div className={DESKTOP_PAGE_SHELL_BODY}>
          <div className="space-y-4 md:mt-4 md:flex-1 md:min-h-0 md:overflow-auto md:overflow-x-hidden">
            {error ? <div className="alert alert-error text-sm mb-4">{error}</div> : null}
            <SystemListToolbar
              title="API Credentials"
              createTooltip="Create API key"
              onCreate={() => setShowCreateModal(true)}
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
                      {singleSelected ? (
                        <li>
                          <button onClick={() => navigate(`/settings/api-credentials/${singleSelected.id}`)}>
                            Open credential
                          </button>
                        </li>
                      ) : null}
                      {selectedActiveRows.length > 0 ? (
                        <li>
                          <button onClick={revokeSelectedCredentials} disabled={saving}>
                            {selectedActiveRows.length === 1 ? "Revoke" : `Revoke active (${selectedActiveRows.length})`}
                          </button>
                        </li>
                      ) : null}
                      <li>
                        <button
                          className="text-error"
                          onClick={() => setShowDeleteModal(true)}
                          disabled={!allSelectedRevoked || saving}
                          title={allSelectedRevoked ? "Delete revoked credential(s)" : "Revoke credentials before deleting them"}
                        >
                          {allSelectedRevoked
                            ? selectedIds.length === 1 ? "Delete" : `Delete selected (${selectedIds.length})`
                            : "Delete (revoke first)"}
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
                  searchFields={["cred.name", "cred.key_prefix", "cred.scopes"]}
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
                    if (id) navigate(`/settings/api-credentials/${id}`);
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {showCreateModal ? (
        <CredentialModal
          name={name}
          setName={setName}
          scopes={scopes}
          setScopes={setScopes}
          expiresInDays={expiresInDays}
          setExpiresInDays={setExpiresInDays}
          saving={creating}
          onCancel={() => setShowCreateModal(false)}
          onConfirm={createCredential}
        />
      ) : null}

      {createdToken ? (
        <TokenModal
          token={createdToken}
          onClose={() => {
            setCreatedToken("");
            if (createdCredentialId) {
              navigate(`/settings/api-credentials/${createdCredentialId}`);
            }
          }}
        />
      ) : null}

      {showDeleteModal ? (
        <div className="modal modal-open">
          <div className="modal-box max-w-md">
            <h3 className="font-semibold text-lg">Delete API Credential{selectedIds.length > 1 ? "s" : ""}</h3>
            <div className="mt-3 text-sm">
              This will permanently remove {selectedIds.length} revoked API credential{selectedIds.length > 1 ? "s" : ""}. Request logs will remain for audit history.
            </div>
            {!allSelectedRevoked ? (
              <div className="alert alert-warning mt-4 text-sm">
                Active API credentials must be revoked before they can be deleted.
              </div>
            ) : null}
            <div className="modal-action">
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => !saving && setShowDeleteModal(false)} disabled={saving}>
                Cancel
              </button>
              <button className="btn btn-error btn-sm" type="button" onClick={deleteSelectedCredentials} disabled={saving || !allSelectedRevoked}>
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
