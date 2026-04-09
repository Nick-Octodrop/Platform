import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "../api.js";
import AppSelect from "../components/AppSelect.jsx";
import { useToast } from "../components/Toast.jsx";
import TabbedPaneShell from "../ui/TabbedPaneShell.jsx";
import { formatDateTime } from "../utils/dateTime.js";

function DetailPanel({ title, description, children, tone = "bg-base-100" }) {
  return (
    <section className={`rounded-box border border-base-300 ${tone} p-4`}>
      <div className="font-medium">{title}</div>
      {description ? <div className="mt-1 text-sm opacity-70">{description}</div> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function emptyForm() {
  return {
    id: "",
    name: "",
    target_url: "",
    event_pattern: "*",
    status: "active",
    signing_secret_id: "",
    headers_json_text: "{}",
  };
}

export default function SettingsWebhookSubscriptionDetailPage() {
  const { subscriptionId } = useParams();
  const { pushToast } = useToast();
  const [items, setItems] = useState([]);
  const [secrets, setSecrets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(emptyForm());
  const [activeTabId, setActiveTabId] = useState("details");

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
  }, [subscriptionId]);

  const item = useMemo(() => items.find((entry) => entry.id === subscriptionId) || null, [items, subscriptionId]);

  useEffect(() => {
    if (item) {
      setForm({
        id: item.id,
        name: item.name || "",
        target_url: item.target_url || "",
        event_pattern: item.event_pattern || "*",
        status: item.status || "active",
        signing_secret_id: item.signing_secret_id || "",
        headers_json_text: JSON.stringify(item.headers_json || {}, null, 2),
      });
    } else {
      setForm(emptyForm());
    }
  }, [item]);

  async function saveSubscription() {
    if (!form.id || saving) return;
    setSaving(true);
    setError("");
    try {
      let headersJson = {};
      try {
        headersJson = JSON.parse(form.headers_json_text || "{}");
      } catch {
        throw new Error("Headers JSON must be valid JSON");
      }
      await apiFetch(`/settings/webhook-subscriptions/${encodeURIComponent(form.id)}`, {
        method: "PATCH",
        body: {
          name: form.name.trim(),
          target_url: form.target_url.trim(),
          event_pattern: form.event_pattern.trim(),
          status: form.status,
          signing_secret_id: form.signing_secret_id || null,
          headers_json: headersJson,
        },
      });
      pushToast("success", "Webhook subscription updated.");
      await load();
    } catch (err) {
      setError(err?.message || "Failed to update webhook subscription");
    } finally {
      setSaving(false);
    }
  }

  return (
    <TabbedPaneShell
      title=""
      subtitle=""
      tabs={[
        { id: "details", label: "Details" },
        { id: "delivery", label: "Delivery" },
      ]}
      activeTabId={activeTabId}
      onTabChange={setActiveTabId}
      contentContainer={false}
      rightActions={null}
    >
      {error ? <div className="alert alert-error text-sm mb-4">{error}</div> : null}

      {loading ? (
        <div className="rounded-box border border-base-300 bg-base-100 p-4 text-sm opacity-70">Loading…</div>
      ) : !item ? (
        <div className="rounded-box border border-base-300 bg-base-100 p-4 text-sm opacity-60">Subscription not found.</div>
      ) : activeTabId === "details" ? (
        <div className="space-y-4">
          <DetailPanel title="Subscription Details" description="Control target, pattern, status, signing, and header overrides here.">
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                saveSubscription();
              }}
            >
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="form-control">
                  <span className="label-text text-sm">Name</span>
                  <input className="input input-bordered input-sm" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} disabled={saving} />
                </label>
                <label className="form-control">
                  <span className="label-text text-sm">Status</span>
                  <AppSelect className="select select-bordered select-sm" value={form.status} onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))} disabled={saving}>
                    <option value="active">Active</option>
                    <option value="disabled">Disabled</option>
                  </AppSelect>
                </label>
                <label className="form-control md:col-span-2">
                  <span className="label-text text-sm">Target URL</span>
                  <input className="input input-bordered input-sm" value={form.target_url} onChange={(e) => setForm((prev) => ({ ...prev, target_url: e.target.value }))} disabled={saving} />
                </label>
                <label className="form-control">
                  <span className="label-text text-sm">Event Pattern</span>
                  <input className="input input-bordered input-sm" value={form.event_pattern} onChange={(e) => setForm((prev) => ({ ...prev, event_pattern: e.target.value }))} disabled={saving} />
                </label>
                <label className="form-control">
                  <span className="label-text text-sm">Signing Secret</span>
                  <AppSelect className="select select-bordered select-sm" value={form.signing_secret_id} onChange={(e) => setForm((prev) => ({ ...prev, signing_secret_id: e.target.value }))} disabled={saving}>
                    <option value="">No signing secret</option>
                    {secrets.map((secret) => (
                      <option key={secret.id} value={secret.id}>{secret.name || secret.id}</option>
                    ))}
                  </AppSelect>
                </label>
                <label className="form-control md:col-span-2">
                  <span className="label-text text-sm">Extra Headers JSON</span>
                  <textarea className="textarea textarea-bordered min-h-[8rem] font-mono text-xs" value={form.headers_json_text} onChange={(e) => setForm((prev) => ({ ...prev, headers_json_text: e.target.value }))} disabled={saving} />
                </label>
              </div>

              <div className="flex flex-wrap gap-2">
                <button className="btn btn-sm btn-primary" type="submit" disabled={saving || !form.name.trim() || !form.target_url.trim() || !form.event_pattern.trim()}>
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          </DetailPanel>
        </div>
      ) : (
        <DetailPanel title="Delivery Status" description="Recent delivery outcome and signing state for this endpoint." tone="bg-base-200/40">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-box bg-base-100 p-3">
              <div className="text-xs uppercase tracking-wide opacity-60">Last Delivered</div>
              <div className="mt-1 text-sm">{formatDateTime(item.last_delivered_at) || "Never"}</div>
            </div>
            <div className="rounded-box bg-base-100 p-3">
              <div className="text-xs uppercase tracking-wide opacity-60">Last Result</div>
              <div className="mt-1 text-sm">{item.last_error || item.last_status_code || "—"}</div>
            </div>
            <div className="rounded-box bg-base-100 p-3">
              <div className="text-xs uppercase tracking-wide opacity-60">Signing</div>
              <div className="mt-1 text-sm">{item.signing_secret_id ? "Signed deliveries enabled" : "Unsigned deliveries"}</div>
            </div>
            <div className="rounded-box bg-base-100 p-3">
              <div className="text-xs uppercase tracking-wide opacity-60">Header Overrides</div>
              <div className="mt-1 text-sm">{item.headers_json && Object.keys(item.headers_json).length ? `${Object.keys(item.headers_json).length} header(s)` : "None"}</div>
            </div>
          </div>
        </DetailPanel>
      )}
    </TabbedPaneShell>
  );
}
