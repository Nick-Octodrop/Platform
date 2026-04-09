let lucideCatalogPromise = null;

function toKebab(name) {
  return name
    .replace(/_/g, "-")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
}

function toPascal(name) {
  return name
    .replace(/[_\-\s]+/g, " ")
    .replace(/(^|\s)([a-zA-Z0-9])/g, (_, __, c) => c.toUpperCase())
    .replace(/\s+/g, "");
}

export function normalizeLucideKey(raw) {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  const idx = trimmed.indexOf("lucide:");
  if (idx === -1) return trimmed;
  return trimmed.slice(idx + 7).trim();
}

async function loadLucideCatalog() {
  if (!lucideCatalogPromise) {
    lucideCatalogPromise = import("lucide-react/dynamicIconImports").then((mod) => {
      const importers = mod?.default || mod || {};
      const iconMap = Object.entries(importers).reduce((acc, [name, loader]) => {
        if (typeof loader !== "function") return acc;
        acc[name] = loader;
        acc[toKebab(name)] = loader;
        acc[toPascal(name)] = loader;
        acc[name.toLowerCase()] = loader;
        acc[toKebab(name).toLowerCase()] = loader;
        acc[toPascal(name).toLowerCase()] = loader;
        return acc;
      }, {});
      const iconList = Object.keys(importers).map((name) => ({ name }));
      return { importers, iconMap, iconList };
    });
  }
  return lucideCatalogPromise;
}

export async function loadLucideIconList() {
  const catalog = await loadLucideCatalog();
  return catalog.iconList;
}

export async function resolveLucideIcon(name) {
  const normalized = normalizeLucideKey(name);
  if (!normalized) return null;
  const catalog = await loadLucideCatalog();
  const kebab = toKebab(normalized);
  const pascal = toPascal(normalized);
  const loader =
    catalog.iconMap[normalized]
    || catalog.iconMap[kebab]
    || catalog.iconMap[pascal]
    || catalog.iconMap[normalized.toLowerCase()]
    || catalog.iconMap[kebab.toLowerCase()]
    || catalog.iconMap[pascal.toLowerCase()];
  if (typeof loader !== "function") return null;
  const mod = await loader();
  return mod?.default || null;
}
