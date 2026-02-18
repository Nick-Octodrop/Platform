import React from "react";
import Tabs from "../components/Tabs.jsx";

// A reusable "studio-like" shell: title + tabs + a single scrollable pane.
// Used for settings/reference pages that should feel like the studio tab pane (no side panels).
export default function TabbedPaneShell({
  title,
  subtitle,
  tabs = [],
  activeTabId,
  onTabChange,
  rightActions = null,
  children,
}) {
  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <div className="card bg-base-100 border border-base-300 shadow-sm h-full min-h-0 flex flex-col overflow-hidden">
        <div className="card-body flex flex-col min-h-0">
          <div className="shrink-0 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-base font-semibold truncate">{title}</div>
              {subtitle ? <div className="text-sm opacity-70 mt-1">{subtitle}</div> : null}
            </div>
            {rightActions ? <div className="shrink-0">{rightActions}</div> : null}
          </div>

          {Array.isArray(tabs) && tabs.length > 0 ? (
            <div className="shrink-0 mt-4">
              <Tabs tabs={tabs} activeId={activeTabId} onChange={onTabChange} />
            </div>
          ) : null}

          <div className="mt-4 flex-1 min-h-0 overflow-auto">{children}</div>
        </div>
      </div>
    </div>
  );
}

