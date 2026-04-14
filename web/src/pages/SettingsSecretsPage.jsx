import React, { useEffect, useMemo, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { apiFetch } from "../api.js";
import { useToast } from "../components/Toast.jsx";
import { useI18n } from "../i18n/LocalizationProvider.jsx";
import SystemListToolbar from "../ui/SystemListToolbar.jsx";
import ListViewRenderer from "../ui/ListViewRenderer.jsx";
import { formatDateTime } from "../utils/dateTime.js";
import { DESKTOP_PAGE_SHELL, DESKTOP_PAGE_SHELL_BODY } from "../ui/pageShell.js";
import { SOFT_BUTTON_SM } from "../components/buttonStyles.js";

function SecretModal({
  t,
  title,
  confirmLabel,
  busyLabel,
  saving,
  onCancel,
  onConfirm,
  name,
  setName,
  providerKey,
  setProviderKey,
  secretKey,
  setSecretKey,
  value,
  setValue,
  showMetadata = true,
}) {
  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-xl">
        <h3 className="font-semibold text-lg">{title}</h3>
        <div className="mt-4 space-y-4">
          <label className="form-control">
            <span className="label-text text-sm">{t("settings.secrets.name")}</span>
            <input
              className="input input-bordered"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("settings.secrets.name_placeholder")}
              disabled={saving}
            />
          </label>

          {showMetadata ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="form-control">
                <span className="label-text text-sm">{t("settings.secrets.provider_key")}</span>
                <input
                  className="input input-bordered"
                  value={providerKey}
                  onChange={(e) => setProviderKey(e.target.value)}
                  placeholder={t("settings.secrets.provider_key_placeholder")}
                  disabled={saving}
                />
                <span className="label-text-alt opacity-70 mt-1">{t("settings.secrets.provider_key_help")}</span>
              </label>
              <label className="form-control">
                <span className="label-text text-sm">{t("settings.secrets.secret_key")}</span>
                <input
                  className="input input-bordered"
                  value={secretKey}
                  onChange={(e) => setSecretKey(e.target.value)}
                  placeholder={t("settings.secrets.secret_key_placeholder")}
                  disabled={saving}
                />
                <span className="label-text-alt opacity-70 mt-1">{t("settings.secrets.secret_key_help")}</span>
              </label>
            </div>
          ) : null}

          <label className="form-control">
            <span className="label-text text-sm">{t("settings.secrets.secret_value")}</span>
            <textarea
              className="textarea textarea-bordered min-h-[8rem]"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={t("settings.secrets.secret_value_placeholder")}
              disabled={saving}
            />
            <span className="label-text-alt opacity-70 mt-1">{t("settings.secrets.secret_value_help")}</span>
          </label>
        </div>
        <div className="modal-action">
          <button className="btn btn-ghost" type="button" onClick={onCancel} disabled={saving}>
            {t("common.cancel")}
          </button>
          <button className="btn btn-primary" type="button" onClick={onConfirm} disabled={saving || !value.trim()}>
            {saving ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SettingsSecretsPage() {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [page, setPage] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showRotateModal, setShowRotateModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState("");
  const [providerKey, setProviderKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [value, setValue] = useState("");
  const [rotateValue, setRotateValue] = useState("");

  async function loadSecrets() {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/settings/secrets");
      setItems(Array.isArray(res?.secrets) ? res.secrets : []);
    } catch (err) {
      setItems([]);
      setError(err?.message || t("settings.secrets.load_failed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSecrets();
  }, []);

  const rows = useMemo(
    () =>
      (items || []).map((s) => ({
        id: s.id,
        name: s.name || "—",
        provider_key: s.provider_key || "—",
        secret_key: s.secret_key || "—",
        status: s.status || "active",
        version: s.version || 1,
        last_rotated_at: s.last_rotated_at || "",
        created_at: s.created_at || "",
        updated_at: s.updated_at || "",
      })),
    [items],
  );

  const selectedRows = useMemo(() => {
    const byId = new Map(rows.map((row) => [row.id, row]));
    return selectedIds.map((id) => byId.get(id)).filter(Boolean);
  }, [rows, selectedIds]);
  const singleSelected = selectedRows.length === 1 ? selectedRows[0] : null;

  async function createSecret() {
    if (creating || !value.trim()) return;
    setCreating(true);
    setError("");
    try {
      await apiFetch("/settings/secrets", {
        method: "POST",
        body: {
          name: name.trim() || null,
          provider_key: providerKey.trim() || null,
          secret_key: secretKey.trim() || null,
          value,
        },
      });
      setShowCreateModal(false);
      setName("");
      setProviderKey("");
      setSecretKey("");
      setValue("");
      pushToast("success", t("settings.secrets.created"));
      await loadSecrets();
    } catch (err) {
      setError(err?.message || t("settings.secrets.create_failed"));
    } finally {
      setCreating(false);
    }
  }

  async function rotateSelectedSecret() {
    if (rotating || !singleSelected?.id || !rotateValue.trim()) return;
    setRotating(true);
    setError("");
    try {
      await apiFetch(`/settings/secrets/${encodeURIComponent(singleSelected.id)}/rotate`, {
        method: "POST",
        body: { value: rotateValue },
      });
      setRotateValue("");
      setShowRotateModal(false);
      pushToast("success", t("settings.secrets.rotated"));
      await loadSecrets();
    } catch (err) {
      setError(err?.message || t("settings.secrets.rotate_failed"));
    } finally {
      setRotating(false);
    }
  }

  async function deleteSelectedSecrets() {
    if (deleting || selectedIds.length === 0) return;
    setDeleting(true);
    setError("");
    try {
      await Promise.all(selectedIds.map((id) => apiFetch(`/settings/secrets/${encodeURIComponent(id)}`, { method: "DELETE" })));
      setShowDeleteModal(false);
      setSelectedIds([]);
      pushToast("success", selectedIds.length === 1 ? t("settings.secrets.deleted_one") : t("settings.secrets.deleted_many"));
      await loadSecrets();
    } catch (err) {
      setError(err?.message || t("settings.secrets.delete_failed"));
    } finally {
      setDeleting(false);
    }
  }

  const listFieldIndex = useMemo(
    () => ({
      "secret.name": { id: "secret.name", label: t("settings.secrets.name") },
      "secret.provider_key": { id: "secret.provider_key", label: t("settings.secrets.provider") },
      "secret.secret_key": { id: "secret.secret_key", label: t("settings.secrets.secret_key") },
      "secret.status": { id: "secret.status", label: t("settings.document_numbering.status") },
      "secret.version": { id: "secret.version", label: t("settings.secrets.version") },
      "secret.last_rotated_at": { id: "secret.last_rotated_at", label: t("settings.secrets.last_rotated") },
      "secret.updated_at": { id: "secret.updated_at", label: t("settings.secrets.updated") },
    }),
    [t],
  );

  const listView = useMemo(
    () => ({
      id: "system.settings.secrets.list",
      kind: "list",
      columns: [
        { field_id: "secret.name" },
        { field_id: "secret.provider_key" },
        { field_id: "secret.secret_key" },
        { field_id: "secret.status" },
        { field_id: "secret.version" },
        { field_id: "secret.last_rotated_at" },
        { field_id: "secret.updated_at" },
      ],
    }),
    [],
  );

  const listRecords = useMemo(
    () =>
      rows.map((row) => ({
        record_id: row.id,
        record: {
          "secret.name": row.name,
          "secret.provider_key": row.provider_key,
          "secret.secret_key": row.secret_key,
          "secret.status": row.status === "active" ? t("common.active") : row.status,
          "secret.version": row.version,
          "secret.last_rotated_at": row.last_rotated_at ? formatDateTime(row.last_rotated_at, "—") : "—",
          "secret.updated_at": row.updated_at ? formatDateTime(row.updated_at, "—") : "—",
        },
      })),
    [rows, t],
  );

  return (
    <div className="min-h-full md:h-full md:min-h-0 md:flex md:flex-col md:overflow-hidden">
      <div className={DESKTOP_PAGE_SHELL}>
        <div className={DESKTOP_PAGE_SHELL_BODY}>
          <div className="space-y-4 md:mt-4 md:flex-1 md:min-h-0 md:overflow-auto md:overflow-x-hidden">
            {error ? <div className="alert alert-error text-sm">{error}</div> : null}

            <SystemListToolbar
              title={t("settings.secrets.title")}
              createTooltip={t("settings.secrets.new_secret")}
              onCreate={() => setShowCreateModal(true)}
              searchValue={search}
              onSearchChange={(v) => {
                setSearch(v);
                setPage(0);
              }}
              filters={[]}
              onRefresh={loadSecrets}
              showSavedViews={false}
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
                          <button onClick={() => setShowRotateModal(true)}>
                            {t("settings.secrets.rotate")}
                          </button>
                        </li>
                      ) : null}
                      <li>
                        <button className="text-error" onClick={() => setShowDeleteModal(true)}>
                          {selectedIds.length === 1 ? t("common.delete") : t("settings.secrets.delete_selected", { count: selectedIds.length })}
                        </button>
                      </li>
                    </ul>
                  </div>
                ) : null
              }
              pagination={{
                page,
                pageSize: 25,
                totalItems,
                onPageChange: setPage,
              }}
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
                  searchFields={["secret.name", "secret.provider_key", "secret.secret_key"]}
                  filters={[]}
                  activeFilter={null}
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
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {showCreateModal ? (
        <SecretModal
          t={t}
          title={t("settings.secrets.new_secret")}
          confirmLabel={t("common.create")}
          busyLabel={t("settings.secrets.creating")}
          saving={creating}
          onCancel={() => !creating && setShowCreateModal(false)}
          onConfirm={createSecret}
          name={name}
          setName={setName}
          providerKey={providerKey}
          setProviderKey={setProviderKey}
          secretKey={secretKey}
          setSecretKey={setSecretKey}
          value={value}
          setValue={setValue}
          showMetadata
        />
      ) : null}

      {showRotateModal && singleSelected ? (
        <SecretModal
          t={t}
          title={t("settings.secrets.rotate_title", { name: singleSelected.name })}
          confirmLabel={t("settings.secrets.rotate")}
          busyLabel={t("settings.secrets.rotating")}
          saving={rotating}
          onCancel={() => !rotating && setShowRotateModal(false)}
          onConfirm={rotateSelectedSecret}
          name={singleSelected.name === "—" ? "" : singleSelected.name}
          setName={() => {}}
          providerKey={singleSelected.provider_key === "—" ? "" : singleSelected.provider_key}
          setProviderKey={() => {}}
          secretKey={singleSelected.secret_key === "—" ? "" : singleSelected.secret_key}
          setSecretKey={() => {}}
          value={rotateValue}
          setValue={setRotateValue}
          showMetadata={false}
        />
      ) : null}

      {showDeleteModal ? (
        <div className="modal modal-open">
          <div className="modal-box max-w-md">
            <h3 className="font-semibold text-lg">
              {selectedIds.length > 1 ? t("settings.secrets.delete_title_many") : t("settings.secrets.delete_title_one")}
            </h3>
            <div className="mt-3 text-sm">
              {t("settings.secrets.delete_body", { count: selectedIds.length })}
            </div>
            <div className="modal-action">
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => !deleting && setShowDeleteModal(false)} disabled={deleting}>
                {t("common.cancel")}
              </button>
              <button className="btn btn-error btn-sm" type="button" onClick={deleteSelectedSecrets} disabled={deleting}>
                {deleting ? t("common.deleting") : t("common.delete")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
