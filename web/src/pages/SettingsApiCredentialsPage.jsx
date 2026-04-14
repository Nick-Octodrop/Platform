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
import { useI18n } from "../i18n/LocalizationProvider.jsx";

function CredentialModal({
  t,
  availableScopes,
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
        <h3 className="text-lg font-semibold">{t("settings.api_credentials.create_title")}</h3>
        <p className="mt-1 text-sm opacity-70">{t("settings.api_credentials.create_description")}</p>

        <div className="mt-5 space-y-4">
          <label className="form-control">
            <span className="label-text text-sm">{t("settings.api_credentials.name")}</span>
            <input
              className="input input-bordered"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("settings.api_credentials.name_placeholder")}
              disabled={saving}
            />
          </label>

          <label className="form-control">
            <span className="label-text text-sm">{t("settings.api_credentials.expires_in_days")}</span>
            <input
              className="input input-bordered"
              value={expiresInDays}
              onChange={(event) => setExpiresInDays(event.target.value)}
              placeholder={t("settings.api_credentials.no_expiry_placeholder")}
              disabled={saving}
            />
            <span className="label-text-alt mt-1 opacity-70">{t("settings.api_credentials.expires_help")}</span>
          </label>

          <div className="space-y-2">
            <div className="text-sm font-medium">{t("settings.api_credentials.scopes_title")}</div>
            <div className="space-y-2">
              {availableScopes.map((scope) => (
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
            {t("common.cancel")}
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={saving || !name.trim()}>
            {saving ? t("settings.api_credentials.creating") : t("settings.api_credentials.create_key")}
          </button>
        </div>
      </div>
    </div>
  );
}

function TokenModal({ t, token, onClose }) {
  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-2xl">
        <h3 className="text-lg font-semibold">{t("settings.api_credentials.copy_title")}</h3>
        <p className="mt-1 text-sm opacity-70">{t("settings.api_credentials.copy_description")}</p>
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
            {t("common.copy")}
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {t("common.done")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SettingsApiCredentialsPage() {
  const { t } = useI18n();
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

  const availableScopes = useMemo(
    () => [
      { id: "meta.read", label: t("settings.api_credentials.scopes.meta_read.label"), help: t("settings.api_credentials.scopes.meta_read.help") },
      { id: "records.read", label: t("settings.api_credentials.scopes.records_read.label"), help: t("settings.api_credentials.scopes.records_read.help") },
      { id: "records.write", label: t("settings.api_credentials.scopes.records_write.label"), help: t("settings.api_credentials.scopes.records_write.help") },
      { id: "automations.read", label: t("settings.api_credentials.scopes.automations_read.label"), help: t("settings.api_credentials.scopes.automations_read.help") },
      { id: "automations.write", label: t("settings.api_credentials.scopes.automations_write.label"), help: t("settings.api_credentials.scopes.automations_write.help") },
    ],
    [t],
  );

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch("/settings/api-credentials");
      setItems(Array.isArray(response?.api_credentials) ? response.api_credentials : []);
    } catch (err) {
      setItems([]);
      setError(err?.message || t("settings.api_credentials.load_failed"));
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
      setError(err?.message || t("settings.api_credentials.create_failed"));
    } finally {
      setCreating(false);
    }
  }

  const rows = useMemo(
    () => (items || []).map((item) => ({
      id: item.id,
      name: item.name || t("settings.untitled"),
      status: item.status || "active",
      key_prefix: item.key_prefix || "—",
      scopes: Array.isArray(item.scopes) ? item.scopes.join(", ") : "",
      last_used_at: formatDateTime(item.last_used_at) || t("settings.api_credentials.never"),
      expires_at: formatDateTime(item.expires_at) || t("settings.api_credentials.no_expiry"),
    })),
    [items, t],
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
      pushToast("success", selectedActiveRows.length === 1 ? t("settings.api_credentials.revoked_one") : t("settings.api_credentials.revoked_many"));
      await load();
    } catch (err) {
      setError(err?.message || t("settings.api_credentials.revoke_failed"));
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
      pushToast("success", selectedIds.length === 1 ? t("settings.api_credentials.deleted_one") : t("settings.api_credentials.deleted_many"));
      await load();
    } catch (err) {
      setError(err?.message || t("settings.api_credentials.delete_failed"));
    } finally {
      setSaving(false);
    }
  }

  const listFieldIndex = useMemo(
    () => ({
      "cred.name": { id: "cred.name", label: t("settings.api_credentials.name") },
      "cred.status": { id: "cred.status", label: t("settings.api_credentials.status") },
      "cred.key_prefix": { id: "cred.key_prefix", label: t("settings.api_credentials.key_prefix") },
      "cred.scopes": { id: "cred.scopes", label: t("settings.api_credentials.scopes_title") },
      "cred.last_used_at": { id: "cred.last_used_at", label: t("settings.api_credentials.last_used") },
      "cred.expires_at": { id: "cred.expires_at", label: t("settings.api_credentials.expiry") },
    }),
    [t],
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
      { id: "all", label: t("common.all"), domain: null },
      { id: "active", label: t("common.active"), domain: { op: "eq", field: "cred.status", value: "active" } },
      { id: "revoked", label: t("common.revoked"), domain: { op: "eq", field: "cred.status", value: "revoked" } },
    ],
    [t],
  );

  const activeFilter = useMemo(() => filters.find((filter) => filter.id === statusFilter) || null, [filters, statusFilter]);

  return (
    <div className="min-h-full md:h-full md:min-h-0 md:flex md:flex-col md:overflow-hidden">
      <div className={DESKTOP_PAGE_SHELL}>
        <div className={DESKTOP_PAGE_SHELL_BODY}>
          <div className="space-y-4 md:mt-4 md:flex-1 md:min-h-0 md:overflow-auto md:overflow-x-hidden">
            {error ? <div className="alert alert-error text-sm mb-4">{error}</div> : null}
            <SystemListToolbar
              title={t("settings.api_credentials.title")}
              createTooltip={t("settings.api_credentials.create_key")}
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
                    <button className={SOFT_BUTTON_SM} type="button" tabIndex={0} aria-label={t("settings.selection_actions")}>
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                    <ul className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-56 z-[200]">
                      <li className="menu-title">
                        <span>{t("settings.selection")}</span>
                      </li>
                      {singleSelected ? (
                        <li>
                          <button onClick={() => navigate(`/settings/api-credentials/${singleSelected.id}`)}>
                            {t("settings.api_credentials.open_credential")}
                          </button>
                        </li>
                      ) : null}
                      {selectedActiveRows.length > 0 ? (
                        <li>
                          <button onClick={revokeSelectedCredentials} disabled={saving}>
                            {selectedActiveRows.length === 1
                              ? t("settings.api_credentials.revoke")
                              : t("settings.api_credentials.revoke_active_count", { count: selectedActiveRows.length })}
                          </button>
                        </li>
                      ) : null}
                      <li>
                        <button
                          className="text-error"
                          onClick={() => setShowDeleteModal(true)}
                          disabled={!allSelectedRevoked || saving}
                          title={allSelectedRevoked ? t("settings.api_credentials.delete_revoked_title") : t("settings.api_credentials.revoke_before_delete")}
                        >
                          {allSelectedRevoked
                            ? selectedIds.length === 1
                              ? t("common.delete")
                              : t("common.delete_count", { count: selectedIds.length })
                            : t("settings.api_credentials.delete_revoke_first")}
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
          t={t}
          availableScopes={availableScopes}
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
          t={t}
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
            <h3 className="font-semibold text-lg">
              {selectedIds.length > 1 ? t("settings.api_credentials.delete_title_many") : t("settings.api_credentials.delete_title_one")}
            </h3>
            <div className="mt-3 text-sm">{t("settings.api_credentials.delete_body", { count: selectedIds.length })}</div>
            {!allSelectedRevoked ? (
              <div className="alert alert-warning mt-4 text-sm">{t("settings.api_credentials.active_must_revoke")}</div>
            ) : null}
            <div className="modal-action">
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => !saving && setShowDeleteModal(false)} disabled={saving}>
                {t("common.cancel")}
              </button>
              <button className="btn btn-error btn-sm" type="button" onClick={deleteSelectedCredentials} disabled={saving || !allSelectedRevoked}>
                {saving ? t("common.deleting") : t("common.delete")}
              </button>
            </div>
          </div>
          <button className="modal-backdrop" type="button" onClick={() => !saving && setShowDeleteModal(false)}>
            {t("common.close")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
