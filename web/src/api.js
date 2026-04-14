import { supabase } from "./supabase";
import { localizeManifest } from "./i18n/manifest.js";
import { getI18nCacheKey } from "./i18n/runtime.js";

const RAW_API_URL = (import.meta.env.VITE_API_URL || "http://localhost:8000").trim();
const IS_DEV_PROXY_CANDIDATE =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  /^https?:\/\//i.test(RAW_API_URL) &&
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(window.location.origin);

export const API_URL = IS_DEV_PROXY_CANDIDATE ? "/__octo_api__" : RAW_API_URL;
const ACTIVE_WORKSPACE_STORAGE_KEY = "octo_active_workspace_id";
const TAB_WORKSPACE_STORAGE_KEY = "octo_tab_workspace_id";
const SANDBOX_SESSION_STORAGE_KEY = "octo_ai_sandbox_session_id";
const manifestCache = new Map();
const manifestCacheTs = new Map();
const manifestHashByModule = new Map();
const manifestByHash = new Map();
const compiledByHash = new Map();
const MANIFEST_TTL_MS = 30000;
const manifestInFlight = new Map();

const requestCache = new Map();
const requestCacheTs = new Map();
const requestInFlight = new Map();

const REQUEST_DEFAULT_TTL_MS = 0;
const REQUEST_CACHE_TTL_MS = 30000;
let modulesCache = null;
let modulesCacheTs = 0;
const MODULES_TTL_MS = 30000;
const draftCache = new Map();
const draftCacheTs = new Map();
const draftInFlight = new Map();
const DRAFT_TTL_MS = 30000;
const RECORD_MUTATION_EVENT = "octo:records-mutated";

const REQUEST_POLICIES = [
  { pattern: /^\/modules$/, methods: ["GET"], ttl: 30000 },
  { pattern: /^\/access\/context$/, methods: ["GET"], ttl: 10000 },
  { pattern: /^\/access\/members$/, methods: ["GET"], ttl: 10000 },
  { pattern: /^\/access\/profiles(?:\/[^/]+)?$/, methods: ["GET"], ttl: 15000 },
  { pattern: /^\/settings\/provider-status(?:\?.*)?$/, methods: ["GET"], ttl: 10000 },
  { pattern: /^\/prefs\/ui$/, methods: ["GET"], ttl: 10000 },
  { pattern: /^\/templates\/meta$/, methods: ["GET"], ttl: 30000 },
  { pattern: /^\/system\/interfaces\/sources(?:\?.*)?$/, methods: ["GET"], ttl: 30000 },
  { pattern: /^\/system\/calendar\/sources$/, methods: ["GET"], ttl: 30000 },
  { pattern: /^\/system\/documents\/sources$/, methods: ["GET"], ttl: 30000 },
  { pattern: /^\/system\/dashboard\/sources$/, methods: ["GET"], ttl: 30000 },
  { pattern: /^\/settings\/api-credentials(?:\/[^/]+)?$/, methods: ["GET"], ttl: 15000 },
  { pattern: /^\/email\/templates(?:\/[^/]+)?$/, methods: ["GET"], ttl: 15000 },
  { pattern: /^\/email\/outbox(?:\/[^/]+)?$/, methods: ["GET"], ttl: 15000 },
  { pattern: /^\/studio2\/modules$/, methods: ["GET"], ttl: 30000 },
  { pattern: /^\/studio2\/modules\/[^/]+\/draft$/, methods: ["GET"], ttl: 30000 },
  { pattern: /^\/studio2\/modules\/[^/]+\/history$/, methods: ["GET"], ttl: 30000 },
  { pattern: /^\/studio2\/registry$/, methods: ["GET"], ttl: 30000 },
  { pattern: /^\/studio2\/modules\/[^/]+\/manifest$/, methods: ["GET"], ttl: 30000 },
  { pattern: /^\/modules\/[^/]+\/manifest$/, methods: ["GET"], ttl: 30000 },
  { pattern: /^\/page\/bootstrap$/, methods: ["GET"], ttl: 30000 },
  { pattern: /^\/records\/[^/]+$/, methods: ["GET"], ttl: 30000 },
  { pattern: /^\/records\/[^/]+\/[^/]+$/, methods: ["GET"], ttl: 30000 },
  { pattern: /^\/lookup\/[^/]+\/options$/, methods: ["POST"], ttl: 60000 },
];

function notifyWorkspaceChanged(workspaceId, scope = "local") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("octo:workspace-changed", {
      detail: {
        workspaceId: workspaceId || "",
        scope,
      },
    }),
  );
}

export function isOctoAiSandboxActive() {
  if (typeof window === "undefined") return false;
  try {
    const search = new URLSearchParams(window.location.search || "");
    if (search.get("octo_ai_sandbox") === "0" || search.get("octo_ai_live") === "1") return false;
    if (search.get("octo_ai_sandbox") === "1") return true;
    return Boolean(window.sessionStorage.getItem(SANDBOX_SESSION_STORAGE_KEY) || "");
  } catch {
    return false;
  }
}

function resolvePolicy(path, method) {
  for (const policy of REQUEST_POLICIES) {
    if (policy.pattern.test(path) && policy.methods.includes(method)) {
      return policy;
    }
  }
  return null;
}

function workspaceScopedKey(key, workspaceId = null) {
  const resolvedWorkspace = workspaceId ?? getActiveWorkspaceId() ?? "";
  return `${resolvedWorkspace || "default"}:${key}`;
}

function requestKey(method, path, body, cacheKey, workspaceId = null) {
  if (cacheKey) return `${method}:${workspaceScopedKey(cacheKey, workspaceId)}`;
  if (!body) return `${method}:${workspaceScopedKey(path, workspaceId)}`;
  return `${method}:${workspaceScopedKey(`${path}:${body}`, workspaceId)}`;
}

function invalidateRequestPrefix(prefix) {
  for (const key of requestCache.keys()) {
    if (key.includes(prefix)) {
      requestCache.delete(key);
      requestCacheTs.delete(key);
    }
  }
}

function invalidateRecordCache(entityId, recordId = null) {
  if (!entityId) return;
  if (recordId) {
    invalidateRequestPrefix(`/records/${entityId}/${recordId}`);
  }
  invalidateRequestPrefix(`/records/${entityId}`);
  invalidateRequestPrefix(`/page/bootstrap`);
}

function emitRecordMutation(detail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(RECORD_MUTATION_EVENT, {
      detail: {
        workspaceId: getActiveWorkspaceId() || "",
        ...(detail || {}),
      },
    }),
  );
}

export function subscribeRecordMutations(listener) {
  if (typeof window === "undefined" || typeof listener !== "function") return () => {};
  const handler = (event) => listener(event?.detail || {});
  window.addEventListener(RECORD_MUTATION_EVENT, handler);
  return () => window.removeEventListener(RECORD_MUTATION_EVENT, handler);
}

function emitMutationForResponse(path, method, data) {
  if (method === "GET") return;
  if (path.startsWith("/records/")) {
    const parts = path.split("/").filter(Boolean);
    const entityId = parts[1] || "";
    const recordId = parts.length > 2 ? parts[2] : (data?.record_id || data?.record?.id || null);
    const record = data?.record && typeof data.record === "object" ? data.record : null;
    emitRecordMutation({
      source: "ui",
      operation:
        method === "POST"
          ? "create"
          : method === "PUT" || method === "PATCH"
            ? "update"
            : method === "DELETE"
              ? "delete"
              : method.toLowerCase(),
      entityId,
      recordId: recordId || null,
      recordIds: recordId ? [recordId] : [],
      record,
      path,
      broad: false,
    });
    return;
  }
  if (path.startsWith("/actions/")) {
    const result = data?.result || {};
    const entityId = result?.entity_id || "";
    const recordId = result?.record_id || null;
    const record = result?.record && typeof result.record === "object" ? result.record : null;
    emitRecordMutation({
      source: "ui",
      operation: "action",
      entityId,
      recordId,
      recordIds: recordId ? [recordId] : [],
      record,
      path,
      actionId: result?.action_id || null,
      broad: true,
    });
  }
}

function formatApiErrorPath(path) {
  if (!path || typeof path !== "string") return "";
  const selectedFieldMatch = path.match(/^selected_ids\[(\d+)\]\.(.+)$/);
  if (selectedFieldMatch) {
    const rowNumber = Number.parseInt(selectedFieldMatch[1], 10) + 1;
    const fieldPath = selectedFieldMatch[2];
    return `${fieldPath} (selected row ${rowNumber})`;
  }
  const selectedRowMatch = path.match(/^selected_ids\[(\d+)\]$/);
  if (selectedRowMatch) {
    const rowNumber = Number.parseInt(selectedRowMatch[1], 10) + 1;
    return `selected row ${rowNumber}`;
  }
  return path;
}

function formatApiErrorMessage(message, path, code) {
  const baseMessage = typeof message === "string" && message.trim() ? message.trim() : "Request failed";
  const formattedPath = formatApiErrorPath(path);
  if (code === "ACTION_INVALID" && path === "selected_ids") {
    return "Select at least one record first";
  }
  if (!formattedPath) return baseMessage;
  if (code === "TRANSFORMATION_SOURCE_REQUIRED") {
    return `Missing required source field: ${formattedPath}`;
  }
  if (baseMessage.toLowerCase().includes(formattedPath.toLowerCase())) {
    return baseMessage;
  }
  return `${baseMessage}: ${formattedPath}`;
}

export function compileManifest(manifest) {
  const entities = Array.isArray(manifest?.entities) ? manifest.entities : [];
  const views = Array.isArray(manifest?.views) ? manifest.views : [];
  const entityById = new Map();
  const fieldByEntity = new Map();
  for (const entity of entities) {
    if (!entity?.id) continue;
    entityById.set(entity.id, entity);
    const fields = Array.isArray(entity.fields) ? entity.fields : [];
    const fieldMap = new Map();
    for (const field of fields) {
      if (field?.id) fieldMap.set(field.id, field);
    }
    fieldByEntity.set(entity.id, fieldMap);
  }
  const viewById = new Map();
  for (const view of views) {
    if (view?.id) viewById.set(view.id, view);
  }
  return { entityById, fieldByEntity, viewById };
}

function compiledManifestCacheKey(manifestHash, moduleId = "") {
  return `${manifestHash || moduleId || "manifest"}:${getI18nCacheKey()}`;
}

async function localizeManifestResult(res, moduleId = "") {
  const manifest = res?.manifest;
  if (!manifest || typeof manifest !== "object") return res;
  const localizedManifest = await localizeManifest(manifest);
  const compiledKey = compiledManifestCacheKey(res?.manifest_hash, moduleId);
  const compiled = compiledByHash.get(compiledKey) || compileManifest(localizedManifest);
  if (!compiledByHash.has(compiledKey)) {
    compiledByHash.set(compiledKey, compiled);
  }
  return { ...res, manifest: localizedManifest, compiled };
}

function resolveLocalizedPage(manifest, pageId) {
  const pages = Array.isArray(manifest?.pages) ? manifest.pages : [];
  return pages.find((page) => page?.id === pageId) || null;
}

export async function apiFetch(path, options = {}) {
  const { _workspaceRetry = false, ...requestOptions } = options || {};
  const perfEnabled = typeof window !== "undefined" && window.localStorage?.getItem("octo_perf") === "1";
  const trace = requestOptions.trace || path;
  const start = perfEnabled ? performance.now() : 0;
  const session = (await supabase.auth.getSession()).data.session;
  const token = session?.access_token;
  const headers = {
    "Content-Type": "application/json",
    ...(requestOptions.headers || {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const activeWorkspaceId = getActiveWorkspaceId();
  const sandboxActive = isOctoAiSandboxActive();
  if (activeWorkspaceId && !headers["X-Workspace-Id"]) {
    headers["X-Workspace-Id"] = activeWorkspaceId;
  }
  if (sandboxActive) {
    headers["Cache-Control"] = "no-store";
    headers.Pragma = "no-cache";
  }
  const method = (requestOptions.method || "GET").toUpperCase();
  const body =
    typeof requestOptions.body === "string" ? requestOptions.body : requestOptions.body ? JSON.stringify(requestOptions.body) : "";
  const policy = resolvePolicy(path, method);
  const cacheTtl =
    sandboxActive ? 0 : typeof requestOptions.cacheTtl === "number" ? requestOptions.cacheTtl : policy?.ttl ?? REQUEST_DEFAULT_TTL_MS;
  const cacheKey = requestOptions.cacheKey || null;
  const cacheAllowed = cacheTtl > 0;
  const key = requestKey(method, path, body, cacheKey, activeWorkspaceId);

  if (cacheAllowed) {
    const cached = requestCache.get(key);
    const ts = requestCacheTs.get(key) || 0;
    if (cached && Date.now() - ts < cacheTtl) {
      if (perfEnabled) {
        const ms = Math.round(performance.now() - start);
        console.debug(`[perf] ${trace} 200 ${ms}ms (cache)`);
      }
      return cached;
    }
  }

  const inflight = requestInFlight.get(key);
  if (inflight) {
    return inflight;
  }

  let res;
  let data;
  const timeoutMs = typeof requestOptions.timeoutMs === "number" ? requestOptions.timeoutMs : null;
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutId = timeoutMs && controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const request = fetch(`${API_URL}${path}`, {
      ...requestOptions,
      method,
      body: body || requestOptions.body,
      headers,
      cache: sandboxActive ? "no-store" : requestOptions.cache,
      signal: controller?.signal,
    })
      .then(async (response) => {
        res = response;
        data = await response.json();
        if (!response.ok) {
          const code = data?.errors?.[0]?.code;
          const message = data?.errors?.[0]?.message || data?.error || data?.message || data?.detail || "Request failed";
          const path = data?.errors?.[0]?.path;
          const err = new Error(formatApiErrorMessage(message, path, code));
          err.code = code;
          err.detail = data?.errors?.[0]?.detail;
          err.path = path;
          err.rawMessage = message;
          err.status = response.status;
          if (Array.isArray(data?.errors)) err.errors = data.errors;
          if (Array.isArray(data?.warnings)) err.warnings = data.warnings;
          throw err;
        }
        if (cacheAllowed) {
          requestCache.set(key, data);
          requestCacheTs.set(key, Date.now());
        }
        if (method !== "GET") {
          if (path.startsWith("/records/")) {
            const parts = path.split("/").filter(Boolean);
            const entityId = parts[1];
            const recId = parts.length > 2 ? parts[2] : null;
            invalidateRecordCache(entityId, recId);
          }
        if (path.startsWith("/access/members")) {
          invalidateRequestPrefix("/access/members");
          invalidateRequestPrefix("/access/context");
        }
        if (path.startsWith("/access/profiles")) {
          invalidateRequestPrefix("/access/profiles");
          invalidateRequestPrefix("/access/context");
        }
        if (path.startsWith("/access/workspaces")) {
          invalidateRequestPrefix("/access/context");
        }
        if (path.startsWith("/settings/secrets") || path.startsWith("/settings/provider-status")) {
          invalidateRequestPrefix("/settings/provider-status");
        }
        if (path.startsWith("/prefs/ui")) {
          invalidateRequestPrefix("/prefs/ui");
        }
        if (path.startsWith("/settings/api-credentials")) {
          invalidateRequestPrefix("/settings/api-credentials");
        }
        if (path.startsWith("/email/templates")) {
          invalidateRequestPrefix("/email/templates");
        }
        if (path.startsWith("/email/outbox")) {
          invalidateRequestPrefix("/email/outbox");
        }
        if (path.startsWith("/actions/")) {
          // Actions can mutate arbitrary records, so clear record/list bootstrap caches broadly.
          invalidateRequestPrefix("/records/");
          invalidateRequestPrefix("/page/bootstrap");
          invalidateRequestPrefix("/system/dashboard/query");
          invalidateRequestPrefix("/system/calendar/events");
          invalidateRequestPrefix("/system/documents/items");
        }
          if (path.startsWith("/modules") || path.startsWith("/studio2/")) {
            modulesCache = null;
            modulesCacheTs = 0;
            invalidateRequestPrefix("/modules");
          }
          emitMutationForResponse(path, method, data);
        }
        return data;
      })
      .finally(() => {
        requestInFlight.delete(key);
        if (timeoutId) clearTimeout(timeoutId);
      });

    requestInFlight.set(key, request);
    return await request;
  } catch (err) {
    const shouldRetryWorkspaceSelection =
      !_workspaceRetry &&
      method === "GET" &&
      Boolean(activeWorkspaceId) &&
      (err?.code === "WORKSPACE_FORBIDDEN" || err?.code === "WORKSPACE_NOT_FOUND");
    if (shouldRetryWorkspaceSelection) {
      clearSavedWorkspaceSelection();
      return apiFetch(path, { ...requestOptions, _workspaceRetry: true });
    }
    throw err;
  } finally {
    if (perfEnabled) {
      const ms = Math.round(performance.now() - start);
      const status = res?.status;
      console.debug(`[perf] ${trace} ${status ?? "ERR"} ${ms}ms`);
    }
  }
}

export async function createRecord(entityId, payload, options = {}) {
  return apiFetch(`/records/${entityId}`, {
    ...options,
    method: "POST",
    body: typeof payload === "string" ? payload : JSON.stringify(payload || {}),
  });
}

export async function updateRecord(entityId, recordId, payload, options = {}) {
  return apiFetch(`/records/${entityId}/${recordId}`, {
    ...options,
    method: "PUT",
    body: typeof payload === "string" ? payload : JSON.stringify(payload || {}),
  });
}

export async function deleteRecord(entityId, recordId, options = {}) {
  return apiFetch(`/records/${entityId}/${recordId}`, {
    ...options,
    method: "DELETE",
  });
}

export async function runManifestAction(moduleId, actionId, context = {}, options = {}) {
  return apiFetch("/actions/run", {
    ...options,
    method: "POST",
    body: JSON.stringify({
      module_id: moduleId,
      action_id: actionId,
      context,
    }),
  });
}

export async function getProviderStatus(providers = []) {
  const values = Array.isArray(providers) ? providers.filter(Boolean) : [];
  const query = new URLSearchParams();
  if (values.length) query.set("providers", values.join(","));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiFetch(`/settings/provider-status${suffix}`);
}

export async function createWorkspaceSecret(payload = {}) {
  return apiFetch("/settings/secrets", { method: "POST", body: payload });
}

export async function googlePlacesAutocomplete(input, sessionToken = null) {
  const query = new URLSearchParams();
  query.set("input", input || "");
  if (sessionToken) query.set("session_token", sessionToken);
  return apiFetch(`/tools/google-places/autocomplete?${query.toString()}`);
}

export async function googlePlaceDetails(placeId, sessionToken = null) {
  const query = new URLSearchParams();
  query.set("place_id", placeId || "");
  if (sessionToken) query.set("session_token", sessionToken);
  return apiFetch(`/tools/google-places/details?${query.toString()}`);
}

export function getActiveWorkspaceId() {
  try {
    const search = new URLSearchParams(window.location.search || "");
    const frameMode = search.get("octo_ai_frame") === "1";
    const sandboxEnabled = search.get("octo_ai_sandbox") === "1";
    const frameWorkspaceId = search.get("octo_ai_workspace") || "";
    if (frameMode && sandboxEnabled && frameWorkspaceId) {
      return frameWorkspaceId;
    }
    const tabScoped = window.sessionStorage.getItem(TAB_WORKSPACE_STORAGE_KEY) || "";
    if (tabScoped) return tabScoped;
    return window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function setActiveWorkspaceId(workspaceId) {
  try {
    if (workspaceId) {
      window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, workspaceId);
    } else {
      window.localStorage.removeItem(ACTIVE_WORKSPACE_STORAGE_KEY);
    }
    clearCaches();
    notifyWorkspaceChanged(workspaceId, "persistent");
  } catch {
    // ignore
  }
}

export function setTabWorkspaceId(workspaceId) {
  try {
    if (workspaceId) {
      window.sessionStorage.setItem(TAB_WORKSPACE_STORAGE_KEY, workspaceId);
    } else {
      window.sessionStorage.removeItem(TAB_WORKSPACE_STORAGE_KEY);
    }
    clearCaches();
    notifyWorkspaceChanged(workspaceId, "tab");
  } catch {
    // ignore
  }
}

export function clearSavedWorkspaceSelection() {
  try {
    window.localStorage.removeItem(ACTIVE_WORKSPACE_STORAGE_KEY);
    window.sessionStorage.removeItem(TAB_WORKSPACE_STORAGE_KEY);
    clearCaches();
    notifyWorkspaceChanged("", "reset");
  } catch {
    // ignore
  }
}

export function clearTabWorkspaceId() {
  setTabWorkspaceId("");
}

export function getOctoAiSandboxSessionId() {
  try {
    return window.sessionStorage.getItem(SANDBOX_SESSION_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function setOctoAiSandboxSessionId(sessionId) {
  try {
    if (sessionId) {
      window.sessionStorage.setItem(SANDBOX_SESSION_STORAGE_KEY, sessionId);
    } else {
      window.sessionStorage.removeItem(SANDBOX_SESSION_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

export function clearOctoAiSandboxSessionId() {
  setOctoAiSandboxSessionId("");
}

export async function getAuthHeaders(extra = {}) {
  const session = (await supabase.auth.getSession()).data.session;
  const token = session?.access_token;
  const headers = {
    "Content-Type": "application/json",
    ...extra,
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export function invalidateModulesCache() {
  modulesCache = null;
  modulesCacheTs = 0;
  invalidateRequestPrefix("/modules");
}

export function peekModulesCache() {
  if (isOctoAiSandboxActive()) return null;
  const now = Date.now();
  const workspaceKey = workspaceScopedKey("modules");
  if (modulesCache && modulesCache.workspaceKey === workspaceKey && now - modulesCacheTs < MODULES_TTL_MS) {
    return modulesCache;
  }
  return null;
}

export function peekUiPrefsCache() {
  if (isOctoAiSandboxActive()) return null;
  const now = Date.now();
  const key = requestKey("GET", "/prefs/ui", "", null);
  const ts = requestCacheTs.get(key) || 0;
  if (requestCache.has(key) && now - ts < 10000) {
    return requestCache.get(key);
  }
  return null;
}

export async function getUiPrefs() {
  return apiFetch("/prefs/ui");
}

export async function setUiPrefs(payload) {
  return apiFetch("/prefs/ui", { method: "PUT", body: payload });
}

export async function getModules() {
  if (isOctoAiSandboxActive()) {
    modulesCache = null;
    modulesCacheTs = 0;
    return apiFetch("/modules", { cacheTtl: 0 });
  }
  const now = Date.now();
  const workspaceKey = workspaceScopedKey("modules");
  if (modulesCache && modulesCache.workspaceKey === workspaceKey && now - modulesCacheTs < MODULES_TTL_MS) {
    return modulesCache;
  }
  const res = await apiFetch("/modules");
  modulesCache = { ...res, workspaceKey };
  modulesCacheTs = now;
  return modulesCache;
}

export async function enableModule(moduleId) {
  return apiFetch(`/modules/${moduleId}/enable`, { method: "POST", body: JSON.stringify({ reason: "enable" }) });
}

export async function disableModule(moduleId) {
  return apiFetch(`/modules/${moduleId}/disable`, { method: "POST", body: JSON.stringify({ reason: "disable" }) });
}

export async function setModuleIcon(moduleId, iconKey) {
  return apiFetch(`/modules/${moduleId}/icon`, { method: "POST", body: { icon_key: iconKey } });
}

export async function clearModuleIcon(moduleId) {
  return apiFetch(`/modules/${moduleId}/icon`, { method: "DELETE" });
}

export async function setModuleOrder(moduleId, displayOrder) {
  return apiFetch(`/modules/${moduleId}/order`, { method: "POST", body: { display_order: displayOrder } });
}

export async function getManifest(moduleId) {
  if (isOctoAiSandboxActive()) {
    const res = await apiFetch(`/modules/${moduleId}/manifest`, { cacheTtl: 0 });
    return localizeManifestResult(res, moduleId);
  }
  const now = Date.now();
  const scopedModuleId = workspaceScopedKey(moduleId);
  const cached = manifestCache.get(scopedModuleId);
  const ts = manifestCacheTs.get(scopedModuleId) || 0;
  if (cached && now - ts < MANIFEST_TTL_MS) {
    return cached;
  }
  const inflight = manifestInFlight.get(scopedModuleId);
  if (inflight) {
    return inflight;
  }
  const cachedHash = manifestHashByModule.get(scopedModuleId);
  if (cachedHash && manifestByHash.has(cachedHash) && now - ts < MANIFEST_TTL_MS) {
    const res = manifestByHash.get(cachedHash);
    manifestCache.set(scopedModuleId, res);
    manifestCacheTs.set(scopedModuleId, now);
    return res;
  }
  const request = apiFetch(`/modules/${moduleId}/manifest`).then(async (res) => {
    const result = await localizeManifestResult(res, moduleId);
    const manifestHash = result.manifest_hash;
    if (manifestHash) {
      manifestByHash.set(manifestHash, result);
      manifestHashByModule.set(scopedModuleId, manifestHash);
    }
    manifestCache.set(scopedModuleId, result);
    manifestCacheTs.set(scopedModuleId, now);
    return result;
  }).finally(() => {
    manifestInFlight.delete(scopedModuleId);
  });
  manifestInFlight.set(scopedModuleId, request);
  return request;
}

export async function getPageBootstrap({
  moduleId,
  pageId = null,
  viewId = null,
  recordId = null,
  cursor = null,
  limit = null,
  q = null,
  searchFields = null,
  domain = null,
} = {}) {
  if (!moduleId) throw new Error("moduleId is required");
  const params = new URLSearchParams();
  params.set("module_id", moduleId);
  if (pageId) params.set("page_id", pageId);
  if (viewId) params.set("view_id", viewId);
  if (recordId) params.set("record_id", recordId);
  if (cursor) params.set("cursor", cursor);
  if (limit) params.set("limit", String(limit));
  if (q) params.set("q", q);
  if (searchFields) params.set("search_fields", searchFields);
  if (domain) params.set("domain", domain);
  const res = await apiFetch(`/page/bootstrap?${params.toString()}`, { cacheTtl: isOctoAiSandboxActive() ? 0 : undefined });
  const localized = await localizeManifestResult(res, moduleId);
  const manifestHash = localized?.manifest_hash;
  const manifest = localized?.manifest;
  if (moduleId && manifestHash && manifest && typeof manifest === "object") {
    const scopedModuleId = workspaceScopedKey(moduleId);
    const compiled = localized?.compiled || compileManifest(manifest);
    const manifestResult = { module_id: moduleId, manifest_hash: manifestHash, manifest, compiled };
    manifestByHash.set(manifestHash, manifestResult);
    manifestHashByModule.set(scopedModuleId, manifestHash);
    manifestCache.set(scopedModuleId, manifestResult);
    manifestCacheTs.set(scopedModuleId, Date.now());
    return {
      ...localized,
      compiled,
      page: resolveLocalizedPage(manifest, localized?.page_id),
    };
  }
  return localized;
}

export function invalidateManifestCache(moduleId) {
  const scopedModuleId = workspaceScopedKey(moduleId);
  manifestCache.delete(scopedModuleId);
  manifestCacheTs.delete(scopedModuleId);
  const hash = manifestHashByModule.get(scopedModuleId);
  if (hash) {
    manifestByHash.delete(hash);
    for (const key of compiledByHash.keys()) {
      if (key.startsWith(`${hash}:`)) {
        compiledByHash.delete(key);
      }
    }
  }
  manifestHashByModule.delete(scopedModuleId);
}

export function invalidateManifestCaches() {
  manifestCache.clear();
  manifestCacheTs.clear();
  manifestHashByModule.clear();
  manifestByHash.clear();
  compiledByHash.clear();
  manifestInFlight.clear();
}

export function clearCaches() {
  invalidateModulesCache();
  draftCache.clear();
  draftCacheTs.clear();
  draftInFlight.clear();
  requestCache.clear();
  requestCacheTs.clear();
  requestInFlight.clear();
  invalidateManifestCaches();
}

export async function listStudio2Modules() {
  return apiFetch("/studio2/modules");
}

export async function listMarketplaceApps() {
  return apiFetch("/marketplace/apps");
}

export async function publishMarketplaceApp(payload) {
  return apiFetch("/marketplace/apps/publish", { method: "POST", body: payload || {} });
}

export async function cloneMarketplaceApp(appId, payload) {
  return apiFetch(`/marketplace/apps/${appId}/clone`, { method: "POST", body: payload || {} });
}

export async function getDraft(moduleId) {
  if (isOctoAiSandboxActive()) {
    return apiFetch(`/studio2/modules/${moduleId}/draft`, { cacheTtl: 0 });
  }
  const now = Date.now();
  const scopedModuleId = workspaceScopedKey(moduleId);
  const cached = draftCache.get(scopedModuleId);
  const ts = draftCacheTs.get(scopedModuleId) || 0;
  if (cached && now - ts < DRAFT_TTL_MS) {
    return cached;
  }
  const inflight = draftInFlight.get(scopedModuleId);
  if (inflight) return inflight;
  const request = apiFetch(`/studio2/modules/${moduleId}/draft`)
    .then((res) => {
      draftCache.set(scopedModuleId, res);
      draftCacheTs.set(scopedModuleId, now);
      return res;
    })
    .finally(() => {
      draftInFlight.delete(scopedModuleId);
    });
  draftInFlight.set(scopedModuleId, request);
  return request;
}

export async function getStudio2Registry() {
  return apiFetch("/studio2/registry");
}

export async function getStudio2Manifest(moduleId) {
  return apiFetch(`/studio2/modules/${moduleId}/manifest`);
}

export async function validateStudio2Patchset(patchset) {
  return apiFetch("/studio2/patchset/validate", { method: "POST", body: { patchset } });
}

export async function previewStudio2Patchset(patchset) {
  return apiFetch("/studio2/patchset/preview", { method: "POST", body: { patchset } });
}

export async function applyStudio2Patchset(patchset, reason = "studio2") {
  return apiFetch("/studio2/patchset/apply", { method: "POST", body: { patchset, reason } });
}

export async function rollbackStudio2Patchset(payload) {
  return apiFetch("/studio2/patchset/rollback", { method: "POST", body: payload });
}

export async function studio2JsonFix(text, error) {
  return apiFetch("/studio2/json/fix", { method: "POST", body: { text, error } });
}

export async function studio2AiPlan(prompt, moduleId, draftText = null) {
  return apiFetch("/studio2/ai/plan", { method: "POST", body: { prompt, module_id: moduleId, draft_text: draftText } });
}

export async function studio2AiFixJson(text, error) {
  return apiFetch("/studio2/ai/fix_json", { method: "POST", body: { text, error } });
}

export async function studio2AgentChat(
  moduleId,
  message,
  draftText = null,
  errors = null,
  draftManifestJson = null,
  chatHistory = null,
  includeProgress = false
) {
  return apiFetch("/studio2/agent/chat", {
    method: "POST",
    body: {
      module_id: moduleId,
      message,
      draft_text: draftText,
      errors,
      draft_manifest_json: draftManifestJson,
      chat_history: chatHistory,
      include_progress: includeProgress,
    },
    timeoutMs: 60000,
  });
}

export async function studio2AgentStatus() {
  return apiFetch("/studio2/agent/status");
}

export async function createStudio2Module(moduleName, description = "") {
  return apiFetch("/studio2/modules/create", { method: "POST", body: { module_name: moduleName, description } });
}

export async function createStudio2ModuleWithSeed(moduleId, name, seed = "template") {
  return apiFetch("/studio2/modules", { method: "POST", body: { module_id: moduleId, name, seed } });
}

export async function deleteStudio2Draft(moduleId) {
  return apiFetch(`/studio2/modules/${moduleId}/draft/delete`, { method: "POST", body: {} });
}

export async function saveStudio2Draft(moduleId, manifestText, note = null) {
  return apiFetch(`/studio2/modules/${moduleId}/draft`, { method: "POST", body: { text: manifestText, note } });
}

export async function validateStudio2Draft(moduleId, manifestText) {
  return apiFetch(`/studio2/modules/${moduleId}/validate`, { method: "POST", body: { text: manifestText } });
}

export async function installStudio2Draft(moduleId, manifestText) {
  return apiFetch(`/studio2/modules/${moduleId}/install`, { method: "POST", body: { text: manifestText } });
}

export async function listStudio2History(moduleId) {
  return apiFetch(`/studio2/modules/${moduleId}/history`);
}

export async function rollbackStudio2Module(moduleId, payload) {
  return apiFetch(`/studio2/modules/${moduleId}/rollback`, { method: "POST", body: payload });
}

export async function deleteModule(moduleId, options = {}) {
  const params = new URLSearchParams();
  if (options.force) params.set("force", "true");
  if (options.archive) params.set("archive", "true");
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch(`/modules/${moduleId}${suffix}`, { method: "DELETE" });
}

export async function listSnapshots(moduleId) {
  return apiFetch(`/modules/${moduleId}/snapshots`);
}

export async function rollbackModule(moduleId, snapshotId, reason = "rollback") {
  return apiFetch(`/modules/${moduleId}/rollback`, {
    method: "POST",
    body: JSON.stringify({ snapshot_id: snapshotId, reason }),
  });
}

export async function listOctoAiSessions() {
  return apiFetch("/octo-ai/sessions");
}

export async function createOctoAiSession(payload = {}) {
  return apiFetch("/octo-ai/sessions", { method: "POST", body: payload });
}

export async function getOctoAiSession(sessionId) {
  return apiFetch(`/octo-ai/sessions/${sessionId}`);
}

export async function updateOctoAiSession(sessionId, payload = {}) {
  return apiFetch(`/octo-ai/sessions/${sessionId}`, { method: "PUT", body: payload });
}

export async function deleteOctoAiSession(sessionId) {
  return apiFetch(`/octo-ai/sessions/${sessionId}`, { method: "DELETE", body: {} });
}

export async function getOctoAiExplorer() {
  return apiFetch("/octo-ai/explorer");
}

export async function getOctoAiWorkspaceGraph() {
  return apiFetch("/octo-ai/workspace/graph");
}

export async function getOctoAiArtifact(artifactType, artifactKey) {
  return apiFetch(`/octo-ai/artifacts/${artifactType}/${artifactKey}`);
}

export async function answerOctoAiQuestion(sessionId, payload = {}) {
  return apiFetch(`/octo-ai/sessions/${sessionId}/questions/answer`, { method: "POST", body: payload });
}

export async function sendOctoAiChatMessage(sessionId, payload = {}) {
  return apiFetch(`/octo-ai/sessions/${sessionId}/chat`, { method: "POST", body: payload });
}

export async function ensureOctoAiSandbox(sessionId) {
  return apiFetch(`/octo-ai/sessions/${sessionId}/sandbox`, { method: "POST", body: {} });
}

export async function discardOctoAiSandbox(sessionId) {
  return apiFetch(`/octo-ai/sessions/${sessionId}/sandbox/discard`, { method: "POST", body: {} });
}

export async function generateOctoAiPatchset(sessionId, payload = {}) {
  return apiFetch(`/octo-ai/sessions/${sessionId}/patchsets/generate`, { method: "POST", body: payload });
}

export async function validateOctoAiPatchset(patchsetId) {
  return apiFetch(`/octo-ai/patchsets/${patchsetId}/validate`, { method: "POST", body: {} });
}

export async function applyOctoAiPatchset(patchsetId, approved = true) {
  return apiFetch(`/octo-ai/patchsets/${patchsetId}/apply`, { method: "POST", body: { approved } });
}

export async function rollbackOctoAiPatchset(patchsetId) {
  return apiFetch(`/octo-ai/patchsets/${patchsetId}/rollback`, { method: "POST", body: {} });
}

export async function createOctoAiRelease(sessionId, payload = {}) {
  return apiFetch(`/octo-ai/sessions/${sessionId}/releases`, { method: "POST", body: payload });
}

export async function promoteOctoAiRelease(releaseId) {
  return apiFetch(`/octo-ai/releases/${releaseId}/promote`, { method: "POST", body: {} });
}

export async function rollbackOctoAiRelease(releaseId) {
  return apiFetch(`/octo-ai/releases/${releaseId}/rollback`, { method: "POST", body: {} });
}

export function startOctoAiChatStream({ sessionId, message, scopeMode = null, onEvent }) {
  const controller = new AbortController();
  const promise = (async () => {
    const headers = await getAuthHeaders();
    const activeWorkspaceId = getActiveWorkspaceId();
    if (activeWorkspaceId && !headers["X-Workspace-Id"]) {
      headers["X-Workspace-Id"] = activeWorkspaceId;
    }
    headers.Accept = "text/event-stream";
    let sawAnyEvent = false;
    const res = await fetch(`${API_URL}/octo-ai/sessions/${sessionId}/chat/stream`, {
      method: "POST",
      headers,
      body: JSON.stringify({ message, scope_mode: scopeMode || undefined }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      let detail = "";
      try {
        const payload = await res.json();
        detail = payload?.errors?.[0]?.message || payload?.error || payload?.message || "";
      } catch {
        try {
          detail = await res.text();
        } catch {
          detail = "";
        }
      }
      throw new Error(detail || `Stream failed (${res.status})`);
    }
    if (!res.body) throw new Error(`Stream failed (${res.status})`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let donePayload = null;
    let streamError = null;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() || "";
      for (const chunk of chunks) {
        const lines = chunk.split("\n");
        let eventName = "";
        const dataLines = [];
        for (const rawLine of lines) {
          const line = rawLine.trimEnd();
          if (line.startsWith("event:")) eventName = line.replace("event:", "").trim();
          if (line.startsWith("data:")) dataLines.push(line.replace("data:", "").trim());
        }
        if (!eventName || dataLines.length === 0) continue;
        try {
          const payload = JSON.parse(dataLines.join("\n"));
          const evt = { event: eventName, ...payload };
          sawAnyEvent = true;
          onEvent?.(evt);
          if (eventName === "error") {
            streamError = payload?.data?.message || payload?.data?.error || payload?.message || "Stream failed";
          }
          if (eventName === "done") {
            donePayload = payload?.data || payload || null;
          }
        } catch {
          // ignore malformed frames
        }
      }
      if (donePayload) break;
    }
    if (streamError) throw new Error(streamError);
    if (!donePayload) {
      const err = new Error("Stream ended without done event");
      err.transport = !sawAnyEvent;
      throw err;
    }
    return donePayload;
  })().catch((err) => {
    if (err?.name === "AbortError") throw err;
    const messageText = typeof err?.message === "string" ? err.message : "";
    const transportFailure = Boolean(
      err?.transport || /network error|failed to fetch|load failed|networkerror/i.test(messageText),
    );
    if (!transportFailure) throw err;
    return sendOctoAiChatMessage(sessionId, { message, scope_mode: scopeMode || undefined }).then((payload) => {
      const data = payload?.data || payload || {};
      return data;
    });
  });
  return { cancel: () => controller.abort(), promise };
}
