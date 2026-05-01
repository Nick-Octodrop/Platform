import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpDown,
  BarChart3,
  Bookmark,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Columns3,
  Download,
  Filter,
  LineChart,
  List,
  ListFilter,
  MoreHorizontal,
  PieChart,
  Plus,
  RefreshCw,
  Ruler,
  Search,
  Table2,
  Upload,
} from "lucide-react";
import { apiFetch, deleteRecord, subscribeRecordMutations } from "../api.js";
import { getSafeSession } from "../supabase.js";
import ListViewRenderer from "./ListViewRenderer.jsx";
import PaginationControls from "../components/PaginationControls.jsx";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import { evalCondition } from "../utils/conditions.js";
import { formatFieldValue } from "../utils/fieldFormatting.js";
import { PRIMARY_BUTTON_SM, SOFT_BUTTON_SM, SOFT_BUTTON_XS, SOFT_ICON_SM } from "../components/buttonStyles.js";
import DaisyTooltip from "../components/DaisyTooltip.jsx";
import useMediaQuery from "../hooks/useMediaQuery.js";
import { translateRuntime } from "../i18n/runtime.js";

function IconList() {
  return <List className="h-4 w-4" />;
}

function IconKanban() {
  return <Columns3 className="h-4 w-4" />;
}

function IconGraph() {
  return <BarChart3 className="h-4 w-4" />;
}

function IconLine() {
  return <LineChart className="h-4 w-4" />;
}

function IconPie() {
  return <PieChart className="h-4 w-4" />;
}

function IconPivot() {
  return <Table2 className="h-4 w-4" />;
}

function IconCalendar() {
  return <CalendarDays className="h-4 w-4" />;
}

function ViewModesLoadingState({ kind = "list" }) {
  if (kind === "kanban") {
    return (
      <div className="h-full min-h-[40vh] rounded-box bg-base-100 p-4">
        <div className="grid h-full min-h-[32vh] grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, colIdx) => (
            <div key={colIdx} className="flex min-h-0 flex-col rounded-box border border-base-300 bg-base-200/45 p-3">
              <div className="mb-3 flex items-center justify-between">
                <div className="h-5 w-24 animate-pulse rounded bg-base-200/90" />
                <div className="h-4 w-8 animate-pulse rounded bg-base-200/70" />
              </div>
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((__, cardIdx) => (
                  <div key={cardIdx} className="rounded-box border border-base-300 bg-base-100 p-3 shadow-sm">
                    <div className="h-5 w-2/3 animate-pulse rounded bg-base-200/80" />
                    <div className="mt-2 h-4 w-1/2 animate-pulse rounded bg-base-200/65" />
                    <div className="mt-4 flex gap-2">
                      <div className="h-5 w-14 animate-pulse rounded-full bg-base-200/80" />
                      <div className="h-5 w-16 animate-pulse rounded-full bg-base-200/70" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (kind === "calendar") {
    return (
      <div className="h-full min-h-[40vh] rounded-box bg-base-100 p-4">
        <div className="h-full rounded-box border border-base-300 bg-base-100 p-4">
          <div className="mb-4 flex gap-2">
            {Array.from({ length: 7 }).map((_, idx) => (
              <div key={idx} className="h-8 flex-1 animate-pulse rounded bg-base-200/75" />
            ))}
          </div>
          <div className="grid h-[calc(100%-3rem)] grid-cols-7 gap-2">
            {Array.from({ length: 21 }).map((_, idx) => (
              <div key={idx} className="rounded-lg bg-base-200/40" />
            ))}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="h-full min-h-[40vh] rounded-box bg-base-100 p-4">
      <div className="overflow-hidden rounded-box border border-base-300 bg-base-100">
        {Array.from({ length: 7 }).map((_, idx) => (
          <div key={idx} className="flex items-center gap-4 border-b border-base-200 px-4 py-3 last:border-b-0">
            <div className="h-4 w-4 animate-pulse rounded bg-base-200/75" />
            <div className="h-4 w-40 animate-pulse rounded bg-base-200/80" />
            <div className="h-4 flex-1 animate-pulse rounded bg-base-200/60" />
            <div className="h-4 w-16 animate-pulse rounded bg-base-200/70" />
          </div>
        ))}
      </div>
    </div>
  );
}

function IconSearch() {
  return <Search className="h-4 w-4" />;
}

function IconFilter() {
  return <Filter className="h-4 w-4" />;
}

function IconRefresh() {
  return <RefreshCw className="h-4 w-4" />;
}

function IconPlus() {
  return <Plus className="h-4 w-4" />;
}

function IconBookmark() {
  return <Bookmark className="h-4 w-4" />;
}

function IconGroup() {
  return <ListFilter className="h-4 w-4" />;
}

function IconColumns() {
  return <Columns2 className="h-4 w-4" />;
}

function IconMeasure() {
  return <Ruler className="h-4 w-4" />;
}

function IconSort() {
  return <ArrowUpDown className="h-4 w-4" />;
}

function viewModeLabel(mode) {
  if (mode === "kanban") return translateRuntime("common.view_modes.kanban");
  if (mode === "graph") return translateRuntime("common.view_modes.graph");
  if (mode === "calendar") return translateRuntime("common.view_modes.calendar");
  if (mode === "pivot") return translateRuntime("common.view_modes.pivot");
  return translateRuntime("common.view_modes.list");
}

function graphTypeLabel(type) {
  if (type === "line") return translateRuntime("common.view_modes.line_chart");
  if (type === "pie") return translateRuntime("common.view_modes.pie_chart");
  return translateRuntime("common.view_modes.bar_chart");
}

function normalizeViewTarget(target) {
  if (!target || typeof target !== "string") return null;
  if (target.startsWith("view:")) return target.slice(5);
  return target;
}

function resolveEntityFullId(manifest, viewEntity) {
  const entities = Array.isArray(manifest?.entities) ? manifest.entities : [];
  const match = entities.find((e) => e.id === viewEntity);
  if (match) return match.id;
  if (viewEntity && !viewEntity.startsWith("entity.")) {
    const prefixed = `entity.${viewEntity}`;
    const prefMatch = entities.find((e) => e.id === prefixed);
    return prefMatch ? prefMatch.id : viewEntity;
  }
  return viewEntity;
}

function resolveEntityDefaults(appDefaults, entityFullId) {
  if (!appDefaults || !appDefaults.entities) return null;
  const map = appDefaults.entities || {};
  const shortId = entityFullId?.startsWith("entity.") ? entityFullId.slice("entity.".length) : entityFullId;
  return map[entityFullId] || map[shortId] || null;
}

function resolveEntityDefaultFormPage(appDefaults, entityFullId) {
  const entityDefaults = resolveEntityDefaults(appDefaults, entityFullId);
  return entityDefaults?.entity_form_page || appDefaults?.entity_form_page || null;
}

function humanizeEntityId(entityId) {
  if (!entityId) return "";
  const raw = entityId.startsWith("entity.") ? entityId.slice("entity.".length) : entityId;
  return raw
    .replace(/[_\.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function buildFieldIndex(manifest, entityFullId) {
  const entity = (manifest?.entities || []).find((e) => e.id === entityFullId);
  const index = {};
  for (const f of entity?.fields || []) {
    if (f?.id) index[f.id] = f;
  }
  return index;
}

function normalizeEnumOptions(options) {
  if (!Array.isArray(options)) return [];
  return options
    .map((opt) => {
      if (typeof opt === "string") return { value: opt, label: opt };
      if (opt && typeof opt === "object") {
        const value = opt.value ?? opt.id ?? opt.key;
        if (value == null) return null;
        return { value, label: opt.label ?? value };
      }
      return null;
    })
    .filter(Boolean);
}

function isUuidLike(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

function safeOpaqueLabel(value, fallback = "") {
  const text = String(value || "").trim();
  if (!text) return fallback;
  return isUuidLike(text) ? fallback : text;
}

async function fetchLookupLabelEntries(pending, fallbackForId = () => "") {
  const requests = Array.isArray(pending) ? pending : [];
  if (!requests.length) return [];
  const groups = new Map();
  for (const item of requests) {
    const targetEntityId = String(item?.targetEntityId || "").trim();
    const recordId = String(item?.recordId || "").trim();
    if (!targetEntityId || !recordId) continue;
    const labelField = String(item?.labelField || "").trim();
    const groupKey = `${targetEntityId}:${labelField}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, { targetEntityId, labelField, ids: new Set(), items: [] });
    }
    const group = groups.get(groupKey);
    group.ids.add(recordId);
    group.items.push({ ...item, recordId });
  }
  const entries = [];
  await Promise.all(
    Array.from(groups.values()).map(async (group) => {
      const ids = Array.from(group.ids);
      let labels = {};
      try {
        const res = await apiFetch(`/lookup/${encodeURIComponent(group.targetEntityId)}/labels`, {
          method: "POST",
          body: {
            ids,
            label_field: group.labelField || undefined,
          },
          cacheTtl: 60000,
        });
        labels = res?.labels && typeof res.labels === "object" ? res.labels : {};
      } catch {
        labels = {};
      }
      for (const item of group.items) {
        const label = labels[item.recordId];
        entries.push([
          item.cacheKey,
          String(label && label !== item.recordId ? label : fallbackForId(item.recordId)),
        ]);
      }
    }),
  );
  return entries;
}

function formatGroupedFieldValue(fieldDef, rawValue, lookupLabels = {}, memberLabels = {}) {
  if (rawValue === null || rawValue === undefined || rawValue === "") return "";
  if (!fieldDef) return isUuidLike(rawValue) ? "" : String(rawValue);
  if (fieldDef.type === "enum") {
    const option = normalizeEnumOptions(fieldDef.options).find((opt) => String(opt.value) === String(rawValue));
    return String(option?.label ?? rawValue);
  }
  if (fieldDef.type === "lookup") {
    const cacheKey = `${fieldDef.id}:${String(rawValue)}`;
    return String(lookupLabels[cacheKey] || (isUuidLike(rawValue) ? "" : rawValue));
  }
  if (fieldDef.type === "user") {
    const userId = String(rawValue || "").trim();
    return String(memberLabels[userId] || (isUuidLike(userId) ? "" : userId));
  }
  if (fieldDef.type === "bool") return rawValue ? translateRuntime("common.yes") : translateRuntime("common.no");
  if (fieldDef.type === "date" || fieldDef.type === "datetime") {
    const parsed = toDateValue(rawValue);
    if (parsed) {
      return fieldDef.type === "date"
        ? parsed.toLocaleDateString()
        : parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    }
  }
  return isUuidLike(rawValue) ? "" : String(rawValue);
}

function csvEscape(value, delimiter = ",") {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (!text.includes("\"") && !text.includes("\n") && !text.includes("\r") && !text.includes(delimiter)) {
    return text;
  }
  return `"${text.replaceAll("\"", "\"\"")}"`;
}

function makeDelimitedContent(headers, rows, delimiter = ",") {
  const headerLine = headers.map((value) => csvEscape(value, delimiter)).join(delimiter);
  const bodyLines = rows.map((row) => row.map((value) => csvEscape(value, delimiter)).join(delimiter));
  return [headerLine, ...bodyLines].join("\r\n");
}

function downloadTextFile(filename, content, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function suggestEntitySlug(entityFullId) {
  if (!entityFullId) return "records";
  return String(entityFullId)
    .replace(/^entity\./, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || "records";
}

function normalizeSavedFilterRow(filter) {
  if (!filter || typeof filter !== "object") return null;
  const normalizeJsonObject = (value) => {
    if (!value) return {};
    if (typeof value === "object" && !Array.isArray(value)) return value;
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      } catch {
        return {};
      }
    }
    return {};
  };
  return {
    ...filter,
    id: filter.id ? String(filter.id) : "",
    name: typeof filter.name === "string" ? filter.name : "",
    domain: normalizeJsonObject(filter.domain),
    state: normalizeJsonObject(filter.state),
    is_default: Boolean(filter.is_default),
  };
}

function parseCsvText(text) {
  const rows = [];
  let cur = "";
  let row = [];
  let inQuotes = false;
  const source = String(text || "").replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (inQuotes) {
      if (ch === "\"" && next === "\"") {
        cur += "\"";
        i += 1;
        continue;
      }
      if (ch === "\"") {
        inQuotes = false;
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === "\"") {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cur);
      cur = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
      continue;
    }
    if (ch === "\r") continue;
    cur += ch;
  }
  if (cur !== "" || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

function normalizeFieldLookupKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getByPath(data, path) {
  if (!data || typeof data !== "object" || typeof path !== "string") return undefined;
  if (path in data) return data[path];
  const parts = path.split(".");
  let cur = data;
  for (const part of parts) {
    if (cur && typeof cur === "object" && part in cur) {
      cur = cur[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

function resolveTemplateRefs(value, record) {
  if (Array.isArray(value)) return value.map((item) => resolveTemplateRefs(item, record));
  if (value && typeof value === "object") {
    if (typeof value.ref === "string") {
      if (value.ref === "$record.id") return record?.id ?? null;
      if (value.ref.startsWith("$record.")) return getByPath(record, value.ref.slice("$record.".length));
      return getByPath(record, value.ref);
    }
    const next = {};
    for (const [key, nested] of Object.entries(value)) {
      next[key] = resolveTemplateRefs(nested, record);
    }
    return next;
  }
  return value;
}

function resolveConditionRefs(condition, record) {
  if (!condition || typeof condition !== "object") return condition;
  const op = condition.op;
  if (op === "and" || op === "or") {
    return {
      ...condition,
      conditions: Array.isArray(condition.conditions)
        ? condition.conditions.map((item) => resolveConditionRefs(item, record))
        : [],
    };
  }
  if (op === "not") {
    return {
      ...condition,
      condition: resolveConditionRefs(condition.condition, record),
    };
  }
  const resolveOperand = (operand) => {
    if (operand && typeof operand === "object" && typeof operand.ref === "string") {
      if (operand.ref === "$record.id") return record?.id;
      if (operand.ref.startsWith("$record.")) return getByPath(record, operand.ref.slice("$record.".length));
      if (operand.ref.startsWith("record.")) return getByPath(record, operand.ref.slice("record.".length));
      const resolved = getByPath(record, operand.ref);
      // Keep unresolved refs (for example $actor.user_id) for backend evaluation.
      if (resolved === undefined) return operand;
      return resolved;
    }
    return operand;
  };
  if ("left" in condition || "right" in condition) {
    return {
      ...condition,
      left: resolveOperand(condition.left),
      right: resolveOperand(condition.right),
    };
  }
  if ("value" in condition) {
    return {
      ...condition,
      value: resolveOperand(condition.value),
    };
  }
  return condition;
}

function hasRecordRef(condition) {
  if (!condition || typeof condition !== "object") return false;
  const scanValue = (value) => {
    if (!value || typeof value !== "object") return false;
    if (typeof value.ref === "string" && value.ref.startsWith("$record.")) return true;
    return false;
  };
  if (scanValue(condition.left) || scanValue(condition.right) || scanValue(condition.value)) return true;
  if (typeof condition.field === "string" && condition.field.startsWith("$record.")) return true;
  if (Array.isArray(condition.conditions) && condition.conditions.some((item) => hasRecordRef(item))) return true;
  if (condition.condition && hasRecordRef(condition.condition)) return true;
  return false;
}

async function resolveLookupLabelsBatch(targetEntityId, ids, labelField) {
  const normalizedIds = Array.from(
    new Set((ids || []).map((recordId) => String(recordId || "").trim()).filter(Boolean)),
  );
  if (!normalizedIds.length) return {};
  const response = await apiFetch(`/lookup/${encodeURIComponent(targetEntityId)}/labels`, {
    method: "POST",
    body: {
      ids: normalizedIds,
      label_field: labelField || undefined,
    },
  });
  return response?.labels && typeof response.labels === "object" ? response.labels : {};
}

function buildDomain(activeFilter, clientFilters, recordDomain) {
  const conditions = [];
  if (recordDomain) conditions.push(recordDomain);
  if (activeFilter?.domain) conditions.push(activeFilter.domain);
  if (Array.isArray(clientFilters)) {
    for (const flt of clientFilters) {
      if (!flt?.field_id) continue;
      if (flt.op === "contains") {
        conditions.push({ op: "contains", field: flt.field_id, value: flt.value });
      } else if (flt.op === "eq") {
        conditions.push({ op: "eq", field: flt.field_id, value: flt.value });
      }
    }
  }
  if (conditions.length === 0) return null;
  if (conditions.length === 1) return conditions[0];
  return { op: "and", conditions };
}

function KanbanView({ view, entityDef, records, groupBy, onSelectRow, canDragCards = false, onMoveCard }) {
  const isMobile = useMediaQuery("(max-width: 768px)");
  const boardRef = useRef(null);
  const card = view.card || {};
  const titleField = card.title_field || entityDef?.display_field || "id";
  const subtitleFields = Array.isArray(card.subtitle_fields) ? card.subtitle_fields : [];
  const badgeFields = Array.isArray(card.badge_fields) ? card.badge_fields : [];
  const humanize = (value) => String(value || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const emptyEntityLabel = entityDef?.label || humanizeEntityId(entityDef?.id) || "Record";
  const [dragging, setDragging] = useState(null);
  const [busyRowId, setBusyRowId] = useState("");
  const [moveError, setMoveError] = useState("");
  const [lookupLabels, setLookupLabels] = useState({});
  const [memberLabels, setMemberLabels] = useState({});
  const [mobileBoardHeight, setMobileBoardHeight] = useState(null);
  const fieldMap = useMemo(() => {
    const map = {};
    for (const field of entityDef?.fields || []) {
      if (field?.id) map[field.id] = field;
    }
    return map;
  }, [entityDef]);
  useEffect(() => {
    let cancelled = false;
    const fieldIds = Array.from(new Set([titleField, ...subtitleFields, ...badgeFields, groupBy].filter(Boolean)));
    const lookupFieldDefs = fieldIds
      .map((fieldId) => fieldMap[fieldId])
      .filter((fieldDef) => fieldDef?.type === "lookup" && typeof fieldDef?.entity === "string");
    if (!lookupFieldDefs.length) return undefined;
    const pending = [];
    for (const fieldDef of lookupFieldDefs) {
      const targetEntityId = fieldDef.entity.startsWith("entity.") ? fieldDef.entity : `entity.${fieldDef.entity}`;
      const labelField = typeof fieldDef.display_field === "string" ? fieldDef.display_field : null;
      const ids = new Set(
        (records || [])
          .map((row) => String((row?.record || {})[fieldDef.id] || "").trim())
          .filter(Boolean),
      );
      for (const recordId of ids) {
        const cacheKey = `${fieldDef.id}:${recordId}`;
        if (Object.prototype.hasOwnProperty.call(lookupLabels, cacheKey)) continue;
        pending.push({ cacheKey, targetEntityId, recordId, labelField });
      }
    }
    if (!pending.length) return undefined;
    (async () => {
      const grouped = new Map();
      for (const item of pending) {
        const groupKey = `${item.targetEntityId}::${item.labelField || ""}`;
        if (!grouped.has(groupKey)) grouped.set(groupKey, { targetEntityId: item.targetEntityId, labelField: item.labelField, items: [] });
        grouped.get(groupKey).items.push(item);
      }
      const resolvedEntries = [];
      for (const group of grouped.values()) {
        try {
          const labels = await resolveLookupLabelsBatch(
            group.targetEntityId,
            group.items.map((item) => item.recordId),
            group.labelField,
          );
          for (const item of group.items) {
            resolvedEntries.push([item.cacheKey, safeOpaqueLabel(labels[item.recordId], safeOpaqueLabel(item.recordId, ""))]);
          }
        } catch {
          for (const item of group.items) {
            resolvedEntries.push([item.cacheKey, safeOpaqueLabel(item.recordId, "")]);
          }
        }
      }
      if (!cancelled) setLookupLabels((prev) => ({ ...prev, ...Object.fromEntries(resolvedEntries) }));
    })();
    return () => {
      cancelled = true;
    };
  }, [titleField, subtitleFields, badgeFields, groupBy, fieldMap, records, lookupLabels]);
  useEffect(() => {
    let cancelled = false;
    const fieldIds = Array.from(new Set([titleField, ...subtitleFields, ...badgeFields, groupBy].filter(Boolean)));
    const needsMembers = fieldIds.some((fieldId) => {
      const type = String(fieldMap[fieldId]?.type || "").toLowerCase();
      return type === "user" || type === "users";
    });
    if (!needsMembers) return undefined;
    (async () => {
      try {
        const res = await apiFetch("/access/members");
        const rows = Array.isArray(res?.members) ? res.members : [];
        const next = {};
        for (const member of rows) {
          const userId = String(member?.user_id || "").trim();
          if (!userId) continue;
          const name = String(member?.name || "").trim();
          const email = String(member?.email || "").trim();
          next[userId] = name || email || userId;
        }
        if (!cancelled) setMemberLabels(next);
      } catch {
        if (!cancelled) setMemberLabels({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [titleField, subtitleFields, badgeFields, groupBy, fieldMap]);
  const KANBAN_BADGE_BASE =
    "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 shadow-sm";
  const priorityTone = (value) => {
    const v = String(value || "").toLowerCase();
    if (v === "urgent" || v === "critical") return `${KANBAN_BADGE_BASE} border-error/20 bg-error/10 text-error`;
    if (v === "high") return `${KANBAN_BADGE_BASE} border-warning/20 bg-warning/12 text-warning-content`;
    if (v === "low") return `${KANBAN_BADGE_BASE} border-base-300 bg-base-100 text-base-content/60`;
    return `${KANBAN_BADGE_BASE} border-base-300 bg-base-100 text-base-content/70`;
  };
  const statusTone = (value) => {
    const v = String(value || "").toLowerCase();
    if (["done", "completed", "approved", "won", "resolved", "confirmed", "active"].includes(v)) {
      return `${KANBAN_BADGE_BASE} border-success/20 bg-success/12 text-success-content`;
    }
    if (["cancelled", "canceled", "rejected", "lost", "inactive", "expired"].includes(v)) {
      return `${KANBAN_BADGE_BASE} border-error/20 bg-error/10 text-error`;
    }
    if (["draft", "new", "planned", "pending"].includes(v)) {
      return `${KANBAN_BADGE_BASE} border-base-300 bg-base-100 text-base-content/65`;
    }
    return `${KANBAN_BADGE_BASE} border-base-300 bg-base-100 text-base-content/70`;
  };
  const badgeKind = (fieldId, rawValue) => {
    const fieldIdText = String(fieldId || "").toLowerCase();
    const fieldDef = fieldMap[fieldId] || null;
    if (fieldIdText.includes("priority")) return "priority";
    if (fieldIdText.includes("status") || fieldIdText.includes("stage")) return "status";
    if (
      fieldDef?.type === "number" ||
      fieldIdText.includes("amount") ||
      fieldIdText.includes("value") ||
      fieldIdText.includes("total") ||
      fieldIdText.includes("price") ||
      fieldIdText.includes("cost") ||
      fieldIdText.includes("margin")
    ) {
      return "metric";
    }
    return "meta";
  };
  const badgeTone = (fieldId, rawValue) => {
    const kind = badgeKind(fieldId, rawValue);
    if (kind === "priority") return priorityTone(rawValue);
    if (kind === "status") return statusTone(rawValue);
    if (kind === "metric") return "text-[12px] font-semibold leading-5 text-base-content/80 tabular-nums";
    return `${KANBAN_BADGE_BASE} border-base-300 bg-base-100 text-base-content/68`;
  };
  const formatCardValue = (fieldId, rawValue, record = {}) => {
    if (rawValue === null || rawValue === undefined || rawValue === "") return "";
    const fieldDef = fieldMap[fieldId] || null;
    const isUuidLike = typeof rawValue === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawValue.trim());
    if (fieldDef?.type === "enum") {
      const option = normalizeEnumOptions(fieldDef.options).find((opt) => String(opt.value) === String(rawValue));
      return String(option?.label ?? rawValue);
    }
    if (fieldDef?.type === "lookup") {
      const cacheKey = `${fieldId}:${String(rawValue)}`;
      return String(lookupLabels[cacheKey] || (isUuidLike ? "" : rawValue));
    }
    if (fieldDef?.type === "user") {
      const userId = String(rawValue || "").trim();
      return String(memberLabels[userId] || (isUuidLike ? "" : userId));
    }
    if (fieldDef?.type === "users") {
      const values = Array.isArray(rawValue)
        ? rawValue
        : (typeof rawValue === "string"
            ? rawValue.split(",").map((item) => item.trim()).filter(Boolean)
            : []);
      return values.map((userId) => memberLabels[userId] || userId).join(", ");
    }
  if (fieldDef?.type === "bool") return rawValue ? translateRuntime("common.yes") : translateRuntime("common.no");
    if (fieldDef?.type === "date" || fieldDef?.type === "datetime") {
      const parsed = toDateValue(rawValue);
      if (parsed) {
        return fieldDef.type === "date"
          ? parsed.toLocaleDateString()
          : parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
      }
    }
    if (fieldDef?.type === "number") {
      return formatFieldValue(fieldDef, rawValue, record);
    }
    if (Array.isArray(rawValue)) return rawValue.map((item) => String(item ?? "")).filter(Boolean).join(", ");
    if (isUuidLike) return "";
    return String(rawValue);
  };

  const grouped = useMemo(() => {
    if (!groupBy) return { "": records };
    const groups = {};
    for (const row of records) {
      const rec = row.record || {};
      const key = rec[groupBy] ?? "";
      if (!groups[key]) groups[key] = [];
      groups[key].push(row);
    }
    return groups;
  }, [records, groupBy]);

  const groupKeys = useMemo(() => {
    const currentKeys = Object.keys(grouped);
    if (!groupBy) return currentKeys;
    const groupField = Array.isArray(entityDef?.fields) ? entityDef.fields.find((f) => f?.id === groupBy) : null;
    const optionOrder = Array.isArray(groupField?.options) ? groupField.options.map((opt) => String(opt?.value ?? "")).filter(Boolean) : [];
    if (optionOrder.length === 0) return currentKeys;
    const remaining = currentKeys.filter((key) => !optionOrder.includes(key));
    return [...optionOrder, ...remaining];
  }, [grouped, groupBy, entityDef]);

  useLayoutEffect(() => {
    if (!isMobile) {
      setMobileBoardHeight(null);
      return undefined;
    }
    const node = boardRef.current;
    if (!node || typeof window === "undefined") return undefined;
    const updateHeight = () => {
      const rect = node.getBoundingClientRect();
      const available = Math.floor(window.innerHeight - rect.top - 8);
      setMobileBoardHeight(available > 240 ? available : 240);
    };
    updateHeight();
    window.addEventListener("resize", updateHeight);
    window.addEventListener("orientationchange", updateHeight);
    return () => {
      window.removeEventListener("resize", updateHeight);
      window.removeEventListener("orientationchange", updateHeight);
    };
  }, [isMobile, groupBy, records.length]);

  async function handleDrop(targetGroupKey) {
    if (!dragging || !canDragCards || typeof onMoveCard !== "function") return;
    if (dragging.groupKey === targetGroupKey) {
      setDragging(null);
      return;
    }
    setMoveError("");
    setBusyRowId(dragging.rowId);
    try {
      const result = await onMoveCard(dragging.row, targetGroupKey);
      if (result && result.ok === false && result.message) {
        setMoveError(result.message);
      }
    } finally {
      setBusyRowId("");
      setDragging(null);
    }
  }

  return (
    <div
      ref={boardRef}
      className="flex h-full min-h-0 flex-col"
      style={isMobile && mobileBoardHeight ? { height: `${mobileBoardHeight}px` } : undefined}
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden pb-2">
          <div className="flex h-full min-h-0 gap-4 min-w-max">
            {groupKeys.map((groupKey) => (
              <div
                key={groupKey}
                className={`w-[320px] shrink-0 bg-base-200 rounded-box border shadow-sm p-2 h-full min-h-0 flex flex-col ${
                  dragging && dragging.groupKey !== groupKey ? "border-primary/40" : "border-base-300"
                }`}
                onDragOver={(e) => {
                  if (!canDragCards || !dragging) return;
                  e.preventDefault();
                }}
                onDrop={(e) => {
                  if (!canDragCards || !dragging) return;
                  e.preventDefault();
                  handleDrop(groupKey);
                }}
              >
                <div className="p-2 flex items-center justify-between gap-2">
                  <div className="font-semibold truncate">{groupBy ? (groupKey ? (formatCardValue(groupBy, groupKey) || humanize(groupKey)) : translateRuntime("common.view_modes.ungrouped")) : translateRuntime("common.all")}</div>
                  <span className="badge badge-ghost badge-sm">{(grouped[groupKey] || []).length}</span>
                </div>
                <div className="p-[7px] space-y-3 overflow-y-auto min-h-0">
                  {(grouped[groupKey] || []).length === 0 ? (
                    <div className="text-xs text-base-content/50 p-2">{translateRuntime("common.view_modes.no_records_found_named", { name: emptyEntityLabel })}</div>
                  ) : (grouped[groupKey] || []).map((row) => {
                    const record = row.record || {};
                    const rowId = row.record_id || record.id;
                    const cardTitle = formatCardValue(titleField, record[titleField], record) || safeOpaqueLabel(rowId, emptyEntityLabel);
                    const subtitleValues = subtitleFields
                      .map((fieldId) => ({ fieldId, value: formatCardValue(fieldId, record[fieldId], record) }))
                      .filter((item) => item.value);
                    const badgeValues = badgeFields
                      .map((fieldId) => ({ fieldId, raw: record[fieldId], value: formatCardValue(fieldId, record[fieldId], record) }))
                      .filter((item) => item.value);
                    return (
                      <div
                        key={rowId}
                        className={`card bg-base-100 border border-base-200 shadow-sm hover:shadow-md hover:border-base-300 transition cursor-pointer ${
                          dragging?.rowId === rowId ? "opacity-60" : ""
                        }`}
                        onClick={() => onSelectRow?.(row)}
                        draggable={canDragCards && !busyRowId}
                        onDragStart={() => setDragging({ row, rowId, groupKey })}
                        onDragEnd={() => setDragging(null)}
                      >
                        <div className="card-body p-[7px] gap-1">
                          <div className="text-base font-semibold truncate">{cardTitle}</div>
                          <div className="space-y-0.5">
                            {subtitleValues.length > 0 ? subtitleValues.map((item) => (
                              <div key={`${rowId}-${item.fieldId}`} className="text-sm text-base-content/70 leading-snug line-clamp-1">
                                {item.value}
                              </div>
                            )) : (
                              <div className="text-sm text-base-content/30 leading-snug line-clamp-1">&nbsp;</div>
                            )}
                          </div>
                          {badgeValues.length > 0 ? (
                            <div className="mt-3 flex flex-wrap items-center gap-1.5">
                              {badgeValues.map((item) => {
                                const kind = badgeKind(item.fieldId, item.raw);
                                return (
                                  <span
                                    key={`${rowId}-${item.fieldId}`}
                                    className={badgeTone(item.fieldId, item.raw)}
                                  >
                                    {kind === "metric" ? item.value : item.value}
                                  </span>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {moveError ? (
        <div className="modal modal-open">
          <div className="modal-box max-w-lg">
            <h3 className="font-semibold text-lg">Move blocked</h3>
            <p className="py-3 text-sm text-base-content/75">{moveError}</p>
            <div className="modal-action">
              <button className="btn btn-primary" onClick={() => setMoveError("")}>OK</button>
            </div>
          </div>
          <button
            className="modal-backdrop"
            aria-label="Close move blocked dialog"
            onClick={() => setMoveError("")}
          />
        </div>
      ) : null}
    </div>
  );
}

function GraphView({ data, type = "bar" }) {
  const containerRef = useRef(null);
  const [pieSize, setPieSize] = useState(0);
  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node || type !== "pie") return undefined;
    const updateSize = () => {
      const { clientWidth, clientHeight } = node;
      setPieSize(Math.max(0, Math.min(clientWidth, clientHeight)));
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, [type]);
  const rawData = Array.isArray(data) ? data : [];
  const normalized = rawData.map((d) => {
    const key = d?.label ?? d?.key ?? d?.group ?? "";
    const rawValue = d?.value ?? d?.count ?? d?.total ?? d?.measure ?? d?.sum ?? 0;
    const value = Number(rawValue);
    return { key, value: Number.isFinite(value) ? value : 0 };
  });
  if (normalized.length === 0) {
    return <div className="text-sm opacity-60">{translateRuntime("common.view_modes.no_data")}</div>;
  }
  const values = normalized.map((d) => d.value || 0);
  const max = Math.max(1, ...values);
  const colors = ["#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#0891b2", "#ea580c"];

  if (type === "pie") {
    const total = values.reduce((sum, v) => sum + v, 0) || 1;
    let offset = 0;
    const parts = normalized.map((d, idx) => {
      const value = d.value || 0;
      const start = offset;
      const end = offset + (value / total) * 100;
      offset = end;
      return `${colors[idx % colors.length]} ${start}% ${end}%`;
    });
    return (
      <div className="flex flex-col h-full min-h-0 gap-3 overflow-hidden">
        <div ref={containerRef} className="flex-1 min-h-0 w-full flex items-center justify-center overflow-hidden">
          <div
            className="rounded-full border border-base-400 aspect-square"
            style={{
              width: pieSize ? `${pieSize}px` : "100%",
              height: pieSize ? `${pieSize}px` : "100%",
              background: `conic-gradient(${parts.join(",")})`,
            }}
          />
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs pb-2 max-h-32 overflow-auto w-full flex-none text-base-content">
          {normalized.map((d, idx) => (
            <div key={d.key} className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: colors[idx % colors.length] }} />
              <span className="opacity-70">{d.key || "(empty)"}</span>
              <span className="ml-auto font-medium">{d.value || 0}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (type === "line") {
    const width = 100;
    const height = 50;
    const pad = 8;
    const innerW = width - pad * 2;
    const innerH = height - pad * 2;
    const step = normalized.length > 1 ? innerW / (normalized.length - 1) : innerW;
    const points = normalized
      .map((d, idx) => {
        const value = d.value || 0;
        const x = pad + idx * step;
        const y = pad + innerH - (value / max) * innerH;
        return `${x},${y}`;
      })
      .join(" ");
    return (
      <div className="flex flex-col h-full min-h-0 gap-3 overflow-hidden">
        <div className="flex-1 min-h-0 overflow-hidden">
          <svg className="w-full h-full" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
            <path d={`M${pad} ${pad}V${pad + innerH}H${pad + innerW}`} stroke="currentColor" strokeWidth="0.5" opacity="0.2" fill="none" />
            <polyline fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" points={points} />
            {normalized.map((d, idx) => {
              const value = d.value || 0;
              const x = pad + idx * step;
              const y = pad + innerH - (value / max) * innerH;
              return (
                <circle
                  key={`${d.key}-${idx}`}
                  cx={x}
                  cy={y}
                  r="1.8"
                  fill={colors[idx % colors.length]}
                />
              );
            })}
          </svg>
        </div>
        <div className="flex flex-wrap gap-3 text-xs pb-2 max-h-32 overflow-auto w-full flex-none text-base-content">
          {normalized.map((d, idx) => (
            <div key={d.key} className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: colors[idx % colors.length] }} />
              <span className="opacity-70">{d.key || "(empty)"}</span>
              <span className="font-medium">{d.value || 0}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-auto pr-1">
        {normalized.map((d, idx) => {
          const value = d.value || 0;
          const widthPct = (value / max) * 100;
          return (
            <div key={d.key || idx} className="flex items-center gap-3">
              <div className="w-40 text-xs opacity-70 truncate">{d.key || "(empty)"}</div>
              <div className="flex-1 bg-base-300 rounded h-3 overflow-hidden">
                <div
                  className="h-full rounded"
                  style={{ width: `${Math.max(3, widthPct)}%`, background: colors[idx % colors.length] }}
                />
              </div>
              <div className="text-xs opacity-70 w-10 text-right">{value}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function toDateValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function atMidnight(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function ymdKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatClockLabel(date) {
  if (!(date instanceof Date)) return "";
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function hasTimeComponent(date) {
  if (!(date instanceof Date)) return false;
  return date.getHours() !== 0 || date.getMinutes() !== 0 || date.getSeconds() !== 0 || date.getMilliseconds() !== 0;
}

function minutesSinceMidnight(date) {
  if (!(date instanceof Date)) return 0;
  return date.getHours() * 60 + date.getMinutes();
}

function layoutTimedEvents(events) {
  const sorted = [...(events || [])].sort((a, b) => {
    if (a.startMin !== b.startMin) return a.startMin - b.startMin;
    if (a.endMin !== b.endMin) return a.endMin - b.endMin;
    return String(a.title || "").localeCompare(String(b.title || ""));
  });
  const active = [];
  let maxColumns = 1;
  const items = [];
  for (const ev of sorted) {
    for (let i = active.length - 1; i >= 0; i -= 1) {
      if (active[i].endMin <= ev.startMin) active.splice(i, 1);
    }
    const used = new Set(active.map((a) => a.col));
    let col = 0;
    while (used.has(col)) col += 1;
    active.push({ endMin: ev.endMin, col });
    if (col + 1 > maxColumns) maxColumns = col + 1;
    items.push({ ...ev, col });
  }
  return { items, maxColumns };
}

function CalendarView({ view, records, onSelectRow, entityDef }) {
  const calendar = view?.calendar || {};
  const titleField = calendar.title_field || view?.title_field || "id";
  const startField = calendar.date_start || view?.date_start;
  const endField = calendar.date_end || view?.date_end || startField;
  const allDayField = calendar.all_day_field || view?.all_day_field;
  const statusField = calendar.status_field || view?.status_field;
  const fieldMap = useMemo(() => {
    const map = {};
    for (const field of entityDef?.fields || []) {
      if (field?.id) map[field.id] = field;
    }
    return map;
  }, [entityDef]);
  const [lookupLabels, setLookupLabels] = useState({});
  const [memberLabels, setMemberLabels] = useState({});
  useEffect(() => {
    let cancelled = false;
    const fieldDef = fieldMap[titleField];
    if (fieldDef?.type !== "lookup" || typeof fieldDef?.entity !== "string") return undefined;
    const targetEntityId = fieldDef.entity.startsWith("entity.") ? fieldDef.entity : `entity.${fieldDef.entity}`;
    const labelField = typeof fieldDef.display_field === "string" ? fieldDef.display_field : null;
    const ids = new Set(
      (records || [])
        .map((row) => String((row?.record || {})[titleField] || "").trim())
        .filter(Boolean),
    );
    const pending = [];
    for (const recordId of ids) {
      const cacheKey = `${titleField}:${recordId}`;
      if (Object.prototype.hasOwnProperty.call(lookupLabels, cacheKey)) continue;
      pending.push({ cacheKey, targetEntityId, recordId, labelField });
    }
    if (!pending.length) return undefined;
    (async () => {
      try {
        const labels = await resolveLookupLabelsBatch(
          targetEntityId,
          pending.map((item) => item.recordId),
          labelField,
        );
        if (!cancelled) {
          setLookupLabels((prev) => ({
            ...prev,
            ...Object.fromEntries(
              pending.map((item) => [item.cacheKey, safeOpaqueLabel(labels[item.recordId], safeOpaqueLabel(item.recordId, ""))]),
            ),
          }));
        }
      } catch {
        if (!cancelled) {
          setLookupLabels((prev) => ({
            ...prev,
            ...Object.fromEntries(pending.map((item) => [item.cacheKey, item.recordId])),
          }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fieldMap, titleField, records, lookupLabels]);
  useEffect(() => {
    let cancelled = false;
    const fieldDef = fieldMap[titleField];
    if (fieldDef?.type !== "user") return undefined;
    (async () => {
      try {
        const res = await apiFetch("/access/members");
        const rows = Array.isArray(res?.members) ? res.members : [];
        const next = {};
        for (const member of rows) {
          const userId = String(member?.user_id || "").trim();
          if (!userId) continue;
          const name = String(member?.name || "").trim();
          const email = String(member?.email || "").trim();
          next[userId] = name || email || userId;
        }
        if (!cancelled) setMemberLabels(next);
      } catch {
        if (!cancelled) setMemberLabels({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fieldMap, titleField]);
  const formatCalendarValue = (fieldId, rawValue, record = {}) => {
    if (rawValue === null || rawValue === undefined || rawValue === "") return "";
    const fieldDef = fieldMap[fieldId] || null;
    if (fieldDef?.type === "enum") {
      const option = normalizeEnumOptions(fieldDef.options).find((opt) => String(opt.value) === String(rawValue));
      return String(option?.label ?? rawValue);
    }
    if (fieldDef?.type === "lookup") {
      const cacheKey = `${fieldId}:${String(rawValue)}`;
      return String(lookupLabels[cacheKey] || rawValue);
    }
    if (fieldDef?.type === "user") {
      const userId = String(rawValue || "").trim();
      return String(memberLabels[userId] || userId);
    }
    if (fieldDef?.type === "bool") return rawValue ? translateRuntime("common.yes") : translateRuntime("common.no");
    if (fieldDef?.type === "date" || fieldDef?.type === "datetime") {
      const parsed = toDateValue(rawValue);
      if (parsed) {
        return fieldDef.type === "date"
          ? parsed.toLocaleDateString()
          : parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
      }
    }
    if (fieldDef?.type === "number") {
      return formatFieldValue(fieldDef, rawValue, record);
    }
    return String(rawValue);
  };
  const allowedScales = new Set(["day", "week", "month", "year"]);
  const configuredScale = String(calendar.default_scale || view?.default_scale || "month").toLowerCase();
  const [scale, setScale] = useState(allowedScales.has(configuredScale) ? configuredScale : "month");
  const [cursorMonth, setCursorMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  });
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const eventsByDay = useMemo(() => {
    const out = new Map();
    for (const row of records || []) {
      const rec = row?.record || {};
      const start = toDateValue(rec?.[startField]);
      if (!start) continue;
      const endRaw = toDateValue(rec?.[endField]);
      const end = endRaw && endRaw >= start ? endRaw : start;
      const startDay = atMidnight(start);
      const endDay = atMidnight(end);
      const rawTitle = rec?.[titleField];
      const eventTitle = formatCalendarValue(titleField, rawTitle, rec) || safeOpaqueLabel(row?.record_id, translateRuntime("common.record"));
      const allDay = Boolean(allDayField && rec?.[allDayField]);

      const walker = new Date(startDay);
      let guard = 0;
      while (walker <= endDay && guard < 92) {
        const key = ymdKey(walker);
        const existing = out.get(key) || [];
        const dayStart = atMidnight(walker);
        const dayEnd = new Date(dayStart);
        dayEnd.setHours(23, 59, 59, 999);
        const segStart = start > dayStart ? start : dayStart;
        const segEnd = end < dayEnd ? end : dayEnd;
        const sameDay = atMidnight(segStart).getTime() === atMidnight(segEnd).getTime();
        const startLabel = formatClockLabel(segStart);
        const endLabel = formatClockLabel(segEnd);
        const sortMinutes = allDay ? -1 : segStart.getHours() * 60 + segStart.getMinutes();
        let timeLabel = "";
        if (allDay) {
          timeLabel = translateRuntime("common.view_modes.all_day");
        } else if (sameDay) {
          timeLabel = `${startLabel}${segEnd > segStart ? ` - ${endLabel}` : ""}`;
        } else {
          timeLabel = `${startLabel}+`;
        }
        existing.push({ row, title: eventTitle, sortMinutes, timeLabel, allDay });
        out.set(key, existing);
        walker.setDate(walker.getDate() + 1);
        guard += 1;
      }
    }
    return out;
  }, [records, startField, endField, titleField, allDayField, lookupLabels, memberLabels]);

  const timedByDay = useMemo(() => {
    const out = new Map();
    function ensureBucket(key) {
      if (!out.has(key)) out.set(key, { raw: [], allDayCount: 0, layout: { items: [], maxColumns: 1 } });
      return out.get(key);
    }
    for (const row of records || []) {
      const rec = row?.record || {};
      const start = toDateValue(rec?.[startField]);
      if (!start) continue;
      const endRaw = toDateValue(rec?.[endField]);
      const end = endRaw && endRaw >= start ? endRaw : start;
      const startDay = atMidnight(start);
      const endDay = atMidnight(end);
      const rawTitle = rec?.[titleField];
      const eventTitle = formatCalendarValue(titleField, rawTitle, rec) || safeOpaqueLabel(row?.record_id, translateRuntime("common.record"));
      const explicitAllDay = Boolean(allDayField && rec?.[allDayField]);
      const treatAsTimed = !explicitAllDay && (hasTimeComponent(start) || hasTimeComponent(end));

      const walker = new Date(startDay);
      let guard = 0;
      while (walker <= endDay && guard < 92) {
        const key = ymdKey(walker);
        const bucket = ensureBucket(key);
        if (!treatAsTimed) {
          bucket.allDayCount += 1;
          walker.setDate(walker.getDate() + 1);
          guard += 1;
          continue;
        }
        const dayStart = atMidnight(walker);
        const dayEnd = new Date(dayStart);
        dayEnd.setHours(23, 59, 59, 999);
        const segStart = start > dayStart ? start : dayStart;
        const segEnd = end < dayEnd ? end : dayEnd;
        const startMin = minutesSinceMidnight(segStart);
        const rawEndMin = minutesSinceMidnight(segEnd);
        const endMin = Math.min(24 * 60, Math.max(startMin + 15, rawEndMin || startMin + 30));
        const startLabel = formatClockLabel(segStart);
        const endLabel = formatClockLabel(segEnd);
        bucket.raw.push({
          row,
          title: eventTitle,
          startMin,
          endMin,
          timeLabel: `${startLabel}${segEnd > segStart ? ` - ${endLabel}` : ""}`,
        });
        walker.setDate(walker.getDate() + 1);
        guard += 1;
      }
    }
    for (const bucket of out.values()) {
      bucket.layout = layoutTimedEvents(bucket.raw);
    }
    return out;
  }, [records, startField, endField, titleField, allDayField, lookupLabels, memberLabels]);

  function startOfWeek(value) {
    const d = atMidnight(value);
    const mondayOffset = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - mondayOffset);
    return d;
  }

  function moveCursor(direction) {
    setCursorMonth((current) => {
      const next = new Date(current);
      if (scale === "year") {
        next.setFullYear(next.getFullYear() + direction);
      } else if (scale === "day") {
        next.setDate(next.getDate() + direction);
      } else if (scale === "week") {
        next.setDate(next.getDate() + direction * 7);
      } else {
        next.setMonth(next.getMonth() + direction);
      }
      return next;
    });
  }

  const monthDays = useMemo(() => {
    const monthStart = new Date(cursorMonth.getFullYear(), cursorMonth.getMonth(), 1);
    const mondayOffset = (monthStart.getDay() + 6) % 7;
    const monthEnd = new Date(cursorMonth.getFullYear(), cursorMonth.getMonth() + 1, 0);
    const dayCount = monthEnd.getDate();
    const totalCells = Math.ceil((mondayOffset + dayCount) / 7) * 7;
    const firstGridDay = new Date(monthStart);
    firstGridDay.setDate(firstGridDay.getDate() - mondayOffset);

    const cells = [];
    const walker = new Date(firstGridDay);
    for (let i = 0; i < totalCells; i += 1) {
      const key = ymdKey(walker);
      cells.push({
        key,
        date: new Date(walker),
        inMonth: walker.getMonth() === cursorMonth.getMonth(),
        events: eventsByDay.get(key) || [],
      });
      walker.setDate(walker.getDate() + 1);
    }
    return { monthStart, cells, rowCount: Math.max(1, totalCells / 7) };
  }, [cursorMonth, eventsByDay]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(cursorMonth);
    const cells = [];
    const walker = new Date(start);
    for (let i = 0; i < 7; i += 1) {
      const key = ymdKey(walker);
      cells.push({
        key,
        date: new Date(walker),
        events: eventsByDay.get(key) || [],
      });
      walker.setDate(walker.getDate() + 1);
    }
    return cells;
  }, [cursorMonth, eventsByDay]);

  const dayCell = useMemo(() => {
    const day = atMidnight(cursorMonth);
    const key = ymdKey(day);
    return {
      key,
      date: day,
      events: eventsByDay.get(key) || [],
    };
  }, [cursorMonth, eventsByDay]);

  const yearMonths = useMemo(() => {
    const year = cursorMonth.getFullYear();
    return Array.from({ length: 12 }).map((_, idx) => {
      const monthStart = new Date(year, idx, 1);
      const monthEnd = new Date(year, idx + 1, 0);
      let total = 0;
      for (let d = 1; d <= monthEnd.getDate(); d += 1) {
        const key = ymdKey(new Date(year, idx, d));
        total += (eventsByDay.get(key) || []).length;
      }
      return {
        idx,
        label: monthStart.toLocaleDateString(undefined, { month: "long" }),
        total,
      };
    });
  }, [cursorMonth, eventsByDay]);

  const todayKey = ymdKey(new Date());
  const monthLabel =
    scale === "year"
      ? `${cursorMonth.getFullYear()}`
      : scale === "day"
        ? cursorMonth.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
      : scale === "week"
        ? `${translateRuntime("common.view_modes.week_of")} ${startOfWeek(cursorMonth).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`
        : cursorMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const describeEvent = (event) => {
    const rec = event?.row?.record || {};
    const title = event?.title || safeOpaqueLabel(rec?.[titleField], safeOpaqueLabel(event?.row?.record_id, translateRuntime("common.record")));
    const status = statusField && rec?.[statusField]
      ? `${translateRuntime("common.status")}: ${String(rec[statusField]).replace(/_/g, " ")}`
      : "";
    const when = event?.timeLabel ? `${translateRuntime("common.view_modes.when")}: ${event.timeLabel}` : "";
    return [title, when, status].filter(Boolean).join(" | ");
  };

  return (
    <div className="h-full min-h-0 w-full rounded-box border border-base-300 bg-base-100 p-3 flex flex-col gap-3 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2">
        <div className="join shrink-0">
          <button className={`${SOFT_BUTTON_SM} join-item`} onClick={() => moveCursor(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button className={`${SOFT_BUTTON_SM} join-item`} onClick={() => setCursorMonth(new Date())}>
            {translateRuntime("common.view_modes.today")}
          </button>
          <button className={`${SOFT_BUTTON_SM} join-item`} onClick={() => moveCursor(1)}>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="min-w-0 flex-1 text-sm sm:text-base font-semibold text-center sm:text-left">{monthLabel}</div>
        <div className="w-full sm:w-auto overflow-x-auto no-scrollbar">
          <div className="join min-w-max">
            <button className={`${SOFT_BUTTON_SM} join-item ${scale === "day" ? "bg-base-300" : ""}`} onClick={() => setScale("day")}>{translateRuntime("common.view_modes.day")}</button>
            <button className={`${SOFT_BUTTON_SM} join-item ${scale === "week" ? "bg-base-300" : ""}`} onClick={() => setScale("week")}>{translateRuntime("common.view_modes.week")}</button>
            <button className={`${SOFT_BUTTON_SM} join-item ${scale === "month" ? "bg-base-300" : ""}`} onClick={() => setScale("month")}>{translateRuntime("common.view_modes.month")}</button>
            <button className={`${SOFT_BUTTON_SM} join-item ${scale === "year" ? "bg-base-300" : ""}`} onClick={() => setScale("year")}>{translateRuntime("common.view_modes.year")}</button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {scale !== "year" ? (
          <div className={`h-full min-h-0 flex flex-col ${scale === "month" ? "overflow-auto" : "overflow-hidden"}`}>
            {scale === "month" && (
              <div className="shrink-0 min-w-[700px] grid grid-cols-7 gap-2 text-xs font-semibold text-base-content/60 mb-2">
                {weekdays.map((w) => (
                  <div key={w} className="px-1 py-1">{w}</div>
                ))}
              </div>
            )}

            {scale === "month" ? (
              <div
                className="flex-1 min-h-0 min-w-[700px] grid gap-2 grid-cols-7"
                style={{ gridTemplateRows: `repeat(${monthDays.rowCount || 6}, minmax(0, 1fr))` }}
              >
                {monthDays.cells.map((cell) => (
                  <div
                    key={cell.key}
                    className={`h-full min-h-0 rounded-box border p-2 flex flex-col gap-1 overflow-hidden hover:border-primary/40 cursor-pointer ${
                      !cell.inMonth ? "border-base-200 bg-base-200/35" : "border-base-300 bg-base-100"
                    } ${cell.key === todayKey ? "ring-1 ring-inset ring-primary/40" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setCursorMonth(new Date(cell.date));
                      setScale("day");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setCursorMonth(new Date(cell.date));
                        setScale("day");
                      }
                    }}
                  >
                    <div className={`text-xs font-medium ${!cell.inMonth ? "text-base-content/50" : "text-base-content"}`}>
                      {cell.date.getDate()}
                    </div>
                    <div className="space-y-1 flex-1 min-h-0 overflow-auto pr-1">
                      {[...(cell.events || [])]
                        .sort((a, b) => {
                          if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
                          if (a.sortMinutes !== b.sortMinutes) return a.sortMinutes - b.sortMinutes;
                          return String(a.title).localeCompare(String(b.title));
                        })
                        .map((event, idx) => (
                          <DaisyTooltip key={`${cell.key}-${idx}`} label={describeEvent(event)} placement="top">
                            <button
                              type="button"
                              className="w-full text-left truncate rounded-md bg-primary/10 hover:bg-primary/20 text-base-content px-1.5 py-1 text-[11px]"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectRow?.(event.row);
                              }}
                              title={event.title}
                            >
                              {event.title}
                            </button>
                          </DaisyTooltip>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              (() => {
                const cells = scale === "week" ? weekDays : [dayCell];
                const defaultStart = 6 * 60;
                const defaultEnd = 20 * 60;
                let minStart = defaultStart;
                let maxEnd = defaultEnd;
                for (const cell of cells) {
                  const layout = timedByDay.get(cell.key)?.layout;
                  for (const ev of layout?.items || []) {
                    if (ev.startMin < minStart) minStart = ev.startMin;
                    if (ev.endMin > maxEnd) maxEnd = ev.endMin;
                  }
                }
                minStart = Math.max(0, Math.floor((minStart - 60) / 60) * 60);
                maxEnd = Math.min(24 * 60, Math.ceil((maxEnd + 60) / 60) * 60);
                if (maxEnd - minStart < 6 * 60) maxEnd = Math.min(24 * 60, minStart + 6 * 60);
                const hourHeight = 56;
                const pxPerMin = hourHeight / 60;
                const dayHeight = Math.max(560, Math.round((maxEnd - minStart) * pxPerMin));
                const marks = [];
                for (let m = minStart; m <= maxEnd; m += 30) marks.push(m);
                const laneWidth = 140;
                const gridTemplateColumns = `64px repeat(${cells.length}, minmax(0, 1fr))`;
                const timelineMinWidth = scale === "week" ? Math.max(760, 64 + cells.length * 120) : 0;

                const now = new Date();
                const nowMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
                const showNowInRange = nowMinutes >= minStart && nowMinutes <= maxEnd;
                const nowTop = (nowMinutes - minStart) * pxPerMin;

                return (
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <div className="h-full min-h-0 overflow-y-auto overflow-x-auto no-scrollbar pr-1">
                      <div style={timelineMinWidth > 0 ? { minWidth: `${timelineMinWidth}px` } : undefined}>
                        <div className="grid gap-2 mb-2" style={{ gridTemplateColumns }}>
                          <div />
                          {cells.map((cell) => {
                            const allDayCount = timedByDay.get(cell.key)?.allDayCount || 0;
                            const isClickable = scale === "week";
                            return (
                              <button
                                key={`hdr-${cell.key}`}
                                type="button"
                                className={`px-2 text-left text-xs font-semibold text-base-content/70 ${isClickable ? "hover:text-base-content" : "cursor-default"}`}
                                onClick={() => {
                                  if (!isClickable) return;
                                  setCursorMonth(new Date(cell.date));
                                  setScale("day");
                                }}
                              >
                                {cell.date.toLocaleDateString(undefined, scale === "week"
                                  ? { weekday: "short", day: "numeric", month: "short" }
                                  : { weekday: "long", day: "numeric", month: "short" })}
                                {allDayCount > 0 ? <span className="ml-2 text-base-content/50">{translateRuntime("common.view_modes.events_count_all_day", { count: allDayCount })}</span> : null}
                              </button>
                            );
                          })}
                        </div>
                        <div className="grid gap-2" style={{ gridTemplateColumns }}>
                          <div className="relative border-r border-base-300" style={{ height: dayHeight }}>
                            {marks.map((m) => (
                              <div key={`t-${m}`} className="absolute left-0 right-0" style={{ top: (m - minStart) * pxPerMin }}>
                                {m % 60 === 0 ? (
                                  <div className="-translate-y-1/2 pr-2 text-right text-[11px] text-base-content/60">
                                    {formatClockLabel(new Date(2000, 0, 1, Math.floor(m / 60), m % 60))}
                                  </div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                          {cells.map((cell) => {
                            const layout = timedByDay.get(cell.key)?.layout || { items: [], maxColumns: 1 };
                            const lanes = Math.max(1, layout.maxColumns || 1);
                            const canvasWidth = Math.max(0, lanes * laneWidth);
                            const useFixedWidthCanvas = lanes > 4;
                            return (
                              <div
                                key={cell.key}
                                className={`rounded-box border border-base-300 bg-base-100 overflow-hidden ${scale === "week" ? "cursor-pointer hover:border-primary/40" : ""}`}
                                style={{ height: dayHeight }}
                                onClick={() => {
                                  if (scale !== "week") return;
                                  setCursorMonth(new Date(cell.date));
                                  setScale("day");
                                }}
                              >
                                <div className={useFixedWidthCanvas ? "h-full overflow-x-auto overflow-y-hidden" : "h-full overflow-hidden"}>
                                  <div className="relative min-w-full" style={{ width: useFixedWidthCanvas ? `${canvasWidth}px` : "100%", height: dayHeight }}>
                                  {marks.map((m) => (
                                    <div
                                      key={`${cell.key}-line-${m}`}
                                      className={`absolute left-0 right-0 z-0 ${m % 60 === 0 ? "border-t border-base-300/80" : "border-t border-base-300/35"}`}
                                      style={{ top: (m - minStart) * pxPerMin }}
                                    />
                                  ))}
                                  {layout.items.map((ev, idx) => {
                                    const rawTop = (ev.startMin - minStart) * pxPerMin;
                                    const rawHeight = Math.max(18, (ev.endMin - ev.startMin) * pxPerMin);
                                    const eventInset = 2;
                                    const top = Math.max(eventInset, rawTop + eventInset);
                                    const height = Math.max(18, rawHeight - eventInset * 2);
                                    const leftPct = (ev.col / lanes) * 100;
                                    const widthPct = 100 / lanes;
                                    return (
                                      <DaisyTooltip key={`${cell.key}-ev-${idx}`} label={describeEvent(ev)} placement="top">
                                        <button
                                          type="button"
                                          className="absolute z-10 box-border text-left rounded-box bg-primary/10 hover:bg-primary/20 text-base-content px-1.5 py-1 text-[11px] overflow-hidden"
                                          style={{
                                            top,
                                            height,
                                            left: `calc(${leftPct}% + 2px)`,
                                            width: `calc(${widthPct}% - 4px)`,
                                          }}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            onSelectRow?.(ev.row);
                                          }}
                                          title={`${ev.timeLabel} - ${ev.title}`}
                                        >
                                          <div className="font-medium truncate">{ev.title}</div>
                                          <div className="text-[10px] opacity-70 truncate">{ev.timeLabel}</div>
                                        </button>
                                      </DaisyTooltip>
                                    );
                                  })}
                                  {showNowInRange && cell.key === todayKey ? (
                                    <div
                                      className="absolute left-0 right-0 z-20 border-t border-error/80 pointer-events-none"
                                      style={{ top: nowTop }}
                                    />
                                  ) : null}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()
            )}
          </div>
        ) : (
          <div className="h-full min-h-0 overflow-auto">
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            {yearMonths.map((month) => (
              <button
                key={month.idx}
                type="button"
                className="rounded-box border border-base-300 bg-base-100 hover:bg-base-200 p-3 text-left flex flex-col gap-2"
                onClick={() => {
                  setCursorMonth(new Date(cursorMonth.getFullYear(), month.idx, 1));
                  setScale("month");
                }}
              >
                <div className="font-medium">{month.label}</div>
                <div className="text-xs text-base-content/60">{translateRuntime("common.view_modes.events_count", { count: month.total })}</div>
              </button>
            ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PivotView({ data, measure }) {
  if (!data || !Array.isArray(data.rows) || !Array.isArray(data.cols)) {
    return <div className="text-sm opacity-60">{translateRuntime("common.view_modes.no_data")}</div>;
  }
  const humanize = (value) =>
    String(value || "")
      .split(".")
      .pop()
      .replace(/_/g, " ")
      .replace(/\b\w/g, (m) => m.toUpperCase());
  const rowHeader = data?.row_group_by ? humanize(data.row_group_by) : translateRuntime("common.view_modes.row");
  const formatValue = (value) => {
    if (measure?.startsWith("sum:")) return Number(value || 0).toFixed(2);
    return String(value || 0);
  };
  return (
    <div className="h-full min-h-0 overflow-auto">
      <table className="table table-sm">
        <thead>
          <tr>
            <th className="bg-base-300">{rowHeader}</th>
            {data.cols.map((col) => (
              <th key={col.key} className="bg-base-300">
                {col.label || translateRuntime("common.view_modes.empty")}
              </th>
            ))}
            <th className="bg-base-300">{translateRuntime("common.view_modes.total")}</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.key}>
              <th>{row.label || translateRuntime("common.view_modes.empty")}</th>
              {data.cols.map((col) => {
                const value = data.matrix?.[row.key]?.[col.key] || 0;
                return <td key={`${row.key}-${col.key}`}>{formatValue(value)}</td>;
              })}
              <td className="font-semibold">{formatValue(data.row_totals?.[row.key] || 0)}</td>
            </tr>
          ))}
          <tr>
            <th>{translateRuntime("common.view_modes.total")}</th>
            {data.cols.map((col) => (
              <td key={`total-${col.key}`} className="font-semibold">
                {formatValue(data.col_totals?.[col.key] || 0)}
              </td>
            ))}
            <td className="font-semibold">{formatValue(data.grand_total || 0)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function ViewModesBlock({
  block,
  manifest,
  searchParams,
  setSearchParams,
  onNavigate,
  onRunAction,
  onLookupCreate,
  actionsMap,
  moduleId = null,
  externalRefreshTick = 0,
  previewMode = false,
  onConfirm,
  onPrompt,
  bootstrap = null,
  bootstrapVersion = 0,
  bootstrapLoading = false,
  canWriteRecords = true,
  recordContext = null,
  forceListOnly = false,
  onPageSectionLoadingChange = null,
}) {
  const isMobile = useMediaQuery("(max-width: 768px)");
  const compact = block?.compact === true;
  const compactMobile = compact && isMobile;
  const modes = Array.isArray(block?.modes) ? block.modes : [];
  const views = Array.isArray(manifest?.views) ? manifest.views : [];
  const appDefaults = manifest?.app?.defaults || {};
  const entityFullId = resolveEntityFullId(manifest, block?.entity_id);
  const entityDef = (manifest?.entities || []).find((e) => e.id === entityFullId);
  const entityLabel = entityDef?.label || humanizeEntityId(entityFullId);
  const recordContextEntityFullId = recordContext?.entityId ? resolveEntityFullId(manifest, recordContext.entityId) : null;
  const recordContextEntityDef = (manifest?.entities || []).find((e) => e.id === recordContextEntityFullId);
  const recordContextReturnLabel = recordContext?.recordId
    ? recordContextEntityDef?.label || humanizeEntityId(recordContextEntityFullId)
    : null;
  const fieldIndex = useMemo(() => buildFieldIndex(manifest, entityFullId), [manifest, entityFullId]);
  const actions = Array.isArray(manifest?.actions) ? manifest.actions : [];
  const transformations = Array.isArray(manifest?.transformations) ? manifest.transformations : [];

  const [records, setRecords] = useState([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [clientFilters, setClientFilters] = useState([]);
  const [savedFilters, setSavedFilters] = useState([]);
  const [prefs, setPrefs] = useState(null);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [listPage, setListPage] = useState(0);
  const [listTotalItems, setListTotalItems] = useState(0);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState("csv");
  const [exportColumnScope, setExportColumnScope] = useState("visible");
  const [exportBusy, setExportBusy] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importFileName, setImportFileName] = useState("");
  const [importParseError, setImportParseError] = useState("");
  const [importHeaders, setImportHeaders] = useState([]);
  const [importRows, setImportRows] = useState([]);
  const [importMappedFields, setImportMappedFields] = useState([]);
  const [importUnmappedHeaders, setImportUnmappedHeaders] = useState([]);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const settingsMenuRef = useRef(null);
  const prefsLoadedRef = useRef(false);
  const bootstrapUsedRef = useRef(null);

  const modeParam = searchParams?.get("mode") || null;
  const searchText = searchParams?.get("search") || "";
  const filterParam = searchParams?.get("filter") || "";
  const groupByParam = searchParams?.get("group_by") || "";
  const graphTypeParam = searchParams?.get("graph_type") || "";
  const graphGroupByParam = searchParams?.get("graph_group_by") || "";
  const graphMeasureParam = searchParams?.get("graph_measure") || "";
  const pivotRowParam = searchParams?.get("pivot_row_group_by") || "";
  const pivotColParam = searchParams?.get("pivot_col_group_by") || "";
  const pivotMeasureParam = searchParams?.get("pivot_measure") || "";

  const resolvedModes = modes
    .map((m) => ({
      ...m,
      targetId: normalizeViewTarget(m.target),
      view: views.find((v) => v.id === normalizeViewTarget(m.target)),
    }))
    .filter((m) => m.mode && m.targetId && m.view);

  const modeButtons = useMemo(() => {
    if (forceListOnly) return resolvedModes.filter((m) => m.mode === "list" && !m.disabled);
    return resolvedModes.filter((m) => !m.disabled);
  }, [resolvedModes, forceListOnly]);

  const defaultMode = forceListOnly ? "list" : (block?.default_mode || resolvedModes[0]?.mode || "list");
  const activeMode = forceListOnly ? "list" : (resolvedModes.find((m) => m.mode === modeParam)?.mode || defaultMode);
  const activeModeDef = resolvedModes.find((m) => m.mode === activeMode) || resolvedModes[0] || null;
  const activeView = activeModeDef?.view || null;
  const activeViewKind = String(activeView?.kind || activeView?.type || "").toLowerCase();
  const effectiveGroupByParam = groupByParam || prefs?.default_group_by || activeModeDef?.default_group_by || block?.default_group_by || "";

  const groupByFieldDef = useMemo(
    () => (Array.isArray(entityDef?.fields) ? entityDef.fields.find((f) => f?.id === effectiveGroupByParam) : null),
    [entityDef, effectiveGroupByParam]
  );
  const workflowStatusField = useMemo(() => {
    const workflows = Array.isArray(manifest?.workflows) ? manifest.workflows : [];
    const wf = workflows.find((item) => item?.entity === entityFullId && typeof item?.status_field === "string");
    return wf?.status_field || null;
  }, [manifest, entityFullId]);
  const kanbanCanDrag = useMemo(() => {
    if (!canWriteRecords || previewMode) return false;
    if (!effectiveGroupByParam) return false;
    if (groupByFieldDef?.readonly) return false;
    const t = String(groupByFieldDef?.type || "").toLowerCase();
    return t === "enum" || t === "string" || t === "number" || t === "bool" || t === "user";
  }, [canWriteRecords, previewMode, effectiveGroupByParam, groupByFieldDef]);

  useEffect(() => {
    if (!settingsMenuOpen || isMobile) return undefined;
    function handlePointerDown(event) {
      if (!settingsMenuRef.current) return;
      if (!settingsMenuRef.current.contains(event.target)) {
        setSettingsMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [settingsMenuOpen, isMobile]);

  function castGroupValue(rawValue) {
    if (rawValue === "") return null;
    const fieldType = String(groupByFieldDef?.type || "").toLowerCase();
    if (fieldType === "number") {
      const n = Number(rawValue);
      return Number.isFinite(n) ? n : null;
    }
    if (fieldType === "bool") {
      if (rawValue === true || rawValue === "true") return true;
      if (rawValue === false || rawValue === "false") return false;
      return null;
    }
    return rawValue;
  }

  function findActionTransitionValue(action) {
    if (!action) return null;
    if (action.kind === "update_record") {
      if (resolveEntityFullId(manifest, action.entity_id) !== entityFullId) return null;
      const patch = action.patch;
      if (!patch || typeof patch !== "object" || !(effectiveGroupByParam in patch)) return null;
      return { value: patch[effectiveGroupByParam] };
    }
    if (action.kind === "transform_record") {
      if (resolveEntityFullId(manifest, action.entity_id) !== entityFullId) return null;
      const transformation = transformations.find((item) => item?.key === action.transformation_key);
      if (!transformation || resolveEntityFullId(manifest, transformation.source_entity_id) !== entityFullId) return null;
      const sourcePatch = transformation?.source_update?.patch;
      if (!sourcePatch || typeof sourcePatch !== "object" || !(effectiveGroupByParam in sourcePatch)) return null;
      return { value: sourcePatch[effectiveGroupByParam] };
    }
    return null;
  }

  function findTransitionAction(record, targetValue) {
    const matches = actions.filter((action) => {
      const transition = findActionTransitionValue(action);
      return transition?.value === targetValue;
    });
    const visible = matches.filter((action) => {
      if (!action.visible_when) return true;
      return evalCondition(action.visible_when, { record: record || {} });
    });
    return { matches, visible, action: visible[0] || null };
  }

  function formatKanbanMoveError(err, targetValue) {
    const targetLabel =
      groupBy && targetValue !== null && targetValue !== undefined && targetValue !== ""
        ? (formatCardValue(groupBy, targetValue) || humanize(targetValue))
        : "this column";
    if (err?.code === "ACTION_DISABLED" && err?.path === "action_id") {
      return `Complete the required validation before moving this card to ${targetLabel}.`;
    }
    if (typeof err?.message === "string" && err.message.trim()) {
      return err.message.trim();
    }
    return `Move to ${targetLabel} failed.`;
  }

  async function handleKanbanMove(row, targetGroupKey) {
    const record = row?.record || {};
    const rowId = row?.record_id || record?.id;
    if (!rowId || !effectiveGroupByParam) return { ok: false, message: "Invalid record." };
    const targetValue = castGroupValue(targetGroupKey);
    const currentValue = record[effectiveGroupByParam] ?? null;
    if (currentValue === targetValue) return { ok: true };

    const transition = findTransitionAction(record, targetValue);
    const transitionAction = transition.action;
    const isStatusMove = workflowStatusField && effectiveGroupByParam === workflowStatusField;
    if (transitionAction?.modal_id) {
      return { ok: false, message: "This transition requires a modal. Open the record to continue." };
    }
    if (!transitionAction) {
      if (transition.matches.length > 0) {
        return { ok: false, message: "Move blocked by validation/visibility rules for this action." };
      }
      if (isStatusMove) {
        return { ok: false, message: "No valid transition action for this move." };
      }
      return { ok: false, message: "No matching action for this move. Drag/drop only runs defined actions." };
    }

    try {
      if (typeof onRunAction !== "function") {
        return { ok: false, message: "Action runner unavailable for drag/drop." };
      }
      const result = await onRunAction(transitionAction, {
        recordId: rowId,
        recordDraft: { ...(record || {}) },
        stayOnSourceRecord: transitionAction.kind === "transform_record",
      });
      if (!result) return { ok: false, message: "Transition failed." };
      const patch = transitionAction?.patch && typeof transitionAction.patch === "object" ? transitionAction.patch : null;
      const resultEntityId = result?.entity_id ? resolveEntityFullId(manifest, result.entity_id) : null;
      const sourceEntityId = result?.source_entity_id ? resolveEntityFullId(manifest, result.source_entity_id) : null;
      const resultRecord =
        result?.record && typeof result.record === "object" && (!resultEntityId || resultEntityId === entityFullId)
          ? result.record
          : null;
      const sourceRecord =
        result?.source_record && typeof result.source_record === "object" && (!sourceEntityId || sourceEntityId === entityFullId)
          ? result.source_record
          : null;
      const nextRecord = sourceRecord || resultRecord || { ...(record || {}), ...(patch || {}), [effectiveGroupByParam]: targetValue };
      setRecords((prev) =>
        (Array.isArray(prev) ? prev : []).map((entry) => {
          const entryId = entry?.record_id || entry?.record?.id;
          if (entryId !== rowId) return entry;
          return {
            ...entry,
            record: { ...(entry.record || {}), ...(nextRecord || {}) },
          };
        })
      );
      setRefreshTick((v) => v + 1);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: formatKanbanMoveError(err, targetValue) };
    }
  }

  const listView = resolvedModes.find((m) => m.mode === "list")?.view || activeView;
  const searchFields = Array.isArray(listView?.header?.search?.fields) ? listView.header.search.fields : [];
  const manifestFilters = Array.isArray(listView?.header?.filters) ? listView.header.filters : [];
  const graphDefault = activeView?.default || {};
  const graphType = graphTypeParam || graphDefault.type || "bar";
  const graphGroupBy = graphGroupByParam || effectiveGroupByParam || graphDefault.group_by || "";
  const graphMeasure = graphMeasureParam || graphDefault.measure || "count";
  const showGraphMode = activeMode === "graph";
  const showListMode = activeMode === "list";
  const showKanbanMode = activeMode === "kanban";
  const showCalendarMode = activeMode === "calendar";
  const sectionKey = useMemo(
    () => `view_modes:${entityFullId || "entity"}:${activeView?.id || activeMode || "view"}`,
    [entityFullId, activeView?.id, activeMode]
  );
  const listPageSize = Number.isFinite(Number(block?.page_size)) && Number(block?.page_size) > 0
    ? Number(block?.page_size)
    : Number.isFinite(Number(listView?.page_size)) && Number(listView?.page_size) > 0
      ? Number(listView?.page_size)
      : 25;
  const pivotRowGroupBy = pivotRowParam || effectiveGroupByParam || activeModeDef?.default_group_by || block?.default_group_by || "";
  const pivotColGroupBy = pivotColParam || "";
  const pivotMeasure = pivotMeasureParam || activeModeDef?.default_measure || block?.default_measure || "count";

  const savedFilterList = useMemo(
    () =>
      savedFilters.map((f) => ({
        id: f.id,
        label: f.name,
        domain: f.domain,
        source: "saved",
        is_default: f.is_default,
      })),
    [savedFilters]
  );
  const manifestFilterList = useMemo(
    () => manifestFilters.map((f) => ({ ...f, source: "manifest" })),
    [manifestFilters]
  );

  const activeFilter =
    savedFilterList.find((f) => f.id === filterParam) ||
    manifestFilterList.find((f) => f.id === filterParam) ||
    null;
  const recordScope = useMemo(() => {
    const base = recordContext?.record && typeof recordContext.record === "object" ? recordContext.record : {};
    const id = recordContext?.recordId || base?.id || null;
    return id ? { ...base, id } : base;
  }, [recordContext]);
  const recordDomain = useMemo(
    () => resolveConditionRefs(block?.record_domain || null, recordScope),
    [block?.record_domain, recordScope]
  );
  const createDefaults = useMemo(
    () => resolveTemplateRefs(block?.create_defaults || null, recordScope),
    [block?.create_defaults, recordScope]
  );
  const domain = useMemo(
    () => buildDomain(activeFilter, clientFilters, recordDomain),
    [activeFilter, clientFilters, recordDomain]
  );
  const pendingDefaultMode = !forceListOnly && !modeParam && Boolean(defaultMode);
  const pendingDefaultFilter =
    !forceListOnly &&
    !filterParam &&
    clientFilters.length === 0 &&
    Boolean(prefs?.default_filter_id || prefs?.default_filter_key || block?.default_filter_id);
  const pendingDefaultGroup =
    !forceListOnly &&
    !groupByParam &&
    Boolean(prefs?.default_group_by || activeModeDef?.default_group_by || block?.default_group_by);
  const waitingForInitialParams =
    !previewMode &&
    !forceListOnly &&
    (pendingDefaultFilter || (pendingDefaultGroup && !effectiveGroupByParam));

  useEffect(() => {
    if (previewMode || !entityFullId) return;
    let mounted = true;
    async function loadPrefs() {
      try {
        const session = await getSafeSession();
        if (!session?.access_token) {
          prefsLoadedRef.current = true;
          if (mounted) setPrefsLoaded(true);
          return;
        }
      } catch {
        prefsLoadedRef.current = true;
        if (mounted) setPrefsLoaded(true);
        return;
      }
      apiFetch(`/filters/${encodeURIComponent(entityFullId)}`)
        .then((res) => {
          if (!mounted) return;
          setSavedFilters(Array.isArray(res?.filters) ? res.filters.map(normalizeSavedFilterRow).filter(Boolean) : []);
        })
        .catch(() => {});
      apiFetch(`/prefs/entity/${encodeURIComponent(entityFullId)}`)
        .then((res) => {
          if (!mounted) return;
          setPrefs(res.prefs || {});
          prefsLoadedRef.current = true;
          setPrefsLoaded(true);
        })
        .catch(() => {
          prefsLoadedRef.current = true;
          if (mounted) setPrefsLoaded(true);
        });
    }
    loadPrefs();
    return () => {
      mounted = false;
    };
  }, [entityFullId, previewMode]);

  async function reloadSavedFilters() {
    if (previewMode || !entityFullId) return;
    try {
      const res = await apiFetch(`/filters/${encodeURIComponent(entityFullId)}`);
      setSavedFilters(Array.isArray(res?.filters) ? res.filters.map(normalizeSavedFilterRow).filter(Boolean) : []);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (forceListOnly) return;
    if (!setSearchParams) return;
    if (!prefsLoadedRef.current) return;
    const params = new URLSearchParams(searchParams || "");
    let changed = false;
    if (!params.get("mode")) {
      const prefMode = prefs?.default_mode;
      params.set("mode", prefMode || defaultMode);
      changed = true;
    }
    if (!params.get("filter")) {
      const prefFilter = prefs?.default_filter_id || prefs?.default_filter_key || block?.default_filter_id;
      if (prefFilter && clientFilters.length === 0) {
        params.set("filter", prefFilter);
        changed = true;
      }
    }
    if (!params.get("group_by")) {
      const prefGroup = prefs?.default_group_by || activeModeDef?.default_group_by || block?.default_group_by;
      if (prefGroup) {
        params.set("group_by", prefGroup);
        changed = true;
      }
    }
    if (changed) setSearchParams(params, { replace: true });
  }, [forceListOnly, prefs, searchParams, setSearchParams, defaultMode, activeModeDef, block, clientFilters.length]);

  useEffect(() => {
    if (forceListOnly) return;
    if (!setSearchParams || !activeView) return;
    const params = new URLSearchParams(searchParams || "");
    let changed = false;
    if (activeMode === "graph") {
      const graphDefaults = activeView.default || {};
      if (!params.get("graph_type") && graphDefaults.type) {
        params.set("graph_type", graphDefaults.type);
        changed = true;
      }
      if (!params.get("graph_measure") && graphDefaults.measure) {
        params.set("graph_measure", graphDefaults.measure);
        changed = true;
      }
      if (!params.get("graph_group_by") && graphDefaults.group_by && !params.get("group_by")) {
        params.set("graph_group_by", graphDefaults.group_by);
        changed = true;
      }
    }
    if (activeMode === "pivot") {
      if (!params.get("pivot_row_group_by") && effectiveGroupByParam) {
        params.set("pivot_row_group_by", effectiveGroupByParam);
        changed = true;
      }
      if (!params.get("pivot_measure") && (activeModeDef?.default_measure || block?.default_measure)) {
        params.set("pivot_measure", activeModeDef?.default_measure || block?.default_measure);
        changed = true;
      }
    }
    if (changed) setSearchParams(params, { replace: true });
  }, [forceListOnly, activeMode, activeView, searchParams, setSearchParams, effectiveGroupByParam]);

  useEffect(() => {
    if (!activeView || previewMode) {
      setRecordsLoading(false);
      return undefined;
    }
    if (waitingForInitialParams) {
      setRecordsLoading(true);
      return undefined;
    }
    const viewKind = activeView.kind || activeView.type;
    if (viewKind === "graph" || activeMode === "pivot") {
      setRecordsLoading(false);
      return undefined;
    }
    const bootstrapList = bootstrap?.list;
    const allowBootstrapList =
      !domain &&
      !searchText &&
      !effectiveGroupByParam;
    const bootstrapMatches =
      allowBootstrapList &&
      bootstrapList &&
      bootstrap?.viewId === activeView?.id &&
      bootstrapList?.entity_id === entityFullId &&
      bootstrapUsedRef.current !== bootstrapVersion;
    if (bootstrapMatches && ["list", "kanban", "calendar"].includes(String(viewKind))) {
      setRecords(bootstrapList.records || []);
      setSelectedIds([]);
      bootstrapUsedRef.current = bootstrapVersion;
      setRecordsLoading(false);
      return undefined;
    }
    if (bootstrapLoading && viewKind === "list") {
      setRecordsLoading(true);
      return undefined;
    }
    if (block?.record_domain && hasRecordRef(block.record_domain) && !recordScope?.id) {
      setRecords([]);
      setSelectedIds([]);
      setRecordsLoading(false);
      return undefined;
    }
    const listFields = [];
    if (viewKind === "list") {
      const cols = Array.isArray(activeView.columns) ? activeView.columns : [];
      for (const c of cols) {
        if (c?.field_id) listFields.push(c.field_id);
        const field = fieldIndex?.[c?.field_id];
        if (field?.type === "number" && field?.format) {
          if (typeof field.format.currency_field === "string" && field.format.currency_field) {
            listFields.push(field.format.currency_field);
          }
          if (typeof field.format.unit_field === "string" && field.format.unit_field) {
            listFields.push(field.format.unit_field);
          }
        }
      }
    }
    if (viewKind === "kanban") {
      const card = activeView.card || {};
      if (card.title_field) listFields.push(card.title_field);
      for (const fid of card.subtitle_fields || []) listFields.push(fid);
      for (const fid of card.badge_fields || []) listFields.push(fid);
      if (effectiveGroupByParam) listFields.push(effectiveGroupByParam);
    }
    if (viewKind === "calendar") {
      const calendar = activeView.calendar || {};
      const titleField = calendar.title_field || activeView.title_field || entityDef?.display_field;
      const startField = calendar.date_start || activeView.date_start;
      const endField = calendar.date_end || activeView.date_end;
      if (titleField) listFields.push(titleField);
      if (startField) listFields.push(startField);
      if (endField) listFields.push(endField);
      if (calendar.color_field) listFields.push(calendar.color_field);
      if (calendar.all_day_field) listFields.push(calendar.all_day_field);
    }
    if (entityDef?.display_field) listFields.push(entityDef.display_field);
    const uniq = Array.from(new Set(listFields));
    const qs = new URLSearchParams();
    if (uniq.length) qs.set("fields", uniq.join(","));
    if (searchText) qs.set("q", searchText);
    if (searchFields.length) qs.set("search_fields", searchFields.join(","));
    if (domain) qs.set("domain", JSON.stringify(domain));
    let cancelled = false;
    setRecordsLoading(true);
    apiFetch(`/records/${entityFullId}${qs.toString() ? `?${qs.toString()}` : ""}`)
      .then((res) => {
        if (cancelled) return;
        setRecords(res.records || []);
        setSelectedIds([]);
      })
      .catch(() => {
        if (!cancelled) setRecords([]);
      })
      .finally(() => {
        if (!cancelled) setRecordsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeView, entityFullId, searchText, searchFields, domain, effectiveGroupByParam, previewMode, entityDef, refreshTick, externalRefreshTick, bootstrap, bootstrapVersion, bootstrapLoading, block, recordScope, waitingForInitialParams]);

  useEffect(() => {
    const sectionBusy =
      (showListMode || showKanbanMode || showCalendarMode) &&
      (recordsLoading || waitingForInitialParams);
    onPageSectionLoadingChange?.(sectionKey, sectionBusy);
    return () => onPageSectionLoadingChange?.(sectionKey, false);
  }, [
    onPageSectionLoadingChange,
    sectionKey,
    showListMode,
    showKanbanMode,
    showCalendarMode,
    recordsLoading,
    waitingForInitialParams,
  ]);

  useEffect(() => {
    if (previewMode) return undefined;
    return subscribeRecordMutations((detail) => {
      if (!detail || detail.entityId !== entityFullId) return;
      const ids = Array.isArray(detail.recordIds)
        ? detail.recordIds.map((value) => String(value || "")).filter(Boolean)
        : detail.recordId
          ? [String(detail.recordId)]
          : [];
      const nextRecord = detail.record && typeof detail.record === "object" ? detail.record : null;
      if (detail.operation === "delete" && ids.length > 0) {
        const idSet = new Set(ids);
        setRecords((prev) =>
          (Array.isArray(prev) ? prev : []).filter((row) => !idSet.has(String(row?.record_id || row?.record?.id || "")))
        );
        setSelectedIds((prev) => prev.filter((id) => !idSet.has(String(id || ""))));
        return;
      }
      if ((detail.operation === "update" || detail.operation === "action") && ids.length > 0 && nextRecord) {
        const targetId = ids[0];
        setRecords((prev) =>
          (Array.isArray(prev) ? prev : []).map((row) => {
            const rowId = String(row?.record_id || row?.record?.id || "");
            if (rowId !== targetId) return row;
            return {
              ...row,
              record: { ...(row?.record || {}), ...nextRecord },
            };
          })
        );
        return;
      }
      if (detail.operation === "create" && ids.length > 0 && nextRecord) {
        const targetId = ids[0];
        setRecords((prev) => {
          const rows = Array.isArray(prev) ? prev : [];
          if (rows.some((row) => String(row?.record_id || row?.record?.id || "") === targetId)) return rows;
          return [{ record_id: targetId, record: nextRecord }, ...rows];
        });
      }
    });
  }, [previewMode, entityFullId]);

  const [graphData, setGraphData] = useState([]);
  useEffect(() => {
    if (!activeView || previewMode) return;
    if (waitingForInitialParams) return;
    const viewKind = activeView.kind || activeView.type;
    if (viewKind !== "graph") return;
    const groupBy = graphGroupBy;
    if (!groupBy) {
      setGraphData([]);
      return;
    }
    const measure = graphMeasure || "count";
    const qs = new URLSearchParams();
    qs.set("group_by", groupBy);
    qs.set("measure", measure);
    if (searchText) qs.set("q", searchText);
    if (searchFields.length) qs.set("search_fields", searchFields.join(","));
    if (domain) qs.set("domain", JSON.stringify(domain));
    apiFetch(`/records/${entityFullId}/aggregate?${qs.toString()}`)
      .then((res) => {
        setGraphData(res.groups || []);
      })
      .catch(() => setGraphData([]));
  }, [activeView, entityFullId, searchText, searchFields, domain, graphGroupBy, graphMeasure, previewMode, refreshTick, externalRefreshTick, waitingForInitialParams]);

  const [groupLookupLabels, setGroupLookupLabels] = useState({});
  const [groupMemberLabels, setGroupMemberLabels] = useState({});

  const [pivotData, setPivotData] = useState(null);
  useEffect(() => {
    if (!entityFullId || previewMode) return;
    if (waitingForInitialParams) return;
    if (activeMode !== "pivot") return;
    if (!pivotRowGroupBy) {
      setPivotData(null);
      return;
    }
    const qs = new URLSearchParams();
    qs.set("row_group_by", pivotRowGroupBy);
    if (pivotColGroupBy) qs.set("col_group_by", pivotColGroupBy);
    if (pivotMeasure) qs.set("measure", pivotMeasure);
    if (searchText) qs.set("q", searchText);
    if (searchFields.length) qs.set("search_fields", searchFields.join(","));
    if (domain) qs.set("domain", JSON.stringify(domain));
    apiFetch(`/records/${entityFullId}/pivot?${qs.toString()}`)
      .then((res) => {
        setPivotData(res || null);
      })
      .catch(() => setPivotData(null));
  }, [activeMode, entityFullId, pivotRowGroupBy, pivotColGroupBy, pivotMeasure, searchText, searchFields, domain, previewMode, refreshTick, externalRefreshTick, waitingForInitialParams]);

  const groupedFieldValues = useMemo(() => {
    const out = [];
    const pushValues = (fieldId, values) => {
      if (!fieldId) return;
      const fieldDef = fieldIndex[fieldId];
      if (!fieldDef) return;
      const seen = new Set();
      const cleaned = [];
      for (const value of values || []) {
        const key = String(value ?? "").trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        cleaned.push(key);
      }
      if (!cleaned.length) return;
      out.push({ fieldId, fieldDef, values: cleaned });
    };
    if (graphGroupBy && Array.isArray(graphData) && graphData.length) {
      pushValues(
        graphGroupBy,
        graphData.map((item) => item?.key ?? item?.group ?? item?.label ?? ""),
      );
    }
    if (activeMode === "pivot" && pivotData) {
      if (pivotRowGroupBy && Array.isArray(pivotData.rows) && pivotData.rows.length) {
        pushValues(
          pivotRowGroupBy,
          pivotData.rows.map((row) => row?.key ?? row?.label ?? ""),
        );
      }
      if (pivotColGroupBy && Array.isArray(pivotData.cols) && pivotData.cols.length) {
        pushValues(
          pivotColGroupBy,
          pivotData.cols.map((col) => col?.key ?? col?.label ?? ""),
        );
      }
    }
    return out;
  }, [fieldIndex, graphGroupBy, graphData, activeMode, pivotData, pivotRowGroupBy, pivotColGroupBy]);

  useEffect(() => {
    let cancelled = false;
    const lookupGroups = groupedFieldValues.filter(({ fieldDef }) => fieldDef?.type === "lookup" && typeof fieldDef?.entity === "string");
    if (!lookupGroups.length) return undefined;
    const pending = [];
    for (const { fieldId, fieldDef, values } of lookupGroups) {
      const targetEntityId = fieldDef.entity.startsWith("entity.") ? fieldDef.entity : `entity.${fieldDef.entity}`;
      const labelField = typeof fieldDef.display_field === "string" ? fieldDef.display_field : null;
      for (const recordId of values) {
        const cacheKey = `${fieldId}:${recordId}`;
        if (Object.prototype.hasOwnProperty.call(groupLookupLabels, cacheKey)) continue;
        pending.push({ cacheKey, targetEntityId, recordId, labelField });
      }
    }
    if (!pending.length) return undefined;
    (async () => {
      const resolved = await fetchLookupLabelEntries(pending, () => "");
      if (!cancelled) setGroupLookupLabels((prev) => ({ ...prev, ...Object.fromEntries(resolved) }));
    })();
    return () => {
      cancelled = true;
    };
  }, [groupedFieldValues, groupLookupLabels]);

  useEffect(() => {
    let cancelled = false;
    const requiresMemberLabels = groupedFieldValues.some(({ fieldDef }) => fieldDef?.type === "user");
    if (!requiresMemberLabels) return undefined;
    (async () => {
      try {
        const res = await apiFetch("/access/members");
        const rows = Array.isArray(res?.members) ? res.members : [];
        const next = {};
        for (const member of rows) {
          const userId = String(member?.user_id || "").trim();
          if (!userId) continue;
          const name = String(member?.name || "").trim();
          const email = String(member?.email || "").trim();
          next[userId] = name || email || "";
        }
        if (!cancelled) setGroupMemberLabels(next);
      } catch {
        if (!cancelled) setGroupMemberLabels({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [groupedFieldValues]);

  const presentedGraphData = useMemo(() => {
    const fieldDef = fieldIndex[graphGroupBy] || null;
    return (Array.isArray(graphData) ? graphData : []).map((item) => {
      const rawKey = item?.key ?? item?.group ?? item?.label ?? "";
      const label = formatGroupedFieldValue(fieldDef, rawKey, groupLookupLabels, groupMemberLabels);
      return { ...item, label };
    });
  }, [fieldIndex, graphGroupBy, graphData, groupLookupLabels, groupMemberLabels]);

  const presentedPivotData = useMemo(() => {
    if (!pivotData) return null;
    const rowFieldDef = fieldIndex[pivotRowGroupBy] || null;
    const colFieldDef = fieldIndex[pivotColGroupBy] || null;
    return {
      ...pivotData,
      rows: Array.isArray(pivotData.rows)
        ? pivotData.rows.map((row) => ({
            ...row,
            label: formatGroupedFieldValue(rowFieldDef, row?.key ?? row?.label ?? "", groupLookupLabels, groupMemberLabels),
          }))
        : [],
      cols: Array.isArray(pivotData.cols)
        ? pivotData.cols.map((col) => ({
            ...col,
            label: formatGroupedFieldValue(colFieldDef, col?.key ?? col?.label ?? "", groupLookupLabels, groupMemberLabels),
          }))
        : [],
    };
  }, [pivotData, fieldIndex, pivotRowGroupBy, pivotColGroupBy, groupLookupLabels, groupMemberLabels]);

  function updateParam(key, value) {
    if (!setSearchParams) return;
    const params = new URLSearchParams(searchParams || "");
    if (value) params.set(key, value);
    else params.delete(key);
    if (key !== "search") params.delete("record");
    setSearchParams(params, { replace: true });
  }

  function handleModeChange(mode) {
    updateParam("mode", mode);
    apiFetch(`/prefs/entity/${encodeURIComponent(entityFullId)}`, {
      method: "PUT",
      body: JSON.stringify({ default_mode: mode }),
    }).catch(() => {});
  }

  function handleSearchChange(value) {
    updateParam("search", value);
  }

  function handleFilterChange(value) {
    updateParam("filter", value);
  }

  function handleGroupByChange(value) {
    if (activeMode === "graph") {
      updateParam("graph_group_by", value);
      return;
    }
    updateParam("group_by", value);
    apiFetch(`/prefs/entity/${encodeURIComponent(entityFullId)}`, {
      method: "PUT",
      body: JSON.stringify({ default_group_by: value || null, default_mode: activeMode }),
    }).catch(() => {});
  }

  function handleGraphTypeChange(value) {
    updateParam("graph_type", value);
  }

  function handleGraphMeasureChange(value) {
    updateParam("graph_measure", value);
  }

  function handlePivotRowChange(value) {
    if (!setSearchParams) return;
    const params = new URLSearchParams(searchParams || "");
    if (value) {
      params.set("pivot_row_group_by", value);
      params.set("group_by", value);
    } else {
      params.delete("pivot_row_group_by");
      params.delete("group_by");
    }
    params.delete("record");
    setSearchParams(params, { replace: true });
  }

  function handlePivotColChange(value) {
    updateParam("pivot_col_group_by", value);
  }

  function handlePivotMeasureChange(value) {
    updateParam("pivot_measure", value);
  }

  function handleSetDefault() {
    if (!filterParam) return;
    const saved = savedFilters.find((f) => f.id === filterParam);
    if (saved) {
      apiFetch(`/filters/${encodeURIComponent(filterParam)}`, {
        method: "PUT",
        body: JSON.stringify({ is_default: true }),
      }).catch(() => {});
      return;
    }
    apiFetch(`/prefs/entity/${encodeURIComponent(entityFullId)}`, {
      method: "PUT",
      body: JSON.stringify({ default_filter_key: filterParam, default_mode: activeMode }),
    }).catch(() => {});
  }

  function applySavedView(view) {
    if (!setSearchParams) return;
    const params = new URLSearchParams(searchParams || "");
    const state = view?.state || {};
    const nextMode = state.mode || activeMode;
    const nextSearch = state.search || "";
    const nextGroupBy = state.group_by || "";
    const nextGraphType = state.graph_type || "";
    const nextGraphMeasure = state.graph_measure || "";
    const nextGraphGroupBy = state.graph_group_by || "";
    const nextPivotRow = state.pivot_row_group_by || "";
    const nextPivotCol = state.pivot_col_group_by || "";
    const nextPivotMeasure = state.pivot_measure || "";
    if (nextMode) params.set("mode", nextMode);
    else params.delete("mode");
    if (nextSearch) params.set("search", nextSearch);
    else params.delete("search");
    if (nextGroupBy) params.set("group_by", nextGroupBy);
    else params.delete("group_by");
    if (nextGraphType) params.set("graph_type", nextGraphType);
    else params.delete("graph_type");
    if (nextGraphMeasure) params.set("graph_measure", nextGraphMeasure);
    else params.delete("graph_measure");
    if (nextGraphGroupBy) params.set("graph_group_by", nextGraphGroupBy);
    else params.delete("graph_group_by");
    if (nextPivotRow) params.set("pivot_row_group_by", nextPivotRow);
    else params.delete("pivot_row_group_by");
    if (nextPivotCol) params.set("pivot_col_group_by", nextPivotCol);
    else params.delete("pivot_col_group_by");
    if (nextPivotMeasure) params.set("pivot_measure", nextPivotMeasure);
    else params.delete("pivot_measure");
    params.set("filter", view.id);
    params.delete("record");
    setSearchParams(params, { replace: true });
  }

  async function handleSaveFilter() {
    if (!onPrompt) return;
    const promptDialog = onPrompt;
    const name = await promptDialog({ title: translateRuntime("common.view_modes.save_view_as_title"), defaultValue: "" });
    if (!name) return;
    const state = {
      mode: activeMode || "",
      search: searchText || "",
      filter: filterParam || "",
      group_by: effectiveGroupByParam || "",
      graph_type: graphType,
      graph_measure: graphMeasure,
      graph_group_by: graphGroupBy,
      pivot_row_group_by: pivotRowGroupBy,
      pivot_col_group_by: pivotColGroupBy,
      pivot_measure: pivotMeasure,
    };
    apiFetch(`/filters/${encodeURIComponent(entityFullId)}`, {
      method: "POST",
      body: JSON.stringify({ name, domain: domain || {}, state }),
    })
      .then(async (res) => {
        const created = normalizeSavedFilterRow(res?.filter);
        if (created?.id) {
          setSavedFilters((prev) => [created, ...prev.filter((item) => item?.id !== created.id)]);
        } else {
          await reloadSavedFilters();
        }
      })
      .catch(() => {});
  }

  function handleDeleteSavedView(viewId) {
    if (!viewId) return;
    apiFetch(`/filters/${encodeURIComponent(viewId)}`, { method: "DELETE" })
      .then(async () => {
        setSavedFilters((prev) => prev.filter((f) => f.id !== viewId));
        await reloadSavedFilters();
      })
      .catch(() => {});
  }

  async function handleBulkDelete() {
    if (!selectedIds.length) return;
    if (!onConfirm) return;
    const confirmDialog = onConfirm;
    const ok = await confirmDialog({
      title: translateRuntime("common.view_modes.delete_records_title"),
      body: translateRuntime("common.view_modes.delete_records_body", { count: selectedIds.length }),
    });
    if (!ok) return;
    const deletingIds = [...selectedIds];
    const deletingSet = new Set(deletingIds);
    setRecords((prev) =>
      (Array.isArray(prev) ? prev : []).filter((row) => !deletingSet.has(row?.record_id || row?.record?.id))
    );
    setSelectedIds([]);
    Promise.all(deletingIds.map((rid) => deleteRecord(entityFullId, rid)))
      .then(() => setRefreshTick((v) => v + 1))
      .catch(() => setRefreshTick((v) => v + 1));
  }

  function resolveActionLabel(action) {
    if (action.label) return action.label;
    if (action.kind === "create_record" || action.kind === "open_form") return translateRuntime("common.new");
    if (action.kind === "update_record") return translateRuntime("common.save");
    if (action.kind === "refresh") return translateRuntime("common.refresh");
    return translateRuntime("common.action");
  }

  function runBulkAction(action) {
    if (!action) return;
    onRunAction?.(action, { selectedIds });
  }

  const bulkActions = useMemo(() => {
    const header = listView?.header || {};
    const actions = Array.isArray(header.bulk_actions) ? header.bulk_actions : [];
    return actions
      .map((a) => {
        if (a.action_id && actionsMap?.has(a.action_id)) return actionsMap.get(a.action_id);
        return a;
      })
      .filter((a) => a && (a.kind || a.action_id));
  }, [listView, actionsMap]);

  const openRecordTarget = listView?.open_record?.to || resolveEntityDefaultFormPage(appDefaults, entityFullId);
  const openRecordParam = listView?.open_record?.param || "record";
  function handleOpenRecord(row) {
    if (!openRecordTarget) return;
    const recordId = row?.record_id || row?.record?.id;
    if (!recordId) return;
    const target = openRecordTarget.startsWith("page:") || openRecordTarget.startsWith("view:") ? openRecordTarget : `page:${openRecordTarget}`;
    onNavigate?.(target, {
      moduleId: block?.target_module_id || moduleId || undefined,
      recordId,
      recordParamName: openRecordParam,
      preserveParams: true,
      returnToCurrent: Boolean(recordContextReturnLabel),
      returnLabel: recordContextReturnLabel || undefined,
    });
  }
  const selectedRows = useMemo(() => {
    if (!Array.isArray(records) || !selectedIds.length) return [];
    const selected = new Set(selectedIds.map((id) => String(id)));
    return records.filter((row) => {
      const rowId = row?.record_id || row?.record?.id;
      return rowId && selected.has(String(rowId));
    });
  }, [records, selectedIds]);
  const visibleExportFields = useMemo(() => {
    const cols = Array.isArray(listView?.columns) ? listView.columns : [];
    return cols.map((col) => col?.field_id).filter(Boolean);
  }, [listView]);
  const allExportFields = useMemo(() => {
    const fields = Array.isArray(entityDef?.fields) ? entityDef.fields : [];
    return fields.map((field) => field?.id).filter(Boolean);
  }, [entityDef]);
  const templateFieldDefs = useMemo(() => {
    const fields = Array.isArray(entityDef?.fields) ? entityDef.fields : [];
    return fields.filter((field) => {
      if (!field?.id) return false;
      if (field.readonly) return false;
      if (field.type === "attachments") return false;
      if (field.type === "uuid") return false;
      return true;
    });
  }, [entityDef]);

  const filterableFields = useMemo(() => {
    if (!entityDef || !Array.isArray(entityDef.fields)) return [];
    return entityDef.fields.filter((f) => f?.id && ["string", "text", "rich_text", "enum", "bool", "date", "datetime", "number", "user"].includes(f.type));
  }, [entityDef]);
  const measureOptions = useMemo(() => {
    const opts = [{ value: "count", label: translateRuntime("common.view_modes.count") }];
    if (!entityDef || !Array.isArray(entityDef.fields)) return opts;
    for (const f of entityDef.fields) {
      if (f?.id && f.type === "number") {
        opts.push({ value: `sum:${f.id}`, label: translateRuntime("common.view_modes.sum_named", { name: f.label || f.id }) });
      }
    }
    return opts;
  }, [entityDef]);
  const createInModal = Boolean(!compact && forceListOnly && block?.create_modal !== false && typeof onLookupCreate === "function");
  const searchEnabled = Boolean(listView?.header?.search?.enabled);
  const showSearch = !compact && searchEnabled;
  const showFilters = !compact && !forceListOnly && (manifestFilterList.length > 0 || filterableFields.length > 0);
  const showSavedViews = !compact && !forceListOnly && Boolean(entityFullId);
  const showGroupBy = !compact && !forceListOnly && (activeMode === "kanban" || activeMode === "graph" || activeMode === "pivot") && filterableFields.length > 0;
  const showGraphMeasure = activeMode === "graph" && measureOptions.length > 0;
  const showPivotMeasure = activeMode === "pivot" && measureOptions.length > 0;
  const hideRecordViewsWhileLoading = (showListMode || showKanbanMode || showCalendarMode) && recordsLoading;
  const preserveMobileKanbanHeight = compactMobile && activeViewKind === "kanban" && showKanbanMode;
  const showCreateButton = canWriteRecords && block?.allow_create !== false && block?.show_create !== false;
  const showMobileToolbarActions = isMobile && (
    showFilters
    || showSavedViews
    || showGroupBy
    || activeMode === "graph"
    || activeMode === "pivot"
    || activeMode === "list"
    || bulkActions.length > 0
    || selectedIds.length > 0
    || templateFieldDefs.length > 0
    || canWriteRecords
  );
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileModeSheetOpen, setMobileModeSheetOpen] = useState(false);
  const [mobileMenuSheet, setMobileMenuSheet] = useState("");
  const mobileToolbarGroupClass = "join items-center overflow-visible";
  const mobileToolbarButtonClass = SOFT_ICON_SM;
  const mobileToolbarButtonActiveClass = "bg-base-300";
  const toolbarStartDropdownClass = isMobile
    ? "dropdown-content left-0 right-auto p-2 shadow bg-base-100 rounded-box w-[calc(100vw-2rem)] max-w-64 z-[200] max-h-72 overflow-y-auto overflow-x-hidden"
    : "dropdown-content p-2 shadow bg-base-100 rounded-box w-64 z-[200] max-h-72 overflow-y-auto overflow-x-hidden";
  const toolbarEndDropdownClass = isMobile
    ? "dropdown-content right-0 left-auto p-2 shadow bg-base-100 rounded-box w-[calc(100vw-2rem)] max-w-64 z-[200] max-h-72 overflow-y-auto overflow-x-hidden"
    : "dropdown-content p-2 shadow bg-base-100 rounded-box w-64 z-[200] max-h-72 overflow-y-auto overflow-x-hidden";
  const settingsMenuClass = isMobile
    ? "absolute right-0 mt-2 menu p-2 shadow bg-base-100 rounded-box w-[calc(100vw-2rem)] max-w-64 z-[210] border border-base-300"
    : "absolute right-0 mt-2 menu p-2 shadow bg-base-100 rounded-box w-64 z-[210] border border-base-300";

  useEffect(() => {
    setMobileSearchOpen(false);
  }, [entityFullId, activeMode, isMobile]);

  useEffect(() => {
    setMobileModeSheetOpen(false);
  }, [activeMode, isMobile]);

  useEffect(() => {
    setMobileMenuSheet("");
  }, [activeMode, entityFullId, isMobile]);

  useEffect(() => {
    if (!mobileModeSheetOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileModeSheetOpen]);

  useEffect(() => {
    if (!settingsMenuOpen || !isMobile) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [settingsMenuOpen, isMobile]);

  useEffect(() => {
    if (!mobileMenuSheet || !isMobile) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileMenuSheet, isMobile]);

  function formatExportValue(fieldDef, rawValue, lookupLabels, memberLabels) {
    if (rawValue === null || rawValue === undefined) return "";
    const type = String(fieldDef?.type || "").toLowerCase();
    if (type === "enum") {
      const option = normalizeEnumOptions(fieldDef?.options).find((item) => String(item.value) === String(rawValue));
      return String(option?.label ?? rawValue);
    }
    if (type === "lookup") {
      const key = `${fieldDef?.id}:${String(rawValue)}`;
      return String(lookupLabels[key] || rawValue);
    }
    if (type === "user") {
      const userId = String(rawValue || "").trim();
      return String(memberLabels[userId] || userId);
    }
    if (type === "users") {
      const values = Array.isArray(rawValue)
        ? rawValue
        : (typeof rawValue === "string"
            ? rawValue.split(",").map((item) => item.trim()).filter(Boolean)
            : []);
      return values.map((userId) => memberLabels[userId] || userId).join(", ");
    }
    if (Array.isArray(rawValue)) return rawValue.join(", ");
    if (typeof rawValue === "object") return JSON.stringify(rawValue);
    return String(rawValue);
  }

  async function buildLookupLabelMap(rows, fieldIds) {
    const lookupFieldDefs = fieldIds
      .map((fieldId) => fieldIndex[fieldId])
      .filter((fieldDef) => fieldDef?.type === "lookup" && typeof fieldDef?.entity === "string");
    if (!lookupFieldDefs.length || !rows.length) return {};
    const pending = [];
    for (const fieldDef of lookupFieldDefs) {
      const targetEntityId = String(fieldDef.entity).startsWith("entity.") ? fieldDef.entity : `entity.${fieldDef.entity}`;
      const labelField = typeof fieldDef.display_field === "string" ? fieldDef.display_field : "";
      const ids = new Set();
      for (const row of rows) {
        const rec = row?.record || {};
        const value = getByPath(rec, fieldDef.id);
        if (value === null || value === undefined || value === "") continue;
        ids.add(String(value));
      }
      for (const recordId of ids) {
        pending.push({ fieldId: fieldDef.id, targetEntityId, labelField, recordId });
      }
    }
    if (!pending.length) return {};
    const resolved = await fetchLookupLabelEntries(
      pending.map((item) => ({ ...item, cacheKey: `${item.fieldId}:${item.recordId}` })),
      (recordId) => safeOpaqueLabel(recordId, ""),
    );
    return Object.fromEntries(resolved);
  }

  async function fetchMemberLabelMap() {
    try {
      const res = await apiFetch("/access/members");
      const rows = Array.isArray(res?.members) ? res.members : [];
      const next = {};
      for (const member of rows) {
        const userId = String(member?.user_id || "").trim();
        if (!userId) continue;
        const name = String(member?.name || "").trim();
        const email = String(member?.email || "").trim();
        next[userId] = name || email || userId;
      }
      return next;
    } catch {
      return {};
    }
  }

  async function handleExportSelectedRows() {
    if (!selectedRows.length || exportBusy) return;
    const fieldIds = exportColumnScope === "all" ? allExportFields : visibleExportFields;
    if (!fieldIds.length) return;
    setExportBusy(true);
    try {
      const lookupLabels = await buildLookupLabelMap(selectedRows, fieldIds);
      const memberLabels = await fetchMemberLabelMap();
      const headers = fieldIds.map((fieldId) => fieldIndex[fieldId]?.label || fieldId);
      const body = selectedRows.map((row) => {
        const rec = row?.record || {};
        return fieldIds.map((fieldId) => {
          const fieldDef = fieldIndex[fieldId] || null;
          const rawValue = getByPath(rec, fieldId);
          return formatExportValue(fieldDef, rawValue, lookupLabels, memberLabels);
        });
      });
      const timestamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
      const entitySlug = suggestEntitySlug(entityFullId);
      if (exportFormat === "excel") {
        const content = makeDelimitedContent(headers, body, "\t");
        downloadTextFile(`${entitySlug}_${timestamp}.xls`, content, "application/vnd.ms-excel;charset=utf-8");
      } else {
        const content = makeDelimitedContent(headers, body, ",");
        downloadTextFile(`${entitySlug}_${timestamp}.csv`, content, "text/csv;charset=utf-8");
      }
      setExportModalOpen(false);
    } finally {
      setExportBusy(false);
    }
  }

  function handleDownloadImportTemplate() {
    if (!templateFieldDefs.length) return;
    const headers = templateFieldDefs.map((field) => field.id);
    const exampleRow = templateFieldDefs.map((field) => {
      const type = String(field?.type || "").toLowerCase();
      if (type === "enum") {
        const first = normalizeEnumOptions(field?.options)[0];
        return first?.value ?? "";
      }
      if (type === "number") return "0";
      if (type === "bool") return "false";
      if (type === "date") return "2026-03-12";
      if (type === "datetime") return "2026-03-12T09:00:00Z";
      if (type === "lookup" || type === "user" || type === "users") return "";
      return "";
    });
    const entitySlug = suggestEntitySlug(entityFullId);
    const content = makeDelimitedContent(headers, [exampleRow], ",");
    downloadTextFile(`${entitySlug}_import_template.csv`, content, "text/csv;charset=utf-8");
  }

  function resetImportState() {
    setImportFileName("");
    setImportParseError("");
    setImportHeaders([]);
    setImportRows([]);
    setImportMappedFields([]);
    setImportUnmappedHeaders([]);
    setImportResult(null);
  }

  function parseScalarByType(rawValue, fieldDef) {
    const text = String(rawValue ?? "").trim();
    if (!text) return undefined;
    const type = String(fieldDef?.type || "").toLowerCase();
    if (type === "number") {
      const num = Number(text);
      return Number.isFinite(num) ? num : text;
    }
    if (type === "bool" || type === "boolean") {
      const low = text.toLowerCase();
      if (["true", "1", "yes", "y"].includes(low)) return true;
      if (["false", "0", "no", "n"].includes(low)) return false;
      return text;
    }
    if (type === "users" || type === "tags") {
      if (text.startsWith("[") && text.endsWith("]")) {
        try {
          const parsed = JSON.parse(text);
          if (Array.isArray(parsed)) return parsed;
        } catch {
          // Fall back to delimiter parsing.
        }
      }
      return text
        .split(/[;,]/g)
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return text;
  }

  async function parseImportFile(file) {
    if (!file) return;
    setImportBusy(false);
    setImportParseError("");
    setImportResult(null);
    setImportFileName(file.name || "");
    try {
      const text = await file.text();
      const parsed = parseCsvText(text);
      if (!parsed.length) {
        setImportParseError(translateRuntime("common.view_modes.csv_empty"));
        setImportHeaders([]);
        setImportRows([]);
        setImportMappedFields([]);
        setImportUnmappedHeaders([]);
        return;
      }
      const headerRow = parsed[0].map((value) => String(value || "").trim());
      if (!headerRow.length) {
        setImportParseError(translateRuntime("common.view_modes.csv_header_missing"));
        return;
      }
      const fieldDefs = Array.isArray(templateFieldDefs) ? templateFieldDefs : [];
      const byId = new Map();
      const byLabel = new Map();
      for (const field of fieldDefs) {
        if (!field?.id) continue;
        byId.set(normalizeFieldLookupKey(field.id), field.id);
        if (field?.label) byLabel.set(normalizeFieldLookupKey(field.label), field.id);
      }
      const mappedFields = [];
      const unmapped = [];
      for (const header of headerRow) {
        const key = normalizeFieldLookupKey(header);
        const mapped = byId.get(key) || byLabel.get(key) || null;
        mappedFields.push(mapped);
        if (!mapped) unmapped.push(header);
      }
      const rows = parsed
        .slice(1)
        .filter((cells) => Array.isArray(cells) && cells.some((cell) => String(cell || "").trim() !== ""));
      setImportHeaders(headerRow);
      setImportRows(rows);
      setImportMappedFields(mappedFields);
      setImportUnmappedHeaders(unmapped);
      if (!rows.length) setImportParseError("CSV has no data rows.");
    } catch (err) {
      setImportParseError(err?.message || translateRuntime("common.view_modes.csv_parse_failed"));
      setImportHeaders([]);
      setImportRows([]);
      setImportMappedFields([]);
      setImportUnmappedHeaders([]);
    }
  }

  async function handleImportCsv() {
    if (!importRows.length || importBusy) return;
    const mappedCount = importMappedFields.filter(Boolean).length;
    if (!mappedCount) {
      setImportParseError(translateRuntime("common.view_modes.no_csv_columns_mapped"));
      return;
    }
    setImportBusy(true);
    setImportParseError("");
    const successes = [];
    const failures = [];
    for (let rowIndex = 0; rowIndex < importRows.length; rowIndex += 1) {
      const cells = importRows[rowIndex] || [];
      const payload = {};
      for (let colIndex = 0; colIndex < importMappedFields.length; colIndex += 1) {
        const fieldId = importMappedFields[colIndex];
        if (!fieldId) continue;
        const rawValue = cells[colIndex];
        const fieldDef = fieldIndex[fieldId];
        const parsedValue = parseScalarByType(rawValue, fieldDef);
        if (parsedValue === undefined) continue;
        payload[fieldId] = parsedValue;
      }
      try {
        const res = await apiFetch(`/records/${entityFullId}`, {
          method: "POST",
          body: JSON.stringify({ record: payload }),
        });
        const recordId = res?.record?.id || res?.record_id || null;
        successes.push({ row: rowIndex + 2, recordId });
      } catch (err) {
        failures.push({
          row: rowIndex + 2,
          error: err?.message || translateRuntime("common.view_modes.import_failed"),
        });
      }
    }
    setImportBusy(false);
    setImportResult({
      total: importRows.length,
      successCount: successes.length,
      failureCount: failures.length,
      failures: failures.slice(0, 20),
    });
    if (successes.length) setRefreshTick((v) => v + 1);
  }

  return (
    <div
      className={
        compactMobile && !preserveMobileKanbanHeight
          ? `flex min-w-0 flex-col ${compact ? "gap-3" : "gap-4"}`
          : `flex flex-col ${compact ? "gap-3" : "gap-4"} h-full min-h-0 overflow-hidden`
      }
    >
      {!compact && (
        <div className={isMobile ? "flex flex-wrap items-center justify-between gap-3 relative z-30 shrink-0" : "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 relative z-30 shrink-0"}>
          <div className="flex items-center gap-2 min-w-0">
          {showCreateButton && (
            <DaisyTooltip label={translateRuntime("common.new_record_named", { name: entityLabel })} placement="bottom">
              <button
                className={PRIMARY_BUTTON_SM}
                onClick={async () => {
                  if (createInModal) {
                    const created = await onLookupCreate({
                      entityId: entityFullId,
                      displayField: entityDef?.display_field,
                      defaults: createDefaults,
                    });
                    if (created?.record_id) setRefreshTick((v) => v + 1);
                    return;
                  }
                  const target = resolveEntityDefaultFormPage(appDefaults, entityFullId);
                  if (target) onNavigate?.(target);
                }}
              >
                <IconPlus />
              </button>
            </DaisyTooltip>
          )}
          <div className="text-lg font-semibold">{entityLabel}</div>
        </div>

        <div className="order-3 sm:order-none flex items-center justify-start sm:justify-center flex-none min-w-0">
          {(!isMobile && (showSearch || showFilters || showGroupBy || showSavedViews)) && (
            <div className={mobileToolbarGroupClass}>
              {showSearch && (
                <>
                  <DaisyTooltip label={translateRuntime("common.search")} className="join-item" placement="bottom">
                    <button
                      className={mobileToolbarButtonClass}
                      type="button"
                      aria-label={translateRuntime("common.search")}
                    >
                      <IconSearch />
                    </button>
                  </DaisyTooltip>
                  <input
                    className="input input-bordered input-sm join-item w-full max-w-xs"
                    placeholder={translateRuntime("common.search")}
                    value={searchText}
                    onChange={(e) => handleSearchChange(e.target.value)}
                  />
                </>
              )}
              {showFilters && (
                <div className="dropdown dropdown-bottom join-item">
                  <DaisyTooltip label={translateRuntime("common.filters")} className="join-item" placement="bottom">
                    <button
                      className={mobileToolbarButtonClass}
                      type="button"
                      aria-label={translateRuntime("common.filters")}
                    >
                      <IconFilter />
                    </button>
                  </DaisyTooltip>
                  <div className={toolbarStartDropdownClass}>
                    <ul className="menu flex flex-col">
                      {manifestFilterList.map((flt) => (
                        <li key={flt.id}>
                          <button onClick={() => handleFilterChange(flt.id)}>{flt.label || flt.id}</button>
                        </li>
                      ))}
                      {filterableFields.length > 0 && <li className="menu-title">{translateRuntime("common.custom")}</li>}
                      {filterableFields.map((field) => (
                        <li key={field.id}>
                          <button
                            onClick={async () => {
                              if (!onPrompt) return;
                              const value = await onPrompt({ title: translateRuntime("common.view_modes.filter_named", { name: field.label || field.id }), defaultValue: "" });
                              if (value === null || value === "") return;
                              setClientFilters((prev) => [
                                ...prev,
                                { field_id: field.id, label: field.label || field.id, op: "contains", value },
                              ]);
                            }}
                          >
                            {field.label || field.id}
                          </button>
                        </li>
                      ))}
                      <li>
                        <button onClick={() => handleFilterChange("")}>{translateRuntime("common.clear")}</button>
                      </li>
                    </ul>
                  </div>
                </div>
              )}
              {showGroupBy && (
                <div className="dropdown dropdown-bottom join-item">
                  <DaisyTooltip label={translateRuntime("common.view_modes.sort_and_group")} className="join-item" placement="bottom">
                    <button
                      className={mobileToolbarButtonClass}
                      type="button"
                      aria-label={translateRuntime("common.view_modes.sort_and_group")}
                    >
                      <IconSort />
                    </button>
                  </DaisyTooltip>
                  <div className={toolbarStartDropdownClass}>
                    <ul className="menu flex flex-col">
                      {filterableFields.map((field) => (
                        <li key={field.id}>
                          <button onClick={() => handleGroupByChange(field.id)}>{field.label || field.id}</button>
                        </li>
                      ))}
                      <li>
                        <button onClick={() => handleGroupByChange("")}>{translateRuntime("common.clear")}</button>
                      </li>
                    </ul>
                  </div>
                </div>
              )}
              {showSavedViews && (
                <div className="dropdown dropdown-bottom join-item">
                  <DaisyTooltip label={translateRuntime("common.view_modes.saved_views")} className="join-item" placement="bottom">
                    <button
                      className={mobileToolbarButtonClass}
                      type="button"
                      aria-label={translateRuntime("common.view_modes.saved_views")}
                    >
                      <IconBookmark />
                    </button>
                  </DaisyTooltip>
                  <div className={toolbarStartDropdownClass}>
                    <ul className="menu flex flex-col">
                      {savedFilters.map((flt) => (
                        <li key={flt.id}>
                          <div className="flex items-center justify-between gap-2">
                            <button className="flex-1 text-left" onClick={() => applySavedView(flt)}>
                              {flt.name}
                            </button>
                            <button
                              className={SOFT_BUTTON_XS}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleDeleteSavedView(flt.id);
                              }}
                              aria-label={translateRuntime("common.remove_named", { name: flt.name })}
                            >
                              ×
                            </button>
                          </div>
                        </li>
                      ))}
                      <li>
                        <button onClick={handleSaveFilter}>{translateRuntime("common.view_modes.save_current_view")}</button>
                      </li>
                      <li>
                        <button onClick={handleSetDefault} disabled={!filterParam}>{translateRuntime("common.view_modes.set_as_default")}</button>
                      </li>
                    </ul>
                  </div>
                </div>
              )}
              <DaisyTooltip label={translateRuntime("common.refresh")} className="join-item" placement="bottom">
                <button className={mobileToolbarButtonClass} type="button" onClick={() => setRefreshTick((v) => v + 1)} aria-label={translateRuntime("common.refresh")}>
                  <IconRefresh />
                </button>
              </DaisyTooltip>
            </div>
          )}
        </div>

        {isMobile && showSearch && mobileSearchOpen && (
          <div className="order-4 w-full shrink-0">
            <input
              className="input input-bordered w-full"
              placeholder={translateRuntime("common.view_modes.search_placeholder")}
              value={searchText}
              onChange={(e) => handleSearchChange(e.target.value)}
              autoFocus
            />
          </div>
        )}

        <div className={isMobile ? "flex w-full items-center gap-2 min-w-0" : "order-none sm:order-3 flex items-center justify-end gap-2 min-w-0 flex-nowrap overflow-visible"}>
          <div className={isMobile ? "flex items-center gap-2 min-w-0 flex-1 flex-nowrap overflow-x-auto overflow-y-visible no-scrollbar" : "contents"}>
            {isMobile && showSearch && (
              <DaisyTooltip label={translateRuntime("common.search")} placement="top">
                <button
                  className={`${mobileToolbarButtonClass} shrink-0`}
                  type="button"
                  aria-label={translateRuntime("common.search")}
                  onClick={() => setMobileSearchOpen((open) => !open)}
                >
                  <IconSearch />
                </button>
              </DaisyTooltip>
            )}
            {isMobile && (
              <DaisyTooltip label={translateRuntime("common.refresh")} placement="top">
                <button
                  className={`${mobileToolbarButtonClass} shrink-0`}
                  type="button"
                  onClick={() => setRefreshTick((v) => v + 1)}
                  aria-label={translateRuntime("common.refresh")}
                >
                  <IconRefresh />
                </button>
              </DaisyTooltip>
            )}
            {(!isMobile || showMobileToolbarActions) && (
              <div className="relative shrink-0" ref={settingsMenuRef}>
                <button
                  className={mobileToolbarButtonClass}
                  type="button"
                  aria-label={isMobile ? translateRuntime("common.more_actions") : translateRuntime("common.view_modes.import_export_settings")}
                  onClick={() => setSettingsMenuOpen((open) => !open)}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {settingsMenuOpen && !isMobile && (
                  <ul className={settingsMenuClass}>
                    {selectedIds.length > 0 && activeMode === "list" && (
                      <>
                        <li className="menu-title">{translateRuntime("settings.selection")}</li>
                        <li>
                          <button
                            onClick={() => {
                              handleBulkDelete();
                              setSettingsMenuOpen(false);
                            }}
                          >
                            {translateRuntime("common.view_modes.delete_selected")}
                          </button>
                        </li>
                        <li>
                          <button
                            onClick={() => {
                              setExportModalOpen(true);
                              setSettingsMenuOpen(false);
                            }}
                          >
                            {translateRuntime("common.view_modes.export_selected")}
                          </button>
                        </li>
                        {bulkActions.map((action) => (
                          <li key={action.id || action.label}>
                            <button
                              onClick={() => {
                                runBulkAction(action);
                                setSettingsMenuOpen(false);
                              }}
                            >
                              {resolveActionLabel(action)}
                            </button>
                          </li>
                        ))}
                      </>
                    )}
                    {(selectedIds.length > 0 && activeMode === "list") && <li className="menu-title">{translateRuntime("common.view_modes.import_export")}</li>}
                    <li>
                      <button
                        onClick={() => {
                          handleDownloadImportTemplate();
                          setSettingsMenuOpen(false);
                        }}
                        disabled={!templateFieldDefs.length}
                      >
                        <Download className="h-4 w-4" />
                        {translateRuntime("common.view_modes.download_import_template")}
                      </button>
                    </li>
                    <li>
                      <button
                        onClick={() => {
                          resetImportState();
                          setImportModalOpen(true);
                          setSettingsMenuOpen(false);
                        }}
                        disabled={!canWriteRecords}
                      >
                        <Upload className="h-4 w-4" />
                        {translateRuntime("common.view_modes.import_csv")}
                      </button>
                    </li>
                  </ul>
                )}
              </div>
            )}
            {activeMode === "graph" && (
              <div className={`${mobileToolbarGroupClass} shrink-0`}>
              <DaisyTooltip label={translateRuntime("common.view_modes.bar_chart")} className="join-item" placement="top">
                <button
                  className={`${mobileToolbarButtonClass} ${graphType === "bar" ? mobileToolbarButtonActiveClass : ""}`}
                  onClick={() => handleGraphTypeChange("bar")}
                >
                  <IconGraph />
                </button>
              </DaisyTooltip>
              <DaisyTooltip label={translateRuntime("common.view_modes.line_chart")} className="join-item" placement="top">
                <button
                  className={`${mobileToolbarButtonClass} ${graphType === "line" ? mobileToolbarButtonActiveClass : ""}`}
                  onClick={() => handleGraphTypeChange("line")}
                >
                  <IconLine />
                </button>
              </DaisyTooltip>
              <DaisyTooltip label={translateRuntime("common.view_modes.pie_chart")} className="join-item" placement="top">
                <button
                  className={`${mobileToolbarButtonClass} ${graphType === "pie" ? mobileToolbarButtonActiveClass : ""}`}
                  onClick={() => handleGraphTypeChange("pie")}
                >
                  <IconPie />
                </button>
              </DaisyTooltip>
              {showGraphMeasure && (
                <div className="dropdown dropdown-end dropdown-bottom join-item">
                  <DaisyTooltip label={translateRuntime("common.view_modes.measure")} className="join-item" placement="top">
                    <button
                      className={mobileToolbarButtonClass}
                      type="button"
                      tabIndex={0}
                      onClick={() => {
                        if (isMobile) setMobileMenuSheet("graph_measure");
                      }}
                    >
                      <IconMeasure />
                    </button>
                  </DaisyTooltip>
                  {!isMobile && <div className={toolbarEndDropdownClass}>
                    <ul className="menu flex flex-col">
                      {measureOptions.map((opt) => (
                        <li key={opt.value}>
                          <button onClick={() => handleGraphMeasureChange(opt.value)}>{opt.label}</button>
                        </li>
                      ))}
                    </ul>
                  </div>}
                </div>
              )}
              </div>
            )}
            {activeMode === "pivot" && (
              <div className={`${mobileToolbarGroupClass} shrink-0`}>
              <div className="dropdown dropdown-end dropdown-bottom join-item">
                <DaisyTooltip label={translateRuntime("common.view_modes.rows")} className="join-item" placement="top">
                  <button
                    className={mobileToolbarButtonClass}
                    type="button"
                    tabIndex={0}
                    onClick={() => {
                      if (isMobile) setMobileMenuSheet("pivot_rows");
                    }}
                  >
                    <IconGroup />
                  </button>
                </DaisyTooltip>
                {!isMobile && <div className={toolbarEndDropdownClass}>
                  <ul className="menu flex flex-col">
                    {filterableFields.map((field) => (
                      <li key={field.id}>
                        <button onClick={() => handlePivotRowChange(field.id)}>{field.label || field.id}</button>
                      </li>
                    ))}
                  </ul>
                </div>}
              </div>
              <div className="dropdown dropdown-end dropdown-bottom join-item">
                <DaisyTooltip label={translateRuntime("common.view_modes.columns")} className="join-item" placement="top">
                  <button
                    className={mobileToolbarButtonClass}
                    type="button"
                    tabIndex={0}
                    onClick={() => {
                      if (isMobile) setMobileMenuSheet("pivot_cols");
                    }}
                  >
                    <IconColumns />
                  </button>
                </DaisyTooltip>
                {!isMobile && <div className={toolbarEndDropdownClass}>
                  <ul className="menu flex flex-col">
                    {filterableFields.map((field) => (
                      <li key={field.id}>
                        <button onClick={() => handlePivotColChange(field.id)}>{field.label || field.id}</button>
                      </li>
                    ))}
                    <li>
                      <button onClick={() => handlePivotColChange("")}>{translateRuntime("common.clear")}</button>
                    </li>
                  </ul>
                </div>}
              </div>
              {showPivotMeasure && (
                <div className="dropdown dropdown-end dropdown-bottom join-item">
                  <DaisyTooltip label={translateRuntime("common.view_modes.measure")} className="join-item" placement="top">
                    <button
                      className={mobileToolbarButtonClass}
                      type="button"
                      tabIndex={0}
                      onClick={() => {
                        if (isMobile) setMobileMenuSheet("pivot_measure");
                      }}
                    >
                      <IconMeasure />
                    </button>
                  </DaisyTooltip>
                  {!isMobile && <div className={toolbarEndDropdownClass}>
                    <ul className="menu flex flex-col">
                      {measureOptions.map((opt) => (
                        <li key={opt.value}>
                          <button onClick={() => handlePivotMeasureChange(opt.value)}>{opt.label}</button>
                        </li>
                      ))}
                    </ul>
                  </div>}
                </div>
              )}
              </div>
            )}
            {!forceListOnly && (
              isMobile ? (
                <DaisyTooltip label={translateRuntime("common.view_modes.view_mode")} placement="top">
                  <button
                    className={`${mobileToolbarButtonClass} shrink-0`}
                    type="button"
                    onClick={() => setMobileModeSheetOpen(true)}
                    aria-label={translateRuntime("common.view_modes.view_mode")}
                  >
                    {activeMode === "list"
                      ? <IconList />
                      : activeMode === "kanban"
                        ? <IconKanban />
                        : activeMode === "graph"
                          ? <IconGraph />
                          : activeMode === "calendar"
                            ? <IconCalendar />
                            : <IconPivot />}
                  </button>
                </DaisyTooltip>
              ) : (
                <div className="join shrink-0">
                  {modeButtons.map((m) => {
                    const active = m.mode === activeMode;
                    const icon = m.mode === "list"
                      ? <IconList />
                      : m.mode === "kanban"
                        ? <IconKanban />
                        : m.mode === "graph"
                          ? <IconGraph />
                          : m.mode === "calendar"
                            ? <IconCalendar />
                            : <IconPivot />;
                    const modeTip = viewModeLabel(m.mode);
                    return (
                      <DaisyTooltip key={m.mode} label={modeTip} className="join-item" placement="top">
                        <button
                          className={`${SOFT_ICON_SM} ${active ? "bg-base-300" : ""}`}
                          onClick={() => !m.disabled && handleModeChange(m.mode)}
                          disabled={m.disabled}
                          type="button"
                          aria-label={m.mode}
                        >
                          {icon}
                        </button>
                      </DaisyTooltip>
                    );
                  })}
                </div>
              )
            )}
          </div>
          {activeMode === "list" && (
            <div className={isMobile ? "ml-auto shrink-0" : "shrink-0"}>
              <PaginationControls
                page={listPage}
                pageSize={listPageSize}
                totalItems={listTotalItems}
                onPageChange={setListPage}
              />
            </div>
          )}
        </div>
        </div>
      )}

      {clientFilters.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {clientFilters.map((flt, idx) => (
            <div key={`${flt.field_id}-${idx}`} className="badge badge-outline badge-sm badge-dismissible">
              {flt.label || flt.field_id}: {String(flt.value)}
              <button
                className="badge-remove"
                onClick={() => setClientFilters((prev) => prev.filter((_, i) => i !== idx))}
                aria-label={translateRuntime("common.remove_named", { name: flt.label || flt.field_id })}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div
        className={
          compactMobile
            ? "relative z-0 min-w-0 overflow-visible"
            : `flex-1 min-h-0 relative z-0 ${activeMode === "calendar" ? "overflow-hidden" : "overflow-auto"}`
        }
      >
        {activeView && activeViewKind === "list" && showListMode && (
          <div className={compactMobile ? "min-w-0" : "h-full min-h-0"}>
            <div className={hideRecordViewsWhileLoading ? (compactMobile ? "min-w-0 opacity-0 pointer-events-none" : "h-full min-h-0 opacity-0 pointer-events-none") : (compactMobile ? "min-w-0" : "h-full min-h-0")}>
              <ListViewRenderer
                view={activeView}
                fieldIndex={fieldIndex}
                records={records}
                enableSelection={!compact}
                header={activeView.header}
                hideHeader={true}
                searchQuery={searchText}
                searchFields={searchFields}
                filters={manifestFilters}
                activeFilter={activeFilter && activeFilter.source === "manifest" ? activeFilter : null}
                clientFilters={clientFilters}
                page={listPage}
                pageSize={listPageSize}
                onPageChange={setListPage}
                onTotalItemsChange={setListTotalItems}
                showPaginationControls={false}
                selectedIds={selectedIds}
                onToggleSelect={(recordId, checked) => {
                  setSelectedIds((prev) => {
                    const next = new Set(prev);
                    if (checked) next.add(recordId);
                    else next.delete(recordId);
                    return Array.from(next);
                  });
                }}
                onToggleAll={(checked, ids) => {
                  if (!checked) {
                    setSelectedIds([]);
                    return;
                  }
                  const allIds = Array.isArray(ids) ? ids : records.map((r) => r.record_id || r.record?.id).filter(Boolean);
                  setSelectedIds(allIds);
                }}
                onSelectRow={handleOpenRecord}
              />
            </div>
          </div>
        )}

        {activeView && activeViewKind === "kanban" && showKanbanMode && (
          <div className="h-full min-h-0">
            <div className={hideRecordViewsWhileLoading ? "h-full min-h-0 opacity-0 pointer-events-none" : "h-full min-h-0"}>
              <KanbanView
                view={activeView}
                entityDef={entityDef}
                records={records}
                groupBy={effectiveGroupByParam}
                canDragCards={kanbanCanDrag}
                onMoveCard={handleKanbanMove}
                onSelectRow={handleOpenRecord}
              />
            </div>
          </div>
        )}

        {activeView && activeViewKind === "calendar" && showCalendarMode && (
          <div className="h-full min-h-0 overflow-hidden">
            <div className={hideRecordViewsWhileLoading ? "h-full min-h-0 opacity-0 pointer-events-none" : "h-full min-h-0 overflow-hidden"}>
              <CalendarView
                view={activeView}
                records={records}
                entityDef={entityDef}
                onSelectRow={handleOpenRecord}
              />
            </div>
          </div>
        )}

        {showGraphMode && (
          <div className="h-full min-h-0">
            <GraphView data={presentedGraphData} type={graphType} />
          </div>
        )}

        {activeMode === "pivot" && (
          <div className="h-full min-h-0">
            <PivotView data={presentedPivotData} measure={pivotMeasure} />
          </div>
        )}
      </div>

      {exportModalOpen && (
        <div className="modal modal-open">
          <div className="modal-box max-w-lg">
            <h3 className="font-semibold text-lg">{translateRuntime("common.view_modes.export_selected_records")}</h3>
            <div className="text-sm opacity-70 mt-1">
              {translateRuntime("common.view_modes.rows_selected_in", { count: selectedRows.length, name: entityLabel })}
            </div>
            <div className="mt-4 space-y-4">
              <div>
                <div className="text-xs opacity-60 mb-2">{translateRuntime("common.view_modes.format")}</div>
                <div className="join">
                  <button
                    type="button"
                    className={`${SOFT_BUTTON_SM} join-item ${exportFormat === "csv" ? "bg-base-300" : ""}`}
                    onClick={() => setExportFormat("csv")}
                  >
                    CSV
                  </button>
                  <button
                    type="button"
                    className={`${SOFT_BUTTON_SM} join-item ${exportFormat === "excel" ? "bg-base-300" : ""}`}
                    onClick={() => setExportFormat("excel")}
                  >
                    Excel (.xls)
                  </button>
                </div>
              </div>
              <div>
                <div className="text-xs opacity-60 mb-2">{translateRuntime("common.view_modes.columns")}</div>
                <div className="join">
                  <button
                    type="button"
                    className={`${SOFT_BUTTON_SM} join-item ${exportColumnScope === "visible" ? "bg-base-300" : ""}`}
                    onClick={() => setExportColumnScope("visible")}
                  >
                    {translateRuntime("common.view_modes.visible_count", { count: visibleExportFields.length })}
                  </button>
                  <button
                    type="button"
                    className={`${SOFT_BUTTON_SM} join-item ${exportColumnScope === "all" ? "bg-base-300" : ""}`}
                    onClick={() => setExportColumnScope("all")}
                  >
                    {translateRuntime("common.view_modes.all_count", { count: allExportFields.length })}
                  </button>
                </div>
              </div>
            </div>
            <div className="modal-action">
              <button className="btn" onClick={() => setExportModalOpen(false)} disabled={exportBusy}>
                {translateRuntime("common.cancel")}
              </button>
              <button
                className="btn btn-primary"
                onClick={handleExportSelectedRows}
                disabled={exportBusy || selectedRows.length === 0}
              >
                {exportBusy ? translateRuntime("common.view_modes.preparing") : translateRuntime("common.view_modes.download")}
              </button>
            </div>
          </div>
          <button className="modal-backdrop" type="button" onClick={() => !exportBusy && setExportModalOpen(false)}>
            {translateRuntime("common.close")}
          </button>
        </div>
      )}

      {importModalOpen && (
        <div className="modal modal-open">
          <div className="modal-box max-w-2xl">
            <h3 className="font-semibold text-lg">{translateRuntime("common.view_modes.import_csv")}</h3>
            <p className="text-sm opacity-70 mt-1">
              {translateRuntime("common.view_modes.import_records_into", { name: entityLabel })}
            </p>
            <div className="mt-4 space-y-4">
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="file-input file-input-bordered file-input-sm w-full"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    parseImportFile(file || null);
                  }}
                  disabled={importBusy}
                />
              </div>
              {importFileName && (
                <div className="text-xs opacity-70">{translateRuntime("common.view_modes.file_name", { name: importFileName })}</div>
              )}
              {importHeaders.length > 0 && (
                <div className="rounded-md border border-base-300 p-3 text-sm space-y-1">
                  <div>{translateRuntime("common.view_modes.columns_count", { count: importHeaders.length })}</div>
                  <div>{translateRuntime("common.view_modes.mapped_fields_count", { count: importMappedFields.filter(Boolean).length })}</div>
                  <div>{translateRuntime("common.view_modes.rows_detected", { count: importRows.length })}</div>
                  {importUnmappedHeaders.length > 0 && (
                    <div className="text-warning">
                      {translateRuntime("common.view_modes.unmapped_columns", { names: importUnmappedHeaders.join(", ") })}
                    </div>
                  )}
                </div>
              )}
              {importParseError && (
                <div className="alert alert-error py-2 text-sm">{importParseError}</div>
              )}
              {importResult && (
                <div className="rounded-md border border-base-300 p-3 text-sm space-y-1">
                  <div>{translateRuntime("common.view_modes.total_rows_processed", { count: importResult.total })}</div>
                  <div className="text-success">{translateRuntime("common.view_modes.imported_count", { count: importResult.successCount })}</div>
                  <div className={importResult.failureCount > 0 ? "text-error" : ""}>
                    {translateRuntime("common.view_modes.failed_count", { count: importResult.failureCount })}
                  </div>
                  {Array.isArray(importResult.failures) && importResult.failures.length > 0 && (
                    <div className="mt-2 max-h-40 overflow-auto text-xs space-y-1">
                      {importResult.failures.map((item) => (
                        <div key={`${item.row}-${item.error}`} className="opacity-80">
                          {translateRuntime("common.view_modes.row_error", { row: item.row, error: item.error })}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="modal-action">
              <button className="btn" onClick={() => setImportModalOpen(false)} disabled={importBusy}>
                {translateRuntime("common.close")}
              </button>
              <button
                className="btn btn-primary"
                onClick={handleImportCsv}
                disabled={importBusy || importRows.length === 0 || importMappedFields.filter(Boolean).length === 0}
              >
                {importBusy ? translateRuntime("common.view_modes.importing") : translateRuntime("common.view_modes.import_count", { count: importRows.length || 0 })}
              </button>
            </div>
          </div>
          <button className="modal-backdrop" type="button" onClick={() => !importBusy && setImportModalOpen(false)}>
            {translateRuntime("common.close")}
          </button>
        </div>
      )}

      {isMobile && settingsMenuOpen && (
        <div className="fixed inset-0 z-[220]">
          <button
            type="button"
            className="absolute inset-0 bg-base-content/35"
            aria-label={translateRuntime("common.view_modes.close_actions")}
            onClick={() => setSettingsMenuOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-base-100 border-t border-base-300 shadow-2xl p-4">
            <div className="mx-auto mb-4 h-1.5 w-24 rounded-full bg-base-300" />
            <div className="space-y-2">
              {(showFilters || showGroupBy || showSavedViews) && (
                <div className="border-b border-base-300 pb-2 mb-2">
                  <div className="px-2 pb-2 text-sm font-semibold">{translateRuntime("common.view_modes.view_options")}</div>
                  {showFilters && (
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 rounded-2xl px-4 py-4 text-left text-base hover:bg-base-200"
                      onClick={() => {
                        setSettingsMenuOpen(false);
                        setMobileMenuSheet("filters");
                      }}
                    >
                      <Filter className="h-5 w-5" />
                      <span className="font-medium">{translateRuntime("common.filters")}</span>
                    </button>
                  )}
                  {showGroupBy && (
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 rounded-2xl px-4 py-4 text-left text-base hover:bg-base-200"
                      onClick={() => {
                        setSettingsMenuOpen(false);
                        setMobileMenuSheet("group_by");
                      }}
                    >
                      <ArrowUpDown className="h-5 w-5" />
                      <span className="font-medium">{translateRuntime("common.view_modes.sort_and_group")}</span>
                    </button>
                  )}
                  {showSavedViews && (
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 rounded-2xl px-4 py-4 text-left text-base hover:bg-base-200"
                      onClick={() => {
                        setSettingsMenuOpen(false);
                        setMobileMenuSheet("saved_views");
                      }}
                    >
                      <Bookmark className="h-5 w-5" />
                      <span className="font-medium">{translateRuntime("settings.saved_views")}</span>
                    </button>
                  )}
                </div>
              )}
              {activeMode === "graph" && (
                <div className="border-b border-base-300 pb-2 mb-2">
                  <div className="px-2 pb-2 text-sm font-semibold">{translateRuntime("common.view_modes.graph")}</div>
                  <div className="grid grid-cols-3 gap-2 px-2 pb-2">
                    <button
                      type="button"
                      className={`rounded-2xl border px-3 py-3 text-sm ${graphType === "bar" ? "border-primary bg-primary/5 text-primary" : "border-base-300"}`}
                      onClick={() => handleGraphTypeChange("bar")}
                    >
                      {translateRuntime("common.view_modes.bar")}
                    </button>
                    <button
                      type="button"
                      className={`rounded-2xl border px-3 py-3 text-sm ${graphType === "line" ? "border-primary bg-primary/5 text-primary" : "border-base-300"}`}
                      onClick={() => handleGraphTypeChange("line")}
                    >
                      {translateRuntime("common.view_modes.line")}
                    </button>
                    <button
                      type="button"
                      className={`rounded-2xl border px-3 py-3 text-sm ${graphType === "pie" ? "border-primary bg-primary/5 text-primary" : "border-base-300"}`}
                      onClick={() => handleGraphTypeChange("pie")}
                    >
                      {translateRuntime("common.view_modes.pie")}
                    </button>
                  </div>
                  {showGraphMeasure && (
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 rounded-2xl px-4 py-4 text-left text-base hover:bg-base-200"
                      onClick={() => {
                        setSettingsMenuOpen(false);
                        setMobileMenuSheet("graph_measure");
                      }}
                    >
                      <Ruler className="h-5 w-5" />
                      <span className="font-medium">{translateRuntime("common.view_modes.measure")}</span>
                    </button>
                  )}
                </div>
              )}
              {activeMode === "pivot" && (
                <div className="border-b border-base-300 pb-2 mb-2">
                  <div className="px-2 pb-2 text-sm font-semibold">{translateRuntime("common.view_modes.pivot")}</div>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-2xl px-4 py-4 text-left text-base hover:bg-base-200"
                    onClick={() => {
                      setSettingsMenuOpen(false);
                      setMobileMenuSheet("pivot_rows");
                    }}
                  >
                    <ListFilter className="h-5 w-5" />
                    <span className="font-medium">{translateRuntime("common.view_modes.rows")}</span>
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-2xl px-4 py-4 text-left text-base hover:bg-base-200"
                    onClick={() => {
                      setSettingsMenuOpen(false);
                      setMobileMenuSheet("pivot_cols");
                    }}
                  >
                    <Columns2 className="h-5 w-5" />
                    <span className="font-medium">{translateRuntime("common.view_modes.columns")}</span>
                  </button>
                  {showPivotMeasure && (
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 rounded-2xl px-4 py-4 text-left text-base hover:bg-base-200"
                      onClick={() => {
                        setSettingsMenuOpen(false);
                        setMobileMenuSheet("pivot_measure");
                      }}
                    >
                      <Ruler className="h-5 w-5" />
                      <span className="font-medium">{translateRuntime("common.view_modes.measure")}</span>
                    </button>
                  )}
                </div>
              )}
              {bulkActions.length > 0 && selectedIds.length > 0 && (
                <div className="border-b border-base-300 pb-2 mb-2">
                  <div className="px-2 pb-2 text-sm font-semibold">{translateRuntime("settings.selection")}</div>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-2xl px-4 py-4 text-left text-base hover:bg-base-200"
                    onClick={() => {
                      handleBulkDelete();
                      setSettingsMenuOpen(false);
                    }}
                  >
                    <span className="font-medium">{translateRuntime("common.view_modes.delete_selected")}</span>
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-2xl px-4 py-4 text-left text-base hover:bg-base-200"
                    onClick={() => {
                      setSettingsMenuOpen(false);
                      setMobileMenuSheet("bulk_actions");
                    }}
                  >
                    <span className="font-medium">{translateRuntime("common.bulk_actions")}</span>
                  </button>
                </div>
              )}
              {activeMode === "list" && selectedIds.length > 0 && bulkActions.length === 0 && (
                <div className="border-b border-base-300 pb-2 mb-2">
                  <div className="px-2 pb-2 text-sm font-semibold">{translateRuntime("settings.selection")}</div>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-2xl px-4 py-4 text-left text-base hover:bg-base-200"
                    onClick={() => {
                      handleBulkDelete();
                      setSettingsMenuOpen(false);
                    }}
                  >
                    <span className="font-medium">{translateRuntime("common.view_modes.delete_selected")}</span>
                  </button>
                </div>
              )}
              {activeMode === "list" && selectedIds.length > 0 && (
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-2xl px-4 py-4 text-left text-base hover:bg-base-200"
                  onClick={() => {
                    setExportModalOpen(true);
                    setSettingsMenuOpen(false);
                  }}
                >
                  <Download className="h-5 w-5" />
                  <span className="font-medium">{translateRuntime("common.view_modes.export_selected")}</span>
                </button>
              )}
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-2xl px-4 py-4 text-left text-base hover:bg-base-200 disabled:opacity-50"
                onClick={() => {
                  handleDownloadImportTemplate();
                  setSettingsMenuOpen(false);
                }}
                disabled={!templateFieldDefs.length}
              >
                <Download className="h-5 w-5" />
                <span className="font-medium">{translateRuntime("common.view_modes.download_import_template")}</span>
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-2xl px-4 py-4 text-left text-base hover:bg-base-200 disabled:opacity-50"
                onClick={() => {
                  resetImportState();
                  setImportModalOpen(true);
                  setSettingsMenuOpen(false);
                }}
                disabled={!canWriteRecords}
              >
                <Upload className="h-5 w-5" />
                <span className="font-medium">{translateRuntime("common.view_modes.import_csv")}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {isMobile && mobileMenuSheet && (
        <div className="fixed inset-0 z-[220]">
          <button
            type="button"
            className="absolute inset-0 bg-base-content/35"
            aria-label={translateRuntime("common.view_modes.close_menu")}
            onClick={() => setMobileMenuSheet("")}
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-base-100 border-t border-base-300 shadow-2xl p-4">
            <div className="mx-auto mb-4 h-1.5 w-24 rounded-full bg-base-300" />
            <div className="max-h-[60vh] overflow-auto">
              {mobileMenuSheet === "filters" && (
                <div className="space-y-2">
                  <div className="px-2 pb-2 text-sm font-semibold">{translateRuntime("common.filters")}</div>
                  {manifestFilterList.map((flt) => (
                    <button
                      key={flt.id}
                      type="button"
                      className="flex w-full items-center rounded-2xl px-4 py-4 text-left text-base hover:bg-base-200"
                      onClick={() => {
                        handleFilterChange(flt.id);
                        setMobileMenuSheet("");
                      }}
                    >
                      {flt.label || flt.id}
                    </button>
                  ))}
                  {filterableFields.length > 0 && (
                    <div className="px-2 pt-2 text-xs font-semibold uppercase tracking-wide opacity-50">{translateRuntime("common.custom")}</div>
                  )}
                  {filterableFields.map((field) => (
                    <button
                      key={field.id}
                      type="button"
                      className="flex w-full items-center rounded-2xl px-4 py-4 text-left text-base hover:bg-base-200"
                      onClick={async () => {
                        if (!onPrompt) return;
                        const value = await onPrompt({ title: `${translateRuntime("common.filter")} ${field.label}`, defaultValue: "" });
                        if (value === null || value === "") return;
                        setClientFilters((prev) => [
                          ...prev,
                          { field_id: field.id, label: field.label || field.id, op: "contains", value },
                        ]);
                        setMobileMenuSheet("");
                      }}
                    >
                      {field.label || field.id}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="flex w-full items-center rounded-2xl px-4 py-4 text-left text-base hover:bg-base-200"
                    onClick={() => {
                      handleFilterChange("");
                      setMobileMenuSheet("");
                    }}
                  >
                    {translateRuntime("common.clear")}
                  </button>
                </div>
              )}
              {mobileMenuSheet === "group_by" && (
                <div className="space-y-2">
                  <div className="px-2 pb-2 text-sm font-semibold">{translateRuntime("common.view_modes.sort_and_group")}</div>
                  {filterableFields.map((field) => (
                    <button
                      key={field.id}
                      type="button"
                      className="flex w-full items-center rounded-2xl px-4 py-4 text-left text-base hover:bg-base-200"
                      onClick={() => {
                        handleGroupByChange(field.id);
                        setMobileMenuSheet("");
                      }}
                    >
                      {field.label || field.id}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="flex w-full items-center rounded-2xl px-4 py-4 text-left text-base hover:bg-base-200"
                    onClick={() => {
                      handleGroupByChange("");
                      setMobileMenuSheet("");
                    }}
                  >
                    {translateRuntime("common.clear")}
                  </button>
                </div>
              )}
              {mobileMenuSheet === "saved_views" && (
                <div className="space-y-2">
                  <div className="px-2 pb-2 text-sm font-semibold">{translateRuntime("settings.saved_views")}</div>
                  {savedFilters.map((flt) => (
                    <div key={flt.id} className="flex items-center gap-2 rounded-2xl px-2 py-1 hover:bg-base-200">
                      <button
                        type="button"
                        className="flex-1 rounded-xl px-2 py-3 text-left text-base"
                        onClick={() => {
                          applySavedView(flt);
                          setMobileMenuSheet("");
                        }}
                      >
                        {flt.name}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm btn-square"
                        aria-label={`${translateRuntime("common.delete")} ${flt.name}`}
                        onClick={() => handleDeleteSavedView(flt.id)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="flex w-full items-center rounded-2xl px-4 py-4 text-left text-base hover:bg-base-200 disabled:opacity-50"
                    onClick={async () => {
                      await handleSaveFilter();
                      setMobileMenuSheet("");
                    }}
                  >
                    {translateRuntime("settings.save_current_view")}
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center rounded-2xl px-4 py-4 text-left text-base hover:bg-base-200 disabled:opacity-50"
                    onClick={() => {
                      handleSetDefault();
                      setMobileMenuSheet("");
                    }}
                    disabled={!filterParam}
                  >
                    {translateRuntime("settings.default_view")}
                  </button>
                </div>
              )}
              {mobileMenuSheet === "graph_measure" && (
                <div className="space-y-2">
                  <div className="px-2 pb-2 text-sm font-semibold">{translateRuntime("common.view_modes.measure")}</div>
                  {measureOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className="flex w-full items-center rounded-2xl px-4 py-4 text-left text-base hover:bg-base-200"
                      onClick={() => {
                        handleGraphMeasureChange(opt.value);
                        setMobileMenuSheet("");
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
              {mobileMenuSheet === "pivot_rows" && (
                <div className="space-y-2">
                  <div className="px-2 pb-2 text-sm font-semibold">{translateRuntime("common.view_modes.pivot_rows")}</div>
                  {filterableFields.map((field) => (
                    <button
                      key={field.id}
                      type="button"
                      className="flex w-full items-center rounded-2xl px-4 py-4 text-left text-base hover:bg-base-200"
                      onClick={() => {
                        handlePivotRowChange(field.id);
                        setMobileMenuSheet("");
                      }}
                    >
                      {field.label || field.id}
                    </button>
                  ))}
                </div>
              )}
              {mobileMenuSheet === "pivot_cols" && (
                <div className="space-y-2">
                  <div className="px-2 pb-2 text-sm font-semibold">{translateRuntime("common.view_modes.pivot_columns")}</div>
                  {filterableFields.map((field) => (
                    <button
                      key={field.id}
                      type="button"
                      className="flex w-full items-center rounded-2xl px-4 py-4 text-left text-base hover:bg-base-200"
                      onClick={() => {
                        handlePivotColChange(field.id);
                        setMobileMenuSheet("");
                      }}
                    >
                      {field.label || field.id}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="flex w-full items-center rounded-2xl px-4 py-4 text-left text-base hover:bg-base-200"
                    onClick={() => {
                      handlePivotColChange("");
                      setMobileMenuSheet("");
                    }}
                  >
                    {translateRuntime("common.clear")}
                  </button>
                </div>
              )}
              {mobileMenuSheet === "pivot_measure" && (
                <div className="space-y-2">
                  <div className="px-2 pb-2 text-sm font-semibold">{translateRuntime("common.view_modes.pivot_measure")}</div>
                  {measureOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className="flex w-full items-center rounded-2xl px-4 py-4 text-left text-base hover:bg-base-200"
                      onClick={() => {
                        handlePivotMeasureChange(opt.value);
                        setMobileMenuSheet("");
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
              {mobileMenuSheet === "bulk_actions" && (
                <div className="space-y-2">
                  <div className="px-2 pb-2 text-sm font-semibold">{translateRuntime("common.bulk_actions")}</div>
                  {bulkActions.map((action) => (
                    <button
                      key={action.id || action.label}
                      type="button"
                      className="flex w-full items-center rounded-2xl px-4 py-4 text-left text-base hover:bg-base-200"
                      onClick={() => {
                        runBulkAction(action);
                        setMobileMenuSheet("");
                      }}
                    >
                      {resolveActionLabel(action)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {isMobile && mobileModeSheetOpen && !forceListOnly && (
        <div className="fixed inset-0 z-[220]">
          <button
            type="button"
            className="absolute inset-0 bg-base-content/35"
            aria-label={translateRuntime("common.view_modes.close_view_mode_picker")}
            onClick={() => setMobileModeSheetOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-base-100 border-t border-base-300 shadow-2xl p-4">
            <div className="mx-auto mb-4 h-1.5 w-24 rounded-full bg-base-300" />
            <div className="grid grid-cols-2 gap-3">
              {modeButtons.map((m) => {
                const active = m.mode === activeMode;
                const icon = m.mode === "list"
                  ? <IconList />
                  : m.mode === "kanban"
                    ? <IconKanban />
                    : m.mode === "graph"
                      ? <IconGraph />
                      : m.mode === "calendar"
                        ? <IconCalendar />
                        : <IconPivot />;
                const label = viewModeLabel(m.mode);
                return (
                  <button
                    key={m.mode}
                    type="button"
                    disabled={m.disabled}
                    onClick={() => {
                      if (m.disabled) return;
                      handleModeChange(m.mode);
                      setMobileModeSheetOpen(false);
                    }}
                    className={`rounded-2xl border p-4 flex flex-col items-center justify-center gap-3 min-h-28 ${
                      active ? "border-primary bg-primary/5 text-primary" : "border-base-300 bg-base-200/40"
                    } ${m.disabled ? "opacity-50" : ""}`}
                  >
                    <span className="flex h-5 w-5 items-center justify-center">{icon}</span>
                    <span className="text-sm font-medium">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
