import { useCallback, useEffect, useMemo, useState } from "react";
import { getProviderStatus } from "../api.js";
import { translateRuntime } from "../i18n/runtime.js";

export default function useWorkspaceProviderStatus(providerKeys = []) {
  const providerKeySignature = JSON.stringify(
    Array.from(new Set((Array.isArray(providerKeys) ? providerKeys : []).filter(Boolean))).sort()
  );
  const stableKeys = useMemo(() => {
    try {
      const parsed = JSON.parse(providerKeySignature);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [providerKeySignature]);
  const [providers, setProviders] = useState({});
  const [loading, setLoading] = useState(stableKeys.length > 0);
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
      setError(err?.message || translateRuntime("common.errors.provider_status_load_failed"));
    } finally {
      setLoading(false);
    }
  }, [providerKeySignature]);

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
