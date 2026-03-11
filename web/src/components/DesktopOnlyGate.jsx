import React from "react";
import { Link, useLocation } from "react-router-dom";
import useMediaQuery from "../hooks/useMediaQuery.js";

export default function DesktopOnlyGate({ feature = "This section", children }) {
  const isMobile = useMediaQuery("(max-width: 1024px)");
  const location = useLocation();

  if (!isMobile) return children;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title">{feature} Is Desktop-Only For Now</h2>
          <p className="text-sm opacity-80">
            This area has advanced editors and works best on a larger screen. Use desktop/laptop to continue.
          </p>
          <div className="text-xs opacity-60 break-all">
            Requested path: {location.pathname}
          </div>
          <div className="card-actions justify-end mt-2">
            <Link className="btn btn-ghost btn-sm" to="/home">Back To Home</Link>
            <Link className="btn btn-primary btn-sm" to="/apps">Open Apps</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
