import React, { useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useModuleStore } from "../state/moduleStore.jsx";
import { getAppDisplayName, getAppTranslationNamespaces } from "../state/appCatalog.js";
import { getPinnedApps, getRecentApps, recordRecentApp, subscribeAppUsage } from "../state/appUsage.js";
import { appendOctoAiFrameParams } from "../apps/appShellUtils.js";
import { useAccessContext } from "../access.js";
import { useI18n } from "../i18n/LocalizationProvider.jsx";
import { ensureRuntimeNamespaces } from "../i18n/runtime.js";

const navLinkClass = ({ isActive }) =>
  `btn btn-ghost justify-start w-full ${isActive ? "bg-base-200" : ""}`;

function AppShortcut({ id, label, homeRoute }) {
  const navigate = useNavigate();

  function openModule(event) {
    event.preventDefault();
    recordRecentApp(id);
    const route = (typeof homeRoute === "string" && homeRoute) || `/apps/${id}`;
    navigate(appendOctoAiFrameParams(route));
  }

  return (
    <NavLink to={appendOctoAiFrameParams(`/apps/${id}`)} className={navLinkClass} onClick={openModule}>
      <span className="badge badge-outline mr-2">{label.slice(0, 1).toUpperCase()}</span>
      {label}
    </NavLink>
  );
}

export default function SideNav() {
  const { modules } = useModuleStore();
  const { loading: accessLoading, hasCapability, isSuperadmin } = useAccessContext();
  const { t, locale } = useI18n();
  const [pinned, setPinned] = useState(getPinnedApps());
  const [recent, setRecent] = useState(getRecentApps());
  const enabledApps = modules.filter((m) => m.enabled && (isSuperadmin || m.module_id !== "octo_ai"));
  const enabledById = useMemo(() => {
    const map = {};
    for (const m of enabledApps) map[m.module_id] = m;
    return map;
  }, [enabledApps]);

  useEffect(() => {
    const handler = () => {
      setPinned(getPinnedApps());
      setRecent(getRecentApps());
    };
    const unsubscribe = subscribeAppUsage(handler);
    handler();
    return unsubscribe;
  }, []);

  useEffect(() => {
    const namespaces = getAppTranslationNamespaces(modules);
    if (namespaces.length === 0) return;
    ensureRuntimeNamespaces(namespaces).catch(() => {});
  }, [locale, modules]);

  const orderedApps = useMemo(() => {
    const enabledIds = enabledApps.map((m) => m.module_id);
    const pinnedFirst = pinned.filter((id) => enabledIds.includes(id));
    const recentNext = recent.filter((id) => enabledIds.includes(id) && !pinnedFirst.includes(id));
    const rest = enabledIds.filter((id) => !pinnedFirst.includes(id) && !recentNext.includes(id)).sort();
    return [...pinnedFirst, ...recentNext, ...rest];
  }, [enabledApps, pinned, recent]);

  const canSeeOctoAi = !accessLoading && isSuperadmin;

  return (
    <div className="w-64 min-h-full bg-base-200 p-4">
      <div className="text-lg font-semibold mb-4">OCTO</div>
      <div className="menu space-y-4">
        <div>
          <div className="text-xs uppercase opacity-60 mb-2">{t("navigation.core")}</div>
          <NavLink to={appendOctoAiFrameParams("/home")} className={navLinkClass}>{t("navigation.home")}</NavLink>
          <NavLink to={appendOctoAiFrameParams("/apps")} className={navLinkClass}>{t("navigation.apps")}</NavLink>
          {canSeeOctoAi ? <NavLink to={appendOctoAiFrameParams("/octo-ai")} className={navLinkClass}>Octo AI</NavLink> : null}
          <NavLink to={appendOctoAiFrameParams("/ops")} className={navLinkClass}>{t("navigation.ops")}</NavLink>
        </div>
        <div>
          <div className="text-xs uppercase opacity-60 mb-2">{t("navigation.settings")}</div>
          <NavLink to={appendOctoAiFrameParams("/settings")} className={navLinkClass}>{t("navigation.settings")}</NavLink>
          {canSeeOctoAi ? <NavLink to={appendOctoAiFrameParams("/settings/security")} className={navLinkClass}>{t("navigation.security")}</NavLink> : null}
        </div>
        <div className="divider"></div>
        <div>
          <div className="text-xs uppercase opacity-60 mb-2">{t("navigation.enabled_apps")}</div>
          {orderedApps.length === 0 && (
            <div className="text-sm opacity-70">{t("empty.install_app")}</div>
          )}
          {orderedApps.map((id) => {
            const moduleRecord = enabledById[id];
            const label = getAppDisplayName(id, moduleRecord);
            return <AppShortcut key={id} id={id} label={label} homeRoute={moduleRecord?.home_route} />;
          })}
        </div>
      </div>
    </div>
  );
}
