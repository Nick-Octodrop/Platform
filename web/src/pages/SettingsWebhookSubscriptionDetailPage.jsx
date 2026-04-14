import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "../api.js";
import AppSelect from "../components/AppSelect.jsx";
import { useToast } from "../components/Toast.jsx";
import { useI18n } from "../i18n/LocalizationProvider.jsx";
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
  const { t } = useI18n();
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
      setError(err?.message || t("settings.webhook_subscriptions.load_failed"));
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
        throw new Error(t("settings.webhook_subscriptions.headers_json_invalid"));
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
      pushToast("success", t("settings.webhook_subscriptions.updated"));
      await load();
    } catch (err) {
      setError(err?.message || t("settings.webhook_subscriptions.update_failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <TabbedPaneShell
      title=""
      subtitle=""
      tabs={[
        { id: "details", label: t("settings.webhook_subscriptions.detail.tabs.details") },
        { id: "delivery", label: t("settings.webhook_subscriptions.detail.tabs.delivery") },
      ]}
      activeTabId={activeTabId}
      onTabChange={setActiveTabId}
      contentContainer={false}
      rightActions={null}
    >
      {error ? <div className="alert alert-error text-sm mb-4">{error}</div> : null}

      {loading ? (
        <div className="rounded-box border border-base-300 bg-base-100 p-4 text-sm opacity-70">{t("common.loading")}</div>
      ) : !item ? (
        <div className="rounded-box border border-base-300 bg-base-100 p-4 text-sm opacity-60">{t("settings.webhook_subscriptions.detail.not_found")}</div>
      ) : activeTabId === "details" ? (
        <div className="space-y-4">
          <DetailPanel title={t("settings.webhook_subscriptions.detail.title")} description={t("settings.webhook_subscriptions.detail.description")}>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                saveSubscription();
              }}
            >
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="form-control">
                  <span className="label-text text-sm">{t("settings.webhook_subscriptions.name")}</span>
                  <input className="input input-bordered input-sm" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} disabled={saving} />
                </label>
                <label className="form-control">
                  <span className="label-text text-sm">{t("settings.document_numbering.status")}</span>
                  <AppSelect className="select select-bordered select-sm" value={form.status} onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))} disabled={saving}>
                    <option value="active">{t("common.active")}</option>
                    <option value="disabled">{t("settings.webhook_subscriptions.disabled")}</option>
                  </AppSelect>
                </label>
                <label className="form-control md:col-span-2">
                  <span className="label-text text-sm">{t("settings.webhook_subscriptions.target_url")}</span>
                  <input className="input input-bordered input-sm" value={form.target_url} onChange={(e) => setForm((prev) => ({ ...prev, target_url: e.target.value }))} disabled={saving} />
                </label>
                <label className="form-control">
                  <span className="label-text text-sm">{t("settings.webhook_subscriptions.event_pattern")}</span>
                  <input className="input input-bordered input-sm" value={form.event_pattern} onChange={(e) => setForm((prev) => ({ ...prev, event_pattern: e.target.value }))} disabled={saving} />
                </label>
                <label className="form-control">
                  <span className="label-text text-sm">{t("settings.webhook_subscriptions.signing_secret")}</span>
                  <AppSelect className="select select-bordered select-sm" value={form.signing_secret_id} onChange={(e) => setForm((prev) => ({ ...prev, signing_secret_id: e.target.value }))} disabled={saving}>
                    <option value="">{t("settings.webhook_subscriptions.no_signing_secret")}</option>
                    {secrets.map((secret) => (
                      <option key={secret.id} value={secret.id}>{secret.name || secret.id}</option>
                    ))}
                  </AppSelect>
                </label>
                <label className="form-control md:col-span-2">
                  <span className="label-text text-sm">{t("settings.webhook_subscriptions.extra_headers_json")}</span>
                  <textarea className="textarea textarea-bordered min-h-[8rem] font-mono text-xs" value={form.headers_json_text} onChange={(e) => setForm((prev) => ({ ...prev, headers_json_text: e.target.value }))} disabled={saving} />
                </label>
              </div>

              <div className="flex flex-wrap gap-2">
                <button className="btn btn-sm btn-primary" type="submit" disabled={saving || !form.name.trim() || !form.target_url.trim() || !form.event_pattern.trim()}>
                  {saving ? t("common.saving") : t("common.save")}
                </button>
              </div>
            </form>
          </DetailPanel>
        </div>
      ) : (
        <DetailPanel title={t("settings.webhook_subscriptions.detail.delivery_title")} description={t("settings.webhook_subscriptions.detail.delivery_description")} tone="bg-base-200/40">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-box bg-base-100 p-3">
              <div className="text-xs uppercase tracking-wide opacity-60">{t("settings.webhook_subscriptions.last_delivered")}</div>
              <div className="mt-1 text-sm">{formatDateTime(item.last_delivered_at) || t("settings.webhook_subscriptions.never")}</div>
            </div>
            <div className="rounded-box bg-base-100 p-3">
              <div className="text-xs uppercase tracking-wide opacity-60">{t("settings.webhook_subscriptions.detail.last_result")}</div>
              <div className="mt-1 text-sm">{item.last_error || item.last_status_code || "—"}</div>
            </div>
            <div className="rounded-box bg-base-100 p-3">
              <div className="text-xs uppercase tracking-wide opacity-60">{t("settings.webhook_subscriptions.detail.signing")}</div>
              <div className="mt-1 text-sm">{item.signing_secret_id ? t("settings.webhook_subscriptions.detail.signing_enabled") : t("settings.webhook_subscriptions.detail.signing_disabled")}</div>
            </div>
            <div className="rounded-box bg-base-100 p-3">
              <div className="text-xs uppercase tracking-wide opacity-60">{t("settings.webhook_subscriptions.detail.header_overrides")}</div>
              <div className="mt-1 text-sm">{item.headers_json && Object.keys(item.headers_json).length ? t("settings.webhook_subscriptions.detail.header_count", { count: Object.keys(item.headers_json).length }) : t("settings.none")}</div>
            </div>
          </div>
        </DetailPanel>
      )}
    </TabbedPaneShell>
  );
}
