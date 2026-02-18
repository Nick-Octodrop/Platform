import React from "react";
import { Navigate, useParams } from "react-router-dom";

export default function ModuleDetailPage() {
  const { moduleId } = useParams();
  if (!moduleId) return <Navigate to="/settings/diagnostics" replace />;
  return <Navigate to={`/settings/diagnostics/${encodeURIComponent(moduleId)}`} replace />;
}
