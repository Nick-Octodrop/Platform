import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { SOFT_ICON_SM } from "./buttonStyles.js";
import DaisyTooltip from "./DaisyTooltip.jsx";

export default function PaginationControls({
  page = 0,
  pageSize = 25,
  totalItems = 0,
  onPageChange,
  className = "",
}) {
  const safeTotal = Number.isFinite(totalItems) ? Math.max(0, totalItems) : 0;
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 25;
  if (safeTotal <= safePageSize) return null;
  const totalPages = Math.max(1, Math.ceil(safeTotal / safePageSize));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);

  const canPrev = safePage > 0;
  const canNext = safePage < totalPages - 1;

  return (
    <div className={`flex items-center gap-2 ${className}`.trim()}>
      <div className="join">
        <DaisyTooltip label="Previous" className="join-item" placement="top">
          <button
            className={SOFT_ICON_SM}
            type="button"
            disabled={!canPrev}
            onClick={() => onPageChange?.(safePage - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </DaisyTooltip>
        <div className="join-item h-8 min-h-8 px-2 flex items-center text-xs opacity-80 tabular-nums border border-base-content/20 bg-base-100">
          {safePage + 1} / {totalPages}
        </div>
        <DaisyTooltip label="Next" className="join-item" placement="top">
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
