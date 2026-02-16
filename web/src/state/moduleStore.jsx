import React, { createContext, useCallback, useContext, useMemo, useState, useEffect } from "react";
import {
  getModules,
  invalidateModulesCache,
  enableModule,
  disableModule,
  deleteModule,
} from "../api";

const ModuleStoreContext = createContext(null);

export function ModuleStoreProvider({ user, children }) {
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(
    async (opts = {}) => {
      if (!user) {
        setModules([]);
        setError(null);
        return;
      }
      setLoading(true);
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
    refresh({ force: true });
  }, [user, refresh]);

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
