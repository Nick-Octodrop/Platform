import React, { useEffect, useMemo, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { MessageSquare, MoreHorizontal, ShieldCheck } from "lucide-react";
import Tabs from "../../components/Tabs.jsx";
import ValidationPanel from "../../components/ValidationPanel.jsx";
import TemplateAgentPane from "./TemplateAgentPane.jsx";
import { PRIMARY_BUTTON_SM, SOFT_BUTTON_SM } from "../../components/buttonStyles.js";
import { apiFetch } from "../../api.js";
import { useAccessContext } from "../../access.js";
import useMediaQuery from "../../hooks/useMediaQuery.js";

const DEFAULT_SAMPLE = { entity_id: "", record_id: "" };

export default function TemplateStudioShell({
  title,
  recordId,
  user,
  profile,
  loadRecord,
  saveRecord,
  validate,
  preview,
  extraActions = [],
  extraContext = {},
  initialTabId,
  renderLeftPane,
  renderValidationPanel,
  showFixWithAi = true,
  enableAutosave = true,
  activeTab: externalActiveTab,
  onTabChange,
}) {
  const { isSuperadmin } = useAccessContext();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [record, setRecord] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("Saved");
  const [activeTab, setActiveTab] = useState(initialTabId || profile?.defaultTabId);
  const [validationState, setValidationState] = useState(null);
  const [previewState, setPreviewState] = useState(null);
  const [entities, setEntities] = useState([]);
  const [sample, setSample] = useState(DEFAULT_SAMPLE);
  const [renderModalOpen, setRenderModalOpen] = useState(false);
  const [renderSample, setRenderSample] = useState({ entity_id: "", record_id: "" });
  const [mobileUtilitySheet, setMobileUtilitySheet] = useState("");
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const debounceRef = useRef(null);
  const previewDebounceRef = useRef(null);
  const lastAutoPreviewRef = useRef("");
  const validateDebounceRef = useRef(null);
  const lastValidateSigRef = useRef("");
  const loadRecordRef = useRef(loadRecord);
  const layoutKey = useMemo(() => {
    return `template-studio:${profile?.kind || "default"}`;
  }, [profile?.kind]);

  const sampleStorageKey = useMemo(() => {
    return `template-studio-sample:${profile?.kind || "template"}`;
  }, [profile?.kind]);

  useEffect(() => {
    let mounted = true;
    async function loadMeta() {
      if (!profile?.samplePicker?.enabled) return;
      try {
        const res = await apiFetch("/templates/meta");
        if (!mounted) return;
        setEntities(res?.entities || []);
      } catch {
        if (mounted) setEntities([]);
      }
    }
    loadMeta();
    return () => {
      mounted = false;
    };
  }, [profile?.samplePicker?.enabled]);

  useEffect(() => {
    const raw = localStorage.getItem(sampleStorageKey);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.entity_id) {
          setSample(parsed);
        }
      } catch {
        // ignore
      }
    }
  }, [sampleStorageKey]);

  useEffect(() => {
    if (!sample?.entity_id) return;
    localStorage.setItem(sampleStorageKey, JSON.stringify(sample));
  }, [sample, sampleStorageKey]);

  useEffect(() => {
    if (!entities.length) return;
    const currentEntityId = sample?.entity_id || "";
    const hasCurrentEntity = currentEntityId && entities.some((ent) => ent.id === currentEntityId);
    if (hasCurrentEntity) return;
    const templateEntityId = draft?.variables_schema?.entity_id;
    const hasTemplateEntity = templateEntityId && entities.some((ent) => ent.id === templateEntityId);
    if (hasTemplateEntity) {
      setSample((prev) => ({ ...(prev || {}), entity_id: templateEntityId, record_id: "" }));
      return;
    }
    if (currentEntityId) {
      setSample(DEFAULT_SAMPLE);
    }
  }, [entities, draft?.variables_schema?.entity_id, sample?.entity_id]);

  useEffect(() => {
    if (!sample?.entity_id) {
      setPreviewState(null);
    }
  }, [sample?.entity_id]);

  useEffect(() => {
    loadRecordRef.current = loadRecord;
  }, [loadRecord]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      if (!recordId || !loadRecordRef.current) return;
      const res = await loadRecordRef.current(recordId);
      if (!mounted) return;
      setRecord(res);
      setDraft(res);
      setSaveStatus("Saved");
      setValidationState(null);
      setPreviewState(null);
    }
    load();
    return () => {
      mounted = false;
    };
  }, [recordId]);

  useEffect(() => {
    if (externalActiveTab !== undefined) return;
    if (!activeTab) {
      setActiveTab(initialTabId || profile?.defaultTabId);
    }
  }, [activeTab, initialTabId, profile?.defaultTabId, externalActiveTab]);

  useEffect(() => {
    if (!enableAutosave || !saveRecord) return;
    if (!draft || !record) return;
    const draftStr = JSON.stringify(draft);
    const recordStr = JSON.stringify(record);
    if (draftStr === recordStr) {
      if (saveStatus !== "Saved") {
        setSaveStatus("Saved");
      }
      return;
    }
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    setSaveStatus("Unsaved");
    debounceRef.current = setTimeout(async () => {
      setSaving(true);
      setSaveStatus("Saving…");
      try {
        const updated = await saveRecord(recordId, draft);
        setRecord(updated);
        setDraft(updated);
        setSaveStatus("Saved");
      } catch {
        setSaveStatus("Save failed");
      }
      setSaving(false);
    }, 800);
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [draft, record, recordId, saveRecord, enableAutosave]);

  async function saveNow() {
    if (!saveRecord || !draft) return;
    setSaving(true);
    setSaveStatus("Saving…");
    try {
      const updated = await saveRecord(recordId, draft);
      setRecord(updated);
      setDraft(updated);
      setSaveStatus("Saved");
    } catch {
      setSaveStatus("Save failed");
    }
    setSaving(false);
  }

  async function runValidate() {
    if (!validate) return;
    try {
      const res = await validate(recordId, { sample });
      setValidationState(res);
    } catch (err) {
      setValidationState({
        compiled_ok: false,
        errors: [{ message: err?.message || "Validation failed", line: 1, col: 1 }],
        undefined: [],
        warnings: [],
        validated_at: null,
      });
    }
  }

  async function runPreview(sampleOverride = null) {
    if (!preview) return;
    try {
      const res = await preview(recordId, { sample: sampleOverride || sample });
      setPreviewState(res);
      setValidationState((prev) => ({
        ...(prev || {}),
        errors: [],
      }));
    } catch (err) {
      setPreviewState({ error: err?.message || "Preview failed" });
      setValidationState({
        compiled_ok: false,
        errors: [{ message: err?.message || "Preview failed", line: 1, col: 1 }],
        undefined: [],
        warnings: [],
        validated_at: null,
      });
    }
  }

  async function runPreviewOnce(sampleOverride) {
    if (!preview) return null;
    try {
      const res = await preview(recordId, { sample: sampleOverride || sample });
      setValidationState((prev) => ({
        ...(prev || {}),
        errors: [],
      }));
      return res;
    } catch (err) {
      setValidationState({
        compiled_ok: false,
        errors: [{ message: err?.message || "Preview failed", line: 1, col: 1 }],
        undefined: [],
        warnings: [],
        validated_at: null,
      });
      return null;
    }
  }

  function openRenderModal() {
    setRenderSample({ entity_id: sample?.entity_id || "", record_id: "" });
    setRenderModalOpen(true);
  }

  const ctx = {
    record,
    draft,
    setDraft,
    saveNow,
    validationState,
    setValidationState,
    previewState,
    setPreviewState,
    sample,
    setSample,
    runValidate,
    runPreview,
    runPreviewOnce,
    entities,
    activeTab: externalActiveTab ?? activeTab,
    setActiveTab: onTabChange ?? setActiveTab,
    renderModalOpen,
    setRenderModalOpen,
    renderSample,
    setRenderSample,
    openRenderModal,
    ...extraContext,
  };

  const actions = [...(profile?.actions || []), ...(extraActions || [])];
  const activeTabId = externalActiveTab ?? activeTab;
  const handleTabChange = onTabChange ?? setActiveTab;
  const leftPaneContent = renderLeftPane
    ? renderLeftPane(ctx)
    : (
      <TemplateAgentPane
        disabled={saving}
        initialMessage={profile?.agentMessage}
        agentKind={profile?.kind}
        user={user}
      />
    );
  const undefinedList = (validationState?.undefined && validationState.undefined.length > 0)
    ? validationState.undefined
    : (validationState?.possible_undefined || []);
  const mergedWarnings = [
    ...(validationState?.warnings || []),
    ...undefinedList.map((item) => `Undefined: ${item}`),
  ];
  const validationContent = renderValidationPanel ? renderValidationPanel(ctx) : (
    <ValidationPanel
      title="Validation"
      errors={validationState?.errors || []}
      warnings={mergedWarnings}
      idleMessage="Validation runs automatically while you edit."
      showSuccess={true}
      showFix={showFixWithAi && isSuperadmin}
      fixDisabled
    />
  );

  const primaryAction = actions.find((action) => action.kind === "primary") || null;
  const secondaryActions = actions.filter((action) => action !== primaryAction);

  useEffect(() => {
    if (!validate) return;
    if (!draft || !recordId) return;
    const sig = JSON.stringify(draft);
    if (sig === lastValidateSigRef.current) return;
    if (validateDebounceRef.current) {
      clearTimeout(validateDebounceRef.current);
    }
    validateDebounceRef.current = setTimeout(() => {
      runValidate();
      lastValidateSigRef.current = sig;
    }, 700);
    return () => {
      if (validateDebounceRef.current) {
        clearTimeout(validateDebounceRef.current);
      }
    };
  }, [draft, validate, recordId]);

  useEffect(() => {
    if (!profile?.autoPreview) return;
    if (activeTabId !== "preview") return;
    if (!sample?.entity_id) return;
    if (!draft) return;
    const sig = JSON.stringify({ entity_id: sample.entity_id, draft });
    if (sig === lastAutoPreviewRef.current) {
      return;
    }
    if (previewDebounceRef.current) {
      clearTimeout(previewDebounceRef.current);
    }
    previewDebounceRef.current = setTimeout(() => {
      const mode = profile?.autoPreviewMode || "sample";
      const previewSample = mode === "placeholder"
        ? { entity_id: sample.entity_id, placeholder: true }
        : sample;
      runPreview(previewSample);
      lastAutoPreviewRef.current = sig;
    }, 900);
    return () => {
      if (previewDebounceRef.current) {
        clearTimeout(previewDebounceRef.current);
      }
    };
  }, [draft, sample, activeTabId, profile?.autoPreview, profile?.autoPreviewMode]);

  if (isMobile) {
    return (
      <div className="min-h-full bg-base-100">
        <div className="p-4 flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-2xl font-semibold truncate">{title}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {primaryAction && (
                <button
                  className={PRIMARY_BUTTON_SM}
                  onClick={() => primaryAction.onClick?.(ctx)}
                  disabled={saving || primaryAction.disabled}
                >
                  {primaryAction.label}
                </button>
              )}
              {(secondaryActions.length > 0 || extraActions.length > 0) && (
                <div className="relative">
                  <button
                    type="button"
                    className={SOFT_BUTTON_SM}
                    aria-label="More actions"
                    onClick={() => setMobileActionsOpen((open) => !open)}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  {mobileActionsOpen && (
                    <ul className="absolute right-0 top-full mt-2 menu p-2 shadow bg-base-100 rounded-box w-56 z-[220] border border-base-300">
                      {secondaryActions.map((action) => (
                        <li key={action.id}>
                          <button
                            onClick={() => {
                              action.onClick?.(ctx);
                              setMobileActionsOpen(false);
                            }}
                            disabled={saving || action.disabled}
                          >
                            {action.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className={SOFT_BUTTON_SM}
              onClick={() => setMobileUtilitySheet("agent")}
            >
              <MessageSquare className="h-4 w-4" />
              Agent
            </button>
            <button
              type="button"
              className={SOFT_BUTTON_SM}
              onClick={() => setMobileUtilitySheet("validation")}
            >
              <ShieldCheck className="h-4 w-4" />
              Validation
            </button>
          </div>

          <div>
            <Tabs
              activeId={activeTabId}
              onChange={handleTabChange}
              tabs={(profile?.rightTabs || []).map((tab) => ({ id: tab.id, label: tab.label }))}
            />
          </div>

          <div className="flex flex-col gap-4 min-w-0">
            {(profile?.rightTabs || []).map((tab) => {
              if (tab.id !== activeTabId) return null;
              return <div key={tab.id}>{tab.render(ctx)}</div>;
            })}
          </div>
        </div>

        {mobileUtilitySheet && (
          <div className="fixed inset-0 z-[220]">
            <button
              type="button"
              className="absolute inset-0 bg-base-content/35"
              aria-label="Close panel"
              onClick={() => setMobileUtilitySheet("")}
            />
            <div className="absolute inset-x-0 bottom-0 max-h-[85vh] rounded-t-3xl bg-base-100 border-t border-base-300 shadow-2xl p-4 flex flex-col">
              <div className="mx-auto mb-4 h-1.5 w-24 rounded-full bg-base-300" />
              <div className="flex items-center justify-between gap-2 pb-3">
                <div className="text-sm font-semibold">
                  {mobileUtilitySheet === "agent" ? "Agent" : ""}
                </div>
                <button type="button" className={SOFT_BUTTON_SM} onClick={() => setMobileUtilitySheet("")}>
                  Done
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-auto">
                {mobileUtilitySheet === "agent" ? leftPaneContent : validationContent}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-6rem)] min-h-0 flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0">
        <PanelGroup direction="horizontal" autoSaveId={`${layoutKey}:horizontal`}>
          <Panel defaultSize={22} minSize={22} maxSize={40}>
            <div className="card bg-base-100 shadow h-full min-h-0 flex flex-col overflow-hidden">
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden p-6">
                {leftPaneContent}
              </div>
            </div>
          </Panel>
          <PanelResizeHandle className="w-2 bg-base-200 hover:bg-base-300" />
          <Panel minSize={55}>
            <div className="card bg-base-100 shadow h-full min-h-0 flex flex-col overflow-hidden">
              <PanelGroup direction="vertical" autoSaveId={`${layoutKey}:vertical`}>
                <Panel defaultSize={88} minSize={55}>
                  <div className="h-full flex flex-col min-h-0 p-6">
                    <div className="flex items-center justify-end mb-3">
                      <div className="flex items-center gap-2">
                        {actions.map((action) => {
                          const cls = action.kind === "primary" ? PRIMARY_BUTTON_SM : SOFT_BUTTON_SM;
                          return (
                            <button
                              key={action.id}
                              className={cls}
                              onClick={() => action.onClick?.(ctx)}
                              disabled={saving || action.disabled}
                            >
                              {action.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="mb-3">
                      <Tabs
                        activeId={activeTabId}
                        onChange={handleTabChange}
                        tabs={(profile?.rightTabs || []).map((tab) => ({ id: tab.id, label: tab.label }))}
                      />
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto bg-base-100">
                      {(profile?.rightTabs || []).map((tab) => {
                        if (tab.id === "preview") {
                          const isActive = tab.id === activeTabId;
                          return (
                            <div
                              key={tab.id}
                              className={`h-full ${isActive ? "" : "hidden"}`}
                              aria-hidden={!isActive}
                            >
                              {tab.render(ctx)}
                            </div>
                          );
                        }
                        return tab.id === activeTabId ? (
                          <div key={tab.id} className="h-full">
                            {tab.render(ctx)}
                          </div>
                        ) : null;
                      })}
                    </div>
                  </div>
                </Panel>
                <PanelResizeHandle className="h-2 bg-base-200 hover:bg-base-300" />
                <Panel defaultSize={12} minSize={12} maxSize={40}>
                  <div className="h-full border-t border-base-200 bg-base-100 p-6 overflow-y-auto">
                    {validationContent}
                  </div>
                </Panel>
              </PanelGroup>
            </div>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}

 
