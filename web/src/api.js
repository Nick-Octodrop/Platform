import { supabase } from "./supabase";

export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
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

function resolvePolicy(path, method) {
  for (const policy of REQUEST_POLICIES) {
    if (policy.pattern.test(path) && policy.methods.includes(method)) {
      return policy;
    }
  }
  return null;
}

function requestKey(method, path, body, cacheKey) {
  if (cacheKey) return `${method}:${cacheKey}`;
  if (!body) return `${method}:${path}`;
  return `${method}:${path}:${body}`;
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
  const method = (options.method || "GET").toUpperCase();
  const body = typeof options.body === "string" ? options.body : options.body ? JSON.stringify(options.body) : "";
  const policy = resolvePolicy(path, method);
  const cacheTtl = typeof options.cacheTtl === "number" ? options.cacheTtl : policy?.ttl ?? REQUEST_DEFAULT_TTL_MS;
  const cacheKey = options.cacheKey || null;
  const cacheAllowed = cacheTtl > 0;
  const key = requestKey(method, path, body, cacheKey);

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
  const now = Date.now();
  if (modulesCache && now - modulesCacheTs < MODULES_TTL_MS) {
    return modulesCache;
  }
  const res = await apiFetch("/modules");
  modulesCache = res;
  modulesCacheTs = now;
  return res;
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
  const now = Date.now();
  const cached = manifestCache.get(moduleId);
  const ts = manifestCacheTs.get(moduleId) || 0;
  if (cached && now - ts < MANIFEST_TTL_MS) {
    return cached;
  }
  const inflight = manifestInFlight.get(moduleId);
  if (inflight) {
    return inflight;
  }
  const cachedHash = manifestHashByModule.get(moduleId);
  if (cachedHash && manifestByHash.has(cachedHash) && now - ts < MANIFEST_TTL_MS) {
    const res = manifestByHash.get(cachedHash);
    manifestCache.set(moduleId, res);
    manifestCacheTs.set(moduleId, now);
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
      manifestHashByModule.set(moduleId, manifestHash);
      manifestCache.set(moduleId, result);
      manifestCacheTs.set(moduleId, now);
      return result;
    }
    manifestCache.set(moduleId, res);
    manifestCacheTs.set(moduleId, now);
    return res;
  }).finally(() => {
    manifestInFlight.delete(moduleId);
  });
  manifestInFlight.set(moduleId, request);
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
  return apiFetch(`/page/bootstrap?${params.toString()}`);
}

export function invalidateManifestCache(moduleId) {
  manifestCache.delete(moduleId);
  manifestCacheTs.delete(moduleId);
  const hash = manifestHashByModule.get(moduleId);
  if (hash) {
    manifestByHash.delete(hash);
    compiledByHash.delete(hash);
  }
  manifestHashByModule.delete(moduleId);
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

export async function getDraft(moduleId) {
  const now = Date.now();
  const cached = draftCache.get(moduleId);
  const ts = draftCacheTs.get(moduleId) || 0;
  if (cached && now - ts < DRAFT_TTL_MS) {
    return cached;
  }
  const inflight = draftInFlight.get(moduleId);
  if (inflight) return inflight;
  const request = apiFetch(`/studio2/modules/${moduleId}/draft`)
    .then((res) => {
      draftCache.set(moduleId, res);
      draftCacheTs.set(moduleId, now);
      return res;
    })
    .finally(() => {
      draftInFlight.delete(moduleId);
    });
  draftInFlight.set(moduleId, request);
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
