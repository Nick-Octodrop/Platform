import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpDown,
  BarChart3,
  Bookmark,
  Columns2,
  Columns3,
  Filter,
  LineChart,
  List,
  ListFilter,
  PieChart,
  Plus,
  RefreshCw,
  Ruler,
  Search,
  Table2,
} from "lucide-react";
import { apiFetch } from "../api.js";
import { supabase } from "../supabase.js";
import ListViewRenderer from "./ListViewRenderer.jsx";
import { evalCondition } from "../utils/conditions.js";
import { PRIMARY_BUTTON_SM, SOFT_BUTTON_SM, SOFT_BUTTON_XS, SOFT_ICON_SM } from "../components/buttonStyles.js";
import DaisyTooltip from "../components/DaisyTooltip.jsx";

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

function buildDomain(activeFilter, clientFilters) {
  const conditions = [];
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

function KanbanView({ view, entityDef, records, groupBy, onSelectRow }) {
  const card = view.card || {};
  const titleField = card.title_field;
  const humanize = (value) => String(value || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const priorityTone = (value) => {
    const v = String(value || "").toLowerCase();
    if (v === "urgent") return "badge-error";
    if (v === "high") return "badge-warning";
    if (v === "low") return "badge-ghost";
    return "badge-neutral";
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
    const known = optionOrder.filter((key) => currentKeys.includes(key));
    const remaining = currentKeys.filter((key) => !known.includes(key));
    return [...known, ...remaining];
  }, [grouped, groupBy, entityDef]);
  return (
    <div className="h-full min-h-0">
      <div className="h-full min-h-0">
        <div className="h-full min-h-0 overflow-x-auto overflow-y-hidden pb-2">
          <div className="flex h-full min-h-0 gap-4 min-w-max">
            {groupKeys.map((groupKey) => (
              <div key={groupKey} className="w-[320px] shrink-0 bg-base-100 rounded-box border border-base-300 shadow-sm p-2 h-full min-h-0 flex flex-col">
                <div className="p-2 flex items-center justify-between gap-2">
                  <div className="font-semibold truncate">{groupBy ? (groupKey ? humanize(groupKey) : "Ungrouped") : "All"}</div>
                  <span className="badge badge-ghost badge-sm">{grouped[groupKey].length}</span>
                </div>
                <div className="p-[7px] space-y-3 overflow-y-auto min-h-0">
                  {grouped[groupKey].length === 0 ? (
                    <div className="text-xs text-base-content/50 p-2">No work orders</div>
                  ) : grouped[groupKey].map((row) => {
                    const record = row.record || {};
                    const rowId = row.record_id || record.id;
                    const workOrderNo = String(record[titleField] ?? "");
                    const workTitle = String(record["workorder.title"] ?? "");
                    const priority = String(record["workorder.priority"] ?? "");
                    return (
                      <div
                        key={rowId}
                        className="card bg-base-100 border border-base-200 shadow-sm hover:shadow-md hover:border-base-300 transition cursor-pointer"
                        onClick={() => onSelectRow?.(row)}
                      >
                        <div className="card-body p-[7px] gap-1">
                          <div className="text-base font-semibold truncate">{workOrderNo}</div>
                          <div className="text-sm text-base-content/70 leading-snug line-clamp-2">{workTitle || " "}</div>
                          {priority ? (
                            <div className="mt-3 flex items-center gap-2">
                              <span className={`badge badge-sm ${priorityTone(priority)}`}>{humanize(priority)}</span>
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
    return <div className="text-sm opacity-60">No data</div>;
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

function PivotView({ data, measure }) {
  if (!data || !Array.isArray(data.rows) || !Array.isArray(data.cols)) {
    return <div className="text-sm opacity-60">No data</div>;
  }
  const formatValue = (value) => {
    if (measure?.startsWith("sum:")) return Number(value || 0).toFixed(2);
    return String(value || 0);
  };
  return (
    <div className="h-full min-h-0 overflow-auto">
      <table className="table table-sm">
        <thead>
          <tr>
            <th className="bg-base-300">Row</th>
            {data.cols.map((col) => (
              <th key={col.key} className="bg-base-300">
                {col.label || "(empty)"}
              </th>
            ))}
            <th className="bg-base-300">Total</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.key}>
              <th>{row.label || "(empty)"}</th>
              {data.cols.map((col) => {
                const value = data.matrix?.[row.key]?.[col.key] || 0;
                return <td key={`${row.key}-${col.key}`}>{formatValue(value)}</td>;
              })}
              <td className="font-semibold">{formatValue(data.row_totals?.[row.key] || 0)}</td>
            </tr>
          ))}
          <tr>
            <th>Total</th>
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
  actionsMap,
  externalRefreshTick = 0,
  previewMode = false,
  onConfirm,
  onPrompt,
  bootstrap = null,
  bootstrapVersion = 0,
  bootstrapLoading = false,
  canWriteRecords = true,
}) {
  const modes = Array.isArray(block?.modes) ? block.modes : [];
  const views = Array.isArray(manifest?.views) ? manifest.views : [];
  const appDefaults = manifest?.app?.defaults || {};
  const entityFullId = resolveEntityFullId(manifest, block?.entity_id);
  const entityDef = (manifest?.entities || []).find((e) => e.id === entityFullId);
  const entityLabel = entityDef?.label || humanizeEntityId(entityFullId);
  const fieldIndex = useMemo(() => buildFieldIndex(manifest, entityFullId), [manifest, entityFullId]);

  const [records, setRecords] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [clientFilters, setClientFilters] = useState([]);
  const [savedFilters, setSavedFilters] = useState([]);
  const [prefs, setPrefs] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);
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
    const list = [...resolvedModes];
    if (!list.find((m) => m.mode === "pivot")) {
      list.push({ mode: "pivot", disabled: true });
    }
    return list;
  }, [resolvedModes]);

  const defaultMode = block?.default_mode || resolvedModes[0]?.mode || "list";

  const activeMode = resolvedModes.find((m) => m.mode === modeParam)?.mode || defaultMode;
  const activeModeDef = resolvedModes.find((m) => m.mode === activeMode) || resolvedModes[0] || null;
  const activeView = activeModeDef?.view || null;

  const listView = resolvedModes.find((m) => m.mode === "list")?.view || activeView;
  const searchFields = Array.isArray(listView?.header?.search?.fields) ? listView.header.search.fields : [];
  const manifestFilters = Array.isArray(listView?.header?.filters) ? listView.header.filters : [];
  const graphDefault = activeView?.default || {};
  const graphType = graphTypeParam || graphDefault.type || "bar";
  const graphGroupBy = graphGroupByParam || groupByParam || graphDefault.group_by || "";
  const graphMeasure = graphMeasureParam || graphDefault.measure || "count";
  const showGraphMode = activeMode === "graph";
  const pivotRowGroupBy = pivotRowParam || groupByParam || activeModeDef?.default_group_by || block?.default_group_by || "";
  const pivotColGroupBy = pivotColParam || "";
  const pivotMeasure = pivotMeasureParam || "count";

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
  const domain = buildDomain(activeFilter, clientFilters);

  useEffect(() => {
    if (previewMode || !entityFullId) return;
    let mounted = true;
    async function loadPrefs() {
      try {
        const session = (await supabase.auth.getSession()).data.session;
        if (!session?.access_token) {
          prefsLoadedRef.current = true;
          return;
        }
      } catch {
        prefsLoadedRef.current = true;
        return;
      }
      apiFetch(`/filters/${entityFullId}`)
        .then((res) => {
          if (!mounted) return;
          setSavedFilters(res.filters || []);
        })
        .catch(() => {});
      apiFetch(`/prefs/entity/${entityFullId}`)
        .then((res) => {
          if (!mounted) return;
          setPrefs(res.prefs || {});
          prefsLoadedRef.current = true;
        })
        .catch(() => {
          prefsLoadedRef.current = true;
        });
    }
    loadPrefs();
    return () => {
      mounted = false;
    };
  }, [entityFullId, previewMode]);

  useEffect(() => {
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
  }, [prefs, searchParams, setSearchParams, defaultMode, activeModeDef, block, clientFilters.length]);

  useEffect(() => {
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
      if (!params.get("pivot_row_group_by") && groupByParam) {
        params.set("pivot_row_group_by", groupByParam);
        changed = true;
      }
    }
    if (changed) setSearchParams(params, { replace: true });
  }, [activeMode, activeView, searchParams, setSearchParams, groupByParam]);

  useEffect(() => {
    if (!activeView || previewMode) return;
    const viewKind = activeView.kind || activeView.type;
    if (viewKind === "graph" || activeMode === "pivot") return;
    const bootstrapList = bootstrap?.list;
    const bootstrapMatches =
      bootstrapList &&
      bootstrap?.viewId === activeView?.id &&
      bootstrapList?.entity_id === entityFullId &&
      bootstrapUsedRef.current !== bootstrapVersion;
    if (bootstrapMatches && viewKind === "list") {
      setRecords(bootstrapList.records || []);
      setSelectedIds([]);
      bootstrapUsedRef.current = bootstrapVersion;
      return;
    }
    if (bootstrapLoading && viewKind === "list") {
      return;
    }
    const listFields = [];
    if (viewKind === "list") {
      const cols = Array.isArray(activeView.columns) ? activeView.columns : [];
      for (const c of cols) {
        if (c?.field_id) listFields.push(c.field_id);
      }
    }
    if (viewKind === "kanban") {
      const card = activeView.card || {};
      if (card.title_field) listFields.push(card.title_field);
      for (const fid of card.subtitle_fields || []) listFields.push(fid);
      for (const fid of card.badge_fields || []) listFields.push(fid);
      if (groupByParam) listFields.push(groupByParam);
    }
    if (entityDef?.display_field) listFields.push(entityDef.display_field);
    const uniq = Array.from(new Set(listFields));
    const qs = new URLSearchParams();
    if (uniq.length) qs.set("fields", uniq.join(","));
    if (searchText) qs.set("q", searchText);
    if (searchFields.length) qs.set("search_fields", searchFields.join(","));
    if (domain) qs.set("domain", JSON.stringify(domain));
    apiFetch(`/records/${entityFullId}${qs.toString() ? `?${qs.toString()}` : ""}`)
      .then((res) => {
        setRecords(res.records || []);
        setSelectedIds([]);
      })
      .catch(() => setRecords([]));
  }, [activeView, entityFullId, searchText, searchFields, domain, groupByParam, previewMode, entityDef, refreshTick, externalRefreshTick, bootstrap, bootstrapVersion, bootstrapLoading]);

  const [graphData, setGraphData] = useState([]);
  useEffect(() => {
    if (!activeView || previewMode) return;
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
  }, [activeView, entityFullId, searchText, searchFields, domain, graphGroupBy, graphMeasure, previewMode, refreshTick, externalRefreshTick]);

  const [pivotData, setPivotData] = useState(null);
  useEffect(() => {
    if (!entityFullId || previewMode) return;
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
  }, [activeMode, entityFullId, pivotRowGroupBy, pivotColGroupBy, pivotMeasure, searchText, searchFields, domain, previewMode, refreshTick, externalRefreshTick]);

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
    apiFetch(`/prefs/entity/${entityFullId}`, {
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
    apiFetch(`/prefs/entity/${entityFullId}`, {
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
    updateParam("pivot_row_group_by", value);
    updateParam("group_by", value);
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
      apiFetch(`/filters/${filterParam}`, {
        method: "PUT",
        body: JSON.stringify({ is_default: true }),
      }).catch(() => {});
      return;
    }
    apiFetch(`/prefs/entity/${entityFullId}`, {
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
    if (!domain) return;
    if (!onPrompt) return;
    const promptDialog = onPrompt;
    const name = await promptDialog({ title: "Save view as", defaultValue: "" });
    if (!name) return;
    const state = {
      mode: activeMode || "",
      search: searchText || "",
      filter: filterParam || "",
      group_by: groupByParam || "",
      graph_type: graphType,
      graph_measure: graphMeasure,
      graph_group_by: graphGroupBy,
      pivot_row_group_by: pivotRowGroupBy,
      pivot_col_group_by: pivotColGroupBy,
      pivot_measure: pivotMeasure,
    };
    apiFetch(`/filters/${entityFullId}`, {
      method: "POST",
      body: JSON.stringify({ name, domain, state }),
    })
      .then((res) => {
        setSavedFilters((prev) => [res.filter, ...prev]);
      })
      .catch(() => {});
  }

  function handleDeleteSavedView(viewId) {
    if (!viewId) return;
    apiFetch(`/filters/${viewId}`, { method: "DELETE" })
      .then(() => {
        setSavedFilters((prev) => prev.filter((f) => f.id !== viewId));
      })
      .catch(() => {});
  }

  async function handleBulkDelete() {
    if (!selectedIds.length) return;
    if (!onConfirm) return;
    const confirmDialog = onConfirm;
    const ok = await confirmDialog({
      title: "Delete records",
      body: `Delete ${selectedIds.length} record(s)?`,
    });
    if (!ok) return;
    Promise.all(selectedIds.map((rid) => apiFetch(`/records/${entityFullId}/${rid}`, { method: "DELETE" })))
      .then(() => setSelectedIds([]))
      .catch(() => {});
  }

  function resolveActionLabel(action) {
    if (action.label) return action.label;
    if (action.kind === "create_record" || action.kind === "open_form") return "New";
    if (action.kind === "update_record") return "Save";
    if (action.kind === "refresh") return "Refresh";
    return "Action";
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

  const filterableFields = useMemo(() => {
    if (!entityDef || !Array.isArray(entityDef.fields)) return [];
    return entityDef.fields.filter((f) => f?.id && ["string", "text", "enum", "bool", "date", "datetime", "number"].includes(f.type));
  }, [entityDef]);
  const measureOptions = useMemo(() => {
    const opts = [{ value: "count", label: "Count" }];
    if (!entityDef || !Array.isArray(entityDef.fields)) return opts;
    for (const f of entityDef.fields) {
      if (f?.id && f.type === "number") {
        opts.push({ value: `sum:${f.id}`, label: `Sum ${f.label || f.id}` });
      }
    }
    return opts;
  }, [entityDef]);
  const searchEnabled = Boolean(listView?.header?.search?.enabled);
  const showSearch = searchEnabled;
  const showFilters = manifestFilterList.length > 0 || filterableFields.length > 0;
  const showSavedViews = savedFilters.length > 0 || showFilters;
  const showGroupBy = activeMode !== "list" && filterableFields.length > 0;
  const showGraphMeasure = activeMode === "graph" && measureOptions.length > 0;
  const showPivotMeasure = activeMode === "pivot" && measureOptions.length > 0;

  return (
    <div className="flex flex-col gap-4 h-full min-h-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 relative z-30 shrink-0">
          <div className="flex items-center gap-2 min-w-[12rem]">
          {canWriteRecords && (
            <DaisyTooltip label={`New ${entityLabel}`} placement="bottom">
              <button
                className={PRIMARY_BUTTON_SM}
                onClick={() => {
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

        <div className="flex items-center justify-center flex-1 min-w-[16rem]">
          {(showSearch || showFilters || showGroupBy || showSavedViews) && (
            <div className="join items-center overflow-visible">
              {showSearch && (
                <>
                  <DaisyTooltip label="Search" className="join-item" placement="bottom">
                    <button className={SOFT_ICON_SM} type="button" aria-label="Search">
                      <IconSearch />
                    </button>
                  </DaisyTooltip>
                  <input
                    className="input input-bordered input-sm join-item w-full max-w-xs"
                    placeholder="Search…"
                    value={searchText}
                    onChange={(e) => handleSearchChange(e.target.value)}
                  />
                </>
              )}
              {showFilters && (
                <div className="dropdown dropdown-end dropdown-bottom join-item">
                  <DaisyTooltip label="Filters" className="join-item" placement="bottom">
                    <button className={SOFT_ICON_SM} type="button" aria-label="Filters">
                      <IconFilter />
                    </button>
                  </DaisyTooltip>
                  <div className="dropdown-content p-2 shadow bg-base-100 rounded-box w-64 z-[200] max-h-72 overflow-y-auto overflow-x-hidden">
                    <ul className="menu flex flex-col">
                      {manifestFilterList.map((flt) => (
                        <li key={flt.id}>
                          <button onClick={() => handleFilterChange(flt.id)}>{flt.label || flt.id}</button>
                        </li>
                      ))}
                      {filterableFields.length > 0 && <li className="menu-title">Custom</li>}
                      {filterableFields.map((field) => (
                        <li key={field.id}>
                          <button
                            onClick={async () => {
                              if (!onPrompt) return;
                              const value = await onPrompt({ title: `Filter ${field.label}`, defaultValue: "" });
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
                        <button onClick={() => handleFilterChange("")}>Clear</button>
                      </li>
                    </ul>
                  </div>
                </div>
              )}
              {showGroupBy && (
                <div className="dropdown dropdown-end dropdown-bottom join-item">
                  <DaisyTooltip label="Sort and group" className="join-item" placement="bottom">
                    <button className={SOFT_ICON_SM} type="button" aria-label="Sort and group">
                      <IconSort />
                    </button>
                  </DaisyTooltip>
                  <div className="dropdown-content p-2 shadow bg-base-100 rounded-box w-64 z-[200] max-h-72 overflow-y-auto overflow-x-hidden">
                    <ul className="menu flex flex-col">
                      {filterableFields.map((field) => (
                        <li key={field.id}>
                          <button onClick={() => handleGroupByChange(field.id)}>{field.label || field.id}</button>
                        </li>
                      ))}
                      <li>
                        <button onClick={() => handleGroupByChange("")}>Clear</button>
                      </li>
                    </ul>
                  </div>
                </div>
              )}
              {showSavedViews && (
                <div className="dropdown dropdown-end dropdown-bottom join-item">
                  <DaisyTooltip label="Saved views" className="join-item" placement="bottom">
                    <button className={SOFT_ICON_SM} type="button" aria-label="Saved views">
                      <IconBookmark />
                    </button>
                  </DaisyTooltip>
                  <div className="dropdown-content p-2 shadow bg-base-100 rounded-box w-64 z-[200] max-h-72 overflow-y-auto overflow-x-hidden">
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
                              aria-label={`Remove ${flt.name}`}
                            >
                              ×
                            </button>
                          </div>
                        </li>
                      ))}
                      <li>
                        <button onClick={handleSaveFilter} disabled={!domain}>Save current view</button>
                      </li>
                      <li>
                        <button onClick={handleSetDefault} disabled={!filterParam}>Set as default</button>
                      </li>
                    </ul>
                  </div>
                </div>
              )}
              <DaisyTooltip label="Refresh" className="join-item" placement="bottom">
                <button className={SOFT_ICON_SM} type="button" onClick={() => setRefreshTick((v) => v + 1)} aria-label="Refresh">
                  <IconRefresh />
                </button>
              </DaisyTooltip>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 min-w-[10rem] justify-end">
          {activeMode === "graph" && (
            <div className="join">
              <DaisyTooltip label="Bar chart" className="join-item" placement="top">
                <button
                  className={`${SOFT_ICON_SM} ${graphType === "bar" ? "bg-base-300" : ""}`}
                  onClick={() => handleGraphTypeChange("bar")}
                >
                  <IconGraph />
                </button>
              </DaisyTooltip>
              <DaisyTooltip label="Line chart" className="join-item" placement="top">
                <button
                  className={`${SOFT_ICON_SM} ${graphType === "line" ? "bg-base-300" : ""}`}
                  onClick={() => handleGraphTypeChange("line")}
                >
                  <IconLine />
                </button>
              </DaisyTooltip>
              <DaisyTooltip label="Pie chart" className="join-item" placement="top">
                <button
                  className={`${SOFT_ICON_SM} ${graphType === "pie" ? "bg-base-300" : ""}`}
                  onClick={() => handleGraphTypeChange("pie")}
                >
                  <IconPie />
                </button>
              </DaisyTooltip>
              {showGraphMeasure && (
                <div className="dropdown dropdown-end dropdown-bottom join-item">
                  <DaisyTooltip label="Measure" className="join-item" placement="top">
                    <button className={SOFT_ICON_SM} type="button" tabIndex={0}>
                      <IconMeasure />
                    </button>
                  </DaisyTooltip>
                  <div className="dropdown-content p-2 shadow bg-base-100 rounded-box w-64 z-[200] max-h-72 overflow-y-auto overflow-x-hidden">
                    <ul className="menu flex flex-col">
                      {measureOptions.map((opt) => (
                        <li key={opt.value}>
                          <button onClick={() => handleGraphMeasureChange(opt.value)}>{opt.label}</button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}
          {activeMode === "pivot" && (
            <div className="join">
              <div className="dropdown dropdown-end dropdown-bottom join-item">
                <DaisyTooltip label="Rows" className="join-item" placement="top">
                  <button className={SOFT_ICON_SM} type="button" tabIndex={0}>
                    <IconGroup />
                  </button>
                </DaisyTooltip>
                <div className="dropdown-content p-2 shadow bg-base-100 rounded-box w-64 z-[200] max-h-72 overflow-y-auto overflow-x-hidden">
                  <ul className="menu flex flex-col">
                    {filterableFields.map((field) => (
                      <li key={field.id}>
                        <button onClick={() => handlePivotRowChange(field.id)}>{field.label || field.id}</button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="dropdown dropdown-end dropdown-bottom join-item">
                <DaisyTooltip label="Columns" className="join-item" placement="top">
                  <button className={SOFT_ICON_SM} type="button" tabIndex={0}>
                    <IconColumns />
                  </button>
                </DaisyTooltip>
                <div className="dropdown-content p-2 shadow bg-base-100 rounded-box w-64 z-[200] max-h-72 overflow-y-auto overflow-x-hidden">
                  <ul className="menu flex flex-col">
                    {filterableFields.map((field) => (
                      <li key={field.id}>
                        <button onClick={() => handlePivotColChange(field.id)}>{field.label || field.id}</button>
                      </li>
                    ))}
                    <li>
                      <button onClick={() => handlePivotColChange("")}>Clear</button>
                    </li>
                  </ul>
                </div>
              </div>
              {showPivotMeasure && (
                <div className="dropdown dropdown-end dropdown-bottom join-item">
                  <DaisyTooltip label="Measure" className="join-item" placement="top">
                    <button className={SOFT_ICON_SM} type="button" tabIndex={0}>
                      <IconMeasure />
                    </button>
                  </DaisyTooltip>
                  <div className="dropdown-content p-2 shadow bg-base-100 rounded-box w-64 z-[200] max-h-72 overflow-y-auto overflow-x-hidden">
                    <ul className="menu flex flex-col">
                      {measureOptions.map((opt) => (
                        <li key={opt.value}>
                          <button onClick={() => handlePivotMeasureChange(opt.value)}>{opt.label}</button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="join">
            {modeButtons.map((m) => {
              const active = m.mode === activeMode;
              const icon = m.mode === "list" ? <IconList /> : m.mode === "kanban" ? <IconKanban /> : m.mode === "graph" ? <IconGraph /> : <IconPivot />;
              const modeTip = m.mode === "kanban" ? "Kanban" : m.mode === "graph" ? "Graph" : m.mode === "pivot" ? "Pivot" : "List";
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
          {selectedIds.length > 0 && (
            <button className={SOFT_BUTTON_SM} onClick={handleBulkDelete}>Delete ({selectedIds.length})</button>
          )}
          {bulkActions.length > 0 && selectedIds.length > 0 && (
            <div className="dropdown dropdown-end">
              <button className={SOFT_BUTTON_SM}>Bulk</button>
              <ul className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-56 z-50">
                {bulkActions.map((action) => (
                  <li key={action.id || action.label}>
                    <button onClick={() => onRunAction?.(action)}>{resolveActionLabel(action)}</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {clientFilters.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {clientFilters.map((flt, idx) => (
            <div key={`${flt.field_id}-${idx}`} className="badge badge-outline badge-sm gap-2">
              {flt.label || flt.field_id}: {String(flt.value)}
              <button className={SOFT_BUTTON_XS} onClick={() => setClientFilters((prev) => prev.filter((_, i) => i !== idx))}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto relative z-0">
        {activeView && (activeView.kind === "list" || activeView.type === "list") && (
          <div className="h-full min-h-0">
            <ListViewRenderer
              view={activeView}
              fieldIndex={fieldIndex}
              records={records}
              header={activeView.header}
              hideHeader={true}
              searchQuery={searchText}
              searchFields={searchFields}
              filters={manifestFilters}
              activeFilter={activeFilter && activeFilter.source === "manifest" ? activeFilter : null}
              clientFilters={clientFilters}
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
              onSelectRow={(row) => {
                if (!openRecordTarget) return;
                const recordId = row.record_id || row.record?.id;
                if (!recordId) return;
                const target = openRecordTarget.startsWith("page:") || openRecordTarget.startsWith("view:") ? openRecordTarget : `page:${openRecordTarget}`;
                onNavigate?.(target, { recordId, recordParamName: openRecordParam, preserveParams: true });
              }}
            />
          </div>
        )}

        {activeView && (activeView.kind === "kanban" || activeView.type === "kanban") && (
          <div className="h-full min-h-0">
            <KanbanView
              view={activeView}
              entityDef={entityDef}
              records={records}
              groupBy={groupByParam}
              onSelectRow={(row) => {
                if (!openRecordTarget) return;
                const recordId = row.record_id || row.record?.id;
                if (!recordId) return;
                const target = openRecordTarget.startsWith("page:") || openRecordTarget.startsWith("view:") ? openRecordTarget : `page:${openRecordTarget}`;
                onNavigate?.(target, { recordId, recordParamName: openRecordParam, preserveParams: true });
              }}
            />
          </div>
        )}

        {showGraphMode && (
          <div className="h-full min-h-0">
            <GraphView data={graphData} type={graphType} />
          </div>
        )}

        {activeMode === "pivot" && (
          <div className="h-full min-h-0">
            <PivotView data={pivotData} measure={pivotMeasure} />
          </div>
        )}
      </div>
    </div>
  );
}
