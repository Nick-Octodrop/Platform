import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { clearCaches, getActiveWorkspaceId, getUiPrefs } from "../api.js";
import {
  bootstrapRuntime,
  formatCurrencyRuntime,
  formatDateRuntime,
  formatDateTimeRuntime,
  formatNumberRuntime,
  formatPercentRuntime,
  formatTimeRuntime,
  getI18nRuntimeSnapshot,
  hasRuntimeTranslation,
  I18N_RUNTIME_CHANGE_EVENT,
  ensureRuntimeNamespaces,
  translateRuntime,
} from "./runtime.js";
import {
  COMMON_CURRENCIES,
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  DEFAULT_TIMEZONE,
  SUPPORTED_LOCALES,
  getTimezoneOptions,
} from "./options.js";

const CORE_NAMESPACES = ["common", "empty", "navigation", "settings", "validation"];
const I18N_BOOTSTRAP_STORAGE_KEY = "octo_i18n_bootstrap_v1";

const LocalizationContext = createContext(null);

function buildResolvedPrefs(payload) {
  const resolved = payload?.resolved || {};
  return {
    locale: resolved.locale || DEFAULT_LOCALE,
    timezone: resolved.timezone || DEFAULT_TIMEZONE,
    defaultCurrency: resolved.default_currency || DEFAULT_CURRENCY,
    workspace: payload?.workspace || {},
    user: payload?.user || {},
  };
}

function readBootstrapPrefs() {
  if (typeof window === "undefined") {
    return { prefs: buildResolvedPrefs(null), hasStored: false };
  }
  try {
    const raw = window.localStorage.getItem(I18N_BOOTSTRAP_STORAGE_KEY);
    if (!raw) return { prefs: buildResolvedPrefs(null), hasStored: false };
    const parsed = JSON.parse(raw);
    return {
      prefs: {
        locale: parsed?.locale || DEFAULT_LOCALE,
        timezone: parsed?.timezone || DEFAULT_TIMEZONE,
        defaultCurrency: parsed?.defaultCurrency || DEFAULT_CURRENCY,
        workspace: {},
        user: {},
      },
      hasStored: true,
    };
  } catch {
    return { prefs: buildResolvedPrefs(null), hasStored: false };
  }
}

function persistBootstrapPrefs(prefs) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      I18N_BOOTSTRAP_STORAGE_KEY,
      JSON.stringify({
        locale: prefs?.locale || DEFAULT_LOCALE,
        timezone: prefs?.timezone || DEFAULT_TIMEZONE,
        defaultCurrency: prefs?.defaultCurrency || DEFAULT_CURRENCY,
      }),
    );
  } catch {
    // Ignore storage failures.
  }
}

function isI18nRelevantPrefsPayload(payload) {
  if (!payload || typeof payload !== "object") return false;
  const user = payload.user;
  if (user && typeof user === "object") {
    if ("locale" in user || "timezone" in user) return true;
  }
  const workspace = payload.workspace;
  if (workspace && typeof workspace === "object") {
    if ("default_locale" in workspace || "default_timezone" in workspace || "default_currency" in workspace) {
      return true;
    }
  }
  return false;
}

export function LocalizationProvider({ children, user }) {
  const initialBootstrap = readBootstrapPrefs();
  const [prefs, setPrefs] = useState(() => initialBootstrap.prefs);
  const [loading, setLoading] = useState(() => Boolean(user) && !initialBootstrap.hasStored);
  const [version, setVersion] = useState(() => bootstrapRuntime({ ...initialBootstrap.prefs, namespaces: CORE_NAMESPACES }).version);
  const [workspaceKey, setWorkspaceKey] = useState(() => getActiveWorkspaceId());

  const applyPrefs = useCallback(async (payload) => {
    const nextPrefs = buildResolvedPrefs(payload);
    persistBootstrapPrefs(nextPrefs);
    const bootstrapSnapshot = bootstrapRuntime({ ...nextPrefs, namespaces: CORE_NAMESPACES });
    setPrefs({
      ...nextPrefs,
      workspace: payload?.workspace || {},
      user: payload?.user || {},
    });
    setVersion(bootstrapSnapshot.version);
    await ensureRuntimeNamespaces(CORE_NAMESPACES, nextPrefs.locale);
    clearCaches();
    setPrefs({
      ...nextPrefs,
      workspace: payload?.workspace || {},
      user: payload?.user || {},
    });
    setVersion(getI18nRuntimeSnapshot().version);
    return nextPrefs;
  }, []);

  const reload = useCallback(async (payloadOverride = null) => {
    const fallbackPrefs = buildResolvedPrefs(null);
    if (!user) {
      persistBootstrapPrefs(fallbackPrefs);
      const bootstrapSnapshot = bootstrapRuntime({ ...fallbackPrefs, namespaces: CORE_NAMESPACES });
      setPrefs(fallbackPrefs);
      setVersion(bootstrapSnapshot.version);
      await ensureRuntimeNamespaces(CORE_NAMESPACES, fallbackPrefs.locale);
      clearCaches();
      setPrefs(fallbackPrefs);
      setVersion(getI18nRuntimeSnapshot().version);
      setLoading(false);
      return fallbackPrefs;
    }
    setLoading(true);
    try {
      const payload = payloadOverride && typeof payloadOverride === "object" ? payloadOverride : await getUiPrefs();
      return await applyPrefs(payload);
    } catch (error) {
      const bootstrapSnapshot = bootstrapRuntime({ ...fallbackPrefs, namespaces: CORE_NAMESPACES });
      setPrefs(fallbackPrefs);
      setVersion(bootstrapSnapshot.version);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [applyPrefs, user]);

  useEffect(() => {
    reload().catch(() => {
      setLoading(false);
    });
  }, [reload, workspaceKey]);

  useEffect(() => {
    function handleWorkspaceChanged() {
      setWorkspaceKey(getActiveWorkspaceId());
    }
    if (typeof window === "undefined") return undefined;
    window.addEventListener("octo:workspace-changed", handleWorkspaceChanged);
    return () => window.removeEventListener("octo:workspace-changed", handleWorkspaceChanged);
  }, []);

  useEffect(() => {
    function handleUiPrefsUpdated(event) {
      const payload = event?.detail?.payload;
      const response = event?.detail?.response;
      if (!isI18nRelevantPrefsPayload(payload)) return;
      reload(response && typeof response === "object" ? response : null).catch(() => {
        // Ignore transient reload failures; next explicit reload or refresh will recover.
      });
    }
    if (typeof window === "undefined") return undefined;
    window.addEventListener("octo:ui-prefs-updated", handleUiPrefsUpdated);
    return () => window.removeEventListener("octo:ui-prefs-updated", handleUiPrefsUpdated);
  }, [reload]);

  useEffect(() => {
    function handleRuntimeChanged() {
      setVersion(getI18nRuntimeSnapshot().version);
    }
    if (typeof window === "undefined") return undefined;
    window.addEventListener(I18N_RUNTIME_CHANGE_EVENT, handleRuntimeChanged);
    return () => window.removeEventListener(I18N_RUNTIME_CHANGE_EVENT, handleRuntimeChanged);
  }, []);

  const value = useMemo(
    () => ({
      locale: prefs.locale,
      timezone: prefs.timezone,
      defaultCurrency: prefs.defaultCurrency,
      workspaceKey,
      workspacePrefs: prefs.workspace,
      userPrefs: prefs.user,
      loading,
      version,
      availableLocales: SUPPORTED_LOCALES,
      availableTimezones: getTimezoneOptions(),
      availableCurrencies: COMMON_CURRENCIES,
      reload,
      t: (key, values, options) => translateRuntime(key, values, options),
      hasTranslation: (key) => hasRuntimeTranslation(key),
      formatDate: (value, options) => formatDateRuntime(value, options),
      formatTime: (value, options) => formatTimeRuntime(value, options),
      formatDateTime: (value, options) => formatDateTimeRuntime(value, options),
      formatNumber: (value, options) => formatNumberRuntime(value, options),
      formatPercent: (value, options) => formatPercentRuntime(value, options),
      formatCurrency: (value, currencyCode, options) => formatCurrencyRuntime(value, currencyCode, options),
    }),
    [loading, prefs, reload, version, workspaceKey],
  );

  return <LocalizationContext.Provider value={value}>{children}</LocalizationContext.Provider>;
}

export function useI18n() {
  const value = useContext(LocalizationContext);
  if (!value) {
    return {
      locale: DEFAULT_LOCALE,
      timezone: DEFAULT_TIMEZONE,
      defaultCurrency: DEFAULT_CURRENCY,
      workspaceKey: getActiveWorkspaceId(),
      workspacePrefs: {},
      userPrefs: {},
      loading: false,
      version: getI18nRuntimeSnapshot().version,
      availableLocales: SUPPORTED_LOCALES,
      availableTimezones: getTimezoneOptions(),
      availableCurrencies: COMMON_CURRENCIES,
      reload: async () => buildResolvedPrefs(null),
      t: (key, values, options) => translateRuntime(key, values, options),
      hasTranslation: (key) => hasRuntimeTranslation(key),
      formatDate: (value, options) => formatDateRuntime(value, options),
      formatTime: (value, options) => formatTimeRuntime(value, options),
      formatDateTime: (value, options) => formatDateTimeRuntime(value, options),
      formatNumber: (value, options) => formatNumberRuntime(value, options),
      formatPercent: (value, options) => formatPercentRuntime(value, options),
      formatCurrency: (value, currencyCode, options) => formatCurrencyRuntime(value, currencyCode, options),
    };
  }
  return value;
}
