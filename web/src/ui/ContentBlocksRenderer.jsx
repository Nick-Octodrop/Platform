import React, { useMemo, useState, useEffect, useRef, createContext, useContext } from "react";
import { apiFetch, API_URL } from "../api.js";
import { supabase } from "../supabase.js";
import { evalCondition } from "../utils/conditions.js";
import Tabs from "../components/Tabs.jsx";
import ViewModesBlock from "./ViewModesBlock.jsx";
import { Info, Paperclip } from "lucide-react";

const GAP_MAP = {
  sm: "gap-2",
  md: "gap-4",
  lg: "gap-6",
};
const SPAN_MAP = {
  1: "col-span-1",
  2: "col-span-2",
  3: "col-span-3",
  4: "col-span-4",
  5: "col-span-5",
  6: "col-span-6",
  7: "col-span-7",
  8: "col-span-8",
  9: "col-span-9",
  10: "col-span-10",
  11: "col-span-11",
  12: "col-span-12",
};

function gapClass(value) {
  return GAP_MAP[value] || GAP_MAP.md;
}

function spanClass(span) {
  return SPAN_MAP[span] || SPAN_MAP[12];
}

function normalizeViewTarget(target) {
  if (!target || typeof target !== "string") return null;
  if (target.startsWith("view:")) return target.slice(5);
  if (target.startsWith("page:")) return null;
  return target;
}

const RecordScopeContext = createContext(null);

function hasViewModes(blocks) {
  if (!Array.isArray(blocks)) return false;
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    if (block.kind === "view_modes") return true;
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
    if (block.kind === "view_modes" || block.kind === "view" || block.kind === "record" || block.kind === "chatter") return true;
    if (block.kind === "container" && hasFillHeight(block.content)) return true;
    if (block.kind === "stack" && hasFillHeight(block.content)) return true;
    if (block.kind === "grid" && Array.isArray(block.items) && block.items.some((item) => hasFillHeight(item?.content))) return true;
    if (block.kind === "tabs" && Array.isArray(block.tabs) && block.tabs.some((tab) => hasFillHeight(tab?.content))) return true;
  }
  return false;
}

export default function ContentBlocksRenderer({ blocks, renderView, recordId, searchParams, setSearchParams, manifest, moduleId, actionsMap, onNavigate, onRunAction, onConfirm, onPrompt, externalRefreshTick = 0, previewMode = false, bootstrap = null, bootstrapVersion = 0, bootstrapLoading = false }) {
  const safeBlocks = Array.isArray(blocks) ? blocks : [];
  const fullHeight = hasViewModes(safeBlocks) || hasFillHeight(safeBlocks);
  const inherited = useContext(RecordScopeContext);
  const baseContext = inherited || (recordId ? { entityId: null, recordId, record: null, setRecord: () => {} } : null);
  const content = (
    <div className={fullHeight ? "h-full min-h-0 flex flex-col overflow-hidden" : "space-y-4"}>
      {safeBlocks.map((block, idx) => {
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
            externalRefreshTick={externalRefreshTick}
            recordContext={baseContext}
            previewMode={previewMode}
            bootstrap={bootstrap}
            bootstrapVersion={bootstrapVersion}
            bootstrapLoading={bootstrapLoading}
          />
        );
        if (!fullHeight) return node;
        return (
          <div key={`wrap-${block?.kind || "block"}-${idx}`} className="flex-1 min-h-0 h-full overflow-hidden">
            {node}
          </div>
        );
      })}
    </div>
  );
  if (!inherited && baseContext) {
    return <RecordScopeContext.Provider value={baseContext}>{content}</RecordScopeContext.Provider>;
  }
  return content;
}

function BlockRenderer({ block, renderView, recordId, searchParams, setSearchParams, manifest, moduleId, actionsMap, recordContext, onNavigate, onRunAction, onConfirm, onPrompt, externalRefreshTick = 0, previewMode = false, bootstrap, bootstrapVersion, bootstrapLoading }) {
  if (!block || typeof block !== "object") {
    return <div className="alert alert-warning">Invalid block</div>;
  }
  const kind = block.kind;

  if (kind === "view") {
    const viewId = normalizeViewTarget(block.target);
    if (!viewId) return <div className="alert alert-error">Invalid view target</div>;
    return (
      <div className="flex-1 h-full min-h-0 flex flex-col overflow-hidden">
        {renderView(viewId, recordContext, previewMode, { showViewTitle: false })}
      </div>
    );
  }

  if (kind === "view_modes") {
    return (
      <ViewModesBlock
        block={block}
        manifest={manifest}
        searchParams={searchParams}
        setSearchParams={setSearchParams}
        onNavigate={onNavigate}
        onRunAction={onRunAction}
        actionsMap={actionsMap}
        onConfirm={onConfirm}
        onPrompt={onPrompt}
        externalRefreshTick={externalRefreshTick}
        previewMode={previewMode}
        bootstrap={bootstrap}
        bootstrapVersion={bootstrapVersion}
        bootstrapLoading={bootstrapLoading}
      />
    );
  }

  if (kind === "stack") {
    return (
      <div className={`flex flex-col ${gapClass(block.gap)}`}>
        <ContentBlocksRenderer blocks={block.content} renderView={renderView} recordId={recordId} searchParams={searchParams} setSearchParams={setSearchParams} manifest={manifest} moduleId={moduleId} actionsMap={actionsMap} onNavigate={onNavigate} onRunAction={onRunAction} onConfirm={onConfirm} onPrompt={onPrompt} externalRefreshTick={externalRefreshTick} previewMode={previewMode} bootstrap={bootstrap} bootstrapVersion={bootstrapVersion} bootstrapLoading={bootstrapLoading} />
      </div>
    );
  }

  if (kind === "grid") {
    return (
      <div className={`grid grid-cols-12 items-stretch h-full min-h-0 ${gapClass(block.gap)}`}>
        {(block.items || []).map((item, idx) => (
          <div key={`${item.span || "span"}-${idx}`} className={`${spanClass(item.span)} h-full min-h-0 flex flex-col overflow-hidden`}>
            <div className="flex-1 min-h-0 overflow-hidden">
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
                externalRefreshTick={externalRefreshTick}
                previewMode={previewMode}
                bootstrap={bootstrap}
                bootstrapVersion={bootstrapVersion}
                bootstrapLoading={bootstrapLoading}
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

    return (
      <div>
        <Tabs tabs={tabs} activeId={activeId} onChange={setActiveId} />
        <div className="mt-4">
          {tabs.map((tab) =>
            tab.id === activeId ? (
              <ContentBlocksRenderer key={tab.id} blocks={tab.content} renderView={renderView} recordId={recordId} searchParams={searchParams} setSearchParams={setSearchParams} manifest={manifest} moduleId={moduleId} actionsMap={actionsMap} onNavigate={onNavigate} onRunAction={onRunAction} onConfirm={onConfirm} onPrompt={onPrompt} externalRefreshTick={externalRefreshTick} previewMode={previewMode} bootstrap={bootstrap} bootstrapVersion={bootstrapVersion} bootstrapLoading={bootstrapLoading} />
            ) : null
          )}
        </div>
      </div>
    );
  }

  if (kind === "text") {
    return <div className="prose max-w-none whitespace-pre-wrap">{block.text || ""}</div>;
  }

  if (kind === "container") {
    const variant = block.variant || "card";
    const title = block.title;
    const hasViewModes = Array.isArray(block.content) && block.content.some((b) => b?.kind === "view_modes");
    const hasInnerScroll = Array.isArray(block.content) && block.content.some((b) => b?.kind === "view" || b?.kind === "view_modes");
    const shouldFill = Array.isArray(block.content) && block.content.some((b) => b?.kind === "view" || b?.kind === "view_modes" || b?.kind === "chatter");
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
        externalRefreshTick={externalRefreshTick}
        previewMode={previewMode}
        bootstrap={bootstrap}
        bootstrapVersion={bootstrapVersion}
        bootstrapLoading={bootstrapLoading}
      />
    );
    if (variant === "panel") {
      return (
        <div className={`bg-base-200 rounded-box ${shouldFill ? "h-full min-h-0" : ""} flex flex-col overflow-hidden`}>
          {title && (
            <div className="shrink-0 px-4 pt-4 text-sm font-semibold">
              {title}
            </div>
          )}
          <div className={`flex-1 min-h-0 ${hasInnerScroll ? "overflow-hidden flex flex-col" : "overflow-auto"} px-4 pb-4 ${title ? "pt-3" : "pt-4"}`}>{content}</div>
        </div>
      );
    }
    if (variant === "flat") {
      return (
        <div className={`${shouldFill ? "h-full min-h-0" : ""} flex flex-col overflow-hidden`}>
          {title && (
            <div className="shrink-0 text-sm font-semibold">
              {title}
            </div>
          )}
          <div className={`flex-1 min-h-0 ${hasInnerScroll ? "overflow-hidden flex flex-col" : "overflow-auto"} ${title ? "pt-3" : ""}`}>{content}</div>
        </div>
      );
    }
    return (
      <div className={`card bg-base-100 shadow ${shouldFill ? "h-full min-h-0" : ""} flex flex-col overflow-hidden`}>
        <div className="card-body flex-1 min-h-0 flex flex-col overflow-hidden">
          {title && <div className="shrink-0 text-sm font-semibold">{title}</div>}
          <div className={`flex-1 min-h-0 ${hasInnerScroll ? "overflow-hidden flex flex-col" : "overflow-auto"} ${title ? "pt-3" : ""}`}>{content}</div>
        </div>
      </div>
    );
  }

  if (kind === "record") {
    const entityId = block.entity_id;
    const queryKey = block.record_id_query || "record";
    const recordIdFromQuery = searchParams?.get ? searchParams.get(queryKey) : null;
    if (!entityId) return <div className="alert alert-warning">Record block missing entity_id</div>;
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
              externalRefreshTick={externalRefreshTick}
              previewMode={previewMode}
              bootstrap={bootstrap}
              bootstrapVersion={bootstrapVersion}
              bootstrapLoading={bootstrapLoading}
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
      return <div className="alert bg-base-200 text-base-content border border-base-300">Activity feed unavailable in preview.</div>;
    }
    const entityId = block.entity_id || recordContext?.entityId;
    const ref = block.record_ref || (recordContext?.recordId ? "$record.id" : null);
    let resolvedId = recordId || recordContext?.recordId;
    if (typeof ref === "string" && ref !== "$record.id") {
      resolvedId = ref;
    }
    return <ChatterPanel entityId={entityId} recordId={resolvedId} />;
  }

  if (previewMode) {
    return null;
  }
  return <div className="alert alert-warning">Unsupported block kind: {kind}</div>;
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
    <ul className="steps steps-horizontal w-full">
      {options.map((opt) => {
        const isActive = value === opt.value;
        return (
          <li key={opt.value} className={`step ${isActive ? "step-primary" : ""}`}>
            {opt.label ?? opt.value}
          </li>
        );
      })}
    </ul>
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
        const res = await apiFetch(`/records/${entityId}/${recordId}`);
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

function ChatterPanel({ entityId, recordId }) {
  const [items, setItems] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [activeTab, setActiveTab] = useState("activity");
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [currentUserLabel, setCurrentUserLabel] = useState("You");
  const quickAttachInputRef = useRef(null);
  const listRef = useRef(null);

  function formatWhen(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }

  function itemAuthor(item) {
    const author = item?.author;
    if (!author || typeof author !== "object") return "System";
    return author.name || author.email || "System";
  }

  function humanizeValue(value) {
    if (value === null || value === undefined || value === "") return "(empty)";
    const text = String(value).replace(/_/g, " ").trim();
    if (!text) return "(empty)";
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
        const res = await apiFetch(`/api/activity?entity_id=${encodeURIComponent(entityId)}&record_id=${encodeURIComponent(recordId)}&limit=100`);
        setItems(Array.isArray(res.items) ? res.items : []);
        const att = await apiFetch(`/records/${entityId}/${recordId}/attachments`);
        setAttachments(att.attachments || []);
      } catch (err) {
        setItems([]);
        setAttachments([]);
        setError(err?.message || "Failed to load activity.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [entityId, recordId]);

  useEffect(() => {
    let mounted = true;
    async function loadCurrentUser() {
      try {
        const session = (await supabase.auth.getSession()).data.session;
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

  async function handleUpload(event) {
    const file = event.target.files?.[0];
    if (!file || !entityId || !recordId) return;
    setUploading(true);
    setError("");
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const token = session?.access_token;
      const form = new FormData();
      form.append("entity_id", entityId);
      form.append("record_id", recordId);
      form.append("file", file);
      const res = await fetch(`${API_URL}/api/activity/attachment`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      }).then((r) => r.json());
      if (!res.ok) throw new Error(res?.errors?.[0]?.message || "Upload failed");
      if (res?.item) {
        setItems((prev) => [res.item, ...prev]);
      }
      const att = await apiFetch(`/records/${entityId}/${recordId}/attachments`);
      setAttachments(att.attachments || []);
    } catch (err) {
      setError(err?.message || "Upload failed");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function handlePost() {
    if (!text.trim() || !entityId || !recordId) return;
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
        body: { entity_id: entityId, record_id: recordId, body },
      });
      if (res?.item) {
        setItems((prev) => [res.item, ...prev.filter((item) => item.id !== tempId)]);
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

  async function handleOpenAttachment(attachment) {
    if (!attachment?.id) return;
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const token = session?.access_token;
      if (!token) {
        window.open(`${API_URL}/attachments/${attachment.id}/download`, "_blank", "noopener,noreferrer");
        return;
      }
      const res = await fetch(`${API_URL}/attachments/${attachment.id}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      console.warn("attachment_open_failed", err);
    }
  }

  if (!entityId) return <div className="alert alert-warning">Chatter missing entity_id</div>;
  if (!recordId) return <div className="alert alert-info">Save this record to use Activity</div>;

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
            Activity
          </button>
          <button
            role="tab"
            type="button"
            className={`tab ${activeTab === "attachments" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("attachments")}
          >
            Attachments
          </button>
        </div>
      </div>
      {activeTab === "activity" && (
        <div className="shrink-0 pt-4 space-y-2">
          <textarea
            className="textarea textarea-bordered w-full"
            placeholder="Add a note…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <button className="btn btn-primary btn-sm" onClick={handlePost} disabled={posting || !text.trim()}>
              Add Note
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => quickAttachInputRef.current?.click()}
              disabled={uploading}
              title="Attach file"
            >
              <Paperclip className="h-4 w-4" />
              {uploading ? "Uploading..." : "Attach"}
            </button>
            <input
              ref={quickAttachInputRef}
              type="file"
              className="hidden"
              onChange={handleUpload}
              disabled={uploading}
            />
          </div>
        </div>
      )}
      {activeTab === "attachments" && (
        <div className="shrink-0 space-y-2 pt-4">
          <input type="file" className="file-input file-input-bordered w-full" onChange={handleUpload} disabled={uploading} />
          {attachments.length === 0 && <div className="text-xs opacity-60">No attachments</div>}
          <div className="space-y-2">
            {attachments.map((attachment) => (
              <button
                key={attachment.id}
                className="w-full rounded-box border border-base-300 bg-base-100 px-3 py-2 text-left hover:border-primary/40 hover:bg-base-200"
                type="button"
                onClick={() => handleOpenAttachment(attachment)}
              >
                <div className="truncate text-sm font-medium">{attachment.filename || "Attachment"}</div>
                <div className="mt-1 text-xs opacity-60">
                  {attachment.mime_type || "file"}
                  {typeof attachment.size === "number" ? ` · ${attachment.size} bytes` : ""}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
      {error && <div className="text-xs text-error pt-2">{error}</div>}
      {activeTab === "activity" && (
      <div ref={listRef} className="flex-1 min-h-0 overflow-auto space-y-2 pt-4">
        {loading && <div className="text-xs opacity-60">Activity loading...</div>}
        {!loading && items.length === 0 && <div className="text-xs opacity-60">No activity yet.</div>}
        {items.map((item) => {
          const payload = item?.payload || {};
          const type = item?.event_type;
          const kind = classifyEvent(item);
          const who = itemAuthor(item);
          const when = formatWhen(item?.created_at);
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
            return (
              <div key={item.id} className="card card-compact rounded-box border border-base-300 bg-base-100 text-sm">
                <div className="card-body gap-1 p-3">
                  <div className="mb-1 text-xs text-base-content/60">{who} · {when}</div>
                  <div className="flex items-center gap-2">
                    <Paperclip className="h-4 w-4 text-base-content/60" />
                    <button
                      className="link link-primary text-sm"
                      type="button"
                      onClick={() => handleOpenAttachment({ id: payload?.attachment_id })}
                    >
                      {payload?.filename || "Attachment"}
                    </button>
                  </div>
                </div>
              </div>
            );
          }
          const changes = Array.isArray(payload?.changes) ? payload.changes : [];
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
                ) : (
                  <div className="mt-1 text-xs text-base-content/60">Record updated.</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}
