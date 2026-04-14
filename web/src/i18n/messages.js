import { FALLBACK_LOCALE } from "./options.js";

let localeModules = null;
let preloadedCoreModules = null;
try {
  localeModules = import.meta.glob("../locales/*/*.json", { import: "default" });
} catch {
  localeModules = null;
}
try {
  preloadedCoreModules = {
    ...import.meta.glob("../locales/*/common.json", { import: "default", eager: true }),
    ...import.meta.glob("../locales/*/empty.json", { import: "default", eager: true }),
    ...import.meta.glob("../locales/*/navigation.json", { import: "default", eager: true }),
    ...import.meta.glob("../locales/*/settings.json", { import: "default", eager: true }),
    ...import.meta.glob("../locales/*/validation.json", { import: "default", eager: true }),
  };
} catch {
  preloadedCoreModules = null;
}
const messageCache = new Map();
const inflight = new Map();

function cacheKey(locale, namespace) {
  return `${locale}:${namespace}`;
}

export function getMessageCacheSnapshot(locale, namespaces = []) {
  const snapshot = {};
  for (const namespace of namespaces) {
    const key = cacheKey(locale, namespace);
    if (messageCache.has(key)) {
      snapshot[namespace] = messageCache.get(key) || {};
    }
  }
  return snapshot;
}

export function getPreloadedLocaleNamespaces(locale, namespaces = []) {
  const normalizedLocale = String(locale || "").trim() || FALLBACK_LOCALE;
  const unique = Array.from(new Set((namespaces || []).map((item) => String(item || "").trim()).filter(Boolean)));
  if (unique.length === 0) return {};
  const loaded = {};
  for (const namespace of unique) {
    const existing = messageCache.get(cacheKey(normalizedLocale, namespace));
    if (existing && typeof existing === "object") {
      loaded[namespace] = existing;
      continue;
    }
    if (!preloadedCoreModules) continue;
    const path = `../locales/${normalizedLocale}/${namespace}.json`;
    const messages = preloadedCoreModules[path];
    if (!messages || typeof messages !== "object") continue;
    loaded[namespace] = messages;
    messageCache.set(cacheKey(normalizedLocale, namespace), messages);
  }
  return loaded;
}

export async function loadNamespaceMessages(locale, namespace) {
  const normalizedLocale = String(locale || "").trim() || FALLBACK_LOCALE;
  const safeNamespace = String(namespace || "").trim();
  if (!safeNamespace) return {};
  const key = cacheKey(normalizedLocale, safeNamespace);
  if (messageCache.has(key)) {
    return messageCache.get(key) || {};
  }
  if (inflight.has(key)) {
    return inflight.get(key);
  }
  const path = `../locales/${normalizedLocale}/${safeNamespace}.json`;
  const loader = localeModules ? localeModules[path] : null;
  const request = (async () => {
    if (!loader) {
      if (typeof process !== "undefined" && process?.versions?.node) {
        try {
          const nodeFsModule = "node:fs/promises";
          const { readFile } = await import(/* @vite-ignore */ nodeFsModule);
          const url = new URL(path, import.meta.url);
          const messages = JSON.parse(await readFile(url, "utf8"));
          messageCache.set(key, messages);
          return messages;
        } catch {
          messageCache.set(key, {});
          return {};
        } finally {
          inflight.delete(key);
        }
      }
      messageCache.set(key, {});
      return {};
    }
    try {
      const loaded = await loader();
      const messages = loaded && typeof loaded === "object" ? loaded : {};
      messageCache.set(key, messages);
      return messages;
    } catch {
      messageCache.set(key, {});
      return {};
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, request);
  return request;
}

export async function ensureLocaleNamespaces(locale, namespaces = []) {
  const unique = Array.from(new Set((namespaces || []).map((item) => String(item || "").trim()).filter(Boolean)));
  if (unique.length === 0) return {};
  const loaded = await Promise.all(unique.map(async (namespace) => [namespace, await loadNamespaceMessages(locale, namespace)]));
  return Object.fromEntries(loaded);
}
