import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { SOFT_ICON_SM } from "./buttonStyles.js";
import DaisyTooltip from "./DaisyTooltip.jsx";
import useMediaQuery from "../hooks/useMediaQuery.js";
import { translateRuntime } from "../i18n/runtime.js";

export default function PaginationControls({
  page = 0,
  pageSize = 25,
  totalItems = 0,
  onPageChange,
  className = "",
}) {
  const isMobile = useMediaQuery("(max-width: 768px)");
  const safeTotal = Number.isFinite(totalItems) ? Math.max(0, totalItems) : 0;
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 25;
  if (safeTotal <= safePageSize) return null;
  const totalPages = Math.max(1, Math.ceil(safeTotal / safePageSize));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);

  const canPrev = safePage > 0;
  const canNext = safePage < totalPages - 1;

  return (
    <div className={`flex items-center ${isMobile ? "gap-1" : "gap-2"} ${className}`.trim()}>
      <div className="join">
        <DaisyTooltip label={translateRuntime("common.previous")} className="join-item" placement="top">
          <button
            className={SOFT_ICON_SM}
            type="button"
            disabled={!canPrev}
            onClick={() => onPageChange?.(safePage - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </DaisyTooltip>
        <div className={`join-item pagination-page-indicator h-8 min-h-8 flex items-center opacity-80 tabular-nums border border-base-content/20 bg-base-100 ${isMobile ? "px-1.5 text-[11px]" : "px-2 text-xs"}`}>
          {safePage + 1} / {totalPages}
        </div>
        <DaisyTooltip label={translateRuntime("common.next")} className="join-item" placement="top">
          <button
            className={SOFT_ICON_SM}
            type="button"
            disabled={!canNext}
            onClick={() => onPageChange?.(safePage + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </DaisyTooltip>
      </div>
    </div>
  );
}
