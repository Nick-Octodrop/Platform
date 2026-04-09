import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowRight, CheckCircle2, Circle, KeyRound, Plus, ShieldCheck, TestTube2 } from "lucide-react";
import { apiFetch } from "../api.js";
import AppSelect from "../components/AppSelect.jsx";
import TabbedPaneShell from "../ui/TabbedPaneShell.jsx";
import { formatDateTime } from "../utils/dateTime.js";

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
      setError(err?.message || "Failed to load connection");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [connectionId]);

  useEffect(() => {
    if (!connectionId || typeof window === "undefined") return;
    const nextRedirectUri = `${window.location.origin}/integrations/connections/${connectionId}`;
    setOauthRedirectUri((prev) => prev || nextRedirectUri);
    const params = new URLSearchParams(window.location.search);
    const returnedCode = params.get("code");
    if (returnedCode) {
      setOauthCode((prev) => prev || returnedCode);
    }
  }, [connectionId]);

  const providerIndex = useMemo(() => {
    const map = new Map();
    for (const provider of providers || []) {
      if (provider?.key) map.set(provider.key, provider);
    }
    return map;
  }, [providers]);

  const providerKey = providerKeyFromType(item?.type);
  const provider = providerIndex.get(providerKey) || null;
  const providerManifest = provider?.manifest_json || {};
  const providerCapabilities = Array.isArray(providerManifest?.capabilities) ? providerManifest.capabilities : [];
  const providerSupportsSync = providerCapabilities.includes("sync.poll");
  const authMode = String(config?.auth_mode || config?.provider_auth_type || "").trim().toLowerCase();
  const setupFields = Array.isArray(providerManifest?.setup_schema?.fields) ? providerManifest.setup_schema.fields : [];
  const syncFields = Array.isArray(providerManifest?.sync_schema?.fields) ? providerManifest.sync_schema.fields : [];
  const secretKeys = Array.isArray(providerManifest?.secret_keys) ? providerManifest.secret_keys : [];
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

  const tabs = useMemo(
    () => [
      { id: "setup", label: "Setup" },
      { id: "secrets", label: "Secrets" },
      { id: "request", label: "Request" },
      ...(providerSupportsSync ? [{ id: "sync", label: "Sync" }] : []),
      { id: "webhooks", label: "Webhooks" },
      { id: "mappings", label: "Mappings" },
      { id: "logs", label: "Logs" },
    ],
    [providerSupportsSync],
  );

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
      setNotice("Secret created.");
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
      setError(err?.message || "Failed to create secret");
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
      setNotice("Connection saved.");
      await load();
    } catch (err) {
      setError(err?.message || "Save failed");
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
      setNotice("Connection test completed.");
      await load();
    } catch (err) {
      setTestResult(null);
      setError(err?.message || "Connection test failed");
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
      setNotice("Request completed.");
      await load();
    } catch (err) {
      setRequestResult(null);
      setError(err?.message || "Request failed");
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
      setNotice("Sync completed.");
      await load();
    } catch (err) {
      setSyncResult(null);
      setError(err?.message || "Sync failed");
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
      const res = await apiFetch(`/integrations/connections/${encodeURIComponent(item.id)}/oauth/authorize-url`, {
        method: "POST",
        body: { redirect_uri: oauthRedirectUri.trim() },
      });
      setOauthAuthorizeResult(res?.result || null);
      setNotice("Authorize URL generated.");
    } catch (err) {
      setOauthAuthorizeResult(null);
      setError(err?.message || "Failed to generate authorize URL");
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
      setNotice("OAuth tokens stored.");
      setOauthAuthorizeResult(null);
      await load();
      if (res?.result?.connection) {
        setItem(res.result.connection);
        setConfig(res.result.connection.config || {});
        setConfigText(prettyJson(res.result.connection.config || {}));
      }
    } catch (err) {
      setError(err?.message || "Failed to exchange OAuth code");
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
      setNotice("OAuth tokens refreshed.");
      await load();
      if (res?.result?.connection) {
        setItem(res.result.connection);
        setConfig(res.result.connection.config || {});
        setConfigText(prettyJson(res.result.connection.config || {}));
      }
    } catch (err) {
      setError(err?.message || "Failed to refresh OAuth tokens");
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
      setNotice("Mapping added.");
      await load();
    } catch (err) {
      setError(err?.message || "Failed to create mapping");
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
      setError(err?.message || "Failed to preview mapping");
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
      setNotice("Webhook added.");
      await load();
    } catch (err) {
      setError(err?.message || "Failed to create webhook");
    } finally {
      setCreatingWebhook(false);
    }
  }

  async function deleteWebhook(webhookId) {
    try {
      await apiFetch(`/integrations/webhooks/${encodeURIComponent(webhookId)}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err?.message || "Failed to delete webhook");
    }
  }

  async function deleteMapping(mappingId) {
    try {
      await apiFetch(`/integrations/mappings/${encodeURIComponent(mappingId)}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err?.message || "Failed to delete mapping");
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
            disabled={saving}
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
              disabled={saving}
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
          disabled={saving}
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
        <Section key={fieldId} title={label} help={help || "Define the request used for each poll."}>
          <div className="space-y-3">
            <label className="form-control">
              <span className="label-text text-sm">Method</span>
              <AppSelect className="select select-bordered" value={syncRequest.method || "GET"} onChange={(e) => updateSyncRequestField("method", e.target.value)}>
                {["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </AppSelect>
            </label>
            <label className="form-control">
              <span className="label-text text-sm">Path</span>
              <input className="input input-bordered" value={syncRequest.path || ""} onChange={(e) => updateSyncRequestField("path", e.target.value)} placeholder="/contacts" />
              <span className="label-text-alt opacity-70 mt-1">Use path for Generic REST base URLs. Use full URL only when you need to override the whole endpoint.</span>
            </label>
            <label className="form-control">
              <span className="label-text text-sm">Full URL override</span>
              <input className="input input-bordered" value={syncRequest.url || ""} onChange={(e) => updateSyncRequestField("url", e.target.value)} placeholder="https://api.example.com/custom/path" />
            </label>
            <JsonField label="Headers" value={prettyJson(syncRequest.headers || {})} onChange={(text) => updateSyncRequestField("headers", safeJsonParse(text, {}))} minHeight="7rem" />
            <JsonField label="Query" value={prettyJson(syncRequest.query || {})} onChange={(text) => updateSyncRequestField("query", safeJsonParse(text, {}))} minHeight="7rem" />
            <JsonField label="JSON body" value={prettyJson(syncRequest.json || {})} onChange={(text) => updateSyncRequestField("json", safeJsonParse(text, {}))} minHeight="8rem" help="Leave empty unless the polling endpoint expects a JSON payload." />
            <label className="form-control">
              <span className="label-text text-sm">Raw body</span>
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
    () => secretKeys.filter((secretKey) => Boolean(secretRefs?.[secretKey])).length,
    [secretKeys, secretRefs],
  );
  const hasTestedConnection = Boolean(item?.last_tested_at);
  const setupGuideSteps = useMemo(
    () => [
      {
        icon: ShieldCheck,
        title: "Review connection settings",
        description: "Fill in the provider-specific fields below. Most integrations only need the basic connection settings plus the right auth mode.",
        actionLabel: "",
        onAction: null,
        complete: Boolean((name || "").trim()) && setupFields.length > 0 ? true : Boolean((name || "").trim() && Object.keys(config || {}).length > 0),
      },
      {
        icon: KeyRound,
        title: "Attach required secrets",
        description: secretKeys.length
          ? `${linkedSecretCount} of ${secretKeys.length} required secret slots are linked. Open the Secrets tab to attach or create them.`
          : "This provider does not declare any named secret slots.",
        actionLabel: secretKeys.length ? "Open secrets" : "",
        onAction: secretKeys.length ? () => setActiveTab("secrets") : null,
        complete: secretKeys.length === 0 || linkedSecretCount === secretKeys.length,
      },
      {
        icon: TestTube2,
        title: "Run a connection test",
        description: hasTestedConnection
          ? `Last tested ${formatDateTime(item?.last_tested_at, "recently")}. Use this after changing setup fields or secrets.`
          : "Use Test connection once setup and secrets are ready. This confirms the runtime can actually authenticate.",
        actionLabel: "Test now",
        onAction: runTest,
        complete: Boolean(item?.health_status && item.health_status !== "error" && hasTestedConnection),
      },
    ],
    [config, hasTestedConnection, item?.health_status, item?.last_tested_at, linkedSecretCount, name, secretKeys, setupFields.length],
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
          <div className="text-sm opacity-70">Loading…</div>
        ) : !item ? (
          <div className="text-sm opacity-60">Connection not found.</div>
        ) : activeTab === "secrets" ? (
          <div className="space-y-4">
            <Section title="Connection secrets" help="Link the named secret slots this provider expects. Secrets stay reusable and encrypted, and the worker resolves them only at runtime.">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <SummaryStat label="Required slots" value={String(secretKeys.length)} />
                <SummaryStat label="Linked" value={`${linkedSecretCount}/${secretKeys.length || 0}`} />
                <SummaryStat label="Reusable secrets" value={String(secrets.length)} />
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-sm btn-primary" type="button" onClick={() => openCreateSecretModal("")}>
                  <Plus className="h-4 w-4" />
                  New secret
                </button>
                <button className="btn btn-sm btn-outline" type="button" onClick={() => navigate("/settings/secrets")}>
                  Manage all secrets
                </button>
              </div>
              {secretKeys.length === 0 ? (
                <div className="text-sm opacity-60">This provider does not declare any named secrets.</div>
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
                                ? `Currently linked to ${selectedSecret.name || selectedSecret.id}.`
                                : `No secret linked yet. Add or select a ${titleCase(secretKey).toLowerCase()} secret for this connection.`}
                            </div>
                          </div>
                          <button className="btn btn-ghost btn-sm" type="button" onClick={() => openCreateSecretModal(secretKey)}>
                            <Plus className="h-4 w-4" />
                            Create for this slot
                          </button>
                        </div>

                        <label className="form-control mt-3">
                          <span className="label-text text-sm">Select stored secret</span>
                          <AppSelect
                            className="select select-bordered"
                            value={secretRefs?.[secretKey] || ""}
                            onChange={(e) => updateSecretRef(secretKey, e.target.value)}
                            disabled={saving}
                          >
                            <option value="">No secret selected</option>
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
                            Matching provider and secret-key pairs are shown first so setup stays predictable.
                          </span>
                        </label>

                        {selectedSecret ? (
                          <div className="mt-3 rounded-box bg-base-200 px-3 py-2 text-sm">
                            Linked secret: {selectedSecret.name || selectedSecret.id}
                            {selectedSecret.provider_key ? ` • Provider ${selectedSecret.provider_key}` : ""}
                            {selectedSecret.secret_key ? ` • Slot ${selectedSecret.secret_key}` : ""}
                            {selectedSecret.version ? ` • Version ${selectedSecret.version}` : ""}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-primary btn-sm" type="button" onClick={save} disabled={loading || saving || !item?.id}>
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </Section>
          </div>
        ) : activeTab === "request" ? (
          <div className="space-y-4">
            <Section title="Manual request" help="Use this to test the connection against a real endpoint. This is especially useful while setting up Generic REST and Generic Webhook providers.">
              <div className="space-y-3">
                <label className="form-control">
                  <span className="label-text text-sm">Method</span>
                  <AppSelect className="select select-bordered" value={requestForm.method} onChange={(e) => setRequestForm((prev) => ({ ...prev, method: e.target.value }))}>
                    {["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => (
                      <option key={method} value={method}>
                        {method}
                      </option>
                    ))}
                  </AppSelect>
                </label>
                <label className="form-control">
                  <span className="label-text text-sm">Path</span>
                  <input className="input input-bordered" value={requestForm.path} onChange={(e) => setRequestForm((prev) => ({ ...prev, path: e.target.value }))} placeholder="/health" />
                  <span className="label-text-alt opacity-70 mt-1">Use path for Generic REST. Use URL only if you need to override the full endpoint.</span>
                </label>
                <label className="form-control">
                  <span className="label-text text-sm">Full URL override</span>
                  <input className="input input-bordered" value={requestForm.url} onChange={(e) => setRequestForm((prev) => ({ ...prev, url: e.target.value }))} placeholder="https://api.example.com/custom/path" />
                </label>
                <JsonField label="Headers" value={requestForm.headersText} onChange={(text) => setRequestForm((prev) => ({ ...prev, headersText: text }))} minHeight="7rem" />
                <JsonField label="Query" value={requestForm.queryText} onChange={(text) => setRequestForm((prev) => ({ ...prev, queryText: text }))} minHeight="7rem" />
                <JsonField label="JSON body" value={requestForm.jsonText} onChange={(text) => setRequestForm((prev) => ({ ...prev, jsonText: text }))} minHeight="8rem" help="Leave empty and use raw body below if the endpoint does not expect JSON." />
                <label className="form-control">
                  <span className="label-text text-sm">Raw body</span>
                  <textarea className="textarea textarea-bordered min-h-[7rem]" value={requestForm.bodyText} onChange={(e) => setRequestForm((prev) => ({ ...prev, bodyText: e.target.value }))} />
                </label>
                <div>
                  <button className="btn btn-primary btn-sm" type="button" onClick={runRequest} disabled={runningRequest}>
                    {runningRequest ? "Running…" : "Run request"}
                  </button>
                </div>
              </div>
            </Section>

            <Section title="Latest response" help="The request result is shown here immediately after execution. Full history is kept in Logs." tone="muted">
              {requestResult ? <pre className="rounded-box bg-base-200 p-3 text-xs overflow-auto">{JSON.stringify(requestResult, null, 2)}</pre> : <div className="text-sm opacity-60">No request executed yet.</div>}
            </Section>
          </div>
        ) : activeTab === "sync" ? (
          <div className="space-y-4">
            <Section title="Polling sync" help="Use this when the provider does not push changes to Octodrop. The saved sync config defines how the next batch is fetched and where the checkpoint cursor is stored.">
              <div className="space-y-3">
                {syncFields.length === 0 ? (
                  <div className="text-sm opacity-60">This provider does not define a sync schema.</div>
                ) : (
                  syncFields.map((field) => renderSyncField(field))
                )}
                <div>
                  <button className="btn btn-primary btn-sm" type="button" onClick={runSync} disabled={runningSync}>
                    {runningSync ? "Running…" : "Run sync now"}
                  </button>
                </div>
              </div>
            </Section>

            <Section title="Latest sync result" help="This shows the last manual sync run from this page. Background runs and history are visible in Logs and Sync checkpoints." tone="muted">
              {syncResult ? <pre className="rounded-box bg-base-200 p-3 text-xs overflow-auto">{JSON.stringify(syncResult, null, 2)}</pre> : <div className="text-sm opacity-60">No sync run yet.</div>}
            </Section>
          </div>
        ) : activeTab === "webhooks" ? (
          <div className="space-y-4">
            <Section title="Webhook definitions" help="Inbound webhooks store raw events and process them asynchronously. Outbound webhooks can be called through automation actions or manual requests.">
              <div className="rounded-box border border-base-300 bg-base-200 p-3 text-sm">
                <div className="font-medium">Signing model</div>
                <div className="mt-1 opacity-80">
                  Signed outbound webhooks now include `X-Octo-Timestamp` and `X-Octo-Signature`. The signature is an HMAC SHA-256 over `timestamp.payload`.
                  Inbound verification accepts that format and still supports the older body-only `sha256=` signature for compatibility.
                </div>
              </div>
              <div className="space-y-3">
                <label className="form-control">
                  <span className="label-text text-sm">Direction</span>
                  <AppSelect className="select select-bordered" value={newWebhook.direction} onChange={(e) => setNewWebhook((prev) => ({ ...prev, direction: e.target.value }))}>
                    <option value="inbound">Inbound</option>
                    <option value="outbound">Outbound</option>
                  </AppSelect>
                </label>
                <label className="form-control">
                  <span className="label-text text-sm">Event key</span>
                  <input className="input input-bordered" value={newWebhook.event_key} onChange={(e) => setNewWebhook((prev) => ({ ...prev, event_key: e.target.value }))} placeholder="contact.updated" />
                </label>
                <label className="form-control">
                  <span className="label-text text-sm">Endpoint path</span>
                  <input className="input input-bordered" value={newWebhook.endpoint_path} onChange={(e) => setNewWebhook((prev) => ({ ...prev, endpoint_path: e.target.value }))} placeholder="/webhooks/client-crm" />
                </label>
                <label className="form-control">
                  <span className="label-text text-sm">Signing secret</span>
                  <AppSelect className="select select-bordered" value={newWebhook.signing_secret_id} onChange={(e) => setNewWebhook((prev) => ({ ...prev, signing_secret_id: e.target.value }))}>
                    <option value="">No signing secret</option>
                    {(secrets || []).map((secret) => (
                      <option key={secret.id} value={secret.id}>
                        {secret.name || secret.id}
                      </option>
                    ))}
                  </AppSelect>
                </label>
                <JsonField label="Webhook config" value={newWebhook.config_json_text} onChange={(text) => setNewWebhook((prev) => ({ ...prev, config_json_text: text }))} minHeight="8rem" />
                <div>
                  <button className="btn btn-primary btn-sm" type="button" onClick={createWebhook} disabled={creatingWebhook || !newWebhook.event_key.trim()}>
                    {creatingWebhook ? "Adding…" : "Add webhook"}
                  </button>
                </div>
              </div>
            </Section>

            <TableList
              emptyLabel="No webhooks configured yet."
              columns={[
                { key: "direction", label: "Direction" },
                { key: "event_key", label: "Event key" },
                { key: "status", label: "Status" },
                { key: "endpoint_path", label: "Endpoint" },
                {
                  key: "actions",
                  label: "",
                  render: (row) => (
                    <button className="btn btn-ghost btn-xs text-error" type="button" onClick={() => deleteWebhook(row.id)}>
                      Delete
                    </button>
                  ),
                },
              ]}
              rows={webhooks}
            />
          </div>
        ) : activeTab === "mappings" ? (
          <div className="space-y-4">
            <Section title="Mapping profiles" help="Mappings stay declarative. Use them to turn inbound sync items into OCTO records without writing runtime code. Start with the guided fields, then only use raw JSON for advanced cases.">
              <div className="space-y-3">
                <label className="form-control">
                  <span className="label-text text-sm">Name</span>
                  <input className="input input-bordered" value={newMapping.name} onChange={(e) => setNewMapping((prev) => ({ ...prev, name: e.target.value }))} placeholder="Contacts import mapping" />
                </label>
                <label className="form-control">
                  <span className="label-text text-sm">Source entity</span>
                  <input className="input input-bordered" value={newMapping.source_entity} onChange={(e) => setNewMapping((prev) => ({ ...prev, source_entity: e.target.value }))} placeholder="external.contact" />
                  <span className="label-text-alt opacity-70 mt-1">This is the external/source shape label for humans. It does not need to exist as an OCTO entity.</span>
                </label>
                <label className="form-control">
                  <span className="label-text text-sm">Target entity</span>
                  <input className="input input-bordered" value={newMapping.target_entity} onChange={(e) => setNewMapping((prev) => ({ ...prev, target_entity: e.target.value }))} placeholder="entity.contact" />
                  <span className="label-text-alt opacity-70 mt-1">Use the OCTO entity id you want this mapping to create or update.</span>
                </label>
                <label className="form-control">
                  <span className="label-text text-sm">Resource key</span>
                  <input className="input input-bordered" value={newMapping.resource_key} onChange={(e) => setNewMapping((prev) => ({ ...prev, resource_key: e.target.value }))} placeholder="contacts" />
                  <span className="label-text-alt opacity-70 mt-1">Optional. Use this to target only sync items from one resource, such as `contacts` or `invoices`.</span>
                </label>
                <label className="form-control">
                  <span className="label-text text-sm">Record mode</span>
                  <AppSelect className="select select-bordered" value={newMapping.record_mode} onChange={(e) => setNewMapping((prev) => ({ ...prev, record_mode: e.target.value }))}>
                    <option value="upsert">Upsert existing or create new</option>
                    <option value="create">Always create a new record</option>
                  </AppSelect>
                </label>
                {newMapping.record_mode === "upsert" ? (
                  <label className="form-control">
                    <span className="label-text text-sm">Match on target fields</span>
                    <input className="input input-bordered" value={newMapping.match_on_text} onChange={(e) => setNewMapping((prev) => ({ ...prev, match_on_text: e.target.value }))} placeholder="contact.email" />
                    <span className="label-text-alt opacity-70 mt-1">Comma-separated target fields used to find an existing OCTO record before updating it.</span>
                  </label>
                ) : null}

                <Section title="Field mappings" help="Each row maps one source value into one OCTO target field.">
                  <div className="space-y-3">
                    {(newMapping.field_mappings || []).map((row, index) => (
                      <div key={index} className="rounded-box border border-base-300 bg-base-100 p-3 space-y-3">
                        <label className="form-control">
                          <span className="label-text text-sm">Target field</span>
                          <input
                            className="input input-bordered"
                            value={row.to}
                            onChange={(e) => updateFieldMappingRow(index, { to: e.target.value })}
                            placeholder="contact.email"
                          />
                        </label>
                        <label className="form-control">
                          <span className="label-text text-sm">Value source</span>
                          <AppSelect
                            className="select select-bordered"
                            value={row.value_type}
                            onChange={(e) => updateFieldMappingRow(index, { value_type: e.target.value })}
                          >
                            <option value="path">Source path</option>
                            <option value="constant">Constant value</option>
                            <option value="ref">System reference</option>
                          </AppSelect>
                        </label>
                        <label className="form-control">
                          <span className="label-text text-sm">{row.value_type === "constant" ? "Constant value" : row.value_type === "ref" ? "Reference" : "Source path"}</span>
                          <input
                            className="input input-bordered"
                            value={row.source}
                            onChange={(e) => updateFieldMappingRow(index, { source: e.target.value })}
                            placeholder={row.value_type === "constant" ? "active" : row.value_type === "ref" ? "$now" : "email"}
                          />
                        </label>
                        <label className="form-control">
                          <span className="label-text text-sm">Transform</span>
                          <AppSelect
                            className="select select-bordered"
                            value={row.transform || ""}
                            onChange={(e) => updateFieldMappingRow(index, { transform: e.target.value })}
                          >
                            <option value="">No transform</option>
                            <option value="trim">Trim whitespace</option>
                            <option value="lower">Lowercase</option>
                            <option value="upper">Uppercase</option>
                            <option value="string">Convert to text</option>
                            <option value="number">Convert to number</option>
                            <option value="integer">Convert to integer</option>
                            <option value="boolean">Convert to boolean</option>
                            <option value="null_if_empty">Null if empty</option>
                          </AppSelect>
                        </label>
                        <div className="flex justify-end">
                          <button className="btn btn-ghost btn-sm text-error" type="button" onClick={() => removeFieldMappingRow(index)} disabled={(newMapping.field_mappings || []).length <= 1}>
                            Remove row
                          </button>
                        </div>
                      </div>
                    ))}
                    <button className="btn btn-sm btn-outline" type="button" onClick={addFieldMappingRow}>
                      <Plus className="h-4 w-4" />
                      Add field mapping
                    </button>
                  </div>
                </Section>

                <Section title="Preview mapping" help="Paste one sample source record here to see the mapped OCTO field values before you save the profile.">
                  <div className="space-y-3">
                    <JsonField label="Sample source record" value={newMapping.sample_source_text} onChange={(text) => setNewMapping((prev) => ({ ...prev, sample_source_text: text }))} minHeight="10rem" />
                    <div className="flex flex-wrap gap-2">
                      <button className="btn btn-sm btn-outline" type="button" onClick={previewMapping} disabled={previewingMapping}>
                        {previewingMapping ? "Previewing..." : "Preview mapping"}
                      </button>
                    </div>
                    {mappingPreview ? (
                      <pre className="rounded-box bg-base-200 p-3 text-xs overflow-auto">{JSON.stringify(mappingPreview, null, 2)}</pre>
                    ) : (
                      <div className="text-sm opacity-60">No preview yet.</div>
                    )}
                  </div>
                </Section>

                <details className="collapse collapse-arrow border border-base-300 bg-base-100">
                  <summary className="collapse-title text-sm font-medium">Advanced mapping JSON</summary>
                  <div className="collapse-content">
                    <JsonField
                      label="Advanced overrides"
                      value={newMapping.mapping_json_text}
                      onChange={(text) => setNewMapping((prev) => ({ ...prev, mapping_json_text: text }))}
                      minHeight="10rem"
                      help="These fields are merged on top of the guided builder output. Use this only for advanced conditions or future mapping options."
                    />
                  </div>
                </details>

                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-primary btn-sm" type="button" onClick={createMapping} disabled={creatingMapping || !newMapping.name.trim() || !newMapping.source_entity.trim() || !newMapping.target_entity.trim()}>
                    {creatingMapping ? "Adding…" : "Add mapping"}
                  </button>
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => { setNewMapping(defaultNewMappingState()); setMappingPreview(null); }}>
                    Reset
                  </button>
                </div>
              </div>
            </Section>

            <TableList
              emptyLabel="No mappings configured yet."
              columns={[
                { key: "name", label: "Name" },
                { key: "resource", label: "Resource", render: (row) => row.mapping_json?.resource_key || "—" },
                { key: "source_entity", label: "Source" },
                { key: "target_entity", label: "Target" },
                { key: "mode", label: "Mode", render: (row) => row.mapping_json?.record_mode || row.mapping_json?.mode || "create" },
                {
                  key: "actions",
                  label: "",
                  render: (row) => (
                    <button className="btn btn-ghost btn-xs text-error" type="button" onClick={() => deleteMapping(row.id)}>
                      Delete
                    </button>
                  ),
                },
              ]}
              rows={mappings}
            />
          </div>
        ) : activeTab === "logs" ? (
          <div className="space-y-4">
            <Section title="Request logs" help="Outbound test calls and automation-driven provider calls are stored here for troubleshooting." tone="muted">
              <TableList
                emptyLabel="No request logs yet."
                columns={[
                  { key: "created_at", label: "When", render: (row) => formatDateTime(row.created_at, "—") },
                  { key: "source", label: "Source" },
                  { key: "method", label: "Method" },
                  { key: "url", label: "URL" },
                  { key: "response_status", label: "Status" },
                ]}
                rows={requestLogs}
              />
            </Section>

            <Section title="Webhook events" help="Inbound webhook payloads are always stored first, then processed asynchronously by workers." tone="muted">
              <TableList
                emptyLabel="No webhook events yet."
                columns={[
                  { key: "received_at", label: "Received", render: (row) => formatDateTime(row.received_at, "—") },
                  { key: "event_key", label: "Event key" },
                  { key: "status", label: "Status" },
                  { key: "provider_event_id", label: "Provider event ID" },
                ]}
                rows={webhookEvents}
              />
            </Section>

            <Section title="Sync checkpoints" help="Polling integrations use checkpoints so later sync runs only process new or changed records." tone="muted">
              <TableList
                emptyLabel="No checkpoints yet."
                columns={[
                  { key: "scope_key", label: "Scope" },
                  { key: "cursor_value", label: "Cursor" },
                  { key: "status", label: "Status" },
                  { key: "updated_at", label: "Updated", render: (row) => formatDateTime(row.updated_at, "—") },
                ]}
                rows={checkpoints}
              />
            </Section>
          </div>
        ) : (
          <div className="space-y-4">
            <Section title="Setup guide" help="Use this as the linear path for getting a connection ready. You usually only need the connection settings, the correct secrets, and a successful test run." tone="muted">
              <div className="space-y-3">
                {setupGuideSteps.map((step) => (
                  <SetupGuideStep key={step.title} {...step} />
                ))}
              </div>
            </Section>

            <Section title="Connection setup" help="Keep this section focused on provider settings. Secrets are linked separately so credentials stay reusable and isolated from business logic.">
              <div className="space-y-3">
                <label className="form-control">
                  <span className="label-text text-sm">Connection name</span>
                  <input className="input input-bordered" value={name} onChange={(e) => setName(e.target.value)} disabled={saving} />
                </label>

                <label className="form-control">
                  <span className="label-text text-sm">Status</span>
                  <AppSelect className="select select-bordered" value={status} onChange={(e) => setStatus(e.target.value)} disabled={saving}>
                    <option value="active">Active</option>
                    <option value="disabled">Disabled</option>
                  </AppSelect>
                </label>

                {groupedSetupFields
                  .filter(([groupKey]) => groupKey !== "advanced")
                  .map(([groupKey, fields]) => (
                    <Section
                      key={groupKey}
                      title={groupKey === "connection" ? "Provider settings" : titleCase(groupKey)}
                      help={
                        groupKey === "connection"
                          ? "These are the main provider fields your team will usually configure first."
                          : "These fields belong together and are part of this provider's setup schema."
                      }
                    >
                      <div className="space-y-3">{fields.map((field) => renderSetupField(field))}</div>
                    </Section>
                  ))}

                {authMode === "oauth2" ? (
                  <Section title="OAuth2 connection flow" help="Use this when the provider authenticates through an OAuth2 browser flow. Generate the authorize URL, complete the provider login, then exchange the returned code so Octodrop can store and refresh the tokens safely.">
                    <div className="space-y-3">
                      <label className="form-control">
                        <span className="label-text text-sm">Redirect URI</span>
                        <input
                          className="input input-bordered"
                          value={oauthRedirectUri}
                          onChange={(e) => setOauthRedirectUri(e.target.value)}
                          placeholder="https://app.example.com/integrations/connections/..."
                        />
                        <span className="label-text-alt opacity-70 mt-1">Register this exact URL with the provider. If the provider redirects back with `?code=...`, this page will prefill the code field automatically.</span>
                      </label>

                      <div className="flex flex-wrap gap-2">
                        <button className="btn btn-sm btn-outline" type="button" onClick={generateOauthAuthorizeUrl} disabled={authorizingOAuth || !oauthRedirectUri.trim()}>
                          {authorizingOAuth ? "Generating..." : "Generate authorize URL"}
                        </button>
                        <button className="btn btn-sm btn-outline" type="button" onClick={refreshOauthTokens} disabled={refreshingOAuth}>
                          {refreshingOAuth ? "Refreshing..." : "Refresh tokens now"}
                        </button>
                      </div>

                      {oauthAuthorizeResult?.authorize_url ? (
                        <div className="space-y-2 rounded-box border border-base-300 bg-base-200/60 p-3">
                          <div className="text-sm font-medium">Authorize URL</div>
                          <textarea className="textarea textarea-bordered min-h-[7rem] text-xs" readOnly value={oauthAuthorizeResult.authorize_url} />
                          <div className="flex flex-wrap gap-2">
                            <a className="btn btn-sm btn-primary" href={oauthAuthorizeResult.authorize_url} target="_blank" rel="noreferrer">
                              Open provider login
                            </a>
                          </div>
                        </div>
                      ) : null}

                      <label className="form-control">
                        <span className="label-text text-sm">Authorization code</span>
                        <input
                          className="input input-bordered"
                          value={oauthCode}
                          onChange={(e) => setOauthCode(e.target.value)}
                          placeholder="Paste the returned code here"
                        />
                        <span className="label-text-alt opacity-70 mt-1">After completing the provider login, paste the returned `code` parameter here if it was not auto-filled.</span>
                      </label>

                      <div className="flex flex-wrap gap-2">
                        <button className="btn btn-sm btn-primary" type="button" onClick={exchangeOauthCode} disabled={exchangingOAuth || !oauthRedirectUri.trim() || !oauthCode.trim()}>
                          {exchangingOAuth ? "Exchanging..." : "Exchange code for tokens"}
                        </button>
                      </div>

                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="rounded-box bg-base-200 px-3 py-2 text-sm">
                          <div className="text-xs uppercase tracking-wide opacity-60">Access token expiry</div>
                          <div className="mt-1">{formatDateTime(config?.oauth_access_token_expires_at, "—")}</div>
                        </div>
                        <div className="rounded-box bg-base-200 px-3 py-2 text-sm">
                          <div className="text-xs uppercase tracking-wide opacity-60">Last token refresh</div>
                          <div className="mt-1">{formatDateTime(config?.oauth_last_token_refresh_at, "—")}</div>
                        </div>
                      </div>
                    </div>
                  </Section>
                ) : null}

                <details className="collapse collapse-arrow border border-base-300 bg-base-100">
                  <summary className="collapse-title text-sm font-medium">Advanced config JSON</summary>
                  <div className="collapse-content">
                    {groupedSetupFields.some(([groupKey]) => groupKey === "advanced") ? (
                      <div className="mb-4 space-y-3">
                        <div className="text-sm opacity-70">These advanced provider fields are still driven by the provider schema, but are tucked away because most connections will not need them.</div>
                        {groupedSetupFields
                          .filter(([groupKey]) => groupKey === "advanced")
                          .flatMap(([, fields]) => fields)
                          .map((field) => renderSetupField(field))}
                      </div>
                    ) : null}
                    <JsonField
                      label="Full config"
                      value={configText}
                      onChange={(text) => {
                        setConfigText(text);
                        setConfig(safeJsonParse(text, config));
                      }}
                      minHeight="16rem"
                      help="This is the raw stored config. Use it for fields not yet modeled in the guided form."
                    />
                  </div>
                </details>

                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-outline btn-sm" type="button" onClick={runTest} disabled={loading || testing || !item?.id}>
                    {testing ? "Testing..." : "Test connection"}
                  </button>
                  <button className="btn btn-primary btn-sm" type="button" onClick={save} disabled={loading || saving || !name.trim()}>
                    {saving ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </Section>

            <Section title="Connection summary" help="This is the current runtime state of the connection, including provider, health, and audit timestamps." tone="muted">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <SummaryStat label="Provider" value={provider?.name || providerKey} />
                <SummaryStat label="Auth type" value={provider?.auth_type || config?.provider_auth_type} />
                <SummaryStat label="Health" value={item.health_status || "unknown"} />
                <SummaryStat label="Status" value={item.status} />
                <SummaryStat label="Last tested" value={formatDateTime(item.last_tested_at, "—")} />
                <SummaryStat label="Last success" value={formatDateTime(item.last_success_at, "—")} />
                <SummaryStat label="Last error" value={item.last_error || "—"} />
                <SummaryStat label="Updated" value={formatDateTime(item.updated_at, "—")} />
              </div>
            </Section>

            <Section title="Latest test result" help="Use Test connection after changing config or secrets. The result here is only the latest run; full request history is in Logs." tone="muted">
              {testResult ? <pre className="rounded-box bg-base-200 p-3 text-xs overflow-auto">{JSON.stringify(testResult, null, 2)}</pre> : <div className="text-sm opacity-60">No test run yet.</div>}
            </Section>
          </div>
        )}
      </div>

      {showCreateSecretModal ? (
        <SimpleModal
          title={createSecretTargetKey ? `Create ${titleCase(createSecretTargetKey)} secret` : "Create secret"}
          subtitle="Secrets are encrypted, reusable, and resolved only at runtime by the worker."
          onClose={() => {
            if (!creatingSecret) setShowCreateSecretModal(false);
          }}
        >
          <div className="space-y-4">
            <label className="form-control">
              <span className="label-text text-sm">Name</span>
              <input
                className="input input-bordered"
                value={createSecretForm.name}
                onChange={(e) => setCreateSecretForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Xero refresh token"
                disabled={creatingSecret}
              />
              <span className="label-text-alt opacity-70 mt-1">Use a name your team will recognize when linking this secret to connections.</span>
            </label>

            <label className="form-control">
              <span className="label-text text-sm">Provider key</span>
              <input
                className="input input-bordered"
                value={createSecretForm.provider_key}
                onChange={(e) => setCreateSecretForm((prev) => ({ ...prev, provider_key: e.target.value }))}
                placeholder="generic_rest"
                disabled={creatingSecret}
              />
            </label>

            <label className="form-control">
              <span className="label-text text-sm">Secret slot</span>
              <input
                className="input input-bordered"
                value={createSecretForm.secret_key}
                onChange={(e) => setCreateSecretForm((prev) => ({ ...prev, secret_key: e.target.value }))}
                placeholder="api_key"
                disabled={creatingSecret}
              />
              <span className="label-text-alt opacity-70 mt-1">The slot should match the named secret this provider expects, such as `api_key`, `bearer_token`, or `signing_secret`.</span>
            </label>

            <label className="form-control">
              <span className="label-text text-sm">Status</span>
              <AppSelect
                className="select select-bordered"
                value={createSecretForm.status}
                onChange={(e) => setCreateSecretForm((prev) => ({ ...prev, status: e.target.value }))}
                disabled={creatingSecret}
              >
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </AppSelect>
            </label>

            <label className="form-control">
              <span className="label-text text-sm">Secret value</span>
              <textarea
                className="textarea textarea-bordered min-h-[8rem]"
                value={createSecretForm.value}
                onChange={(e) => setCreateSecretForm((prev) => ({ ...prev, value: e.target.value }))}
                placeholder="Paste the credential value"
                disabled={creatingSecret}
              />
              <span className="label-text-alt opacity-70 mt-1">The value is stored encrypted and will not be shown again after save.</span>
            </label>

            <div className="flex items-center justify-end gap-2">
              <button className="btn btn-ghost" type="button" onClick={() => setShowCreateSecretModal(false)} disabled={creatingSecret}>
                Cancel
              </button>
              <button className="btn btn-primary" type="button" onClick={createSecretForConnection} disabled={creatingSecret || !createSecretForm.value.trim()}>
                {creatingSecret ? "Creating..." : "Create secret"}
              </button>
            </div>
          </div>
        </SimpleModal>
      ) : null}
    </TabbedPaneShell>
  );
}
