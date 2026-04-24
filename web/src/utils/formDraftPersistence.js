const STORAGE_PREFIX = "octo:form-draft:";
const pendingWrites = new Map();
const lastPersistedRaw = new Map();

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = stableValue(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function canUseSessionStorage() {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

export function buildFormDraftStorageKey({ scope = "form", entityId = "", recordId = "new", viewId = "", routeKey = "" } = {}) {
  return `${STORAGE_PREFIX}${scope}:${entityId || "unknown"}:${recordId || "new"}:${viewId || "view"}:${routeKey || "route"}`;
}

export function loadFormDraftSnapshot(key) {
  if (!key || !canUseSessionStorage()) return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    lastPersistedRaw.set(key, raw);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function formDraftValuesEqual(left, right) {
  try {
    return JSON.stringify(stableValue(left || {})) === JSON.stringify(stableValue(right || {}));
  } catch {
    return false;
  }
}

export function resolvePersistedFormDraft(baseRecord, persisted, applyRecord = (value) => value || {}) {
  const safeBase = baseRecord && typeof baseRecord === "object" ? baseRecord : {};
  const baseApplied = applyRecord(safeBase);
  const persistedDraft =
    persisted?.dirty && persisted?.draft && typeof persisted.draft === "object" ? persisted.draft : null;
  if (!persistedDraft) {
    return { draft: baseApplied, initialDraft: baseApplied, dirty: false };
  }
  const persistedInitial =
    persisted?.dirty && persisted?.initialDraft && typeof persisted.initialDraft === "object"
      ? persisted.initialDraft
      : persisted?.dirty && persisted?.record && typeof persisted.record === "object"
        ? persisted.record
        : safeBase;
  const initialApplied = applyRecord(persistedInitial);
  const mergedApplied = applyRecord({ ...safeBase, ...persistedDraft });
  const dirty = !formDraftValuesEqual(mergedApplied, initialApplied);
  if (!dirty) {
    return { draft: initialApplied, initialDraft: initialApplied, dirty: false };
  }
  return { draft: mergedApplied, initialDraft: initialApplied, dirty: true };
}

export function saveFormDraftSnapshot(key, snapshot) {
  if (!key || !canUseSessionStorage()) return;
  try {
    const raw = JSON.stringify(snapshot || {});
    if (lastPersistedRaw.get(key) === raw && !pendingWrites.has(key)) return;
    const existingTimer = pendingWrites.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    const timer = window.setTimeout(() => {
      try {
        window.sessionStorage.setItem(key, raw);
        lastPersistedRaw.set(key, raw);
      } catch {
        // ignore quota / storage failures
      } finally {
        pendingWrites.delete(key);
      }
    }, 180);
    pendingWrites.set(key, timer);
  } catch {
    // ignore quota / storage failures
  }
}

export function clearFormDraftSnapshot(key) {
  if (!key || !canUseSessionStorage()) return;
  try {
    const existingTimer = pendingWrites.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
      pendingWrites.delete(key);
    }
    window.sessionStorage.removeItem(key);
    lastPersistedRaw.delete(key);
  } catch {
    // ignore storage failures
  }
}
