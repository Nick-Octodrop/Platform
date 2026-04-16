import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowRight, CheckCircle2, Circle, KeyRound, Plus, ShieldCheck, TestTube2 } from "lucide-react";
import { apiFetch } from "../api.js";
import AppSelect from "../components/AppSelect.jsx";
import TabbedPaneShell from "../ui/TabbedPaneShell.jsx";
import { formatDateTime } from "../utils/dateTime.js";
import { buildIntegrationOauthRedirectUri, encodeIntegrationOauthState } from "../utils/integrationsOAuth.js";
import { useI18n } from "../i18n/LocalizationProvider.jsx";

function providerKeyFromType(type) {
  const raw = String(type || "");
  if (!raw.startsWith("integration.")) return raw || "—";
  return raw.split(".", 2)[1] || "—";
}

function safeJsonParse(text, fallback) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function prettyJson(value) {
  return JSON.stringify(value || {}, null, 2);
}

function defaultNewMappingState() {
  return {
    name: "",
    source_entity: "",
    target_entity: "",
    resource_key: "",
    record_mode: "upsert",
    match_on_text: "",
    field_mappings: [{ to: "", value_type: "path", source: "", transform: "" }],
    mapping_json_text: "{}",
    sample_source_text: "{}",
  };
}

function buildMappingJsonFromForm(form) {
  const fieldMappings = (Array.isArray(form?.field_mappings) ? form.field_mappings : [])
    .map((row) => {
      if (!row?.to || !row?.source) return null;
      const item = { to: row.to.trim() };
      if (row.value_type === "constant") item.value = row.source;
      else if (row.value_type === "ref") item.ref = row.source.trim();
      else item.path = row.source.trim();
      if (row.transform) item.transform = row.transform;
      return item;
    })
    .filter(Boolean);
  return {
    resource_key: form?.resource_key?.trim() || undefined,
    record_mode: form?.record_mode || "upsert",
    match_on: (form?.match_on_text || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
    field_mappings: fieldMappings,
  };
}

function SummaryStat({ label, value }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide opacity-60">{label}</div>
      <div className="mt-1 break-words">{value || "—"}</div>
    </div>
  );
}

function titleCase(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

const XERO_HIDDEN_SETUP_FIELDS = new Set([
  "base_url",
  "authorization_url",
  "token_url",
  "client_id",
  "default_headers",
  "oauth_token_refresh_leeway_seconds",
  "test_request",
  "xero_tenants",
]);

const XERO_READONLY_SETUP_FIELDS = new Set([
  "xero_tenant_name",
  "xero_tenant_id",
]);

function SimpleModal({ title, subtitle = "", children, onClose, maxWidthClass = "max-w-xl" }) {
  return (
    <div className="modal modal-open">
      <div className={`modal-box ${maxWidthClass}`}>
        <div className="space-y-1">
          <h3 className="text-lg font-semibold">{title}</h3>
          {subtitle ? <p className="text-sm opacity-70">{subtitle}</p> : null}
        </div>
        <div className="mt-4">{children}</div>
        <button className="btn btn-sm btn-circle btn-ghost absolute right-3 top-3" type="button" onClick={onClose}>
          x
        </button>
      </div>
    </div>
  );
}

function Section({ title, help, children, tone = "default" }) {
  const shellClass = tone === "muted"
    ? "space-y-3 rounded-box border border-base-300 bg-base-200/40 p-4"
    : "space-y-3 rounded-box border border-base-300 bg-base-100 p-4";
  return (
    <section className={shellClass}>
      <div>
        <div className="font-medium">{title}</div>
        {help ? <div className="mt-1 text-sm opacity-70">{help}</div> : null}
      </div>
      {children}
    </section>
  );
}

function SetupGuideStep({ icon: Icon, title, description, actionLabel = "", onAction, complete = false }) {
  const StateIcon = complete ? CheckCircle2 : Circle;
  return (
    <div className="flex items-start gap-3 rounded-box border border-base-300 bg-base-200/60 p-3">
      <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-full bg-base-200">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="font-medium">{title}</div>
          <StateIcon className={`h-4 w-4 ${complete ? "text-success" : "opacity-50"}`} />
        </div>
        <div className="mt-1 text-sm opacity-70">{description}</div>
      </div>
      {actionLabel && typeof onAction === "function" ? (
        <button className="btn btn-ghost btn-sm" type="button" onClick={onAction}>
          {actionLabel}
          <ArrowRight className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

function JsonField({ label, value, onChange, minHeight = "9rem", disabled = false, help = "" }) {
  return (
    <label className="form-control">
      <span className="label-text text-sm">{label}</span>
      <textarea
        className="textarea textarea-bordered font-mono text-xs"
        style={{ minHeight }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
      {help ? <span className="label-text-alt opacity-70 mt-1">{help}</span> : null}
    </label>
  );
}

function TableList({ emptyLabel, columns, rows }) {
  if (!rows.length) return <div className="text-sm opacity-60">{emptyLabel}</div>;
  return (
    <div className="overflow-x-auto rounded-box border border-base-300 bg-base-200/40">
      <table className="table table-sm">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((column) => (
                <td key={column.key} className="align-top">
                  {column.render ? column.render(row) : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function IntegrationConnectionPage() {
  const { connectionId } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const detailT = (key, values) => t(`settings.integrations.detail.${key}`, values);
  const [item, setItem] = useState(null);
  const [providers, setProviders] = useState([]);
  const [secrets, setSecrets] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [webhooks, setWebhooks] = useState([]);
  const [requestLogs, setRequestLogs] = useState([]);
  const [webhookEvents, setWebhookEvents] = useState([]);
  const [checkpoints, setCheckpoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [runningRequest, setRunningRequest] = useState(false);
  const [runningSync, setRunningSync] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeTab, setActiveTab] = useState("setup");
  const [showCreateSecretModal, setShowCreateSecretModal] = useState(false);
  const [creatingSecret, setCreatingSecret] = useState(false);
  const [createSecretTargetKey, setCreateSecretTargetKey] = useState("");
  const [createSecretForm, setCreateSecretForm] = useState({
    name: "",
    provider_key: "",
    secret_key: "",
    status: "active",
    value: "",
  });

  const [name, setName] = useState("");
  const [status, setStatus] = useState("active");
  const [secretRefs, setSecretRefs] = useState({});
  const [config, setConfig] = useState({});
  const [configText, setConfigText] = useState("{}");
  const [testResult, setTestResult] = useState(null);
  const [requestResult, setRequestResult] = useState(null);
  const [syncResult, setSyncResult] = useState(null);
  const [oauthRedirectUri, setOauthRedirectUri] = useState("");
  const [oauthAuthorizeResult, setOauthAuthorizeResult] = useState(null);
  const [oauthCode, setOauthCode] = useState("");
  const [authorizingOAuth, setAuthorizingOAuth] = useState(false);
  const [exchangingOAuth, setExchangingOAuth] = useState(false);
  const [refreshingOAuth, setRefreshingOAuth] = useState(false);
  const [requestForm, setRequestForm] = useState({
    method: "GET",
    path: "/",
    url: "",
    headersText: "{}",
    queryText: "{}",
    jsonText: "{}",
    bodyText: "",
  });
  const [newMapping, setNewMapping] = useState(defaultNewMappingState);
  const [creatingMapping, setCreatingMapping] = useState(false);
  const [previewingMapping, setPreviewingMapping] = useState(false);
  const [mappingPreview, setMappingPreview] = useState(null);
  const [newWebhook, setNewWebhook] = useState({
    direction: "inbound",
    event_key: "",
    endpoint_path: "",
    signing_secret_id: "",
    config_json_text: "{}",
  });
  const [creatingWebhook, setCreatingWebhook] = useState(false);

  async function load() {
    if (!connectionId) return;
    setLoading(true);
    setError("");
    try {
      const [
        connectionRes,
        providersRes,
        secretsRes,
        mappingsRes,
        webhooksRes,
        logsRes,
        eventsRes,
        checkpointsRes,
      ] = await Promise.all([
        apiFetch(`/integrations/connections/${encodeURIComponent(connectionId)}`),
        apiFetch("/integrations/providers"),
        apiFetch("/settings/secrets"),
        apiFetch(`/integrations/mappings?connection_id=${encodeURIComponent(connectionId)}`),
        apiFetch(`/integrations/webhooks?connection_id=${encodeURIComponent(connectionId)}`),
        apiFetch(`/integrations/request-logs?connection_id=${encodeURIComponent(connectionId)}`),
        apiFetch(`/integrations/webhook-events?connection_id=${encodeURIComponent(connectionId)}`),
        apiFetch(`/integrations/checkpoints?connection_id=${encodeURIComponent(connectionId)}`),
      ]);
      const conn = connectionRes?.connection || null;
      setItem(conn);
      setProviders(Array.isArray(providersRes?.providers) ? providersRes.providers : []);
      setSecrets(Array.isArray(secretsRes?.secrets) ? secretsRes.secrets : []);
      setMappings(Array.isArray(mappingsRes?.mappings) ? mappingsRes.mappings : []);
      setWebhooks(Array.isArray(webhooksRes?.webhooks) ? webhooksRes.webhooks : []);
      setRequestLogs(Array.isArray(logsRes?.logs) ? logsRes.logs : []);
      setWebhookEvents(Array.isArray(eventsRes?.events) ? eventsRes.events : []);
      setCheckpoints(Array.isArray(checkpointsRes?.checkpoints) ? checkpointsRes.checkpoints : []);
      setName(conn?.name || "");
      setStatus(conn?.status || "active");
      setSecretRefs(conn?.secret_refs || {});
      setConfig(conn?.config || {});
      setConfigText(prettyJson(conn?.config || {}));
      setRequestForm((prev) => ({
        ...prev,
        method: String(conn?.config?.test_request?.method || prev.method || "GET").toUpperCase(),
        path: conn?.config?.test_request?.path || prev.path || "/",
        headersText: prettyJson(conn?.config?.test_request?.headers || {}),
        queryText: prettyJson(conn?.config?.test_request?.query || {}),
        jsonText: prettyJson(conn?.config?.test_request?.json || {}),
      }));
    } catch (err) {
      setItem(null);
      setError(err?.message || detailT("errors.load_connection"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [connectionId]);

  useEffect(() => {
    if (!connectionId || typeof window === "undefined") return;
    const resolvedProviderKey = providerKeyFromType(item?.type);
    const nextRedirectUri = buildIntegrationOauthRedirectUri(window.location.origin, resolvedProviderKey, connectionId);
    setOauthRedirectUri((prev) => {
      if (!prev || prev.includes(`/integrations/connections/${connectionId}`) || prev.includes("/integrations/oauth/")) {
        return nextRedirectUri;
      }
      return prev;
    });
    const params = new URLSearchParams(window.location.search);
    const returnedCode = params.get("code");
    if (returnedCode) {
      setOauthCode((prev) => prev || returnedCode);
    }
  }, [connectionId, item?.type]);

  const providerIndex = useMemo(() => {
    const map = new Map();
    for (const provider of providers || []) {
      if (provider?.key) map.set(provider.key, provider);
    }
    return map;
  }, [providers]);

  const providerKey = providerKeyFromType(item?.type);
  const provider = providerIndex.get(providerKey) || null;
  const isXeroProvider = providerKey === "xero";
  const providerManifest = provider?.manifest_json || {};
  const providerCapabilities = Array.isArray(providerManifest?.capabilities) ? providerManifest.capabilities : [];
  const providerSupportsSync = providerCapabilities.includes("sync.poll");
  const authMode = String(config?.auth_mode || config?.provider_auth_type || "").trim().toLowerCase();
  const setupFields = Array.isArray(providerManifest?.setup_schema?.fields) ? providerManifest.setup_schema.fields : [];
  const syncFields = Array.isArray(providerManifest?.sync_schema?.fields) ? providerManifest.sync_schema.fields : [];
  const secretKeys = Array.isArray(providerManifest?.secret_keys) ? providerManifest.secret_keys : [];
  const requiresManualSecrets = !isXeroProvider && secretKeys.length > 0;
  const groupedSetupFields = useMemo(() => {
    const groups = new Map();
    for (const rawField of setupFields) {
      const field = typeof rawField === "string" ? { id: rawField } : rawField;
      if (!field?.id) continue;
      const groupKey = String(field.group || "connection");
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push(field);
    }
    return Array.from(groups.entries());
  }, [setupFields]);
  const visibleSetupGroups = useMemo(
    () => groupedSetupFields
      .map(([groupKey, fields]) => [
        groupKey,
        fields.filter((rawField) => {
          const field = typeof rawField === "string" ? { id: rawField } : rawField;
          if (!field?.id) return false;
          if (!isXeroProvider) return true;
          return !XERO_HIDDEN_SETUP_FIELDS.has(field.id);
        }),
      ])
      .filter(([, fields]) => fields.length),
    [groupedSetupFields, isXeroProvider],
  );

  const tabs = useMemo(
    () => [
      { id: "setup", label: t("settings.integrations.detail.tabs.setup") },
      ...(requiresManualSecrets ? [{ id: "secrets", label: t("settings.integrations.detail.tabs.secrets") }] : []),
      { id: "request", label: t("settings.integrations.detail.tabs.request") },
      ...(providerSupportsSync ? [{ id: "sync", label: t("settings.integrations.detail.tabs.sync") }] : []),
      { id: "webhooks", label: t("settings.integrations.detail.tabs.webhooks") },
      { id: "mappings", label: t("settings.integrations.detail.tabs.mappings") },
      { id: "logs", label: t("settings.integrations.detail.tabs.logs") },
    ],
    [providerSupportsSync, requiresManualSecrets, t],
  );

  useEffect(() => {
    if (tabs.some((tab) => tab.id === activeTab)) return;
    setActiveTab("setup");
  }, [activeTab, tabs]);

  function updateConfigField(key, value) {
    setConfig((prev) => {
      const next = { ...(prev || {}), [key]: value };
      setConfigText(prettyJson(next));
      return next;
    });
  }

  function updateSyncField(key, value) {
    setConfig((prev) => {
      const next = {
        ...(prev || {}),
        sync: {
          ...((prev || {}).sync || {}),
          [key]: value,
        },
      };
      setConfigText(prettyJson(next));
      return next;
    });
  }

  function updateSyncRequestField(key, value) {
    setConfig((prev) => {
      const next = {
        ...(prev || {}),
        sync: {
          ...((prev || {}).sync || {}),
          request: {
            ...((((prev || {}).sync || {}).request) || {}),
            [key]: value,
          },
        },
      };
      setConfigText(prettyJson(next));
      return next;
    });
  }

  function updateSecretRef(secretKey, secretId) {
    setSecretRefs((prev) => {
      const next = { ...(prev || {}) };
      if (secretId) next[secretKey] = secretId;
      else delete next[secretKey];
      return next;
    });
  }

  function openCreateSecretModal(secretKey = "") {
    setCreateSecretTargetKey(secretKey);
    setCreateSecretForm({
      name: secretKey ? `${provider?.name || providerKey} ${titleCase(secretKey)}` : `${provider?.name || providerKey} secret`,
      provider_key: providerKey && providerKey !== "—" ? providerKey : "",
      secret_key: secretKey || "",
      status: "active",
      value: "",
    });
    setShowCreateSecretModal(true);
  }

  async function createSecretForConnection() {
    if (creatingSecret || !createSecretForm.value.trim()) return;
    setCreatingSecret(true);
    setError("");
    setNotice("");
    try {
      const res = await apiFetch("/settings/secrets", {
        method: "POST",
        body: {
          name: createSecretForm.name.trim() || null,
          provider_key: createSecretForm.provider_key.trim() || null,
          secret_key: createSecretForm.secret_key.trim() || null,
          status: createSecretForm.status || "active",
          value: createSecretForm.value,
        },
      });
      const created = res?.secret || null;
      setNotice(detailT("notices.secret_created"));
      setShowCreateSecretModal(false);
      setCreateSecretForm({
        name: "",
        provider_key: providerKey && providerKey !== "—" ? providerKey : "",
        secret_key: "",
        status: "active",
        value: "",
      });
      if (created?.id) {
        setSecretRefs((prev) => {
          if (!createSecretTargetKey) return prev;
          return { ...(prev || {}), [createSecretTargetKey]: created.id };
        });
      }
      await load();
    } catch (err) {
      setError(err?.message || detailT("errors.create_secret"));
    } finally {
      setCreatingSecret(false);
    }
  }

  async function save() {
    if (!item?.id || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const nextConfig = safeJsonParse(configText, config);
      const res = await apiFetch(`/integrations/connections/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        body: {
          name: name.trim(),
          status,
          config: nextConfig,
          secret_refs: secretRefs,
        },
      });
      setItem(res?.connection || null);
      setConfig(res?.connection?.config || nextConfig);
      setConfigText(prettyJson(res?.connection?.config || nextConfig));
      setNotice(detailT("notices.connection_saved"));
      await load();
    } catch (err) {
      setError(err?.message || detailT("errors.save_failed"));
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    if (!item?.id || testing) return;
    setTesting(true);
    setError("");
    setNotice("");
    try {
      const res = await apiFetch(`/integrations/connections/${encodeURIComponent(item.id)}/test`, { method: "POST" });
      setTestResult(res?.result || null);
      setNotice(detailT("notices.connection_test_completed"));
      await load();
    } catch (err) {
      setTestResult(null);
      setError(err?.message || detailT("errors.connection_test_failed"));
      await load();
    } finally {
      setTesting(false);
    }
  }

  async function runRequest() {
    if (!item?.id || runningRequest) return;
    setRunningRequest(true);
    setError("");
    setNotice("");
    try {
      const payload = {
        method: requestForm.method,
        path: requestForm.path || undefined,
        url: requestForm.url || undefined,
        headers: safeJsonParse(requestForm.headersText, {}),
        query: safeJsonParse(requestForm.queryText, {}),
      };
      if (requestForm.bodyText.trim()) payload.body = requestForm.bodyText;
      else payload.json = safeJsonParse(requestForm.jsonText, {});
      const res = await apiFetch(`/integrations/connections/${encodeURIComponent(item.id)}/request`, {
        method: "POST",
        body: payload,
      });
      setRequestResult(res?.result || null);
      setNotice(detailT("notices.request_completed"));
      await load();
    } catch (err) {
      setRequestResult(null);
      setError(err?.message || detailT("errors.request_failed"));
      await load();
    } finally {
      setRunningRequest(false);
    }
  }

  async function runSync() {
    if (!item?.id || runningSync) return;
    setRunningSync(true);
    setError("");
    setNotice("");
    try {
      const res = await apiFetch(`/integrations/connections/${encodeURIComponent(item.id)}/sync`, {
        method: "POST",
        body: {
          sync: config?.sync || {},
        },
      });
      setSyncResult(res?.result || null);
      setNotice(detailT("notices.sync_completed"));
      await load();
    } catch (err) {
      setSyncResult(null);
      setError(err?.message || detailT("errors.sync_failed"));
      await load();
    } finally {
      setRunningSync(false);
    }
  }

  async function generateOauthAuthorizeUrl() {
    if (!item?.id || authorizingOAuth || !oauthRedirectUri.trim()) return;
    setAuthorizingOAuth(true);
    setError("");
    setNotice("");
    try {
      const state = encodeIntegrationOauthState({
        connectionId: item.id,
        providerKey,
        returnOrigin: typeof window !== "undefined" ? window.location.origin : "",
      });
      const res = await apiFetch(`/integrations/connections/${encodeURIComponent(item.id)}/oauth/authorize-url`, {
        method: "POST",
        body: { redirect_uri: oauthRedirectUri.trim(), state },
      });
      setOauthAuthorizeResult(res?.result || null);
      setNotice(detailT("notices.authorize_url_generated"));
    } catch (err) {
      setOauthAuthorizeResult(null);
      setError(err?.message || detailT("errors.generate_authorize_url"));
    } finally {
      setAuthorizingOAuth(false);
    }
  }

  async function exchangeOauthCode() {
    if (!item?.id || exchangingOAuth || !oauthRedirectUri.trim() || !oauthCode.trim()) return;
    setExchangingOAuth(true);
    setError("");
    setNotice("");
    try {
      const res = await apiFetch(`/integrations/connections/${encodeURIComponent(item.id)}/oauth/exchange`, {
        method: "POST",
        body: { redirect_uri: oauthRedirectUri.trim(), code: oauthCode.trim() },
      });
      setNotice(detailT("notices.oauth_tokens_stored"));
      setOauthAuthorizeResult(null);
      await load();
      if (res?.result?.connection) {
        setItem(res.result.connection);
        setConfig(res.result.connection.config || {});
        setConfigText(prettyJson(res.result.connection.config || {}));
      }
    } catch (err) {
      setError(err?.message || detailT("errors.exchange_oauth_code"));
    } finally {
      setExchangingOAuth(false);
    }
  }

  async function refreshOauthTokens() {
    if (!item?.id || refreshingOAuth) return;
    setRefreshingOAuth(true);
    setError("");
    setNotice("");
    try {
      const res = await apiFetch(`/integrations/connections/${encodeURIComponent(item.id)}/oauth/refresh`, { method: "POST" });
      setNotice(detailT("notices.oauth_tokens_refreshed"));
      await load();
      if (res?.result?.connection) {
        setItem(res.result.connection);
        setConfig(res.result.connection.config || {});
        setConfigText(prettyJson(res.result.connection.config || {}));
      }
    } catch (err) {
      setError(err?.message || detailT("errors.refresh_oauth_tokens"));
    } finally {
      setRefreshingOAuth(false);
    }
  }

  async function createMapping() {
    if (creatingMapping || !item?.id) return;
    setCreatingMapping(true);
    setError("");
    try {
      const guidedMapping = buildMappingJsonFromForm(newMapping);
      const advancedMapping = safeJsonParse(newMapping.mapping_json_text, {});
      await apiFetch("/integrations/mappings", {
        method: "POST",
        body: {
          connection_id: item.id,
          name: newMapping.name.trim(),
          source_entity: newMapping.source_entity.trim(),
          target_entity: newMapping.target_entity.trim(),
          mapping_json: { ...guidedMapping, ...advancedMapping },
        },
      });
      setNewMapping(defaultNewMappingState());
      setMappingPreview(null);
      setNotice(detailT("notices.mapping_added"));
      await load();
    } catch (err) {
      setError(err?.message || detailT("errors.create_mapping"));
    } finally {
      setCreatingMapping(false);
    }
  }

  async function previewMapping() {
    if (previewingMapping || !item?.id) return;
    setPreviewingMapping(true);
    setError("");
    try {
      const guidedMapping = buildMappingJsonFromForm(newMapping);
      const advancedMapping = safeJsonParse(newMapping.mapping_json_text, {});
      const res = await apiFetch("/integrations/mappings/preview", {
        method: "POST",
        body: {
          connection_id: item.id,
          connection: item,
          resource_key: newMapping.resource_key.trim() || undefined,
          mapping_json: { ...guidedMapping, ...advancedMapping },
          source_record: safeJsonParse(newMapping.sample_source_text, {}),
        },
      });
      setMappingPreview(res?.preview || null);
    } catch (err) {
      setMappingPreview(null);
      setError(err?.message || detailT("errors.preview_mapping"));
    } finally {
      setPreviewingMapping(false);
    }
  }

  function updateFieldMappingRow(rowIndex, updates) {
    setNewMapping((prev) => ({
      ...prev,
      field_mappings: (prev.field_mappings || []).map((row, index) => (index === rowIndex ? { ...row, ...updates } : row)),
    }));
  }

  function addFieldMappingRow() {
    setNewMapping((prev) => ({
      ...prev,
      field_mappings: [...(prev.field_mappings || []), { to: "", value_type: "path", source: "", transform: "" }],
    }));
  }

  function removeFieldMappingRow(rowIndex) {
    setNewMapping((prev) => ({
      ...prev,
      field_mappings: (prev.field_mappings || []).filter((_, index) => index !== rowIndex),
    }));
  }

  async function createWebhook() {
    if (creatingWebhook || !item?.id) return;
    setCreatingWebhook(true);
    setError("");
    try {
      await apiFetch("/integrations/webhooks", {
        method: "POST",
        body: {
          connection_id: item.id,
          direction: newWebhook.direction,
          event_key: newWebhook.event_key.trim(),
          endpoint_path: newWebhook.endpoint_path.trim() || null,
          signing_secret_id: newWebhook.signing_secret_id || null,
          config_json: safeJsonParse(newWebhook.config_json_text, {}),
        },
      });
      setNewWebhook({
        direction: "inbound",
        event_key: "",
        endpoint_path: "",
        signing_secret_id: "",
        config_json_text: "{}",
      });
      setNotice(detailT("notices.webhook_added"));
      await load();
    } catch (err) {
      setError(err?.message || detailT("errors.create_webhook"));
    } finally {
      setCreatingWebhook(false);
    }
  }

  async function deleteWebhook(webhookId) {
    try {
      await apiFetch(`/integrations/webhooks/${encodeURIComponent(webhookId)}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err?.message || detailT("errors.delete_webhook"));
    }
  }

  async function deleteMapping(mappingId) {
    try {
      await apiFetch(`/integrations/mappings/${encodeURIComponent(mappingId)}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err?.message || detailT("errors.delete_mapping"));
    }
  }

  function renderSetupField(rawField) {
    const field = typeof rawField === "string" ? { id: rawField } : rawField;
    if (!field || typeof field !== "object" || !field.id) return null;
    const fieldId = field.id;
    const fieldType = field.type || "text";
    const label = field.label || fieldId.replaceAll("_", " ");
    const help = field.help || "";
    const placeholder = field.placeholder || "";
    const readOnly = isXeroProvider && XERO_READONLY_SETUP_FIELDS.has(fieldId);
    const showWhen = field.show_when;
    if (showWhen && typeof showWhen === "object") {
      const actualValue = config?.[showWhen.field];
      if (Array.isArray(showWhen.in) && !showWhen.in.includes(actualValue)) return null;
      if (Object.prototype.hasOwnProperty.call(showWhen, "eq") && actualValue !== showWhen.eq) return null;
    }
    if (fieldType === "select" || fieldId === "auth_mode" || fieldId === "api_key_in") {
      const options = Array.isArray(field.options)
        ? field.options
        : fieldId === "auth_mode"
          ? (providerManifest?.supported_auth_modes || ["none", "bearer", "api_key", "basic"])
          : ["header", "query"];
      const defaultValue = fieldId === "auth_mode" ? "none" : fieldId === "api_key_in" ? "header" : "";
      return (
        <label key={fieldId} className="form-control">
          <span className="label-text text-sm">{label}</span>
          <AppSelect className="select select-bordered" value={config?.[fieldId] || defaultValue} onChange={(e) => updateConfigField(fieldId, e.target.value)} disabled={saving}>
            {options.map((option) => {
              const normalized = typeof option === "string" ? { value: option, label: option } : option;
              return (
                <option key={normalized.value} value={normalized.value}>
                  {normalized.label || normalized.value}
                </option>
              );
            })}
          </AppSelect>
          {help ? <span className="label-text-alt opacity-70 mt-1">{help}</span> : null}
        </label>
      );
    }
    if (fieldType === "json" || fieldId === "default_headers" || fieldId === "test_request") {
      return (
        <JsonField
          key={fieldId}
          label={label}
          value={prettyJson(config?.[fieldId] || {})}
          onChange={(text) => updateConfigField(fieldId, safeJsonParse(text, {}))}
          help={help}
          minHeight={fieldId === "test_request" ? "10rem" : "8rem"}
          disabled={readOnly}
        />
      );
    }
    if (fieldType === "number") {
      return (
        <label key={fieldId} className="form-control">
          <span className="label-text text-sm">{label}</span>
          <input
            className="input input-bordered"
            inputMode="numeric"
            value={config?.[fieldId] ?? ""}
            onChange={(e) => updateConfigField(fieldId, e.target.value)}
            disabled={saving || readOnly}
            readOnly={readOnly}
            placeholder={placeholder}
          />
          {help ? <span className="label-text-alt opacity-70 mt-1">{help}</span> : null}
        </label>
      );
    }
    if (fieldType === "boolean") {
      return (
        <label key={fieldId} className="form-control">
          <label className="label cursor-pointer justify-start gap-3">
            <input
              type="checkbox"
              className="toggle toggle-sm"
              checked={Boolean(config?.[fieldId])}
              onChange={(e) => updateConfigField(fieldId, e.target.checked)}
              disabled={saving || readOnly}
            />
            <span className="label-text text-sm">{label}</span>
          </label>
          {help ? <span className="label-text-alt opacity-70 mt-1">{help}</span> : null}
        </label>
      );
    }
    return (
      <label key={fieldId} className="form-control">
        <span className="label-text text-sm">{label}</span>
        <input
          className="input input-bordered"
          value={config?.[fieldId] || ""}
          onChange={(e) => updateConfigField(fieldId, e.target.value)}
          disabled={saving || readOnly}
          readOnly={readOnly}
          placeholder={placeholder}
        />
        {help ? <span className="label-text-alt opacity-70 mt-1">{help}</span> : null}
      </label>
    );
  }

  function renderSyncField(rawField) {
    const field = typeof rawField === "string" ? { id: rawField } : rawField;
    if (!field || typeof field !== "object" || !field.id) return null;
    const fieldId = field.id;
    const fieldType = field.type || "text";
    const label = field.label || fieldId.replaceAll("_", " ");
    const help = field.help || "";
    const placeholder = field.placeholder || "";
    const syncConfig = config?.sync || {};
    const syncRequest = syncConfig?.request || {};
    if (fieldType === "request_builder") {
      return (
        <Section key={fieldId} title={label} help={help || detailT("sync.request_builder_help")}>
          <div className="space-y-3">
            <label className="form-control">
              <span className="label-text text-sm">{detailT("request.method")}</span>
              <AppSelect className="select select-bordered" value={syncRequest.method || "GET"} onChange={(e) => updateSyncRequestField("method", e.target.value)}>
                {["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </AppSelect>
            </label>
            <label className="form-control">
              <span className="label-text text-sm">{detailT("request.path")}</span>
              <input className="input input-bordered" value={syncRequest.path || ""} onChange={(e) => updateSyncRequestField("path", e.target.value)} placeholder={detailT("sync.path_placeholder")} />
              <span className="label-text-alt opacity-70 mt-1">{detailT("sync.path_help")}</span>
            </label>
            <label className="form-control">
              <span className="label-text text-sm">{detailT("request.url_override")}</span>
              <input className="input input-bordered" value={syncRequest.url || ""} onChange={(e) => updateSyncRequestField("url", e.target.value)} placeholder={detailT("request.url_placeholder")} />
            </label>
            <JsonField label={detailT("request.headers")} value={prettyJson(syncRequest.headers || {})} onChange={(text) => updateSyncRequestField("headers", safeJsonParse(text, {}))} minHeight="7rem" />
            <JsonField label={detailT("request.query")} value={prettyJson(syncRequest.query || {})} onChange={(text) => updateSyncRequestField("query", safeJsonParse(text, {}))} minHeight="7rem" />
            <JsonField label={detailT("request.json_body")} value={prettyJson(syncRequest.json || {})} onChange={(text) => updateSyncRequestField("json", safeJsonParse(text, {}))} minHeight="8rem" help={detailT("sync.json_help")} />
            <label className="form-control">
              <span className="label-text text-sm">{detailT("request.raw_body")}</span>
              <textarea className="textarea textarea-bordered min-h-[7rem]" value={syncRequest.body || ""} onChange={(e) => updateSyncRequestField("body", e.target.value)} />
            </label>
          </div>
        </Section>
      );
    }
    if (fieldType === "boolean") {
      return (
        <label key={fieldId} className="form-control">
          <label className="label cursor-pointer justify-start gap-3">
            <input type="checkbox" className="toggle toggle-sm" checked={Boolean(syncConfig?.[fieldId])} onChange={(e) => updateSyncField(fieldId, e.target.checked)} />
            <span className="label-text text-sm">{label}</span>
          </label>
          {help ? <span className="label-text-alt opacity-70 mt-1">{help}</span> : null}
        </label>
      );
    }
    if (fieldType === "number") {
      return (
        <label key={fieldId} className="form-control">
          <span className="label-text text-sm">{label}</span>
          <input className="input input-bordered" inputMode="numeric" value={syncConfig?.[fieldId] ?? ""} onChange={(e) => updateSyncField(fieldId, e.target.value)} placeholder={placeholder} />
          {help ? <span className="label-text-alt opacity-70 mt-1">{help}</span> : null}
        </label>
      );
    }
    return (
      <label key={fieldId} className="form-control">
        <span className="label-text text-sm">{label}</span>
        <input className="input input-bordered" value={syncConfig?.[fieldId] || ""} onChange={(e) => updateSyncField(fieldId, e.target.value)} placeholder={placeholder} />
        {help ? <span className="label-text-alt opacity-70 mt-1">{help}</span> : null}
      </label>
    );
  }

  const secretsById = useMemo(() => {
    const map = new Map();
    for (const secret of secrets || []) {
      if (secret?.id) map.set(secret.id, secret);
    }
    return map;
  }, [secrets]);
  const linkedSecretCount = useMemo(
    () => (requiresManualSecrets ? secretKeys.filter((secretKey) => Boolean(secretRefs?.[secretKey])).length : 0),
    [requiresManualSecrets, secretKeys, secretRefs],
  );
  const hasTestedConnection = Boolean(item?.last_tested_at);
  const setupGuideSteps = useMemo(
    () => {
      const steps = [
        {
          icon: ShieldCheck,
          title: detailT("setup.guide.review_title"),
          description: detailT("setup.guide.review_description"),
          actionLabel: "",
          onAction: null,
          complete: Boolean((name || "").trim()) && setupFields.length > 0 ? true : Boolean((name || "").trim() && Object.keys(config || {}).length > 0),
        },
      ];
      if (isXeroProvider) {
        steps.push({
          icon: KeyRound,
          title: "Connect the workspace to Xero",
          description: config?.xero_tenant_id
            ? `Connected to ${config?.xero_tenant_name || "the selected Xero organisation"}.`
            : "Use the shared Octodrop Xero app to sign in and approve this workspace. No manual client secret or code paste is required here.",
          actionLabel: "",
          onAction: null,
          complete: Boolean(config?.xero_tenant_id),
        });
      } else {
        steps.push({
          icon: KeyRound,
          title: detailT("setup.guide.attach_secrets_title"),
          description: secretKeys.length
            ? detailT("setup.guide.attach_secrets_progress", { linked: linkedSecretCount, total: secretKeys.length })
            : detailT("secrets.none_declared"),
          actionLabel: secretKeys.length ? detailT("setup.guide.open_secrets") : "",
          onAction: secretKeys.length ? () => setActiveTab("secrets") : null,
          complete: secretKeys.length === 0 || linkedSecretCount === secretKeys.length,
        });
      }
      steps.push({
        icon: TestTube2,
        title: detailT("setup.guide.test_title"),
        description: hasTestedConnection
          ? detailT("setup.guide.last_tested", { value: formatDateTime(item?.last_tested_at, detailT("setup.guide.recently")) })
          : detailT("setup.guide.test_description"),
        actionLabel: detailT("setup.guide.test_now"),
        onAction: runTest,
        complete: Boolean(item?.health_status && item.health_status !== "error" && hasTestedConnection),
      });
      return steps;
    },
    [config, detailT, hasTestedConnection, isXeroProvider, item?.health_status, item?.last_tested_at, linkedSecretCount, name, secretKeys, setupFields.length, t],
  );

  function secretsForSlot(secretKey) {
    return [...(secrets || [])].sort((a, b) => {
      const score = (secret) => {
        let total = 0;
        if (secret?.provider_key && secret.provider_key === providerKey) total += 4;
        if (secret?.secret_key && secret.secret_key === secretKey) total += 8;
        if (!secret?.provider_key) total += 1;
        return total;
      };
      return score(b) - score(a) || String(a?.name || a?.id || "").localeCompare(String(b?.name || b?.id || ""));
    });
  }

  return (
    <TabbedPaneShell
      title=""
      subtitle=""
      tabs={tabs}
      activeTabId={activeTab}
      onTabChange={setActiveTab}
      mobilePrimaryActions={[]}
      mobileOverflowActions={[]}
      rightActions={null}
    >
      {error ? <div className="alert alert-error text-sm mb-4">{error}</div> : null}
      {notice ? <div className="alert alert-success text-sm mb-4">{notice}</div> : null}

      <div className="space-y-4">
        {loading ? (
          <div className="text-sm opacity-70">{t("common.loading")}</div>
        ) : !item ? (
          <div className="text-sm opacity-60">{t("settings.integrations.detail.connection_not_found")}</div>
        ) : activeTab === "secrets" ? (
          <div className="space-y-4">
            <Section title={t("settings.integrations.detail.secrets.title")} help={t("settings.integrations.detail.secrets.help")}>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <SummaryStat label={t("settings.integrations.detail.secrets.required_slots")} value={String(secretKeys.length)} />
                <SummaryStat label={t("settings.integrations.detail.secrets.linked")} value={`${linkedSecretCount}/${secretKeys.length || 0}`} />
                <SummaryStat label={t("settings.integrations.detail.secrets.reusable_secrets")} value={String(secrets.length)} />
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-sm btn-primary" type="button" onClick={() => openCreateSecretModal("")}>
                  <Plus className="h-4 w-4" />
                  {t("settings.integrations.detail.secrets.new_secret")}
                </button>
                <button className="btn btn-sm btn-outline" type="button" onClick={() => navigate("/settings/secrets")}>
                  {t("settings.integrations.detail.secrets.manage_all")}
                </button>
              </div>
              {secretKeys.length === 0 ? (
                <div className="text-sm opacity-60">{t("settings.integrations.detail.secrets.none_declared")}</div>
              ) : (
                <div className="space-y-4">
                  {secretKeys.map((secretKey) => {
                    const selectedSecret = secretsById.get(secretRefs?.[secretKey]);
                    return (
                      <div key={secretKey} className="rounded-box border border-base-300 bg-base-100 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="font-medium">{titleCase(secretKey)}</div>
                            <div className="mt-1 text-sm opacity-70">
                              {selectedSecret
                                ? t("settings.integrations.detail.secrets.currently_linked", { name: selectedSecret.name || selectedSecret.id })
                                : t("settings.integrations.detail.secrets.not_linked", { slot: titleCase(secretKey).toLowerCase() })}
                            </div>
                          </div>
                          <button className="btn btn-ghost btn-sm" type="button" onClick={() => openCreateSecretModal(secretKey)}>
                            <Plus className="h-4 w-4" />
                            {t("settings.integrations.detail.secrets.create_for_slot")}
                          </button>
                        </div>

                        <label className="form-control mt-3">
                          <span className="label-text text-sm">{t("settings.integrations.detail.secrets.select_stored_secret")}</span>
                          <AppSelect
                            className="select select-bordered"
                            value={secretRefs?.[secretKey] || ""}
                            onChange={(e) => updateSecretRef(secretKey, e.target.value)}
                            disabled={saving}
                          >
                            <option value="">{t("settings.integrations.detail.secrets.no_secret_selected")}</option>
                            {secretsForSlot(secretKey).map((secret) => (
                              <option key={secret.id} value={secret.id}>
                                {secret.name || secret.id}
                                {secret.provider_key || secret.secret_key
                                  ? ` • ${[secret.provider_key, secret.secret_key].filter(Boolean).join(" / ")}`
                                  : ""}
                              </option>
                            ))}
                          </AppSelect>
                          <span className="label-text-alt opacity-70 mt-1">
                            {t("settings.integrations.detail.secrets.matching_pairs_help")}
                          </span>
                        </label>

                        {selectedSecret ? (
                          <div className="mt-3 rounded-box bg-base-200 px-3 py-2 text-sm">
                            {t("settings.integrations.detail.secrets.linked_secret", { name: selectedSecret.name || selectedSecret.id })}
                            {selectedSecret.provider_key ? ` • ${t("settings.integrations.detail.secrets.provider_value", { value: selectedSecret.provider_key })}` : ""}
                            {selectedSecret.secret_key ? ` • ${t("settings.integrations.detail.secrets.slot_value", { value: selectedSecret.secret_key })}` : ""}
                            {selectedSecret.version ? ` • ${t("settings.integrations.detail.secrets.version_value", { value: selectedSecret.version })}` : ""}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-primary btn-sm" type="button" onClick={save} disabled={loading || saving || !item?.id}>
                  {saving ? t("common.saving") : t("common.save")}
                </button>
              </div>
            </Section>
          </div>
        ) : activeTab === "request" ? (
          <div className="space-y-4">
            <Section title={detailT("request.title")} help={detailT("request.help")}>
              <div className="space-y-3">
                <label className="form-control">
                  <span className="label-text text-sm">{detailT("request.method")}</span>
                  <AppSelect className="select select-bordered" value={requestForm.method} onChange={(e) => setRequestForm((prev) => ({ ...prev, method: e.target.value }))}>
                    {["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => (
                      <option key={method} value={method}>
                        {method}
                      </option>
                    ))}
                  </AppSelect>
                </label>
                <label className="form-control">
                  <span className="label-text text-sm">{detailT("request.path")}</span>
                  <input className="input input-bordered" value={requestForm.path} onChange={(e) => setRequestForm((prev) => ({ ...prev, path: e.target.value }))} placeholder={detailT("request.path_placeholder")} />
                  <span className="label-text-alt opacity-70 mt-1">{detailT("request.path_help")}</span>
                </label>
                <label className="form-control">
                  <span className="label-text text-sm">{detailT("request.url_override")}</span>
                  <input className="input input-bordered" value={requestForm.url} onChange={(e) => setRequestForm((prev) => ({ ...prev, url: e.target.value }))} placeholder={detailT("request.url_placeholder")} />
                </label>
                <JsonField label={detailT("request.headers")} value={requestForm.headersText} onChange={(text) => setRequestForm((prev) => ({ ...prev, headersText: text }))} minHeight="7rem" />
                <JsonField label={detailT("request.query")} value={requestForm.queryText} onChange={(text) => setRequestForm((prev) => ({ ...prev, queryText: text }))} minHeight="7rem" />
                <JsonField label={detailT("request.json_body")} value={requestForm.jsonText} onChange={(text) => setRequestForm((prev) => ({ ...prev, jsonText: text }))} minHeight="8rem" help={detailT("request.json_help")} />
                <label className="form-control">
                  <span className="label-text text-sm">{detailT("request.raw_body")}</span>
                  <textarea className="textarea textarea-bordered min-h-[7rem]" value={requestForm.bodyText} onChange={(e) => setRequestForm((prev) => ({ ...prev, bodyText: e.target.value }))} />
                </label>
                <div>
                  <button className="btn btn-primary btn-sm" type="button" onClick={runRequest} disabled={runningRequest}>
                    {runningRequest ? detailT("request.running") : detailT("request.run")}
                  </button>
                </div>
              </div>
            </Section>

            <Section title={detailT("request.latest_response_title")} help={detailT("request.latest_response_help")} tone="muted">
              {requestResult ? <pre className="rounded-box bg-base-200 p-3 text-xs overflow-auto">{JSON.stringify(requestResult, null, 2)}</pre> : <div className="text-sm opacity-60">{detailT("request.no_response")}</div>}
            </Section>
          </div>
        ) : activeTab === "sync" ? (
          <div className="space-y-4">
            <Section title={detailT("sync.title")} help={detailT("sync.help")}>
              <div className="space-y-3">
                {syncFields.length === 0 ? (
                  <div className="text-sm opacity-60">{detailT("sync.no_schema")}</div>
                ) : (
                  syncFields.map((field) => renderSyncField(field))
                )}
                <div>
                  <button className="btn btn-primary btn-sm" type="button" onClick={runSync} disabled={runningSync}>
                    {runningSync ? detailT("sync.running") : detailT("sync.run_now")}
                  </button>
                </div>
              </div>
            </Section>

            <Section title={detailT("sync.latest_result_title")} help={detailT("sync.latest_result_help")} tone="muted">
              {syncResult ? <pre className="rounded-box bg-base-200 p-3 text-xs overflow-auto">{JSON.stringify(syncResult, null, 2)}</pre> : <div className="text-sm opacity-60">{detailT("sync.no_result")}</div>}
            </Section>
          </div>
        ) : activeTab === "webhooks" ? (
          <div className="space-y-4">
            <Section title={detailT("webhooks.title")} help={detailT("webhooks.help")}>
              <div className="rounded-box border border-base-300 bg-base-200 p-3 text-sm">
                <div className="font-medium">{detailT("webhooks.signing_model_title")}</div>
                <div className="mt-1 opacity-80">{detailT("webhooks.signing_model_help")}</div>
              </div>
              <div className="space-y-3">
                <label className="form-control">
                  <span className="label-text text-sm">{detailT("webhooks.direction")}</span>
                  <AppSelect className="select select-bordered" value={newWebhook.direction} onChange={(e) => setNewWebhook((prev) => ({ ...prev, direction: e.target.value }))}>
                    <option value="inbound">{detailT("webhooks.direction_inbound")}</option>
                    <option value="outbound">{detailT("webhooks.direction_outbound")}</option>
                  </AppSelect>
                </label>
                <label className="form-control">
                  <span className="label-text text-sm">{detailT("webhooks.event_key")}</span>
                  <input className="input input-bordered" value={newWebhook.event_key} onChange={(e) => setNewWebhook((prev) => ({ ...prev, event_key: e.target.value }))} placeholder={detailT("webhooks.event_key_placeholder")} />
                </label>
                <label className="form-control">
                  <span className="label-text text-sm">{detailT("webhooks.endpoint_path")}</span>
                  <input className="input input-bordered" value={newWebhook.endpoint_path} onChange={(e) => setNewWebhook((prev) => ({ ...prev, endpoint_path: e.target.value }))} placeholder={detailT("webhooks.endpoint_path_placeholder")} />
                </label>
                <label className="form-control">
                  <span className="label-text text-sm">{detailT("webhooks.signing_secret")}</span>
                  <AppSelect className="select select-bordered" value={newWebhook.signing_secret_id} onChange={(e) => setNewWebhook((prev) => ({ ...prev, signing_secret_id: e.target.value }))}>
                    <option value="">{detailT("webhooks.no_signing_secret")}</option>
                    {(secrets || []).map((secret) => (
                      <option key={secret.id} value={secret.id}>
                        {secret.name || secret.id}
                      </option>
                    ))}
                  </AppSelect>
                </label>
                <JsonField label={detailT("webhooks.config")} value={newWebhook.config_json_text} onChange={(text) => setNewWebhook((prev) => ({ ...prev, config_json_text: text }))} minHeight="8rem" />
                <div>
                  <button className="btn btn-primary btn-sm" type="button" onClick={createWebhook} disabled={creatingWebhook || !newWebhook.event_key.trim()}>
                    {creatingWebhook ? detailT("webhooks.adding") : detailT("webhooks.add")}
                  </button>
                </div>
              </div>
            </Section>

            <TableList
              emptyLabel={detailT("webhooks.none")}
              columns={[
                { key: "direction", label: detailT("webhooks.direction") },
                { key: "event_key", label: detailT("webhooks.event_key") },
                { key: "status", label: t("common.status") },
                { key: "endpoint_path", label: detailT("webhooks.endpoint") },
                {
                  key: "actions",
                  label: "",
                  render: (row) => (
                    <button className="btn btn-ghost btn-xs text-error" type="button" onClick={() => deleteWebhook(row.id)}>
                      {t("common.delete")}
                    </button>
                  ),
                },
              ]}
              rows={webhooks}
            />
          </div>
        ) : activeTab === "mappings" ? (
          <div className="space-y-4">
            <Section title={detailT("mappings.title")} help={detailT("mappings.help")}>
              <div className="space-y-3">
                <label className="form-control">
                  <span className="label-text text-sm">{t("common.name")}</span>
                  <input className="input input-bordered" value={newMapping.name} onChange={(e) => setNewMapping((prev) => ({ ...prev, name: e.target.value }))} placeholder={detailT("mappings.name_placeholder")} />
                </label>
                <label className="form-control">
                  <span className="label-text text-sm">{detailT("mappings.source_entity")}</span>
                  <input className="input input-bordered" value={newMapping.source_entity} onChange={(e) => setNewMapping((prev) => ({ ...prev, source_entity: e.target.value }))} placeholder={detailT("mappings.source_entity_placeholder")} />
                  <span className="label-text-alt opacity-70 mt-1">{detailT("mappings.source_entity_help")}</span>
                </label>
                <label className="form-control">
                  <span className="label-text text-sm">{detailT("mappings.target_entity")}</span>
                  <input className="input input-bordered" value={newMapping.target_entity} onChange={(e) => setNewMapping((prev) => ({ ...prev, target_entity: e.target.value }))} placeholder={detailT("mappings.target_entity_placeholder")} />
                  <span className="label-text-alt opacity-70 mt-1">{detailT("mappings.target_entity_help")}</span>
                </label>
                <label className="form-control">
                  <span className="label-text text-sm">{detailT("mappings.resource_key")}</span>
                  <input className="input input-bordered" value={newMapping.resource_key} onChange={(e) => setNewMapping((prev) => ({ ...prev, resource_key: e.target.value }))} placeholder={detailT("mappings.resource_key_placeholder")} />
                  <span className="label-text-alt opacity-70 mt-1">{detailT("mappings.resource_key_help")}</span>
                </label>
                <label className="form-control">
                  <span className="label-text text-sm">{detailT("mappings.record_mode")}</span>
                  <AppSelect className="select select-bordered" value={newMapping.record_mode} onChange={(e) => setNewMapping((prev) => ({ ...prev, record_mode: e.target.value }))}>
                    <option value="upsert">{detailT("mappings.record_mode_upsert")}</option>
                    <option value="create">{detailT("mappings.record_mode_create")}</option>
                  </AppSelect>
                </label>
                {newMapping.record_mode === "upsert" ? (
                  <label className="form-control">
                    <span className="label-text text-sm">{detailT("mappings.match_on")}</span>
                    <input className="input input-bordered" value={newMapping.match_on_text} onChange={(e) => setNewMapping((prev) => ({ ...prev, match_on_text: e.target.value }))} placeholder={detailT("mappings.match_on_placeholder")} />
                    <span className="label-text-alt opacity-70 mt-1">{detailT("mappings.match_on_help")}</span>
                  </label>
                ) : null}

                <Section title={detailT("mappings.field_mappings_title")} help={detailT("mappings.field_mappings_help")}>
                  <div className="space-y-3">
                    {(newMapping.field_mappings || []).map((row, index) => (
                      <div key={index} className="rounded-box border border-base-300 bg-base-100 p-3 space-y-3">
                        <label className="form-control">
                          <span className="label-text text-sm">{detailT("mappings.target_field")}</span>
                          <input
                            className="input input-bordered"
                            value={row.to}
                            onChange={(e) => updateFieldMappingRow(index, { to: e.target.value })}
                            placeholder={detailT("mappings.target_field_placeholder")}
                          />
                        </label>
                        <label className="form-control">
                          <span className="label-text text-sm">{detailT("mappings.value_source")}</span>
                          <AppSelect
                            className="select select-bordered"
                            value={row.value_type}
                            onChange={(e) => updateFieldMappingRow(index, { value_type: e.target.value })}
                          >
                            <option value="path">{detailT("mappings.value_source_path")}</option>
                            <option value="constant">{detailT("mappings.value_source_constant")}</option>
                            <option value="ref">{detailT("mappings.value_source_ref")}</option>
                          </AppSelect>
                        </label>
                        <label className="form-control">
                          <span className="label-text text-sm">{row.value_type === "constant" ? detailT("mappings.value_source_constant") : row.value_type === "ref" ? detailT("mappings.reference") : detailT("mappings.source_path")}</span>
                          <input
                            className="input input-bordered"
                            value={row.source}
                            onChange={(e) => updateFieldMappingRow(index, { source: e.target.value })}
                            placeholder={row.value_type === "constant" ? detailT("mappings.constant_placeholder") : row.value_type === "ref" ? detailT("mappings.reference_placeholder") : detailT("mappings.source_path_placeholder")}
                          />
                        </label>
                        <label className="form-control">
                          <span className="label-text text-sm">{detailT("mappings.transform")}</span>
                          <AppSelect
                            className="select select-bordered"
                            value={row.transform || ""}
                            onChange={(e) => updateFieldMappingRow(index, { transform: e.target.value })}
                          >
                            <option value="">{detailT("mappings.no_transform")}</option>
                            <option value="trim">{detailT("mappings.transform_trim")}</option>
                            <option value="lower">{detailT("mappings.transform_lower")}</option>
                            <option value="upper">{detailT("mappings.transform_upper")}</option>
                            <option value="string">{detailT("mappings.transform_string")}</option>
                            <option value="number">{detailT("mappings.transform_number")}</option>
                            <option value="integer">{detailT("mappings.transform_integer")}</option>
                            <option value="boolean">{detailT("mappings.transform_boolean")}</option>
                            <option value="null_if_empty">{detailT("mappings.transform_null_if_empty")}</option>
                          </AppSelect>
                        </label>
                        <div className="flex justify-end">
                          <button className="btn btn-ghost btn-sm text-error" type="button" onClick={() => removeFieldMappingRow(index)} disabled={(newMapping.field_mappings || []).length <= 1}>
                            {detailT("mappings.remove_row")}
                          </button>
                        </div>
                      </div>
                    ))}
                    <button className="btn btn-sm btn-outline" type="button" onClick={addFieldMappingRow}>
                      <Plus className="h-4 w-4" />
                      {detailT("mappings.add_field_mapping")}
                    </button>
                  </div>
                </Section>

                <Section title={detailT("mappings.preview_title")} help={detailT("mappings.preview_help")}>
                  <div className="space-y-3">
                    <JsonField label={detailT("mappings.sample_source_record")} value={newMapping.sample_source_text} onChange={(text) => setNewMapping((prev) => ({ ...prev, sample_source_text: text }))} minHeight="10rem" />
                    <div className="flex flex-wrap gap-2">
                      <button className="btn btn-sm btn-outline" type="button" onClick={previewMapping} disabled={previewingMapping}>
                        {previewingMapping ? detailT("mappings.previewing") : detailT("mappings.preview_action")}
                      </button>
                    </div>
                    {mappingPreview ? (
                      <pre className="rounded-box bg-base-200 p-3 text-xs overflow-auto">{JSON.stringify(mappingPreview, null, 2)}</pre>
                    ) : (
                      <div className="text-sm opacity-60">{detailT("mappings.no_preview")}</div>
                    )}
                  </div>
                </Section>

                <details className="collapse collapse-arrow border border-base-300 bg-base-100">
                  <summary className="collapse-title text-sm font-medium">{detailT("mappings.advanced_json_title")}</summary>
                  <div className="collapse-content">
                    <JsonField
                      label={detailT("mappings.advanced_overrides")}
                      value={newMapping.mapping_json_text}
                      onChange={(text) => setNewMapping((prev) => ({ ...prev, mapping_json_text: text }))}
                      minHeight="10rem"
                      help={detailT("mappings.advanced_overrides_help")}
                    />
                  </div>
                </details>

                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-primary btn-sm" type="button" onClick={createMapping} disabled={creatingMapping || !newMapping.name.trim() || !newMapping.source_entity.trim() || !newMapping.target_entity.trim()}>
                    {creatingMapping ? detailT("mappings.adding") : detailT("mappings.add")}
                  </button>
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => { setNewMapping(defaultNewMappingState()); setMappingPreview(null); }}>
                    {detailT("mappings.reset")}
                  </button>
                </div>
              </div>
            </Section>

            <TableList
              emptyLabel={detailT("mappings.none")}
              columns={[
                { key: "name", label: t("common.name") },
                { key: "resource", label: detailT("mappings.resource"), render: (row) => row.mapping_json?.resource_key || "—" },
                { key: "source_entity", label: detailT("mappings.source") },
                { key: "target_entity", label: detailT("mappings.target") },
                { key: "mode", label: detailT("mappings.mode"), render: (row) => row.mapping_json?.record_mode || row.mapping_json?.mode || "create" },
                {
                  key: "actions",
                  label: "",
                  render: (row) => (
                    <button className="btn btn-ghost btn-xs text-error" type="button" onClick={() => deleteMapping(row.id)}>
                      {t("common.delete")}
                    </button>
                  ),
                },
              ]}
              rows={mappings}
            />
          </div>
        ) : activeTab === "logs" ? (
          <div className="space-y-4">
            <Section title={detailT("logs.request_title")} help={detailT("logs.request_help")} tone="muted">
              <TableList
                emptyLabel={detailT("logs.request_none")}
                columns={[
                  { key: "created_at", label: detailT("logs.when"), render: (row) => formatDateTime(row.created_at, "—") },
                  { key: "source", label: detailT("logs.source") },
                  { key: "method", label: detailT("logs.method") },
                  { key: "url", label: detailT("logs.url") },
                  { key: "response_status", label: t("common.status") },
                ]}
                rows={requestLogs}
              />
            </Section>

            <Section title={detailT("logs.webhook_events_title")} help={detailT("logs.webhook_events_help")} tone="muted">
              <TableList
                emptyLabel={detailT("logs.webhook_events_none")}
                columns={[
                  { key: "received_at", label: detailT("logs.received"), render: (row) => formatDateTime(row.received_at, "—") },
                  { key: "event_key", label: detailT("webhooks.event_key") },
                  { key: "status", label: t("common.status") },
                  { key: "provider_event_id", label: detailT("logs.provider_event_id") },
                ]}
                rows={webhookEvents}
              />
            </Section>

            <Section title={detailT("logs.sync_checkpoints_title")} help={detailT("logs.sync_checkpoints_help")} tone="muted">
              <TableList
                emptyLabel={detailT("logs.sync_checkpoints_none")}
                columns={[
                  { key: "scope_key", label: detailT("logs.scope") },
                  { key: "cursor_value", label: detailT("logs.cursor") },
                  { key: "status", label: t("common.status") },
                  { key: "updated_at", label: t("common.updated"), render: (row) => formatDateTime(row.updated_at, "—") },
                ]}
                rows={checkpoints}
              />
            </Section>
          </div>
        ) : (
          <div className="space-y-4">
            <Section title={detailT("setup.guide.title")} help={detailT("setup.guide.help")} tone="muted">
              <div className="space-y-3">
                {setupGuideSteps.map((step) => (
                  <SetupGuideStep key={step.title} {...step} />
                ))}
              </div>
            </Section>

            <Section title={detailT("setup.connection_setup_title")} help={detailT("setup.connection_setup_help")}>
              <div className="space-y-3">
                <label className="form-control">
                  <span className="label-text text-sm">{detailT("setup.connection_name")}</span>
                  <input className="input input-bordered" value={name} onChange={(e) => setName(e.target.value)} disabled={saving} />
                </label>

                <label className="form-control">
                  <span className="label-text text-sm">{t("common.status")}</span>
                  <AppSelect className="select select-bordered" value={status} onChange={(e) => setStatus(e.target.value)} disabled={saving}>
                    <option value="active">{detailT("setup.status_active")}</option>
                    <option value="disabled">{detailT("setup.status_disabled")}</option>
                  </AppSelect>
                </label>

                {isXeroProvider ? (
                  <Section
                    title="Xero connection"
                    help="This workspace uses the shared Octodrop Xero app. The only required step here is approving access in Xero, then Octodrop stores the tokens and tenant automatically."
                  >
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="rounded-box bg-base-200 px-3 py-2 text-sm">
                        <div className="text-xs uppercase tracking-wide opacity-60">OAuth app</div>
                        <div className="mt-1">Shared Octodrop Xero app</div>
                      </div>
                      <div className="rounded-box bg-base-200 px-3 py-2 text-sm">
                        <div className="text-xs uppercase tracking-wide opacity-60">Redirect URI</div>
                        <div className="mt-1 break-all">{oauthRedirectUri || "—"}</div>
                      </div>
                      <div className="rounded-box bg-base-200 px-3 py-2 text-sm">
                        <div className="text-xs uppercase tracking-wide opacity-60">Scopes</div>
                        <div className="mt-1 break-words">{String(config?.oauth_scope || "").trim() || "—"}</div>
                      </div>
                      <div className="rounded-box bg-base-200 px-3 py-2 text-sm">
                        <div className="text-xs uppercase tracking-wide opacity-60">Selected tenant</div>
                        <div className="mt-1">{config?.xero_tenant_name || "Not connected yet"}</div>
                      </div>
                    </div>
                  </Section>
                ) : null}

                {visibleSetupGroups
                  .filter(([groupKey]) => groupKey !== "advanced")
                  .map(([groupKey, fields]) => (
                    <Section
                      key={groupKey}
                      title={groupKey === "connection" ? detailT("setup.provider_settings") : titleCase(groupKey)}
                      help={
                        groupKey === "connection"
                          ? detailT("setup.provider_settings_help")
                          : detailT("setup.group_help")
                      }
                    >
                      <div className="space-y-3">{fields.map((field) => renderSetupField(field))}</div>
                    </Section>
                  ))}

                {authMode === "oauth2" ? (
                  <Section
                    title={isXeroProvider ? "Connect to Xero" : detailT("setup.oauth_title")}
                    help={isXeroProvider ? "Open the Xero login, approve access for this workspace, and the callback will complete the token exchange automatically." : detailT("setup.oauth_help")}
                  >
                    <div className="space-y-3">
                      <label className="form-control">
                        <span className="label-text text-sm">{detailT("setup.redirect_uri")}</span>
                        <input
                          className="input input-bordered"
                          value={oauthRedirectUri}
                          onChange={(e) => setOauthRedirectUri(e.target.value)}
                          placeholder={detailT("setup.redirect_uri_placeholder")}
                          readOnly={isXeroProvider}
                          disabled={isXeroProvider}
                        />
                        <span className="label-text-alt opacity-70 mt-1">
                          {isXeroProvider ? "This must exactly match the redirect URI registered on the Octodrop Xero app." : detailT("setup.redirect_uri_help")}
                        </span>
                      </label>

                      <div className="flex flex-wrap gap-2">
                        <button className="btn btn-sm btn-outline" type="button" onClick={generateOauthAuthorizeUrl} disabled={authorizingOAuth || !oauthRedirectUri.trim()}>
                          {authorizingOAuth ? detailT("setup.generating") : isXeroProvider ? "Generate Xero login" : detailT("setup.generate_authorize_url")}
                        </button>
                        <button className="btn btn-sm btn-outline" type="button" onClick={refreshOauthTokens} disabled={refreshingOAuth}>
                          {refreshingOAuth ? detailT("setup.refreshing") : detailT("setup.refresh_tokens")}
                        </button>
                      </div>

                      {oauthAuthorizeResult?.authorize_url ? (
                        <div className="space-y-2 rounded-box border border-base-300 bg-base-200/60 p-3">
                          <div className="text-sm font-medium">{detailT("setup.authorize_url")}</div>
                          <textarea className="textarea textarea-bordered min-h-[7rem] w-full text-xs" readOnly value={oauthAuthorizeResult.authorize_url} />
                          <div className="flex flex-wrap gap-2">
                            <a className="btn btn-sm btn-primary" href={oauthAuthorizeResult.authorize_url} target="_blank" rel="noreferrer">
                              {isXeroProvider ? "Open Xero login" : detailT("setup.open_provider_login")}
                            </a>
                          </div>
                        </div>
                      ) : null}

                      {!isXeroProvider ? (
                        <>
                          <label className="form-control">
                            <span className="label-text text-sm">{detailT("setup.authorization_code")}</span>
                            <input
                              className="input input-bordered"
                              value={oauthCode}
                              onChange={(e) => setOauthCode(e.target.value)}
                              placeholder={detailT("setup.authorization_code_placeholder")}
                            />
                            <span className="label-text-alt opacity-70 mt-1">{detailT("setup.authorization_code_help")}</span>
                          </label>

                          <div className="flex flex-wrap gap-2">
                            <button className="btn btn-sm btn-primary" type="button" onClick={exchangeOauthCode} disabled={exchangingOAuth || !oauthRedirectUri.trim() || !oauthCode.trim()}>
                              {exchangingOAuth ? detailT("setup.exchanging") : detailT("setup.exchange_code")}
                            </button>
                          </div>
                        </>
                      ) : null}

                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="rounded-box bg-base-200 px-3 py-2 text-sm">
                          <div className="text-xs uppercase tracking-wide opacity-60">{detailT("setup.access_token_expiry")}</div>
                          <div className="mt-1">{formatDateTime(config?.oauth_access_token_expires_at, "—")}</div>
                        </div>
                        <div className="rounded-box bg-base-200 px-3 py-2 text-sm">
                          <div className="text-xs uppercase tracking-wide opacity-60">{detailT("setup.last_token_refresh")}</div>
                          <div className="mt-1">{formatDateTime(config?.oauth_last_token_refresh_at, "—")}</div>
                        </div>
                      </div>
                    </div>
                  </Section>
                ) : null}

                <details className="collapse collapse-arrow border border-base-300 bg-base-100">
                  <summary className="collapse-title text-sm font-medium">{detailT("setup.advanced_config_title")}</summary>
                  <div className="collapse-content">
                    {visibleSetupGroups.some(([groupKey]) => groupKey === "advanced") ? (
                      <div className="mb-4 space-y-3">
                        <div className="text-sm opacity-70">{detailT("setup.advanced_config_help")}</div>
                        {visibleSetupGroups
                          .filter(([groupKey]) => groupKey === "advanced")
                          .flatMap(([, fields]) => fields)
                          .map((field) => renderSetupField(field))}
                      </div>
                    ) : null}
                    <JsonField
                      label={detailT("setup.full_config")}
                      value={configText}
                      onChange={(text) => {
                        setConfigText(text);
                        setConfig(safeJsonParse(text, config));
                      }}
                      minHeight="16rem"
                      help={detailT("setup.full_config_help")}
                    />
                  </div>
                </details>

                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-outline btn-sm" type="button" onClick={runTest} disabled={loading || testing || !item?.id}>
                    {testing ? detailT("setup.testing") : detailT("setup.test_connection")}
                  </button>
                  <button className="btn btn-primary btn-sm" type="button" onClick={save} disabled={loading || saving || !name.trim()}>
                    {saving ? t("common.saving") : t("common.save")}
                  </button>
                </div>
              </div>
            </Section>

            <Section title={detailT("setup.summary_title")} help={detailT("setup.summary_help")} tone="muted">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <SummaryStat label={detailT("setup.summary_provider")} value={provider?.name || providerKey} />
                <SummaryStat label={detailT("setup.summary_auth_type")} value={provider?.auth_type || config?.provider_auth_type} />
                <SummaryStat label={detailT("setup.summary_health")} value={item.health_status || detailT("setup.unknown")} />
                <SummaryStat label={t("common.status")} value={item.status} />
                <SummaryStat label={detailT("setup.summary_last_tested")} value={formatDateTime(item.last_tested_at, "—")} />
                <SummaryStat label={detailT("setup.summary_last_success")} value={formatDateTime(item.last_success_at, "—")} />
                <SummaryStat label={detailT("setup.summary_last_error")} value={item.last_error || "—"} />
                <SummaryStat label={t("common.updated")} value={formatDateTime(item.updated_at, "—")} />
              </div>
            </Section>

            <Section title={detailT("setup.latest_test_result_title")} help={detailT("setup.latest_test_result_help")} tone="muted">
              {testResult ? <pre className="rounded-box bg-base-200 p-3 text-xs overflow-auto">{JSON.stringify(testResult, null, 2)}</pre> : <div className="text-sm opacity-60">{detailT("setup.no_test_result")}</div>}
            </Section>
          </div>
        )}
      </div>

      {showCreateSecretModal ? (
        <SimpleModal
          title={createSecretTargetKey ? detailT("modal.create_secret_for_slot", { slot: titleCase(createSecretTargetKey) }) : detailT("modal.create_secret")}
          subtitle={detailT("modal.create_secret_help")}
          onClose={() => {
            if (!creatingSecret) setShowCreateSecretModal(false);
          }}
        >
          <div className="space-y-4">
            <label className="form-control">
              <span className="label-text text-sm">{t("common.name")}</span>
              <input
                className="input input-bordered"
                value={createSecretForm.name}
                onChange={(e) => setCreateSecretForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder={detailT("modal.secret_name_placeholder")}
                disabled={creatingSecret}
              />
              <span className="label-text-alt opacity-70 mt-1">{detailT("modal.secret_name_help")}</span>
            </label>

            <label className="form-control">
              <span className="label-text text-sm">{detailT("modal.provider_key")}</span>
              <input
                className="input input-bordered"
                value={createSecretForm.provider_key}
                onChange={(e) => setCreateSecretForm((prev) => ({ ...prev, provider_key: e.target.value }))}
                placeholder={detailT("modal.provider_key_placeholder")}
                disabled={creatingSecret}
              />
            </label>

            <label className="form-control">
              <span className="label-text text-sm">{detailT("modal.secret_slot")}</span>
              <input
                className="input input-bordered"
                value={createSecretForm.secret_key}
                onChange={(e) => setCreateSecretForm((prev) => ({ ...prev, secret_key: e.target.value }))}
                placeholder={detailT("modal.secret_slot_placeholder")}
                disabled={creatingSecret}
              />
              <span className="label-text-alt opacity-70 mt-1">{detailT("modal.secret_slot_help")}</span>
            </label>

            <label className="form-control">
              <span className="label-text text-sm">{t("common.status")}</span>
              <AppSelect
                className="select select-bordered"
                value={createSecretForm.status}
                onChange={(e) => setCreateSecretForm((prev) => ({ ...prev, status: e.target.value }))}
                disabled={creatingSecret}
              >
                <option value="active">{detailT("setup.status_active")}</option>
                <option value="disabled">{detailT("setup.status_disabled")}</option>
              </AppSelect>
            </label>

            <label className="form-control">
              <span className="label-text text-sm">{detailT("modal.secret_value")}</span>
              <textarea
                className="textarea textarea-bordered min-h-[8rem]"
                value={createSecretForm.value}
                onChange={(e) => setCreateSecretForm((prev) => ({ ...prev, value: e.target.value }))}
                placeholder={detailT("modal.secret_value_placeholder")}
                disabled={creatingSecret}
              />
              <span className="label-text-alt opacity-70 mt-1">{detailT("modal.secret_value_help")}</span>
            </label>

            <div className="flex items-center justify-end gap-2">
              <button className="btn btn-ghost" type="button" onClick={() => setShowCreateSecretModal(false)} disabled={creatingSecret}>
                {t("common.cancel")}
              </button>
              <button className="btn btn-primary" type="button" onClick={createSecretForConnection} disabled={creatingSecret || !createSecretForm.value.trim()}>
                {creatingSecret ? detailT("modal.creating") : detailT("modal.create_secret")}
              </button>
            </div>
          </div>
        </SimpleModal>
      ) : null}
    </TabbedPaneShell>
  );
}
