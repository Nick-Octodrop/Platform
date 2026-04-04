import React, { useEffect, useMemo, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { apiFetch } from "../api.js";
import { useToast } from "../components/Toast.jsx";
import SystemListToolbar from "../ui/SystemListToolbar.jsx";
import ListViewRenderer from "../ui/ListViewRenderer.jsx";
import { formatDateTime } from "../utils/dateTime.js";
import { DESKTOP_PAGE_SHELL, DESKTOP_PAGE_SHELL_BODY } from "../ui/pageShell.js";
import { SOFT_BUTTON_SM } from "../components/buttonStyles.js";

function SecretModal({
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
            <span className="label-text text-sm">Name</span>
            <input
              className="input input-bordered"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Xero refresh token"
              disabled={saving}
            />
          </label>

          {showMetadata ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="form-control">
                <span className="label-text text-sm">Provider key</span>
                <input
                  className="input input-bordered"
                  value={providerKey}
                  onChange={(e) => setProviderKey(e.target.value)}
                  placeholder="xero"
                  disabled={saving}
                />
                <span className="label-text-alt opacity-70 mt-1">Optional. Useful once one workspace stores secrets for several providers.</span>
              </label>
              <label className="form-control">
                <span className="label-text text-sm">Secret key</span>
                <input
                  className="input input-bordered"
                  value={secretKey}
                  onChange={(e) => setSecretKey(e.target.value)}
                  placeholder="refresh_token"
                  disabled={saving}
                />
                <span className="label-text-alt opacity-70 mt-1">Optional slot name such as `api_token`, `client_secret`, or `signing_secret`.</span>
              </label>
            </div>
          ) : null}

          <label className="form-control">
            <span className="label-text text-sm">Secret value</span>
            <textarea
              className="textarea textarea-bordered min-h-[8rem]"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Enter secret value"
              disabled={saving}
            />
            <span className="label-text-alt opacity-70 mt-1">Secret values are encrypted and not shown again after save.</span>
          </label>
        </div>
        <div className="modal-action">
          <button className="btn btn-ghost" type="button" onClick={onCancel} disabled={saving}>
            Cancel
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
      setError(err?.message || "Failed to load secrets");
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
      pushToast("success", "Secret created.");
      await loadSecrets();
    } catch (err) {
      setError(err?.message || "Failed to create secret");
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
      pushToast("success", "Secret rotated.");
      await loadSecrets();
    } catch (err) {
      setError(err?.message || "Failed to rotate secret");
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
      pushToast("success", selectedIds.length === 1 ? "Secret deleted." : "Secrets deleted.");
      await loadSecrets();
    } catch (err) {
      setError(err?.message || "Failed to delete secret(s)");
    } finally {
      setDeleting(false);
    }
  }

  const listFieldIndex = useMemo(
    () => ({
      "secret.name": { id: "secret.name", label: "Name" },
      "secret.provider_key": { id: "secret.provider_key", label: "Provider" },
      "secret.secret_key": { id: "secret.secret_key", label: "Secret Key" },
      "secret.status": { id: "secret.status", label: "Status" },
      "secret.version": { id: "secret.version", label: "Version" },
      "secret.last_rotated_at": { id: "secret.last_rotated_at", label: "Last Rotated" },
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
          "secret.status": row.status,
          "secret.version": row.version,
          "secret.last_rotated_at": row.last_rotated_at ? formatDateTime(row.last_rotated_at, "—") : "—",
          "secret.updated_at": row.updated_at ? formatDateTime(row.updated_at, "—") : "—",
        },
      })),
    [rows],
  );

  return (
    <div className="min-h-full md:h-full md:min-h-0 md:flex md:flex-col md:overflow-hidden">
      <div className={DESKTOP_PAGE_SHELL}>
        <div className={DESKTOP_PAGE_SHELL_BODY}>
          <div className="space-y-4 md:mt-4 md:flex-1 md:min-h-0 md:overflow-auto md:overflow-x-hidden">
            {error ? <div className="alert alert-error text-sm">{error}</div> : null}

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
                          <button onClick={() => setShowRotateModal(true)}>
                            Rotate
                          </button>
                        </li>
                      ) : null}
                      <li>
                        <button className="text-error" onClick={() => setShowDeleteModal(true)}>
                          {selectedIds.length === 1 ? "Delete" : `Delete selected (${selectedIds.length})`}
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
          title="New Secret"
          confirmLabel="Create"
          busyLabel="Creating..."
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
          title={`Rotate ${singleSelected.name}`}
          confirmLabel="Rotate"
          busyLabel="Rotating..."
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
            <h3 className="font-semibold text-lg">Delete Secret{selectedIds.length > 1 ? "s" : ""}</h3>
            <div className="mt-3 text-sm">
              This will remove {selectedIds.length} secret{selectedIds.length > 1 ? "s" : ""}. Connections using these secrets will need to be relinked.
            </div>
            <div className="modal-action">
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => !deleting && setShowDeleteModal(false)} disabled={deleting}>
                Cancel
              </button>
              <button className="btn btn-error btn-sm" type="button" onClick={deleteSelectedSecrets} disabled={deleting}>
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
