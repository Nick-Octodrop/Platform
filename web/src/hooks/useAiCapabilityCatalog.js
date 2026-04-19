import { useCallback, useEffect, useState } from "react";
import { getAiCapabilities } from "../api.js";

export default function useAiCapabilityCatalog() {
  const [capabilities, setCapabilities] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await getAiCapabilities();
      setCapabilities(res?.capabilities && typeof res.capabilities === "object" ? res.capabilities : null);
    } catch (err) {
      setCapabilities(null);
      setError(err?.message || "Failed to load AI capabilities.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return {
    capabilities,
    loading,
    error,
    reload: load,
  };
}
