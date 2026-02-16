const STORAGE_KEY = "app_icons_v1";
const EVENT_NAME = "app-icons-updated";

function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // ignore
  }
  return {};
}

function saveStore(store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function notifyChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export function getAppIcon(moduleId) {
  const store = loadStore();
  return store[moduleId] || null;
}

export function setAppLucideIcon(moduleId, iconName) {
  const store = loadStore();
  store[moduleId] = `lucide:${iconName}`;
  saveStore(store);
  notifyChange();
}

export function setAppIcon(moduleId, dataUrl) {
  const store = loadStore();
  store[moduleId] = dataUrl;
  saveStore(store);
  notifyChange();
}

export function removeAppIcon(moduleId) {
  const store = loadStore();
  delete store[moduleId];
  saveStore(store);
  notifyChange();
}

export function subscribeAppIcons(handler) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
