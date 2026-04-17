import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowRight, CheckCircle2, Circle, KeyRound, Plus, ShieldCheck, TestTube2 } from "lucide-react";
import { apiFetch } from "../api.js";
import AppSelect from "../components/AppSelect.jsx";
import { PRIMARY_BUTTON_SM, SOFT_BUTTON_SM } from "../components/buttonStyles.js";
import TabbedPaneShell from "../ui/TabbedPaneShell.jsx";
import ResponsiveDrawer from "../ui/ResponsiveDrawer.jsx";
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

function makeClientId(prefix = "item") {
  const stamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${stamp}_${random}`;
}

function normalizeRequestTemplate(raw, index = 0) {
  const template = raw && typeof raw === "object" ? raw : {};
  return {
    id: String(template.id || `request_template_${index + 1}`),
    name: String(template.name || `Request template ${index + 1}`),
    method: String(template.method || "GET").trim().toUpperCase() || "GET",
    path: String(template.path || ""),
    url: String(template.url || ""),
    headers: template.headers && typeof template.headers === "object" && !Array.isArray(template.headers) ? template.headers : {},
    query: template.query && typeof template.query === "object" && !Array.isArray(template.query) ? template.query : {},
    json: template.json,
    body: typeof template.body === "string" ? template.body : "",
    updated_at: typeof template.updated_at === "string" ? template.updated_at : "",
  };
}

function requestTemplateToRequestForm(template) {
  const normalized = normalizeRequestTemplate(template);
  return {
    method: normalized.method || "GET",
    path: normalized.path || "",
    url: normalized.url || "",
    headersText: prettyJson(normalized.headers || {}),
    queryText: prettyJson(normalized.query || {}),
    jsonText: prettyJson(normalized.json || {}),
    bodyText: normalized.body || "",
  };
}

function requestTemplateSummaryTarget(template) {
  const normalized = normalizeRequestTemplate(template);
  return normalized.path || normalized.url || "/";
}

function defaultNewMappingState() {
  return {
    name: "",
    source_entity: "",
    target_entity: "",
    resource_key: "",
    usage_scope: "sync_and_automation",
    record_mode: "upsert",
    match_on_text: "",
    field_mappings: [{ to: "", value_type: "path", source: "", transform: "", value_map_rows: [], value_map_default: "" }],
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
      const valueMapEntries = (Array.isArray(row?.value_map_rows) ? row.value_map_rows : [])
        .filter((entry) => String(entry?.from || "").trim())
        .map((entry) => [String(entry.from).trim(), entry?.to ?? ""]);
      if (valueMapEntries.length) item.value_map = Object.fromEntries(valueMapEntries);
      if (String(row?.value_map_default || "").trim()) item.value_map_default = String(row.value_map_default).trim();
      return item;
    })
    .filter(Boolean);
  return {
    resource_key: form?.resource_key?.trim() || undefined,
    usage_scope: form?.usage_scope || "sync_and_automation",
    record_mode: form?.record_mode || "upsert",
    match_on: (form?.match_on_text || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
    field_mappings: fieldMappings,
  };
}

function extractMappingAdvancedOverrides(mappingJson) {
  const raw = mappingJson && typeof mappingJson === "object" ? { ...mappingJson } : {};
  delete raw.resource_key;
  delete raw.usage_scope;
  delete raw.record_mode;
  delete raw.match_on;
  delete raw.field_mappings;
  return raw;
}

function mappingFormFromRecord(mapping) {
  const mappingJson = mapping?.mapping_json && typeof mapping.mapping_json === "object" ? mapping.mapping_json : {};
  const fieldMappings = Array.isArray(mappingJson.field_mappings) ? mappingJson.field_mappings : [];
  return {
    name: String(mapping?.name || ""),
    source_entity: String(mapping?.source_entity || ""),
    target_entity: String(mapping?.target_entity || ""),
    resource_key: String(mappingJson.resource_key || ""),
    usage_scope: String(mappingJson.usage_scope || "sync_and_automation"),
    record_mode: String(mappingJson.record_mode || "upsert"),
    match_on_text: Array.isArray(mappingJson.match_on) ? mappingJson.match_on.join(", ") : "",
    field_mappings: fieldMappings.length
      ? fieldMappings.map((row) => ({
          to: String(row?.to || ""),
          value_type: Object.prototype.hasOwnProperty.call(row || {}, "value")
            ? "constant"
            : Object.prototype.hasOwnProperty.call(row || {}, "ref")
              ? "ref"
              : "path",
          source: String(row?.path ?? row?.ref ?? row?.value ?? ""),
          transform: String(row?.transform || ""),
          value_map_rows: Object.entries(row?.value_map && typeof row.value_map === "object" ? row.value_map : {}).map(([from, to]) => ({ from, to: String(to ?? "") })),
          value_map_default: String(row?.value_map_default || ""),
        }))
      : [{ to: "", value_type: "path", source: "", transform: "", value_map_rows: [], value_map_default: "" }],
    mapping_json_text: prettyJson(extractMappingAdvancedOverrides(mappingJson)),
    sample_source_text: "{}",
  };
}

function collectJsonPaths(value, prefix = "") {
  if (value == null) return [];
  if (Array.isArray(value)) {
    const first = value.find((item) => item != null);
    if (first == null) return prefix ? [prefix] : [];
    return collectJsonPaths(first, `${prefix}[0]`);
  }
  if (typeof value !== "object") {
    return prefix ? [prefix] : [];
  }
  const paths = [];
  for (const [key, child] of Object.entries(value)) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    if (child != null && typeof child === "object") {
      const nested = collectJsonPaths(child, nextPrefix);
      if (nested.length) paths.push(...nested);
      else paths.push(nextPrefix);
    } else {
      paths.push(nextPrefix);
    }
  }
  return paths;
}

function uniquePathOptions(items) {
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .filter(Boolean)
    .map((item) => {
      if (typeof item === "string") return { value: item, label: item, type: "", options: [] };
      return {
        value: String(item.path || item.value || ""),
        label: String(item.label || item.path || item.value || ""),
        type: String(item.type || ""),
        options: Array.isArray(item.options) ? item.options : [],
      };
    })
    .filter((item) => item.value)
    .filter((item) => {
      if (seen.has(item.value)) return false;
      seen.add(item.value);
      return true;
    });
}

function normalizeOptionItems(options) {
  if (!Array.isArray(options)) return [];
  return options
    .map((option) => {
      if (typeof option === "string") return { value: option, label: option };
      if (!option || typeof option !== "object") return null;
      const value = String(option.value ?? option.id ?? "").trim();
      if (!value) return null;
      return {
        value,
        label: String(option.label ?? option.name ?? option.value ?? option.id ?? value),
      };
    })
    .filter(Boolean);
}

function tokenizeFieldText(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[\[\]\(\)\.\-_:/\\]+/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function fieldSignature(option) {
  const parts = new Set([
    ...tokenizeFieldText(option?.value),
    ...tokenizeFieldText(option?.label),
  ]);
  return Array.from(parts);
}

function fieldMatchScore(left, right) {
  const leftTokens = fieldSignature(left);
  const rightTokens = fieldSignature(right);
  if (!leftTokens.length || !rightTokens.length) return 0;
  const overlap = leftTokens.filter((token) => rightTokens.includes(token));
  if (!overlap.length) return 0;
  let score = overlap.length * 10;
  if (String(left?.label || "").trim().toLowerCase() === String(right?.label || "").trim().toLowerCase()) score += 25;
  if (String(left?.value || "").trim().toLowerCase() === String(right?.value || "").trim().toLowerCase()) score += 20;
  if (leftTokens.every((token) => rightTokens.includes(token)) || rightTokens.every((token) => leftTokens.includes(token))) score += 12;
  if (String(left?.type || "").trim().toLowerCase() && String(left?.type || "").trim().toLowerCase() === String(right?.type || "").trim().toLowerCase()) score += 4;
  return score;
}

function findBestMatchingField(targetOption, candidateOptions, usedValues = new Set()) {
  let best = null;
  let bestScore = 0;
  for (const candidate of Array.isArray(candidateOptions) ? candidateOptions : []) {
    if (!candidate?.value || usedValues.has(candidate.value)) continue;
    const score = fieldMatchScore(targetOption, candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

function mappingPairSummary(row, sourceOptionMap, targetOptionMap, providerName = "Source") {
  const sourceLabel = sourceOptionMap.get(row?.source)?.label
    || (row?.value_type === "constant" ? `Constant: ${row?.source || "—"}` : row?.value_type === "ref" ? `Reference: ${row?.source || "—"}` : row?.source || "Choose source field");
  const targetLabel = targetOptionMap.get(row?.to)?.label || row?.to || "Choose OCTO field";
  return `${providerName}: ${sourceLabel} -> OCTO: ${targetLabel}`;
}

function mappingUsageScopeValue(mapping) {
  const raw = String(mapping?.mapping_json?.usage_scope || mapping?.usage_scope || "sync_and_automation").trim().toLowerCase();
  if (raw === "sync_only" || raw === "automation_only" || raw === "sync_and_automation") return raw;
  return "sync_and_automation";
}

function mappingUsageScopeLabel(value) {
  switch (String(value || "").trim().toLowerCase()) {
    case "sync_only":
      return "Sync only";
    case "automation_only":
      return "Automation only";
    default:
      return "Sync + Automation";
  }
}

function xeroSyncPreset(resourceKey) {
  const normalized = String(resourceKey || "").trim();
  if (!normalized) return null;
  return {
    resource_key: normalized,
    scope_key: normalized,
    items_path: normalized,
    request: {
      method: "GET",
      path: `/${normalized}`,
      headers: { Accept: "application/json" },
    },
  };
}

function buildXeroRequestJsonTemplate(resource) {
  if (!resource || typeof resource !== "object") return {};
  const key = String(resource.key || "").trim();
  const sample = resource.sample_record && typeof resource.sample_record === "object" ? resource.sample_record : null;
  if (!key || !sample) return {};
  return { [key]: [sample] };
}

function singularLabel(value) {
  const label = String(value || "").trim();
  if (!label) return "record";
  if (/ies$/i.test(label)) return `${label.slice(0, -3)}y`;
  if (/s$/i.test(label)) return label.slice(0, -1);
  return label;
}

function buildXeroReadPreset({ id, label, path, url, help, query = {}, targetLabel = "" }) {
  return {
    id,
    label,
    method: "GET",
    path,
    url,
    targetLabel: targetLabel || label,
    help,
    headersText: prettyJson({ Accept: "application/json" }),
    queryText: prettyJson(query || {}),
    jsonText: "{}",
    bodyText: "",
  };
}

function buildXeroRequestPresets(resources = []) {
  const presets = [
    buildXeroReadPreset({
      id: "connections:list",
      label: "List connections",
      url: "https://api.xero.com/connections",
      targetLabel: "Connections",
      help: "Check which Xero organisation links are available for this connection.",
    }),
    buildXeroReadPreset({
      id: "organisation:get",
      label: "Get organisation",
      path: "/Organisation",
      targetLabel: "Organisation",
      help: "Load the connected organisation details from Xero.",
    }),
    buildXeroReadPreset({
      id: "accounts:list",
      label: "List accounts",
      path: "/Accounts",
      targetLabel: "Accounts",
      help: "Browse the chart of accounts available in Xero.",
    }),
    buildXeroReadPreset({
      id: "branding-themes:list",
      label: "List branding themes",
      path: "/BrandingThemes",
      targetLabel: "Branding themes",
      help: "Review the branding themes available for invoices and documents.",
    }),
    buildXeroReadPreset({
      id: "currencies:list",
      label: "List currencies",
      path: "/Currencies",
      targetLabel: "Currencies",
      help: "See which currencies are enabled for the connected organisation.",
    }),
    buildXeroReadPreset({
      id: "tax-rates:list",
      label: "List tax rates",
      path: "/TaxRates",
      targetLabel: "Tax rates",
      help: "Inspect the tax rates configured in Xero.",
    }),
    buildXeroReadPreset({
      id: "tracking-categories:list",
      label: "List tracking categories",
      path: "/TrackingCategories",
      targetLabel: "Tracking categories",
      help: "Review available tracking categories and their options.",
    }),
    buildXeroReadPreset({
      id: "users:list",
      label: "List users",
      path: "/Users",
      targetLabel: "Users",
      help: "See users available in the connected Xero organisation.",
    }),
  ];
  for (const resource of Array.isArray(resources) ? resources : []) {
    const key = String(resource?.key || "").trim();
    if (!key) continue;
    const label = String(resource?.label || key).trim() || key;
    presets.push(
      buildXeroReadPreset({
        id: `${key}:list`,
        label: `List ${label}`,
        path: `/${key}`,
        targetLabel: label,
        help: `Fetch ${label.toLowerCase()} from Xero using this connection.`,
      }),
    );
    presets.push(
      buildXeroReadPreset({
        id: `${key}:search`,
        label: `Search ${label}`,
        path: `/${key}`,
        targetLabel: label,
        help: `Start with a filtered ${label.toLowerCase()} request and refine the query JSON as needed.`,
        query: {
          page: 1,
          order: "UpdatedDateUTC DESC",
          where: "",
        },
      }),
    );
    if (resource?.sample_record && typeof resource.sample_record === "object") {
      presets.push({
        id: `${key}:create`,
        label: `Create ${singularLabel(label)}`,
        method: "POST",
        path: `/${key}`,
        targetLabel: label,
        help: `Start a write request for ${singularLabel(label).toLowerCase()} records with a sample JSON wrapper.`,
        headersText: prettyJson({
          Accept: "application/json",
          "Content-Type": "application/json",
        }),
        queryText: "{}",
        jsonText: prettyJson(buildXeroRequestJsonTemplate(resource)),
        bodyText: "",
      });
    }
  }
  return presets;
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

const SHOPIFY_READONLY_SETUP_FIELDS = new Set([
  "shopify_shop_name",
  "shopify_myshopify_domain",
  "shopify_shop_currency",
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
  const [mappingCatalog, setMappingCatalog] = useState({ provider: { resources: [] }, entities: [] });
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
  const [disconnectingOAuth, setDisconnectingOAuth] = useState(false);
  const [requestForm, setRequestForm] = useState({
    method: "GET",
    path: "/",
    url: "",
    headersText: "{}",
    queryText: "{}",
    jsonText: "{}",
    bodyText: "",
  });
  const [requestTemplateName, setRequestTemplateName] = useState("");
  const [editingRequestTemplateId, setEditingRequestTemplateId] = useState("");
  const [savingRequestTemplate, setSavingRequestTemplate] = useState(false);
  const [deletingRequestTemplateId, setDeletingRequestTemplateId] = useState("");
  const [selectedRequestPresetId, setSelectedRequestPresetId] = useState("");
  const [newMapping, setNewMapping] = useState(defaultNewMappingState);
  const [mappingDrawerOpen, setMappingDrawerOpen] = useState(false);
  const [editingMappingId, setEditingMappingId] = useState("");
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
  const [requestDrawerOpen, setRequestDrawerOpen] = useState(false);
  const [syncDrawerOpen, setSyncDrawerOpen] = useState(false);
  const [webhookDrawerOpen, setWebhookDrawerOpen] = useState(false);
  const [xeroConnectionDrawerOpen, setXeroConnectionDrawerOpen] = useState(false);
  const [shopifyConnectionDrawerOpen, setShopifyConnectionDrawerOpen] = useState(false);

  async function load() {
    if (!connectionId) return;
    setLoading(true);
    setError("");
    try {
      const [
        connectionRes,
        mappingCatalogRes,
        providersRes,
        secretsRes,
        mappingsRes,
        webhooksRes,
        logsRes,
        eventsRes,
        checkpointsRes,
      ] = await Promise.all([
        apiFetch(`/integrations/connections/${encodeURIComponent(connectionId)}`),
        apiFetch(`/integrations/connections/${encodeURIComponent(connectionId)}/mapping-catalog`),
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
      setMappingCatalog(mappingCatalogRes?.catalog || { provider: { resources: [] }, entities: [] });
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
      setMappingCatalog({ provider: { resources: [] }, entities: [] });
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
    const oauthStatus = params.get("oauth");
    const oauthMessage = params.get("message");
    const providerLabel = resolvedProviderKey ? `${resolvedProviderKey.charAt(0).toUpperCase()}${resolvedProviderKey.slice(1)}` : "Provider";
    if (oauthStatus === "connected") {
      setNotice(`${providerLabel} connected successfully.`);
      setOauthAuthorizeResult(null);
      void load();
    } else if (oauthStatus === "error") {
      setError(oauthMessage || `${providerLabel} connection failed.`);
      setOauthAuthorizeResult(null);
    }
    if (oauthStatus === "connected" || oauthStatus === "error" || returnedCode) {
      params.delete("oauth");
      params.delete("message");
      params.delete("code");
      const nextQuery = params.toString();
      const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash || ""}`;
      window.history.replaceState({}, "", nextUrl);
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
  const isShopifyProvider = providerKey === "shopify";
  const isDrawerManagedProvider = isXeroProvider || isShopifyProvider;
  const isManagedOauthProvider = providerKey === "xero" || providerKey === "shopify";
  const xeroConnected = isXeroProvider && Boolean(config?.xero_tenant_id);
  const oauthTokenBound = Boolean(
    secretRefs?.access_token ||
    secretRefs?.refresh_token ||
    config?.oauth_access_token_expires_at ||
    (config?.oauth_token_response && Object.keys(config.oauth_token_response || {}).length > 0),
  );
  const shopifyConnected = isShopifyProvider && Boolean(config?.shopify_myshopify_domain || config?.shopify_shop_name);
  const shopifyOauthBound = isShopifyProvider && oauthTokenBound;
  const shopifyReady = shopifyConnected || shopifyOauthBound;
  const latestTestLog = useMemo(
    () => (Array.isArray(requestLogs) ? requestLogs.find((row) => row?.source === "test_connection") || null : null),
    [requestLogs],
  );
  const latestTestResult = useMemo(() => {
    if (testResult) return testResult;
    if (!latestTestLog) return null;
    return {
      ok: typeof latestTestLog.ok === "boolean" ? latestTestLog.ok : latestTestLog.response_status < 400,
      status_code: latestTestLog.response_status ?? null,
      url: latestTestLog.url || null,
      method: latestTestLog.method || null,
      headers: latestTestLog.response_headers_json || {},
      body_json: latestTestLog.response_body_json ?? null,
      body_text: latestTestLog.response_body_text ?? null,
      error_message: latestTestLog.error_message || null,
    };
  }, [latestTestLog, testResult]);
  const latestTestedAt = latestTestLog?.created_at || item?.last_tested_at || null;
  const requestTemplates = useMemo(
    () => (Array.isArray(config?.request_templates) ? config.request_templates : []).map((template, index) => normalizeRequestTemplate(template, index)),
    [config],
  );
  const providerManifest = provider?.manifest_json || {};
  const providerCapabilities = Array.isArray(providerManifest?.capabilities) ? providerManifest.capabilities : [];
  const providerSupportsSync = providerCapabilities.includes("sync.poll");
  const authMode = String(config?.auth_mode || config?.provider_auth_type || "").trim().toLowerCase();
  const setupFields = Array.isArray(providerManifest?.setup_schema?.fields) ? providerManifest.setup_schema.fields : [];
  const syncFields = Array.isArray(providerManifest?.sync_schema?.fields) ? providerManifest.sync_schema.fields : [];
  const secretKeys = Array.isArray(providerManifest?.secret_keys) ? providerManifest.secret_keys : [];
  const requiresManualSecrets = !isManagedOauthProvider && secretKeys.length > 0;
  const mappingProvider = mappingCatalog?.provider || { resources: [] };
  const mappingEntities = Array.isArray(mappingCatalog?.entities) ? mappingCatalog.entities : [];
  const mappingResources = Array.isArray(mappingProvider?.resources) ? mappingProvider.resources : [];
  const xeroRequestPresets = useMemo(() => (isXeroProvider ? buildXeroRequestPresets(mappingResources) : []), [isXeroProvider, mappingResources]);
  const filteredXeroRequestPresets = useMemo(
    () => xeroRequestPresets.filter((preset) => String(preset?.method || "").trim().toUpperCase() === String(requestForm.method || "GET").trim().toUpperCase()),
    [requestForm.method, xeroRequestPresets],
  );
  const selectedXeroRequestPreset = useMemo(
    () => xeroRequestPresets.find((preset) => preset.id === selectedRequestPresetId) || null,
    [selectedRequestPresetId, xeroRequestPresets],
  );
  const selectedResource = useMemo(
    () => mappingResources.find((resource) => resource?.key === newMapping.resource_key) || null,
    [mappingResources, newMapping.resource_key],
  );
  const selectedTargetEntity = useMemo(
    () => mappingEntities.find((entity) => entity?.entity_id === newMapping.target_entity) || null,
    [mappingEntities, newMapping.target_entity],
  );
  const selectedEditingMapping = useMemo(
    () => (Array.isArray(mappings) ? mappings : []).find((mapping) => String(mapping?.id || "") === editingMappingId) || null,
    [editingMappingId, mappings],
  );
  const mappingDrawerTitle = editingMappingId
    ? (selectedEditingMapping?.name ? `Edit ${selectedEditingMapping.name}` : "Edit mapping profile")
    : "New mapping profile";
  const sampleSourceFieldOptions = useMemo(
    () => uniquePathOptions(collectJsonPaths(safeJsonParse(newMapping.sample_source_text, {}))),
    [newMapping.sample_source_text],
  );
  const sourceFieldOptions = useMemo(
    () => uniquePathOptions([...(selectedResource?.fields || []), ...sampleSourceFieldOptions]),
    [selectedResource, sampleSourceFieldOptions],
  );
  const targetFieldOptions = useMemo(
    () => uniquePathOptions((selectedTargetEntity?.fields || []).map((field) => ({ value: field.id, label: field.label || field.id, type: field.type || "", options: field.options || [] }))),
    [selectedTargetEntity],
  );

  useEffect(() => {
    if (!selectedRequestPresetId) return;
    if (filteredXeroRequestPresets.some((preset) => preset.id === selectedRequestPresetId)) return;
    setSelectedRequestPresetId("");
  }, [filteredXeroRequestPresets, selectedRequestPresetId]);
  const sourceFieldOptionMap = useMemo(
    () => new Map(sourceFieldOptions.map((field) => [field.value, field])),
    [sourceFieldOptions],
  );
  const targetFieldOptionMap = useMemo(
    () => new Map(targetFieldOptions.map((field) => [field.value, field])),
    [targetFieldOptions],
  );
  const targetFieldDefinitionById = useMemo(
    () => new Map((selectedTargetEntity?.fields || []).map((field) => [field.id, field])),
    [selectedTargetEntity],
  );
  const suggestedFieldMappings = useMemo(() => {
    const usedSourceValues = new Set();
    return targetFieldOptions
      .map((targetField) => {
        const sourceField = findBestMatchingField(targetField, sourceFieldOptions, usedSourceValues);
        if (!sourceField) return null;
        usedSourceValues.add(sourceField.value);
        return {
          to: targetField.value,
          value_type: "path",
          source: sourceField.value,
          transform: "",
        };
      })
      .filter(Boolean);
  }, [sourceFieldOptions, targetFieldOptions]);
  const selectedMatchOnFields = useMemo(
    () => String(newMapping.match_on_text || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
    [newMapping.match_on_text],
  );
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
  const shopifyDrawerSetupGroups = useMemo(
    () => visibleSetupGroups.filter(([groupKey]) => groupKey === "connection" || groupKey === "advanced"),
    [visibleSetupGroups],
  );
  const syncConfig = config?.sync || {};
  const selectedSyncResourceKey = String(syncConfig?.resource_key || "").trim();
  const selectedSyncResource = useMemo(
    () => mappingResources.find((resource) => resource?.key === selectedSyncResourceKey) || null,
    [mappingResources, selectedSyncResourceKey],
  );
  const selectedSyncMappingIds = useMemo(
    () => (Array.isArray(syncConfig?.mapping_ids) ? syncConfig.mapping_ids : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean),
    [syncConfig],
  );
  const selectedSyncMappings = useMemo(
    () => (Array.isArray(mappings) ? mappings : []).filter((mapping) => {
      const mappingResourceKey = String(mapping?.mapping_json?.resource_key || "").trim();
      if (mappingResourceKey !== selectedSyncResourceKey) return false;
      const usageScope = mappingUsageScopeValue(mapping);
      return usageScope === "sync_only" || usageScope === "sync_and_automation";
    }),
    [mappings, selectedSyncResourceKey],
  );
  const canSaveConnection = Boolean(item?.id && name.trim()) && !loading && !saving;
  const saveActionLabel = saving ? t("common.saving") : t("common.save");
  const connectionTitle = item?.name || provider?.name || "Integration";
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

  function applyXeroSyncResource(resourceKey) {
    const preset = xeroSyncPreset(resourceKey);
    setConfig((prev) => {
      const currentSync = { ...((prev || {}).sync || {}) };
      const nextSync = {
        ...currentSync,
        ...(preset || {}),
        resource_key: resourceKey,
        scope_key: currentSync.scope_key || preset?.scope_key || resourceKey,
      };
      const next = {
        ...(prev || {}),
        sync: nextSync,
      };
      setConfigText(prettyJson(next));
      return next;
    });
  }

  function toggleSyncMapping(mappingId) {
    const normalized = String(mappingId || "").trim();
    if (!normalized) return;
    setConfig((prev) => {
      const currentSync = { ...((prev || {}).sync || {}) };
      const currentIds = Array.isArray(currentSync.mapping_ids) ? currentSync.mapping_ids.map((item) => String(item || "").trim()).filter(Boolean) : [];
      const nextIds = currentIds.includes(normalized)
        ? currentIds.filter((item) => item !== normalized)
        : [...currentIds, normalized];
      const nextSync = { ...currentSync };
      if (nextIds.length) nextSync.mapping_ids = nextIds;
      else delete nextSync.mapping_ids;
      const next = { ...(prev || {}), sync: nextSync };
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

  function openNewRequestTemplateDrawer() {
    setEditingRequestTemplateId("");
    setRequestTemplateName("");
    setSelectedRequestPresetId("");
    setRequestForm({
      method: "GET",
      path: "/",
      url: "",
      headersText: "{}",
      queryText: "{}",
      jsonText: "{}",
      bodyText: "",
    });
    setRequestDrawerOpen(true);
  }

  function openRequestTemplateDrawer(template) {
    const normalized = normalizeRequestTemplate(template);
    setEditingRequestTemplateId(normalized.id);
    setRequestTemplateName(normalized.name);
    setSelectedRequestPresetId("");
    setRequestForm(requestTemplateToRequestForm(normalized));
    setRequestDrawerOpen(true);
  }

  function useRequestTemplate(template) {
    const normalized = normalizeRequestTemplate(template);
    setEditingRequestTemplateId(normalized.id);
    setRequestTemplateName(normalized.name);
    setSelectedRequestPresetId("");
    setRequestForm(requestTemplateToRequestForm(normalized));
  }

  async function persistConnectionPatch(body, successMessage = "") {
    if (!item?.id) return null;
    const res = await apiFetch(`/integrations/connections/${encodeURIComponent(item.id)}`, {
      method: "PATCH",
      body,
    });
    const nextConnection = res?.connection || null;
    if (nextConnection) {
      setItem(nextConnection);
      setConfig(nextConnection.config || {});
      setConfigText(prettyJson(nextConnection.config || {}));
    }
    if (successMessage) setNotice(successMessage);
    return nextConnection;
  }

  async function saveRequestTemplate() {
    if (!item?.id || savingRequestTemplate) return;
    const nameValue = String(requestTemplateName || "").trim();
    if (!nameValue) {
      setError("Template name is required.");
      return;
    }
    setSavingRequestTemplate(true);
    setError("");
    setNotice("");
    try {
      const nextTemplate = normalizeRequestTemplate(
        {
          id: editingRequestTemplateId || makeClientId("request_template"),
          name: nameValue,
          method: requestForm.method,
          path: requestForm.path,
          url: requestForm.url,
          headers: safeJsonParse(requestForm.headersText, {}),
          query: safeJsonParse(requestForm.queryText, {}),
          json: safeJsonParse(requestForm.jsonText, {}),
          body: requestForm.bodyText,
          updated_at: new Date().toISOString(),
        },
        requestTemplates.length,
      );
      const nextTemplates = editingRequestTemplateId
        ? requestTemplates.map((template) => (template.id === editingRequestTemplateId ? nextTemplate : template))
        : [...requestTemplates, nextTemplate];
      await persistConnectionPatch(
        {
          config: {
            ...(config || {}),
            request_templates: nextTemplates,
          },
        },
        editingRequestTemplateId ? "Request template updated." : "Request template saved.",
      );
      setEditingRequestTemplateId(nextTemplate.id);
      setRequestTemplateName(nextTemplate.name);
    } catch (err) {
      setError(err?.message || "Failed to save request template.");
    } finally {
      setSavingRequestTemplate(false);
    }
  }

  async function deleteRequestTemplate(templateId) {
    const normalized = String(templateId || "").trim();
    if (!item?.id || !normalized || deletingRequestTemplateId) return;
    setDeletingRequestTemplateId(normalized);
    setError("");
    setNotice("");
    try {
      const nextTemplates = requestTemplates.filter((template) => template.id !== normalized);
      await persistConnectionPatch(
        {
          config: {
            ...(config || {}),
            request_templates: nextTemplates,
          },
        },
        "Request template removed.",
      );
      if (editingRequestTemplateId === normalized) {
        setEditingRequestTemplateId("");
        setRequestTemplateName("");
      }
    } catch (err) {
      setError(err?.message || "Failed to remove request template.");
    } finally {
      setDeletingRequestTemplateId("");
    }
  }

  function applyRequestPreset(preset = {}) {
    setRequestForm((prev) => ({
      ...prev,
      method: preset.method || "GET",
      path: preset.path || "",
      url: preset.url || "",
      queryText: preset.queryText ?? "{}",
      headersText: preset.headersText ?? "{}",
      jsonText: preset.jsonText ?? "{}",
      bodyText: preset.bodyText ?? "",
    }));
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

  async function persistCurrentConnectionDraft({ successMessage = "", shouldLoad = true } = {}) {
    if (!item?.id) return null;
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
    if (successMessage) setNotice(successMessage);
    if (shouldLoad) await load();
    return res?.connection || null;
  }

  async function save() {
    if (!item?.id || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await persistCurrentConnectionDraft({ successMessage: detailT("notices.connection_saved") });
    } catch (err) {
      setError(err?.message || detailT("errors.save_failed"));
    } finally {
      setSaving(false);
    }
  }

  async function connectShopify() {
    if (!item?.id || authorizingOAuth || !oauthRedirectUri.trim()) return;
    setAuthorizingOAuth(true);
    setError("");
    setNotice("");
    try {
      await persistCurrentConnectionDraft({ shouldLoad: false });
      const body = {
        redirect_uri: oauthRedirectUri.trim(),
        return_origin: typeof window !== "undefined" ? window.location.origin : "",
      };
      const res = await apiFetch(`/integrations/connections/${encodeURIComponent(item.id)}/oauth/authorize-url`, {
        method: "POST",
        body,
      });
      const result = res?.result || null;
      setOauthAuthorizeResult(result);
      if (result?.authorize_url && typeof window !== "undefined") {
        window.location.assign(result.authorize_url);
        return;
      }
      setNotice("Shopify authorize URL generated.");
    } catch (err) {
      setOauthAuthorizeResult(null);
      const rawMessage = String(err?.message || "Failed to connect Shopify.");
      setError(
        rawMessage.includes("Unsupported integration provider: shopify")
          ? `${rawMessage}. The API deployment behind this workspace is still running an older build. Deploy the API/backend that includes Shopify provider support, then try again.`
          : rawMessage,
      );
    } finally {
      setAuthorizingOAuth(false);
    }
  }

  async function runTest() {
    if (!item?.id || testing) return;
    setTesting(true);
    setError("");
    setNotice("");
    try {
      const res = await apiFetch(`/integrations/connections/${encodeURIComponent(item.id)}/test`, { method: "POST" });
      const result = res?.result || null;
      const nowIso = new Date().toISOString();
      setTestResult(result);
      setItem((prev) => (
        prev
          ? {
              ...prev,
              health_status: result?.ok ? "ok" : "error",
              last_tested_at: nowIso,
              last_success_at: result?.ok ? nowIso : prev.last_success_at,
              last_error: result?.ok ? null : `HTTP ${result?.status_code ?? "error"}`,
            }
          : prev
      ));
      setRequestLogs((prev) => ([
        {
          id: `test-${Date.now()}`,
          created_at: nowIso,
          source: "test_connection",
          method: result?.method || null,
          url: result?.url || null,
          response_status: result?.status_code ?? null,
          response_headers_json: result?.headers || {},
          response_body_json: result?.body_json ?? null,
          response_body_text: result?.body_text ?? null,
          ok: result?.ok,
          error_message: null,
        },
        ...(Array.isArray(prev) ? prev.filter((row) => row?.source !== "test_connection" || row?.created_at !== nowIso) : []),
      ]));
    } catch (err) {
      const errorMessage = err?.message || detailT("errors.connection_test_failed");
      const nowIso = new Date().toISOString();
      setTestResult({ ok: false, error_message: errorMessage });
      setItem((prev) => (
        prev
          ? {
              ...prev,
              health_status: "error",
              last_tested_at: nowIso,
              last_error: errorMessage,
            }
          : prev
      ));
      setRequestLogs((prev) => ([
        {
          id: `test-${Date.now()}`,
          created_at: nowIso,
          source: "test_connection",
          method: null,
          url: null,
          response_status: null,
          response_headers_json: {},
          response_body_json: null,
          response_body_text: null,
          ok: false,
          error_message: errorMessage,
        },
        ...(Array.isArray(prev) ? prev.filter((row) => row?.source !== "test_connection" || row?.created_at !== nowIso) : []),
      ]));
      setError(errorMessage);
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
      const method = String(requestForm.method || "GET").trim().toUpperCase();
      const allowsRequestBody = !["GET", "DELETE", "HEAD"].includes(method);
      const payload = {
        method,
        path: requestForm.path || undefined,
        url: requestForm.url || undefined,
        headers: safeJsonParse(requestForm.headersText, {}),
        query: safeJsonParse(requestForm.queryText, {}),
      };
      if (requestForm.bodyText.trim()) payload.body = requestForm.bodyText;
      else if (allowsRequestBody) payload.json = safeJsonParse(requestForm.jsonText, {});
      const res = await apiFetch(`/integrations/connections/${encodeURIComponent(item.id)}/request`, {
        method: "POST",
        body: payload,
      });
      const result = res?.result || null;
      const nowIso = new Date().toISOString();
      setRequestResult(result);
      setRequestLogs((prev) => ([
        {
          id: `request-${Date.now()}`,
          created_at: nowIso,
          source: "manual_request",
          method: result?.method || method,
          url: result?.url || payload.url || payload.path || null,
          response_status: result?.status_code ?? null,
          response_headers_json: result?.headers || {},
          response_body_json: result?.body_json ?? null,
          response_body_text: result?.body_text ?? null,
          ok: result?.ok,
          error_message: result?.ok ? null : `HTTP ${result?.status_code ?? "error"}`,
        },
        ...(Array.isArray(prev) ? prev : []),
      ]));
      setNotice(detailT("notices.request_completed"));
    } catch (err) {
      setRequestResult(null);
      setError(err?.message || detailT("errors.request_failed"));
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
      const body = { redirect_uri: oauthRedirectUri.trim() };
      if (isManagedOauthProvider) {
        body.return_origin = typeof window !== "undefined" ? window.location.origin : "";
      } else {
        body.state = encodeIntegrationOauthState({
          connectionId: item.id,
          providerKey,
          returnOrigin: typeof window !== "undefined" ? window.location.origin : "",
        });
      }
      const res = await apiFetch(`/integrations/connections/${encodeURIComponent(item.id)}/oauth/authorize-url`, {
        method: "POST",
        body,
      });
      const result = res?.result || null;
      setOauthAuthorizeResult(result);
      if (isManagedOauthProvider && result?.authorize_url && typeof window !== "undefined") {
        window.location.assign(result.authorize_url);
        return;
      }
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

  async function disconnectOauthConnection() {
    if (!item?.id || disconnectingOAuth) return;
    setDisconnectingOAuth(true);
    setError("");
    setNotice("");
    try {
      const res = await apiFetch(`/integrations/connections/${encodeURIComponent(item.id)}/oauth/disconnect`, { method: "POST" });
      setOauthAuthorizeResult(null);
      setOauthCode("");
      setTestResult(null);
      setXeroConnectionDrawerOpen(false);
      setShopifyConnectionDrawerOpen(false);
      setNotice(isManagedOauthProvider ? `${provider?.name || providerKey || "Provider"} disconnected.` : detailT("notices.connection_saved"));
      await load();
      if (res?.connection) {
        setItem(res.connection);
        setConfig(res.connection.config || {});
        setConfigText(prettyJson(res.connection.config || {}));
      }
    } catch (err) {
      setError(err?.message || (isManagedOauthProvider ? `Failed to disconnect ${provider?.name || providerKey || "provider"}.` : detailT("errors.save_failed")));
    } finally {
      setDisconnectingOAuth(false);
    }
  }

  function selectMappingResource(resourceKey) {
    const nextResource = mappingResources.find((resource) => resource?.key === resourceKey) || null;
    setNewMapping((prev) => {
      const nextSourceEntity = nextResource?.source_entity || (resourceKey ? `${providerKey}.${resourceKey}` : "");
      const nextTargetEntity = prev.target_entity || nextResource?.suggested_target_entity || "";
      const nextSample = nextResource?.sample_record && (!prev.sample_source_text || prev.sample_source_text === "{}")
        ? prettyJson(nextResource.sample_record)
        : prev.sample_source_text;
      return {
        ...prev,
        resource_key: resourceKey,
        source_entity: nextSourceEntity,
        target_entity: nextTargetEntity,
        sample_source_text: nextSample,
      };
    });
  }

  function toggleMatchOnField(fieldId) {
    setNewMapping((prev) => {
      const current = String(prev.match_on_text || "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      const next = current.includes(fieldId)
        ? current.filter((item) => item !== fieldId)
        : [...current, fieldId];
      return { ...prev, match_on_text: next.join(", ") };
    });
  }

  function applySuggestedFieldMappings() {
    if (!suggestedFieldMappings.length) return;
    setNewMapping((prev) => ({
      ...prev,
      field_mappings: suggestedFieldMappings,
    }));
  }

  function resetMappingEditor() {
    setNewMapping(defaultNewMappingState());
    setMappingPreview(null);
    setEditingMappingId("");
  }

  function closeMappingDrawer() {
    if (creatingMapping || previewingMapping) return;
    setMappingDrawerOpen(false);
    resetMappingEditor();
  }

  function openNewMappingDrawer() {
    resetMappingEditor();
    setMappingDrawerOpen(true);
  }

  function openEditMappingDrawer(mapping) {
    if (!mapping?.id) return;
    setEditingMappingId(String(mapping.id));
    setNewMapping(mappingFormFromRecord(mapping));
    setMappingPreview(null);
    setMappingDrawerOpen(true);
  }

  function resetCurrentMappingForm() {
    if (selectedEditingMapping) {
      setNewMapping(mappingFormFromRecord(selectedEditingMapping));
    } else {
      setNewMapping(defaultNewMappingState());
    }
    setMappingPreview(null);
  }

  async function saveMapping() {
    if (creatingMapping || !item?.id) return;
    setCreatingMapping(true);
    setError("");
    try {
      const guidedMapping = buildMappingJsonFromForm(newMapping);
      const advancedMapping = safeJsonParse(newMapping.mapping_json_text, {});
      const sourceEntity = newMapping.source_entity.trim() || selectedResource?.source_entity || (newMapping.resource_key.trim() ? `${providerKey}.${newMapping.resource_key.trim()}` : "");
      const body = {
        connection_id: item.id,
        name: newMapping.name.trim(),
        source_entity: sourceEntity,
        target_entity: newMapping.target_entity.trim(),
        mapping_json: { ...guidedMapping, ...advancedMapping },
      };
      if (editingMappingId) {
        await apiFetch(`/integrations/mappings/${encodeURIComponent(editingMappingId)}`, {
          method: "PATCH",
          body,
        });
        setNotice("Mapping profile updated.");
      } else {
        await apiFetch("/integrations/mappings", {
          method: "POST",
          body,
        });
        setNotice(detailT("notices.mapping_added"));
      }
      setMappingDrawerOpen(false);
      resetMappingEditor();
      await load();
    } catch (err) {
      setError(err?.message || (editingMappingId ? "Failed to update mapping profile" : detailT("errors.create_mapping")));
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

  function updateFieldValueMapRow(rowIndex, mapIndex, updates) {
    setNewMapping((prev) => ({
      ...prev,
      field_mappings: (prev.field_mappings || []).map((row, index) => {
        if (index !== rowIndex) return row;
        const nextRows = Array.isArray(row.value_map_rows) ? row.value_map_rows : [];
        return {
          ...row,
          value_map_rows: nextRows.map((entry, entryIndex) => (entryIndex === mapIndex ? { ...entry, ...updates } : entry)),
        };
      }),
    }));
  }

  function addFieldValueMapRow(rowIndex) {
    setNewMapping((prev) => ({
      ...prev,
      field_mappings: (prev.field_mappings || []).map((row, index) => (
        index === rowIndex
          ? {
              ...row,
              value_map_rows: [...(Array.isArray(row.value_map_rows) ? row.value_map_rows : []), { from: "", to: "" }],
            }
          : row
      )),
    }));
  }

  function removeFieldValueMapRow(rowIndex, mapIndex) {
    setNewMapping((prev) => ({
      ...prev,
      field_mappings: (prev.field_mappings || []).map((row, index) => {
        if (index !== rowIndex) return row;
        return {
          ...row,
          value_map_rows: (Array.isArray(row.value_map_rows) ? row.value_map_rows : []).filter((_, entryIndex) => entryIndex !== mapIndex),
        };
      }),
    }));
  }

  function addFieldMappingRow() {
    setNewMapping((prev) => ({
      ...prev,
      field_mappings: [...(prev.field_mappings || []), { to: "", value_type: "path", source: "", transform: "", value_map_rows: [], value_map_default: "" }],
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
      setWebhookDrawerOpen(false);
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
    const readOnly = (isXeroProvider && XERO_READONLY_SETUP_FIELDS.has(fieldId))
      || (isShopifyProvider && SHOPIFY_READONLY_SETUP_FIELDS.has(fieldId));
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
    if (isShopifyProvider && fieldId === "client_id") {
      return (
        <div key={fieldId} className="form-control gap-3">
          <label className="form-control">
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

          <div className="rounded-box border border-base-300 bg-base-200/50 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Client secret</div>
                <div className="mt-1 text-xs opacity-70">
                  Store the Shopify app client secret in Secrets and link it here for OAuth.
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => openCreateSecretModal("client_secret")}>
                Create client secret
              </button>
            </div>
            <label className="form-control mt-3">
              <span className="label-text text-sm">Stored client secret</span>
              <AppSelect
                className="select select-bordered"
                value={secretRefs?.client_secret || ""}
                onChange={(e) => updateSecretRef("client_secret", e.target.value)}
              >
                <option value="">No secret selected</option>
                {secretsForSlot("client_secret").map((secret) => (
                  <option key={secret.id} value={secret.id}>
                    {secret.name || secret.id}
                    {secret.provider_key || secret.secret_key
                      ? ` • ${[secret.provider_key, secret.secret_key].filter(Boolean).join(" / ")}`
                      : ""}
                  </option>
                ))}
              </AppSelect>
              <span className="label-text-alt opacity-70 mt-1">
                {selectedShopifyClientSecret
                  ? `Linked secret: ${selectedShopifyClientSecret.name || selectedShopifyClientSecret.id}`
                  : "Create or select a stored secret for the Shopify app client secret."}
              </span>
            </label>
          </div>
        </div>
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
    if (fieldType === "select") {
      const options = Array.isArray(field.options) ? field.options : [];
      return (
        <label key={fieldId} className="form-control">
          <span className="label-text text-sm">{label}</span>
          <AppSelect
            className="select select-bordered"
            value={syncConfig?.[fieldId] || ""}
            onChange={(e) => {
              const nextValue = e.target.value;
              if (isXeroProvider && fieldId === "resource_key") {
                applyXeroSyncResource(nextValue);
              } else {
                updateSyncField(fieldId, nextValue);
              }
            }}
          >
            <option value="">{placeholder || `Select ${label.toLowerCase()}`}</option>
            {options.map((option) => {
              const normalized = typeof option === "string"
                ? { value: option, label: option }
                : { value: String(option?.value || ""), label: String(option?.label || option?.value || "") };
              if (!normalized.value) return null;
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
  const selectedShopifyClientSecret = useMemo(
    () => secretsById.get(secretRefs?.client_secret) || null,
    [secretsById, secretRefs],
  );
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
            ? `Connected to ${config?.xero_tenant_name || "the selected Xero organisation"}. Use Connection in the page header to reconnect, refresh tokens, or review the connection.`
            : "Use Connection in the page header to sign in to Xero and finish setup for this workspace.",
          actionLabel: "Open Connection",
          onAction: () => setXeroConnectionDrawerOpen(true),
          complete: Boolean(config?.xero_tenant_id),
        });
      } else if (isShopifyProvider) {
        steps.push({
          icon: KeyRound,
          title: "Connect the Shopify store",
          description: shopifyConnected
            ? `Connected to ${config?.shopify_shop_name || config?.shopify_myshopify_domain || "the selected Shopify store"}. Use Connection in the page header to reconnect, refresh tokens, or review the connection.`
            : "Use Connection in the page header to save the app credentials, link the client secret, and authorize this store.",
          actionLabel: "Open Connection",
          onAction: () => setShopifyConnectionDrawerOpen(true),
          complete: shopifyConnected,
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
        description: isXeroProvider && !config?.xero_tenant_id
          ? "Open Connection in the page header, connect Xero, then run the connection test from that drawer."
          : isShopifyProvider && !shopifyConnected
            ? "Open Connection in the page header, connect Shopify, then run the connection test from that drawer."
          : hasTestedConnection
            ? (isXeroProvider
              ? `${detailT("setup.guide.last_tested", { value: formatDateTime(item?.last_tested_at, detailT("setup.guide.recently")) })} Use Connection in the page header to run it again.`
              : detailT("setup.guide.last_tested", { value: formatDateTime(item?.last_tested_at, detailT("setup.guide.recently")) }))
            : detailT("setup.guide.test_description"),
        actionLabel: isXeroProvider ? "Open Connection" : (isShopifyProvider && !shopifyConnected ? "Open Connection" : detailT("setup.guide.test_now")),
        onAction: isXeroProvider ? (() => setXeroConnectionDrawerOpen(true)) : (isShopifyProvider && !shopifyConnected ? (() => setShopifyConnectionDrawerOpen(true)) : runTest),
        complete: Boolean(item?.health_status && item.health_status !== "error" && hasTestedConnection),
      });
      return steps;
    },
    [config, detailT, hasTestedConnection, isShopifyProvider, isXeroProvider, item?.health_status, item?.last_tested_at, linkedSecretCount, name, secretKeys, setupFields.length, shopifyConnected, t],
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

  const mappingEditorContent = (
    <div className="space-y-4">
      <div className="rounded-box border border-base-300 bg-base-200/50 p-4 text-sm">
        <div className="font-medium">Profile editor</div>
        <div className="mt-1 opacity-80">
          One mapping profile is one reusable recipe for translating a provider record into OCTO fields.
        </div>
      </div>
      <label className="form-control">
        <span className="label-text text-sm">{t("common.name")}</span>
        <input className="input input-bordered" value={newMapping.name} onChange={(e) => setNewMapping((prev) => ({ ...prev, name: e.target.value }))} placeholder={detailT("mappings.name_placeholder")} />
      </label>
      <label className="form-control">
        <span className="label-text text-sm">{detailT("mappings.source_entity")}</span>
        {mappingResources.length ? (
          <input
            className="input input-bordered"
            value={newMapping.source_entity || selectedResource?.source_entity || ""}
            readOnly
            placeholder={detailT("mappings.source_entity_placeholder")}
          />
        ) : (
          <input className="input input-bordered" value={newMapping.source_entity} onChange={(e) => setNewMapping((prev) => ({ ...prev, source_entity: e.target.value }))} placeholder={detailT("mappings.source_entity_placeholder")} />
        )}
        <span className="label-text-alt opacity-70 mt-1">{detailT("mappings.source_entity_help")}</span>
      </label>
      <label className="form-control">
        <span className="label-text text-sm">{detailT("mappings.target_entity")}</span>
        {mappingEntities.length ? (
          <AppSelect
            className="select select-bordered"
            value={newMapping.target_entity}
            onChange={(e) => setNewMapping((prev) => ({ ...prev, target_entity: e.target.value }))}
          >
            <option value="">{detailT("mappings.target_entity_placeholder")}</option>
            {mappingEntities.map((entity) => (
              <option key={entity.entity_id} value={entity.entity_id}>
                {entity.label || entity.entity_id}
              </option>
            ))}
          </AppSelect>
        ) : (
          <input className="input input-bordered" value={newMapping.target_entity} onChange={(e) => setNewMapping((prev) => ({ ...prev, target_entity: e.target.value }))} placeholder={detailT("mappings.target_entity_placeholder")} />
        )}
        <span className="label-text-alt opacity-70 mt-1">{detailT("mappings.target_entity_help")}</span>
      </label>
      <label className="form-control">
        <span className="label-text text-sm">{detailT("mappings.resource_key")}</span>
        {mappingResources.length ? (
          <AppSelect
            className="select select-bordered"
            value={newMapping.resource_key}
            onChange={(e) => selectMappingResource(e.target.value)}
          >
            <option value="">{detailT("mappings.resource_key_placeholder")}</option>
            {mappingResources.map((resource) => (
              <option key={resource.key} value={resource.key}>
                {resource.label || resource.key}
              </option>
            ))}
          </AppSelect>
        ) : (
          <input className="input input-bordered" value={newMapping.resource_key} onChange={(e) => setNewMapping((prev) => ({ ...prev, resource_key: e.target.value }))} placeholder={detailT("mappings.resource_key_placeholder")} />
        )}
        <span className="label-text-alt opacity-70 mt-1">{detailT("mappings.resource_key_help")}</span>
      </label>
      {selectedResource || selectedTargetEntity ? (
        <div className="rounded-box border border-base-300 bg-base-100 p-3 text-sm">
          <div className="font-medium">Mapping direction</div>
          <div className="mt-1 opacity-80">
            {(selectedResource?.label || newMapping.resource_key || "Provider record")}
            {" -> "}
            {(selectedTargetEntity?.label || newMapping.target_entity || "OCTO entity")}
          </div>
          <div className="mt-1 text-xs opacity-60">
            Provider records from this resource will be translated into fields on the selected OCTO entity.
          </div>
        </div>
      ) : null}
      <label className="form-control">
        <span className="label-text text-sm">Usage</span>
        <AppSelect className="select select-bordered" value={newMapping.usage_scope} onChange={(e) => setNewMapping((prev) => ({ ...prev, usage_scope: e.target.value }))}>
          <option value="sync_and_automation">Sync + Automation</option>
          <option value="sync_only">Sync only</option>
          <option value="automation_only">Automation only</option>
        </AppSelect>
        <span className="label-text-alt opacity-70 mt-1">Use sync-only mappings during integration sync, automation-only mappings inside workflows, or make one profile reusable for both.</span>
      </label>
      <label className="form-control">
        <span className="label-text text-sm">{detailT("mappings.record_mode")}</span>
        <AppSelect className="select select-bordered" value={newMapping.record_mode} onChange={(e) => setNewMapping((prev) => ({ ...prev, record_mode: e.target.value }))}>
          <option value="upsert">{detailT("mappings.record_mode_upsert")}</option>
          <option value="create">{detailT("mappings.record_mode_create")}</option>
        </AppSelect>
      </label>
      {newMapping.record_mode === "upsert" ? (
        targetFieldOptions.length ? (
          <div className="form-control">
            <span className="label-text text-sm">{detailT("mappings.match_on")}</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {targetFieldOptions.map((field) => {
                const selected = selectedMatchOnFields.includes(field.value);
                return (
                  <button
                    key={field.value}
                    className={`btn btn-xs ${selected ? "btn-primary" : "btn-outline"}`}
                    type="button"
                    onClick={() => toggleMatchOnField(field.value)}
                  >
                    {field.label}
                  </button>
                );
              })}
            </div>
            <span className="label-text-alt opacity-70 mt-1">{detailT("mappings.match_on_help")}</span>
          </div>
        ) : (
          <label className="form-control">
            <span className="label-text text-sm">{detailT("mappings.match_on")}</span>
            <input className="input input-bordered" value={newMapping.match_on_text} onChange={(e) => setNewMapping((prev) => ({ ...prev, match_on_text: e.target.value }))} placeholder={detailT("mappings.match_on_placeholder")} />
            <span className="label-text-alt opacity-70 mt-1">{detailT("mappings.match_on_help")}</span>
          </label>
        )
      ) : null}

      <Section title={detailT("mappings.field_mappings_title")} help={detailT("mappings.field_mappings_help")}>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              className="btn btn-sm btn-outline"
              type="button"
              onClick={applySuggestedFieldMappings}
              disabled={!suggestedFieldMappings.length}
            >
              Auto-fill suggested fields
            </button>
            {suggestedFieldMappings.length ? (
              <div className="text-xs opacity-70 self-center">
                Found {suggestedFieldMappings.length} likely provider {"->"} OCTO field matches from the selected resource and entity.
              </div>
            ) : (
              <div className="text-xs opacity-60 self-center">
                Choose a provider resource and target OCTO entity first to enable field suggestions.
              </div>
            )}
          </div>
          {(newMapping.field_mappings || []).map((row, index) => (
            <div key={index} className="rounded-box border border-base-300 bg-base-100 p-3 space-y-3">
              {(() => {
                const targetFieldDef = targetFieldDefinitionById.get(row?.to);
                const targetEnumOptions = normalizeOptionItems(targetFieldDef?.options);
                const sourceSampleRecord = safeJsonParse(newMapping.sample_source_text, selectedResource?.sample_record || {});
                const sourceSampleValue = row?.value_type === "path" && row?.source ? (() => {
                  try {
                    return row.source.split(".").reduce((current, part) => {
                      if (current == null) return undefined;
                      const token = String(part || "").trim();
                      if (!token) return current;
                      const bracketMatch = token.match(/^(.+)\[(\d+)\]$/);
                      if (bracketMatch) {
                        const next = current?.[bracketMatch[1]];
                        return Array.isArray(next) ? next[Number(bracketMatch[2])] : undefined;
                      }
                      return current?.[token];
                    }, sourceSampleRecord);
                  } catch {
                    return undefined;
                  }
                })() : undefined;
                const sourceValueSuggestions = Array.isArray(sourceSampleValue)
                  ? sourceSampleValue.filter((item) => ["string", "number"].includes(typeof item)).map((item) => String(item))
                  : ["string", "number"].includes(typeof sourceSampleValue)
                    ? [String(sourceSampleValue)]
                    : [];
                const sourceValueSuggestionsUnique = Array.from(new Set(sourceValueSuggestions.filter(Boolean)));
                const sourceValueDatalistId = `mapping-source-values-${index}`;
                return (
                  <>
                    <div className="rounded-box bg-base-200/70 px-3 py-2 text-sm font-medium">
                      {mappingPairSummary(row, sourceFieldOptionMap, targetFieldOptionMap, mappingProvider?.provider_name || provider?.name || providerKey)}
                    </div>
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
                      <span className="label-text text-sm">
                        {row.value_type === "constant"
                          ? "Constant value"
                          : row.value_type === "ref"
                            ? "Reference"
                            : `${mappingProvider?.provider_name || provider?.name || "Provider"} field`}
                      </span>
                      {row.value_type === "path" && sourceFieldOptions.length ? (
                        <AppSelect
                          className="select select-bordered"
                          value={row.source}
                          onChange={(e) => {
                            const nextSource = e.target.value;
                            const updates = { source: nextSource };
                            if (!row.to) {
                              const matchedTarget = findBestMatchingField(sourceFieldOptionMap.get(nextSource), targetFieldOptions);
                              if (matchedTarget?.value) updates.to = matchedTarget.value;
                            }
                            updateFieldMappingRow(index, updates);
                          }}
                        >
                          <option value="">{detailT("mappings.source_path_placeholder")}</option>
                          {sourceFieldOptions.map((field) => (
                            <option key={field.value} value={field.value}>
                              {field.label}{field.type ? ` (${field.type})` : ""}
                            </option>
                          ))}
                        </AppSelect>
                      ) : (
                        <input
                          className="input input-bordered"
                          value={row.source}
                          onChange={(e) => updateFieldMappingRow(index, { source: e.target.value })}
                          placeholder={row.value_type === "constant" ? detailT("mappings.constant_placeholder") : row.value_type === "ref" ? detailT("mappings.reference_placeholder") : detailT("mappings.source_path_placeholder")}
                        />
                      )}
                    </label>
                    <label className="form-control">
                      <span className="label-text text-sm">OCTO field</span>
                      {targetFieldOptions.length ? (
                        <AppSelect
                          className="select select-bordered"
                          value={row.to}
                          onChange={(e) => {
                            const nextTarget = e.target.value;
                            const updates = { to: nextTarget };
                            if (row.value_type === "path" && !row.source) {
                              const matchedSource = findBestMatchingField(targetFieldOptionMap.get(nextTarget), sourceFieldOptions);
                              if (matchedSource?.value) updates.source = matchedSource.value;
                            }
                            updateFieldMappingRow(index, updates);
                          }}
                        >
                          <option value="">{detailT("mappings.target_field_placeholder")}</option>
                          {targetFieldOptions.map((field) => (
                            <option key={field.value} value={field.value}>
                              {field.label}
                            </option>
                          ))}
                        </AppSelect>
                      ) : (
                        <input
                          className="input input-bordered"
                          value={row.to}
                          onChange={(e) => updateFieldMappingRow(index, { to: e.target.value })}
                          placeholder={detailT("mappings.target_field_placeholder")}
                        />
                      )}
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
                    <div className="space-y-3 rounded-box border border-base-300 bg-base-200/40 p-3">
                      <div>
                        <div className="text-sm font-medium">Value map</div>
                        <div className="mt-1 text-xs opacity-70">
                          Use this when the provider value and OCTO value are named differently, for example
                          <span className="font-medium"> supplier {"->"} NL supplier</span>.
                        </div>
                        {targetEnumOptions.length ? (
                          <div className="mt-1 text-xs opacity-60">
                            Valid OCTO values for this field: {targetEnumOptions.map((option) => option.label).join(", ")}
                          </div>
                        ) : null}
                      </div>
                      {(Array.isArray(row.value_map_rows) ? row.value_map_rows : []).map((entry, mapIndex) => (
                        <div key={`${index}-map-${mapIndex}`} className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                          <label className="form-control">
                            <span className="label-text text-sm">{mappingProvider?.provider_name || provider?.name || "Provider"} value</span>
                            <input
                              className="input input-bordered"
                              list={sourceValueSuggestionsUnique.length ? sourceValueDatalistId : undefined}
                              value={entry.from || ""}
                              onChange={(e) => updateFieldValueMapRow(index, mapIndex, { from: e.target.value })}
                              placeholder="supplier"
                            />
                            {sourceValueSuggestionsUnique.length ? (
                              <datalist id={sourceValueDatalistId}>
                                {sourceValueSuggestionsUnique.map((option) => (
                                  <option key={option} value={option} />
                                ))}
                              </datalist>
                            ) : null}
                          </label>
                          <label className="form-control">
                            <span className="label-text text-sm">OCTO value</span>
                            {targetEnumOptions.length ? (
                              <AppSelect
                                className="select select-bordered"
                                value={entry.to || ""}
                                onChange={(e) => updateFieldValueMapRow(index, mapIndex, { to: e.target.value })}
                              >
                                <option value="">Select OCTO value</option>
                                {targetEnumOptions.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </AppSelect>
                            ) : (
                              <input
                                className="input input-bordered"
                                value={entry.to || ""}
                                onChange={(e) => updateFieldValueMapRow(index, mapIndex, { to: e.target.value })}
                                placeholder="NL supplier"
                              />
                            )}
                          </label>
                          <div className="flex items-end">
                            <button className="btn btn-ghost btn-sm text-error" type="button" onClick={() => removeFieldValueMapRow(index, mapIndex)}>
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                      <div className="flex flex-wrap gap-2">
                        <button className="btn btn-sm btn-outline" type="button" onClick={() => addFieldValueMapRow(index)}>
                          <Plus className="h-4 w-4" />
                          Add value map
                        </button>
                      </div>
                      <label className="form-control">
                        <span className="label-text text-sm">Fallback OCTO value</span>
                        {targetEnumOptions.length ? (
                          <AppSelect
                            className="select select-bordered"
                            value={row.value_map_default || ""}
                            onChange={(e) => updateFieldMappingRow(index, { value_map_default: e.target.value })}
                          >
                            <option value="">Leave original provider value</option>
                            {targetEnumOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </AppSelect>
                        ) : (
                          <input
                            className="input input-bordered"
                            value={row.value_map_default || ""}
                            onChange={(e) => updateFieldMappingRow(index, { value_map_default: e.target.value })}
                            placeholder="Leave blank to keep the original provider value when no map entry matches"
                          />
                        )}
                      </label>
                    </div>
                    <div className="flex justify-end">
                      <button className="btn btn-ghost btn-sm text-error" type="button" onClick={() => removeFieldMappingRow(index)} disabled={(newMapping.field_mappings || []).length <= 1}>
                        {detailT("mappings.remove_row")}
                      </button>
                    </div>
                  </>
                );
              })()}
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
            {selectedResource?.sample_record ? (
              <button
                className="btn btn-sm btn-ghost"
                type="button"
                onClick={() => setNewMapping((prev) => ({ ...prev, sample_source_text: prettyJson(selectedResource.sample_record) }))}
              >
                Use {selectedResource.label || selectedResource.key} sample
              </button>
            ) : null}
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
        <button className="btn btn-primary btn-sm" type="button" onClick={saveMapping} disabled={creatingMapping || !newMapping.name.trim() || !(newMapping.source_entity.trim() || selectedResource?.source_entity || newMapping.resource_key.trim()) || !newMapping.target_entity.trim()}>
          {creatingMapping ? (editingMappingId ? "Saving..." : detailT("mappings.adding")) : (editingMappingId ? "Save mapping profile" : detailT("mappings.add"))}
        </button>
        <button className="btn btn-ghost btn-sm" type="button" onClick={resetCurrentMappingForm} disabled={creatingMapping || previewingMapping}>
          {detailT("mappings.reset")}
        </button>
      </div>
    </div>
  );

  const requestDrawerContent = (
    <div className="space-y-4">
      <div className="space-y-3">
        <label className="form-control">
          <span className="label-text text-sm">Template name</span>
          <input
            className="input input-bordered"
            value={requestTemplateName}
            onChange={(e) => setRequestTemplateName(e.target.value)}
            placeholder="Create Xero invoice"
          />
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          <button className="btn btn-outline btn-sm" type="button" onClick={saveRequestTemplate} disabled={savingRequestTemplate}>
            {savingRequestTemplate ? "Saving template..." : (editingRequestTemplateId ? "Update template" : "Save as template")}
          </button>
        </div>
      </div>

      {isXeroProvider ? (
        <div className="rounded-box border border-base-300 bg-base-200/50 p-4 text-sm">
          <div className="font-medium">Request presets</div>
          <div className="mt-1 opacity-80">Choose a common Xero request for the current method, then adjust the fields below if needed.</div>
          <label className="form-control mt-3">
            <span className="label-text text-sm">Preset</span>
            <AppSelect
              className="select select-bordered"
              value={selectedRequestPresetId}
              onChange={(e) => {
                const nextId = e.target.value;
                setSelectedRequestPresetId(nextId);
                const preset = filteredXeroRequestPresets.find((item) => item.id === nextId);
                if (preset) applyRequestPreset(preset);
              }}
            >
              <option value="">Choose a {requestForm.method} request</option>
              {filteredXeroRequestPresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </AppSelect>
          </label>
          <div className="mt-3 rounded-box border border-base-300 bg-base-100 px-4 py-3">
            {selectedXeroRequestPreset ? (
              <div className="space-y-1">
                <div className="text-sm font-medium">{selectedXeroRequestPreset.label}</div>
                <div className="text-xs uppercase tracking-wide opacity-60">
                  {selectedXeroRequestPreset.method} • {selectedXeroRequestPreset.path || selectedXeroRequestPreset.url || "/"}
                </div>
                <div className="text-sm opacity-80">{selectedXeroRequestPreset.help}</div>
              </div>
            ) : (
              <div className="text-sm opacity-70">
                {filteredXeroRequestPresets.length
                  ? `Available ${requestForm.method} presets are ready to load into the explorer.`
                  : `No ${requestForm.method} presets are available yet for this connection.`}
              </div>
            )}
          </div>
        </div>
      ) : null}

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
        </label>
        <label className="form-control">
          <span className="label-text text-sm">Custom URL</span>
          <input className="input input-bordered" value={requestForm.url} onChange={(e) => setRequestForm((prev) => ({ ...prev, url: e.target.value }))} placeholder={detailT("request.url_placeholder")} />
        </label>
        <JsonField label={detailT("request.headers")} value={requestForm.headersText} onChange={(text) => setRequestForm((prev) => ({ ...prev, headersText: text }))} minHeight="7rem" />
        <JsonField label={detailT("request.query")} value={requestForm.queryText} onChange={(text) => setRequestForm((prev) => ({ ...prev, queryText: text }))} minHeight="7rem" />
        <JsonField label={detailT("request.json_body")} value={requestForm.jsonText} onChange={(text) => setRequestForm((prev) => ({ ...prev, jsonText: text }))} minHeight="8rem" />
        <label className="form-control">
          <span className="label-text text-sm">{detailT("request.raw_body")}</span>
          <textarea className="textarea textarea-bordered min-h-[7rem]" value={requestForm.bodyText} onChange={(e) => setRequestForm((prev) => ({ ...prev, bodyText: e.target.value }))} />
        </label>
      </div>
    </div>
  );

  const syncDrawerContent = (
    <div className="space-y-4">
      <Section title={detailT("sync.title")}>
        <div className="space-y-3">
          {syncFields.length === 0 ? (
            <div className="text-sm opacity-60">{detailT("sync.no_schema")}</div>
          ) : (
            syncFields.map((field) => renderSyncField(field))
          )}
          {isXeroProvider && selectedSyncResource ? (
            <div className="rounded-box border border-base-300 bg-base-200/50 p-4 text-sm">
              <div className="font-medium">Mapping profiles used by this sync</div>
              <div className="mt-1 opacity-70">
                Choose the saved mapping profiles this sync is allowed to run for {selectedSyncResource.label || selectedSyncResource.key}.
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {selectedSyncMappings.length ? selectedSyncMappings.map((mapping) => {
                  const mappingId = String(mapping?.id || "").trim();
                  const selected = selectedSyncMappingIds.includes(mappingId);
                  return (
                    <button
                      key={mappingId}
                      className={`btn btn-xs ${selected ? "btn-primary" : "btn-outline"}`}
                      type="button"
                      onClick={() => toggleSyncMapping(mappingId)}
                    >
                      {mapping?.name || mappingId}
                    </button>
                  );
                }) : <div className="opacity-60">No sync-capable mappings exist for this resource yet.</div>}
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary btn-sm" type="button" onClick={runSync} disabled={runningSync}>
              {runningSync ? detailT("sync.running") : detailT("sync.run_now")}
            </button>
          </div>
        </div>
      </Section>
    </div>
  );

  const webhookDrawerContent = (
    <div className="space-y-4">
      <Section title={detailT("webhooks.title")}>
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
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary btn-sm" type="button" onClick={createWebhook} disabled={creatingWebhook || !newWebhook.event_key.trim()}>
              {creatingWebhook ? detailT("webhooks.adding") : detailT("webhooks.add")}
            </button>
          </div>
        </div>
      </Section>
    </div>
  );

  const xeroConnectionDrawerContent = (
    <div className="space-y-4">
      <div className="space-y-4">
        <div className="flex flex-wrap justify-end gap-2">
          <button className="btn btn-primary btn-sm" type="button" onClick={generateOauthAuthorizeUrl} disabled={authorizingOAuth || !oauthRedirectUri.trim() || refreshingOAuth || disconnectingOAuth || testing}>
            {authorizingOAuth ? "Opening Xero..." : xeroConnected ? "Reconnect Xero" : "Connect to Xero"}
          </button>
          {xeroConnected ? (
            <button className="btn btn-outline btn-sm" type="button" onClick={runTest} disabled={loading || testing || !item?.id || disconnectingOAuth || refreshingOAuth}>
              {testing ? detailT("setup.testing") : detailT("setup.test_connection")}
            </button>
          ) : null}
          <button className="btn btn-outline btn-sm" type="button" onClick={refreshOauthTokens} disabled={!xeroConnected || refreshingOAuth || disconnectingOAuth || testing}>
            {refreshingOAuth ? detailT("setup.refreshing") : "Refresh Xero tokens"}
          </button>
          <button className="btn btn-outline btn-error btn-sm" type="button" onClick={disconnectOauthConnection} disabled={!xeroConnected || disconnectingOAuth || refreshingOAuth || testing}>
            {disconnectingOAuth ? "Disconnecting Xero..." : "Disconnect Xero"}
          </button>
        </div>

        <div className="rounded-box border border-base-300 bg-base-200/60 p-4 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-medium">{xeroConnected ? `Connected to ${config?.xero_tenant_name || "your Xero account"}` : "Connect to Xero"}</div>
              <div className="mt-1 opacity-80">
                {xeroConnected ? "This integration is ready to use." : "Sign in to Xero and approve access to finish setup for this workspace."}
              </div>
            </div>
            <div className={`rounded-full px-3 py-1 text-xs font-medium ${xeroConnected ? "border border-success/30 bg-success/10 text-success" : "border border-base-300 bg-base-100 text-base-content/70"}`}>
              {xeroConnected ? "Connected" : "Not connected"}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-box bg-base-100 px-3 py-2">
              <div className="text-xs uppercase tracking-wide opacity-60">Organisation</div>
              <div className="mt-1 break-words">{config?.xero_tenant_name || "—"}</div>
            </div>
            <div className="rounded-box bg-base-100 px-3 py-2">
              <div className="text-xs uppercase tracking-wide opacity-60">Organisation ID</div>
              <div className="mt-1 break-all">{config?.xero_tenant_id || "—"}</div>
            </div>
            <div className="rounded-box bg-base-100 px-3 py-2">
              <div className="text-xs uppercase tracking-wide opacity-60">Redirect URI</div>
              <div className="mt-1 break-all">{oauthRedirectUri || "—"}</div>
            </div>
            <div className="rounded-box bg-base-100 px-3 py-2">
              <div className="text-xs uppercase tracking-wide opacity-60">Access token expiry</div>
              <div className="mt-1">{formatDateTime(config?.oauth_access_token_expires_at, "—")}</div>
            </div>
            <div className="rounded-box bg-base-100 px-3 py-2">
              <div className="text-xs uppercase tracking-wide opacity-60">Last token refresh</div>
              <div className="mt-1">{formatDateTime(config?.oauth_last_token_refresh_at, "—")}</div>
            </div>
          </div>
        </div>

        {latestTestResult ? (
          <div className="rounded-box border border-base-300 bg-base-200/50 p-4 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium">Latest test result</div>
                <div className="mt-1 opacity-70">
                  {formatDateTime(latestTestedAt, "Just now")}
                </div>
              </div>
              <div className={`rounded-full px-3 py-1 text-xs font-medium ${latestTestResult?.ok ? "border border-success/30 bg-success/10 text-success" : "border border-error/30 bg-error/10 text-error"}`}>
                {latestTestResult?.ok ? "Passed" : "Failed"}
              </div>
            </div>
            <pre className="mt-3 rounded-box bg-base-100 p-3 text-xs overflow-auto">{JSON.stringify(latestTestResult, null, 2)}</pre>
          </div>
        ) : null}
      </div>
    </div>
  );

  const shopifyConnectionDrawerContent = (
    <div className="space-y-4">
      <div className="space-y-4">
        <div className="flex flex-wrap justify-end gap-2">
          <button
            className="btn btn-primary btn-sm"
            type="button"
            onClick={connectShopify}
            disabled={authorizingOAuth || !oauthRedirectUri.trim() || refreshingOAuth || disconnectingOAuth || testing}
          >
            {authorizingOAuth ? "Opening Shopify..." : shopifyReady ? "Reconnect Shopify" : "Save & Connect Shopify"}
          </button>
          {shopifyConnected ? (
            <button className="btn btn-outline btn-sm" type="button" onClick={runTest} disabled={loading || testing || !item?.id || disconnectingOAuth || refreshingOAuth}>
              {testing ? detailT("setup.testing") : detailT("setup.test_connection")}
            </button>
          ) : null}
          <button className="btn btn-outline btn-sm" type="button" onClick={refreshOauthTokens} disabled={!shopifyOauthBound || refreshingOAuth || disconnectingOAuth || testing}>
            {refreshingOAuth ? detailT("setup.refreshing") : "Refresh Shopify tokens"}
          </button>
          <button className="btn btn-outline btn-error btn-sm" type="button" onClick={disconnectOauthConnection} disabled={!shopifyOauthBound || disconnectingOAuth || refreshingOAuth || testing}>
            {disconnectingOAuth ? "Disconnecting Shopify..." : "Disconnect Shopify"}
          </button>
        </div>

        <Section
          title={detailT("setup.connection_setup_title")}
          help="Keep the Shopify app credentials, saved secret, OAuth connect, and runtime settings together here."
        >
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

            {shopifyDrawerSetupGroups
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

            {shopifyDrawerSetupGroups.some(([groupKey]) => groupKey === "advanced") ? (
              <details className="collapse collapse-arrow border border-base-300 bg-base-100">
                <summary className="collapse-title text-sm font-medium">{detailT("setup.advanced_config_title")}</summary>
                <div className="collapse-content">
                  <div className="mb-4 space-y-3">
                    <div className="text-sm opacity-70">{detailT("setup.advanced_config_help")}</div>
                    {shopifyDrawerSetupGroups
                      .filter(([groupKey]) => groupKey === "advanced")
                      .flatMap(([, fields]) => fields)
                      .map((field) => renderSetupField(field))}
                  </div>
                </div>
              </details>
            ) : null}
          </div>
        </Section>

        <div className="rounded-box border border-base-300 bg-base-200/60 p-4 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-medium">
                {shopifyConnected
                  ? `Connected to ${config?.shopify_shop_name || config?.shopify_myshopify_domain || "your Shopify store"}`
                  : shopifyOauthBound
                    ? "Shopify authorised"
                    : "Connect to Shopify"}
              </div>
              <div className="mt-1 opacity-80">
                {shopifyConnected
                  ? "This integration is ready to use."
                  : shopifyOauthBound
                    ? "OAuth tokens are linked, but Shopify store metadata is missing. You can disconnect and reconnect this store cleanly."
                    : "Save the Shopify app settings, link the client secret, then authorize this store connection."}
              </div>
            </div>
            <div className={`rounded-full px-3 py-1 text-xs font-medium ${shopifyConnected ? "border border-success/30 bg-success/10 text-success" : shopifyOauthBound ? "border border-warning/30 bg-warning/10 text-warning" : "border border-base-300 bg-base-100 text-base-content/70"}`}>
              {shopifyConnected ? "Connected" : shopifyOauthBound ? "Authorised" : "Not connected"}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-box bg-base-100 px-3 py-2">
              <div className="text-xs uppercase tracking-wide opacity-60">Shop domain</div>
              <div className="mt-1 break-words">{config?.shop_domain || "—"}</div>
            </div>
            <div className="rounded-box bg-base-100 px-3 py-2">
              <div className="text-xs uppercase tracking-wide opacity-60">Connected shop</div>
              <div className="mt-1 break-words">{config?.shopify_shop_name || "—"}</div>
            </div>
            <div className="rounded-box bg-base-100 px-3 py-2">
              <div className="text-xs uppercase tracking-wide opacity-60">Connected myshopify domain</div>
              <div className="mt-1 break-all">{config?.shopify_myshopify_domain || "—"}</div>
            </div>
            <div className="rounded-box bg-base-100 px-3 py-2">
              <div className="text-xs uppercase tracking-wide opacity-60">Shop currency</div>
              <div className="mt-1">{config?.shopify_shop_currency || "—"}</div>
            </div>
            <div className="rounded-box bg-base-100 px-3 py-2">
              <div className="text-xs uppercase tracking-wide opacity-60">Redirect URI</div>
              <div className="mt-1 break-all">{oauthRedirectUri || "—"}</div>
            </div>
            <div className="rounded-box bg-base-100 px-3 py-2">
              <div className="text-xs uppercase tracking-wide opacity-60">Access token expiry</div>
              <div className="mt-1">{formatDateTime(config?.oauth_access_token_expires_at, "—")}</div>
            </div>
            <div className="rounded-box bg-base-100 px-3 py-2">
              <div className="text-xs uppercase tracking-wide opacity-60">Last token refresh</div>
              <div className="mt-1">{formatDateTime(config?.oauth_last_token_refresh_at, "—")}</div>
            </div>
            <div className="rounded-box bg-base-100 px-3 py-2">
              <div className="text-xs uppercase tracking-wide opacity-60">Client secret</div>
              <div className="mt-1 break-words">{selectedShopifyClientSecret?.name || "Not linked"}</div>
            </div>
          </div>
        </div>

        {latestTestResult ? (
          <div className="rounded-box border border-base-300 bg-base-200/50 p-4 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium">Latest test result</div>
                <div className="mt-1 opacity-70">
                  {formatDateTime(latestTestedAt, "Just now")}
                </div>
              </div>
              <div className={`rounded-full px-3 py-1 text-xs font-medium ${latestTestResult?.ok ? "border border-success/30 bg-success/10 text-success" : "border border-error/30 bg-error/10 text-error"}`}>
                {latestTestResult?.ok ? "Passed" : "Failed"}
              </div>
            </div>
            <pre className="mt-3 rounded-box bg-base-100 p-3 text-xs overflow-auto">{JSON.stringify(latestTestResult, null, 2)}</pre>
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <TabbedPaneShell
      title={connectionTitle}
      tabs={tabs}
      activeTabId={activeTab}
      onTabChange={setActiveTab}
      mobilePrimaryActions={[
        {
          label: saveActionLabel,
          onClick: save,
          disabled: !canSaveConnection,
          className: PRIMARY_BUTTON_SM,
        },
      ]}
      mobileOverflowActions={[]}
      rightActions={(
        <div className="flex items-center gap-2">
          {isXeroProvider ? (
            <button className={SOFT_BUTTON_SM} type="button" onClick={() => setXeroConnectionDrawerOpen(true)}>
              Connection
            </button>
          ) : null}
          {isShopifyProvider ? (
            <button className={SOFT_BUTTON_SM} type="button" onClick={() => setShopifyConnectionDrawerOpen(true)}>
              Connection
            </button>
          ) : null}
          <button className={PRIMARY_BUTTON_SM} type="button" onClick={save} disabled={!canSaveConnection}>
            {saveActionLabel}
          </button>
        </div>
      )}
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
            </Section>
          </div>
        ) : activeTab === "request" ? (
          <div className="space-y-4">
            <Section title="API explorer" help="Run one-off requests with this connection and review the response here.">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <SummaryStat label={detailT("request.method")} value={requestForm.method} />
                <SummaryStat label="Path" value={requestForm.path || "Not set"} />
                <SummaryStat label="Custom URL" value={requestForm.url || "Using provider base URL"} />
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-primary btn-sm" type="button" onClick={() => setRequestDrawerOpen(true)}>
                  Open API explorer
                </button>
                <button className="btn btn-outline btn-sm" type="button" onClick={runRequest} disabled={runningRequest}>
                  {runningRequest ? detailT("request.running") : detailT("request.run")}
                </button>
              </div>
            </Section>

            <Section title="Saved request templates" tone="muted">
              {requestTemplates.length ? (
                <TableList
                  emptyLabel="No request templates saved yet."
                  columns={[
                    { key: "name", label: "Name" },
                    { key: "method", label: "Method" },
                    { key: "target", label: "Target", render: (row) => requestTemplateSummaryTarget(row) },
                    { key: "updated_at", label: "Updated", render: (row) => formatDateTime(row.updated_at, "—") },
                    {
                      key: "actions",
                      label: "",
                      render: (row) => (
                        <div className="flex flex-wrap justify-end gap-2">
                          <button className="btn btn-ghost btn-xs" type="button" onClick={() => useRequestTemplate(row)}>
                            Use
                          </button>
                          <button className="btn btn-ghost btn-xs" type="button" onClick={() => openRequestTemplateDrawer(row)}>
                            Edit
                          </button>
                          <button
                            className="btn btn-ghost btn-xs text-error"
                            type="button"
                            onClick={() => deleteRequestTemplate(row.id)}
                            disabled={deletingRequestTemplateId === row.id}
                          >
                            {deletingRequestTemplateId === row.id ? "Removing..." : "Delete"}
                          </button>
                        </div>
                      ),
                    },
                  ]}
                  rows={requestTemplates}
                />
              ) : (
                <div className="text-sm opacity-60">No request templates saved yet.</div>
              )}
            </Section>

            <Section title="Recent requests" tone="muted">
              <TableList
                emptyLabel={detailT("logs.request_none")}
                columns={[
                  { key: "created_at", label: detailT("logs.when"), render: (row) => formatDateTime(row.created_at, "—") },
                  { key: "method", label: detailT("logs.method") },
                  { key: "url", label: detailT("logs.url") },
                  { key: "response_status", label: t("common.status") },
                ]}
                rows={requestLogs.slice(0, 8)}
              />
            </Section>

            <Section title="Latest response" tone="muted">
              {requestResult ? <pre className="rounded-box bg-base-200 p-3 text-xs overflow-auto">{JSON.stringify(requestResult, null, 2)}</pre> : <div className="text-sm opacity-60">{detailT("request.no_response")}</div>}
            </Section>
          </div>
        ) : activeTab === "sync" ? (
          <div className="space-y-4">
            <Section title={detailT("sync.title")}>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <SummaryStat label="Resource" value={selectedSyncResource?.label || selectedSyncResourceKey || "Not configured"} />
                <SummaryStat label="Source of truth" value={String(config?.sync?.source_of_truth || "provider").replaceAll("_", " ")} />
                <SummaryStat label="Conflict policy" value={String(config?.sync?.conflict_policy || "source_of_truth").replaceAll("_", " ")} />
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-primary btn-sm" type="button" onClick={() => setSyncDrawerOpen(true)}>
                  Configure sync
                </button>
                <button className="btn btn-outline btn-sm" type="button" onClick={runSync} disabled={runningSync}>
                  {runningSync ? detailT("sync.running") : detailT("sync.run_now")}
                </button>
              </div>
            </Section>

            <Section title={detailT("sync.latest_result_title")} tone="muted">
              {syncResult ? <pre className="rounded-box bg-base-200 p-3 text-xs overflow-auto">{JSON.stringify(syncResult, null, 2)}</pre> : <div className="text-sm opacity-60">{detailT("sync.no_result")}</div>}
            </Section>
          </div>
        ) : activeTab === "webhooks" ? (
          <div className="space-y-4">
            <Section title={detailT("webhooks.title")}>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <SummaryStat label="Inbound webhooks" value={String(webhooks.filter((row) => row?.direction === "inbound").length)} />
                <SummaryStat label="Outbound webhooks" value={String(webhooks.filter((row) => row?.direction === "outbound").length)} />
                <SummaryStat label="Signed webhooks" value={String(webhooks.filter((row) => row?.signing_secret_id).length)} />
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-primary btn-sm" type="button" onClick={() => setWebhookDrawerOpen(true)}>
                  <Plus className="h-4 w-4" />
                  New webhook
                </button>
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
            <Section title={detailT("mappings.title")}>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-primary btn-sm" type="button" onClick={openNewMappingDrawer}>
                  <Plus className="h-4 w-4" />
                  New mapping profile
                </button>
              </div>
            </Section>

            <TableList
              emptyLabel={detailT("mappings.none")}
              columns={[
                { key: "name", label: t("common.name") },
                { key: "resource", label: detailT("mappings.resource"), render: (row) => row.mapping_json?.resource_key || "—" },
                { key: "source_entity", label: detailT("mappings.source") },
                { key: "target_entity", label: detailT("mappings.target") },
                { key: "usage", label: "Usage", render: (row) => mappingUsageScopeLabel(mappingUsageScopeValue(row)) },
                { key: "mode", label: detailT("mappings.mode"), render: (row) => row.mapping_json?.record_mode || row.mapping_json?.mode || "create" },
                {
                  key: "pairs",
                  label: "Field mappings",
                  render: (row) => {
                    const fieldMappings = Array.isArray(row.mapping_json?.field_mappings) ? row.mapping_json.field_mappings : [];
                    if (!fieldMappings.length) return "—";
                    return (
                      <div className="space-y-1">
                        {fieldMappings.slice(0, 3).map((mapping, idx) => (
                          <div key={`${row.id}-pair-${idx}`} className="text-xs">
                            {(mapping.path || mapping.ref || mapping.value || "—")} {" -> "} {mapping.to || "—"}
                          </div>
                        ))}
                        {fieldMappings.length > 3 ? <div className="text-xs opacity-60">+{fieldMappings.length - 3} more</div> : null}
                      </div>
                    );
                  },
                },
                {
                  key: "open",
                  label: "",
                  render: (row) => (
                    <button className="btn btn-outline btn-xs" type="button" onClick={() => openEditMappingDrawer(row)}>
                      Open
                    </button>
                  ),
                },
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
            <ResponsiveDrawer
              open={mappingDrawerOpen}
              onClose={closeMappingDrawer}
              title={mappingDrawerTitle}
              mobileHeightClass="h-[92dvh] max-h-[92dvh]"
              zIndexClass="z-[240]"
            >
              {mappingEditorContent}
            </ResponsiveDrawer>
          </div>
        ) : activeTab === "logs" ? (
          <div className="space-y-4">
            <Section title="Requests" tone="muted">
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

            <Section title="Webhook events" tone="muted">
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

            <Section title="Sync activity" tone="muted">
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
              {isShopifyProvider ? (
                <div className="space-y-3">
                  <div className="rounded-box border border-base-300 bg-base-200/60 p-4 text-sm">
                    <div className="font-medium">Use the Connection drawer for Shopify</div>
                    <div className="mt-1 opacity-80">
                      Keep the Shopify app credentials, linked client secret, OAuth connect flow, and connection testing together in the Connection drawer.
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button className="btn btn-primary btn-sm" type="button" onClick={() => setShopifyConnectionDrawerOpen(true)}>
                      Open Connection
                    </button>
                  </div>
                </div>
              ) : (
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

                {authMode === "oauth2" && !isXeroProvider ? (
                  <Section
                    title={detailT("setup.oauth_title")}
                    help={detailT("setup.oauth_help")}
                  >
                    <div className="space-y-3">
                      <>
                        <label className="form-control">
                          <span className="label-text text-sm">{detailT("setup.redirect_uri")}</span>
                          <input
                            className="input input-bordered"
                            value={oauthRedirectUri}
                            onChange={(e) => setOauthRedirectUri(e.target.value)}
                            placeholder={detailT("setup.redirect_uri_placeholder")}
                          />
                          <span className="label-text-alt opacity-70 mt-1">{detailT("setup.redirect_uri_help")}</span>
                        </label>

                        <div className="flex flex-wrap gap-2">
                          <button className="btn btn-sm btn-outline" type="button" onClick={generateOauthAuthorizeUrl} disabled={authorizingOAuth || !oauthRedirectUri.trim()}>
                            {authorizingOAuth ? detailT("setup.generating") : detailT("setup.generate_authorize_url")}
                          </button>
                          <button className="btn btn-sm btn-outline" type="button" onClick={refreshOauthTokens} disabled={refreshingOAuth}>
                            {refreshingOAuth ? detailT("setup.refreshing") : detailT("setup.refresh_tokens")}
                          </button>
                        </div>
                      </>

                      {oauthAuthorizeResult?.authorize_url && !isManagedOauthProvider ? (
                        <div className="space-y-2 rounded-box border border-base-300 bg-base-200/60 p-3">
                          <div className="text-sm font-medium">{detailT("setup.authorize_url")}</div>
                          <textarea className="textarea textarea-bordered min-h-[7rem] w-full text-xs" readOnly value={oauthAuthorizeResult.authorize_url} />
                          <div className="flex flex-wrap gap-2">
                            <a className="btn btn-sm btn-primary" href={oauthAuthorizeResult.authorize_url} target="_blank" rel="noreferrer">
                              {detailT("setup.open_provider_login")}
                            </a>
                          </div>
                        </div>
                      ) : null}

                      {!isManagedOauthProvider ? (
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
                        </>
                      ) : null}
                    </div>
                  </Section>
                ) : null}

                {!isXeroProvider ? (
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
                ) : null}

                {!isXeroProvider ? (
                  <div className="flex flex-wrap gap-2">
                    <button className="btn btn-outline btn-sm" type="button" onClick={runTest} disabled={loading || testing || !item?.id || disconnectingOAuth}>
                      {testing ? detailT("setup.testing") : detailT("setup.test_connection")}
                    </button>
                  </div>
                ) : null}
              </div>
              )}
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

            {!isDrawerManagedProvider ? (
              <Section title={detailT("setup.latest_test_result_title")} help={detailT("setup.latest_test_result_help")} tone="muted">
                {testResult ? <pre className="rounded-box bg-base-200 p-3 text-xs overflow-auto">{JSON.stringify(testResult, null, 2)}</pre> : <div className="text-sm opacity-60">{detailT("setup.no_test_result")}</div>}
              </Section>
            ) : null}
          </div>
        )}
      </div>

      <ResponsiveDrawer
        open={requestDrawerOpen}
        onClose={() => setRequestDrawerOpen(false)}
        title="API explorer"
        description="Set up and run a one-off request with this connection."
        mobileHeightClass="h-[92dvh] max-h-[92dvh]"
        zIndexClass="z-[240]"
      >
        {requestDrawerContent}
      </ResponsiveDrawer>

      <ResponsiveDrawer
        open={syncDrawerOpen}
        onClose={() => setSyncDrawerOpen(false)}
        title="Configure sync"
        mobileHeightClass="h-[92dvh] max-h-[92dvh]"
        zIndexClass="z-[240]"
      >
        {syncDrawerContent}
      </ResponsiveDrawer>

      <ResponsiveDrawer
        open={webhookDrawerOpen}
        onClose={() => setWebhookDrawerOpen(false)}
        title="New webhook"
        mobileHeightClass="h-[92dvh] max-h-[92dvh]"
        zIndexClass="z-[240]"
      >
        {webhookDrawerContent}
      </ResponsiveDrawer>

      <ResponsiveDrawer
        open={xeroConnectionDrawerOpen}
        onClose={() => setXeroConnectionDrawerOpen(false)}
        title="Xero connection"
        mobileHeightClass="h-[92dvh] max-h-[92dvh]"
        zIndexClass="z-[240]"
      >
        {xeroConnectionDrawerContent}
      </ResponsiveDrawer>

      <ResponsiveDrawer
        open={shopifyConnectionDrawerOpen}
        onClose={() => setShopifyConnectionDrawerOpen(false)}
        title="Shopify connection"
        mobileHeightClass="h-[92dvh] max-h-[92dvh]"
        zIndexClass="z-[240]"
      >
        {shopifyConnectionDrawerContent}
      </ResponsiveDrawer>

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
