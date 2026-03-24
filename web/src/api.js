import { supabase } from "./supabase";

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

const REQUEST_POLICIES = [
  { pattern: /^\/modules$/, methods: ["GET"], ttl: 30000 },
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

export async function apiFetch(path, options = {}) {
  const perfEnabled = typeof window !== "undefined" && window.localStorage?.getItem("octo_perf") === "1";
  const trace = options.trace || path;
  const start = perfEnabled ? performance.now() : 0;
  const session = (await supabase.auth.getSession()).data.session;
  const token = session?.access_token;
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
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
  const method = (options.method || "GET").toUpperCase();
  const body = typeof options.body === "string" ? options.body : options.body ? JSON.stringify(options.body) : "";
  const policy = resolvePolicy(path, method);
  const cacheTtl = sandboxActive ? 0 : typeof options.cacheTtl === "number" ? options.cacheTtl : policy?.ttl ?? REQUEST_DEFAULT_TTL_MS;
  const cacheKey = options.cacheKey || null;
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
  const timeoutMs = typeof options.timeoutMs === "number" ? options.timeoutMs : null;
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutId = timeoutMs && controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const request = fetch(`${API_URL}${path}`, {
      ...options,
      method,
      body: body || options.body,
      headers,
      cache: sandboxActive ? "no-store" : options.cache,
      signal: controller?.signal,
    })
      .then(async (response) => {
        res = response;
        data = await response.json();
        if (!response.ok) {
          const code = data?.errors?.[0]?.code;
          const message = data?.errors?.[0]?.message || data?.error || data?.message || "Request failed";
          const err = new Error(message);
          err.code = code;
          err.detail = data?.errors?.[0]?.detail;
          err.path = data?.errors?.[0]?.path;
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
          if (path.startsWith("/actions/")) {
            // Actions can mutate arbitrary records, so clear record/list bootstrap caches broadly.
            invalidateRequestPrefix("/records/");
            invalidateRequestPrefix("/page/bootstrap");
          }
          if (path.startsWith("/modules") || path.startsWith("/studio2/")) {
            modulesCache = null;
            modulesCacheTs = 0;
            invalidateRequestPrefix("/modules");
          }
        }
        return data;
      })
      .finally(() => {
        requestInFlight.delete(key);
        if (timeoutId) clearTimeout(timeoutId);
      });

    requestInFlight.set(key, request);
    return await request;
  } finally {
    if (perfEnabled) {
      const ms = Math.round(performance.now() - start);
      const status = res?.status;
      console.debug(`[perf] ${trace} ${status ?? "ERR"} ${ms}ms`);
    }
  }
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
    const manifestHash = res.manifest_hash;
    if (manifestHash) {
      const compiled = compiledByHash.get(manifestHash) || compileManifest(res.manifest);
      if (!compiledByHash.has(manifestHash)) {
        compiledByHash.set(manifestHash, compiled);
      }
      return { ...res, compiled };
    }
    return res;
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
  const request = apiFetch(`/modules/${moduleId}/manifest`).then((res) => {
    const manifestHash = res.manifest_hash;
    if (manifestHash) {
      const compiled = compiledByHash.get(manifestHash) || compileManifest(res.manifest);
      if (!compiledByHash.has(manifestHash)) {
        compiledByHash.set(manifestHash, compiled);
      }
      const result = { ...res, compiled };
      manifestByHash.set(manifestHash, result);
      manifestHashByModule.set(scopedModuleId, manifestHash);
      manifestCache.set(scopedModuleId, result);
      manifestCacheTs.set(scopedModuleId, now);
      return result;
    }
    manifestCache.set(scopedModuleId, res);
    manifestCacheTs.set(scopedModuleId, now);
    return res;
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
  return apiFetch(`/page/bootstrap?${params.toString()}`, { cacheTtl: isOctoAiSandboxActive() ? 0 : undefined });
}

export function invalidateManifestCache(moduleId) {
  const scopedModuleId = workspaceScopedKey(moduleId);
  manifestCache.delete(scopedModuleId);
  manifestCacheTs.delete(scopedModuleId);
  const hash = manifestHashByModule.get(scopedModuleId);
  if (hash) {
    manifestByHash.delete(hash);
    compiledByHash.delete(hash);
  }
  manifestHashByModule.delete(scopedModuleId);
}

export function clearCaches() {
  invalidateModulesCache();
  draftCache.clear();
  draftCacheTs.clear();
  draftInFlight.clear();
  requestCache.clear();
  requestCacheTs.clear();
  requestInFlight.clear();
  manifestCache.clear();
  manifestCacheTs.clear();
  manifestHashByModule.clear();
  manifestByHash.clear();
  compiledByHash.clear();
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
