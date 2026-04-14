import React, { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import Tabs from "../components/Tabs.jsx";
import useMediaQuery from "../hooks/useMediaQuery.js";
import { DESKTOP_PAGE_SHELL, DESKTOP_PAGE_SHELL_BODY } from "./pageShell.js";
import { translateRuntime } from "../i18n/runtime.js";

// A reusable "studio-like" shell: title + tabs + a single scrollable pane.
// Used for settings/reference pages that should feel like the studio tab pane (no side panels).
export default function TabbedPaneShell({
  title,
  subtitle,
  tabs = [],
  activeTabId,
  onTabChange,
  rightActions = null,
  mobilePrimaryActions = [],
  mobileOverflowActions = [],
  contentContainer = false,
  contentContainerClass = "min-h-full",
  children,
}) {
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const mobileActionsRef = useRef(null);
  const hasMobilePrimaryActions = isMobile && mobilePrimaryActions.length > 0;
  const hasMobileOverflowActions = isMobile && mobileOverflowActions.length > 0;
  const hasHeaderContent = Boolean(title || subtitle || rightActions || hasMobilePrimaryActions || hasMobileOverflowActions);

  useEffect(() => {
    if (!mobileActionsOpen) return undefined;
    function handlePointerDown(event) {
      if (!mobileActionsRef.current) return;
      if (!mobileActionsRef.current.contains(event.target)) {
        setMobileActionsOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [mobileActionsOpen]);

  return (
    <div className={`h-full min-h-0 flex flex-col overflow-hidden ${isMobile ? "bg-base-100" : ""}`}>
      <div className={`${isMobile ? "h-full min-h-0 flex flex-col bg-base-100 overflow-hidden" : DESKTOP_PAGE_SHELL}`}>
        <div className={`${isMobile ? "h-full min-h-0 p-4 flex flex-col" : `${DESKTOP_PAGE_SHELL_BODY} p-3 sm:p-4`}`}>
          {hasHeaderContent ? (
            <div className="shrink-0 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                {title ? <div className="text-base font-semibold truncate">{title}</div> : null}
                {subtitle ? <div className="text-sm opacity-70 mt-1">{subtitle}</div> : null}
                {hasMobilePrimaryActions ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {mobilePrimaryActions.map((action) => (
                      <button
                        key={action.label}
                        type="button"
                        className={action.className || "btn btn-primary btn-sm"}
                        onClick={action.onClick}
                        disabled={action.disabled}
                        title={action.title}
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              {hasMobileOverflowActions ? (
                <div className="relative shrink-0" ref={mobileActionsRef}>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    aria-label={translateRuntime("common.more_actions")}
                    onClick={() => setMobileActionsOpen((open) => !open)}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  {mobileActionsOpen ? (
                    <ul className="absolute right-0 top-full z-[220] mt-2 menu w-56 rounded-box border border-base-300 bg-base-100 p-2 shadow">
                      {mobileOverflowActions.map((action) => (
                        <li key={action.label}>
                          <button
                            type="button"
                            onClick={() => {
                              if (action.disabled) return;
                              action.onClick?.();
                              setMobileActionsOpen(false);
                            }}
                            disabled={action.disabled}
                            title={action.title}
                          >
                            {action.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : rightActions ? <div className={`shrink-0 ${isMobile ? "hidden" : ""}`}>{rightActions}</div> : null}
            </div>
          ) : null}

          {Array.isArray(tabs) && tabs.length > 0 ? (
            <div className={`shrink-0 ${hasHeaderContent ? "mt-4" : ""}`}>
              <Tabs tabs={tabs} activeId={activeTabId} onChange={onTabChange} />
            </div>
          ) : null}

          <div className={`${hasHeaderContent || (Array.isArray(tabs) && tabs.length > 0) ? "mt-4" : ""} flex-1 min-h-0 overflow-auto ${isMobile ? "bg-base-100" : ""}`}>
            {contentContainer ? <div className={contentContainerClass}>{children}</div> : children}
          </div>
        </div>
      </div>
    </div>
  );
}
