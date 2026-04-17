const DEFAULT_PUBLIC_APP_ORIGIN = "https://app.octodrop.com";
const DEFAULT_PUBLIC_API_ORIGIN = "https://octodrop-platform-api.fly.dev";

function trimOrigin(value) {
  return String(value || "").replace(/\/+$/, "");
}

function resolveProviderOauthOrigin(origin, providerKey) {
  const baseOrigin = trimOrigin(origin);
  const normalizedProviderKey = String(providerKey || "").trim().toLowerCase();
  if (normalizedProviderKey === "xero" || normalizedProviderKey === "shopify") {
    const explicitRedirectUri = trimOrigin(
      normalizedProviderKey === "xero"
        ? (import.meta.env.VITE_XERO_OAUTH_REDIRECT_URI || "")
        : (import.meta.env.VITE_SHOPIFY_OAUTH_REDIRECT_URI || ""),
    );
    if (explicitRedirectUri) {
      return explicitRedirectUri.replace(/\/integrations\/oauth\/[a-z0-9_-]+\/callback$/i, "");
    }
    const configuredApiUrl = trimOrigin(import.meta.env.VITE_API_URL || "");
    if (/^https?:\/\//i.test(configuredApiUrl) && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configuredApiUrl)) {
      return configuredApiUrl;
    }
    return trimOrigin(import.meta.env.VITE_PUBLIC_API_ORIGIN || DEFAULT_PUBLIC_API_ORIGIN);
  }
  return baseOrigin;
}

export function buildIntegrationOauthRedirectUri(origin, providerKey, connectionId = "") {
  const baseOrigin = resolveProviderOauthOrigin(origin, providerKey);
  const normalizedProviderKey = String(providerKey || "").trim().toLowerCase();
  if (!baseOrigin) return "";
  if (normalizedProviderKey === "xero" || normalizedProviderKey === "shopify") {
    return `${baseOrigin}/integrations/oauth/${normalizedProviderKey}/callback`;
  }
  if (connectionId) {
    return `${baseOrigin}/integrations/connections/${connectionId}`;
  }
  return `${baseOrigin}/integrations/oauth/${normalizedProviderKey || "callback"}/callback`;
}

export function encodeIntegrationOauthState(payload) {
  try {
    return window.btoa(JSON.stringify(payload || {}));
  } catch {
    return "";
  }
}

export function decodeIntegrationOauthState(state) {
  const raw = String(state || "").trim();
  if (!raw) return {};
  try {
    const jsonText = window.atob(raw);
    const parsed = JSON.parse(jsonText);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
