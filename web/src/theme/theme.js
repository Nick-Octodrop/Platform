const THEME_KEY = "octo_theme";
const BRAND_KEY = "octo_brand_colors";

function hexToOklch(hex) {
  if (!hex) return null;
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) return null;
  const r = parseInt(normalized.slice(0, 2), 16) / 255;
  const g = parseInt(normalized.slice(2, 4), 16) / 255;
  const b = parseInt(normalized.slice(4, 6), 16) / 255;
  const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const rl = toLinear(r);
  const gl = toLinear(g);
  const bl = toLinear(b);
  const lVal = 0.4122214708 * rl + 0.5363325363 * gl + 0.0514459929 * bl;
  const mVal = 0.2119034982 * rl + 0.6806995451 * gl + 0.1073969566 * bl;
  const sVal = 0.0883024619 * rl + 0.2817188376 * gl + 0.6299787005 * bl;
  const lRoot = Math.cbrt(lVal);
  const mRoot = Math.cbrt(mVal);
  const sRoot = Math.cbrt(sVal);
  const oklabL = 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot;
  const oklabA = 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot;
  const oklabB = 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot;
  const c = Math.sqrt(oklabA * oklabA + oklabB * oklabB);
  const h = (Math.atan2(oklabB, oklabA) * 180) / Math.PI;
  const hue = (h + 360) % 360;
  return { l: oklabL, c, h: hue };
}

function formatOklch({ l, c, h }) {
  const lPercent = (l * 100).toFixed(2);
  return `${lPercent}% ${c.toFixed(3)} ${h.toFixed(1)}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function deriveFocusColor(base, deltaL) {
  return {
    l: clamp(base.l + deltaL, 0, 1),
    c: base.c,
    h: base.h,
  };
}

function deriveContrast(base) {
  return base.l >= 0.7 ? { l: 0.15, c: 0, h: 0 } : { l: 0.98, c: 0, h: 0 };
}

export function getInitialTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored) return stored;
  return "dark";
}

export function getBrandColors() {
  try {
    const raw = localStorage.getItem(BRAND_KEY);
    if (!raw) return { primary: "", secondary: "", accent: "" };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return {
        primary: parsed.primary || "",
        secondary: parsed.secondary || "",
        accent: parsed.accent || "",
      };
    }
  } catch {
    // ignore
  }
  return { primary: "", secondary: "", accent: "" };
}

export function applyBrandColors(colors) {
  const rootStyle = document.documentElement.style;
  const bodyStyle = document.body?.style;
  const primary = hexToOklch(colors?.primary);
  const secondary = hexToOklch(colors?.secondary);
  const accent = hexToOklch(colors?.accent);
  const applyVar = (key, value) => {
    if (value) {
      rootStyle.setProperty(key, value);
      if (bodyStyle) bodyStyle.setProperty(key, value);
    } else {
      rootStyle.removeProperty(key);
      if (bodyStyle) bodyStyle.removeProperty(key);
    }
  };
  if (primary) {
    applyVar("--p", formatOklch(primary));
    applyVar("--pf", formatOklch(deriveFocusColor(primary, -0.08)));
    applyVar("--pc", formatOklch(deriveContrast(primary)));
  } else {
    applyVar("--p", null);
    applyVar("--pf", null);
    applyVar("--pc", null);
  }
  if (secondary) {
    applyVar("--s", formatOklch(secondary));
    applyVar("--sf", formatOklch(deriveFocusColor(secondary, -0.08)));
    applyVar("--sc", formatOklch(deriveContrast(secondary)));
  } else {
    applyVar("--s", null);
    applyVar("--sf", null);
    applyVar("--sc", null);
  }
  if (accent) {
    applyVar("--a", formatOklch(accent));
    applyVar("--af", formatOklch(deriveFocusColor(accent, -0.08)));
    applyVar("--ac", formatOklch(deriveContrast(accent)));
  } else {
    applyVar("--a", null);
    applyVar("--af", null);
    applyVar("--ac", null);
  }
}

export function setBrandColors(colors) {
  localStorage.setItem(BRAND_KEY, JSON.stringify(colors));
  applyBrandColors(colors);
}

export function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

export function setTheme(theme) {
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
}
