import React, { createContext, useCallback, useContext, useMemo, useRef, useState, useEffect } from "react";
import {
  getModules,
  peekModulesCache,
  invalidateModulesCache,
  enableModule,
  disableModule,
  deleteModule,
  getActiveWorkspaceId,
} from "../api";

const ModuleStoreContext = createContext(null);

export function ModuleStoreProvider({ user, children }) {
  const [modules, setModules] = useState(() => {
    const cached = peekModulesCache();
    return Array.isArray(cached?.modules) ? cached.modules : [];
  });
  const [loading, setLoading] = useState(() => {
    const cached = peekModulesCache();
    return Boolean(user) && !Array.isArray(cached?.modules);
  });
  const [error, setError] = useState(null);
  const [workspaceKey, setWorkspaceKey] = useState(() => getActiveWorkspaceId());
  const modulesRef = useRef(modules);

  useEffect(() => {
    modulesRef.current = modules;
  }, [modules]);

  const refresh = useCallback(
    async (opts = {}) => {
      if (!user) {
        setModules([]);
        setError(null);
        return;
      }
      const shouldShowLoading = !Array.isArray(modulesRef.current) || modulesRef.current.length === 0;
      if (shouldShowLoading) setLoading(true);
      try {
        if (opts.force) invalidateModulesCache();
        const res = await getModules();
        setModules(res.modules || []);
        setError(null);
      } catch (err) {
        setError(err.message || "Failed to load modules");
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  useEffect(() => {
    refresh();
  }, [user, refresh, workspaceKey]);

  useEffect(() => {
    function handleWorkspaceChanged() {
      setWorkspaceKey(getActiveWorkspaceId());
    }
    if (typeof window === "undefined") return undefined;
    window.addEventListener("octo:workspace-changed", handleWorkspaceChanged);
    return () => window.removeEventListener("octo:workspace-changed", handleWorkspaceChanged);
  }, []);

  const enabledById = useMemo(() => {
    const map = {};
    for (const m of modules) {
      map[m.module_id] = Boolean(m.enabled);
    }
    return map;
  }, [modules]);

  const actions = useMemo(
    () => ({
      refresh,
      enableModule,
      disableModule,
      deleteModule,
    }),
    [refresh]
  );

  const value = {
    modules,
    loading,
    error,
    enabledById,
    actions,
  };

  return <ModuleStoreContext.Provider value={value}>{children}</ModuleStoreContext.Provider>;
}

export function useModuleStore() {
  const ctx = useContext(ModuleStoreContext);
  if (!ctx) {
    throw new Error("useModuleStore must be used within ModuleStoreProvider");
  }
  return ctx;
}
