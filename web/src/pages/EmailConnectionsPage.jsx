import React, { useEffect, useMemo, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api.js";
import { useToast } from "../components/Toast.jsx";
import SystemListToolbar from "../ui/SystemListToolbar.jsx";
import ListViewRenderer from "../ui/ListViewRenderer.jsx";
import { DESKTOP_PAGE_SHELL, DESKTOP_PAGE_SHELL_BODY } from "../ui/pageShell.js";
import { SOFT_BUTTON_SM } from "../components/buttonStyles.js";
import AppSelect from "../components/AppSelect.jsx";
import { useI18n } from "../i18n/LocalizationProvider.jsx";

export default function EmailConnectionsPage() {
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const { t } = useI18n();
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
      setError(err?.message || t("settings.email_connections.load_failed"));
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
      pushToast("success", selectedIds.length === 1 ? t("settings.email_connections.deleted_one") : t("settings.email_connections.deleted_many"));
      await load();
    } catch (err) {
      setError(err?.message || t("settings.email_connections.delete_failed"));
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
      setError(err?.message || t("settings.email_connections.create_failed"));
    } finally {
      setCreating(false);
    }
  }

  const rows = useMemo(
    () => (items || []).map((c) => ({
      id: c.id,
      name: c.name || c.id,
      status: c.status === "disabled" ? t("common.disabled") : t("common.active"),
      host: c?.config?.host || "",
      port: c?.config?.port || "",
      updated_at: c.updated_at || c.created_at || "",
      type: c.type || "smtp",
    })),
    [items, t],
  );

  const listFieldIndex = useMemo(
    () => ({
      "conn.name": { id: "conn.name", label: t("common.name") },
      "conn.status": { id: "conn.status", label: t("common.status") },
      "conn.host": { id: "conn.host", label: t("settings.email_connections.smtp_host") },
      "conn.port": { id: "conn.port", label: t("common.port") },
      "conn.updated_at": { id: "conn.updated_at", label: t("common.updated") },
      "conn.type": { id: "conn.type", label: t("common.type") },
    }),
    [t],
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
      { id: "all", label: t("common.all"), domain: null },
      { id: "active", label: t("common.active"), domain: { op: "eq", field: "conn.status", value: t("common.active") } },
      { id: "disabled", label: t("common.disabled"), domain: { op: "eq", field: "conn.status", value: t("common.disabled") } },
    ],
    [t],
  );

  const activeFilter = useMemo(() => filters.find((f) => f.id === statusFilter) || null, [filters, statusFilter]);

  return (
    <div className="min-h-full md:h-full md:min-h-0 md:flex md:flex-col md:overflow-hidden">
      <div className={DESKTOP_PAGE_SHELL}>
        <div className={DESKTOP_PAGE_SHELL_BODY}>
          <div className="space-y-4 md:mt-4 md:flex-1 md:min-h-0 md:overflow-auto md:overflow-x-hidden">
            {error ? <div className="alert alert-error text-sm mb-4">{error}</div> : null}
            <SystemListToolbar
              title={t("settings.email_connections.title")}
              createTooltip={t("settings.email_connections.new_connection")}
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
                    <button className={SOFT_BUTTON_SM} type="button" tabIndex={0} aria-label={t("settings.selection_actions")}>
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                    <ul className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-56 z-[200]">
                      <li className="menu-title">
                        <span>{t("settings.selection")}</span>
                      </li>
                      {selectedIds.length === 1 ? (
                        <li>
                          <button onClick={() => navigate(`/settings/email/connections/${selectedIds[0]}`)}>
                            {t("settings.email_connections.open_connection")}
                          </button>
                        </li>
                      ) : null}
                      <li>
                        <button className="text-error" onClick={() => setShowDeleteModal(true)} disabled={saving}>
                          {selectedIds.length === 1 ? t("common.delete") : t("settings.email_connections.delete_selected", { count: selectedIds.length })}
                        </button>
                      </li>
                    </ul>
                  </div>
                ) : null
              }
            />

            <div className="md:mt-4">
              {loading ? (
                <div className="text-sm opacity-70">{t("common.loading")}</div>
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
            <h3 className="font-semibold text-lg">{t("settings.email_connections.new_connection_title")}</h3>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="form-control">
                <span className="label-text text-sm">{t("settings.email_connections.connection_type")}</span>
                <AppSelect
                  className="select select-bordered select-sm"
                  value={createForm.type}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, type: e.target.value }))}
                  disabled={creating}
                >
                  <option value="smtp">{t("settings.email_connections.type_smtp")}</option>
                </AppSelect>
              </label>
              <label className="form-control">
                <span className="label-text text-sm">{t("common.name")}</span>
                <input
                  className="input input-bordered input-sm"
                  value={createForm.name}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder={t("settings.email_connections.name_placeholder")}
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
                {t("common.cancel")}
              </button>
              <button
                className="btn btn-primary btn-sm"
                type="button"
                onClick={createConnection}
                disabled={creating || !createForm.name.trim()}
              >
                {t("common.create")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showDeleteModal ? (
        <div className="modal modal-open">
          <div className="modal-box max-w-md">
            <h3 className="font-semibold text-lg">
              {selectedIds.length === 1 ? t("settings.email_connections.delete_title_one") : t("settings.email_connections.delete_title_many")}
            </h3>
            <div className="mt-3 text-sm">
              {t("settings.email_connections.delete_body", { count: selectedIds.length })}
            </div>
            <div className="modal-action">
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={() => !saving && setShowDeleteModal(false)}
                disabled={saving}
              >
                {t("common.cancel")}
              </button>
              <button className="btn btn-error btn-sm" type="button" onClick={deleteSelectedConnections} disabled={saving}>
                {saving ? t("common.deleting") : t("common.delete")}
              </button>
            </div>
          </div>
          <button className="modal-backdrop" type="button" aria-label={t("common.close")} onClick={() => !saving && setShowDeleteModal(false)} />
        </div>
      ) : null}
    </div>
  );
}
