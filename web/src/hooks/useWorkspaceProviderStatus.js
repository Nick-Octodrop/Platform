import { useCallback, useEffect, useMemo, useState } from "react";
import { getProviderStatus } from "../api.js";

export default function useWorkspaceProviderStatus(providerKeys = []) {
  const stableKeys = useMemo(
    () => Array.from(new Set((Array.isArray(providerKeys) ? providerKeys : []).filter(Boolean))).sort(),
    [providerKeys]
  );
  const [providers, setProviders] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (stableKeys.length === 0) {
      setProviders({});
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await getProviderStatus(stableKeys);
      setProviders(res?.providers && typeof res.providers === "object" ? res.providers : {});
    } catch (err) {
      setProviders({});
      setError(err?.message || "Failed to load provider status");
    } finally {
      setLoading(false);
    }
  }, [stableKeys]);

  useEffect(() => {
    load();
  }, [load]);

  return {
    providers,
    loading,
    error,
    reload: load,
  };
}
