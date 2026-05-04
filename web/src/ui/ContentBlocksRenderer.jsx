import React, { useMemo, useState, useEffect, useRef, createContext, useContext, useCallback } from "react";
import { apiFetch, API_URL, getActiveWorkspaceId, getManifest, subscribeRecordMutations } from "../api.js";
import { getSafeSession } from "../supabase.js";
import { evalCondition } from "../utils/conditions.js";
import Tabs from "../components/Tabs.jsx";
import ViewModesBlock from "./ViewModesBlock.jsx";
import DocumentRegistryBlock from "./DocumentRegistryBlock.jsx";
import { Info, Paperclip, Trash2 } from "lucide-react";
import { useAccessContext } from "../access.js";
import { formatDateTime } from "../utils/dateTime.js";
import AttachmentGallery from "./AttachmentGallery.jsx";
import { SOFT_BUTTON_SM } from "../components/buttonStyles.js";
import useMediaQuery from "../hooks/useMediaQuery.js";
import AppModuleIcon from "../components/AppModuleIcon.jsx";
import { translateRuntime } from "../i18n/runtime.js";

const GAP_MAP = {
  sm: "gap-2",
  md: "gap-4",
  lg: "gap-6",
};
function gapClass(value) {
  return GAP_MAP[value] || GAP_MAP.md;
}

function spanClass(span) {
  const parsed = Number.isFinite(Number(span)) ? Math.max(1, Math.min(12, Number(span))) : 12;
  if (parsed >= 12) return "col-span-12";
  return `col-span-12 md:col-span-${parsed}`;
}

function normalizeViewTarget(target) {
  if (!target || typeof target !== "string") return null;
  if (target.startsWith("view:")) return target.slice(5);
  if (target.startsWith("page:")) return null;
  return target;
}

function resolveBlockRefs(value, context = {}) {
  if (Array.isArray(value)) return value.map((item) => resolveBlockRefs(item, context));
  if (!value || typeof value !== "object") return value;
  if (Object.keys(value).length === 1 && Object.prototype.hasOwnProperty.call(value, "ref")) {
    const ref = value.ref;
    if (typeof ref !== "string") return value;
    if (ref === "$today") return new Date().toISOString().slice(0, 10);
    if (ref === "$now") return new Date().toISOString();
    if (ref === "$record.id") return context?.recordId ?? null;
    if (ref.startsWith("$record.")) {
      const fieldId = ref.slice(8);
      return context?.record?.[fieldId] ?? null;
    }
    return value;
  }
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = resolveBlockRefs(item, context);
  }
  return out;
}

function formatStatCardValue(value, format = "number") {
  const numeric = typeof value === "number" ? value : Number(value || 0);
  if (!Number.isFinite(numeric)) return "0";
  if (format === "currency") {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(numeric);
  }
  if (format === "hours") {
    return new Intl.NumberFormat(undefined, {
      minimumFractionDigits: Number.isInteger(numeric) ? 0 : 1,
      maximumFractionDigits: 2,
    }).format(numeric);
  }
  return new Intl.NumberFormat().format(numeric);
}

const RecordScopeContext = createContext(null);

function hasViewModes(blocks) {
  if (!Array.isArray(blocks)) return false;
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    if (block.kind === "view_modes" || block.kind === "document_registry") return true;
    if (block.kind === "container" && hasViewModes(block.content)) return true;
    if (block.kind === "stack" && hasViewModes(block.content)) return true;
    if (block.kind === "grid" && Array.isArray(block.items) && block.items.some((item) => hasViewModes(item?.content))) return true;
    if (block.kind === "tabs" && Array.isArray(block.tabs) && block.tabs.some((tab) => hasViewModes(tab?.content))) return true;
    if (block.kind === "record" && hasViewModes(block.content)) return true;
  }
  return false;
}

function hasFillHeight(blocks) {
  if (!Array.isArray(blocks)) return false;
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    if (block.kind === "view_modes" || block.kind === "view" || block.kind === "record" || block.kind === "chatter" || block.kind === "document_registry") return true;
    if (block.kind === "container" && hasFillHeight(block.content)) return true;
    if (block.kind === "stack" && hasFillHeight(block.content)) return true;
    if (block.kind === "grid" && Array.isArray(block.items) && block.items.some((item) => hasFillHeight(item?.content))) return true;
    if (block.kind === "tabs" && Array.isArray(block.tabs) && block.tabs.some((tab) => hasFillHeight(tab?.content))) return true;
  }
  return false;
}

function blockPrefersFill(block) {
  if (!block || typeof block !== "object") return false;
  if (block.kind === "view_modes" || block.kind === "view" || block.kind === "record" || block.kind === "chatter" || block.kind === "document_registry") {
    return true;
  }
  if (block.kind === "container") return hasFillHeight(block.content);
  if (block.kind === "stack") return hasFillHeight(block.content);
  if (block.kind === "grid") return Array.isArray(block.items) && block.items.some((item) => hasFillHeight(item?.content));
  if (block.kind === "tabs") return Array.isArray(block.tabs) && block.tabs.some((tab) => hasFillHeight(tab?.content));
  return false;
}

function blockContainsRelatedList(block) {
  if (!block || typeof block !== "object") return false;
  if (block.kind === "related_list") return true;
  if (Array.isArray(block.content) && block.content.some(blockContainsRelatedList)) return true;
  if (Array.isArray(block.items) && block.items.some((item) => Array.isArray(item?.content) && item.content.some(blockContainsRelatedList))) return true;
  if (Array.isArray(block.tabs) && block.tabs.some((tab) => Array.isArray(tab?.content) && tab.content.some(blockContainsRelatedList))) return true;
  return false;
}

function isRelatedListWrapper(block) {
  if (!block || typeof block !== "object") return false;
  const content = Array.isArray(block.content) ? block.content : [];
  return content.length > 0 && content.every(blockContainsRelatedList);
}

function shouldSortRelatedBlocks(entries) {
  if (!Array.isArray(entries) || entries.length < 2) return false;
  return entries.every(({ block }) => blockContainsRelatedList(block));
}

function sumKnownRecordCounts(counts) {
  const values = Object.values(counts || {}).filter((value) => Number.isFinite(Number(value)));
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + Number(value || 0), 0);
}

function sortRelatedBlockEntries(entries, counts) {
  if (!shouldSortRelatedBlocks(entries)) return entries;
  return [...entries].sort((a, b) => {
    const aCount = counts?.[a.idx];
    const bCount = counts?.[b.idx];
    const aHasRecords = Number.isFinite(Number(aCount)) && Number(aCount) > 0;
    const bHasRecords = Number.isFinite(Number(bCount)) && Number(bCount) > 0;
    if (aHasRecords !== bHasRecords) return aHasRecords ? -1 : 1;
    return a.idx - b.idx;
  });
}

function StatValueSkeleton() {
  return <div className="h-8 w-20 animate-pulse rounded-md bg-base-200/80" />;
}

function ActivityItemSkeleton({ wide = false }) {
  return (
    <div className="card card-compact rounded-box border border-base-300 bg-base-100 text-sm">
      <div className="card-body gap-2 p-3">
        <div className={`h-3 animate-pulse rounded bg-base-200/80 ${wide ? "w-40" : "w-32"}`} />
        <div className="h-4 w-3/4 animate-pulse rounded bg-base-200/70" />
      </div>
    </div>
  );
}

export default function ContentBlocksRenderer({ blocks, renderView, recordId, searchParams, setSearchParams, manifest, moduleId, actionsMap, onNavigate, onRunAction, onConfirm, onPrompt, onLookupCreate, onFallback, externalRefreshTick = 0, previewMode = false, bootstrap = null, bootstrapVersion = 0, bootstrapLoading = false, canWriteRecords = null, recordContext = null, onPageSectionLoadingChange = null, onRecordCountChange = null, frameRelatedLists = true, relatedListFrameProvided = false }) {
  const safeBlocks = Array.isArray(blocks) ? blocks : [];
  const [blockRecordCounts, setBlockRecordCounts] = useState({});
  const isMobile = useMediaQuery("(max-width: 768px)");
  const inherited = useContext(RecordScopeContext);
  const fallbackContext = useMemo(
    () => (recordId ? { entityId: null, recordId, record: null, setRecord: () => {} } : null),
    [recordId]
  );
  const baseContext = recordContext || inherited || fallbackContext;
  const shouldProvideContext = Boolean(baseContext && baseContext !== inherited);
  const visibleBlockEntries = useMemo(
    () => safeBlocks
      .map((block, idx) => ({ block, idx }))
      .filter(({ block }) => isBlockVisible(block, baseContext?.record)),
    [safeBlocks, baseContext?.record]
  );
  const sortedVisibleBlockEntries = useMemo(
    () => sortRelatedBlockEntries(visibleBlockEntries, blockRecordCounts),
    [visibleBlockEntries, blockRecordCounts]
  );
  const visibleBlocks = sortedVisibleBlockEntries.map(({ block }) => block);
  const mobileRecordPage = isMobile && (visibleBlocks.some((block) => block?.kind === "record") || Boolean(recordContext?.recordId) || Boolean(recordId));
  const singleFillBlock = visibleBlocks.length === 1 && blockPrefersFill(visibleBlocks[0]);
  const fullHeight = !mobileRecordPage && (isMobile ? singleFillBlock : (hasViewModes(visibleBlocks) || hasFillHeight(visibleBlocks)));
  const { hasCapability } = useAccessContext();
  const effectiveCanWriteRecords =
    typeof canWriteRecords === "boolean"
      ? canWriteRecords
      : hasCapability("records.write") && bootstrap?.permissions?.records_write !== false;
  useEffect(() => {
    if (typeof onRecordCountChange !== "function") return;
    const total = sumKnownRecordCounts(blockRecordCounts);
    if (total === null) return;
    onRecordCountChange(total);
  }, [blockRecordCounts, onRecordCountChange]);

  const content = (
    <div className={fullHeight ? "h-full min-h-0 flex flex-col overflow-hidden gap-4" : "space-y-4"}>
      {sortedVisibleBlockEntries.map(({ block, idx }) => {
        const node = (
          <BlockRenderer
            key={`${block?.kind || "block"}-${idx}`}
            block={block}
            renderView={renderView}
            recordId={recordId}
            searchParams={searchParams}
            setSearchParams={setSearchParams}
            manifest={manifest}
            moduleId={moduleId}
            actionsMap={actionsMap}
            onNavigate={onNavigate}
            onRunAction={onRunAction}
            onConfirm={onConfirm}
            onPrompt={onPrompt}
            onLookupCreate={onLookupCreate}
            onFallback={onFallback}
            externalRefreshTick={externalRefreshTick}
            recordContext={baseContext}
            previewMode={previewMode}
            bootstrap={bootstrap}
            bootstrapVersion={bootstrapVersion}
            bootstrapLoading={bootstrapLoading}
            canWriteRecords={effectiveCanWriteRecords}
            onPageSectionLoadingChange={onPageSectionLoadingChange}
            frameRelatedLists={frameRelatedLists}
            relatedListFrameProvided={relatedListFrameProvided}
            onRecordCountChange={(count) => {
              setBlockRecordCounts((prev) => {
                if (prev[idx] === count) return prev;
                return { ...prev, [idx]: count };
              });
            }}
          />
        );
        if (!fullHeight || !blockPrefersFill(block)) return node;
        return (
          <div key={`wrap-${block?.kind || "block"}-${idx}`} className="flex-1 min-h-0 h-full overflow-hidden">
            {node}
          </div>
        );
      })}
    </div>
  );
  if (shouldProvideContext) {
    return <RecordScopeContext.Provider value={baseContext}>{content}</RecordScopeContext.Provider>;
  }
  return content;
}

function BlockRenderer({ block, renderView, recordId, searchParams, setSearchParams, manifest, moduleId, actionsMap, recordContext, onNavigate, onRunAction, onConfirm, onPrompt, onLookupCreate, onFallback, externalRefreshTick = 0, previewMode = false, bootstrap, bootstrapVersion, bootstrapLoading, canWriteRecords, onPageSectionLoadingChange = null, onRecordCountChange = null, frameRelatedLists = true, relatedListFrameProvided = false }) {
  const isMobile = useMediaQuery("(max-width: 768px)");
  const mobileRecordPage = isMobile && Boolean(recordContext?.recordId || recordId);
  const constrainHeight = !mobileRecordPage && (!isMobile || blockPrefersFill(block));
  const relatedListBlock = useMemo(
    () => (frameRelatedLists || relatedListFrameProvided ? { ...block, embedded_frame: true } : block),
    [block, frameRelatedLists, relatedListFrameProvided]
  );
  if (!block || typeof block !== "object") {
    return <div className="alert alert-warning">Invalid block</div>;
  }
  const kind = block.kind;

  if (kind === "view") {
    const viewId = normalizeViewTarget(block.target);
    if (!viewId) return <div className="alert alert-error">Invalid view target</div>;
    return (
      <div className={constrainHeight ? "flex-1 h-full min-h-0 flex flex-col overflow-hidden" : "flex flex-col"}>
        {renderView(viewId, recordContext, previewMode, { showViewTitle: false })}
      </div>
    );
  }

  if (kind === "view_modes") {
    return (
      <ScopedViewModesBlock
        block={block}
        manifest={manifest}
        moduleId={moduleId}
        searchParams={searchParams}
        setSearchParams={setSearchParams}
        onNavigate={onNavigate}
        onRunAction={onRunAction}
        actionsMap={actionsMap}
        onConfirm={onConfirm}
        onPrompt={onPrompt}
        onLookupCreate={onLookupCreate}
        onFallback={onFallback}
        externalRefreshTick={externalRefreshTick}
        previewMode={previewMode}
        bootstrap={bootstrap}
        bootstrapVersion={bootstrapVersion}
        bootstrapLoading={bootstrapLoading}
        canWriteRecords={canWriteRecords}
        recordContext={recordContext}
        onRecordCountChange={onRecordCountChange}
      />
    );
  }

  if (kind === "related_list") {
    const content = (
      <RelatedListBlock
        block={relatedListBlock}
        manifest={manifest}
        moduleId={moduleId}
        searchParams={searchParams}
        setSearchParams={setSearchParams}
        onNavigate={onNavigate}
        onRunAction={onRunAction}
        actionsMap={actionsMap}
        onConfirm={onConfirm}
        onPrompt={onPrompt}
        onLookupCreate={onLookupCreate}
        onFallback={onFallback}
        externalRefreshTick={externalRefreshTick}
        previewMode={previewMode}
        bootstrap={bootstrap}
        bootstrapVersion={bootstrapVersion}
        bootstrapLoading={bootstrapLoading}
        canWriteRecords={canWriteRecords}
        recordContext={recordContext}
        onRecordCountChange={onRecordCountChange}
      />
    );
    if (!frameRelatedLists) return content;
    return (
      <div className="min-w-0 rounded-box border border-base-300 bg-base-100 px-3 py-3">
        {content}
      </div>
    );
  }

  if (kind === "document_registry") {
    return (
      <div className={constrainHeight ? "flex-1 h-full min-h-0 flex flex-col overflow-hidden" : "flex flex-col"}>
        <DocumentRegistryBlock
          block={block}
          manifest={manifest}
          moduleId={moduleId}
          onNavigate={onNavigate}
          onConfirm={onConfirm}
          externalRefreshTick={externalRefreshTick}
          onPageSectionLoadingChange={onPageSectionLoadingChange}
        />
      </div>
    );
  }

  if (kind === "stack") {
    return (
      <div className={`${constrainHeight ? "h-full min-h-0" : ""} flex flex-col ${gapClass(block.gap)}`}>
        <ContentBlocksRenderer blocks={block.content} renderView={renderView} recordId={recordId} searchParams={searchParams} setSearchParams={setSearchParams} manifest={manifest} moduleId={moduleId} actionsMap={actionsMap} onNavigate={onNavigate} onRunAction={onRunAction} onConfirm={onConfirm} onPrompt={onPrompt} onLookupCreate={onLookupCreate} onFallback={onFallback} externalRefreshTick={externalRefreshTick} previewMode={previewMode} bootstrap={bootstrap} bootstrapVersion={bootstrapVersion} bootstrapLoading={bootstrapLoading} canWriteRecords={canWriteRecords} onPageSectionLoadingChange={onPageSectionLoadingChange} onRecordCountChange={onRecordCountChange} frameRelatedLists={frameRelatedLists} relatedListFrameProvided={relatedListFrameProvided} />
      </div>
    );
  }

  if (kind === "grid") {
    return (
      <div className={`grid grid-cols-12 items-stretch ${constrainHeight ? "h-full min-h-0" : ""} ${gapClass(block.gap)}`}>
        {(block.items || []).map((item, idx) => (
          <div key={`${item.span || "span"}-${idx}`} className={`${spanClass(item.span)} ${constrainHeight ? "h-full min-h-0 overflow-hidden" : ""} flex flex-col`}>
            <div className={`${constrainHeight ? "flex-1 min-h-0 overflow-hidden" : ""}`}>
              <ContentBlocksRenderer
                blocks={item.content}
                renderView={renderView}
                recordId={recordId}
                searchParams={searchParams}
                setSearchParams={setSearchParams}
                manifest={manifest}
                moduleId={moduleId}
                actionsMap={actionsMap}
                onNavigate={onNavigate}
                onRunAction={onRunAction}
                onConfirm={onConfirm}
                onPrompt={onPrompt}
                onLookupCreate={onLookupCreate}
                onFallback={onFallback}
                externalRefreshTick={externalRefreshTick}
                previewMode={previewMode}
                bootstrap={bootstrap}
                bootstrapVersion={bootstrapVersion}
                bootstrapLoading={bootstrapLoading}
                canWriteRecords={canWriteRecords}
                onPageSectionLoadingChange={onPageSectionLoadingChange}
                onRecordCountChange={onRecordCountChange}
                frameRelatedLists={frameRelatedLists}
                relatedListFrameProvided={relatedListFrameProvided}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (kind === "tabs") {
    const tabs = Array.isArray(block.tabs) ? block.tabs : [];
    const defaultId = block.default_tab || tabs[0]?.id || null;
    const [activeId, setActiveId] = useState(defaultId);
    const shouldFill = tabs.some((tab) => hasFillHeight(tab?.content) || hasViewModes(tab?.content));

    return (
      <div className={shouldFill ? "h-full min-h-0 flex flex-col overflow-hidden" : ""}>
        <div className="shrink-0">
          <Tabs tabs={tabs} activeId={activeId} onChange={setActiveId} />
        </div>
        <div className={shouldFill ? "mt-4 flex-1 min-h-0 overflow-hidden" : "mt-4"}>
          {tabs.map((tab) =>
            tab.id === activeId ? (
              <ContentBlocksRenderer key={tab.id} blocks={tab.content} renderView={renderView} recordId={recordId} searchParams={searchParams} setSearchParams={setSearchParams} manifest={manifest} moduleId={moduleId} actionsMap={actionsMap} onNavigate={onNavigate} onRunAction={onRunAction} onConfirm={onConfirm} onPrompt={onPrompt} onLookupCreate={onLookupCreate} onFallback={onFallback} externalRefreshTick={externalRefreshTick} previewMode={previewMode} bootstrap={bootstrap} bootstrapVersion={bootstrapVersion} bootstrapLoading={bootstrapLoading} canWriteRecords={canWriteRecords} onPageSectionLoadingChange={null} onRecordCountChange={onRecordCountChange} frameRelatedLists={frameRelatedLists} relatedListFrameProvided={relatedListFrameProvided} />
            ) : null
          )}
        </div>
      </div>
    );
  }

  if (kind === "text") {
    return <div className="prose max-w-none whitespace-pre-wrap">{block.text || ""}</div>;
  }

  if (kind === "stat_cards") {
    return (
      <StatCardsBlock
        block={block}
        moduleId={moduleId}
        recordContext={recordContext}
        onNavigate={onNavigate}
        externalRefreshTick={externalRefreshTick}
        onPageSectionLoadingChange={onPageSectionLoadingChange}
      />
    );
  }

  if (kind === "container") {
    const variant = block.variant || "card";
    const relatedListWrapper = isRelatedListWrapper(block);
    const title = relatedListWrapper ? null : block.title;
    const hasInnerScroll = Array.isArray(block.content) && block.content.some((b) => b?.kind === "view" || b?.kind === "view_modes" || b?.kind === "document_registry" || b?.kind === "tabs");
    const shouldFill = Array.isArray(block.content) && block.content.some((b) => b?.kind === "view" || b?.kind === "view_modes" || b?.kind === "document_registry" || b?.kind === "chatter" || b?.kind === "tabs");
    const content = (
      <ContentBlocksRenderer
        blocks={block.content || []}
        renderView={renderView}
        recordId={recordId}
        searchParams={searchParams}
        setSearchParams={setSearchParams}
        manifest={manifest}
        moduleId={moduleId}
        actionsMap={actionsMap}
        onNavigate={onNavigate}
        onRunAction={onRunAction}
        onConfirm={onConfirm}
        onPrompt={onPrompt}
        onLookupCreate={onLookupCreate}
        onFallback={onFallback}
        externalRefreshTick={externalRefreshTick}
        previewMode={previewMode}
        bootstrap={bootstrap}
        bootstrapVersion={bootstrapVersion}
        bootstrapLoading={bootstrapLoading}
        canWriteRecords={canWriteRecords}
        onPageSectionLoadingChange={onPageSectionLoadingChange}
        onRecordCountChange={onRecordCountChange}
        frameRelatedLists={!relatedListWrapper}
        relatedListFrameProvided={relatedListWrapper}
      />
    );
    if (variant === "panel") {
      const panelContentPadding = relatedListWrapper
        ? "px-3 py-3"
        : `${isMobile ? "px-4 pb-4" : "px-4 pb-4"} ${title ? (isMobile ? "pt-3" : "pt-3") : (isMobile ? "pt-4" : "pt-4")}`;
      const panelSurfaceClass = relatedListWrapper
        ? "border border-base-300 bg-base-100"
        : "bg-base-200";
      return (
        <div className={`${panelSurfaceClass} ${isMobile ? "rounded-none" : "rounded-box"} ${shouldFill && constrainHeight ? "h-full min-h-0" : ""} flex flex-col ${constrainHeight ? "overflow-hidden" : ""}`}>
          {title && (
            <div className={`shrink-0 text-sm font-semibold ${isMobile ? "px-4 pt-4" : "px-4 pt-4"}`}>
              {title}
            </div>
          )}
          <div className={`${constrainHeight ? "flex-1 min-h-0" : ""} ${constrainHeight ? (hasInnerScroll ? "overflow-hidden flex flex-col" : "overflow-auto") : ""} ${panelContentPadding}`}>{content}</div>
        </div>
      );
    }
    if (variant === "flat") {
      return (
        <div className={`${shouldFill && constrainHeight ? "h-full min-h-0" : ""} flex flex-col ${constrainHeight ? "overflow-hidden" : ""}`}>
          {title && (
            <div className="shrink-0 text-sm font-semibold">
              {title}
            </div>
          )}
          <div className={`${constrainHeight ? "flex-1 min-h-0" : ""} ${constrainHeight ? (hasInnerScroll ? "overflow-hidden flex flex-col" : "overflow-auto") : ""} ${title ? "pt-3" : ""}`}>{content}</div>
        </div>
      );
    }
    return (
      <div className={`card bg-base-100 shadow ${isMobile ? "rounded-none" : ""} ${shouldFill && constrainHeight ? "h-full min-h-0" : ""} flex flex-col ${constrainHeight ? "overflow-hidden" : ""}`}>
        <div className={`card-body ${isMobile ? "p-4" : ""} ${constrainHeight ? "flex-1 min-h-0" : ""} flex flex-col ${constrainHeight ? "overflow-hidden" : ""}`}>
          {title && <div className="shrink-0 text-sm font-semibold">{title}</div>}
          <div className={`${constrainHeight ? "flex-1 min-h-0" : ""} ${constrainHeight ? (hasInnerScroll ? "overflow-hidden flex flex-col" : "overflow-auto") : ""} ${title ? (isMobile ? "pt-3" : "pt-3") : ""}`}>{content}</div>
        </div>
      </div>
    );
  }

  if (kind === "record") {
    const entityId = block.entity_id;
    const queryKey = block.record_id_query || "record";
    const recordIdFromQuery = searchParams?.get ? searchParams.get(queryKey) : null;
    if (!entityId) return <div className="alert alert-warning">Record block missing entity_id</div>;
    if (isMobile) {
      return (
        <RecordScopeProvider
          entityId={entityId}
          recordId={recordIdFromQuery}
          previewMode={previewMode}
        >
          <ContentBlocksRenderer
            blocks={block.content || []}
            renderView={renderView}
            recordId={recordIdFromQuery}
            searchParams={searchParams}
            setSearchParams={setSearchParams}
            manifest={manifest}
            moduleId={moduleId}
            actionsMap={actionsMap}
            onNavigate={onNavigate}
            onRunAction={onRunAction}
            onConfirm={onConfirm}
            onPrompt={onPrompt}
            onLookupCreate={onLookupCreate}
            onFallback={onFallback}
            externalRefreshTick={externalRefreshTick}
            previewMode={previewMode}
            bootstrap={bootstrap}
            bootstrapVersion={bootstrapVersion}
            bootstrapLoading={bootstrapLoading}
            canWriteRecords={canWriteRecords}
            onPageSectionLoadingChange={onPageSectionLoadingChange}
            onRecordCountChange={onRecordCountChange}
            frameRelatedLists={frameRelatedLists}
            relatedListFrameProvided={relatedListFrameProvided}
          />
        </RecordScopeProvider>
      );
    }
    return (
      <div className="h-full min-h-0 flex flex-col overflow-hidden">
        <RecordScopeProvider
          entityId={entityId}
          recordId={recordIdFromQuery}
          previewMode={previewMode}
        >
          <div className="flex-1 min-h-0 overflow-hidden">
            <ContentBlocksRenderer
              blocks={block.content || []}
              renderView={renderView}
              recordId={recordIdFromQuery}
              searchParams={searchParams}
              setSearchParams={setSearchParams}
              manifest={manifest}
              moduleId={moduleId}
              actionsMap={actionsMap}
              onNavigate={onNavigate}
              onRunAction={onRunAction}
              onConfirm={onConfirm}
              onPrompt={onPrompt}
              onLookupCreate={onLookupCreate}
              onFallback={onFallback}
              externalRefreshTick={externalRefreshTick}
              previewMode={previewMode}
              bootstrap={bootstrap}
              bootstrapVersion={bootstrapVersion}
              bootstrapLoading={bootstrapLoading}
              canWriteRecords={canWriteRecords}
              onPageSectionLoadingChange={onPageSectionLoadingChange}
              onRecordCountChange={onRecordCountChange}
              frameRelatedLists={frameRelatedLists}
              relatedListFrameProvided={relatedListFrameProvided}
            />
          </div>
        </RecordScopeProvider>
      </div>
    );
  }

  if (kind === "toolbar") {
    const align = block.align || "right";
    const actions = Array.isArray(block.actions) ? block.actions : [];
    return (
      <ToolbarBlock actions={actions} align={align} actionsMap={actionsMap} moduleId={moduleId} recordContext={recordContext} onNavigate={onNavigate} onConfirm={onConfirm} previewMode={previewMode} />
    );
  }

  if (kind === "statusbar") {
    return <StatusBarBlock block={block} manifest={manifest} recordContext={recordContext} />;
  }

  if (kind === "chatter") {
    if (previewMode) {
      return (
        <div className="alert bg-base-200 text-base-content border border-base-300">
          {translateRuntime("common.activity_panel.preview_unavailable")}
        </div>
      );
    }
    const entityId = block.entity_id || recordContext?.entityId;
    const ref = block.record_ref || (recordContext?.recordId ? "$record.id" : null);
    let resolvedId = recordId || recordContext?.recordId;
    if (typeof ref === "string" && ref !== "$record.id") {
      resolvedId = ref;
    }
    if (isMobile) {
      return (
        <div className="pt-1">
          <div className="text-sm font-semibold mb-2">{translateRuntime("common.activity_and_attachments")}</div>
          <ChatterPanel entityId={entityId} recordId={resolvedId} onPageSectionLoadingChange={onPageSectionLoadingChange} />
        </div>
      );
    }
    return <ChatterPanel entityId={entityId} recordId={resolvedId} onPageSectionLoadingChange={onPageSectionLoadingChange} />;
  }

  if (previewMode) {
    return null;
  }
  return <div className="alert alert-warning">Unsupported block kind: {kind}</div>;
}

function ScopedViewModesBlock(props) {
  const useLocalParams =
    props?.block?.compact === true ||
    props?.block?.param_scope === "local" ||
    props?.block?.embedded_related_list === true ||
    Boolean(props?.recordContext?.recordId);
  const [localSearchParams, setLocalSearchParams] = useState(() => new URLSearchParams());

  function handleSetLocalSearchParams(next) {
    if (next instanceof URLSearchParams) {
      setLocalSearchParams(new URLSearchParams(next.toString()));
      return;
    }
    if (typeof next === "string") {
      setLocalSearchParams(new URLSearchParams(next));
      return;
    }
    setLocalSearchParams(new URLSearchParams());
  }

  return (
    <ViewModesBlock
      {...props}
      searchParams={useLocalParams ? localSearchParams : props.searchParams}
      setSearchParams={useLocalParams ? handleSetLocalSearchParams : props.setSearchParams}
    />
  );
}

function findView(manifest, viewId) {
  const views = Array.isArray(manifest?.views) ? manifest.views : [];
  return views.find((view) => view?.id === viewId) || null;
}

function findEntity(manifest, entityId) {
  const entities = Array.isArray(manifest?.entities) ? manifest.entities : [];
  return entities.find((entity) => entity?.id === entityId) || null;
}

function moduleIdFromManifest(manifest) {
  return manifest?.module?.id || manifest?.module?.key || null;
}

function RelatedListBlock({
  block,
  manifest,
  moduleId,
  searchParams,
  setSearchParams,
  onNavigate,
  onRunAction,
  actionsMap,
  onConfirm,
  onPrompt,
  onLookupCreate,
  onFallback,
  externalRefreshTick,
  previewMode,
  bootstrap,
  bootstrapVersion,
  bootstrapLoading,
  canWriteRecords,
  recordContext,
  onRecordCountChange,
}) {
  const targetViewId = normalizeViewTarget(block?.target || block?.view);
  const entityId = block?.entity_id;
  const [externalManifest, setExternalManifest] = useState(null);
  const [externalState, setExternalState] = useState({ status: "idle", error: null });

  const localView = targetViewId ? findView(manifest, targetViewId) : null;
  const localEntity = entityId ? findEntity(manifest, entityId) : null;
  const needsExternalManifest = Boolean(targetViewId && entityId && (!localView || !localEntity || block?.target_module_id));
  const targetModuleId = block?.target_module_id || block?.module_id || block?.module || null;
  const effectiveManifest = externalManifest || manifest;
  const effectiveModuleId = moduleIdFromManifest(effectiveManifest) || targetModuleId || moduleId;

  useEffect(() => {
    let cancelled = false;
    async function loadExternalManifest() {
      if (!needsExternalManifest) {
        setExternalManifest(null);
        setExternalState({ status: "idle", error: null });
        return;
      }
      setExternalState({ status: "loading", error: null });
      try {
        if (targetModuleId) {
          const res = await getManifest(targetModuleId);
          if (!cancelled) {
            setExternalManifest(res?.manifest || null);
            setExternalState({ status: "idle", error: null });
          }
          return;
        }
        const modulesRes = await apiFetch("/modules");
        const modules = Array.isArray(modulesRes?.modules) ? modulesRes.modules : Array.isArray(modulesRes) ? modulesRes : [];
        for (const mod of modules) {
          const candidateModuleId = mod?.module_id || mod?.id || mod?.moduleId;
          if (!candidateModuleId || candidateModuleId === moduleId) continue;
          let candidate;
          try {
            candidate = await getManifest(candidateModuleId);
          } catch {
            continue;
          }
          const candidateManifest = candidate?.manifest;
          if (findView(candidateManifest, targetViewId) && findEntity(candidateManifest, entityId)) {
            if (!cancelled) {
              setExternalManifest(candidateManifest);
              setExternalState({ status: "idle", error: null });
            }
            return;
          }
        }
        if (!cancelled) {
          setExternalManifest(null);
          setExternalState({ status: "error", error: "Related list view not found" });
        }
      } catch (err) {
        if (!cancelled) {
          setExternalManifest(null);
          setExternalState({ status: "error", error: err?.message || "Related list view not found" });
        }
      }
    }
    loadExternalManifest();
    return () => {
      cancelled = true;
    };
  }, [needsExternalManifest, targetModuleId, targetViewId, entityId, moduleId]);

  const mappedBlock = useMemo(
    () => ({
      kind: "view_modes",
      entity_id: entityId,
      default_mode: "list",
      modes: [{ mode: "list", target: `view:${targetViewId || ""}` }],
      record_domain: block.record_domain || null,
      create_defaults: block.create_defaults || null,
      create_mode: block.create_mode || block.createMode || null,
      create_modal: block.create_modal !== false,
      allow_create:
        (block.create_modal !== false || block.create_mode === "page" || block.createMode === "page") &&
        block.allow_create !== false &&
        block.show_create !== false,
      target_module_id: effectiveModuleId,
      param_scope: block.param_scope || "local",
      page_size: block.page_size || 10,
      embedded_related_list: true,
      embedded_related_list_frame_provided: block.embedded_frame === true,
    }),
    [
      block.allow_create,
      block.createMode,
      block.create_defaults,
      block.create_modal,
      block.create_mode,
      block.embedded_frame,
      block.page_size,
      block.param_scope,
      block.record_domain,
      block.show_create,
      effectiveModuleId,
      entityId,
      targetViewId,
    ]
  );

  const effectiveActionsMap = useMemo(() => {
    const map = new Map();
    for (const action of (Array.isArray(effectiveManifest?.actions) ? effectiveManifest.actions : [])) {
      if (action?.id) map.set(action.id, action);
    }
    return map.size ? map : actionsMap;
  }, [effectiveManifest, actionsMap]);

  const effectiveRunAction = useCallback(
    (action, runtimeContext = {}) => {
      if (!onRunAction) return null;
      return onRunAction(action, {
        ...runtimeContext,
        moduleId: effectiveModuleId,
      });
    },
    [onRunAction, effectiveModuleId]
  );

  if (!targetViewId) return <div className="alert alert-error">related_list requires a list view target</div>;
  if (externalState.status === "loading") {
    return <div className="text-sm text-base-content/60">Loading related records...</div>;
  }
  if (externalState.status === "error") {
    return <div className="alert alert-error">{externalState.error}</div>;
  }

  return (
    <ScopedViewModesBlock
      block={mappedBlock}
      manifest={effectiveManifest}
      moduleId={effectiveModuleId}
      searchParams={searchParams}
      setSearchParams={setSearchParams}
      onNavigate={onNavigate}
      onRunAction={effectiveRunAction}
      actionsMap={effectiveActionsMap}
      onConfirm={onConfirm}
      onPrompt={onPrompt}
      onLookupCreate={onLookupCreate}
      onFallback={onFallback}
      externalRefreshTick={externalRefreshTick}
      previewMode={previewMode}
      bootstrap={needsExternalManifest ? null : bootstrap}
      bootstrapVersion={bootstrapVersion}
      bootstrapLoading={needsExternalManifest ? false : bootstrapLoading}
      canWriteRecords={canWriteRecords}
      recordContext={recordContext}
      forceListOnly={true}
      onRecordCountChange={onRecordCountChange}
    />
  );
}

function findField(manifest, entityId, fieldId) {
  const entities = Array.isArray(manifest?.entities) ? manifest.entities : [];
  const entity = entities.find((e) => e.id === entityId || e.id === `entity.${entityId}`);
  if (!entity) return null;
  const fields = Array.isArray(entity.fields) ? entity.fields : [];
  return fields.find((f) => f.id === fieldId) || null;
}

function StatusBar({ field, value }) {
  if (!field || !Array.isArray(field.options)) {
    return <div className="alert alert-warning">Statusbar requires enum field</div>;
  }
  const options = field.options.map((opt) => {
    if (typeof opt === "string") return { value: opt, label: opt };
    if (opt && typeof opt === "object") return opt;
    return null;
  }).filter(Boolean);
  return (
    <div className="w-full overflow-x-auto md:overflow-visible no-scrollbar">
      <ul className="steps steps-horizontal w-full min-w-max md:min-w-0">
        {options.map((opt) => {
          const isActive = value === opt.value;
          return (
            <li key={opt.value} className={`step whitespace-nowrap text-xs sm:text-sm ${isActive ? "step-primary" : ""}`}>
              {opt.label ?? opt.value}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ToolbarBlock({ actions, align, actionsMap, moduleId, recordContext, onNavigate, onConfirm, previewMode = false }) {
  const justify =
    align === "left" ? "justify-start" : align === "between" ? "justify-between" : "justify-end";
  return (
    <div className={`flex flex-wrap gap-2 ${justify}`}>
      {actions.map((a, idx) => (
        <ToolbarAction key={`${a.action_id || "action"}-${idx}`} action={a} actionsMap={actionsMap} moduleId={moduleId} recordContext={recordContext} onNavigate={onNavigate} onConfirm={onConfirm} previewMode={previewMode} />
      ))}
    </div>
  );
}

function fallbackActionLabel(action) {
  const kind = action?.kind;
  if (kind === "create_record" || kind === "open_form") return "New";
  if (kind === "update_record") return "Save";
  if (kind === "refresh") return "Refresh";
  if (kind === "navigate") return "Open";
  return "Action";
}

function ToolbarAction({ action, actionsMap, moduleId, recordContext, onNavigate, onConfirm, previewMode = false }) {
  const resolved = action?.action_id ? actionsMap?.get(action.action_id) : null;
  if (!resolved) return null;
  const label = resolved.label || fallbackActionLabel(resolved);
  const visible = resolved.visible_when ? evalConditionSafe(resolved.visible_when, recordContext?.record) : true;
  if (!visible) return null;
  const enabled = resolved.enabled_when ? evalConditionSafe(resolved.enabled_when, recordContext?.record) : true;

  return (
    <button
      className="btn btn-outline btn-sm"
      disabled={!enabled || previewMode}
      onClick={() => {
        if (previewMode) return;
        runToolbarAction(resolved, moduleId, recordContext, onNavigate, onConfirm);
      }}
    >
      {label}
    </button>
  );
}

async function runToolbarAction(action, moduleId, recordContext, onNavigate, onConfirm) {
  if (!action?.id || !moduleId) return;
  if (action.confirm && typeof action.confirm === "object") {
    if (!onConfirm) return;
    const title = action.confirm.title || "Confirm";
    const body = action.confirm.body || "Are you sure?";
    const ok = await onConfirm({ title, body });
    if (!ok) return;
  }
  const res = await apiFetch("/actions/run", {
    method: "POST",
    body: JSON.stringify({
      module_id: moduleId,
      action_id: action.id,
      context: {
        record_id: recordContext?.recordId || null,
        record_draft: recordContext?.record || {},
      },
    }),
  });
  const result = res.result || {};
  if (onNavigate && result?.kind === "navigate" && result.target) {
    onNavigate(result.target);
  }
  if (onNavigate && result?.kind === "open_form" && result.target) {
    onNavigate(`view:${result.target}`);
  }
}

function evalConditionSafe(condition, record) {
  if (!condition) return false;
  try {
    return evalCondition(condition, { record: record || {} });
  } catch {
    return false;
  }
}

function isBlockVisible(block, record) {
  if (!block || typeof block !== "object") return true;
  if (block.visible_when && !evalConditionSafe(block.visible_when, record)) return false;
  if (block.hidden_when && evalConditionSafe(block.hidden_when, record)) return false;
  return true;
}

function buildStatCardShells(block) {
  return (Array.isArray(block?.cards) ? block.cards : []).map((card) => ({
    ...card,
    value: card.value ?? null,
    error: card.error || "",
  }));
}

function StatCardsBlock({
  block,
  moduleId,
  recordContext,
  onNavigate,
  externalRefreshTick = 0,
  onPageSectionLoadingChange = null,
}) {
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [cards, setCards] = useState(() => buildStatCardShells(block));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const sectionKey = useMemo(
    () => `stat_cards:${moduleId || "module"}:${block?.id || block?.title || "cards"}`,
    [moduleId, block?.id, block?.title]
  );

  useEffect(() => {
    setCards(buildStatCardShells(block));
    setError("");
    setLoading(Array.isArray(block?.cards) && block.cards.length > 0);
  }, [block]);

  useEffect(() => {
    onPageSectionLoadingChange?.(sectionKey, loading);
    return () => onPageSectionLoadingChange?.(sectionKey, false);
  }, [onPageSectionLoadingChange, sectionKey, loading]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const definedCards = buildStatCardShells(block);
      if (!definedCards.length) {
        setCards([]);
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        setError("");
        const sourceRes = await apiFetch("/system/dashboard/sources");
        const sources = Array.isArray(sourceRes?.sources) ? sourceRes.sources : [];
        const results = await Promise.allSettled(
          definedCards.map(async (card) => {
            const source =
              sources.find((item) => item?.entity_id === card.entity_id && item?.module_id === moduleId) ||
              sources.find((item) => item?.entity_id === card.entity_id) ||
              null;
            if (!source?.source_key) {
              return {
                id: card.id,
                value: null,
                error: "Source unavailable",
              };
            }
            const filter = resolveBlockRefs(card.domain, {
              record: recordContext?.record || {},
              recordId: recordContext?.recordId || null,
            });
            const response = await apiFetch("/system/dashboard/query", {
              method: "POST",
              body: {
                source_key: source.source_key,
                measure: card.measure || "count",
                date_field: card.date_field || undefined,
                filter: filter || undefined,
              },
            });
            return {
              id: card.id,
              value: response?.value ?? 0,
              error: "",
            };
          })
        );
        if (cancelled) return;
        const valueMap = new Map(
          results.map((item, idx) => {
            if (item?.status === "fulfilled") return [item.value.id, item.value];
            const card = definedCards[idx] || {};
            return [
              card.id,
              {
                id: card.id,
                value: null,
                error: item?.reason?.message || "Metric unavailable",
              },
            ];
          })
        );
        setCards(
          definedCards.map((card) => ({
            ...card,
            value: valueMap.get(card.id)?.value ?? null,
            error: valueMap.get(card.id)?.error || "",
          }))
        );
      } catch (err) {
        if (cancelled) return;
        setError("Dashboard metrics are unavailable right now.");
        setCards(buildStatCardShells(block));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [block, moduleId, recordContext?.record, recordContext?.recordId, externalRefreshTick]);

  const desktopColumns = Math.max(1, cards.length || Number(block?.columns) || 4);
  const gridStyle = isMobile ? undefined : { gridTemplateColumns: `repeat(${desktopColumns}, minmax(0, 1fr))` };

  return (
    <div className="space-y-3">
      {block?.title ? <div className="text-sm font-semibold">{block.title}</div> : null}
      {error ? <div className="alert alert-error">{error}</div> : null}
      <div className={`grid grid-cols-1 ${isMobile ? "gap-0" : "gap-4"}`} style={gridStyle}>
        {cards.map((card) => {
          const clickable = typeof card.target === "string" && card.target && typeof onNavigate === "function";
          const toneClass =
            card.tone === "success"
              ? "text-success"
              : card.tone === "warning"
                ? "text-warning"
                : card.tone === "error"
                  ? "text-error"
                  : "text-primary";
          const content = (
            <div className={`card bg-base-100 shadow-sm ${isMobile ? "rounded-none border-0" : "rounded-box border border-base-300"} h-full`}>
              <div className="card-body gap-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs uppercase tracking-wide text-base-content/60 break-words">{card.label}</div>
                    {card.subtitle ? <div className="mt-1 text-xs text-base-content/50">{card.subtitle}</div> : null}
                  </div>
                  {card.icon ? (
                    <div className={`shrink-0 ${toneClass}`}>
                      <AppModuleIcon iconUrl={`lucide:${card.icon}`} size={18} strokeWidth={2} iconClassName={toneClass} fallback={null} />
                    </div>
                  ) : null}
                </div>
                <div className="text-3xl font-semibold leading-none">
                  {loading ? (
                    <StatValueSkeleton />
                  ) : card.error ? (
                    <span className="text-base-content/35">-</span>
                  ) : (
                    formatStatCardValue(card.value, card.format)
                  )}
                </div>
                {card.error ? <div className="text-xs text-error">{card.error}</div> : null}
              </div>
            </div>
          );
          if (!clickable) return <div key={card.id} className="min-w-0">{content}</div>;
          return (
            <button
              key={card.id}
              type="button"
              className="block h-full w-full min-w-0 text-left"
              onClick={() => onNavigate(card.target)}
            >
              {content}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RecordScopeProvider({ entityId, recordId, children, previewMode = false }) {
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hiddenFields, setHiddenFields] = useState([]);

  useEffect(() => {
    async function load() {
      if (previewMode) {
        setRecord(null);
        setLoading(false);
        setError(null);
        return;
      }
      if (!entityId || !recordId) {
        setRecord(null);
        setLoading(false);
        setError(null);
        return;
      }
      try {
        setLoading(true);
        setError(null);
        const res = await apiFetch(`/records/${entityId}/${recordId}`, { cacheTtl: 5000 });
        setRecord(res.record || null);
        setLoading(false);
      } catch {
        setRecord(null);
        setLoading(false);
        setError("Record not found");
      }
    }
    load();
  }, [entityId, recordId, previewMode]);

  const registerHiddenField = useMemo(
    () => (fieldId) => {
      if (!fieldId) return;
      setHiddenFields((prev) => (prev.includes(fieldId) ? prev : [...prev, fieldId]));
    },
    []
  );
  const value = useMemo(
    () => ({ entityId, recordId, record, setRecord, recordLoading: loading, recordError: error, hiddenFields, registerHiddenField }),
    [entityId, recordId, record, loading, error, hiddenFields, registerHiddenField]
  );
  return <RecordScopeContext.Provider value={value}>{children}</RecordScopeContext.Provider>;
}

function StatusBarBlock({ block, manifest, recordContext }) {
  const entityId = block.entity_id || recordContext?.entityId;
  const fieldId = block.field_id;
  const record = recordContext?.record;
  useEffect(() => {
    if (recordContext?.registerHiddenField && fieldId) {
      recordContext.registerHiddenField(fieldId);
    }
  }, [recordContext, fieldId]);
  if (!entityId || !fieldId) return <div className="alert alert-warning">Statusbar missing entity_id/field_id</div>;
  const value = record ? record[fieldId] : null;
  const field = findField(manifest, entityId, fieldId);
  return <StatusBar field={field} value={value} />;
}

function ChatterPanel({ entityId, recordId, onPageSectionLoadingChange = null }) {
  const { hasCapability } = useAccessContext();
  const canWriteRecords = hasCapability("records.write");
  const [items, setItems] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [activeTab, setActiveTab] = useState("activity");
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [deletingAttachmentId, setDeletingAttachmentId] = useState("");
  const [attachmentToDelete, setAttachmentToDelete] = useState(null);
  const [error, setError] = useState("");
  const [currentUserLabel, setCurrentUserLabel] = useState("You");
  const [members, setMembers] = useState([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const sectionKey = useMemo(
    () => `chatter:${entityId || "entity"}:${recordId || "record"}`,
    [entityId, recordId]
  );
  const quickAttachInputRef = useRef(null);
  const listRef = useRef(null);
  const pollTimerRef = useRef(null);
  const latestSeenAtRef = useRef(null);
  const burstUntilRef = useRef(0);
  const lastAttachmentRefreshAtRef = useRef(0);
  const lastPollAtRef = useRef(0);

  const DEFAULT_POLL_MS = 15000;
  const BURST_POLL_MS = 3000;
  const BURST_WINDOW_MS = 30000;
  const ATTACHMENTS_POLL_MS = 20000;

  async function fetchActivity({ since } = {}) {
    const qs = new URLSearchParams({
      entity_id: String(entityId || ""),
      record_id: String(recordId || ""),
      limit: "100",
    });
    if (since) qs.set("since", String(since));
    const res = await apiFetch(`/api/activity?${qs.toString()}`);
    return Array.isArray(res.items) ? res.items : [];
  }

  async function fetchAttachments() {
    const att = await apiFetch(`/records/${entityId}/${recordId}/attachments`);
    return att.attachments || [];
  }

  function mergeIncoming(prev, incoming) {
    const allPrev = Array.isArray(prev) ? prev : [];
    const temps = allPrev.filter((item) => String(item?.id || "").startsWith("temp-"));
    const existing = allPrev.filter((item) => !String(item?.id || "").startsWith("temp-"));
    const merged = [...(Array.isArray(incoming) ? incoming : []), ...existing, ...temps];
    const seen = new Set();
    return merged.filter((item) => {
      const id = String(item?.id || "");
      if (!id) return false;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  function itemAuthor(item) {
    const author = item?.author;
    if (!author || typeof author !== "object") return "System";
    return author.name || author.email || "System";
  }

  function humanizeValue(value) {
    if (value === null || value === undefined || value === "") return `(${translateRuntime("common.activity_panel.empty_value")})`;
    const text = String(value).replace(/_/g, " ").trim();
    if (!text) return `(${translateRuntime("common.activity_panel.empty_value")})`;
    return text.replace(/\b\w/g, (m) => m.toUpperCase());
  }

  function classifyEvent(item) {
    if (item?.event_type === "attachment") return "attachment_event";
    if (item?.event_type === "change") return "system_event";
    return "user_note";
  }

  useEffect(() => {
    async function load() {
      if (!entityId || !recordId) return;
      setLoading(true);
      setError("");
      try {
        const [serverItems, nextAtt] = await Promise.all([fetchActivity(), fetchAttachments()]);
        setItems(serverItems);
        latestSeenAtRef.current = serverItems[0]?.created_at || null;
        setAttachments(nextAtt);
        lastAttachmentRefreshAtRef.current = Date.now();
      } catch (err) {
        setItems([]);
        setAttachments([]);
        setError(err?.message || translateRuntime("common.activity_panel.load_failed"));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [entityId, recordId]);

  useEffect(() => {
    if (!entityId || !recordId) return undefined;
    return subscribeRecordMutations((detail) => {
      if (!detail || detail.entityId !== entityId) return;
      const ids = Array.isArray(detail.recordIds)
        ? detail.recordIds.map((value) => String(value || "")).filter(Boolean)
        : detail.recordId
          ? [String(detail.recordId)]
          : [];
      if (!ids.includes(String(recordId))) return;
      fetchAttachments()
        .then((nextAtt) => {
          setAttachments(nextAtt);
          lastAttachmentRefreshAtRef.current = Date.now();
        })
        .catch((err) => console.warn("chatter_attachment_refresh_failed", err));
      if (activeTab === "activity") {
        fetchActivity()
          .then((serverItems) => {
            setItems(serverItems);
            latestSeenAtRef.current = serverItems[0]?.created_at || latestSeenAtRef.current;
          })
          .catch((err) => console.warn("chatter_activity_refresh_failed", err));
      }
    });
  }, [entityId, recordId, activeTab]);

  useEffect(() => {
    onPageSectionLoadingChange?.(sectionKey, loading);
    return () => onPageSectionLoadingChange?.(sectionKey, false);
  }, [onPageSectionLoadingChange, sectionKey, loading]);

  useEffect(() => {
    if (!entityId || !recordId) return undefined;
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = null;
    let stopped = false;

    function nextDelay() {
      const now = Date.now();
      const burst = now < (burstUntilRef.current || 0);
      if (activeTab === "activity") return burst ? BURST_POLL_MS : DEFAULT_POLL_MS;
      // Attachments don't need to be as aggressive.
      return burst ? Math.max(5000, BURST_POLL_MS * 2) : ATTACHMENTS_POLL_MS;
    }

    function scheduleNext() {
      if (stopped) return;
      pollTimerRef.current = setTimeout(tick, nextDelay());
    }

    async function tick() {
      // Avoid fighting local optimistic UI. We'll still merge in local temps.
      try {
        lastPollAtRef.current = Date.now();
        if (activeTab === "activity") {
          const since = latestSeenAtRef.current;
          const incoming = await fetchActivity(since ? { since } : undefined);
          if (incoming.length > 0) {
            latestSeenAtRef.current = incoming[0]?.created_at || latestSeenAtRef.current;
            setItems((prev) => mergeIncoming(prev, incoming));

            // If a new attachment event arrived, refresh the attachment list too.
            const hasNewAttachment = incoming.some((it) => it?.event_type === "attachment");
            const staleAtt = Date.now() - (lastAttachmentRefreshAtRef.current || 0) > ATTACHMENTS_POLL_MS;
            if (hasNewAttachment && staleAtt) {
              const nextAtt = await fetchAttachments();
              setAttachments(nextAtt);
              lastAttachmentRefreshAtRef.current = Date.now();
            }
          }
        } else if (activeTab === "attachments") {
          const staleAtt = Date.now() - (lastAttachmentRefreshAtRef.current || 0) > ATTACHMENTS_POLL_MS;
          if (staleAtt) {
            const nextAtt = await fetchAttachments();
            setAttachments(nextAtt);
            lastAttachmentRefreshAtRef.current = Date.now();
          }
        }
      } catch (err) {
        // Quietly ignore; next tick will retry. We don't want background polling to spam errors.
        console.warn("chatter_poll_failed", err);
      } finally {
        scheduleNext();
      }
    }

    scheduleNext();

    function onVisibility() {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - (lastPollAtRef.current || 0) < 5000) return;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
      tick();
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    };
  }, [activeTab, entityId, recordId]);

  useEffect(() => {
    let mounted = true;
    async function loadCurrentUser() {
      try {
        const session = await getSafeSession();
        const user = session?.user;
        const label = user?.email || user?.user_metadata?.full_name || "You";
        if (mounted) setCurrentUserLabel(label);
      } catch {
        if (mounted) setCurrentUserLabel("You");
      }
    }
    loadCurrentUser();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    async function loadMembers() {
      try {
        const res = await apiFetch("/access/members");
        const rows = Array.isArray(res?.members) ? res.members : [];
        if (mounted) {
          setMembers(
            rows.filter(
              (member) =>
                (typeof member?.email === "string" && member.email.trim()) ||
                (typeof member?.name === "string" && member.name.trim()) ||
                (typeof member?.user_id === "string" && member.user_id.trim())
            )
          );
        }
      } catch {
        if (mounted) setMembers([]);
      }
    }
    loadMembers();
    return () => {
      mounted = false;
    };
  }, []);

  function parseMentionTokens(value, allMembers = []) {
    if (typeof value !== "string" || !value.trim()) return [];
    const normalizeNameToken = (v) => String(v || "").trim().toLowerCase().replace(/\s+/g, "");
    const byEmail = new Map(
      (Array.isArray(allMembers) ? allMembers : [])
        .map((member) => [String(member?.email || "").trim().toLowerCase(), String(member?.user_id || "").trim()])
        .filter(([email]) => email)
    );
    const byName = new Map(
      (Array.isArray(allMembers) ? allMembers : [])
        .map((member) => [normalizeNameToken(member?.name), String(member?.user_id || "").trim()])
        .filter(([name, userId]) => name && userId)
    );
    const seen = new Set();
    const out = [];
    const matches = value.match(/@[A-Z0-9._%+\-@]+/gi) || [];
    for (const raw of matches) {
      const token = raw.slice(1).toLowerCase();
      const mapped = byEmail.get(token) || byName.get(normalizeNameToken(token)) || token;
      if (!mapped || seen.has(mapped)) continue;
      seen.add(mapped);
      out.push(mapped);
    }
    return out;
  }

  function getActiveMentionQuery(value) {
    if (typeof value !== "string") return null;
    const match = value.match(/(?:^|\s)@([^\s@]*)$/);
    if (!match) return null;
    return String(match[1] || "");
  }

  function replaceTrailingMention(value, token) {
    const source = typeof value === "string" ? value : "";
    return source.replace(/(^|\s)@[^\s@]*$/, `$1@${String(token).trim()} `);
  }

  const mentionQuery = useMemo(() => getActiveMentionQuery(text), [text]);
  const mentionSuggestions = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.trim().toLowerCase();
    const rows = members.filter((member) => {
      const email = String(member?.email || "").toLowerCase();
      const name = String(member?.name || "").toLowerCase();
      const userId = String(member?.user_id || "").toLowerCase();
      if (!email && !name && !userId) return false;
      if (!q) return true;
      return email.includes(q) || name.includes(q) || userId.includes(q);
    });
    return rows.slice(0, 8);
  }, [members, mentionQuery]);
  const showMentionMenu = mentionQuery !== null && mentionSuggestions.length > 0;

  useEffect(() => {
    setMentionIndex(0);
  }, [mentionQuery]);

  function applyMention(member) {
    const email = String(member?.email || "").trim();
    const nameToken = String(member?.name || "").trim().toLowerCase().replace(/\s+/g, "");
    const userId = String(member?.user_id || "").trim();
    const token = email || nameToken || userId;
    if (!token) return;
    setText((prev) => replaceTrailingMention(prev, token));
  }

  function handleTextKeyDown(event) {
    if (!showMentionMenu) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setMentionIndex((prev) => Math.min(prev + 1, mentionSuggestions.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setMentionIndex((prev) => Math.max(prev - 1, 0));
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      const picked = mentionSuggestions[mentionIndex];
      if (!picked) return;
      event.preventDefault();
      applyMention(picked);
    }
  }

  async function handleUpload(event) {
    const files = Array.from(event.target.files || []);
    if (!canWriteRecords || files.length === 0 || !entityId || !recordId) return;
    burstUntilRef.current = Date.now() + BURST_WINDOW_MS;
    setUploading(true);
    setError("");
    try {
      const session = await getSafeSession();
      const token = session?.access_token;
      const uploadedItems = [];
      const failures = [];
      for (const file of files) {
        const form = new FormData();
        form.append("entity_id", entityId);
        form.append("record_id", recordId);
        form.append("file", file);
        try {
          const res = await fetch(`${API_URL}/api/activity/attachment`, {
            method: "POST",
            headers: workspaceHeaders(token),
            body: form,
          }).then((r) => r.json());
          if (!res.ok) throw new Error(res?.errors?.[0]?.message || "Upload failed");
          if (res?.item) {
            uploadedItems.push(res.item);
          }
        } catch (err) {
          const message = String(err?.message || "Upload failed");
          failures.push(
            `${file?.name || "file"}: ${message === "Failed to fetch" ? "Network error reaching upload API" : message}`
          );
        }
      }
      if (uploadedItems.length > 0) {
        setItems((prev) => [...uploadedItems, ...prev]);
        const newest = uploadedItems[0]?.created_at;
        if (newest) {
          const prevTs = latestSeenAtRef.current ? Date.parse(latestSeenAtRef.current) : 0;
          const nextTs = Date.parse(newest);
          if (!Number.isNaN(nextTs) && nextTs > prevTs) latestSeenAtRef.current = newest;
        }
      }
      const att = await apiFetch(`/records/${entityId}/${recordId}/attachments`);
      setAttachments(att.attachments || []);
      if (failures.length > 0) setError(failures.join(" | "));
    } catch (err) {
      setError(err?.message || "Upload failed");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function handlePost() {
    if (!canWriteRecords || !text.trim() || !entityId || !recordId) return;
    burstUntilRef.current = Date.now() + BURST_WINDOW_MS;
    const body = text.trim();
    const tempId = `temp-${Date.now()}`;
    setItems((prev) => [
      {
        id: tempId,
        event_type: "comment",
        payload: { body },
        author: { email: currentUserLabel },
        created_at: new Date().toISOString(),
      },
      ...prev,
    ]);
    setText("");
    if (listRef.current) listRef.current.scrollTop = 0;
    setPosting(true);
    setError("");
    try {
      const res = await apiFetch("/api/activity/comment", {
        method: "POST",
        body: { entity_id: entityId, record_id: recordId, body, mentions: parseMentionTokens(body, members) },
      });
      if (res?.item) {
        setItems((prev) => [res.item, ...prev.filter((item) => item.id !== tempId)]);
        const createdAt = res?.item?.created_at;
        if (createdAt) {
          const prevTs = latestSeenAtRef.current ? Date.parse(latestSeenAtRef.current) : 0;
          const nextTs = Date.parse(createdAt);
          if (!Number.isNaN(nextTs) && nextTs > prevTs) latestSeenAtRef.current = createdAt;
        }
      } else {
        setItems((prev) => prev.filter((item) => item.id !== tempId));
      }
    } catch (err) {
      setItems((prev) => prev.filter((item) => item.id !== tempId));
      setText(body);
      setError(err?.message || "Failed to post comment.");
    } finally {
      setPosting(false);
    }
  }

  async function handleDeleteAttachment() {
    if (!attachmentToDelete?.id || deletingAttachmentId) return;
    setDeletingAttachmentId(attachmentToDelete.id);
    setError("");
    try {
      await apiFetch(
        `/records/${encodeURIComponent(entityId)}/${encodeURIComponent(recordId)}/attachments/${encodeURIComponent(attachmentToDelete.id)}`,
        { method: "DELETE" }
      );
      setAttachments((prev) => prev.filter((attachment) => attachment?.id !== attachmentToDelete.id));
      setItems((prev) =>
        prev.filter((item) => {
          if (item?.event_type !== "attachment") return true;
          return String(item?.payload?.attachment_id || "") !== String(attachmentToDelete.id);
        })
      );
      setAttachmentToDelete(null);
    } catch (err) {
      setError(err?.message || translateRuntime("common.attachments.delete_failed"));
    } finally {
      setDeletingAttachmentId("");
    }
  }

  if (!entityId) return <div className="alert alert-warning">{translateRuntime("common.activity_panel.missing_entity")}</div>;
  if (!recordId) return <div className="alert alert-info">{translateRuntime("common.activity_panel.save_record")}</div>;

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="shrink-0">
        <div role="tablist" className="tabs tabs-boxed w-full">
          <button
            role="tab"
            type="button"
            className={`tab ${activeTab === "activity" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("activity")}
          >
            {translateRuntime("common.activity")}
          </button>
          <button
            role="tab"
            type="button"
            className={`tab ${activeTab === "attachments" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("attachments")}
          >
            {translateRuntime("common.attachments_label")}
          </button>
        </div>
      </div>
      {activeTab === "activity" && (
        <div className="shrink-0 pt-4 space-y-2">
          <textarea
            className="textarea textarea-bordered w-full"
            placeholder={translateRuntime("common.add_note_placeholder")}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleTextKeyDown}
            disabled={!canWriteRecords || posting || uploading}
          />
          {showMentionMenu && (
            <div className="rounded-box border border-base-300 bg-base-100 p-1 max-h-48 overflow-auto">
              {mentionSuggestions.map((member, idx) => {
                const email = String(member?.email || "").trim();
                const userId = String(member?.user_id || "").trim();
                const label = member?.name || email || userId;
                if (!label) return null;
                return (
                  <button
                    key={String(member?.user_id || email || label)}
                    type="button"
                    className={`w-full text-left px-2 py-1 rounded ${idx === mentionIndex ? "bg-base-200" : "hover:bg-base-200"}`}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      applyMention(member);
                    }}
                  >
                    <div className="text-sm">{label}</div>
                    {email && label !== email && <div className="text-xs opacity-70">{email}</div>}
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button className="btn btn-primary btn-sm" onClick={handlePost} disabled={!canWriteRecords || posting || !text.trim()}>
              {translateRuntime("common.add_note")}
            </button>
            <button
              type="button"
              className={SOFT_BUTTON_SM}
              onClick={() => quickAttachInputRef.current?.click()}
              disabled={!canWriteRecords || uploading}
              title={translateRuntime("common.attach_file")}
            >
              <Paperclip className="h-4 w-4" />
              {uploading ? translateRuntime("common.uploading") : translateRuntime("common.attach")}
            </button>
            <input
              ref={quickAttachInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleUpload}
              disabled={!canWriteRecords || uploading}
            />
          </div>
        </div>
      )}
      {activeTab === "attachments" && (
        <div className="shrink-0 space-y-2 pt-4">
          <AttachmentGallery
            attachments={attachments}
            uploading={uploading}
            deletingId={deletingAttachmentId}
            canUpload={canWriteRecords}
            canDelete={canWriteRecords}
            onUpload={handleUpload}
            onDelete={(attachment) => setAttachmentToDelete(attachment)}
          />
        </div>
      )}
      {error && <div className="text-xs text-error pt-2">{error}</div>}
      {activeTab === "activity" && (
      <div ref={listRef} className="flex-1 min-h-0 overflow-auto space-y-2 pt-4">
        {loading && (
          <>
            <ActivityItemSkeleton />
            <ActivityItemSkeleton />
            <ActivityItemSkeleton wide />
          </>
        )}
        {!loading && items.length === 0 && <div className="text-xs opacity-60">{translateRuntime("common.activity_panel.empty")}</div>}
        {items.map((item) => {
          const payload = item?.payload || {};
          const type = item?.event_type;
          const kind = classifyEvent(item);
          const who = itemAuthor(item);
          const when = formatDateTime(item?.created_at);
          if (type === "comment") {
            return (
              <div key={item.id} className="card card-compact rounded-box border border-base-300 bg-base-100 text-sm">
                <div className="card-body gap-1 p-3">
                  <div className="mb-1 text-xs text-base-content/60">{who} · {when}</div>
                  <div className="whitespace-pre-wrap text-sm text-base-content">{payload?.body || ""}</div>
                </div>
              </div>
            );
          }
          if (type === "attachment") {
            const removed = payload?.action === "removed";
            return (
              <div key={item.id} className="card card-compact rounded-box border border-base-300 bg-base-100 text-sm">
                <div className="card-body gap-1 p-3">
                  <div className="mb-1 text-xs text-base-content/60">{who} · {when}</div>
                  <div className="flex items-center gap-2">
                    {removed ? (
                      <>
                        <Trash2 className="h-4 w-4 text-base-content/60" />
                        <span className="text-sm">
                          {translateRuntime("common.activity_panel.removed_attachment", {
                            name: payload?.filename || translateRuntime("common.activity_panel.attachment"),
                          })}
                        </span>
                      </>
                    ) : (
                      <>
                        <Paperclip className="h-4 w-4 text-base-content/60" />
                        <span className="text-sm">{payload?.filename || translateRuntime("common.activity_panel.attachment")}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          }
          const changes = Array.isArray(payload?.changes) ? payload.changes : [];
          const systemMessage = typeof payload?.message === "string" ? payload.message.trim() : "";
          return (
            <div key={item.id} className="flex items-start gap-2 rounded-box bg-base-200/50 px-3 py-2">
              <div className="pt-0.5">
                {kind === "system_event" && <Info className="h-3.5 w-3.5 text-base-content/40" />}
              </div>
              <div className="min-w-0">
                <div className="mb-1 text-xs text-base-content/60">{who} · {when}</div>
                {changes.length > 0 ? (
                  <ul className="mt-1 space-y-1 text-xs text-base-content/60">
                    {changes.map((change, idx) => (
                      <li key={`${item.id}-${idx}`}>
                        {humanizeValue(change?.label || change?.field || "Field")}: {humanizeValue(change?.from)} → {humanizeValue(change?.to)}
                      </li>
                    ))}
                  </ul>
                ) : systemMessage ? (
                  <div className="mt-1 text-xs text-base-content/70">{systemMessage}</div>
                ) : (
                  <div className="mt-1 text-xs text-base-content/60">{translateRuntime("common.activity_panel.record_updated")}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      )}
      {attachmentToDelete ? (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-semibold text-base">{translateRuntime("common.attachments.delete_title")}</h3>
            <p className="mt-2 text-sm opacity-80 break-all">
              {translateRuntime("common.attachments.delete_body_prefix")}{" "}
              <span className="font-medium">{attachmentToDelete.filename || translateRuntime("common.attachments.this_file")}</span>{" "}
              {translateRuntime("common.attachments.delete_body_suffix")}
            </p>
            <div className="modal-action">
              <button className="btn btn-sm" type="button" onClick={() => setAttachmentToDelete(null)} disabled={!!deletingAttachmentId}>
                {translateRuntime("common.cancel")}
              </button>
              <button className="btn btn-sm btn-error" type="button" onClick={handleDeleteAttachment} disabled={!!deletingAttachmentId}>
                {deletingAttachmentId ? translateRuntime("common.deleting") : translateRuntime("common.delete")}
              </button>
            </div>
          </div>
          <button className="modal-backdrop" type="button" onClick={() => setAttachmentToDelete(null)}>
            {translateRuntime("common.close")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
  function workspaceHeaders(token) {
    const workspaceId = getActiveWorkspaceId();
    return {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
    };
  }
