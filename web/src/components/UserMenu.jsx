import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import useMediaQuery from "../hooks/useMediaQuery.js";
import { useI18n } from "../i18n/LocalizationProvider.jsx";

export default function UserMenu({ user, onSignOut }) {
  const { t } = useI18n();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);
  const email = user?.email || t("settings.account_title");
  const compact = user?.email ? user.email.split("@")[0] : t("settings.account_title");

  useEffect(() => {
    if (!open || isMobile) return undefined;
    function handlePointerDown(event) {
      if (!panelRef.current) return;
      if (!panelRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [open, isMobile]);

  useEffect(() => {
    if (!open || !isMobile) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open, isMobile]);

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        className="btn btn-ghost btn-sm max-w-[9rem] sm:max-w-[14rem]"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="sm:hidden truncate">{compact}</span>
        <span className="hidden sm:inline truncate">{email}</span>
      </button>
      {open && !isMobile && (
        <ul className="absolute right-0 mt-2 menu p-2 shadow bg-base-100 rounded-box w-56 z-50">
          <li><Link to="/settings" onClick={() => setOpen(false)}>{t("navigation.settings")}</Link></li>
          <li><button onClick={onSignOut}>{t("settings.sign_out")}</button></li>
        </ul>
      )}
      {open && isMobile && (
        <div className="fixed inset-0 z-[220]">
          <button
            type="button"
            className="absolute inset-0 bg-base-content/35"
            aria-label={t("common.close")}
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-base-100 border-t border-base-300 shadow-2xl p-4">
            <div className="mx-auto mb-4 h-1.5 w-24 rounded-full bg-base-300" />
            <div className="mb-3 px-2">
              <div className="text-sm font-semibold truncate">{compact}</div>
              <div className="text-xs opacity-60 truncate">{email}</div>
            </div>
            <div className="space-y-2">
              <Link
                to="/settings"
                className="flex w-full items-center rounded-2xl px-4 py-4 text-left text-base hover:bg-base-200"
                onClick={() => setOpen(false)}
              >
                {t("navigation.settings")}
              </Link>
              <button
                type="button"
                className="flex w-full items-center rounded-2xl px-4 py-4 text-left text-base hover:bg-base-200"
                onClick={onSignOut}
              >
                {t("settings.sign_out")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
