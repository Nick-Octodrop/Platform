import React, { useEffect, useMemo, useState } from "react";
import { Bookmark, Filter, List as ListIcon, MoreHorizontal, Plus, RefreshCw, Search as SearchIcon } from "lucide-react";
import { PRIMARY_BUTTON_SM, SOFT_ICON_SM } from "../components/buttonStyles.js";
import PaginationControls from "../components/PaginationControls.jsx";
import DaisyTooltip from "../components/DaisyTooltip.jsx";
import { apiFetch } from "../api.js";
import useMediaQuery from "../hooks/useMediaQuery.js";
import { useI18n } from "../i18n/LocalizationProvider.jsx";

function normalizeSavedView(view) {
  if (!view || typeof view !== "object") return null;
  const normalizeJsonObject = (value) => {
    if (!value) return {};
    if (typeof value === "object" && !Array.isArray(value)) return value;
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      } catch {
        return {};
      }
    }
    return {};
  };
  return {
    ...view,
    id: view.id ? String(view.id) : "",
    name: typeof view.name === "string" ? view.name : "",
    domain: normalizeJsonObject(view.domain),
    state: normalizeJsonObject(view.state),
    is_default: Boolean(view.is_default),
  };
}

export default function SystemListToolbar({
  title,
  createTooltip = null,
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
  const { t } = useI18n();
  const resolvedCreateTooltip = createTooltip || t("common.new");
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [filterPrompt, setFilterPrompt] = useState(null);
  const [filterPromptValue, setFilterPromptValue] = useState("");
  const [savedViews, setSavedViews] = useState([]);
  const [savedViewsError, setSavedViewsError] = useState("");
  const [savePromptOpen, setSavePromptOpen] = useState(false);
  const [savePromptValue, setSavePromptValue] = useState("");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const canManageSavedViews = showSavedViews && typeof savedViewsEntityId === "string" && savedViewsEntityId.trim();
  const canSaveCurrentView = canManageSavedViews && savedViewState && typeof onApplySavedViewState === "function";

  async function reloadSavedViews() {
    if (!canManageSavedViews) return;
    const res = await apiFetch(`/filters/${encodeURIComponent(savedViewsEntityId)}`);
    setSavedViews(Array.isArray(res?.filters) ? res.filters.map(normalizeSavedView).filter(Boolean) : []);
    setSavedViewsError("");
  }

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
        setSavedViews(Array.isArray(res?.filters) ? res.filters.map(normalizeSavedView).filter(Boolean) : []);
        setSavedViewsError("");
      })
      .catch((err) => {
        if (cancelled) return;
        setSavedViews([]);
        setSavedViewsError(err?.message || t("settings.saved_views_load_failed"));
      });
    return () => {
      cancelled = true;
    };
  }, [canManageSavedViews, savedViewsEntityId]);

  const defaultSavedView = useMemo(
    () => savedViews.find((view) => view?.is_default) || null,
    [savedViews]
  );
  const hasMobileMenuOptions = filters.length > 0 || filterableFields.length > 0 || showSavedViews;

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
          domain: savedViewDomain || {},
          state: savedViewState,
        },
      });
      const created = normalizeSavedView(res?.filter);
      if (created) {
        setSavedViews((prev) => [created, ...prev.filter((view) => view?.id !== created.id)]);
      } else {
        await reloadSavedViews();
      }
      setSavedViewsError("");
    } catch (err) {
      setSavedViewsError(err?.message || t("settings.saved_views_save_failed"));
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
      await reloadSavedViews();
      setSavedViewsError("");
    } catch (err) {
      setSavedViewsError(err?.message || t("settings.saved_views_delete_failed"));
    }
  }

  async function handleSetDefaultSavedView(viewId) {
    if (!viewId) return;
    try {
      const res = await apiFetch(`/filters/${encodeURIComponent(viewId)}`, {
        method: "PUT",
        body: { is_default: true },
      });
      const updated = normalizeSavedView(res?.filter);
      setSavedViews((prev) =>
        prev.map((view) => {
          if (!view?.id) return view;
          if (view.id === viewId) return { ...view, ...(updated || {}), is_default: true };
          return { ...view, is_default: false };
        })
      );
      await reloadSavedViews();
      setSavedViewsError("");
    } catch (err) {
      setSavedViewsError(err?.message || t("settings.saved_views_default_failed"));
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 relative z-30 shrink-0 w-full min-w-0">
        <div className="flex items-center gap-2 min-w-[12rem]">
          {onCreate && (
            <DaisyTooltip label={resolvedCreateTooltip} placement="bottom">
              <button className={PRIMARY_BUTTON_SM} onClick={onCreate}>
                <Plus className="h-4 w-4" />
              </button>
            </DaisyTooltip>
          )}
          <div className="text-lg font-semibold">{title}</div>
        </div>

        <div className={`flex items-center justify-center flex-1 min-w-0 ${isMobile ? "hidden" : ""}`}>
          <div className="join items-center overflow-visible">
            <DaisyTooltip label={t("common.search")} className="join-item" placement="bottom">
              <button className={SOFT_ICON_SM}>
                <SearchIcon className="h-4 w-4" />
              </button>
            </DaisyTooltip>
            <input
              className="input input-bordered input-sm join-item toolbar-search-input w-full max-w-xs py-0 leading-none"
              placeholder={t("common.search")}
              value={searchValue}
              onChange={(e) => onSearchChange?.(e.target.value)}
            />
            <div className="dropdown dropdown-end dropdown-bottom join-item">
              <DaisyTooltip label={t("common.filters")} className="join-item" placement="bottom">
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
                  {filterableFields.length > 0 && <li className="menu-title">{t("common.custom")}</li>}
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
                    <button onClick={() => onClearFilters?.()}>{t("common.clear")}</button>
                  </li>
                </ul>
              </div>
            </div>
            {showSavedViews && (
              <div className="dropdown dropdown-end dropdown-bottom join-item">
                <DaisyTooltip label={t("settings.saved_views")} className="join-item" placement="bottom">
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
                            {view?.is_default ? ` (${t("settings.default_view")})` : ""}
                          </button>
                          <button
                            className="btn btn-ghost btn-xs"
                            onClick={() => handleSetDefaultSavedView(view.id)}
                            type="button"
                          >
                            {t("settings.default_view")}
                          </button>
                          <button
                            className="btn btn-ghost btn-xs text-error"
                            onClick={() => handleDeleteSavedView(view.id)}
                            type="button"
                          >
                            {t("common.delete")}
                          </button>
                        </div>
                      </li>
                    ))}
                    {canManageSavedViews && savedViews.length === 0 ? <li><span className="text-xs opacity-60">{t("settings.no_saved_views")}</span></li> : null}
                    <li>
                      <button
                        onClick={() => {
                          if (!canSaveCurrentView) return;
                          setSavePromptOpen(true);
                          setSavePromptValue("");
                        }}
                        disabled={!canSaveCurrentView}
                      >
                        {t("settings.save_current_view")}
                      </button>
                    </li>
                    {defaultSavedView ? <li><span className="text-xs opacity-60">{t("settings.default_named", { name: defaultSavedView.name })}</span></li> : null}
                  </ul>
                </div>
              </div>
            )}
            <DaisyTooltip label={t("common.refresh")} className="join-item" placement="bottom">
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
              <DaisyTooltip label={t("common.record")} className="join-item" placement="top">
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

        {isMobile && (
          <div className="order-4 flex w-full items-center gap-2 min-w-0">
            <DaisyTooltip label={t("common.search")} placement="top">
              <button
                className={`${SOFT_ICON_SM} shrink-0`}
                type="button"
                aria-label={t("common.search")}
                onClick={() => setMobileSearchOpen((open) => !open)}
              >
                <SearchIcon className="h-4 w-4" />
              </button>
            </DaisyTooltip>
            {onRefresh && (
              <DaisyTooltip label={t("common.refresh")} placement="top">
                <button
                  className={`${SOFT_ICON_SM} shrink-0`}
                  type="button"
                  onClick={onRefresh}
                  aria-label={t("common.refresh")}
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
              </DaisyTooltip>
            )}
            {hasMobileMenuOptions && (
              <DaisyTooltip label={t("common.more_actions")} placement="top">
                <button
                  className={`${SOFT_ICON_SM} shrink-0`}
                  type="button"
                  aria-label={t("common.more_actions")}
                  onClick={() => setMobileMenuOpen(true)}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DaisyTooltip>
            )}
          </div>
        )}

        {isMobile && mobileSearchOpen && (
          <div className="order-5 w-full shrink-0">
            <input
              className="input input-bordered w-full"
              placeholder={t("common.search")}
              value={searchValue}
              onChange={(e) => onSearchChange?.(e.target.value)}
              autoFocus
            />
          </div>
        )}
      </div>

      {isMobile && mobileMenuOpen && (
        <div className="fixed inset-0 z-[220]">
          <button
            type="button"
            className="absolute inset-0 bg-base-content/35"
            aria-label={t("common.close")}
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-base-300 bg-base-100 p-4 shadow-2xl">
            <div className="mx-auto mb-4 h-1.5 w-24 rounded-full bg-base-300" />
            <div className="max-h-[60vh] overflow-auto space-y-2">
              {(filters.length > 0 || filterableFields.length > 0) && (
                <div className="border-b border-base-300 pb-2 mb-2">
                  <div className="px-2 pb-2 text-sm font-semibold">{t("common.filters")}</div>
                  {filters.map((flt) => (
                    <button
                      key={flt.id}
                      type="button"
                      className="flex w-full items-center rounded-2xl px-4 py-4 text-left text-base hover:bg-base-200"
                      onClick={() => {
                        onFilterChange?.(flt.id);
                        setMobileMenuOpen(false);
                      }}
                    >
                      {flt.label}
                    </button>
                  ))}
                  {filterableFields.length > 0 ? (
                    <div className="px-2 pt-2 text-xs font-semibold uppercase tracking-wide opacity-50">{t("common.custom")}</div>
                  ) : null}
                  {filterableFields.map((field) => (
                    <button
                      key={field.id}
                      type="button"
                      className="flex w-full items-center rounded-2xl px-4 py-4 text-left text-base hover:bg-base-200"
                      onClick={() => {
                        setFilterPrompt({ field });
                        setFilterPromptValue("");
                        setMobileMenuOpen(false);
                      }}
                    >
                      {field.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="flex w-full items-center rounded-2xl px-4 py-4 text-left text-base hover:bg-base-200"
                    onClick={() => {
                      onClearFilters?.();
                      setMobileMenuOpen(false);
                    }}
                  >
                    {t("common.clear")}
                  </button>
                </div>
              )}

              {showSavedViews && (
                <div className="space-y-2">
                  <div className="px-2 pb-2 text-sm font-semibold">{t("settings.saved_views")}</div>
                  {savedViewsError ? <div className="px-4 text-sm text-error">{savedViewsError}</div> : null}
                  {canManageSavedViews && savedViews.map((view) => (
                    <div key={view.id} className="flex items-center gap-2 rounded-2xl px-2 py-1 hover:bg-base-200">
                      <button
                        type="button"
                        className="flex-1 rounded-xl px-2 py-3 text-left text-base"
                        onClick={() => {
                          onApplySavedViewState?.(view?.state || {}, view);
                          setMobileMenuOpen(false);
                        }}
                      >
                        {view.name}
                        {view?.is_default ? ` (${t("settings.default_view")})` : ""}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleSetDefaultSavedView(view.id)}
                        type="button"
                      >
                        {t("settings.default_view")}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm text-error"
                        onClick={() => handleDeleteSavedView(view.id)}
                        type="button"
                      >
                        {t("common.delete")}
                      </button>
                    </div>
                  ))}
                  {canManageSavedViews && savedViews.length === 0 ? <div className="px-4 text-sm opacity-60">{t("settings.no_saved_views")}</div> : null}
                  <button
                    type="button"
                    className="flex w-full items-center rounded-2xl px-4 py-4 text-left text-base hover:bg-base-200 disabled:opacity-50"
                    onClick={() => {
                      if (!canSaveCurrentView) return;
                      setSavePromptOpen(true);
                      setSavePromptValue("");
                      setMobileMenuOpen(false);
                    }}
                    disabled={!canSaveCurrentView}
                  >
                    {t("settings.save_current_view")}
                  </button>
                  {defaultSavedView ? <div className="px-4 text-xs opacity-60">{t("settings.default_named", { name: defaultSavedView.name })}</div> : null}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {filterPrompt && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">
              {t("common.filter")} {filterPrompt.field?.label || filterPrompt.field?.id || t("common.field")}
            </h3>
            <div className="py-2 text-sm opacity-70">{t("settings.enter_filter_value")}</div>
            <input
              className="input input-bordered input-sm w-full"
              placeholder={t("settings.value")}
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
                {t("common.cancel")}
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
                {t("settings.apply")}
              </button>
            </div>
          </div>
        </div>
      )}

      {savePromptOpen && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">{t("common.save_current_view")}</h3>
            <div className="py-2 text-sm opacity-70">{t("common.give_saved_view_name")}</div>
            <input
              className="input input-bordered input-sm w-full"
              placeholder={t("common.view_name")}
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
                {t("common.cancel")}
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
