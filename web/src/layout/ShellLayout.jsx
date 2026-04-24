import React, { useEffect, useMemo } from "react";
import { useLocation, Outlet } from "react-router-dom";
import TopNav from "./TopNav.jsx";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import { recordRecentApp } from "../state/appUsage.js";
import useMediaQuery from "../hooks/useMediaQuery.js";
import {
  clearOctoAiSandboxSessionId,
} from "../api.js";

export default function ShellLayout({ user, onSignOut, children }) {
  const location = useLocation();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const pathname = typeof location?.pathname === "string" ? location.pathname : "/";
  const searchText = typeof location?.search === "string" ? location.search : "";
  const search = useMemo(() => new URLSearchParams(searchText), [searchText]);
  const isEmbedMode = search.get("octo_ai_embed") === "1";
  const isFrameMode = search.get("octo_ai_frame") === "1";
  const isNestedFrame = typeof window !== "undefined" && window.self !== window.top;
  const isAppRoute = pathname === "/apps" || pathname.startsWith("/apps/");
  const isSettingsRoute = pathname.startsWith("/settings");
  const isStudioRoute = pathname.startsWith("/studio");
  const isOctoAiRoute = pathname.startsWith("/octo-ai");
  const isAutomationRoute = pathname.startsWith("/automations") || pathname.startsWith("/automation-runs");
  const isTemplateStudioRoute =
    pathname.startsWith("/email/templates/")
    || pathname.startsWith("/documents/templates/");
  useEffect(() => {
    const parts = pathname.split("/").filter(Boolean);
    if (parts[0] === "apps" && parts[1]) {
      recordRecentApp(parts[1]);
    } else if (parts[0] === "data" && parts[1]) {
      recordRecentApp(parts[1]);
    }
  }, [pathname]);
  useEffect(() => {
    // The legacy global sandbox dock is retired. Keep any stale session storage cleared
    // so top-level /home never resurrects the old right-side Octo AI panel.
    if (!isFrameMode && !isNestedFrame) {
      clearOctoAiSandboxSessionId();
    }
  }, [isFrameMode, isNestedFrame]);

  const isHome = pathname === "/";
  const hideTopNav = isEmbedMode;
  const shellHeightClass = isMobile ? "h-[100dvh]" : "h-screen";
  const baseMainClass = isEmbedMode || isHome
    ? "flex-1 min-h-0 overflow-hidden p-0"
    : isFrameMode && isMobile
      ? "flex-1 min-h-0 overflow-y-auto p-0"
    : isFrameMode
      ? "flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 lg:p-6"
    : isMobile && isAppRoute
        ? "flex-1 min-h-0 overflow-y-auto p-0"
      : isMobile && isSettingsRoute
        ? "flex-1 min-h-0 overflow-y-auto p-0"
        : isMobile && (isStudioRoute || isOctoAiRoute || isAutomationRoute || isTemplateStudioRoute)
          ? "flex-1 min-h-0 overflow-y-auto p-0"
      : "flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 lg:p-6";
  const mainClass = baseMainClass;

  if (!user) {
    return <LoadingSpinner className={shellHeightClass} />;
  }

  return (
    <div className={`flex ${shellHeightClass} flex-col overflow-hidden`}>
      {hideTopNav ? null : <TopNav user={user} onSignOut={onSignOut} frameMode={isFrameMode} />}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <main className={`${mainClass} ${isEmbedMode ? "h-full w-full" : ""}`}>{children || <Outlet />}</main>
      </div>
    </div>
  );
}
