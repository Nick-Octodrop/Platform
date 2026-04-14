import { ensureRuntimeNamespaces, hasRuntimeTranslation, translateRuntime } from "./runtime.js";

const KEY_MAPPINGS = [
  ["name_key", "name"],
  ["title_key", "title"],
  ["label_key", "label"],
  ["menu_label_key", "label"],
  ["action_label_key", "label"],
  ["status_label_key", "label"],
  ["tab_label_key", "tab_label"],
  ["section_title_key", "title"],
  ["description_key", "description"],
  ["help_text_key", "help_text"],
  ["placeholder_key", "placeholder"],
  ["empty_state_key", "empty_state"],
  ["text_key", "text"],
  ["subtitle_key", "subtitle"],
  ["button_label_key", "button_label"],
];

function collectNamespaces(value, namespaces = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectNamespaces(item, namespaces));
    return namespaces;
  }
  if (!value || typeof value !== "object") return namespaces;
  for (const [key, child] of Object.entries(value)) {
    if (key.endsWith("_key") && typeof child === "string" && child.includes(".")) {
      namespaces.add(child.split(".")[0]);
    }
    collectNamespaces(child, namespaces);
  }
  return namespaces;
}

function localizeNode(value) {
  if (Array.isArray(value)) {
    return value.map((item) => localizeNode(item));
  }
  if (!value || typeof value !== "object") return value;
  const next = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, localizeNode(child)]));
  for (const [keyProp, targetProp] of KEY_MAPPINGS) {
    const key = next[keyProp];
    if (typeof key !== "string" || !key.trim()) continue;
    const fallback = typeof next[targetProp] === "string" ? next[targetProp] : "";
    next[targetProp] = translateRuntime(key, {}, { defaultValue: fallback || key });
  }
  return next;
}

export async function localizeManifest(manifest) {
  if (!manifest || typeof manifest !== "object") return manifest;
  const namespaces = Array.from(collectNamespaces(manifest));
  if (namespaces.length > 0) {
    await ensureRuntimeNamespaces(namespaces);
  }
  return localizeNode(manifest);
}

export function manifestHasTranslationKey(manifest, key) {
  if (!manifest || typeof manifest !== "object") return false;
  return hasRuntimeTranslation(key);
}
