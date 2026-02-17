import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "./api";

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

export function hasCapability(accessContext, capability) {
  if (!capability) return true;
  const permissions = accessContext?.permissions;
  const key = capabilityKey(capability);
  if (permissions && Object.prototype.hasOwnProperty.call(permissions, key)) {
    return Boolean(permissions[key]);
  }
  return actorHasCapability(accessContext?.actor, capability);
}

export function useAccessContext() {
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await apiFetch("/access/context", { cacheTtl: 10000, cacheKey: "access_context" });
        if (!alive) return;
        setContext(res || null);
      } catch (err) {
        if (!alive) return;
        setError(err?.message || "Failed to load access context");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const actor = context?.actor || null;
  const permissions = context?.permissions || {};

  return useMemo(
    () => ({
      loading,
      error,
      context,
      actor,
      permissions,
      hasCapability: (capability) => hasCapability(context, capability),
      isSuperadmin: actor?.platform_role === "superadmin",
    }),
    [loading, error, context, actor, permissions]
  );
}
