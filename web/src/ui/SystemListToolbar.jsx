import React, { useEffect, useMemo, useState } from "react";
import { Bookmark, Filter, List as ListIcon, Plus, RefreshCw, Search as SearchIcon } from "lucide-react";
import { PRIMARY_BUTTON_SM, SOFT_ICON_SM } from "../components/buttonStyles.js";
import PaginationControls from "../components/PaginationControls.jsx";
import DaisyTooltip from "../components/DaisyTooltip.jsx";
import { apiFetch } from "../api.js";

export default function SystemListToolbar({
  title,
  createTooltip = "New",
  onCreate,
  searchValue = "",
  onSearchChange,
  filters = [],
  onFilterChange,
  filterableFields = [],
  onAddCustomFilter,
  onClearFilters,
  onRefresh,
  rightActions = null,
  pagination = null,
  showSavedViews = true,
  showListToggle = false,
  savedViewsEntityId = "",
  savedViewDomain = null,
  savedViewState = null,
  onApplySavedViewState,
}) {
  const [filterPrompt, setFilterPrompt] = useState(null);
  const [filterPromptValue, setFilterPromptValue] = useState("");
  const [savedViews, setSavedViews] = useState([]);
  const [savedViewsError, setSavedViewsError] = useState("");
  const [savePromptOpen, setSavePromptOpen] = useState(false);
  const [savePromptValue, setSavePromptValue] = useState("");

  const canManageSavedViews = showSavedViews && typeof savedViewsEntityId === "string" && savedViewsEntityId.trim();
  const canSaveCurrentView = canManageSavedViews && savedViewDomain && savedViewState && typeof onApplySavedViewState === "function";

  useEffect(() => {
    if (!canManageSavedViews) {
      setSavedViews([]);
      setSavedViewsError("");
      return;
    }
    let cancelled = false;
    apiFetch(`/filters/${encodeURIComponent(savedViewsEntityId)}`)
      .then((res) => {
        if (cancelled) return;
        setSavedViews(Array.isArray(res?.filters) ? res.filters : []);
        setSavedViewsError("");
      })
      .catch((err) => {
        if (cancelled) return;
        setSavedViews([]);
        setSavedViewsError(err?.message || "Failed to load saved views");
      });
    return () => {
      cancelled = true;
    };
  }, [canManageSavedViews, savedViewsEntityId]);

  const defaultSavedView = useMemo(
    () => savedViews.find((view) => view?.is_default) || null,
    [savedViews]
  );

  async function handleSaveCurrentView() {
    const name = savePromptValue.trim();
    if (!name || !canSaveCurrentView) {
      setSavePromptOpen(false);
      setSavePromptValue("");
      return;
    }
    try {
      const res = await apiFetch(`/filters/${encodeURIComponent(savedViewsEntityId)}`, {
        method: "POST",
        body: {
          name,
          domain: savedViewDomain,
          state: savedViewState,
        },
      });
      const created = res?.filter;
      if (created) {
        setSavedViews((prev) => [created, ...prev]);
      }
      setSavedViewsError("");
    } catch (err) {
      setSavedViewsError(err?.message || "Failed to save view");
    } finally {
      setSavePromptOpen(false);
      setSavePromptValue("");
    }
  }

  async function handleDeleteSavedView(viewId) {
    if (!viewId) return;
    try {
      await apiFetch(`/filters/${encodeURIComponent(viewId)}`, { method: "DELETE" });
      setSavedViews((prev) => prev.filter((view) => view?.id !== viewId));
      setSavedViewsError("");
    } catch (err) {
      setSavedViewsError(err?.message || "Failed to delete saved view");
    }
  }

  async function handleSetDefaultSavedView(viewId) {
    if (!viewId) return;
    try {
      const res = await apiFetch(`/filters/${encodeURIComponent(viewId)}`, {
        method: "PUT",
        body: { is_default: true },
      });
      const updated = res?.filter;
      setSavedViews((prev) =>
        prev.map((view) => {
          if (!view?.id) return view;
          if (view.id === viewId) return { ...view, ...(updated || {}), is_default: true };
          return { ...view, is_default: false };
        })
      );
      setSavedViewsError("");
    } catch (err) {
      setSavedViewsError(err?.message || "Failed to set default view");
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 relative z-30 shrink-0 w-full min-w-0">
        <div className="flex items-center gap-2 min-w-[12rem]">
          {onCreate && (
            <DaisyTooltip label={createTooltip} placement="bottom">
              <button className={PRIMARY_BUTTON_SM} onClick={onCreate}>
                <Plus className="h-4 w-4" />
              </button>
            </DaisyTooltip>
          )}
          <div className="text-lg font-semibold">{title}</div>
        </div>

        <div className="flex items-center justify-center flex-1 min-w-0">
          <div className="join items-center overflow-visible">
            <DaisyTooltip label="Search" className="join-item" placement="bottom">
              <button className={SOFT_ICON_SM}>
                <SearchIcon className="h-4 w-4" />
              </button>
            </DaisyTooltip>
            <input
              className="input input-bordered input-sm join-item toolbar-search-input w-full max-w-xs py-0 leading-none"
              placeholder="Search…"
              value={searchValue}
              onChange={(e) => onSearchChange?.(e.target.value)}
            />
            <div className="dropdown dropdown-end dropdown-bottom join-item">
              <DaisyTooltip label="Filters" className="join-item" placement="bottom">
                <button className={SOFT_ICON_SM} type="button" tabIndex={0}>
                  <Filter className="h-4 w-4" />
                </button>
              </DaisyTooltip>
              <div className="dropdown-content p-2 shadow bg-base-100 rounded-box w-64 z-[200] max-h-72 overflow-y-auto overflow-x-hidden">
                <ul className="menu flex flex-col">
                  {filters.map((flt) => (
                    <li key={flt.id}>
                      <button onClick={() => onFilterChange?.(flt.id)}>{flt.label}</button>
                    </li>
                  ))}
                  {filterableFields.length > 0 && <li className="menu-title">Custom</li>}
                  {filterableFields.map((field) => (
                    <li key={field.id}>
                      <button
                        onClick={() => {
                          setFilterPrompt({ field });
                          setFilterPromptValue("");
                        }}
                      >
                        {field.label}
                      </button>
                    </li>
                  ))}
                  <li>
                    <button onClick={() => onClearFilters?.()}>Clear</button>
                  </li>
                </ul>
              </div>
            </div>
            {showSavedViews && (
              <div className="dropdown dropdown-end dropdown-bottom join-item">
                <DaisyTooltip label="Saved views" className="join-item" placement="bottom">
                  <button className={SOFT_ICON_SM} type="button" tabIndex={0}>
                    <Bookmark className="h-4 w-4" />
                  </button>
                </DaisyTooltip>
                <div className="dropdown-content p-2 shadow bg-base-100 rounded-box w-64 z-[200] max-h-72 overflow-y-auto overflow-x-hidden">
                  <ul className="menu flex flex-col">
                    {savedViewsError ? <li><span className="text-error text-xs">{savedViewsError}</span></li> : null}
                    {canManageSavedViews && savedViews.map((view) => (
                      <li key={view.id}>
                        <div className="flex items-center gap-2">
                          <button
                            className="flex-1 text-left"
                            onClick={() => onApplySavedViewState?.(view?.state || {}, view)}
                          >
                            {view.name}
                            {view?.is_default ? " (Default)" : ""}
                          </button>
                          <button
                            className="btn btn-ghost btn-xs"
                            onClick={() => handleSetDefaultSavedView(view.id)}
                            type="button"
                          >
                            Default
                          </button>
                          <button
                            className="btn btn-ghost btn-xs text-error"
                            onClick={() => handleDeleteSavedView(view.id)}
                            type="button"
                          >
                            Delete
                          </button>
                        </div>
                      </li>
                    ))}
                    {canManageSavedViews && savedViews.length === 0 ? <li><span className="text-xs opacity-60">No saved views yet.</span></li> : null}
                    <li>
                      <button
                        onClick={() => {
                          if (!canSaveCurrentView) return;
                          setSavePromptOpen(true);
                          setSavePromptValue("");
                        }}
                        disabled={!canSaveCurrentView}
                      >
                        Save current view
                      </button>
                    </li>
                    {defaultSavedView ? <li><span className="text-xs opacity-60">Default: {defaultSavedView.name}</span></li> : null}
                  </ul>
                </div>
              </div>
            )}
            <DaisyTooltip label="Refresh" className="join-item" placement="bottom">
              <button className={SOFT_ICON_SM} onClick={onRefresh}>
                <RefreshCw className="h-4 w-4" />
              </button>
            </DaisyTooltip>
          </div>
        </div>

        <div className="flex items-center gap-3 min-w-[10rem] justify-end">
          {rightActions}
          {showListToggle && (
            <div className="join">
              <DaisyTooltip label="List" className="join-item" placement="top">
                <button className={`${SOFT_ICON_SM} bg-base-300`} disabled>
                  <ListIcon className="h-4 w-4" />
                </button>
              </DaisyTooltip>
            </div>
          )}
          {pagination && (
            <PaginationControls
              page={pagination.page || 0}
              pageSize={pagination.pageSize || 25}
              totalItems={pagination.totalItems || 0}
              onPageChange={pagination.onPageChange}
            />
          )}
        </div>
      </div>

      {filterPrompt && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">
              Filter {filterPrompt.field?.label || filterPrompt.field?.id || "Field"}
            </h3>
            <div className="py-2 text-sm opacity-70">Enter a value to filter by.</div>
            <input
              className="input input-bordered input-sm w-full"
              placeholder="Value"
              value={filterPromptValue}
              onChange={(e) => setFilterPromptValue(e.target.value)}
              autoFocus
            />
            <div className="modal-action">
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setFilterPrompt(null);
                  setFilterPromptValue("");
                }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  const value = filterPromptValue.trim();
                  if (!value) {
                    setFilterPrompt(null);
                    setFilterPromptValue("");
                    return;
                  }
                  onAddCustomFilter?.(filterPrompt.field, value);
                  setFilterPrompt(null);
                  setFilterPromptValue("");
                }}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      {savePromptOpen && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">Save current view</h3>
            <div className="py-2 text-sm opacity-70">Give this saved view a name.</div>
            <input
              className="input input-bordered input-sm w-full"
              placeholder="View name"
              value={savePromptValue}
              onChange={(e) => setSavePromptValue(e.target.value)}
              autoFocus
            />
            <div className="modal-action">
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setSavePromptOpen(false);
                  setSavePromptValue("");
                }}
              >
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleSaveCurrentView}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
