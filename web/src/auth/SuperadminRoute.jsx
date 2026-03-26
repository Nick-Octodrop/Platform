import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import { useAccessContext } from "../access.js";

export default function SuperadminRoute({ children }) {
  const location = useLocation();
  const { loading, error, isSuperadmin } = useAccessContext();

  if (loading) {
    return <LoadingSpinner className="min-h-[40vh]" />;
  }
  if (error) {
    return <div className="alert alert-error">{error}</div>;
  }
  if (!isSuperadmin) {
    return <Navigate to="/home" replace state={{ from: location.pathname }} />;
  }
  return children;
}
