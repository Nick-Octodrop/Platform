import React from "react";
import { Link, useLocation } from "react-router-dom";
import useMediaQuery from "../hooks/useMediaQuery.js";
import { useI18n } from "../i18n/LocalizationProvider.jsx";

export default function DesktopOnlyGate({ feature = null, children }) {
  const isMobile = useMediaQuery("(max-width: 1024px)");
  const location = useLocation();
  const { t } = useI18n();
  const featureLabel = feature || t("common.this_section");

  if (!isMobile) return children;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title">{t("common.desktop_only_for_now", { feature: featureLabel })}</h2>
          <p className="text-sm opacity-80">
            {t("common.best_on_larger_screen")}
          </p>
          <div className="text-xs opacity-60 break-all">
            {t("common.requested_path", { path: location.pathname })}
          </div>
          <div className="card-actions justify-end mt-2">
            <Link className="btn btn-ghost btn-sm" to="/home">{t("common.back_to_home")}</Link>
            <Link className="btn btn-primary btn-sm" to="/apps">{t("common.open_apps")}</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
