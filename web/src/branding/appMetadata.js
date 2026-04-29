const DEFAULT_APP_NAME = "Octodrop Platform";
const DEFAULT_SHORT_NAME = "Octodrop";
const DEFAULT_THEME_COLOR = "#111827";
const STATIC_ICON_URL = "/icons/icon.svg";
const STATIC_MASKABLE_ICON_URL = "/icons/maskable-icon.svg";

let currentManifestObjectUrl = "";

function cleanText(value) {
  return String(value || "").trim();
}

function firstUrl(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return "";
}

function ensureMeta(selector, create) {
  if (typeof document === "undefined") return null;
  const existing = document.head.querySelector(selector);
  if (existing) return existing;
  const next = create();
  document.head.appendChild(next);
  return next;
}

function setMetaContent(name, content) {
  const node = ensureMeta(`meta[name="${name}"]`, () => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", name);
    return meta;
  });
  if (node) node.setAttribute("content", content);
}

function setLinkHref(rel, href, attrs = {}) {
  const node = ensureMeta(`link[rel="${rel}"]`, () => {
    const link = document.createElement("link");
    link.setAttribute("rel", rel);
    return link;
  });
  if (!node) return;
  node.setAttribute("href", href);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "") {
      node.removeAttribute(key);
      return;
    }
    node.setAttribute(key, String(value));
  });
}

function iconTypeForUrl(url) {
  const value = cleanText(url).toLowerCase().split("?")[0];
  if (value.endsWith(".svg")) return "image/svg+xml";
  if (value.endsWith(".webp")) return "image/webp";
  if (value.endsWith(".jpg") || value.endsWith(".jpeg")) return "image/jpeg";
  if (value.endsWith(".ico")) return "image/x-icon";
  return "image/png";
}

function createWorkspaceManifest({ appName, shortName, themeColor, pwaIconUrl, appIconUrl }) {
  const iconUrl = firstUrl(pwaIconUrl, appIconUrl, STATIC_ICON_URL);
  const maskableIconUrl = firstUrl(pwaIconUrl, appIconUrl, STATIC_MASKABLE_ICON_URL);
  const iconType = iconTypeForUrl(iconUrl);
  const maskableIconType = iconTypeForUrl(maskableIconUrl);
  return {
    id: "/",
    name: appName || DEFAULT_APP_NAME,
    short_name: shortName || DEFAULT_SHORT_NAME,
    description: `${appName || DEFAULT_APP_NAME} workspace platform for mobile and desktop.`,
    categories: ["business", "productivity", "utilities"],
    theme_color: themeColor || DEFAULT_THEME_COLOR,
    background_color: themeColor || DEFAULT_THEME_COLOR,
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone", "browser"],
    start_url: "/home",
    scope: "/",
    prefer_related_applications: false,
    launch_handler: {
      client_mode: ["focus-existing", "auto"],
    },
    icons: [
      {
        src: iconUrl,
        sizes: iconType === "image/svg+xml" ? "any" : "512x512",
        type: iconType,
        purpose: "any",
      },
      {
        src: maskableIconUrl,
        sizes: maskableIconType === "image/svg+xml" ? "any" : "512x512",
        type: maskableIconType,
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Home",
        short_name: "Home",
        description: `Open ${appName || DEFAULT_SHORT_NAME}.`,
        url: "/home",
        icons: [{ src: iconUrl, sizes: iconType === "image/svg+xml" ? "any" : "512x512", type: iconType }],
      },
      {
        name: "Apps",
        short_name: "Apps",
        description: "Browse installed workspace apps.",
        url: "/apps",
        icons: [{ src: iconUrl, sizes: iconType === "image/svg+xml" ? "any" : "512x512", type: iconType }],
      },
    ],
  };
}

function setRuntimeManifest(manifest) {
  if (typeof document === "undefined" || typeof URL === "undefined" || typeof Blob === "undefined") return;
  const blob = new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" });
  const nextUrl = URL.createObjectURL(blob);
  const previousUrl = currentManifestObjectUrl;
  currentManifestObjectUrl = nextUrl;
  setLinkHref("manifest", nextUrl);
  if (previousUrl) {
    window.setTimeout(() => URL.revokeObjectURL(previousUrl), 30000);
  }
}

export function applyWorkspaceAppMetadata(workspacePrefs = {}) {
  if (typeof document === "undefined") return;
  const workspaceName = cleanText(workspacePrefs.workspace_name || workspacePrefs.name || workspacePrefs.title);
  const appName = workspaceName || DEFAULT_APP_NAME;
  const shortName = workspaceName || DEFAULT_SHORT_NAME;
  const themeColor = cleanText(workspacePrefs.primary_color || workspacePrefs.colors?.primary) || DEFAULT_THEME_COLOR;
  const faviconUrl = firstUrl(
    workspacePrefs.favicon_url,
    workspacePrefs.app_icon_url,
    workspacePrefs.pwa_icon_url,
    workspacePrefs.logo_url,
    STATIC_ICON_URL,
  );
  const pwaIconUrl = firstUrl(
    workspacePrefs.pwa_icon_url,
    workspacePrefs.app_icon_url,
    workspacePrefs.favicon_url,
    workspacePrefs.logo_url,
    STATIC_ICON_URL,
  );
  const appIconUrl = firstUrl(workspacePrefs.app_icon_url, faviconUrl, pwaIconUrl, STATIC_ICON_URL);

  document.title = appName === DEFAULT_APP_NAME ? DEFAULT_APP_NAME : `${appName} | Octodrop`;
  setMetaContent("theme-color", themeColor);
  setMetaContent("apple-mobile-web-app-title", shortName);
  setLinkHref("icon", faviconUrl, { type: iconTypeForUrl(faviconUrl) });
  setLinkHref("shortcut icon", faviconUrl, { type: iconTypeForUrl(faviconUrl) });
  setLinkHref("apple-touch-icon", appIconUrl || pwaIconUrl || faviconUrl);
  setRuntimeManifest(createWorkspaceManifest({ appName, shortName, themeColor, pwaIconUrl, appIconUrl }));
}
