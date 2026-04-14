import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MoreHorizontal } from "lucide-react";
import { apiFetch } from "../api.js";
import SystemListToolbar from "../ui/SystemListToolbar.jsx";
import ListViewRenderer from "../ui/ListViewRenderer.jsx";
import { DESKTOP_PAGE_SHELL, DESKTOP_PAGE_SHELL_BODY } from "../ui/pageShell.js";
import { SOFT_BUTTON_SM } from "../components/buttonStyles.js";
import AppSelect from "../components/AppSelect.jsx";
import { useI18n } from "../i18n/LocalizationProvider.jsx";

function providerKeyFromType(type) {
  const raw = String(type || "");
  if (!raw.startsWith("integration.")) return raw || "—";
  return raw.split(".", 2)[1] || "—";
}

function providerLabel(provider, t) {
  return provider?.name || provider?.key || t("settings.integrations.provider");
}

function providerDescription(provider, t) {
  const authType = provider?.auth_type ? t("settings.integrations.auth_value", { value: provider.auth_type }) : null;
  return [provider?.description, authType].filter(Boolean).join(" • ");
}

export default function IntegrationsPage() {
  const { t } = useI18n();
  const navigate = useNavigate();

  const [items, setItems] = useState([]);
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
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
      setError(err?.message || t("settings.integrations.load_failed"));
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
    const name = createForm.name.trim() || providerLabel(providerIndex.get(provider), t);
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
      setError(err?.message || t("settings.integrations.create_failed"));
    } finally {
      setCreating(false);
    }
  }

  async function deleteSelected() {
    if (!selectedIds.length || saving) return;
    const selectedConnections = (items || []).filter((item) => selectedIds.includes(item.id));
    if (selectedConnections.some((item) => item.status !== "disabled")) {
      setError(t("settings.integrations.disable_before_delete"));
      setShowDeleteModal(false);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await Promise.all(selectedIds.map((id) => apiFetch(`/integrations/connections/${encodeURIComponent(id)}`, { method: "DELETE" })));
      setSelectedIds([]);
      setShowDeleteModal(false);
      await load();
    } catch (err) {
      setError(err?.message || t("common.delete_failed"));
    } finally {
      setSaving(false);
    }
  }

  async function disableSelected() {
    if (!selectedIds.length || saving) return;
    setSaving(true);
    setError("");
    try {
      await Promise.all(
        selectedIds.map((id) =>
          apiFetch(`/integrations/connections/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: { status: "disabled" },
          }),
        ),
      );
      await load();
    } catch (err) {
      setError(err?.message || t("settings.integrations.disable_failed"));
    } finally {
      setSaving(false);
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
          status: c.status ? t(`common.${c.status}`, {}, { defaultValue: c.status }) : t("common.active"),
          health: c.health_status || "unknown",
          updated_at: c.updated_at || c.created_at || "",
          type: c.type || "",
        };
      }),
    [items, providerIndex, t],
  );

  const listFieldIndex = useMemo(
    () => ({
      "conn.name": { id: "conn.name", label: t("common.name") },
      "conn.provider": { id: "conn.provider", label: t("settings.integrations.provider") },
      "conn.status": { id: "conn.status", label: t("common.status") },
      "conn.health": { id: "conn.health", label: t("settings.integrations.health") },
      "conn.updated_at": { id: "conn.updated_at", label: t("common.updated") },
    }),
    [t],
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
      { id: "all", label: t("common.all"), domain: null },
      { id: "active", label: t("common.active"), domain: { op: "eq", field: "conn.status", value: "active" } },
      { id: "disabled", label: t("common.disabled"), domain: { op: "eq", field: "conn.status", value: "disabled" } },
      { id: "error", label: t("common.error"), domain: { op: "eq", field: "conn.health", value: "error" } },
    ],
    [t],
  );

  const activeFilter = useMemo(() => filters.find((f) => f.id === statusFilter) || null, [filters, statusFilter]);
  const selectedConnections = useMemo(
    () => (items || []).filter((item) => selectedIds.includes(item.id)),
    [items, selectedIds],
  );
  const allSelectedDisabled = selectedConnections.length > 0 && selectedConnections.every((item) => item.status === "disabled");
  const hasSelectedEnabled = selectedConnections.some((item) => item.status !== "disabled");

  return (
    <div className="min-h-full md:h-full md:min-h-0 md:flex md:flex-col md:overflow-hidden">
      <div className={DESKTOP_PAGE_SHELL}>
        <div className={DESKTOP_PAGE_SHELL_BODY}>
          <div className="md:mt-4 md:flex-1 md:min-h-0 md:overflow-auto md:overflow-x-hidden">
            {error ? <div className="alert alert-error text-sm mb-4">{error}</div> : null}
            <SystemListToolbar
              title={t("navigation.integrations")}
              createTooltip={t("settings.integrations.new_connection")}
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
              showListToggle={false}
              rightActions={
                selectedIds.length > 0 ? (
                  <div className="dropdown dropdown-end">
                    <button className={SOFT_BUTTON_SM} type="button" tabIndex={0} aria-label={t("settings.selection_actions")}>
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                    <ul className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-56 z-[200]">
                      <li className="menu-title">
                        <span>{t("settings.selection")}</span>
                      </li>
                      {selectedIds.length === 1 ? (
                        <li>
                          <button onClick={() => navigate(`/integrations/connections/${selectedIds[0]}`)}>
                            {t("settings.integrations.open_connection")}
                          </button>
                        </li>
                      ) : null}
                      {hasSelectedEnabled ? (
                        <li>
                          <button onClick={disableSelected} disabled={saving}>
                            {selectedIds.length === 1 ? t("settings.integrations.disable") : t("settings.integrations.disable_selected", { count: selectedIds.length })}
                          </button>
                        </li>
                      ) : null}
                      <li>
                        <button
                          className="text-error"
                          onClick={() => setShowDeleteModal(true)}
                          disabled={creating || saving || !allSelectedDisabled}
                          title={!allSelectedDisabled ? t("settings.integrations.disable_before_delete") : undefined}
                        >
                          {allSelectedDisabled
                            ? selectedIds.length === 1
                              ? t("common.delete")
                              : t("settings.integrations.delete_selected", { count: selectedIds.length })
                            : t("settings.integrations.delete_disable_first")}
                        </button>
                      </li>
                    </ul>
                  </div>
                ) : null
              }
            />

            <div className="mt-4">
              {loading ? (
                <div className="text-sm opacity-70">{t("common.loading")}</div>
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
                    const recordId = row?.record_id || row?.record?.id;
                    if (!recordId) return;
                    navigate(`/integrations/connections/${recordId}`);
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {showCreateModal ? (
        <div className="modal modal-open">
          <div className="modal-box max-w-xl">
            <h3 className="font-semibold text-lg">{t("settings.integrations.new_connection_title")}</h3>
            <div className="mt-4 space-y-4">
              <div className="rounded-box border border-base-300 bg-base-200/40 p-3 text-sm">
                <div className="font-medium">{t("settings.integrations.how_it_works_title")}</div>
                <div className="mt-1 opacity-75">
                  {t("settings.integrations.how_it_works_body")}
                </div>
              </div>

              <label className="form-control">
                <span className="label-text text-sm">{t("settings.integrations.provider")}</span>
                <AppSelect
                  className="select select-bordered"
                  value={createForm.provider}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, provider: e.target.value }))}
                  disabled={creating}
                >
                  {(providers || []).map((provider) => (
                    <option key={provider.key} value={provider.key}>
                      {providerLabel(provider, t)}
                    </option>
                  ))}
                </AppSelect>
              </label>

              {createProvider ? (
                <div className="space-y-3 rounded-box border border-base-300 bg-base-200/40 p-3 text-sm">
                  <div className="font-medium">{providerLabel(createProvider, t)}</div>
                  <div className="mt-1 opacity-75">{providerDescription(createProvider, t) || t("settings.integrations.no_provider_description")}</div>
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
                    <div className="rounded-box bg-base-200/60 px-3 py-2">
                      <div className="text-xs uppercase tracking-wide opacity-60">{t("settings.integrations.secrets_expected")}</div>
                      <div className="mt-1">{createProviderSecretKeys.length ? createProviderSecretKeys.join(", ") : t("settings.integrations.no_named_secrets")}</div>
                    </div>
                    <div className="rounded-box bg-base-200/60 px-3 py-2">
                      <div className="text-xs uppercase tracking-wide opacity-60">{t("settings.integrations.next_step")}</div>
                      <div className="mt-1">{t("settings.integrations.next_step_body")}</div>
                    </div>
                  </div>
                </div>
              ) : null}

              <label className="form-control">
                <span className="label-text text-sm">{t("settings.integrations.connection_name")}</span>
                <input
                  className="input input-bordered"
                  value={createForm.name}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder={createProvider ? providerLabel(createProvider, t) : t("settings.integrations.connection_name_placeholder")}
                  disabled={creating}
                />
              </label>
            </div>
            <div className="modal-action">
              <button className="btn btn-ghost" type="button" onClick={() => !creating && setShowCreateModal(false)} disabled={creating}>
                {t("common.cancel")}
              </button>
              <button className="btn btn-primary" type="button" onClick={createConnection} disabled={creating || !createForm.provider}>
                {t("common.create")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showDeleteModal ? (
        <div className="modal modal-open">
          <div className="modal-box max-w-md">
            <h3 className="text-lg font-semibold">{selectedIds.length > 1 ? t("settings.integrations.delete_title_many") : t("settings.integrations.delete_title_one")}</h3>
            <p className="mt-2 text-sm opacity-70">
              {t("settings.integrations.delete_body", { count: selectedIds.length })}
            </p>
            <div className="modal-action">
              <button className="btn btn-ghost" type="button" onClick={() => setShowDeleteModal(false)} disabled={saving}>
                {t("common.cancel")}
              </button>
              <button className="btn btn-error" type="button" onClick={deleteSelected} disabled={saving || !allSelectedDisabled}>
                {saving ? t("common.deleting") : t("common.delete")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
