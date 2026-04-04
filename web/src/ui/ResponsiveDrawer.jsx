import React, { useEffect } from "react";
import { X } from "lucide-react";
import useMediaQuery from "../hooks/useMediaQuery.js";
import { SOFT_BUTTON_SM } from "../components/buttonStyles.js";

export default function ResponsiveDrawer({
  open,
  onClose,
  title,
  description = "",
  children,
  desktopWidthClass = "w-[34vw] min-w-[460px] max-w-[600px]",
  mobileHeightClass = "h-[88dvh] max-h-[88dvh]",
  zIndexClass = "z-[260]",
  panelClassName = "",
}) {
  const isMobile = useMediaQuery("(max-width: 768px)");

  useEffect(() => {
    if (!open) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose?.();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={`fixed inset-0 ${zIndexClass}`}>
      <button
        type="button"
        className="absolute inset-0 bg-base-content/35"
        aria-label="Close panel"
        onClick={() => onClose?.()}
      />
      {isMobile ? (
        <div className={`absolute inset-x-0 bottom-0 ${mobileHeightClass} overflow-hidden rounded-t-3xl border-t border-base-300 bg-base-100 shadow-2xl ${panelClassName}`}>
          <div className="flex h-full min-h-0 flex-col p-4">
            <div className="mx-auto mb-4 h-1.5 w-24 rounded-full bg-base-300" />
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-base font-semibold">{title}</div>
                {description ? <div className="mt-1 text-sm opacity-70">{description}</div> : null}
              </div>
              <button type="button" className={SOFT_BUTTON_SM} onClick={() => onClose?.()}>
                Done
              </button>
            </div>
            <div
              className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain"
              style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
            >
              {children}
            </div>
          </div>
        </div>
      ) : (
        <div className={`absolute inset-y-0 right-0 w-full overflow-hidden ${desktopWidthClass} border-l border-base-300 bg-base-100 shadow-2xl ${panelClassName}`}>
          <div className="flex h-full min-h-0 flex-col p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-lg font-semibold">{title}</div>
                {description ? <div className="mt-1 text-sm opacity-70">{description}</div> : null}
              </div>
              <button type="button" className={SOFT_BUTTON_SM} aria-label="Close panel" onClick={() => onClose?.()}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div
              className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain"
              style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
            >
              {children}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
