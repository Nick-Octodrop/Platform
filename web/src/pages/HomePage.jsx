// HomePage is the system landing page showing installed apps.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useModuleStore } from "../state/moduleStore.jsx";
import { getAppDisplayName, getAppTranslationNamespaces } from "../state/appCatalog.js";
import { getAppIcon, subscribeAppIcons } from "../state/appIcons.js";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import { Package } from "lucide-react";
import { useAccessContext } from "../access.js";
import { appendOctoAiFrameParams, deriveAppHomeRoute } from "../apps/appShellUtils.js";
import AppModuleIcon from "../components/AppModuleIcon.jsx";
import { getUiPrefs, peekUiPrefsCache, setUiPrefs } from "../api.js";
import { useToast } from "../components/Toast.jsx";
import { useI18n } from "../i18n/LocalizationProvider.jsx";
import { ensureRuntimeNamespaces } from "../i18n/runtime.js";

function swapIds(ids, sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) return ids;
  const sourceIndex = ids.indexOf(sourceId);
  const targetIndex = ids.indexOf(targetId);
  if (sourceIndex === -1 || targetIndex === -1) return ids;
  const next = [...ids];
  const temp = next[sourceIndex];
  next[sourceIndex] = next[targetIndex];
  next[targetIndex] = temp;
  return next;
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
  onDragEnter,
  onDragOver,
  onDrop,
  isDragging = false,
  isDropTarget = false,
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
      onDragEnter={draggable ? onDragEnter : undefined}
      onDragOver={draggable ? onDragOver : undefined}
      onDrop={draggable ? onDrop : undefined}
    >
      <button
        className={`bg-base-100 border rounded-2xl shadow hover:shadow-md transition w-24 h-24 sm:w-24 sm:h-24 md:w-28 md:h-28 flex items-center justify-center ${
          isDropTarget ? "border-primary shadow-md" : "border-base-200"
        }`}
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
  const { t, locale, version, workspaceKey } = useI18n();
  const { modules, loading } = useModuleStore();
  const navigate = useNavigate();
  const location = useLocation();
  const initialPrefs = peekUiPrefsCache();
  const initialHomeOrder = Array.isArray(initialPrefs?.workspace?.layout_prefs?.home_app_order)
    ? initialPrefs.workspace.layout_prefs.home_app_order.filter((id) => typeof id === "string" && id.trim())
    : [];
  const [iconVersion, setIconVersion] = useState(0);
  const [openingAppId, setOpeningAppId] = useState("");
  const [draggingAppId, setDraggingAppId] = useState("");
  const [dropTargetId, setDropTargetId] = useState("");
  const [savedHomeOrderIds, setSavedHomeOrderIds] = useState(initialHomeOrder);
  const [homeOrderIds, setHomeOrderIds] = useState(initialHomeOrder);
  const [layoutLoading, setLayoutLoading] = useState(() => Boolean(user) && initialHomeOrder.length === 0);
  const [reorderBusy, setReorderBusy] = useState(false);
  const dragDropCommittedRef = useRef(false);
  const dragStartOrderIdsRef = useRef([]);
  const { isSuperadmin, hasCapability } = useAccessContext();
  const { pushToast } = useToast();
  const canSeeOctoAi = Boolean(isSuperadmin);
  const canReorderApps = hasCapability("modules.manage");
  const homeLoading = loading || layoutLoading;
  const transitioningToApp = Boolean(openingAppId);

  useEffect(() => {
    return subscribeAppIcons(() => setIconVersion((v) => v + 1));
  }, []);

  const systemApps = [
    { id: "apps", name: t("navigation.app_manager"), route: "/apps", system: true, icon_url: getAppIcon("apps") || "lucide:layout-grid" },
    ...(canSeeOctoAi
      ? [{ id: "octo_ai", name: t("navigation.octo_ai"), route: "/octo-ai", system: true, icon_url: getAppIcon("octo_ai") || "lucide:sparkles" }]
      : []),
    { id: "settings", name: t("navigation.settings"), route: "/settings", system: true, icon_url: getAppIcon("settings") || "lucide:settings" },
  ];

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
        icon: <Package size={44} strokeWidth={1.4} className="text-primary" />,
        icon_url: m.icon_key || "lucide:package",
      }));
  }, [iconVersion, isSuperadmin, locale, modules, version]);

  useEffect(() => {
    const namespaces = getAppTranslationNamespaces(modules);
    if (namespaces.length === 0) return;
    ensureRuntimeNamespaces(namespaces).catch(() => {});
  }, [locale, modules]);

  useEffect(() => {
    let active = true;
    async function loadWorkspaceHomeOrder() {
      if (!user) {
        setLayoutLoading(false);
        return;
      }
      const cachedPrefs = peekUiPrefsCache();
      if (cachedPrefs) {
        const cachedOrder = Array.isArray(cachedPrefs?.workspace?.layout_prefs?.home_app_order)
          ? cachedPrefs.workspace.layout_prefs.home_app_order.filter((id) => typeof id === "string" && id.trim())
          : [];
        setSavedHomeOrderIds(cachedOrder);
        setHomeOrderIds(cachedOrder);
        setLayoutLoading(false);
        return;
      }
      setLayoutLoading(true);
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
      } finally {
        if (active) setLayoutLoading(false);
      }
    }
    loadWorkspaceHomeOrder();
    return () => {
      active = false;
    };
  }, [user, workspaceKey]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    function handleWorkspaceChanged() {
      setHomeOrderIds([]);
      setSavedHomeOrderIds([]);
      setLayoutLoading(Boolean(user));
    }
    window.addEventListener("octo:workspace-changed", handleWorkspaceChanged);
    return () => window.removeEventListener("octo:workspace-changed", handleWorkspaceChanged);
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

  const baseOrderedIds = useMemo(() => {
    return applyOrderedIds(allBaseApps, savedHomeOrderIds).map((app) => app.id);
  }, [allBaseApps, savedHomeOrderIds]);

  const previewOrderIds = useMemo(() => {
    const source = homeOrderIds.length ? homeOrderIds : baseOrderedIds;
    if (!draggingAppId || !dropTargetId || draggingAppId === dropTargetId) return source;
    return swapIds(source, draggingAppId, dropTargetId);
  }, [baseOrderedIds, draggingAppId, dropTargetId, homeOrderIds]);

  const allApps = useMemo(() => applyOrderedIds(allBaseApps, previewOrderIds), [allBaseApps, previewOrderIds]);

  async function persistHomeOrder(nextOrderIds) {
    setReorderBusy(true);
    const normalizedNextOrder = applyOrderedIds(allBaseApps, nextOrderIds).map((app) => app.id);
    setHomeOrderIds(normalizedNextOrder);
    try {
      await setUiPrefs({
        workspace: {
          layout_prefs: {
            home_app_order: normalizedNextOrder,
          },
        },
      });
      setSavedHomeOrderIds(normalizedNextOrder);
      setHomeOrderIds(normalizedNextOrder);
    } catch (err) {
      setHomeOrderIds(baseOrderedIds);
      pushToast("error", err?.message || t("common.save_failed"));
    } finally {
      setReorderBusy(false);
      setDraggingAppId("");
      setDropTargetId("");
    }
  }

  function handleTileDragStart(event, appId) {
    if (!canReorderApps || reorderBusy) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", appId);
    dragStartOrderIdsRef.current = homeOrderIds.length ? homeOrderIds : baseOrderedIds;
    dragDropCommittedRef.current = false;
    setDraggingAppId(appId);
    setDropTargetId(appId);
  }

  function handleTileDragEnter(targetId) {
    if (!canReorderApps || reorderBusy || !draggingAppId || draggingAppId === targetId) return;
    setDropTargetId(targetId);
  }

  function handleTileDragOver(event, targetId) {
    if (!canReorderApps || reorderBusy || !draggingAppId || draggingAppId === targetId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dropTargetId !== targetId) {
      setDropTargetId(targetId);
    }
  }

  async function handleTileDrop(event, targetId) {
    event.preventDefault();
    if (!canReorderApps || reorderBusy || !draggingAppId || draggingAppId === targetId) {
      setDraggingAppId("");
      setDropTargetId("");
      return;
    }
    dragDropCommittedRef.current = true;
    const source = dragStartOrderIdsRef.current.length ? dragStartOrderIdsRef.current : homeOrderIds.length ? homeOrderIds : baseOrderedIds;
    const nextOrderIds = swapIds(source, draggingAppId, dropTargetId || targetId);
    await persistHomeOrder(nextOrderIds);
  }

  function handleTileDragEnd() {
    if (reorderBusy) return;
    if (dragDropCommittedRef.current) {
      dragDropCommittedRef.current = false;
      dragStartOrderIdsRef.current = [];
      setDraggingAppId("");
      setDropTargetId("");
      return;
    }
    if (draggingAppId && dropTargetId && draggingAppId !== dropTargetId) {
      dragDropCommittedRef.current = true;
      const source = dragStartOrderIdsRef.current.length ? dragStartOrderIdsRef.current : baseOrderedIds;
      void persistHomeOrder(swapIds(source, draggingAppId, dropTargetId));
      return;
    }
    dragStartOrderIdsRef.current = [];
    setDraggingAppId("");
    setDropTargetId("");
    setHomeOrderIds(baseOrderedIds);
  }

  return (
    <div className="w-full overflow-x-hidden min-h-full md:h-full flex justify-center overflow-y-auto md:overflow-hidden">
      {(homeLoading || transitioningToApp) && <LoadingSpinner className="min-h-full w-full" />}
      {!homeLoading && !transitioningToApp && (
        <div className="w-full flex justify-center items-start pt-4 sm:pt-[12vh] pb-6 sm:pb-0">
          {allApps.length === 0 ? (
            <div className="card bg-base-100 shadow p-6">
              <div className="text-sm opacity-70 mb-3">{t("empty.no_apps_installed")}</div>
              <button className="btn btn-primary w-fit" onClick={() => navigate(appendOctoAiFrameParams("/apps"))}>
                {t("navigation.apps")}
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
                    isDropTarget={Boolean(draggingAppId) && dropTargetId === app.id && draggingAppId !== app.id}
                    onDragStart={(event) => handleTileDragStart(event, app.id)}
                    onDragEnd={handleTileDragEnd}
                    onDragEnter={() => handleTileDragEnter(app.id)}
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
