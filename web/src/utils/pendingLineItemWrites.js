const stores = new Map();
const listeners = new Map();

const SAVED_ENTRY_TTL_MS = 30000;

function normalizeId(value) {
  return String(value || "").trim();
}

function cloneEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  return {
    ...entry,
    record: entry.record && typeof entry.record === "object" ? { ...entry.record } : {},
  };
}

function getStore(scopeKey) {
  const key = normalizeId(scopeKey);
  if (!key) return null;
  if (!stores.has(key)) stores.set(key, new Map());
  return stores.get(key);
}

function emit(scopeKey) {
  const key = normalizeId(scopeKey);
  if (!key) return;
  const callbacks = listeners.get(key);
  if (!callbacks) return;
  callbacks.forEach((callback) => {
    try {
      callback();
    } catch {
      // A stale listener should not break the shared pending-write registry.
    }
  });
}

function sweepSavedEntries(scopeKey) {
  const store = getStore(scopeKey);
  if (!store) return false;
  const now = Date.now();
  let changed = false;
  for (const [tempId, entry] of store.entries()) {
    if (entry?.status === "saved" && now - (entry.updatedAt || now) > SAVED_ENTRY_TTL_MS) {
      store.delete(tempId);
      changed = true;
    }
  }
  if (store.size === 0) stores.delete(normalizeId(scopeKey));
  return changed;
}

export function buildPendingLineItemScope({ parentEntityId, parentRecordId, childEntityId, parentField } = {}) {
  const parentRecord = normalizeId(parentRecordId);
  const childEntity = normalizeId(childEntityId);
  if (!parentRecord || !childEntity) return "";
  return [
    normalizeId(parentEntityId) || "entity",
    parentRecord,
    childEntity,
    normalizeId(parentField) || "parent",
  ].join("::");
}

export function subscribePendingLineItems(scopeKey, callback) {
  const key = normalizeId(scopeKey);
  if (!key || typeof callback !== "function") return () => {};
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(callback);
  return () => {
    const callbacks = listeners.get(key);
    if (!callbacks) return;
    callbacks.delete(callback);
    if (callbacks.size === 0) listeners.delete(key);
  };
}

export function getPendingLineItemEntries(scopeKey) {
  const key = normalizeId(scopeKey);
  if (!key) return [];
  sweepSavedEntries(key);
  const store = stores.get(key);
  if (!store) return [];
  return Array.from(store.values())
    .map(cloneEntry)
    .filter(Boolean)
    .sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0));
}

export function getPendingLineItemEntry(scopeKey, tempId) {
  const store = stores.get(normalizeId(scopeKey));
  const entry = store?.get(normalizeId(tempId));
  return cloneEntry(entry);
}

export function addPendingLineItem(scopeKey, entry) {
  const key = normalizeId(scopeKey);
  const tempId = normalizeId(entry?.tempId);
  const store = getStore(key);
  if (!store || !tempId) return null;
  const now = Date.now();
  const next = {
    ...entry,
    tempId,
    status: "saving",
    error: "",
    createdAt: entry?.createdAt || now,
    updatedAt: now,
    record: entry?.record && typeof entry.record === "object" ? { ...entry.record } : {},
  };
  store.set(tempId, next);
  emit(key);
  return cloneEntry(next);
}

export function attachPendingLineItemPromise(scopeKey, tempId, promise) {
  const key = normalizeId(scopeKey);
  const store = stores.get(key);
  const entry = store?.get(normalizeId(tempId));
  if (!entry) return;
  entry.promise = promise;
  entry.updatedAt = Date.now();
  emit(key);
}

export function updatePendingLineItem(scopeKey, tempId, updater) {
  const key = normalizeId(scopeKey);
  const store = stores.get(key);
  const entry = store?.get(normalizeId(tempId));
  if (!entry) return null;
  const currentRecord = entry.record && typeof entry.record === "object" ? entry.record : {};
  const nextRecord =
    typeof updater === "function"
      ? updater({ ...currentRecord }, cloneEntry(entry))
      : { ...currentRecord, ...(updater && typeof updater === "object" ? updater : {}) };
  entry.record = nextRecord && typeof nextRecord === "object" ? { ...nextRecord } : {};
  entry.updatedAt = Date.now();
  emit(key);
  return cloneEntry(entry);
}

export function completePendingLineItem(scopeKey, tempId, { recordId, record, label } = {}) {
  const key = normalizeId(scopeKey);
  const store = stores.get(key);
  const entry = store?.get(normalizeId(tempId));
  if (!entry) return null;
  entry.status = "saved";
  entry.recordId = normalizeId(recordId) || entry.recordId || "";
  entry.record = record && typeof record === "object" ? { ...record } : entry.record || {};
  entry.label = label || entry.label || "";
  entry.error = "";
  entry.promise = null;
  entry.updatedAt = Date.now();
  emit(key);
  return cloneEntry(entry);
}

export function failPendingLineItem(scopeKey, tempId, error) {
  const key = normalizeId(scopeKey);
  const store = stores.get(key);
  const entry = store?.get(normalizeId(tempId));
  if (!entry) return null;
  entry.status = "error";
  entry.error = error?.message || String(error || "");
  entry.promise = null;
  entry.updatedAt = Date.now();
  emit(key);
  return cloneEntry(entry);
}

export function removePendingLineItem(scopeKey, tempId) {
  const key = normalizeId(scopeKey);
  const store = stores.get(key);
  if (!store) return false;
  const deleted = store.delete(normalizeId(tempId));
  if (store.size === 0) stores.delete(key);
  if (deleted) emit(key);
  return deleted;
}

export function acknowledgePersistedLineItems(scopeKey, recordIds = []) {
  const key = normalizeId(scopeKey);
  const store = stores.get(key);
  if (!store) return;
  const ids = new Set((recordIds || []).map(normalizeId).filter(Boolean));
  let changed = false;
  for (const [tempId, entry] of store.entries()) {
    if (entry?.status === "saved" && entry.recordId && ids.has(normalizeId(entry.recordId))) {
      store.delete(tempId);
      changed = true;
    }
  }
  if (sweepSavedEntries(key)) changed = true;
  if (store.size === 0) stores.delete(key);
  if (changed) emit(key);
}

export async function waitForPendingLineItemWrites({ parentEntityId, parentRecordId, timeoutMs = 15000 } = {}) {
  const parentEntity = normalizeId(parentEntityId);
  const parentRecord = normalizeId(parentRecordId);
  if (!parentRecord) return { ok: true, pending: 0, failed: 0, timedOut: false };

  function matchingEntries() {
    const entries = [];
    for (const store of stores.values()) {
      for (const entry of store.values()) {
        if (normalizeId(entry?.parentRecordId) !== parentRecord) continue;
        if (parentEntity && normalizeId(entry?.parentEntityId) && normalizeId(entry.parentEntityId) !== parentEntity) continue;
        entries.push(entry);
      }
    }
    return entries;
  }

  let entries = matchingEntries();
  let pending = entries.filter((entry) => entry?.status === "saving" && entry.promise);
  if (pending.length > 0) {
    let timedOut = false;
    await Promise.race([
      Promise.allSettled(pending.map((entry) => entry.promise)),
      new Promise((resolve) => {
        setTimeout(() => {
          timedOut = true;
          resolve();
        }, timeoutMs);
      }),
    ]);
    if (timedOut) {
      return { ok: false, pending: pending.length, failed: 0, timedOut: true };
    }
  }

  entries = matchingEntries();
  pending = entries.filter((entry) => entry?.status === "saving");
  const failed = entries.filter((entry) => entry?.status === "error");
  return {
    ok: pending.length === 0 && failed.length === 0,
    pending: pending.length,
    failed: failed.length,
    timedOut: false,
  };
}
