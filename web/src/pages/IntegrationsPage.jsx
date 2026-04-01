import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api.js";
import SystemListToolbar from "../ui/SystemListToolbar.jsx";
import ListViewRenderer from "../ui/ListViewRenderer.jsx";
import { DESKTOP_PAGE_SHELL, DESKTOP_PAGE_SHELL_BODY } from "../ui/pageShell.js";

function providerKeyFromType(type) {
  const raw = String(type || "");
  if (!raw.startsWith("integration.")) return raw || "—";
  return raw.split(".", 2)[1] || "—";
}

function providerLabel(provider) {
  return provider?.name || provider?.key || "Provider";
}

function providerDescription(provider) {
  const authType = provider?.auth_type ? `Auth: ${provider.auth_type}` : null;
  return [provider?.description, authType].filter(Boolean).join(" • ");
}

export default function IntegrationsPage() {
  const navigate = useNavigate();

  const [items, setItems] = useState([]);
  const [providers, setProviders] = useState([]);
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
    provider: "",
    name: "",
  });

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [connectionsRes, providersRes] = await Promise.all([
        apiFetch("/integrations/connections"),
        apiFetch("/integrations/providers"),
      ]);
      setItems(Array.isArray(connectionsRes?.connections) ? connectionsRes.connections : []);
      const providerItems = Array.isArray(providersRes?.providers) ? providersRes.providers : [];
      setProviders(providerItems);
      setCreateForm((prev) => ({
        provider: prev.provider || providerItems[0]?.key || "generic_rest",
        name: prev.name || "",
      }));
    } catch (err) {
      setItems([]);
      setProviders([]);
      setError(err?.message || "Failed to load integrations");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const providerIndex = useMemo(() => {
    const index = new Map();
    for (const provider of providers || []) {
      if (provider?.key) index.set(provider.key, provider);
    }
    return index;
  }, [providers]);

  const createProvider = providerIndex.get(createForm.provider) || null;
  const createProviderManifest = createProvider?.manifest_json || {};
  const createProviderCapabilities = Array.isArray(createProviderManifest?.capabilities) ? createProviderManifest.capabilities : [];
  const createProviderSecretKeys = Array.isArray(createProviderManifest?.secret_keys) ? createProviderManifest.secret_keys : [];

  function openCreateModal() {
    setCreateForm({
      provider: providers[0]?.key || "generic_rest",
      name: "",
    });
    setShowCreateModal(true);
  }

  async function createConnection() {
    if (creating) return;
    const provider = String(createForm.provider || "").trim().toLowerCase();
    const name = createForm.name.trim() || providerLabel(providerIndex.get(provider));
    if (!provider || !name) return;
    try {
      setCreating(true);
      const res = await apiFetch("/integrations/connections", {
        method: "POST",
        body: { provider, name, status: "active", config: {} },
      });
      setShowCreateModal(false);
      const id = res?.connection?.id;
      if (id) navigate(`/integrations/connections/${id}`);
      else await load();
    } catch (err) {
      setError(err?.message || "Failed to create connection");
    } finally {
      setCreating(false);
    }
  }

  async function removeConnection(id) {
    const ok = window.confirm("Delete this integration connection? This cannot be undone.");
    if (!ok) return;
    try {
      await apiFetch(`/integrations/connections/${encodeURIComponent(id)}`, { method: "DELETE" });
      setSelectedIds((prev) => prev.filter((itemId) => itemId !== id));
      await load();
    } catch (err) {
      setError(err?.message || "Delete failed");
    }
  }

  const rows = useMemo(
    () =>
      (items || []).map((c) => {
        const providerKey = providerKeyFromType(c.type);
        const provider = providerIndex.get(providerKey);
        return {
          id: c.id,
          name: c.name || c.id,
          provider: provider?.name || providerKey || "—",
          status: c.status || "active",
          health: c.health_status || "unknown",
          updated_at: c.updated_at || c.created_at || "",
          type: c.type || "",
        };
      }),
    [items, providerIndex],
  );

  const listFieldIndex = useMemo(
    () => ({
      "conn.name": { id: "conn.name", label: "Name" },
      "conn.provider": { id: "conn.provider", label: "Provider" },
      "conn.status": { id: "conn.status", label: "Status" },
      "conn.health": { id: "conn.health", label: "Health" },
      "conn.updated_at": { id: "conn.updated_at", label: "Updated" },
    }),
    [],
  );

  const listView = useMemo(
    () => ({
      id: "system.integrations.connections.list",
      kind: "list",
      columns: [
        { field_id: "conn.name" },
        { field_id: "conn.provider" },
        { field_id: "conn.status" },
        { field_id: "conn.health" },
        { field_id: "conn.updated_at" },
      ],
    }),
    [],
  );

  const listRecords = useMemo(
    () =>
      rows.map((row) => ({
        record_id: row.id,
        record: {
          "conn.name": row.name,
          "conn.provider": row.provider,
          "conn.status": row.status,
          "conn.health": row.health,
          "conn.updated_at": row.updated_at,
        },
      })),
    [rows],
  );

  const filters = useMemo(
    () => [
      { id: "all", label: "All", domain: null },
      { id: "active", label: "Active", domain: { op: "eq", field: "conn.status", value: "active" } },
      { id: "disabled", label: "Disabled", domain: { op: "eq", field: "conn.status", value: "disabled" } },
      { id: "error", label: "Errors", domain: { op: "eq", field: "conn.health", value: "error" } },
    ],
    [],
  );

  const activeFilter = useMemo(() => filters.find((f) => f.id === statusFilter) || null, [filters, statusFilter]);
  const selectedRows = useMemo(() => {
    const map = new Map(rows.map((row) => [row.id, row]));
    return selectedIds.map((id) => map.get(id)).filter(Boolean);
  }, [rows, selectedIds]);
  const singleSelected = selectedRows.length === 1 ? selectedRows[0] : null;

  return (
    <div className="min-h-full md:h-full md:min-h-0 md:flex md:flex-col md:overflow-hidden">
      <div className={DESKTOP_PAGE_SHELL}>
        <div className={DESKTOP_PAGE_SHELL_BODY}>
          <div className="md:mt-4 md:flex-1 md:min-h-0 md:overflow-auto md:overflow-x-hidden">
            {error ? <div className="alert alert-error text-sm mb-4">{error}</div> : null}
            <SystemListToolbar
              title="Integrations"
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
              rightActions={
                <>
                  {selectedIds.length === 1 && singleSelected ? (
                    <div className="flex items-center gap-2">
                      <button
                        className="btn btn-sm btn-outline"
                        type="button"
                        onClick={() => navigate(`/integrations/connections/${singleSelected.id}`)}
                      >
                        Open
                      </button>
                      <button
                        className="btn btn-sm btn-outline"
                        type="button"
                        onClick={() => removeConnection(singleSelected.id)}
                        disabled={singleSelected.status !== "disabled"}
                        title={singleSelected.status !== "disabled" ? "Disable the connection before deleting it" : undefined}
                      >
                        Delete
                      </button>
                    </div>
                  ) : null}
                </>
              }
              pagination={{
                page,
                pageSize: 25,
                totalItems,
                onPageChange: setPage,
              }}
              showListToggle={false}
            />

            <div className="mt-4">
              {loading ? (
                <div className="text-sm opacity-70">Loading…</div>
              ) : rows.length === 0 ? (
                <div className="space-y-2 text-sm opacity-70">
                  <div>No integrations yet.</div>
                  <div>Create a connection first, then configure secrets, webhooks, and test requests inside it.</div>
                </div>
              ) : (
                <ListViewRenderer
                  view={listView}
                  fieldIndex={listFieldIndex}
                  records={listRecords}
                  hideHeader
                  searchQuery={search}
                  searchFields={["conn.name", "conn.provider"]}
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
                  onToggleAll={(checked, allIds) => setSelectedIds(checked ? allIds || [] : [])}
                  onOpenRecord={(recordId) => navigate(`/integrations/connections/${recordId}`)}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {showCreateModal ? (
        <div className="modal modal-open">
          <div className="modal-box max-w-xl">
            <h3 className="font-semibold text-lg">New Integration Connection</h3>
            <div className="mt-4 space-y-4">
              <div className="rounded-box border border-base-300 bg-base-200/40 p-3 text-sm">
                <div className="font-medium">How this works</div>
                <div className="mt-1 opacity-75">
                  Choose the provider template first. After creation you will land on the connection page to fill setup fields, attach secrets, and run a connection test.
                </div>
              </div>

              <label className="form-control">
                <span className="label-text text-sm">Provider</span>
                <select
                  className="select select-bordered"
                  value={createForm.provider}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, provider: e.target.value }))}
                  disabled={creating}
                >
                  {(providers || []).map((provider) => (
                    <option key={provider.key} value={provider.key}>
                      {providerLabel(provider)}
                    </option>
                  ))}
                </select>
              </label>

              {createProvider ? (
                <div className="space-y-3 rounded-box border border-base-300 bg-base-200/40 p-3 text-sm">
                  <div className="font-medium">{providerLabel(createProvider)}</div>
                  <div className="mt-1 opacity-75">{providerDescription(createProvider) || "No provider description."}</div>
                  {createProviderCapabilities.length ? (
                    <div className="flex flex-wrap gap-2">
                      {createProviderCapabilities.map((capability) => (
                        <span key={capability} className="rounded-full border border-base-300 px-2 py-1 text-xs">
                          {capability}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="rounded-box bg-base-100 px-3 py-2">
                      <div className="text-xs uppercase tracking-wide opacity-60">Secrets expected</div>
                      <div className="mt-1">{createProviderSecretKeys.length ? createProviderSecretKeys.join(", ") : "No named secrets declared"}</div>
                    </div>
                    <div className="rounded-box bg-base-100 px-3 py-2">
                      <div className="text-xs uppercase tracking-wide opacity-60">Next step after create</div>
                      <div className="mt-1">Configure setup, attach secrets, then test the connection.</div>
                    </div>
                  </div>
                </div>
              ) : null}

              <label className="form-control">
                <span className="label-text text-sm">Connection Name</span>
                <input
                  className="input input-bordered"
                  value={createForm.name}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder={createProvider ? providerLabel(createProvider) : "Connection name"}
                  disabled={creating}
                />
              </label>
            </div>
            <div className="modal-action">
              <button className="btn btn-ghost" type="button" onClick={() => !creating && setShowCreateModal(false)} disabled={creating}>
                Cancel
              </button>
              <button className="btn btn-primary" type="button" onClick={createConnection} disabled={creating || !createForm.provider}>
                Create
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
