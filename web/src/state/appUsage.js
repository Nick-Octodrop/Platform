const PIN_KEY = "octo_pinned_apps";
const RECENT_KEY = "octo_recent_apps";
const EVENT_NAME = "octo_apps_usage";
const RECENT_MAX = 5;

function notify() {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(EVENT_NAME));
  } catch {
    // Ignore non-critical UI cache notification failures.
  }
}

function readList(key) {
  try {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") return [];
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeList(key, list) {
  try {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify(list));
    notify();
  } catch {
    // Ignore non-critical UI cache persistence failures.
  }
}

export function getPinnedApps() {
  return readList(PIN_KEY);
}

export function togglePinnedApp(moduleId) {
  const current = new Set(readList(PIN_KEY));
  if (current.has(moduleId)) {
    current.delete(moduleId);
  } else {
    current.add(moduleId);
  }
  writeList(PIN_KEY, Array.from(current));
}

export function getRecentApps() {
  return readList(RECENT_KEY);
}

export function recordRecentApp(moduleId) {
  if (typeof moduleId !== "string" || !moduleId.trim()) return;
  const current = readList(RECENT_KEY);
  const next = [moduleId, ...current.filter((id) => id !== moduleId)].slice(0, RECENT_MAX);
  writeList(RECENT_KEY, next);
}

export function subscribeAppUsage(handler) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
