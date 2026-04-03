import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api.js";
import SystemListToolbar from "../ui/SystemListToolbar.jsx";
import ListViewRenderer from "../ui/ListViewRenderer.jsx";
import { formatDateTime } from "../utils/dateTime.js";
import { DESKTOP_PAGE_SHELL, DESKTOP_PAGE_SHELL_BODY } from "../ui/pageShell.js";

function SubscriptionModal({
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
        <h3 className="text-lg font-semibold">Create Webhook Subscription</h3>
        <p className="mt-1 text-sm opacity-70">
          Subscribe an external endpoint to Octodrop events. Matching events are delivered asynchronously by workers.
        </p>

        <div className="mt-5 space-y-4">
          <label className="form-control">
            <span className="label-text text-sm">Name</span>
            <input className="input input-bordered" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
          </label>

          <label className="form-control">
            <span className="label-text text-sm">Target URL</span>
            <input
              className="input input-bordered"
              value={form.target_url}
              onChange={(e) => setForm((prev) => ({ ...prev, target_url: e.target.value }))}
              placeholder="https://example.com/octodrop/webhooks"
            />
          </label>

          <label className="form-control">
            <span className="label-text text-sm">Event Pattern</span>
            <input
              className="input input-bordered"
              value={form.event_pattern}
              onChange={(e) => setForm((prev) => ({ ...prev, event_pattern: e.target.value }))}
              placeholder="billing.* or record.updated"
            />
          </label>

          <label className="form-control">
            <span className="label-text text-sm">Signing Secret</span>
            <select className="select select-bordered" value={form.signing_secret_id} onChange={(e) => setForm((prev) => ({ ...prev, signing_secret_id: e.target.value }))}>
              <option value="">No signing secret</option>
              {(secrets || []).map((secret) => (
                <option key={secret.id} value={secret.id}>
                  {secret.name || secret.id}
                </option>
              ))}
            </select>
          </label>

          <label className="form-control">
            <span className="label-text text-sm">Extra Headers JSON</span>
            <textarea
              className="textarea textarea-bordered min-h-[8rem] font-mono text-xs"
              value={form.headers_json_text}
              onChange={(e) => setForm((prev) => ({ ...prev, headers_json_text: e.target.value }))}
            />
          </label>
        </div>

        <div className="modal-action">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={saving || !form.name.trim() || !form.target_url.trim() || !form.event_pattern.trim()}>
            {saving ? "Saving..." : "Create Subscription"}
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
      setError(err?.message || "Failed to load webhook subscriptions");
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
        throw new Error("Headers JSON must be valid JSON");
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
      setError(err?.message || "Failed to create webhook subscription");
    } finally {
      setSaving(false);
    }
  }

  const rows = useMemo(
    () => (items || []).map((item) => ({
      id: item.id,
      name: item.name || "Untitled",
      status: item.status || "active",
      event_pattern: item.event_pattern || "*",
      target_url: item.target_url || "—",
      last_delivered_at: formatDateTime(item.last_delivered_at) || "Never",
    })),
    [items],
  );

  const listFieldIndex = useMemo(
    () => ({
      "sub.name": { id: "sub.name", label: "Name" },
      "sub.status": { id: "sub.status", label: "Status" },
      "sub.event_pattern": { id: "sub.event_pattern", label: "Event Pattern" },
      "sub.target_url": { id: "sub.target_url", label: "Target URL" },
      "sub.last_delivered_at": { id: "sub.last_delivered_at", label: "Last Delivered" },
    }),
    [],
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
        "sub.status": row.status,
        "sub.event_pattern": row.event_pattern,
        "sub.target_url": row.target_url,
        "sub.last_delivered_at": row.last_delivered_at,
      },
    })),
    [rows],
  );

  const filters = useMemo(
    () => [
      { id: "all", label: "All", domain: null },
      { id: "active", label: "Active", domain: { op: "eq", field: "sub.status", value: "active" } },
      { id: "disabled", label: "Disabled", domain: { op: "eq", field: "sub.status", value: "disabled" } },
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
              title="Webhook Subscriptions"
              createTooltip="New webhook"
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
            />

            <div className="md:mt-4">
              {loading ? (
                <div className="text-sm opacity-70">Loading…</div>
              ) : rows.length === 0 ? (
                <div className="text-sm opacity-60">No webhook subscriptions yet.</div>
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
          form={createForm}
          setForm={setCreateForm}
          saving={saving}
          secrets={secrets}
          onCancel={() => setShowCreateModal(false)}
          onConfirm={createSubscription}
        />
      ) : null}
    </div>
  );
}
