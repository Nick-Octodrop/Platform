import {
  formatCurrencyValue,
  formatDateTimeValue,
  formatDateValue,
  formatNumberValue,
  formatPercentValue,
  formatTimeValue,
} from "./formatters.js";
import { ensureLocaleNamespaces, getPreloadedLocaleNamespaces } from "./messages.js";
import { DEFAULT_CURRENCY, DEFAULT_LOCALE, DEFAULT_TIMEZONE, FALLBACK_LOCALE } from "./options.js";

export const I18N_RUNTIME_CHANGE_EVENT = "octo:i18n-runtime-changed";

const runtime = {
  locale: DEFAULT_LOCALE,
  timezone: DEFAULT_TIMEZONE,
  defaultCurrency: DEFAULT_CURRENCY,
  messages: {},
  fallbackMessages: {},
  version: 0,
};

function emitRuntimeChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(I18N_RUNTIME_CHANGE_EVENT, {
      detail: getI18nRuntimeSnapshot(),
    }),
  );
}

function mergeNamespaceBundle(target, incoming) {
  let changed = false;
  const next = { ...target };
  for (const [namespace, messages] of Object.entries(incoming || {})) {
    if (!messages || typeof messages !== "object") continue;
    if (next[namespace] === messages) continue;
    next[namespace] = messages;
    changed = true;
  }
  return { next, changed };
}

function lookupPath(messages, key) {
  if (!messages || typeof messages !== "object") return undefined;
  return String(key || "")
    .split(".")
    .filter(Boolean)
    .reduce((current, part) => (current && typeof current === "object" ? current[part] : undefined), messages);
}

function interpolate(template, values = {}) {
  if (typeof template !== "string") return template;
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, token) => {
    if (!Object.prototype.hasOwnProperty.call(values, token)) return "";
    const value = values[token];
    return value === null || value === undefined ? "" : String(value);
  });
}

export function getI18nRuntimeSnapshot() {
  return { ...runtime };
}

export function getI18nCacheKey() {
  return `${runtime.locale}:${runtime.version}`;
}

export function setRuntimePreferences({ locale, timezone, defaultCurrency } = {}) {
  const nextLocale = String(locale || "").trim() || DEFAULT_LOCALE;
  const nextTimezone = String(timezone || "").trim() || DEFAULT_TIMEZONE;
  const nextCurrency = String(defaultCurrency || "").trim().toUpperCase() || DEFAULT_CURRENCY;
  const localeChanged = runtime.locale !== nextLocale;
  const changed =
    localeChanged ||
    runtime.timezone !== nextTimezone ||
    runtime.defaultCurrency !== nextCurrency;
  if (localeChanged) {
    runtime.messages = {};
    runtime.fallbackMessages = {};
  }
  runtime.locale = nextLocale;
  runtime.timezone = nextTimezone;
  runtime.defaultCurrency = nextCurrency;
  if (changed) {
    runtime.version += 1;
    emitRuntimeChange();
  }
  return getI18nRuntimeSnapshot();
}

export function bootstrapRuntime({ locale, timezone, defaultCurrency, namespaces = [] } = {}) {
  const snapshot = setRuntimePreferences({ locale, timezone, defaultCurrency });
  const unique = Array.from(new Set((namespaces || []).map((item) => String(item || "").trim()).filter(Boolean)));
  if (unique.length === 0) return snapshot;
  const loaded = getPreloadedLocaleNamespaces(snapshot.locale, unique);
  const fallbackLoaded =
    snapshot.locale === FALLBACK_LOCALE
      ? loaded
      : getPreloadedLocaleNamespaces(FALLBACK_LOCALE, unique);
  const hasLoadedMessages = Object.keys(loaded).length > 0 || Object.keys(fallbackLoaded).length > 0;
  if (!hasLoadedMessages) return getI18nRuntimeSnapshot();
  const mergedPrimary = mergeNamespaceBundle(runtime.messages, loaded);
  const mergedFallback = mergeNamespaceBundle(runtime.fallbackMessages, fallbackLoaded);
  if (!mergedPrimary.changed && !mergedFallback.changed) {
    return getI18nRuntimeSnapshot();
  }
  runtime.messages = mergedPrimary.next;
  runtime.fallbackMessages = mergedFallback.next;
  runtime.version += 1;
  emitRuntimeChange();
  return getI18nRuntimeSnapshot();
}

export async function ensureRuntimeNamespaces(namespaces = [], locale = runtime.locale) {
  const unique = Array.from(new Set((namespaces || []).map((item) => String(item || "").trim()).filter(Boolean)));
  if (unique.length === 0) return getI18nRuntimeSnapshot();
  const loaded = await ensureLocaleNamespaces(locale, unique);
  const fallbackLoaded = locale === FALLBACK_LOCALE ? loaded : await ensureLocaleNamespaces(FALLBACK_LOCALE, unique);
  const mergedPrimary = mergeNamespaceBundle(runtime.messages, loaded);
  const mergedFallback = mergeNamespaceBundle(runtime.fallbackMessages, fallbackLoaded);
  if (!mergedPrimary.changed && !mergedFallback.changed) {
    return getI18nRuntimeSnapshot();
  }
  runtime.messages = mergedPrimary.next;
  runtime.fallbackMessages = mergedFallback.next;
  runtime.version += 1;
  emitRuntimeChange();
  return getI18nRuntimeSnapshot();
}

export function hasRuntimeTranslation(key) {
  const raw = String(key || "").trim();
  if (!raw.includes(".")) return false;
  const [namespace, ...rest] = raw.split(".");
  const path = rest.join(".");
  return lookupPath(runtime.messages[namespace], path) !== undefined || lookupPath(runtime.fallbackMessages[namespace], path) !== undefined;
}

export function translateRuntime(key, values = {}, options = {}) {
  const raw = String(key || "").trim();
  if (!raw) return "";
  if (!raw.includes(".")) return interpolate(options.defaultValue || raw, values);
  const [namespace, ...rest] = raw.split(".");
  const path = rest.join(".");
  const template =
    lookupPath(runtime.messages[namespace], path) ??
    lookupPath(runtime.fallbackMessages[namespace], path) ??
    options.defaultValue ??
    raw;
  return interpolate(template, values);
}

export function formatDateRuntime(value, options = {}) {
  return formatDateValue(value, { locale: runtime.locale, timezone: runtime.timezone, ...options });
}

export function formatTimeRuntime(value, options = {}) {
  return formatTimeValue(value, { locale: runtime.locale, timezone: runtime.timezone, ...options });
}

export function formatDateTimeRuntime(value, options = {}) {
  return formatDateTimeValue(value, { locale: runtime.locale, timezone: runtime.timezone, ...options });
}

export function formatNumberRuntime(value, options = {}) {
  return formatNumberValue(value, { locale: runtime.locale, ...options });
}

export function formatPercentRuntime(value, options = {}) {
  return formatPercentValue(value, { locale: runtime.locale, ...options });
}

export function formatCurrencyRuntime(value, currencyCode, options = {}) {
  return formatCurrencyValue(value, currencyCode || runtime.defaultCurrency, { locale: runtime.locale, ...options });
}
