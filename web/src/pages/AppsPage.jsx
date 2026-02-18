// AppsPage is system-level "Home" (not a module). It manages installable modules.
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useModuleStore } from "../state/moduleStore.jsx";
import { useToast } from "../components/Toast.jsx";
import { getAppDisplayName } from "../state/appCatalog.js";
import { recordRecentApp } from "../state/appUsage.js";
import { getDefaultOpenRoute, loadEntityIndex } from "../data/entityIndex.js";
import { apiFetch, invalidateModulesCache, setModuleIcon, setModuleOrder } from "../api.js";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import { Package } from "lucide-react";
import { LUCIDE_ICON_LIST, normalizeLucideKey, resolveLucideIcon } from "../state/lucideIconCatalog.js";
import { useAccessContext } from "../access.js";
import SystemListToolbar from "../ui/SystemListToolbar.jsx";

// Kept intentionally minimal: App Manager cards shouldn't surface extra status/meta beyond actions + app version.

function AppIcon({ app }) {
  const iconUrl = app.icon_url;
  const lucideKey = normalizeLucideKey(iconUrl);
  const LucideIcon = lucideKey ? resolveLucideIcon(lucideKey) : null;
  const isImageUrl =
    typeof iconUrl === "string" &&
    !LucideIcon &&
    !iconUrl.includes("lucide:") &&
    (iconUrl.startsWith("data:") || iconUrl.startsWith("http"));
  if (LucideIcon) {
    return (
      <div className="text-primary">
        <LucideIcon size={40} strokeWidth={1.31} />
      </div>
    );
  }
  if (isImageUrl) {
    return <img src={iconUrl} alt={app.name} className="w-10 h-10 object-contain" />;
  }
  return <div className="text-primary">{app.icon}</div>;
}

export default function AppsPage({ user }) {
  const { modules, loading, error, actions } = useModuleStore();
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("all"); // all | installed | marketplace
  const [entityIndex, setEntityIndex] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteMode, setDeleteMode] = useState("keep_records"); // keep_records | delete_records
  const [forceConfirm, setForceConfirm] = useState("");
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [iconPickerApp, setIconPickerApp] = useState(null);
  const [iconQuery, setIconQuery] = useState("");
  const [marketplaceApps, setMarketplaceApps] = useState([]);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [marketplaceError, setMarketplaceError] = useState("");
  const [marketplaceCloneBusy, setMarketplaceCloneBusy] = useState("");
  const { hasCapability, isSuperadmin } = useAccessContext();
  const canManageModules = hasCapability("modules.manage");


  const moduleById = useMemo(() => {
    const map = new Map();
    for (const m of modules) map.set(m.module_id, m);
    return map;
  }, [modules]);

  useEffect(() => {
    async function buildIndex() {
      if (!user) return;
      const index = await loadEntityIndex(modules);
      setEntityIndex(index);
    }
    buildIndex();
  }, [modules, user]);

  useEffect(() => {
    if (!user) return;
    let alive = true;
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
      setMarketplaceError(err?.message || "Failed to load marketplace");
    } finally {
      if (isAlive()) setMarketplaceLoading(false);
    }
  }

  async function toggleModule(moduleId, enabled) {
    try {
      if (enabled) {
        await actions.enableModule(moduleId);
        pushToast("success", "Module enabled");
      } else {
        await actions.disableModule(moduleId);
        pushToast("info", "Module disabled");
      }
      await actions.refresh({ force: true });
    } catch (err) {
      pushToast("error", err.message || "Action failed");
    }
  }

  function handleOpen(moduleId) {
    recordRecentApp(moduleId);
    const route = getDefaultOpenRoute(moduleId, entityIndex);
    navigate(route);
  }

  function handleDetails(moduleId) {
    navigate(`/apps/${moduleId}/details`);
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
    const next = window.prompt("Display order (blank to clear)", current ?? "");
    if (next === null) return;
    const trimmed = `${next}`.trim();
    const value = trimmed === "" ? null : Number(trimmed);
    if (trimmed !== "" && !Number.isInteger(value)) {
      pushToast("error", "Display order must be an integer");
      return;
    }
    try {
      await setModuleOrder(app.id, value);
      await actions.refresh({ force: true });
    } catch (err) {
      pushToast("error", err.message || "Failed to set order");
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      const opts = deleteMode === "delete_records" ? { force: true } : { archive: true };
      await actions.deleteModule(deleteTarget, opts);
      pushToast("success", deleteMode === "delete_records" ? "Module deleted (records removed)" : "Module removed (records kept)");
      invalidateModulesCache();
      await actions.refresh({ force: true });
    } catch (err) {
      pushToast("error", err.message || "Delete failed");
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
      pushToast("success", `Cloned ${app.title || app.slug || "app"}${newId ? ` (${newId})` : ""} (disabled)`);
      await actions.refresh({ force: true });
    } catch (err) {
      pushToast("error", err?.message || "Clone failed");
    } finally {
      setMarketplaceCloneBusy("");
    }
  }

  async function deleteMarketplaceApp(app) {
    if (!app?.id) return;
    const confirm = window.prompt("Type DELETE to permanently remove this marketplace app.");
    if (confirm !== "DELETE") return;
    try {
      await apiFetch(`/marketplace/apps/${app.id}`, { method: "DELETE" });
      pushToast("success", "Marketplace app deleted");
      await refreshMarketplace();
    } catch (err) {
      pushToast("error", err?.message || "Failed to delete marketplace app");
    }
  }

  if (!user) {
    return <div className="alert">Please log in to view apps.</div>;
  }

  const items = useMemo(() => {
    const installed = modules.map((m) => ({
      kind: "installed",
      id: m.module_id,
      title: getAppDisplayName(m.module_id, m),
      description: m.description || "",
      module_version: m.module_version || "",
      module: m,
      icon: <Package size={64} strokeWidth={1.31} className="text-primary" />,
      icon_url: m.icon_key || null,
      keywords: ["installed", m.module_id, m.name || "", m.description || ""].filter(Boolean),
    }));
    const marketplace = (Array.isArray(marketplaceApps) ? marketplaceApps : []).map((a) => ({
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
  }, [marketplaceApps, modules]);

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

  const filteredIcons = useMemo(() => {
    const q = iconQuery.trim().toLowerCase();
    if (!q) return LUCIDE_ICON_LIST;
    return LUCIDE_ICON_LIST.filter((icon) => icon.name.toLowerCase().includes(q));
  }, [iconQuery]);

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <div className="card bg-base-100 border border-base-300 shadow-sm h-full min-h-0 flex flex-col overflow-hidden">
        <div className="card-body flex flex-col min-h-0">
          <div className="shrink-0">
            <SystemListToolbar
              title="Apps"
              searchValue={query}
              onSearchChange={setQuery}
              filters={[
                { id: "all", label: "All" },
                { id: "installed", label: "Installed" },
                { id: "marketplace", label: "Marketplace" },
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
          <div className="mt-4 flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
            {(loading || marketplaceLoading) && <LoadingSpinner />}
            {error && <div className="alert alert-error mb-4">{error}</div>}
            {marketplaceError && <div className="alert alert-error mb-4">{marketplaceError}</div>}

            {!loading && !marketplaceLoading && filteredItems.length === 0 ? (
              <div className="text-sm opacity-60">No apps match your search.</div>
            ) : null}

            {!loading && !marketplaceLoading && filteredItems.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredItems.map((item) => {
                  if (item.kind === "marketplace") {
                    const marketplaceRow = marketplaceApps.find((a) => a.id === item.id);
                    const app = {
                      id: item.id,
                      name: item.title,
                      icon: <Package size={64} strokeWidth={1.31} className="text-primary" />,
                      icon_url: item.icon_url || null,
                    };
                    const sourceId = item.source_module_id || item.id;
                    return (
                      <div key={`mkt-${item.id}`} className="border rounded-box p-4 bg-base-100 shadow-sm flex flex-col min-h-[140px] border-base-200">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex items-start gap-3">
                            <div className="w-10 h-10 rounded-box bg-transparent flex items-center justify-center shrink-0">
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
                        {item.description ? (
                          <div className="text-sm opacity-70 mt-2 leading-snug">{item.description}</div>
                        ) : null}
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
                    icon_url: item.icon_url,
                  };
                  return (
                    <div
                      key={`inst-${item.id}`}
                      className={`border rounded-box p-4 bg-base-100 shadow-sm flex flex-col min-h-[140px] ${
                        disabled ? "border-warning/40" : "border-base-200"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex items-start gap-3">
                          <div className="w-10 h-10 rounded-box bg-transparent flex items-center justify-center shrink-0">
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
                                Disable
                              </button>
                            ) : (
                              <button className="btn btn-sm btn-primary" onClick={() => toggleModule(item.id, true)} type="button">
                                Enable
                              </button>
                            )
                          ) : null}
                          <div className="dropdown dropdown-end">
                            <button className="btn btn-sm btn-outline" onClick={(e) => e.stopPropagation()} type="button">
                              ⋮
                            </button>
                            <ul className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-48 z-50">
                              <li><button onClick={() => handleDetails(item.id)}>View details</button></li>
                              {canManageModules ? (
                                <>
                                  <li>
                                    <button
                                      onClick={() => {
                                        setIconPickerApp(app);
                                        setIconQuery("");
                                        setIconPickerOpen(true);
                                      }}
                                    >
                                      Choose icon…
                                    </button>
                                  </li>
                                  <li><button onClick={() => handleSetOrder(app)}>Set order…</button></li>
                                  <li><button onClick={() => openDelete(item.id)} className="text-error">Remove / delete…</button></li>
                                </>
                              ) : null}
                            </ul>
                          </div>
                        </div>
                      </div>
                      {item.description ? (
                        <div className="text-sm opacity-70 mt-2 leading-snug">{item.description}</div>
                      ) : null}
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
            <h3 className="font-bold text-lg">Delete module</h3>
            <p className="text-sm opacity-70 mt-2">
              Choose whether to keep records created by this module, or delete everything.
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
                  <div className="font-semibold">Remove module (keep records)</div>
                  <div className="text-xs opacity-70">The app is archived/disabled, but your workspace data remains.</div>
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
                  <div className="font-semibold text-error">Delete module + records</div>
                  <div className="text-xs opacity-70">
                    Irreversible. Removes all records for entities defined by this module (and any other module using the same entities).
                  </div>
                </div>
              </label>
            </div>
            <p className="text-sm mt-2">Type <span className="font-mono">{deleteTarget}</span> to confirm.</p>
            <input
              className="input input-bordered input-sm w-full mt-3"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="module id"
            />
            {deleteMode === "delete_records" && (
              <div className="mt-3">
                <div className="text-sm">Also type <span className="font-mono">DELETE</span> to confirm record deletion.</div>
                <input
                  className="input input-bordered input-sm w-full mt-2"
                  value={forceConfirm}
                  onChange={(e) => setForceConfirm(e.target.value)}
                  placeholder="DELETE"
                />
              </div>
            )}
            <div className="modal-action">
              <button className="btn" onClick={closeDelete}>Cancel</button>
              <button
                className={`btn ${deleteMode === "delete_records" ? "btn-error" : "btn-warning"}`}
                onClick={handleDelete}
                disabled={deleteConfirm !== deleteTarget || (deleteMode === "delete_records" && forceConfirm !== "DELETE")}
              >
                {deleteMode === "delete_records" ? "Delete" : "Remove"}
              </button>
            </div>
          </div>
        </div>
      )}
      {iconPickerOpen && (
        <div className="modal modal-open">
          <div className="modal-box max-w-4xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Choose an icon</h3>
              <button className="btn btn-ghost btn-xs" onClick={() => setIconPickerOpen(false)}>✕</button>
            </div>
            <input
              className="input input-bordered input-sm w-full mb-4"
              placeholder="Search icons…"
              value={iconQuery}
              onChange={(e) => setIconQuery(e.target.value)}
            />
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-3 max-h-[60vh] overflow-auto">
              {filteredIcons.map(({ name }) => {
                const Icon = resolveLucideIcon(name);
                if (!Icon) return null;
                return (
                  <button
                    key={name}
                    type="button"
                    className="btn btn-ghost h-20 flex flex-col items-center gap-1"
                    onClick={async () => {
                      if (!iconPickerApp) return;
                      try {
                        await setModuleIcon(iconPickerApp.id, `lucide:${name}`);
                        setIconPickerOpen(false);
                        await actions.refresh({ force: true });
                      } catch (err) {
                        pushToast("error", err.message || "Failed to set icon");
                      }
                    }}
                  >
                    <Icon size={28} strokeWidth={1.31} />
                    <span className="text-[10px] uppercase opacity-70">{name}</span>
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
