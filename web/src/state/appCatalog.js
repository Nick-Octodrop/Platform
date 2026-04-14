import { translateRuntime } from "../i18n/runtime.js";

function titleCase(text) {
  return text
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((t) => t[0].toUpperCase() + t.slice(1))
    .join(" ");
}

function namespaceFromKey(key) {
  if (typeof key !== "string" || !key.includes(".")) return null;
  return key.split(".")[0] || null;
}

export function getAppDisplayName(moduleId, moduleRecord) {
  const fallback = moduleRecord?.name || titleCase(moduleId);
  if (moduleRecord?.name_key) {
    return translateRuntime(moduleRecord.name_key, {}, { defaultValue: fallback });
  }
  return fallback;
}

export function getAppDescription(moduleRecord) {
  const fallback = moduleRecord?.description || "";
  if (moduleRecord?.description_key) {
    return translateRuntime(moduleRecord.description_key, {}, { defaultValue: fallback });
  }
  return fallback;
}

export function getAppTranslationNamespaces(moduleRecords = []) {
  const namespaces = new Set();
  for (const moduleRecord of moduleRecords || []) {
    const nameNamespace = namespaceFromKey(moduleRecord?.name_key);
    const descriptionNamespace = namespaceFromKey(moduleRecord?.description_key);
    if (nameNamespace) namespaces.add(nameNamespace);
    if (descriptionNamespace) namespaces.add(descriptionNamespace);
  }
  return Array.from(namespaces);
}
