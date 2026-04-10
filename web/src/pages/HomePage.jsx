// HomePage is the system landing page showing installed apps.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useModuleStore } from "../state/moduleStore.jsx";
import { getAppDisplayName } from "../state/appCatalog.js";
import { getAppIcon, subscribeAppIcons } from "../state/appIcons.js";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import { LayoutGrid, Package, Settings as SettingsIcon, Sparkles } from "lucide-react";
import { useAccessContext } from "../access.js";
import { appendOctoAiFrameParams, deriveAppHomeRoute } from "../apps/appShellUtils.js";
import AppModuleIcon from "../components/AppModuleIcon.jsx";
import { getUiPrefs, setModuleOrder, setUiPrefs } from "../api.js";
import { useToast } from "../components/Toast.jsx";

function moveIdBefore(ids, sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) return ids;
  const next = ids.filter((id) => id !== sourceId);
  const targetIndex = next.indexOf(targetId);
  if (targetIndex === -1) return ids;
  next.splice(targetIndex, 0, sourceId);
  return next;
}

function arraysEqual(left, right) {
  if (left === right) return true;
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function applyOrderedIds(items, orderIds) {
  if (!Array.isArray(items) || items.length === 0) return [];
  if (!Array.isArray(orderIds) || orderIds.length === 0) return items;
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered = orderIds.map((id) => byId.get(id)).filter(Boolean);
  const remaining = items.filter((item) => !orderIds.includes(item.id));
  return [...ordered, ...remaining];
}

function AppTile({
  app,
  module,
  onOpen,
  draggable = false,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  isDragging = false,
}) {
  const disabled = module && !module.enabled;
  const icon = app.icon;
  const iconUrl = app.icon_url;
  return (
    <div
      className={`flex flex-col items-center text-center ${disabled ? "opacity-60" : ""} ${isDragging ? "opacity-50" : ""}`}
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      onDragOver={draggable ? onDragOver : undefined}
      onDrop={draggable ? onDrop : undefined}
    >
      <button
        className="bg-base-100 border border-base-200 rounded-2xl shadow hover:shadow-md transition w-24 h-24 sm:w-24 sm:h-24 md:w-28 md:h-28 flex items-center justify-center"
        onClick={() => onOpen(app)}
        type="button"
      >
        <AppModuleIcon
          iconUrl={iconUrl}
          size={44}
          strokeWidth={1.4}
          iconClassName="text-primary"
          imageClassName="w-16 h-16 sm:w-18 sm:h-18 md:w-24 md:h-24 object-contain"
          fallback={<div className="text-[2.75rem] sm:text-5xl text-primary">{icon}</div>}
        />
      </button>
      <div className="mt-2 w-24 sm:w-24 md:w-28 text-[11px] sm:text-xs font-semibold leading-tight line-clamp-2">{app.name}</div>
    </div>
  );
}

export default function HomePage({ user }) {
  const { modules, loading, actions } = useModuleStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [iconVersion, setIconVersion] = useState(0);
  const [openingAppId, setOpeningAppId] = useState("");
  const [draggingAppId, setDraggingAppId] = useState("");
  const [savedHomeOrderIds, setSavedHomeOrderIds] = useState([]);
  const [homeOrderIds, setHomeOrderIds] = useState([]);
  const [reorderBusy, setReorderBusy] = useState(false);
  const dragDropCommittedRef = useRef(false);
  const { isSuperadmin, hasCapability } = useAccessContext();
  const { pushToast } = useToast();
  const canSeeOctoAi = Boolean(isSuperadmin);
  const canReorderApps = hasCapability("modules.manage");
  const homeLoading = loading;
  const transitioningToApp = Boolean(openingAppId);

  useEffect(() => {
    return subscribeAppIcons(() => setIconVersion((v) => v + 1));
  }, []);

  const systemApps = [
    { id: "apps", name: "App Manager", route: "/apps", system: true, icon: <LayoutGrid size={56} strokeWidth={1.31} className="text-primary" /> },
    ...(canSeeOctoAi ? [{ id: "octo_ai", name: "Octo AI", route: "/octo-ai", system: true, icon: <Sparkles size={56} strokeWidth={1.31} className="text-primary" /> }] : []),
    { id: "settings", name: "Settings", route: "/settings", system: true, icon: <SettingsIcon size={56} strokeWidth={1.31} className="text-primary" /> },
  ].map((app) => ({ ...app, icon_url: getAppIcon(app.id) }));

  const installedApps = useMemo(() => {
    return modules
      .filter((m) => m.enabled && (isSuperadmin || m.module_id !== "octo_ai"))
      .slice()
      .sort((a, b) => {
        const aOrder = Number.isFinite(a.display_order) ? a.display_order : Number.MAX_SAFE_INTEGER;
        const bOrder = Number.isFinite(b.display_order) ? b.display_order : Number.MAX_SAFE_INTEGER;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return `${a.module_id || ""}`.localeCompare(`${b.module_id || ""}`);
      })
      .map((m) => ({
        id: m.module_id,
        name: getAppDisplayName(m.module_id, m),
        module: m,
        system: false,
        icon: <Package size={56} strokeWidth={1.31} className="text-primary" />,
        icon_url: m.icon_key || null,
      }));
  }, [iconVersion, isSuperadmin, modules, user]);

  useEffect(() => {
    let active = true;
    async function loadWorkspaceHomeOrder() {
      if (!user) return;
      try {
        const prefs = await getUiPrefs();
        if (!active) return;
        const order = prefs?.workspace?.layout_prefs?.home_app_order;
        const normalized = Array.isArray(order) ? order.filter((id) => typeof id === "string" && id.trim()) : [];
        setSavedHomeOrderIds(normalized);
        setHomeOrderIds(normalized);
      } catch {
        if (!active) return;
        setSavedHomeOrderIds([]);
        setHomeOrderIds([]);
      }
    }
    loadWorkspaceHomeOrder();
    return () => {
      active = false;
    };
  }, [user]);

  const allBaseApps = useMemo(() => [...installedApps, ...systemApps], [installedApps, systemApps]);

  async function handleOpen(app) {
    setOpeningAppId(app.id || "app");
    if (app.system) {
      navigate(appendOctoAiFrameParams(app.route));
      return;
    }
    const targetRoute =
      (typeof app?.module?.home_route === "string" && app.module.home_route) ||
      deriveAppHomeRoute(app.id, null, { searchLike: location.search }) ||
      `/apps/${app.id}`;
    navigate(appendOctoAiFrameParams(targetRoute, location.search));
  }

  const allApps = useMemo(() => applyOrderedIds(allBaseApps, homeOrderIds), [allBaseApps, homeOrderIds]);

  const baseOrderedIds = useMemo(() => {
    return applyOrderedIds(allBaseApps, savedHomeOrderIds).map((app) => app.id);
  }, [allBaseApps, savedHomeOrderIds]);

  async function persistHomeOrder(nextOrderIds) {
    setReorderBusy(true);
    setHomeOrderIds(nextOrderIds);
    try {
      const moduleIdSet = new Set(modules.map((module) => module.module_id));
      const currentInstalledOrderIds = installedApps.map((app) => app.id);
      const nextInstalledOrderIds = nextOrderIds.filter((id) => moduleIdSet.has(id));
      const installedOrderChanged = !arraysEqual(currentInstalledOrderIds, nextInstalledOrderIds);

      if (installedOrderChanged) {
        await Promise.all(nextInstalledOrderIds.map((id, index) => setModuleOrder(id, index + 1)));
      }

      await setUiPrefs({
        workspace: {
          layout_prefs: {
            home_app_order: nextOrderIds,
          },
        },
      });
      const prefs = await getUiPrefs();
      const persistedOrder = prefs?.workspace?.layout_prefs?.home_app_order;
      const normalizedPersistedOrder = Array.isArray(persistedOrder)
        ? persistedOrder.filter((id) => typeof id === "string" && id.trim())
        : nextOrderIds;
      const mergedPersistedOrder = applyOrderedIds(allBaseApps, normalizedPersistedOrder).map((app) => app.id);
      setSavedHomeOrderIds(mergedPersistedOrder);
      setHomeOrderIds(mergedPersistedOrder);
      if (installedOrderChanged) {
        await actions.refresh({ force: true });
      }
    } catch (err) {
      setHomeOrderIds(baseOrderedIds);
      pushToast("error", err?.message || "Failed to save app order");
    } finally {
      setReorderBusy(false);
      setDraggingAppId("");
    }
  }

  function handleTileDragStart(appId) {
    if (!canReorderApps || reorderBusy) return;
    dragDropCommittedRef.current = false;
    setDraggingAppId(appId);
  }

  function handleTileDragOver(event, targetId) {
    if (!canReorderApps || reorderBusy || !draggingAppId || draggingAppId === targetId) return;
    event.preventDefault();
    setHomeOrderIds((current) => {
      const source = current.length ? current : baseOrderedIds;
      return moveIdBefore(source, draggingAppId, targetId);
    });
  }

  async function handleTileDrop(event, targetId) {
    event.preventDefault();
    if (!canReorderApps || reorderBusy || !draggingAppId || draggingAppId === targetId) {
      setDraggingAppId("");
      return;
    }
    dragDropCommittedRef.current = true;
    const source = homeOrderIds.length ? homeOrderIds : baseOrderedIds;
    const nextOrderIds = moveIdBefore(source, draggingAppId, targetId);
    await persistHomeOrder(nextOrderIds);
  }

  function handleTileDragEnd() {
    if (reorderBusy) return;
    setDraggingAppId("");
    if (dragDropCommittedRef.current) {
      dragDropCommittedRef.current = false;
      return;
    }
    setHomeOrderIds(baseOrderedIds);
  }

  return (
    <div className="w-full overflow-x-hidden min-h-full md:h-full flex justify-center overflow-y-auto md:overflow-hidden">
      {(homeLoading || transitioningToApp) && <LoadingSpinner className="min-h-full w-full" />}
      {!homeLoading && !transitioningToApp && (
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
              <div className="grid w-full gap-x-2 gap-y-4 justify-items-center grid-cols-3 sm:grid-cols-4 md:grid-cols-5 max-w-[728px] px-3 sm:px-4">
                {allApps.map((app) => (
                  <AppTile
                    key={app.id}
                    app={app}
                    module={app.module}
                    onOpen={handleOpen}
                    draggable={canReorderApps}
                    isDragging={draggingAppId === app.id}
                    onDragStart={() => handleTileDragStart(app.id)}
                    onDragEnd={handleTileDragEnd}
                    onDragOver={(event) => handleTileDragOver(event, app.id)}
                    onDrop={(event) => handleTileDrop(event, app.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
