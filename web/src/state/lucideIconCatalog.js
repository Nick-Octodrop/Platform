import { icons } from "lucide-react";

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

function normalizeIcon(Icon) {
  if (typeof Icon === "function") return Icon;
  if (Icon && typeof Icon === "object") return Icon;
  if (Icon && typeof Icon.default === "function") return Icon.default;
  return null;
}

export const LUCIDE_ICON_MAP = Object.entries(icons).reduce((acc, [name, Icon]) => {
  const normalized = normalizeIcon(Icon);
  if (!normalized) return acc;
  acc[name] = normalized;
  acc[toKebab(name)] = normalized;
  acc[toPascal(name)] = normalized;
  acc[name.toLowerCase()] = normalized;
  acc[toKebab(name).toLowerCase()] = normalized;
  acc[toPascal(name).toLowerCase()] = normalized;
  return acc;
}, {});

export const LUCIDE_ICON_LIST = Object.keys(icons).map((name) => ({ name }));

export function normalizeLucideKey(raw) {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  const idx = trimmed.indexOf("lucide:");
  if (idx === -1) return trimmed;
  return trimmed.slice(idx + 7).trim();
}

export function resolveLucideIcon(name) {
  const normalized = normalizeLucideKey(name);
  if (!normalized) return null;
  const direct = normalizeIcon(icons[normalized]) || normalizeIcon(icons[normalized.toLowerCase()]);
  if (direct) return direct;
  const kebab = toKebab(normalized);
  const pascal = toPascal(normalized);
  return LUCIDE_ICON_MAP[normalized]
    || LUCIDE_ICON_MAP[kebab]
    || LUCIDE_ICON_MAP[pascal]
    || LUCIDE_ICON_MAP[normalized.toLowerCase()]
    || LUCIDE_ICON_MAP[kebab.toLowerCase()]
    || LUCIDE_ICON_MAP[pascal.toLowerCase()]
    || null;
}
