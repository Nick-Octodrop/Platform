import React, { Suspense, lazy, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { supabase } from "./supabase";
import ProtectedRoute from "./auth/ProtectedRoute.jsx";
import CapabilityRoute from "./auth/CapabilityRoute.jsx";
import SuperadminRoute from "./auth/SuperadminRoute.jsx";
import ShellLayout from "./layout/ShellLayout.jsx";
import { ModuleStoreProvider } from "./state/moduleStore.jsx";
import { ToastProvider } from "./components/Toast.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { AccessContextProvider, getAccessContext } from "./access.js";
import { LocalizationProvider, useI18n } from "./i18n/LocalizationProvider.jsx";
import {
  applyBrandColors,
  applyUiDensity,
  DEFAULT_BRAND_COLORS,
  getInitialUiDensity,
  getInitialTheme,
  setBrandColors,
  setTheme,
} from "./theme/theme.js";
import { apiFetch, getActiveWorkspaceId, getUiPrefs, setActiveWorkspaceId } from "./api.js";
import LoginPage from "./pages/LoginPage.jsx";
import HomePage from "./pages/HomePage.jsx";
import AppShell from "./apps/AppShell.jsx";
import AuthSetPasswordPage from "./pages/AuthSetPasswordPage.jsx";
import LoadingSpinner from "./components/LoadingSpinner.jsx";

const AppsPage = lazy(() => import("./pages/AppsPage.jsx"));
const ModuleDetailPage = lazy(() => import("./pages/ModuleDetailPage.jsx"));
const Studio2Page = lazy(() => import("./pages/Studio2Page.jsx"));
const StudioModulePreviewFramePage = lazy(() => import("./pages/studio/StudioModulePreviewFramePage.jsx"));
const AuditPage = lazy(() => import("./pages/AuditPage.jsx"));
const SettingsPage = lazy(() => import("./pages/SettingsPage.jsx"));
const SettingsSettingsPage = lazy(() => import("./pages/SettingsSettingsPage.jsx"));
const SettingsPasswordPage = lazy(() => import("./pages/SettingsPasswordPage.jsx"));
const SettingsUsersPage = lazy(() => import("./pages/SettingsUsersPage.jsx"));
const SettingsAccessPoliciesPage = lazy(() => import("./pages/SettingsAccessPoliciesPage.jsx"));
const SettingsAccessPolicyDetailPage = lazy(() => import("./pages/SettingsAccessPolicyDetailPage.jsx"));
const SettingsWorkspacesPage = lazy(() => import("./pages/SettingsWorkspacesPage.jsx"));
const SettingsSecretsPage = lazy(() => import("./pages/SettingsSecretsPage.jsx"));
const SettingsDocumentNumberingPage = lazy(() => import("./pages/SettingsDocumentNumberingPage.jsx"));
const SettingsDocumentNumberingDetailPage = lazy(() => import("./pages/SettingsDocumentNumberingDetailPage.jsx"));
const SettingsApiCredentialsPage = lazy(() => import("./pages/SettingsApiCredentialsPage.jsx"));
const SettingsApiCredentialDetailPage = lazy(() => import("./pages/SettingsApiCredentialDetailPage.jsx"));
const SettingsWebhookSubscriptionsPage = lazy(() => import("./pages/SettingsWebhookSubscriptionsPage.jsx"));
const SettingsWebhookSubscriptionDetailPage = lazy(() => import("./pages/SettingsWebhookSubscriptionDetailPage.jsx"));
const DiagnosticsPage = lazy(() => import("./pages/DiagnosticsPage.jsx"));
const DiagnosticsModulePage = lazy(() => import("./pages/DiagnosticsModulePage.jsx"));
const DataExplorerPage = lazy(() => import("./pages/DataExplorerPage.jsx"));
const OpsPage = lazy(() => import("./pages/OpsPage.jsx"));
const OpsJobPage = lazy(() => import("./pages/OpsJobPage.jsx"));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage.jsx"));
const IntegrationsPage = lazy(() => import("./pages/IntegrationsPage.jsx"));
const IntegrationConnectionPage = lazy(() => import("./pages/IntegrationConnectionPage.jsx"));
const EmailHomePage = lazy(() => import("./pages/EmailHomePage.jsx"));
const EmailConnectionsPage = lazy(() => import("./pages/EmailConnectionsPage.jsx"));
const EmailConnectionDetailPage = lazy(() => import("./pages/EmailConnectionDetailPage.jsx"));
const EmailTemplatesPage = lazy(() => import("./pages/EmailTemplatesPage.jsx"));
const EmailOutboxPage = lazy(() => import("./pages/EmailOutboxPage.jsx"));
const EmailOutboxItemPage = lazy(() => import("./pages/EmailOutboxItemPage.jsx"));
const EmailTemplateStudioPage = lazy(() => import("./pages/email/EmailTemplateStudioPage.jsx"));
const DocumentsHomePage = lazy(() => import("./pages/DocumentsHomePage.jsx"));
const DocumentsPage = lazy(() => import("./pages/DocumentsPage.jsx"));
const DocumentTemplateStudioPage = lazy(() => import("./pages/documents/DocumentTemplateStudioPage.jsx"));
const AutomationsPage = lazy(() => import("./pages/AutomationsPage.jsx"));
const AutomationEditorPage = lazy(() => import("./pages/AutomationEditorPage.jsx"));
const AutomationRunsPage = lazy(() => import("./pages/AutomationRunsPage.jsx"));
const AutomationRunDetailPage = lazy(() => import("./pages/AutomationRunDetailPage.jsx"));
const EntityCreatePage = lazy(() => import("./pages/EntityCreatePage.jsx"));
const EntityRecordPage = lazy(() => import("./pages/EntityRecordPage.jsx"));
const OctoAiSessionsPage = lazy(() => import("./pages/OctoAiSessionsPage.jsx"));
const OctoAiSessionDetailPage = lazy(() => import("./pages/OctoAiSessionDetailPage.jsx"));
const OctoAiWorkspacePage = lazy(() => import("./pages/OctoAiWorkspacePage.jsx"));
const SecurityCenterPage = lazy(() => import("./pages/SecurityCenterPage.jsx"));
const ExternalApiDocsPage = lazy(() => import("./pages/ExternalApiDocsPage.jsx").then((m) => ({ default: m.default })));
const ExternalApiDocsRedirectPage = lazy(() => import("./pages/ExternalApiDocsPage.jsx").then((m) => ({ default: m.ExternalApiDocsRedirectPage })));

function RouteLoadingScreen() {
  return (
    <div className="flex h-full min-h-0 w-full bg-base-200">
      <LoadingSpinner className="flex-1 min-h-0 w-full" />
    </div>
  );
}

function getPwaSurfaceState() {
  if (typeof window === "undefined") {
    return { isStandalone: false, isMobileBrowser: false, isMobileDevice: false, isIos: false, isSafari: false };
  }
  const displayStandalone = window.matchMedia?.("(display-mode: standalone)")?.matches;
  const navigatorStandalone = typeof window.navigator?.standalone === "boolean" && window.navigator.standalone;
  const isStandalone = Boolean(displayStandalone || navigatorStandalone);
  const ua = window.navigator?.userAgent || "";
  const isIos = /iPad|iPhone|iPod/.test(ua);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  const coarsePointer = Boolean(window.matchMedia?.("(hover: none) and (pointer: coarse)")?.matches);
  const isMobileDevice = Boolean(coarsePointer || /Android|iPhone|iPad|iPod/i.test(ua));
  const isMobileBrowser = Boolean(
    !isStandalone &&
      isMobileDevice
  );
  return { isStandalone, isMobileBrowser, isMobileDevice, isIos, isSafari };
}

function shouldAutoApplyPwaUpdate(_surface = getPwaSurfaceState()) {
  return false;
}

const CURRENT_BUILD_ID = typeof __OCTO_BUILD_ID__ === "undefined" ? "dev" : String(__OCTO_BUILD_ID__);

async function fetchLatestBuildMeta() {
  if (typeof window === "undefined") return null;
  const url = new URL("/build-meta.json", window.location.origin);
  url.searchParams.set("__octo_ts__", String(Date.now()));
  const res = await fetch(url.toString(), {
    cache: "no-store",
    headers: {
      "cache-control": "no-cache, no-store, max-age=0",
      pragma: "no-cache",
    },
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  if (!data || typeof data !== "object") return null;
  const buildId = typeof data.buildId === "string" ? data.buildId.trim() : "";
  if (!buildId) return null;
  return {
    buildId,
    builtAt: typeof data.builtAt === "string" ? data.builtAt : null,
  };
}

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [workspaceKey, setWorkspaceKey] = useState(() => getActiveWorkspaceId());
  const [accessContextSeed, setAccessContextSeed] = useState(null);
  const [updatePromptVisible, setUpdatePromptVisible] = useState(false);
  const [installPromptVisible, setInstallPromptVisible] = useState(false);
  const [installPromptEvent, setInstallPromptEvent] = useState(null);
  const [installMode, setInstallMode] = useState("browser");

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session || null);
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession || null);
      setLoading(false);
    });
    return () => {
      mounted = false;
      listener?.subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    applyUiDensity(getInitialUiDensity());
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const media = window.matchMedia("(max-width: 639px)");
    const handleChange = () => applyUiDensity(getInitialUiDensity());
    media.addEventListener?.("change", handleChange);
    return () => media.removeEventListener?.("change", handleChange);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return undefined;
    const mobileLike = window.matchMedia("(hover: none), (pointer: coarse)");
    if (!mobileLike.matches) return undefined;

    const openClass = "dropdown-open";
    const closeAll = (except = null) => {
      document.querySelectorAll(`.dropdown.${openClass}`).forEach((node) => {
        if (node !== except) node.classList.remove(openClass);
      });
    };

    function onDocumentClick(event) {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const dropdown = target.closest(".dropdown");
      const insideContent = !!target.closest(".dropdown-content");
      const trigger = target.closest("button, label, summary, [role='button']");

      if (!dropdown) {
        closeAll();
        return;
      }

      if (insideContent) {
        closeAll();
        return;
      }

      const triggerInsideDropdown = !!(trigger && dropdown.contains(trigger));
      if (!triggerInsideDropdown) {
        closeAll();
        return;
      }

      const isOpen = dropdown.classList.contains(openClass);
      closeAll(dropdown);
      if (isOpen) {
        dropdown.classList.remove(openClass);
      } else {
        dropdown.classList.add(openClass);
      }
    }

    function onEsc(event) {
      if (event.key === "Escape") closeAll();
    }

    document.addEventListener("click", onDocumentClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("click", onDocumentClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!session?.user) return;
      try {
        const res = await getUiPrefs();
        if (!mounted) return;
        const workspace = res?.workspace || {};
        const userPrefs = res?.user || {};
        const nextBrandColors = workspace?.colors ? { ...DEFAULT_BRAND_COLORS, ...workspace.colors } : DEFAULT_BRAND_COLORS;
        setBrandColors(nextBrandColors);
        applyBrandColors(nextBrandColors);
        const nextTheme = userPrefs?.theme || workspace?.theme || getInitialTheme();
        if (nextTheme) {
          setTheme(nextTheme);
        }
        applyUiDensity(getInitialUiDensity());
      } catch {
        // ignore
      }
    })();
    return () => {
      mounted = false;
    };
  }, [session?.user, workspaceKey]);

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
    if (!session?.user) return undefined;
    (async () => {
      try {
        const res = await getAccessContext();
        if (!alive) return;
        setAccessContextSeed(res || null);
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
      } catch {
        // ignore; workspace can still be selected manually
      }
    })();
    return () => {
      alive = false;
    };
  }, [session?.user, workspaceKey]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    if (!window.__octoPwaEnabled) return undefined;
    let alive = true;

    async function getActiveRegistration() {
      const activeRegistration = window.__octoWebSwRegistration;
      if (activeRegistration) return activeRegistration;
      if (!("serviceWorker" in navigator)) return null;
      const registrations = await navigator.serviceWorker.getRegistrations();
      const registration =
        registrations.find((item) => item?.waiting) ||
        registrations.find((item) => item?.installing) ||
        registrations[0] ||
        null;
      if (registration) {
        window.__octoWebSwRegistration = registration;
      }
      return registration;
    }

    async function applyUpdateOrPrompt() {
      if (!alive) return;
      const surface = getPwaSurfaceState();
      if (shouldAutoApplyPwaUpdate(surface)) {
        const applyUpdate = window.__octoWebApplyUpdate;
        if (typeof applyUpdate === "function") {
          try {
            await applyUpdate(true);
            return;
          } catch {
            // fall through to manual prompt
          }
        }
      }
      setUpdatePromptVisible(true);
    }

    async function refreshBuildMetaAvailability() {
      try {
        const latest = await fetchLatestBuildMeta();
        if (!alive || !latest) return;
        if (latest.buildId !== CURRENT_BUILD_ID) {
          window.__octoWebUpdateReady = true;
          window.__octoLatestBuildId = latest.buildId;
          await applyUpdateOrPrompt();
        }
      } catch {
        // ignore transient build-meta fetch failures
      }
    }

    async function refreshUpdateAvailability() {
      if (!("serviceWorker" in navigator)) return;
      try {
        const registration = await getActiveRegistration();
        if (!alive || !registration) return;
        if (registration.waiting) {
          window.__octoWebUpdateReady = true;
          await applyUpdateOrPrompt();
          return;
        }
        await registration.update();
        if (!alive) return;
        if (registration.waiting) {
          window.__octoWebUpdateReady = true;
          await applyUpdateOrPrompt();
        }
      } catch {
        // ignore
      } finally {
        await refreshBuildMetaAvailability();
      }
    }

    function handleUpdateReady() {
      applyUpdateOrPrompt();
    }

    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      refreshUpdateAvailability();
    }

    if (window.__octoWebUpdateReady) {
      handleUpdateReady();
    }
    refreshUpdateAvailability();
    window.addEventListener("octo:web-pwa-update-ready", handleUpdateReady);
    window.addEventListener("focus", refreshUpdateAvailability);
    window.addEventListener("pageshow", refreshUpdateAvailability);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    const pollId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        refreshUpdateAvailability();
      }
    }, 5 * 60 * 1000);
    return () => {
      alive = false;
      window.removeEventListener("octo:web-pwa-update-ready", handleUpdateReady);
      window.removeEventListener("focus", refreshUpdateAvailability);
      window.removeEventListener("pageshow", refreshUpdateAvailability);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.clearInterval(pollId);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    if (!window.__octoPwaEnabled) return undefined;
    const dismissalKey = "octo:pwa-install-dismissed-at-v1";
    const dismissalCooldownMs = 7 * 24 * 60 * 60 * 1000;

    function hasDismissedRecently() {
      const raw = window.localStorage.getItem(dismissalKey);
      if (!raw) return false;
      const dismissedAt = Number(raw);
      if (!Number.isFinite(dismissedAt)) return false;
      return Date.now() - dismissedAt < dismissalCooldownMs;
    }

    function refreshInstallAvailability() {
      const { isStandalone, isIos, isSafari } = getPwaSurfaceState();
      if (isStandalone) {
        setInstallPromptVisible(false);
        return;
      }
      if (installPromptEvent) {
        setInstallMode("browser");
        setInstallPromptVisible(!hasDismissedRecently());
        return;
      }
      if (isIos && isSafari) {
        setInstallMode("ios");
        setInstallPromptVisible(!hasDismissedRecently());
        return;
      }
      setInstallMode("browser");
      setInstallPromptVisible(false);
    }

    function handleBeforeInstallPrompt(event) {
      event.preventDefault();
      const { isStandalone } = getPwaSurfaceState();
      if (isStandalone) {
        setInstallPromptEvent(null);
        setInstallPromptVisible(false);
        return;
      }
      setInstallPromptEvent(event);
      setInstallMode("browser");
      if (!hasDismissedRecently()) {
        setInstallPromptVisible(true);
      }
    }

    function handleAppInstalled() {
      setInstallPromptEvent(null);
      setInstallPromptVisible(false);
      window.localStorage.removeItem(dismissalKey);
    }

    refreshInstallAvailability();
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, [installPromptEvent]);

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  async function handleApplyUpdate() {
    const applyUpdate = typeof window !== "undefined" ? window.__octoWebApplyUpdate : null;
    const recover = typeof window !== "undefined" ? window.__octoRecoverFromStaleBundle : null;
    if (typeof window !== "undefined") {
      window.__octoWebUpdateReady = false;
    }
    setUpdatePromptVisible(false);
    if (typeof applyUpdate === "function") {
      try {
        await applyUpdate(true);
        return;
      } catch {
        // fall through to hard reload recovery
      }
    }
    if (typeof recover === "function") {
      const recovered = await recover("manual-update-fallback");
      if (recovered) return;
    }
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  }

  async function handleInstallApp() {
    if (!installPromptEvent) return;
    try {
      await installPromptEvent.prompt();
      await installPromptEvent.userChoice;
    } catch {
      // ignore
    } finally {
      setInstallPromptEvent(null);
      setInstallPromptVisible(false);
    }
  }

  function handleDismissInstallPrompt() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("octo:pwa-install-dismissed-at-v1", String(Date.now()));
    }
    setInstallPromptVisible(false);
  }

  const user = session?.user || null;
  const lazyPage = (node) => (
    <Suspense fallback={<RouteLoadingScreen />}>
      {node}
    </Suspense>
  );

  return (
    <ToastProvider>
      <ErrorBoundary>
        <LocalizationProvider user={user}>
          {updatePromptVisible ? <WebUpdatePrompt onUpdate={handleApplyUpdate} /> : null}
          {!updatePromptVisible && installPromptVisible ? (
            <WebInstallPrompt
              mode={installMode}
              canInstall={Boolean(installPromptEvent)}
              onInstall={handleInstallApp}
              onDismiss={handleDismissInstallPrompt}
            />
          ) : null}
          <LocalizedRoutes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/auth/set-password" element={<AuthSetPasswordPage user={user} />} />
            <Route path="/ext" element={lazyPage(<ExternalApiDocsPage />)} />
            <Route
              path="/ext/v1/docs"
              element={lazyPage(<ExternalApiDocsRedirectPage path="/ext/v1/docs" label="Swagger UI" />)}
            />
            <Route
              path="/ext/v1/docs/oauth2-redirect"
              element={lazyPage(<ExternalApiDocsRedirectPage path="/ext/v1/docs/oauth2-redirect" label="Swagger OAuth Redirect" />)}
            />
            <Route
              path="/ext/v1/redoc"
              element={lazyPage(<ExternalApiDocsRedirectPage path="/ext/v1/redoc" label="ReDoc" />)}
            />
            <Route
              path="/ext/v1/openapi.json"
              element={lazyPage(<ExternalApiDocsRedirectPage path="/ext/v1/openapi.json" label="OpenAPI JSON" />)}
            />
            <Route
              path="/ext/v1/guide.md"
              element={lazyPage(<ExternalApiDocsRedirectPage path="/ext/v1/guide.md" label="External API Guide" />)}
            />
            <Route
              path="/ext/v1/events.md"
              element={lazyPage(<ExternalApiDocsRedirectPage path="/ext/v1/events.md" label="External Event Catalog" />)}
            />
            <Route
              path="/*"
              element={
                <ProtectedRoute user={user} loading={loading}>
                  <AccessContextProvider seedContext={accessContextSeed}>
                    <ModuleStoreProvider user={user}>
                      <ShellLayout user={user} onSignOut={handleSignOut} />
                    </ModuleStoreProvider>
                  </AccessContextProvider>
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to="/home" replace />} />
              <Route path="home" element={<HomePage user={user} />} />
              <Route path="apps" element={lazyPage(<AppsPage user={user} />)} />
              <Route path="apps/:moduleId" element={<AppShell />} />
              <Route path="apps/:moduleId/page/:pageId" element={<AppShell />} />
              <Route path="apps/:moduleId/view/:viewId" element={<AppShell />} />
              <Route path="apps/:moduleId/details" element={lazyPage(<ModuleDetailPage user={user} />)} />
              <Route
                path="studio"
                element={(
                  <CapabilityRoute capability="modules.manage">
                    {lazyPage(<Studio2Page user={user} />)}
                  </CapabilityRoute>
                )}
              />
              <Route
                path="studio/:moduleId"
                element={(
                  <CapabilityRoute capability="modules.manage">
                    {lazyPage(<Studio2Page user={user} />)}
                  </CapabilityRoute>
                )}
              />
              <Route
                path="studio/preview/:moduleId"
                element={(
                  <CapabilityRoute capability="modules.manage">
                    {lazyPage(<StudioModulePreviewFramePage />)}
                  </CapabilityRoute>
                )}
              />
              <Route path="studio2" element={<Navigate to="/studio" replace />} />
              <Route path="studio2/:moduleId" element={<Navigate to="/studio" replace />} />
              <Route path="audit" element={lazyPage(<AuditPage />)} />
              <Route path="security" element={<Navigate to="/settings/security" replace />} />
            <Route path="settings" element={lazyPage(<SettingsPage />)} />
            <Route
              path="settings/security"
              element={(
                <SuperadminRoute>
                  {lazyPage(<SecurityCenterPage />)}
                </SuperadminRoute>
              )}
            />
            <Route path="settings/settings" element={lazyPage(<SettingsSettingsPage user={user} onSignOut={handleSignOut} />)} />
            <Route path="settings/preferences" element={<Navigate to="/settings/settings" replace />} />
            <Route path="settings/password" element={lazyPage(<SettingsPasswordPage user={user} />)} />
            <Route
              path="settings/users"
              element={(
                <CapabilityRoute capability="workspace.manage_members">
                  {lazyPage(<SettingsUsersPage />)}
                </CapabilityRoute>
              )}
            />
            <Route
              path="settings/access-policies"
              element={(
                <CapabilityRoute capability="workspace.manage_members">
                  {lazyPage(<SettingsAccessPoliciesPage />)}
                </CapabilityRoute>
              )}
            />
            <Route
              path="settings/access-policies/:profileId"
              element={(
                <CapabilityRoute capability="workspace.manage_members">
                  {lazyPage(<SettingsAccessPolicyDetailPage />)}
                </CapabilityRoute>
              )}
            />
            <Route
              path="settings/workspaces"
              element={lazyPage(<SettingsWorkspacesPage />)}
            />
            <Route
              path="settings/document-numbering"
              element={(
                <CapabilityRoute capability="workspace.manage_settings">
                  {lazyPage(<SettingsDocumentNumberingPage />)}
                </CapabilityRoute>
              )}
            />
            <Route
              path="settings/document-numbering/new"
              element={(
                <CapabilityRoute capability="workspace.manage_settings">
                  {lazyPage(<SettingsDocumentNumberingDetailPage />)}
                </CapabilityRoute>
              )}
            />
            <Route
              path="settings/document-numbering/:sequenceId"
              element={(
                <CapabilityRoute capability="workspace.manage_settings">
                  {lazyPage(<SettingsDocumentNumberingDetailPage />)}
                </CapabilityRoute>
              )}
            />
            <Route
              path="settings/api-credentials"
              element={(
                <CapabilityRoute capability="workspace.manage_settings">
                  {lazyPage(<SettingsApiCredentialsPage />)}
                </CapabilityRoute>
              )}
            />
            <Route
              path="settings/api-credentials/:credentialId"
              element={(
                <CapabilityRoute capability="workspace.manage_settings">
                  {lazyPage(<SettingsApiCredentialDetailPage />)}
                </CapabilityRoute>
              )}
            />
            <Route
              path="settings/webhook-subscriptions"
              element={(
                <CapabilityRoute capability="workspace.manage_settings">
                  {lazyPage(<SettingsWebhookSubscriptionsPage />)}
                </CapabilityRoute>
              )}
            />
            <Route
              path="settings/webhook-subscriptions/:subscriptionId"
              element={(
                <CapabilityRoute capability="workspace.manage_settings">
                  {lazyPage(<SettingsWebhookSubscriptionDetailPage />)}
                </CapabilityRoute>
              )}
            />
            <Route
              path="settings/secrets"
              element={(
                <CapabilityRoute capability="workspace.manage_settings">
                  {lazyPage(<SettingsSecretsPage />)}
                </CapabilityRoute>
              )}
            />
            <Route
              path="settings/diagnostics"
              element={(
                <CapabilityRoute capability="workspace.manage_settings">
                  {lazyPage(<DiagnosticsPage />)}
                </CapabilityRoute>
              )}
            />
            <Route
              path="settings/diagnostics/:moduleId"
              element={(
                <CapabilityRoute capability="workspace.manage_settings">
                  {lazyPage(<DiagnosticsModulePage />)}
                </CapabilityRoute>
              )}
            />
            <Route
              path="settings/email"
              element={(
                <CapabilityRoute capability="templates.manage">
                  {lazyPage(<EmailHomePage />)}
                </CapabilityRoute>
              )}
            />
            <Route
              path="settings/email/connections"
              element={(
                <CapabilityRoute capability="templates.manage">
                  {lazyPage(<EmailConnectionsPage />)}
                </CapabilityRoute>
              )}
            />
            <Route
              path="settings/email/connections/:connectionId"
              element={(
                <CapabilityRoute capability="templates.manage">
                  {lazyPage(<EmailConnectionDetailPage />)}
                </CapabilityRoute>
              )}
            />
            <Route
              path="settings/email-templates"
              element={(
                <CapabilityRoute capability="templates.manage">
                  {lazyPage(<EmailTemplatesPage />)}
                </CapabilityRoute>
              )}
            />
            <Route
              path="settings/email-outbox"
              element={(
                <CapabilityRoute capability="templates.manage">
                  {lazyPage(<EmailOutboxPage />)}
                </CapabilityRoute>
              )}
            />
            <Route
              path="settings/email-outbox/:outboxId"
              element={(
                <CapabilityRoute capability="templates.manage">
                  {lazyPage(<EmailOutboxItemPage />)}
                </CapabilityRoute>
              )}
            />
            <Route
              path="settings/documents"
              element={(
                <CapabilityRoute capability="templates.manage">
                  {lazyPage(<DocumentsHomePage />)}
                </CapabilityRoute>
              )}
            />
            <Route
              path="settings/documents/templates"
              element={(
                <CapabilityRoute capability="templates.manage">
                  {lazyPage(<DocumentsPage />)}
                </CapabilityRoute>
              )}
            />
            <Route
              path="email/templates/:id"
              element={(
                <CapabilityRoute capability="templates.manage">
                  {lazyPage(<EmailTemplateStudioPage user={user} />)}
                </CapabilityRoute>
              )}
            />
            <Route
              path="documents/templates/:id"
              element={(
                <CapabilityRoute capability="templates.manage">
                  {lazyPage(<DocumentTemplateStudioPage user={user} />)}
                </CapabilityRoute>
              )}
            />
            <Route path="notifications" element={lazyPage(<NotificationsPage />)} />
            <Route
              path="integrations"
              element={(
                <CapabilityRoute capability="workspace.manage_settings">
                  {lazyPage(<IntegrationsPage />)}
                </CapabilityRoute>
              )}
            />
            <Route
              path="integrations/connections/:connectionId"
              element={(
                <CapabilityRoute capability="workspace.manage_settings">
                  {lazyPage(<IntegrationConnectionPage />)}
                </CapabilityRoute>
              )}
            />
            <Route
              path="automations"
              element={(
                <CapabilityRoute capability="automations.manage">
                  {lazyPage(<AutomationsPage />)}
                </CapabilityRoute>
              )}
            />
            <Route
              path="automations/:automationId"
              element={(
                <CapabilityRoute capability="automations.manage">
                  {lazyPage(<AutomationEditorPage user={user} />)}
                </CapabilityRoute>
              )}
            />
            <Route
              path="automations/:automationId/runs"
              element={(
                <CapabilityRoute capability="automations.manage">
                  {lazyPage(<AutomationRunsPage />)}
                </CapabilityRoute>
              )}
            />
            <Route
              path="automation-runs/:runId"
              element={(
                <CapabilityRoute capability="automations.manage">
                  {lazyPage(<AutomationRunDetailPage />)}
                </CapabilityRoute>
              )}
            />
            <Route
              path="ops"
              element={(
                <CapabilityRoute capability="automations.manage">
                  {lazyPage(<OpsPage />)}
                </CapabilityRoute>
              )}
            />
            <Route
              path="ops/jobs/:jobId"
              element={(
                <CapabilityRoute capability="automations.manage">
                  {lazyPage(<OpsJobPage />)}
                </CapabilityRoute>
              )}
            />
            <Route
              path="octo-ai"
              element={(
                <SuperadminRoute>
                  {lazyPage(<OctoAiSessionsPage />)}
                </SuperadminRoute>
              )}
            />
            <Route
              path="octo-ai/sessions/:sessionId"
              element={(
                <SuperadminRoute>
                  {lazyPage(<OctoAiSessionDetailPage />)}
                </SuperadminRoute>
              )}
            />
            <Route
              path="octo-ai/sandboxes/:sessionId"
              element={(
                <SuperadminRoute>
                  {lazyPage(<OctoAiWorkspacePage />)}
                </SuperadminRoute>
              )}
            />
            <Route
              path="data"
              element={(
                <CapabilityRoute capability="records.read">
                  {lazyPage(<DataExplorerPage />)}
                </CapabilityRoute>
              )}
            />
            <Route
              path="data/:entity"
              element={(
                <CapabilityRoute capability="records.read">
                  {lazyPage(<DataExplorerPage />)}
                </CapabilityRoute>
              )}
            />
            <Route
              path="data/:entity/new"
              element={(
                <CapabilityRoute capability="records.write">
                  {lazyPage(<EntityCreatePage />)}
                </CapabilityRoute>
              )}
            />
            <Route
              path="data/:entity/:id"
              element={(
                <CapabilityRoute capability="records.read">
                  {lazyPage(<EntityRecordPage />)}
                </CapabilityRoute>
              )}
            />
            <Route path="*" element={<Navigate to="/home" replace />} />
            </Route>
          </LocalizedRoutes>
        </LocalizationProvider>
      </ErrorBoundary>
    </ToastProvider>
  );
}

function LocalizedRoutes({ children }) {
  const { locale, workspaceKey } = useI18n();
  return <Routes key={`${workspaceKey || "default"}:${locale || "default"}`}>{children}</Routes>;
}

function WebUpdatePrompt({ onUpdate }) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-base-300 bg-base-100 p-4 shadow-lg">
        <p className="text-sm font-semibold">{t("common.app_update.title")}</p>
        <p className="mt-1 text-sm text-base-content/70">{t("common.app_update.description")}</p>
        <button type="button" className="btn btn-primary mt-3 w-full" onClick={onUpdate}>
          {t("common.app_update.action")}
        </button>
      </div>
    </div>
  );
}

function WebInstallPrompt({ mode, canInstall, onInstall, onDismiss }) {
  const { t } = useI18n();
  const isIos = mode === "ios";
  return (
    <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-base-300 bg-base-100 p-4 shadow-lg">
        <p className="text-sm font-semibold">{t("common.app_install.title")}</p>
        {canInstall ? (
          <p className="mt-1 text-sm text-base-content/70">
            {t("common.app_install.description")}
          </p>
        ) : isIos ? (
          <p className="mt-1 text-sm text-base-content/70">
            {t("common.app_install.ios_description_prefix")}{" "}
            <span className="font-medium">{t("common.app_install.add_to_home_screen")}</span>.
          </p>
        ) : (
          <p className="mt-1 text-sm text-base-content/70">
            {t("common.app_install.browser_description_prefix")}{" "}
            <span className="font-medium">{t("common.app_install.install_app")}</span> {t("common.app_install.or")}{" "}
            <span className="font-medium">{t("common.app_install.add_to_desktop")}</span>.
          </p>
        )}
        {isIos ? (
          <ol className="mt-3 space-y-1 text-sm text-base-content/80">
            <li>{t("common.app_install.ios_step_1")}</li>
            <li>{t("common.app_install.ios_step_2")}</li>
            <li>{t("common.app_install.ios_step_3")}</li>
          </ol>
        ) : null}
        <div className="mt-3 flex items-center gap-2">
          {canInstall ? (
            <button type="button" className="btn btn-primary flex-1" onClick={onInstall}>
              {t("common.app_install.install_now")}
            </button>
          ) : (
            <button type="button" className="btn btn-primary flex-1" onClick={onDismiss}>
              {t("common.ok")}
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onDismiss}>
            {t("common.app_install.not_now")}
          </button>
        </div>
      </div>
    </div>
  );
}
