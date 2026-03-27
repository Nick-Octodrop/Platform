import React, { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { supabase } from "./supabase";
import ProtectedRoute from "./auth/ProtectedRoute.jsx";
import CapabilityRoute from "./auth/CapabilityRoute.jsx";
import SuperadminRoute from "./auth/SuperadminRoute.jsx";
import ShellLayout from "./layout/ShellLayout.jsx";
import { ModuleStoreProvider } from "./state/moduleStore.jsx";
import { ToastProvider } from "./components/Toast.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import {
  applyBrandColors,
  applyUiDensity,
  getInitialUiDensity,
  getInitialTheme,
  normalizeUiDensity,
  setBrandColors,
  setTheme,
  setUiDensity,
} from "./theme/theme.js";
import { apiFetch, getActiveWorkspaceId, getUiPrefs, setActiveWorkspaceId } from "./api.js";
import LoginPage from "./pages/LoginPage.jsx";
import AppsPage from "./pages/AppsPage.jsx";
import ModuleDetailPage from "./pages/ModuleDetailPage.jsx";
import HomePage from "./pages/HomePage.jsx";
import Studio2Page from "./pages/Studio2Page.jsx";
import AuditPage from "./pages/AuditPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import SettingsSettingsPage from "./pages/SettingsSettingsPage.jsx";
import SettingsPasswordPage from "./pages/SettingsPasswordPage.jsx";
import SettingsUsersPage from "./pages/SettingsUsersPage.jsx";
import SettingsWorkspacesPage from "./pages/SettingsWorkspacesPage.jsx";
import SettingsSecretsPage from "./pages/SettingsSecretsPage.jsx";
import DiagnosticsPage from "./pages/DiagnosticsPage.jsx";
import DiagnosticsModulePage from "./pages/DiagnosticsModulePage.jsx";
import DataExplorerPage from "./pages/DataExplorerPage.jsx";
import OpsPage from "./pages/OpsPage.jsx";
import OpsJobPage from "./pages/OpsJobPage.jsx";
import NotificationsPage from "./pages/NotificationsPage.jsx";
import IntegrationsPage from "./pages/IntegrationsPage.jsx";
import IntegrationConnectionPage from "./pages/IntegrationConnectionPage.jsx";
import EmailHomePage from "./pages/EmailHomePage.jsx";
import EmailConnectionsPage from "./pages/EmailConnectionsPage.jsx";
import EmailConnectionDetailPage from "./pages/EmailConnectionDetailPage.jsx";
import EmailTemplatesPage from "./pages/EmailTemplatesPage.jsx";
import EmailOutboxPage from "./pages/EmailOutboxPage.jsx";
import EmailOutboxItemPage from "./pages/EmailOutboxItemPage.jsx";
import EmailTemplateStudioPage from "./pages/email/EmailTemplateStudioPage.jsx";
import DocumentsHomePage from "./pages/DocumentsHomePage.jsx";
import DocumentsPage from "./pages/DocumentsPage.jsx";
import DocumentTemplateStudioPage from "./pages/documents/DocumentTemplateStudioPage.jsx";
import AutomationsPage from "./pages/AutomationsPage.jsx";
import AutomationEditorPage from "./pages/AutomationEditorPage.jsx";
import AutomationRunsPage from "./pages/AutomationRunsPage.jsx";
import AutomationRunDetailPage from "./pages/AutomationRunDetailPage.jsx";
import EntityCreatePage from "./pages/EntityCreatePage.jsx";
import EntityRecordPage from "./pages/EntityRecordPage.jsx";
import AppShell from "./apps/AppShell.jsx";
import AuthSetPasswordPage from "./pages/AuthSetPasswordPage.jsx";
import DesktopOnlyGate from "./components/DesktopOnlyGate.jsx";
import OctoAiSessionsPage from "./pages/OctoAiSessionsPage.jsx";
import OctoAiSessionDetailPage from "./pages/OctoAiSessionDetailPage.jsx";
import OctoAiWorkspacePage from "./pages/OctoAiWorkspacePage.jsx";

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [workspaceKey, setWorkspaceKey] = useState(() => getActiveWorkspaceId());
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
        if (workspace?.colors) {
          setBrandColors(workspace.colors);
          applyBrandColors(workspace.colors);
        }
        const nextTheme = userPrefs?.theme || workspace?.theme || getInitialTheme();
        if (nextTheme) {
          setTheme(nextTheme);
        }
        // Keep local preference as fallback so navigation/reload does not unexpectedly drop to "sm".
        const nextUiDensity = normalizeUiDensity(userPrefs?.ui_density || workspace?.ui_density || getInitialUiDensity());
        setUiDensity(nextUiDensity);
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
    if (!session?.user || workspaceKey) return undefined;
    (async () => {
      try {
        const res = await apiFetch("/access/context", { cacheTtl: 10000, cacheKey: "access_context_seed" });
        if (!alive || getActiveWorkspaceId()) return;
        const defaultWorkspaceId =
          res?.actor?.workspace_id ||
          res?.workspaces?.[0]?.workspace_id ||
          res?.workspaces?.[0]?.id ||
          "";
        if (defaultWorkspaceId) {
          setActiveWorkspaceId(defaultWorkspaceId);
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
    function handleUpdateReady() {
      setUpdatePromptVisible(true);
    }
    window.addEventListener("octo:web-pwa-update-ready", handleUpdateReady);
    return () => window.removeEventListener("octo:web-pwa-update-ready", handleUpdateReady);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const dismissalKey = "octo:pwa-install-dismissed-v1";
    const isStandalone = () => {
      const displayStandalone = window.matchMedia?.("(display-mode: standalone)")?.matches;
      const navigatorStandalone = typeof window.navigator?.standalone === "boolean" && window.navigator.standalone;
      return Boolean(displayStandalone || navigatorStandalone);
    };
    const ua = window.navigator?.userAgent || "";
    const isIos = /iPad|iPhone|iPod/.test(ua);
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    const hasDismissed = window.localStorage.getItem(dismissalKey) === "1";

    function refreshInstallAvailability() {
      if (isStandalone()) {
        setInstallPromptVisible(false);
        return;
      }
      if (installPromptEvent) {
        setInstallMode("browser");
        setInstallPromptVisible(!hasDismissed);
        return;
      }
      if (isIos && isSafari) {
        setInstallMode("ios");
        setInstallPromptVisible(!hasDismissed);
        return;
      }
      setInstallMode("browser");
      setInstallPromptVisible(false);
    }

    function handleBeforeInstallPrompt(event) {
      event.preventDefault();
      setInstallPromptEvent(event);
      setInstallMode("browser");
      if (!isStandalone() && !hasDismissed) {
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
    if (typeof applyUpdate === "function") {
      await applyUpdate(true);
    } else if (typeof window !== "undefined") {
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
      window.localStorage.setItem("octo:pwa-install-dismissed-v1", "1");
    }
    setInstallPromptVisible(false);
  }

  const user = session?.user || null;

  return (
    <ToastProvider>
      <ErrorBoundary>
        {updatePromptVisible ? <WebUpdatePrompt onUpdate={handleApplyUpdate} /> : null}
        {!updatePromptVisible && installPromptVisible ? (
          <WebInstallPrompt
            mode={installMode}
            canInstall={Boolean(installPromptEvent)}
            onInstall={handleInstallApp}
            onDismiss={handleDismissInstallPrompt}
          />
        ) : null}
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/auth/set-password" element={<AuthSetPasswordPage user={user} />} />
          <Route
            path="/*"
            element={
              <ProtectedRoute user={user} loading={loading}>
                <ModuleStoreProvider user={user}>
                  <ShellLayout user={user} onSignOut={handleSignOut} />
                </ModuleStoreProvider>
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/home" replace />} />
            <Route path="home" element={<HomePage user={user} />} />
            <Route path="apps" element={<AppsPage user={user} />} />
            <Route path="apps/:moduleId" element={<AppShell />} />
            <Route path="apps/:moduleId/page/:pageId" element={<AppShell />} />
            <Route path="apps/:moduleId/view/:viewId" element={<AppShell />} />
            <Route path="apps/:moduleId/details" element={<ModuleDetailPage user={user} />} />
            <Route
              path="studio"
              element={(
                <CapabilityRoute capability="modules.manage">
                  <Studio2Page user={user} />
                </CapabilityRoute>
              )}
            />
            <Route
              path="studio/:moduleId"
              element={(
                <CapabilityRoute capability="modules.manage">
                  <Studio2Page user={user} />
                </CapabilityRoute>
              )}
            />
            <Route path="studio2" element={<Navigate to="/studio" replace />} />
            <Route path="studio2/:moduleId" element={<Navigate to="/studio" replace />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="settings/settings" element={<SettingsSettingsPage user={user} onSignOut={handleSignOut} />} />
            <Route path="settings/preferences" element={<Navigate to="/settings/settings" replace />} />
            <Route path="settings/password" element={<SettingsPasswordPage user={user} />} />
            <Route
              path="settings/users"
              element={(
                <CapabilityRoute capability="workspace.manage_members">
                  <SettingsUsersPage />
                </CapabilityRoute>
              )}
            />
            <Route
              path="settings/workspaces"
              element={(
                <CapabilityRoute capability="workspace.manage_settings">
                  <SettingsWorkspacesPage />
                </CapabilityRoute>
              )}
            />
            <Route
              path="settings/secrets"
              element={(
                <CapabilityRoute capability="workspace.manage_settings">
                  <SettingsSecretsPage />
                </CapabilityRoute>
              )}
            />
            <Route
              path="settings/diagnostics"
              element={(
                <CapabilityRoute capability="workspace.manage_settings">
                  <DiagnosticsPage />
                </CapabilityRoute>
              )}
            />
            <Route
              path="settings/diagnostics/:moduleId"
              element={(
                <CapabilityRoute capability="workspace.manage_settings">
                  <DiagnosticsModulePage />
                </CapabilityRoute>
              )}
            />
            <Route
              path="settings/email"
              element={(
                <CapabilityRoute capability="templates.manage">
                  <EmailHomePage />
                </CapabilityRoute>
              )}
            />
            <Route
              path="settings/email/connections"
              element={(
                <CapabilityRoute capability="templates.manage">
                  <EmailConnectionsPage />
                </CapabilityRoute>
              )}
            />
            <Route
              path="settings/email/connections/:connectionId"
              element={(
                <CapabilityRoute capability="templates.manage">
                  <EmailConnectionDetailPage />
                </CapabilityRoute>
              )}
            />
            <Route
              path="settings/email-templates"
              element={(
                <CapabilityRoute capability="templates.manage">
                  <EmailTemplatesPage />
                </CapabilityRoute>
              )}
            />
            <Route
              path="settings/email-outbox"
              element={(
                <CapabilityRoute capability="templates.manage">
                  <EmailOutboxPage />
                </CapabilityRoute>
              )}
            />
            <Route
              path="settings/email-outbox/:outboxId"
              element={(
                <CapabilityRoute capability="templates.manage">
                  <EmailOutboxItemPage />
                </CapabilityRoute>
              )}
            />
            <Route
              path="settings/documents"
              element={(
                <CapabilityRoute capability="templates.manage">
                  <DocumentsHomePage />
                </CapabilityRoute>
              )}
            />
            <Route
              path="settings/documents/templates"
              element={(
                <CapabilityRoute capability="templates.manage">
                  <DocumentsPage />
                </CapabilityRoute>
              )}
            />
            <Route
              path="email/templates/:id"
              element={(
                <CapabilityRoute capability="templates.manage">
                  <EmailTemplateStudioPage user={user} />
                </CapabilityRoute>
              )}
            />
            <Route
              path="documents/templates/:id"
              element={(
                <CapabilityRoute capability="templates.manage">
                  <DocumentTemplateStudioPage user={user} />
                </CapabilityRoute>
              )}
            />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route
              path="integrations"
              element={(
                <CapabilityRoute capability="workspace.manage_settings">
                  <IntegrationsPage />
                </CapabilityRoute>
              )}
            />
            <Route
              path="integrations/connections/:connectionId"
              element={(
                <CapabilityRoute capability="workspace.manage_settings">
                  <IntegrationConnectionPage />
                </CapabilityRoute>
              )}
            />
            <Route
              path="automations"
              element={(
                <CapabilityRoute capability="automations.manage">
                  <AutomationsPage />
                </CapabilityRoute>
              )}
            />
            <Route
              path="automations/:automationId"
              element={(
                <CapabilityRoute capability="automations.manage">
                  <AutomationEditorPage user={user} />
                </CapabilityRoute>
              )}
            />
            <Route
              path="automations/:automationId/runs"
              element={(
                <CapabilityRoute capability="automations.manage">
                  <AutomationRunsPage />
                </CapabilityRoute>
              )}
            />
            <Route
              path="automation-runs/:runId"
              element={(
                <CapabilityRoute capability="automations.manage">
                  <AutomationRunDetailPage />
                </CapabilityRoute>
              )}
            />
            <Route
              path="ops"
              element={(
                <CapabilityRoute capability="automations.manage">
                  <OpsPage />
                </CapabilityRoute>
              )}
            />
            <Route
              path="ops/jobs/:jobId"
              element={(
                <CapabilityRoute capability="automations.manage">
                  <OpsJobPage />
                </CapabilityRoute>
              )}
            />
            <Route
              path="octo-ai"
              element={(
                <SuperadminRoute>
                  <DesktopOnlyGate feature="Octo AI">
                    <OctoAiSessionsPage />
                  </DesktopOnlyGate>
                </SuperadminRoute>
              )}
            />
            <Route
              path="octo-ai/sessions/:sessionId"
              element={(
                <SuperadminRoute>
                  <DesktopOnlyGate feature="Octo AI">
                    <OctoAiSessionDetailPage />
                  </DesktopOnlyGate>
                </SuperadminRoute>
              )}
            />
            <Route
              path="octo-ai/sandboxes/:sessionId"
              element={(
                <SuperadminRoute>
                  <DesktopOnlyGate feature="Octo AI">
                    <OctoAiWorkspacePage />
                  </DesktopOnlyGate>
                </SuperadminRoute>
              )}
            />
            <Route
              path="data"
              element={(
                <CapabilityRoute capability="records.read">
                  <DataExplorerPage />
                </CapabilityRoute>
              )}
            />
            <Route
              path="data/:entity"
              element={(
                <CapabilityRoute capability="records.read">
                  <DataExplorerPage />
                </CapabilityRoute>
              )}
            />
            <Route
              path="data/:entity/new"
              element={(
                <CapabilityRoute capability="records.write">
                  <EntityCreatePage />
                </CapabilityRoute>
              )}
            />
            <Route
              path="data/:entity/:id"
              element={(
                <CapabilityRoute capability="records.read">
                  <EntityRecordPage />
                </CapabilityRoute>
              )}
            />
            <Route path="*" element={<Navigate to="/home" replace />} />
          </Route>
        </Routes>
      </ErrorBoundary>
    </ToastProvider>
  );
}

function WebUpdatePrompt({ onUpdate }) {
  return (
    <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-base-300 bg-base-100 p-4 shadow-lg">
        <p className="text-sm font-semibold">Update available</p>
        <p className="mt-1 text-sm text-base-content/70">A newer version of Octodrop is ready.</p>
        <button type="button" className="btn btn-primary mt-3 w-full" onClick={onUpdate}>
          Update now
        </button>
      </div>
    </div>
  );
}

function WebInstallPrompt({ mode, canInstall, onInstall, onDismiss }) {
  const isIos = mode === "ios";
  return (
    <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-base-300 bg-base-100 p-4 shadow-lg">
        <p className="text-sm font-semibold">Install Octodrop</p>
        {canInstall ? (
          <p className="mt-1 text-sm text-base-content/70">
            Install Octodrop as an app for faster launch, standalone windowing, and better update flow.
          </p>
        ) : isIos ? (
          <p className="mt-1 text-sm text-base-content/70">
            On iPhone or iPad, open the browser share menu and choose <span className="font-medium">Add to Home Screen</span>.
          </p>
        ) : (
          <p className="mt-1 text-sm text-base-content/70">
            Use your browser menu and choose <span className="font-medium">Install app</span> or <span className="font-medium">Add to desktop</span>.
          </p>
        )}
        {isIos ? (
          <ol className="mt-3 space-y-1 text-sm text-base-content/80">
            <li>1. Tap the Share button in Safari.</li>
            <li>2. Choose `Add to Home Screen`.</li>
            <li>3. Tap `Add` to install Octodrop.</li>
          </ol>
        ) : null}
        <div className="mt-3 flex items-center gap-2">
          {canInstall ? (
            <button type="button" className="btn btn-primary flex-1" onClick={onInstall}>
              Install now
            </button>
          ) : (
            <button type="button" className="btn btn-primary flex-1" onClick={onDismiss}>
              OK
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onDismiss}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
