// AppsPage is system-level "Home" (not a module). It manages installable modules.
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useModuleStore } from "../state/moduleStore.jsx";
import { useToast } from "../components/Toast.jsx";
import { getAppDisplayName } from "../state/appCatalog.js";
import { getPinnedApps, recordRecentApp, subscribeAppUsage, togglePinnedApp } from "../state/appUsage.js";
import { getDefaultOpenRoute, loadEntityIndex } from "../data/entityIndex.js";
import { apiFetch, invalidateModulesCache, setModuleIcon, clearModuleIcon, setModuleOrder } from "../api.js";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import { Package } from "lucide-react";
import { LUCIDE_ICON_LIST, normalizeLucideKey, resolveLucideIcon } from "../state/lucideIconCatalog.js";
import { useAccessContext } from "../access.js";

function statusChip(module) {
  if (!module) return <span className="badge">Not installed</span>;
  if (!module.enabled) return <span className="badge badge-warning">Disabled</span>;
  return <span className="badge badge-success">Enabled</span>;
}

function AppTile({ app, module, pinned, onOpen, onToggle, onPin, onDelete, onDetails, onChooseIcon, onRemoveIcon, onSetOrder, canManageModules }) {
  const disabled = module && !module.enabled;
  const isSystem = app.system;
  const iconUrl = app.icon_url;
  const lucideKey = normalizeLucideKey(iconUrl);
  const LucideIcon = lucideKey ? resolveLucideIcon(lucideKey) : null;
  const isImageUrl = typeof iconUrl === "string" && !LucideIcon && !iconUrl.includes("lucide:") && (
    iconUrl.startsWith("data:") || iconUrl.startsWith("http")
  );
  return (
    <div className={`relative flex flex-col items-center text-center ${disabled ? "opacity-60" : ""}`}>
      <button
        className="bg-base-100 border border-base-200 rounded-box shadow hover:shadow-md transition w-32 h-32 flex items-center justify-center"
        onClick={() => onOpen(app.id)}
        type="button"
      >
        {LucideIcon ? (
          <div className="text-5xl text-primary">
            <LucideIcon size={64} strokeWidth={1.31} />
          </div>
        ) : isImageUrl ? (
          <img src={iconUrl} alt={app.name} className="w-28 h-28 object-contain" />
        ) : (
          <div className="text-5xl text-primary">{app.icon}</div>
        )}
      </button>
      <div className="mt-2 text-xs font-semibold">{app.name}</div>
      <div className="mt-1 flex items-center gap-2">
        {isSystem && <span className="badge badge-outline badge-sm">System</span>}
        {!isSystem && statusChip(module)}
        {pinned && !isSystem && <span className="badge badge-ghost badge-sm">Pinned</span>}
      </div>
      {!isSystem && (
        <div className="dropdown dropdown-end absolute top-2 right-2">
          <button
            className="btn btn-xs btn-ghost"
            onClick={(e) => e.stopPropagation()}
          >
            ⋮
          </button>
          <ul
            className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-44 z-50"
            onClick={(e) => e.stopPropagation()}
          >
            <li><button onClick={() => onOpen(app.id)} disabled={disabled}>Open</button></li>
            <li><button onClick={() => onDetails(app.id)}>View details</button></li>
            <li><button onClick={() => onPin()}>{pinned ? "Unpin" : "Pin"}</button></li>
            {canManageModules ? (
              <>
                {module?.enabled ? (
                  <li><button onClick={() => onToggle(app.id, false)}>Disable</button></li>
                ) : (
                  <li><button onClick={() => onToggle(app.id, true)}>Enable</button></li>
                )}
                <li><button onClick={() => onChooseIcon()}>Choose icon…</button></li>
                {iconUrl && (
                  <li><button onClick={() => onRemoveIcon()}>Remove icon</button></li>
                )}
                <li><button onClick={() => onSetOrder()}>Set order…</button></li>
                <li><button onClick={() => onDelete(app.id)} className="text-error">Delete</button></li>
              </>
            ) : null}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function AppsPage({ user }) {
  const { modules, loading, error, actions } = useModuleStore();
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [pinned, setPinned] = useState(getPinnedApps());
  const [entityIndex, setEntityIndex] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [iconPickerApp, setIconPickerApp] = useState(null);
  const [iconQuery, setIconQuery] = useState("");
  const [marketplaceApps, setMarketplaceApps] = useState([]);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [marketplaceError, setMarketplaceError] = useState("");
  const [marketplaceCloneBusy, setMarketplaceCloneBusy] = useState("");
  const { hasCapability } = useAccessContext();
  const canManageModules = hasCapability("modules.manage");


  const moduleById = useMemo(() => {
    const map = new Map();
    for (const m of modules) map.set(m.module_id, m);
    return map;
  }, [modules]);

  useEffect(() => {
    const handler = () => {
      setPinned(getPinnedApps());
    };
    const unsubscribe = subscribeAppUsage(handler);
    handler();
    return unsubscribe;
  }, []);

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
    (async () => {
      setMarketplaceLoading(true);
      setMarketplaceError("");
      try {
        const res = await apiFetch("/marketplace/apps");
        if (!alive) return;
        setMarketplaceApps(Array.isArray(res?.apps) ? res.apps : []);
      } catch (err) {
        if (!alive) return;
        setMarketplaceError(err?.message || "Failed to load marketplace");
      } finally {
        if (alive) setMarketplaceLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [user]);

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
  }

  function closeDelete() {
    setDeleteTarget(null);
    setDeleteConfirm("");
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
      await actions.deleteModule(deleteTarget);
      pushToast("success", "Module deleted");
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
      await apiFetch(`/marketplace/apps/${app.id}/clone`, { method: "POST", body: {} });
      pushToast("success", `Cloned ${app.title || app.slug || "app"}`);
      await actions.refresh({ force: true });
    } catch (err) {
      pushToast("error", err?.message || "Clone failed");
    } finally {
      setMarketplaceCloneBusy("");
    }
  }

  if (!user) {
    return <div className="alert">Please log in to view apps.</div>;
  }

  const allCards = useMemo(() => modules.map((m) => ({
    id: m.module_id,
    name: getAppDisplayName(m.module_id, m),
    module: m,
    system: false,
    icon: <Package size={64} strokeWidth={1.31} className="text-primary" />,
    icon_url: m.icon_key || null,
  })), [modules]);
  const filteredCards = allCards.filter((app) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return app.name.toLowerCase().includes(q) || app.id.toLowerCase().includes(q);
  });
  const filteredIcons = useMemo(() => {
    const q = iconQuery.trim().toLowerCase();
    if (!q) return LUCIDE_ICON_LIST;
    return LUCIDE_ICON_LIST.filter((icon) => icon.name.toLowerCase().includes(q));
  }, [iconQuery]);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-4">
        <h2 className="text-2xl font-semibold">App Manager</h2>
        <div className="text-sm opacity-70">Install and manage apps available to your workspace.</div>
      </div>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
        <input
          className="input input-bordered w-full md:max-w-md"
          placeholder="Search apps…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="btn btn-outline" onClick={() => actions.refresh({ force: true })} disabled={loading}>
          Refresh
        </button>
      </div>
      {loading && <LoadingSpinner />}
      {error && <div className="alert alert-error mb-4">{error}</div>}
      {!loading && (
        <>
          <div className="mb-4">
            <div className="text-xs uppercase opacity-60 mb-2">Installed</div>
            {modules.length === 0 && (
              <div className="card bg-base-100 shadow p-6">
                <div className="text-sm opacity-70 mb-3">No modules installed yet.</div>
                {canManageModules ? (
                  <button className="btn btn-primary w-fit" onClick={() => navigate("/studio")}>
                    Create a module in Studio
                  </button>
                ) : null}
              </div>
            )}
            {modules.length > 0 && (
              <div className="w-full flex justify-center">
                <div className="grid w-full max-w-[828px] gap-3 justify-center justify-items-center [grid-template-columns:repeat(auto-fit,128px)]">
                {filteredCards.map((app) => {
                  const moduleRecord = moduleById.get(app.id);
                  const disabled = moduleRecord && !moduleRecord.enabled;
                  return (
                    <AppTile
                      key={app.id}
                      app={app}
                      module={moduleRecord}
                      pinned={pinned.includes(app.id)}
                      onOpen={(id) => (disabled ? handleDetails(id) : handleOpen(id))}
                      onToggle={toggleModule}
                      onPin={() => togglePinnedApp(app.id)}
                      onDelete={openDelete}
                      onDetails={handleDetails}
                      onChooseIcon={() => {
                        setIconPickerApp(app);
                        setIconQuery("");
                        setIconPickerOpen(true);
                      }}
                      onRemoveIcon={async () => {
                        try {
                          await clearModuleIcon(app.id);
                          await actions.refresh({ force: true });
                        } catch (err) {
                          pushToast("error", err.message || "Failed to remove icon");
                        }
                      }}
                      onSetOrder={() => handleSetOrder(app)}
                      canManageModules={canManageModules}
                    />
                  );
                })}
                {filteredCards.length === 0 && (
                  <div className="text-sm opacity-70">No apps match your search.</div>
                )}
                </div>
              </div>
            )}
          </div>
          <div className="mt-8">
            <div className="text-xs uppercase opacity-60 mb-2">Marketplace</div>
            <div className="card bg-base-100 shadow">
              <div className="card-body">
                {marketplaceLoading ? <LoadingSpinner className="min-h-[10vh]" /> : null}
                {marketplaceError ? <div className="alert alert-error">{marketplaceError}</div> : null}
                {!marketplaceLoading && !marketplaceError && marketplaceApps.length === 0 ? (
                  <div className="text-sm opacity-70">No marketplace apps published yet.</div>
                ) : null}
                {!marketplaceLoading && !marketplaceError && marketplaceApps.length > 0 ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    {marketplaceApps.map((app) => (
                      <div key={app.id} className="rounded-box border border-base-300 p-4 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold truncate">{app.title || app.slug}</div>
                          <div className="text-xs opacity-60 mt-1">
                            Source: <span className="font-mono">{app.source_module_id}</span>
                          </div>
                          {app.description ? <div className="text-sm opacity-80 mt-2">{app.description}</div> : null}
                        </div>
                        {canManageModules ? (
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={() => cloneMarketplaceApp(app)}
                            disabled={marketplaceCloneBusy === app.id}
                          >
                            {marketplaceCloneBusy === app.id ? "Cloning..." : "Clone"}
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </>
      )}
      {deleteTarget && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">Delete module</h3>
            <p className="text-sm opacity-70 mt-2">This will delete the module and all its data.</p>
            <p className="text-sm mt-2">Type <span className="font-mono">{deleteTarget}</span> to confirm.</p>
            <input
              className="input input-bordered w-full mt-3"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="module id"
            />
            <div className="modal-action">
              <button className="btn" onClick={closeDelete}>Cancel</button>
              <button className="btn btn-error" onClick={handleDelete} disabled={deleteConfirm !== deleteTarget}>
                Delete
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
              className="input input-bordered w-full mb-4"
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
