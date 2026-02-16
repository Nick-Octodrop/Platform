import React from "react";
import { Navigate } from "react-router-dom";
import LoadingSpinner from "../components/LoadingSpinner.jsx";

export default function ProtectedRoute({ user, loading, children }) {
  if (loading) {
    return <LoadingSpinner className="h-screen" />;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return children;
}
