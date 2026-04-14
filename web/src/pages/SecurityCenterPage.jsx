import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BellRing,
  Database,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  UserCog,
  Webhook,
} from "lucide-react";
import { apiFetch } from "../api.js";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import { useI18n } from "../i18n/LocalizationProvider.jsx";
import TabbedPaneShell from "../ui/TabbedPaneShell.jsx";

function statusTone(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("reject") || text.includes("fail") || text.includes("error") || text === "false") {
    return "badge-error";
  }
  if (text.includes("warn") || text.includes("pending")) return "badge-warning";
  return "badge-success";
}

function formatActor(value) {
  if (!value) return "-";
  if (typeof value === "string") return value;
  if (typeof value !== "object") return String(value);
  return value.email || value.user_id || value.role || value.platform_role || JSON.stringify(value);
}

function StatCard({ icon: Icon, label, value, help, tone = "text-success" }) {
  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-base-content/50">{label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight">{value ?? 0}</p>
          <p className="mt-1 text-xs text-base-content/60">{help}</p>
        </div>
        <Icon className={`h-5 w-5 ${tone}`} />
      </div>
    </div>
  );
}

function Section({ title, description, children, tone = "bg-base-100" }) {
  return (
    <section className={`rounded-box border border-base-300 ${tone} p-4`}>
      <div className="flex flex-col gap-1 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          {description ? <div className="mt-1 text-sm opacity-70">{description}</div> : null}
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function EmptyRow({ t, colSpan }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-8 text-center text-sm text-base-content/60">
        {t("settings.security_center.no_events")}
      </td>
    </tr>
  );
}

function ApiTable({ rows, t, formatDate }) {
  return (
    <div className="overflow-x-auto">
      <table className="table table-sm">
        <thead>
          <tr>
            <th>{t("settings.security_center.tables.time")}</th>
            <th>{t("settings.security_center.tables.workspace")}</th>
            <th>{t("settings.security_center.tables.method")}</th>
            <th>{t("settings.security_center.tables.path")}</th>
            <th>{t("settings.document_numbering.status")}</th>
            <th>{t("settings.security_center.tables.ip")}</th>
            <th>{t("settings.security_center.tables.credential")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <EmptyRow t={t} colSpan={7} /> : null}
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="whitespace-nowrap">{formatDate(row.created_at)}</td>
              <td className="font-mono text-xs">{row.org_id || "-"}</td>
              <td>{row.method || "-"}</td>
              <td className="max-w-md truncate font-mono text-xs">{row.path || "-"}</td>
              <td>
                <span className={`badge badge-sm ${Number(row.status_code) >= 400 ? "badge-error" : "badge-success"}`}>
                  {row.status_code || "-"}
                </span>
              </td>
              <td className="font-mono text-xs">{row.ip_address || "-"}</td>
              <td className="font-mono text-xs">{row.api_credential_id || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WebhookTable({ rows, t, formatDate }) {
  return (
    <div className="overflow-x-auto">
      <table className="table table-sm">
        <thead>
          <tr>
            <th>{t("settings.security_center.tables.time")}</th>
            <th>{t("settings.security_center.tables.workspace")}</th>
            <th>{t("settings.security_center.tables.event")}</th>
            <th>{t("settings.document_numbering.status")}</th>
            <th>{t("settings.security_center.tables.signature")}</th>
            <th>{t("settings.security_center.tables.error")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <EmptyRow t={t} colSpan={6} /> : null}
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="whitespace-nowrap">{formatDate(row.received_at)}</td>
              <td className="font-mono text-xs">{row.org_id || "-"}</td>
              <td className="max-w-xs truncate">{row.event_key || row.provider_event_id || "-"}</td>
              <td><span className={`badge badge-sm ${statusTone(row.status)}`}>{row.status || "-"}</span></td>
              <td><span className={`badge badge-sm ${statusTone(String(row.signature_valid))}`}>{String(row.signature_valid)}</span></td>
              <td className="max-w-md truncate text-xs text-base-content/70">{row.error_message || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IntegrationTable({ rows, t, formatDate }) {
  return (
    <div className="overflow-x-auto">
      <table className="table table-sm">
        <thead>
          <tr>
            <th>{t("settings.security_center.tables.time")}</th>
            <th>{t("settings.security_center.tables.workspace")}</th>
            <th>{t("settings.security_center.tables.source")}</th>
            <th>{t("settings.security_center.tables.direction")}</th>
            <th>{t("settings.document_numbering.status")}</th>
            <th>{t("settings.security_center.tables.url")}</th>
            <th>{t("settings.security_center.tables.error")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <EmptyRow t={t} colSpan={7} /> : null}
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="whitespace-nowrap">{formatDate(row.created_at)}</td>
              <td className="font-mono text-xs">{row.org_id || "-"}</td>
              <td>{row.source || "-"}</td>
              <td>{row.direction || "-"}</td>
              <td><span className={`badge badge-sm ${Number(row.response_status) >= 400 || row.ok === false ? "badge-error" : "badge-success"}`}>{row.response_status || String(row.ok)}</span></td>
              <td className="max-w-md truncate font-mono text-xs">{row.url || "-"}</td>
              <td className="max-w-md truncate text-xs text-base-content/70">{row.error_message || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModuleAuditTable({ rows, t, formatDate }) {
  return (
    <div className="overflow-x-auto">
      <table className="table table-sm">
        <thead>
          <tr>
            <th>{t("settings.security_center.tables.time")}</th>
            <th>{t("settings.security_center.tables.workspace")}</th>
            <th>{t("settings.diagnostics.module")}</th>
            <th>{t("settings.security_center.tables.action")}</th>
            <th>{t("settings.security_center.tables.actor")}</th>
            <th>{t("settings.security_center.tables.audit_id")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <EmptyRow t={t} colSpan={6} /> : null}
          {rows.map((row) => {
            const audit = row.audit && typeof row.audit === "object" ? row.audit : {};
            return (
              <tr key={row.audit_id || `${row.org_id}:${row.module_id}:${row.created_at}`}>
                <td className="whitespace-nowrap">{formatDate(row.created_at)}</td>
                <td className="font-mono text-xs">{row.org_id || "-"}</td>
                <td>{row.module_id || audit.module_id || "-"}</td>
                <td><span className="badge badge-sm badge-outline">{audit.action || "-"}</span></td>
                <td className="font-mono text-xs">{formatActor(audit.actor)}</td>
                <td className="font-mono text-xs">{row.audit_id || audit.audit_id || "-"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SuperadminsTable({ rows, t, formatDate }) {
  return (
    <div className="overflow-x-auto">
      <table className="table table-sm">
        <thead>
          <tr>
            <th>{t("settings.users.user")}</th>
            <th>{t("settings.role")}</th>
            <th>{t("common.created")}</th>
            <th>{t("settings.secrets.updated")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <EmptyRow t={t} colSpan={4} /> : null}
          {rows.map((row) => (
            <tr key={row.user_id}>
              <td className="font-mono text-xs">{row.user_id || "-"}</td>
              <td><span className="badge badge-sm badge-error">{row.platform_role || "-"}</span></td>
              <td>{formatDate(row.created_at)}</td>
              <td>{formatDate(row.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SecurityCenterPage() {
  const { t, formatDateTime } = useI18n();
  const [data, setData] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("api");

  const tabs = useMemo(
    () => [
      { id: "api", label: t("settings.security_center.tabs.api") },
      { id: "webhooks", label: t("settings.security_center.tabs.webhooks") },
      { id: "integrations", label: t("settings.security_center.tabs.integrations") },
      { id: "modules", label: t("settings.security_center.tabs.modules") },
      { id: "admins", label: t("settings.security_center.tabs.admins") },
    ],
    [t],
  );

  function formatDate(value) {
    return formatDateTime(value, { dateStyle: "medium", timeStyle: "short" }) || "-";
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/security/overview?limit=150", { cacheTtl: 0 });
      setData(res?.data || null);
      setWarnings(Array.isArray(res?.warnings) ? res.warnings : []);
    } catch (err) {
      setError(err?.message || t("settings.security_center.load_failed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const summary = data?.summary || {};
  const activeRows = useMemo(() => {
    if (activeTab === "webhooks") return data?.webhook_events || [];
    if (activeTab === "integrations") return data?.integration_failures || [];
    if (activeTab === "modules") return data?.module_audit || [];
    if (activeTab === "admins") return data?.superadmins || [];
    return data?.api_requests || [];
  }, [activeTab, data]);

  return (
    <TabbedPaneShell
      title={t("settings.security_center.title")}
      subtitle={t("settings.security_center.subtitle")}
      tabs={tabs}
      activeTabId={activeTab}
      onTabChange={setActiveTab}
      contentContainer
      rightActions={(
        <button type="button" className="btn btn-sm btn-primary gap-2" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {t("common.refresh")}
        </button>
      )}
      mobilePrimaryActions={[
        {
          label: loading ? t("settings.security_center.refreshing") : t("common.refresh"),
          onClick: load,
          disabled: loading,
        },
      ]}
    >
      <div className="space-y-4">
        {error ? <div className="alert alert-error text-sm">{error}</div> : null}
        {warnings.length > 0 ? (
          <div className="alert alert-warning text-sm">
            <AlertTriangle className="h-4 w-4" />
            <span>{warnings.map((warning) => warning.message || warning.code).join(" ")}</span>
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <StatCard icon={ShieldAlert} label={t("settings.security_center.cards.api_denied")} value={summary.api_denied_24h} help={t("settings.security_center.cards.last_24_hours")} tone="text-error" />
          <StatCard icon={BellRing} label={t("settings.security_center.cards.api_5xx")} value={summary.api_5xx_24h} help={t("settings.security_center.cards.last_24_hours")} tone="text-warning" />
          <StatCard icon={Webhook} label={t("settings.security_center.cards.webhook_rejects")} value={summary.webhook_rejections_24h} help={t("settings.security_center.cards.last_24_hours")} tone="text-error" />
          <StatCard icon={Database} label={t("settings.security_center.cards.integration_fails")} value={summary.integration_failures_24h} help={t("settings.security_center.cards.last_24_hours")} tone="text-warning" />
          <StatCard icon={KeyRound} label={t("settings.security_center.cards.module_changes")} value={summary.module_changes_24h} help={t("settings.security_center.cards.last_24_hours")} tone="text-info" />
          <StatCard icon={UserCog} label={t("settings.security_center.cards.superadmins")} value={summary.superadmin_count} help={t("settings.security_center.cards.current_platform_rows")} tone="text-error" />
        </div>

        <Section
          title={tabs.find((tab) => tab.id === activeTab)?.label || t("settings.security_center.feed_title")}
          description={t("settings.security_center.feed_description")}
        >
          <div className="min-h-[20rem] overflow-x-auto">
            {loading && !data ? <LoadingSpinner className="min-h-[20vh]" /> : null}
            {!loading || data ? (
              <>
                {activeTab === "webhooks" ? <WebhookTable rows={activeRows} t={t} formatDate={formatDate} /> : null}
                {activeTab === "integrations" ? <IntegrationTable rows={activeRows} t={t} formatDate={formatDate} /> : null}
                {activeTab === "modules" ? <ModuleAuditTable rows={activeRows} t={t} formatDate={formatDate} /> : null}
                {activeTab === "admins" ? <SuperadminsTable rows={activeRows} t={t} formatDate={formatDate} /> : null}
                {activeTab === "api" ? <ApiTable rows={activeRows} t={t} formatDate={formatDate} /> : null}
              </>
            ) : null}
          </div>
        </Section>

        <Section title={t("settings.security_center.operational_note_title")} tone="bg-base-200/40">
          <div className="flex items-start gap-3 text-sm leading-6 text-base-content/70">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" />
            <p>
              {t("settings.security_center.operational_note_body")}
            </p>
          </div>
        </Section>
      </div>
    </TabbedPaneShell>
  );
}
