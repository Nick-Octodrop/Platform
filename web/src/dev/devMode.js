const DEV_KEY = "octo_dev_mode";
const EVENT_NAME = "octo_dev_mode_change";

export function getDevMode() {
  return localStorage.getItem(DEV_KEY) === "1";
}

export function setDevMode(enabled) {
  localStorage.setItem(DEV_KEY, enabled ? "1" : "0");
  window.dispatchEvent(new Event(EVENT_NAME));
}

export function subscribeDevMode(handler) {
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
