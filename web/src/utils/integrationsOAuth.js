const DEFAULT_PUBLIC_APP_ORIGIN = "https://app.octodrop.com";

function trimOrigin(value) {
  return String(value || "").replace(/\/+$/, "");
}

function resolveProviderOauthOrigin(origin, providerKey) {
  const baseOrigin = trimOrigin(origin);
  const normalizedProviderKey = String(providerKey || "").trim().toLowerCase();
  if (normalizedProviderKey === "xero") {
    return trimOrigin(
      import.meta.env.VITE_XERO_OAUTH_APP_ORIGIN ||
      import.meta.env.VITE_PUBLIC_APP_ORIGIN ||
      import.meta.env.VITE_APP_ORIGIN ||
      DEFAULT_PUBLIC_APP_ORIGIN,
    );
  }
  return baseOrigin;
}

export function buildIntegrationOauthRedirectUri(origin, providerKey, connectionId = "") {
  const baseOrigin = resolveProviderOauthOrigin(origin, providerKey);
  const normalizedProviderKey = String(providerKey || "").trim().toLowerCase();
  if (!baseOrigin) return "";
  if (normalizedProviderKey === "xero") {
    return `${baseOrigin}/integrations/oauth/xero/callback`;
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
