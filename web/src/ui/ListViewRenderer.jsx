import React, { useEffect, useMemo, useState } from "react";
import { FixedSizeList as VirtualList } from "react-window";
import { getFieldValue } from "./field_renderers.jsx";
import { resolveFieldLabel } from "../utils/labels.js";
import { formatDateLike } from "../utils/dateTime.js";
import { evalCondition } from "../utils/conditions.js";
import { formatFieldValue } from "../utils/fieldFormatting.js";
import { PRIMARY_BUTTON_SM, SOFT_BUTTON_SM } from "../components/buttonStyles.js";
import { apiFetch } from "../api.js";
import PaginationControls from "../components/PaginationControls.jsx";
import DaisyTooltip from "../components/DaisyTooltip.jsx";
import useMediaQuery from "../hooks/useMediaQuery.js";

const DEFAULT_PAGE_SIZE = 25;

function normalizeEnumOptions(options) {
  if (!Array.isArray(options)) return [];
  return options
    .map((opt) => {
      if (typeof opt === "string") {
        return { value: opt, label: opt.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) };
      }
      if (opt && typeof opt === "object") {
        const value = opt.value ?? opt.id ?? opt.key;
        const label = opt.label ?? value;
        return value != null ? { value, label } : null;
      }
      return null;
    })
    .filter(Boolean);
}

function getRowId(row) {
  if (!row || typeof row !== "object") return null;
  if (row.record_id) return row.record_id;
  if (row.record?.id) return row.record.id;
  const record = row.record;
  if (!record || typeof record !== "object") return null;
  const explicitIdKey = Object.keys(record).find((key) => typeof key === "string" && key.endsWith(".id"));
  return explicitIdKey ? record[explicitIdKey] : null;
}

function isUuidLike(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

export default function ListViewRenderer({
  view,
  fieldIndex,
  records,
  onSelectRow,
  selectedIds = [],
  onToggleSelect,
  onToggleAll,
  header,
  searchQuery = "",
  searchFields = [],
  onSearchChange,
  filters = [],
  activeFilter = null,
  onFilterChange,
  clientFilters = [],
  primaryActions = [],
  secondaryActions = [],
  bulkActions = [],
  onActionClick,
  hideHeader = false,
  disableHorizontalScroll = false,
  tableClassName = "",
  page: externalPage = null,
  pageSize = DEFAULT_PAGE_SIZE,
  onPageChange,
  onTotalItemsChange,
  showPaginationControls = true,
  enableSelection = true,
  emptyLabel = null,
}) {
  if (!view) return <div className="alert">Missing list view</div>;
  const columns = view.columns || [];
  const missing = columns.find((c) => !fieldIndex[c.field_id]);
  if (missing) {
    return <div className="alert alert-error">Missing field in manifest: {missing.field_id}</div>;
  }
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [lookupLabels, setLookupLabels] = useState({});
  const [memberLabels, setMemberLabels] = useState({});
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [internalPage, setInternalPage] = useState(0);

  const isExternalPagination = typeof externalPage === "number" && typeof onPageChange === "function";
  const page = isExternalPagination ? externalPage : internalPage;
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? pageSize : DEFAULT_PAGE_SIZE;

  useEffect(() => {
    let cancelled = false;
    const lookupColumns = columns
      .map((col) => ({ col, field: fieldIndex[col.field_id] }))
      .filter(({ field }) => field?.type === "lookup" && typeof field?.entity === "string");
    if (lookupColumns.length === 0) return undefined;

    const pending = [];
    for (const { col, field } of lookupColumns) {
      const targetEntityId = field.entity.startsWith("entity.") ? field.entity : `entity.${field.entity}`;
      const labelField = typeof field.display_field === "string" ? field.display_field : null;
      const ids = new Set(
        (records || [])
          .map((row) => String(getFieldValue(row.record || {}, col.field_id) || "").trim())
          .filter(Boolean),
      );
      for (const recordId of ids) {
        const cacheKey = `${col.field_id}:${recordId}`;
        if (Object.prototype.hasOwnProperty.call(lookupLabels, cacheKey)) continue;
        pending.push({ cacheKey, targetEntityId, recordId, labelField });
      }
    }
    if (pending.length === 0) return undefined;

    (async () => {
      const resolved = await Promise.all(
        pending.map(async ({ cacheKey, targetEntityId, recordId, labelField }) => {
          try {
            const res = await apiFetch(`/records/${encodeURIComponent(targetEntityId)}/${encodeURIComponent(recordId)}`);
            const rec = res?.record || {};
            const label =
              (labelField && rec?.[labelField]) ||
              rec?.display_name ||
              rec?.full_name ||
              rec?.name ||
              "";
            return [cacheKey, String(label)];
          } catch {
            return [cacheKey, ""];
          }
        }),
      );
      if (cancelled) return;
      setLookupLabels((prev) => ({ ...prev, ...Object.fromEntries(resolved) }));
    })();

    return () => {
      cancelled = true;
    };
  }, [columns, fieldIndex, records, lookupLabels]);

  useEffect(() => {
    let cancelled = false;
    async function loadMembers() {
      try {
        const res = await apiFetch("/access/members");
        const rows = Array.isArray(res?.members) ? res.members : [];
        const next = {};
        for (const member of rows) {
          const userId = String(member?.user_id || "").trim();
          if (!userId) continue;
          const name = typeof member?.name === "string" ? member.name.trim() : "";
          const email = typeof member?.email === "string" ? member.email.trim() : "";
          next[userId] = name || email || userId;
        }
        if (!cancelled) {
          setMemberLabels(next);
          setMembersLoaded(true);
        }
      } catch {
        if (!cancelled) {
          setMemberLabels({});
          setMembersLoaded(true);
        }
      }
    }
    loadMembers();
    return () => {
      cancelled = true;
    };
  }, []);

  const formatCellValue = (row, col) => {
    const field = fieldIndex[col.field_id];
    const rawValue = getFieldValue(row.record, col.field_id);
    if (rawValue === null || rawValue === undefined) return "";
    if (field?.type === "enum") {
      const opt = normalizeEnumOptions(field.options).find((o) => String(o.value) === String(rawValue));
      return String(opt?.label ?? rawValue);
    }
    if (field?.type === "lookup") {
      const cacheKey = `${col.field_id}:${String(rawValue)}`;
      if (Object.prototype.hasOwnProperty.call(lookupLabels, cacheKey)) {
        return String(lookupLabels[cacheKey] || "");
      }
      return isUuidLike(rawValue) ? "" : String(rawValue);
    }
    if (field?.type === "user") {
      const userId = String(rawValue || "").trim();
      if (membersLoaded) return String(memberLabels[userId] || (isUuidLike(userId) ? "" : userId));
      return isUuidLike(userId) ? "" : userId;
    }
    if (field?.type === "users") {
      const values = Array.isArray(rawValue)
        ? rawValue
        : (typeof rawValue === "string"
            ? rawValue.split(",").map((item) => item.trim()).filter(Boolean)
            : []);
      if (!membersLoaded) {
        return values.every((userId) => isUuidLike(userId)) ? "" : values.join(", ");
      }
      return values.map((userId) => memberLabels[userId] || (isUuidLike(userId) ? "" : userId)).filter(Boolean).join(", ");
    }
    if (field?.type === "number") {
      return formatFieldValue(field, rawValue, row.record || {});
    }
    return String(formatDateLike(rawValue, { fieldType: field?.type, fieldId: col.field_id }));
  };
  const filteredRecords = useMemo(() => {
    let next = Array.isArray(records) ? records : [];
    if (activeFilter?.domain) {
      next = next.filter((row) => evalCondition(activeFilter.domain, { record: row.record || {} }));
    }
    if (searchQuery && searchFields.length > 0) {
      const needle = searchQuery.toLowerCase();
      next = next.filter((row) => {
        const rec = row.record || {};
        return searchFields.some((fieldId) => {
          const value = getFieldValue(rec, fieldId);
          if (value === null || value === undefined) return false;
          return String(value).toLowerCase().includes(needle);
        });
      });
    }
    if (Array.isArray(clientFilters) && clientFilters.length > 0) {
      next = next.filter((row) => {
        const rec = row.record || {};
        return clientFilters.every((flt) => {
          const value = getFieldValue(rec, flt.field_id);
          if (flt.op === "contains") {
            if (value === null || value === undefined) return false;
            return String(value).toLowerCase().includes(String(flt.value || "").toLowerCase());
          }
          if (flt.op === "eq") {
            return String(value ?? "") === String(flt.value ?? "");
          }
          return true;
        });
      });
    }
    return next;
  }, [records, searchQuery, searchFields, activeFilter, clientFilters]);

  const totalItems = filteredRecords.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / Math.max(1, safePageSize)));

  useEffect(() => {
    onTotalItemsChange?.(totalItems);
  }, [totalItems, onTotalItemsChange]);

  useEffect(() => {
    if (page < 0) {
      if (isExternalPagination) onPageChange?.(0);
      else setInternalPage(0);
      return;
    }
    if (page > totalPages - 1) {
      const next = Math.max(0, totalPages - 1);
      if (isExternalPagination) onPageChange?.(next);
      else setInternalPage(next);
    }
  }, [isExternalPagination, onPageChange, page, totalPages]);

  const pagedRecords = useMemo(() => {
    const start = page * Math.max(1, safePageSize);
    return filteredRecords.slice(start, start + Math.max(1, safePageSize));
  }, [filteredRecords, page, safePageSize]);

  const filteredIds = useMemo(
    () => filteredRecords.map((r) => getRowId(r)).filter(Boolean),
    [filteredRecords],
  );
  const allFilteredSelected = useMemo(
    () => filteredIds.length > 0 && filteredIds.every((id) => selectedSet.has(id)),
    [filteredIds, selectedSet],
  );
  const useVirtual = !isMobile && pagedRecords.length > 200;
  const rowHeight = 40;
  const listHeight = Math.min(520, pagedRecords.length * rowHeight + 2);
  const gridTemplate = enableSelection
    ? `2.5rem repeat(${columns.length}, minmax(140px, 1fr))`
    : `repeat(${columns.length}, minmax(140px, 1fr))`;

  return (
    <div className="h-full min-h-0 flex flex-col gap-4">
      {header && !hideHeader && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {primaryActions.map((item) => (
              <DaisyTooltip key={item.label} label={item.label} placement="bottom">
                <button
                  className={PRIMARY_BUTTON_SM}
                  onClick={() => onActionClick?.(item.action)}
                  disabled={!item.enabled}
                >
                  {item.label}
                </button>
              </DaisyTooltip>
            ))}
            {secondaryActions.length > 0 && (
              <div className="dropdown">
                <DaisyTooltip label="More actions" placement="bottom">
                  <button className={SOFT_BUTTON_SM}>More</button>
                </DaisyTooltip>
                <ul className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-48 z-50">
                  {secondaryActions.map((item) => (
                    <li key={item.label}>
                      <button onClick={() => onActionClick?.(item.action)} disabled={!item.enabled}>
                        {item.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {header?.search?.enabled && (
            <input
              className="input input-bordered input-sm w-full max-w-xs"
              placeholder={header.search?.placeholder || "Search..."}
              value={searchQuery}
              onChange={(e) => onSearchChange?.(e.target.value)}
            />
          )}

          <div className="flex items-center gap-2">
            {filters.length > 0 && (
              <div className="dropdown dropdown-end">
                <DaisyTooltip label="Filters" placement="bottom">
                  <button className={SOFT_BUTTON_SM}>
                    {activeFilter?.label || "Filter"}
                  </button>
                </DaisyTooltip>
                <ul className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-56 z-50">
                  {filters.map((flt) => (
                    <li key={flt.id}>
                      <button onClick={() => onFilterChange?.(flt.id)}>{flt.label || flt.id}</button>
                    </li>
                  ))}
                  <li>
                    <button onClick={() => onFilterChange?.("")}>Clear</button>
                  </li>
                </ul>
              </div>
            )}
            {bulkActions.length > 0 && selectedIds.length > 0 && (
              <div className="dropdown dropdown-end">
                <DaisyTooltip label="Bulk actions" placement="bottom">
                  <button className={SOFT_BUTTON_SM}>Bulk actions</button>
                </DaisyTooltip>
                <ul className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-56 z-50">
                  {bulkActions.map((item) => (
                    <li key={item.label}>
                      <button onClick={() => onActionClick?.(item.action)} disabled={!item.enabled}>
                        {item.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {showPaginationControls && totalItems > safePageSize && (
              <PaginationControls
                page={page}
                pageSize={safePageSize}
                totalItems={totalItems}
                onPageChange={(next) => {
                  if (isExternalPagination) onPageChange?.(next);
                  else setInternalPage(next);
                }}
              />
            )}
          </div>
        </div>
      )}

      {showPaginationControls && (hideHeader || !header) && totalItems > safePageSize ? (
        <div className="flex items-center justify-end w-full">
          <PaginationControls
            page={page}
            pageSize={safePageSize}
            totalItems={totalItems}
            onPageChange={(next) => {
              if (isExternalPagination) onPageChange?.(next);
              else setInternalPage(next);
            }}
            className="ml-auto"
          />
        </div>
      ) : null}

      <div
        className={
          isMobile
            ? "flex-1 min-h-0 w-full overflow-x-auto overflow-y-auto no-scrollbar overscroll-x-contain"
            : disableHorizontalScroll
              ? "flex-1 min-h-0 overflow-x-hidden overflow-y-auto"
              : "flex-1 min-h-0 overflow-x-auto overflow-y-auto"
        }
        style={isMobile ? { WebkitOverflowScrolling: "touch" } : undefined}
      >
        {useVirtual ? (
          <div className="w-full">
            <div className="grid items-center gap-2 text-sm font-semibold px-3 py-2" style={{ gridTemplateColumns: gridTemplate }}>
              {enableSelection && (
                <div>
                  <input
                    className="checkbox"
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={(e) => onToggleAll?.(e.target.checked, filteredIds)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              )}
              {columns.map((col) => (
                <div
                  key={col.field_id}
                  className={fieldIndex[col.field_id]?.type === "uuid" ? "font-mono text-xs truncate max-w-[16rem]" : ""}
                >
                  {resolveFieldLabel(col, fieldIndex)}
                </div>
              ))}
            </div>
            <VirtualList
              height={listHeight}
              itemCount={pagedRecords.length}
              itemSize={rowHeight}
              width="100%"
              itemData={{ rows: pagedRecords, columns, selectedSet, onSelectRow, onToggleSelect, gridTemplate }}
            >
              {({ index, style, data }) => {
                const row = data.rows[index];
                const rowId = getRowId(row);
                const selected = rowId && data.selectedSet.has(rowId);
                return (
                  <div
                    className={`grid items-center gap-2 px-3 border-b cursor-pointer ${selected ? "bg-base-200" : "hover:bg-base-200"}`}
                    style={{ ...style, gridTemplateColumns: data.gridTemplate }}
                    onClick={() => data.onSelectRow?.(row)}
                  >
                    {enableSelection && (
                      <div>
                        <input
                          className="checkbox"
                          type="checkbox"
                          checked={Boolean(selected)}
                          onChange={(e) => data.onToggleSelect?.(rowId, e.target.checked)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                    )}
                    {data.columns.map((col) => {
                      const value = formatCellValue(row, col);
                      const isId = fieldIndex[col.field_id]?.type === "uuid";
                      return (
                        <div
                          key={col.field_id}
                          className={isId ? "font-mono text-xs truncate max-w-[16rem]" : ""}
                          title={isId ? value : undefined}
                        >
                          {value}
                        </div>
                      );
                    })}
                  </div>
                );
              }}
            </VirtualList>
          </div>
        ) : (
          <table className={`table table-hover ${tableClassName} min-w-max ${isMobile ? "w-max min-w-full table-auto" : ""}`.trim()}>
            <thead className="[&_th]:border-b-0">
              <tr>
                {enableSelection && (
                  <th className="w-10 border-b-0">
                    <input
                      className="checkbox"
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={(e) => onToggleAll?.(e.target.checked, filteredIds)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </th>
                )}
                {columns.map((col) => (
                  <th
                    key={col.field_id}
                    className={`${fieldIndex[col.field_id]?.type === "uuid" ? "font-mono text-xs truncate max-w-[16rem]" : ""} border-b-0`.trim()}
                  >
                    {resolveFieldLabel(col, fieldIndex)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagedRecords.length === 0 && emptyLabel !== null ? (
                <tr>
                  <td
                    colSpan={columns.length + (enableSelection ? 1 : 0)}
                    className="py-10 text-center text-sm opacity-60"
                  >
                    {emptyLabel}
                  </td>
                </tr>
              ) : pagedRecords.map((row) => {
                const rowId = getRowId(row);
                const selected = rowId && selectedSet.has(rowId);
                return (
                  <tr
                    key={rowId}
                    className={`cursor-pointer hover:bg-base-200 ${selected ? "active" : ""}`}
                    onClick={() => onSelectRow?.(row)}
                  >
                    {enableSelection && (
                      <td>
                        <input
                          className="checkbox"
                          type="checkbox"
                          checked={selected}
                          onChange={(e) => onToggleSelect?.(rowId, e.target.checked)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                    )}
                    {columns.map((col) => {
                      const value = formatCellValue(row, col);
                      const isId = fieldIndex[col.field_id]?.type === "uuid";
                      return (
                        <td
                          key={col.field_id}
                          className={isId ? "font-mono text-xs truncate max-w-[16rem]" : ""}
                          title={isId ? value : undefined}
                        >
                          {value}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
