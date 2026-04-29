import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import LoadingSpinner from "../components/LoadingSpinner.jsx";

const HANDOFF_COMPLETED_STORAGE_KEY = "octo_password_handoff_completed_users";

function hasCompletedPasswordHandoff(userId) {
  if (typeof window === "undefined" || !userId) return false;
  try {
    const raw = window.localStorage.getItem(HANDOFF_COMPLETED_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) && parsed.includes(userId);
  } catch {
    return false;
  }
}

export default function ProtectedRoute({ user, loading, children, allowPasswordHandoff = false }) {
  const location = useLocation();
  if (loading) {
    return <LoadingSpinner className="h-screen" />;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (
    !allowPasswordHandoff &&
    user?.app_metadata?.octo_managed_account_state === "handoff_required" &&
    !hasCompletedPasswordHandoff(user?.id)
  ) {
    return <Navigate to="/auth/set-password" replace state={{ from: location.pathname }} />;
  }
  return children;
}
