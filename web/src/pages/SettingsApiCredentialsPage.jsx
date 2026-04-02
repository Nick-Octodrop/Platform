import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api.js";
import SystemListToolbar from "../ui/SystemListToolbar.jsx";
import ListViewRenderer from "../ui/ListViewRenderer.jsx";
import { formatDateTime } from "../utils/dateTime.js";

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
      <div className="bg-base-100 md:card md:rounded-[1.75rem] md:border md:border-base-300 md:shadow-sm md:h-full md:min-h-0 md:flex md:flex-col md:overflow-hidden">
        <div className="p-4 md:card-body md:flex md:flex-col md:min-h-0 md:overflow-hidden">
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
            />

            <div className="md:mt-4">
              {loading ? (
                <div className="text-sm opacity-70">Loading…</div>
              ) : rows.length === 0 ? (
                <div className="text-sm opacity-60">No API credentials yet.</div>
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
    </div>
  );
}
