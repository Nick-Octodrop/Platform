import React, { useEffect, useMemo, useState } from "react";
import { Download, FolderOpen, MoreHorizontal, Trash2 } from "lucide-react";
import { API_URL, apiFetch, subscribeRecordMutations } from "../api.js";
import { SOFT_BUTTON_SM } from "../components/buttonStyles.js";
import { useI18n } from "../i18n/LocalizationProvider.jsx";
import SystemListToolbar from "./SystemListToolbar.jsx";
import ListViewRenderer from "./ListViewRenderer.jsx";

function parseStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
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

function matchesScopedSource(source, block, moduleId) {
  if (!source || typeof source !== "object") return false;
  const scope = String(block?.scope || "global").trim().toLowerCase();
  if (scope === "current_module" && source.module_id !== moduleId) return false;

  const includeModuleIds = parseStringArray(block?.include_module_ids);
  if (includeModuleIds.length > 0 && !includeModuleIds.includes(String(source.module_id || ""))) return false;

  const excludeModuleIds = new Set(parseStringArray(block?.exclude_module_ids));
  if (excludeModuleIds.has(String(source.module_id || ""))) return false;

  const includeEntityIds = parseStringArray(block?.include_entity_ids);
  if (includeEntityIds.length > 0 && !includeEntityIds.includes(String(source.entity_id || ""))) return false;

  const excludeEntityIds = new Set(parseStringArray(block?.exclude_entity_ids));
  if (excludeEntityIds.has(String(source.entity_id || ""))) return false;

  const includeSourceKeys = parseStringArray(block?.include_source_keys);
  if (includeSourceKeys.length > 0 && !includeSourceKeys.includes(String(source.source_key || ""))) return false;

  const excludeSourceKeys = new Set(parseStringArray(block?.exclude_source_keys));
  if (excludeSourceKeys.has(String(source.source_key || ""))) return false;

  return true;
}

function matchesCategoryFilter(item, block, selectedCategory) {
  const category = String(item?.category || "").trim();
  const includeCategories = parseStringArray(block?.include_categories);
  if (includeCategories.length > 0 && !includeCategories.includes(category)) return false;
  const excludeCategories = new Set(parseStringArray(block?.exclude_categories));
  if (excludeCategories.has(category)) return false;
  if (selectedCategory && selectedCategory !== "all" && category !== selectedCategory) return false;
  return true;
}

function attachmentIdFromItem(item) {
  return String(item?.attachment?.id || "").trim();
}

function attachmentDownloadUrl(attachmentId) {
  return `${API_URL}/attachments/${encodeURIComponent(attachmentId)}/download`;
}

function sortItems(items, sourceByKey) {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return [...items].sort((left, right) => {
    const leftTs = Date.parse(String(left?.date || "")) || 0;
    const rightTs = Date.parse(String(right?.date || "")) || 0;
    if (leftTs !== rightTs) return rightTs - leftTs;

    const leftSource = sourceByKey.get(left?.source_key || "");
    const rightSource = sourceByKey.get(right?.source_key || "");
    const leftModule = String(leftSource?.module_name || left?.module_id || "");
    const rightModule = String(rightSource?.module_name || right?.module_id || "");
    const moduleCmp = collator.compare(leftModule, rightModule);
    if (moduleCmp !== 0) return moduleCmp;

    const leftFile = String(left?.attachment?.filename || left?.record_label || "");
    const rightFile = String(right?.attachment?.filename || right?.record_label || "");
    return collator.compare(leftFile, rightFile);
  });
}

export default function DocumentRegistryBlock({
  block,
  manifest,
  moduleId,
  onNavigate,
  onConfirm,
  externalRefreshTick = 0,
  onPageSectionLoadingChange = null,
}) {
  const { t } = useI18n();
  const [sources, setSources] = useState([]);
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState(String(block?.default_search || ""));
  const [selectedSourceKey, setSelectedSourceKey] = useState(String(block?.default_source_key || "all"));
  const [selectedCategory, setSelectedCategory] = useState(String(block?.default_category || "all"));
  const [mineOnly, setMineOnly] = useState(Boolean(block?.default_mine));
  const [selectedIds, setSelectedIds] = useState([]);
  const [page, setPage] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const [loadingSources, setLoadingSources] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [error, setError] = useState("");
  const [reloadTick, setReloadTick] = useState(0);
  const [deleting, setDeleting] = useState(false);

  const appDefaults = manifest?.app?.defaults || {};
  const sectionKey = useMemo(
    () => `document_registry:${moduleId || "module"}:${block?.id || block?.title || "documents"}`,
    [moduleId, block?.id, block?.title],
  );
  const loading = loadingSources || loadingItems;

  useEffect(() => {
    onPageSectionLoadingChange?.(sectionKey, loading);
    return () => onPageSectionLoadingChange?.(sectionKey, false);
  }, [loading, onPageSectionLoadingChange, sectionKey]);

  useEffect(() => {
    const unsubscribe = subscribeRecordMutations(() => setReloadTick((value) => value + 1));
    return unsubscribe;
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadSources() {
      try {
        setLoadingSources(true);
        setError("");
        const res = await apiFetch("/system/documents/sources");
        if (cancelled) return;
        setSources(Array.isArray(res?.sources) ? res.sources : []);
      } catch (err) {
        if (cancelled) return;
        setSources([]);
        setError(err?.message || t("common.load_failed"));
      } finally {
        if (!cancelled) setLoadingSources(false);
      }
    }
    loadSources();
    return () => {
      cancelled = true;
    };
  }, [reloadTick, externalRefreshTick, t]);

  const allowedSources = useMemo(
    () => (Array.isArray(sources) ? sources.filter((source) => matchesScopedSource(source, block, moduleId)) : []),
    [sources, block, moduleId],
  );

  const sourceByKey = useMemo(
    () => new Map(allowedSources.map((source) => [String(source?.source_key || ""), source])),
    [allowedSources],
  );

  useEffect(() => {
    if (selectedSourceKey === "all") return;
    if (!sourceByKey.has(selectedSourceKey)) {
      setSelectedSourceKey("all");
      setPage(0);
    }
  }, [selectedSourceKey, sourceByKey]);

  const activeSourceKeys = useMemo(() => {
    if (selectedSourceKey !== "all" && sourceByKey.has(selectedSourceKey)) return [selectedSourceKey];
    return allowedSources.map((source) => String(source?.source_key || "")).filter(Boolean);
  }, [allowedSources, selectedSourceKey, sourceByKey]);

  useEffect(() => {
    let cancelled = false;
    async function loadItems() {
      if (activeSourceKeys.length === 0) {
        setItems([]);
        setLoadingItems(false);
        return;
      }
      try {
        setLoadingItems(true);
        setError("");
        const params = new URLSearchParams();
        params.set("limit", String(Math.max(1, Math.min(Number(block?.limit) || 2000, 2000))));
        if (search.trim()) params.set("q", search.trim());
        if (mineOnly) params.set("mine", "true");
        if (activeSourceKeys.length === 1) params.set("source_key", activeSourceKeys[0]);
        else params.set("source_keys", activeSourceKeys.join(","));
        const res = await apiFetch(`/system/documents/items?${params.toString()}`);
        if (cancelled) return;
        setItems(Array.isArray(res?.items) ? res.items : []);
      } catch (err) {
        if (cancelled) return;
        setItems([]);
        setError(err?.message || t("common.load_failed"));
      } finally {
        if (!cancelled) setLoadingItems(false);
      }
    }
    loadItems();
    return () => {
      cancelled = true;
    };
  }, [activeSourceKeys, block?.limit, mineOnly, reloadTick, search, selectedSourceKey, t]);

  const categoryOptions = useMemo(() => {
    const values = new Set();
    for (const item of items) {
      const category = String(item?.category || "").trim();
      if (!category) continue;
      if (!matchesCategoryFilter(item, block, "all")) continue;
      values.add(category);
    }
    return Array.from(values).sort((left, right) => left.localeCompare(right));
  }, [items, block]);

  const filteredItems = useMemo(() => {
    const visible = items.filter((item) => matchesCategoryFilter(item, block, selectedCategory));
    return sortItems(visible, sourceByKey);
  }, [items, block, selectedCategory, sourceByKey]);

  const rows = useMemo(() => {
    return filteredItems.map((item, index) => {
      const source = sourceByKey.get(String(item?.source_key || ""));
      const attachment = item?.attachment || {};
      const attachmentId = attachmentIdFromItem(item) || `${item?.source_key || "source"}:${item?.record_id || "record"}:${index}`;
      return {
        record_id: attachmentId,
        _item: item,
        record: {
          "doc.filename": attachment?.filename || item?.record_label || attachmentId,
          "doc.category": String(item?.category || ""),
          "doc.record_label": String(item?.record_label || ""),
          "doc.module_name": String(source?.module_name || item?.module_id || ""),
          "doc.entity_label": String(source?.entity_label || item?.entity_id || ""),
          "doc.owner": item?.owner || "",
          "doc.date": item?.date || "",
        },
      };
    });
  }, [filteredItems, sourceByKey]);

  const rowsById = useMemo(() => new Map(rows.map((row) => [String(row.record_id || ""), row])), [rows]);

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => rowsById.has(String(id || ""))));
  }, [rowsById]);

  const selectedRows = useMemo(
    () => selectedIds.map((id) => rowsById.get(String(id || ""))).filter(Boolean),
    [selectedIds, rowsById],
  );

  const canOpenCurrentModuleRecord = useMemo(() => {
    if (selectedRows.length !== 1) return false;
    const item = selectedRows[0]?._item;
    if (!item || String(item?.module_id || "") !== String(moduleId || "")) return false;
    return Boolean(resolveEntityDefaultFormPage(appDefaults, item?.entity_id));
  }, [appDefaults, moduleId, selectedRows]);

  const view = useMemo(
    () => ({
      id: `system.document_registry.${moduleId || "module"}.${block?.id || "default"}`,
      kind: "list",
      columns: [
        { field_id: "doc.filename", label: t("common.name") },
        { field_id: "doc.category", label: t("common.type") },
        { field_id: "doc.record_label", label: t("common.record") },
        { field_id: "doc.module_name", label: t("common.module") },
        { field_id: "doc.entity_label", label: t("common.entity") },
        { field_id: "doc.owner", label: "Owner" },
        { field_id: "doc.date", label: t("common.updated") },
      ],
    }),
    [block?.id, moduleId, t],
  );

  const fieldIndex = useMemo(
    () => ({
      "doc.filename": { id: "doc.filename", label: t("common.name"), type: "string" },
      "doc.category": { id: "doc.category", label: t("common.type"), type: "string" },
      "doc.record_label": { id: "doc.record_label", label: t("common.record"), type: "string" },
      "doc.module_name": { id: "doc.module_name", label: t("common.module"), type: "string" },
      "doc.entity_label": { id: "doc.entity_label", label: t("common.entity"), type: "string" },
      "doc.owner": { id: "doc.owner", label: "Owner", type: "user" },
      "doc.date": { id: "doc.date", label: t("common.updated"), type: "date" },
    }),
    [t],
  );

  async function reloadItems() {
    setReloadTick((value) => value + 1);
  }

  function openAttachmentForItem(item) {
    const attachmentId = attachmentIdFromItem(item);
    if (!attachmentId || item?.allow_download === false) return;
    window.open(attachmentDownloadUrl(attachmentId), "_blank", "noopener,noreferrer");
  }

  function openRecordForItem(item) {
    if (!item || String(item?.module_id || "") !== String(moduleId || "")) return;
    const target = resolveEntityDefaultFormPage(appDefaults, item?.entity_id);
    if (!target || typeof onNavigate !== "function") return;
    onNavigate(target, { recordId: item?.record_id });
  }

  async function confirmDelete(count) {
    if (typeof onConfirm === "function") {
      return Boolean(
        await onConfirm({
          title: count === 1 ? `${t("common.delete")} document` : `${t("common.delete")} ${count} documents`,
          body: count === 1
            ? "Remove the selected document attachment from its source record?"
            : `Remove ${count} selected document attachments from their source records?`,
        }),
      );
    }
    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      return window.confirm(
        count === 1
          ? "Remove the selected document attachment from its source record?"
          : `Remove ${count} selected document attachments from their source records?`,
      );
    }
    return false;
  }

  async function deleteSelectedAttachments() {
    if (deleting || selectedRows.length === 0) return;
    const deletableRows = selectedRows.filter((row) => row?._item?.allow_delete && attachmentIdFromItem(row?._item));
    if (deletableRows.length === 0) return;
    const confirmed = await confirmDelete(deletableRows.length);
    if (!confirmed) return;
    try {
      setDeleting(true);
      setError("");
      for (const row of deletableRows) {
        const item = row?._item;
        await apiFetch(
          `/records/${encodeURIComponent(item.entity_id)}/${encodeURIComponent(item.record_id)}/attachments/${encodeURIComponent(attachmentIdFromItem(item))}?field_id=${encodeURIComponent(item.attachment_field || "")}&delete_scope=record`,
          { method: "DELETE" },
        );
      }
      setSelectedIds([]);
      await reloadItems();
    } catch (err) {
      setError(err?.message || t("common.delete_failed"));
    } finally {
      setDeleting(false);
    }
  }

  const selectedCanDownload = selectedRows.some((row) => row?._item?.allow_download !== false && attachmentIdFromItem(row?._item));
  const selectedCanDelete = selectedRows.some((row) => row?._item?.allow_delete && attachmentIdFromItem(row?._item));

  const sourceSelectOptions = useMemo(
    () => [
      { value: "all", label: "All sources" },
      ...allowedSources.map((source) => ({
        value: String(source?.source_key || ""),
        label: `${source?.module_name || source?.module_id || "Module"} - ${source?.entity_label || source?.entity_id || "Entity"}`,
      })),
    ],
    [allowedSources],
  );

  const rightActions = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <select
        className="select select-bordered select-sm"
        value={selectedSourceKey}
        onChange={(event) => {
          setSelectedSourceKey(event.target.value || "all");
          setPage(0);
        }}
      >
        {sourceSelectOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <select
        className="select select-bordered select-sm"
        value={selectedCategory}
        onChange={(event) => {
          setSelectedCategory(event.target.value || "all");
          setPage(0);
        }}
      >
        <option value="all">All types</option>
        {categoryOptions.map((category) => (
          <option key={category} value={category}>
            {category}
          </option>
        ))}
      </select>
      <label className="label cursor-pointer gap-2 rounded-box border border-base-300 px-3 py-1.5">
        <span className="label-text text-sm">Mine only</span>
        <input
          className="checkbox checkbox-sm"
          type="checkbox"
          checked={mineOnly}
          onChange={(event) => {
            setMineOnly(Boolean(event.target.checked));
            setPage(0);
          }}
        />
      </label>
      {selectedRows.length > 0 ? (
        <div className="dropdown dropdown-end">
          <button className={SOFT_BUTTON_SM} type="button" tabIndex={0} aria-label={t("common.selection_actions")}>
            <MoreHorizontal className="h-4 w-4" />
          </button>
          <ul className="dropdown-content menu rounded-box z-[200] w-56 bg-base-100 p-2 shadow">
            <li className="menu-title">
              <span>{t("common.selection_actions")}</span>
            </li>
            {selectedRows.length === 1 && selectedCanDownload ? (
              <li>
                <button type="button" onClick={() => openAttachmentForItem(selectedRows[0]?._item)}>
                  <Download className="h-4 w-4" />
                  Download file
                </button>
              </li>
            ) : null}
            {selectedRows.length === 1 && canOpenCurrentModuleRecord ? (
              <li>
                <button type="button" onClick={() => openRecordForItem(selectedRows[0]?._item)}>
                  <FolderOpen className="h-4 w-4" />
                  Open record
                </button>
              </li>
            ) : null}
            {selectedRows.length > 1 && selectedCanDownload ? (
              <li>
                <button
                  type="button"
                  onClick={() => {
                    selectedRows.forEach((row) => openAttachmentForItem(row?._item));
                  }}
                >
                  <Download className="h-4 w-4" />
                  Download selected
                </button>
              </li>
            ) : null}
            {selectedCanDelete ? (
              <li>
                <button
                  type="button"
                  className="text-error"
                  onClick={deleteSelectedAttachments}
                  disabled={deleting}
                >
                  <Trash2 className="h-4 w-4" />
                  {deleting ? t("common.deleting") : t("common.delete")}
                </button>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <SystemListToolbar
        title={String(block?.title || "Documents")}
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value || "");
          setPage(0);
        }}
        filters={[]}
        filterableFields={[]}
        onRefresh={reloadItems}
        onClearFilters={() => {
          setSelectedSourceKey("all");
          setSelectedCategory("all");
          setMineOnly(false);
          setPage(0);
        }}
        pagination={{
          page,
          pageSize: Math.max(1, Number(block?.page_size) || 25),
          totalItems,
          onPageChange: setPage,
        }}
        savedViewsEntityId={String(block?.saved_views_entity_id || `system.document_registry.${moduleId || "module"}.${block?.id || "default"}`)}
        savedViewDomain={{}}
        savedViewState={{ search, selectedSourceKey, selectedCategory, mineOnly }}
        onApplySavedViewState={(state) => {
          setSearch(String(state?.search || ""));
          setSelectedSourceKey(String(state?.selectedSourceKey || "all"));
          setSelectedCategory(String(state?.selectedCategory || "all"));
          setMineOnly(Boolean(state?.mineOnly));
          setPage(0);
        }}
        rightActions={rightActions}
      />

      {error ? <div className="alert alert-error text-sm">{error}</div> : null}

      <div className="min-h-0 flex-1 overflow-hidden rounded-box border border-base-300 bg-base-100">
        <ListViewRenderer
          view={view}
          fieldIndex={fieldIndex}
          records={rows}
          hideHeader
          searchQuery=""
          searchFields={[]}
          filters={[]}
          activeFilter={null}
          clientFilters={[]}
          page={page}
          pageSize={Math.max(1, Number(block?.page_size) || 25)}
          onPageChange={setPage}
          onTotalItemsChange={setTotalItems}
          showPaginationControls={false}
          selectedIds={selectedIds}
          enableSelection
          emptyLabel={
            loading
              ? t("common.loading")
              : allowedSources.length === 0
                ? "No documentable sources are available for this view."
                : "No documents found."
          }
          onToggleSelect={(id, checked) => {
            if (!id) return;
            setSelectedIds((prev) => {
              const next = new Set(prev);
              if (checked) next.add(id);
              else next.delete(id);
              return Array.from(next);
            });
          }}
          onToggleAll={(checked, allIds) => {
            setSelectedIds(checked ? allIds || [] : []);
          }}
          onSelectRow={(row) => {
            const item = row?._item;
            if (!item) return;
            if (item.allow_download === false) {
              openRecordForItem(item);
              return;
            }
            openAttachmentForItem(item);
          }}
        />
      </div>
    </div>
  );
}
