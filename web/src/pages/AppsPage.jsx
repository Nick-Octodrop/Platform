// AppsPage is system-level "Home" (not a module). It manages installable modules.
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useModuleStore } from "../state/moduleStore.jsx";
import { useToast } from "../components/Toast.jsx";
import { getAppDescription, getAppDisplayName, getAppTranslationNamespaces } from "../state/appCatalog.js";
import { recordRecentApp } from "../state/appUsage.js";
import { apiFetch, invalidateModulesCache, setModuleIcon, setModuleOrder } from "../api.js";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import { MoreVertical, Package } from "lucide-react";
import { loadLucideIconList } from "../state/lucideIconCatalog.js";
import {
  HERO_ICON_FAMILIES,
  heroKey,
  normalizeHeroFamily,
  loadHeroIconList,
} from "../state/heroIconCatalog.js";
import { useAccessContext } from "../access.js";
import SystemListToolbar from "../ui/SystemListToolbar.jsx";
import { appendOctoAiFrameParams, deriveAppHomeRoute } from "../apps/appShellUtils.js";
import useMediaQuery from "../hooks/useMediaQuery.js";
import { DESKTOP_PAGE_SHELL, DESKTOP_PAGE_SHELL_BODY } from "../ui/pageShell.js";
import AppModuleIcon from "../components/AppModuleIcon.jsx";
import { useI18n } from "../i18n/LocalizationProvider.jsx";
import { ensureRuntimeNamespaces } from "../i18n/runtime.js";

// Kept intentionally minimal: App Manager cards shouldn't surface extra status/meta beyond actions + app version.

function AppIcon({ app }) {
  const iconUrl = app.icon_url;
  return (
    <AppModuleIcon
      iconUrl={iconUrl}
      size={44}
      strokeWidth={1.31}
      iconClassName="text-primary"
      imageClassName="w-11 h-11 object-contain"
      fallback={<div className="flex items-center justify-center text-primary">{app.icon}</div>}
    />
  );
}

const SETTINGS_CARD_CLASS = "border rounded-box p-4 bg-base-100 shadow-sm flex flex-col min-h-[140px]";

export default function AppsPage({ user }) {
  const { locale, t, version } = useI18n();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const { modules, loading, error, actions } = useModuleStore();
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("all"); // all | installed | marketplace
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteMode, setDeleteMode] = useState("keep_records"); // keep_records | delete_records
  const [forceConfirm, setForceConfirm] = useState("");
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [iconPickerApp, setIconPickerApp] = useState(null);
  const [iconQuery, setIconQuery] = useState("");
  const [iconLibrary, setIconLibrary] = useState("lucide");
  const [heroFamily, setHeroFamily] = useState("24/outline");
  const [lucideIconList, setLucideIconList] = useState([]);
  const [heroIconLists, setHeroIconLists] = useState({});
  const [iconCatalogLoading, setIconCatalogLoading] = useState(false);
  const [marketplaceApps, setMarketplaceApps] = useState([]);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [marketplaceError, setMarketplaceError] = useState("");
  const [initialMarketplaceSettled, setInitialMarketplaceSettled] = useState(false);
  const [marketplaceCloneBusy, setMarketplaceCloneBusy] = useState("");
  const [openMenuId, setOpenMenuId] = useState("");
  const { hasCapability, isSuperadmin } = useAccessContext();
  const canManageModules = hasCapability("modules.manage");


  const moduleById = useMemo(() => {
    const map = new Map();
    for (const m of modules) map.set(m.module_id, m);
    return map;
  }, [modules]);

  useEffect(() => {
    const namespaces = getAppTranslationNamespaces(modules);
    if (namespaces.length === 0) return;
    ensureRuntimeNamespaces(namespaces).catch(() => {});
  }, [locale, modules]);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    setInitialMarketplaceSettled(false);
    refreshMarketplace(() => alive);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function refreshMarketplace(isAlive = () => true) {
    if (!user) return;
    setMarketplaceLoading(true);
    setMarketplaceError("");
    try {
      const res = await apiFetch("/marketplace/apps");
      if (!isAlive()) return;
      setMarketplaceApps(Array.isArray(res?.apps) ? res.apps : []);
    } catch (err) {
      if (!isAlive()) return;
      setMarketplaceError(err?.message || t("settings.apps_page.marketplace_load_failed"));
    } finally {
      if (isAlive()) {
        setMarketplaceLoading(false);
        setInitialMarketplaceSettled(true);
      }
    }
  }

  async function toggleModule(moduleId, enabled) {
    try {
      if (enabled) {
        await actions.enableModule(moduleId);
        pushToast("success", t("settings.apps_page.module_enabled"));
      } else {
        await actions.disableModule(moduleId);
        pushToast("info", t("settings.apps_page.module_disabled"));
      }
      await actions.refresh({ force: true });
    } catch (err) {
      pushToast("error", err.message || t("common.app_shell.action_failed"));
    }
  }

  async function handleOpen(moduleId) {
    recordRecentApp(moduleId);
    const moduleRecord = moduleById.get(moduleId);
    const targetRoute =
      (typeof moduleRecord?.home_route === "string" && moduleRecord.home_route) ||
      deriveAppHomeRoute(moduleId, null) ||
      `/apps/${moduleId}`;
    navigate(appendOctoAiFrameParams(targetRoute));
  }

  function handleDetails(moduleId) {
    navigate(`/settings/diagnostics/${encodeURIComponent(moduleId)}`);
  }

  function openDelete(moduleId) {
    setDeleteTarget(moduleId);
    setDeleteConfirm("");
    setDeleteMode("keep_records");
    setForceConfirm("");
  }

  function closeDelete() {
    setDeleteTarget(null);
    setDeleteConfirm("");
    setDeleteMode("keep_records");
    setForceConfirm("");
  }

  async function handleSetOrder(app) {
    const current = app.module?.display_order;
    const next = window.prompt(t("settings.apps_page.display_order_prompt"), current ?? "");
    if (next === null) return;
    const trimmed = `${next}`.trim();
    const value = trimmed === "" ? null : Number(trimmed);
    if (trimmed !== "" && !Number.isInteger(value)) {
      pushToast("error", t("settings.apps_page.display_order_integer"));
      return;
    }
    try {
      await setModuleOrder(app.id, value);
      await actions.refresh({ force: true });
    } catch (err) {
      pushToast("error", err.message || t("settings.apps_page.display_order_set_failed"));
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      const opts = deleteMode === "delete_records" ? { force: true } : { archive: true };
      await actions.deleteModule(deleteTarget, opts);
      pushToast(
        "success",
        deleteMode === "delete_records"
          ? t("settings.apps_page.module_deleted_records_removed")
          : t("settings.apps_page.module_removed_records_kept")
      );
      invalidateModulesCache();
      await actions.refresh({ force: true });
    } catch (err) {
      pushToast("error", err.message || t("common.delete_failed"));
    } finally {
      closeDelete();
    }
  }

  async function cloneMarketplaceApp(app) {
    if (!app?.id || marketplaceCloneBusy) return;
    setMarketplaceCloneBusy(app.id);
    try {
      const res = await apiFetch(`/marketplace/apps/${app.id}/clone`, { method: "POST", body: {} });
      const newId = res?.module_id || res?.data?.module_id;
      pushToast(
        "success",
        t("settings.apps_page.cloned_disabled", {
          name: app.title || app.slug || t("common.app"),
          suffix: newId ? ` (${newId})` : "",
        })
      );
      await actions.refresh({ force: true });
    } catch (err) {
      pushToast("error", err?.message || t("settings.apps_page.clone_failed"));
    } finally {
      setMarketplaceCloneBusy("");
    }
  }

  async function deleteMarketplaceApp(app) {
    if (!app?.id) return;
    const confirm = window.prompt(t("settings.apps_page.marketplace_delete_prompt"));
    if (confirm !== "DELETE") return;
    try {
      await apiFetch(`/marketplace/apps/${app.id}`, { method: "DELETE" });
      pushToast("success", t("settings.apps_page.marketplace_deleted"));
      await refreshMarketplace();
    } catch (err) {
      pushToast("error", err?.message || t("settings.apps_page.marketplace_delete_failed"));
    }
  }

  function closeAppMenu() {
    setOpenMenuId("");
  }

  if (!user) {
    return <div className="alert">{t("settings.apps_page.login_required")}</div>;
  }

  const items = useMemo(() => {
    const installed = modules
      .filter((m) => isSuperadmin || m.module_id !== "octo_ai")
      .map((m) => ({
      kind: "installed",
      id: m.module_id,
      title: getAppDisplayName(m.module_id, m),
      description: getAppDescription(m),
      module_version: m.module_version || "",
      module: m,
      icon: <Package size={64} strokeWidth={1.31} className="text-primary" />,
      icon_url: m.icon_key || null,
      keywords: ["installed", m.module_id, m.name || "", m.description || "", m.name_key || "", m.description_key || ""].filter(Boolean),
    }));
    const marketplace = (Array.isArray(marketplaceApps) ? marketplaceApps : [])
      .filter((a) => isSuperadmin || (a.id !== "octo_ai" && a.source_module_id !== "octo_ai"))
      .map((a) => ({
      kind: "marketplace",
      id: a.id,
      title: a.title || a.slug || "App",
      description: a.description || "",
      source_module_id: a.source_module_id,
      icon_url: a.icon_url || null,
      module_version: a.module_version || "",
      keywords: ["marketplace", a.slug, a.title, a.source_module_id, a.description].filter(Boolean),
    }));
    return [...installed, ...marketplace];
  }, [isSuperadmin, locale, marketplaceApps, modules, version]);

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (activeFilter !== "all" && item.kind !== activeFilter) return false;
      if (!needle) return true;
      const keywords = Array.isArray(item.keywords) ? item.keywords.join(" ") : "";
      const haystack = `${item.title || ""} ${item.description || ""} ${item.id || ""} ${keywords}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [activeFilter, items, query]);

  const needsInstalled = activeFilter !== "marketplace";
  const needsMarketplace = activeFilter !== "installed";
  const showInitialLoading =
    (needsInstalled && loading && modules.length === 0) ||
    (needsMarketplace && !initialMarketplaceSettled);

  useEffect(() => {
    let active = true;
    async function loadCatalog() {
      if (!iconPickerOpen) return;
      setIconCatalogLoading(true);
      try {
        if (iconLibrary === "lucide") {
          const list = await loadLucideIconList();
          if (active) setLucideIconList(Array.isArray(list) ? list : []);
        } else {
          const normalizedFamily = normalizeHeroFamily(heroFamily);
          if (!heroIconLists[normalizedFamily]) {
            const list = await loadHeroIconList(normalizedFamily);
            if (active) {
              setHeroIconLists((prev) => ({
                ...prev,
                [normalizedFamily]: Array.isArray(list) ? list : [],
              }));
            }
          }
        }
      } finally {
        if (active) setIconCatalogLoading(false);
      }
    }
    loadCatalog();
    return () => {
      active = false;
    };
  }, [heroFamily, heroIconLists, iconLibrary, iconPickerOpen]);

  const filteredLucideIcons = useMemo(() => {
    const q = iconQuery.trim().toLowerCase();
    if (!q) return lucideIconList;
    return lucideIconList.filter((icon) => icon.name.toLowerCase().includes(q));
  }, [iconQuery, lucideIconList]);

  const filteredHeroIcons = useMemo(() => {
    const q = iconQuery.trim().toLowerCase();
    const source = heroIconLists[normalizeHeroFamily(heroFamily)] || [];
    if (!q) return source;
    return source.filter((icon) => icon.name.toLowerCase().includes(q));
  }, [heroFamily, heroIconLists, iconQuery]);

  return (
    <div className="min-h-full md:h-full md:min-h-0 md:flex md:flex-col md:overflow-hidden">
      <div className={DESKTOP_PAGE_SHELL}>
        <div className={DESKTOP_PAGE_SHELL_BODY}>
          <div className="shrink-0">
            <SystemListToolbar
              title={t("settings.apps_page.title")}
              searchValue={query}
              onSearchChange={setQuery}
              filters={[
                { id: "all", label: t("common.all") },
                { id: "installed", label: t("settings.apps_page.installed") },
                { id: "marketplace", label: t("settings.apps_page.marketplace") },
              ]}
              onFilterChange={setActiveFilter}
              onClearFilters={() => setActiveFilter("all")}
              onRefresh={async () => {
                await actions.refresh({ force: true });
                await refreshMarketplace();
              }}
              showListToggle={false}
            />
          </div>
          <div className="mt-4 md:flex-1 md:min-h-0 md:overflow-y-auto md:overflow-x-hidden">
            {showInitialLoading && <LoadingSpinner />}
            {error && <div className="alert alert-error mb-4">{error}</div>}
            {marketplaceError && <div className="alert alert-error mb-4">{marketplaceError}</div>}

            {!showInitialLoading && filteredItems.length === 0 ? (
              <div className="text-sm opacity-60">{t("settings.apps_page.no_apps_match")}</div>
            ) : null}

            {!showInitialLoading && filteredItems.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredItems.map((item) => {
                  if (item.kind === "marketplace") {
                    const marketplaceRow = marketplaceApps.find((a) => a.id === item.id);
                    const app = {
                      id: item.id,
                      name: item.title,
                      icon: <Package size={44} strokeWidth={1.31} className="text-primary" />,
                      icon_url: item.icon_url || "lucide:package",
                    };
                    const sourceId = item.source_module_id || item.id;
                    return (
                      <div key={`mkt-${item.id}`} className={`${SETTINGS_CARD_CLASS} border-base-300`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex items-start gap-3">
                            <div className="w-10 h-10 bg-transparent flex items-center justify-center shrink-0">
                              <AppIcon app={app} />
                            </div>
                            <div className="min-w-0">
                              <div className="text-base font-semibold truncate">{item.title}</div>
                              <div className="text-xs opacity-60 mt-1 flex flex-wrap items-center gap-2">
                                <span className="font-mono">{sourceId}</span>
                                {item.module_version ? <span className="font-mono opacity-60">V {item.module_version}</span> : null}
                              </div>
                            </div>
                          </div>
                          <div className="shrink-0 flex items-center gap-2">
                            {canManageModules ? (
                              <button
                                className="btn btn-sm btn-primary"
                                onClick={() =>
                                  cloneMarketplaceApp(
                                    marketplaceRow || { id: item.id, title: item.title, slug: item.title }
                                  )
                                }
                                disabled={marketplaceCloneBusy === item.id}
                                type="button"
                              >
                                {marketplaceCloneBusy === item.id ? "Cloning..." : "Clone"}
                              </button>
                            ) : null}
                            {isSuperadmin ? (
                              <button
                                className="btn btn-sm btn-outline btn-error"
                                type="button"
                                onClick={() => {
                                  if (!window.confirm("Permanently delete this marketplace listing? This cannot be undone.")) return;
                                  deleteMarketplaceApp(marketplaceRow || { id: item.id });
                                }}
                              >
                                Delete
                              </button>
                            ) : null}
                          </div>
                        </div>
                        {item.description ? <div className="text-sm opacity-70 mt-2 leading-snug">{item.description}</div> : null}
                        <div className="mt-auto pt-4" />
                      </div>
                    );
                  }

                  const moduleRecord = moduleById.get(item.id);
                  const disabled = moduleRecord && !moduleRecord.enabled;
                  const app = {
                    id: item.id,
                    name: item.title,
                    module: moduleRecord,
                    icon: item.icon,
                    icon_url: item.icon_url || "lucide:package",
                  };
                  return (
                    <div
                      key={`inst-${item.id}`}
                      className={`${SETTINGS_CARD_CLASS} ${
                        disabled ? "border-warning/40" : "border-base-300"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex items-start gap-3">
                          <div className="w-10 h-10 bg-transparent flex items-center justify-center shrink-0">
                            <AppIcon app={app} />
                          </div>
                          <div className="min-w-0">
                            <div className="text-base font-semibold truncate">{item.title}</div>
                            <div className="text-xs opacity-60 mt-1 flex flex-wrap items-center gap-2">
                              <span className="font-mono">{item.id}</span>
                              {item.module_version ? <span className="font-mono opacity-60">V {item.module_version}</span> : null}
                            </div>
                          </div>
                        </div>
                        <div className="shrink-0 flex items-center gap-2">
                          {canManageModules ? (
                            moduleRecord?.enabled ? (
                              <button className="btn btn-sm btn-outline" onClick={() => toggleModule(item.id, false)} type="button">
                                {t("settings.apps_page.disable_button")}
                              </button>
                            ) : (
                              <button className="btn btn-sm btn-primary" onClick={() => toggleModule(item.id, true)} type="button">
                                {t("settings.apps_page.enable_button")}
                              </button>
                            )
                          ) : null}
                          <div className="relative">
                            <button
                              className="btn btn-sm btn-outline"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenMenuId((prev) => (prev === item.id ? "" : item.id));
                              }}
                              type="button"
                            >
                              {isMobile ? <MoreVertical className="w-4 h-4" /> : "⋮"}
                            </button>
                            {openMenuId === item.id ? (
                              <ul className={`absolute right-0 ${isMobile ? "bottom-full mb-2" : "top-full mt-2"} menu p-2 shadow bg-base-100 rounded-box w-48 z-50 border border-base-300`}>
                                <li><button onClick={() => { closeAppMenu(); handleDetails(item.id); }}>{t("settings.apps_page.view_details")}</button></li>
                                {canManageModules ? (
                                  <>
                                    <li>
                                      <button
                                        onClick={() => {
                                          closeAppMenu();
                                          setIconPickerApp(app);
                                          setIconQuery("");
                                          setIconLibrary("lucide");
                                          setHeroFamily("24/outline");
                                          setIconPickerOpen(true);
                                        }}
                                      >
                                        {t("settings.apps_page.choose_icon")}
                                      </button>
                                    </li>
                                    <li><button onClick={() => { closeAppMenu(); handleSetOrder(app); }}>{t("settings.apps_page.set_order")}</button></li>
                                    <li><button onClick={() => { closeAppMenu(); openDelete(item.id); }} className="text-error">{t("settings.apps_page.remove_delete")}</button></li>
                                  </>
                                ) : null}
                              </ul>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      {item.description ? (
                        <div className="text-sm opacity-70 mt-2 leading-snug">{item.description}</div>
                      ) : null}
                      <div className="mt-auto pt-4" />
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {deleteTarget && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">{t("settings.apps_page.delete_title")}</h3>
            <p className="text-sm opacity-70 mt-2">
              {t("settings.apps_page.delete_body")}
            </p>
            <div className="mt-4 space-y-2">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="delete-mode"
                  className="radio radio-sm mt-1"
                  checked={deleteMode === "keep_records"}
                  onChange={() => setDeleteMode("keep_records")}
                />
                <div>
                  <div className="font-semibold">{t("settings.apps_page.remove_keep_records")}</div>
                  <div className="text-xs opacity-70">{t("settings.apps_page.remove_keep_records_help")}</div>
                </div>
              </label>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="delete-mode"
                  className="radio radio-sm mt-1"
                  checked={deleteMode === "delete_records"}
                  onChange={() => setDeleteMode("delete_records")}
                />
                <div>
                  <div className="font-semibold text-error">{t("settings.apps_page.delete_module_records")}</div>
                  <div className="text-xs opacity-70">
                    {t("settings.apps_page.delete_module_records_help")}
                  </div>
                </div>
              </label>
            </div>
            <p className="text-sm mt-2">{t("settings.apps_page.type_value_to_confirm", { value: deleteTarget })}</p>
            <input
              className="input input-bordered input-sm w-full mt-3"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={t("settings.apps_page.module_id_placeholder")}
            />
            {deleteMode === "delete_records" && (
              <div className="mt-3">
                <div className="text-sm">{t("settings.apps_page.also_type_delete_to_confirm")}</div>
                <input
                  className="input input-bordered input-sm w-full mt-2"
                  value={forceConfirm}
                  onChange={(e) => setForceConfirm(e.target.value)}
                  placeholder={t("settings.apps_page.delete_keyword_placeholder")}
                />
              </div>
            )}
            <div className="modal-action">
              <button className="btn" onClick={closeDelete}>{t("common.cancel")}</button>
              <button
                className={`btn ${deleteMode === "delete_records" ? "btn-error" : "btn-warning"}`}
                onClick={handleDelete}
                disabled={deleteConfirm !== deleteTarget || (deleteMode === "delete_records" && forceConfirm !== "DELETE")}
              >
                {deleteMode === "delete_records" ? t("common.delete") : t("common.remove")}
              </button>
            </div>
          </div>
        </div>
      )}
      {iconPickerOpen && (
        <div className="modal modal-open">
          <div className="modal-box max-w-4xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">{t("settings.apps_page.choose_icon_title")}</h3>
              <button className="btn btn-ghost btn-xs" onClick={() => setIconPickerOpen(false)}>✕</button>
            </div>
            <input
              className="input input-bordered input-sm w-full mb-4"
              placeholder={t("settings.apps_page.search_icons")}
              value={iconQuery}
              onChange={(e) => setIconQuery(e.target.value)}
            />
            <div className="tabs tabs-boxed mb-4">
              <button
                type="button"
                className={`tab ${iconLibrary === "lucide" ? "tab-active" : ""}`}
                onClick={() => setIconLibrary("lucide")}
              >
                Lucide
              </button>
              <button
                type="button"
                className={`tab ${iconLibrary === "hero" ? "tab-active" : ""}`}
                onClick={() => setIconLibrary("hero")}
              >
                Heroicons
              </button>
            </div>
            {iconLibrary === "hero" && (
              <div className="tabs tabs-boxed mb-4">
                {HERO_ICON_FAMILIES.map((family) => (
                  <button
                    key={family.id}
                    type="button"
                    className={`tab ${heroFamily === family.id ? "tab-active" : ""}`}
                    onClick={() => setHeroFamily(family.id)}
                  >
                    {family.label}
                  </button>
                ))}
              </div>
            )}
            {iconCatalogLoading ? (
              <div className="py-10 flex items-center justify-center">
                <LoadingSpinner />
              </div>
            ) : null}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-3 max-h-[60vh] overflow-auto">
              {!iconCatalogLoading && iconLibrary === "lucide" && filteredLucideIcons.map(({ name }) => {
                return (
                  <button
                    key={`lucide:${name}`}
                    type="button"
                    className="btn btn-ghost h-16 w-full min-w-0 flex items-center justify-center overflow-hidden"
                    title={name}
                    onClick={async () => {
                      if (!iconPickerApp) return;
                      try {
                        await setModuleIcon(iconPickerApp.id, `lucide:${name}`);
                        setIconPickerOpen(false);
                        await actions.refresh({ force: true });
                      } catch (err) {
                        pushToast("error", err.message || t("settings.apps_page.icon_set_failed"));
                      }
                    }}
                  >
                    <AppModuleIcon iconUrl={`lucide:${name}`} size={28} strokeWidth={1.31} fallback={null} />
                  </button>
                );
              })}
              {!iconCatalogLoading && iconLibrary === "hero" && filteredHeroIcons.map(({ name }) => {
                return (
                  <button
                    key={heroKey(heroFamily, name)}
                    type="button"
                    className="btn btn-ghost h-16 w-full min-w-0 flex items-center justify-center overflow-hidden"
                    title={name}
                    onClick={async () => {
                      if (!iconPickerApp) return;
                      try {
                        await setModuleIcon(iconPickerApp.id, heroKey(heroFamily, name));
                        setIconPickerOpen(false);
                        await actions.refresh({ force: true });
                      } catch (err) {
                        pushToast("error", err.message || t("settings.apps_page.icon_set_failed"));
                      }
                    }}
                  >
                    <AppModuleIcon iconUrl={heroKey(heroFamily, name)} size={28} fallback={null} />
                  </button>
                );
              })}
            </div>
          </div>
          <div className="modal-backdrop" onClick={() => setIconPickerOpen(false)} />
        </div>
      )}
    </div>
  );
}
