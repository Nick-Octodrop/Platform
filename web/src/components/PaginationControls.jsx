import React, { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { SOFT_ICON_SM } from "./buttonStyles.js";

export default function PaginationControls({
  page = 0,
  pageSize = 25,
  totalItems = 0,
  onPageChange,
  className = "",
}) {
  const safeTotal = Number.isFinite(totalItems) ? Math.max(0, totalItems) : 0;
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 25;
  const totalPages = Math.max(1, Math.ceil(safeTotal / safePageSize));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);

  const range = useMemo(() => {
    if (safeTotal === 0) return { from: 0, to: 0 };
    const from = safePage * safePageSize + 1;
    const to = Math.min(safeTotal, (safePage + 1) * safePageSize);
    return { from, to };
  }, [safePage, safePageSize, safeTotal]);

  const canPrev = safePage > 0;
  const canNext = safePage < totalPages - 1;

  return (
    <div className={`flex items-center gap-2 ${className}`.trim()}>
      <div className="join">
        <button
          className={`${SOFT_ICON_SM} join-item tooltip`}
          data-tip="Previous"
          type="button"
          disabled={!canPrev}
          onClick={() => onPageChange?.(safePage - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="join-item h-8 min-h-8 px-2 flex items-center text-xs opacity-80 tabular-nums border border-base-content/20 bg-base-100">
          {safePage + 1} / {totalPages}
        </div>
        <button
          className={`${SOFT_ICON_SM} join-item tooltip`}
          data-tip="Next"
          type="button"
          disabled={!canNext}
          onClick={() => onPageChange?.(safePage + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
