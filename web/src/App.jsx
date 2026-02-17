import React, { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { supabase } from "./supabase";
import ProtectedRoute from "./auth/ProtectedRoute.jsx";
import CapabilityRoute from "./auth/CapabilityRoute.jsx";
import ShellLayout from "./layout/ShellLayout.jsx";
import { ModuleStoreProvider } from "./state/moduleStore.jsx";
import { ToastProvider } from "./components/Toast.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { applyBrandColors, getInitialTheme, setBrandColors, setTheme } from "./theme/theme.js";
import { getUiPrefs } from "./api.js";
import LoginPage from "./pages/LoginPage.jsx";
import AppsPage from "./pages/AppsPage.jsx";
import ModuleDetailPage from "./pages/ModuleDetailPage.jsx";
import HomePage from "./pages/HomePage.jsx";
import Studio2Page from "./pages/Studio2Page.jsx";
import AuditPage from "./pages/AuditPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import SettingsPreferencesPage from "./pages/SettingsPreferencesPage.jsx";
import SettingsPasswordPage from "./pages/SettingsPasswordPage.jsx";
import SettingsUsersPage from "./pages/SettingsUsersPage.jsx";
import SettingsWorkspacesPage from "./pages/SettingsWorkspacesPage.jsx";
import SettingsSecretsPage from "./pages/SettingsSecretsPage.jsx";
import DiagnosticsPage from "./pages/DiagnosticsPage.jsx";
import DataExplorerPage from "./pages/DataExplorerPage.jsx";
import OpsPage from "./pages/OpsPage.jsx";
import NotificationsPage from "./pages/NotificationsPage.jsx";
import EmailHomePage from "./pages/EmailHomePage.jsx";
import EmailConnectionsPage from "./pages/EmailConnectionsPage.jsx";
import EmailDiagnosticsPage from "./pages/EmailDiagnosticsPage.jsx";
import EmailTemplatesPage from "./pages/EmailTemplatesPage.jsx";
import EmailOutboxPage from "./pages/EmailOutboxPage.jsx";
import EmailTemplateStudioPage from "./pages/email/EmailTemplateStudioPage.jsx";
import DocumentsHomePage from "./pages/DocumentsHomePage.jsx";
import DocumentsPage from "./pages/DocumentsPage.jsx";
import DocumentTemplateStudioPage from "./pages/documents/DocumentTemplateStudioPage.jsx";
import DocumentsDefaultsPage from "./pages/DocumentsDefaultsPage.jsx";
import AutomationsPage from "./pages/AutomationsPage.jsx";
import AutomationEditorPage from "./pages/AutomationEditorPage.jsx";
import AutomationRunsPage from "./pages/AutomationRunsPage.jsx";
import AutomationRunDetailPage from "./pages/AutomationRunDetailPage.jsx";
import EntityCreatePage from "./pages/EntityCreatePage.jsx";
import EntityRecordPage from "./pages/EntityRecordPage.jsx";
import AppShell from "./apps/AppShell.jsx";
import AuthSetPasswordPage from "./pages/AuthSetPasswordPage.jsx";

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

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
      } catch {
        // ignore
      }
    })();
    return () => {
      mounted = false;
    };
  }, [session?.user]);

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  const user = session?.user || null;

  return (
    <ToastProvider>
      <ErrorBoundary>
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
            <Route path="settings/preferences" element={<SettingsPreferencesPage user={user} onSignOut={handleSignOut} />} />
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
              path="settings/email/diagnostics"
              element={(
                <CapabilityRoute capability="templates.manage">
                  <EmailDiagnosticsPage />
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
            <Route
              path="settings/documents/defaults"
              element={(
                <CapabilityRoute capability="templates.manage">
                  <DocumentsDefaultsPage />
                </CapabilityRoute>
              )}
            />
            <Route path="notifications" element={<NotificationsPage />} />
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
