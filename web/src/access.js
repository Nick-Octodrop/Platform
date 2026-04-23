import { createContext, createElement, useContext, useEffect, useMemo, useState } from "react";
import { apiFetch, getActiveWorkspaceId, setActiveWorkspaceId } from "./api";
import { translateRuntime } from "./i18n/runtime.js";

const CAPABILITIES_BY_ROLE = {
  admin: new Set([
    "workspace.manage_members",
    "workspace.manage_settings",
    "modules.manage",
    "templates.manage",
    "automations.manage",
    "records.read",
    "records.write",
  ]),
  member: new Set(["records.read", "records.write"]),
  readonly: new Set(["records.read"]),
  portal: new Set(["records.read", "records.write"]),
};

function actorHasCapability(actor, capability) {
  if (!actor || !capability) return false;
  if (actor.platform_role === "superadmin") return true;
  const role = actor.workspace_role || actor.role || "member";
  return CAPABILITIES_BY_ROLE[role]?.has(capability) || false;
}

function capabilityKey(capability) {
  return capability.replaceAll(".", "_");
}

const AccessContextState = createContext(null);

export function hasCapability(accessContext, capability) {
  if (!capability) return true;
  const permissions = accessContext?.permissions;
  const key = capabilityKey(capability);
  if (permissions && Object.prototype.hasOwnProperty.call(permissions, key)) {
    return Boolean(permissions[key]);
  }
  return actorHasCapability(accessContext?.actor, capability);
}

export async function getAccessContext() {
  return apiFetch("/access/context", { cacheTtl: 10000, cacheKey: "access_context" });
}

function buildAccessValue(context, loading, error) {
  const actor = context?.actor || null;
  const permissions = context?.permissions || {};
  return {
    loading,
    error,
    context,
    actor,
    permissions,
    hasCapability: (capability) => hasCapability(context, capability),
    isSuperadmin: actor?.platform_role === "superadmin",
  };
}

export function AccessContextProvider({ children }) {
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [workspaceKey, setWorkspaceKey] = useState(() => getActiveWorkspaceId());

  useEffect(() => {
    function handleWorkspaceChanged() {
      setWorkspaceKey(getActiveWorkspaceId());
    }
    if (typeof window === "undefined") return undefined;
    window.addEventListener("octo:workspace-changed", handleWorkspaceChanged);
    return () => window.removeEventListener("octo:workspace-changed", handleWorkspaceChanged);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading((prev) => (context ? prev : true));
      setError("");
      try {
        const res = await getAccessContext();
        if (!alive) return;
        setContext(res || null);
        if (!getActiveWorkspaceId()) {
          const defaultWorkspaceId =
            res?.actor?.workspace_id ||
            res?.workspaces?.[0]?.workspace_id ||
            res?.workspaces?.[0]?.id ||
            "";
          if (defaultWorkspaceId) {
            setActiveWorkspaceId(defaultWorkspaceId);
          }
        }
      } catch (err) {
        if (!alive) return;
        setError(err?.message || translateRuntime("common.errors.access_context_load_failed"));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [workspaceKey]);

  const value = useMemo(() => buildAccessValue(context, loading, error), [context, loading, error]);

  return createElement(AccessContextState.Provider, { value }, children);
}

export function useAccessContext() {
  const ctx = useContext(AccessContextState);
  if (ctx) return ctx;
  return buildAccessValue(null, true, "");
}
