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
import TabbedPaneShell from "../ui/TabbedPaneShell.jsx";

const TABS = [
  { id: "api", label: "API Requests" },
  { id: "webhooks", label: "Webhooks" },
  { id: "integrations", label: "Integrations" },
  { id: "modules", label: "Module Audit" },
  { id: "admins", label: "Superadmins" },
];

function formatDate(value) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

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

function EmptyRow({ colSpan }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-8 text-center text-sm text-base-content/60">
        No events in this feed.
      </td>
    </tr>
  );
}

function ApiTable({ rows }) {
  return (
    <div className="overflow-x-auto">
      <table className="table table-sm">
        <thead>
          <tr>
            <th>Time</th>
            <th>Workspace</th>
            <th>Method</th>
            <th>Path</th>
            <th>Status</th>
            <th>IP</th>
            <th>Credential</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <EmptyRow colSpan={7} /> : null}
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

function WebhookTable({ rows }) {
  return (
    <div className="overflow-x-auto">
      <table className="table table-sm">
        <thead>
          <tr>
            <th>Time</th>
            <th>Workspace</th>
            <th>Event</th>
            <th>Status</th>
            <th>Signature</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <EmptyRow colSpan={6} /> : null}
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

function IntegrationTable({ rows }) {
  return (
    <div className="overflow-x-auto">
      <table className="table table-sm">
        <thead>
          <tr>
            <th>Time</th>
            <th>Workspace</th>
            <th>Source</th>
            <th>Direction</th>
            <th>Status</th>
            <th>URL</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <EmptyRow colSpan={7} /> : null}
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

function ModuleAuditTable({ rows }) {
  return (
    <div className="overflow-x-auto">
      <table className="table table-sm">
        <thead>
          <tr>
            <th>Time</th>
            <th>Workspace</th>
            <th>Module</th>
            <th>Action</th>
            <th>Actor</th>
            <th>Audit ID</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <EmptyRow colSpan={6} /> : null}
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

function SuperadminsTable({ rows }) {
  return (
    <div className="overflow-x-auto">
      <table className="table table-sm">
        <thead>
          <tr>
            <th>User</th>
            <th>Role</th>
            <th>Created</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <EmptyRow colSpan={4} /> : null}
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
  const [data, setData] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("api");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/security/overview?limit=150", { cacheTtl: 0 });
      setData(res?.data || null);
      setWarnings(Array.isArray(res?.warnings) ? res.warnings : []);
    } catch (err) {
      setError(err?.message || "Failed to load Security Center");
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
      title="Security Center"
      subtitle="Superadmin-only monitoring for API denials, webhook failures, integration failures, module audit, and platform access."
      tabs={TABS}
      activeTabId={activeTab}
      onTabChange={setActiveTab}
      contentContainer
      rightActions={(
        <button type="button" className="btn btn-sm btn-primary gap-2" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      )}
      mobilePrimaryActions={[
        {
          label: loading ? "Refreshing..." : "Refresh",
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
          <StatCard icon={ShieldAlert} label="401/403" value={summary.api_denied_24h} help="Last 24 hours" tone="text-error" />
          <StatCard icon={BellRing} label="API 5xx" value={summary.api_5xx_24h} help="Last 24 hours" tone="text-warning" />
          <StatCard icon={Webhook} label="Webhook Rejects" value={summary.webhook_rejections_24h} help="Last 24 hours" tone="text-error" />
          <StatCard icon={Database} label="Integration Fails" value={summary.integration_failures_24h} help="Last 24 hours" tone="text-warning" />
          <StatCard icon={KeyRound} label="Module Changes" value={summary.module_changes_24h} help="Last 24 hours" tone="text-info" />
          <StatCard icon={UserCog} label="Superadmins" value={summary.superadmin_count} help="Current platform role rows" tone="text-error" />
        </div>

        <Section
          title={TABS.find((tab) => tab.id === activeTab)?.label || "Event Feed"}
          description="Use this feed for investigation. Critical production alerts still need external Slack/email/on-call routing."
        >
          <div className="min-h-[20rem] overflow-x-auto">
            {loading && !data ? <LoadingSpinner className="min-h-[20vh]" /> : null}
            {!loading || data ? (
              <>
                {activeTab === "webhooks" ? <WebhookTable rows={activeRows} /> : null}
                {activeTab === "integrations" ? <IntegrationTable rows={activeRows} /> : null}
                {activeTab === "modules" ? <ModuleAuditTable rows={activeRows} /> : null}
                {activeTab === "admins" ? <SuperadminsTable rows={activeRows} /> : null}
                {activeTab === "api" ? <ApiTable rows={activeRows} /> : null}
              </>
            ) : null}
          </div>
        </Section>

        <Section title="Operational Note" tone="bg-base-200/40">
          <div className="flex items-start gap-3 text-sm leading-6 text-base-content/70">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" />
            <p>
              This page is for superadmin review and incident triage. It does not replace production alert routing to
              Slack/email/on-call, and it intentionally uses a gated internal DB read path to show global security
              telemetry across workspaces.
            </p>
          </div>
        </Section>
      </div>
    </TabbedPaneShell>
  );
}
