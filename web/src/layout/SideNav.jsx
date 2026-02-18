// SideNav encodes the system vs module mental model.
// System items are always visible; enabled modules appear as shortcuts.
import React, { useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useModuleStore } from "../state/moduleStore.jsx";
import { getAppDisplayName } from "../state/appCatalog.js";
import { getPinnedApps, getRecentApps, recordRecentApp, subscribeAppUsage } from "../state/appUsage.js";
import { getManifest } from "../api";
import { buildTargetRoute } from "../apps/appShellUtils.js";
import { useAccessContext } from "../access.js";

const navLinkClass = ({ isActive }) =>
  `btn btn-ghost justify-start w-full ${isActive ? "bg-base-200" : ""}`;

function AppShortcut({ id, label }) {
  const navigate = useNavigate();

  async function openModule(event) {
    event.preventDefault();
    recordRecentApp(id);
    try {
      const res = await getManifest(id);
      const homeTarget = res?.manifest?.app?.home || null;
      const route = buildTargetRoute(id, homeTarget) || `/apps/${id}`;
      navigate(route);
    } catch {
      navigate(`/apps/${id}`);
    }
  }

  return (
    <NavLink to={`/apps/${id}`} className={navLinkClass} onClick={openModule}>
      <span className="badge badge-outline mr-2">{label.slice(0, 1).toUpperCase()}</span>
      {label}
    </NavLink>
  );
}

export default function SideNav() {
  const { modules } = useModuleStore();
  const { loading: accessLoading, hasCapability } = useAccessContext();
  const [pinned, setPinned] = useState(getPinnedApps());
  const [recent, setRecent] = useState(getRecentApps());
  const enabledApps = modules.filter((m) => m.enabled);
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

  const orderedApps = useMemo(() => {
    const enabledIds = enabledApps.map((m) => m.module_id);
    const pinnedFirst = pinned.filter((id) => enabledIds.includes(id));
    const recentNext = recent.filter((id) => enabledIds.includes(id) && !pinnedFirst.includes(id));
    const rest = enabledIds.filter((id) => !pinnedFirst.includes(id) && !recentNext.includes(id)).sort();
    return [...pinnedFirst, ...recentNext, ...rest];
  }, [enabledApps, pinned, recent]);

  const canSeeIntegrations = !accessLoading && hasCapability("workspace.manage_settings");

  return (
    <div className="w-64 min-h-full bg-base-200 p-4">
      <div className="text-lg font-semibold mb-4">OCTO</div>
      <div className="menu space-y-4">
        <div>
          <div className="text-xs uppercase opacity-60 mb-2">Core</div>
          <NavLink to="/home" className={navLinkClass}>Home</NavLink>
          <NavLink to="/apps" className={navLinkClass}>Apps</NavLink>
          <NavLink to="/studio" className={navLinkClass}>Studio</NavLink>
          <NavLink to="/automations" className={navLinkClass}>Automations</NavLink>
          {canSeeIntegrations ? <NavLink to="/integrations" className={navLinkClass}>Integrations</NavLink> : null}
          <NavLink to="/ops" className={navLinkClass}>Ops</NavLink>
        </div>
        <div>
          <div className="text-xs uppercase opacity-60 mb-2">Settings</div>
          <NavLink to="/settings" className={navLinkClass}>Settings</NavLink>
          <NavLink to="/notifications" className={navLinkClass}>Notifications</NavLink>
        </div>
        <div className="divider"></div>
        <div>
          <div className="text-xs uppercase opacity-60 mb-2">Enabled Apps</div>
          {orderedApps.length === 0 && (
            <div className="text-sm opacity-70">Install an app</div>
          )}
          {orderedApps.map((id) => {
            const moduleRecord = enabledById[id];
            const label = getAppDisplayName(id, moduleRecord);
            return <AppShortcut key={id} id={id} label={label} />;
          })}
        </div>
      </div>
    </div>
  );
}
