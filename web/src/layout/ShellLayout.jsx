import React, { useEffect } from "react";
import { useLocation, Outlet } from "react-router-dom";
import TopNav from "./TopNav.jsx";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import { recordRecentApp } from "../state/appUsage.js";

export default function ShellLayout({ user, onSignOut, children }) {
  const location = useLocation();
  useEffect(() => {
    const parts = location.pathname.split("/").filter(Boolean);
    if (parts[0] === "apps" && parts[1]) {
      recordRecentApp(parts[1]);
    } else if (parts[0] === "data" && parts[1]) {
      recordRecentApp(parts[1]);
    }
  }, [location.pathname]);

  if (!user) {
    return <LoadingSpinner className="h-screen" />;
  }
  const isHome = location.pathname === "/";
  const mainClass = isHome
    ? "flex-1 min-h-0 overflow-hidden p-0"
    : "flex-1 min-h-0 overflow-y-auto p-6";

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopNav user={user} onSignOut={onSignOut} />
      <main className={mainClass}>{children || <Outlet />}</main>
    </div>
  );
}
