import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const realtimeFlag = (import.meta.env.VITE_SUPABASE_REALTIME || "").toLowerCase();

export const realtimeEnabled = realtimeFlag === "1" || realtimeFlag === "true" || realtimeFlag === "yes";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

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

export async function getSafeSession() {
  try {
    const { data, error } = await supabase.auth.getSession();
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
  }
}
