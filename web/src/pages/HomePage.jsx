// HomePage is the system landing page showing installed apps.
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useModuleStore } from "../state/moduleStore.jsx";
import { getAppDisplayName } from "../state/appCatalog.js";
import { getAppIcon, subscribeAppIcons } from "../state/appIcons.js";
import { getDefaultOpenRoute, loadEntityIndex } from "../data/entityIndex.js";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import { LayoutGrid, Package, PenTool, Settings as SettingsIcon, Sparkles, Workflow, Wrench } from "lucide-react";
import { normalizeLucideKey, resolveLucideIcon } from "../state/lucideIconCatalog.js";
import { normalizeHeroKey, resolveHeroIcon } from "../state/heroIconCatalog.js";
import { useAccessContext } from "../access.js";
import { appendOctoAiFrameParams } from "../apps/appShellUtils.js";

function AppTile({ app, module, onOpen }) {
  const disabled = module && !module.enabled;
  const icon = app.icon;
  const iconUrl = app.icon_url;
  const lucideKey = normalizeLucideKey(iconUrl);
  const LucideIcon = lucideKey ? resolveLucideIcon(lucideKey) : null;
  const heroKey = normalizeHeroKey(iconUrl);
  const HeroIcon = heroKey ? resolveHeroIcon(heroKey) : null;
  const isImageUrl = typeof iconUrl === "string" && !LucideIcon && !HeroIcon && !iconUrl.includes("lucide:") && !iconUrl.includes("hero:") && (
    iconUrl.startsWith("data:") || iconUrl.startsWith("http")
  );
  return (
    <div className={`flex flex-col items-center text-center ${disabled ? "opacity-60" : ""}`}>
      <button
        className="bg-base-100 border border-base-200 rounded-2xl shadow hover:shadow-md transition w-24 h-24 sm:w-24 sm:h-24 md:w-28 md:h-28 flex items-center justify-center"
        onClick={() => onOpen(app)}
        type="button"
      >
        {LucideIcon ? (
          <div className="text-primary">
            <LucideIcon size={44} strokeWidth={1.4} className="sm:w-12 sm:h-12 md:w-14 md:h-14" />
          </div>
        ) : HeroIcon ? (
          <div className="text-primary">
            <HeroIcon className="w-11 h-11 sm:w-12 sm:h-12 md:w-14 md:h-14" />
          </div>
        ) : isImageUrl ? (
          <img src={iconUrl} alt={app.name} className="w-16 h-16 sm:w-18 sm:h-18 md:w-24 md:h-24 object-contain" />
        ) : (
          <div className="text-[2.75rem] sm:text-5xl text-primary">{icon}</div>
        )}
      </button>
      <div className="mt-2 w-24 sm:w-24 md:w-28 text-[11px] sm:text-xs font-semibold leading-tight line-clamp-2">{app.name}</div>
    </div>
  );
}

export default function HomePage({ user }) {
  const { modules, loading } = useModuleStore();
  const navigate = useNavigate();
  const [entityIndex, setEntityIndex] = useState(null);
  const [iconVersion, setIconVersion] = useState(0);
  const { loading: accessLoading, hasCapability, isSuperadmin } = useAccessContext();
  const canSeeStudio = !accessLoading && hasCapability("modules.manage");
  const canSeeOctoAi = !accessLoading && isSuperadmin;
  const canSeeAutomations = !accessLoading && hasCapability("automations.manage");
  const canSeeIntegrations = !accessLoading && hasCapability("workspace.manage_settings");
  const homeLoading = loading || accessLoading;

  useEffect(() => {
    async function buildIndex() {
      if (!user) return;
      const index = await loadEntityIndex(modules);
      setEntityIndex(index);
    }
    buildIndex();
  }, [modules, user]);

  useEffect(() => {
    return subscribeAppIcons(() => setIconVersion((v) => v + 1));
  }, []);

  const systemApps = [
    { id: "apps", name: "App Manager", route: "/apps", system: true, icon: <LayoutGrid size={56} strokeWidth={1.31} className="text-primary" /> },
    ...(canSeeStudio ? [{ id: "studio", name: "Studio", route: "/studio", system: true, icon: <PenTool size={56} strokeWidth={1.31} className="text-primary" /> }] : []),
    ...(canSeeOctoAi ? [{ id: "octo_ai", name: "Octo AI", route: "/octo-ai", system: true, icon: <Sparkles size={56} strokeWidth={1.31} className="text-primary" /> }] : []),
    ...(canSeeAutomations ? [{ id: "automations", name: "Automations", route: "/automations", system: true, icon: <Workflow size={56} strokeWidth={1.31} className="text-primary" /> }] : []),
    ...(canSeeIntegrations ? [{ id: "integrations", name: "Integrations", route: "/integrations", system: true, icon: <Wrench size={56} strokeWidth={1.31} className="text-primary" /> }] : []),
    { id: "settings", name: "Settings", route: "/settings", system: true, icon: <SettingsIcon size={56} strokeWidth={1.31} className="text-primary" /> },
  ].map((app) => ({ ...app, icon_url: getAppIcon(app.id) }));

  const installedApps = useMemo(() => {
    return modules
      .filter((m) => m.enabled && (isSuperadmin || m.module_id !== "octo_ai"))
      .map((m) => ({
        id: m.module_id,
        name: getAppDisplayName(m.module_id, m),
        module: m,
        system: false,
        icon: <Package size={56} strokeWidth={1.31} className="text-primary" />,
        icon_url: m.icon_key || null,
      }));
  }, [iconVersion, isSuperadmin, modules, user]);

  function handleOpen(app) {
    if (app.system) {
      navigate(appendOctoAiFrameParams(app.route));
      return;
    }
    const route = getDefaultOpenRoute(app.id, entityIndex);
    navigate(appendOctoAiFrameParams(route));
  }

  const allApps = useMemo(() => {
    return [...installedApps, ...systemApps];
  }, [installedApps, systemApps]);

  return (
    <div className="w-full min-h-full md:h-full flex justify-center overflow-x-hidden overflow-y-auto md:overflow-hidden">
      {homeLoading && <LoadingSpinner className="min-h-full w-full" />}
      {!homeLoading && (
        <div className="w-full flex justify-center items-start pt-4 sm:pt-[12vh] pb-6 sm:pb-0">
          {allApps.length === 0 ? (
            <div className="card bg-base-100 shadow p-6">
              <div className="text-sm opacity-70 mb-3">No apps installed yet.</div>
              <button className="btn btn-primary w-fit" onClick={() => navigate(appendOctoAiFrameParams("/apps"))}>
                Open Modules
              </button>
            </div>
          ) : (
            <div className="w-full flex justify-center">
              <div className="grid w-full max-w-[728px] gap-x-2 gap-y-4 px-3 sm:px-4 justify-items-center grid-cols-3 sm:grid-cols-4 md:grid-cols-5">
                {allApps.map((app) => (
                  <AppTile key={app.id} app={app} module={app.module} onOpen={handleOpen} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
