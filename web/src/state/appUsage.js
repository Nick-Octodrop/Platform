const PIN_KEY = "octo_pinned_apps";
const RECENT_KEY = "octo_recent_apps";
const EVENT_NAME = "octo_apps_usage";
const RECENT_MAX = 5;

function notify() {
  window.dispatchEvent(new Event(EVENT_NAME));
}

function readList(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeList(key, list) {
  localStorage.setItem(key, JSON.stringify(list));
  notify();
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
  const current = readList(RECENT_KEY);
  const next = [moduleId, ...current.filter((id) => id !== moduleId)].slice(0, RECENT_MAX);
  writeList(RECENT_KEY, next);
}

export function subscribeAppUsage(handler) {
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
