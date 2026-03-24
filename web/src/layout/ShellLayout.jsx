import React, { useEffect, useMemo } from "react";
import { useLocation, Outlet } from "react-router-dom";
import TopNav from "./TopNav.jsx";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import { recordRecentApp } from "../state/appUsage.js";
import {
  clearOctoAiSandboxSessionId,
} from "../api.js";

export default function ShellLayout({ user, onSignOut, children }) {
  const location = useLocation();
  const search = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const isEmbedMode = search.get("octo_ai_embed") === "1";
  const isFrameMode = search.get("octo_ai_frame") === "1";
  const isNestedFrame = typeof window !== "undefined" && window.self !== window.top;
  useEffect(() => {
    const parts = location.pathname.split("/").filter(Boolean);
    if (parts[0] === "apps" && parts[1]) {
      recordRecentApp(parts[1]);
    } else if (parts[0] === "data" && parts[1]) {
      recordRecentApp(parts[1]);
    }
  }, [location.pathname]);
  useEffect(() => {
    // The legacy global sandbox dock is retired. Keep any stale session storage cleared
    // so top-level /home never resurrects the old right-side Octo AI panel.
    if (!isFrameMode && !isNestedFrame) {
      clearOctoAiSandboxSessionId();
    }
  }, [isFrameMode, isNestedFrame]);

  const isHome = location.pathname === "/";
  const baseMainClass = isEmbedMode || isHome
    ? "flex-1 min-h-0 overflow-hidden p-0"
    : "flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 lg:p-6";
  const mainClass = baseMainClass;

  if (!user) {
    return <LoadingSpinner className="h-screen" />;
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {isEmbedMode ? null : <TopNav user={user} onSignOut={onSignOut} />}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <main className={`${mainClass} ${isEmbedMode ? "h-full w-full" : ""}`}>{children || <Outlet />}</main>
      </div>
    </div>
  );
}
