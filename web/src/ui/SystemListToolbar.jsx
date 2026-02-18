import React, { useState } from "react";
import { Bookmark, Filter, List as ListIcon, Plus, RefreshCw, Search as SearchIcon } from "lucide-react";
import { PRIMARY_BUTTON_SM, SOFT_ICON_SM } from "../components/buttonStyles.js";
import PaginationControls from "../components/PaginationControls.jsx";
import DaisyTooltip from "../components/DaisyTooltip.jsx";

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
}) {
  const [filterPrompt, setFilterPrompt] = useState(null);
  const [filterPromptValue, setFilterPromptValue] = useState("");

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
              className="input input-bordered input-sm join-item w-full max-w-xs h-8 min-h-8 py-0 leading-none"
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
                    <li><button disabled>Save current view</button></li>
                    <li><button disabled>Set as default</button></li>
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
    </>
  );
}
