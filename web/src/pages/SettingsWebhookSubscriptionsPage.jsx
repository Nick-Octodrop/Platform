import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MoreHorizontal } from "lucide-react";
import { apiFetch } from "../api.js";
import AppSelect from "../components/AppSelect.jsx";
import { useI18n } from "../i18n/LocalizationProvider.jsx";
import SystemListToolbar from "../ui/SystemListToolbar.jsx";
import ListViewRenderer from "../ui/ListViewRenderer.jsx";
import { formatDateTime } from "../utils/dateTime.js";
import { DESKTOP_PAGE_SHELL, DESKTOP_PAGE_SHELL_BODY } from "../ui/pageShell.js";
import { SOFT_BUTTON_SM } from "../components/buttonStyles.js";

function SubscriptionModal({
  t,
  form,
  setForm,
  saving,
  secrets,
  onCancel,
  onConfirm,
}) {
  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-2xl">
        <h3 className="text-lg font-semibold">{t("settings.webhook_subscriptions.create_title")}</h3>
        <p className="mt-1 text-sm opacity-70">
          {t("settings.webhook_subscriptions.create_description")}
        </p>

        <div className="mt-5 space-y-4">
          <label className="form-control">
            <span className="label-text text-sm">{t("settings.webhook_subscriptions.name")}</span>
            <input className="input input-bordered" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
          </label>

          <label className="form-control">
            <span className="label-text text-sm">{t("settings.webhook_subscriptions.target_url")}</span>
            <input
              className="input input-bordered"
              value={form.target_url}
              onChange={(e) => setForm((prev) => ({ ...prev, target_url: e.target.value }))}
              placeholder={t("settings.webhook_subscriptions.target_url_placeholder")}
            />
          </label>

          <label className="form-control">
            <span className="label-text text-sm">{t("settings.webhook_subscriptions.event_pattern")}</span>
            <input
              className="input input-bordered"
              value={form.event_pattern}
              onChange={(e) => setForm((prev) => ({ ...prev, event_pattern: e.target.value }))}
              placeholder={t("settings.webhook_subscriptions.event_pattern_placeholder")}
            />
          </label>

          <label className="form-control">
            <span className="label-text text-sm">{t("settings.webhook_subscriptions.signing_secret")}</span>
            <AppSelect className="select select-bordered" value={form.signing_secret_id} onChange={(e) => setForm((prev) => ({ ...prev, signing_secret_id: e.target.value }))}>
              <option value="">{t("settings.webhook_subscriptions.no_signing_secret")}</option>
              {(secrets || []).map((secret) => (
                <option key={secret.id} value={secret.id}>
                  {secret.name || secret.id}
                </option>
              ))}
            </AppSelect>
          </label>

          <label className="form-control">
            <span className="label-text text-sm">{t("settings.webhook_subscriptions.extra_headers_json")}</span>
            <textarea
              className="textarea textarea-bordered min-h-[8rem] font-mono text-xs"
              value={form.headers_json_text}
              onChange={(e) => setForm((prev) => ({ ...prev, headers_json_text: e.target.value }))}
            />
          </label>
        </div>

        <div className="modal-action">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>
            {t("common.cancel")}
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={saving || !form.name.trim() || !form.target_url.trim() || !form.event_pattern.trim()}>
            {saving ? t("common.saving") : t("settings.webhook_subscriptions.create_action")}
          </button>
        </div>
      </div>
    </div>
  );
}

function emptyForm() {
  return {
    name: "",
    target_url: "",
    event_pattern: "*",
    signing_secret_id: "",
    headers_json_text: "{}",
  };
}

export default function SettingsWebhookSubscriptionsPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [secrets, setSecrets] = useState([]);
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
  const [createForm, setCreateForm] = useState(emptyForm());

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [subscriptionsRes, secretsRes] = await Promise.all([
        apiFetch("/settings/webhook-subscriptions"),
        apiFetch("/settings/secrets"),
      ]);
      setItems(Array.isArray(subscriptionsRes?.subscriptions) ? subscriptionsRes.subscriptions : []);
      setSecrets(Array.isArray(secretsRes?.secrets) ? secretsRes.secrets : []);
    } catch (err) {
      setItems([]);
      setSecrets([]);
      setError(err?.message || t("settings.webhook_subscriptions.load_failed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createSubscription() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      let headersJson = {};
      try {
        headersJson = JSON.parse(createForm.headers_json_text || "{}");
      } catch {
        throw new Error(t("settings.webhook_subscriptions.headers_json_invalid"));
      }
      const response = await apiFetch("/settings/webhook-subscriptions", {
        method: "POST",
        body: {
          name: createForm.name.trim(),
          target_url: createForm.target_url.trim(),
          event_pattern: createForm.event_pattern.trim(),
          signing_secret_id: createForm.signing_secret_id || null,
          headers_json: headersJson,
        },
      });
      setShowCreateModal(false);
      setCreateForm(emptyForm());
      await load();
      if (response?.subscription?.id) {
        navigate(`/settings/webhook-subscriptions/${response.subscription.id}`);
      }
    } catch (err) {
      setError(err?.message || t("settings.webhook_subscriptions.create_failed"));
    } finally {
      setSaving(false);
    }
  }

  async function deleteSelectedSubscriptions() {
    if (saving || selectedIds.length === 0) return;
    setSaving(true);
    setError("");
    try {
      await Promise.all(
        selectedIds.map((id) => apiFetch(`/settings/webhook-subscriptions/${encodeURIComponent(id)}`, { method: "DELETE" }))
      );
      setShowDeleteModal(false);
      setSelectedIds([]);
      await load();
    } catch (err) {
      setError(err?.message || t("settings.webhook_subscriptions.delete_failed"));
    } finally {
      setSaving(false);
    }
  }

  const rows = useMemo(
    () => (items || []).map((item) => ({
      id: item.id,
      name: item.name || t("settings.untitled"),
      status: item.status || "active",
      event_pattern: item.event_pattern || "*",
      target_url: item.target_url || "—",
      last_delivered_at: formatDateTime(item.last_delivered_at) || t("settings.webhook_subscriptions.never"),
    })),
    [items, t],
  );

  const listFieldIndex = useMemo(
    () => ({
      "sub.name": { id: "sub.name", label: t("settings.webhook_subscriptions.name") },
      "sub.status": { id: "sub.status", label: t("settings.document_numbering.status") },
      "sub.event_pattern": { id: "sub.event_pattern", label: t("settings.webhook_subscriptions.event_pattern") },
      "sub.target_url": { id: "sub.target_url", label: t("settings.webhook_subscriptions.target_url") },
      "sub.last_delivered_at": { id: "sub.last_delivered_at", label: t("settings.webhook_subscriptions.last_delivered") },
    }),
    [t],
  );

  const listView = useMemo(
    () => ({
      id: "system.settings.webhook_subscriptions.list",
      kind: "list",
      columns: [
        { field_id: "sub.name" },
        { field_id: "sub.status" },
        { field_id: "sub.event_pattern" },
        { field_id: "sub.target_url" },
        { field_id: "sub.last_delivered_at" },
      ],
    }),
    [],
  );

  const listRecords = useMemo(
    () => rows.map((row) => ({
      record_id: row.id,
      record: {
        "sub.name": row.name,
        "sub.status": row.status === "active" ? t("common.active") : t("settings.webhook_subscriptions.disabled"),
        "sub.event_pattern": row.event_pattern,
        "sub.target_url": row.target_url,
        "sub.last_delivered_at": row.last_delivered_at,
      },
    })),
    [rows, t],
  );

  const filters = useMemo(
    () => [
      { id: "all", label: t("common.all"), domain: null },
      { id: "active", label: t("common.active"), domain: { op: "eq", field: "sub.status", value: t("common.active") } },
      { id: "disabled", label: t("settings.webhook_subscriptions.disabled"), domain: { op: "eq", field: "sub.status", value: t("settings.webhook_subscriptions.disabled") } },
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
              title={t("settings.webhook_subscriptions.title")}
              createTooltip={t("settings.webhook_subscriptions.new_webhook")}
              onCreate={() => {
                setCreateForm(emptyForm());
                setShowCreateModal(true);
              }}
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
                      {selectedIds.length === 1 ? (
                        <li>
                          <button onClick={() => navigate(`/settings/webhook-subscriptions/${selectedIds[0]}`)}>
                            {t("settings.webhook_subscriptions.open_subscription")}
                          </button>
                        </li>
                      ) : null}
                      <li>
                        <button className="text-error" onClick={() => setShowDeleteModal(true)} disabled={saving}>
                          {selectedIds.length === 1 ? t("common.delete") : t("settings.webhook_subscriptions.delete_selected", { count: selectedIds.length })}
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
                  searchFields={["sub.name", "sub.event_pattern", "sub.target_url"]}
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
                    if (id) navigate(`/settings/webhook-subscriptions/${id}`);
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {showCreateModal ? (
        <SubscriptionModal
          t={t}
          form={createForm}
          setForm={setCreateForm}
          saving={saving}
          secrets={secrets}
          onCancel={() => setShowCreateModal(false)}
          onConfirm={createSubscription}
        />
      ) : null}

      {showDeleteModal ? (
        <div className="modal modal-open">
          <div className="modal-box max-w-md">
            <h3 className="text-lg font-semibold">
              {selectedIds.length > 1 ? t("settings.webhook_subscriptions.delete_title_many") : t("settings.webhook_subscriptions.delete_title_one")}
            </h3>
            <p className="mt-2 text-sm opacity-70">
              {t("settings.webhook_subscriptions.delete_body", { count: selectedIds.length })}
            </p>
            <div className="modal-action">
              <button type="button" className="btn btn-ghost" onClick={() => setShowDeleteModal(false)} disabled={saving}>
                {t("common.cancel")}
              </button>
              <button type="button" className="btn btn-error" onClick={deleteSelectedSubscriptions} disabled={saving}>
                {saving ? t("common.deleting") : t("common.delete")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
