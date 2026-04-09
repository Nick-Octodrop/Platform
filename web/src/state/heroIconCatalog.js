const DEFAULT_FAMILY = "24/outline";

export const HERO_ICON_FAMILIES = [
  { id: "24/outline", label: "Hero 24 Outline" },
  { id: "24/solid", label: "Hero 24 Solid" },
  { id: "20/solid", label: "Hero 20 Solid" },
  { id: "16/solid", label: "Hero 16 Solid" },
];

const familyCatalogPromises = new Map();

function normalizeIcon(Icon) {
  if (typeof Icon === "function") return Icon;
  if (Icon && typeof Icon === "object") return Icon;
  if (Icon && typeof Icon.default === "function") return Icon.default;
  return null;
}

function createFamilyCatalog(source) {
  const familyMap = Object.entries(source || {}).reduce((acc, [name, Icon]) => {
    if (!name.endsWith("Icon")) return acc;
    const base = name.slice(0, -4);
    const normalized = normalizeIcon(Icon);
    if (!normalized) return acc;
    acc[base] = normalized;
    return acc;
  }, {});
  return {
    familyMap,
    iconList: Object.keys(familyMap).map((name) => ({ name })),
  };
}

async function importHeroFamily(family) {
  switch (family) {
    case "24/solid":
      return import("@heroicons/react/24/solid");
    case "20/solid":
      return import("@heroicons/react/20/solid");
    case "16/solid":
      return import("@heroicons/react/16/solid");
    case "24/outline":
    default:
      return import("@heroicons/react/24/outline");
  }
}

async function loadHeroFamilyCatalog(family) {
  const normalizedFamily = normalizeHeroFamily(family);
  if (!familyCatalogPromises.has(normalizedFamily)) {
    familyCatalogPromises.set(
      normalizedFamily,
      importHeroFamily(normalizedFamily).then((mod) => createFamilyCatalog(mod))
    );
  }
  return familyCatalogPromises.get(normalizedFamily);
}

export function normalizeHeroFamily(raw) {
  const value = String(raw || "").trim();
  if (!value) return DEFAULT_FAMILY;
  return HERO_ICON_FAMILIES.some((family) => family.id === value) ? value : DEFAULT_FAMILY;
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

export async function loadHeroIconList(family) {
  const catalog = await loadHeroFamilyCatalog(family);
  return catalog.iconList;
}

export async function resolveHeroIcon(input, familyOverride = null) {
  const parsed = normalizeHeroKey(input);
  if (!parsed) return null;
  const family = normalizeHeroFamily(familyOverride || parsed.family);
  const name = String(parsed.name || "").trim();
  if (!name) return null;
  const catalog = await loadHeroFamilyCatalog(family);
  return catalog.familyMap[name] || null;
}
