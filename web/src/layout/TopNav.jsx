import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useMatch, useParams } from "react-router-dom";
import UserMenu from "../components/UserMenu.jsx";
import NotificationBell from "../components/NotificationBell.jsx";
import { apiFetch, getManifest, listStudio2Modules } from "../api.js";
import { buildTargetRoute } from "../apps/appShellUtils.js";

export default function TopNav({ user, onSignOut }) {
  const location = useLocation();
  const { moduleId } = useParams();
  const isAppRoute = !!useMatch("/apps/:moduleId/*");
  const pageMatch = useMatch("/apps/:moduleId/page/:pageId");
  const viewMatch = useMatch("/apps/:moduleId/view/:viewId");
  const studioMatch = useMatch("/studio/:moduleId");
  const isStudioList = location.pathname === "/studio";
  const isStudioEditor = !!studioMatch;
  const isStudioRoute = isStudioList || isStudioEditor;
  const isHome = location.pathname === "/home";
  const isAppsStore = location.pathname === "/apps";
  const isSettingsRoot = location.pathname === "/settings";
  const isSettingsPreferences = location.pathname.startsWith("/settings/preferences");
  const isSettingsUsers = location.pathname.startsWith("/settings/users");
  const isSettingsWorkspaces = location.pathname.startsWith("/settings/workspaces");
  const isSettingsSecrets = location.pathname.startsWith("/settings/secrets");
  const isDiagnostics = location.pathname === "/settings/diagnostics";
  const isAudit = location.pathname.startsWith("/audit");
  const isData = location.pathname.startsWith("/data");
  const isOps = location.pathname.startsWith("/ops");
  const isEmailHome = location.pathname === "/settings/email";
  const isEmailConnections = location.pathname.startsWith("/settings/email/connections");
  const isEmailDiagnostics = location.pathname.startsWith("/settings/email/diagnostics");
  const isEmailTemplates = location.pathname.startsWith("/settings/email-templates");
  const isEmailOutbox = location.pathname.startsWith("/settings/email-outbox");
  const isEmailTemplateStudio = location.pathname.startsWith("/email/templates/");
  const isDocsHome = location.pathname === "/settings/documents";
  const isDocsTemplates = location.pathname.startsWith("/settings/documents/templates");
  const isDocsDefaults = location.pathname.startsWith("/settings/documents/defaults");
  const isDocTemplateStudio = location.pathname.startsWith("/documents/templates/");
  const settingsLeafLabel = isSettingsPreferences
    ? "Preferences"
    : isSettingsUsers
      ? "Users"
      : isSettingsWorkspaces
        ? "Workspaces"
        : isSettingsSecrets
          ? "Secrets"
          : isDiagnostics
            ? "Diagnostics"
            : isAudit
              ? "Audit"
              : isData
                ? "Data Explorer"
                : isEmailHome
                  ? "Email"
                  : isEmailConnections
                    ? "Email Connections"
                    : isEmailDiagnostics
                      ? "Email Diagnostics"
                      : isEmailTemplates
                        ? "Email Templates"
                        : isEmailOutbox
                          ? "Email Outbox"
                          : isEmailTemplateStudio
                            ? "Email Template"
                            : isDocsHome
                              ? "Documents"
                              : isDocsTemplates
                                ? "Document Templates"
                                : isDocsDefaults
                                  ? "Document Defaults"
                                  : isDocTemplateStudio
                                    ? "Document Template"
                                    : "";
  const isSettingsRoute = isSettingsRoot
    || isSettingsPreferences
    || isSettingsUsers
    || isSettingsWorkspaces
    || isSettingsSecrets
    || isDiagnostics
    || isAudit
    || isData
    || isEmailHome
    || isEmailConnections
    || isEmailDiagnostics
    || isEmailTemplates
    || isEmailOutbox
    || isEmailTemplateStudio
    || isDocsHome
    || isDocsTemplates
    || isDocsDefaults
    || isDocTemplateStudio;
  const isNotifications = location.pathname.startsWith("/notifications");
  const isAutomations = location.pathname.startsWith("/automations");
  const isAutomationRuns = location.pathname.startsWith("/automation-runs");
  const [manifest, setManifest] = useState(null);
  const [studioModules, setStudioModules] = useState([]);
  const [studioLoading, setStudioLoading] = useState(false);
  const [recordCrumbLabel, setRecordCrumbLabel] = useState("");

  useEffect(() => {
    let mounted = true;
    async function loadManifest() {
      if (!isAppRoute || !moduleId) {
        setManifest(null);
        return;
      }
      try {
        const res = await getManifest(moduleId);
        if (!mounted) return;
        setManifest(res?.manifest || null);
      } catch {
        if (mounted) setManifest(null);
      }
    }
    loadManifest();
    return () => {
      mounted = false;
    };
  }, [isAppRoute, moduleId]);

  useEffect(() => {
    if (!isStudioRoute) return;
    let mounted = true;
    async function loadStudioModules() {
      setStudioLoading(true);
      try {
        const res = await listStudio2Modules();
        if (!mounted) return;
        const payload = res.data || {};
        if (Array.isArray(payload.modules)) {
          setStudioModules(
            payload.modules.map((m) => ({
              module_id: m.module_id,
              name: m.name || m.module_id,
            }))
          );
        } else {
          const installed = payload.installed || [];
          const drafts = payload.drafts || [];
          const draftOnly = drafts.filter((d) => !installed.find((i) => i.module_id === d.module_id));
          const merged = [
            ...installed.map((m) => ({
              module_id: m.module_id,
              name: m.name || m.module_id,
            })),
            ...draftOnly.map((d) => ({
              module_id: d.module_id,
              name: d.name || d.module_id,
            })),
          ];
          setStudioModules(merged);
        }
      } catch {
        if (mounted) setStudioModules([]);
      } finally {
        if (mounted) setStudioLoading(false);
      }
    }
    loadStudioModules();
    return () => {
      mounted = false;
    };
  }, [isStudioRoute]);

  const appName = manifest?.module?.name || moduleId;
  const navGroups = Array.isArray(manifest?.app?.nav) ? manifest.app.nav : [];
  const appHomeTarget = manifest?.app?.home || null;
  const appHomeRoute = appHomeTarget ? buildTargetRoute(moduleId, appHomeTarget) : null;
  const currentPageId = pageMatch?.params?.pageId || "";
  const currentViewId = viewMatch?.params?.viewId || "";
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const currentPageDef = useMemo(() => {
    if (!currentPageId || !Array.isArray(manifest?.pages)) return null;
    return manifest.pages.find((p) => p?.id === currentPageId) || null;
  }, [manifest, currentPageId]);
  const recordParamKey = currentPageDef?.content?.find((b) => b?.kind === "record")?.record_id_query || "record";
  const recordIdParam = currentPageId && recordParamKey ? searchParams.get(recordParamKey) : null;
  const isRecordPage = !!(currentPageId && recordParamKey && recordIdParam);
  const recordEntityId = currentPageDef?.content?.find((b) => b?.kind === "record")?.entity_id || null;

  const recordTitleField = useMemo(() => {
    if (!recordEntityId || !Array.isArray(manifest?.entities)) return null;
    const entity = manifest.entities.find((e) => e?.id === recordEntityId);
    return entity?.display_field || null;
  }, [manifest, recordEntityId]);

  useEffect(() => {
    let mounted = true;
    async function loadRecordCrumb() {
      if (!isAppRoute || !isRecordPage || !recordEntityId || !recordIdParam) {
        setRecordCrumbLabel("");
        return;
      }
      try {
        const res = await apiFetch(`/records/${encodeURIComponent(recordEntityId)}/${encodeURIComponent(recordIdParam)}`);
        if (!mounted) return;
        const record = res?.record || {};
        const raw = (recordTitleField && record?.[recordTitleField]) || record?.id || recordIdParam;
        const text = String(raw || "").trim();
        setRecordCrumbLabel(text || "Record");
      } catch {
        if (mounted) setRecordCrumbLabel("Record");
      }
    }
    loadRecordCrumb();
    return () => {
      mounted = false;
    };
  }, [isAppRoute, isRecordPage, recordEntityId, recordIdParam, recordTitleField]);

  const currentPath = location.pathname;
  const navItems = useMemo(() => {
    if (!moduleId) return [];
    const items = [];
    for (const group of navGroups) {
      if (!group || !Array.isArray(group.items)) continue;
      const groupLabel = group.group || "Navigation";
      const groupItems = group.items.filter((i) => i && i.label && i.to);
      items.push({ groupLabel, items: groupItems });
    }
    return items;
  }, [navGroups, moduleId]);

  const studioModuleId = studioMatch?.params?.moduleId || "";
  const studioModuleName = studioModules.find((m) => m.module_id === studioModuleId)?.name
    || (studioLoading ? "Loading…" : studioModuleId);

  return (
    <div className="navbar bg-base-100 shadow overflow-visible relative z-40">
      <div className="flex-none gap-2">
        {isStudioRoute ? (
          <div className="breadcrumbs text-sm pl-2">
            <ul>
              <li><Link to="/home">Home</Link></li>
              <li><Link to="/studio">Studio</Link></li>
              {isStudioEditor && <li>{studioModuleName}</li>}
            </ul>
          </div>
        ) : isAppRoute ? (
          <div className="breadcrumbs text-sm pl-2">
            <ul>
              <li><Link to="/home">Home</Link></li>
              <li>
                {appHomeRoute ? (
                  <Link to={appHomeRoute}>{appName || moduleId}</Link>
                ) : (
                  appName || moduleId
                )}
              </li>
              {isRecordPage && <li>{recordCrumbLabel || "Record"}</li>}
            </ul>
          </div>
        ) : isAppsStore ? (
          <div className="breadcrumbs text-sm pl-2">
            <ul>
              <li><Link to="/home">Home</Link></li>
              <li>Apps</li>
            </ul>
          </div>
        ) : isSettingsRoute ? (
          <div className="breadcrumbs text-sm pl-2">
            <ul>
              <li><Link to="/home">Home</Link></li>
              <li><Link to="/settings">Settings</Link></li>
              {settingsLeafLabel && <li>{settingsLeafLabel}</li>}
            </ul>
          </div>
        ) : isNotifications ? (
          <div className="breadcrumbs text-sm pl-2">
            <ul>
              <li><Link to="/home">Home</Link></li>
              <li>Notifications</li>
            </ul>
          </div>
        ) : isAutomations ? (
          <div className="breadcrumbs text-sm pl-2">
            <ul>
              <li><Link to="/home">Home</Link></li>
              <li><Link to="/automations">Automations</Link></li>
            </ul>
          </div>
        ) : isAutomationRuns ? (
          <div className="breadcrumbs text-sm pl-2">
            <ul>
              <li><Link to="/home">Home</Link></li>
              <li><Link to="/automations">Automations</Link></li>
              <li>Run</li>
            </ul>
          </div>
        ) : isOps ? (
          <div className="breadcrumbs text-sm pl-2">
            <ul>
              <li><Link to="/home">Home</Link></li>
              <li>Ops</li>
            </ul>
          </div>
        ) : (
          !isHome && (
            <Link to="/home" className="btn btn-ghost btn-sm">← Home</Link>
          )
        )}
      </div>
      <div className="flex-1 justify-center">
        {isStudioRoute && (
          <div className="text-sm font-medium text-primary">
            {isStudioEditor ? studioModuleName : "Studio"}
          </div>
        )}
        {isAppRoute && !isStudioRoute && navItems.length > 0 && (
          <div className="flex items-center gap-4">
            {navItems.map((group) => {
              const items = group.items || [];
              const single = items.length === 1 && items[0]?.label === group.groupLabel;
              if (single) {
                const target = buildTargetRoute(moduleId, items[0].to);
                const active = target && currentPath.startsWith(target);
                return (
                  <Link
                    key={`${group.groupLabel}-single`}
                    to={target || "#"}
                    className={`text-sm font-medium ${active ? "text-primary" : "opacity-80"}`}
                  >
                    {group.groupLabel}
                  </Link>
                );
              }
              return (
                <div className="dropdown dropdown-hover" key={group.groupLabel}>
                  <label tabIndex={0} className="text-sm font-medium cursor-pointer">
                    {group.groupLabel}
                  </label>
                  <ul tabIndex={0} className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-56 z-50">
                    {items.map((item) => {
                      const target = buildTargetRoute(moduleId, item.to);
                      const active = target && currentPath.startsWith(target);
                      return (
                        <li key={item.label}>
                          <Link to={target || "#"} className={active ? "text-primary" : ""}>
                            {item.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="flex-none">
        <NotificationBell />
        <UserMenu user={user} onSignOut={onSignOut} />
      </div>
    </div>
  );
}
