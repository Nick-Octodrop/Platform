import * as HeroOutline24 from "@heroicons/react/24/outline";
import * as HeroSolid24 from "@heroicons/react/24/solid";
import * as HeroSolid20 from "@heroicons/react/20/solid";
import * as HeroSolid16 from "@heroicons/react/16/solid";

const DEFAULT_FAMILY = "24/outline";

export const HERO_ICON_FAMILIES = [
  { id: "24/outline", label: "Hero 24 Outline" },
  { id: "24/solid", label: "Hero 24 Solid" },
  { id: "20/solid", label: "Hero 20 Solid" },
  { id: "16/solid", label: "Hero 16 Solid" },
];

function normalizeIcon(Icon) {
  if (typeof Icon === "function") return Icon;
  if (Icon && typeof Icon === "object") return Icon;
  return null;
}

function createFamilyMap(source) {
  return Object.entries(source || {}).reduce((acc, [name, Icon]) => {
    if (!name.endsWith("Icon")) return acc;
    const base = name.slice(0, -4);
    const normalized = normalizeIcon(Icon);
    if (!normalized) return acc;
    acc[base] = normalized;
    return acc;
  }, {});
}

export const HERO_ICON_MAP_BY_FAMILY = {
  "24/outline": createFamilyMap(HeroOutline24),
  "24/solid": createFamilyMap(HeroSolid24),
  "20/solid": createFamilyMap(HeroSolid20),
  "16/solid": createFamilyMap(HeroSolid16),
};

export const HERO_ICON_LIST_BY_FAMILY = Object.fromEntries(
  Object.entries(HERO_ICON_MAP_BY_FAMILY).map(([family, familyMap]) => [
    family,
    Object.keys(familyMap).map((name) => ({ name })),
  ])
);

export function normalizeHeroFamily(raw) {
  const value = String(raw || "").trim();
  if (!value) return DEFAULT_FAMILY;
  if (HERO_ICON_MAP_BY_FAMILY[value]) return value;
  return DEFAULT_FAMILY;
}

export function normalizeHeroKey(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  const prefixed = trimmed.startsWith("hero:") ? trimmed.slice(5) : trimmed;
  if (!prefixed) return null;
  const parts = prefixed.split(":").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const family = normalizeHeroFamily(parts[0]);
    const name = parts.slice(1).join(":");
    if (!name) return null;
    return { family, name };
  }
  return { family: DEFAULT_FAMILY, name: prefixed };
}

export function heroKey(family, name) {
  const normalizedFamily = normalizeHeroFamily(family);
  const normalizedName = String(name || "").trim();
  if (!normalizedName) return "";
  return `hero:${normalizedFamily}:${normalizedName}`;
}

export function resolveHeroIcon(input, familyOverride = null) {
  const parsed = normalizeHeroKey(input);
  if (!parsed) return null;
  const family = normalizeHeroFamily(familyOverride || parsed.family);
  const name = String(parsed.name || "").trim();
  if (!name) return null;
  return HERO_ICON_MAP_BY_FAMILY[family]?.[name] || null;
}

