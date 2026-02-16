import React, { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { supabase } from "./supabase";
import ProtectedRoute from "./auth/ProtectedRoute.jsx";
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
            <Route path="studio" element={<Studio2Page user={user} />} />
            <Route path="studio/:moduleId" element={<Studio2Page user={user} />} />
            <Route path="studio2" element={<Navigate to="/studio" replace />} />
            <Route path="studio2/:moduleId" element={<Navigate to="/studio" replace />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="settings/preferences" element={<SettingsPreferencesPage user={user} onSignOut={handleSignOut} />} />
            <Route path="settings/users" element={<SettingsUsersPage />} />
            <Route path="settings/workspaces" element={<SettingsWorkspacesPage />} />
            <Route path="settings/secrets" element={<SettingsSecretsPage />} />
            <Route path="settings/diagnostics" element={<DiagnosticsPage />} />
            <Route path="settings/email" element={<EmailHomePage />} />
            <Route path="settings/email/connections" element={<EmailConnectionsPage />} />
            <Route path="settings/email/diagnostics" element={<EmailDiagnosticsPage />} />
            <Route path="settings/email-templates" element={<EmailTemplatesPage />} />
            <Route path="settings/email-outbox" element={<EmailOutboxPage />} />
            <Route path="settings/documents" element={<DocumentsHomePage />} />
            <Route path="settings/documents/templates" element={<DocumentsPage />} />
            <Route path="email/templates/:id" element={<EmailTemplateStudioPage user={user} />} />
            <Route path="documents/templates/:id" element={<DocumentTemplateStudioPage user={user} />} />
            <Route path="settings/documents/defaults" element={<DocumentsDefaultsPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="automations" element={<AutomationsPage />} />
            <Route path="automations/:automationId" element={<AutomationEditorPage user={user} />} />
            <Route path="automations/:automationId/runs" element={<AutomationRunsPage />} />
            <Route path="automation-runs/:runId" element={<AutomationRunDetailPage />} />
            <Route path="ops" element={<OpsPage />} />
            <Route path="data" element={<DataExplorerPage />} />
            <Route path="data/:entity" element={<DataExplorerPage />} />
            <Route path="data/:entity/new" element={<EntityCreatePage />} />
            <Route path="data/:entity/:id" element={<EntityRecordPage />} />
            <Route path="*" element={<Navigate to="/home" replace />} />
          </Route>
        </Routes>
      </ErrorBoundary>
    </ToastProvider>
  );
}
