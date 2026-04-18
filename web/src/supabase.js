import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const realtimeFlag = (import.meta.env.VITE_SUPABASE_REALTIME || "").toLowerCase();

export const realtimeEnabled = realtimeFlag === "1" || realtimeFlag === "true" || realtimeFlag === "yes";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
const ACCESS_TOKEN_REFRESH_LEEWAY_MS = 60_000;
let refreshInFlight = null;

function authErrorMessage(errorLike) {
  return String(
    errorLike?.message ||
      errorLike?.error_description ||
      errorLike?.description ||
      errorLike?.reason?.message ||
      errorLike?.error ||
      "",
  ).toLowerCase();
}

function isInvalidRefreshTokenError(errorLike) {
  const message = authErrorMessage(errorLike);
  if (!message) return false;
  return (
    message.includes("invalid refresh token") ||
    message.includes("refresh token not found") ||
    message.includes("refresh token is invalid") ||
    message.includes("invalid grant")
  );
}

function clearStoredSupabaseSession() {
  if (typeof window === "undefined") return;
  const storages = [window.localStorage, window.sessionStorage].filter(Boolean);
  for (const storage of storages) {
    try {
      const keys = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (typeof key === "string" && /^sb-.*-auth-token$/.test(key)) {
          keys.push(key);
        }
      }
      keys.forEach((key) => storage.removeItem(key));
    } catch {
      // ignore storage cleanup failures
    }
  }
}

async function recoverInvalidRefreshToken() {
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // ignore sign-out failures and clear storage directly
  }
  clearStoredSupabaseSession();
}

function sessionExpiresSoon(session, leewayMs = ACCESS_TOKEN_REFRESH_LEEWAY_MS) {
  const expiresAt = Number(session?.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) return false;
  return expiresAt * 1000 <= Date.now() + leewayMs;
}

async function refreshSafeSession() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error) {
        if (isInvalidRefreshTokenError(error)) {
          await recoverInvalidRefreshToken();
          return null;
        }
        throw error;
      }
      return data?.session || null;
    } catch (error) {
      if (isInvalidRefreshTokenError(error)) {
        await recoverInvalidRefreshToken();
        return null;
      }
      throw error;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export async function getSafeSession(options = {}) {
  const forceRefresh = options && typeof options === "object" ? options.forceRefresh === true : false;
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      if (isInvalidRefreshTokenError(error)) {
        await recoverInvalidRefreshToken();
        return null;
      }
      throw error;
    }
    const session = data?.session || null;
    if (!session) return null;
    if (forceRefresh || sessionExpiresSoon(session)) {
      return (await refreshSafeSession()) || session;
    }
    return session;
  } catch (error) {
    if (isInvalidRefreshTokenError(error)) {
      await recoverInvalidRefreshToken();
      return null;
    }
    throw error;
  }
}
