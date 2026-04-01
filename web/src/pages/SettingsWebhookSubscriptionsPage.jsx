import React, { useEffect, useState } from "react";
import { apiFetch } from "../api.js";
import { formatDateTime } from "../utils/dateTime.js";

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
              placeholder="construction.* or record.updated"
            />
            <span className="label-text-alt opacity-70 mt-1">Use `*` for all events, or a prefix wildcard like `billing.*`.</span>
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
            <span className="label-text-alt opacity-70 mt-1">If set, deliveries include `X-Octo-Timestamp` and `X-Octo-Signature`.</span>
          </label>

          <label className="form-control">
            <span className="label-text text-sm">Extra Headers JSON</span>
            <textarea
              className="textarea textarea-bordered font-mono text-xs min-h-[8rem]"
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

export default function SettingsWebhookSubscriptionsPage() {
  const [items, setItems] = useState([]);
  const [secrets, setSecrets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [form, setForm] = useState({
    name: "",
    target_url: "",
    event_pattern: "*",
    signing_secret_id: "",
    headers_json_text: "{}",
  });

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
    setNotice("");
    try {
      let headersJson = {};
      try {
        headersJson = JSON.parse(form.headers_json_text || "{}");
      } catch {
        throw new Error("Headers JSON must be valid JSON");
      }
      await apiFetch("/settings/webhook-subscriptions", {
        method: "POST",
        body: {
          name: form.name.trim(),
          target_url: form.target_url.trim(),
          event_pattern: form.event_pattern.trim(),
          signing_secret_id: form.signing_secret_id || null,
          headers_json: headersJson,
        },
      });
      setShowCreateModal(false);
      setForm({
        name: "",
        target_url: "",
        event_pattern: "*",
        signing_secret_id: "",
        headers_json_text: "{}",
      });
      setNotice("Webhook subscription created.");
      await load();
    } catch (err) {
      setError(err?.message || "Failed to create webhook subscription");
    } finally {
      setSaving(false);
    }
  }

  async function deleteSubscription(id) {
    setError("");
    setNotice("");
    try {
      await apiFetch(`/settings/webhook-subscriptions/${encodeURIComponent(id)}`, { method: "DELETE" });
      setNotice("Webhook subscription deleted.");
      await load();
    } catch (err) {
      setError(err?.message || "Failed to delete webhook subscription");
    }
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
      <div className="rounded-box border border-base-300 bg-base-100 p-4 md:p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Webhook Subscriptions</h1>
            <p className="mt-1 text-sm opacity-70">
              Send signed Octodrop events to third-party systems using async worker delivery.
            </p>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
            New Subscription
          </button>
        </div>
        {notice ? <div className="alert alert-success mt-4 text-sm">{notice}</div> : null}
        {error ? <div className="alert alert-error mt-4 text-sm">{error}</div> : null}
      </div>

      <div className="rounded-box border border-base-300 bg-base-100 overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Pattern</th>
              <th>Target</th>
              <th>Status</th>
              <th>Last Delivered</th>
              <th>Last Result</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-sm opacity-60">Loading subscriptions...</td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-sm opacity-60">No webhook subscriptions yet.</td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id}>
                  <td>{item.name || "Untitled"}</td>
                  <td className="font-mono text-xs">{item.event_pattern || "*"}</td>
                  <td className="text-sm">{item.target_url || "—"}</td>
                  <td>
                    <span className={`badge badge-sm ${item.status === "active" ? "badge-success" : "badge-ghost"}`}>
                      {item.status || "active"}
                    </span>
                  </td>
                  <td className="text-sm">{formatDateTime(item.last_delivered_at) || "Never"}</td>
                  <td className="text-sm">
                    {item.last_error ? (
                      <span className="text-error">{item.last_error}</span>
                    ) : item.last_status_code ? (
                      <span>{item.last_status_code}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="text-right">
                    <button type="button" className="btn btn-ghost btn-sm text-error" onClick={() => deleteSubscription(item.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showCreateModal ? (
        <SubscriptionModal
          form={form}
          setForm={setForm}
          saving={saving}
          secrets={secrets}
          onCancel={() => setShowCreateModal(false)}
          onConfirm={createSubscription}
        />
      ) : null}
    </div>
  );
}
