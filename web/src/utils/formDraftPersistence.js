const STORAGE_PREFIX = "octo:form-draft:";

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
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveFormDraftSnapshot(key, snapshot) {
  if (!key || !canUseSessionStorage()) return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(snapshot || {}));
  } catch {
    // ignore quota / storage failures
  }
}

export function clearFormDraftSnapshot(key) {
  if (!key || !canUseSessionStorage()) return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // ignore storage failures
  }
}
